import { createClientFromRequest } from '../_shared/base44-compat.ts';

async function findOrCreateFolder(accessToken, name, parentId) {
  let q = `name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  if (parentId) q += ` and '${parentId}' in parents`;

  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1`,
    { headers: { 'Authorization': `Bearer ${accessToken}` } }
  );
  const searchData = await searchRes.json();
  if (searchData.files?.length > 0) return searchData.files[0].id;

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

    const { file_url, file_name, file_size, customer_name } = await req.json();
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

    // Get Consulting Visit root folder ID from AppConfig
    const configs = await base44.asServiceRole.entities.AppConfig.filter({ key: 'gdrive_consulting_visit_folder_id' });
    const rootFolderId = configs.length > 0 ? configs[0].value : null;

    if (!rootFolderId) {
      return Response.json({ error: 'ยังไม่ได้ตั้งค่า Consulting Visit Folder ID — ไปตั้งค่าที่ Settings > Google Drive' }, { status: 400 });
    }

    // Build folder path: Root / ชื่อบริษัท / ปี / เดือน
    const now = new Date();
    const year = String(now.getFullYear());
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const companyName = customer_name || 'ไม่ระบุลูกค้า';

    let targetFolderId = rootFolderId;
    targetFolderId = await findOrCreateFolder(accessToken, companyName, targetFolderId);
    targetFolderId = await findOrCreateFolder(accessToken, year, targetFolderId);
    targetFolderId = await findOrCreateFolder(accessToken, month, targetFolderId);

    // Build multipart upload
    const metadata = {
      name: file_name,
      ...(targetFolderId ? { parents: [targetFolderId] } : {}),
    };

    const boundary = '---finding_upload_boundary';
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
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,thumbnailLink,size',
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
      thumbnail_url: driveFile.thumbnailLink || null,
      size: parseInt(driveFile.size || '0') || file_size || 0,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});