#!/usr/bin/env bun
/**
 * Joe Hudson AI coach — CLI entrypoint (E-031).
 *
 * Modes:
 *
 *   bun run coach-app/run.ts repl
 *     Interactive multi-turn REPL. Reads coach config from
 *     `coach-app/configs/v1-no-retrieval.yaml` by default.
 *
 *   bun run coach-app/run.ts turn --history <json>
 *     One-shot mode. Reads conversation history (array of {role,content})
 *     from stdin OR `--history <path-to-json>`, emits one coach response
 *     as JSON on stdout. Used by experiments that want to drive the coach
 *     programmatically.
 *
 * Shared flags:
 *   --config <path>     coach config YAML (default coach-app/configs/v1-no-retrieval.yaml)
 *   --model <name>      override model from config
 *   --no-safety         disable runtime safety pre/post checks (for debugging only)
 *   --quiet             suppress telemetry stderr lines
 *
 * The eval harness consumes a coach via its config YAML directly — it does
 * not shell out to this CLI. The CLI is for interactive REPL use plus
 * scriptable one-shot turns, and is the user-facing surface of the coach.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, isAbsolute } from "node:path";
import { parse as parseYaml } from "yaml";
import { generateCoachTurn } from "./lib/anthropic-client.ts";
import {
  preResponseScan,
  postResponseCheck,
  buildSafetyReminder,
  SAFETY_FALLBACK_TEMPLATE,
  type SafetyTrigger,
} from "./lib/safety.ts";
import type { ModelMessage } from "ai";

interface CoachConfigFile {
  id: string;
  description?: string;
  model: string;
  system_prompt?: string;
  system_prompt_path?: string;
  temperature?: number;
  max_tokens_per_turn?: number;
  retrieval?: { strategy: string; config?: Record<string, unknown> };
  trigger_policy?: string;
}

interface LoadedCoachConfig {
  id: string;
  description: string;
  model: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  retrievalStrategy: string;
  triggerPolicy: string;
}

function loadConfig(path: string): LoadedCoachConfig {
  const abs = resolve(path);
  if (!existsSync(abs)) {
    throw new Error(`Coach config not found: ${abs}`);
  }
  const raw = readFileSync(abs, "utf8");
  const obj = parseYaml(raw) as CoachConfigFile;
  if (!obj.id || !obj.model) {
    throw new Error(`Coach config ${abs} missing required id or model field`);
  }

  let systemPrompt = obj.system_prompt ?? "";
  if (!systemPrompt && obj.system_prompt_path) {
    const baseDir = dirname(abs);
    const promptPath = isAbsolute(obj.system_prompt_path)
      ? obj.system_prompt_path
      : resolve(baseDir, obj.system_prompt_path);
    if (!existsSync(promptPath)) {
      throw new Error(
        `system_prompt_path ${promptPath} (from ${abs}) does not exist`,
      );
    }
    systemPrompt = readFileSync(promptPath, "utf8");
  }
  if (!systemPrompt) {
    throw new Error(
      `Coach config ${abs} must specify either system_prompt or system_prompt_path`,
    );
  }

  return {
    id: obj.id,
    description: obj.description ?? "",
    model: obj.model,
    systemPrompt,
    temperature: obj.temperature ?? 0.7,
    maxTokens: obj.max_tokens_per_turn ?? 1024,
    retrievalStrategy: obj.retrieval?.strategy ?? "none",
    triggerPolicy: obj.trigger_policy ?? "never",
  };
}

interface CliOpts {
  cmd: "repl" | "turn";
  configPath: string;
  modelOverride: string | null;
  historyPath: string | null;
  newClientMessage: string | null;
  safetyEnabled: boolean;
  quiet: boolean;
}

function parseArgs(argv: string[]): CliOpts {
  const cmd = (argv[0] as CliOpts["cmd"]) ?? "repl";
  if (cmd !== "repl" && cmd !== "turn") {
    throw new Error(`Unknown subcommand: ${cmd}. Use 'repl' or 'turn'.`);
  }
  const out: CliOpts = {
    cmd,
    configPath: "coach-app/configs/v1-no-retrieval.yaml",
    modelOverride: null,
    historyPath: null,
    newClientMessage: null,
    safetyEnabled: true,
    quiet: false,
  };
  for (let i = 1; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--config") out.configPath = argv[++i];
    else if (a === "--model") out.modelOverride = argv[++i];
    else if (a === "--history") out.historyPath = argv[++i];
    else if (a === "--turn-message") out.newClientMessage = argv[++i];
    else if (a === "--no-safety") out.safetyEnabled = false;
    else if (a === "--quiet") out.quiet = true;
    else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown flag: ${a}`);
    }
  }
  return out;
}

function printHelp(): void {
  console.log(`Usage:
  bun run coach-app/run.ts repl [options]
  bun run coach-app/run.ts turn --history <path.json> [options]
  bun run coach-app/run.ts turn --turn-message "<text>" [options]

Options:
  --config <path>          Coach config YAML (default: coach-app/configs/v1-no-retrieval.yaml)
  --model <name>           Override model from config
  --history <path>         Path to JSON file containing [{role,content},...] history (turn mode)
  --turn-message <text>    Single client message (turn mode; creates fresh history)
  --no-safety              Disable runtime safety pre/post checks (debug only)
  --quiet                  Suppress telemetry stderr output
`);
}

interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Run a single coach turn with runtime safety enabled.
 * Returns the final coach response text plus the cumulative usage telemetry.
 */
