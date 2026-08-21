// googleOAuthStart — เริ่ม OAuth consent ของ Google Drive
// admin เปิด endpoint นี้ (ผ่านหน้า Settings) → redirect ไปหน้า consent ของ Google
// scope ตรงกับ base44/connectors/googledrive.jsonc เดิม
import { requireRole } from '../_shared/auth.ts';

Deno.serve(async (req) => {
  try {
    await requireRole(req, ['admin', 'management']);

    const params = new URLSearchParams({
      client_id: Deno.env.get('GOOGLE_CLIENT_ID')!,
      redirect_uri: `${Deno.env.get('APP_ORIGIN')}/functions/v1/googleOAuthCallback`,
      response_type: 'code',
      access_type: 'offline',          // ขอ refresh_token
      prompt: 'consent',               // บังคับให้ได้ refresh_token ทุกครั้ง
      scope: [
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/userinfo.email',
      ].join(' '),
    });
    const url = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
    return Response.json({ url });
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return Response.json({ error: (e as Error).message }, { status });
  }
});
