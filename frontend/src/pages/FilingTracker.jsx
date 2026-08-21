import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FileCheck2, Download, Loader2, AlertTriangle, Search, Building2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAccessControl } from '../components/auth/useAccessControl';
import TablePagination, { paginateData } from '../components/shared/TablePagination';

const STATUS = {
  pending:      { label: 'รอยื่น',      cls: 'bg-slate-100 text-slate-700' },
  in_progress:  { label: 'กำลังทำ',      cls: 'bg-blue-100 text-blue-700' },
  prepared:     { label: 'เตรียมเสร็จ',   cls: 'bg-indigo-100 text-indigo-700' },
  filed:        { label: 'ยื่นแล้ว',      cls: 'bg-emerald-100 text-emerald-700' },
  accepted:     { label: 'รับแล้ว',       cls: 'bg-green-100 text-green-700' },
  rejected:     { label: 'ถูกปฏิเสธ',     cls: 'bg-red-100 text-red-700' },
  amended:      { label: 'ยื่นเพิ่มเติม',  cls: 'bg-amber-100 text-amber-700' },
  not_required: { label: 'ไม่ต้องยื่น',   cls: 'bg-gray-100 text-gray-500' },
};
const OPEN = ['pending', 'in_progress', 'prepared'];
const AUTH_COLOR = { RD: 'bg-blue-50 text-blue-700', DBD: 'bg-purple-50 text-purple-700', SSO: 'bg-teal-50 text-teal-700' };
const now = new Date();

