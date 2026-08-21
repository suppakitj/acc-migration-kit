#!/usr/bin/env bash
# ============================================================================
# backup.sh — สำรองฐานข้อมูล + storage แล้วบันทึกสถานะลง ops_backup_log
#   (หน้า OpsHealth อ่านตารางนี้เพื่อดูความสดของ backup)
# ตั้งเป็น cron/systemd timer รายวัน เช่น 02:00 น.
#
# ต้องมี env: PGURL (postgres superuser), RESTIC_REPOSITORY, RESTIC_PASSWORD,
#            B2_ACCOUNT_ID, B2_ACCOUNT_KEY, STACK_DIR (โฟลเดอร์ supabase docker)
# ============================================================================
set -uo pipefail
: "${PGURL:?ต้องตั้ง PGURL เช่น postgresql://postgres:PASS@localhost:5432/postgres}"
STACK_DIR="${STACK_DIR:-/opt/acc}"
STAMP=$(date +%Y%m%d_%H%M%S)
OUT="/var/backups/acc"; mkdir -p "$OUT"
started=$(date -u +%Y-%m-%dT%H:%M:%SZ)

log_row() {  # kind status size location message
  psql "$PGURL" -q -c "insert into public.ops_backup_log(kind,status,started_at,finished_at,size_bytes,location,message)
    values ('$1','$2','$started', now(), ${3:-null}, $(printf '%q' "'$4'" 2>/dev/null || echo "'$4'"), '$5');" 2>/dev/null \
   || psql "$PGURL" -q -v s="$started" -v k="$1" -v st="$2" -v sz="${3:-null}" -v loc="$4" -v msg="$5" \
        -c "insert into public.ops_backup_log(kind,status,started_at,finished_at,size_bytes,location,message) values (:'k',:'st',:'s',now(), NULLIF(:'sz','null')::bigint, :'loc', :'msg');"
}

# 1) pg_dump (custom format)
DUMP="$OUT/acc_${STAMP}.dump"
if pg_dump "$PGURL" -Fc -f "$DUMP" 2>/tmp/bk_dump.err; then
  SZ=$(stat -c%s "$DUMP" 2>/dev/null || echo null)
  log_row pg_dump success "$SZ" "$DUMP" "ok"
else
  log_row pg_dump failed null "$DUMP" "$(tail -c 300 /tmp/bk_dump.err | tr \"'\" ' ')"
fi

# 2) restic → offsite (เข้ารหัสฝั่งเรา) — DB dump + storage volume
if command -v restic >/dev/null && [ -n "${RESTIC_REPOSITORY:-}" ]; then
  restic snapshots >/dev/null 2>&1 || restic init >/dev/null 2>&1
  if restic backup "$OUT" "$STACK_DIR/volumes/storage" >/tmp/bk_restic.log 2>&1; then
    log_row restic success null "$RESTIC_REPOSITORY" "ok"
  else
    log_row restic failed null "$RESTIC_REPOSITORY" "$(tail -c 300 /tmp/bk_restic.log | tr \"'\" ' ')"
  fi
  restic forget --keep-daily 14 --keep-weekly 8 --keep-monthly 12 --prune >/dev/null 2>&1 || true
fi

# 3) เก็บ dump ในเครื่องย้อนหลัง 14 วัน
find "$OUT" -name 'acc_*.dump' -mtime +14 -delete 2>/dev/null || true
echo "backup done: $STAMP"
