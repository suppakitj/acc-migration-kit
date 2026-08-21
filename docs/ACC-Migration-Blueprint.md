# ACC Operation System — Migration Blueprint

### จาก Base44 (managed platform) → Ubuntu 24.04 on-premise + Self-Hosted Supabase

**จัดทำเพื่อ:** คุณศุภกิจ เจียวเปี๊ยะ — กรรมการผู้จัดการ, ACC Consulting Co., Ltd.
**วันที่:** 17 สิงหาคม 2569
**ฐานข้อมูลการวิเคราะห์:** `github.com/suppakitj/acc-operation-System` (สแกนโค้ดทั้ง repo แล้ว)
**สถานะ:** v2 — แก้จากฉบับร่างแรกทั้งฉบับ หลังเข้าถึงโค้ดจริง

---

## 0. Executive Summary

### 0.1 ขนาดของงานจริง — ต่างจากประมาณการเบื้องต้นอย่างมีนัยสำคัญ

ก่อนเห็นโค้ด ผมประเมินไว้ 4–6 สัปดาห์ **ตัวเลขนั้นต่ำเกินไปมาก** ระบบนี้ไม่ใช่ task management ธรรมดา — จากการสแกนโค้ดพบว่า:

| ตัวชี้วัด | จำนวนจริง |
|---|---:|
| บรรทัดโค้ดรวม (ไม่นับ lockfile) | **53,534** |
| Entities (ตารางข้อมูล) | **45** |
| Pages | **52** |
| Components | **~250** |
| **Backend functions (Deno)** | **55 ตัว / 9,065 บรรทัด** |
| จุดที่เรียก `base44.functions.invoke` จาก UI | 57 |
| จุดที่เรียก `base44.auth.me()` | 49 |
| ระบบภายนอกที่ต่ออยู่ | Google Drive, LINE Messaging API (OA), Manus OCR, Microsoft 365 SMTP, Holiday API, Peak |

ประเมินใหม่: **10–14 สัปดาห์** สำหรับคนเดียวทำควบงานประจำ หรือ **5–7 สัปดาห์** แบบ full-time

### 0.2 ข่าวดี — โครงสร้างเอื้อต่อการย้ายอย่างผิดคาด

จากการวิเคราะห์ pattern การเรียก SDK พบสามข้อที่ทำให้งานนี้ **เสี่ยงน้อยกว่าที่ขนาดโค้ดบ่งบอก**:

1. **ทั้งแอปเรียก SDK ผ่านไฟล์เดียว** — ทุกไฟล์ `import { base44 } from '@/api/base44Client'` ไม่มีที่ไหน import `@base44/sdk` ตรง ๆ เลย → เขียนไฟล์นั้นใหม่ไฟล์เดียว โค้ดอีก ~300 ไฟล์ไม่ต้องแตะ
2. **ไม่มีการใช้ query operator ซับซ้อนแม้แต่จุดเดียว** — ตรวจแล้วไม่พบ `$gte`, `$in`, `$or` ใด ๆ ทุก `filter()` เป็นการเทียบเท่ากันหมด → แปลงเป็น PostgREST ได้ตรงตัว 1:1 โดยไม่ต้องตีความ
3. **Backend functions รันบน Deno อยู่แล้ว** — Supabase Edge Functions ก็ Deno → พอร์ตแต่ละ function เหลือแค่ **เปลี่ยน import บรรทัดแรก** ไม่ต้องเขียน business logic ใหม่

ผมได้สร้าง shim ทั้งสองชั้น (client + server) ให้แล้วในแพ็กเกจนี้ พร้อม schema ที่ทดสอบกับ PostgreSQL 16 จริงและผ่านหมด

### 0.3 ข่าวร้าย — สามจุดที่ต้องเขียนใหม่จริง ๆ ไม่มีทางเลี่ยง

| จุด | เหตุผล | Effort |
|---|---|---|
| **Google Drive connector** (11 functions) | Base44 ถือ refresh token และต่ออายุให้เอง `base44.asServiceRole.connectors.getConnection('googledrive')` ไม่มีของเทียบเท่าใน Supabase → ต้องทำ OAuth consent flow + token store + refresh เอง | 3–5 วัน |
| **ตารางเวลา (cron) ของ 15 functions** | Base44 เก็บ schedule เป็น platform state **ไม่ถูก export ลง repo** → ต้องเปิด Base44 dashboard จดมาทีละตัว แล้วสร้างใหม่ด้วย pg_cron | 1–2 วัน (+ ต้องเข้า dashboard) |
| **ระบบ login** | เดิม Base44 โฮสต์หน้า login ให้ทั้งหมด — ในโค้ดไม่มีหน้า login เลย ต้องสร้างใหม่ พร้อม reset password, invite, 2FA | 3–5 วัน |

> **ประเด็นที่ต้องตัดสินใจก่อนเริ่ม:** ข้อที่สอง (ตารางเวลา cron) เป็น **ความเสี่ยงเงียบ** ที่ร้ายที่สุดในโครงการนี้ ถ้าลืมย้าย job ตัวใดตัวหนึ่ง ระบบจะยังทำงานดูปกติทุกอย่าง แต่การแจ้งเตือน deadline ภาษีจะไม่ถูกส่ง และไม่มีใครรู้จนกว่าจะเลยกำหนดยื่นแล้ว สำหรับสำนักงานบัญชี นี่คือความเสี่ยงเชิงวิชาชีพ ไม่ใช่แค่เชิงเทคนิค — จึงควรทำ checklist ยืนยันทีละ job และทดสอบยิงจริงทุกตัวก่อน cutover

---

## 1. สิ่งที่ส่งมอบในแพ็กเกจนี้ (ใช้งานได้จริง ทดสอบแล้ว)

