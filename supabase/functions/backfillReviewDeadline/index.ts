import { createClientFromRequest } from '../_shared/base44-compat.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    // Fetch holidays
    const holidays = await base44.asServiceRole.entities.HolidayMaster.filter({ status: 'active' });
    const holidayDates = new Set(
      holidays.filter(h => h.date).map(h => h.date.split('T')[0])
    );

    function calcReviewDeadline(dueDate) {
      if (!dueDate) return null;
      let d = new Date(dueDate.split('T')[0] + 'T00:00:00');
      let added = 0;
      while (added < 2) {
        d.setDate(d.getDate() + 1);
        const day = d.getDay();
        const dateStr = d.toISOString().split('T')[0];
        if (day !== 0 && day !== 6 && !holidayDates.has(dateStr)) {
          added++;
        }
      }
      return d.toISOString().split('T')[0];
    }

    // Fetch all tasks with status = review and no review_deadline
    const allTasks = await base44.asServiceRole.entities.Task.filter({});
    const reviewTasks = allTasks.filter(t => t.status === 'review' && !t.review_deadline && t.due_date);

    let updated = 0;
    for (const task of reviewTasks) {
      const deadline = calcReviewDeadline(task.due_date);
      if (deadline) {
        await base44.asServiceRole.entities.Task.update(task.id, { review_deadline: deadline });
        updated++;
        console.log(`Updated task ${task.id} "${task.title}" → review_deadline: ${deadline}`);
      }
    }

    console.log(`Backfill complete: ${updated}/${reviewTasks.length} tasks updated`);
    return Response.json({
      status: 'ok',
      total_review_tasks: reviewTasks.length,
      updated,
    });
  } catch (error) {
    console.error('backfillReviewDeadline error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});