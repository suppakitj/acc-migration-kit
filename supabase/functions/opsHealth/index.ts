// opsHealth — สรุปสุขภาพระบบสำหรับ admin: cron, backup, ตัวเลขสำคัญ
import { createClientFromRequest } from '../_shared/base44-compat.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const me = await base44.auth.me();
    if (!me || !['admin', 'management'].includes(me.role)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    const sb = base44._admin;

    // cron (จาก pg_cron ถ้ามี)
    let cron: unknown[] = [];
    try { const { data } = await sb.rpc('ops_cron_summary'); cron = data ?? []; } catch { cron = []; }

    // backup ล่าสุด
    const { data: backups } = await sb.from('ops_backup_log')
      .select('*').order('finished_at', { ascending: false }).limit(10);
    const lastSuccess = (backups ?? []).find((b: { status: string }) => b.status === 'success');
    const hoursSince = lastSuccess
      ? (Date.now() - new Date(lastSuccess.finished_at).getTime()) / 3.6e6 : null;

    // ตัวเลขสำคัญ (head:true → count เท่านั้น ไม่ดึงข้อมูล)
    const count = async (table: string, filter?: (q: any) => any) => {
      let q = sb.from(table).select('*', { count: 'exact', head: true });
      if (filter) q = filter(q);
      const { count: c } = await q; return c ?? 0;
    };
    const todayBkk = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' })).toISOString().slice(0, 10);

    const stats = {
      tasks_pending:     await count('task', (q: any) => q.eq('status', 'pending')),
      line_req_pending:  await count('line_request', (q: any) => q.eq('status', 'pending')),
      filings_pending:   await count('filing_record', (q: any) => q.in('status', ['pending', 'in_progress', 'prepared'])),
      filings_overdue:   await count('filing_record', (q: any) => q.lt('due_date', todayBkk).in('status', ['pending', 'in_progress', 'prepared'])),
    };

    return Response.json({
      generated_at: new Date().toISOString(),
      cron,
      backup: {
        last_success: lastSuccess?.finished_at ?? null,
        hours_since_success: hoursSince != null ? Math.round(hoursSince * 10) / 10 : null,
        fresh: hoursSince != null && hoursSince <= 26,   // ควร backup ทุกวัน
        recent: backups ?? [],
      },
      stats,
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
});
