import { useEffect, useState, type RefObject } from "react";

interface Pos { x: number; y: number; text: string }

/** A floating 问 AI button next to text selected inside `root`. */
export function SelectionAsk({ root, onAsk }: { root: RefObject<HTMLElement | null>; onAsk(text: string): void }) {
  const [pos, setPos] = useState<Pos | null>(null);

  useEffect(() => {
    const update = () => {
      const sel = window.getSelection();
      const text = sel?.toString().trim() ?? "";
      if (!sel || sel.isCollapsed || !text || !root.current?.contains(sel.anchorNode)) return setPos(null);
      const r = sel.getRangeAt(0).getBoundingClientRect();
      setPos({ x: Math.min(r.right, window.innerWidth - 90), y: Math.min(r.bottom + 6, window.innerHeight - 36), text });
    };
    // After mouseup the selection is final; keyboard selection (Shift+arrows) ends on keyup.
    const onUp = () => setTimeout(update, 0);
    const onChange = () => window.getSelection()?.isCollapsed && setPos(null);
    const onScroll = () => setPos(null);
    const el = root.current;
    document.addEventListener("mouseup", onUp);
    document.addEventListener("keyup", onUp);
    document.addEventListener("selectionchange", onChange);
    el?.addEventListener("scroll", onScroll);
    return () => {
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("keyup", onUp);
      document.removeEventListener("selectionchange", onChange);
      el?.removeEventListener("scroll", onScroll);
    };
  }, [root]);

  if (!pos) return null;
  return (
    <button
      className="sel-ask"
      style={{ left: pos.x, top: pos.y }}
      // Keep the selection while clicking.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        onAsk(pos.text);
        setPos(null);
      }}
    >
      💬 问 AI
    </button>
  );
}
