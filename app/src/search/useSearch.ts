import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { ViewOpts } from "../session/view";
import type { Turn } from "../session/viewModel";
import { clearHighlights, findUnitEl, paintHighlights, scrollRangeIntoView, scrollToRect, textRanges } from "./dom";
import { buildUnits, findHits, makeMatcher, MAX_HITS, type Hit } from "./search";

const DEBOUNCE = 150;
const MAX_WAIT_FRAMES = 12;

export interface SearchState {
  open: boolean;
  query: string;
  regex: boolean;
  caseSensitive: boolean;
  hits: Hit[];
  index: number;
  error: string | null;
  capped: boolean;
  setOpen(open: boolean): void;
  setQuery(q: string): void;
  setRegex(v: boolean): void;
  setCaseSensitive(v: boolean): void;
  next(): void;
  prev(): void;
}

interface Deps {
  turns: Turn[];
  cwd?: string;
  view: ViewOpts;
  timeline: RefObject<HTMLElement | null>;
  activeTurnId?: string;
  reveal(key: string): void;
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

export function useSearch({ turns, cwd, view, timeline, activeTurnId, reveal }: Deps): SearchState {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [index, setIndex] = useState(0);
  const [navNonce, setNavNonce] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), DEBOUNCE);
    return () => clearTimeout(t);
  }, [query]);

  const units = useMemo(() => buildUnits(turns, cwd, view), [turns, cwd, view]);
  const matcher = useMemo(
    () => (open ? makeMatcher(debounced, { regex, caseSensitive }) : null),
    [open, debounced, regex, caseSensitive],
  );
  const re = matcher instanceof RegExp ? matcher : null;
  const hits = useMemo(() => (re ? findHits(units, re) : []), [units, re]);

  // New query/options: start at the first hit at or after the turn being read. Not on new entries.
  const hitsRef = useRef(hits);
  hitsRef.current = hits;
  const activeRef = useRef(activeTurnId);
  activeRef.current = activeTurnId;
  useEffect(() => {
    const order = new Map(turns.map((t, i) => [t.id, i]));
    const from = order.get(activeRef.current ?? "") ?? 0;
    const i = hitsRef.current.findIndex((h) => (order.get(h.turnId) ?? 0) >= from);
    setIndex(Math.max(0, i));
    setNavNonce((n) => n + 1);
    // `turns` intentionally omitted: new entries must not reset the position.
  }, [re]);

  const paint = useCallback(
    (scroll: boolean) => {
      const root = timeline.current;
      if (!root || !re) return clearHighlights();
      const all = textRanges(root, re);
      const hit = hitsRef.current[index];
      let current: Range | null = null;
      if (hit) {
        const el = findUnitEl(root, hit.unitKey, hit.turnId);
        if (el) {
          const own = textRanges(el, re);
          current = own[Math.min(hit.ordinal, own.length - 1)] ?? null;
          if (scroll && current) scrollRangeIntoView(root, current);
          else if (scroll) scrollToRect(root, el.getBoundingClientRect());
        }
      }
      paintHighlights(all, current);
    },
    [timeline, re, index],
  );

  // Navigate: reveal folded content, wait for it to render, then highlight and scroll.
  useEffect(() => {
    const hit = hitsRef.current[index];
    if (!hit) return paint(false);
    reveal(hit.unitKey);
    let cancelled = false;
    // Unfolding takes a few renders (reveal -> effect -> setOpen); wait until the match exists.
    const ready = () => {
      const el = timeline.current?.querySelector(`[data-unit="${CSS.escape(hit.unitKey)}"]`);
      return !!el && !!re && textRanges(el, re).length > hit.ordinal;
    };
    void (async () => {
      for (let i = 0; i < MAX_WAIT_FRAMES && !cancelled && !ready(); i++) await nextFrame();
      if (!cancelled) paint(true);
    })();
    return () => {
      cancelled = true;
    };
    // Driven by explicit navigation (navNonce) only.
  }, [navNonce]);

  // Keep highlights in sync with DOM changes (folding, new messages, highlighting) without scrolling.
  useEffect(() => {
    const root = timeline.current;
    if (!root || !re) {
      clearHighlights();
      return;
    }
    let timer: number | undefined;
    const obs = new MutationObserver(() => {
      clearTimeout(timer);
      timer = window.setTimeout(() => paint(false), 80);
    });
    obs.observe(root, { childList: true, subtree: true, characterData: true });
    paint(false);
    return () => {
      obs.disconnect();
      clearTimeout(timer);
    };
  }, [timeline, re, paint]);

  const step = (d: number) => {
    const n = hitsRef.current.length;
    if (!n) return;
    setIndex((i) => (i + d + n) % n);
    setNavNonce((x) => x + 1);
  };

  return {
    open,
    query,
    regex,
    caseSensitive,
    hits,
    index,
    error: typeof matcher === "string" ? matcher : null,
    capped: hits.length >= MAX_HITS,
    setOpen,
    setQuery,
    setRegex,
    setCaseSensitive,
    next: () => step(1),
    prev: () => step(-1),
  };
}
