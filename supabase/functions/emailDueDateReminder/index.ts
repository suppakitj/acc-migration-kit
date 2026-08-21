import { createClientFromRequest } from '../_shared/base44-compat.ts';

const SERVICE_LABELS = {
  accounting: 'ทำบัญชี',
  payroll: 'เงินเดือน',
  tax_consulting: 'ที่ปรึกษาภาษี',
  audit: 'ตรวจสอบบัญชี',
  peak_licensing: 'Peak Account',
};

const PRIORITY_LABELS = {
  low: 'ต่ำ',
  medium: 'ปานกลาง',
  high: 'สูง ⚠️',
  urgent: 'เร่งด่วน 🔴',
};

const DEPT_LABELS = {
  management: 'Management',
  accounting: 'บัญชี',
  consulting: 'ที่ปรึกษา',
  audit: 'Audit',
  billing: 'Billing',
  it: 'IT',
};

function getBangkokDate() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
}

function dateDiffDays(dueStr, today) {
  const due = new Date(dueStr + 'T00:00:00');
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((due - todayMidnight) / (1000 * 60 * 60 * 24));
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return d.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
}

function buildEmailHTML(recipientName, tasks, senderName, contextLabel) {
  const taskRows = tasks.map(t => {
    let urgencyColor, urgencyLabel;
    if (t.daysLeft < 0) {
      urgencyColor = '#dc2626';
      urgencyLabel = `เกินกำหนด ${Math.abs(t.daysLeft)} วัน`;
    } else if (t.daysLeft <= 3) {
      urgencyColor = '#ea580c';
      urgencyLabel = `อีก ${t.daysLeft} วัน`;
    } else {
      urgencyColor = '#d97706';
      urgencyLabel = `อีก ${t.daysLeft} วัน`;
    }

    return `
      <tr>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; font-size: 13px; color: #334155;">${t.title}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; font-size: 13px; color: #334155;">${t.customer_name || '-'}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; font-size: 13px; color: #334155;">${SERVICE_LABELS[t.service_type] || t.service_type || '-'}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; font-size: 13px; color: #334155;">${t.assigned_name || t.assigned_to || '-'}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; font-size: 13px; color: #334155;">${formatDate(t.due_date)}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; font-size: 13px;"><span style="color: ${urgencyColor}; font-weight: 600;">${urgencyLabel}</span></td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; font-size: 13px; color: #334155;">${PRIORITY_LABELS[t.priority] || t.priority || '-'}</td>
      </tr>
    `;
  }).join('');

  const overdueCount = tasks.filter(t => t.daysLeft < 0).length;
  const dueSoonCount = tasks.filter(t => t.daysLeft >= 0 && t.daysLeft <= 3).length;
  const dueWeekCount = tasks.filter(t => t.daysLeft > 3 && t.daysLeft <= 7).length;

  return `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 750px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #0f172a 0%, #1e3a5f 50%, #2563eb 100%); padding: 28px; border-radius: 12px 12px 0 0; text-align: center;">
        <h1 style="color: #ffffff; margin: 0; font-size: 22px; letter-spacing: 0.5px;">${senderName}</h1>
        <p style="color: #93c5fd; margin: 8px 0 0; font-size: 13px;">📋 แจ้งเตือนกำหนดส่งงาน — Due Date Reminder</p>
      </div>
      <div style="background: #ffffff; padding: 28px; border: 1px solid #e2e8f0; border-top: none;">
        <p style="color: #334155; font-size: 14px; line-height: 1.7;">
          สวัสดีค่ะ <strong>${recipientName}</strong>,
        </p>
        <p style="color: #475569; font-size: 13px; line-height: 1.7;">
          ${contextLabel}
        </p>

        ${overdueCount > 0 ? `<div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 12px 15px; margin: 12px 0;">
          <p style="margin: 0; color: #991b1b; font-size: 13px; font-weight: 600;">🔴 เกินกำหนดแล้ว ${overdueCount} งาน</p>
        </div>` : ''}
        ${dueSoonCount > 0 ? `<div style="background: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px; padding: 12px 15px; margin: 12px 0;">
          <p style="margin: 0; color: #9a3412; font-size: 13px; font-weight: 600;">🟠 ใกล้กำหนด (≤3 วัน) ${dueSoonCount} งาน</p>
        </div>` : ''}
        ${dueWeekCount > 0 ? `<div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 12px 15px; margin: 12px 0;">
          <p style="margin: 0; color: #92400e; font-size: 13px; font-weight: 600;">🟡 กำหนดภายใน 7 วัน ${dueWeekCount} งาน</p>
        </div>` : ''}

        <table style="width: 100%; border-collapse: collapse; margin: 18px 0; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
          <thead>
            <tr style="background: #f1f5f9;">
              <th style="padding: 10px 12px; text-align: left; font-size: 11px; color: #64748b; font-weight: 600; border-bottom: 2px solid #e2e8f0;">ชื่องาน</th>
              <th style="padding: 10px 12px; text-align: left; font-size: 11px; color: #64748b; font-weight: 600; border-bottom: 2px solid #e2e8f0;">ลูกค้า</th>
              <th style="padding: 10px 12px; text-align: left; font-size: 11px; color: #64748b; font-weight: 600; border-bottom: 2px solid #e2e8f0;">บริการ</th>
              <th style="padding: 10px 12px; text-align: left; font-size: 11px; color: #64748b; font-weight: 600; border-bottom: 2px solid #e2e8f0;">ผู้รับผิดชอบ</th>
              <th style="padding: 10px 12px; text-align: left; font-size: 11px; color: #64748b; font-weight: 600; border-bottom: 2px solid #e2e8f0;">กำหนดส่ง</th>
              <th style="padding: 10px 12px; text-align: left; font-size: 11px; color: #64748b; font-weight: 600; border-bottom: 2px solid #e2e8f0;">สถานะ</th>
              <th style="padding: 10px 12px; text-align: left; font-size: 11px; color: #64748b; font-weight: 600; border-bottom: 2px solid #e2e8f0;">ความสำคัญ</th>
            </tr>
          </thead>
          <tbody>
            ${taskRows}
          </tbody>
        </table>

        <p style="color: #94a3b8; font-size: 12px; margin-bottom: 0; margin-top: 20px;">
          ขอบคุณค่ะ — <strong>${senderName}</strong>
        </p>
      </div>
      <div style="background: #f8fafc; padding: 12px 28px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px; text-align: center;">
        <p style="color: #94a3b8; font-size: 10px; margin: 0;">อีเมลนี้ส่งโดยอัตโนมัติจากระบบ ${senderName} — กรุณาอย่าตอบกลับ</p>
      </div>
    </div>
  `;
}

