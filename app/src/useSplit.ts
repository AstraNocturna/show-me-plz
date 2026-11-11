import { useCallback, useEffect, useState, type RefObject } from "react";
import type { SplitDir } from "./components/FilePreview";

const KEY = "smp.split";
const MIN = 0.2;
const MAX = 0.8;

interface Split {
  dir: SplitDir;
  /** Share of the workspace taken by the conversation pane. */
  ratio: number;
}

function loadSplit(): Split {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "") as Split;
    if ((s.dir === "row" || s.dir === "col") && s.ratio >= MIN && s.ratio <= MAX) return s;
  } catch {
    /* default */
  }
  return { dir: "row", ratio: 0.5 };
}

/** Split direction and divider position, persisted across launches. */
export function useSplit(container: RefObject<HTMLElement | null>) {
  const [split, setSplit] = useState(loadSplit);
  useEffect(() => localStorage.setItem(KEY, JSON.stringify(split)), [split]);

  const toggleDir = useCallback(() => setSplit((s) => ({ ...s, dir: s.dir === "row" ? "col" : "row" })), []);

  const startDrag = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const box = container.current?.getBoundingClientRect();
      if (!box) return;
      const handle = e.currentTarget;
      handle.setPointerCapture(e.pointerId);
      document.body.classList.add("dragging");
      const move = (ev: PointerEvent) => {
        const r = split.dir === "row" ? (ev.clientX - box.left) / box.width : (ev.clientY - box.top) / box.height;
        setSplit((s) => ({ ...s, ratio: Math.min(MAX, Math.max(MIN, r)) }));
      };
      const up = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        document.body.classList.remove("dragging");
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
    },
    [container, split.dir],
  );

  return { ...split, toggleDir, startDrag };
}
