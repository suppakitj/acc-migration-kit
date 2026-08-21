import { createClientFromRequest } from '../_shared/base44-compat.ts';

const PKG_LABELS = { trial: 'TRIAL', basic: 'BASIC', pro: 'PRO', pro_plus: 'PRO Plus' };

function fmtDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear();
}

async function pushLine(token, to, text) {
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ to, messages: [{ type: 'text', text }] }),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error('LINE push failed: ' + res.status + ' ' + err);
  }
  return res.ok;
}

function buildLineMsg(items) {
  if (items.length === 0) return null;
  const parts = [];
  parts.push('📢 แจ้งเตือน Peak License ใกล้หมดอายุ');
  parts.push('📆 ' + fmtDate(new Date().toISOString().split('T')[0]));
  parts.push('━━━━━━━━━━━━━━━━');
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    parts.push((i + 1) + '. 🏢 ' + item.name);
    parts.push('   📦 ' + (PKG_LABELS[item.pkg] || item.pkg));
    parts.push('   📅 หมดอายุ: ' + fmtDate(item.exp));
    parts.push('   ⏳ เหลือ ' + item.days + ' วัน');
    if (i < items.length - 1) parts.push('');
  }
  parts.push('━━━━━━━━━━━━━━━━');
  parts.push('รวม ' + items.length + ' รายการ — กรุณาดำเนินการต่ออายุ');
  return parts.join('\n');
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const configs = await base44.asServiceRole.entities.AppConfig.filter({});
    const getVal = (key) => configs.find(c => c.key === key)?.value || '';

    const settingsCfg = configs.find(c => c.key === 'peak_notification_settings');
    let settings = { reminder_days: [30, 15, 7], channels: ['email'] };
    if (settingsCfg?.value) {
      try { settings = { ...settings, ...JSON.parse(settingsCfg.value) }; } catch (e) { /* ignore */ }
    }

    const lineToken = getVal('line_access_token');
    const acctGroup = getVal('line_group_dept_accounting');

    // Skip holidays — don't send reminders on holidays
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const dayOfWeek = today.getDay(); // 0=Sun, 6=Sat

    // Skip weekends
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return Response.json({ success: true, skipped: true, reason: 'weekend' });
    }

    // Skip holidays from HolidayMaster
    const holidays = await base44.asServiceRole.entities.HolidayMaster.filter({ status: 'active' });
    const isHoliday = holidays.some(h => h.date === todayStr);
    if (isHoliday) {
      return Response.json({ success: true, skipped: true, reason: 'holiday' });
    }

    const licenses = await base44.asServiceRole.entities.PeakLicense.filter({});
    const results = [];
    const lineItems = [];

    for (const lic of licenses) {
      if (!lic.expiry_date) continue;
      if (lic.license_status === 'cancelled' || lic.license_status === 'expired') continue;

      const expDate = new Date(lic.expiry_date);
      const daysLeft = Math.ceil((expDate.getTime() - today.getTime()) / 86400000);
      const matched = settings.reminder_days.find(d => daysLeft === d);
      if (matched === undefined) continue;

      const hist = lic.notification_history || [];
      if (hist.some(h => h.date === todayStr && h.days_before === matched)) continue;

      const msg = 'Peak License ของ ' + lic.customer_name + ' (' + (lic.package_type || '').toUpperCase() + ') จะหมดอายุในอีก ' + matched + ' วัน (' + lic.expiry_date + ')';
      const chSent = [];

      if (settings.channels.includes('email')) {
        await base44.asServiceRole.integrations.Core.SendEmail({
          to: user.email,
          subject: '[Peak License] แจ้งเตือน: ' + lic.customer_name + ' หมดอายุใน ' + matched + ' วัน',
          body: '<div style="font-family:sans-serif;padding:20px"><h2>แจ้งเตือน Peak License ใกล้หมดอายุ</h2><p><b>ลูกค้า:</b> ' + lic.customer_name + '</p><p><b>แพ็กเกจ:</b> ' + (lic.package_type || '').toUpperCase() + '</p><p><b>วันหมดอายุ:</b> ' + lic.expiry_date + '</p><p><b>เหลืออีก:</b> ' + matched + ' วัน</p><p>กรุณาดำเนินการต่ออายุ License</p></div>',
        });
        chSent.push('email');
      }

      if (settings.channels.includes('line')) {
        lineItems.push({ name: lic.customer_name, pkg: lic.package_type, exp: lic.expiry_date, days: matched });
        chSent.push('line');
      }

      const newHist = [...hist, { date: todayStr, channel: chSent.join(', '), days_before: matched, message: msg }];
      const upd = { notification_history: newHist };
      if (daysLeft <= 30 && lic.license_status === 'active') upd.license_status = 'expiring_soon';

      await base44.asServiceRole.entities.PeakLicense.update(lic.id, upd);
      results.push({ customer: lic.customer_name, days_left: matched, channels: chSent });
    }

    let lineSent = false;
    if (lineItems.length > 0 && lineToken && acctGroup) {
      const lineMsg = buildLineMsg(lineItems);
      if (lineMsg) {
        lineSent = await pushLine(lineToken, acctGroup, lineMsg);
        console.log('Peak LINE reminder to accounting: ' + (lineSent ? 'ok' : 'fail'));
      }
    } else if (lineItems.length > 0) {
      if (!lineToken) console.warn('No LINE token');
      if (!acctGroup) console.warn('No accounting group ID (line_group_dept_accounting)');
    }

    for (const lic of licenses) {
      if (!lic.expiry_date) continue;
      if (lic.license_status === 'cancelled' || lic.license_status === 'expired' || lic.license_status === 'renewed') continue;
      if (today > new Date(lic.expiry_date)) {
        await base44.asServiceRole.entities.PeakLicense.update(lic.id, { license_status: 'expired' });
        results.push({ customer: lic.customer_name, status_updated: 'expired' });
      }
    }

    return Response.json({ success: true, processed: results.length, line_sent: lineSent, line_items: lineItems.length, results });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});