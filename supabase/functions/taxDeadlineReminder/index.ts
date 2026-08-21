import { createClientFromRequest } from '../_shared/base44-compat.ts';

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
    console.error(`LINE push failed: ${res.status} ${errBody}`);
  }
  return res.ok;
}

const CATEGORY_EMOJI = {
  withholding_tax: '📋',
  vat: '🧾',
  sbt: '🏦',
  sso: '👥',
};

function formatThaiDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDate();
  const months = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.',
                   'ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  const month = months[d.getMonth()];
  const buddhistYear = d.getFullYear() + 543;
  return `${day} ${month} ${buddhistYear}`;
}

function getDaysUntil(deadlineStr, todayStr) {
  const deadline = new Date(deadlineStr + 'T00:00:00');
  const today = new Date(todayStr + 'T00:00:00');
  return Math.floor((deadline - today) / (1000 * 60 * 60 * 24));
}

function buildLineMessage(todayStr, deadlines7, deadlines3, deadlinesToday) {
  const total = deadlines7.length + deadlines3.length + deadlinesToday.length;
  if (total === 0) return null;

  const lines = [];
  lines.push('📅 แจ้งเตือนปฏิทินภาษีอากร');
  lines.push(`📆 วันที่ ${formatThaiDate(todayStr)}`);
  lines.push('━━━━━━━━━━━━━━━━');

  if (deadlinesToday.length > 0) {
    lines.push('');
    lines.push(`🔴 วันนี้วันสุดท้าย! (${deadlinesToday.length} รายการ)`);
    lines.push('─────────────');
    deadlinesToday.forEach(d => {
      const emoji = CATEGORY_EMOJI[d.category] || '📋';
      lines.push(`${emoji} ${d.tax_label}`);
      lines.push(`   📅 กำหนด: ${formatThaiDate(d.deadline)}`);
      if (d.was_shifted) lines.push(`   ⚠ ${d.shift_reason}`);
    });
  }

  if (deadlines3.length > 0) {
    lines.push('');
    lines.push(`⚠️ อีก 3 วันจะครบกำหนด (${deadlines3.length} รายการ)`);
    lines.push('─────────────');
    deadlines3.forEach(d => {
      const emoji = CATEGORY_EMOJI[d.category] || '📋';
      const days = getDaysUntil(d.deadline, todayStr);
      lines.push(`${emoji} ${d.tax_label} — อีก ${days} วัน`);
      lines.push(`   📅 กำหนด: ${formatThaiDate(d.deadline)}`);
    });
  }

  if (deadlines7.length > 0) {
    lines.push('');
    lines.push(`📋 อีก 7 วันจะครบกำหนด (${deadlines7.length} รายการ)`);
    lines.push('─────────────');
    deadlines7.forEach(d => {
      const emoji = CATEGORY_EMOJI[d.category] || '📋';
      const days = getDaysUntil(d.deadline, todayStr);
      lines.push(`${emoji} ${d.tax_label} — อีก ${days} วัน`);
      lines.push(`   📅 กำหนด: ${formatThaiDate(d.deadline)}`);
    });
  }

  lines.push('');
  lines.push('━━━━━━━━━━━━━━━━');
  lines.push(`รวม ${total} รายการ | 🔴 ${deadlinesToday.length} วันนี้ | ⚠️ ${deadlines3.length} ใน 3 วัน | 📋 ${deadlines7.length} ใน 7 วัน`);
  lines.push('');
  lines.push('💡 ดูปฏิทินเต็มได้ที่ ACC Precision Hub → ปฏิทินภาษี');

  return lines.join('\n');
}

