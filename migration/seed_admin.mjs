/**
 * seed_admin.mjs — สร้างผู้ใช้ admin คนแรก (จำเป็นเพื่อเข้าไปตั้งค่าระบบ)
 *   SUPABASE_URL=http://localhost:8000 \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   ADMIN_EMAIL=suppakit.j@accconsultingservice.com \
 *   [ADMIN_PASSWORD=... | ส่งลิงก์ตั้งรหัสผ่านถ้าไม่ระบุ] \
 *   node seed_admin.mjs
 */
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD; // optional
if (!URL || !KEY || !EMAIL) {
  console.error('ต้องตั้ง SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_EMAIL');
  process.exit(1);
}

const sb = createClient(URL, KEY, { auth: { persistSession: false } });

const { data: created, error } = await sb.auth.admin.createUser({
  email: EMAIL,
  password: PASSWORD || undefined,
  email_confirm: true,
  user_metadata: { full_name: 'System Administrator' },
});

let id = created?.user?.id;
if (error) {
  if (/already/i.test(error.message)) {
    const { data: list } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
    id = list?.users?.find((u) => u.email?.toLowerCase() === EMAIL.toLowerCase())?.id;
    console.log('ผู้ใช้มีอยู่แล้ว — อัปเดต role เป็น admin');
  } else {
    console.error('createUser error:', error.message);
    process.exit(1);
  }
}

const { error: pe } = await sb.from('profiles')
  .update({ role: 'admin', full_name: 'System Administrator', user_status: 'active' })
  .eq('id', id);
if (pe) { console.error('set role error:', pe.message); process.exit(1); }

if (!PASSWORD) {
  const { error: le } = await sb.auth.resetPasswordForEmail(EMAIL, {
    redirectTo: `${process.env.APP_ORIGIN || URL}/reset-password`,
  });
  console.log(le ? `ส่งลิงก์ตั้งรหัสผ่านไม่สำเร็จ: ${le.message}` : `ส่งลิงก์ตั้งรหัสผ่านไปที่ ${EMAIL} แล้ว`);
} else {
  console.log(`ตั้งรหัสผ่านให้ ${EMAIL} เรียบร้อย (ล็อกอินได้ทันที)`);
}
console.log(`✅ admin พร้อมใช้งาน: ${EMAIL}`);
