/**
 * ============================================================================
 *  base44Client.js — DROP-IN REPLACEMENT
 * ============================================================================
 *  ไฟล์นี้แทนที่ src/api/base44Client.js เดิม (ที่ import จาก '@base44/sdk')
 *  โดยคง "รูปร่าง API" ทุกอย่างที่โค้ดเดิมเรียกใช้ไว้เหมือนเดิม 100%
 *  → ไฟล์ .jsx อีก ~250 ไฟล์ที่ `import { base44 } from '@/api/base44Client'`
 *    ไม่ต้องแก้แม้บรรทัดเดียว
 *
 *  surface ที่รองรับ (สำรวจจาก repo จริง — ครบทุก call site):
 *    base44.entities.<E>.list(sort, limit)
 *    base44.entities.<E>.filter(where, sort, limit)
 *    base44.entities.<E>.get(id)
 *    base44.entities.<E>.create(obj)
 *    base44.entities.<E>.bulkCreate(arr)
 *    base44.entities.<E>.update(id, patch)
 *    base44.entities.<E>.delete(id)
 *    base44.entities[dynamicName]              (ใช้ใน ExecutiveBI / KpiReportCenter / DatabaseBackup)
 *    base44.auth.me() / logout(url) / updateMe(patch) / redirectToLogin(url) / login(email, pw)
 *    base44.users.inviteUser(email, role)
 *    base44.functions.invoke(name, body)       → { data }
 *    base44.integrations.Core.UploadFile({ file })                       → { file_url }
 *    base44.integrations.Core.SendEmail({...})
 *    base44.integrations.Core.InvokeLLM({ prompt, response_json_schema })
 *    base44.integrations.Core.ExtractDataFromUploadedFile({ file_url, json_schema }) → { status, output }
 * ============================================================================
 */
import { supabase } from './supabaseClient';
import { tableFor } from './entityMap';

/* -------------------------------------------------------------------------- */
/*  helpers                                                                    */
/* -------------------------------------------------------------------------- */

const PAGE = 1000; // PostgREST ปลอดภัยที่ 1000 rows/คำขอ

class ApiError extends Error {
  constructor(error, context) {
    super(`[${context}] ${error?.message ?? 'unknown error'}${error?.code ? ` (${error.code})` : ''}`);
    this.name = 'ApiError';
    this.status = error?.status ?? error?.code;
    this.details = error?.details;
    this.hint = error?.hint;
  }
}

function unwrap(res, context) {
  if (res.error) throw new ApiError(res.error, context);
  return res.data;
}

/** '-created_date' → { column:'created_date', ascending:false }; รองรับหลายคอลัมน์คั่นด้วย , */
function parseSort(sort) {
  if (!sort || typeof sort !== 'string') return [];
  return sort.split(',').map((s) => s.trim()).filter(Boolean).map((s) => ({
    column: s.startsWith('-') ? s.slice(1) : s,
    ascending: !s.startsWith('-'),
  }));
}

function applyWhere(q, where = {}) {
  for (const [k, v] of Object.entries(where)) {
    if (v === undefined) continue;
    if (v === null) q = q.is(k, null);
    else if (Array.isArray(v)) q = q.in(k, v);
    else q = q.eq(k, v);
  }
  return q;
}

/**
 * ดึงข้อมูลแบบไล่หน้า — Base44 คืนทั้งชุดตาม limit ที่ขอ (โค้ดเดิมขอถึง 10,000 แถว)
 * PostgREST อาจ cap ที่ db-max-rows → ถ้าไม่ไล่หน้า ข้อมูลจะถูกตัดเงียบ ๆ ซึ่งอันตรายที่สุด
 * เพราะรายงานจะแสดงตัวเลขที่ "ดูปกติ" แต่ผิด
 */
