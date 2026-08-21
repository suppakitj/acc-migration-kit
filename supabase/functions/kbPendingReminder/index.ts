import { createClientFromRequest } from '../_shared/base44-compat.ts';

/**
 * Remind managers about KB articles stuck in pending_review for 3+ days.
 * Sends LINE notification to accounting group + in-app notifications to managers.
 * Designed to run as a daily scheduled automation.
 */

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Fetch all KB articles and filter pending_review
    const allArticles = await base44.asServiceRole.entities.KnowledgeArticle.list('updated_date', 500);
    const pendingArticles = allArticles.filter(a => a.status === 'pending_review');

    if (pendingArticles.length === 0) {
      console.log('No pending KB articles');
      return Response.json({ message: 'No pending articles', reminded: 0 });
    }

    // Filter to articles pending for 3+ days
    const now = new Date();
    const overdue = pendingArticles.filter(a => {
      const updatedAt = new Date(a.updated_date);
      return (now - updatedAt) >= THREE_DAYS_MS;
    });

    if (overdue.length === 0) {
      console.log(`${pendingArticles.length} pending but none overdue yet`);
      return Response.json({ message: 'No overdue pending articles', total_pending: pendingArticles.length, reminded: 0 });
    }

    // Get managers for in-app notification
    const managerRoles = ['admin', 'management', 'manager', 'super_supervisor'];
    let managers = [];
    for (const role of managerRoles) {
      try {
        const usersWithRole = await base44.asServiceRole.entities.User.filter({ role }, '-created_date', 20);
        managers = managers.concat(usersWithRole);
      } catch { /* skip */ }
    }

    // Get LINE group ID
    const configs = await base44.asServiceRole.entities.AppConfig.list('-created_date', 50);
    const groupId = configs.find(c => c.key === 'line_group_dept_accounting')?.value;

    // Build summary
    const articleList = overdue.map((a, i) => {
      const daysAgo = Math.floor((now - new Date(a.updated_date)) / (24 * 60 * 60 * 1000));
      return `${i + 1}. ${a.title} (${a.author_name || '-'}, ${daysAgo} วัน)`;
    }).join('\n');

    // Send LINE notification
    if (groupId) {
      await base44.asServiceRole.functions.invoke('lineSendMessage', {
        line_user_id: groupId,
        message: `⏰ KB รออนุมัติเกิน 3 วัน\n━━━━━━━━━━━━━━━━\n📋 ${overdue.length} บทความรอตรวจสอบ:\n${articleList}\n━━━━━━━━━━━━━━━━\nกรุณาตรวจสอบและอนุมัติ`,
        display_name: 'ACC Precision Hub',
        chat_type: 'group',
      });
      console.log('LINE reminder sent');
    }

    // Send in-app notifications to managers
    for (const mgr of managers.slice(0, 5)) {
      await base44.asServiceRole.entities.Notification.create({
        title: `⏰ KB รออนุมัติ ${overdue.length} บทความ (เกิน 3 วัน)`,
        message: `มี ${overdue.length} บทความ KB ที่รออนุมัติเกิน 3 วัน กรุณาตรวจสอบ`,
        type: 'task_assigned',
        target_user: mgr.email,
        related_entity_type: 'KnowledgeArticle',
      });
    }

    console.log(`Reminded ${overdue.length} overdue KB articles to ${managers.length} managers`);

    return Response.json({
      total_pending: pendingArticles.length,
      reminded: overdue.length,
      managers_notified: managers.length,
    });
  } catch (error) {
    console.error('kbPendingReminder error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});