export default function FilingTracker() {
  const qc = useQueryClient();
  const { data: currentUser } = useQuery({ queryKey: ['currentUser'], queryFn: () => base44.auth.me() });
  const isManager = ['admin', 'management', 'manager'].includes(currentUser?.role);

  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);   // 0 = รายปี
  const [authFilter, setAuthFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('open');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const { data: filings = [], isLoading } = useQuery({
    queryKey: ['filingRecord', year, month],
    queryFn: () => base44.entities.FilingRecord.filter(
      month ? { period_year: year, period_month: month } : { period_year: year }, '-due_date', 5000),
  });

  const gen = useMutation({
    mutationFn: () => base44.functions.invoke('generateFilings', { period_year: year, period_month: month || undefined }),
    onSuccess: (res) => {
      if (res?.data?.error) { toast.error(res.data.error); return; }
      toast.success(`สร้างรายการยื่น ${res.data.created} รายการ (สแกน ${res.data.scanned_customers} ลูกค้า)`);
      qc.invalidateQueries({ queryKey: ['filingRecord'] });
    },
    onError: (e) => toast.error(e.message),
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }) => base44.entities.FilingRecord.update(id, { status }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['filingRecord'] }); },
    onError: (e) => toast.error(e.message),
  });
  const setReceipt = useMutation({
    mutationFn: ({ id, receipt_no }) => base44.entities.FilingRecord.update(id, { receipt_no }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['filingRecord'] }); toast.success('บันทึกเลขรับแล้ว'); },
  });

  const todayStr = new Date().toISOString().slice(0, 10);
  const filtered = useMemo(() => filings.filter((f) => {
    if (authFilter !== 'all' && f.authority !== authFilter) return false;
    if (statusFilter === 'open' && !OPEN.includes(f.status)) return false;
    if (statusFilter !== 'open' && statusFilter !== 'all' && f.status !== statusFilter) return false;
    if (search && !`${f.customer_name} ${f.filing_label} ${f.tax_id}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [filings, authFilter, statusFilter, search]);

  const stats = useMemo(() => ({
    total: filings.length,
    open: filings.filter((f) => OPEN.includes(f.status)).length,
    done: filings.filter((f) => ['filed', 'accepted'].includes(f.status)).length,
    overdue: filings.filter((f) => OPEN.includes(f.status) && f.due_date && f.due_date < todayStr).length,
  }), [filings, todayStr]);

  const exportCsv = () => {
    if (!filtered.length) { toast.error('ไม่มีข้อมูล'); return; }
    const cols = ['customer_name', 'tax_id', 'filing_label', 'authority', 'period_label', 'due_date', 'status', 'filed_date', 'receipt_no', 'assigned_name'];
    const csv = '﻿' + [cols.join(','), ...filtered.map((r) => cols.map((c) => `"${String(r[c] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    a.download = `filings_${month ? `${year}-${month}` : year}.csv`; a.click();
  };

  const pageRows = paginateData(filtered, page, pageSize);
  const years = [now.getFullYear() + 1, now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2];

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2"><FileCheck2 className="w-5 h-5" /> ติดตามสถานะการยื่น (RD / DBD / SSO)</h1>
          <p className="text-xs text-muted-foreground">บันทึกว่ายื่นจริงหรือยัง เลขรับ วันที่ยื่น — เสริมปฏิทินภาษีด้วยสถานะการยื่นจริง</p>
        </div>
        <Button size="sm" variant="outline" className="gap-1.5 text-xs self-start" onClick={exportCsv}>
          <Download className="w-3.5 h-3.5" /> Export CSV
        </Button>
      </div>

      {/* period + generate */}
      <Card>
        <CardContent className="p-4 flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">ปี (ค.ศ.)</label>
            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger className="h-9 w-28"><SelectValue /></SelectTrigger>
              <SelectContent>{years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">งวด</label>
            <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
              <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="0">รายปี (annual)</SelectItem>
                {Array.from({ length: 12 }, (_, i) => <SelectItem key={i + 1} value={String(i + 1)}>เดือน {i + 1}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {isManager && (
            <Button size="sm" className="gap-1.5 text-xs" disabled={gen.isPending} onClick={() => gen.mutate()}>
              {gen.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Building2 className="w-3.5 h-3.5" />}
              สร้างรายการยื่นงวดนี้จากภาระผูกพันลูกค้า
            </Button>
          )}
        </CardContent>
      </Card>

      {/* stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-4"><div className="text-2xl font-bold">{stats.total}</div><div className="text-xs text-muted-foreground">ทั้งหมดในงวด</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-2xl font-bold text-amber-600">{stats.open}</div><div className="text-xs text-muted-foreground">ยังไม่ยื่น</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-2xl font-bold text-emerald-600">{stats.done}</div><div className="text-xs text-muted-foreground">ยื่นแล้ว</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-2xl font-bold text-destructive flex items-center gap-1">{stats.overdue > 0 && <AlertTriangle className="w-5 h-5" />}{stats.overdue}</div><div className="text-xs text-muted-foreground">เกินกำหนด</div></CardContent></Card>
      </div>

      {/* filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
          <Input placeholder="ค้นชื่อลูกค้า / เลขผู้เสียภาษี / ประเภท" className="pl-8 h-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={authFilter} onValueChange={setAuthFilter}>
          <SelectTrigger className="h-9 w-32"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">ทุกหน่วยงาน</SelectItem><SelectItem value="RD">RD</SelectItem><SelectItem value="DBD">DBD</SelectItem><SelectItem value="SSO">SSO</SelectItem></SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="open">ยังไม่ยื่น</SelectItem>
            <SelectItem value="all">ทุกสถานะ</SelectItem>
            {Object.entries(STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ลูกค้า</TableHead><TableHead>ประเภท</TableHead><TableHead>หน่วยงาน</TableHead>
                  <TableHead>งวด</TableHead><TableHead>กำหนดยื่น</TableHead><TableHead>สถานะ</TableHead>
                  <TableHead>เลขรับ</TableHead><TableHead>ผู้รับผิดชอบ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageRows.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-10">ไม่มีข้อมูล — เลือกงวดแล้วกด "สร้างรายการยื่น"</TableCell></TableRow>
                ) : pageRows.map((f) => {
                  const overdue = OPEN.includes(f.status) && f.due_date && f.due_date < todayStr;
                  return (
                    <TableRow key={f.id} className={overdue ? 'bg-red-50/50' : ''}>
                      <TableCell className="font-medium text-sm">{f.customer_name}</TableCell>
                      <TableCell className="text-sm">{f.filing_label || f.filing_type}</TableCell>
                      <TableCell><Badge variant="outline" className={`text-xs ${AUTH_COLOR[f.authority] || ''}`}>{f.authority}</Badge></TableCell>
                      <TableCell className="text-xs">{f.period_label}</TableCell>
                      <TableCell className={`text-xs ${overdue ? 'text-destructive font-medium' : ''}`}>{f.due_date || '—'}</TableCell>
                      <TableCell>
                        <Select value={f.status} onValueChange={(v) => setStatus.mutate({ id: f.id, status: v })}>
                          <SelectTrigger className={`h-7 w-32 text-xs border-0 ${STATUS[f.status]?.cls}`}><SelectValue /></SelectTrigger>
                          <SelectContent>{Object.entries(STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Input defaultValue={f.receipt_no || ''} placeholder="—" className="h-7 w-28 text-xs"
                          onBlur={(e) => { if (e.target.value !== (f.receipt_no || '')) setReceipt.mutate({ id: f.id, receipt_no: e.target.value }); }} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{f.assigned_name || '—'}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <TablePagination totalItems={filtered.length} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
    </div>
  );
}
