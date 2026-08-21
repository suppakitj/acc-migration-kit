import { createClientFromRequest } from '../_shared/base44-compat.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { messageIds } = await req.json();
    if (!messageIds || !Array.isArray(messageIds) || messageIds.length === 0) {
      return Response.json({ status: 'ok' });
    }

    // Use service role to update messages created by webhook
    for (const id of messageIds) {
      await base44.asServiceRole.entities.LineMessage.update(id, { is_read: true });
    }

    return Response.json({ status: 'ok', updated: messageIds.length });
  } catch (error) {
    console.error('Mark read error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});