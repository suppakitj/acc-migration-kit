import { createClientFromRequest } from '../_shared/base44-compat.ts';

const TAX_RULES = [
  { type: 'pnd1',  label: 'ภ.ง.ด.1',    category: 'withholding_tax', onlineDay: 15 },
  { type: 'pnd2',  label: 'ภ.ง.ด.2',    category: 'withholding_tax', onlineDay: 15 },
  { type: 'pnd3',  label: 'ภ.ง.ด.3',    category: 'withholding_tax', onlineDay: 15 },
  { type: 'pnd53', label: 'ภ.ง.ด.53',   category: 'withholding_tax', onlineDay: 15 },
  { type: 'pnd54', label: 'ภ.ง.ด.54',   category: 'withholding_tax', onlineDay: 15 },
  { type: 'pp36',  label: 'ภ.พ.36',     category: 'vat',             onlineDay: 15 },
  { type: 'pp30',  label: 'ภ.พ.30',     category: 'vat',             onlineDay: 23 },
  { type: 'pt40',  label: 'ภ.ธ.40',     category: 'sbt',             onlineDay: 23 },
  { type: 'sso',   label: 'ประกันสังคม', category: 'sso',             onlineDay: 25 },
];

const ANNUAL_RULES = [
  // ── ภาษีเงินได้บุคคลธรรมดา ──
  {
    type: 'pnd90',
    label: 'ภ.ง.ด.90 (บุคคลธรรมดา-มีรายได้อื่น)',
    category: 'annual_cit',
    calcDeadline: (fiscalYear) => {
      return { filingYear: fiscalYear + 1, month: 4, day: 8 };
    },
  },
  {
    type: 'pnd91',
    label: 'ภ.ง.ด.91 (เงินเดือนอย่างเดียว)',
    category: 'annual_cit',
    calcDeadline: (fiscalYear) => {
      return { filingYear: fiscalYear + 1, month: 4, day: 8 };
    },
  },
  {
    type: 'pnd95',
    label: 'ภ.ง.ด.95',
    category: 'annual_cit',
    calcDeadline: (fiscalYear) => {
      return { filingYear: fiscalYear + 1, month: 4, day: 8 };
    },
  },
  {
    type: 'pnd94',
    label: 'ภ.ง.ด.94 (ครึ่งปีบุคคลธรรมดา)',
    category: 'annual_cit',
    calcDeadline: (fiscalYear) => {
      return { filingYear: fiscalYear + 1, month: 10, day: 8 };
    },
  },
  // ── ภาษีเงินได้นิติบุคคล ──
  {
    type: 'pnd50',
    label: 'ภ.ง.ด.50 (นิติบุคคลประจำปี)',
    category: 'annual_cit',
    calcDeadline: (fiscalYear) => {
      const yearEnd = new Date(fiscalYear, 11, 31);
      const deadline = new Date(yearEnd);
      deadline.setDate(deadline.getDate() + 158);
      return { filingYear: deadline.getFullYear(), month: deadline.getMonth() + 1, day: deadline.getDate() };
    },
  },
  {
    type: 'pnd51',
    label: 'ภ.ง.ด.51 (นิติบุคคลครึ่งปี)',
    category: 'annual_cit',
    calcDeadline: (fiscalYear) => {
      const halfYear = new Date(fiscalYear + 1, 5, 30);
      const deadline = new Date(halfYear);
      deadline.setMonth(deadline.getMonth() + 2);
      deadline.setDate(deadline.getDate() + 8);
      return { filingYear: deadline.getFullYear(), month: deadline.getMonth() + 1, day: deadline.getDate() };
    },
  },
  // ── สรุปหัก ณ ที่จ่ายสิ้นปี ──
  {
    type: 'pnd1k',
    label: 'ภ.ง.ด.1ก (สรุปสิ้นปี)',
    category: 'annual_filing',
    calcDeadline: (fiscalYear) => {
      return { filingYear: fiscalYear + 1, month: 3, day: 8 };
    },
  },
  // ── งานยื่นรายปี ──
  {
    type: 'disclosure_form',
    label: 'Disclosure Form (สบช.3)',
    category: 'annual_filing',
    calcDeadline: (fiscalYear) => {
      const yearEnd = new Date(fiscalYear, 11, 31);
      const deadline = new Date(yearEnd);
      deadline.setDate(deadline.getDate() + 158);
      return { filingYear: deadline.getFullYear(), month: deadline.getMonth() + 1, day: deadline.getDate() };
    },
  },
  {
    type: 'dbd_filing',
    label: 'ยื่นงบ DBD',
    category: 'annual_filing',
    calcDeadline: (fiscalYear) => {
      return { filingYear: fiscalYear + 1, month: 5, day: 31 };
    },
  },
  {
    type: 'boj5',
    label: 'บอจ.5 (บัญชีผู้ถือหุ้น)',
    category: 'annual_filing',
    calcDeadline: (fiscalYear) => {
      return { filingYear: fiscalYear + 1, month: 5, day: 14 };
    },
  },
];

function formatDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function getHolidayDates(base44, year) {
  const holidays = await base44.asServiceRole.entities.HolidayMaster.filter(
    { year, status: 'active' }, 'date', 500
  );
  return new Set(holidays.map(h => h.date));
}

function isNonWorkday(dateStr, holidaySet) {
  const d = new Date(dateStr + 'T00:00:00');
  const dayOfWeek = d.getDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) return true;
  if (holidaySet.has(dateStr)) return true;
  return false;
}

