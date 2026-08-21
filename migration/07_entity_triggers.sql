-- ============================================================================
-- 07_entity_triggers.sql — แทน Base44 "entity automations" (4 ตัว)
-- ============================================================================
--  Base44 ยิง webhook เมื่อ record ถูก Created/Updated พร้อม payload
--  { event:{type, entity_id}, data, old_data }
--
--  กลยุทธ์:
--   • 2 ตัวที่ logic ตรงไปตรงมา → ทำเป็น native PL/pgSQL trigger
--     (ดีกว่าเดิม: ทำงานใน transaction เดียว ไม่ต้องยิง network ไม่ต้องใช้
--      dedup 10 วินาที และ "ตัดออกจากรายการ function ที่ต้องพอร์ต" ได้เลย)
--   • 2 ตัว (Peak sync) มี business logic ข้ามตาราง → ใช้ dispatcher ยิงไป
--     Edge Function ที่พอร์ตมา เพื่อรักษา logic เดิมไว้ verbatim
-- ============================================================================


-- ###########################################################################
--  A) autoSetCompletedDate   (Task → Updated)   → NATIVE TRIGGER
--     เมื่อ status เปลี่ยนเป็น completed และยังไม่มี completed_date
--     → ใส่วันที่ปัจจุบัน (เขตเวลา Bangkok)
--     ไม่ต้องพอร์ต Edge Function ตัวนี้อีกต่อไป
-- ###########################################################################
create or replace function public.trg_auto_set_completed_date()
returns trigger language plpgsql as $$
begin
  if new.status = 'completed'
     and (old.status is distinct from 'completed')
     and new.completed_date is null then
    new.completed_date := (now() at time zone 'Asia/Bangkok')::date;
  end if;
  return new;
end $$;

drop trigger if exists trg_task_auto_completed on public.task;
create trigger trg_task_auto_completed
  before update on public.task
  for each row execute function public.trg_auto_set_completed_date();


-- ###########################################################################
--  B) trackDueDateChange   (Task → Updated)   → NATIVE TRIGGER
--     บันทึกประวัติเมื่อ due_date เปลี่ยน + เพิ่มตัวนับ
--     รักษา logic เดิมทุกข้อ:
--       - ข้ามถ้า due_date ไม่เปลี่ยน หรือเดิมว่าง (ตั้งครั้งแรก)
--       - ข้ามถ้า frontend ต่อ history ให้แล้ว (length ใหม่ > length เก่า)
--       - บันทึกผู้แก้ไข (email + ชื่อ + role) จาก profiles
--     ทำใน transaction เดียว → ไม่ต้องมี dedup 10 วินาทีอย่างเวอร์ชัน Deno
--     ไม่ต้องพอร์ต Edge Function ตัวนี้อีกต่อไป
-- ###########################################################################
create or replace function public.trg_track_due_date_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  old_len int := coalesce(jsonb_array_length(old.due_date_change_history), 0);
  new_len int := coalesce(jsonb_array_length(new.due_date_change_history), 0);
  who     text := coalesce(public.current_email(), 'system');
  who_name text;
  who_role text;
  entry   jsonb;
begin
  -- due_date เปลี่ยนจริง และเดิมไม่ว่าง เท่านั้น
  if new.due_date is not distinct from old.due_date or old.due_date is null then
    return new;
  end if;

  -- frontend ต่อ history ให้แล้ว → ไม่ต้องทำซ้ำ
  if new_len > old_len then
    return new;
  end if;

  select full_name, role into who_name, who_role
    from public.profiles where email = who;
  who_name := coalesce(who_name, who);
  who_role := coalesce(who_role, '');

  entry := jsonb_build_object(
    'changed_at', to_char(now() at time zone 'Asia/Bangkok', 'YYYY-MM-DD"T"HH24:MI:SS'),
    'changed_by', who,
    'changed_by_name', who_name,
    'changed_by_role', who_role,
    'old_due_date', to_char(old.due_date, 'YYYY-MM-DD'),
    'new_due_date', to_char(new.due_date, 'YYYY-MM-DD')
  );

  new.due_date_change_count   := coalesce(new.due_date_change_count, 0) + 1;
  new.due_date_change_history := coalesce(new.due_date_change_history, '[]'::jsonb) || entry;
  return new;
