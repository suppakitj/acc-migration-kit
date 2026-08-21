/**
 * anthropic.ts — เรียก Claude API แบบ structured output
 * ใช้โดย invokeLLM และ extractDataFromFile
 * API key อยู่ server-side (Deno.env) เท่านั้น — ห้ามให้ถึง browser
 */
const API_KEY = () => Deno.env.get('ANTHROPIC_API_KEY') ?? '';
const MODEL = () => Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-sonnet-4-5';

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'document'; source: { type: 'base64'; media_type: string; data: string } };

/**
 * เรียก Claude แล้วคืนผลลัพธ์
 * - ถ้าให้ json_schema มา → บังคับ structured output ผ่าน tool แล้วคืน object
 * - ถ้าไม่ให้ → คืน { text }
 */
export async function callClaude(opts: {
  prompt: string;
  content?: ContentBlock[];         // แนบรูป/เอกสารเพิ่ม (นอกจาก prompt)
  json_schema?: Record<string, unknown>;
  max_tokens?: number;
}): Promise<unknown> {
  const key = API_KEY();
  if (!key) throw new Error('ANTHROPIC_API_KEY ยังไม่ได้ตั้งค่าใน environment');

  const userContent: ContentBlock[] = [{ type: 'text', text: opts.prompt }, ...(opts.content ?? [])];

  const body: Record<string, unknown> = {
    model: MODEL(),
    max_tokens: opts.max_tokens ?? 4096,
    messages: [{ role: 'user', content: userContent }],
  };

  if (opts.json_schema) {
    // schema ของ Base44 บางครั้งเป็น array ที่ระดับบนสุด — Anthropic tool ต้องเป็น object
    const schema = opts.json_schema.type === 'array'
      ? { type: 'object', properties: { output: opts.json_schema }, required: ['output'] }
      : opts.json_schema;
    body.tools = [{ name: 'respond', description: 'ส่งผลลัพธ์แบบมีโครงสร้าง', input_schema: schema }];
    body.tool_choice = { type: 'tool', name: 'respond' };
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
  const data = await res.json();

  if (opts.json_schema) {
    const tool = data.content?.find((c: { type: string }) => c.type === 'tool_use');
    const input = tool?.input ?? {};
    // ถ้า schema เดิมเป็น array เราห่อไว้ใน { output } → คลายกลับ
    return opts.json_schema.type === 'array' ? (input.output ?? []) : input;
  }
  const text = data.content?.find((c: { type: string }) => c.type === 'text')?.text ?? '';
  return { text };
}
