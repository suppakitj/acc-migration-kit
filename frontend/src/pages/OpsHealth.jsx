import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Activity, Database, ShieldAlert, RefreshCw, CheckCircle2, XCircle, Clock, HardDrive } from 'lucide-react';
import { useAccessControl } from '../components/auth/useAccessControl';

function fmt(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'short' }); }
  catch { return iso; }
}
function bytes(n) {
  if (!n) return '—';
  const u = ['B', 'KB', 'MB', 'GB']; let i = 0; let v = Number(n);
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1)} ${u[i]}`;
}

export default function OpsHealth() {
  const { data: currentUser } = useQuery({ queryKey: ['currentUser'], queryFn: () => base44.auth.me() });
  const isAdmin = ['admin', 'management'].includes(currentUser?.role);

  const { data, isLoading, refetch, isFetching, error } = useQuery({
    queryKey: ['opsHealth'],
    queryFn: async () => {
      const res = await base44.functions.invoke('opsHealth', {});
      if (res?.data?.error) throw new Error(res.data.error);
      return res.data;
    },
    enabled: isAdmin,
    refetchInterval: 60000,
  });

  if (currentUser && !isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <ShieldAlert className="w-12 h-12 text-muted-foreground" />
        <p className="text-muted-foreground">เฉพาะผู้ดูแลระบบเท่านั้น</p>
      </div>
    );
  }

  const backup = data?.backup;
  const cron = data?.cron || [];
  const stats = data?.stats || {};
  const cronFail = cron.filter((c) => c.last_status && c.last_status !== 'succeeded').length;

  const StatCard = ({ label, value, tone }) => (
    <Card><CardContent className="p-4">
      <div className={`text-2xl font-bold ${tone || ''}`}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </CardContent></Card>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2"><Activity className="w-5 h-5" /> สุขภาพระบบ (Ops / Backup)</h1>
          <p className="text-xs text-muted-foreground">สถานะ cron, ความสดของ backup และตัวเลขสำคัญ — self-host ต้องเฝ้าเอง</p>
        </div>
        <Button size="sm" variant="outline" className="gap-1.5 text-xs" disabled={isFetching} onClick={() => refetch()}>
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} /> รีเฟรช
        </Button>
      </div>

      {error && <Card><CardContent className="p-4 text-sm text-destructive">โหลดข้อมูลไม่ได้: {error.message}</CardContent></Card>}

      {/* backup freshness */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Card className={backup?.fresh ? 'border-emerald-300' : 'border-red-300'}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              {backup?.fresh ? <CheckCircle2 className="w-5 h-5 text-emerald-600" /> : <XCircle className="w-5 h-5 text-destructive" />}
              <div className="text-sm font-semibold">{backup?.fresh ? 'Backup สดใหม่' : 'Backup ค้าง/ไม่มี'}</div>
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              ล่าสุดสำเร็จ: {fmt(backup?.last_success)}
              {backup?.hours_since_success != null && ` (${backup.hours_since_success} ชม.ที่แล้ว)`}
            </div>
          </CardContent>
        </Card>
        <StatCard label="cron ที่ล้มเหลวล่าสุด" value={cronFail} tone={cronFail ? 'text-destructive' : 'text-emerald-600'} />
        <StatCard label="งานค้าง (pending)" value={stats.tasks_pending ?? '—'} />
        <StatCard label="ยื่นเกินกำหนด" value={stats.filings_overdue ?? '—'} tone={stats.filings_overdue ? 'text-destructive' : ''} />
      </div>

      {/* cron table */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-1.5"><Clock className="w-4 h-4" /> Scheduled jobs (pg_cron)</CardTitle></CardHeader>
        <CardContent className="p-0">
          {isLoading ? <div className="p-6 text-center text-muted-foreground text-sm">กำลังโหลด…</div>
            : cron.length === 0 ? <div className="p-6 text-center text-muted-foreground text-sm">ยังไม่มีข้อมูล cron (ตรวจว่า pg_cron ติดตั้งและรัน 06_cron.sql แล้ว)</div>
            : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Job</TableHead><TableHead>ตาราง (UTC)</TableHead><TableHead>สถานะล่าสุด</TableHead><TableHead>รันล่าสุด</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {cron.map((c) => (
                  <TableRow key={c.jobname}>
                    <TableCell className="text-sm font-medium">{c.jobname}</TableCell>
                    <TableCell className="text-xs font-mono">{c.schedule}</TableCell>
                    <TableCell>
                      {!c.last_status ? <Badge variant="secondary" className="text-xs">ยังไม่รัน</Badge>
                        : c.last_status === 'succeeded' ? <Badge className="text-xs bg-emerald-100 text-emerald-700">succeeded</Badge>
                        : <Badge variant="destructive" className="text-xs">{c.last_status}</Badge>}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{fmt(c.last_start)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* recent backups */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-1.5"><HardDrive className="w-4 h-4" /> ประวัติ backup ล่าสุด</CardTitle></CardHeader>
        <CardContent className="p-0">
          {(backup?.recent?.length ?? 0) === 0 ? <div className="p-6 text-center text-muted-foreground text-sm">ยังไม่มีบันทึก backup (ตั้ง cron ให้ infra/backup.sh เขียน ops_backup_log)</div>
            : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>ประเภท</TableHead><TableHead>สถานะ</TableHead><TableHead>เสร็จเมื่อ</TableHead><TableHead>ขนาด</TableHead><TableHead>ปลายทาง</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {backup.recent.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="text-xs"><Badge variant="outline" className="text-xs">{b.kind}</Badge></TableCell>
                    <TableCell>{b.status === 'success' ? <Badge className="text-xs bg-emerald-100 text-emerald-700">success</Badge> : <Badge variant="destructive" className="text-xs">failed</Badge>}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{fmt(b.finished_at)}</TableCell>
                    <TableCell className="text-xs">{bytes(b.size_bytes)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground truncate max-w-[200px]">{b.location || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatCard label="คำขอ LINE รอคัดแยก" value={stats.line_req_pending ?? '—'} />
        <StatCard label="รายการยื่นค้าง" value={stats.filings_pending ?? '—'} />
        <StatCard label="อัปเดตล่าสุด" value={data ? fmt(data.generated_at) : '—'} />
      </div>
    </div>
  );
}
