# ACC Operation System — ระบบเต็ม (Base44 → self-hosted Supabase)

ระบบที่พอร์ตครบทั้งชุด พร้อมนำขึ้นเครื่อง Ubuntu 24.04 ของบริษัท
สร้างจากการสแกนโค้ดจริงทั้ง repository และทดสอบเท่าที่ทำได้ใน sandbox

**อ่านสถานะตามจริงก่อน:** ส่วน [สถานะและสิ่งที่ต้องทำบนเครื่องจริง](#สถานะ) ท้ายไฟล์

---

## มีอะไรในชุดนี้ (สมบูรณ์แล้ว)

| ส่วน | สถานะ |
|---|---|
| **Backend functions** | พอร์ต **58** + integration **6** + ฟีเจอร์ใหม่ **4** = **68 ตัว** — ผ่าน `deno lint` |
| **Shared shim** | `base44-compat.ts` (server), `anthropic.ts`, `auth.ts`, `entity-map.ts` |
| **Native triggers** | `autoSetCompletedDate`, `trackDueDateChange` → PL/pgSQL (ทดสอบผ่าน) |
| **Frontend** | shim `base44Client.js` + หน้า Login/ResetPassword + AuthContext ใหม่ + router guard — **`npm run build` ผ่านทั้งแอป** |
| **Database** | 01–08 SQL: 51 ตาราง (+filing_record, ops_backup_log), secret-key RLS, cron, triggers, business-day fn — PostgreSQL 16 idempotent |
| **Security** | GATE 1–6 PASS, RLS negative test PASS, webhook fail-closed, secret กัน staff อ่าน |
| **Deploy** | `bootstrap.sh` (one-command), `gen-keys.mjs`, `seed_admin.mjs`, `apply-to-repo.sh`, `backup.sh` |
| **ฟีเจอร์ใหม่ (staff)** | LINE→task+SLA · ติดตามการยื่น RD/DBD/SSO · Ops/Backup health (ดู `docs/FEATURES-new.md`) |

---

## วิธีนำขึ้นระบบ — 3 ขั้นตอน

### ขั้น A — เตรียมโค้ด (บนเครื่อง dev)

```bash
# clone repo เดิมจาก Base44 แล้ว apply โค้ดที่พอร์ตแล้วทับ
git clone https://github.com/suppakitj/acc-operation-System.git
cd acc-migration && ./infra/apply-to-repo.sh ../acc-operation-System
# ไฟล์เดิมถูกสำรองเป็น *.bak — ตรวจ diff แล้ว commit
```

### ขั้น B — ยกระบบ (บนเครื่อง server Ubuntu 24.04)

```bash
# ต้องมี docker, docker compose, node 20+, git, psql
APP_ORIGIN=https://accoperation.com \
ADMIN_EMAIL=suppakit.j@accconsultingservice.com \
./infra/bootstrap.sh /opt/acc /path/to/acc-operation-System
```

รอบแรก bootstrap จะสร้าง `.env` แล้ว**หยุดให้เติมค่า** — เปิด `/opt/acc/.env` กรอก:
`SMTP_USER/SMTP_PASS` (M365), `ANTHROPIC_API_KEY`, `GOOGLE_CLIENT_ID/SECRET`
แล้วรัน bootstrap ซ้ำ — มันจะ up stack, รัน migration, deploy functions, build frontend, seed admin ให้อัตโนมัติ

### ขั้น C — ต่อโลกภายนอก + ย้ายข้อมูล

```bash
# 1) Cloudflare Tunnel ชี้มา 127.0.0.1:8080 ; Tailscale สำหรับ Studio (127.0.0.1:3000)
# 2) ย้ายข้อมูลจริง (ดู migration/):
#    - เปิด Base44 (browser console) วาง 10_export-from-base44.js → ได้ acc-export-*.json
node migration/11_import-to-supabase.mjs acc-export-*.json --dry-run   # ตรวจ
node migration/11_import-to-supabase.mjs acc-export-*.json             # เขียนจริง
# 3) GO-LIVE GATE
psql "$DB_URL" -f migration/04_verify.sql
```

---

## เรื่องที่ต้องทำเองหลังระบบขึ้น (ยืนยันจาก Base44 dashboard)

1. **ตั้งค่า secret ในหน้า AppSettings**: LINE channel token/secret, credential encryption key, Manus API/webhook secret — ระบบเก็บใน `app_config` (admin เท่านั้นที่อ่าน/แก้ได้)
2. **เชื่อม Google Drive**: เปิด AppSettings กด "เชื่อม Google Drive" → consent (googleOAuthStart/Callback เก็บ refresh token ให้)
3. **เปลี่ยน webhook URL** ที่ LINE Developer Console → `https://<origin>/functions/v1/lineWebhook` และที่ Manus → `.../manusWebhook` (ตั้ง `manus_webhook_secret` ก่อน ไม่งั้น fail-closed จะปฏิเสธ)
4. **ทดสอบ cron 13 job**: `select * from cron.job_run_details order by start_time desc;` — ต้องเห็นทุก job รันสำเร็จ
5. **ทดสอบ loop guard ของ Peak sync** (ดู 07_entity_triggers.sql)

---

## <a name="สถานะ"></a>สถานะตามจริง — สิ่งที่ทดสอบแล้ว vs ต้องทดสอบบนเครื่องจริง

**ทดสอบแล้วใน sandbox:**
- SQL ทั้ง 7 ไฟล์รันบน PostgreSQL 16 จริง — idempotent, GATE 1–6 PASS, RLS negative test PASS
- native trigger 2 ตัว — ทดสอบด้วยข้อมูลจริงผ่านทุกเคส
- frontend `npm run build` — ทั้งแอป (56 หน้า ~250 component) คอมไพล์ผ่านกับ Supabase, ถอด base44 หมด
- backend 59 functions — `deno lint` ผ่าน (พบเฉพาะ style เดิม 5 จุด ไม่ใช่ error)
- gen-keys — สร้าง JWT anon/service ถูกต้อง

**ยังต้องทดสอบบนเครื่องจริงเท่านั้น (sandbox ทำแทนไม่ได้):**
- `deno check` เต็ม (sandbox บล็อก jsr.io) — รันบนเครื่องที่เข้า registry ได้
- shim ฝั่ง client/server กับ Supabase + PostgREST + Deno runtime จริง (end-to-end)
- SMTP ส่งจริง, Anthropic API จริง, Google OAuth flow จริง, LINE/Manus webhook จริง
- ย้ายข้อมูลจริง + reconciliation + **UAT กับผู้ใช้จริง**

> **สรุป:** ระบบถูกสร้างและเดินสายครบทุกชิ้นแล้ว และผ่านการตรวจสอบทุกอย่างที่ตรวจได้โดยไม่มีเครื่องจริง
> ขั้นที่เหลือคือ "รันบนเครื่องจริงกับ secret และข้อมูลจริง แล้ว UAT" ซึ่งเป็นงานที่ต้องทำในสภาพแวดล้อมของบริษัทเท่านั้น
> โปรดอย่าข้าม UAT และ GO-LIVE GATE ก่อนเปิดใช้กับข้อมูลลูกค้าจริง

---

## โครงสร้างไฟล์

```
supabase/functions/         59 Edge Functions + _shared/ (compat, anthropic, auth, entity-map)
supabase/config.toml        verify_jwt ต่อ function (webhook = false)
migration/                  01–07 SQL, gen_schema.py, export/import, seed_admin, run_all
frontend/                   api shim, AuthContext, Login, ResetPassword, App, vite, package
infra/                      bootstrap.sh, gen-keys.mjs, apply-to-repo.sh, compose override, Caddyfile
docs/                       Blueprint, automation mapping, functions inventory
```
