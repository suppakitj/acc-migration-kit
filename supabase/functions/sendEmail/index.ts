// sendEmail — แทน base44.integrations.Core.SendEmail
// ส่งอีเมลผ่าน SMTP ของ Microsoft 365 (env: SMTP_HOST/PORT/USER/PASS/FROM)
// ถูกเรียกทั้งจาก frontend (Core.SendEmail) และจาก function อื่น (asServiceRole)
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';
import { requireUser } from '../_shared/auth.ts';

Deno.serve(async (req) => {
  try {
    // เรียกจาก function อื่นจะแนบ service key เป็น Bearer → requireUser คืน null ได้
    // อนุญาตถ้า (ก) เป็นผู้ใช้ที่ล็อกอิน หรือ (ข) แนบ service key
    const auth = req.headers.get('Authorization') ?? '';
    const isService = auth === `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`;
    if (!isService) {
      const me = await requireUser(req);
      if (!me) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { to, subject, body, html, cc, bcc } = await req.json();
    if (!to || !subject || (!body && !html)) {
      return Response.json({ error: 'ต้องมี to, subject และ body/html' }, { status: 400 });
    }

    const client = new SMTPClient({
      connection: {
        hostname: Deno.env.get('SMTP_HOST') ?? 'smtp.office365.com',
        port: Number(Deno.env.get('SMTP_PORT') ?? '587'),
        tls: false,                       // 587 = STARTTLS
        auth: {
          username: Deno.env.get('SMTP_USER')!,
          password: Deno.env.get('SMTP_PASS')!,
        },
      },
    });

    await client.send({
      from: Deno.env.get('SMTP_FROM') ?? Deno.env.get('SMTP_USER')!,
      to, cc, bcc, subject,
      content: html ? undefined : body,
      html: html ?? undefined,
    });
    await client.close();

    return Response.json({ success: true });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
});
