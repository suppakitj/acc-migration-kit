-- ============ RLS negative test ============
-- ทดสอบว่า staff อ่านตารางความลับไม่ได้จริง (ไม่ใช่แค่ "ตั้ง policy ไว้แล้ว")
insert into auth.users(id, email) values
  ('11111111-1111-1111-1111-111111111111','staff1@acc.test'),
  ('22222222-2222-2222-2222-222222222222','admin1@acc.test')
on conflict do nothing;
update public.profiles set role='staff' where email='staff1@acc.test';
update public.profiles set role='admin' where email='admin1@acc.test';

insert into public.customer_credential (id, customer_id, customer_name, service_id, username, password_encrypted)
values ('cred-test-1','c1','ลูกค้าทดสอบ','s1','u','ENCRYPTED') on conflict (id) do nothing;
insert into public.task (id, title, status) values ('task-test-1','งานทดสอบ','pending') on conflict (id) do nothing;
insert into public.app_secret (key, value) values ('line_access_token','SECRET') on conflict (key) do nothing;
-- secret + non-secret ใน app_config เพื่อทดสอบ predicate is_secret_key
insert into public.app_config (id, key, value) values
  ('cfg-secret','line_access_token','SECRET-TOKEN'),
  ('cfg-otp','otp_cred-test-1','{"otp":"123456"}'),
  ('cfg-public','line_webhook_url','https://ops.acc/webhook/lineWebhook')
on conflict (id) do nothing;

grant usage on schema public, auth to authenticated, anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on all tables in schema public to anon;

\echo ''
\echo '--- as STAFF ---'
create or replace function auth.uid() returns uuid language sql stable as
  $$ select '11111111-1111-1111-1111-111111111111'::uuid $$;
set role authenticated;
select 'task visible to staff        : ' || count(*) from public.task;
select 'CREDENTIAL visible to staff  : ' || count(*) || '   <-- ต้องเป็น 0' from public.customer_credential;
select 'DIRECTOR visible to staff    : ' || count(*) || '   <-- ต้องเป็น 0' from public.director_info;
select 'AUDIT LOG visible to staff   : ' || count(*) || '   <-- ต้องเป็น 0' from public.audit_log;
select 'APP_SECRET visible to staff  : ' || count(*) || '   <-- ต้องเป็น 0' from public.app_secret;
select 'app_config SECRET keys/staff : ' || count(*) || '   <-- ต้องเป็น 0' from public.app_config where public.is_secret_key(key);
select 'app_config PUBLIC keys/staff : ' || count(*) || '   <-- ต้องเป็น 1 (อ่าน config ปกติได้)' from public.app_config where not public.is_secret_key(key);
reset role;

\echo ''
\echo '--- as ADMIN ---'
create or replace function auth.uid() returns uuid language sql stable as
  $$ select '22222222-2222-2222-2222-222222222222'::uuid $$;
set role authenticated;
select 'CREDENTIAL visible to admin  : ' || count(*) || '   <-- ต้องเป็น 1' from public.customer_credential;
select 'APP_SECRET visible to admin  : ' || count(*) || '   <-- ต้องเป็น 0 (service_role only)' from public.app_secret;
select 'app_config SECRET keys/admin : ' || count(*) || '   <-- ต้องเป็น 2 (admin แก้ตั้งค่าได้)' from public.app_config where public.is_secret_key(key);
reset role;

\echo ''
\echo '--- as ANON (คนที่ไม่ล็อกอิน ใช้ anon key จาก bundle) ---'
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
set role anon;
select 'task visible to anon         : ' || count(*) || '   <-- ต้องเป็น 0' from public.task;
select 'CREDENTIAL visible to anon   : ' || count(*) || '   <-- ต้องเป็น 0' from public.customer_credential;
select 'CUSTOMER visible to anon     : ' || count(*) || '   <-- ต้องเป็น 0' from public.customer;
reset role;
