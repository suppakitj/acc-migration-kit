import { createClientFromRequest } from '../_shared/base44-compat.ts';

/**
 * Generate tasks from active TaskTemplates for a given month/year.
 * 
 * Params:
 *  - target_month (1-12)
 *  - target_year (e.g. 2026)
 *  - dry_run (boolean) — if true, returns preview without creating tasks
 *  - template_ids (optional array) — only generate for specific templates
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!['admin', 'management', 'manager', 'super_supervisor'].includes(user.role)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { target_month, target_year, dry_run = false, template_ids, selected_tasks } = await req.json();

    if (!target_month || !target_year) {
      return Response.json({ error: 'target_month and target_year are required' }, { status: 400 });
    }

    const month = parseInt(target_month);
    const year = parseInt(target_year);

    if (month < 1 || month > 12) {
      return Response.json({ error: 'target_month must be 1-12' }, { status: 400 });
    }

    // Fetch all active templates
    const allTemplates = await base44.asServiceRole.entities.TaskTemplate.filter(
      { status: 'active' }, '-created_date', 500
    );

    // Filter templates applicable for this month
    let templates = allTemplates.filter(tmpl => {
      // If template_ids specified, only include those
      if (template_ids && template_ids.length > 0 && !template_ids.includes(tmpl.id)) {
        return false;
      }

      // Check recurring type vs month
      if (tmpl.recurring_type === 'quarterly') {
        // Quarterly = months 1,4,7,10 (or based on applicable_months)
        if (tmpl.applicable_months && tmpl.applicable_months.length > 0) {
          return tmpl.applicable_months.includes(month);
        }
        return [1, 4, 7, 10].includes(month);
      }

      if (tmpl.recurring_type === 'yearly') {
        if (tmpl.applicable_months && tmpl.applicable_months.length > 0) {
          return tmpl.applicable_months.includes(month);
        }
        return month === 1; // Default yearly = January
      }

      // Monthly
      if (tmpl.applicable_months && tmpl.applicable_months.length > 0) {
        return tmpl.applicable_months.includes(month);
      }
      return true; // Monthly with no restriction = every month
    });

    console.log(`Found ${templates.length} applicable templates for ${month}/${year}`);

    // Fetch all active customers
    const customers = await base44.asServiceRole.entities.Customer.filter(
      { status: 'active' }, '-created_date', 1000
    );

    // Fetch existing tasks to avoid duplicates
    // Check by template_id + customer_id + due_date month/year
    const monthStr = String(month).padStart(2, '0');
    const existingTasks = await base44.asServiceRole.entities.Task.filter(
      { is_recurring: true }, '-created_date', 5000
    );

    // Build a set of existing task keys for dedup
    const existingKeys = new Set();
    existingTasks.forEach(t => {
      if (t.template_id && t.customer_id && t.due_date) {
        const dueMonth = t.due_date.substring(0, 7); // "YYYY-MM"
        existingKeys.add(`${t.template_id}_${t.customer_id}_${dueMonth}`);
      }
    });

    // ── Mode: create from selected_tasks (user picked specific tasks from preview) ──
    if (!dry_run && selected_tasks && selected_tasks.length > 0) {
      const created = [];
      for (const taskData of selected_tasks) {
        // Build clean task data (strip preview-only fields)
        const { template_code, template_name, ...cleanData } = taskData;
        const newTask = await base44.asServiceRole.entities.Task.create(cleanData);
        created.push(newTask);
      }

      console.log(`Created ${created.length} selected tasks for ${month}/${year}`);

      return Response.json({
        target_month: month,
        target_year: year,
        dry_run: false,
        total_templates: templates.length,
        total_tasks: created.length,
        skipped_duplicate: 0,
        skipped_no_match: 0,
        tasks: created,
        generated_by: user.full_name || user.email,
      });
    }

    // ── Mode: preview (dry_run) or legacy full generation ──
    const preview = [];
    const created = [];
    let skippedDuplicate = 0;
    let skippedNoMatch = 0;

    for (const tmpl of templates) {
      // Determine match type: obligation-based or service-based
      const matchType = tmpl.match_type || 'service';

      let matchingCustomers;
      if (matchType === 'obligation' && tmpl.obligation_type) {
        matchingCustomers = customers.filter(c =>
          c.obligations && c.obligations.includes(tmpl.obligation_type)
        );
      } else {
        matchingCustomers = customers.filter(c =>
          c.services && c.services.includes(tmpl.service_type)
        );
      }

      if (matchingCustomers.length === 0) {
        skippedNoMatch++;
        continue;
      }

      for (const customer of matchingCustomers) {
        const dueDay = Math.min(tmpl.due_date_rule || 15, 28);
        const dueDate = `${year}-${monthStr}-${String(dueDay).padStart(2, '0')}`;
        const dueDateMonth = `${year}-${monthStr}`;
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

        let startDate = '';
        if (tmpl.estimated_days) {
          const due = new Date(dueDate);
          due.setDate(due.getDate() - tmpl.estimated_days);
          startDate = due.toISOString().split('T')[0];
        }

        const taskData = {
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
        };

        preview.push({
          ...taskData,
          template_code: tmpl.template_code,
          template_name: tmpl.name,
        });

        if (!dry_run) {
          const newTask = await base44.asServiceRole.entities.Task.create(taskData);
          created.push(newTask);
          existingKeys.add(dedupKey);
        }
      }
    }

    console.log(`Generate tasks for ${month}/${year}: ${preview.length} tasks, ${skippedDuplicate} duplicates skipped, ${skippedNoMatch} templates with no matching customers`);

    return Response.json({
      target_month: month,
      target_year: year,
      dry_run,
      total_templates: templates.length,
      total_tasks: preview.length,
      skipped_duplicate: skippedDuplicate,
      skipped_no_match: skippedNoMatch,
      tasks: dry_run ? preview : created,
      generated_by: user.full_name || user.email,
    });
  } catch (error) {
    console.error('Generate tasks error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});