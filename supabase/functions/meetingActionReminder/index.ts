import { createClientFromRequest } from '../_shared/base44-compat.ts';

async function sendToLineGroup(accessToken, groupId, message) {
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify({ to: groupId, messages: [{ type: 'text', text: message }] }),
  });
  if (!res.ok) console.error(`LINE push failed: ${res.status} ${await res.text()}`);
  return res.ok;
}

function formatThaiDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const months = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear() + 543}`;
}

function daysBetween(dateA, dateB) {
  return Math.floor((new Date(dateA) - new Date(dateB)) / (1000 * 60 * 60 * 24));
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Bangkok timezone
    const now = new Date();
    const bangkokOffset = 7 * 60 * 60 * 1000;
    const bangkokNow = new Date(now.getTime() + bangkokOffset);
    const todayStr = bangkokNow.toISOString().split('T')[0];

    // Skip weekends
    const dayOfWeek = bangkokNow.getUTCDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return Response.json({ status: 'skipped', reason: 'weekend' });
    }

    // Fetch open meeting notes
    const openNotes = await base44.asServiceRole.entities.MeetingNote.filter(
      { status: 'open' }, '-meeting_date', 500
    );

    if (openNotes.length === 0) {
      return Response.json({ status: 'no_open_notes' });
    }

    // ═══ 1. Action Item Alerts ═══
    const actionAlerts = []; // { note, item, type: 'today' | 'overdue', daysOverdue }

    for (const note of openNotes) {
      const items = note.action_items || [];
      for (const item of items) {
        if (item.done) continue;
        if (!item.due_date) continue;
        const dueNorm = item.due_date.split('T')[0];

        if (dueNorm === todayStr) {
          actionAlerts.push({ note, item, type: 'today', daysOverdue: 0 });
        } else if (dueNorm < todayStr) {
          const days = daysBetween(todayStr, dueNorm);
          actionAlerts.push({ note, item, type: 'overdue', daysOverdue: days });
        }
      }
    }

    // ═══ 2. Follow-up Date Alerts ═══
    const followUpAlerts = []; // { note, type: 'today' | 'overdue', daysOverdue }

    for (const note of openNotes) {
      if (!note.follow_up_date) continue;
      const fupNorm = note.follow_up_date.split('T')[0];

      if (fupNorm === todayStr) {
        followUpAlerts.push({ note, type: 'today', daysOverdue: 0 });
      } else if (fupNorm < todayStr) {
        const days = daysBetween(todayStr, fupNorm);
        // Only alert follow-ups overdue up to 7 days to avoid spamming old notes
        if (days <= 7) {
          followUpAlerts.push({ note, type: 'overdue', daysOverdue: days });
        }
      }
    }

    const totalAlerts = actionAlerts.length + followUpAlerts.length;
    if (totalAlerts === 0) {
      return Response.json({ status: 'no_alerts', today: todayStr });
    }

    // ═══ Group by staff email ═══
    const byStaff = {}; // email -> { name, actionItems: [], followUps: [] }

    const addStaff = (email, name) => {
      if (!email) return;
      if (!byStaff[email]) byStaff[email] = { name: name || email, actionItems: [], followUps: [] };
    };

    for (const alert of actionAlerts) {
      // Notify all staff on the note
      const emails = alert.note.staff_emails?.length ? alert.note.staff_emails : (alert.note.staff_email ? [alert.note.staff_email] : []);
      const names = alert.note.staff_names?.length ? alert.note.staff_names : (alert.note.staff_name ? [alert.note.staff_name] : []);
      emails.forEach((email, i) => {
        addStaff(email, names[i]);
        byStaff[email].actionItems.push(alert);
      });
      // Also notify manager
      addStaff(alert.note.manager_email, alert.note.manager_name);
      if (alert.note.manager_email) byStaff[alert.note.manager_email].actionItems.push(alert);
    }

    for (const alert of followUpAlerts) {
      const emails = alert.note.staff_emails?.length ? alert.note.staff_emails : (alert.note.staff_email ? [alert.note.staff_email] : []);
      const names = alert.note.staff_names?.length ? alert.note.staff_names : (alert.note.staff_name ? [alert.note.staff_name] : []);
      emails.forEach((email, i) => {
        addStaff(email, names[i]);
        byStaff[email].followUps.push(alert);
      });
      addStaff(alert.note.manager_email, alert.note.manager_name);
      if (alert.note.manager_email) byStaff[alert.note.manager_email].followUps.push(alert);
    }

    // ═══ Send Notifications + Emails ═══
    let emailsSent = 0;

    for (const [email, data] of Object.entries(byStaff)) {
      const { actionItems, followUps } = data;
      if (actionItems.length === 0 && followUps.length === 0) continue;

      // ── Build notification message ──
      let message = '';
      const actionOverdue = actionItems.filter(a => a.type === 'overdue');
      const actionToday = actionItems.filter(a => a.type === 'today');
      const fupOverdue = followUps.filter(a => a.type === 'overdue');
      const fupToday = followUps.filter(a => a.type === 'today');

      if (actionOverdue.length > 0) {
        message += `🔴 Action Item เลยกำหนด ${actionOverdue.length} รายการ:\n`;
        actionOverdue.forEach(a => { message += `- ${a.item.text} (เลย ${a.daysOverdue} วัน) จาก "${a.note.title}"\n`; });
      }
      if (actionToday.length > 0) {
        message += `⚠️ Action Item กำหนดวันนี้ ${actionToday.length} รายการ:\n`;
        actionToday.forEach(a => { message += `- ${a.item.text} จาก "${a.note.title}"\n`; });
      }
      if (fupOverdue.length > 0) {
        message += `🔔 Follow-up เลยกำหนด ${fupOverdue.length} รายการ:\n`;
        fupOverdue.forEach(a => { message += `- "${a.note.title}" (เลย ${a.daysOverdue} วัน)\n`; });
      }
      if (fupToday.length > 0) {
        message += `📅 Follow-up วันนี้ ${fupToday.length} รายการ:\n`;
        fupToday.forEach(a => { message += `- "${a.note.title}"\n`; });
      }

      const notifTitle = `📝 Meeting Notes: ${actionItems.length + followUps.length} รายการต้องดำเนินการ`;

      // Notification ในระบบ
      await base44.asServiceRole.entities.Notification.create({
        title: notifTitle,
        message: message.trim(),
        type: 'due_3days',
        target_user: email,
      }).catch(e => console.warn('Notification failed:', e.message));

      // ── Email ──
      const emailBody = buildEmailHtml(data, todayStr, actionOverdue, actionToday, fupOverdue, fupToday);
      await base44.asServiceRole.integrations.Core.SendEmail({
        from_name: 'ACC Consulting',
        to: email,
        subject: `📝 Meeting Notes — ${actionItems.length + followUps.length} รายการต้องดำเนินการ (${formatThaiDate(todayStr)})`,
        body: emailBody,
      }).catch(e => console.warn('Email failed:', e.message));
      emailsSent++;
    }

    // ═══ LINE กลุ่มบัญชี ═══
    const configs = await base44.asServiceRole.entities.AppConfig.filter({});
    const getVal = (key) => configs.find(c => c.key === key)?.value || '';
    const accessToken = getVal('line_access_token');
    const groupId = getVal('line_group_dept_accounting') || getVal('line_group_id');

    if (accessToken && groupId && totalAlerts > 0) {
      const lines = [];
      lines.push(`📝 แจ้งเตือน Meeting Notes`);
      lines.push(`📆 ${formatThaiDate(todayStr)}`);
      lines.push('━━━━━━━━━━━━━━━━');

      const overdueActions = actionAlerts.filter(a => a.type === 'overdue');
      const todayActions = actionAlerts.filter(a => a.type === 'today');
      const overdueFups = followUpAlerts.filter(a => a.type === 'overdue');
      const todayFups = followUpAlerts.filter(a => a.type === 'today');

      if (overdueActions.length > 0) {
        lines.push('');
        lines.push(`🔴 Action Item เลยกำหนด (${overdueActions.length})`);
        lines.push('─────────────');
        overdueActions.forEach(a => {
          const staffNames = a.note.staff_names?.join(', ') || a.note.staff_name || '';
          lines.push(`• ${a.item.text}`);
          lines.push(`   👤 ${staffNames} — เลย ${a.daysOverdue} วัน`);
          lines.push(`   📄 ${a.note.title}`);
        });
      }

      if (todayActions.length > 0) {
        lines.push('');
        lines.push(`⚠️ Action Item วันนี้ (${todayActions.length})`);
        lines.push('─────────────');
        todayActions.forEach(a => {
          const staffNames = a.note.staff_names?.join(', ') || a.note.staff_name || '';
          lines.push(`• ${a.item.text}`);
          lines.push(`   👤 ${staffNames}`);
          lines.push(`   📄 ${a.note.title}`);
        });
      }

      if (overdueFups.length > 0) {
        lines.push('');
        lines.push(`🔔 Follow-up เลยกำหนด (${overdueFups.length})`);
        lines.push('─────────────');
        overdueFups.forEach(a => {
          const staffNames = a.note.staff_names?.join(', ') || a.note.staff_name || '';
          lines.push(`• "${a.note.title}" — เลย ${a.daysOverdue} วัน`);
          lines.push(`   👤 ${staffNames}`);
        });
      }

      if (todayFups.length > 0) {
        lines.push('');
        lines.push(`📅 Follow-up วันนี้ (${todayFups.length})`);
        lines.push('─────────────');
        todayFups.forEach(a => {
          const staffNames = a.note.staff_names?.join(', ') || a.note.staff_name || '';
          lines.push(`• "${a.note.title}"`);
          lines.push(`   👤 ${staffNames}`);
        });
      }

      lines.push('');
      lines.push('━━━━━━━━━━━━━━━━');
      lines.push(`รวม ${totalAlerts} รายการ`);

      const lineMessage = lines.join('\n');
      if (lineMessage.length <= 5000) {
        await sendToLineGroup(accessToken, groupId, lineMessage);
      } else {
        const parts = lineMessage.split('\n\n');
        let chunk = '';
        for (const part of parts) {
          if ((chunk + '\n\n' + part).length > 4800 && chunk) {
            await sendToLineGroup(accessToken, groupId, chunk);
            chunk = part;
          } else {
            chunk = chunk ? chunk + '\n\n' + part : part;
          }
        }
        if (chunk) await sendToLineGroup(accessToken, groupId, chunk);
      }
    }

    console.log(`Meeting reminder: ${actionAlerts.length} action alerts, ${followUpAlerts.length} follow-up alerts, ${emailsSent} emails sent`);

    return Response.json({
      status: 'sent',
      today: todayStr,
      action_alerts: actionAlerts.length,
      followup_alerts: followUpAlerts.length,
      emails_sent: emailsSent,
      staff_notified: Object.keys(byStaff).length,
    });
  } catch (error) {
    console.error('meetingActionReminder error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

// ── Build HTML email ──
function buildEmailHtml(data, todayStr, actionOverdue, actionToday, fupOverdue, fupToday) {
  const sections = [];

  if (actionOverdue.length > 0) {
    const rows = actionOverdue.map(a =>
      `<tr><td style="padding:6px 10px;font-size:13px;">🔴 ${a.item.text}</td><td style="padding:6px 10px;font-size:13px;color:#dc2626;">เลย ${a.daysOverdue} วัน</td><td style="padding:6px 10px;font-size:13px;">${a.note.title}</td></tr>`
    ).join('');
    sections.push(`<h3 style="color:#dc2626;font-size:14px;margin:16px 0 8px;">🔴 Action Item เลยกำหนด (${actionOverdue.length})</h3>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;">
        <thead><tr style="background:#fef2f2;"><th style="padding:6px 10px;text-align:left;font-size:11px;">รายการ</th><th style="padding:6px 10px;text-align:left;font-size:11px;">สถานะ</th><th style="padding:6px 10px;text-align:left;font-size:11px;">จาก Meeting</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`);
  }

  if (actionToday.length > 0) {
    const rows = actionToday.map(a =>
      `<tr><td style="padding:6px 10px;font-size:13px;">⚠️ ${a.item.text}</td><td style="padding:6px 10px;font-size:13px;color:#d97706;">กำหนดวันนี้</td><td style="padding:6px 10px;font-size:13px;">${a.note.title}</td></tr>`
    ).join('');
    sections.push(`<h3 style="color:#d97706;font-size:14px;margin:16px 0 8px;">⚠️ Action Item กำหนดวันนี้ (${actionToday.length})</h3>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;">
        <thead><tr style="background:#fffbeb;"><th style="padding:6px 10px;text-align:left;font-size:11px;">รายการ</th><th style="padding:6px 10px;text-align:left;font-size:11px;">สถานะ</th><th style="padding:6px 10px;text-align:left;font-size:11px;">จาก Meeting</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`);
  }

  if (fupOverdue.length > 0) {
    const rows = fupOverdue.map(a =>
      `<tr><td style="padding:6px 10px;font-size:13px;">🔔 ${a.note.title}</td><td style="padding:6px 10px;font-size:13px;color:#dc2626;">เลย ${a.daysOverdue} วัน</td><td style="padding:6px 10px;font-size:13px;">${formatThaiDate(a.note.follow_up_date)}</td></tr>`
    ).join('');
    sections.push(`<h3 style="color:#7c3aed;font-size:14px;margin:16px 0 8px;">🔔 Follow-up เลยกำหนด (${fupOverdue.length})</h3>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;">
        <thead><tr style="background:#f5f3ff;"><th style="padding:6px 10px;text-align:left;font-size:11px;">Meeting</th><th style="padding:6px 10px;text-align:left;font-size:11px;">สถานะ</th><th style="padding:6px 10px;text-align:left;font-size:11px;">กำหนด Follow-up</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`);
  }

  if (fupToday.length > 0) {
    const rows = fupToday.map(a =>
      `<tr><td style="padding:6px 10px;font-size:13px;">📅 ${a.note.title}</td><td style="padding:6px 10px;font-size:13px;color:#2563eb;">วันนี้</td><td style="padding:6px 10px;font-size:13px;">${formatThaiDate(a.note.follow_up_date)}</td></tr>`
    ).join('');
    sections.push(`<h3 style="color:#2563eb;font-size:14px;margin:16px 0 8px;">📅 Follow-up วันนี้ (${fupToday.length})</h3>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;">
        <thead><tr style="background:#eff6ff;"><th style="padding:6px 10px;text-align:left;font-size:11px;">Meeting</th><th style="padding:6px 10px;text-align:left;font-size:11px;">สถานะ</th><th style="padding:6px 10px;text-align:left;font-size:11px;">กำหนด Follow-up</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`);
  }

  const total = actionOverdue.length + actionToday.length + fupOverdue.length + fupToday.length;

  return `
    <div style="font-family:'Segoe UI',Tahoma,sans-serif;max-width:700px;margin:0 auto;padding:20px;">
      <div style="background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;padding:18px 24px;border-radius:12px 12px 0 0;">
        <h2 style="margin:0;font-size:16px;">📝 แจ้งเตือน Meeting Notes</h2>
        <p style="margin:6px 0 0;font-size:12px;opacity:0.9;">วันที่ ${formatThaiDate(todayStr)} — ${total} รายการต้องดำเนินการ</p>
      </div>
      <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:16px 24px;">
        ${sections.join('')}
        <p style="font-size:12px;color:#6b7280;margin-top:20px;text-align:center;">เปิดระบบเพื่อดูรายละเอียดและอัปเดตสถานะ</p>
      </div>
      <p style="text-align:center;font-size:10px;color:#9ca3af;margin-top:12px;">ACC Precision Hub — ACC Consulting Co., Ltd.</p>
    </div>`;
}