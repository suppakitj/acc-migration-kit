-- ============================================================================
-- 04_verify.sql — GO-LIVE GATE
-- ============================================================================
--  รันก่อน cutover ทุกครั้ง ทุกหัวข้อต้อง PASS
--  ถ้ามี FAIL แม้ข้อเดียว → ห้าม deploy
--
--  เหตุผล: PostgREST เปิดทุกตารางใน schema public เป็น REST endpoint โดยตรง
--  และ anon key ฝังอยู่ใน frontend bundle ที่ใครก็อ่านได้
--  ตารางที่ไม่มี RLS หรือมี RLS แต่ไม่มี policy = ข้อมูลลูกค้าเปิดสาธารณะ
-- ============================================================================

\echo '=============================================================='
\echo ' GATE 1 — ทุกตารางใน public ต้องเปิด RLS'
\echo '=============================================================='
select
  case when count(*) = 0 then 'PASS' else 'FAIL — ' || count(*) || ' ตารางไม่ได้เปิด RLS' end as result,
  coalesce(string_agg(tablename, ', ' order by tablename), '-') as tables
from pg_tables
where schemaname = 'public' and rowsecurity = false;

\echo ''
\echo '=============================================================='
\echo ' GATE 2 — ทุกตารางที่เปิด RLS ต้องมี policy อย่างน้อย 1 ข้อ'
\echo '           (ยกเว้นตาราง service_role-only ที่ตั้งใจไม่มี policy)'
\echo '=============================================================='
with expected_no_policy(t) as (
  values ('oauth_connection'), ('app_secret'), ('otp_challenge')
),
offenders as (
  select c.relname::text as t
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
    and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
    and c.relname not in (select t from expected_no_policy)
)
select
  case when count(*) = 0 then 'PASS' else 'FAIL — ' || count(*) || ' ตารางเปิด RLS แต่ไม่มี policy' end as result,
  coalesce(string_agg(t, ', ' order by t), '-') as tables
from offenders;

\echo ''
\echo '=============================================================='
\echo ' GATE 3 — ตารางที่ต้องเป็น service_role-only ต้องไม่มี policy จริง'
\echo '=============================================================='
select
  case when count(*) = 0 then 'PASS'
       else 'FAIL — มี policy เปิดให้ role อื่นเข้าถึงตารางความลับ' end as result,
  coalesce(string_agg(distinct c.relname, ', '), '-') as tables
from pg_policy p
join pg_class c on c.oid = p.polrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('oauth_connection', 'app_secret', 'otp_challenge');

\echo ''
\echo '=============================================================='
\echo ' GATE 4 — ทุก secret key ใน app_config ต้องถูกจัดเป็น "ความลับ"'
\echo '           (กัน secret หลุด predicate → staff อ่านได้)'
\echo '=============================================================='
select
  case when count(*) = 0 then 'PASS'
       else 'FAIL — ' || count(*) || ' key ที่ดูเป็น secret แต่ is_secret_key ไม่จับ' end as result,
  coalesce(string_agg(key, ', ' order by key), '-') as offending_keys
from public.app_config
where (key ~* '(token|secret|password|passwd|api_key|encryption_key|credential)' or key like 'otp_%')
  and not public.is_secret_key(key);

\echo ''
\echo '=============================================================='
\echo ' GATE 5 — app_config ต้องมี select policy ที่จำกัด secret (ไม่ใช่ true ล้วน)'
\echo '=============================================================='
select
  case when count(*) >= 1 then 'PASS'
       else 'FAIL — app_config_select เปิดกว้างเกินไป (secret จะรั่วผ่าน anon/staff)' end as result
from pg_policies
where schemaname = 'public' and tablename = 'app_config' and policyname = 'app_config_select'
  and qual ilike '%is_secret_key%';

\echo ''
\echo '=============================================================='
\echo ' GATE 6 — ทุก profile ต้องมี role ที่ถูกต้อง และมี admin อย่างน้อย 1 คน'
\echo '=============================================================='
select
  case
    when (select count(*) from public.profiles where role = 'admin') = 0
      then 'FAIL — ไม่มีผู้ใช้ role admin เลย จะเข้าไปตั้งค่าไม่ได้'
    when (select count(*) from public.profiles where role is null) > 0
      then 'FAIL — มี profile ที่ role เป็น null'
    else 'PASS'
  end as result,
  (select count(*) from public.profiles) as total_profiles,
  (select count(*) from public.profiles where role = 'admin') as admins;

\echo ''
\echo '=============================================================='
\echo ' GATE 7 — จำนวนแถวต่อตาราง (เทียบกับรายงาน import ด้วยตา)'
\echo '=============================================================='
select relname as table_name, n_live_tup as approx_rows
from pg_stat_user_tables
where schemaname = 'public' and n_live_tup > 0
order by n_live_tup desc;

\echo ''
\echo '=============================================================='
\echo ' GATE 8 — ตารางที่ไม่มี index บน foreign-key-like column'
\echo '           (เตือนเรื่อง performance ไม่ใช่ blocker)'
\echo '=============================================================='
select c.relname as table_name, a.attname as column_name
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
where n.nspname = 'public' and c.relkind = 'r'
  and (a.attname like '%\_id' or a.attname like '%\_email')
  and a.attname <> 'created_by_id'   -- ไม่ได้ใช้ใน RLS/query ปัจจุบัน จึงไม่ต้องมี index
  and not exists (
    select 1 from pg_index i
    where i.indrelid = c.oid and a.attnum = any(i.indkey)
  )
order by 1, 2;
