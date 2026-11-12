import { useEffect, useRef, useState } from "react";
import type { ViewOpts } from "../session/view";

const ITEMS: Array<[keyof ViewOpts, string, string]> = [
  ["interim", "中间回复", "取消后每轮只看最终回答"],
  ["process", "思考与工具", "思考过程和工具调用，一起显示或隐藏"],
  ["expand", "默认展开思考与工具", "不勾选时折叠成一行，点开查看"],
];

/** The 显示 menu: which parts of the conversation the view shows. */
export function ViewMenu({ view, onChange }: { view: ViewOpts; onChange(v: ViewOpts): void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const summary = !view.interim && !view.process ? "仅最终回答" : !view.process ? "隐藏过程" : view.expand ? "展开过程" : "";
  return (
    <div className="view-menu" ref={root}>
      <button className={`menu-btn ${open ? "on" : ""}`} onClick={() => setOpen(!open)} title="选择要显示的内容">
        显示{summary && <span className="menu-summary">：{summary}</span>} ▾
      </button>
      {open && (
        <div className="menu-pop">
          {ITEMS.map(([key, label, hint]) => {
            const disabled = key === "expand" && !view.process;
            return (
              <label key={key} className={disabled ? "disabled" : ""} title={hint}>
                <input
                  type="checkbox"
                  checked={view[key]}
                  disabled={disabled}
                  onChange={(e) => onChange({ ...view, [key]: e.target.checked })}
                />
                <span>
                  {label}
                  <small>{hint}</small>
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
