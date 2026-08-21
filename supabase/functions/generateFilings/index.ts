// generateFilings — สร้างรายการยื่น (filing_record) ตามงวด จากภาระผูกพันของลูกค้า
//  period_month มีค่า → งวดรายเดือน (pnd1/3/53/pp30/sso ...)
//  period_month ว่าง  → งวดรายปี (pnd50/51, dbd_filing, disclosure_form, boj5 ...)
import { createClientFromRequest } from '../_shared/base44-compat.ts';

// obligation code (Customer.obligations) → filing type/authority/category/cadence
const OBLIGATION_MAP: Record<string, { ft: string; auth: string; cat: string; monthly: boolean; label: string }> = {
  pnd1_monthly:    { ft: 'pnd1',  auth: 'RD',  cat: 'withholding_tax', monthly: true,  label: 'ภ.ง.ด.1' },
  pnd3_monthly:    { ft: 'pnd3',  auth: 'RD',  cat: 'withholding_tax', monthly: true,  label: 'ภ.ง.ด.3' },
  pnd53_monthly:   { ft: 'pnd53', auth: 'RD',  cat: 'withholding_tax', monthly: true,  label: 'ภ.ง.ด.53' },
  pnd54_monthly:   { ft: 'pnd54', auth: 'RD',  cat: 'withholding_tax', monthly: true,  label: 'ภ.ง.ด.54' },
  pp30_monthly:    { ft: 'pp30',  auth: 'RD',  cat: 'vat',             monthly: true,  label: 'ภ.พ.30' },
  pp36_monthly:    { ft: 'pp36',  auth: 'RD',  cat: 'vat',             monthly: true,  label: 'ภ.พ.36' },
  sso_monthly:     { ft: 'sso',   auth: 'SSO', cat: 'sso',             monthly: true,  label: 'ประกันสังคม' },
  pnd1k_yearly:    { ft: 'pnd1k', auth: 'RD',  cat: 'withholding_tax', monthly: false, label: 'ภ.ง.ด.1ก' },
  pnd90_director:  { ft: 'pnd90', auth: 'RD',  cat: 'annual_cit',      monthly: false, label: 'ภ.ง.ด.90' },
  pnd91_director:  { ft: 'pnd91', auth: 'RD',  cat: 'annual_cit',      monthly: false, label: 'ภ.ง.ด.91' },
  pnd50_half:      { ft: 'pnd51', auth: 'RD',  cat: 'annual_cit',      monthly: false, label: 'ภ.ง.ด.51 (ครึ่งปี)' },
  pnd50_annual:    { ft: 'pnd50', auth: 'RD',  cat: 'annual_cit',      monthly: false, label: 'ภ.ง.ด.50' },
  audit_annual:    { ft: 'audit', auth: 'DBD', cat: 'annual_filing',   monthly: false, label: 'ตรวจสอบบัญชีประจำปี' },
  dbd_filing:      { ft: 'dbd_filing',    auth: 'DBD', cat: 'annual_filing', monthly: false, label: 'นำส่งงบการเงิน (DBD)' },
  disclosure_form: { ft: 'disclosure_form', auth: 'DBD', cat: 'annual_filing', monthly: false, label: 'แบบนำส่งงบ (สบช.3)' },
  boj5_annual:     { ft: 'boj5',  auth: 'DBD', cat: 'annual_filing',   monthly: false, label: 'บอจ.5' },
};

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const me = await base44.auth.me();
    if (!me || !['admin', 'management', 'manager'].includes(me.role)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    const admin = base44.asServiceRole;

    const { period_year, period_month, customer_ids } = await req.json();
    if (!period_year) return Response.json({ error: 'period_year is required' }, { status: 400 });
    const wantMonthly = !!period_month;
    const periodLabel = wantMonthly ? `${period_year}-${String(period_month).padStart(2, '0')}` : String(period_year);

    // deadline map ของงวดนี้ (ไว้เติม due_date)
    const dlFilter: Record<string, unknown> = { for_year: period_year, status: 'active' };
    if (wantMonthly) dlFilter.for_month = period_month;
    const deadlines = await admin.entities.TaxDeadline.filter(dlFilter, '-deadline', 500);
    const dlByType: Record<string, string> = {};
    for (const d of deadlines) if (d.tax_type && d.deadline && !dlByType[d.tax_type]) dlByType[d.tax_type] = d.deadline;

    // ลูกค้า active
    let customers = await admin.entities.Customer.filter({ status: 'active' }, '-created_date', 5000);
    if (Array.isArray(customer_ids) && customer_ids.length) {
      const set = new Set(customer_ids);
      customers = customers.filter((c: { id: string }) => set.has(c.id));
    }

    // กันซ้ำ: โหลด filing ของงวดนี้ที่มีอยู่แล้ว
    const existing = await admin.entities.FilingRecord.filter(
      wantMonthly ? { period_year, period_month } : { period_year }, '-created_date', 10000);
    const seen = new Set(existing.map((f: { customer_id: string; filing_type: string }) => `${f.customer_id}|${f.filing_type}`));

    const rows = [];
    for (const c of customers) {
      const obligations: string[] = Array.isArray(c.obligations) ? c.obligations : [];
      for (const ob of obligations) {
        const m = OBLIGATION_MAP[ob];
        if (!m) continue;
        if (m.monthly !== wantMonthly) continue;         // ตรง cadence กับงวดที่ขอ
        if (seen.has(`${c.id}|${m.ft}`)) continue;         // มีอยู่แล้ว
        rows.push({
          customer_id: c.id, customer_name: c.company_name || c.customer_code || '', tax_id: c.tax_id || '',
          filing_type: m.ft, filing_label: m.label, authority: m.auth, category: m.cat,
          period_month: wantMonthly ? period_month : null, period_year, period_label: periodLabel,
          due_date: dlByType[m.ft] || null, status: 'pending',
          assigned_to: c.primary_officer || '', assigned_name: c.primary_officer_name || '',
        });
        seen.add(`${c.id}|${m.ft}`);
      }
    }

    let created = 0;
    if (rows.length) {
      const res = await admin.entities.FilingRecord.bulkCreate(rows);
      created = res.length;
    }
    return Response.json({ success: true, created, scanned_customers: customers.length, period: periodLabel });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
});
