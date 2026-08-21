/**
 * auth.ts — helper ยืนยันตัวตน/สิทธิ์ สำหรับ integration functions ที่สร้างใหม่
 */
import { createClientFromRequest } from './base44-compat.ts';

export type Me = { id: string; email: string; role?: string; full_name?: string } | null;

/** คืน user+profile หรือ null (ยืนยันจาก JWT ที่แนบมา) */
export async function requireUser(req: Request): Promise<Me> {
  const base44 = createClientFromRequest(req);
  return await base44.auth.me();
}

/** ต้องเป็น role ที่กำหนด ไม่งั้น throw (จับด้านนอกเป็น 401/403) */
export async function requireRole(req: Request, roles: string[]): Promise<Me> {
  const me = await requireUser(req);
  if (!me) { const e = new Error('Unauthorized'); (e as any).status = 401; throw e; }
  if (roles.length && !roles.includes(me.role ?? '')) {
    const e = new Error('Forbidden'); (e as any).status = 403; throw e;
  }
  return me;
}
