import { createClientFromRequest } from '../_shared/base44-compat.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const requestedLimit = Math.min(body.limit || 500, 2000);
    const requestedOffset = Math.max(body.offset || 0, 0);

    // Fetch in smaller batches to avoid JSON serialization issues
    // Large payloads with special characters (quotes, unicode) can cause truncation
    const BATCH_SIZE = 50;
    const allMessages = [];
    let offset = 0;
    let fetchMore = true;

    while (fetchMore && allMessages.length < requestedLimit) {
      const batchLimit = Math.min(BATCH_SIZE, requestedLimit - allMessages.length);
      
      let batch;
      try {
        batch = await base44.asServiceRole.entities.LineMessage.filter(
          {},
          '-created_date',
          batchLimit,
          requestedOffset + offset
        );
      } catch (fetchErr) {
        console.error(`Batch fetch error at offset ${offset}:`, fetchErr.message);
        break;
      }

      // Handle SDK returning string instead of array
      if (typeof batch === 'string') {
        try {
          batch = JSON.parse(batch);
        } catch (parseErr) {
          console.error(`JSON parse failed at offset ${offset}, length=${batch.length}:`, parseErr.message);
          // Try a safer approach: wrap in try-catch per-record
          batch = safeParseJsonArray(batch);
        }
      }

      if (!Array.isArray(batch) || batch.length === 0) {
        fetchMore = false;
        break;
      }

      allMessages.push(...batch);
      offset += batch.length;

      // If we got fewer than requested, there are no more records
      if (batch.length < batchLimit) {
        fetchMore = false;
      }
    }

    return Response.json({ messages: allMessages });
  } catch (error) {
    console.error('List LINE messages error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

/**
 * Safely parse a JSON string that might be a malformed array.
 * Attempts to extract as many valid objects as possible.
 */
function safeParseJsonArray(str) {
  if (!str || typeof str !== 'string') return [];
  
  const items = [];
  let depth = 0;
  let start = -1;

  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    
    // Skip escaped characters
    if (ch === '\\') {
      i++;
      continue;
    }
    
    // Skip string contents
    if (ch === '"') {
      i++;
      while (i < str.length) {
        if (str[i] === '\\') { i++; }
        else if (str[i] === '"') break;
        i++;
      }
      continue;
    }
    
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        const candidate = str.slice(start, i + 1);
        try {
          items.push(JSON.parse(candidate));
        } catch {
          // Skip malformed object
        }
        start = -1;
      }
    }
  }
  
  console.log(`safeParseJsonArray recovered ${items.length} items from ${str.length} chars`);
  return items;
}