# Runbook นำระบบขึ้นเครื่อง — acc-front (Ubuntu 22.04, all-in-one)

รันในฐานะ root บนเครื่อง `acc-front` ทำตามลำดับ อย่าข้าม
โดเมน: `accoperation.com` · อีเมล admin: `suppakit.j@accconsultingservice.com`

---

## STEP 0 — ตรวจสเปกเครื่องก่อน (แล้วส่งผลให้ผมดู)

```bash
echo "CPU: $(nproc) cores"; \
echo "RAM: $(free -h | awk '/Mem:/{print $2}')"; \
echo "DISK:"; df -h / | awk 'NR==2{print "  root "$2" ใช้ไป "$3" เหลือ "$4}'; \
cat /etc/os-release | grep VERSION=
```

ต้องการอย่างน้อย: 4 core / 16 GB RAM / เหลือ disk ≥ 100 GB (แนะนำ 8 core / 32 GB)
ถ้า RAM < 16 GB บอกผม — ต้องปรับค่า tuning ใน `docker-compose.override.yml` ลง

---

## STEP 1 — ติดตั้งของที่ต้องมี (Docker, Node 20, psql 16, git)

```bash
apt update && apt -y full-upgrade
apt install -y ca-certificates curl gnupg git ufw fail2ban unattended-upgrades

# Docker Engine + compose plugin
curl -fsSL https://get.docker.com | sh

# Node.js 20 (ค่า default ของ 22.04 เก่าเกินไป)
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# PostgreSQL client 16 (ให้ตรงกับ server ใน container; pg_dump ต้อง >= server)
install -d /usr/share/postgresql-common/pgdg
curl -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc --fail-silent \
  https://www.postgresql.org/media/keys/ACCC4CF8.asc
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] \
https://apt.postgresql.org/pub/repos/apt jammy-pgdg main" > /etc/apt/sources.list.d/pgdg.list
apt update && apt install -y postgresql-client-16

# ตรวจว่าครบ
docker --version && docker compose version && node -v && psql --version && git --version
```

---

## STEP 1.5 — สร้าง swap 4 GB (จำเป็นบนเครื่อง RAM 8 GB)

Supabase รัน ~10 container + ตอน build frontend ใช้ RAM พีค → ต้องมี swap กัน OOM

```bash
fallocate -l 4G /swapfile
chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
sysctl -w vm.swappiness=10 && echo 'vm.swappiness=10' >> /etc/sysctl.conf
free -h    # ควรเห็น Swap: 4.0Gi
```

> **หมายเหตุความจุ (สำคัญต่อการตัดสินใจ):** 8 GB รันได้สำหรับเปิดใช้ช่วงแรก + UAT +
> งานประจำวันของพนักงาน แต่หน้า BI/รายงานที่ดึงข้อมูลหลายพันแถว (ExecutiveBI,
> KpiReportCenter) จะหน่วงและกิน RAM สูง — **ควรวางแผนอัป RAM เป็น 16 GB (ดีสุด 32 GB)
> ก่อนพึ่งพาหนักช่วงฤดูภาษี** เมื่ออัปแล้วปรับค่าใน override กลับขึ้น (ดูคอมเมนต์ในไฟล์)

---

## STEP 2 — Firewall (เปิดเฉพาะ SSH; ที่เหลือออกทาง tunnel)

```bash
ufw default deny incoming && ufw default allow outgoing
ufw allow 22/tcp
ufw --force enable
ufw status
```

---

## STEP 3 — เอาโค้ดขึ้นเครื่อง (kit + app repo)

**3.1 App repo** (โค้ดแอปจาก GitHub):
```bash
cd /root
git clone https://github.com/suppakitj/acc-operation-System.git app
```

**3.2 Migration kit** — ไฟล์ `acc-migration-kit.zip` ที่ผมส่งในแชท
ให้ส่งขึ้นเครื่องจากคอมคุณ (รันบน **เครื่องคุณ** ไม่ใช่ server):
```bash
scp acc-migration-kit.zip root@<ไอพีหรือโฮสต์ของ acc-front>:/root/
```
แล้วกลับมาที่ server แตกไฟล์:
```bash
cd /root && apt install -y unzip && unzip -o acc-migration-kit.zip
# ได้โฟลเดอร์ /root/acc-migration
```

---

## STEP 4 — Apply โค้ดที่พอร์ตแล้วทับ app repo

```bash
cd /root/acc-migration
bash infra/apply-to-repo.sh /root/app
```
จะคัดลอก shim/หน้าใหม่/functions/migration ทับ พร้อมสำรองไฟล์เดิมเป็น `*.bak`

---

## STEP 5 — Bootstrap รอบแรก (สร้าง .env แล้วหยุดให้เติม secret)

```bash
cd /root/acc-migration
APP_ORIGIN=https://accoperation.com \
ADMIN_EMAIL=suppakit.j@accconsultingservice.com \
bash infra/bootstrap.sh /opt/acc /root/app
```
รอบแรกจะ clone Supabase, generate key อัตโนมัติ, สร้าง `/opt/acc/.env` **แล้วหยุด**

