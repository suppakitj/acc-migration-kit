// invokeLLM — แทน base44.integrations.Core.InvokeLLM
// รับ { prompt, response_json_schema } → คืน object ตาม schema (หรือ { text })
import { callClaude } from '../_shared/anthropic.ts';
import { requireUser } from '../_shared/auth.ts';

Deno.serve(async (req) => {
  try {
    const me = await requireUser(req);
    if (!me) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { prompt, response_json_schema, max_tokens } = await req.json();
    if (!prompt) return Response.json({ error: 'prompt is required' }, { status: 400 });

    const out = await callClaude({ prompt, json_schema: response_json_schema, max_tokens });
    return Response.json(out);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
});
