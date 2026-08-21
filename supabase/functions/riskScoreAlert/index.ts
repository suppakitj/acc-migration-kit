import { createClientFromRequest } from '../_shared/base44-compat.ts';

const PRIORITY_WEIGHT = { urgent: 4, high: 3, medium: 2, low: 1 };
const STATUS_WEIGHT = { pending: 3, in_progress: 2, review: 1 };
const PRIORITY_EMOJI = { urgent: '🔴', high: '🟠', medium: '🟡', low: '🟢' };
const STATUS_LABEL = { pending: 'รอดำเนินการ', in_progress: 'กำลังทำ', review: 'รอตรวจสอบ' };

function getBangkokToday() {
  const now = new Date();
  const offset = 7 * 60 * 60 * 1000;
  return new Date(now.getTime() + offset).toISOString().split('T')[0];
}

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

function computeRiskScore(task, todayStr) {
  if (!task.due_date) return 0;
  const daysLeft = getDaysDiff(task.due_date, todayStr);
  const priorityW = PRIORITY_WEIGHT[task.priority] || 2;
  const statusW = STATUS_WEIGHT[task.status] || 2;
  const checklist = task.checklist || [];
  const progress = checklist.length > 0 ? checklist.filter(c => c.checked).length / checklist.length : 0;
  const changePenalty = Math.min((task.due_date_change_count || 0) * 0.15, 0.6);

  let score = 0;
  if (daysLeft <= 0) score += 50;
  else if (daysLeft <= 1) score += 40;
  else if (daysLeft <= 3) score += 30;
  else if (daysLeft <= 7) score += 20;
  else if (daysLeft <= 14) score += 10;
  else score += 5;
  score += (1 - progress) * 20;
  score += priorityW * 4;
  score += statusW * 3;
  score += changePenalty * 15;
  return Math.min(100, Math.round(score));
}

function getRiskLabel(score) {
  if (score >= 70) return '🚨 วิกฤต';
  if (score >= 50) return '⚠️ สูง';
  return '';
}

async function sendToLine(accessToken, target, message) {
  if (!accessToken || !target) return;
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ to: target, messages: [{ type: 'text', text: message }] }),
  });
  if (!res.ok) console.error(`LINE push failed: ${res.status} ${await res.text()}`);
  return res.ok;
}

function buildRiskAlertMessage(todayStr, highRiskTasks) {
  const lines = [
    `🔔 แจ้งเตือน Risk Score สูง`,
    `📆 ${formatDate(todayStr)}`,
    `━━━━━━━━━━━━━━━━`,
    `พบ ${highRiskTasks.length} งานที่มีความเสี่ยงสูง/วิกฤต`,
    '',
  ];

  highRiskTasks.slice(0, 20).forEach((t, i) => {
    const daysLeft = getDaysDiff(t.due_date, todayStr);
    const daysText = daysLeft <= 0 ? `เกิน ${Math.abs(daysLeft)} วัน` : `อีก ${daysLeft} วัน`;
    const pEmoji = PRIORITY_EMOJI[t.priority] || '📋';
    lines.push(`${i + 1}. ${getRiskLabel(t._riskScore)} ${pEmoji} ${t.title}`);
    lines.push(`   Risk Score: ${t._riskScore}/100`);
    if (t.customer_name) lines.push(`   🏢 ${t.customer_name}`);
    lines.push(`   👤 ${t.assigned_name || '-'} | 📅 ${daysText}`);
    lines.push(`   📌 ${STATUS_LABEL[t.status] || t.status}`);
    lines.push('');
  });

  lines.push('━━━━━━━━━━━━━━━━');
  lines.push('💡 กรุณาตรวจสอบและดำเนินการป้องกัน');
  return lines.join('\n');
}

