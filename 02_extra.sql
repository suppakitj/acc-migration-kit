-- ============================================================================
-- 02_extra.sql — สิ่งที่ Base44 ให้มาโดยไม่มีในไฟล์ entity จึงต้องสร้างเพิ่ม
-- รันหลัง 01_schema.sql
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) oauth_connection — แทน base44.connectors (Google Drive)
--    Base44 ถือ refresh token และ refresh ให้เอง เมื่อ self-host ต้องเก็บเอง
-- ---------------------------------------------------------------------------
create table if not exists public.oauth_connection (
  provider       text primary key,              -- 'googledrive'
  client_id      text not null,
  client_secret  text not null,
  refresh_token  text not null,
  access_token   text,
  expires_at     timestamptz,
  token_url      text not null default 'https://oauth2.googleapis.com/token',
  scopes         text[] not null default '{}',
  connected_by   text,
  connected_at   timestamptz not null default now(),
  updated_date   timestamptz not null default now()
);

alter table public.oauth_connection enable row level security;
-- ไม่มี policy = เข้าถึงได้เฉพาะ service_role เท่านั้น (ตั้งใจ)
-- frontend ต้องไม่มีทางอ่านตารางนี้ได้เลย

drop trigger if exists trg_oauth_touch on public.oauth_connection;
create trigger trg_oauth_touch before update on public.oauth_connection
  for each row execute function public.touch_updated_date();


-- ---------------------------------------------------------------------------
-- 2) app_secret — ย้าย secret ออกจากตาราง app_config
--    ปัจจุบันโค้ดเก็บ line_access_token / credential_encryption_key ไว้ใน
--    AppConfig ซึ่งเป็นตารางที่ผู้ใช้ที่ล็อกอินอ่านได้ → ต้องแยกออก
-- ---------------------------------------------------------------------------
create table if not exists public.app_secret (
  key          text primary key,
  value        text not null,
  description  text,
  updated_by   text,
  updated_date timestamptz not null default now()
);

alter table public.app_secret enable row level security;
-- ไม่มี policy = service_role only

drop trigger if exists trg_app_secret_touch on public.app_secret;
create trigger trg_app_secret_touch before update on public.app_secret
  for each row execute function public.touch_updated_date();

-- ตรวจว่ายังมี secret หลงอยู่ใน app_config หรือไม่ (รันก่อน go-live)
-- select key from public.app_config
--  where key ~* '(token|secret|password|key|credential)';


-- ---------------------------------------------------------------------------
-- 3) (การตัดสินใจเชิงออกแบบ) OTP และ secret ยังเก็บใน app_config เหมือนเดิม
--    เพื่อ "ไม่แก้" 2 function crown-jewel (credentialManager, directorManager)
--    ที่ถอดรหัสรหัสผ่านลูกค้า — การเขียนใหม่มีความเสี่ยงสูงกว่าประโยชน์
--    ช่องโหว่เดิม (staff อ่าน secret/OTP ได้) ปิดที่ชั้น RLS ในข้อ 5 แทน
--    (functions ใช้ service_role จึงยังอ่านได้ตามปกติ ไม่ต้องแก้โค้ด)
--
--    ตาราง app_secret (ข้อ 2) มีไว้เป็น option สำหรับ secret ที่อยากกันสุดขีด
--    ในอนาคต — ปัจจุบันแอปยังไม่ใช้
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 4) Storage bucket + policies (แทน Base44 UploadFile)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('uploads', 'uploads', false)
on conflict (id) do nothing;

drop policy if exists uploads_insert on storage.objects;
create policy uploads_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'uploads');

drop policy if exists uploads_select on storage.objects;
create policy uploads_select on storage.objects for select to authenticated
  using (bucket_id = 'uploads');

drop policy if exists uploads_delete_own on storage.objects;
create policy uploads_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'uploads'
         and (owner = auth.uid() or public.current_app_role() in ('admin','management')));


-- ---------------------------------------------------------------------------
-- 5) app_config — ปิดช่องโหว่ secret รั่วผ่าน frontend ที่ชั้น RLS
--    • key ที่เป็น secret/OTP → อ่าน/เขียนได้เฉพาะ admin/management
--    • key อื่น (webhook URL, folder id, feature flag) → authenticated อ่านได้
--    functions ใช้ service_role → ข้าม RLS อ่านได้ทุก key เหมือนเดิม (ไม่ต้องแก้)
--
--    helper: บอกว่า key นี้เป็นความลับหรือไม่ (ใช้ซ้ำใน policy + gate)
-- ---------------------------------------------------------------------------
create or replace function public.is_secret_key(k text) returns boolean
language sql immutable set search_path = '' as $$
  select k ~* '(token|secret|password|passwd|api[_-]?key|encryption[_-]?key|credential|client_secret|refresh_token|access_token)'
      or k like 'otp_%'
$$;

drop policy if exists app_config_all on public.app_config;

drop policy if exists app_config_select on public.app_config;
create policy app_config_select on public.app_config for select to authenticated
  using (
    not public.is_secret_key(key)                       -- key ทั่วไป: ทุกคนที่ล็อกอิน
    or public.current_app_role() in ('admin','management')  -- secret: เฉพาะผู้บริหาร
  );

drop policy if exists app_config_write on public.app_config;
create policy app_config_write on public.app_config for all to authenticated
  using (public.current_app_role() in ('admin','management'))
  with check (public.current_app_role() in ('admin','management'));


-- ---------------------------------------------------------------------------
-- 6) audit_log — insert ได้ทุกคน อ่านได้เฉพาะผู้บริหาร ห้ามแก้/ลบ
--    (ทับ policy จาก 01_schema.sql เพราะ audit trail ต้อง append-only)
-- ---------------------------------------------------------------------------
drop policy if exists audit_log_ro on public.audit_log;
drop policy if exists audit_log_rw on public.audit_log;

drop policy if exists audit_log_insert on public.audit_log;
create policy audit_log_insert on public.audit_log for insert to authenticated
  with check (true);

drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log for select to authenticated
  using (public.current_app_role() in ('admin','management'));
-- ไม่มี policy สำหรับ update/delete = ห้ามแก้ไขย้อนหลัง (สำคัญต่อ PDPA/audit)


-- ---------------------------------------------------------------------------
-- 7) Scheduled jobs (pg_cron) → ย้ายไปไฟล์ 06_cron.sql แล้ว
--    (ต้องมี extension pg_cron/pg_net + ตั้ง app.service_key ก่อน จึงแยกไฟล์
--     เพื่อให้ 02_extra รันได้บนฐานข้อมูลที่ยังไม่มี pg_cron)
-- ---------------------------------------------------------------------------
