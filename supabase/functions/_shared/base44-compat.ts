/**
 * ============================================================================
 *  base44-compat.ts — server-side shim สำหรับ Supabase Edge Functions (Deno)
 * ============================================================================
 *  Base44 backend functions ทั้ง 55 ตัวเริ่มด้วยบรรทัดเดียวกัน:
 *
 *      import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';
 *
 *  ไฟล์นี้ให้ createClientFromRequest ที่มี surface เดียวกันแต่ทำงานบน Supabase
 *  → การพอร์ตแต่ละ function เหลือแค่เปลี่ยน import บรรทัดแรกเป็น:
 *
 *      import { createClientFromRequest } from '../_shared/base44-compat.ts';
 *
 *  surface ที่รองรับ (สำรวจจาก base44/functions/ ทั้งหมด):
 *    base44.auth.me()
 *    base44.entities.<E>.{list,filter,get,create,bulkCreate,update,delete}
 *    base44.asServiceRole.entities.<E>.{...}
 *    base44.asServiceRole.connectors.getConnection('googledrive')
 *    base44.integrations.Core.SendEmail(...)
 *    base44.asServiceRole.integrations.Core.{SendEmail,UploadFile}
 *    base44.functions.invoke(name, body)
 *    base44.asServiceRole.functions.invoke(name, body)
 * ============================================================================
 */
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { ENTITY_TABLE } from './entity-map.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PAGE = 1000;

function tableFor(entity: string): string {
  const t = (ENTITY_TABLE as Record<string, string>)[entity];
  if (!t) throw new Error(`Unknown entity: ${entity}`);
  return t;
}

function parseSort(sort?: string) {
  if (!sort) return [];
  return sort.split(',').map((s) => s.trim()).filter(Boolean).map((s) => ({
    column: s.startsWith('-') ? s.slice(1) : s,
    ascending: !s.startsWith('-'),
  }));
}

function unwrap<T>(res: { data: T | null; error: unknown }, ctx: string): T {
  if (res.error) {
    const e = res.error as { message?: string; code?: string };
    throw new Error(`[${ctx}] ${e.message ?? 'error'}${e.code ? ` (${e.code})` : ''}`);
  }
  return res.data as T;
}

/* -------------------------------------------------------------------------- */
/*  entities proxy                                                            */
/* -------------------------------------------------------------------------- */

// deno-lint-ignore no-explicit-any
function makeEntities(sb: SupabaseClient): any {
  const cache = new Map<string, unknown>();

  const build = (entity: string) => {
    const table = tableFor(entity);
    const sel = () => sb.from(table).select('*');
    // deno-lint-ignore no-explicit-any
    const ord = (q: any, sort?: string) => {
      for (const o of parseSort(sort)) q = q.order(o.column, { ascending: o.ascending, nullsFirst: false });
      return q;
    };
    // deno-lint-ignore no-explicit-any
    const where = (q: any, w: Record<string, unknown> = {}) => {
      for (const [k, v] of Object.entries(w)) {
        if (v === undefined) continue;
        if (v === null) q = q.is(k, null);
        else if (Array.isArray(v)) q = q.in(k, v);
        else q = q.eq(k, v);
      }
      return q;
    };
    // deno-lint-ignore no-explicit-any
    const paged = async (mk: () => any, limit?: number, ctx = entity) => {
      const target = limit ?? Infinity;
      // deno-lint-ignore no-explicit-any
      const rows: any[] = [];
      let from = 0;
      for (;;) {
        const size = Math.min(PAGE, target - rows.length);
        if (size <= 0) break;
        const chunk = unwrap(await mk().range(from, from + size - 1), ctx);
        // deno-lint-ignore no-explicit-any
        rows.push(...(chunk as any[]));
        // deno-lint-ignore no-explicit-any
        if ((chunk as any[]).length < size) break;
        from += size;
      }
      return rows;
    };

    return {
      list: (sort = '-created_date', limit?: number) => paged(() => ord(sel(), sort), limit, `${entity}.list`),
      filter: (w = {}, sort = '-created_date', limit?: number) =>
        paged(() => ord(where(sel(), w), sort), limit, `${entity}.filter`),
      get: async (id: string) =>
        unwrap(await sb.from(table).select('*').eq('id', id).single(), `${entity}.get`),
      create: async (payload: unknown) =>
        unwrap(await sb.from(table).insert(payload).select().single(), `${entity}.create`),
      // deno-lint-ignore no-explicit-any
      bulkCreate: async (rows: any[]) => {
        if (!rows?.length) return [];
        // deno-lint-ignore no-explicit-any
        const out: any[] = [];
        for (let i = 0; i < rows.length; i += 500) {
          // deno-lint-ignore no-explicit-any
          out.push(...unwrap<any[]>(await sb.from(table).insert(rows.slice(i, i + 500)).select(), `${entity}.bulkCreate`));
        }
        return out;
      },
      update: async (id: string, patch: unknown) =>
        unwrap(await sb.from(table).update(patch).eq('id', id).select().single(), `${entity}.update`),
      delete: async (id: string) => {
        unwrap(await sb.from(table).delete().eq('id', id), `${entity}.delete`);
        return { success: true };
      },
    };
  };

  return new Proxy({}, {
    get(_t, name: string) {
      if (typeof name !== 'string') return undefined;
      if (!cache.has(name)) cache.set(name, build(name));
      return cache.get(name);
    },
  });
}

