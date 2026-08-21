import { createClientFromRequest } from '../_shared/base44-compat.ts';

const PRIORITY_EMOJI = { urgent: '🔴', high: '🟠', medium: '🟡', low: '🟢' };
const PRIORITY_LABEL = { urgent: 'เร่งด่วน', high: 'สูง', medium: 'ปานกลาง', low: 'ต่ำ' };
const STATUS_LABEL = { pending: 'รอดำเนินการ', in_progress: 'กำลังทำ', review: 'รอตรวจสอบ' };
const DEPT_LABEL = {
  management: 'Management', accounting: 'บัญชี', consulting: 'ที่ปรึกษา',
  audit: 'Audit', billing: 'Billing', it: 'IT'
};

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

function buildSection(emoji, title, tasks) {
  if (tasks.length === 0) return null;
  const lines = [`${emoji} ${title} (${tasks.length} งาน)`, '─────────────'];
  tasks.forEach((t, i) => {
    const pEmoji = PRIORITY_EMOJI[t.priority] || '📋';
    const pLabel = PRIORITY_LABEL[t.priority] || '-';
    const statusLabel = STATUS_LABEL[t.status] || t.status || '-';
    lines.push(`${i + 1}. ${pEmoji} ${t.title}`);
    if (t.customer_name) lines.push(`   🏢 ${t.customer_name}`);
    lines.push(`   👤 ${t.assigned_name || '-'}`);
    lines.push(`   📅 กำหนด: ${formatDate(t.due_date)}`);
    lines.push(`   📌 ${statusLabel} | ${pLabel}`);
    if (i < tasks.length - 1) lines.push('');
  });
  return lines.join('\n');
}

function buildFullMessage(todayStr, overdueTasks, due3Days, due7Days, deptLabel) {
  const totalAlerts = overdueTasks.length + due3Days.length + due7Days.length;
  if (totalAlerts === 0) return null;

  const sections = [];
  const prefix = deptLabel ? `📢 แจ้งเตือน Due Date — แผนก${deptLabel}` : `📢 แจ้งเตือน Due Date ประจำวัน`;
  sections.push(prefix);
  sections.push(`📆 ${formatDate(todayStr)}`);
  sections.push(`━━━━━━━━━━━━━━━━`);

  const overdueSection = buildSection('🚨 OVERDUE — เกินกำหนดแล้ว!', 'เกินกำหนด', overdueTasks);
  if (overdueSection) sections.push(overdueSection);

  const due3Section = buildSection('⚠️ อีก 3 วันจะครบกำหนด', 'ครบกำหนดภายใน 3 วัน', due3Days);
  if (due3Section) sections.push(due3Section);

  const due7Section = buildSection('📋 อีก 7 วันจะครบกำหนด', 'ครบกำหนดภายใน 7 วัน', due7Days);
  if (due7Section) sections.push(due7Section);

  sections.push(`━━━━━━━━━━━━━━━━`);
  sections.push(`รวม ${totalAlerts} งาน | 🚨 ${overdueTasks.length} เกินกำหนด | ⚠️ ${due3Days.length} ใน 3 วัน | 📋 ${due7Days.length} ใน 7 วัน`);

  return sections.join('\n\n');
}

