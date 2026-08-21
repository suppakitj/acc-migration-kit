import { createClientFromRequest } from '../_shared/base44-compat.ts';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function updateWithRetry(sdk, id, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      await sdk.asServiceRole.entities.LineMessage.update(id, { is_read: true });
      return true;
    } catch (e) {
      if (e.status === 429 && attempt < retries - 1) {
        // Exponential backoff: 3s, 6s, 12s
        await sleep(3000 * Math.pow(2, attempt));
      } else {
        console.warn(`Skip ${id}: ${e.message}`);
        return false;
      }
    }
  }
  return false;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin only' }, { status: 403 });
    }

    // Fetch one batch of unread messages (max 20 to stay within rate limits)
    const batch = await base44.asServiceRole.entities.LineMessage.filter(
      { is_read: false, direction: 'incoming' }, '-created_date', 20
    );

    if (batch.length === 0) {
      return Response.json({ status: 'ok', marked: 0, remaining: 0 });
    }

    let marked = 0;
    for (const msg of batch) {
      const ok = await updateWithRetry(base44, msg.id);
      if (ok) marked++;
      // 1 second gap between each update
      await sleep(1000);
    }

    // Check if there are more
    const remaining = await base44.asServiceRole.entities.LineMessage.filter(
      { is_read: false, direction: 'incoming' }, '-created_date', 1
    );

    return Response.json({
      status: 'ok',
      marked,
      remaining: remaining.length > 0 ? 'more' : 0,
    });
  } catch (error) {
    console.error('markAllLineRead error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});