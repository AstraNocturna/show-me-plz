import { useLayoutEffect, useEffect, useRef, useState } from "react";

export type MenuItem =
  | { kind: "item"; label: string; onClick(): void; disabled?: boolean }
  | { kind: "heading"; label: string }
  | { kind: "sep" }
  | { kind: "list"; entries: Array<{ label: string; color: string; onClick(): void }>; empty: string };

/** A small right-click menu at (x, y), kept inside the window; closes on any click away, Esc, scroll or resize. */
export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos({
      left: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)),
      top: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)),
    });
  }, [x, y, items]);

  useEffect(() => {
    const onDown = (e: Event) => !ref.current?.contains(e.target as Node) && onClose();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("contextmenu", onDown, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);
    window.addEventListener("wheel", onDown, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("contextmenu", onDown, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("wheel", onDown, true);
    };
  }, [onClose]);

  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };
  return (
    <div className="ctx-menu" ref={ref} style={pos} role="menu">
      {items.map((it, i) => {
        switch (it.kind) {
          case "sep":
            return <div key={i} className="ctx-sep" />;
          case "heading":
            return <div key={i} className="ctx-heading">{it.label}</div>;
          case "list":
            return (
              <div key={i} className="ctx-list">
                {it.entries.length === 0 && <div className="ctx-empty">{it.empty}</div>}
                {it.entries.map((e, j) => (
                  <button key={j} className="ctx-item" role="menuitem" onClick={run(e.onClick)} title={e.label}>
                    <span className="ctx-dot" style={{ background: e.color }} />
                    <span className="ctx-label">{e.label}</span>
                  </button>
                ))}
              </div>
            );
          default:
            return (
              <button key={i} className="ctx-item" role="menuitem" disabled={it.disabled} onClick={run(it.onClick)}>
                <span className="ctx-label">{it.label}</span>
              </button>
            );
        }
      })}
    </div>
  );
}
