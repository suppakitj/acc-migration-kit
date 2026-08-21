import { createClientFromRequest } from '../_shared/base44-compat.ts';

const PRIORITY_EMOJI = { urgent: '🔴', high: '🟠', medium: '🟡', low: '🟢' };
const PRIORITY_LABEL = { urgent: 'เร่งด่วน', high: 'สูง', medium: 'ปานกลาง', low: 'ต่ำ' };
const STATUS_LABEL = {
  pending: 'รอดำเนินการ', in_progress: 'กำลังทำ', review: 'รอตรวจสอบ',
  completed: 'เสร็จแล้ว', cancelled: 'ยกเลิก',
};
const SCHEDULE_TYPE_LABEL = {
  client_visit: 'เยี่ยมลูกค้า', office: 'ทำงานที่ออฟฟิศ', leave: 'ลา',
  meeting: 'ประชุม', fieldwork: 'งานภาคสนาม', wfh: 'Work from Home', other: 'อื่นๆ',
};
const SCHEDULE_STATUS_LABEL = { scheduled: 'กำหนดแล้ว', completed: 'เสร็จสิ้น', cancelled: 'ยกเลิก' };

async function sendLineMessage(accessToken, target, message) {
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      to: target,
      messages: [{ type: 'text', text: message }],
    }),
  });
  if (!res.ok) {
    const errBody = await res.text();
    console.error(`LINE push failed for ${target}: ${res.status} ${errBody}`);
  }
  return res.ok;
}

function buildTaskMessage(eventType, data, oldData) {
  const emoji = PRIORITY_EMOJI[data.priority] || '📋';
  const priorityText = PRIORITY_LABEL[data.priority] || data.priority || '-';
  const statusText = STATUS_LABEL[data.status] || data.status || '-';

  if (eventType === 'create') {
    return [
      `${emoji} งานใหม่!`,
      `━━━━━━━━━━━━━━`,
      `📋 ${data.title}`,
      data.customer_name ? `🏢 ลูกค้า: ${data.customer_name}` : null,
      `⚡ ความสำคัญ: ${priorityText}`,
      `📌 สถานะ: ${statusText}`,
      data.assigned_name ? `👤 ผู้รับผิดชอบ: ${data.assigned_name}` : null,
      data.due_date ? `📅 กำหนดส่ง: ${data.due_date}` : null,
      data.description ? `\n💬 ${data.description}` : null,
    ].filter(Boolean).join('\n');
  }

  const changes = [];
  if (oldData?.status !== data.status) {
    changes.push(`📌 สถานะ: ${STATUS_LABEL[oldData?.status] || '-'} → ${statusText}`);
  }
  if (oldData?.priority !== data.priority) {
    changes.push(`⚡ ความสำคัญ: ${PRIORITY_LABEL[oldData?.priority] || '-'} → ${priorityText}`);
  }
  if (oldData?.assigned_to !== data.assigned_to && data.assigned_name) {
    changes.push(`👤 มอบหมายให้: ${data.assigned_name}`);
  }
  if (oldData?.due_date !== data.due_date && data.due_date) {
    changes.push(`📅 กำหนดส่งใหม่: ${data.due_date}`);
  }
  if (changes.length === 0) return null;

  return [
    `${emoji} อัปเดตงาน`,
    `━━━━━━━━━━━━━━`,
    `📋 ${data.title}`,
    data.customer_name ? `🏢 ${data.customer_name}` : null,
    ``,
    ...changes,
  ].filter(Boolean).join('\n');
}

