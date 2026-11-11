import { useEffect, useState, type RefObject } from "react";
import { findUnitEl } from "../search/dom";

export interface MarkerSpec {
  key: string;
  turnId: string;
  color: string;
  kind: "mark" | "hit";
}

interface Placed extends MarkerSpec {
  top: number;
}

const MAX = 400;

/** Thin overlay beside the scrollbar showing where bookmarks and search hits are. */
export function Markers({ specs, timeline, onJump }: { specs: MarkerSpec[]; timeline: RefObject<HTMLElement | null>; onJump(s: MarkerSpec): void }) {
  const [placed, setPlaced] = useState<Placed[]>([]);

  useEffect(() => {
    const root = timeline.current;
    if (!root) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const base = root.getBoundingClientRect().top - root.scrollTop;
        const h = root.scrollHeight || 1;
        const seen = new Set<string>();
        const out: Placed[] = [];
        for (const s of specs) {
          if (out.length >= MAX) break;
          const el = findUnitEl(root, s.key, s.turnId);
          if (!el) continue;
          const top = ((el.getBoundingClientRect().top - base) / h) * 100;
          const id = `${s.kind}:${Math.round(top * 4)}`; // collapse overlapping markers
          if (seen.has(id)) continue;
          seen.add(id);
          out.push({ ...s, top });
        }
        setPlaced(out);
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    if (root.firstElementChild) ro.observe(root.firstElementChild);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [specs, timeline]);

  return (
    <div className="markers">
      {placed.map((p) => (
        <button
          key={`${p.kind}:${p.key}`}
          className={`marker ${p.kind}`}
          style={{ top: `${p.top}%`, background: p.color }}
          onClick={() => onJump(p)}
          title={p.kind === "mark" ? "书签" : "搜索结果"}
        />
      ))}
    </div>
  );
}
