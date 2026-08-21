-- ============================================================================
-- 08_features.sql — ฟีเจอร์ใหม่ (ภายในสำหรับพนักงาน) หลัง self-host
--   F1) LINE triage → auto task + SLA   (ใช้ next_business_day + LineRequest/Task เดิม)
--   F2) RD/DBD filing status tracker      (ตาราง filing_record)
--   F3) Ops/Backup health                 (ops_backup_log + ops_cron_summary)
-- รันหลัง 07_entity_triggers.sql — idempotent
-- ============================================================================

-- ---------------------------------------------------------------------------
-- helper: บวกวันทำการ (ข้ามเสาร์-อาทิตย์ + วันหยุดใน holiday_master)
--   ใช้คำนวณ SLA due date ให้ตรงปฏิทินไทย
-- ---------------------------------------------------------------------------
create or replace function public.next_business_day(start_date date, business_days int)
returns date language plpgsql stable set search_path = '' as $$
declare
  d date := start_date;
  added int := 0;
begin
  if business_days is null or business_days <= 0 then
    return start_date;
  end if;
  while added < business_days loop
    d := d + 1;
    -- 6 = เสาร์, 0 = อาทิตย์ (extract dow)
    if extract(dow from d) in (0, 6) then continue; end if;
    if exists (select 1 from public.holiday_master h where h.date = d) then continue; end if;
    added := added + 1;
  end loop;
  return d;
end $$;


-- ===========================================================================
-- F1) SLA config — เก็บใน app_config (ไม่ต้องสร้าง entity ใหม่)
--     key รูปแบบ  request_sla_<request_type>  = จำนวนวันทำการ
--     key         request_autoconvert        = 'on'|'off'  (เปิด auto-create)
--     seed ค่าเริ่มต้น (statutory = ด่วนกว่า)
-- ===========================================================================
insert into public.app_config (id, key, value, description) values
  ('sla_tax_invoice',    'request_sla_tax_invoice',    '5', 'SLA วันทำการ: ออกใบกำกับภาษี'),
  ('sla_withholding',    'request_sla_withholding_cert','3', 'SLA วันทำการ: หนังสือรับรองหัก ณ ที่จ่าย'),
  ('sla_sso_register',   'request_sla_sso_register',   '3', 'SLA วันทำการ: แจ้งเข้าประกันสังคม'),
  ('sla_sso_terminate',  'request_sla_sso_terminate',  '3', 'SLA วันทำการ: แจ้งออกประกันสังคม'),
  ('sla_autoconvert',    'request_autoconvert',        'off','เปิด/ปิดการสร้างงานอัตโนมัติจากคำขอ LINE')
on conflict (id) do nothing;


-- ===========================================================================
-- F2) filing_record — บันทึกสถานะการยื่นจริงกับ RD/DBD/SSO
--     เสริม tax_deadline (ปฏิทินว่าอะไรต้องยื่น) ด้วย "การยื่นจริงเกิดขึ้นหรือยัง"
-- ===========================================================================
create table if not exists public.filing_record (
  id            text primary key default ('f' || replace(gen_random_uuid()::text, '-', '')),
  created_date  timestamptz not null default now(),
  updated_date  timestamptz not null default now(),
  created_by    text default public.current_email(),
  created_by_id uuid default auth.uid(),

  customer_id     text,
  customer_name   text,
  tax_id          text,
  filing_type     text not null,          -- pnd1, pnd3, pnd53, pp30, pnd50, dbd_filing, sso, ...
  filing_label    text,                   -- ป้ายอ่านง่าย เช่น "ภ.ง.ด.53"
  authority       text not null default 'RD',   -- RD | DBD | SSO
  category        text,                   -- withholding_tax | vat | annual_cit | annual_filing | sso
  period_month    int,                    -- 1-12 (null สำหรับรายปี)
  period_year     int not null,
  period_label    text,                   -- "2026-08" หรือ "2569"
  due_date        date,
  status          text not null default 'pending',  -- pending|in_progress|prepared|filed|accepted|rejected|amended|not_required
  filed_date      date,
  receipt_no      text,                   -- เลขรับ / reference จากระบบ e-filing
  filed_amount    numeric,
  filed_by        text,
  filed_by_name   text,
  assigned_to     text,
  assigned_name   text,
  task_id         text,                   -- ผูกกับ Task
  deadline_id     text,                   -- ผูกกับ tax_deadline ที่มา
  attachment_url  text,
  note            text,
  _placeholder    boolean default null
);