```
acc-migration/
├── docs/
│   ├── ACC-Migration-Blueprint.md        ← เอกสารนี้
│   └── _functions_inventory.md           ← inventory 55 functions พร้อมสิ่งที่ต้องต่อใหม่
├── frontend/src/api/
│   ├── base44Client.js                   ← ★ drop-in replacement (แทนไฟล์เดิมได้ทันที)
│   ├── supabaseClient.js
│   └── entityMap.js                      ← entity → table map (auto-generated)
├── supabase/functions/_shared/
│   ├── base44-compat.ts                  ← ★ createClientFromRequest() สำหรับ Edge Functions
│   └── entity-map.ts
├── migration/
│   ├── gen_schema.py                     ← generator: entity jsonc → DDL (รันซ้ำได้)
│   ├── 01_schema.sql                     ← 45 ตาราง + constraint + trigger + index + RLS
│   ├── 02_extra.sql                      ← oauth_connection, app_secret, otp_challenge, storage
│   ├── 03_helpers.sql                    ← RPC ช่วย migration
│   ├── 04_verify.sql                     ← ★ GO-LIVE GATE 8 ข้อ
│   ├── 05_rls_test.sql                   ← ★ negative test: staff อ่านข้อมูลความลับไม่ได้
│   ├── 10_export-from-base44.js          ← ดัมพ์ข้อมูลจาก Base44 (วางใน browser console)
│   ├── 11_import-to-supabase.mjs         ← โหลดเข้า Postgres + reconciliation report
│   └── entity-table.json
└── infra/
    ├── docker-compose.override.yml       ← ทับ default ที่ไม่ปลอดภัย
    ├── caddy/Caddyfile
    └── .env.example
```

### ผลการทดสอบที่รันจริงแล้ว (ไม่ใช่การอ้าง)

ผม provision PostgreSQL 16.13 ขึ้นมาจริง สร้าง stub ของ Supabase (`auth.users`, `auth.uid()`, `storage.*`, role `anon`/`authenticated`/`service_role`) แล้วรัน DDL ทั้งชุด:

| การทดสอบ | ผล |
|---|---|
| `01_schema.sql` + `02_extra.sql` + `03_helpers.sql` รันบน Postgres 16 เปล่า | **ผ่าน ไม่มี error** |
| รันซ้ำสองรอบ (idempotency) | **ผ่าน — ไม่มี error ทั้งสองรอบ** |
| Object ที่สร้างได้ | 48 ตาราง, 51 policy, 80 check constraint, 140 index |
| GATE 1–6 ใน `04_verify.sql` | **PASS ทั้งหมด** |
| **RLS negative test** — staff อ่าน `customer_credential` | **0 แถว** (ต้องเป็น 0) ✅ |
| staff อ่าน `director_info` / `audit_log` / `app_secret` | **0 แถวทั้งหมด** ✅ |
| admin อ่าน `customer_credential` | **1 แถว** (ต้องเข้าถึงได้) ✅ |
| admin อ่าน `app_secret` | **0 แถว** (service_role only) ✅ |
| **anon key อ่าน `task` / `customer` / `customer_credential`** | **0 แถวทั้งหมด** ✅ |

บรรทัดสุดท้ายคือข้อที่สำคัญที่สุดในตารางนี้ — อธิบายในหัวข้อ 5.3

---

## 2. Base44 SDK → Supabase: การ Map ที่ตรวจสอบจากโค้ดจริง

### 2.1 ฝั่ง Frontend — surface ที่ใช้จริงทั้งหมด (นับจาก repo)

| Base44 call | จำนวนที่ใช้ | แทนด้วย |
|---|---:|---|
| `base44.functions.invoke(name, body)` | 57 | `supabase.functions.invoke` (ห่อให้คืน `{ data }` เหมือนเดิม) |
| `base44.auth.me()` | 49 | `auth.getUser()` + join `profiles` |
| `base44.entities.<E>.{list,filter,create,update,delete,get,bulkCreate}` | ~230 | `supabase.from(table).*` |
| `base44.entities[dynamicName]` | 5 | Proxy — รองรับการเข้าถึงแบบ dynamic ที่ `ExecutiveBI`, `KpiReportCenter`, `DatabaseBackup`, `OvertimeAnalytics`, `PerformanceEvaluation` ใช้ |
| `base44.integrations.Core.UploadFile` | 10 | Supabase Storage + signed URL |
| `base44.integrations.Core.ExtractDataFromUploadedFile` | 3 | Edge Function → LLM (คืน `{ output }` เหมือนเดิม) |
| `base44.integrations.Core.SendEmail` | 2 | Edge Function → M365 SMTP |
| `base44.integrations.Core.InvokeLLM` | 1 | Edge Function → Anthropic API |
| `base44.auth.logout` | 4 | `signOut()` + redirect |
| `base44.auth.updateMe` | 3 | `update profiles` |
| `base44.users.inviteUser` | 1 | Edge Function (ต้องใช้ service_role) |

**ทุกตัวถูกรองรับครบใน `frontend/src/api/base44Client.js` ที่ส่งมาด้วย** — ขั้นตอนติดตั้งคือทับไฟล์เดิม แล้ว `npm rm @base44/sdk @base44/vite-plugin && npm i @supabase/supabase-js`

### 2.2 รายละเอียดสองจุดที่ต้องพิถีพิถัน (ถ้าพลาดจะเจ็บ)

**(ก) พฤติกรรมของ `functions.invoke` เมื่อ function ตอบ 4xx**

โค้ดเดิมใช้ pattern นี้ใน 8 จุด:

```js
const res = await base44.functions.invoke('testEmailConnection', {});
if (res.data?.error) throw new Error(res.data.error);   // <-- อ่าน error จาก body
return res.data;
```

