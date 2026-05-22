/**
 * File-based response cache for Anthropic API calls.
 *
 * Key: sha256(model + system_prompt + messages_json + extra_salt)
 * Value: JSON envelope with timestamp + response payload + cost record.
 *
 * Cache hits short-circuit the API call entirely. Cache misses write to disk
 * after the API call returns.
 *
 * Invalidation is manual: `rm -rf eval/cache/`. The eval data is small and
 * iteration cycles are short; LRU / TTL is unnecessary complexity at this scale.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface CachedCall {
  cached_at: string; // ISO timestamp
  model: string;
  request_hash: string;
  response: unknown;
  usage: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  } | null;
}

function hashRequest(parts: {
  model: string;
  system: string;
  messages: unknown;
  extra?: string;
}): string {
  const h = createHash("sha256");
  h.update("model:" + parts.model + "\n");
  h.update("system:" + parts.system + "\n");
  h.update("messages:" + JSON.stringify(parts.messages) + "\n");
  if (parts.extra) h.update("extra:" + parts.extra + "\n");
  return h.digest("hex");
}

export class ResponseCache {
  private dir: string;
  hits = 0;
  misses = 0;

  constructor(dir: string) {
    this.dir = dir;
    if (!existsSync(this.dir)) {
      mkdirSync(this.dir, { recursive: true });
    }
  }

  key(parts: { model: string; system: string; messages: unknown; extra?: string }): string {
    return hashRequest(parts);
  }

  get(key: string): CachedCall | null {
    const path = join(this.dir, key + ".json");
    if (!existsSync(path)) {
      this.misses += 1;
      return null;
    }
    try {
      const raw = readFileSync(path, "utf8");
      const parsed = JSON.parse(raw) as CachedCall;
      this.hits += 1;
      return parsed;
    } catch (e) {
      this.misses += 1;
      return null;
    }
  }

  put(key: string, model: string, response: unknown, usage: CachedCall["usage"]): void {
    const path = join(this.dir, key + ".json");
    const env: CachedCall = {
      cached_at: new Date().toISOString(),
      model,
      request_hash: key,
      response,
      usage,
    };
    writeFileSync(path, JSON.stringify(env, null, 2), "utf8");
  }
}
