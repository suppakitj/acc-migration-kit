/**
 * ============================================================================
 *  10_export-from-base44.js  —  ดัมพ์ข้อมูลทั้งหมดออกจาก Base44
 * ============================================================================
 *  วิธีใช้ (ไม่ต้องมี API key, ไม่ต้องค้นหา endpoint):
 *
 *   1. เปิดแอป ACC Operation System บน Base44 แล้ว login ด้วยบัญชี admin
 *   2. กด F12 → แท็บ Console
 *   3. วางสคริปต์นี้ทั้งไฟล์ → Enter
 *   4. รอจนขึ้น "EXPORT COMPLETE" แล้วไฟล์ acc-export-<วันที่>.json จะถูกดาวน์โหลด
 *
 *  เหตุผลที่ทำแบบนี้: สคริปต์ยืมสิทธิ์จาก session ของ SDK ที่โหลดอยู่ในหน้าเว็บ
 *  → ได้ข้อมูลชุดเดียวกับที่แอปเห็นเป๊ะ ๆ ไม่มีปัญหาเรื่อง auth หรือ endpoint
 *  ที่ไม่ documented และเป็น JSON เต็มรูป (ไม่เสียโครงสร้าง nested อย่าง CSV)
 *
 *  ผลลัพธ์:  { exported_at, entities: { Task: [...], Customer: [...], ... },
 *              counts: { Task: 1234, ... } }
 * ============================================================================
 */
(async () => {
  const ENTITIES = [
    'Announcement', 'AppConfig', 'AuditLog', 'Billing', 'Customer', 'CustomerCredential',
    'DirectorInfo', 'ExternalService', 'HolidayMaster', 'Idea', 'KnowledgeArticle',
    'KnowledgeCategory', 'KpiReport', 'LineGroup', 'LineGroupMember', 'LineMessage',
    'MeetingNote', 'MiniApp', 'Notification', 'OcrJob', 'OvertimeEntry', 'PeakLicense',
    'PerformanceSnapshot', 'PulseResponse', 'Referrer', 'Schedule', 'ServiceMaster',
    'ShoutOut', 'SkillEntry', 'Task', 'TaskTemplate', 'TaxDeadline',
    'TaxQA_CompanyTaxProfile', 'TaxQA_ExceptionFlag', 'TaxQA_Filing',
    'TaxQA_IncomeKeywordMap', 'TaxQA_IngestionBatch', 'TaxQA_LineItem',
    'TaxQA_ReviewLog', 'TaxQA_ValidationRule', 'TaxQA_VatPeriodRegister',
    'TaxQA_WhtRateTable', 'TimeEntry', 'TodoItem', 'User',
  ];

  // ดึง client จาก module ที่แอปโหลดไว้ (Vite เก็บไว้บน window ในโหมด dev
  // ถ้าไม่เจอ ให้ import แบบ dynamic จาก path ของแอป)
  let base44 = window.base44;
  if (!base44) {
    try {
      const mod = await import('/src/api/base44Client.js');
      base44 = mod.base44;
    } catch {
      console.error(
        '❌ หา base44 client ไม่พบ\n' +
        '   วิธีแก้: เพิ่มบรรทัด  window.base44 = base44;  ท้ายไฟล์ src/api/base44Client.js\n' +
        '   แล้ว publish ใหม่หนึ่งครั้ง (หรือรัน npm run dev ในเครื่อง) จากนั้นรันสคริปต์นี้อีกครั้ง'
      );
      return;
    }
  }

  const out = { exported_at: new Date().toISOString(), entities: {}, counts: {}, errors: {} };
  const PAGE = 2000;

  for (const name of ENTITIES) {
    try {
      // ไล่หน้าเผื่อบาง entity มีเกิน 10,000 แถว — ไม่ยอมให้ข้อมูลถูกตัดเงียบ ๆ
      const rows = [];
      let lastLen = PAGE;
      let guard = 0;
      while (lastLen === PAGE && guard < 50) {
        const batch = await base44.entities[name].list('-created_date', PAGE * (guard + 1));
        lastLen = batch.length - rows.length;
        rows.length = 0;
        rows.push(...batch);
        if (batch.length < PAGE * (guard + 1)) break;
        guard++;
      }
      out.entities[name] = rows;
      out.counts[name] = rows.length;
      console.log(`✅ ${name.padEnd(28)} ${rows.length}`);
    } catch (e) {
      out.errors[name] = String(e?.message ?? e);
      out.entities[name] = [];
      out.counts[name] = 0;
      console.warn(`⚠️  ${name.padEnd(28)} FAILED: ${e?.message ?? e}`);
    }
    await new Promise((r) => setTimeout(r, 150)); // กัน rate limit
  }

  const total = Object.values(out.counts).reduce((a, b) => a + b, 0);
  console.log('─'.repeat(52));
  console.table(out.counts);
  console.log(`EXPORT COMPLETE — รวม ${total.toLocaleString()} แถว`);
  if (Object.keys(out.errors).length) console.warn('มี entity ที่ดึงไม่สำเร็จ:', out.errors);

  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const blob = new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `acc-export-${stamp}.json`;
  a.click();

  window.__accExport = out; // เผื่อต้องตรวจใน console
})();