function buildRiskEmailHTML(todayStr, highRiskTasks, senderName) {
  const rows = highRiskTasks.slice(0, 30).map(t => {
    const daysLeft = getDaysDiff(t.due_date, todayStr);
    const daysText = daysLeft <= 0 ? `เกิน ${Math.abs(daysLeft)} วัน` : `อีก ${daysLeft} วัน`;
    const scoreColor = t._riskScore >= 70 ? '#dc2626' : '#ea580c';
    const checklist = t.checklist || [];
    const progress = checklist.length > 0 ? Math.round((checklist.filter(c => c.checked).length / checklist.length) * 100) : 0;

    return `<tr>
      <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:12px;">${t.title}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:12px;">${t.customer_name || '-'}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:12px;">${t.assigned_name || '-'}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:12px;text-align:center;"><span style="color:${scoreColor};font-weight:700;">${t._riskScore}</span></td>
      <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:12px;">${formatDate(t.due_date)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:12px;color:${daysLeft<=0?'#dc2626':'#ea580c'};">${daysText}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:12px;">${progress}%</td>
    </tr>`;
  }).join('');

  const criticalCount = highRiskTasks.filter(t => t._riskScore >= 70).length;
  const highCount = highRiskTasks.filter(t => t._riskScore >= 50 && t._riskScore < 70).length;

  return `<div style="font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;max-width:750px;margin:0 auto;padding:20px;">
    <div style="background:linear-gradient(135deg,#7f1d1d 0%,#dc2626 100%);padding:24px;border-radius:12px 12px 0 0;text-align:center;">
      <h1 style="color:#fff;margin:0;font-size:20px;">🔔 Risk Score Alert</h1>
      <p style="color:#fca5a5;margin:6px 0 0;font-size:12px;">แจ้งเตือนงานที่มีความเสี่ยง Overdue สูง — ${formatDate(todayStr)}</p>
    </div>
    <div style="background:#fff;padding:24px;border:1px solid #e2e8f0;border-top:none;">
      <div style="display:flex;gap:12px;margin-bottom:16px;">
        ${criticalCount > 0 ? `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:10px 14px;flex:1;"><p style="margin:0;color:#991b1b;font-size:12px;font-weight:600;">🚨 วิกฤต: ${criticalCount} งาน</p></div>` : ''}
        ${highCount > 0 ? `<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:10px 14px;flex:1;"><p style="margin:0;color:#9a3412;font-size:12px;font-weight:600;">⚠️ สูง: ${highCount} งาน</p></div>` : ''}
      </div>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
        <thead><tr style="background:#f1f5f9;">
          <th style="padding:8px 10px;text-align:left;font-size:10px;color:#64748b;font-weight:600;border-bottom:2px solid #e2e8f0;">งาน</th>
          <th style="padding:8px 10px;text-align:left;font-size:10px;color:#64748b;font-weight:600;border-bottom:2px solid #e2e8f0;">ลูกค้า</th>
          <th style="padding:8px 10px;text-align:left;font-size:10px;color:#64748b;font-weight:600;border-bottom:2px solid #e2e8f0;">ผู้รับผิดชอบ</th>
          <th style="padding:8px 10px;text-align:center;font-size:10px;color:#64748b;font-weight:600;border-bottom:2px solid #e2e8f0;">Risk</th>
          <th style="padding:8px 10px;text-align:left;font-size:10px;color:#64748b;font-weight:600;border-bottom:2px solid #e2e8f0;">กำหนด</th>
          <th style="padding:8px 10px;text-align:left;font-size:10px;color:#64748b;font-weight:600;border-bottom:2px solid #e2e8f0;">เหลือ</th>
          <th style="padding:8px 10px;text-align:left;font-size:10px;color:#64748b;font-weight:600;border-bottom:2px solid #e2e8f0;">Progress</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="color:#94a3b8;font-size:11px;margin-top:16px;">💡 กรุณาตรวจสอบและดำเนินการป้องกันงานเสี่ยงเหล่านี้</p>
    </div>
    <div style="background:#f8fafc;padding:10px 24px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;text-align:center;">
      <p style="color:#94a3b8;font-size:10px;margin:0;">ส่งโดยอัตโนมัติจาก ${senderName}</p>
    </div>
  </div>`;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const todayStr = getBangkokToday();

    // Check weekend / holiday
    const bangkokNow = new Date(new Date().getTime() + 7 * 60 * 60 * 1000);
    const dow = bangkokNow.getUTCDay();
    if (dow === 0 || dow === 6) {
      console.log('Weekend — skip risk alert');
      return Response.json({ status: 'skipped', reason: 'weekend' });
    }

    const holidays = await base44.asServiceRole.entities.HolidayMaster.filter({ status: 'active' });
    if (holidays.some(h => h.date === todayStr)) {
      console.log('Holiday — skip risk alert');
      return Response.json({ status: 'skipped', reason: 'holiday' });
    }

    // Fetch tasks
    const allTasks = await base44.asServiceRole.entities.Task.filter({});
    const activeTasks = allTasks.filter(t =>
      t.due_date && ['pending', 'in_progress', 'review'].includes(t.status)
    );

    // Compute risk scores
    const highRiskTasks = activeTasks
      .map(t => ({ ...t, _riskScore: computeRiskScore(t, todayStr) }))
      .filter(t => t._riskScore >= 50) // high + critical only
      .sort((a, b) => b._riskScore - a._riskScore);

    if (highRiskTasks.length === 0) {
      console.log('No high-risk tasks found');
      return Response.json({ status: 'ok', message: 'No high-risk tasks' });
    }

    console.log(`Found ${highRiskTasks.length} high-risk tasks`);

    // Get configs
    const configs = await base44.asServiceRole.entities.AppConfig.filter({});
    const getVal = (key) => configs.find(c => c.key === key)?.value || '';
    const lineToken = getVal('line_access_token');
    const senderName = getVal('o365_sender_name') || getVal('smtp_sender_name') || 'ACC Consulting';

    // --- Email to admin/management ---
    const allUsers = await base44.asServiceRole.entities.User.filter({});
    const mgmtUsers = allUsers.filter(u => ['admin', 'management'].includes(u.role) && u.user_status !== 'inactive');
    let emailSent = 0;

    const emailHtml = buildRiskEmailHTML(todayStr, highRiskTasks, senderName);
    for (const u of mgmtUsers) {
      if (!u.email) continue;
      try {
        await base44.asServiceRole.integrations.Core.SendEmail({
          from_name: senderName,
          to: u.email,
          subject: `[Risk Alert] ${highRiskTasks.length} งานเสี่ยง Overdue — ${formatDate(todayStr)}`,
          body: emailHtml,
        });
        emailSent++;
      } catch (e) {
        console.error(`Email to ${u.email} failed:`, e.message);
      }
    }

    // Create notification
    await base44.asServiceRole.entities.Notification.create({
      title: `🔔 Risk Alert: ${highRiskTasks.length} งานเสี่ยงสูง`,
      message: `พบ ${highRiskTasks.filter(t=>t._riskScore>=70).length} งานวิกฤต และ ${highRiskTasks.filter(t=>t._riskScore>=50&&t._riskScore<70).length} งานเสี่ยงสูง`,
      type: 'system',
      sent_via_line: false,
      sent_via_email: emailSent > 0,
    });

    return Response.json({
      status: 'sent',
      high_risk_count: highRiskTasks.length,
      critical: highRiskTasks.filter(t => t._riskScore >= 70).length,
      high: highRiskTasks.filter(t => t._riskScore >= 50 && t._riskScore < 70).length,
      line_sent: false,
      emails_sent: emailSent,
    });

  } catch (error) {
    console.error('riskScoreAlert error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});