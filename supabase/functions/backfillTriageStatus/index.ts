import { createClientFromRequest } from '../_shared/base44-compat.ts';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const cutoffDate = new Date().toISOString();
    let totalUpdated = 0;
    let hasMore = true;

    while (hasMore) {
      const result = await base44.asServiceRole.entities.LineMessage.updateMany(
        { triage_status: { $exists: false } },
        {
          $set: {
            triage_status: 'dismissed',
            dismiss_reason: 'backfill: ก่อนเปิดระบบคัดกรอง',
            dismissed_at: cutoffDate
          }
        }
      );
      totalUpdated += result.modified_count || 0;
      hasMore = result.has_more === true;
    }

    // Also dismiss records that have triage_status = 'new' from before cutoff
    hasMore = true;
    while (hasMore) {
      const result = await base44.asServiceRole.entities.LineMessage.updateMany(
        { triage_status: 'new', created_date: { $lt: cutoffDate } },
        {
          $set: {
            triage_status: 'dismissed',
            dismiss_reason: 'backfill: ก่อนเปิดระบบคัดกรอง',
            dismissed_at: cutoffDate
          }
        }
      );
      totalUpdated += result.modified_count || 0;
      hasMore = result.has_more === true;
    }

    console.log(`Backfill complete: ${totalUpdated} messages marked as dismissed`);
    return Response.json({ success: true, total_updated: totalUpdated, cutoff: cutoffDate });
  } catch (error) {
    console.error('backfillTriageStatus error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
}