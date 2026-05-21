#!/usr/bin/env bash
# complete-claim.sh <folder> <type> <articles_created_json> <articles_updated_json>
# Updates the in-progress entry to complete.
# Example: ./complete-claim.sh "2020-10-26_Introduction to VIEW" "teaching" '["view","vulnerability"]' '["wonder"]'

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ABSORB_LOG="$REPO_ROOT/coach/_absorb_log.json"
LOCKDIR="$REPO_ROOT/coach/.claim.lock"

FOLDER="$1"
TYPE="${2:-teaching}"
CREATED="${3:-[]}"
UPDATED="${4:-[]}"

# Acquire lock via mkdir
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

python3 << PYEOF
import json, datetime

with open('$ABSORB_LOG') as f:
    data = json.load(f)

folder = '''$FOLDER'''
for entry in data['absorbed']:
    if entry['folder'] == folder and entry.get('status') == 'in-progress':
        entry['status'] = 'complete'
        entry['type'] = '$TYPE'
        entry['absorbed_at'] = datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')
        entry['articles_created'] = json.loads('$CREATED')
        entry['articles_updated'] = json.loads('$UPDATED')
        break

with open('$ABSORB_LOG', 'w') as f:
    json.dump(data, f, indent=2)
PYEOF

echo "OK: $FOLDER marked complete"
