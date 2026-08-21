// autoConvertRequests — cron: แปลงคำขอ LINE ที่ actionable เป็น Task อัตโนมัติ
// ทำงานเฉพาะเมื่อ app_config request_autoconvert = 'on'
import { createClientFromRequest } from '../_shared/base44-compat.ts';
import { convertLineRequestToTask, REQUEST_META } from '../_shared/requests.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const admin = base44.asServiceRole;

    const cfg = await admin.entities.AppConfig.filter({ key: 'request_autoconvert' });
    if ((cfg?.[0]?.value ?? 'off') !== 'on') {
      return Response.json({ skipped: true, reason: 'auto-convert ปิดอยู่' });
    }

    // คำขอที่รอดำเนินการ ยังไม่มีงานผูก และเป็นประเภทที่รู้จัก (actionable)
    const pending = await admin.entities.LineRequest.filter({ status: 'pending' }, '-created_date', 200);
    const results = [];
    for (const r of pending) {
      if (r.task_id) continue;
      if (!REQUEST_META[r.request_type]) continue; // ข้าม 'other'/ไม่ระบุ → ให้คนคัดแยกเอง
      try {
        const res = await convertLineRequestToTask(base44, r.id, { ack: true });
        results.push({ id: r.id, ...res });
      } catch (e) {
        results.push({ id: r.id, error: (e as Error).message });
      }
    }
    return Response.json({ success: true, converted: results.filter(x => x.task_id).length, total: results.length, results });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
});