end $$;

drop trigger if exists trg_task_track_due_date on public.task;
create trigger trg_task_track_due_date
  before update on public.task
  for each row execute function public.trg_track_due_date_change();


-- ###########################################################################
--  C) + D) Peak sync (2 ตัว) → DISPATCHER ยิงไป Edge Function ที่พอร์ตมา
--     C) syncPeakToCustomer : PeakLicense (Created/Updated) → sync กลับ Customer
--     D) syncPeakLicense    : Customer  (Created/Updated) → สร้าง/แก้ PeakLicense
--     สอง function นี้มี logic ข้ามตาราง จึงรักษาไว้เป็น Edge Function
--     dispatcher สร้าง payload รูปเดียวกับ Base44 { event, data, old_data }
--     → โค้ดที่พอร์ตมา parse ได้เลยโดยไม่ต้องแก้
--
--     !! ต้องมี extension pg_net และตั้ง app.service_key (ดู 06_cron.sql) !!
-- ###########################################################################

-- generic dispatcher: ยิง Edge Function ด้วย payload สไตล์ Base44
create or replace function public.dispatch_entity_automation()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  fn      text := tg_argv[0];
  ev_type text := lower(tg_op);          -- 'insert' | 'update'
  payload jsonb;
begin
  payload := jsonb_build_object(
    'event', jsonb_build_object(
                'type', case when tg_op = 'INSERT' then 'create' else 'update' end,
                'entity_id', new.id
             ),
    'data', to_jsonb(new),
    'old_data', case when tg_op = 'UPDATE' then to_jsonb(old) else null end
  );

  perform net.http_post(
    url     := 'http://kong:8000/functions/v1/' || fn,
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || current_setting('app.service_key', true)
               ),
    body    := payload,
    timeout_milliseconds := 30000
  );
  return new;
end $$;

-- C) PeakLicense → syncPeakToCustomer
drop trigger if exists trg_peak_to_customer on public.peak_license;
create trigger trg_peak_to_customer
  after insert or update on public.peak_license
  for each row execute function public.dispatch_entity_automation('syncPeakToCustomer');

-- D) Customer → syncPeakLicense
drop trigger if exists trg_customer_to_peak on public.customer;
create trigger trg_customer_to_peak
  after insert or update on public.customer
  for each row execute function public.dispatch_entity_automation('syncPeakLicense');

-- ---------------------------------------------------------------------------
--  ⚠️ ป้องกัน infinite loop
--  syncPeakToCustomer แก้ Customer → trigger D ยิง syncPeakLicense → แก้
--  PeakLicense → trigger C ยิงอีก ... วน
--  ทางแก้ (เลือกทำในโค้ด function ที่พอร์ต):
--    • ให้ function เขียนกลับด้วย service_role และตรวจว่าค่าเปลี่ยนจริงก่อน update
--      (no-op update ต้องไม่ยิงต่อ) — เพิ่มเงื่อนไข guard column เช่น
--      "อัปเดตเฉพาะเมื่อ payment_date/expiry_date ต่างจากเดิม"
--    • หรือใช้ session flag: ตอน function เขียนกลับ ให้ set local
--      app.suppress_automation = 'on' แล้ว dispatcher เช็ค flag นี้ก่อนยิง
--  >>> ทดสอบ create/update Customer ที่มี peak_licensing แล้วดู cron.job_run_details
--      / logs ว่าไม่วนซ้ำ ก่อนขึ้น production <<<
-- ---------------------------------------------------------------------------

-- guard ตัวอย่าง (เปิดใช้ถ้าเลือกวิธี session flag):
-- ใน dispatcher เพิ่มก่อน perform net.http_post:
--   if current_setting('app.suppress_automation', true) = 'on' then return new; end if;
-- และใน Edge Function ที่เขียนกลับ ให้รัน:
--   select set_config('app.suppress_automation','on', true);  -- true = transaction-local
