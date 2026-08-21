-- ============================================================================
-- 03_helpers.sql — ฟังก์ชันช่วยงาน migration (เรียกจาก 11_import-to-supabase.mjs)
-- รันหลัง 02_extra.sql
-- ============================================================================

-- ---------------------------------------------------------------------------
-- อ่านชื่อคอลัมน์ของตาราง — importer ใช้กรอง field แปลกปลอมก่อน insert
-- ---------------------------------------------------------------------------
create or replace function public._columns_of(p_table text)
returns table (column_name text)
language sql stable security definer set search_path = '' as $$
  select c.column_name::text
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = p_table
$$;

revoke all on function public._columns_of(text) from public, anon, authenticated;
grant execute on function public._columns_of(text) to service_role;


-- ---------------------------------------------------------------------------
-- backfill created_by_id (uuid) จาก created_by (email) ที่ Base44 ส่งมา
-- ---------------------------------------------------------------------------
create or replace function public._backfill_created_by(p_table text)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  n integer := 0;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = p_table and column_name = 'created_by_id'
  ) then
    return 0;
  end if;

  execute format(
    'update public.%I t
        set created_by_id = p.id
       from public.profiles p
      where lower(t.created_by) = lower(p.email)
        and t.created_by_id is null', p_table
  );
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public._backfill_created_by(text) from public, anon, authenticated;
grant execute on function public._backfill_created_by(text) to service_role;


-- ---------------------------------------------------------------------------
-- ปิดฟังก์ชันช่วยงานเมื่อ migration เสร็จ (รันหลัง cutover)
-- ---------------------------------------------------------------------------
-- drop function if exists public._columns_of(text);
-- drop function if exists public._backfill_created_by(text);
