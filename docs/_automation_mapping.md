# ภาคผนวก C — Automation Mapping (แก้ความเสี่ยง R1)

จัดทำจาก **Base44 dashboard จริง** (17 ส.ค. 2569) เทียบกับโค้ด — นี่คือข้อมูลชิ้นเดียว
ที่โค้ดใน repo บอกไม่ได้ และเป็นความเสี่ยงอันดับหนึ่งของโครงการ

**บทเรียนที่ยืนยัน R1:** จาก 15 function ที่ผมเดาจากโค้ดว่าเป็น cron จริง ๆ แล้ว
**13 ตัวเป็น cron, 4 ตัวเป็น entity-trigger (ไม่ใช่ cron), และ 2 ตัวที่เดาว่าเป็น cron
กลับไม่มีตารางเวลาเลย** — ถ้าย้ายโดยเดาจากโค้ดอย่างเดียวจะพลาดทั้งขึ้นทั้งล่อง

---

## C.1 Time-based (13 ตัว) → `pg_cron` ใน `06_cron.sql`

เวลาที่แสดงแปลงเป็น UTC แล้ว (Bangkok = UTC+7) — ยืนยัน anchor: `0 1 * * *` UTC = 08:00 น. ไทย

| # | Automation (Base44) | Function | ตารางเวลา (ไทย) | cron (UTC) |
|---|---|---|---|---|
| 1 | KB Pending Review Reminder | `kbPendingReminder` | ทุกวัน 09:00 | `0 2 * * *` |
| 2 | Retry Monthly Task Generation | `retryMonthlyTaskGeneration` | วันที่ 2 เวลา 02:00–06:00 (รายชม.) | `0 19,20,21,22,23 1 * *` |
| 3 | Weekly Postpone Summary | `weeklyPostponeSummary` | จันทร์ 09:00 | `0 2 * * 1` |
| 4 | Monthly Auto Cleanup | `autoCleanup` | วันที่ 2 เวลา 03:00 | `0 20 1 * *` |
| 5 | Auto Generate Monthly Tasks | `autoGenerateMonthlyTasks` | วันที่ 2 เวลา 01:00 | `0 18 1 * *` |
| 6 | Meeting Action Item Reminder | `meetingActionReminder` | ทุกวัน 10:00 | `0 3 * * *` |
| 7 | Todo Email Reminder | `todoEmailReminder` | จ–ศ 10:00 | `0 3 * * 1-5` |
| 8 | Tax Deadline Daily Reminder | `taxDeadlineReminder` | ทุกวัน 10:00 | `0 3 * * *` |
| 9 | LINE Billing Reminder | `lineBillingReminder` | ทุกวัน 10:00 (ข้ามวันหยุด — logic ใน fn) | `0 3 * * *` |
| 10 | Cleanup Audit Log (30 days) | `cleanupAuditLog` | ทุกวัน 02:00 | `0 19 * * *` |
| 11 | LINE Due Date Reminder | `lineDueDateReminder` | ทุกวัน 08:00 | `0 1 * * *` |
| 12 | Peak License Daily Reminder | `peakLicenseReminder` | ทุกวัน 09:30 | `30 2 * * *` |
| 13 | Retry failed Drive saves | `retryDriveSave` | ทุก 2 ชั่วโมง | `0 */2 * * *` |

> หมายเหตุ: มีทั้ง `cleanupAuditLog` (>30 วัน, รายวัน) และ `autoCleanup` (Audit >90 วัน + Notification/LineMessage, รายเดือน) ทำงานคนละหน้าที่ — ต้องมีทั้งคู่

---

## C.2 Entity-triggered (4 ตัว) → `07_entity_triggers.sql`

Base44 automation แบบ Created/Updated **ไม่ใช่ cron** — ยิงเมื่อ record เปลี่ยน

| Automation | Function | Trigger on | วิธีย้าย | สถานะทดสอบ |
|---|---|---|---|---|
| Auto Set Completed Date | `autoSetCompletedDate` | Task Updated | **Native PL/pgSQL trigger** | ✅ ทดสอบผ่าน |
| Track Due Date Changes | `trackDueDateChange` | Task Updated | **Native PL/pgSQL trigger** | ✅ ทดสอบผ่าน |
| Sync PeakLicense → Customer | `syncPeakToCustomer` | PeakLicense Created/Updated | Dispatcher → Edge Function | โครงพร้อม |
| Auto-sync Peak License | `syncPeakLicense` | Customer Created/Updated | Dispatcher → Edge Function | โครงพร้อม |