---

## STEP 6 — เติม secret ใน /opt/acc/.env

```bash
nano /opt/acc/.env
```
เติมค่าเหล่านี้ (ที่เหลือ gen ให้แล้ว):

| ตัวแปร | ค่า |
|---|---|
| `SMTP_USER` / `SMTP_PASS` | บัญชี M365 ที่ใช้ส่งเมล + app password |
| `ANTHROPIC_API_KEY` | key จาก console.anthropic.com |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | จากคู่มือ Google OAuth |

> LINE token / credential encryption key / Manus key — **ไม่ต้องใส่ในไฟล์นี้**
> ไปตั้งในหน้า AppSettings หลังระบบขึ้น (เก็บใน DB, admin เท่านั้นที่อ่าน)

---

## STEP 7 — Bootstrap รอบสอง (ยกระบบจริง)

```bash
cd /root/acc-migration
APP_ORIGIN=https://accoperation.com \
ADMIN_EMAIL=suppakit.j@accconsultingservice.com \
bash infra/bootstrap.sh /opt/acc /root/app
```
รอบนี้จะ: `docker compose up` → รัน migration ทั้งหมด (01–08) → deploy functions →
build frontend → seed admin → ส่งลิงก์ตั้งรหัสผ่านไปที่อีเมล admin

ตรวจว่าขึ้นครบ:
```bash
cd /opt/acc && docker compose ps      # ทุก service ควร Up/healthy
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080   # ควรได้ 200
psql "postgresql://postgres:$(grep '^POSTGRES_PASSWORD=' /opt/acc/.env | cut -d= -f2)@localhost:5432/postgres" \
  -c "select count(*) as tables from pg_tables where schemaname='public';"   # ~51
```

---

## STEP 8 — เปิดสู่ภายนอก + admin plane (ตามคู่มือ SETUP-google-oauth-cloudflare)

```bash
# Cloudflare Tunnel → 127.0.0.1:8080  (โดเมน accoperation.com)
# Tailscale → เข้า Studio 127.0.0.1:3000 ผ่าน SSH forward
```
รายละเอียดทีละขั้นอยู่ใน `docs/SETUP-google-oauth-cloudflare.md`

---

## STEP 9 — Go-live gate + ย้ายข้อมูล

```bash
export DB_URL="postgresql://postgres:$(grep '^POSTGRES_PASSWORD=' /opt/acc/.env | cut -d= -f2)@localhost:5432/postgres"
# 1) เปิด Base44 (browser console) วาง 10_export-from-base44.js → ได้ acc-export-*.json → scp ขึ้น server
export SUPABASE_URL=http://localhost:8000
export SUPABASE_SERVICE_ROLE_KEY=$(grep '^SERVICE_ROLE_KEY=' /opt/acc/.env | cut -d= -f2)
node migration/11_import-to-supabase.mjs acc-export-*.json --dry-run   # ตรวจ
node migration/11_import-to-supabase.mjs acc-export-*.json             # เขียนจริง
# 2) GATE — ต้อง PASS ทุกข้อ
psql "$DB_URL" -f migration/04_verify.sql
```

---

## STEP 10 — หลังข้อมูลเข้า

1. ตั้ง secret ในหน้า AppSettings (LINE, credential key, Manus)
2. เชื่อม Google Drive (ปุ่มใน AppSettings)
3. เปลี่ยน webhook URL ที่ LINE/Manus → `https://accoperation.com/functions/v1/lineWebhook` / `.../manusWebhook`
4. ตั้ง cron backup: `crontab -e` →
   ```
   0 2 * * * PGURL="postgresql://postgres:PASS@localhost:5432/postgres" RESTIC_REPOSITORY=... RESTIC_PASSWORD=... STACK_DIR=/opt/acc /root/acc-migration/infra/backup.sh
   ```
5. เปิดหน้า **สุขภาพระบบ** (/OpsHealth) เช็คว่า cron + backup เขียว
6. UAT กับพนักงาน 2–3 คน ~1–2 สัปดาห์ ก่อนใช้จริงเต็ม

---

### ถ้าติดตรงไหน
เก็บ log แล้วส่งมา: `cd /opt/acc && docker compose logs --tail=50 <service>`
ผมช่วยไล่แก้ทีละจุดได้ครับ

**เฉพาะเครื่อง RAM 8 GB — ถ้า container วน restart / OOM:**
- ดู RAM ระหว่างรัน: `docker stats --no-stream`
- ตัวที่กิน RAM มากและตัดออกได้บนเครื่องเล็กคือ `analytics` (logflare) + `vector` (log pipeline)
  ถ้าจำเป็นให้หยุดชั่วคราว: `cd /opt/acc && docker compose stop analytics vector`
  (Studio ยังใช้ได้ แค่ไม่มีหน้า Logs ใน dashboard — ยอมได้ช่วงแรก)
- ถ้า `npm run build` ถูก kill (exit 137 = OOM) ให้ยืนยันว่า swap ขึ้นแล้ว (STEP 1.5)
  หรือหยุด container ชั่วคราวตอน build: `docker compose stop` → build → `docker compose start`