/* -------------------------------------------------------------------------- */
/*  connectors — แทน base44.asServiceRole.connectors.getConnection()           */
/* -------------------------------------------------------------------------- */
/**
 *  Base44 บริหาร OAuth token ของ Google Drive ให้เอง (refresh อัตโนมัติ)
 *  เมื่อ self-host เราต้องทำเอง: เก็บ refresh_token ในตาราง oauth_connection
 *  แล้วแลกเป็น access_token ใหม่เมื่อใกล้หมดอายุ
 *
 *  >>> จุดนี้คือ vendor lock-in ที่หนักที่สุดของ Base44 — ต้องทำ OAuth consent
 *      flow ของตัวเองหนึ่งครั้ง (ดู functions/googleOAuthCallback) <<<
 */
async function getConnection(admin: SupabaseClient, provider: string) {
  const row = unwrap(
    await admin.from('oauth_connection').select('*').eq('provider', provider).single(),
    'connectors.getConnection'
  ) as {
    access_token: string | null;
    refresh_token: string;
    expires_at: string | null;
    client_id: string;
    client_secret: string;
    token_url: string;
  };

  const stillValid =
    row.access_token && row.expires_at && new Date(row.expires_at).getTime() - Date.now() > 120_000;
  if (stillValid) return { accessToken: row.access_token!, provider };

  const res = await fetch(row.token_url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: row.client_id,
      client_secret: row.client_secret,
      refresh_token: row.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`${provider} token refresh failed: ${res.status} ${await res.text()}`);

  const tok = await res.json() as { access_token: string; expires_in: number };
  await admin.from('oauth_connection').update({
    access_token: tok.access_token,
    expires_at: new Date(Date.now() + tok.expires_in * 1000).toISOString(),
  }).eq('provider', provider);

  return { accessToken: tok.access_token, provider };
}

/* -------------------------------------------------------------------------- */
/*  integrations.Core (server side)                                            */
/* -------------------------------------------------------------------------- */

function makeCore(admin: SupabaseClient, authHeader: string) {
  return {
    // deno-lint-ignore no-explicit-any
    async SendEmail(payload: any) {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/sendEmail`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: authHeader || `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify(payload),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body?.error ?? `sendEmail failed (${r.status})`);
      return body;
    },

    /** รับ Blob/Uint8Array แล้วคืน { file_url } เหมือน Base44 */
    // deno-lint-ignore no-explicit-any
    async UploadFile({ file, file_name }: { file: any; file_name?: string }) {
      const name = (file_name ?? file?.name ?? 'file').replace(/[^\w.\-ก-๙]+/g, '_');
      const path = `server/${Date.now()}_${name}`;
      const up = await admin.storage.from('uploads').upload(path, file, { upsert: false });
      if (up.error) throw new Error(`UploadFile: ${up.error.message}`);
      const signed = await admin.storage.from('uploads').createSignedUrl(path, 60 * 60 * 24 * 7);
      if (signed.error) throw new Error(`UploadFile.sign: ${signed.error.message}`);
      return { file_url: signed.data.signedUrl, file_path: path };
    },
  };
}

function makeInvoker(authHeader: string, asService: boolean) {
  // deno-lint-ignore no-explicit-any
  return async (name: string, body: any = {}) => {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: asService ? `Bearer ${SERVICE_KEY}` : (authHeader || `Bearer ${SERVICE_KEY}`),
      },
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => null);
    return { data, status: r.status };
  };
}

/* -------------------------------------------------------------------------- */
/*  createClientFromRequest — entry point                                      */
/* -------------------------------------------------------------------------- */

export function createClientFromRequest(req: Request) {
  const authHeader = req.headers.get('Authorization') ?? '';

  // client ที่ผูกกับผู้ใช้ → RLS มีผลบังคับ
  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // client service_role → ข้าม RLS (ใช้เฉพาะที่จำเป็น เช่น cron, webhook, audit log)
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return {
    auth: {
      /** คืน user + profile รูปร่างเดียวกับ Base44 (role, full_name, email, ...) หรือ null */
      async me() {
        if (!authHeader) return null;
        const { data: { user }, error } = await asUser.auth.getUser();
        if (error || !user) return null;
        const { data: profile } = await admin
          .from('profiles').select('*').eq('id', user.id).single();
        if (!profile) return null;
        if (profile.user_status === 'inactive') return null;
        return { ...profile, id: user.id, email: user.email };
      },
    },

    entities: makeEntities(asUser),
    integrations: { Core: makeCore(admin, authHeader) },
    functions: { invoke: makeInvoker(authHeader, false) },

    asServiceRole: {
      entities: makeEntities(admin),
      integrations: { Core: makeCore(admin, authHeader) },
      functions: { invoke: makeInvoker(authHeader, true) },
      connectors: {
        getConnection: (provider: string) => getConnection(admin, provider),
      },
    },

    // เผื่อโค้ดบางตัวเรียกใช้ client ตรง
    _asUser: asUser,
    _admin: admin,
  };
}

/** CORS helper — Base44 จัดการให้ แต่ Edge Functions ต้องทำเอง */
export const CORS = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

export function handleOptions(req: Request): Response | null {
  return req.method === 'OPTIONS' ? new Response('ok', { headers: CORS }) : null;
}
