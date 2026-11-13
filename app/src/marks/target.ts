import { userKey } from "../session/units.ts";
import type { Turn } from "../session/viewModel.ts";

/** How much of the marked text a bookmark keeps: shown as its title, and given to the model to name it. */
export const PREVIEW_MAX = 600;

/** What a bookmark on `unitKey` would point at: a user prompt or a text part of an answer; null for anything else. */
export function markTarget(turns: Turn[], unitKey: string): { key: string; turnId: string; preview: string } | null {
  for (const t of turns) {
    if (unitKey === userKey(t.id)) return t.user ? { key: unitKey, turnId: t.id, preview: t.user.label.slice(0, PREVIEW_MAX) } : null;
    const prefix = `${t.id}:p`;
    const index = unitKey.slice(prefix.length);
    if (!unitKey.startsWith(prefix) || !/^[0-9]+$/.test(index)) continue;
    const part = t.parts[Number(index)];
    return part?.kind === "text" ? { key: unitKey, turnId: t.id, preview: part.text.slice(0, PREVIEW_MAX) } : null;
  }
  return null;
}

/** The nearest enclosing bookmarkable unit key of a DOM element (a prompt or an answer text), if any. */
export function markableKeyAt(el: Element | null): string | null {
  let unit = el?.closest<HTMLElement>("[data-unit]") ?? null;
  while (unit) {
    const key = unit.dataset.unit ?? "";
    if (/:(u|p[0-9]+)$/.test(key)) return key;
    unit = unit.parentElement?.closest<HTMLElement>("[data-unit]") ?? null;
  }
  return null;
}