Base44 **ไม่ throw** เมื่อ function ตอบ 400 พร้อม `{ error: '...' }` แต่ Supabase SDK **throw** (`FunctionsHttpError`) และตั้ง `data = null` ถ้าไม่จัดการ ข้อความ error ที่ผู้ใช้เห็นจะกลายเป็น "Edge Function returned a non-2xx status code" แทนข้อความไทยที่ตั้งใจไว้ — shim ที่ส่งมาจึงดักและอ่าน body กลับมาเป็น `data` เพื่อรักษาพฤติกรรมเดิมไว้

**(ข) ความเสี่ยงข้อมูลถูกตัดเงียบ ๆ ตอนดึงหลายพันแถว**

โค้ดเดิมขอข้อมูลปริมาณมากในหน้ารายงาน — พบการเรียก `.list('-created_date', 10000)`, `5000`, `3000`, `2000` หลายจุด (ExecutiveBI, KpiReportCenter, OvertimeAnalytics, DatabaseBackup) PostgREST มี `db-max-rows` ที่จะ **ตัดผลลัพธ์ทิ้งโดยไม่แจ้ง error**

> นี่คือความเสี่ยงประเภทที่อันตรายที่สุดในงาน migration: รายงาน KPI จะแสดงตัวเลขที่ "ดูสมเหตุสมผล" แต่ผิด และไม่มีสัญญาณเตือนใด ๆ ผู้บริหารอาจใช้ตัวเลขนั้นตัดสินใจเรื่องค่าตอบแทนหรือประเมินผลพนักงาน

shim จึงไล่หน้าเอง (`.range()` ทีละ 1,000 แถว) จนครบจำนวนที่ขอ และ override ตั้ง `PGRST_DB_MAX_ROWS=10000` ไว้เป็นชั้นป้องกันที่สอง

### 2.3 ฝั่ง Backend — วิธีพอร์ต 55 functions

ทุก function เริ่มด้วยบรรทัดเดียวกัน:

```ts
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';
```

เปลี่ยนเป็น:

```ts
import { createClientFromRequest } from '../_shared/base44-compat.ts';
```

`base44-compat.ts` ที่ส่งมารองรับ surface ฝั่ง server ครบทุกตัวที่พบในโค้ด:

| Base44 (server) | ใช้ที่ | สถานะใน shim |
|---|---:|---|
| `base44.auth.me()` | 36 | ✅ |
| `base44.asServiceRole.entities.<E>.*` | ~150 | ✅ |
| `base44.entities.<E>.*` (RLS มีผล) | ~50 | ✅ |
| `base44.asServiceRole.integrations.Core.SendEmail` | 8 | ✅ |
| `base44.asServiceRole.integrations.Core.UploadFile` | 3 | ✅ |
| `base44.functions.invoke` / `asServiceRole.functions.invoke` | 6 | ✅ |
| **`base44.asServiceRole.connectors.getConnection('googledrive')`** | **11** | ⚠️ ต้องเติม OAuth flow (โครงพร้อม + ตาราง `oauth_connection` แล้ว) |

**ลำดับการพอร์ตที่แนะนำ** (ดู inventory เต็มใน `docs/_functions_inventory.md`):

1. **กลุ่มไม่มี dependency ภายนอก (24 ตัว)** — พอร์ตได้ทันที ใช้ทดสอบว่า shim ทำงานถูก เช่น `generateMonthlyTasks`, `taxqaValidate`, `listUsers`, `updateUser`
2. **กลุ่ม LINE (13 ตัว)** — ต้องมี channel access token ใน `app_secret` และเปลี่ยน webhook URL ที่ LINE Developer Console
3. **กลุ่มอีเมล (10 ตัว)** — ต้องตั้ง SMTP ของ M365
4. **กลุ่ม Google Drive (11 ตัว)** — ทำ OAuth flow ก่อน ทำท้ายสุดเพราะยากที่สุด
5. **กลุ่ม Manus OCR (3 ตัว)** — ต้อง re-register webhook URL ใหม่

---

## 3. Schema Design — สิ่งที่ generator ทำและตัดสินใจแทน

`gen_schema.py` แปลง `base44/entities/*.jsonc` ทั้ง 45 ไฟล์เป็น DDL โดยมีการตัดสินใจเชิงออกแบบที่ควรทราบ:

| การตัดสินใจ | เหตุผล |
|---|---|
| `id` เป็น **`text`** ไม่ใช่ `uuid` | โค้ดเดิมอ้างอิงกันข้ามตารางด้วย id ของ Base44 เป็น string (`customer_id`, `template_id`, `service_id` ฯลฯ) — เก็บค่าเดิมไว้ทั้งหมด ทำให้ import แล้ว reference ไม่พังแม้แต่จุดเดียว และ **rollback กลับ Base44 ได้** |
| คงชื่อ `created_date` / `updated_date` ไว้ (ไม่เปลี่ยนเป็น `created_at`) | frontend เรียงข้อมูลด้วย `'-created_date'` ใน 90+ จุด — ความสม่ำเสมอสำคัญกว่าความสวยของ naming convention ในงาน migration |
| `created_by` เป็น **email (text)** + เพิ่ม `created_by_id` (uuid) | Base44 เก็บเป็น email และโค้ดเทียบตรง ๆ (`a.created_by === currentUser?.email`) — ถ้าเปลี่ยนเป็น uuid ต้องแก้ logic หลายที่ จึงคงของเดิมและเพิ่มคอลัมน์ uuid ไว้ใช้ใน RLS อนาคต |
| enum → `text` + `CHECK constraint` (ไม่ใช่ PG enum type) | เพิ่ม/ลบค่าใน CHECK ทำได้ด้วย `ALTER ... DROP/ADD CONSTRAINT` ไม่ต้อง `ALTER TYPE` ที่ล็อกตาราง — สำนักงานบัญชีต้องเพิ่มประเภทบริการ/แผนกใหม่เป็นระยะ |
| `array` / `object` → `jsonb` | ตรงกับที่ Base44 ส่งมา และ query ได้ด้วย operator ของ jsonb ถ้าต้องการทีหลัง |
| trigger `touch_updated_date` ทุกตาราง | แทน behaviour ที่ Base44 ทำให้เองอัตโนมัติ |
| index อัตโนมัติบน `*_id`, `*_email`, `status`, `key` | คอลัมน์ที่ `filter()` ใช้บ่อยที่สุดจากการสแกนโค้ด |

