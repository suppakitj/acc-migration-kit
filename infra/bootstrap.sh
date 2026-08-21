#!/usr/bin/env bash
# ============================================================================
# bootstrap.sh — ยกระบบทั้งชุดบน Ubuntu 24.04 (รันบนเครื่อง server)
# ทำ: ติดตั้ง Supabase self-hosted, วาง override, gen keys, up, migrate,
#     deploy functions, build frontend, seed admin
#
# ต้องมีก่อน: docker + docker compose, node 20+, git, psql client
# ใช้:  APP_ORIGIN=https://accoperation.com \
#       ADMIN_EMAIL=suppakit.j@accconsultingservice.com \
#       ./bootstrap.sh /opt/acc /path/to/acc-operation-System(repo ที่ apply แล้ว)
# ============================================================================
set -euo pipefail
KIT="$(cd "$(dirname "$0")/.." && pwd)"
STACK="${1:-/opt/acc}"
REPO="${2:?ระบุ path repo ที่ apply-to-repo.sh แล้ว}"
: "${APP_ORIGIN:?ต้องตั้ง APP_ORIGIN}"
: "${ADMIN_EMAIL:?ต้องตั้ง ADMIN_EMAIL}"

echo "==[1/7] เตรียม Supabase self-hosted ที่ $STACK"
mkdir -p "$STACK"
if [ ! -f "$STACK/docker-compose.yml" ]; then
  tmp=$(mktemp -d)
  git clone --depth 1 https://github.com/supabase/supabase "$tmp/supabase"
  cp -r "$tmp/supabase/docker/." "$STACK/"
  rm -rf "$tmp"
fi
cp "$KIT/infra/docker-compose.override.yml" "$STACK/docker-compose.override.yml"
mkdir -p "$STACK/caddy" && cp "$KIT/infra/caddy/Caddyfile" "$STACK/caddy/Caddyfile"

echo "==[2/7] สร้าง .env (ถ้ายังไม่มี)"
if [ ! -f "$STACK/.env" ]; then
  cp "$KIT/infra/.env.example" "$STACK/.env"
  node "$KIT/infra/gen-keys.mjs" >> "$STACK/.env"
  {
    echo "APP_ORIGIN=$APP_ORIGIN"
    echo "SITE_URL=$APP_ORIGIN"
    echo "API_EXTERNAL_URL=$APP_ORIGIN"
    echo "SUPABASE_PUBLIC_URL=$APP_ORIGIN"
  } >> "$STACK/.env"
  echo "  → สร้าง .env แล้ว **เปิดเติม SMTP_*, ANTHROPIC_API_KEY, GOOGLE_* ก่อนไปต่อ**"
  echo "  หยุดที่นี่เพื่อเติมค่า แล้วรัน bootstrap.sh ซ้ำ" ; exit 0
fi

set -a; . "$STACK/.env"; set +a
DB_URL="postgresql://postgres:${POSTGRES_PASSWORD}@localhost:5432/postgres"

echo "==[3/7] docker compose up"
( cd "$STACK" && docker compose up -d )
echo "  รอ Postgres พร้อม..."; sleep 20

echo "==[4/7] รัน migration + triggers + cron"
DB_URL="$DB_URL" SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" WITH_CRON=1 bash "$KIT/migration/00_run_all.sh"

echo "==[5/7] deploy Edge Functions"
if command -v supabase >/dev/null; then
  ( cd "$REPO" && supabase functions deploy --project-ref local || \
    echo "  (ถ้าใช้ self-host ล้วน ให้ mount supabase/functions เข้า edge-runtime container แทน)" )
else
  echo "  ไม่พบ supabase CLI — คัดลอก $REPO/supabase/functions เข้า volume ของ edge-runtime"
fi

echo "==[6/7] build frontend → Caddy"
( cd "$REPO" && npm install --no-audit --no-fund && \
  printf 'VITE_SUPABASE_URL=%s\nVITE_SUPABASE_ANON_KEY=%s\n' "$APP_ORIGIN" "$ANON_KEY" > .env.local && \
  npm run build )
rm -rf "$STACK/caddy/site" && cp -r "$REPO/dist" "$STACK/caddy/site"

echo "==[7/7] seed admin"
SUPABASE_URL="http://localhost:8000" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
  ADMIN_EMAIL="$ADMIN_EMAIL" APP_ORIGIN="$APP_ORIGIN" \
  node "$KIT/migration/seed_admin.mjs"

( cd "$STACK" && docker compose restart caddy )
echo
echo "เสร็จ ✅  เปิด $APP_ORIGIN แล้วตั้งรหัสผ่าน admin จากอีเมล"
echo "ถัดไป: ตั้ง Cloudflare Tunnel ชี้มาที่ 127.0.0.1:8080 และ Tailscale สำหรับ Studio"
