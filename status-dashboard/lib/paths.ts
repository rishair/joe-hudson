// Centralizes filesystem paths for the dashboard.
// Default: dashboard lives at <repo>/status-dashboard/, so WIKI_ROOT is one up.
// Override via WIKI_ROOT env var for out-of-repo dev.

import { resolve } from "node:path";

const DEFAULT_WIKI_ROOT = resolve(import.meta.dir, "..", "..");

export const WIKI_ROOT = process.env.WIKI_ROOT
  ? resolve(process.env.WIKI_ROOT)
  : DEFAULT_WIKI_ROOT;

export const WIKI_DIR = resolve(WIKI_ROOT, "meta", "wiki");
export const GOALS_DIR = resolve(WIKI_DIR, "goals");
export const RESEARCH_DIR = resolve(WIKI_DIR, "research");
export const EXPERIMENTS_DIR = resolve(WIKI_DIR, "experiments");
export const FINDINGS_DIR = resolve(WIKI_DIR, "findings");
export const REQUESTS_DIR = resolve(WIKI_DIR, "requests");
export const CHECKPOINTS_DIR = resolve(WIKI_DIR, "checkpoints");
export const BACKLOG_INDEX = resolve(WIKI_DIR, "backlog", "index.md");