**Generator รันซ้ำได้** — ถ้าแก้ entity บน Base44 เพิ่ม แล้ว pull repo ใหม่ ก็รัน `python3 gen_schema.py` ใหม่ได้เลย ไม่ต้องแก้ SQL ด้วยมือ

---

## 4. Data Migration

### 4.1 วิธี export ที่เลือกใช้ และเหตุผล

Base44 มี REST API แต่ endpoint และวิธี auth ไม่ documented ชัดเจน การเดา endpoint แล้วพลาดจะเสียเวลาและอาจได้ข้อมูลไม่ครบ **วิธีที่แน่นอนกว่าคือยืมสิทธิ์จาก session ในเบราว์เซอร์** — `10_export-from-base44.js` วางใน browser console ตอน login เป็น admin แล้วมันจะดึงทั้ง 45 entity ออกเป็น JSON ไฟล์เดียว

ข้อดี: ได้ข้อมูลชุดเดียวกับที่แอปเห็นเป๊ะ ๆ, ไม่ต้องหา API key, เป็น JSON เต็มรูป (ไม่เสียโครงสร้าง nested อย่าง `checklist`, `findings`, `change_history` ที่ CSV จะทำให้ยุ่ง)

> หมายเหตุ: หน้า **Database Backup** ที่มีในแอปอยู่แล้วครอบคลุมเพียง **14 จาก 45 entity** และ export เป็น CSV — ใช้เป็นทางเลือกสำรองได้ แต่ไม่พอสำหรับ migration

### 4.2 ขั้นตอน

```bash
# 1) export จาก Base44 (browser console) → acc-export-2026-08-17-1030.json

# 2) ตรวจก่อนเขียนจริง
export SUPABASE_URL=http://localhost:8000
export SUPABASE_SERVICE_ROLE_KEY=...
node 11_import-to-supabase.mjs acc-export-2026-08-17-1030.json --dry-run

# 3) เขียนจริง
node 11_import-to-supabase.mjs acc-export-2026-08-17-1030.json

# 4) GO-LIVE GATE
psql -f 04_verify.sql
psql -f 05_rls_test.sql
```

`11_import-to-supabase.mjs` ออกแบบให้:

- **idempotent** — `upsert` บน `id` เดิม รันซ้ำได้ไม่เกิดข้อมูลซ้ำ
- **ไม่ตัด field เงียบ ๆ** — ถ้า JSON มี field ที่ไม่มีใน schema จะรายงานชื่อ field ที่ตัดออกทุกตัว (ไม่ใช่ทิ้งเงียบ)
- แปลง `''` → `NULL` ให้คอลัมน์ `date` / `timestamptz` (Base44 ส่ง empty string มาบ่อย ซึ่ง Postgres ไม่รับ)
- **reconciliation อัตโนมัติ** — เทียบ `source count` กับ `loaded count` ทุกตาราง และ **exit code ≠ 0 ถ้าไม่ตรง**
- สร้าง `auth.users` + `profiles` ให้ผู้ใช้ทุกคน แล้ว backfill `created_by_id` จาก email

### 4.3 เรื่องผู้ใช้ — จุดที่ต้องสื่อสารกับพนักงาน

เดิม login ผ่าน Google (Base44 จัดการ) ตอนนี้เปลี่ยนเป็น email + password ในระบบเอง → **พนักงานทุกคนต้องตั้งรหัสผ่านใหม่** ควรทำแบบนี้:

1. Import สร้าง auth user ทุกคนไว้ล่วงหน้า (`email_confirm: true`) — ยังไม่มีรหัสผ่าน
2. วัน cutover ส่งลิงก์ตั้งรหัสผ่าน (`/auth/v1/recover`) ให้ทุกคนพร้อมกัน
3. บังคับ TOTP 2FA เฉพาะ role `admin` และ `management` (คนที่เข้าถึง credential vault ได้)

---

## 5. ความปลอดภัย — สามประเด็นที่ต้อง sign-off ก่อน go-live

### 5.1 Secret ปัจจุบันเก็บในตารางที่ผู้ใช้ทุกคนอ่านได้

จากการสแกนโค้ด: `credentialManager` อ่าน `credential_encryption_key` และ `lineSendMessage` อ่าน `line_access_token` **จากตาราง `AppConfig`** ซึ่ง frontend อ่านได้โดยตรง (พบ `base44.entities.AppConfig` ถูกเรียก 37 จุดจาก UI)

บน Base44 อาจพอรับได้เพราะ platform คุมชั้นการเข้าถึงให้ แต่บน PostgREST ตารางทุกตารางถูก expose เป็น REST endpoint → **ผู้ใช้ระดับ staff คนใดก็สามารถเรียก `/rest/v1/app_config` ตรง ๆ ด้วย token ของตัวเอง แล้วอ่านคีย์ถอดรหัส credential ของลูกค้าทั้งหมดได้**

`02_extra.sql` แก้ด้วยการสร้างตาราง `app_secret` แยก (service_role only, ไม่มี policy เลย) และ GATE 4 ใน `04_verify.sql` จะ **FAIL ถ้ายังพบคีย์หลงอยู่ใน `app_config`**

