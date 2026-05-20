#!/usr/bin/env bash
set -euo pipefail

WIKI_DIR="meta/wiki"
RAW_DIR="meta/raw"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# --- Locking ---

LOCK_DIR="$WIKI_DIR/.locks"
mkdir -p "$LOCK_DIR"

acquire_lock() {
  local name="$1"
  local lockfile="$LOCK_DIR/${name}.lock"
  local attempts=0
  while ! mkdir "$lockfile" 2>/dev/null; do
    ((attempts++))
    if (( attempts > 50 )); then
      # Stale lock (>10s old). Break it.
      if [[ -d "$lockfile" ]]; then
        local lock_age
        lock_age=$(stat -f %m "$lockfile" 2>/dev/null || stat -c %Y "$lockfile" 2>/dev/null)
        local now
        now=$(date +%s)
        if (( now - lock_age > 10 )); then
          rmdir "$lockfile" 2>/dev/null || true
          continue
        fi
      fi
      echo "ERROR: Could not acquire lock '$name' after 10s" >&2
      exit 1
    fi
    sleep 0.2
  done
}

release_lock() {
  local name="$1"
  rmdir "$LOCK_DIR/${name}.lock" 2>/dev/null || true
}

# --- ID generation ---

next_id() {
  local prefix="$1"
  local dir="$2"
  acquire_lock "id_${prefix}"
  local max=0
  for f in "$dir"/${prefix}-*.md; do
    [[ -f "$f" ]] || continue
    num="${f##*${prefix}-}"
    num="${num%.md}"
    num=$((10#$num))
    (( num > max )) && max=$num
  done
  # Note: lock is released AFTER the file is created by the caller.
  # The caller must call release_lock "id_${prefix}" after writing the file.
  printf "%s-%03d" "$prefix" $((max + 1))
}

# --- Templates ---

create_goal_page() {
  local id="$1" name="$2" parent="$3" brief="${4:-}"
  local file="$WIKI_DIR/goals/${id}.md"
  cat > "$file" <<EOF
---
type: goal
id: $id
status: active
created: $(date +%Y-%m-%d)
parent: $parent
---

# $name

## Outcome

${brief:-FILL IN: What "done" looks like. An agent reading only this section should know exactly what success means.}

## Context

${brief:+See outcome above.}${brief:-FILL IN: Why this goal matters. What it unblocks. What an agent needs to know before working on this.}

## Sub-goals

(none yet)

## Research

(none yet)

## Experiments

(none yet)

## Decision Log

- $(date +%Y-%m-%d): Goal created.
EOF
  echo "$file"
}

create_research_page() {
  local id="$1" question="$2" goal="$3" brief="${4:-}"
  local file="$WIKI_DIR/research/${id}.md"
  cat > "$file" <<EOF
---
type: research
id: $id
status: pending
parent_goal: $goal
depends_on:
claim_ttl:
claimed_by:
claimed_at:
created: $(date +%Y-%m-%d)
---

# $question

## Question

$question

## Why This Matters

${brief:-FILL IN: What does answering this question unblock? What decisions depend on it? An agent should know why this research is worth doing.}

## Constraints and Scope

${brief:+See question above.}${brief:-FILL IN: What is in scope and out of scope? What tools or resources are available? Any known dead ends to avoid?}

## Sources

(none yet)

## Findings

(none yet)

## Implications

(none yet)

## Links

- Parent goal: [[$goal]]
EOF
  echo "$file"
}

create_experiment_page() {
  local id="$1" hypothesis="$2" goal="$3" parent_exp="${4:-}" brief="${5:-}"
  local file="$WIKI_DIR/experiments/${id}.md"
  cat > "$file" <<EOF
---
type: experiment
id: $id
status: pending
parent_goal: $goal
parent_experiment: $parent_exp
depends_on:
claim_ttl:
claimed_by:
claimed_at:
created: $(date +%Y-%m-%d)
---

# $hypothesis

## Hypothesis

$hypothesis

## Method

${brief:-FILL IN: Step-by-step instructions an agent can follow without asking questions. Include: what tools to use, what inputs to provide, what to look for in the output, and what constitutes success vs failure.}

## Success Criteria

${brief:+See method above.}${brief:-FILL IN: What specific result means this experiment succeeded? What means it failed? Be concrete.}

## Result

(not yet run)

## Analysis

(pending)

## Dead Ends

(none yet)

## Next Steps

(pending)

## Links

- Parent goal: [[$goal]]${parent_exp:+
- Parent experiment: [[$parent_exp]]}
EOF
  echo "$file"
}

create_finding_page() {
  local id="$1" claim="$2" experiment="$3" domain="$4"
  local file="$WIKI_DIR/findings/${id}.md"
  cat > "$file" <<EOF
---
type: finding
id: $id
status: provisional
source_experiment: $experiment
created: $(date +%Y-%m-%d)
domain: $domain
---

# $claim

## Claim

$claim

## Evidence

(link to experiment)

## Boundary Conditions

(When does this NOT apply? What assumptions does it rest on?)

## Links

EOF
  echo "$file"
}

# --- TTL for claims ---

# Get the stale threshold in seconds for a page file.
# Reads claim_ttl from frontmatter (in minutes). Defaults to 20m (1200s).
get_ttl_seconds() {
  local f="$1"
  local ttl_min
  ttl_min=$(grep '^claim_ttl:' "$f" | sed 's/^claim_ttl: *//' | tr -d ' ')
  if [[ -n "$ttl_min" && "$ttl_min" =~ ^[0-9]+$ ]]; then
    echo $(( ttl_min * 60 ))
  else
    echo 1200
  fi
}

# --- Claim management ---

do_claim() {
  local page="$1" agent="${2:-agent}"
  local file
  file=$(find_page "$page")
  if [[ -z "$file" ]]; then
    echo "ERROR: Page $page not found" >&2
    exit 1
  fi

  # Check if already claimed and not stale
  local claimed_at
  claimed_at=$(grep '^claimed_at:' "$file" | sed 's/^claimed_at: *//')
  if [[ -n "$claimed_at" ]]; then
    local mod_time now stale_seconds=1200
    mod_time=$(stat -f %m "$file" 2>/dev/null || stat -c %Y "$file" 2>/dev/null)
    now=$(date +%s)
    if (( now - mod_time < stale_seconds )); then
      local claimed_by
      claimed_by=$(grep '^claimed_by:' "$file" | sed 's/^claimed_by: *//')
      echo "WARNING: Page $page is claimed by '$claimed_by' (last modified $(( (now - mod_time) / 60 ))m ago). Claim is not stale yet." >&2
      echo "Use --force to override." >&2
      exit 1
    fi
    echo "NOTE: Previous claim is stale (>20min since last modification). Re-claiming."
  fi

  # Update frontmatter
  local ts
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  sed -i '' "s/^claimed_by:.*/claimed_by: $agent/" "$file"
  sed -i '' "s/^claimed_at:.*/claimed_at: $ts/" "$file"
  # Update status to claimed if pending
  sed -i '' "s/^status: pending/status: claimed/" "$file"
  echo "Claimed $page ($file) as '$agent' at $ts"
}

do_unclaim() {
  local page="$1"
  local file
  file=$(find_page "$page")
  if [[ -z "$file" ]]; then
    echo "ERROR: Page $page not found" >&2
    exit 1
  fi
  sed -i '' "s/^claimed_by:.*/claimed_by:/" "$file"
  sed -i '' "s/^claimed_at:.*/claimed_at:/" "$file"
  sed -i '' "s/^status: claimed/status: pending/" "$file"
  echo "Unclaimed $page ($file)"
}

# --- Find a page by ID ---

find_page() {
  local id="$1"
  local f
  for dir in goals research experiments findings; do
    f="$WIKI_DIR/$dir/${id}.md"
    if [[ -f "$f" ]]; then
      echo "$f"
      return
    fi
  done
}

# --- Status ---

do_status() {
  echo "=== Wiki Status ==="
  echo ""

  # Count pages by type
  for type in goals research experiments findings; do
    local count
    count=$(find "$WIKI_DIR/$type" -name "*.md" 2>/dev/null | wc -l | tr -d ' ')
    echo "$type: $count pages"
  done
  echo ""

  # Status breakdown for research
  echo "--- Research ---"
  for status in pending claimed in-progress complete; do
    local count=0
    for f in "$WIKI_DIR"/research/*.md; do
      [[ -f "$f" ]] || continue
      grep -q "^status: $status" "$f" && ((count++)) || true
    done
    echo "  $status: $count"
  done
  echo ""

  # Status breakdown for experiments
  echo "--- Experiments ---"
  for status in pending claimed in-progress succeeded failed inconclusive; do
    local count=0
    for f in "$WIKI_DIR"/experiments/*.md; do
      [[ -f "$f" ]] || continue
      grep -q "^status: $status" "$f" && ((count++)) || true
    done
    echo "  $status: $count"
  done
  echo ""

  # Stale claims
  echo "--- Stale Claims (>20min) ---"
  local now
  now=$(date +%s)
  local found_stale=false
  for f in "$WIKI_DIR"/research/*.md "$WIKI_DIR"/experiments/*.md; do
    [[ -f "$f" ]] || continue
    local claimed_at
    claimed_at=$(grep '^claimed_at:' "$f" | sed 's/^claimed_at: *//')
    [[ -z "$claimed_at" ]] && continue
    local mod_time
    mod_time=$(stat -f %m "$f" 2>/dev/null || stat -c %Y "$f" 2>/dev/null)
    if (( now - mod_time > 1200 )); then
      local id claimed_by
      id=$(grep '^id:' "$f" | sed 's/^id: *//')
      claimed_by=$(grep '^claimed_by:' "$f" | sed 's/^claimed_by: *//')
      echo "  $id (claimed by $claimed_by, $(( (now - mod_time) / 60 ))m stale) - $f"
      found_stale=true
    fi
  done
  $found_stale || echo "  (none)"
  echo ""

  # Checkpoints
  local checkpoint_count
  checkpoint_count=$(find "$WIKI_DIR/checkpoints" -name "*.md" 2>/dev/null | wc -l | tr -d ' ')
  echo "Checkpoints: $checkpoint_count"

  # Completed task count since last checkpoint
  local total_done=0
  for f in "$WIKI_DIR"/research/*.md; do
    [[ -f "$f" ]] || continue
    grep -q '^status: complete' "$f" && ((total_done++)) || true
  done
  for f in "$WIKI_DIR"/experiments/*.md; do
    [[ -f "$f" ]] || continue
    grep -qE '^status: (succeeded|failed|inconclusive)' "$f" && ((total_done++)) || true
  done
  echo "Completed tasks (total): $total_done"
  echo ""

  # Last modified file
  local latest
  latest=$(find "$WIKI_DIR" -name "*.md" -exec stat -f "%m %N" {} \; 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-)
  if [[ -n "$latest" ]]; then
    echo "Last modified: $latest"
  fi
}

# --- Rebuild index ---

do_rebuild_index() {
  python3 "$SCRIPT_DIR/rebuild-index.py"
}

# --- Main ---

cmd="${1:-help}"
shift || true

case "$cmd" in
  create)
    type="${1:-}"
    shift || true
    case "$type" in
      goal)
        name="${1:?Usage: wiki.sh create goal \"name\" [--parent G-XXX] [--brief \"description\"]}"
        shift || true
        parent="root"
        brief=""
        while [[ $# -gt 0 ]]; do
          case "$1" in
            --parent) parent="$2"; shift 2 ;;
            --brief) brief="$2"; shift 2 ;;
            *) shift ;;
          esac
        done
        id=$(next_id "G" "$WIKI_DIR/goals")
        file=$(create_goal_page "$id" "$name" "$parent" "$brief")
        release_lock "id_G"
        echo "Created goal $id: $file"
        do_rebuild_index
        ;;
      research)
        question="${1:?Usage: wiki.sh create research \"question\" --goal G-XXX [--brief \"context\"]}"
        shift || true
        goal=""
        brief=""
        while [[ $# -gt 0 ]]; do
          case "$1" in
            --goal) goal="$2"; shift 2 ;;
            --brief) brief="$2"; shift 2 ;;
            *) shift ;;
          esac
        done
        [[ -z "$goal" ]] && { echo "ERROR: --goal is required" >&2; exit 1; }
        id=$(next_id "R" "$WIKI_DIR/research")
        file=$(create_research_page "$id" "$question" "$goal" "$brief")
        release_lock "id_R"
        echo "Created research $id: $file"
        do_rebuild_index
        ;;
      experiment)
        hypothesis="${1:?Usage: wiki.sh create experiment \"hypothesis\" --goal G-XXX [--parent-exp E-XXX] [--brief \"method\"]}"
        shift || true
        goal=""
        parent_exp=""
        brief=""
        while [[ $# -gt 0 ]]; do
          case "$1" in
            --goal) goal="$2"; shift 2 ;;
            --parent-exp) parent_exp="$2"; shift 2 ;;
            --brief) brief="$2"; shift 2 ;;
            *) shift ;;
          esac
        done
        [[ -z "$goal" ]] && { echo "ERROR: --goal is required" >&2; exit 1; }
        id=$(next_id "E" "$WIKI_DIR/experiments")
        file=$(create_experiment_page "$id" "$hypothesis" "$goal" "$parent_exp" "$brief")
        release_lock "id_E"
        echo "Created experiment $id: $file"
        do_rebuild_index
        ;;
      finding)
        claim="${1:?Usage: wiki.sh create finding \"claim\" --experiment E-XXX --domain \"description\"}"
        shift || true
        experiment=""
        domain=""
        while [[ $# -gt 0 ]]; do
          case "$1" in
            --experiment) experiment="$2"; shift 2 ;;
            --domain) domain="$2"; shift 2 ;;
            *) shift ;;
          esac
        done
        [[ -z "$experiment" ]] && { echo "ERROR: --experiment is required" >&2; exit 1; }
        [[ -z "$domain" ]] && { echo "ERROR: --domain is required" >&2; exit 1; }
        id=$(next_id "F" "$WIKI_DIR/findings")
        file=$(create_finding_page "$id" "$claim" "$experiment" "$domain")
        release_lock "id_F"
        echo "Created finding $id: $file"
        do_rebuild_index
        ;;
      *)
        echo "Usage: wiki.sh create {goal|research|experiment|finding} ..."
        exit 1
        ;;
    esac
    ;;
  claim)
    page="${1:?Usage: wiki.sh claim <PAGE-ID> [agent-name]}"
    agent="${2:-agent}"
    do_claim "$page" "$agent"
    ;;
  unclaim)
    page="${1:?Usage: wiki.sh unclaim <PAGE-ID>}"
    do_unclaim "$page"
    ;;
  status)
    do_status
    ;;
  rebuild-index)
    do_rebuild_index
    ;;
  stale)
    # Quick stale check (respects per-page claim_ttl)
    now=$(date +%s)
    found=false
    for f in "$WIKI_DIR"/research/*.md "$WIKI_DIR"/experiments/*.md; do
      [[ -f "$f" ]] || continue
      claimed_at=$(grep '^claimed_at:' "$f" | sed 's/^claimed_at: *//')
      [[ -z "$claimed_at" ]] && continue
      mod_time=$(stat -f %m "$f" 2>/dev/null || stat -c %Y "$f" 2>/dev/null)
      ttl=$(get_ttl_seconds "$f")
      if (( now - mod_time > ttl )); then
        id=$(grep '^id:' "$f" | sed 's/^id: *//')
        claimed_by=$(grep '^claimed_by:' "$f" | sed 's/^claimed_by: *//')
        mins=$(( (now - mod_time) / 60 ))
        echo "$id  claimed_by=$claimed_by  stale=${mins}m (ttl=$((ttl/60))m)  $f"
        found=true
      fi
    done
    $found || echo "No stale claims."
    ;;
  next)
    # Output the next best thing to work on, following the priority order from the skill.
    # Designed to be read by an agent that will then execute the work.
    now=$(date +%s)

    # Priority 1: In-progress items that are stale (previous agent died)
    for f in "$WIKI_DIR"/research/*.md "$WIKI_DIR"/experiments/*.md; do
      [[ -f "$f" ]] || continue
      claimed_at=$(grep '^claimed_at:' "$f" | sed 's/^claimed_at: *//')
      [[ -z "$claimed_at" ]] && continue
      status_val=$(grep '^status:' "$f" | head -1 | sed 's/^status: *//')
      [[ "$status_val" == "claimed" || "$status_val" == "in-progress" ]] || continue
      mod_time=$(stat -f %m "$f" 2>/dev/null || stat -c %Y "$f" 2>/dev/null)
      ttl=$(get_ttl_seconds "$f")
      if (( now - mod_time > ttl )); then
        id=$(grep '^id:' "$f" | sed 's/^id: *//')
        type=$(grep '^type:' "$f" | sed 's/^type: *//')
        echo "STALE_CLAIM $type $id $f"
        echo "This item was claimed but hasn't been touched in $(( (now - mod_time) / 60 ))m (ttl=$((ttl/60))m). Re-claim and continue."
        exit 0
      fi
    done

    # Priority 2: Check if checkpoint is due (10+ completed tasks since last checkpoint)
    total_done=0
    for f in "$WIKI_DIR"/research/*.md; do
      [[ -f "$f" ]] || continue
      grep -q '^status: complete' "$f" && ((total_done++)) || true
    done
    for f in "$WIKI_DIR"/experiments/*.md; do
      [[ -f "$f" ]] || continue
      grep -qE '^status: (succeeded|failed|inconclusive)' "$f" && ((total_done++)) || true
    done
    checkpoint_count=$(find "$WIKI_DIR/checkpoints" -name "*.md" 2>/dev/null | wc -l | tr -d ' ')
    tasks_since_checkpoint=$((total_done - checkpoint_count * 10))
    if (( tasks_since_checkpoint >= 10 )); then
      echo "CHECKPOINT"
      echo "$total_done tasks completed, $checkpoint_count checkpoints done. Time to checkpoint."
      exit 0
    fi

    # Helper: check if a file is unclaimed or has a stale claim (respects claim_ttl)
    is_available() {
      local f="$1"
      local claimed_at
      claimed_at=$(grep '^claimed_at:' "$f" | sed 's/^claimed_at: *//')
      [[ -z "$claimed_at" ]] && return 0  # unclaimed
      local mod_time ttl
      mod_time=$(stat -f %m "$f" 2>/dev/null || stat -c %Y "$f" 2>/dev/null)
      ttl=$(get_ttl_seconds "$f")
      (( now - mod_time > ttl ))  # stale = available
    }

    # Helper: check if a page ID has reached a terminal status
    is_resolved() {
      local dep_id="$1"
      local dep_file=""
      for d in "$WIKI_DIR"/goals "$WIKI_DIR"/research "$WIKI_DIR"/experiments "$WIKI_DIR"/findings; do
        if [[ -f "$d/${dep_id}.md" ]]; then
          dep_file="$d/${dep_id}.md"
          break
        fi
      done
      [[ -z "$dep_file" ]] && return 0  # missing dep = treat as resolved (don't block forever)
      local dep_status
      dep_status=$(grep '^status:' "$dep_file" | head -1 | sed 's/^status: *//')
      case "$dep_status" in
        complete|completed|succeeded|failed|inconclusive|confirmed|refuted|abandoned) return 0 ;;
        *) return 1 ;;
      esac
    }

    # Helper: count unresolved dependencies for a file. Returns count via stdout.
    unresolved_dep_count() {
      local f="$1"
      local deps
      deps=$(grep '^depends_on:' "$f" | sed 's/^depends_on: *//')
      [[ -z "$deps" ]] && echo 0 && return
      local count=0
      IFS=', ' read -ra dep_arr <<< "$deps"
      for dep in "${dep_arr[@]}"; do
        dep=$(echo "$dep" | tr -d ' ')
        [[ -z "$dep" ]] && continue
        is_resolved "$dep" || ((count++))
      done
      echo "$count"
    }

    # Priority 3: Pending research with deps resolved (unblocks experiments)
    for f in "$WIKI_DIR"/research/*.md; do
      [[ -f "$f" ]] || continue
      status_val=$(grep '^status:' "$f" | head -1 | sed 's/^status: *//')
      [[ "$status_val" == "pending" || "$status_val" == "claimed" ]] || continue
      is_available "$f" || continue
      [[ $(unresolved_dep_count "$f") -eq 0 ]] || continue
      id=$(grep '^id:' "$f" | sed 's/^id: *//')
      goal=$(grep '^parent_goal:' "$f" | sed 's/^parent_goal: *//')
      echo "RESEARCH $id $goal $f"
      echo "Pending research. Claim it, do the research, record findings."
      exit 0
    done

    # Priority 4: Pending experiments with deps resolved
    for f in "$WIKI_DIR"/experiments/*.md; do
      [[ -f "$f" ]] || continue
      status_val=$(grep '^status:' "$f" | head -1 | sed 's/^status: *//')
      [[ "$status_val" == "pending" || "$status_val" == "claimed" ]] || continue
      is_available "$f" || continue
      [[ $(unresolved_dep_count "$f") -eq 0 ]] || continue
      id=$(grep '^id:' "$f" | sed 's/^id: *//')
      goal=$(grep '^parent_goal:' "$f" | sed 's/^parent_goal: *//')
      echo "EXPERIMENT $id $goal $f"
      echo "Pending experiment. Claim it, run it, record results."
      exit 0
    done

    # Priority 5: Blocked items (fewest unresolved deps first) — self-healing fallback
    best_blocked_file=""
    best_blocked_count=999
    for f in "$WIKI_DIR"/research/*.md "$WIKI_DIR"/experiments/*.md; do
      [[ -f "$f" ]] || continue
      status_val=$(grep '^status:' "$f" | head -1 | sed 's/^status: *//')
      [[ "$status_val" == "pending" || "$status_val" == "claimed" ]] || continue
      is_available "$f" || continue
      local_count=$(unresolved_dep_count "$f")
      [[ "$local_count" -eq 0 ]] && continue  # already handled above
      if (( local_count < best_blocked_count )); then
        best_blocked_count=$local_count
        best_blocked_file="$f"
      fi
    done
    if [[ -n "$best_blocked_file" ]]; then
      id=$(grep '^id:' "$best_blocked_file" | sed 's/^id: *//')
      type=$(grep '^type:' "$best_blocked_file" | sed 's/^type: *//')
      goal=$(grep '^parent_goal:' "$best_blocked_file" | sed 's/^parent_goal: *//')
      deps=$(grep '^depends_on:' "$best_blocked_file" | sed 's/^depends_on: *//')
      type_upper=$(echo "$type" | tr '[:lower:]' '[:upper:]')
      echo "BLOCKED_${type_upper} $id $goal $best_blocked_file"
      echo "WARNING: All unblocked work is done. This item has $best_blocked_count unresolved dep(s): $deps"
      echo "Resolve or remove the dependency before proceeding with the work itself."
      exit 0
    fi

    # Nothing to do
    echo "IDLE"
    echo "No pending work. Review goals and create new research or experiments."
    exit 0
    ;;
  help|--help|-h)
    cat <<'HELP'
wiki.sh - Research wiki CLI

Commands:
  create goal "name" [--parent G-XXX]
  create research "question" --goal G-XXX
  create experiment "hypothesis" --goal G-XXX [--parent-exp E-XXX]
  create finding "claim" --experiment E-XXX --domain "description"
  claim <PAGE-ID> [agent-name]
  unclaim <PAGE-ID>
  status
  stale
  next                              # What should an agent work on next?
  rebuild-index
  help
HELP
    ;;
  *)
    echo "Unknown command: $cmd. Run 'wiki.sh help' for usage." >&2
    exit 1
    ;;
esac
