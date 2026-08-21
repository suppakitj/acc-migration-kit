import { createClientFromRequest } from '../_shared/base44-compat.ts';

/**
 * Save a LINE file to Google Drive with folder structure:
 * LINE Files / {customerName} / {YYYY} / {MM} / {DD} / filename
 */

// In-flight promise cache: prevents concurrent requests from creating duplicates
// Maps cacheKey → Promise<folderId> so the second caller awaits the first's result
const inflightCache = new Map();

async function findOrCreateFolder(accessToken, name, parentId) {
  const cacheKey = `${parentId || 'root'}::${name}`;

  // If another request is already finding/creating this exact folder, await it
  if (inflightCache.has(cacheKey)) {
    return inflightCache.get(cacheKey);
  }

  const promise = _doFindOrCreate(accessToken, name, parentId);
  inflightCache.set(cacheKey, promise);

  try {
    const result = await promise;
    return result;
  } catch (e) {
    inflightCache.delete(cacheKey); // allow retry on failure
    throw e;
  }
}

async function _doFindOrCreate(accessToken, name, parentId) {
  const authH = { Authorization: `Bearer ${accessToken}` };
  const escapedName = name.replace(/'/g, "\\'");

  // For root "LINE Files", always search with parentId constraint via 'root' in parents
  const q = parentId
    ? `name='${escapedName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
    : `name='${escapedName}' and 'root' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;

  // Search existing
  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&orderBy=createdTime&spaces=drive`,
    { headers: authH }
  );
  if (searchRes.ok) {
    const data = await searchRes.json();
    if (data.files && data.files.length > 0) {
      return data.files[0].id; // use earliest-created
    }
  }

  // Create folder
  const metadata = { name, mimeType: 'application/vnd.google-apps.folder' };
  if (parentId) {
    metadata.parents = [parentId];
  }
  const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { ...authH, 'Content-Type': 'application/json' },
    body: JSON.stringify(metadata),
  });
  if (!createRes.ok) {
    const errText = await createRes.text();
    throw new Error(`Failed to create folder "${name}": ${errText}`);
  }
  const folder = await createRes.json();

  // Post-create verify: re-search to pick earliest (race condition guard)
  // Small delay to let Drive index the new folder
  await new Promise(r => setTimeout(r, 300));
  const verifyRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&orderBy=createdTime&spaces=drive`,
    { headers: authH }
  );
  if (verifyRes.ok) {
    const verifyData = await verifyRes.json();
    if (verifyData.files && verifyData.files.length > 0) {
      const canonicalId = verifyData.files[0].id;
      if (canonicalId !== folder.id) {
        console.log(`Race condition: folder "${name}" — using ${canonicalId}, trashing duplicate ${folder.id}`);
        fetch(`https://www.googleapis.com/drive/v3/files/${folder.id}`, {
          method: 'PATCH',
          headers: { ...authH, 'Content-Type': 'application/json' },
          body: JSON.stringify({ trashed: true }),
        }).catch(() => {});
      }
      return canonicalId;
    }
  }

  return folder.id;
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  const { file_url, file_name, content_type, chat_display_name, message_type, sender_name } = await req.json();

  if (!file_url || !chat_display_name) {
    return Response.json({ error: 'file_url and chat_display_name are required' }, { status: 400 });
  }

  // Get Google Drive access token
  let accessToken;
  try {
    const conn = await base44.asServiceRole.connectors.getConnection('googledrive');
    accessToken = conn.accessToken;
  } catch (e) {
    console.error('Google Drive not connected:', e.message);
    return Response.json({ error: 'Google Drive not connected' }, { status: 400 });
  }

  // Build folder path: LINE Files / {chatName} / {YYYY} / {MM} / {DD}
  const now = new Date();
  // Use Bangkok timezone
  const bangkokTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
  const year = String(bangkokTime.getFullYear());
  const month = String(bangkokTime.getMonth() + 1).padStart(2, '0');
  const day = String(bangkokTime.getDate()).padStart(2, '0');

  // Sanitize folder name (remove special chars)
  const safeName = chat_display_name.replace(/[\/\\?%*:|"<>]/g, '_').trim() || 'Unknown';
  const safeSender = (sender_name || 'Unknown').replace(/[\/\\?%*:|"<>]/g, '_').trim() || 'Unknown';

  console.log(`Saving file to Drive: LINE Files / ${safeName} / ${year} / ${month} / ${day} / ${safeSender} / ${file_name}`);

  // Create nested folder structure: chat > year > month > day > sender
  const rootFolderId = await findOrCreateFolder(accessToken, 'LINE Files', null);
  const customerFolderId = await findOrCreateFolder(accessToken, safeName, rootFolderId);
  const yearFolderId = await findOrCreateFolder(accessToken, year, customerFolderId);
  const monthFolderId = await findOrCreateFolder(accessToken, month, yearFolderId);
  const dayFolderId = await findOrCreateFolder(accessToken, day, monthFolderId);
  const senderFolderId = await findOrCreateFolder(accessToken, safeSender, dayFolderId);

  // Download the file
  const fileRes = await fetch(file_url);
  if (!fileRes.ok) {
    return Response.json({ error: 'Failed to download file from storage' }, { status: 500 });
  }
  const fileBuffer = await fileRes.arrayBuffer();

  // Determine file name and content type
  const finalFileName = file_name || `line_${message_type || 'file'}_${Date.now()}`;
  const finalContentType = content_type || 'application/octet-stream';

  // Upload to Google Drive using multipart upload
  const metadata = {
    name: finalFileName,
    parents: [senderFolderId],
  };

  const boundary = 'line_drive_boundary_' + Date.now();
  const metadataStr = JSON.stringify(metadata);
  const encoder = new TextEncoder();

  const metaPart = encoder.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadataStr}\r\n`
  );
  const filePart = encoder.encode(`--${boundary}\r\nContent-Type: ${finalContentType}\r\n\r\n`);
  const endPart = encoder.encode(`\r\n--${boundary}--`);

  const body = new Uint8Array(metaPart.length + filePart.length + fileBuffer.byteLength + endPart.length);
  body.set(metaPart, 0);
  body.set(filePart, metaPart.length);
  body.set(new Uint8Array(fileBuffer), metaPart.length + filePart.length);
  body.set(endPart, metaPart.length + filePart.length + fileBuffer.byteLength);

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

  if (!driveRes.ok) {
    const errText = await driveRes.text();
    console.error('Google Drive upload failed:', errText);
    return Response.json({ error: 'Drive upload failed', details: errText }, { status: 500 });
  }

  const driveFile = await driveRes.json();
  console.log(`File saved to Drive: ${driveFile.name} (${driveFile.id})`);

  return Response.json({
    success: true,
    drive_file_id: driveFile.id,
    drive_file_name: driveFile.name,
    drive_link: driveFile.webViewLink,
    folder_path: `LINE Files/${safeName}/${year}/${month}/${day}/${safeSender}`,
  });
});