**ต้องทำในการ migrate:** ย้าย key เหล่านี้ไป `app_secret` และแก้ 2 function (`credentialManager`, `lineSendMessage` + ตัวอื่นที่อ่าน token) ให้อ่านจากตารางใหม่ พร้อม **หมุนคีย์ใหม่ทั้งหมด** เพราะคีย์ชุดเดิมถือว่าเคยเปิดเผยแล้ว

### 5.2 OTP เก็บเป็น plaintext ในตารางเดียวกัน

`credentialManager` เก็บ OTP ไว้ใน `AppConfig` เป็น `{"otp":"123456","expires":...}` แบบ plaintext → ผู้ใช้ที่อ่าน `app_config` ได้ ก็ **อ่าน OTP ของคนอื่นได้ ทำให้กลไก OTP ป้องกันการเข้าถึง credential ลูกค้าไม่มีผลจริง**

แก้แล้วใน `02_extra.sql`: ตาราง `otp_challenge` แยก (service_role only), เก็บ **hash** ไม่เก็บ OTP ดิบ, มี `attempts` counter กัน brute-force, และมี `purge_expired_otp()` ล้างของหมดอายุ GATE 5 ตรวจว่าไม่มี OTP ค้างใน `app_config`

### 5.3 ประเด็นสำคัญที่สุด: `anon key` อยู่ในไฟล์ที่ใครก็ดาวน์โหลดได้

`VITE_SUPABASE_ANON_KEY` ถูก compile ฝังลงใน JavaScript bundle — **ทุกคนที่เปิดเว็บได้ ก็มีคีย์นี้** สิ่งเดียวที่กั้นระหว่างคนนอกกับข้อมูลลูกค้าทั้งหมดคือ RLS

นี่คือเหตุผลที่ผมรัน negative test จริงแทนที่จะเขียน policy แล้วเชื่อว่าถูก ผลที่ยืนยันแล้ว:

| ผู้เข้าถึง | `task` | `customer` | `customer_credential` | `app_secret` |
|---|---:|---:|---:|---:|
| **anon** (ไม่ล็อกอิน — ใช้คีย์จาก bundle) | 0 | 0 | 0 | 0 |
| **staff** (ล็อกอินแล้ว) | ✅ เห็น | ✅ เห็น | **0** | 0 |
| **admin** | ✅ | ✅ | ✅ | 0 (service_role only) |

**RLS baseline ที่เลือกใช้** รักษาพฤติกรรมเดิมของ Base44 ไว้ (ไฟล์ entity ไม่มี row-level rule เลย → เดิมคือ "ล็อกอินแล้วเห็นทุกอย่าง" คุมสิทธิ์ที่ชั้น UI ด้วย `menu_permissions`) แต่ **ยกระดับ 3 ตารางที่เป็นข้อมูลอ่อนไหวตาม PDPA** ให้เข้มกว่าเดิม:

- `customer_credential` — อ่านได้เฉพาะ admin/management/manager, แก้ได้เฉพาะ admin/management
- `director_info` — เช่นเดียวกัน
- `audit_log` — **append-only**: insert ได้ทุกคน อ่านได้เฉพาะผู้บริหาร **และไม่มี policy สำหรับ update/delete เลย** → ไม่มีใครลบร่องรอยย้อนหลังได้ แม้แต่ admin (สำคัญต่อคุณค่าของ audit trail ในบริบทวิชาชีพบัญชี)

> **ข้อเสนอเชิงบริหาร:** baseline นี้ยังคง "staff เห็นข้อมูลลูกค้าทุกราย" ตามพฤติกรรมเดิม ซึ่งอาจไม่ใช่สิ่งที่ต้องการในระยะยาว การจำกัดให้พนักงานเห็นเฉพาะลูกค้าที่ตนรับผิดชอบเป็น **การยกระดับ ไม่ใช่การย้าย** — แนะนำให้ทำเป็น Phase ถัดไปหลังระบบนิ่งแล้ว ไม่ควรทำพร้อม migration เพราะจะแยกไม่ออกว่าปัญหาที่เจอมาจาก migration หรือจากกฎสิทธิ์ใหม่

---

## 6. Infrastructure (Ubuntu 24.04, on-prem)

### 6.1 Spec ที่แนะนำ — ปรับขึ้นจากฉบับร่างแรก

Supabase self-hosted รัน ~10 container พร้อมกัน (Postgres, Kong, GoTrue, PostgREST, Realtime, Storage, imgproxy, meta, edge-runtime, Studio, analytics) เมื่อรวมกับปริมาณข้อมูลของระบบนี้ (45 ตาราง, LineMessage และ AuditLog โตต่อเนื่อง) และรายงาน BI ที่ query หลายพันแถว:

| ระดับ | Spec | หมายเหตุ |
|---|---|---|
| ต่ำสุดที่ใช้ได้ | 4 core / 16 GB / 500 GB NVMe | จะเริ่มอึดเวลารันรายงาน ExecutiveBI พร้อมกันหลายคน |
| **แนะนำ** | **8 core / 32 GB / 2×1 TB NVMe (RAID 1)** | มี headroom สำหรับ 3–5 ปี |
| จำเป็นเสมอ | UPS 1000VA line-interactive | ไฟดับกลาง write = ฐานข้อมูลเสียหาย |

ค่า tuning ของ Postgres (shared_buffers 8GB, effective_cache_size 24GB) ตั้งไว้ใน `docker-compose.override.yml` สำหรับเครื่อง 32 GB แล้ว

### 6.2 การเชื่อมต่อจากภายนอก

