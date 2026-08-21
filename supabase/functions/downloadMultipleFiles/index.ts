import { createClientFromRequest } from '../_shared/base44-compat.ts';
import JSZip from 'npm:jszip@3.10.1';

const MAX_SIZE = 20 * 1024 * 1024; // 20 MB

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { file_ids } = await req.json();
  if (!file_ids || !Array.isArray(file_ids) || file_ids.length === 0) {
    return Response.json({ error: 'file_ids is required' }, { status: 400 });
  }

  let accessToken;
  try {
    const conn = await base44.asServiceRole.connectors.getConnection('googledrive');
    accessToken = conn.accessToken;
  } catch {
    return Response.json({ error: 'Google Drive not connected' }, { status: 400 });
  }

  const authHeader = { Authorization: `Bearer ${accessToken}` };

  // Get metadata for all files
  const fileMetas = [];
  for (const id of file_ids) {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${id}?fields=id,name,size,mimeType`,
      { headers: authHeader }
    );
    if (res.ok) {
      const meta = await res.json();
      fileMetas.push({ id: meta.id, name: meta.name, size: parseInt(meta.size || '0') });
    }
  }

  if (fileMetas.length === 0) {
    return Response.json({ error: 'ไม่พบไฟล์ที่เลือก' }, { status: 400 });
  }

  const totalSize = fileMetas.reduce((sum, f) => sum + f.size, 0);
  if (totalSize > MAX_SIZE) {
    const sizeMB = (totalSize / 1024 / 1024).toFixed(1);
    return Response.json({
      error: `ขนาดรวม ${sizeMB} MB เกินกำหนด 20 MB — กรุณาเลือกน้อยลง`,
    }, { status: 400 });
  }

  const zip = new JSZip();

  for (const file of fileMetas) {
    const dlRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`,
      { headers: authHeader }
    );
    if (!dlRes.ok) continue;
    const buf = await dlRes.arrayBuffer();
    zip.file(file.name, buf);
  }

  const zipBuffer = await zip.generateAsync({
    type: 'arraybuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  const zipFile = new File([zipBuffer], 'selected_files.zip', { type: 'application/zip' });
  const uploadResult = await base44.asServiceRole.integrations.Core.UploadFile({ file: zipFile });

  return Response.json({
    success: true,
    file_url: uploadResult.file_url,
    file_name: 'selected_files.zip',
    file_count: fileMetas.length,
    total_size_mb: (totalSize / 1024 / 1024).toFixed(1),
  });
});