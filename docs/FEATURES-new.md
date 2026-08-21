# ฟีเจอร์ใหม่ (ภายในสำหรับพนักงาน) — 3 ชุด

สร้างต่อยอดบนสถาปัตยกรรม self-host เดิม ทั้งหมดเป็นเครื่องมือให้พนักงาน ACC ใช้เอง
(ยังไม่เปิดให้ลูกค้าเข้าระบบ ตามที่กำหนด) — ทดสอบ schema บน PostgreSQL 16 + build ผ่านทั้งแอปแล้ว

---

## F1 — LINE triage → สร้างงานอัตโนมัติ + SLA

ต่อยอดจากตัวคัดแยกคำขอ LINE ที่มีอยู่ ให้ "ปิด loop" กลายเป็นงานที่มอบหมายพร้อมกำหนดส่ง

**สิ่งที่เพิ่ม**
- `next_business_day()` — คำนวณ due date เป็น **วันทำการ** (ข้ามเสาร์-อาทิตย์ + `holiday_master`)
- SLA ต่อประเภทคำขอ (เก็บใน `app_config`): ใบกำกับภาษี 5 วัน, หัก ณ ที่จ่าย/ประกันสังคม 3 วัน (ปรับได้ในหน้าจอ)
- `createTaskFromRequest` — พนักงานกดแปลงคำขอ → สร้าง Task (ตั้ง priority: งานตามกฎหมาย = สูง), ผูก `task_id`, มอบหมายให้ผู้ดูแลลูกค้า (primary_officer), แจ้งกลับใน LINE
- `autoConvertRequests` — cron: แปลงคำขอ statutory อัตโนมัติ (เปิด/ปิดด้วยสวิตช์ในหน้าจอ)
- หน้า **SLA คำขอ** (`/RequestSLA`, เมนูกลุ่ม LINE) — บอร์ดคำขอ รอ/กำลังทำ + นับวันค้าง + ปุ่มแปลงเป็นงาน + ตั้งค่า SLA/auto

**เปิด auto-convert เป็น cron** (ถ้าต้องการ) เพิ่มใน `06_cron.sql`:
```sql
select cron.schedule('acc-auto-convert-requests','*/15 * * * *',
  $$ select public.invoke_edge('autoConvertRequests') $$);   -- ทุก 15 นาที
```

---

## F2 — ติดตามสถานะการยื่น RD / DBD / SSO

เสริม "ปฏิทินภาษี" (บอกว่าอะไรต้องยื่น) ด้วย **สมุดบันทึกการยื่นจริง** (ยื่นแล้วหรือยัง เลขรับ วันที่)

**สิ่งที่เพิ่ม**
- entity/ตาราง `filing_record` — ลูกค้า × ประเภท (ภ.ง.ด.1/3/53, ภ.พ.30, ภ.ง.ด.50/51, งบ DBD, สบช.3, บอจ.5, ประกันสังคม) × งวด, สถานะ (รอยื่น→เตรียม→ยื่นแล้ว→รับแล้ว/ปฏิเสธ/เพิ่มเติม), เลขรับ, ยอด, ผู้รับผิดชอบ, ผูก task/deadline
- ตั้ง `filed_date` อัตโนมัติเมื่อสถานะเป็น filed/accepted; กันซ้ำด้วย unique index (ลูกค้า+ประเภท+งวด)
- `generateFilings` — สร้างรายการยื่นของงวด จาก **ภาระผูกพันของลูกค้า** (`Customer.obligations`) + เติม due date จาก `tax_deadline`; งวดเดือน vs งวดปี แยกตาม cadence ของแต่ละประเภท
- หน้า **ติดตามการยื่น RD/DBD** (`/FilingTracker`, เมนูกลุ่มเทมเพลต&ความรู้) — เลือกงวด, ปุ่มสร้างรายการ, ตารางแก้สถานะ/เลขรับแบบ inline, ไฮไลต์เกินกำหนด, สถิติ, export CSV

---

## F3 — สุขภาพระบบ (Ops / Backup health)

self-host ไม่มีใครดูแลให้ — หน้านี้ทำให้ admin เห็นสถานะสำคัญในที่เดียว (แก้ความเสี่ยง R1/R7)

**สิ่งที่เพิ่ม**
- `ops_backup_log` — สคริปต์ `infra/backup.sh` เขียนบันทึกทุกครั้งที่ backup (pg_dump + restic offsite)
- `ops_cron_summary()` — สรุปสถานะ cron ล่าสุดต่อ job จาก `pg_cron` (กันพังถ้ายังไม่ติดตั้ง)
- `opsHealth` (admin) — รวม cron + ความสดของ backup + ตัวเลขสำคัญ (งานค้าง, คำขอ LINE, ยื่นเกินกำหนด)
- หน้า **สุขภาพระบบ** (`/OpsHealth`, เมนูกลุ่มระบบ, admin เท่านั้น) — การ์ด backup สด/ค้าง, ตาราง cron, ประวัติ backup, auto-refresh
- ตั้ง `infra/backup.sh` เป็น cron รายวัน:
  ```cron
  0 2 * * *  PGURL=... RESTIC_REPOSITORY=... RESTIC_PASSWORD=... /opt/acc-kit/infra/backup.sh
  ```

---

## การติดตั้ง (รวมในขั้นตอนเดิม)

- **DB:** `08_features.sql` ถูกเพิ่มใน `00_run_all.sh` แล้ว (รันหลัง 07)
- **Functions:** 4 ตัวใหม่อยู่ใน `supabase/functions/` + `config.toml` (verify_jwt=true) แล้ว
- **Frontend:** `apply-to-repo.sh` คัดลอกหน้าใหม่ 3 หน้า + Sidebar/useAccessControl/usePermissionMatrix ที่เดินสายเมนู+สิทธิ์แล้ว
- **สิทธิ์:** เพิ่ม cap `request_sla`, `filing_tracker` (ทุก role), `ops_health` (admin/management) ใน permission matrix — ปรับได้ในหน้า Role Management

## ทดสอบแล้วใน sandbox
- `08_features.sql` รันบน PostgreSQL 16 idempotent; `filing_record`/`ops_backup_log` RLS เปิด
- `next_business_day('2026-08-14',1)` = `2026-08-17` (ข้ามเสาร์-อาทิตย์ถูกต้อง)
- `deno lint` 5 ไฟล์ใหม่สะอาด
- `npm run build` ทั้งแอปพร้อม 3 หน้าใหม่ + เมนู ผ่าน

## ยังต้องทดสอบบนเครื่องจริง
- generateFilings กับข้อมูล `Customer.obligations` + `tax_deadline` จริง
- createTaskFromRequest end-to-end (สร้าง Task จริง + ack LINE จริง)
- opsHealth อ่าน pg_cron/ops_backup_log จริง
