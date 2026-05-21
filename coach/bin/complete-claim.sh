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

# Pass values via environment so Python doesn't do string-substitution
# on user input — safer for folder names containing quotes, em-dashes,
# non-breaking spaces, or other characters that would break shell quoting.
export ABSORB_LOG FOLDER TYPE CREATED UPDATED

python3 - << 'PYEOF' || exit $?
import json, os, sys, datetime, re

absorb_log = os.environ['ABSORB_LOG']
folder = os.environ['FOLDER']
type_ = os.environ['TYPE']
created = json.loads(os.environ['CREATED'])
updated = json.loads(os.environ['UPDATED'])

def normalize(s):
    # Collapse all Unicode whitespace (including U+00A0 non-breaking space)
    # to a single regular space. Lets callers match a folder name even if
    # they typed a normal space where the filesystem has a non-breaking one.
    return re.sub(r'\s+', ' ', s).strip()

with open(absorb_log) as f:
    data = json.load(f)

target_norm = normalize(folder)
matched = None
# Pass 1: exact match
for entry in data['absorbed']:
    if entry['folder'] == folder and entry.get('status') == 'in-progress':
        matched = entry
        break
# Pass 2: whitespace-normalized match (handles nbsp etc.)
if matched is None:
    for entry in data['absorbed']:
        if normalize(entry['folder']) == target_norm and entry.get('status') == 'in-progress':
            matched = entry
            break

if matched is None:
    print(f"ERROR: no in-progress entry matching {folder!r}", file=sys.stderr)
    # Show in-progress entries for diagnosis
    in_progress = [e['folder'] for e in data['absorbed'] if e.get('status') == 'in-progress']
    if in_progress:
        print(f"Current in-progress entries:", file=sys.stderr)
        for f in in_progress:
            print(f"  {f!r}", file=sys.stderr)
    sys.exit(1)

matched['status'] = 'complete'
matched['type'] = type_
matched['absorbed_at'] = datetime.datetime.now(datetime.UTC).replace(tzinfo=None).strftime('%Y-%m-%dT%H:%M:%SZ')
matched['articles_created'] = created
matched['articles_updated'] = updated

with open(absorb_log, 'w') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)

print(f"OK: {matched['folder']!r} marked complete")
PYEOF
