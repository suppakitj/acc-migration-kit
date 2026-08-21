#!/usr/bin/env bash
# ============================================================================
# 00_run_all.sh — รัน migration SQL ทั้งหมดตามลำดับ (idempotent)
#   DB_URL="postgresql://postgres:<pass>@localhost:5432/postgres" ./00_run_all.sh
# ============================================================================
set -euo pipefail
cd "$(dirname "$0")"

: "${DB_URL:?ต้องตั้ง DB_URL เช่น postgresql://postgres:PASS@localhost:5432/postgres}"

run() { echo "── $1"; psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$1"; }

run 01_schema.sql
run 02_extra.sql
run 03_helpers.sql
run 07_entity_triggers.sql
run 08_features.sql

# 06_cron.sql ต้องมี pg_cron/pg_net + app.service_key — รันแยกหลังตั้งค่า
if [ "${WITH_CRON:-0}" = "1" ]; then
  : "${SERVICE_ROLE_KEY:?ต้องมี SERVICE_ROLE_KEY เพื่อให้ cron ยิง Edge Function}"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -c "alter database postgres set app.service_key = '${SERVICE_ROLE_KEY}';"
  echo "  (ตั้ง app.service_key แล้ว — เปิด connection ใหม่ให้ค่ามีผล)"
  run 06_cron.sql
else
  echo "── ข้าม 06_cron.sql (ตั้ง WITH_CRON=1 พร้อม SERVICE_ROLE_KEY เพื่อรัน)"
fi

echo
echo "== GO-LIVE GATE =="
psql "$DB_URL" -f 04_verify.sql
echo
echo "เสร็จ — ตรวจผล GATE ด้านบนต้อง PASS ทุกข้อก่อน cutover"
echo "รัน RLS negative test บน STAGING เท่านั้น:  psql \"\$DB_URL\" -f 05_rls_test.sql"
