import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_SIZE, FONTS, SIZE_MAX, SIZE_MIN, SPACINGS, WIDTHS, fontCss,
  type Appearance, type RoleStyle,
} from "../prefs/appearance";
import { THEMES, type ThemePref } from "../prefs/themes";

interface Props {
  theme: ThemePref;
  onTheme(t: ThemePref): void;
  appearance: Appearance;
  onChange(fn: (a: Appearance) => Appearance): void;
  onReset(): void;
}

function Segmented<T extends string>({ value, items, onPick }: { value: T; items: Array<[T, string]>; onPick(v: T): void }) {
  return (
    <div className="segmented small">
      {items.map(([id, label]) => (
        <button key={id} className={id === value ? "on" : ""} onClick={() => onPick(id)}>{label}</button>
      ))}
    </div>
  );
}

const CUSTOM = "__custom";

/** Font, size and color of one side of the conversation. */
function RoleEditor({ title, style, onChange }: { title: string; style: RoleStyle; onChange(patch: Partial<RoleStyle>): void }) {
  const preset = FONTS.find(([css]) => css === style.font);
  // Typing a custom name must not flip the select back to a preset while the box is still empty.
  const [custom, setCustom] = useState(!preset);
  const selected = custom ? CUSTOM : style.font;
  const size = style.size || DEFAULT_SIZE;
  return (
    <fieldset className="ap-role">
      <legend>{title}</legend>
      <div className="ap-row">
        <span>字体</span>
        <select
          value={selected}
          onChange={(e) => {
            const v = e.target.value;
            setCustom(v === CUSTOM);
            if (v !== CUSTOM) onChange({ font: v });
          }}
        >
          {FONTS.map(([css, label]) => <option key={label} value={css}>{label}</option>)}
          <option value={CUSTOM}>自定义…</option>
        </select>
      </div>
      {custom && (
        <div className="ap-row">
          <span />
          <input
            className="ap-input"
            placeholder="输入已安装的字体名，如 LXGW WenKai"
            defaultValue={preset ? "" : style.font.replace(/^"|", sans-serif$/g, "")}
            onChange={(e) => onChange({ font: fontCss(e.target.value) })}
          />
        </div>
      )}
      <div className="ap-row">
        <span>大小</span>
        <div className="zoom">
          <button onClick={() => onChange({ size: Math.max(SIZE_MIN, size - 1) })} title="减小字号">−</button>
          <button onClick={() => onChange({ size: 0 })} title="还原默认大小">{size}px</button>
          <button onClick={() => onChange({ size: Math.min(SIZE_MAX, size + 1) })} title="增大字号">+</button>
        </div>
      </div>
      <div className="ap-row">
        <span>颜色</span>
        <input type="color" value={style.color || "#808080"} onChange={(e) => onChange({ color: e.target.value })} />
        <button className="copy-btn" disabled={!style.color} onClick={() => onChange({ color: "" })} title="使用主题的文字颜色">
          默认
        </button>
      </div>
    </fieldset>
  );
}

/** The 个性化 menu: theme, text style of 提问/回答, spacing and width. */
export function AppearanceMenu({ theme, onTheme, appearance, onChange, onReset }: Props) {
  const [open, setOpen] = useState(false);
  // Remounts the role editors on reset, so their font select drops back to the default.
  const [resetNonce, setResetNonce] = useState(0);
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

  const role = (who: "user" | "agent") => (patch: Partial<RoleStyle>) =>
    onChange((a) => ({ ...a, [who]: { ...a[who], ...patch } }));

  return (
    <div className="view-menu appearance" ref={root}>
      <button className={`toggle ${open ? "on" : ""}`} onClick={() => setOpen(!open)} title="个性化：主题、字体、字号、颜色、间距">
        🎨
      </button>
      {open && (
        <div className="menu-pop ap-pop">
          <div className="ap-title">主题</div>
          <div className="ap-themes">
            {THEMES.map((t) => (
              <button key={t.id} className={`ap-theme ${t.id === theme ? "on" : ""}`} onClick={() => onTheme(t.id)} title={t.label}>
                <span className="ap-swatch" style={{ background: t.swatch[0], color: t.swatch[1] }}>
                  Aa<i style={{ background: t.swatch[2] }} />
                </span>
                <span>{t.label}</span>
              </button>
            ))}
          </div>
          <div className="ap-title">版面</div>
          <div className="ap-row">
            <span>内容宽度</span>
            <Segmented value={appearance.width} items={WIDTHS.map(([id, label]) => [id, label])} onPick={(width) => onChange((a) => ({ ...a, width }))} />
          </div>
          <div className="ap-row">
            <span>行距段距</span>
            <Segmented value={appearance.spacing} items={SPACINGS.map(([id, label]) => [id, label])} onPick={(spacing) => onChange((a) => ({ ...a, spacing }))} />
          </div>
          <RoleEditor key={`u${resetNonce}`} title="我的提问" style={appearance.user} onChange={role("user")} />
          <RoleEditor key={`a${resetNonce}`} title="AI 回答" style={appearance.agent} onChange={role("agent")} />
          <button className="copy-btn ap-reset" onClick={() => { onReset(); setResetNonce((n) => n + 1); }} title="字体、大小、颜色、间距和宽度恢复默认（主题不变）">
            恢复默认排版
          </button>
        </div>
      )}
    </div>
  );
}
