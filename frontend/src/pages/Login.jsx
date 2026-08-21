import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44, supabase } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, LogIn } from 'lucide-react';

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [mode, setMode] = useState('login'); // 'login' | 'forgot'

  const handleLogin = async (e) => {
    e.preventDefault();
    setError(''); setInfo(''); setBusy(true);
    try {
      await base44.auth.login(email.trim(), password);
      const next = new URLSearchParams(window.location.search).get('next');
      navigate(next && next.startsWith('/') ? next : '/', { replace: true });
    } catch (err) {
      const msg = String(err?.message || '');
      if (/invalid login/i.test(msg)) setError('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
      else if (/email not confirmed/i.test(msg)) setError('บัญชียังไม่ยืนยันอีเมล — ติดต่อผู้ดูแลระบบ');
      else setError(msg || 'เข้าสู่ระบบไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  const handleForgot = async (e) => {
    e.preventDefault();
    setError(''); setInfo(''); setBusy(true);
    try {
      const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (err) throw err;
      setInfo('ส่งลิงก์ตั้งรหัสผ่านไปที่อีเมลแล้ว (หากอีเมลนี้มีในระบบ)');
    } catch (err) {
      setError(String(err?.message || 'ส่งลิงก์ไม่สำเร็จ'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm shadow-lg">
        <CardHeader className="text-center space-y-1">
          <div className="mx-auto w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-1">
            <LogIn className="w-6 h-6 text-primary" />
          </div>
          <CardTitle className="text-xl">ACC Operation System</CardTitle>
          <CardDescription>
            {mode === 'login' ? 'เข้าสู่ระบบด้วยบัญชีบริษัท' : 'ขอลิงก์ตั้งรหัสผ่านใหม่'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={mode === 'login' ? handleLogin : handleForgot} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">อีเมล</Label>
              <Input id="email" type="email" autoComplete="username" required
                value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="you@accconsultingservice.com" />
            </div>

            {mode === 'login' && (
              <div className="space-y-2">
                <Label htmlFor="password">รหัสผ่าน</Label>
                <Input id="password" type="password" autoComplete="current-password" required
                  value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}
            {info && <p className="text-sm text-emerald-600">{info}</p>}

            <Button type="submit" className="w-full" disabled={busy}>
              {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {mode === 'login' ? 'เข้าสู่ระบบ' : 'ส่งลิงก์ตั้งรหัสผ่าน'}
            </Button>

            <button type="button"
              className="w-full text-xs text-muted-foreground hover:text-foreground transition"
              onClick={() => { setMode(mode === 'login' ? 'forgot' : 'login'); setError(''); setInfo(''); }}>
              {mode === 'login' ? 'ลืมรหัสผ่าน?' : '← กลับไปหน้าเข้าสู่ระบบ'}
            </button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