**ผลพลอยได้:** สองตัวแรกกลายเป็น native trigger → **ตัดออกจากรายการ function ที่ต้องพอร์ตได้เลย**
(เหลือ 53 functions ที่ต้องพอร์ต แทน 55) และทำงานได้ดีกว่าเดิม (transaction เดียว ไม่ต้องยิง
network ไม่ต้องมี dedup 10 วินาทีอย่างเวอร์ชัน Deno)

ผลการทดสอบ native trigger บน PostgreSQL 16 จริง (จากข้อมูลทดสอบ):

| กรณี | ผลที่ต้องได้ | ผลจริง |
|---|---|---|
| status → completed | ใส่ completed_date = วันนี้ (Bangkok) | ✅ 2026-08-17 |
| status → completed ทั้งที่มี completed_date แล้ว | ไม่ทับของเดิม | ✅ คงค่า 2020-01-01 |
| due_date เปลี่ยน | count=1, บันทึกประวัติ + ชื่อ/role ผู้แก้ | ✅ ครบ |
| แก้ field อื่น (due_date เท่าเดิม) | count ไม่เพิ่ม | ✅ ยังเป็น 1 |
| frontend ต่อ history เอง | trigger ไม่ต่อซ้ำ | ✅ count=2 ไม่ใช่ 3 |

---

## C.3 ⚠️ สองประเด็นที่ต้องจัดการก่อน production

**1) Loop ระหว่าง Peak sync สองตัว**
`syncPeakToCustomer` แก้ Customer → trigger ยิง `syncPeakLicense` → แก้ PeakLicense →
ยิง `syncPeakToCustomer` อีก ... บน Base44 platform อาจกันให้เอง แต่บน Postgres ต้องกันเอง
วิธีแก้อยู่ใน comment ท้าย `07_entity_triggers.sql` (guard ด้วย session flag หรือเช็คค่าต่างก่อน update)
**ต้องทดสอบ create/update Customer ที่มี `peak_licensing` แล้วดู log ว่าไม่วนซ้ำ**

**2) สอง function ที่โค้ดชี้ว่าน่าจะเป็น cron แต่ dashboard ไม่มี**
- `emailDueDateReminder` (307 บรรทัด) — ไม่มีตารางเวลา → น่าจะเลิกใช้ (แทนด้วย todo/line reminder)
- `riskScoreAlert` (231 บรรทัด) — ไม่มีตารางเวลา → น่าจะเป็น event/manual

**อย่าเพิ่งตั้ง cron ให้สองตัวนี้** จนกว่าจะยืนยันว่ายังใช้อยู่จริง — ถ้าตั้งไปจะเกิดการส่ง
แจ้งเตือน/อีเมลซ้ำซ้อนที่ผู้ใช้ไม่ต้องการ

---

## C.4 Monitoring — heartbeat กันความเสี่ยง "job หยุดเงียบ ๆ"

การตั้ง cron ให้ครบยังไม่พอ — ถ้า job ตัวหนึ่งเริ่ม fail (เช่น LINE token หมดอายุ)
ระบบจะเงียบและไม่มีใครรู้ วิธีป้องกัน:

```sql
-- ดูประวัติการรันย้อนหลัง — job ที่ fail จะเห็นทันที
select jobname, status, return_message, start_time
  from cron.job_run_details
 where start_time > now() - interval '2 days'
 order by start_time desc;
```

แนะนำเพิ่ม: ให้ทุก reminder function ยิง heartbeat ไป **Uptime Kuma** (Push monitor)
เมื่อรันสำเร็จ แล้วตั้ง Kuma ให้ **แจ้งเตือนเมื่อ heartbeat ขาดหาย** เกินช่วงที่คาด
→ เปลี่ยนจาก "รู้ตอนลูกค้าโวยว่าไม่ได้แจ้งเตือน" เป็น "รู้ภายในไม่กี่ชั่วโมง"
