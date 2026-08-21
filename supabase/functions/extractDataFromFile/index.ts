// extractDataFromFile — แทน base44.integrations.Core.ExtractDataFromUploadedFile
// รับ { file_url, json_schema } → ดึงไฟล์ → ส่งเข้า Claude → คืน { status, output }
// รองรับ: PDF/รูป (ส่งเป็น document/image), CSV/ข้อความ (ส่งเป็น text),
//         XLSX (แปลงเป็น CSV ด้วย SheetJS ก่อน)
import { callClaude } from '../_shared/anthropic.ts';
import { requireUser } from '../_shared/auth.ts';
import * as XLSX from 'npm:xlsx@0.18.5';

function b64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CH));
  }
  return btoa(bin);
}

Deno.serve(async (req) => {
  try {
    const me = await requireUser(req);
    if (!me) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { file_url, json_schema } = await req.json();
    if (!file_url) return Response.json({ error: 'file_url is required' }, { status: 400 });

    const fileRes = await fetch(file_url);
    if (!fileRes.ok) throw new Error(`โหลดไฟล์ไม่สำเร็จ: ${fileRes.status}`);
    const ct = (fileRes.headers.get('content-type') || '').toLowerCase();
    const buf = await fileRes.arrayBuffer();
    const lower = file_url.split('?')[0].toLowerCase();

    const prompt =
      'ดึงข้อมูลจากไฟล์นี้ให้ตรงกับ schema ที่กำหนด ' +
      'ถ้าเป็นตาราง ให้คืนทุกแถวเป็น array ตาม schema โดยไม่เพิ่ม/ตัดข้อมูล';

    let output: unknown;

    if (ct.includes('pdf') || lower.endsWith('.pdf')) {
      output = await callClaude({
        prompt, json_schema,
        content: [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64(buf) } }],
      });
    } else if (ct.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/.test(lower)) {
      const mt = ct.startsWith('image/') ? ct : 'image/png';
      output = await callClaude({
        prompt, json_schema,
        content: [{ type: 'image', source: { type: 'base64', media_type: mt, data: b64(buf) } }],
      });
    } else if (/\.(xlsx|xls)$/.test(lower) || ct.includes('spreadsheet') || ct.includes('excel')) {
      const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
      const csv = wb.SheetNames.map((n: string) =>
        `# ชีต: ${n}\n` + XLSX.utils.sheet_to_csv(wb.Sheets[n])).join('\n\n');
      output = await callClaude({ prompt: `${prompt}\n\nข้อมูลในไฟล์ (CSV):\n${csv}`, json_schema });
    } else {
      const text = new TextDecoder().decode(buf);
      output = await callClaude({ prompt: `${prompt}\n\nข้อมูลในไฟล์:\n${text}`, json_schema });
    }

    // Base44 คืน { status, output } และโค้ด frontend อ่าน res.output
    return Response.json({ status: 'success', output });
  } catch (e) {
    return Response.json({ status: 'error', details: (e as Error).message }, { status: 500 });
  }
});
