import { createClientFromRequest } from '../_shared/base44-compat.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { filing_id } = await req.json();
    if (!filing_id) return Response.json({ error: 'filing_id required' }, { status: 400 });

    const svc = base44.asServiceRole;

    // ─── Load filing ───
    const filings = await svc.entities.TaxQA_Filing.filter({ id: filing_id });
    const filing = filings[0];
    if (!filing) return Response.json({ error: 'Filing not found' }, { status: 404 });

    // ─── Load config ───
    const [globalRules, keywordMaps, whtRates, lineItems] = await Promise.all([
      svc.entities.TaxQA_ValidationRule.filter({ rule_code: 'GLOBAL_PARAMS' }),
      svc.entities.TaxQA_IncomeKeywordMap.filter({}, 'keyword', 200),
      svc.entities.TaxQA_WhtRateTable.filter({ active: true }, 'income_type', 200),
      svc.entities.TaxQA_LineItem.filter({ filing_id }, 'seq_in_file', 2000),
    ]);

    const params = globalRules[0]?.parameters || {};
    const tolerance = params.amount_tolerance ?? 1;
    const juristicPrefix = params.juristic_tax_id_prefix || '0';
    const carryMonths = params.input_vat_carryforward_months ?? 6;
    const vatRate = params.vat_rate ?? 7;

    // ─── Clear old VAL_ open flags (keep INGEST_ and overridden) ───
    const oldFlags = await svc.entities.TaxQA_ExceptionFlag.filter({ filing_id }, '-created_date', 500);
    for (const f of oldFlags) {
      if (f.status === 'open' && f.rule_code.startsWith('VAL_')) {
        await svc.entities.TaxQA_ExceptionFlag.delete(f.id);
      }
    }
    // Count remaining open flags (INGEST_ etc)
    const remainingOpenFlags = oldFlags.filter(f => f.status === 'open' && !f.rule_code.startsWith('VAL_'));

    const flags = [];
    const addFlag = (rule_code, severity, message, line_item_id) => {
      flags.push({ filing_id, rule_code, severity, message, line_item_id: line_item_id || null, status: 'open' });
    };

    const formType = filing.form_type;
    const isWht = ['PND1', 'PND3', 'PND53', 'PND54'].includes(formType);
    const isVat = formType === 'PP30';

    // ═══════════════════════════════════════════════════
    // STRUCTURAL (all forms): Tax ID checksum mod-11
    // ═══════════════════════════════════════════════════
    const checkTaxId = (taxId) => {
      if (!taxId) return true; // skip empty
      const digits = taxId.replace(/\D/g, '');
      if (digits.length !== 13) return true; // skip non-13
      let sum = 0;
      for (let i = 0; i < 12; i++) sum += parseInt(digits[i]) * (13 - i);
      const check = (11 - (sum % 11)) % 10;
      return check === parseInt(digits[12]);
    };

    for (const li of lineItems) {
      const taxId = isWht ? li.payee_tax_id : li.counterparty_tax_id;
      if (taxId && taxId.replace(/\D/g, '').length === 13 && !checkTaxId(taxId)) {
        addFlag('VAL_TAXID', 'error',
          `บรรทัด #${li.seq_in_file}: เลขผู้เสียภาษี "${taxId}" ไม่ผ่าน checksum (mod-11)`, li.id);
      }
    }

    // ═══════════════════════════════════════════════════
    // WHT: calculation check per line
    // ═══════════════════════════════════════════════════
    if (isWht && formType !== 'PND1') {
      for (const li of lineItems) {
        if (li.tax_base && li.wht_rate != null) {
          const expected = li.tax_base * li.wht_rate / 100;
          const diff = Math.abs(expected - (li.wht_amount || 0));
          if (diff > tolerance) {
            addFlag('VAL_CALC', 'error',
              `บรรทัด #${li.seq_in_file}: tax_base(${li.tax_base}) × rate(${li.wht_rate}%) = ${expected.toFixed(2)} แต่ wht_amount = ${li.wht_amount} (ต่าง ${diff.toFixed(2)})`, li.id);
          }
        }
      }
    }

    // ═══════════════════════════════════════════════════
    // WHT: sum check
    // ═══════════════════════════════════════════════════
    if (isWht && filing.header_total_tax != null) {
      const sumWht = lineItems.reduce((s, li) => s + (li.wht_amount || 0), 0);
      const roundedSum = Math.round(sumWht * 100) / 100;
      const diff = Math.abs(roundedSum - filing.header_total_tax);
      if (diff > tolerance) {
        addFlag('VAL_SUM', 'error',
          `ผลรวม wht_amount (${roundedSum.toFixed(2)}) ไม่ตรงกับ header_total_tax (${filing.header_total_tax}) — ต่าง ${diff.toFixed(2)}`);
      }
    }

    // ═══════════════════════════════════════════════════
    // Deadline check
    // ═══════════════════════════════════════════════════
    if (filing.tax_deadline_id && filing.status !== 'filed') {
      const deadlines = await svc.entities.TaxDeadline.filter({ id: filing.tax_deadline_id });
      if (deadlines[0]) {
        const dl = new Date(deadlines[0].deadline);
        const today = new Date();
        const daysLeft = Math.ceil((dl - today) / 86400000);
        if (daysLeft < 0) {
          addFlag('VAL_DEADLINE', 'warning', `กำหนดยื่น ${deadlines[0].deadline} เลยมาแล้ว ${Math.abs(daysLeft)} วัน`);
        } else if (daysLeft <= 3) {
          addFlag('VAL_DEADLINE', 'warning', `กำหนดยื่น ${deadlines[0].deadline} เหลืออีก ${daysLeft} วัน`);
        }
      }
    }

    // ═══════════════════════════════════════════════════
    // RATE checks (PND3/PND53)
    // ═══════════════════════════════════════════════════
    if (formType === 'PND3' || formType === 'PND53') {
      for (const li of lineItems) {
        const desc = (li.income_desc || '').toLowerCase();

        // Rate via keyword map
        let matched = false;
        for (const km of keywordMaps) {
          if (desc.includes(km.keyword.toLowerCase())) {
            matched = true;
            if (Math.abs(li.wht_rate - km.expected_rate) > 0.001) {
              addFlag('VAL_RATE', 'error',
                `บรรทัด #${li.seq_in_file} "${li.income_desc}": อัตรา ${li.wht_rate}% ไม่ตรงมาตรฐาน ${km.expected_rate}% (keyword "${km.keyword}")`, li.id);
            }
            break;
          }
        }
        if (!matched && desc.trim()) {
          addFlag('VAL_RATE_UNKNOWN', 'warning',
            `บรรทัด #${li.seq_in_file} "${li.income_desc}": ระบุประเภทเงินได้ไม่ได้จาก keyword — ตรวจมือ`, li.id);
        }

        // Payee type vs form type
        const payeeTaxId = (li.payee_tax_id || '').replace(/\D/g, '');
        if (payeeTaxId.length === 13) {
          const isJuristic = payeeTaxId[0] === juristicPrefix;
          if (isJuristic && formType === 'PND3') {
            addFlag('VAL_PAYEE_TYPE', 'error',
              `บรรทัด #${li.seq_in_file} "${li.payee_name}" เลข "${li.payee_tax_id}" ขึ้นต้น 0 (นิติบุคคล) ควรอยู่ ภงด.53 ไม่ใช่ ภงด.3`, li.id);
          }
          if (!isJuristic && formType === 'PND53') {
            addFlag('VAL_PAYEE_TYPE', 'error',
              `บรรทัด #${li.seq_in_file} "${li.payee_name}" เลข "${li.payee_tax_id}" ขึ้นต้น ${payeeTaxId[0]} (บุคคลธรรมดา) ควรอยู่ ภงด.3 ไม่ใช่ ภงด.53`, li.id);
          }
        }
      }
    }

    // ═══════════════════════════════════════════════════
    // PND54 — DTA warning per line
    // ═══════════════════════════════════════════════════
    if (formType === 'PND54') {
      for (const li of lineItems) {
        addFlag('VAL_DTA', 'warning',
          `บรรทัด #${li.seq_in_file}: ตรวจอัตราตาม DTA รายประเทศ`, li.id);
      }
    }

    // ═══════════════════════════════════════════════════
    // PND1 — structural only + manual warning
    // ═══════════════════════════════════════════════════
    if (formType === 'PND1') {
      addFlag('VAL_PND1_MANUAL', 'warning',
        'ภาษีเงินเดือนขั้นบันได นอกขอบเขต v1 ตรวจมือ');
    }

    // ═══════════════════════════════════════════════════
    // CROSS-FILING DUPLICATE: cert_no (WTI) ซ้ำกับ filing อื่น
    // ═══════════════════════════════════════════════════
    if (isWht && formType !== 'PND1') {
      // Collect unique cert_no from this filing
      const certNos = [...new Set(lineItems.map(li => li.cert_no).filter(Boolean))];
      if (certNos.length > 0) {
        // Find other filings of same customer + tax_period (exclude current + rejected)
        const otherFilings = await svc.entities.TaxQA_Filing.filter({
          customer_id: filing.customer_id, tax_period: filing.tax_period, form_type: formType,
        }, '-created_date', 50);
        const excludeStatuses = ['rejected', 'superseded', 'cancelled'];
        const otherFilingIds = otherFilings
          .filter(f => f.id !== filing_id && !excludeStatuses.includes(f.status))
          .map(f => f.id);

        if (otherFilingIds.length > 0) {
          // Load line items from other filings in batches
          const otherCertNos = new Set();
          for (const ofId of otherFilingIds) {
            const otherLines = await svc.entities.TaxQA_LineItem.filter({ filing_id: ofId }, 'seq_in_file', 2000);
            for (const ol of otherLines) {
              if (ol.cert_no) otherCertNos.add(ol.cert_no);
            }
          }

          // Check for overlap
          for (const cn of certNos) {
            if (otherCertNos.has(cn)) {
              addFlag('VAL_DUP_CROSS', 'warning',
                `WTI ${cn} เคยถูกบันทึกในไฟล์/ใบอื่นของงวดนี้ อาจอัปโหลดหรือนับซ้ำ`);
            }
          }
        }
      }
    }

    // ═══════════════════════════════════════════════════
    // CROSS-FORM: PND54 ↔ PP36
    // ═══════════════════════════════════════════════════
    if (formType === 'PND54') {
      const pp36 = await svc.entities.TaxQA_Filing.filter({
        customer_id: filing.customer_id, tax_period: filing.tax_period, form_type: 'PP36'
      });
      if (pp36.length === 0) {
        addFlag('VAL_MISSING_PP36', 'error',
          `มี ภงด.54 งวด ${filing.tax_period} แต่ยังไม่มี ภ.พ.36 — ต้องยื่นคู่กัน`);
      }
    }

    // ═══════════════════════════════════════════════════
    // PP30 RULES
    // ═══════════════════════════════════════════════════
    if (isVat) {
      const hasOutput = lineItems.some(l => l.vat_direction === 'output');
      const hasInput = lineItems.some(l => l.vat_direction === 'input');

      // Incomplete check — only one direction
      if (!hasOutput || !hasInput) {
        const missing = !hasOutput ? 'ภาษีขาย' : 'ภาษีซื้อ';
        addFlag('VAL_PP30_INCOMPLETE', 'warning',
          `ยังขาดไฟล์${missing}อีกด้าน — PP30 ยังไม่ครบ`);
      }

      // VAT calc per line: |vat_amount - vat7_base × vatRate/100| > tolerance
      for (const li of lineItems) {
        // Skip exempt/0% lines
        if (!li.vat7_base || li.vat7_base === 0) continue;
        const expectedVat = li.vat7_base * vatRate / 100;
        const diff = Math.abs((li.vat_amount || 0) - expectedVat);
        if (diff > tolerance) {
          addFlag('VAL_VAT_CALC', 'error',
            `บรรทัด #${li.seq_in_file}: vat7_base(${li.vat7_base}) × ${vatRate}% = ${expectedVat.toFixed(2)} แต่ vat_amount = ${li.vat_amount} (ต่าง ${diff.toFixed(2)})`, li.id);
        }
      }

      // Compute output/input totals
      const outputVat = lineItems.filter(l => l.vat_direction === 'output').reduce((s, l) => s + (l.vat_amount || 0), 0);
      const inputVat = lineItems.filter(l => l.vat_direction === 'input').reduce((s, l) => s + (l.vat_amount || 0), 0);

      // CONTINUITY: credit_brought_forward vs prev period register
      const [year, month] = filing.tax_period.split('-').map(Number);
      const prevMonth = month === 1 ? 12 : month - 1;
      const prevYear = month === 1 ? year - 1 : year;
      const prevPeriod = `${prevYear}-${String(prevMonth).padStart(2, '0')}`;

      const prevRegisters = await svc.entities.TaxQA_VatPeriodRegister.filter({
        customer_id: filing.customer_id, tax_period: prevPeriod
      }, '-version', 1);

      if (prevRegisters.length > 0 && filing.credit_brought_forward != null) {
        const prevCf = prevRegisters[0].credit_carried_forward || 0;
        if (Math.abs(filing.credit_brought_forward - prevCf) > tolerance) {
          addFlag('VAL_CREDIT_BREAK', 'error',
            `เครดิตยกมา (${filing.credit_brought_forward}) ไม่ตรงกับเครดิตยกไปงวด ${prevPeriod} (${prevCf})`);
        }
      }

      // Input VAT carryforward: invoice date > carryMonths before tax_period
      const periodStart = new Date(year, month - 1, 1);
      for (const li of lineItems) {
        if (li.vat_direction !== 'input' || !li.tax_invoice_date) continue;
        const dateStr = String(li.tax_invoice_date).trim();
        const parts = dateStr.split('/');
        if (parts.length !== 3) continue;
        const d = parseInt(parts[0]);
        const m = parseInt(parts[1]);
        let y = parseInt(parts[2]);
        if (y > 2500) y -= 543;
        const invoiceDate = new Date(y, m - 1, d);
        if (invoiceDate < periodStart) {
          const monthsBack = (periodStart.getFullYear() - invoiceDate.getFullYear()) * 12 + (periodStart.getMonth() - invoiceDate.getMonth());
          if (monthsBack > carryMonths) {
            addFlag('VAL_INPUT_EXPIRED', 'error',
              `บรรทัดใบกำกับ "${li.tax_invoice_no}" วันที่ ${li.tax_invoice_date} เกิน ${carryMonths} เดือน จากงวด ${filing.tax_period}`, li.id);
          }
        }
      }

      // Store summary on filing
      await svc.entities.TaxQA_Filing.update(filing_id, {
        header_total_tax: Math.round((outputVat - inputVat) * 100) / 100,
      });
    }

    // ═══════════════════════════════════════════════════
    // PERSIST FLAGS + DETERMINE FINAL STATUS
    // ═══════════════════════════════════════════════════
    if (flags.length > 0) {
      const BATCH_SZ = 10;
      for (let i = 0; i < flags.length; i += BATCH_SZ) {
        await svc.entities.TaxQA_ExceptionFlag.bulkCreate(flags.slice(i, i + BATCH_SZ));
        if (i + BATCH_SZ < flags.length) await new Promise(r => setTimeout(r, 500));
      }
    }

    // Total open = new VAL_ flags + remaining INGEST_ open flags
    const totalOpen = flags.length + remainingOpenFlags.length;
    const finalStatus = totalOpen > 0 ? 'flagged' : 'clean';

    await svc.entities.TaxQA_Filing.update(filing_id, {
      status: finalStatus,
      flag_count: totalOpen,
    });

    return Response.json({
      success: true,
      filing_id,
      status: finalStatus,
      total_flags: totalOpen,
      new_val_flags: flags.length,
      existing_open_flags: remainingOpenFlags.length,
      errors: flags.filter(f => f.severity === 'error').length,
      warnings: flags.filter(f => f.severity === 'warning').length,
      flags: flags.map(f => ({ rule_code: f.rule_code, severity: f.severity, message: f.message })),
    });
  } catch (error) {
    console.error('taxqaValidate error:', error.message, error.stack);
    return Response.json({ error: error.message }, { status: 500 });
  }
});