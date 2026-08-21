// createTaskFromRequest — staff กดแปลง "คำขอ LINE" เป็น Task พร้อม SLA
import { createClientFromRequest } from '../_shared/base44-compat.ts';
import { convertLineRequestToTask } from '../_shared/requests.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const me = await base44.auth.me();
    if (!me) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { request_id, ack } = await req.json();
    if (!request_id) return Response.json({ error: 'request_id is required' }, { status: 400 });

    const result = await convertLineRequestToTask(base44, request_id, { ack: ack !== false });
    return Response.json({ success: true, ...result });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
});
