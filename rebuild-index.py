#!/usr/bin/env python3
"""Rebuild meta/wiki/index.md and meta/wiki/_backlinks.json from current wiki state."""

import json
import os
import re
import tempfile
from pathlib import Path

WIKI_DIR = Path("meta/wiki")


def atomic_write(path: Path, content: str):
    """Write to a temp file then rename, so concurrent readers never see a partial file."""
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        os.write(fd, content.encode())
        os.close(fd)
        os.replace(tmp, path)
    except:
        os.close(fd)
        os.unlink(tmp)
        raise


def parse_frontmatter(filepath: Path) -> dict:
    """Extract YAML frontmatter as a simple dict (no pyyaml dependency)."""
    text = filepath.read_text()
    if not text.startswith("---"):
        return {}
    end = text.index("---", 3)
    fm = {}
    for line in text[3:end].strip().splitlines():
        if ":" in line:
            key, val = line.split(":", 1)
            fm[key.strip()] = val.strip()
    return fm


def get_title(filepath: Path) -> str:
    """Get the first markdown heading from a file."""
    for line in filepath.read_text().splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return filepath.stem


def scan_wikilinks(filepath: Path) -> list[str]:
    """Find all [[wikilinks]] in a file."""
    text = filepath.read_text()
    return re.findall(r"\[\[([^\]]+)\]\]", text)


def status_marker(status: str) -> str:
    """Convert status to checkbox marker."""
    done = {"completed", "complete", "succeeded", "confirmed"}
    failed = {"failed", "abandoned", "refuted"}
    in_progress = {"in-progress", "claimed"}
    if status in done:
        return "[x]"
    elif status in failed:
        return "[-]"
    elif status in in_progress:
        return "[~]"
    return "[ ]"


def main():
    # Collect all pages
    pages = {}  # id -> {type, status, parent, title, path, ...}
    for subdir in ["goals", "research", "experiments", "findings"]:
        dirpath = WIKI_DIR / subdir
        if not dirpath.exists():
            continue
        for f in sorted(dirpath.glob("*.md")):
            fm = parse_frontmatter(f)
            page_id = fm.get("id", f.stem)
            pages[page_id] = {
                "type": fm.get("type", subdir.rstrip("s")),
                "status": fm.get("status", ""),
                "parent": fm.get("parent", fm.get("parent_goal", "")),
                "parent_experiment": fm.get("parent_experiment", ""),
                "also": fm.get("also", ""),
                "title": get_title(f),
                "path": str(f),
                "id": page_id,
            }

    # Build backlinks
    backlinks = {}  # target -> [source_ids]
    for subdir in ["goals", "research", "experiments", "findings"]:
        dirpath = WIKI_DIR / subdir
        if not dirpath.exists():
            continue
        for f in sorted(dirpath.glob("*.md")):
            fm = parse_frontmatter(f)
            source_id = fm.get("id", f.stem)
            for link in scan_wikilinks(f):
                backlinks.setdefault(link, [])
                if source_id not in backlinks[link]:
                    backlinks[link].append(source_id)

    # Write backlinks
    backlinks_path = WIKI_DIR / "_backlinks.json"
    atomic_write(backlinks_path, json.dumps(backlinks, indent=2) + "\n")

    # Build goal tree
    # Find root goals
    goals = {pid: p for pid, p in pages.items() if p["type"] == "goal"}
    research = {pid: p for pid, p in pages.items() if p["type"] == "research"}
    experiments = {pid: p for pid, p in pages.items() if p["type"] == "experiment"}
    findings = {pid: p for pid, p in pages.items() if p["type"] == "finding"}

    # Build tree lines
    lines = ["# Wiki Index", "", "## Goals", ""]

    def also_str(page: dict) -> str:
        """Format also aliases if present."""
        a = page.get("also", "")
        return f" (also: {a})" if a else ""

    def render_goal(goal_id, indent=0):
        """Recursively render a goal and its children."""
        g = goals.get(goal_id)
        if not g:
            return
        prefix = "  " * indent
        marker = status_marker(g["status"])
        lines.append(f"{prefix}- {marker} {goal_id} {g['title']}{also_str(g)}")

        # Sub-goals
        sub_goals = [p for p in goals.values() if p["parent"] == goal_id]
        if sub_goals:
            lines.append(f"{prefix}  - Sub-goals")
            for sg in sorted(sub_goals, key=lambda x: x["id"]):
                render_goal(sg["id"], indent + 2)

        # Research for this goal
        goal_research = [p for p in research.values() if p["parent"] == goal_id]
        if goal_research:
            lines.append(f"{prefix}  - Research")
            for r in sorted(goal_research, key=lambda x: x["id"]):
                m = status_marker(r["status"])
                lines.append(f"{prefix}    - {m} {r['id']} {r['title']}{also_str(r)}")

        # Experiments for this goal (top-level only, not sub-experiments)
        goal_experiments = [
            p for p in experiments.values()
            if p["parent"] == goal_id and not p["parent_experiment"]
        ]
        if goal_experiments:
            lines.append(f"{prefix}  - Experiments")
            for e in sorted(goal_experiments, key=lambda x: x["id"]):
                render_experiment(e["id"], indent + 2)

    def render_experiment(exp_id, indent):
        """Render an experiment and its sub-experiments."""
        e = experiments.get(exp_id)
        if not e:
            return
        prefix = "  " * indent
        m = status_marker(e["status"])
        lines.append(f"{prefix}- {m} {exp_id} {e['title']}{also_str(e)}")

        # Sub-experiments
        sub_exps = [
            p for p in experiments.values()
            if p["parent_experiment"] == exp_id
        ]
        for se in sorted(sub_exps, key=lambda x: x["id"]):
            render_experiment(se["id"], indent + 1)

    # Render from root goals
    root_goals = [g for g in goals.values() if g["parent"] == "root"]
    for rg in sorted(root_goals, key=lambda x: x["id"]):
        render_goal(rg["id"])

    # Standalone findings
    if findings:
        lines.extend(["", "## Findings", ""])
        for f in sorted(findings.values(), key=lambda x: x["id"]):
            m = status_marker(f["status"])
            lines.append(f"- {m} {f['id']} {f['title']}")

    # Checkpoints
    checkpoint_dir = WIKI_DIR / "checkpoints"
    checkpoints = sorted(checkpoint_dir.glob("*.md"), reverse=True) if checkpoint_dir.exists() else []
    lines.extend(["", "## Checkpoints", ""])
    if checkpoints:
        for cp in checkpoints:
            lines.append(f"- {cp.stem}")
    else:
        lines.append("(none yet)")

    lines.append("")

    # Write index
    index_path = WIKI_DIR / "index.md"
    atomic_write(index_path, "\n".join(lines))

    # Summary
    print(f"Index rebuilt: {len(goals)} goals, {len(research)} research, {len(experiments)} experiments, {len(findings)} findings")
    print(f"Backlinks: {len(backlinks)} targets")
    print(f"Written: {index_path}, {backlinks_path}")


if __name__ == "__main__":
    main()