async function sendMessage(accessToken, target, message) {
  if (message.length <= 5000) {
    await sendToLineGroup(accessToken, target, message);
  } else {
    // Split into sections
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
    const lineGroupId = getVal('line_group_id');
    const lineUserId = getVal('line_user_id');

    // Build department group map
    const deptGroupMap = {};
    const deptKeys = ['management', 'accounting', 'consulting', 'audit', 'billing', 'it'];
    for (const dk of deptKeys) {
      const gid = getVal(`line_group_dept_${dk}`);
      if (gid) deptGroupMap[dk] = gid;
    }

    const companyTarget = lineGroupId || lineUserId;

    if (!accessToken) {
      console.warn('LINE access token not configured');
      return Response.json({ status: 'skipped', reason: 'no access token' });
    }

    if (!companyTarget && Object.keys(deptGroupMap).length === 0) {
      console.warn('No LINE Group IDs configured (company or department)');
      return Response.json({ status: 'skipped', reason: 'no targets' });
    }

    // Get today in Bangkok timezone
    const now = new Date();
    const bangkokOffset = 7 * 60 * 60 * 1000;
    const bangkokNow = new Date(now.getTime() + bangkokOffset);
    const todayStr = bangkokNow.toISOString().split('T')[0];

    // Check if today is a weekend (Saturday=6, Sunday=0)
    const dayOfWeek = bangkokNow.getUTCDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    // Check if today is a holiday from HolidayMaster
    const holidays = await base44.asServiceRole.entities.HolidayMaster.filter({ status: 'active' });
    const isHoliday = holidays.some(h => h.date === todayStr);

    if (isWeekend || isHoliday) {
      const reason = isWeekend ? `weekend (${['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัส','ศุกร์','เสาร์'][dayOfWeek]})` : `holiday (${holidays.find(h => h.date === todayStr)?.name_th || ''})`;
      console.log(`Skipping due date reminder — today is ${reason}`);
      return Response.json({ status: 'skipped', reason });
    }

    // Fetch active tasks (only pending/in_progress/review with due dates)
    const [pendingTasks, inProgressTasks, reviewTasks] = await Promise.all([
      base44.asServiceRole.entities.Task.filter({ status: 'pending' }, '-due_date', 500),
      base44.asServiceRole.entities.Task.filter({ status: 'in_progress' }, '-due_date', 500),
      base44.asServiceRole.entities.Task.filter({ status: 'review' }, '-due_date', 500),
    ]);
    const activeTasks = [...pendingTasks, ...inProgressTasks, ...reviewTasks].filter(t => t.due_date);

    // Categorize
    const overdueTasks = [];
    const due3Days = [];
    const due7Days = [];

    for (const task of activeTasks) {
      // งาน review → ใช้ review_deadline, ถ้าไม่มี → ข้าม (ไม่นับ overdue)
      const effectiveDate = task.status === 'review'
        ? (task.review_deadline || null)
        : task.due_date;
      if (!effectiveDate) continue;

      const diff = getDaysDiff(effectiveDate, todayStr);
      if (diff < 0) overdueTasks.push({ ...task, _daysOver: Math.abs(diff) });
      else if (diff <= 3) due3Days.push({ ...task, _daysLeft: diff });
      else if (diff <= 7) due7Days.push({ ...task, _daysLeft: diff });
    }

    overdueTasks.sort((a, b) => b._daysOver - a._daysOver);
    due3Days.sort((a, b) => a._daysLeft - b._daysLeft);
    due7Days.sort((a, b) => a._daysLeft - b._daysLeft);

    const totalAlerts = overdueTasks.length + due3Days.length + due7Days.length;

    if (totalAlerts === 0) {
      console.log('No due date alerts today');
      return Response.json({ status: 'ok', message: 'No alerts' });
    }

    let sentTargets = [];

    // Send department-specific messages to department groups only
    const sentGroupIds = new Set();

    for (const [dept, groupId] of Object.entries(deptGroupMap)) {
      if (sentGroupIds.has(groupId)) {
        console.log(`Skipping dept:${dept} — same Group ID as already sent target`);
        continue;
      }
      const deptOverdue = overdueTasks.filter(t => t.department === dept);
      const deptDue3 = due3Days.filter(t => t.department === dept);
      const deptDue7 = due7Days.filter(t => t.department === dept);

      const msg = buildFullMessage(todayStr, deptOverdue, deptDue3, deptDue7, DEPT_LABEL[dept] || dept);
      if (msg) {
        await sendMessage(accessToken, groupId, msg);
        sentGroupIds.add(groupId);
        sentTargets.push(`dept:${dept}`);
      }
    }

    // Save notification records — bulkCreate in batches to avoid rate limits
    const notifData = [];
    for (const t of overdueTasks) {
      notifData.push({
        title: `🚨 งานเกินกำหนด: ${t.title}`,
        message: `งาน "${t.title}" เกินกำหนด ${t._daysOver} วัน (กำหนด ${formatDate(t.due_date)})`,
        type: 'overdue',
        target_user: t.assigned_to || '',
        related_entity_type: 'Task',
        related_entity_id: t.id,
        customer_name: t.customer_name || '',
        sent_via_line: true,
      });
    }
    for (const t of due3Days) {
      notifData.push({
        title: `⚠️ งานใกล้ครบกำหนด: ${t.title}`,
        message: `งาน "${t.title}" จะครบกำหนดในอีก ${t._daysLeft} วัน (${formatDate(t.due_date)})`,
        type: 'due_3days',
        target_user: t.assigned_to || '',
        related_entity_type: 'Task',
        related_entity_id: t.id,
        customer_name: t.customer_name || '',
        sent_via_line: true,
      });
    }
    for (const t of due7Days) {
      notifData.push({
        title: `📋 งานใกล้ครบกำหนด: ${t.title}`,
        message: `งาน "${t.title}" จะครบกำหนดในอีก ${t._daysLeft} วัน (${formatDate(t.due_date)})`,
        type: 'due_7days',
        target_user: t.assigned_to || '',
        related_entity_type: 'Task',
        related_entity_id: t.id,
        customer_name: t.customer_name || '',
        sent_via_line: true,
      });
    }
    // Bulk create in batches of 20
    for (let i = 0; i < notifData.length; i += 20) {
      const batch = notifData.slice(i, i + 20);
      await base44.asServiceRole.entities.Notification.bulkCreate(batch);
      if (i + 20 < notifData.length) await new Promise(r => setTimeout(r, 1500));
    }

    console.log(`Due date reminder sent to: ${sentTargets.join(', ')} — total ${totalAlerts} alerts`);
    return Response.json({
      status: 'sent',
      sent_to: sentTargets,
      overdue: overdueTasks.length,
      due_3days: due3Days.length,
      due_7days: due7Days.length,
      total: totalAlerts,
    });

  } catch (error) {
    console.error('Due date reminder error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});