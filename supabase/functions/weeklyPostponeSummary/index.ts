/**
 * ข้อ 5: สรุปรายสัปดาห์ — ส่ง Email/Notification สรุปการเลื่อน due date
 * Scheduled automation: ทุกวันจันทร์ 09:00
 */
import { createClientFromRequest } from '../_shared/base44-compat.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    // Last 7 days
    const now = new Date();
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekAgoStr = weekAgo.toISOString().slice(0, 10);
    const nowStr = now.toISOString().slice(0, 10);

    // Fetch tasks
    const tasks = await base44.asServiceRole.entities.Task.list('-created_date', 5000);

    // Collect postpones from last week
    const weekPostpones = [];
    const staffMap = {};

    tasks.forEach(t => {
      (t.due_date_change_history || []).forEach(h => {
        const date = h.changed_at?.slice(0, 10);
        if (date && date >= weekAgoStr && date <= nowStr) {
          weekPostpones.push({ ...h, task_title: t.title, customer_name: t.customer_name, assigned_name: t.assigned_name });
          const name = h.changed_by_name || h.changed_by || 'ไม่ทราบ';
          staffMap[name] = (staffMap[name] || 0) + 1;
        }
      });
    });

    // Pending requests
    const pendingCount = tasks.filter(t => t.pending_due_change).length;

    // Red flag tasks (≥3 postpones)
    const redFlagCount = tasks.filter(t => (t.due_date_change_count || 0) >= 3 && t.status !== 'completed' && t.status !== 'cancelled').length;

    if (weekPostpones.length === 0 && pendingCount === 0) {
      return Response.json({ message: 'No postpones this week', sent: false });
    }

    // Top postponer
    const topPostponer = Object.entries(staffMap).sort((a, b) => b[1] - a[1])[0];

    // Reason summary
    const reasonMap = {};
    weekPostpones.forEach(p => {
      const reason = p.reason || 'ไม่ระบุ';
      reasonMap[reason] = (reasonMap[reason] || 0) + 1;
    });
    const topReasons = Object.entries(reasonMap).sort((a, b) => b[1] - a[1]).slice(0, 3);

    // Build notification message
    const msg = [
      `📊 สรุปการเลื่อน Due Date สัปดาห์นี้`,
      `━━━━━━━━━━━━━━━━`,
      `📅 ${weekAgoStr} — ${nowStr}`,
      `📈 จำนวนครั้งที่เลื่อน: ${weekPostpones.length} ครั้ง`,
      `⏳ รออนุมัติ: ${pendingCount} รายการ`,
      `🚩 Red Flag (≥3 ครั้ง): ${redFlagCount} งาน`,
      topPostponer ? `👤 เลื่อนมากสุด: ${topPostponer[0]} (${topPostponer[1]} ครั้ง)` : '',
      topReasons.length > 0 ? `\n💬 เหตุผลที่พบบ่อย:` : '',
      ...topReasons.map((r, i) => `  ${i + 1}. ${r[0]} (${r[1]}x)`),
      `━━━━━━━━━━━━━━━━`,
      `ดูรายละเอียดที่ Postpone Analytics`,
    ].filter(Boolean).join('\n');

    // Send notification to all admins & managers
    const users = await base44.asServiceRole.entities.User.list('-created_date', 200);
    const targets = users.filter(u => ['admin', 'management', 'manager'].includes(u.role));

    for (const target of targets) {
      await base44.asServiceRole.entities.Notification.create({
        title: `📊 สรุปเลื่อน Due สัปดาห์นี้ — ${weekPostpones.length} ครั้ง`,
        message: msg,
        type: 'system',
        target_user: target.email,
      });
    }

    // Also send email to first admin
    const adminUser = targets.find(u => u.role === 'admin');
    if (adminUser) {
      const emailBody = `
        <div style="font-family:'Segoe UI',sans-serif;max-width:600px;margin:0 auto;">
          <div style="background:linear-gradient(135deg,#f59e0b,#d97706);color:white;padding:16px 20px;border-radius:10px 10px 0 0;">
            <h2 style="margin:0;font-size:16px;">📊 สรุปการเลื่อน Due Date ประจำสัปดาห์</h2>
            <p style="margin:4px 0 0;font-size:12px;opacity:0.9;">${weekAgoStr} — ${nowStr}</p>
          </div>
          <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 10px 10px;padding:16px 20px;font-size:13px;">
            <table style="width:100%;border-collapse:collapse;">
              <tr><td style="padding:6px 0;color:#6b7280;">จำนวนครั้งที่เลื่อน:</td><td style="font-weight:bold;">${weekPostpones.length} ครั้ง</td></tr>
              <tr><td style="padding:6px 0;color:#6b7280;">รออนุมัติ:</td><td style="font-weight:bold;">${pendingCount} รายการ</td></tr>
              <tr><td style="padding:6px 0;color:#6b7280;">Red Flag (≥3 ครั้ง):</td><td style="font-weight:bold;color:#dc2626;">${redFlagCount} งาน</td></tr>
              ${topPostponer ? `<tr><td style="padding:6px 0;color:#6b7280;">เลื่อนมากสุด:</td><td style="font-weight:bold;">${topPostponer[0]} (${topPostponer[1]} ครั้ง)</td></tr>` : ''}
            </table>
            ${topReasons.length > 0 ? `
              <h3 style="margin:16px 0 8px;font-size:13px;">💬 เหตุผลที่พบบ่อย:</h3>
              <ol style="margin:0;padding-left:20px;font-size:12px;">
                ${topReasons.map(r => `<li>${r[0]} (${r[1]} ครั้ง)</li>`).join('')}
              </ol>
            ` : ''}
            <p style="margin-top:16px;font-size:11px;color:#9ca3af;">ส่งจากระบบ ACC Precision Hub</p>
          </div>
        </div>`;

      await base44.asServiceRole.integrations.Core.SendEmail({
        from_name: 'ACC Precision Hub',
        to: adminUser.email,
        subject: `📊 สรุปเลื่อน Due สัปดาห์ ${weekAgoStr} — ${weekPostpones.length} ครั้ง | ${redFlagCount} Red Flag`,
        body: emailBody,
      });
    }

    return Response.json({
      message: 'Weekly postpone summary sent',
      sent: true,
      postpone_count: weekPostpones.length,
      targets: targets.length,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});