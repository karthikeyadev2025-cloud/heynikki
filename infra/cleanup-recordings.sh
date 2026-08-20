#!/usr/bin/env bash
# ================================================================
# Hey Nikki — local recording cleanup
#
# WHY THIS EXISTS
# The plan says: "Record to disk → upload to R2 → purge local." The
# purge was never written. AI-handled calls no longer record to disk
# at all (the pipeline holds PCM in memory and uploads to R2), but
# human-mode calls still use record_session, and nothing deleted
# those. On a t3.large that fills the root volume over weeks and takes
# FreeSWITCH, the voice pipeline and the API server down at the same
# moment — the kind of outage that looks like a mystery until you run
# df.
#
# INSTALL (on the EC2 host):
#   sudo cp infra/cleanup-recordings.sh /usr/local/bin/
#   sudo chmod +x /usr/local/bin/cleanup-recordings.sh
#   ( crontab -l 2>/dev/null; \
#     echo "17 * * * * /usr/local/bin/cleanup-recordings.sh >> /var/log/heynikki-cleanup.log 2>&1" ) | crontab -
#
# Runs hourly at :17 — off the top of the hour so it doesn't collide
# with every other cron on the box.
# ================================================================
set -euo pipefail

REC_DIR="${REC_DIR:-/tmp/recordings}"
MAX_AGE_HOURS="${MAX_AGE_HOURS:-6}"     # R2 upload happens within seconds
DISK_WARN_PCT="${DISK_WARN_PCT:-80}"

[ -d "$REC_DIR" ] || { echo "$(date -Is) no $REC_DIR — nothing to do"; exit 0; }

before_kb=$(du -sk "$REC_DIR" 2>/dev/null | cut -f1 || echo 0)

# Age-based, not size-based: a file younger than MAX_AGE_HOURS could
# still be an in-progress call being written to right now.
deleted=$(find "$REC_DIR" -type f \( -name '*.wav' -o -name '*.mp3' \) \
  -mmin +$((MAX_AGE_HOURS * 60)) -print -delete 2>/dev/null | wc -l)

after_kb=$(du -sk "$REC_DIR" 2>/dev/null | cut -f1 || echo 0)
freed_mb=$(( (before_kb - after_kb) / 1024 ))

echo "$(date -Is) cleanup: removed ${deleted} file(s), freed ${freed_mb}MB, ${after_kb}KB remaining"

# Emergency valve. If the disk is still filling despite the sweep,
# something upstream is broken (R2 credentials wrong, uploads failing)
# and the recordings are piling up faster than the age window clears
# them. Say so loudly in the log rather than silently running to 100%.
used_pct=$(df --output=pcent "$REC_DIR" | tail -1 | tr -dc '0-9')
if [ "${used_pct:-0}" -ge "$DISK_WARN_PCT" ]; then
  echo "$(date -Is) WARNING: disk ${used_pct}% full after cleanup — check R2 upload health in the pipeline logs"
  # Last resort: drop the oldest half of what remains so the box stays up.
  if [ "${used_pct:-0}" -ge 92 ]; then
    echo "$(date -Is) CRITICAL: ${used_pct}% — emergency purge of oldest recordings"
    find "$REC_DIR" -type f -printf '%T@ %p\n' 2>/dev/null \
      | sort -n | head -n "$(( $(find "$REC_DIR" -type f | wc -l) / 2 ))" \
      | cut -d' ' -f2- | xargs -r rm -f
  fi
fi
