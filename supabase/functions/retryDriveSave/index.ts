import { createClientFromRequest } from '../_shared/base44-compat.ts';

/**
 * Retry saving LINE files to Google Drive for messages that failed previously.
 * Uses resumable upload to avoid memory limits on large files.
 * Max 10 retries per message before giving up.
 */

const MAX_RETRIES = 10;
const BATCH_SIZE = 1;   // Process one at a time to stay within memory limits
const BATCH_DELAY_MS = 1000;
const MAX_PROCESS = 5;  // Fewer per run to avoid timeouts

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

  if (!createRes.ok) {
    const errText = await createRes.text();
    throw new Error(`Failed to create folder "${name}": ${errText}`);
  }
  return (await createRes.json()).id;
}

async function uploadFileToDrive(accessToken, msg) {
  const isImage = msg.message_type === 'image';
  const fileName = isImage
    ? `line_image_${msg.id}.jpg`
    : msg.content?.replace(/[\[\]]/g, '').replace('ไฟล์: ', '') || `line_file_${msg.id}`;
  const contentType = isImage ? 'image/jpeg' : 'application/octet-stream';
  const chatName = (msg.display_name || msg.customer_name || 'Unknown').replace(/[\/\\?%*:|"<>]/g, '_').trim() || 'Unknown';
  const senderName = (msg.sender_name || msg.display_name || 'Unknown').replace(/[\/\\?%*:|"<>]/g, '_').trim() || 'Unknown';

  // Build folder: LINE Files / chat / YYYY / MM / DD / sender
  const now = new Date();
  const bkk = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
  const year = String(bkk.getFullYear());
  const month = String(bkk.getMonth() + 1).padStart(2, '0');
  const day = String(bkk.getDate()).padStart(2, '0');

  const rootId = await findOrCreateFolder(accessToken, 'LINE Files', null);
  const chatId = await findOrCreateFolder(accessToken, chatName, rootId);
  const yearId = await findOrCreateFolder(accessToken, year, chatId);
  const monthId = await findOrCreateFolder(accessToken, month, yearId);
  const dayId = await findOrCreateFolder(accessToken, day, monthId);
  const senderId = await findOrCreateFolder(accessToken, senderName, dayId);

  // Step 1: Initiate resumable upload session (no file data in memory yet)
  const metadata = { name: fileName, parents: [senderId] };
  const initRes = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,webViewLink',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify(metadata),
    }
  );

  if (!initRes.ok) {
    const errText = await initRes.text();
    throw new Error(`Drive resumable init failed (${initRes.status}): ${errText}`);
  }

  const uploadUrl = initRes.headers.get('Location');
  if (!uploadUrl) throw new Error('No upload URL returned from Drive');

  // Step 2: Download source file and stream it directly to Drive upload URL
  const fileRes = await fetch(msg.file_url);
  if (!fileRes.ok) throw new Error('Failed to download file from storage');

  // Get content length if available for proper upload
  const contentLength = fileRes.headers.get('content-length');

  const uploadHeaders = {
    'Content-Type': contentType,
  };
  if (contentLength) {
    uploadHeaders['Content-Length'] = contentLength;
  }

  // Stream the body directly — avoids loading entire file into memory
  const driveRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: uploadHeaders,
    body: fileRes.body,
  });

  if (!driveRes.ok) {
    const errText = await driveRes.text();
    throw new Error(`Drive upload failed (${driveRes.status}): ${errText}`);
  }

  return await driveRes.json();
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Auth check — automation runs with service token, manual calls need admin
    try {
      const user = await base44.auth.me();
      if (user && user.role !== 'admin') {
        return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
      }
    } catch {
      // Called from automation (no user context) — allow
    }

    // Get Google Drive access token
    let accessToken;
    try {
      const conn = await base44.asServiceRole.connectors.getConnection('googledrive');
      accessToken = conn.accessToken;
    } catch (e) {
      console.error('Google Drive not connected:', e.message);
      return Response.json({ error: 'Google Drive not connected', details: e.message }, { status: 400 });
    }

    // Fetch unsaved messages — small page to stay within memory
    const failedMessages = await base44.asServiceRole.entities.LineMessage.filter(
      { drive_saved: false, direction: 'incoming' },
      '-created_date',
      50
    );

    // Fix legacy: mark non-file messages (text, sticker, etc.) as drive_saved=true
    // since they don't need Drive saving
    const nonFileMessages = failedMessages.filter(m =>
      !m.file_url || (m.message_type !== 'image' && m.message_type !== 'file')
    );
    if (nonFileMessages.length > 0) {
      console.log(`Fixing ${nonFileMessages.length} non-file messages (marking drive_saved=true)`);
      const fixBatch = nonFileMessages.slice(0, 50); // fix up to 50 per run
      for (const msg of fixBatch) {
        try {
          await base44.asServiceRole.entities.LineMessage.update(msg.id, { drive_saved: true });
        } catch { /* ignore */ }
      }
    }

    // Filter to only image/file with file_url and under max retries
    const toRetry = failedMessages.filter(m =>
      m.file_url &&
      (m.message_type === 'image' || m.message_type === 'file') &&
      (m.drive_retry_count || 0) < MAX_RETRIES
    );

    console.log(`Found ${toRetry.length} messages to retry Drive save (of ${failedMessages.length} unsaved)`);

    if (toRetry.length === 0) {
      return Response.json({ total_checked: failedMessages.length, retried: 0, success: 0, failed: 0 });
    }

    const batch = toRetry.slice(0, MAX_PROCESS);
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < batch.length; i += BATCH_SIZE) {
      const chunk = batch.slice(i, i + BATCH_SIZE);

      const results = await Promise.allSettled(chunk.map(async (msg) => {
        const retryNum = (msg.drive_retry_count || 0) + 1;
        try {
          const driveFile = await uploadFileToDrive(accessToken, msg);
          await base44.asServiceRole.entities.LineMessage.update(msg.id, {
            drive_saved: true,
            drive_retry_count: retryNum,
          });
          console.log(`✓ Retry #${retryNum} success for message ${msg.id} → ${driveFile.name}`);
          return 'success';
        } catch (err) {
          console.error(`✗ Retry #${retryNum} failed for message ${msg.id}: ${err.message}`);
          try {
            await base44.asServiceRole.entities.LineMessage.update(msg.id, {
              drive_retry_count: retryNum,
            });
          } catch { /* ignore */ }
          return 'fail';
        }
      }));

      results.forEach(r => {
        if (r.status === 'fulfilled' && r.value === 'success') successCount++;
        else failCount++;
      });

      if (i + BATCH_SIZE < batch.length) {
        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
      }
    }

    console.log(`Drive retry complete: ${successCount} success, ${failCount} failed out of ${batch.length} (${toRetry.length} total pending)`);

    return Response.json({
      total_checked: failedMessages.length,
      total_pending: toRetry.length,
      retried: batch.length,
      success: successCount,
      failed: failCount,
      remaining: toRetry.length - batch.length,
    });
  } catch (error) {
    console.error('retryDriveSave top-level error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});