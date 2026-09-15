#!/usr/bin/env bash
# check-bulk-import-status.sh — daily REMINDER ONLY for the paused Phase 9
# initial force-overwrite pull (job_key=initial_force_pull). Deliberately does
# NOT run bulk-import itself: docs/deployment.md explicitly says not to put
# --force-overwrite on any scheduled/cron invocation (it bypasses the normal
# review-queue/trust-threshold safety routing, so an unattended run could
# clobber an admin edit with nobody watching). This just nudges a human to
# run the real command themselves.
#
# Installed as a systemd --user timer (see scripts/install-bulk-import-reminder.sh).
set -euo pipefail

# job_key -> its exact resume command. Both are checked each run; each
# self-disables its own nagging once done (the timer itself only turns off
# once ALL tracked jobs are done, checked at the bottom).
declare -A JOBS=(
	[initial_force_pull]="cd apps/admin && npm run bulk-import -- --force-overwrite --categories=ship,manufacturer,weapon,location,commodity --job-key=initial_force_pull --max-per-category=500"
	[manufacturer_image_backfill]="cd apps/admin && npm run bulk-import -- --force-overwrite --categories=manufacturer --job-key=manufacturer_image_backfill --max-per-category=500"
)
LOG_FILE="${HOME}/.local/state/ussalmc-bulk-import-reminder.log"
mkdir -p "$(dirname "$LOG_FILE")"

notify() {
	local msg="$1"
	echo "$(date -Iseconds) $msg" >>"$LOG_FILE"
	notify-send --urgency=normal "USSALMC bulk import" "$msg" 2>/dev/null || true
	wall "USSALMC bulk import: $msg" 2>/dev/null || true
}

if ! docker inspect ussalmc-db >/dev/null 2>&1 || [ "$(docker inspect -f '{{.State.Running}}' ussalmc-db 2>/dev/null)" != "true" ]; then
	notify "ussalmc-db container isn't running — can't check bulk-import job status today."
	exit 0
fi

all_done=true
for JOB_KEY in "${!JOBS[@]}"; do
	RESUME_CMD="${JOBS[$JOB_KEY]}"
	STATUS="$(docker exec ussalmc-db psql -U ussa -d ussa_lore -tA -c \
		"SELECT status FROM bulk_import_jobs WHERE job_key='${JOB_KEY}';" 2>/dev/null | tr -d '[:space:]')"

	case "$STATUS" in
	"done")
		notify "${JOB_KEY} finished! No more runs needed."
		;;
	"paused_rate_limit")
		notify "${JOB_KEY} is still paused (daily rate cap hit) — resume with: ${RESUME_CMD}"
		all_done=false
		;;
	"running")
		notify "${JOB_KEY} shows status=running — probably mid-run, or crashed without updating status. Check before resuming."
		all_done=false
		;;
	"")
		# No row yet (job never started) — nothing to nag about.
		;;
	*)
		notify "${JOB_KEY} status is '${STATUS}' (unexpected) — check bulk_import_jobs before resuming."
		all_done=false
		;;
	esac
done

if [ "$all_done" = true ]; then
	systemctl --user disable --now ussalmc-bulk-import-reminder.timer 2>/dev/null || true
fi
