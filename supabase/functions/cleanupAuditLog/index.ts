import { createClientFromRequest } from '../_shared/base44-compat.ts';

async function findOrCreateFolder(accessToken, name, parentId) {
  const q = parentId
    ? `name='${name}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
    : `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;

  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&spaces=drive`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (searchRes.ok) {
    const data = await searchRes.json();
    if (data.files && data.files.length > 0) return data.files[0].id;
  }

  const metadata = { name, mimeType: 'application/vnd.google-apps.folder' };
  if (parentId) metadata.parents = [parentId];

  const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(metadata),
  });

  if (!createRes.ok) throw new Error(`Failed to create folder "${name}"`);
  const folder = await createRes.json();
  return folder.id;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const cutoffDays = 30;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - cutoffDays);
    const cutoffISO = cutoff.toISOString();

    // Fetch old audit logs (older than 30 days)
    const oldLogs = await base44.asServiceRole.entities.AuditLog.filter(
      {}, 'created_date', 5000
    );

    // Filter logs older than cutoff
    const logsToExport = oldLogs.filter(log => {
      const logDate = log.created_date || '';
      return logDate < cutoffISO;
    });

    if (logsToExport.length === 0) {
      return Response.json({ exported: 0, deleted: 0, message: 'No old logs to clean up' });
    }

    // ── Export to Google Drive ──
    let driveExported = false;
    try {
      const conn = await base44.asServiceRole.connectors.getConnection('googledrive');
      const accessToken = conn.accessToken;

      const now = new Date();
      const bangkokTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
      const year = String(bangkokTime.getFullYear());
      const month = String(bangkokTime.getMonth() + 1).padStart(2, '0');

      // อ่าน Audit Log folder จาก AppConfig — ถ้าไม่มีให้สร้าง folder "Audit Logs" อัตโนมัติ
      const configs = await base44.asServiceRole.entities.AppConfig.filter({});
      let auditRootId = configs.find(c => c.key === 'gdrive_audit_log_folder_id')?.value || '';
      if (auditRootId.includes('drive.google.com')) {
        const match = auditRootId.match(/\/folders\/([a-zA-Z0-9_-]+)/);
        if (match) auditRootId = match[1];
      }
      const rootFolderId = auditRootId || await findOrCreateFolder(accessToken, 'Audit Logs', null);
      const yearFolderId = await findOrCreateFolder(accessToken, year, rootFolderId);
      const monthFolderId = await findOrCreateFolder(accessToken, month, yearFolderId);

      // Build CSV content
      const csvHeader = 'วันที่,เวลา,ผู้ใช้,อีเมล,Action,Entity Type,Entity Name,Entity ID,รายละเอียด,Category\n';
      const csvRows = logsToExport.map(log => {
        const d = log.created_date ? new Date(log.created_date) : new Date();
        const date = d.toISOString().split('T')[0];
        const time = d.toISOString().split('T')[1]?.split('.')[0] || '';
        const escape = (s) => `"${(s || '').replace(/"/g, '""')}"`;
        return [
          date, time,
          escape(log.user_name), escape(log.user_email),
          escape(log.action), escape(log.entity_type),
          escape(log.entity_name), escape(log.entity_id),
          escape(log.details), escape(log.category || ''),
        ].join(',');
      }).join('\n');

      const csvContent = '\uFEFF' + csvHeader + csvRows; // BOM for Thai encoding

      // Upload CSV to Google Drive
      const fileName = `audit_log_export_${year}${month}_${Date.now()}.csv`;
      const metadata = { name: fileName, parents: [monthFolderId], mimeType: 'text/csv' };
      const boundary = 'audit_export_' + Date.now();
      const metadataStr = JSON.stringify(metadata);
      const encoder = new TextEncoder();

      const metaPart = encoder.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadataStr}\r\n`);
      const filePart = encoder.encode(`--${boundary}\r\nContent-Type: text/csv; charset=UTF-8\r\n\r\n`);
      const fileBytes = encoder.encode(csvContent);
      const endPart = encoder.encode(`\r\n--${boundary}--`);

      const body = new Uint8Array(metaPart.length + filePart.length + fileBytes.length + endPart.length);
      body.set(metaPart, 0);
      body.set(filePart, metaPart.length);
      body.set(fileBytes, metaPart.length + filePart.length);
      body.set(endPart, metaPart.length + filePart.length + fileBytes.length);

      const driveRes = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': `multipart/related; boundary=${boundary}`,
          },
          body,
        }
      );

      if (driveRes.ok) {
        const driveData = await driveRes.json();
        console.log(`Audit log exported to Drive: ${driveData.name} (${driveData.id})`);
        driveExported = true;
      } else {
        const errText = await driveRes.text();
        console.error('Drive upload failed:', errText);
      }
    } catch (driveErr) {
      console.warn('Google Drive export failed (will still delete):', driveErr.message);
    }

    // ── Delete old logs ──
    let deleted = 0;
    for (const log of logsToExport) {
      try {
        await base44.asServiceRole.entities.AuditLog.delete(log.id);
        deleted++;
      } catch (e) {
        console.warn(`Failed to delete log ${log.id}:`, e.message);
      }
    }

    console.log(`Cleanup: exported ${logsToExport.length} logs, deleted ${deleted}, drive: ${driveExported}`);

    return Response.json({
      exported: logsToExport.length,
      deleted,
      drive_exported: driveExported,
      cutoff_days: cutoffDays,
      cutoff_date: cutoffISO,
    });
  } catch (error) {
    console.error('cleanupAuditLog error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});