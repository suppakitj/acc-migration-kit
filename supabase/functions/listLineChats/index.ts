import { createClientFromRequest } from '../_shared/base44-compat.ts';

async function fetchBatch(base44, offset, limit) {
  for (let i = 0; i < 3; i++) {
    try {
      const batch = await base44.asServiceRole.entities.LineMessage.filter(
        {},
        '-created_date',
        limit,
        offset
      );
      const parsed = typeof batch === 'string' ? JSON.parse(batch) : batch;
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      if (e.message?.includes('Rate limit') && i < 2) {
        await new Promise(r => setTimeout(r, 2000 * (i + 1)));
        continue;
      }
      console.error(`Fetch error at offset ${offset}, attempt ${i}:`, e.message);
      return null; // signal error (vs empty = no more data)
    }
  }
  return null;
}

function processMessages(messages, chats) {
  for (const m of messages) {
    const key = m.line_user_id || m.customer_name || 'unknown';
    if (!chats[key]) {
      chats[key] = {
        id: key,
        name: m.display_name || m.customer_name || '?',
        image: m.profile_image || '',
        chatType: m.chat_type || 'user',
        lastDate: m.created_date,
        lastContent: m.content || '',
        lastMessageType: m.message_type || 'text',
        lastDirection: m.direction || 'incoming',
        unread: 0,
        totalMessages: 0,
      };
    }
    const chat = chats[key];
    chat.totalMessages++;
    if ((m.created_date || '') > (chat.lastDate || '')) {
      chat.lastDate = m.created_date;
      chat.lastContent = m.content || '';
      chat.lastMessageType = m.message_type || 'text';
      chat.lastDirection = m.direction || 'incoming';
    }
    if (m.display_name && (m.created_date || '') >= (chat.lastDate || '')) {
      chat.name = m.display_name;
    }
    if (m.profile_image && !chat.image) chat.image = m.profile_image;
    if (!m.is_read && m.direction === 'incoming') chat.unread++;
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const chats = {};
    let totalFetched = 0;

    // Phase 1: Quick scan — fetch first 500 messages (newest first)
    // This catches all active chats and gives us accurate unread counts for recent messages
    const firstBatch = await fetchBatch(base44, 0, 50);
    if (firstBatch) {
      processMessages(firstBatch, chats);
      totalFetched += firstBatch.length;
    }

    // Continue fetching in batches of 50 to reach ~500 messages for the quick scan
    for (let offset = 50; offset < 500; offset += 50) {
      await new Promise(r => setTimeout(r, 300));
      const batch = await fetchBatch(base44, offset, 50);
      if (!batch || batch.length === 0) break;
      processMessages(batch, chats);
      totalFetched += batch.length;
      if (batch.length < 50) break;
    }

    const quickChatCount = Object.keys(chats).length;
    console.log(`Quick scan: ${totalFetched} msgs, ${quickChatCount} chats`);

    // Phase 2: Deep scan — continue scanning to discover older chats
    // Use larger gaps to save time: check every 500th batch to find remaining chats
    let offset = totalFetched;
    let batchesWithoutNewChat = 0;
    const MAX_STALE = 15;

    while (batchesWithoutNewChat < MAX_STALE && offset < 20000) {
      await new Promise(r => setTimeout(r, 400));
      const batch = await fetchBatch(base44, offset, 50);
      if (batch === null) {
        batchesWithoutNewChat++;
        offset += 50;
        continue;
      }
      if (batch.length === 0) break;

      const prevCount = Object.keys(chats).length;
      processMessages(batch, chats);
      totalFetched += batch.length;
      offset += batch.length;

      if (Object.keys(chats).length > prevCount) {
        batchesWithoutNewChat = 0;
      } else {
        batchesWithoutNewChat++;
      }

      if (batch.length < 50) break;
    }

    console.log(`Total: ${totalFetched} msgs, ${Object.keys(chats).length} chats (deep scan added ${Object.keys(chats).length - quickChatCount})`);

    const chatList = Object.values(chats).sort((a, b) => {
      if (a.unread > 0 && b.unread === 0) return -1;
      if (a.unread === 0 && b.unread > 0) return 1;
      return (b.lastDate || '').localeCompare(a.lastDate || '');
    });

    return Response.json({ chats: chatList, total: chatList.length });
  } catch (error) {
    console.error('listLineChats error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});