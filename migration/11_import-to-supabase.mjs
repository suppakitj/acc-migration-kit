/**
 * ============================================================================
 *  11_import-to-supabase.mjs  —  โหลดข้อมูลจาก acc-export-*.json เข้า Postgres
 * ============================================================================
 *  รันบนเครื่อง server:
 *
 *    npm i @supabase/supabase-js
 *    export SUPABASE_URL=http://localhost:8000
 *    export SUPABASE_SERVICE_ROLE_KEY=...          # ห้าม commit ค่านี้
 *    node 11_import-to-supabase.mjs acc-export-2026-08-17-1030.json
 *
 *  คุณสมบัติ:
 *    • idempotent — รันซ้ำได้ ใช้ upsert บน id เดิมของ Base44
 *    • เก็บ id เดิมไว้ทั้งหมด → reference ข้ามตาราง (customer_id, template_id ฯลฯ) ไม่พัง
 *    • ตัด field ที่ไม่มีใน schema ออกโดยรายงานให้ทราบ ไม่ใช่เงียบ ๆ
 *    • --dry-run ตรวจก่อนเขียนจริง
 *    • ทำ User → auth.users + profiles แยกเป็นขั้นตอนสุดท้าย
 * ============================================================================
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const FILE = process.argv[2];
const DRY = process.argv.includes('--dry-run');
if (!FILE) {
  console.error('usage: node 11_import-to-supabase.mjs <acc-export.json> [--dry-run]');
  process.exit(1);
}

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error('ต้องตั้ง SUPABASE_URL และ SUPABASE_SERVICE_ROLE_KEY ก่อน');
  process.exit(1);
}

const sb = createClient(URL, KEY, { auth: { persistSession: false } });

/* entity -> table (ต้องตรงกับ entityMap.js / entity-map.ts) */
const ENTITY_TABLE = JSON.parse(
  readFileSync(new URL('./entity-table.json', import.meta.url), 'utf8')
);

const BATCH = 300;
const report = { tables: {}, droppedFields: {}, failures: [] };

/** อ่านชื่อคอลัมน์จริงของตาราง เพื่อกรอง field แปลกปลอมออกก่อน insert */
async function columnsOf(table) {
  const { data, error } = await sb.rpc('_columns_of', { p_table: table }).select?.() ?? {};
  if (!error && Array.isArray(data)) return new Set(data.map((r) => r.column_name));
  // fallback: อ่าน 1 แถวเพื่อดู key (ใช้ได้เมื่อตารางมีข้อมูลแล้ว)
  const probe = await sb.from(table).select('*').limit(1);
  if (!probe.error && probe.data?.length) return new Set(Object.keys(probe.data[0]));
  return null; // ไม่รู้ → ไม่กรอง ปล่อยให้ Postgres เป็นคนบอก
}

function normalise(row) {
  const o = { ...row };
  // Base44 ส่ง '' มาให้ field วันที่บ่อย → Postgres date/timestamptz ไม่รับ
  for (const [k, v] of Object.entries(o)) {
    if (v === '') o[k] = null;
  }
  delete o.created_by_id; // ให้ backfill ทีหลังจาก email
  return o;
}

async function loadTable(entity, rows) {
  const table = ENTITY_TABLE[entity];
  if (!table) { report.failures.push(`ไม่รู้จัก entity ${entity}`); return; }
  if (!rows?.length) { report.tables[table] = 0; return; }

  const cols = await columnsOf(table);
  const dropped = new Set();

  const clean = rows.map((r) => {
    const n = normalise(r);
    if (!cols) return n;
    const out = {};
    for (const [k, v] of Object.entries(n)) {
      if (cols.has(k)) out[k] = v;
      else dropped.add(k);
    }
    return out;
  });

  if (dropped.size) report.droppedFields[table] = [...dropped];

  if (DRY) {
    report.tables[table] = clean.length;
    console.log(`[dry] ${table.padEnd(30)} ${clean.length} rows` +
      (dropped.size ? `  (จะตัด field: ${[...dropped].join(', ')})` : ''));
    return;
  }

  let ok = 0;
  for (let i = 0; i < clean.length; i += BATCH) {
    const slice = clean.slice(i, i + BATCH);
    const { error } = await sb.from(table).upsert(slice, { onConflict: 'id' });
    if (error) {
      report.failures.push(`${table} [${i}-${i + slice.length}] ${error.message}`);
      console.error(`❌ ${table} batch ${i}: ${error.message}`);
    } else {
      ok += slice.length;
    }
  }
  report.tables[table] = ok;
  console.log(`✅ ${table.padEnd(30)} ${ok}/${clean.length}` +
    (dropped.size ? `  (ตัด field: ${[...dropped].join(', ')})` : ''));
}

