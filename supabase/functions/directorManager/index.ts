import { createClientFromRequest } from '../_shared/base44-compat.ts';

// ─── Crypto helpers (same as credentialManager) ────────────────────
async function getEncryptionKey(base44) {
  const configs = await base44.asServiceRole.entities.AppConfig.filter({});
  const key = configs.find(c => c.key === 'credential_encryption_key')?.value || '';
  if (!key || key.length < 16) {
    throw new Error('CREDENTIAL_ENCRYPTION_KEY ยังไม่ได้ตั้งค่า — กรุณาไปที่ AppSettings → เชื่อมต่อ → Credential Vault');
  }
  return key;
}

async function getKey(encryptionKey) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw", enc.encode(encryptionKey.padEnd(32, '0').slice(0, 32)),
    { name: "PBKDF2" }, false, ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: enc.encode("credential-salt"), iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
  );
}

async function encrypt(text, encryptionKey) {
  const key = await getKey(encryptionKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(text));
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);
  return btoa(String.fromCharCode(...combined));
}

async function decrypt(base64, encryptionKey) {
  const key = await getKey(encryptionKey);
  const combined = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  return new TextDecoder().decode(decrypted);
}

function generateOTP() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function saveOtp(base44, storeKey, otp) {
  const configKey = `otp_${storeKey}`;
  const value = JSON.stringify({ otp, expires: Date.now() + 5 * 60 * 1000 });
  const existing = await base44.asServiceRole.entities.AppConfig.filter({ key: configKey });
  if (existing.length > 0) {
    await base44.asServiceRole.entities.AppConfig.update(existing[0].id, { value });
  } else {
    await base44.asServiceRole.entities.AppConfig.create({ key: configKey, value, description: 'OTP temp' });
  }
}

async function getOtp(base44, storeKey) {
  const configKey = `otp_${storeKey}`;
  const existing = await base44.asServiceRole.entities.AppConfig.filter({ key: configKey });
  if (existing.length === 0) return null;
  const record = existing[0];
  const parsed = JSON.parse(record.value);
  return { ...parsed, recordId: record.id };
}

async function deleteOtp(base44, recordId) {
  await base44.asServiceRole.entities.AppConfig.delete(recordId);
}

async function logPdpaAccess(base44, { action, entity_type, entity_id, entity_label, user_email, user_name, details }) {
  try {
    await base44.asServiceRole.entities.AuditLog.create({
      action: action,
      entity_type: 'pdpa_access',
      entity_name: entity_type,
      entity_id: entity_id || '',
      user_email: user_email,
      user_name: user_name || user_email,
      details: details || '',
      category: 'pdpa',
    });
  } catch (e) {
    console.warn('Failed to log PDPA access:', e.message);
  }
}

