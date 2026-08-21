import { createClientFromRequest } from '../_shared/base44-compat.ts';

function formatDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

function getDaysDiff(dueDateStr, todayStr) {
  const due = new Date(dueDateStr + 'T00:00:00');
  const today = new Date(todayStr + 'T00:00:00');
  return Math.floor((due - today) / (1000 * 60 * 60 * 24));
}

async function sendToLineGroup(accessToken, groupId, message) {
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      to: groupId,
      messages: [{ type: 'text', text: message }],
    }),
  });
  if (!res.ok) {
    const errBody = await res.text();
    console.error(`LINE push failed for ${groupId}: ${res.status} ${errBody}`);
  }
  return res.ok;
}

function buildBillingSection(emoji, title, bills) {
  if (bills.length === 0) return null;
  const lines = [`${emoji} ${title} (${bills.length} รายการ)`, '─────────────'];
  bills.forEach((b, i) => {
    lines.push(`${i + 1}. 🏢 ${b.customer_name || '-'}`);
    if (b.invoice_number) lines.push(`   📄 เลขที่: ${b.invoice_number}`);
    lines.push(`   💰 ฿${(b.amount || 0).toLocaleString()}`);
    lines.push(`   📅 กำหนดชำระ: ${formatDate(b.due_date)}`);
    if (b._daysOver) lines.push(`   ⏰ เกินกำหนด ${b._daysOver} วัน`);
    if (b._daysLeft !== undefined) lines.push(`   ⏰ อีก ${b._daysLeft} วัน`);
    if (b.owner) lines.push(`   👤 ${b.owner}`);
    if (i < bills.length - 1) lines.push('');
  });
  return lines.join('\n');
}

async function sendLongMessage(accessToken, target, message) {
  if (message.length <= 5000) {
    await sendToLineGroup(accessToken, target, message);
  } else {
    const parts = message.split('\n\n');
    let chunk = '';
    for (const part of parts) {
      if ((chunk + '\n\n' + part).length > 4800 && chunk) {
        await sendToLineGroup(accessToken, target, chunk);
        chunk = part;
      } else {
        chunk = chunk ? chunk + '\n\n' + part : part;
      }
    }
    if (chunk) await sendToLineGroup(accessToken, target, chunk);
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Get LINE config
    const configs = await base44.asServiceRole.entities.AppConfig.filter({});
    const getVal = (key) => configs.find(c => c.key === key)?.value || '';
    const accessToken = getVal('line_access_token');
    const accountingGroupId = getVal('line_group_dept_accounting');

    if (!accessToken) {
      console.warn('LINE access token not configured');
      return Response.json({ status: 'skipped', reason: 'no access token' });
    }

    if (!accountingGroupId) {
      console.warn('Accounting LINE Group ID not configured (line_group_dept_accounting)');
      return Response.json({ status: 'skipped', reason: 'no accounting group id' });
    }

    // Get today in Bangkok timezone
    const now = new Date();
    const bangkokOffset = 7 * 60 * 60 * 1000;
    const bangkokNow = new Date(now.getTime() + bangkokOffset);
    const todayStr = bangkokNow.toISOString().split('T')[0];

    // Check weekend
    const dayOfWeek = bangkokNow.getUTCDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    // Check holiday
    const holidays = await base44.asServiceRole.entities.HolidayMaster.filter({ status: 'active' });
    const isHoliday = holidays.some(h => h.date === todayStr);

    if (isWeekend || isHoliday) {
      const reason = isWeekend
        ? `weekend (${['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัส','ศุกร์','เสาร์'][dayOfWeek]})`
        : `holiday (${holidays.find(h => h.date === todayStr)?.name_th || ''})`;
      console.log(`Skipping billing reminder — today is ${reason}`);
      return Response.json({ status: 'skipped', reason });
    }

    // Fetch all billings (exclude paid & cancelled)
    const allBillings = await base44.asServiceRole.entities.Billing.filter({});
    const activeBillings = allBillings.filter(b =>
      b.due_date && b.status !== 'paid' && b.status !== 'cancelled'
    );

    // Categorize
    const overdueBills = [];
    const due3Days = [];
    const due7Days = [];

    for (const bill of activeBillings) {
      const diff = getDaysDiff(bill.due_date, todayStr);
      if (diff < 0) overdueBills.push({ ...bill, _daysOver: Math.abs(diff) });
      else if (diff <= 3) due3Days.push({ ...bill, _daysLeft: diff });
      else if (diff <= 7) due7Days.push({ ...bill, _daysLeft: diff });
    }

    overdueBills.sort((a, b) => b._daysOver - a._daysOver);
    due3Days.sort((a, b) => a._daysLeft - b._daysLeft);
    due7Days.sort((a, b) => a._daysLeft - b._daysLeft);

    const totalAlerts = overdueBills.length + due3Days.length + due7Days.length;

    if (totalAlerts === 0) {
      console.log('No billing alerts today');
      return Response.json({ status: 'ok', message: 'No billing alerts' });
    }

    // Build message
    const sections = [];
    sections.push(`💳 แจ้งเตือน Billing — แผนกบัญชี`);
    sections.push(`📆 ${formatDate(todayStr)}`);
    sections.push(`━━━━━━━━━━━━━━━━`);

    const overdueSection = buildBillingSection('🚨 OVERDUE — เกินกำหนดชำระ!', 'เกินกำหนด', overdueBills);
    if (overdueSection) sections.push(overdueSection);

    const due3Section = buildBillingSection('⚠️ อีก 3 วันจะครบกำหนดชำระ', 'ครบกำหนดภายใน 3 วัน', due3Days);
    if (due3Section) sections.push(due3Section);

    const due7Section = buildBillingSection('📋 อีก 7 วันจะครบกำหนดชำระ', 'ครบกำหนดภายใน 7 วัน', due7Days);
    if (due7Section) sections.push(due7Section);

    sections.push(`━━━━━━━━━━━━━━━━`);
    sections.push(`รวม ${totalAlerts} รายการ | 🚨 ${overdueBills.length} เกินกำหนด | ⚠️ ${due3Days.length} ใน 3 วัน | 📋 ${due7Days.length} ใน 7 วัน`);

    const fullMessage = sections.join('\n\n');

    // Send to accounting group
    await sendLongMessage(accessToken, accountingGroupId, fullMessage);

    console.log(`Billing reminder sent to accounting group — total ${totalAlerts} alerts`);
    return Response.json({
      status: 'sent',
      sent_to: 'dept:accounting',
      overdue: overdueBills.length,
      due_3days: due3Days.length,
      due_7days: due7Days.length,
      total: totalAlerts,
    });

  } catch (error) {
    console.error('Billing reminder error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});