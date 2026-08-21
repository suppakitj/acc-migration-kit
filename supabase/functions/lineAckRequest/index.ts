import { createClientFromRequest } from '../_shared/base44-compat.ts';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { task, event_type } = await req.json();

    if (!task || !event_type) {
      return Response.json({ error: 'task and event_type are required' }, { status: 400 });
    }

    if (!['created', 'completed'].includes(event_type)) {
      return Response.json({ error: 'event_type must be created or completed' }, { status: 400 });
    }

    // Only process tasks from LINE
    if (task.source_channel !== 'line') {
      return Response.json({ skipped: true, reason: 'not_from_line' });
    }

    // 1. Find target group
    let targetGroupId = task.source_line_user_id || '';
    let lineGroup = null;

    if (targetGroupId) {
      // Check if this is a group chat (starts with C)
      const groups = await base44.asServiceRole.entities.LineGroup.filter({ group_id: targetGroupId }, '-created_date', 1);
      lineGroup = groups[0] || null;
    }

    // Fallback: find active LineGroup by customer_id
    if (!lineGroup && task.customer_id) {
      const groups = await base44.asServiceRole.entities.LineGroup.filter(
        { customer_id: task.customer_id, status: 'active' }, '-created_date', 5
      );
      lineGroup = groups.find(g => g.auto_acknowledge) || null;
      if (lineGroup) {
        targetGroupId = lineGroup.group_id;
      }
    }

    if (!lineGroup) {
      return Response.json({ skipped: true, reason: 'no_group_found' });
    }

    // 2. Check auto_acknowledge flag
    if (!lineGroup.auto_acknowledge) {
      return Response.json({ skipped: true, reason: 'auto_acknowledge_disabled' });
    }

    // 3. Build message
    const taskRef = '#' + String(task.id || '').slice(-6).toUpperCase();
    let message = '';

    if (event_type === 'created') {
      const assignee = task.assigned_name || 'กำลังจัดสรร';
      const dueDate = task.due_date || 'จะแจ้งอีกครั้ง';
      message = [
        '🟢 รับเรื่องแล้วครับ/ค่ะ',
        '━━━━━━━━━━━━━━',
        `📋 ${task.title}`,
        `🔖 อ้างอิง: ${taskRef}`,
        `👤 ผู้ดูแล: ${assignee}`,
        `📅 กำหนด: ${dueDate}`,
      ].join('\n');
    } else {
      message = [
        '✅ ดำเนินการเรียบร้อยแล้วครับ/ค่ะ',
        '━━━━━━━━━━━━━━',
        `📋 ${task.title}`,
        `🔖 อ้างอิง: ${taskRef}`,
      ].join('\n');
    }

    // 4. Get LINE access token
    const configs = await base44.asServiceRole.entities.AppConfig.filter({ key: 'line_access_token' }, '-created_date', 1);
    const accessToken = configs[0]?.value || '';

    if (!accessToken) {
      return Response.json({ error: 'LINE access token not configured' }, { status: 400 });
    }

    // 5. Send via LINE Push API
    const lineRes = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        to: targetGroupId,
        messages: [{ type: 'text', text: message }],
      }),
    });

    if (!lineRes.ok) {
      const errBody = await lineRes.text();
      console.error('LINE API error:', lineRes.status, errBody);
      return Response.json({ error: `LINE API error: ${lineRes.status}` }, { status: 502 });
    }

    // 6. Save outgoing message record
    await base44.asServiceRole.entities.LineMessage.create({
      line_user_id: targetGroupId,
      display_name: lineGroup.group_name || targetGroupId,
      content: message,
      direction: 'outgoing',
      message_type: 'text',
      is_read: true,
      replied_by: 'ระบบอัตโนมัติ',
      chat_type: 'group',
    });

    console.log(`lineAckRequest: sent ${event_type} ack to group ${targetGroupId} for task ${task.id}`);
    return Response.json({ sent: true, event_type, target: targetGroupId });
  } catch (error) {
    console.error('lineAckRequest error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
}