async function fetchPaged(build, limit, context) {
  const target = limit ?? Infinity;
  const rows = [];
  let from = 0;
  for (;;) {
    const size = Math.min(PAGE, target - rows.length);
    if (size <= 0) break;
    const chunk = unwrap(await build().range(from, from + size - 1), context);
    rows.push(...chunk);
    if (chunk.length < size) break; // หมดข้อมูล
    from += size;
  }
  return rows;
}

/* -------------------------------------------------------------------------- */
/*  entities                                                                   */
/* -------------------------------------------------------------------------- */

function makeEntity(entityName) {
  const table = tableFor(entityName);

  const base = (select = '*') => supabase.from(table).select(select);
  const ordered = (q, sort) => {
    for (const o of parseSort(sort)) q = q.order(o.column, { ascending: o.ascending, nullsFirst: false });
    return q;
  };

  return {
    _table: table,

    async list(sort = '-created_date', limit) {
      return fetchPaged(() => ordered(base(), sort), limit, `${entityName}.list`);
    },

    async filter(where = {}, sort = '-created_date', limit) {
      return fetchPaged(() => ordered(applyWhere(base(), where), sort), limit, `${entityName}.filter`);
    },

    async get(id) {
      return unwrap(await supabase.from(table).select('*').eq('id', id).single(), `${entityName}.get`);
    },

    async create(payload) {
      return unwrap(
        await supabase.from(table).insert(payload).select().single(),
        `${entityName}.create`
      );
    },

    async bulkCreate(rows) {
      if (!Array.isArray(rows) || rows.length === 0) return [];
      // แบ่งชุดกัน payload ใหญ่เกิน (import ลูกค้า/วันหยุดทีเดียวหลายพันแถว)
      const out = [];
      for (let i = 0; i < rows.length; i += 500) {
        out.push(
          ...unwrap(
            await supabase.from(table).insert(rows.slice(i, i + 500)).select(),
            `${entityName}.bulkCreate`
          )
        );
      }
      return out;
    },

    async update(id, patch) {
      return unwrap(
        await supabase.from(table).update(patch).eq('id', id).select().single(),
        `${entityName}.update`
      );
    },

    async delete(id) {
      unwrap(await supabase.from(table).delete().eq('id', id), `${entityName}.delete`);
      return { success: true };
    },
  };
}

/** cache ต่อ entity + รองรับการเข้าถึงแบบ dynamic: base44.entities[name] */
const entityCache = new Map();
const entities = new Proxy(
  {},
  {
    get(_t, name) {
      if (typeof name !== 'string') return undefined;
      if (!entityCache.has(name)) entityCache.set(name, makeEntity(name));
      return entityCache.get(name);
    },
    has() {
      return true;
    },
  }
);

/* -------------------------------------------------------------------------- */
/*  auth                                                                       */
/* -------------------------------------------------------------------------- */

const LOGIN_PATH = '/login';

const auth = {
  /** คืน object รูปร่างเดียวกับ Base44 user (email, full_name, role, menu_permissions, ...) */
  async me() {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
      const e = new Error('Not authenticated');
      e.status = 401;
      throw e;
    }
    const profile = unwrap(
      await supabase.from('profiles').select('*').eq('id', user.id).single(),
      'auth.me'
    );
    if (profile.user_status === 'inactive') {
      const e = new Error('User is inactive');
      e.status = 403;
      throw e;
    }
    return { ...profile, id: profile.id, email: user.email };
  },

  async login(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  },

  async logout(redirectUrl) {
    await supabase.auth.signOut();
    if (typeof window !== 'undefined') {
      window.location.href = redirectUrl
        ? `${LOGIN_PATH}?next=${encodeURIComponent(redirectUrl)}`
        : LOGIN_PATH;
    }
  },

  redirectToLogin(fromUrl) {
    if (typeof window === 'undefined') return;
    window.location.href = fromUrl
      ? `${LOGIN_PATH}?next=${encodeURIComponent(fromUrl)}`
      : LOGIN_PATH;
  },

  /** ใช้โดย ProfileSettings / AppearanceSettings / NotificationSettings */
  async updateMe(patch) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    return unwrap(
      await supabase.from('profiles').update(patch).eq('id', user.id).select().single(),
      'auth.updateMe'
    );
  },

  async onAuthStateChange(cb) {
    return supabase.auth.onAuthStateChange(cb);
  },
};

