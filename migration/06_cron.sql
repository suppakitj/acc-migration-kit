-- ============================================================================
-- 06_cron.sql — Scheduled jobs (แทน Base44 time-based Automations)
-- ============================================================================
--  สร้างจาก Base44 dashboard จริง (13 time-based automations)
--
--  !! สำคัญเรื่องเขตเวลา !!
--  pg_cron รันด้วยเขตเวลาของ database (ตั้งให้เป็น UTC) — ค่า cron ด้านล่างเป็น UTC
--  ยืนยัน anchor จาก dashboard:
--     0 1 * * *  UTC = 08:00 Bangkok  ("LINE Due Date - Daily 8AM")
--     0 3 * * *  UTC = 10:00 Bangkok  ("Todo Reminder — 10:00 Bangkok (03:00 UTC)")
--  => Bangkok H  →  UTC (H-7)
--
--  ต้องตั้งค่า service key ก่อน (เลือกวิธีใดวิธีหนึ่ง):
--    วิธี A (ง่าย):  alter database postgres set app.service_key = '<SERVICE_ROLE_KEY>';
--                    แล้ว reconnect  (เก็บใน catalog — internal only)
--    วิธี B (ปลอดภัยกว่า): เก็บใน Supabase Vault แล้วอ่านด้วย vault.decrypted_secrets
--
--  URL ภายใน: http://kong:8000  (ชื่อ service ใน docker network ของ Supabase)
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- helper: ยิง Edge Function หนึ่งตัว (ลด boilerplate ในทุก job)
create or replace function public.invoke_edge(fn text, payload jsonb default '{}'::jsonb)
returns bigint
language plpgsql security definer set search_path = '' as $$
declare req_id bigint;
begin
  select net.http_post(
    url     := 'http://kong:8000/functions/v1/' || fn,
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || current_setting('app.service_key', true)
               ),
    body    := payload,
    timeout_milliseconds := 55000
  ) into req_id;
  return req_id;
end $$;

-- ---------------------------------------------------------------------------
-- ยกเลิก job เดิมก่อน (idempotent — รันไฟล์นี้ซ้ำได้)
-- ---------------------------------------------------------------------------
do $$
declare j text;
begin
  for j in select jobname from cron.job where jobname like 'acc-%' loop
    perform cron.unschedule(j);
  end loop;
end $$;

-- ===========================================================================
--  13 SCHEDULED JOBS
--  รูปแบบ: cron.schedule('<ชื่อ>', '<cron UTC>', $$ select public.invoke_edge('<fn>') $$)
-- ===========================================================================

-- 1) แจ้งเตือน KB รออนุมัติ >3 วัน — ทุกวัน 09:00 Bangkok
select cron.schedule('acc-kb-pending-reminder', '0 2 * * *',
  $$ select public.invoke_edge('kbPendingReminder') $$);

-- 2) Retry สร้างงานรายเดือน — วันที่ 1 (UTC) ทุกชม. 19:00–23:00 = วันที่ 2 Bangkok 02:00–06:00
select cron.schedule('acc-retry-monthly-task', '0 19,20,21,22,23 1 * *',
  $$ select public.invoke_edge('retryMonthlyTaskGeneration', '{"force_retry":true}'::jsonb) $$);

-- 3) สรุปการเลื่อน Due Date รายสัปดาห์ — จันทร์ 09:00 Bangkok
select cron.schedule('acc-weekly-postpone-summary', '0 2 * * 1',
  $$ select public.invoke_edge('weeklyPostponeSummary') $$);

-- 4) ล้างข้อมูลเก่ารายเดือน — วันที่ 2 เวลา 03:00 Bangkok (= วันที่ 1 20:00 UTC)
select cron.schedule('acc-monthly-auto-cleanup', '0 20 1 * *',
  $$ select public.invoke_edge('autoCleanup') $$);