async function runOneCoachTurn(args: {
  cfg: LoadedCoachConfig;
  history: ConversationMessage[];
  clientMessage: string;
  safetyEnabled: boolean;
  quiet: boolean;
}): Promise<{
  text: string;
  triggers: SafetyTrigger[];
  regenerated: boolean;
  used_fallback: boolean;
  cumulative_cost_usd: number;
  cumulative_calls: number;
}> {
  // Pre-response safety scan against the new client message.
  const triggers = args.safetyEnabled
    ? preResponseScan(args.clientMessage)
    : [];
  const reminder = triggers.length > 0 ? buildSafetyReminder(triggers) : "";

  // Build the message list the model sees: history + new client message,
  // optionally with a reminder appended to the user-side message.
  const augmentedClient = reminder
    ? `${args.clientMessage}\n\n${reminder}`
    : args.clientMessage;

  const messages: ModelMessage[] = [
    ...args.history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: augmentedClient },
  ];

  if (!args.quiet && triggers.length > 0) {
    process.stderr.write(
      `[safety] pre-response triggers fired: ${triggers
        .map((t) => `${t.category}(${t.matched})`)
        .join(", ")}; reminder appended.\n`,
    );
  }

  let totalCost = 0;
  let totalCalls = 0;
  let regenerated = false;
  let usedFallback = false;

  // First attempt.
  const first = await generateCoachTurn({
    model: args.cfg.model,
    systemPrompt: args.cfg.systemPrompt,
    messages,
    temperature: args.cfg.temperature,
    maxTokens: args.cfg.maxTokens,
  });
  totalCost += first.usage.cost_usd;
  totalCalls += 1;
  let finalText = first.text;

  // Post-response check.
  if (args.safetyEnabled) {
    const check = postResponseCheck({ draft: first.text, triggers });
    if (!check.ok) {
      regenerated = true;
      if (!args.quiet) {
        process.stderr.write(
          `[safety] post-response check failed: ${check.reason}\n[safety] regenerating with strengthened reminder...\n`,
        );
      }
      const stronger =
        reminder +
        `\n\n[CRITICAL: your previous draft failed the runtime safety check because: ${check.reason} Try again. Do not omit the four required moves. Name a specific resource by name; do not gesture at "support."]`;
      const augmented2 = `${args.clientMessage}\n\n${stronger}`;
      const messages2: ModelMessage[] = [
        ...args.history.map((m) => ({ role: m.role, content: m.content })),
        { role: "user" as const, content: augmented2 },
      ];
      const second = await generateCoachTurn({
        model: args.cfg.model,
        systemPrompt: args.cfg.systemPrompt,
        messages: messages2,
        temperature: args.cfg.temperature,
        maxTokens: args.cfg.maxTokens,
      });
      totalCost += second.usage.cost_usd;
      totalCalls += 1;
      const recheck = postResponseCheck({ draft: second.text, triggers });
      if (recheck.ok) {
        finalText = second.text;
      } else {
        // Hand-authored fallback.
        usedFallback = true;
        if (!args.quiet) {
          process.stderr.write(
            `[safety] regeneration also failed: ${recheck.reason}\n[safety] falling back to hand-authored safety message.\n`,
          );
        }
        const matched =
          triggers[0]?.matched ?? "what you just said";
        finalText = SAFETY_FALLBACK_TEMPLATE(matched);
      }
    }
  }

  if (!args.quiet) {
    process.stderr.write(
      `[telemetry] turn cost=$${totalCost.toFixed(4)} calls=${totalCalls}` +
        (regenerated ? " regenerated" : "") +
        (usedFallback ? " usedFallback" : "") +
        `\n`,
    );
  }

  return {
    text: finalText,
    triggers,
    regenerated,
    used_fallback: usedFallback,
    cumulative_cost_usd: totalCost,
    cumulative_calls: totalCalls,
  };
}

