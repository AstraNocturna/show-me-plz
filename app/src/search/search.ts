import { toolSummary } from "../session/toolSummary.ts";
import { partKey, stepKey, userKey } from "../session/units.ts";
import type { Turn } from "../session/viewModel";

export type UnitKind = "user" | "answer" | "process";
export type Scope = "all" | UnitKind;

export interface Unit {
  key: string;
  turnId: string;
  kind: UnitKind;
  text: string;
}

export interface Hit {
  unitKey: string;
  turnId: string;
  /** Index of this match among matches in the same unit (maps to DOM order). */
  ordinal: number;
}

export interface SearchOptions {
  regex: boolean;
  caseSensitive: boolean;
}

export const MAX_HITS = 5000;

/** Every searchable piece of text, including content that is folded away in the UI. */
export function buildUnits(turns: Turn[], cwd?: string): Unit[] {
  const units: Unit[] = [];
  for (const t of turns) {
    if (t.user) units.push({ key: userKey(t.id), turnId: t.id, kind: "user", text: t.user.text });
    t.parts.forEach((p, i) => {
      const key = partKey(t.id, i);
      if (p.kind === "text" || p.kind === "error") units.push({ key, turnId: t.id, kind: "answer", text: p.text });
      else if (p.kind === "notice") units.push({ key, turnId: t.id, kind: "process", text: `${p.title}\n${p.text}` });
      else if (p.kind === "process") {
        p.steps.forEach((s, j) => {
          const k = stepKey(key, j);
          if (s.kind === "thinking") units.push({ key: k, turnId: t.id, kind: "process", text: s.text });
          else if (s.kind === "tool") {
            // Same order as the DOM: name, summary, args, result.
            const c = s.call;
            const args = Object.entries(c.args).map(([a, v]) => `${a} ${typeof v === "string" ? v : JSON.stringify(v)}`);
            const text = [c.name, toolSummary(c, cwd), ...args, c.result?.text ?? ""].join("\n");
            units.push({ key: k, turnId: t.id, kind: "process", text });
          }
        });
      }
    });
  }
  return units;
}

/** Builds a global regex for the query, or an error message for an invalid pattern. */
export function makeMatcher(query: string, opts: SearchOptions): RegExp | string | null {
  if (!query) return null;
  const source = opts.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  try {
    return new RegExp(source, opts.caseSensitive ? "gu" : "giu");
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** Iterates non-empty matches; guards against zero-width patterns looping forever. */
export function* matches(re: RegExp, text: string): Generator<RegExpExecArray> {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    yield m;
  }
}

export function findHits(units: Unit[], re: RegExp, scope: Scope): Hit[] {
  const hits: Hit[] = [];
  for (const u of units) {
    if (scope !== "all" && u.kind !== scope) continue;
    let ordinal = 0;
    for (const _ of matches(re, u.text)) {
      hits.push({ unitKey: u.key, turnId: u.turnId, ordinal: ordinal++ });
      if (hits.length >= MAX_HITS) return hits;
    }
  }
  return hits;
}