/**
 * Get all departments a user belongs to
 */
function getUserDepts(user) {
  const depts = new Set();
  if (user.departments?.length) user.departments.forEach(d => depts.add(d));
  if (user.department) depts.add(user.department);
  return [...depts];
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Fetch config
    const configs = await base44.asServiceRole.entities.AppConfig.filter({});
    const getVal = (key) => configs.find(c => c.key === key)?.value || '';
    const senderName = getVal('o365_sender_name') || getVal('smtp_sender_name') || 'ACC Consulting';
    const emailSubject = getVal('o365_email_subject') || getVal('smtp_email_subject') || '[ACC Consulting] แจ้งเตือนกำหนดส่งงาน';

    const today = getBangkokDate();

    // Fetch all active tasks that are NOT completed/cancelled and have a due_date
    const allTasks = await base44.asServiceRole.entities.Task.filter({});
    const alertTasks = allTasks
      .filter(t => t.due_date && t.status !== 'completed' && t.status !== 'cancelled')
      .map(t => {
        // งาน review → ใช้ review_deadline แทน due_date
        const effectiveDate = t.status === 'review'
          ? (t.review_deadline || null)
          : t.due_date;
        if (!effectiveDate) return null;
        return { ...t, daysLeft: dateDiffDays(effectiveDate, today) };
      })
      .filter(t => t && t.daysLeft <= 7);

    if (alertTasks.length === 0) {
      console.log('No tasks approaching due date. Skipping email.');
      return Response.json({ status: 'skipped', message: 'ไม่มีงานใกล้กำหนด — ข้ามการส่งอีเมล' });
    }

    // Fetch all users
    const allUsers = await base44.asServiceRole.entities.User.filter({});
    const activeUsers = allUsers.filter(u => u.user_status !== 'inactive');

    // Build user lookup by email
    const userByEmail = {};
    for (const u of activeUsers) {
      if (u.email) userByEmail[u.email] = u;
    }

    // Categorize users by role
    const managementUsers = activeUsers.filter(u => u.role === 'management' || u.role === 'admin');
    const managersByDept = {};  // dept -> [user]
    const superSupervisorsByDept = {}; // dept -> [user]

    for (const u of activeUsers) {
      if (u.role === 'manager' || u.role === 'super_supervisor') {
        const depts = getUserDepts(u);
        for (const dept of depts) {
          if (u.role === 'manager') {
            if (!managersByDept[dept]) managersByDept[dept] = [];
            managersByDept[dept].push(u);
          }
          if (u.role === 'super_supervisor') {
            if (!superSupervisorsByDept[dept]) superSupervisorsByDept[dept] = [];
            superSupervisorsByDept[dept].push(u);
          }
        }
      }
    }

    // Build per-recipient task lists
    // Key: email -> { user, tasks: Set<taskId>, taskList: [] }
    const recipientMap = {};

    function addTaskToRecipient(email, userName, task) {
      if (!email) return;
      if (!recipientMap[email]) {
        recipientMap[email] = { userName, tasks: new Set(), taskList: [] };
      }
      if (!recipientMap[email].tasks.has(task.id)) {
        recipientMap[email].tasks.add(task.id);
        recipientMap[email].taskList.push(task);
      }
    }

    for (const task of alertTasks) {
      const taskDept = task.department;

      // 1) เจ้าของงาน (assigned_to)
      if (task.assigned_to) {
        const owner = userByEmail[task.assigned_to];
        addTaskToRecipient(task.assigned_to, owner?.full_name || task.assigned_name || task.assigned_to, task);
      }

      // 2) Manager ของแผนกเดียวกับงาน
      if (taskDept && managersByDept[taskDept]) {
        for (const mgr of managersByDept[taskDept]) {
          addTaskToRecipient(mgr.email, mgr.full_name || mgr.email, task);
        }
      }

      // 3) Super Supervisor ของแผนกเดียวกับงาน
      if (taskDept && superSupervisorsByDept[taskDept]) {
        for (const ss of superSupervisorsByDept[taskDept]) {
          addTaskToRecipient(ss.email, ss.full_name || ss.email, task);
        }
      }

      // 4) Management / Admin ได้ทุกงาน
      for (const mgtUser of managementUsers) {
        addTaskToRecipient(mgtUser.email, mgtUser.full_name || mgtUser.email, task);
      }
    }

    // Send emails
    let sentCount = 0;
    const errors = [];

    for (const [email, data] of Object.entries(recipientMap)) {
      const { userName, taskList } = data;

      // Sort: overdue first, then ascending daysLeft
      taskList.sort((a, b) => a.daysLeft - b.daysLeft);

      // Determine context label based on user role
      const user = userByEmail[email];
      let contextLabel;
      if (user?.role === 'management' || user?.role === 'admin') {
        contextLabel = 'ด้านล่างนี้คือสรุปงานทั้งหมดในระบบที่ใกล้ถึงกำหนดส่งหรือเลยกำหนดแล้ว กรุณาตรวจสอบและติดตามการดำเนินงานค่ะ';
      } else if (user?.role === 'manager' || user?.role === 'super_supervisor') {
        const depts = getUserDepts(user).map(d => DEPT_LABELS[d] || d).join(', ');
        contextLabel = `ด้านล่างนี้คือสรุปงานในแผนก ${depts} ที่ใกล้ถึงกำหนดส่งหรือเลยกำหนดแล้ว กรุณาตรวจสอบและติดตามทีมงานค่ะ`;
      } else {
        contextLabel = 'ด้านล่างนี้คืองานที่คุณรับผิดชอบ ซึ่งใกล้ถึงกำหนดส่งหรือเลยกำหนดแล้ว กรุณาตรวจสอบและดำเนินการให้แล้วเสร็จด้วยค่ะ';
      }

      try {
        await base44.asServiceRole.integrations.Core.SendEmail({
          from_name: senderName,
          to: email,
          subject: `${emailSubject} (${taskList.length} งาน)`,
          body: buildEmailHTML(userName, taskList, senderName, contextLabel),
        });
        sentCount++;
        console.log(`Sent due date reminder to ${email} — ${taskList.length} tasks`);
      } catch (e) {
        errors.push(`${email}: ${e.message}`);
        console.error(`Failed to send to ${email}:`, e.message);
      }
    }

    // Create one notification record for admins
    for (const mgtUser of managementUsers) {
      if (!mgtUser.email) continue;
      await base44.asServiceRole.entities.Notification.create({
        title: `📧 ส่งอีเมลแจ้งเตือน Due Date อัตโนมัติ`,
        message: `ส่งอีเมลแจ้งเตือน ${alertTasks.length} งานใกล้กำหนด ไปยัง ${sentCount} คน`,
        type: 'system',
        target_user: mgtUser.email,
        is_read: false,
      });
    }

    const summary = {
      status: 'completed',
      date: today.toISOString(),
      total_alert_tasks: alertTasks.length,
      recipients: Object.keys(recipientMap).length,
      emails_sent: sentCount,
      errors: errors.length > 0 ? errors : undefined,
    };

    console.log('Email Due Date Reminder completed:', JSON.stringify(summary));
    return Response.json(summary);

  } catch (error) {
    console.error('emailDueDateReminder error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});