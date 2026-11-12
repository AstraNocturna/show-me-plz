import type { Part, Step, Turn } from "./viewModel";

/** What the conversation view shows; picked in the top bar's 显示 menu. */
export interface ViewOpts {
  /** Text before the closing answer (and notices). Off: only each turn's final answer. */
  interim: boolean;
  /** Process blocks: thinking and tool calls, shown or hidden together. */
  process: boolean;
  /** Process blocks start expanded. */
  expand: boolean;
}

export const DEFAULT_VIEW: ViewOpts = { interim: true, process: true, expand: false };

/** Items keep their original index so unit keys (bookmarks, search hits) are the same in every view. */
export interface Indexed<T> {
  item: T;
  index: number;
}

/** Steps shown in a process block; empty when the block should be hidden altogether. */
export function visibleSteps(steps: Step[], v: ViewOpts): Indexed<Step>[] {
  if (!v.process) return [];
  const shown = steps.map((item, index) => ({ item, index }));
  // A block holding only meta lines ("模型 → …") is not worth showing on its own.
  return shown.some((s) => s.item.kind !== "meta") ? shown : [];
}

/**
 * Parts shown for a turn. The final answer (text and errors after the last process block) is always
 * shown; it is empty while the turn is still working or ended on a tool call.
 */
export function visibleParts(turn: Turn, v: ViewOpts): Indexed<Part>[] {
  const lastProcess = turn.parts.map((p) => p.kind).lastIndexOf("process");
  return turn.parts
    .map((item, index) => ({ item, index }))
    .filter(({ item, index }) => {
      if (item.kind === "process") return visibleSteps(item.steps, v).length > 0;
      const final = index > lastProcess && (item.kind === "text" || item.kind === "error");
      return final || v.interim;
    });
}
