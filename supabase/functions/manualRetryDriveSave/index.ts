import { createClientFromRequest } from '../_shared/base44-compat.ts';

/**
 * Manual retry for failed Drive saves.
 * Resets retry count for messages that have failed (retry >= 1),
 * then lets the scheduled retryDriveSave pick them up.
 * Admin only.
 */

const BATCH_SIZE = 5;
const DELAY_BETWEEN = 1500; // ms between batches

async function updateWithRetry(base44, id, data, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await base44.asServiceRole.entities.LineMessage.update(id, data);
      return true;
    } catch (e) {
      const is429 = e?.message?.includes('Rate limit') || e?.response?.status === 429;
      if (is429 && attempt < maxAttempts) {
        await new Promise(r => setTimeout(r, 2000 * attempt));
        continue;
      }
      console.error(`Failed to reset message ${id}: ${e.message}`);
      return false;
    }
  }
  return false;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    // Find all incoming image/file messages that failed (drive_saved=false, retry >= 1)
    let allUnsaved = [];
    let skip = 0;
    const PAGE_SIZE = 100;
    while (true) {
      const page = await base44.asServiceRole.entities.LineMessage.filter(
        { drive_saved: false, direction: 'incoming' },
        '-created_date',
        PAGE_SIZE,
        skip
      );
      if (!Array.isArray(page) || page.length === 0) break;
      allUnsaved = allUnsaved.concat(page);
      if (page.length < PAGE_SIZE) break;
      skip += PAGE_SIZE;
      if (allUnsaved.length >= 1000) break;
      await new Promise(r => setTimeout(r, 500));
    }

    const toRetry = allUnsaved.filter(m =>
      m.file_url &&
      (m.message_type === 'image' || m.message_type === 'file') &&
      (m.drive_retry_count || 0) >= 1
    );

    if (toRetry.length === 0) {
      return Response.json({ message: 'ไม่มีไฟล์ที่ล้มเหลวให้ retry', retried: 0, success: 0, failed: 0 });
    }

    console.log(`Manual retry: found ${toRetry.length} failed messages — resetting retry counts`);

    // Reset retry counts sequentially in small batches with delay
    let resetOk = 0;
    let resetFail = 0;
    for (let i = 0; i < toRetry.length; i += BATCH_SIZE) {
      const batch = toRetry.slice(i, i + BATCH_SIZE);
      // Process each item in the batch sequentially to avoid rate limits
      for (const msg of batch) {
        const ok = await updateWithRetry(base44, msg.id, { drive_retry_count: 0 });
        if (ok) resetOk++;
        else resetFail++;
      }
      if (i + BATCH_SIZE < toRetry.length) {
        await new Promise(r => setTimeout(r, DELAY_BETWEEN));
      }
    }

    console.log(`Reset complete: ${resetOk} success, ${resetFail} failed`);

    return Response.json({
      retried: resetOk,
      reset_failed: resetFail,
      success: 0,
      failed: 0,
      message: `รีเซ็ต ${resetOk} ไฟล์แล้ว — ระบบจะ retry อัตโนมัติทุก 2 ชม.`,
    });
  } catch (error) {
    console.error('manualRetryDriveSave error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});