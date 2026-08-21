import { createClientFromRequest } from '../_shared/base44-compat.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const currentUser = await base44.auth.me();

    if (!currentUser) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const allowedRoles = ['admin', 'management', 'manager'];
    if (!allowedRoles.includes(currentUser.role)) {
      return Response.json({ error: 'Forbidden: Admin/Management/Manager access required' }, { status: 403 });
    }

    const { userId, data } = await req.json();

    if (!userId || !data) {
      return Response.json({ error: 'Missing userId or data' }, { status: 400 });
    }

    // Separate role from other fields — role requires special handling
    const { role, ...otherData } = data;

    // Update non-role fields first
    if (Object.keys(otherData).length > 0) {
      await base44.asServiceRole.entities.User.update(userId, otherData);
    }

    // Update role separately if provided
    if (role !== undefined) {
      try {
        await base44.asServiceRole.entities.User.update(userId, { role });
      } catch (roleErr) {
        console.warn('Role update skipped (platform restriction):', roleErr.message);
        // Still return success for other fields, but note role wasn't updated
        return Response.json({ success: true, roleUpdateSkipped: true, message: 'ข้อมูลอื่นบันทึกแล้ว แต่ไม่สามารถเปลี่ยน Role ได้ (ต้องเปลี่ยนจาก Dashboard ของ Base44)' });
      }
    }

    return Response.json({ success: true });
  } catch (error) {
    console.error('updateUser error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});