-- 5) สร้าง Task รายเดือนอัตโนมัติ — วันที่ 1 18:00 UTC (= วันที่ 2 01:00 Bangkok)
select cron.schedule('acc-auto-generate-monthly-tasks', '0 18 1 * *',
  $$ select public.invoke_edge('autoGenerateMonthlyTasks') $$);

-- 6) แจ้งเตือน action item จาก Meeting Notes — ทุกวัน 10:00 Bangkok
select cron.schedule('acc-meeting-action-reminder', '0 3 * * *',
  $$ select public.invoke_edge('meetingActionReminder') $$);

-- 7) อีเมลเตือน To-do — จันทร์–ศุกร์ 10:00 Bangkok
select cron.schedule('acc-todo-email-reminder', '0 3 * * 1-5',
  $$ select public.invoke_edge('todoEmailReminder') $$);

-- 8) แจ้งเตือนปฏิทินภาษี — ทุกวัน 10:00 Bangkok
select cron.schedule('acc-tax-deadline-reminder', '0 3 * * *',
  $$ select public.invoke_edge('taxDeadlineReminder') $$);

-- 9) แจ้งเตือนใบแจ้งหนี้ (LINE บัญชี) — ทุกวัน 10:00 Bangkok
--    (การข้ามวันหยุด/เสาร์-อาทิตย์ อยู่ใน logic ของ function เอง)
select cron.schedule('acc-line-billing-reminder', '0 3 * * *',
  $$ select public.invoke_edge('lineBillingReminder') $$);

-- 10) ล้าง Audit Log >30 วัน — ทุกวัน 02:00 Bangkok (= 19:00 UTC วันก่อน)
select cron.schedule('acc-cleanup-audit-log', '0 19 * * *',
  $$ select public.invoke_edge('cleanupAuditLog') $$);

-- 11) แจ้งเตือนงานใกล้ครบกำหนด (LINE) — ทุกวัน 08:00 Bangkok
select cron.schedule('acc-line-due-date-reminder', '0 1 * * *',
  $$ select public.invoke_edge('lineDueDateReminder') $$);

-- 12) แจ้งเตือน Peak License ใกล้หมดอายุ — ทุกวัน 09:30 Bangkok
select cron.schedule('acc-peak-license-reminder', '30 2 * * *',
  $$ select public.invoke_edge('peakLicenseReminder') $$);

-- 13) Retry บันทึกไฟล์ LINE → Google Drive ที่ล้มเหลว — ทุก 2 ชั่วโมง
select cron.schedule('acc-retry-drive-save', '0 */2 * * *',
  $$ select public.invoke_edge('retryDriveSave') $$);


-- ===========================================================================
--  หมายเหตุจากการเทียบ dashboard กับโค้ด — โปรดยืนยัน
-- ===========================================================================
--  functions ที่ผมเดาจากโค้ดว่าเป็น cron แต่ "ไม่พบ" ใน dashboard:
--    • emailDueDateReminder (307 บรรทัด) — ไม่มีตารางเวลา → อาจเลิกใช้แล้ว
--          (น่าจะถูกแทนด้วย todoEmailReminder / lineDueDateReminder)
--          >>> อย่าเพิ่งตั้ง cron ให้ จนกว่าจะยืนยันว่ายังใช้อยู่ <<<
--    • riskScoreAlert (231 บรรทัด) — ไม่มีตารางเวลา → อาจเป็น event/manual
--  หากยืนยันแล้วว่าต้องมี ให้เพิ่มบรรทัด cron.schedule ตามรูปแบบด้านบน
-- ===========================================================================

-- ตรวจสอบ job ที่ตั้งไว้:
--   select jobname, schedule, active from cron.job where jobname like 'acc-%' order by jobname;
-- ดูประวัติการรัน (สำคัญ — ใช้ยืนยันว่า job ทำงานจริง):
--   select jobname, status, return_message, start_time
--     from cron.job_run_details order by start_time desc limit 30;