/* -------------------------------------------------------------------------- */

const dump = JSON.parse(readFileSync(FILE, 'utf8'));
const users = dump.entities.User ?? [];

console.log(`\nไฟล์: ${FILE}   export เมื่อ: ${dump.exported_at}`);
console.log(`entity: ${Object.keys(dump.entities).length}   รวม ${Object.values(dump.counts ?? {}).reduce((a, b) => a + b, 0)} แถว`);
console.log(DRY ? '\n>>> DRY RUN — ไม่เขียนข้อมูลจริง <<<\n' : '\n>>> เขียนข้อมูลจริง <<<\n');

/* 1) ตารางข้อมูลทั่วไป (ยกเว้น User) ---------------------------------------- */
for (const [entity, rows] of Object.entries(dump.entities)) {
  if (entity === 'User') continue;
  await loadTable(entity, rows);
}

/* 2) ผู้ใช้ — สร้าง auth user + profile ------------------------------------- */
console.log('\n--- ผู้ใช้ ---');
const userMap = {}; // email -> uuid
for (const u of users) {
  if (!u.email) continue;
  if (DRY) { console.log(`[dry] user ${u.email} (${u.role ?? 'staff'})`); continue; }

  const { data: created, error } = await sb.auth.admin.createUser({
    email: u.email,
    email_confirm: true,                       // ยืนยันแล้ว ไม่ต้องกดลิงก์
    user_metadata: { full_name: u.full_name ?? u.nickname ?? u.email },
  });

  let id = created?.user?.id;
  if (error) {
    if (/already/i.test(error.message)) {
      const { data: list } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
      id = list?.users?.find((x) => x.email?.toLowerCase() === u.email.toLowerCase())?.id;
    } else {
      report.failures.push(`user ${u.email}: ${error.message}`);
      console.error(`❌ user ${u.email}: ${error.message}`);
      continue;
    }
  }
  if (!id) { report.failures.push(`user ${u.email}: หา uuid ไม่ได้`); continue; }
  userMap[u.email.toLowerCase()] = id;

  const prof = normalise(u);
  delete prof.id;                              // id ของ profiles = uuid ของ auth.users
  const { error: pe } = await sb.from('profiles').upsert({ ...prof, id, email: u.email }, { onConflict: 'id' });
  if (pe) { report.failures.push(`profile ${u.email}: ${pe.message}`); console.error(`❌ profile ${u.email}: ${pe.message}`); }
  else console.log(`✅ user ${u.email.padEnd(34)} role=${u.role ?? 'staff'}`);
}

/* 3) backfill created_by_id จาก email ------------------------------------- */
if (!DRY && Object.keys(userMap).length) {
  console.log('\n--- backfill created_by_id ---');
  for (const table of Object.values(ENTITY_TABLE)) {
    if (table === 'profiles') continue;
    const { error } = await sb.rpc('_backfill_created_by', { p_table: table });
    if (error && !/does not exist/i.test(error.message)) {
      console.warn(`⚠️  backfill ${table}: ${error.message}`);
    }
  }
  console.log('เสร็จ (ใช้ฟังก์ชัน _backfill_created_by ใน 03_helpers.sql)');
}

/* 4) รายงาน --------------------------------------------------------------- */
const outFile = FILE.replace(/\.json$/, '') + (DRY ? '.dryrun' : '') + '.report.json';
writeFileSync(outFile, JSON.stringify({ ...report, source_counts: dump.counts }, null, 2));

console.log('\n' + '='.repeat(60));
console.log('สรุป');
console.log('='.repeat(60));
let mismatch = 0;
for (const [entity, n] of Object.entries(dump.counts ?? {})) {
  const table = ENTITY_TABLE[entity];
  const got = report.tables[table] ?? 0;
  const flag = entity === 'User' ? '(ดูส่วนผู้ใช้)' : got === n ? 'ok' : `⚠️ ต่างกัน ${n - got}`;
  if (entity !== 'User' && got !== n) mismatch++;
  console.log(`${entity.padEnd(30)} source=${String(n).padStart(6)}  loaded=${String(got).padStart(6)}  ${flag}`);
}
console.log(`\nตารางที่จำนวนไม่ตรง: ${mismatch}`);
console.log(`ข้อผิดพลาด: ${report.failures.length}`);
if (report.failures.length) console.log(report.failures.slice(0, 20).join('\n'));
console.log(`\nรายงานฉบับเต็ม: ${outFile}`);
if (mismatch > 0 || report.failures.length) {
  console.log('\n>>> ห้าม cutover จนกว่าจำนวนจะตรงทุกตารางและไม่มีข้อผิดพลาด <<<');
  process.exitCode = 1;
}
