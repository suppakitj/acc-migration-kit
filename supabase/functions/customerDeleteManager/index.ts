import { createClientFromRequest } from '../_shared/base44-compat.ts';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { action, customer_id, reason, reject_reason } = body;

  // === REQUEST DELETE (non-admin) ===
  if (action === 'request_delete') {
    await base44.entities.Customer.update(customer_id, {
      delete_requested: true,
      delete_requested_by: user.email,
      delete_requested_by_name: user.full_name || user.email,
      delete_requested_at: new Date().toISOString(),
      delete_reason: reason || '',
    });

    // Notify admins
    const allUsers = await base44.asServiceRole.entities.User.filter({});
    const admins = allUsers.filter(u => u.role === 'admin');
    const custs = await base44.entities.Customer.filter({ id: customer_id });
    const cust = custs?.[0];
    for (const admin of admins.slice(0, 5)) {
      base44.asServiceRole.entities.Notification.create({
        title: '🏢 ขออนุมัติลบลูกค้า',
        message: `${user.full_name || user.email} ขอลบลูกค้า "${cust?.company_name || ''}" — เหตุผล: ${reason || '-'}`,
        type: 'system',
        target_user: admin.email,
        related_entity_type: 'Customer',
        related_entity_id: customer_id,
        customer_name: cust?.company_name || '',
      }).catch(() => {});
    }

    // Audit log
    base44.asServiceRole.entities.AuditLog.create({
      action: 'request_delete',
      entity_type: 'Customer',
      entity_id: customer_id,
      entity_name: cust?.company_name || '',
      user_email: user.email,
      user_name: user.full_name || user.email,
      details: `ขอลบลูกค้า "${cust?.company_name || ''}" — เหตุผล: ${reason || '-'}`,
    }).catch(() => {});

    return Response.json({ success: true });
  }

  // === CANCEL DELETE ===
  if (action === 'cancel_delete') {
    await base44.entities.Customer.update(customer_id, {
      delete_requested: false,
      delete_requested_by: '',
      delete_requested_by_name: '',
      delete_requested_at: '',
      delete_reason: '',
    });
    return Response.json({ success: true });
  }

  // === APPROVE DELETE (admin only) ===
  if (action === 'approve_delete') {
    if (user.role !== 'admin') {
      return Response.json({ error: 'ต้องเป็น Admin เท่านั้น' }, { status: 403 });
    }
    const custs = await base44.entities.Customer.filter({ id: customer_id });
    const cust = custs?.[0];

    await base44.entities.Customer.delete(customer_id);

    // Notify requester
    if (cust?.delete_requested_by) {
      base44.asServiceRole.entities.Notification.create({
        title: '✅ อนุมัติลบลูกค้าแล้ว',
        message: `Admin ${user.full_name || user.email} อนุมัติลบลูกค้า "${cust?.company_name || ''}"`,
        type: 'system',
        target_user: cust.delete_requested_by,
        customer_name: cust?.company_name || '',
      }).catch(() => {});
    }

    base44.asServiceRole.entities.AuditLog.create({
      action: 'approve_delete',
      entity_type: 'Customer',
      entity_id: customer_id,
      entity_name: cust?.company_name || '',
      user_email: user.email,
      user_name: user.full_name || user.email,
      details: `อนุมัติลบลูกค้า "${cust?.company_name || ''}" — ขอโดย: ${cust?.delete_requested_by_name || ''}`,
    }).catch(() => {});

    return Response.json({ success: true });
  }

  // === REJECT DELETE (admin only) ===
  if (action === 'reject_delete') {
    if (user.role !== 'admin') {
      return Response.json({ error: 'ต้องเป็น Admin เท่านั้น' }, { status: 403 });
    }
    const custs = await base44.entities.Customer.filter({ id: customer_id });
    const cust = custs?.[0];

    await base44.entities.Customer.update(customer_id, {
      delete_requested: false,
      delete_requested_by: '',
      delete_requested_by_name: '',
      delete_requested_at: '',
      delete_reason: '',
    });

    if (cust?.delete_requested_by) {
      base44.asServiceRole.entities.Notification.create({
        title: '❌ ไม่อนุมัติลบลูกค้า',
        message: `Admin ${user.full_name || user.email} ไม่อนุมัติลบลูกค้า "${cust?.company_name || ''}" — เหตุผล: ${reject_reason || '-'}`,
        type: 'system',
        target_user: cust.delete_requested_by,
        customer_name: cust?.company_name || '',
      }).catch(() => {});
    }

    base44.asServiceRole.entities.AuditLog.create({
      action: 'reject_delete',
      entity_type: 'Customer',
      entity_id: customer_id,
      entity_name: cust?.company_name || '',
      user_email: user.email,
      user_name: user.full_name || user.email,
      details: `ปฏิเสธลบลูกค้า "${cust?.company_name || ''}" — เหตุผล: ${reject_reason || '-'}`,
    }).catch(() => {});

    return Response.json({ success: true });
  }

  // === DELETE (admin direct) ===
  if (action === 'delete') {
    if (user.role !== 'admin') {
      return Response.json({ error: 'ต้องเป็น Admin เท่านั้น' }, { status: 403 });
    }
    const custs = await base44.entities.Customer.filter({ id: customer_id });
    const cust = custs?.[0];

    await base44.entities.Customer.delete(customer_id);

    base44.asServiceRole.entities.AuditLog.create({
      action: 'delete',
      entity_type: 'Customer',
      entity_id: customer_id,
      entity_name: cust?.company_name || '',
      user_email: user.email,
      user_name: user.full_name || user.email,
      details: `ลบลูกค้า "${cust?.company_name || ''}" (admin direct)`,
    }).catch(() => {});

    return Response.json({ success: true });
  }

  return Response.json({ error: 'Invalid action' }, { status: 400 });
});