function buildAnnouncementContent(todayStr, deadlinesToday, deadlines3, deadlines7) {
  const parts = [];

  if (deadlinesToday.length > 0) {
    parts.push('🔴 **วันนี้วันสุดท้าย!**');
    deadlinesToday.forEach(d => {
      parts.push(`- ${d.tax_label} (กำหนด ${formatThaiDate(d.deadline)})`);
    });
  }

  if (deadlines3.length > 0) {
    parts.push('');
    parts.push('⚠️ **ครบกำหนดใน 3 วัน**');
    deadlines3.forEach(d => {
      const days = getDaysUntil(d.deadline, todayStr);
      parts.push(`- ${d.tax_label} — อีก ${days} วัน (${formatThaiDate(d.deadline)})`);
    });
  }

  if (deadlines7.length > 0) {
    parts.push('');
    parts.push('📋 **ครบกำหนดใน 7 วัน**');
    deadlines7.forEach(d => {
      const days = getDaysUntil(d.deadline, todayStr);
      parts.push(`- ${d.tax_label} — อีก ${days} วัน (${formatThaiDate(d.deadline)})`);
    });
  }

  return parts.join('\n');
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Get LINE Config
    const configs = await base44.asServiceRole.entities.AppConfig.filter({});
    const getVal = (key) => configs.find(c => c.key === key)?.value || '';
    const accessToken = getVal('line_access_token');
    const accountingGroupId = getVal('line_group_dept_accounting');
    const companyGroupId = getVal('line_group_id');
    const targetGroupId = accountingGroupId || companyGroupId;

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

    // Skip holidays
    const holidays = await base44.asServiceRole.entities.HolidayMaster.filter({ status: 'active' });
    const holidayDates = new Set(holidays.map(h => h.date));
    if (holidayDates.has(todayStr)) {
      return Response.json({ status: 'skipped', reason: 'holiday' });
    }

    // Query TaxDeadlines
    const allDeadlines = await base44.asServiceRole.entities.TaxDeadline.filter(
      { status: 'active' }, 'deadline', 500
    );

    // Categorize by urgency
    const deadlinesToday = [];
    const deadlines3 = [];
    const deadlines7 = [];

    allDeadlines.forEach(d => {
      const daysLeft = getDaysUntil(d.deadline, todayStr);
      if (daysLeft === 0) deadlinesToday.push(d);
      else if (daysLeft >= 1 && daysLeft <= 3) deadlines3.push(d);
      else if (daysLeft >= 4 && daysLeft <= 7) deadlines7.push(d);
    });

    const totalAlerts = deadlinesToday.length + deadlines3.length + deadlines7.length;

    if (totalAlerts === 0) {
      return Response.json({ status: 'no_alerts', today: todayStr });
    }

    // Send LINE Message
    let lineSent = false;
    if (accessToken && targetGroupId) {
      const message = buildLineMessage(todayStr, deadlines7, deadlines3, deadlinesToday);
      if (message) {
        if (message.length <= 5000) {
          await sendToLineGroup(accessToken, targetGroupId, message);
        } else {
          const parts = message.split('\n\n');
          let chunk = '';
          for (const part of parts) {
            if ((chunk + '\n\n' + part).length > 4800 && chunk) {
              await sendToLineGroup(accessToken, targetGroupId, chunk);
              chunk = part;
            } else {
              chunk = chunk ? chunk + '\n\n' + part : part;
            }
          }
          if (chunk) await sendToLineGroup(accessToken, targetGroupId, chunk);
        }
        lineSent = true;
      }
    }

    // Create Announcement
    const announcementContent = buildAnnouncementContent(todayStr, deadlinesToday, deadlines3, deadlines7);
    const announcementType = deadlinesToday.length > 0 ? 'urgent' : 'reminder';
    const announcementTitle = deadlinesToday.length > 0
      ? `🔴 วันนี้วันสุดท้ายยื่นภาษี! (${deadlinesToday.map(d => d.tax_label).join(', ')})`
      : `📋 แจ้งเตือนปฏิทินภาษี — ${formatThaiDate(todayStr)}`;

    await base44.asServiceRole.entities.Announcement.create({
      title: announcementTitle,
      content: announcementContent,
      type: announcementType,
      author_email: 'system@acc-consulting.com',
      author_name: 'ระบบปฏิทินภาษี',
      pinned: deadlinesToday.length > 0,
      expires_at: todayStr,
      target_departments: ['accounting'],
    });

    console.log(`Tax deadline reminder: ${totalAlerts} alerts (${deadlinesToday.length} today, ${deadlines3.length} in 3d, ${deadlines7.length} in 7d). LINE: ${lineSent}`);

    return Response.json({
      status: 'sent',
      today: todayStr,
      line_sent: lineSent,
      line_target: targetGroupId ? 'accounting_group' : 'none',
      announcement_created: true,
      announcement_type: announcementType,
      today_count: deadlinesToday.length,
      three_day_count: deadlines3.length,
      seven_day_count: deadlines7.length,
      total_alerts: totalAlerts,
      deadlines_today: deadlinesToday.map(d => d.tax_label),
      deadlines_3days: deadlines3.map(d => d.tax_label),
      deadlines_7days: deadlines7.map(d => d.tax_label),
    });

  } catch (error) {
    console.error('Tax deadline reminder error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});