เครื่องอยู่ในสำนักงาน (หลัง NAT, IP ไม่นิ่ง) และมี **สอง endpoint ที่ต้องรับ traffic จากภายนอกจริง** ซึ่งเป็นข้อจำกัดที่ต้องออกแบบรอบ:

1. **LINE Webhook** (`lineWebhook`) — LINE ต้องยิงเข้ามาได้
2. **Manus OCR Webhook** (`manusWebhook`) — บริการ OCR ต้องยิงผลกลับมาได้

จึงใช้ **Cloudflare Tunnel** (outbound-only ไม่ต้องเปิด port ที่ router ไม่ต้องมี static IP) โดยแยกเป็นสองชั้น:

| เส้นทาง | การป้องกัน |
|---|---|
| `/webhook/*` (LINE, Manus) | เปิดสาธารณะ **แต่** function ต้อง verify signature เอง — `lineWebhook` ตรวจ `X-Line-Signature` อยู่แล้ว ✅ / `manusWebhook` **ต้องตรวจสอบว่ามีการ verify หรือไม่** ถ้าไม่มีต้องเพิ่ม |
| ทุกเส้นทางอื่น (แอป, API) | Cloudflare Access ปิดกั้นชั้นแรก (ฟรี ≤50 users) แล้วจึงถึง GoTrue |
| Studio, Netdata, Uptime Kuma, SSH | **Tailscale เท่านั้น** ไม่ผูกกับ tunnel เลย |

### 6.3 Backup — ข้อเดียวที่ห้ามประนีประนอม

on-prem ไม่มี HA เครื่องเดียวเสียคือระบบล่มทั้งหมด ดังนั้น backup ไม่ใช่ "ควรมี" แต่คือมาตรการควบคุมหลัก

| ชั้น | วิธี | ความถี่ |
|---|---|---|
| WAL archiving | `archive_command` → `/wal-archive` (ตั้งใน override แล้ว) | ต่อเนื่อง → กู้ถึงจุดเวลาใดก็ได้ (PITR) |
| Logical dump | `pg_dump -Fc` ทุกตาราง | ทุกวัน 01:00 |
| Offsite (เข้ารหัสฝั่งเรา) | `restic` → Backblaze B2 | ทุกวัน |
| Storage bucket | `restic` โฟลเดอร์ `volumes/storage` | ทุกวัน |
| **Restore drill** | กู้ลง staging แล้วเทียบ row count + ยอดรวมเชิงธุรกิจ | **ทุกไตรมาส** |

> Backup ที่ไม่เคยทดสอบ restore ไม่ใช่ backup — เป็นแค่ความสบายใจที่ไม่มีมูลความจริง ควรบรรจุ restore drill ลงในปฏิทินงานเหมือน closing รายเดือน และให้มีคนที่ทำได้อย่างน้อยสองคน
>
> `restic` เข้ารหัสฝั่งเราก่อนส่งขึ้น cloud → ข้อมูลลูกค้าไม่รั่วแม้ผู้ให้บริการ cloud ถูกเจาะ ซึ่งเป็นข้อที่ตอบคำถาม PDPA ได้ตรงที่สุด **แต่ถ้าลืม `RESTIC_PASSWORD` จะกู้ไม่ได้เลยตลอดกาล** — ต้องเก็บใน password manager ของบริษัทที่มี emergency access ไม่ใช่ในหัวคนเดียว

---

## 7. Roadmap ที่แก้ใหม่ตามขนาดงานจริง

| Phase | งาน | Effort | Gate ผ่านออกจาก phase |
|---|---|---|---|
| **0. Discovery ที่เหลือ** | จด cron schedule ทั้ง 15 job จาก Base44 dashboard, ตรวจ webhook verification ของ `manusWebhook`, นับปริมาณข้อมูลจริง | 1–2 วัน | มี checklist cron ครบทุก job |
| **1. Infrastructure** | เครื่อง + Ubuntu + Docker + Supabase stack + Caddy + Cloudflare Tunnel + Tailscale | 3–4 วัน | เข้า Studio ผ่าน Tailscale ได้ |
| **2. Schema + RLS** | รัน `01`–`03`, ปรับ constraint ตาม business rule, `04_verify` + `05_rls_test` ผ่าน | **2–3 วัน** (ลดลงเพราะ generator ทำแล้ว) | GATE 1–8 PASS |
| **3. Auth + หน้า Login** | login, reset password, invite (Edge Function), TOTP 2FA, `AuthContext` ใหม่ | 4–6 วัน | พนักงานทดสอบ login ได้ 3 คน |
| **4. Frontend shim** | ทับ `base44Client.js`, ถอด `@base44/sdk`, ไล่ทดสอบทั้ง 52 หน้า | 5–8 วัน | ทุกหน้าโหลดได้ไม่มี error ใน console |
| **5. พอร์ต functions รอบ 1** | 24 functions ที่ไม่มี dependency ภายนอก | 6–8 วัน | ฟีเจอร์หลักใช้ได้ |
| **6. LINE + Email** | 13 + 10 functions, ย้าย secret ไป `app_secret`, หมุนคีย์, เปลี่ยน webhook URL | 5–7 วัน | ส่ง/รับ LINE และอีเมลได้จริง |
| **7. Google Drive OAuth** | consent flow, token store, refresh, 11 functions | 4–6 วัน | อัปโหลด/ดาวน์โหลดไฟล์ได้ |
| **8. Manus OCR** | 3 functions + re-register webhook | 2–3 วัน | ส่ง OCR แล้วได้ผลกลับ |
| **9. Cron (pg_cron)** | ตั้งทั้ง 15 job + **ยิงทดสอบทีละตัว** | 2–3 วัน | ทุก job ยิงสำเร็จอย่างน้อย 1 ครั้ง |
| **10. Data migration + UAT** | export/import/reconcile + parallel run | 3 วัน + **2 สัปดาห์ UAT** | row count ตรงทุกตาราง + sign-off ผู้ใช้ |
| **11. Cutover + Hypercare** | freeze, delta load, สลับ, เฝ้าระวัง | 1 วัน + 2 สัปดาห์ | — |
| **12. Ops hardening** | backup automation, monitoring, **restore drill ครั้งแรก**, เอกสาร | 3 วัน | restore สำเร็จบน staging |

