#!/usr/bin/env bash
# rebuild-index.sh — Regenerate _index.md and _backlinks.json from article files on disk.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export COACH_DIR="$REPO_ROOT/coach"
export INDEX_FILE="$COACH_DIR/_index.md"
export BACKLINKS_FILE="$COACH_DIR/_backlinks.json"
export ABSORB_LOG="$COACH_DIR/_absorb_log.json"

python3 << 'PYEOF'
import os, re, json

coach_dir = os.environ["COACH_DIR"]
index_file = os.environ["INDEX_FILE"]
backlinks_file = os.environ["BACKLINKS_FILE"]
absorb_log = os.environ["ABSORB_LOG"]

SECTIONS = [
    ("Concerns", "concerns"),
    ("Reads", "reads"),
    ("Questions", "questions"),
    ("Arcs", "arcs"),
    ("Anti-Patterns", "anti-patterns"),
    ("Concepts", "concepts"),
    ("Patterns", "patterns"),
    ("Moves", "moves"),
    ("Distinctions", "distinctions"),
    ("Principles", "principles"),
    ("Practices", "practices"),
    ("Frameworks", "frameworks"),
    ("Examples", "examples"),
    ("Applications", "applications"),
]

def parse_frontmatter(filepath):
    """Parse YAML frontmatter without pyyaml. Handles id, title, aliases."""
    with open(filepath, 'r') as f:
        content = f.read()
    if not content.startswith('---'):
        return None, content
    parts = content.split('---', 2)
    if len(parts) < 3:
        return None, content
    fm_text = parts[1]
    fm = {}
    for line in fm_text.strip().split('\n'):
        line = line.strip()
        if ':' not in line:
            continue
        key, val = line.split(':', 1)
        key = key.strip()
        val = val.strip()
        if val.startswith('[') and val.endswith(']'):
            # Parse simple list: ["a", "b", "c"]
            items = re.findall(r'"([^"]*)"', val)
            fm[key] = items
        elif val.startswith('"') and val.endswith('"'):
            fm[key] = val[1:-1]
        else:
            fm[key] = val
    return fm, parts[2]

def find_wikilinks(content):
    return re.findall(r'\[\[([^\]]+)\]\]', content)

articles_by_section = {dirname: [] for _, dirname in SECTIONS}
backlinks = {}

for section_name, dirname in SECTIONS:
    dirpath = os.path.join(coach_dir, dirname)
    if not os.path.isdir(dirpath):
        continue
    for fname in sorted(os.listdir(dirpath)):
        if not fname.endswith('.md'):
            continue
        filepath = os.path.join(dirpath, fname)
        fm, body = parse_frontmatter(filepath)
        if not fm or 'id' not in fm:
            continue
        article_id = fm['id']
        title = fm.get('title', article_id)
        aliases = fm.get('aliases', [])

        also = ", ".join(aliases) if isinstance(aliases, list) and aliases else ""
        also_str = f" (also: {also})" if also else ""
        articles_by_section[dirname].append(f"- {article_id} {title}{also_str}")

        for target in find_wikilinks(body):
            if target not in backlinks:
                backlinks[target] = []
            if article_id not in backlinks[target]:
                backlinks[target].append(article_id)

try:
    with open(absorb_log) as f:
        log_data = json.load(f)
    complete_count = sum(1 for e in log_data['absorbed'] if e.get('status', 'complete') == 'complete')
    last_entry = None
    for e in reversed(log_data['absorbed']):
        if e.get('status', 'complete') == 'complete':
            last_entry = e
            break
except:
    complete_count = 0
    last_entry = None

with open(index_file, 'w') as f:
    f.write("# Compendium Index\n")
    for section_name, dirname in SECTIONS:
        f.write(f"\n## {section_name}\n\n")
        entries = articles_by_section.get(dirname, [])
        for entry in entries:
            f.write(f"{entry}\n")
    f.write("\n---\n\n")
    f.write(f"Absorb Progress: {complete_count} / 480 transcripts\n")
    if last_entry:
        date = last_entry.get('absorbed_at', '')[:10]
        f.write(f"Last absorbed: {last_entry['folder']} ({date})\n")

with open(backlinks_file, 'w') as f:
    json.dump(backlinks, f, indent=2)

total = sum(len(v) for v in articles_by_section.values())
print(f"Index rebuilt: {total} articles, {len(backlinks)} backlink targets")
PYEOF
