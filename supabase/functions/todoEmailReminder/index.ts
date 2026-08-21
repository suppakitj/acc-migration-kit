import { createClientFromRequest } from '../_shared/base44-compat.ts';

function formatThaiDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDate();
  const months = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  return `${day} ${months[d.getMonth()]} ${d.getFullYear() + 543}`;
}

function buildEmailHTML(userName, todos) {
  const rows = todos.map((t, i) => `
    <tr style="border-bottom:1px solid #eee;">
      <td style="padding:8px 12px;font-size:14px;color:#333;">${i + 1}</td>
      <td style="padding:8px 12px;font-size:14px;color:#333;">${t.title}</td>
      <td style="padding:8px 12px;font-size:14px;color:#e65100;font-weight:600;">วันนี้</td>
    </tr>
  `).join('');

  return `
    <div style="font-family:'Segoe UI',Tahoma,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
      <div style="background:linear-gradient(135deg,#1e40af,#3b82f6);color:white;padding:20px 24px;border-radius:12px 12px 0 0;">
        <h2 style="margin:0;font-size:18px;">📝 To-Do เตือนประจำวัน</h2>
        <p style="margin:8px 0 0;font-size:13px;opacity:0.9;">สวัสดีค่ะ คุณ${userName}</p>
      </div>
      <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:20px 24px;">
        <p style="font-size:14px;color:#555;margin:0 0 16px;">คุณมี <b>${todos.length} รายการ</b> ที่กำหนดวันนี้:</p>
        <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
          <thead>
            <tr style="background:#f9fafb;">
              <th style="padding:8px 12px;text-align:left;font-size:12px;color:#6b7280;width:40px;">#</th>
              <th style="padding:8px 12px;text-align:left;font-size:12px;color:#6b7280;">รายการ</th>
              <th style="padding:8px 12px;text-align:left;font-size:12px;color:#6b7280;width:80px;">กำหนด</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <p style="font-size:13px;color:#6b7280;margin:16px 0 0;">
          💡 เปิด ACC Precision Hub → My Day เพื่อจัดการ To-Do ของคุณ
        </p>
      </div>
      <p style="text-align:center;font-size:11px;color:#9ca3af;margin-top:16px;">
        ส่งอัตโนมัติจากระบบ ACC Precision Hub — ข้อความนี้ส่งเฉพาะเมื่อคุณมี To-Do ที่กำหนดวันนี้
      </p>
    </div>
  `;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Get today in Bangkok timezone
    const now = new Date();
    const bangkokOffset = 7 * 60 * 60 * 1000;
    const bangkokNow = new Date(now.getTime() + bangkokOffset);
    const todayStr = bangkokNow.toISOString().split('T')[0];

    // Skip weekends
    const dayOfWeek = bangkokNow.getUTCDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return Response.json({ status: 'skipped', reason: 'weekend' });
    }

    // Fetch all to-do items that are not done
    const allTodos = await base44.asServiceRole.entities.TodoItem.filter(
      { is_done: false }, '-created_date', 1000
    );

    // Filter: due_date = today
    const dueTodayTodos = allTodos.filter(t => t.due_date === todayStr);

    if (dueTodayTodos.length === 0) {
      return Response.json({ status: 'no_todos_due', today: todayStr });
    }

    // Group by owner_email
    const byOwner = {};
    dueTodayTodos.forEach(t => {
      const email = t.owner_email;
      if (!byOwner[email]) byOwner[email] = { name: t.owner_name || email, todos: [] };
      byOwner[email].todos.push(t);
    });

    // Get email config
    const configs = await base44.asServiceRole.entities.AppConfig.filter({});
    const getVal = (key) => configs.find(c => c.key === key)?.value || '';
    const senderName = getVal('smtp_sender_name') || getVal('o365_sender_name') || 'ACC Precision Hub';

    let sentCount = 0;
    const errors = [];

    for (const [email, data] of Object.entries(byOwner)) {
      try {
        await base44.asServiceRole.integrations.Core.SendEmail({
          from_name: senderName,
          to: email,
          subject: `📝 To-Do วันนี้ (${data.todos.length} รายการ) — ${formatThaiDate(todayStr)}`,
          body: buildEmailHTML(data.name, data.todos),
        });
        sentCount++;
        console.log(`Sent to-do reminder to ${email}: ${data.todos.length} items`);
      } catch (e) {
        errors.push(`${email}: ${e.message}`);
        console.error(`Failed to send to ${email}:`, e.message);
      }
    }

    // Cleanup: auto-delete done to-dos older than 7 days
    const cleanupCutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const doneTodos = await base44.asServiceRole.entities.TodoItem.filter(
      { is_done: true }, 'created_date', 500
    );
    let cleaned = 0;
    for (const t of doneTodos) {
      if (t.updated_date && t.updated_date < cleanupCutoff) {
        try {
          await base44.asServiceRole.entities.TodoItem.delete(t.id);
          cleaned++;
        } catch (_e) { /* ignore */ }
      }
    }

    console.log(`Todo reminder: sent ${sentCount} emails, ${dueTodayTodos.length} todos due today, cleaned ${cleaned} old done items`);

    return Response.json({
      status: 'sent',
      today: todayStr,
      total_due_today: dueTodayTodos.length,
      emails_sent: sentCount,
      owners: Object.keys(byOwner).length,
      cleaned_done_items: cleaned,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error('todoEmailReminder error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});