// ─── Main handler ──────────────────────────────────────────────────
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  let encryptionKey;
  try {
    encryptionKey = await getEncryptionKey(base44);
  } catch (e) {
    return Response.json({ error: e.message, setup_required: true, success: false }, { status: 503 });
  }

  const body = await req.json();
  const { action } = body;

  // === SAVE (create or update) ===
  if (action === 'save') {
    const { customer_id, customer_name, full_name, id_card, address, phone,
            position, tax_filing_type, notes, director_id } = body;

    const data = {
      customer_id,
      customer_name,
      full_name_encrypted: full_name ? await encrypt(full_name, encryptionKey) : '',
      id_card_encrypted: id_card ? await encrypt(id_card, encryptionKey) : '',
      address_encrypted: address ? await encrypt(address, encryptionKey) : '',
      phone_encrypted: phone ? await encrypt(phone, encryptionKey) : '',
      position: position || '',
      tax_filing_type: tax_filing_type || 'pnd91',
      notes: notes || '',
      last_modified_by: user.email,
      last_modified_by_name: user.full_name || user.email,
      status: 'active',
    };

    if (director_id) {
      await base44.entities.DirectorInfo.update(director_id, data);
      await logPdpaAccess(base44, {
        action: 'update',
        entity_type: 'DirectorInfo',
        entity_id: director_id,
        entity_label: customer_name,
        user_email: user.email,
        user_name: user.full_name || user.email,
        details: `แก้ไขข้อมูลกรรมการ ${customer_name}`,
      });
      return Response.json({ success: true, message: 'updated' });
    } else {
      const created = await base44.entities.DirectorInfo.create(data);
      await logPdpaAccess(base44, {
        action: 'create',
        entity_type: 'DirectorInfo',
        entity_id: created.id,
        entity_label: customer_name,
        user_email: user.email,
        user_name: user.full_name || user.email,
        details: `เพิ่มกรรมการใหม่ ${customer_name}`,
      });
      return Response.json({ success: true, id: created.id });
    }
  }

  // === SEND OTP ===
  if (action === 'send_otp') {
    const { director_id } = body;
    const otp = generateOTP();
    const storeKey = `${user.email}_dir_${director_id}`;
    await saveOtp(base44, storeKey, otp);

    await base44.integrations.Core.SendEmail({
      to: user.email,
      subject: 'OTP สำหรับดูข้อมูลกรรมการ - ACC Consulting',
      body: `<div style="font-family:sans-serif;padding:20px;">
        <h2>รหัส OTP ของคุณ</h2>
        <p style="font-size:32px;font-weight:bold;color:#1e40af;letter-spacing:8px;">${otp}</p>
        <p>รหัสนี้จะหมดอายุใน 5 นาที</p>
        <p style="color:#6b7280;font-size:12px;">ข้อมูลกรรมการเป็นข้อมูลส่วนบุคคลตาม PDPA — หากไม่ได้ร้องขอ กรุณาเพิกเฉย</p>
      </div>`,
    });

    return Response.json({ success: true, message: 'OTP sent to ' + user.email });
  }

  // === VERIFY OTP & DECRYPT ===
  if (action === 'decrypt') {
    const { director_id, otp } = body;
    const storeKey = `${user.email}_dir_${director_id}`;
    const stored = await getOtp(base44, storeKey);

    if (!stored) return Response.json({ error: 'กรุณาขอ OTP ก่อน' }, { status: 400 });
    if (Date.now() > stored.expires) {
      await deleteOtp(base44, stored.recordId);
      return Response.json({ error: 'OTP หมดอายุแล้ว กรุณาขอใหม่' }, { status: 400 });
    }
    if (stored.otp !== otp) return Response.json({ error: 'OTP ไม่ถูกต้อง' }, { status: 400 });
    await deleteOtp(base44, stored.recordId);

    const dirs = await base44.entities.DirectorInfo.filter({ id: director_id });
    const dir = dirs?.[0];
    if (!dir) return Response.json({ error: 'ไม่พบข้อมูลกรรมการ' }, { status: 404 });

    await logPdpaAccess(base44, {
      action: 'view',
      entity_type: 'DirectorInfo',
      entity_id: director_id,
      entity_label: dir.customer_name + ' - ' + (dir.position || 'กรรมการ'),
      user_email: user.email,
      user_name: user.full_name || user.email,
      details: `ดูข้อมูลกรรมการ ${dir.customer_name} (${dir.position || 'กรรมการ'})`,
    });

    return Response.json({
      success: true,
      full_name: dir.full_name_encrypted ? await decrypt(dir.full_name_encrypted, encryptionKey) : '',
      id_card: dir.id_card_encrypted ? await decrypt(dir.id_card_encrypted, encryptionKey) : '',
      address: dir.address_encrypted ? await decrypt(dir.address_encrypted, encryptionKey) : '',
      phone: dir.phone_encrypted ? await decrypt(dir.phone_encrypted, encryptionKey) : '',
    });
  }

  // === REQUEST DELETE (non-admin → pending approval) ===
  if (action === 'request_delete') {
    const { director_id, reason } = body;
    const dirs = await base44.entities.DirectorInfo.filter({ id: director_id });
    const dir = dirs?.[0];
    await base44.entities.DirectorInfo.update(director_id, {
      delete_requested: true,
      delete_requested_by: user.email,
      delete_requested_by_name: user.full_name || user.email,
      delete_requested_at: new Date().toISOString(),
      delete_reason: reason || '',
    });
    await logPdpaAccess(base44, {
      action: 'request_delete',
      entity_type: 'DirectorInfo',
      entity_id: director_id,
      user_email: user.email,
      user_name: user.full_name || user.email,
      details: `ขอลบข้อมูลกรรมการ ${dir?.customer_name || ''} — เหตุผล: ${reason || '-'}`,
    });
    // Notify admins
    const allUsers = await base44.asServiceRole.entities.User.filter({});
    const admins = allUsers.filter(u => u.role === 'admin');
    for (const admin of admins.slice(0, 5)) {
      base44.asServiceRole.entities.Notification.create({
        title: '🔐 ขออนุมัติลบข้อมูลกรรมการ',
        message: `${user.full_name || user.email} ขอลบข้อมูลกรรมการของ ${dir?.customer_name || ''} (${dir?.position || ''}) — เหตุผล: ${reason || '-'}`,
        type: 'system',
        target_user: admin.email,
        related_entity_type: 'DirectorInfo',
        related_entity_id: director_id,
      }).catch(() => {});
    }
    return Response.json({ success: true, message: 'request_submitted' });
  }

  // === CANCEL DELETE REQUEST ===
  if (action === 'cancel_delete') {
    const { director_id } = body;
    await base44.entities.DirectorInfo.update(director_id, {
      delete_requested: false, delete_requested_by: '', delete_requested_by_name: '',
      delete_requested_at: '', delete_reason: '',
    });
    return Response.json({ success: true });
  }

  // === APPROVE DELETE (admin only) ===
  if (action === 'approve_delete') {
    const { director_id } = body;
    if (user.role !== 'admin') {
      return Response.json({ error: 'ต้องเป็น Admin เท่านั้น' }, { status: 403 });
    }
    const dirs = await base44.entities.DirectorInfo.filter({ id: director_id });
    const dir = dirs?.[0];
    await base44.entities.DirectorInfo.delete(director_id);
    await logPdpaAccess(base44, {
      action: 'approve_delete',
      entity_type: 'DirectorInfo',
      entity_id: director_id,
      user_email: user.email,
      user_name: user.full_name || user.email,
      details: `อนุมัติลบข้อมูลกรรมการ ${dir?.customer_name || ''} (${dir?.position || ''}) — ขอโดย: ${dir?.delete_requested_by_name || ''}`,
    });
    if (dir?.delete_requested_by) {
      base44.asServiceRole.entities.Notification.create({
        title: '✅ อนุมัติลบข้อมูลกรรมการแล้ว',
        message: `Admin ${user.full_name || user.email} อนุมัติลบข้อมูลกรรมการของ ${dir?.customer_name || ''}`,
        type: 'system',
        target_user: dir.delete_requested_by,
      }).catch(() => {});
    }
    return Response.json({ success: true });
  }

  // === REJECT DELETE (admin only) ===
  if (action === 'reject_delete') {
    const { director_id, reject_reason } = body;
    if (user.role !== 'admin') {
      return Response.json({ error: 'ต้องเป็น Admin เท่านั้น' }, { status: 403 });
    }
    const dirs = await base44.entities.DirectorInfo.filter({ id: director_id });
    const dir = dirs?.[0];
    await base44.entities.DirectorInfo.update(director_id, {
      delete_requested: false, delete_requested_by: '', delete_requested_by_name: '',
      delete_requested_at: '', delete_reason: '',
    });
    await logPdpaAccess(base44, {
      action: 'reject_delete',
      entity_type: 'DirectorInfo',
      entity_id: director_id,
      user_email: user.email,
      user_name: user.full_name || user.email,
      details: `ปฏิเสธลบข้อมูลกรรมการ ${dir?.customer_name || ''} — เหตุผล: ${reject_reason || '-'}`,
    });
    if (dir?.delete_requested_by) {
      base44.asServiceRole.entities.Notification.create({
        title: '❌ ไม่อนุมัติลบข้อมูลกรรมการ',
        message: `Admin ${user.full_name || user.email} ไม่อนุมัติลบข้อมูลกรรมการของ ${dir?.customer_name || ''} — เหตุผล: ${reject_reason || '-'}`,
        type: 'system',
        target_user: dir.delete_requested_by,
      }).catch(() => {});
    }
    return Response.json({ success: true });
  }

  // === DELETE (admin direct) ===
  if (action === 'delete') {
    const { director_id } = body;
    if (user.role !== 'admin') {
      return Response.json({ error: 'ต้องเป็น Admin เท่านั้นถึงจะลบได้โดยตรง' }, { status: 403 });
    }
    await base44.entities.DirectorInfo.delete(director_id);
    await logPdpaAccess(base44, {
      action: 'delete',
      entity_type: 'DirectorInfo',
      entity_id: director_id,
      user_email: user.email,
      user_name: user.full_name || user.email,
      details: `ลบข้อมูลกรรมการ ID: ${director_id} (admin direct)`,
    });
    return Response.json({ success: true });
  }

  return Response.json({ error: 'Invalid action' }, { status: 400 });
});