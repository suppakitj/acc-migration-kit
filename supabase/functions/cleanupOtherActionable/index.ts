import { createClientFromRequest } from '../_shared/base44-compat.ts';

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    let totalUpdated = 0;
    let hasMore = true;
    while (hasMore) {
      const result = await base44.asServiceRole.entities.LineMessage.updateMany(
        { triage_status: 'new', is_actionable: true, request_type: 'other' },
        { $set: { is_actionable: false } }
      );
      totalUpdated += result.modified_count || 0;
      hasMore = result.has_more === true;
    }

    console.log(`cleanupOtherActionable: ${totalUpdated} messages fixed`);
    return Response.json({ success: true, total_updated: totalUpdated });
  } catch (error) {
    console.error('cleanupOtherActionable error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
}