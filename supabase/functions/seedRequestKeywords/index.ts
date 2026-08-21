import { createClientFromRequest } from '../_shared/base44-compat.ts';

const DEFAULTS = {
  tax_invoice: [
    'ใบกำกับภาษี','กำกับภาษี','ออกใบกำกับ','เปิดใบกำกับ','ใบกำกับ',
    'ใบกำกับขาย','กำกับขาย','ใบกำกับเต็มรูป','เต็มรูป','ใบกำกับอย่างย่อ','อย่างย่อ','ใบกำกับย่อ',
    'เปิดบิล','ออกบิล','บิลขาย','ออกบิลขาย','ขอบิล',
    'tax invoice','full tax','vat invoice','tax inv',
  ],
  wht_cert: [
    'หัก ณ ที่จ่าย','หักภาษี ณ ที่จ่าย','ใบหัก','หนังสือรับรองหัก','หนังสือรับรองการหักภาษี',
    '50 ทวิ','๕๐ ทวิ','ทวิ',
    'ภ.ง.ด.1','ภ.ง.ด.2','ภ.ง.ด.3','ภ.ง.ด.53','ภ.ง.ด.54',
    'ภงด1','ภงด2','ภงด3','ภงด53','ภงด54',
    'pnd1','pnd2','pnd3','pnd53','pnd54',
    'wht','withholding','withholding tax',
    'ออกหัก','ทำหัก ณ','ขอใบหัก',
  ],
  sso_enroll: [
    'แจ้งเข้าประกันสังคม','เข้าประกันสังคม','ขึ้นประกันสังคม',
    'แจ้งเข้า ปกส','เข้าปกส','แจ้งเข้า สปส','เข้าสปส',
    'ขึ้นทะเบียนผู้ประกันตน','ขึ้นทะเบียน','แจ้งขึ้นทะเบียน','ขึ้นทะเบียนนายจ้าง',
    'สปส.1-03','สปส.1-02','สปส 1-03','สปส 1-02',
    'พนักงานเข้าใหม่','พนักงานใหม่','รับพนักงานใหม่','มีพนักงานเข้า','คนเข้าใหม่','จ้างพนักงานใหม่','เพิ่มพนักงาน',
  ],
  sso_terminate: [
    'แจ้งออกประกันสังคม','ออกประกันสังคม',
    'แจ้งออก ปกส','ออกปกส','แจ้งออก สปส','ออกสปส',
    'แจ้งลาออก','ลาออก','พนักงานลาออก','มีคนลาออก','พนักงานออก','มีพนักงานออก','เลิกจ้าง',
    'สปส.6-09','สปส 6-09','แจ้งสิ้นสุด','สิ้นสุดความเป็นผู้ประกันตน',
  ],
};

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const existing = await base44.asServiceRole.entities.RequestKeyword.list('-created_date', 2000);
    const seen = new Set(
      (existing || []).map((k) => `${k.request_type}::${(k.keyword || '').trim().toLowerCase()}`)
    );

    let created = 0;
    let skipped = 0;
    for (const [type, kws] of Object.entries(DEFAULTS)) {
      for (const kw of kws) {
        const key = `${type}::${kw.trim().toLowerCase()}`;
        if (seen.has(key)) { skipped++; continue; }
        await base44.asServiceRole.entities.RequestKeyword.create({
          request_type: type, keyword: kw, active: true, note: 'seed: ค่าเริ่มต้น',
        });
        seen.add(key);
        created++;
      }
    }

    console.log(`seedRequestKeywords: created ${created}, skipped ${skipped}`);
    return Response.json({ success: true, created, skipped, total: created + skipped });
  } catch (error) {
    console.error('seedRequestKeywords error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
}