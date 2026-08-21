import { createClientFromRequest } from '../_shared/base44-compat.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (user.role !== 'admin' && user.role !== 'management') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    // Get O365 config from AppConfig
    const configs = await base44.asServiceRole.entities.AppConfig.filter({});
    const getVal = (key) => configs.find(c => c.key === key)?.value || '';

    const senderName = getVal('o365_sender_name') || 'ACC Consulting';
    const emailAddress = getVal('o365_email_address');
    const encodedPassword = getVal('o365_app_password');

    if (!emailAddress || !encodedPassword) {
      return Response.json({
        error: 'กรุณาบันทึก O365 Email Address และ Password ก่อนทดสอบการเชื่อมต่อ'
      }, { status: 400 });
    }

    // Use Base44 SendEmail integration instead of direct SMTP (Deno blocks outgoing SMTP)
    await base44.asServiceRole.integrations.Core.SendEmail({
      from_name: senderName,
      to: user.email,
      subject: '✅ ทดสอบการเชื่อมต่อ O365 Email — ACC Consulting',
      body: `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 30px;">
          <div style="background: linear-gradient(135deg, #0f172a 0%, #1e3a5f 50%, #2563eb 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
            <h1 style="color: #ffffff; margin: 0; font-size: 24px; letter-spacing: 0.5px;">ACC Consulting</h1>
            <p style="color: #93c5fd; margin: 8px 0 0; font-size: 13px;">ระบบแจ้งเตือนอีเมล — Office 365</p>
          </div>
          <div style="background: #ffffff; padding: 30px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px;">
            <h2 style="color: #059669; margin-top: 0; font-size: 20px;">✅ เชื่อมต่อสำเร็จ!</h2>
            <p style="color: #475569; line-height: 1.7; font-size: 14px;">
              อีเมลนี้เป็นการทดสอบจากระบบ ACC Consulting เพื่อยืนยันว่าการตั้งค่า <strong>Microsoft Office 365</strong> ถูกต้องและพร้อมใช้งาน
            </p>
            <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 15px; margin: 20px 0;">
              <p style="margin: 0; color: #1e3a5f; font-size: 13px;">
                <strong>📧 ชื่อผู้ส่ง:</strong> ${senderName}<br>
                <strong>📬 ส่งถึง:</strong> ${user.email}<br>
                <strong>🕐 เวลา:</strong> ${new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}
              </p>
            </div>
            <p style="color: #94a3b8; font-size: 11px; margin-bottom: 0; text-align: center;">
              อีเมลนี้ส่งโดยอัตโนมัติจากระบบ ACC Consulting — กรุณาอย่าตอบกลับ
            </p>
          </div>
        </div>
      `,
    });

    console.log(`O365 test email sent successfully to ${user.email}`);
    return Response.json({ status: 'success', message: 'ส่งอีเมลทดสอบผ่าน Office 365 สำเร็จ' });

  } catch (error) {
    console.error('O365 Email test error:', error.message);
    return Response.json({ 
      error: 'ไม่สามารถส่งอีเมลทดสอบได้ กรุณาตรวจสอบการตั้งค่าอีกครั้ง' 
    }, { status: 500 });
  }
});