import { matches } from "./search";

// UI chrome that is not part of the searchable model text; skipping it keeps DOM match order
// aligned with the per-unit ordinals computed from the model.
const SKIP = ".card-head, .process-head, .code-head, .copy-btn, .float-actions, .tool-status, .detail-head, .mark-btn";

export function textRanges(root: Element, re: RegExp): Range[] {
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.nodeValue ?? "";
    for (const m of matches(re, text)) {
      const r = document.createRange();
      r.setStart(n, m.index);
      r.setEnd(n, m.index + m[0].length);
      ranges.push(r);
    }
  }
  return ranges;
}

/** The unit's element, or its nearest rendered container (folded steps are not in the DOM). */
export function findUnitEl(root: Element, key: string, turnId: string): HTMLElement | null {
  for (let k = key; k.includes(":"); k = k.slice(0, k.lastIndexOf(":"))) {
    const el = root.querySelector<HTMLElement>(`[data-unit="${CSS.escape(k)}"]`);
    if (el) return el;
  }
  return root.querySelector<HTMLElement>(`[data-turn-id="${CSS.escape(turnId)}"]`);
}

export function paintHighlights(all: Range[], current: Range | null): void {
  CSS.highlights.set("smp-hit", new Highlight(...all));
  if (current) CSS.highlights.set("smp-current", new Highlight(current));
  else CSS.highlights.delete("smp-current");
}

export function clearHighlights(): void {
  CSS.highlights.delete("smp-hit");
  CSS.highlights.delete("smp-current");
}

/** Scrolls the timeline so `rect` sits in the upper third of the viewport. */
export function scrollToRect(timeline: HTMLElement, rect: DOMRect): void {
  const top = timeline.getBoundingClientRect().top;
  timeline.scrollTop += rect.top - top - timeline.clientHeight / 3;
}

/** Brings a match into view, including inside nested scrollers (tool output, wide code blocks). */
export function scrollRangeIntoView(timeline: HTMLElement, range: Range): void {
  for (let el = range.startContainer.parentElement; el && el !== timeline; el = el.parentElement) {
    const style = getComputedStyle(el);
    const r = range.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    if (el.scrollHeight > el.clientHeight + 1 && /auto|scroll/.test(style.overflowY) && (r.top < box.top || r.bottom > box.bottom)) {
      el.scrollTop += r.top - box.top - el.clientHeight / 3;
    }
    if (el.scrollWidth > el.clientWidth + 1 && /auto|scroll/.test(style.overflowX) && (r.left < box.left || r.right > box.right)) {
      el.scrollLeft += r.left - box.left - el.clientWidth / 3;
    }
  }
  scrollToRect(timeline, range.getBoundingClientRect());
}