alter table public.filing_record drop constraint if exists filing_record_status_chk;
alter table public.filing_record add constraint filing_record_status_chk
  check (status in ('pending','in_progress','prepared','filed','accepted','rejected','amended','not_required'));
alter table public.filing_record drop constraint if exists filing_record_authority_chk;
alter table public.filing_record add constraint filing_record_authority_chk
  check (authority in ('RD','DBD','SSO'));

-- กันซ้ำ: ลูกค้า+ประเภท+งวด ควรมีรายการเดียว
create unique index if not exists uq_filing_customer_type_period
  on public.filing_record (customer_id, filing_type, period_year, coalesce(period_month, 0));
create index if not exists idx_filing_status   on public.filing_record (status);
create index if not exists idx_filing_due      on public.filing_record (due_date);
create index if not exists idx_filing_customer on public.filing_record (customer_id);
create index if not exists idx_filing_period   on public.filing_record (period_year, period_month);

drop trigger if exists trg_filing_touch on public.filing_record;
create trigger trg_filing_touch before update on public.filing_record
  for each row execute function public.touch_updated_date();

-- ตั้ง filed_date อัตโนมัติเมื่อสถานะเป็น filed/accepted และยังไม่ระบุ
create or replace function public.trg_filing_set_filed_date()
returns trigger language plpgsql as $$
begin
  if new.status in ('filed','accepted') and new.filed_date is null then
    new.filed_date := (now() at time zone 'Asia/Bangkok')::date;
    if new.filed_by is null then new.filed_by := public.current_email(); end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_filing_filed_date on public.filing_record;
create trigger trg_filing_filed_date before insert or update on public.filing_record
  for each row execute function public.trg_filing_set_filed_date();

alter table public.filing_record enable row level security;
drop policy if exists filing_record_select on public.filing_record;
create policy filing_record_select on public.filing_record for select to authenticated using (true);
drop policy if exists filing_record_write on public.filing_record;
create policy filing_record_write on public.filing_record for all to authenticated
  using (true) with check (true);
drop policy if exists filing_record_delete on public.filing_record;
create policy filing_record_delete on public.filing_record for delete to authenticated
  using (public.current_app_role() in ('admin','management'));


-- ===========================================================================
-- F3) ops_backup_log — สคริปต์ backup เขียนบันทึกลงตารางนี้ (เข้าถึงตรงในฐานะ superuser)
--     หน้า OpsHealth (admin) อ่านเพื่อดูความสดของ backup
-- ===========================================================================
create table if not exists public.ops_backup_log (
  id           bigserial primary key,
  kind         text not null,            -- pg_dump | restic | storage
  status       text not null,            -- success | failed
  started_at   timestamptz,
  finished_at  timestamptz not null default now(),
  size_bytes   bigint,
  location     text,
  message      text
);
create index if not exists idx_backup_finished on public.ops_backup_log (finished_at desc);

alter table public.ops_backup_log enable row level security;
drop policy if exists ops_backup_select on public.ops_backup_log;
create policy ops_backup_select on public.ops_backup_log for select to authenticated
  using (public.current_app_role() in ('admin','management'));
-- ไม่มี insert policy → เขียนได้เฉพาะ superuser/service_role (สคริปต์ backup)

-- สรุปสถานะ cron ล่าสุดต่อ job (อ่านจาก pg_cron ถ้ามี) — SECURITY DEFINER
-- ใช้ to_regclass กันพังถ้ายังไม่ติดตั้ง pg_cron
create or replace function public.ops_cron_summary()
returns table (jobname text, schedule text, active boolean, last_status text,
               last_start timestamptz, last_message text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if to_regclass('cron.job') is null then
    return;   -- ยังไม่ได้ติดตั้ง pg_cron → คืนว่าง
  end if;
  return query execute $q$
    select j.jobname, j.schedule, j.active,
           d.status, d.start_time, left(coalesce(d.return_message,''), 200)
    from cron.job j
    left join lateral (
      select status, start_time, return_message
      from cron.job_run_details r
      where r.jobid = j.jobid
      order by start_time desc limit 1
    ) d on true
    where j.jobname like 'acc-%'
    order by j.jobname
  $q$;
end $$;

revoke all on function public.ops_cron_summary() from public, anon;
grant execute on function public.ops_cron_summary() to authenticated, service_role;
