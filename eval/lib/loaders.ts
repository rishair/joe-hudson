/**
 * YAML/JSON file loaders with Zod validation.
 *
 * Each loader: reads file -> parses YAML/JSON -> Zod validates -> returns typed object
 * or throws a ZodError that names the offending field.
 */

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import * as YAML from "yaml";
import { z, ZodError } from "zod";
import {
  ProfileSchema,
  RubricSchema,
  SafetyFileSchema,
  MethodologyFileSchema,
  AntiPatternTestSchema,
  CoachConfigSchema,
  type Profile,
  type Rubric,
  type SafetyCriterion,
  type MethodologyFile,
  type AntiPatternTest,
  type CoachConfig,
} from "./schemas.ts";

function loadYaml(path: string): unknown {
  const raw = readFileSync(path, "utf8");
  return YAML.parse(raw);
}

function loadJson(path: string): unknown {
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw);
}

function listFiles(dir: string, ext: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(ext))
    .map((f) => join(dir, f))
    .filter((p) => statSync(p).isFile())
    .sort();
}

function formatZodError(filePath: string, err: ZodError, kind: string): Error {
  const msgs = err.issues
    .map((iss) => `  - ${iss.path.join(".") || "<root>"}: ${iss.message}`)
    .join("\n");
  return new Error(
    `[${kind} schema] ${filePath} failed validation:\n${msgs}`,
  );
}

// ---- Profiles ----

export function loadProfile(path: string): Profile {
  const raw = loadYaml(path);
  try {
    return ProfileSchema.parse(raw);
  } catch (e) {
    if (e instanceof ZodError) throw formatZodError(path, e, "profile");
    throw e;
  }
}

export function loadAllProfiles(dir: string): Profile[] {
  return listFiles(dir, ".yaml").map(loadProfile);
}

// ---- Rubrics ----

export function loadRubric(path: string): Rubric {
  const raw = loadYaml(path);
  try {
    return RubricSchema.parse(raw);
  } catch (e) {
    if (e instanceof ZodError) throw formatZodError(path, e, "rubric");
    throw e;
  }
}

export function loadAllRubrics(dir: string): Rubric[] {
  // .yaml and ignore non-rubric files like README.md
  return listFiles(dir, ".yaml").map(loadRubric);
}

// ---- Safety criteria ----

export function loadSafetyCriteria(path: string): SafetyCriterion[] {
  const raw = loadYaml(path);
  try {
    const parsed = SafetyFileSchema.parse(raw);
    return parsed.criteria;
  } catch (e) {
    if (e instanceof ZodError) throw formatZodError(path, e, "safety");
    throw e;
  }
}

// ---- Methodology checklist ----

export function loadMethodologyChecklist(path: string): MethodologyFile {
  const raw = loadYaml(path);
  try {
    return MethodologyFileSchema.parse(raw);
  } catch (e) {
    if (e instanceof ZodError) throw formatZodError(path, e, "methodology");
    throw e;
  }
}

// ---- Anti-pattern tests ----

export function loadAntiPatternTest(path: string): AntiPatternTest {
  const raw = loadYaml(path);
  try {
    return AntiPatternTestSchema.parse(raw);
  } catch (e) {
    if (e instanceof ZodError) throw formatZodError(path, e, "anti-pattern");
    throw e;
  }
}

export function loadAllAntiPatternTests(dir: string): AntiPatternTest[] {
  return listFiles(dir, ".yaml").map(loadAntiPatternTest);
}

// ---- Gold exchanges (JSON) ----

export interface GoldExchange {
  id: string;
  title: string;
  primary_demonstrates: string;
  turns: { turn: number; role: "client" | "coach"; content: string }[];
  expected_scores: Record<string, { score: number; rationale: string }>;
}

export function loadGoldExchanges(dir: string): GoldExchange[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => join(dir, f))
    .sort()
    .map((p) => loadJson(p) as GoldExchange);
}

// ---- Coach config ----

export function loadCoachConfig(path: string): CoachConfig {
  const raw = path.endsWith(".json") ? loadJson(path) : loadYaml(path);
  try {
    return CoachConfigSchema.parse(raw);
  } catch (e) {
    if (e instanceof ZodError) throw formatZodError(path, e, "coach-config");
    throw e;
  }
}

// ---- Client prompt template ----

export function loadClientPromptTemplate(path: string): string {
  const raw = readFileSync(path, "utf8");
  // The template lives inside a fenced ``` block in the markdown file produced
  // by E-020. Extract the first such block.
  const m = raw.match(/```\n([\s\S]+?)\n```/);
  if (!m) {
    throw new Error(
      `Client prompt template at ${path} does not contain a fenced code block`,
    );
  }
  return m[1];
}