function getShiftReason(dateStr, holidaySet) {
  const d = new Date(dateStr + 'T00:00:00');
  const dayOfWeek = d.getDay();
  if (dayOfWeek === 6) return 'ตรงวันเสาร์';
  if (dayOfWeek === 0) return 'ตรงวันอาทิตย์';
  if (holidaySet.has(dateStr)) return 'ตรงวันหยุดราชการ';
  return '';
}

function shiftToNextWorkday(dateStr, holidaySet) {
  let current = new Date(dateStr + 'T00:00:00');
  let shifted = false;
  const reasons = [];
  while (isNonWorkday(formatDateStr(current), holidaySet)) {
    const reason = getShiftReason(formatDateStr(current), holidaySet);
    if (reason && !reasons.includes(reason)) reasons.push(reason);
    current.setDate(current.getDate() + 1);
    shifted = true;
  }
  return { date: formatDateStr(current), shifted, reason: reasons.join(', ') };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (!['admin', 'management', 'manager'].includes(user.role)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { target_year, dry_run = false } = await req.json();
    if (!target_year) return Response.json({ error: 'target_year is required' }, { status: 400 });

    const year = parseInt(target_year);

    // ดึงวันหยุดของปีนี้ + ปีถัดไป (deadline ธ.ค. ตกไป ม.ค. ปีถัดไป)
    const holidaysThisYear = await getHolidayDates(base44, year);
    const holidaysNextYear = await getHolidayDates(base44, year + 1);
    const allHolidays = new Set([...holidaysThisYear, ...holidaysNextYear]);

    // เช็ค deadlines ที่มีแล้ว — ไม่สร้างซ้ำ
    const existing = await base44.asServiceRole.entities.TaxDeadline.filter(
      { for_year: year }, '-created_date', 500
    );
    const existingKeys = new Set(existing.map(e => `${e.tax_type}_${e.for_month}_${e.for_year}`));

    const preview = [];
    const created = [];
    let skippedDuplicate = 0;

    for (let month = 1; month <= 12; month++) {
      for (const rule of TAX_RULES) {
        const dedupKey = `${rule.type}_${month}_${year}`;
        if (existingKeys.has(dedupKey)) { skippedDuplicate++; continue; }

        // เดือนที่ต้องยื่น = เดือนถัดไป
        const filingMonth = month === 12 ? 1 : month + 1;
        const filingYear = month === 12 ? year + 1 : year;
        const filingMonthStr = String(filingMonth).padStart(2, '0');

        // คำนวณ deadline ออนไลน์
        const onlineDay = Math.min(rule.onlineDay, 28);
        const rawDate = `${filingYear}-${filingMonthStr}-${String(onlineDay).padStart(2, '0')}`;
        const result = shiftToNextWorkday(rawDate, allHolidays);

        const record = {
          tax_type: rule.type,
          tax_label: rule.label,
          for_month: month,
          for_year: year,
          deadline: result.date,
          original_day: rule.onlineDay,
          was_shifted: result.shifted,
          shift_reason: result.shifted ? result.reason : '',
          category: rule.category,
          status: 'active',
          generated_by: user.email,
        };

        preview.push(record);
        if (!dry_run) {
          const c = await base44.asServiceRole.entities.TaxDeadline.create(record);
          created.push(c);
          existingKeys.add(dedupKey);
        }
      }
    }

    // ── Generate annual deadlines ──
    // งานรายปีของสิ้นรอบปี year-1 → deadline ตกในปี year
    const fiscalYearEnd = year - 1;
    for (const rule of ANNUAL_RULES) {
      const dedupKey = `${rule.type}_0_${year}`;
      if (existingKeys.has(dedupKey)) { skippedDuplicate++; continue; }

      const calc = rule.calcDeadline(fiscalYearEnd);
      let actualDate;
      if (calc.day > 28) {
        const testDate = new Date(calc.filingYear, calc.month - 1, calc.day);
        actualDate = formatDateStr(testDate);
      } else {
        actualDate = `${calc.filingYear}-${String(calc.month).padStart(2, '0')}-${String(calc.day).padStart(2, '0')}`;
      }

      const result = shiftToNextWorkday(actualDate, allHolidays);

      const record = {
        tax_type: rule.type,
        tax_label: rule.label,
        for_month: 0,
        for_year: year,
        deadline: result.date,
        original_day: calc.day,
        was_shifted: result.shifted,
        shift_reason: result.shifted ? result.reason : '',
        category: rule.category,
        status: 'active',
        generated_by: user.email,
        notes: `งานรายปี — สิ้นรอบ 31 ธ.ค. ${fiscalYearEnd}`,
      };

      preview.push(record);
      if (!dry_run) {
        const c = await base44.asServiceRole.entities.TaxDeadline.create(record);
        created.push(c);
        existingKeys.add(dedupKey);
      }
    }

    console.log(`Generate tax deadlines for ${year}: ${preview.length} generated, ${skippedDuplicate} duplicates skipped`);

    return Response.json({
      target_year: year,
      dry_run,
      total_generated: preview.length,
      skipped_duplicate: skippedDuplicate,
      tax_types: TAX_RULES.length + ANNUAL_RULES.length,
      deadlines: dry_run ? preview : created,
      generated_by: user.full_name || user.email,
    });
  } catch (error) {
    console.error('Generate tax deadlines error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});