function buildScheduleMessage(eventType, data) {
  const typeText = SCHEDULE_TYPE_LABEL[data.type] || data.type || '-';
  const statusText = SCHEDULE_STATUS_LABEL[data.status] || data.status || '-';
  const timeText = data.start_time ? `${data.start_time}${data.end_time ? ' - ' + data.end_time : ''}` : '';

  if (eventType === 'create') {
    return [
      `📅 ตารางงานใหม่!`,
      `━━━━━━━━━━━━━━`,
      `📌 ${data.title}`,
      `🗂 ประเภท: ${typeText}`,
      data.date ? `📆 วันที่: ${data.date}` : null,
      timeText ? `🕐 เวลา: ${timeText}` : null,
      data.assigned_name ? `👤 ผู้รับผิดชอบ: ${data.assigned_name}` : null,
      data.customer_name ? `🏢 ลูกค้า: ${data.customer_name}` : null,
      data.location ? `📍 สถานที่: ${data.location}` : null,
      data.description ? `\n💬 ${data.description}` : null,
    ].filter(Boolean).join('\n');
  }

  return [
    `📅 อัปเดตตารางงาน`,
    `━━━━━━━━━━━━━━`,
    `📌 ${data.title}`,
    `📌 สถานะ: ${statusText}`,
    data.date ? `📆 วันที่: ${data.date}` : null,
    timeText ? `🕐 เวลา: ${timeText}` : null,
    data.assigned_name ? `👤 ${data.assigned_name}` : null,
  ].filter(Boolean).join('\n');
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const payload = await req.json();
    const { event, data, old_data } = payload;

    if (!event || !data) {
      return Response.json({ status: 'skipped', reason: 'no event data' });
    }

    const entityName = event.entity_name;
    const eventType = event.type;

    // Get LINE config
    const configs = await base44.asServiceRole.entities.AppConfig.filter({});
    const getVal = (key) => configs.find(c => c.key === key)?.value || '';
    const accessToken = getVal('line_access_token');
    const adminLineUserId = getVal('line_user_id');
    const companyGroupId = getVal('line_group_id');

    // Build department group map
    const deptGroupMap = {};
    const deptKeys = ['management', 'accounting', 'consulting', 'audit', 'billing', 'it'];
    for (const dk of deptKeys) {
      const gid = getVal(`line_group_dept_${dk}`);
      if (gid) deptGroupMap[dk] = gid;
    }

    if (!accessToken) {
      console.warn('LINE access token not configured, skipping notification');
      return Response.json({ status: 'skipped', reason: 'no LINE config' });
    }

    // Build message based on entity type
    let message = null;

    if (entityName === 'Task') {
      if (eventType === 'create') {
        if (data.priority === 'urgent' || data.priority === 'high') {
          message = buildTaskMessage('create', data);
        }
      } else if (eventType === 'update') {
        message = buildTaskMessage('update', data, old_data);
      }
    } else if (entityName === 'Schedule') {
      message = buildScheduleMessage(eventType, data);
    }

    if (!message) {
      return Response.json({ status: 'skipped', reason: 'no notification needed' });
    }

    // Determine recipients
    const recipients = new Set();

    // Always notify admin user
    if (adminLineUserId) {
      recipients.add(adminLineUserId);
    }

    // Send to company group
    if (companyGroupId) {
      recipients.add(companyGroupId);
    }

    // Send to department group if task/schedule has a department
    const dept = data.department;
    if (dept && deptGroupMap[dept]) {
      recipients.add(deptGroupMap[dept]);
    }

    // Also try to reach assigned user's LINE ID
    if (data.assigned_to) {
      const users = await base44.asServiceRole.entities.User.filter({ email: data.assigned_to });
      const assignedUser = users[0];
      if (assignedUser?.line_user_id) {
        recipients.add(assignedUser.line_user_id);
      }
    }

    // Send to all recipients
    let sentCount = 0;
    for (const target of recipients) {
      const ok = await sendLineMessage(accessToken, target, message);
      if (ok) sentCount++;
    }

    console.log(`LINE notification sent to ${sentCount}/${recipients.size} recipients for ${entityName} ${eventType} (dept: ${dept || 'none'})`);
    return Response.json({ status: 'sent', recipients: sentCount, department: dept || null });

  } catch (error) {
    console.error('LINE notify error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});