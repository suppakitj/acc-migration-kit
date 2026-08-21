import { createClientFromRequest } from '../_shared/base44-compat.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    let triggeredBy = 'auto-cron';
    try {
      const user = await base44.auth.me();
      if (user) triggeredBy = user.full_name || user.email;
    } catch (_e) { /* cron mode — no auth */ }

    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
    const results = { notifications: 0, lineMessages: 0, auditLogs: 0, errors: [] };

    // ── 1. ลบ Notification เก่ากว่า 30 วัน ──
    try {
      const cutoff30 = new Date(now);
      cutoff30.setDate(cutoff30.getDate() - 30);
      const cutoff30Str = cutoff30.toISOString();

      const oldNotifications = await base44.asServiceRole.entities.Notification.filter({}, '-created_date', 5000);
      const toDelete = oldNotifications.filter(n => n.created_date && n.created_date < cutoff30Str);

      for (const n of toDelete) {
        await base44.asServiceRole.entities.Notification.delete(n.id);
        results.notifications++;
      }
    } catch (e) {
      results.errors.push(`Notification cleanup: ${e.message}`);
    }

    // ── 2. ลบ LineMessage เก่ากว่า 6 เดือน ──
    try {
      const cutoff6m = new Date(now);
      cutoff6m.setMonth(cutoff6m.getMonth() - 6);
      const cutoff6mStr = cutoff6m.toISOString();

      const oldMessages = await base44.asServiceRole.entities.LineMessage.filter({}, 'created_date', 5000);
      const toDeleteMsgs = oldMessages.filter(m => m.created_date && m.created_date < cutoff6mStr);

      for (const m of toDeleteMsgs) {
        await base44.asServiceRole.entities.LineMessage.delete(m.id);
        results.lineMessages++;
      }
    } catch (e) {
      results.errors.push(`LineMessage cleanup: ${e.message}`);
    }

    // ── 3. ลบ AuditLog เก่ากว่า 90 วัน (ไม่ export — cleanupAuditLog ทำ export อยู่แล้ว) ──
    try {
      const cutoff90 = new Date(now);
      cutoff90.setDate(cutoff90.getDate() - 90);
      const cutoff90Str = cutoff90.toISOString();

      const oldLogs = await base44.asServiceRole.entities.AuditLog.filter({}, 'created_date', 5000);
      const toDeleteLogs = oldLogs.filter(l => l.created_date && l.created_date < cutoff90Str);

      for (const l of toDeleteLogs) {
        await base44.asServiceRole.entities.AuditLog.delete(l.id);
        results.auditLogs++;
      }
    } catch (e) {
      results.errors.push(`AuditLog cleanup: ${e.message}`);
    }

    // ── ส่ง LINE สรุป (ถ้ามีอะไรลบ) ──
    const totalDeleted = results.notifications + results.lineMessages + results.auditLogs;
    if (totalDeleted > 0) {
      try {
        const lineConfigs = await base44.asServiceRole.entities.AppConfig.filter({ key: 'line_group_dept_accounting' });
        const lineGroupId = lineConfigs.length > 0 ? lineConfigs[0].value : '';
        const lineTokenConfigs = await base44.asServiceRole.entities.AppConfig.filter({ key: 'line_access_token' });
        const accessToken = lineTokenConfigs.length > 0 ? lineTokenConfigs[0].value : '';

        if (lineGroupId && accessToken) {
          const msg = `🧹 Auto Cleanup สำเร็จ\n━━━━━━━━━━━━━━━━\n🗑️ Notification (>30 วัน): ${results.notifications}\n💬 LINE Messages (>6 เดือน): ${results.lineMessages}\n📋 Audit Log (>90 วัน): ${results.auditLogs}\n━━━━━━━━━━━━━━━━\nรวมลบ ${totalDeleted} records\n👤 ${triggeredBy}`;

          await fetch('https://api.line.me/v2/bot/message/push', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
            body: JSON.stringify({ to: lineGroupId, messages: [{ type: 'text', text: msg }] }),
          }).catch(() => {});
        }
      } catch (_e) { /* LINE send failed — non-critical */ }
    }

    return Response.json({
      success: true,
      triggered_by: triggeredBy,
      deleted: results,
      errors: results.errors,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});