import { createClientFromRequest } from '../_shared/base44-compat.ts';
import JSZip from 'npm:jszip@3.10.1';

const MAX_SIZE = 20 * 1024 * 1024; // 20 MB

/**
 * Download all files in a Google Drive folder as a .zip
 * Recursively collects files from subfolders.
 * Limits total size to 20MB.
 */

async function listAllFiles(folderId, authHeader, path = '') {
  const query = `'${folderId}' in parents and trashed=false`;
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,mimeType,size)&pageSize=200`,
    { headers: authHeader }
  );
  if (!res.ok) return [];
  const data = await res.json();
  const results = [];

  for (const f of (data.files || [])) {
    if (f.mimeType === 'application/vnd.google-apps.folder') {
      const subFiles = await listAllFiles(f.id, authHeader, path ? `${path}/${f.name}` : f.name);
      results.push(...subFiles);
    } else {
      results.push({
        id: f.id,
        name: f.name,
        path: path ? `${path}/${f.name}` : f.name,
        size: f.size ? parseInt(f.size) : 0,
      });
    }
  }
  return results;
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { folder_id } = await req.json();
  if (!folder_id) return Response.json({ error: 'folder_id is required' }, { status: 400 });

  let accessToken;
  try {
    const conn = await base44.asServiceRole.connectors.getConnection('googledrive');
    accessToken = conn.accessToken;
  } catch {
    return Response.json({ error: 'Google Drive not connected' }, { status: 400 });
  }

  const authHeader = { Authorization: `Bearer ${accessToken}` };

  // Get folder name
  const metaRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${folder_id}?fields=id,name`,
    { headers: authHeader }
  );
  let folderName = 'folder';
  if (metaRes.ok) {
    const meta = await metaRes.json();
    folderName = meta.name || 'folder';
  }

  // List all files recursively
  const allFiles = await listAllFiles(folder_id, authHeader);

  if (allFiles.length === 0) {
    return Response.json({ error: 'ไม่มีไฟล์ใน folder นี้' }, { status: 400 });
  }

  // Check total size
  const totalSize = allFiles.reduce((sum, f) => sum + f.size, 0);
  if (totalSize > MAX_SIZE) {
    const sizeMB = (totalSize / 1024 / 1024).toFixed(1);
    return Response.json({
      error: `ขนาดรวม ${sizeMB} MB เกินกำหนด 20 MB — กรุณาดาวน์โหลดทีละไฟล์`,
    }, { status: 400 });
  }

  // Download files and add to zip
  const zip = new JSZip();

  for (const file of allFiles) {
    const dlRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`,
      { headers: authHeader }
    );
    if (!dlRes.ok) continue;
    const buf = await dlRes.arrayBuffer();
    zip.file(file.path, buf);
  }

  const zipBuffer = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });

  // Upload zip to Base44 storage
  const zipFile = new File([zipBuffer], `${folderName}.zip`, { type: 'application/zip' });
  const uploadResult = await base44.asServiceRole.integrations.Core.UploadFile({ file: zipFile });

  return Response.json({
    success: true,
    file_url: uploadResult.file_url,
    file_name: `${folderName}.zip`,
    file_count: allFiles.length,
    total_size_mb: (totalSize / 1024 / 1024).toFixed(1),
  });
});