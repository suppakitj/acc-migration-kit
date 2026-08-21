import { createClientFromRequest } from '../_shared/base44-compat.ts';

async function findOrCreateFolder(accessToken, name, parentId) {
  // Search for existing folder
  let q = `name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  if (parentId) q += ` and '${parentId}' in parents`;

  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1`,
    { headers: { 'Authorization': `Bearer ${accessToken}` } }
  );
  const searchData = await searchRes.json();
  if (searchData.files?.length > 0) {
    return searchData.files[0].id;
  }

  // Create folder
  const metadata = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
    ...(parentId ? { parents: [parentId] } : {}),
  };
  const createRes = await fetch(
    'https://www.googleapis.com/drive/v3/files?fields=id',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(metadata),
    }
  );
  const folder = await createRes.json();
  return folder.id;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { file_url, file_name, file_size, category_name } = await req.json();
    if (!file_url || !file_name) {
      return Response.json({ error: 'Missing file_url or file_name' }, { status: 400 });
    }

    // Download the file from Base44 storage
    const fileRes = await fetch(file_url);
    if (!fileRes.ok) {
      return Response.json({ error: 'Failed to download file from storage' }, { status: 500 });
    }
    const fileBytes = new Uint8Array(await fileRes.arrayBuffer());
    const contentType = fileRes.headers.get('content-type') || 'application/octet-stream';

    // Get Google Drive access token
    const { accessToken } = await base44.asServiceRole.connectors.getConnection('googledrive');

    // Get KB root folder ID from AppConfig
    const configs = await base44.asServiceRole.entities.AppConfig.filter({ key: 'gdrive_kb_folder_id' });
    const rootFolderId = configs.length > 0 ? configs[0].value : null;

    // Build folder path: KB Root / Category / YYYY-MM
    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const catName = category_name || 'ทั่วไป';

    let targetFolderId = rootFolderId;

    // Create category subfolder
    if (targetFolderId) {
      targetFolderId = await findOrCreateFolder(accessToken, catName, targetFolderId);
    }

    // Create year-month subfolder
    if (targetFolderId) {
      targetFolderId = await findOrCreateFolder(accessToken, yearMonth, targetFolderId);
    }

    // Build multipart upload
    const metadata = {
      name: file_name,
      ...(targetFolderId ? { parents: [targetFolderId] } : {}),
    };

    const boundary = '---kb_upload_boundary';
    const metaPart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`;
    const filePart = `--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`;
    const endPart = `\r\n--${boundary}--`;

    const encoder = new TextEncoder();
    const metaBytes = encoder.encode(metaPart);
    const filePartBytes = encoder.encode(filePart);
    const endBytes = encoder.encode(endPart);

    const body = new Uint8Array(metaBytes.length + filePartBytes.length + fileBytes.length + endBytes.length);
    let offset = 0;
    body.set(metaBytes, offset); offset += metaBytes.length;
    body.set(filePartBytes, offset); offset += filePartBytes.length;
    body.set(fileBytes, offset); offset += fileBytes.length;
    body.set(endBytes, offset);

    const uploadRes = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,size',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
      }
    );

    if (!uploadRes.ok) {
      const err = await uploadRes.text();
      return Response.json({ error: `Google Drive upload failed: ${err}` }, { status: 500 });
    }

    const driveFile = await uploadRes.json();

    return Response.json({
      success: true,
      name: driveFile.name,
      drive_file_id: driveFile.id,
      drive_url: driveFile.webViewLink || `https://drive.google.com/file/d/${driveFile.id}/view`,
      size: parseInt(driveFile.size || '0') || file_size || 0,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});