#!/usr/bin/env bash
# claim-next.sh — Find the next unprocessed transcript and claim it.
# Outputs the folder name on success, "IDLE" if nothing left.
# Uses mkdir as an atomic lock (works on macOS and Linux).
# Treats in-progress claims older than 20 minutes as stale.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ABSORB_LOG="$REPO_ROOT/coach/_absorb_log.json"
TRANSCRIPTS_DIR="$REPO_ROOT/transcripts"
LOCKDIR="$REPO_ROOT/coach/.claim.lock"
STALE_MINUTES=20

# Acquire lock via mkdir (atomic on all Unix)
attempts=0
while ! mkdir "$LOCKDIR" 2>/dev/null; do
  attempts=$((attempts + 1))
  if [ $attempts -gt 60 ]; then
    echo "ERROR: Could not acquire lock after 30s" >&2
    exit 1
  fi
  sleep 0.5
done
trap 'rmdir "$LOCKDIR" 2>/dev/null' EXIT

# Find next folder: skip complete entries and fresh in-progress entries.
# Reclaim stale in-progress entries (older than STALE_MINUTES).
export ABSORB_LOG TRANSCRIPTS_DIR STALE_MINUTES
next_folder=$(python3 << 'PYEOF'
import json, os, datetime

absorb_log = os.environ["ABSORB_LOG"]
transcripts_dir = os.environ["TRANSCRIPTS_DIR"]
stale_minutes = int(os.environ["STALE_MINUTES"])

with open(absorb_log) as f:
    data = json.load(f)

now = datetime.datetime.now(datetime.UTC).replace(tzinfo=None)

# Build set of claimed folders (complete or fresh in-progress)
claimed = set()
stale = set()
for entry in data["absorbed"]:
    folder = entry["folder"]
    status = entry.get("status", "complete")
    if status == "complete":
        claimed.add(folder)
    elif status == "in-progress":
        claimed_at = entry.get("claimed_at", "")
        if claimed_at:
            try:
                t = datetime.datetime.strptime(claimed_at, "%Y-%m-%dT%H:%M:%SZ")
                age = (now - t).total_seconds() / 60
                if age > stale_minutes:
                    stale.add(folder)
                else:
                    claimed.add(folder)
            except:
                claimed.add(folder)
        else:
            claimed.add(folder)

# If there are stale claims, reclaim the first one
if stale:
    folder = sorted(stale)[0]
    # Remove the stale entry
    data["absorbed"] = [e for e in data["absorbed"] if not (e["folder"] == folder and e.get("status") == "in-progress")]
    # Write fresh in-progress claim
    data["absorbed"].append({
        "folder": folder,
        "status": "in-progress",
        "claimed_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "articles_created": [],
        "articles_updated": []
    })
    with open(absorb_log, "w") as f:
        json.dump(data, f, indent=2)
    print(folder)
    raise SystemExit(0)

# Otherwise find first unclaimed folder
folders = sorted(os.listdir(transcripts_dir))
for folder in folders:
    if folder.startswith("_"):
        continue
    if folder not in claimed:
        data["absorbed"].append({
            "folder": folder,
            "status": "in-progress",
            "claimed_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "articles_created": [],
            "articles_updated": []
        })
        with open(absorb_log, "w") as f:
            json.dump(data, f, indent=2)
        print(folder)
        raise SystemExit(0)

print("IDLE")
PYEOF
)

echo "$next_folder"
