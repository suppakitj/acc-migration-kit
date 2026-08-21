import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, KeyRound } from 'lucide-react';

/**
 * ResetPassword — หน้าปลายทางของลิงก์ recovery จากอีเมล
 * Supabase จะสร้าง session ชั่วคราวจาก token ใน URL (detectSessionInUrl)
 * ที่นี่ผู้ใช้ตั้งรหัสผ่านใหม่ด้วย supabase.auth.updateUser
 */
export default function ResetPassword() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    // ลิงก์ recovery มากับ hash (#access_token=...) — แลกเป็น session
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') setReady(true);
    });
    supabase.auth.getSession().then(({ data: { session } }) => { if (session) setReady(true); });
    return () => subscription?.unsubscribe();
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (pw.length < 12) { setError('รหัสผ่านต้องยาวอย่างน้อย 12 ตัวอักษร'); return; }
    if (pw !== pw2) { setError('รหัสผ่านทั้งสองช่องไม่ตรงกัน'); return; }
    setBusy(true);
    try {
      const { error: err } = await supabase.auth.updateUser({ password: pw });
      if (err) throw err;
      setDone(true);
      setTimeout(() => navigate('/login', { replace: true }), 2000);
    } catch (err) {
      setError(String(err?.message || 'ตั้งรหัสผ่านไม่สำเร็จ'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm shadow-lg">
        <CardHeader className="text-center space-y-1">
          <div className="mx-auto w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-1">
            <KeyRound className="w-6 h-6 text-primary" />
          </div>
          <CardTitle className="text-xl">ตั้งรหัสผ่านใหม่</CardTitle>
          <CardDescription>ACC Operation System</CardDescription>
        </CardHeader>
        <CardContent>
          {done ? (
            <p className="text-sm text-emerald-600 text-center">
              ตั้งรหัสผ่านเรียบร้อย กำลังพาไปหน้าเข้าสู่ระบบ…
            </p>
          ) : !ready ? (
            <p className="text-sm text-muted-foreground text-center">
              กำลังตรวจสอบลิงก์… หากค้างนาน แสดงว่าลิงก์หมดอายุ — ขอลิงก์ใหม่จากหน้าเข้าสู่ระบบ
            </p>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="pw">รหัสผ่านใหม่ (≥ 12 ตัวอักษร)</Label>
                <Input id="pw" type="password" autoComplete="new-password" required
                  value={pw} onChange={(e) => setPw(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pw2">ยืนยันรหัสผ่าน</Label>
                <Input id="pw2" type="password" autoComplete="new-password" required
                  value={pw2} onChange={(e) => setPw2(e.target.value)} />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={busy}>
                {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                ตั้งรหัสผ่าน
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
