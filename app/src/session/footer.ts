import type { SessionEntry } from "./types";

/** The same numbers the terminal footer shows, plus the todo list, derived from the viewed branch. */

export interface Todo {
  id: number;
  subject: string;
  description?: string;
  activeForm?: string;
  status: "pending" | "in_progress" | "completed";
  blockedBy?: number[];
}

const STATUSES = new Set(["pending", "in_progress", "completed"]);

function isTodo(t: unknown): t is Todo {
  const o = t as Record<string, unknown> | null;
  return !!o && typeof o.id === "number" && typeof o.subject === "string" && typeof o.status === "string";
}

function fromDetails(d: unknown): Todo[] | undefined {
  const tasks = (d as { tasks?: unknown } | null | undefined)?.tasks;
  if (!Array.isArray(tasks) || !tasks.every(isTodo)) return undefined;
  return tasks.filter((t) => STATUSES.has(t.status));
}

/**
 * The todo list as of the end of `branch`, rebuilt like the rpiv-todo extension does: the last
 * `rpiv-todo-state` snapshot wins; sessions without one fall back to the last `todo` tool result.
 */
export function todosOf(branch: SessionEntry[]): Todo[] {
  let fromEntries: Todo[] | undefined;
  let fromResults: Todo[] | undefined;
  for (const e of branch) {
    if (e.type === "custom" && e.customType === "rpiv-todo-state") {
      fromEntries = fromDetails(e.data) ?? fromEntries;
    } else if (e.type === "message" && e.message?.role === "toolResult" && e.message.toolName === "todo") {
      fromResults = fromDetails(e.message.details) ?? fromResults;
    }
  }
  return fromEntries ?? fromResults ?? [];
}

export interface FooterStats {
  /** Last model seen on the branch (a model switch or an assistant reply). */
  model?: { provider: string; id: string };
  thinking?: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  /** Share of the latest request's prompt that came from the cache, 0..100. */
  lastCacheHit?: number;
  /** Tokens in the latest request including its reply: roughly how full the context is. */
  contextTokens?: number;
}

export function footerStats(branch: SessionEntry[]): FooterStats {
  const s: FooterStats = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
  for (const e of branch) {
    if (e.type === "model_change" && typeof e.provider === "string" && typeof e.modelId === "string") {
      s.model = { provider: e.provider, id: e.modelId };
    } else if (e.type === "thinking_level_change" && typeof e.thinkingLevel === "string") {
      s.thinking = e.thinkingLevel;
    } else if (e.type === "message" && e.message?.role === "assistant") {
      const m = e.message as Record<string, any>;
      if (typeof m.provider === "string" && typeof m.model === "string") s.model = { provider: m.provider, id: m.model };
      const u = m.usage;
      if (!u) continue;
      const input = u.input ?? 0;
      const cacheRead = u.cacheRead ?? 0;
      const cacheWrite = u.cacheWrite ?? 0;
      s.input += input;
      s.output += u.output ?? 0;
      s.cacheRead += cacheRead;
      s.cacheWrite += cacheWrite;
      s.cost += u.cost?.total ?? 0;
      const prompt = input + cacheRead + cacheWrite;
      s.lastCacheHit = prompt > 0 ? (cacheRead / prompt) * 100 : undefined;
      // A request that failed before the model answered reports no usage; keep the previous figure.
      if (prompt > 0) s.contextTokens = prompt + (u.output ?? 0);
    }
  }
  return s;
}

/** 1234 -> "1.2k", 1500000 -> "1.5M". */
export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k`;
  return String(n);
}