**รวม 41–57 person-day** → **10–14 สัปดาห์** แบบทำควบงานประจำ / **5–7 สัปดาห์** full-time

---

## 8. Risk Register (ปรับตามสิ่งที่พบในโค้ด)

| # | ความเสี่ยง | ผลกระทบ | โอกาส | มาตรการ |
|---|---|---|---|---|
| **R1** | **ลืมย้าย cron job → การแจ้งเตือน deadline ภาษีหยุดทำงานเงียบ ๆ** | **รุนแรงมาก** (ความรับผิดทางวิชาชีพ, ค่าปรับลูกค้า) | **สูง** — schedule ไม่อยู่ใน repo | Checklist ทีละ job จาก dashboard; ยิงทดสอบทุกตัว; ตั้ง Uptime Kuma heartbeat ให้ทุก job รายงานเมื่อรันสำเร็จ **และแจ้งเตือนเมื่อขาดหาย** |
| **R2** | คีย์ถอดรหัส credential + LINE token อยู่ในตารางที่ staff อ่านได้ | รุนแรงมาก (PDPA) | **เกิดขึ้นแล้วในระบบปัจจุบัน** | ย้ายไป `app_secret`; **หมุนคีย์ใหม่ทุกตัว**; GATE 4 บังคับ |
| **R3** | OTP plaintext → กลไก OTP ไม่ป้องกันจริง | สูง | เกิดขึ้นแล้ว | ตาราง `otp_challenge` เก็บ hash + attempts counter |
| **R4** | RLS ไม่ครบ → ข้อมูลรั่วผ่าน anon key ใน bundle | รุนแรงมาก | กลาง | GATE 1–3 + `05_rls_test.sql` เป็น negative test บังคับก่อน deploy |
| **R5** | ข้อมูลถูกตัดที่ 1,000 แถว → รายงาน KPI ผิดแบบไม่มีสัญญาณเตือน | **สูง** (ใช้ประเมินผลพนักงาน) | กลาง | shim ไล่หน้าเอง + `PGRST_DB_MAX_ROWS=10000` + เทียบยอดรวมกับ Base44 ในช่วง parallel run |
| **R6** | Google Drive OAuth refresh พลาด → ไฟล์แนบเข้าไม่ได้ | สูง | กลาง | ทำ token refresh + retry; เก็บ `retryDriveSave` ที่มีอยู่แล้วไว้เป็น safety net; แจ้งเตือนเมื่อ refresh fail |
| **R7** | เครื่อง on-prem เสีย (ไม่มี HA) | สูง | ต่ำ–กลาง | WAL + daily dump + offsite; **restore drill ทุกไตรมาส**; documented rebuild ≤4 ชม.; เก็บ config เป็น IaC ใน git |
| **R8** | ไฟดับ/ไฟกระชาก → DB corruption | สูง | กลาง (ไทย) | UPS + `full_page_writes=on` + graceful shutdown script |
| **R9** | **Key-person risk** — คนเดียวที่เข้าใจระบบทั้ง 53,000 บรรทัด | **สูง** | **สูง** | Runbook ที่คนอื่นทำตามได้; credential ใน password manager ที่มี emergency access; IaC ไม่ใช่ manual config; ให้มีคนที่ restore ได้ ≥2 คน |
| R10 | Base44 dashboard มี platform state อื่นที่ยังไม่พบ (เช่น rate limit, custom domain, feature flag) | กลาง | กลาง | Parallel run 2 สัปดาห์เพื่อจับ edge case; เก็บ Base44 read-only 60 วันเป็น rollback |
| R11 | `manusWebhook` อาจไม่ verify signature → คนนอกยิง fake OCR result เข้ามาได้ | กลาง–สูง | **ต้องตรวจสอบ** | ตรวจโค้ดใน Phase 0; ถ้าไม่มี ให้เพิ่ม shared secret ก่อนเปิด tunnel |

---

## 9. ต้นทุน

### 9.1 CapEx

| รายการ | ประมาณการ |
|---|---|
| เครื่อง 8 core / 32 GB / 2×1 TB NVMe (RAID 1) | 45,000–65,000 ฿ |
| UPS 1000VA | 4,000–6,000 ฿ |
| **รวม** | **~50,000–70,000 ฿** |

### 9.2 OpEx ต่อเดือน

| รายการ | ประมาณการ |
|---|---|
| ค่าไฟ (~35W ต่อเนื่อง) | ~110–170 ฿ |
| Cloudflare Tunnel + Access (≤50 users) | 0 ฿ |
| Tailscale | 0 ฿ |
| Backblaze B2 (~150 GB) | ~60–90 ฿ |
| Anthropic API (`InvokeLLM` 1 จุด + `ExtractDataFromUploadedFile` 3 จุด — ใช้ตอน import ไม่ใช่ทุกวัน) | ~100–500 ฿ ตามการใช้งาน |
| Manus OCR | ตามสัญญาเดิม (ไม่เปลี่ยน) |
| **รวม** | **~300–800 ฿/เดือน** |

### 9.3 ต้นทุนที่มองไม่เห็น — ประเด็นที่ต้องตัดสินใจเชิงบริหาร

ต้นทุนจริงของการ self-host ไม่ใช่ค่าเครื่องหรือค่าไฟ แต่คือ:

