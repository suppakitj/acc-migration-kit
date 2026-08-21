import { createClientFromRequest } from '../_shared/base44-compat.ts';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const { message, message_id, line_user_id, chat_type, sender_name, customer_id, customer_name } = await req.json();

    if (!message || !message.trim()) {
      return Response.json({ detected: false });
    }

    const text = message.trim().toLowerCase();

    // Quick keyword pre-filter to avoid unnecessary LLM calls
    const keywords = [
      'ใบกำกับ', 'invoice', 'ใบกำกับภาษี', 'ออกใบ', 'ใบเสร็จ',
      'หัก ณ ที่จ่าย', 'หักณที่จ่าย', 'withholding', 'ภงด', 'ภ.ง.ด',
      'ประกันสังคม', 'สปส', 'เข้าประกัน', 'ออกประกัน', 'แจ้งเข้า', 'แจ้งออก',
      'พนักงานใหม่', 'ลาออก', 'สิ้นสุด'
    ];

    const hasKeyword = keywords.some(kw => text.includes(kw));
    if (!hasKeyword) {
      return Response.json({ detected: false });
    }

    // Use LLM to classify
    const prompt = `คุณเป็นระบบจัดหมวดหมู่คำขอจากลูกค้าสำนักงานบัญชี

ข้อความ: "${message}"

จงตรวจสอบว่าข้อความนี้เป็นคำขอ 1 ใน 4 ประเภทนี้หรือไม่:
1. tax_invoice = ขอออกใบกำกับภาษี / ใบเสร็จ / invoice
2. withholding_cert = ขอออกใบหัก ณ ที่จ่าย / ภงด / withholding certificate
3. sso_register = แจ้งเข้าประกันสังคม / พนักงานใหม่ต้องขึ้นทะเบียน สปส.
4. sso_terminate = แจ้งออกประกันสังคม / พนักงานลาออก/สิ้นสุดสัญญา ต้องแจ้งออก สปส.

ถ้าไม่ใช่คำขอใด ๆ ข้างต้น ให้ตอบ detected = false
ถ้าใช่ ให้สกัดรายละเอียดสำคัญ (ชื่อคน, จำนวนเงิน, วันที่, เลขที่เอกสาร ฯลฯ)`;

    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt,
      response_json_schema: {
        type: "object",
        properties: {
          detected: { type: "boolean", description: "true ถ้าเป็นคำขอ 4 ประเภท" },
          request_type: { type: "string", enum: ["tax_invoice", "withholding_cert", "sso_register", "sso_terminate"] },
          details: { type: "string", description: "รายละเอียดที่สกัดได้" }
        },
        required: ["detected"]
      }
    });

    if (!result || !result.detected) {
      return Response.json({ detected: false });
    }

    // Create LineRequest record
    const requestData = {
      request_type: result.request_type,
      status: 'pending',
      original_message: message,
      message_id: message_id || '',
      line_user_id: line_user_id || '',
      chat_type: chat_type || 'user',
      sender_name: sender_name || '',
      details: result.details || '',
      customer_id: customer_id || '',
      customer_name: customer_name || '',
    };

    const created = await base44.asServiceRole.entities.LineRequest.create(requestData);
    console.log(`Detected LINE request: ${result.request_type} from ${sender_name} — ID: ${created.id}`);

    return Response.json({ detected: true, request_type: result.request_type, request_id: created.id });
  } catch (error) {
    console.error('detectLineRequest error:', error.message);
    return Response.json({ detected: false, error: error.message }, { status: 200 });
  }
}