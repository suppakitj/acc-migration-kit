#!/usr/bin/env bash
# ============================================================================
# apply-to-repo.sh — นำโค้ดที่พอร์ตแล้วไปวางในเครื่อง dev ที่ clone repo เดิมไว้
#   ./apply-to-repo.sh /path/to/acc-operation-System
# ทำสำเนา (.bak) ให้ไฟล์เดิมก่อนทับ และ commit ได้เองภายหลัง
# ============================================================================
set -euo pipefail
KIT="$(cd "$(dirname "$0")/.." && pwd)"
REPO="${1:?ระบุ path ของ repo เช่น ./apply-to-repo.sh ~/acc-operation-System}"
[ -d "$REPO/src/api" ] || { echo "ไม่ใช่ repo ACC (ไม่พบ src/api)"; exit 1; }

bak() { [ -f "$1" ] && cp "$1" "$1.bak" || true; }

echo "== frontend =="
for f in src/api/base44Client.js src/api/supabaseClient.js src/api/entityMap.js \
         src/lib/AuthContext.jsx src/pages/Login.jsx src/pages/ResetPassword.jsx \
         src/pages/RequestSLABoard.jsx src/pages/FilingTracker.jsx src/pages/OpsHealth.jsx \
         src/components/layout/Sidebar.jsx src/components/auth/useAccessControl.jsx src/hooks/usePermissionMatrix.js \
         src/App.jsx vite.config.js package.json; do
  mkdir -p "$REPO/$(dirname "$f")"
  bak "$REPO/$f"
  cp "$KIT/frontend/$f" "$REPO/$f"
  echo "  ✓ $f"
done
# ไฟล์เฉพาะ Base44 ที่ไม่ใช้แล้ว
[ -f "$REPO/src/lib/app-params.js" ] && mv "$REPO/src/lib/app-params.js" "$REPO/src/lib/app-params.js.removed" && echo "  ✓ ย้าย app-params.js ออก"

echo "== backend functions (Supabase Edge) =="
mkdir -p "$REPO/supabase"
cp -r "$KIT/supabase/functions" "$REPO/supabase/functions"
cp "$KIT/supabase/config.toml" "$REPO/supabase/config.toml"
echo "  ✓ supabase/functions (+config.toml)"

echo "== migration =="
cp -r "$KIT/migration" "$REPO/migration"
echo "  ✓ migration/"

cat <<'NOTE'

เสร็จ — ขั้นตอนถัดไปในเครื่อง dev:
  cd <repo>
  npm install            # ถอด @base44/* + เพิ่ม @supabase/supabase-js แล้วใน package.json
  cp .env.example .env.local && แก้ VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
  npm run build
ไฟล์เดิมถูกสำรองเป็น *.bak — ตรวจ diff แล้ว commit ได้เลย
NOTE