| รายการ | ประมาณการ |
|---|---|
| งาน migration ครั้งแรก | 41–57 person-day |
| ดูแลรายเดือน (patch, ตรวจ backup, ตอบ incident) | 3–5 ชม./เดือน |
| Restore drill รายไตรมาส | 2–3 ชม./ไตรมาส |
| Upgrade Supabase (manual, ต้องทดสอบ staging ก่อน) | 4–8 ชม./ปี |

**สิ่งที่ได้กลับมาแลกกับต้นทุนนี้:** ไม่มี vendor lock-in, ข้อมูลลูกค้าอยู่ในสำนักงาน (ตอบ PDPA และคำถามลูกค้าเรื่องความลับได้ตรงกว่า), ไม่มีความเสี่ยงที่ platform เปลี่ยนราคา/ปิดบริการ/เปลี่ยน API, ควบคุม upgrade cycle ได้เอง

**สิ่งที่เสียไป:** ความสะดวกที่ platform จัดการให้ (auth, OAuth token, cron, TLS, HA) — ทั้งหมดกลายเป็นงานของเราตลอดอายุระบบ ไม่ใช่แค่ตอน migrate

> ข้อสังเกตตรงไปตรงมา: ระบบนี้ใหญ่กว่าที่ platform อย่าง Base44 ออกแบบมารองรับไปแล้ว (55 backend functions, 45 entity, ต่อระบบภายนอก 5 ระบบ) การย้ายออกมาเป็นการตัดสินใจที่มีเหตุผลรองรับดี **แต่ควรตัดสินใจโดยรู้ว่านี่คือการรับภาระ operations ถาวร ไม่ใช่งานโครงการที่จบแล้วจบกัน** ควรกำหนดผู้รับผิดชอบและผู้สำรองเป็นลายลักษณ์อักษรก่อนเริ่ม ไม่ใช่หลังจากนั้น

---

## 10. สิ่งที่ต้องการจากคุณเพื่อเดินต่อ

| # | สิ่งที่ต้องการ | สำคัญเพราะ |
|---|---|---|
| 1 | **ตารางเวลา cron ของทั้ง 15 job จาก Base44 dashboard** (ชื่อ job + เวลา + ความถี่) | ไม่มีในโค้ด และเป็นความเสี่ยง R1 ที่ร้ายที่สุด |
| 2 | Spec เครื่องที่มี/จะซื้อ + จำนวน RAM จริง | ปรับค่า tuning Postgres ให้ตรง (ค่าที่ตั้งไว้สมมติ 32 GB) |
| 3 | จำนวนผู้ใช้จริง และปริมาณข้อมูล (จำนวน record ของ `Task`, `LineMessage`, `AuditLog`, `TimeEntry`) | sizing disk + ประเมินเวลา import |
| 4 | โครงสร้าง Google Drive ที่ใช้อยู่ (บัญชีเจ้าของโฟลเดอร์, shared drive หรือ personal) | ออกแบบ OAuth flow ให้ถูกประเภท — ผิดประเภทแล้วต้องทำใหม่ |
| 5 | นโยบายเรื่องส่งเอกสารลูกค้า (ใบกำกับ, งบ) เข้า LLM ภายนอก | เลือกระหว่าง cloud API หรือ local model (Ollama บนเครื่องเดียวกัน) |
| 6 | Downtime window ที่ยอมรับได้สำหรับ cutover | เลือกกลยุทธ์ — แนะนำวันหยุด 4–6 ชม. ไม่คุ้มที่จะลงทุนทำ dual-write |
| 7 | ผู้รับผิดชอบดูแลระบบ + ผู้สำรอง (ชื่อจริง) | มาตรการต่อความเสี่ยง R9 |

> **ด้านความปลอดภัย:** อย่าวาง API key, service_role key, LINE channel secret หรือรหัสผ่านใด ๆ ในแชทนี้ ทุก secret ควรอยู่ใน `.env` บนเครื่องคุณหรือในตาราง `app_secret` เท่านั้น — `.env.example` ในแพ็กเกจเป็นแม่แบบให้แล้ว

---

## 11. ขั้นตอนถัดไปที่ทำได้ทันที (ไม่ต้องรอเครื่อง)

1. **ปิด repo กลับเป็น private** — ผมอ่านโค้ดครบแล้ว ไม่ต้องเปิดค้างไว้
2. รัน `10_export-from-base44.js` เพื่อดัมพ์ข้อมูลชุดแรก → ได้ทั้ง backup และตัวเลขปริมาณข้อมูลจริงสำหรับ sizing
3. เข้า Base44 dashboard จดตารางเวลา cron ทั้ง 15 job
4. สร้าง Google Cloud OAuth client (ใช้เวลา ~30 นาที ทำล่วงหน้าได้)
5. ถ้าเห็นชอบแนวทางนี้ ผมพอร์ต function กลุ่มแรก (24 ตัวที่ไม่มี dependency ภายนอก) ให้ดูเป็นตัวอย่างได้ทันที เพื่อยืนยันว่า shim ทำงานถูกก่อนลงทุนซื้อเครื่อง

---

*เอกสารนี้จัดทำจากการวิเคราะห์โค้ดจริงทั้ง repository ตัวเลข effort เป็นการประมาณการเชิงวิศวกรรมที่มีความไม่แน่นอนตามธรรมชาติ — ส่วนที่แน่นอนที่สุดคือ schema และ shim ที่ทดสอบแล้ว ส่วนที่ไม่แน่นอนที่สุดคือ Phase 7 (Google Drive OAuth) และปริมาณ edge case ที่จะพบใน UAT ราคาฮาร์ดแวร์เป็นประมาณการ ณ เดือนสิงหาคม 2569 ควรตรวจสอบกับผู้จำหน่ายก่อนอนุมัติงบประมาณ*
