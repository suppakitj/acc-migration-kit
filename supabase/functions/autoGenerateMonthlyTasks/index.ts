import { createClientFromRequest } from '../_shared/base44-compat.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Support both webhook (no auth) and user-triggered (with auth)
    let triggeredBy = 'auto-cron';
    try {
      const user = await base44.auth.me();
      if (user) triggeredBy = user.full_name || user.email;
    } catch {}

    // Bangkok timezone
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();
    const monthKey = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;

    // Support force_retry param (skip last_auto_generate check but still dedup tasks)
    let forceRetry = false;
    try {
      const body = await req.clone().json();
      if (body?.force_retry === true) forceRetry = true;
    } catch {}

    // Check if already generated this month
    const configs = await base44.asServiceRole.entities.AppConfig.filter({ key: 'last_auto_generate' });
    const lastGenerated = configs.length > 0 ? configs[0].value : '';

    if (lastGenerated === monthKey && !forceRetry) {
      return Response.json({
        success: true,
        skipped: true,
        message: `เดือน ${monthKey} สร้างงานไปแล้ว — ข้าม`,
      });
    }

    if (forceRetry) {
      console.log(`Force retry mode — bypassing last_auto_generate check for ${monthKey}`);
    }

    // === Replicate generateMonthlyTasks logic (dry_run: false) ===
    const delay = (ms) => new Promise(r => setTimeout(r, ms));

    // Fetch active templates
    const allTemplates = await base44.asServiceRole.entities.TaskTemplate.filter(
      { status: 'active' }, '-created_date', 500
    );

    // Filter templates applicable for this month
    const templates = allTemplates.filter(tmpl => {
      if (tmpl.recurring_type === 'quarterly') {
        if (tmpl.applicable_months?.length > 0) return tmpl.applicable_months.includes(currentMonth);
        return [1, 4, 7, 10].includes(currentMonth);
      }
      if (tmpl.recurring_type === 'yearly') {
        if (tmpl.applicable_months?.length > 0) return tmpl.applicable_months.includes(currentMonth);
        return currentMonth === 1;
      }
      if (tmpl.applicable_months?.length > 0) return tmpl.applicable_months.includes(currentMonth);
      return true;
    });

    await delay(500);

    // Fetch active customers (paginated)
    let customers = [];
    let custSkip = 0;
    while (true) {
      const page = await base44.asServiceRole.entities.Customer.filter(
        { status: 'active' }, '-created_date', 100, custSkip
      );
      if (!Array.isArray(page) || page.length === 0) break;
      customers = customers.concat(page);
      if (page.length < 100) break;
      custSkip += 100;
      await delay(500);
    }

    await delay(500);

    // Fetch existing recurring tasks for dedup (paginated)
    const monthStr = String(currentMonth).padStart(2, '0');
    const existingKeys = new Set();
    let taskSkip = 0;
    while (true) {
      const page = await base44.asServiceRole.entities.Task.filter(
        { is_recurring: true }, '-created_date', 100, taskSkip
      );
      if (!Array.isArray(page) || page.length === 0) break;
      page.forEach(t => {
        if (t.template_id && t.customer_id && t.due_date) {
          existingKeys.add(`${t.template_id}_${t.customer_id}_${t.due_date.substring(0, 7)}`);
        }
      });
      if (page.length < 100) break;
      taskSkip += 100;
      await delay(500);
    }
    console.log(`Loaded ${templates.length} templates, ${customers.length} customers, ${existingKeys.size} existing dedup keys`);

    // Generate tasks — collect all, then bulkCreate in batches to avoid rate limits
    const taskDataList = [];
    let skippedDuplicate = 0;

    for (const tmpl of templates) {
      const matchType = tmpl.match_type || 'service';
      let matchingCustomers;
      if (matchType === 'obligation' && tmpl.obligation_type) {
        matchingCustomers = customers.filter(c => c.obligations?.includes(tmpl.obligation_type));
      } else {
        matchingCustomers = customers.filter(c => c.services?.includes(tmpl.service_type));
      }

      for (const customer of matchingCustomers) {
        const dueDay = Math.min(tmpl.due_date_rule || 15, 28);
        const dueDate = `${currentYear}-${monthStr}-${String(dueDay).padStart(2, '0')}`;
        const dueDateMonth = `${currentYear}-${monthStr}`;
        const dedupKey = `${tmpl.id}_${customer.id}_${dueDateMonth}`;

        if (existingKeys.has(dedupKey)) {
          skippedDuplicate++;
          continue;
        }

        let assignedTo = '';
        let assignedName = '';
        if (tmpl.default_owner_type === 'specific_user' && tmpl.default_owner) {
          assignedTo = tmpl.default_owner;
          assignedName = tmpl.default_owner_name || '';
        } else {
          assignedTo = customer.primary_officer || '';
          assignedName = customer.primary_officer_name || '';
        }

        let startDate;
        if (tmpl.estimated_days) {
          const due = new Date(dueDate);
          due.setDate(due.getDate() - tmpl.estimated_days);
          startDate = due.toISOString().split('T')[0];
        }

        taskDataList.push({
          title: tmpl.name,
          description: tmpl.description || '',
          customer_id: customer.id,
          customer_name: customer.company_name,
          service_type: tmpl.service_type || tmpl.obligation_type || '',
          department: tmpl.department || '',
          assigned_to: assignedTo,
          assigned_name: assignedName,
          priority: tmpl.default_priority || 'medium',
          status: tmpl.default_status || 'pending',
          due_date: dueDate,
          start_date: startDate || undefined,
          is_recurring: true,
          recurring_type: tmpl.recurring_type,
          template_id: tmpl.id,
          checklist: tmpl.default_checklist || [],
        });
        existingKeys.add(dedupKey);
      }
    }

    // Bulk create in batches of 10 with delay to avoid rate limits
    const BATCH_SIZE = 10;
    const BATCH_DELAY_MS = 2000;
    const created = [];
    for (let i = 0; i < taskDataList.length; i += BATCH_SIZE) {
      const batch = taskDataList.slice(i, i + BATCH_SIZE);
      const results = await base44.asServiceRole.entities.Task.bulkCreate(batch);
      created.push(...results);
      if (i + BATCH_SIZE < taskDataList.length) {
        await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
      }
    }
    console.log(`Created ${created.length} tasks in ${Math.ceil(taskDataList.length / BATCH_SIZE)} batches`);

    // Save last_auto_generate
    if (configs.length > 0) {
      await base44.asServiceRole.entities.AppConfig.update(configs[0].id, { value: monthKey });
    } else {
      await base44.asServiceRole.entities.AppConfig.create({
        key: 'last_auto_generate',
        value: monthKey,
        description: 'เดือนล่าสุดที่ auto generate tasks',
      });
    }

    // ── Auto generate Tax Calendar สำหรับปีใหม่ (ทำเฉพาะเดือน ม.ค.) ──
    let taxCalendarGenerated = 0;
    if (currentMonth === 1) {
      try {
        const taxConfigs = await base44.asServiceRole.entities.AppConfig.filter({ key: 'last_auto_tax_calendar' });
        const lastTaxYear = taxConfigs.length > 0 ? taxConfigs[0].value : '';

        if (lastTaxYear !== String(currentYear)) {
          const existingDeadlines = await base44.asServiceRole.entities.TaxDeadline.filter(
            { for_year: currentYear }, 'for_month', 500
          );
          const existingKeys = new Set();
          existingDeadlines.forEach(d => existingKeys.add(`${d.tax_type}_${d.for_month}_${d.for_year}`));

          const TAX_RULES = [
            { type: 'pnd1',  label: 'ภ.ง.ด.1',    category: 'withholding_tax', onlineDay: 15 },
            { type: 'pnd3',  label: 'ภ.ง.ด.3',    category: 'withholding_tax', onlineDay: 15 },
            { type: 'pnd53', label: 'ภ.ง.ด.53',   category: 'withholding_tax', onlineDay: 15 },
            { type: 'pnd54', label: 'ภ.ง.ด.54',   category: 'withholding_tax', onlineDay: 15 },
            { type: 'pp36',  label: 'ภ.พ.36',     category: 'vat',             onlineDay: 15 },
            { type: 'pp30',  label: 'ภ.พ.30',     category: 'vat',             onlineDay: 23 },
            { type: 'sso',   label: 'ประกันสังคม', category: 'sso',             onlineDay: 25 },
          ];

          const taxBatch = [];
          for (let month = 1; month <= 12; month++) {
            for (const rule of TAX_RULES) {
              const key = `${rule.type}_${month}_${currentYear}`;
              if (existingKeys.has(key)) continue;
              taxBatch.push({
                tax_type: rule.type,
                tax_label: rule.label,
                category: rule.category,
                for_month: month,
                for_year: currentYear,
                deadline: `${currentYear}-${String(month).padStart(2, '0')}-${String(rule.onlineDay).padStart(2, '0')}`,
                original_day: rule.onlineDay,
              });
            }
          }
          // Bulk create tax deadlines in batches of 10
          for (let i = 0; i < taxBatch.length; i += 10) {
            const batch = taxBatch.slice(i, i + 10);
            await base44.asServiceRole.entities.TaxDeadline.bulkCreate(batch);
            if (i + 10 < taxBatch.length) await delay(2000);
          }
          taxCalendarGenerated = taxBatch.length;

          if (taxConfigs.length > 0) {
            await base44.asServiceRole.entities.AppConfig.update(taxConfigs[0].id, { value: String(currentYear) });
          } else {
            await base44.asServiceRole.entities.AppConfig.create({
              key: 'last_auto_tax_calendar',
              value: String(currentYear),
              description: 'ปีล่าสุดที่ auto generate tax calendar',
            });
          }
          console.log(`Auto generated ${taxCalendarGenerated} tax deadlines for ${currentYear}`);
        }
      } catch (e) {
        console.warn('Auto tax calendar error:', e.message);
      }
    }

    // Send LINE notification to accounting group
    const monthNames = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    const lineConfigs = await base44.asServiceRole.entities.AppConfig.filter({ key: 'line_group_dept_accounting' });
    const lineGroupId = lineConfigs.length > 0 ? lineConfigs[0].value : '';

    if (lineGroupId && created.length > 0) {
      const lineTokenConfigs = await base44.asServiceRole.entities.AppConfig.filter({ key: 'line_access_token' });
      const accessToken = lineTokenConfigs.length > 0 ? lineTokenConfigs[0].value : '';

      if (accessToken) {
        const message = `📅 สร้างงานอัตโนมัติ\n━━━━━━━━━━━━━━━━\n📆 ${monthNames[currentMonth - 1]} ${currentYear + 543}\n✅ สร้าง ${created.length} งาน\n⏭️ ข้าม ${skippedDuplicate} งาน (สร้างแล้ว)\n📋 จาก ${templates.length} templates${taxCalendarGenerated > 0 ? `\n📆 สร้างปฏิทินภาษี ${taxCalendarGenerated} รายการ` : ''}\n👤 โดย: ${triggeredBy}\n━━━━━━━━━━━━━━━━\nACC Consulting Co., Ltd.`;

        await fetch('https://api.line.me/v2/bot/message/push', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            to: lineGroupId,
            messages: [{ type: 'text', text: message }],
          }),
        }).catch(e => console.warn('LINE notify failed:', e.message));
      }
    }

    return Response.json({
      success: true,
      month: monthKey,
      total_created: created.length,
      skipped_duplicate: skippedDuplicate,
      templates_used: templates.length,
      tax_calendar_generated: taxCalendarGenerated,
      triggered_by: triggeredBy,
    });
  } catch (error) {
    console.error('autoGenerateMonthlyTasks error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});