async function cmdTurn(opts: CliOpts): Promise<number> {
  const cfg = loadConfig(opts.configPath);
  if (opts.modelOverride) {
    (cfg as { model: string }).model = opts.modelOverride;
  }

  let history: ConversationMessage[] = [];
  let clientMessage: string | null = opts.newClientMessage;

  if (opts.historyPath) {
    const raw = readFileSync(opts.historyPath, "utf8");
    const parsed = JSON.parse(raw) as ConversationMessage[];
    if (!Array.isArray(parsed)) {
      throw new Error(
        `History at ${opts.historyPath} must be an array of {role,content}`,
      );
    }
    history = parsed;
    // The last user message in history becomes the "new client message" if no
    // explicit --turn-message was supplied.
    if (!clientMessage) {
      const lastUser = [...history].reverse().find((m) => m.role === "user");
      if (!lastUser) {
        throw new Error(
          `History has no user message and no --turn-message was provided`,
        );
      }
      clientMessage = lastUser.content;
      // Remove it from history so we don't duplicate when we append it as
      // the current turn.
      const lastIdx = history.lastIndexOf(lastUser);
      history = history.slice(0, lastIdx);
    }
  }

  if (!clientMessage) {
    // Read from stdin.
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    clientMessage = Buffer.concat(chunks).toString("utf8").trim();
    if (!clientMessage) {
      throw new Error(
        "No client message provided (use --turn-message, --history, or pipe to stdin)",
      );
    }
  }

  const result = await runOneCoachTurn({
    cfg,
    history,
    clientMessage,
    safetyEnabled: opts.safetyEnabled,
    quiet: opts.quiet,
  });

  // Emit JSON on stdout for programmatic consumption.
  const output = {
    coach_text: result.text,
    safety_triggers: result.triggers,
    regenerated: result.regenerated,
    used_fallback: result.used_fallback,
    cost_usd: result.cumulative_cost_usd,
    calls: result.cumulative_calls,
    coach_config_id: cfg.id,
    model: cfg.model,
  };
  process.stdout.write(JSON.stringify(output, null, 2) + "\n");
  return 0;
}

async function cmdRepl(opts: CliOpts): Promise<number> {
  const cfg = loadConfig(opts.configPath);
  if (opts.modelOverride) {
    (cfg as { model: string }).model = opts.modelOverride;
  }

  process.stderr.write(
    `Coach: ${cfg.id} (model=${cfg.model}, retrieval=${cfg.retrievalStrategy}, trigger=${cfg.triggerPolicy})\n` +
      `Description: ${cfg.description || "(none)"}\n` +
      `Type your message and press Enter. Empty line submits. Ctrl-D exits.\n\n`,
  );

  const history: ConversationMessage[] = [];

  // Bun supports `Bun.stdin.text()` only for one-shot; use readline for REPL.
  const readline = await import("node:readline/promises");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  while (true) {
    let line: string;
    try {
      line = await rl.question("you: ");
    } catch {
      break;
    }
    if (line === undefined) break;
    const text = line.trim();
    if (!text) {
      process.stderr.write("(empty — type something or Ctrl-D to exit)\n");
      continue;
    }
    if (text === "/quit" || text === "/exit") break;

    try {
      const result = await runOneCoachTurn({
        cfg,
        history,
        clientMessage: text,
        safetyEnabled: opts.safetyEnabled,
        quiet: opts.quiet,
      });
      process.stdout.write(`\ncoach: ${result.text}\n\n`);
      history.push({ role: "user", content: text });
      history.push({ role: "assistant", content: result.text });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(`[error] ${msg}\n`);
    }
  }
  rl.close();
  return 0;
}

async function main(): Promise<number> {
  let opts: CliOpts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`${msg}\n\n`);
    printHelp();
    return 2;
  }

  if (opts.cmd === "turn") return await cmdTurn(opts);
  if (opts.cmd === "repl") return await cmdRepl(opts);
  printHelp();
  return 2;
}

main()
  .then((code) => {
    if (code !== 0) process.exit(code);
  })
  .catch((e: unknown) => {
    process.stderr.write(`FATAL: ${(e as Error)?.message ?? String(e)}\n`);
    if ((e as Error)?.stack) process.stderr.write(`${(e as Error).stack}\n`);
    process.exit(1);
  });
