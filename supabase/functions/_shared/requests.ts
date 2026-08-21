/**
 * requests.ts — logic แปลง "คำขอจาก LINE" (LineRequest) → Task พร้อม SLA
 * ใช้ร่วมกันโดย createTaskFromRequest (staff กด) และ autoConvertRequests (cron)
 */

// request_type (ตาม entity LineRequest) → ป้าย + ระดับความสำคัญ + statutory
export const REQUEST_META: Record<string, { label: string; statutory: boolean; priority: string; slaKey: string }> = {
  tax_invoice:      { label: 'ออกใบกำกับภาษี',                 statutory: false, priority: 'medium', slaKey: 'request_sla_tax_invoice' },
  withholding_cert: { label: 'หนังสือรับรองหัก ณ ที่จ่าย',      statutory: true,  priority: 'high',   slaKey: 'request_sla_withholding_cert' },
  sso_register:     { label: 'แจ้งเข้าประกันสังคม',            statutory: true,  priority: 'high',   slaKey: 'request_sla_sso_register' },
  sso_terminate:    { label: 'แจ้งออกประกันสังคม',            statutory: true,  priority: 'high',   slaKey: 'request_sla_sso_terminate' },
};

function bangkokToday(): string {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }))
    .toISOString().slice(0, 10);
}

// deno-lint-ignore no-explicit-any
export async function convertLineRequestToTask(base44: any, lineRequestId: string, opts: { ack?: boolean } = {}) {
  const admin = base44.asServiceRole;

  const reqRow = await admin.entities.LineRequest.get(lineRequestId);
  if (!reqRow) throw new Error('ไม่พบคำขอ (LineRequest) นี้');
  if (reqRow.task_id) return { skipped: true, reason: 'มีงานผูกอยู่แล้ว', task_id: reqRow.task_id };
  if (reqRow.status === 'cancelled') return { skipped: true, reason: 'คำขอถูกยกเลิก' };

  const meta = REQUEST_META[reqRow.request_type] ?? { label: reqRow.request_type || 'คำขอ', statutory: false, priority: 'medium', slaKey: '' };

  // SLA — จำนวนวันทำการจาก app_config (default 3)
  let slaDays = 3;
  if (meta.slaKey) {
    const cfg = await admin.entities.AppConfig.filter({ key: meta.slaKey });
    const v = parseInt(cfg?.[0]?.value ?? '', 10);
    if (!isNaN(v) && v > 0) slaDays = v;
  }

  // due_date = วันทำการถัดไป (ข้ามเสาร์-อาทิตย์/วันหยุด) ผ่านฟังก์ชันใน DB
  let dueDate: string | null = null;
  try {
    const { data } = await base44._admin.rpc('next_business_day', { start_date: bangkokToday(), business_days: slaDays });
    dueDate = data as string;
  } catch { dueDate = null; }

  // หาผู้รับผิดชอบจากลูกค้า (primary_officer) ถ้าระบุ customer_id
  let assignedTo = '', assignedName = '';
  if (reqRow.customer_id) {
    try {
      const cust = await admin.entities.Customer.get(reqRow.customer_id);
      assignedTo = cust?.primary_officer || '';
      assignedName = cust?.primary_officer_name || '';
    } catch { /* ลูกค้าไม่พบ — ปล่อยว่างให้ triage มอบหมายเอง */ }
  }

  const who = reqRow.customer_name || reqRow.sender_name || 'ไม่ระบุลูกค้า';
  const task = await admin.entities.Task.create({
    title: `[คำขอ LINE] ${meta.label} — ${who}`,
    description: reqRow.original_message || '',
    customer_id: reqRow.customer_id || '',
    customer_name: reqRow.customer_name || '',
    service_type: meta.label,
    priority: meta.priority,
    status: 'pending',
    due_date: dueDate,
    assigned_to: assignedTo,
    assigned_name: assignedName,
    source: 'line_request',
  });

  await admin.entities.LineRequest.update(lineRequestId, {
    task_id: task.id,
    status: 'in_progress',
    assigned_to: assignedTo || reqRow.assigned_to,
    assigned_name: assignedName || reqRow.assigned_name,
  });

  // แจ้งกลับใน LINE ว่ารับเรื่องแล้ว (ถ้าเปิด)
  if (opts.ack) {
    try {
      await admin.functions.invoke('lineAckRequest', { request_id: lineRequestId, task_id: task.id, due_date: dueDate });
    } catch (e) { console.warn('lineAckRequest failed (non-blocking):', (e as Error).message); }
  }

  return { task_id: task.id, due_date: dueDate, sla_days: slaDays, priority: meta.priority, statutory: meta.statutory };
}
