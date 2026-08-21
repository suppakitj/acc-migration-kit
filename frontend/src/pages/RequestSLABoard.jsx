import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Flag, Zap, Clock, AlertTriangle, CheckCircle2, ArrowRightCircle, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useAccessControl } from '../components/auth/useAccessControl';

const TYPE_LABEL = {
  tax_invoice: 'ออกใบกำกับภาษี',
  withholding_cert: 'หนังสือรับรองหัก ณ ที่จ่าย',
  sso_register: 'แจ้งเข้าประกันสังคม',
  sso_terminate: 'แจ้งออกประกันสังคม',
};
const STATUTORY = new Set(['withholding_cert', 'sso_register', 'sso_terminate']);
const SLA_KEYS = {
  tax_invoice: 'request_sla_tax_invoice',
  withholding_cert: 'request_sla_withholding_cert',
  sso_register: 'request_sla_sso_register',
  sso_terminate: 'request_sla_sso_terminate',
};

function ageDays(iso) {
  if (!iso) return 0;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 8.64e7);
}

export default function RequestSLABoard() {
  const qc = useQueryClient();
  const { data: currentUser } = useQuery({ queryKey: ['currentUser'], queryFn: () => base44.auth.me() });
  const ac = useAccessControl(currentUser);
  const isManager = ['admin', 'management', 'manager'].includes(currentUser?.role);

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ['lineRequests', 'sla'],
    queryFn: () => base44.entities.LineRequest.filter({}, '-created_date', 500),
    refetchInterval: 60000,
  });
  const { data: configs = [] } = useQuery({
    queryKey: ['appConfig', 'sla'],
    queryFn: () => base44.entities.AppConfig.list('-created_date', 1000),
  });
  const cfg = useMemo(() => Object.fromEntries(configs.map((c) => [c.key, c.value])), [configs]);
  const autoOn = cfg.request_autoconvert === 'on';

  const convert = useMutation({
    mutationFn: (id) => base44.functions.invoke('createTaskFromRequest', { request_id: id, ack: true }),
    onSuccess: (res) => {
      if (res?.data?.error) { toast.error(res.data.error); return; }
      toast.success('สร้างงานจากคำขอเรียบร้อย');
      qc.invalidateQueries({ queryKey: ['lineRequests'] });
    },
    onError: (e) => toast.error(e.message),
  });

  const runAuto = useMutation({
    mutationFn: () => base44.functions.invoke('autoConvertRequests', {}),
    onSuccess: (res) => {
      const d = res?.data || {};
      toast.success(d.skipped ? 'auto-convert ปิดอยู่' : `แปลงอัตโนมัติ ${d.converted || 0}/${d.total || 0} รายการ`);
      qc.invalidateQueries({ queryKey: ['lineRequests'] });
    },
    onError: (e) => toast.error(e.message),
  });

  const saveConfig = useMutation({
    mutationFn: async ({ key, value }) => {
      const existing = configs.find((c) => c.key === key);
      return existing
        ? base44.entities.AppConfig.update(existing.id, { value })
        : base44.entities.AppConfig.create({ key, value });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['appConfig'] }); toast.success('บันทึกการตั้งค่าแล้ว'); },
    onError: (e) => toast.error(e.message),
  });

  const pending = requests.filter((r) => r.status === 'pending' && !r.task_id);
  const inProgress = requests.filter((r) => r.status === 'in_progress' || r.task_id);
  const statutoryPending = pending.filter((r) => STATUTORY.has(r.request_type)).length;

  const RequestCard = ({ r }) => {
    const overdue = ageDays(r.created_date) >= (parseInt(cfg[SLA_KEYS[r.request_type]] || '3', 10));
    return (
      <div className="border rounded-lg p-3 space-y-2 bg-card">
        <div className="flex items-center justify-between gap-2">
          <Badge variant={STATUTORY.has(r.request_type) ? 'destructive' : 'secondary'} className="text-xs">
            {TYPE_LABEL[r.request_type] || r.request_type}
          </Badge>
          <span className={`text-xs flex items-center gap-1 ${overdue ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
            <Clock className="w-3 h-3" /> {ageDays(r.created_date)} วัน
          </span>
        </div>
        <div className="text-sm font-medium">{r.customer_name || r.sender_name || 'ไม่ระบุลูกค้า'}</div>
        <div className="text-xs text-muted-foreground line-clamp-2">{r.original_message}</div>
        {!r.task_id ? (
          <Button size="sm" className="w-full gap-1.5 text-xs" disabled={convert.isPending}
            onClick={() => convert.mutate(r.id)}>
            {convert.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowRightCircle className="w-3.5 h-3.5" />}
            แปลงเป็นงาน
          </Button>
        ) : (
          <div className="text-xs text-emerald-600 flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" /> สร้างงานแล้ว
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2"><Flag className="w-5 h-5" /> SLA คำขอจาก LINE</h1>
          <p className="text-xs text-muted-foreground">แปลงคำขอเป็นงานพร้อมกำหนดส่งตาม SLA (วันทำการ) — งานตามกฎหมายจัดลำดับความสำคัญสูง</p>
        </div>
        {isManager && (
          <Button size="sm" variant="outline" className="gap-1.5 text-xs self-start" disabled={runAuto.isPending}
            onClick={() => runAuto.mutate()}>
            {runAuto.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
            รันแปลงอัตโนมัติเดี๋ยวนี้
          </Button>
        )}
      </div>

      {/* stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Card><CardContent className="p-4"><div className="text-2xl font-bold">{pending.length}</div><div className="text-xs text-muted-foreground">รอแปลงเป็นงาน</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-2xl font-bold text-destructive">{statutoryPending}</div><div className="text-xs text-muted-foreground">งานตามกฎหมายที่ค้าง</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-2xl font-bold text-emerald-600">{inProgress.length}</div><div className="text-xs text-muted-foreground">แปลงเป็นงานแล้ว</div></CardContent></Card>
      </div>

      {/* admin settings */}
      {isManager && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">ตั้งค่า SLA (วันทำการ) และ auto-convert</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {Object.entries(SLA_KEYS).map(([type, key]) => (
                <div key={key} className="space-y-1">
                  <label className="text-xs text-muted-foreground">{TYPE_LABEL[type]}</label>
                  <Input type="number" min="1" defaultValue={cfg[key] || '3'} className="h-8 text-sm"
                    onBlur={(e) => { if (e.target.value !== (cfg[key] || '3')) saveConfig.mutate({ key, value: e.target.value }); }} />
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 pt-1">
              <Switch checked={autoOn} onCheckedChange={(v) => saveConfig.mutate({ key: 'request_autoconvert', value: v ? 'on' : 'off' })} />
              <span className="text-sm">สร้างงานอัตโนมัติจากคำขอ (statutory) — ทำงานตาม cron</span>
              {autoOn ? <Badge className="text-xs">เปิด</Badge> : <Badge variant="secondary" className="text-xs">ปิด</Badge>}
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <h2 className="text-sm font-semibold mb-2 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4 text-amber-500" /> รอดำเนินการ ({pending.length})</h2>
            <div className="grid gap-2">
              {pending.length === 0 ? <p className="text-xs text-muted-foreground py-4">ไม่มีคำขอค้าง 🎉</p>
                : pending.map((r) => <RequestCard key={r.id} r={r} />)}
            </div>
          </div>
          <div>
            <h2 className="text-sm font-semibold mb-2 flex items-center gap-1.5"><RefreshCw className="w-4 h-4 text-blue-500" /> กำลังดำเนินการ ({inProgress.length})</h2>
            <div className="grid gap-2">
              {inProgress.slice(0, 30).map((r) => <RequestCard key={r.id} r={r} />)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
