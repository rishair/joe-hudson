#!/usr/bin/env bash
# claim-next.sh — Find the next unprocessed transcript and claim it.
# Outputs the folder name on success, "IDLE" if nothing left.
# Uses mkdir as an atomic lock (works on macOS and Linux).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ABSORB_LOG="$REPO_ROOT/coach/_absorb_log.json"
TRANSCRIPTS_DIR="$REPO_ROOT/transcripts"
LOCKDIR="$REPO_ROOT/coach/.claim.lock"

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
# Release lock on exit (success or failure)
trap 'rmdir "$LOCKDIR" 2>/dev/null' EXIT

# Get all already-claimed folders (both complete and in-progress)
claimed=$(python3 -c "
import json
with open('$ABSORB_LOG') as f:
    data = json.load(f)
for e in data['absorbed']:
    print(e['folder'])
")

# Find first unclaimed transcript folder (sorted by name = chronological)
next_folder=""
while IFS= read -r folder; do
  [[ "$folder" == _* ]] && continue
  if ! echo "$claimed" | grep -qxF "$folder"; then
    next_folder="$folder"
    break
  fi
done < <(ls -1 "$TRANSCRIPTS_DIR" | sort)

if [ -z "$next_folder" ]; then
  echo "IDLE"
  exit 0
fi

# Write in-progress claim to absorb log
python3 -c "
import json, datetime
with open('$ABSORB_LOG') as f:
    data = json.load(f)
data['absorbed'].append({
    'folder': '''$next_folder''',
    'status': 'in-progress',
    'claimed_at': datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ'),
    'articles_created': [],
    'articles_updated': []
})
with open('$ABSORB_LOG', 'w') as f:
    json.dump(data, f, indent=2)
"

echo "$next_folder"
