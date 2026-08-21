// inviteUser — แทน base44.users.inviteUser(email, role)
// admin สร้างผู้ใช้ + ส่งลิงก์ตั้งรหัสผ่าน (recovery) ให้อีเมลนั้น
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { requireRole } from '../_shared/auth.ts';

Deno.serve(async (req) => {
  try {
    await requireRole(req, ['admin', 'management']);

    const { email, role } = await req.json();
    if (!email) return Response.json({ error: 'email is required' }, { status: 400 });

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } }
    );

    // สร้าง user (ยืนยันอีเมลไว้เลย จะได้ตั้งรหัสผ่านผ่านลิงก์ recovery)
    const { data: created, error } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { invited_role: role ?? 'staff' },
    });
    if (error && !/already/i.test(error.message)) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    // ตั้ง role ใน profiles (มี trigger สร้าง profile ให้แล้ว)
    const appRole = role === 'admin' ? 'admin' : (role === 'user' ? 'staff' : (role ?? 'staff'));
    await admin.from('profiles').update({ role: appRole }).eq('email', email);

    // ส่งลิงก์ตั้งรหัสผ่าน
    const { error: linkErr } = await admin.auth.resetPasswordForEmail(email, {
      redirectTo: `${Deno.env.get('APP_ORIGIN')}/reset-password`,
    });
    if (linkErr) return Response.json({ error: linkErr.message }, { status: 400 });

    return Response.json({ success: true, email, role: appRole });
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return Response.json({ error: (e as Error).message }, { status });
  }
});
