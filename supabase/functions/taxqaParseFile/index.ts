import { createClientFromRequest } from '../_shared/base44-compat.ts';
import * as XLSX from 'npm:xlsx@0.18.5';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { file_url, customer_id, customer_name, tax_period, form_type, supersedes_filing_id } = await req.json();
    if (!file_url || !customer_id || !tax_period) {
      return Response.json({ error: 'file_url, customer_id, tax_period required' }, { status: 400 });
    }

    // ─── Supersede validation ───
    let supersedesVersion = 0;
    if (supersedes_filing_id) {
      const oldFilings = await base44.asServiceRole.entities.TaxQA_Filing.filter({ id: supersedes_filing_id });
      const oldF = oldFilings[0];
      if (!oldF) return Response.json({ error: 'ใบเดิมไม่พบ' }, { status: 404 });
      if (oldF.status !== 'rejected') return Response.json({ error: `ใบเดิมสถานะ "${oldF.status}" — ต้องเป็น rejected เท่านั้น` }, { status: 400 });
      if (oldF.customer_id !== customer_id || oldF.tax_period !== tax_period) {
        return Response.json({ error: 'ลูกค้า/งวดภาษีไม่ตรงกับใบเดิม' }, { status: 400 });
      }
      if (form_type && form_type !== 'auto' && oldF.form_type !== form_type) {
        return Response.json({ error: `ประเภทแบบไม่ตรง — ใบเดิมเป็น ${oldF.form_type}` }, { status: 400 });
      }
      supersedesVersion = oldF.version || 1;
    }

    // Download file
    const fileRes = await fetch(file_url);
    if (!fileRes.ok) return Response.json({ error: 'Failed to download file' }, { status: 500 });
    const buf = await fileRes.arrayBuffer();
    const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

    // ─── Auto-detect layout ─────────────────────────
    let detectedLayout = null;
    let detectedFormType = form_type || null;

    // Layout B: WHT — first row has "ลำดับที่" in col A and "วันที่หัก ณ ที่จ่าย" in col B
    const row0 = rawRows[0] || [];
    const isLayoutB = String(row0[0] || '').includes('ลำดับที่') && String(row0[1] || '').includes('วันที่หัก');

    // Layout A: VAT — sheet name contains ภาษีซื้อ/ภาษีขาย or metadata row contains รายงานภาษี
    const isLayoutA = !isLayoutB && (
      sheetName.includes('ภาษีซื้อ') || sheetName.includes('ภาษีขาย') ||
      String(rawRows[0]?.[1] || '').includes('รายงานภาษี')
    );

    if (isLayoutB) detectedLayout = 'layout_b_wht';
    else if (isLayoutA) detectedLayout = 'layout_a_vat';
    else return Response.json({ error: 'ไม่สามารถระบุ layout ได้ — ไม่ใช่รูปแบบ WHT หรือ VAT ที่รองรับ' }, { status: 400 });

    const errors = [];

    // ─── LAYOUT A: VAT (ภาษีซื้อ/ภาษีขาย) ───────────
    if (detectedLayout === 'layout_a_vat') {
      // Determine direction
      const vatDirection = sheetName.includes('ภาษีซื้อ') ? 'input' : 'output';
      if (!detectedFormType) detectedFormType = 'PP30';

      // Metadata rows 0-3 (row 0 of Excel = column names in sheet_to_json header:1, so rawRows[0]=row1 of Excel)
      // Row 0 = ผู้ออกรายงาน, Row 1 = ชื่อกิจการ, Row 2 = วันที่ออกรายงาน, Row 3 = ช่วงเวลา, Row 4 = header
      // But since sheet_to_json header:1 reads ALL rows including the first "ชื่อรายงาน" row as data:
      // rawRows[0] = ["ชื่อรายงาน : ", "รายงานภาษีซื้อ/ขาย", ...]
      // We need to find the metadata by scanning
      let metaCompany = '';
      let metaPeriod = '';
      let headerRowIdx = -1;
      for (let i = 0; i < Math.min(rawRows.length, 10); i++) {
        const col0 = String(rawRows[i]?.[0] || '');
        if (col0.includes('ชื่อกิจการ')) metaCompany = String(rawRows[i]?.[1] || '');
        if (col0.includes('ช่วงเวลา')) metaPeriod = String(rawRows[i]?.[1] || '');
        if (col0.includes('ลำดับที่')) { headerRowIdx = i; break; }
      }
      if (headerRowIdx === -1) headerRowIdx = 4; // fallback

      // Ingestion check: company name
      if (metaCompany && customer_name && !metaCompany.includes(customer_name) && !customer_name.includes(metaCompany)) {
        errors.push({ rule_code: 'INGEST_COMPANY_MISMATCH', severity: 'error', message: `ชื่อกิจการในไฟล์ "${metaCompany}" ไม่ตรงกับลูกค้า "${customer_name}"` });
      }

      // Ingestion check: period
      if (metaPeriod && tax_period) {
        const parts = metaPeriod.split('-');
        if (parts.length === 2) {
          const startParts = parts[0].trim().split('/');
          if (startParts.length === 3) {
            const fileMonth = `${startParts[2]}-${startParts[1]}`;
            if (fileMonth !== tax_period) {
              errors.push({ rule_code: 'INGEST_PERIOD_MISMATCH', severity: 'error', message: `งวดในไฟล์ "${metaPeriod}" ไม่ตรงกับที่เลือก "${tax_period}"` });
            }
          }
        }
      }

      // Validate header row
      const headerRow = rawRows[headerRowIdx] || [];
      const requiredHeaders = ['เลขที่ใบกำกับภาษี', 'วันที่ใบกำกับภาษี', 'ภาษีมูลค่าเพิ่ม'];
      const headerStr = headerRow.map(h => String(h || '')).join('|');
      for (const rh of requiredHeaders) {
        if (!headerStr.includes(rh)) {
          errors.push({ rule_code: 'INGEST_HEADER_MISSING', severity: 'error', message: `หัวคอลัมน์ "${rh}" ไม่พบในไฟล์` });
        }
      }

      if (errors.some(e => e.severity === 'error' && e.rule_code !== 'INGEST_COMPANY_MISMATCH')) {
        // Create batch with error
        const batch = await base44.asServiceRole.entities.TaxQA_IngestionBatch.create({
          source_filename: file_url.split('/').pop(),
          file_url, customer_id, customer_name: customer_name || '',
          tax_period, form_type: detectedFormType, detected_layout: detectedLayout,
          parsed_count: 0, error_count: errors.length, status: 'failed',
          error_detail: errors.map(e => e.message).join('; '),
          imported_by: user.email, imported_by_name: user.full_name || '',
        });
        return Response.json({ success: false, batch_id: batch.id, errors, parsed_count: 0 });
      }

      // Parse data rows (after header)
      const dataRows = rawRows.slice(headerRowIdx + 1).filter(r => r[0] != null && String(r[0]).trim() !== '' && !String(r[0]).includes('รวม'));

      // Create batch
      const batch = await base44.asServiceRole.entities.TaxQA_IngestionBatch.create({
        source_filename: file_url.split('/').pop(),
        file_url, customer_id, customer_name: customer_name || '',
        tax_period, form_type: detectedFormType, detected_layout: detectedLayout,
        parsed_count: dataRows.length, error_count: errors.length, status: 'parsed',
        imported_by: user.email, imported_by_name: user.full_name || '',
      });

      // Extract filed_ref from status column
      let filedRef = '';
      if (dataRows.length > 0) {
        const statusVal = String(dataRows[0][14] || '');
        const hashMatch = statusVal.match(/#([\w-]+)/);
        if (hashMatch) filedRef = hashMatch[1];
      }

      // Try to find matching TaxDeadline
      let taxDeadlineId = '';
      const periodParts = tax_period.split('-');
      if (periodParts.length === 2) {
        const deadlines = await base44.asServiceRole.entities.TaxDeadline.filter({
          tax_type: 'pp30', for_year: parseInt(periodParts[0]), for_month: parseInt(periodParts[1])
        }, '-created_date', 1);
        if (deadlines.length > 0) taxDeadlineId = deadlines[0].id;
      }

      // PP30 find-or-create: reuse existing filing if not yet filed
      // Exclude filed/superseded/cancelled/rejected from reuse
      const excludeReuse = ['filed', 'superseded', 'cancelled', 'rejected'];
      const existingPP30 = await base44.asServiceRole.entities.TaxQA_Filing.filter({
        customer_id, tax_period, form_type: 'PP30'
      }, '-created_date', 10);
      const reusable = supersedes_filing_id
        ? null  // supersede always creates a new filing
        : existingPP30.find(f => !excludeReuse.includes(f.status));

      let filing;
      if (reusable) {
        // Reuse existing filing — update batch ref + line_count
        filing = reusable;
        await base44.asServiceRole.entities.TaxQA_Filing.update(filing.id, {
          status: 'validating',
          line_count: (filing.line_count || 0) + dataRows.length,
          source_batch_id: batch.id,
        });
        filing.line_count = (filing.line_count || 0) + dataRows.length;
      } else {
        const pp30FilingData = {
          customer_id, customer_name: customer_name || '',
          form_type: detectedFormType, tax_period,
          tax_deadline_id: taxDeadlineId,
          status: 'validating',
          source_batch_id: batch.id, filed_ref: filedRef,
          prepared_by: user.email, prepared_by_name: user.full_name || '',
          line_count: dataRows.length,
        };
        if (supersedes_filing_id) {
          pp30FilingData.supersedes_id = supersedes_filing_id;
          pp30FilingData.version = supersedesVersion + 1;
        }
        filing = await base44.asServiceRole.entities.TaxQA_Filing.create(pp30FilingData);

        // Mark old filing as superseded
        if (supersedes_filing_id) {
          await base44.asServiceRole.entities.TaxQA_Filing.update(supersedes_filing_id, {
            status: 'superseded',
            superseded_at: new Date().toISOString(),
            superseded_by_filing_id: filing.id,
          });
        }
      }

      // Create LineItems in batches
      const lineItems = dataRows.map((r, i) => ({
        filing_id: filing.id,
        seq_in_file: r[0] != null ? Number(r[0]) : i + 1,
        tax_invoice_no: String(r[1] || ''),
        tax_invoice_date: String(r[2] || ''),
        ref_doc_1: String(r[3] || ''),
        invoice_type: String(r[4] || ''),
        contact_code: String(r[5] || ''),
        counterparty_name: String(r[6] || ''),
        counterparty_tax_id: String(r[7] || ''),
        branch: String(r[8] || ''),
        exempt_amount: Number(r[9]) || 0,
        vat0_amount: Number(r[10]) || 0,
        vat7_base: Number(r[11]) || 0,
        vat_amount: Number(r[12]) || 0,
        total_incl_vat: Number(r[13]) || 0,
        raw_status: String(r[14] || ''),
        vat_direction: vatDirection,
      }));

      const BATCH_SZ = 10;
      for (let i = 0; i < lineItems.length; i += BATCH_SZ) {
        await base44.asServiceRole.entities.TaxQA_LineItem.bulkCreate(lineItems.slice(i, i + BATCH_SZ));
        if (i + BATCH_SZ < lineItems.length) await new Promise(r => setTimeout(r, 1000));
      }

      // Write ingestion flags
      for (const err of errors) {
        await base44.asServiceRole.entities.TaxQA_ExceptionFlag.create({
          filing_id: filing.id, rule_code: err.rule_code, severity: err.severity, message: err.message,
        });
      }

      // Auto-validate after parse
      const validateRes = await base44.functions.invoke('taxqaValidate', { filing_id: filing.id });

      return Response.json({
        success: true, batch_id: batch.id, filing_id: filing.id,
        detected_layout: detectedLayout, vat_direction: vatDirection,
        parsed_count: lineItems.length, errors,
        validation: validateRes.data || null,
      });
    }

    // ─── LAYOUT B: WHT (ภงด.3/53) ──────────────────
    if (detectedLayout === 'layout_b_wht') {
      // Metadata from columns R-S (index 17-18) of rows 0-5
      let metaCompany = '';
      let metaPeriod = '';
      let filedRef = '';
      for (let i = 0; i < Math.min(rawRows.length, 6); i++) {
        const keyCol = String(rawRows[i]?.[17] || '');
        const valCol = String(rawRows[i]?.[18] || '');
        if (keyCol.includes('ชื่อกิจการ')) metaCompany = valCol;
        if (keyCol.includes('งวดภาษี')) metaPeriod = valCol;
        if (keyCol.includes('เลขที่แบบภาษี')) filedRef = valCol;
      }

      // Auto-detect PND3 vs PND53
      if (!detectedFormType) {
        if (sheetName.includes('53') || filedRef.includes('PND53') || String(rawRows[0]?.[18] || '').includes('53')) {
          detectedFormType = 'PND53';
        } else if (sheetName.includes('3') || filedRef.includes('PND3')) {
          detectedFormType = 'PND3';
        } else {
          // Check pnd_type in first data row
          const firstDataPnd = String(rawRows[1]?.[9] || '');
          detectedFormType = firstDataPnd.includes('53') ? 'PND53' : 'PND3';
        }
      }

      // Ingestion checks
      if (metaCompany && customer_name && !metaCompany.includes(customer_name) && !customer_name.includes(metaCompany)) {
        errors.push({ rule_code: 'INGEST_COMPANY_MISMATCH', severity: 'error', message: `ชื่อกิจการในไฟล์ "${metaCompany}" ไม่ตรงกับลูกค้า "${customer_name}"` });
      }

      if (metaPeriod && tax_period) {
        const parts = metaPeriod.trim().split('/');
        if (parts.length === 3) {
          const fileMonth = `${parts[2]}-${parts[1]}`;
          if (fileMonth !== tax_period) {
            errors.push({ rule_code: 'INGEST_PERIOD_MISMATCH', severity: 'error', message: `งวดในไฟล์ "${metaPeriod}" ไม่ตรงกับที่เลือก "${tax_period}"` });
          }
        }
      }

      // Validate headers
      const requiredBHeaders = ['ลำดับที่', 'วันที่หัก ณ ที่จ่าย', 'ภาษีหัก ณ ที่จ่าย'];
      const hdrStr = row0.map(h => String(h || '')).join('|');
      for (const rh of requiredBHeaders) {
        if (!hdrStr.includes(rh)) {
          errors.push({ rule_code: 'INGEST_HEADER_MISSING', severity: 'error', message: `หัวคอลัมน์ "${rh}" ไม่พบในไฟล์` });
        }
      }

      if (errors.some(e => e.severity === 'error' && e.rule_code === 'INGEST_HEADER_MISSING')) {
        const batch = await base44.asServiceRole.entities.TaxQA_IngestionBatch.create({
          source_filename: file_url.split('/').pop(),
          file_url, customer_id, customer_name: customer_name || '',
          tax_period, form_type: detectedFormType, detected_layout: detectedLayout,
          parsed_count: 0, error_count: errors.length, status: 'failed',
          error_detail: errors.map(e => e.message).join('; '),
          imported_by: user.email, imported_by_name: user.full_name || '',
        });
        return Response.json({ success: false, batch_id: batch.id, errors, parsed_count: 0 });
      }

      // Parse data rows (index 1+, skip "รวม" row at end)
      const dataRows = rawRows.slice(1).filter(r => {
        const first = String(r[0] || '').trim();
        return first !== '' && !first.includes('รวม') && first !== 'null';
      });

      // Create batch
      const batch = await base44.asServiceRole.entities.TaxQA_IngestionBatch.create({
        source_filename: file_url.split('/').pop(),
        file_url, customer_id, customer_name: customer_name || '',
        tax_period, form_type: detectedFormType, detected_layout: detectedLayout,
        parsed_count: dataRows.length, error_count: errors.length, status: 'parsed',
        imported_by: user.email, imported_by_name: user.full_name || '',
      });

      // Find TaxDeadline
      let taxDeadlineId = '';
      const periodParts = tax_period.split('-');
      if (periodParts.length === 2) {
        const taxType = detectedFormType === 'PND53' ? 'pnd53' : 'pnd3';
        const deadlines = await base44.asServiceRole.entities.TaxDeadline.filter({
          tax_type: taxType, for_year: parseInt(periodParts[0]), for_month: parseInt(periodParts[1])
        }, '-created_date', 1);
        if (deadlines.length > 0) taxDeadlineId = deadlines[0].id;
      }

      // Create Filing
      const totalTax = dataRows.reduce((sum, r) => sum + (Number(r[13]) || 0), 0);
      const whtFilingData = {
        customer_id, customer_name: customer_name || '',
        form_type: detectedFormType, tax_period,
        tax_deadline_id: taxDeadlineId,
        status: 'validating',
        header_total_tax: Math.round(totalTax * 100) / 100,
        source_batch_id: batch.id, filed_ref: filedRef || '',
        prepared_by: user.email, prepared_by_name: user.full_name || '',
        line_count: dataRows.length,
      };
      if (supersedes_filing_id) {
        whtFilingData.supersedes_id = supersedes_filing_id;
        whtFilingData.version = supersedesVersion + 1;
      }
      const filing = await base44.asServiceRole.entities.TaxQA_Filing.create(whtFilingData);

      // Mark old filing as superseded
      if (supersedes_filing_id) {
        await base44.asServiceRole.entities.TaxQA_Filing.update(supersedes_filing_id, {
          status: 'superseded',
          superseded_at: new Date().toISOString(),
          superseded_by_filing_id: filing.id,
        });
      }

      // Parse wht_rate
      const parseRate = (v) => {
        const s = String(v || '').replace('%', '').trim();
        return parseFloat(s) || 0;
      };

      // Create LineItems
      const lineItems = dataRows.map((r, i) => ({
        filing_id: filing.id,
        seq_in_file: r[0] != null ? Number(r[0]) : i + 1,
        pay_date: String(r[1] || ''),
        cert_no: String(r[2] || ''),
        payee_code: String(r[3] || ''),
        payee_name: String(r[4] || ''),
        payee_tax_id: String(r[5] || ''),
        branch: String(r[6] || ''),
        ref_doc_1: String(r[7] || ''),
        ref_doc_2: String(r[8] || ''),
        pnd_type: String(r[9] || ''),
        income_desc: String(r[10] || ''),
        wht_rate: parseRate(r[11]),
        tax_base: Number(r[12]) || 0,
        wht_amount: Number(r[13]) || 0,
        wht_condition: String(r[14] || ''),
        raw_status: String(r[15] || ''),
      }));

      const BATCH_SZ = 10;
      for (let i = 0; i < lineItems.length; i += BATCH_SZ) {
        await base44.asServiceRole.entities.TaxQA_LineItem.bulkCreate(lineItems.slice(i, i + BATCH_SZ));
        if (i + BATCH_SZ < lineItems.length) await new Promise(r => setTimeout(r, 1000));
      }

      // Write flags
      for (const err of errors) {
        await base44.asServiceRole.entities.TaxQA_ExceptionFlag.create({
          filing_id: filing.id, rule_code: err.rule_code, severity: err.severity, message: err.message,
        });
      }

      // Auto-validate after parse
      const validateRes = await base44.functions.invoke('taxqaValidate', { filing_id: filing.id });

      return Response.json({
        success: true, batch_id: batch.id, filing_id: filing.id,
        detected_layout: detectedLayout, form_type: detectedFormType,
        parsed_count: lineItems.length, filed_ref: filedRef, errors,
        validation: validateRes.data || null,
      });
    }

    return Response.json({ error: 'Unknown layout' }, { status: 400 });
  } catch (error) {
    console.error('taxqaParseFile error:', error.message, error.stack);
    return Response.json({ error: error.message }, { status: 500 });
  }
});