import type { Part, Step, Turn } from "./viewModel";

/** final: only each turn's closing answer; chat: process folded; full: process expanded. */
export type Mode = "final" | "chat" | "full";

export interface ViewOpts {
  mode: Mode;
  /** Show tool-call steps (ignored in "final", which shows no process at all). */
  tools: boolean;
}

/** Items keep their original index so unit keys (bookmarks, search hits) are the same in every view. */
export interface Indexed<T> {
  item: T;
  index: number;
}

/** Steps shown in a process block; empty when the block should be hidden altogether. */
export function visibleSteps(steps: Step[], v: ViewOpts): Indexed<Step>[] {
  const shown = steps.flatMap((item, index) => (v.tools || item.kind !== "tool" ? [{ item, index }] : []));
  // A block holding only meta lines ("模型 → …") is not worth showing on its own.
  return shown.some((s) => s.item.kind !== "meta") ? shown : [];
}

/**
 * Parts shown for a turn. In "final" mode that is the closing answer: the text (and errors) after the
 * last process block. Empty while the turn is still working or ended on a tool call.
 */
export function visibleParts(turn: Turn, v: ViewOpts): Indexed<Part>[] {
  const all = turn.parts.map((item, index) => ({ item, index }));
  if (v.mode === "final") {
    const lastProcess = turn.parts.map((p) => p.kind).lastIndexOf("process");
    return all.slice(lastProcess + 1).filter((p) => p.item.kind === "text" || p.item.kind === "error");
  }
  return all.filter((p) => p.item.kind !== "process" || visibleSteps(p.item.steps, v).length > 0);
}
