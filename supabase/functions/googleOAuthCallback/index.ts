// googleOAuthCallback — Google redirect กลับมาพร้อม ?code=...
// แลก code เป็น refresh_token แล้วเก็บลงตาราง oauth_connection (service_role)
// หลังจากนี้ base44.asServiceRole.connectors.getConnection('googledrive') ใช้งานได้
// verify_jwt=false (Google เรียกกลับโดยไม่มี JWT ของเรา)
import { createClient } from 'jsr:@supabase/supabase-js@2';

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const err = url.searchParams.get('error');
  const origin = Deno.env.get('APP_ORIGIN') ?? '';

  if (err) return Response.redirect(`${origin}/AppSettings?gdrive=error`, 302);
  if (!code) return Response.json({ error: 'missing code' }, { status: 400 });

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: Deno.env.get('GOOGLE_CLIENT_ID')!,
        client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
        redirect_uri: `${origin}/functions/v1/googleOAuthCallback`,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) throw new Error(`token exchange ${tokenRes.status}: ${await tokenRes.text()}`);
    const tok = await tokenRes.json();
    if (!tok.refresh_token) {
      throw new Error('ไม่ได้ refresh_token — ต้องเพิกถอนสิทธิ์เดิมใน Google account แล้ว consent ใหม่');
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } }
    );

    await admin.from('oauth_connection').upsert({
      provider: 'googledrive',
      client_id: Deno.env.get('GOOGLE_CLIENT_ID')!,
      client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
      refresh_token: tok.refresh_token,
      access_token: tok.access_token,
      expires_at: new Date(Date.now() + (tok.expires_in ?? 3600) * 1000).toISOString(),
      token_url: 'https://oauth2.googleapis.com/token',
      scopes: ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/userinfo.email'],
    }, { onConflict: 'provider' });

    return Response.redirect(`${origin}/AppSettings?gdrive=connected`, 302);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
});