/* -------------------------------------------------------------------------- */
/*  users (admin)                                                              */
/* -------------------------------------------------------------------------- */

const users = {
  /** เดิม base44.users.inviteUser(email, role) — ต้องผ่าน Edge Function เพราะใช้ service_role key */
  async inviteUser(email, role = 'staff') {
    const { data } = await functions.invoke('inviteUser', { email, role });
    if (data?.error) throw new Error(data.error);
    return data;
  },
};

/* -------------------------------------------------------------------------- */
/*  functions.invoke — คงสัญญา { data } และปล่อยให้ 4xx body ไหลผ่านเป็น data   */
/* -------------------------------------------------------------------------- */

const functions = {
  async invoke(name, body = {}) {
    const { data, error } = await supabase.functions.invoke(name, { body });

    if (error) {
      // Base44 ไม่ throw เมื่อ function ตอบ 4xx พร้อม { error: '...' }
      // โค้ดเดิมเช็ค `if (res.data?.error) throw ...` เอง → ต้องรักษาพฤติกรรมนี้
      const ctx = error.context;
      if (ctx && typeof ctx.json === 'function') {
        try {
          return { data: await ctx.json(), status: ctx.status };
        } catch { /* body ไม่ใช่ JSON — ตกไป throw ด้านล่าง */ }
      }
      throw error;
    }
    return { data };
  },
};

/* -------------------------------------------------------------------------- */
/*  integrations.Core                                                          */
/* -------------------------------------------------------------------------- */

const BUCKET = 'uploads';

const Core = {
  /** { file } → { file_url }  (เทียบเท่า Base44 UploadFile) */
  async UploadFile({ file }) {
    const { data: { user } } = await supabase.auth.getUser();
    const safe = file.name.replace(/[^\w.\-ก-๙]+/g, '_');
    const path = `${user?.id ?? 'anon'}/${Date.now()}_${safe}`;

    const up = await supabase.storage.from(BUCKET).upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || 'application/octet-stream',
    });
    if (up.error) throw new ApiError(up.error, 'Core.UploadFile');

    // signed URL อายุ 7 วัน — พอสำหรับส่งต่อให้ LINE / Google Drive / OCR
    const signed = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 60 * 24 * 7);
    if (signed.error) throw new ApiError(signed.error, 'Core.UploadFile.sign');

    return { file_url: signed.data.signedUrl, file_path: path, file_name: file.name, file_size: file.size };
  },

  async SendEmail(payload) {
    const { data } = await functions.invoke('sendEmail', payload);
    if (data?.error) throw new Error(data.error);
    return data;
  },

  async InvokeLLM(payload) {
    const { data } = await functions.invoke('invokeLLM', payload);
    if (data?.error) throw new Error(data.error);
    return data;
  },

  /** คืน { status, output } เหมือน Base44 (โค้ดเดิมอ่าน res.output) */
  async ExtractDataFromUploadedFile(payload) {
    const { data } = await functions.invoke('extractDataFromFile', payload);
    if (data?.error) throw new Error(data.error);
    return data;
  },
};

/* -------------------------------------------------------------------------- */
/*  export — ชื่อเดิม เพื่อไม่ต้องแก้ import ที่ไหนเลย                          */
/* -------------------------------------------------------------------------- */

export const base44 = {
  entities,
  auth,
  users,
  functions,
  integrations: { Core },
  // เดิมมี base44.app — ในโค้ดถูกใช้แค่ประกอบ URL string ไม่ได้เรียกเมธอด
  app: { id: import.meta.env.VITE_APP_ID ?? 'acc-operation-system' },
};

export { supabase };
export default base44;
