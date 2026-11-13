import { useEffect, useState } from "react";
import { MARK_COLORS, type Mark, type MarksApi } from "../marks/marks";
import type { Reveal } from "../reveal";

/** Document order: turn, then the user prompt before parts by index. */
export function sortMarks(marks: Mark[], turnOrder: Map<string, number>): Mark[] {
  const rank = (m: Mark) => {
    const p = /:p(\d+)/.exec(m.key);
    return p ? Number(p[1]) : -1;
  };
  return [...marks].sort(
    (a, b) => (turnOrder.get(a.turnId) ?? 1e9) - (turnOrder.get(b.turnId) ?? 1e9) || rank(a) - rank(b),
  );
}

function firstLine(s: string): string {
  return s.split(/\r?\n/).find((l) => l.trim())?.trim() ?? "";
}

/** Title of a bookmark: the user's name for it, else the start of the text it points at. */
export const markTitle = (m: Pick<Mark, "name" | "preview">) => m.name?.trim() || firstLine(m.preview);

export function MarksPanel(props: {
  api: MarksApi;
  sorted: Mark[];
  turnOrder: Map<string, number>;
  onJump(m: Mark): void;
  /** Asks to start renaming this bookmark (from the right-click menu); `nonce` re-triggers the same key. */
  rename: Reveal | null;
}) {
  const { api, sorted, turnOrder, onJump, rename } = props;
  const [editing, setEditing] = useState<string | null>(null);
  useEffect(() => {
    if (rename) setEditing(rename.key);
  }, [rename?.nonce]);
  if (!sorted.length) {
    return <div className="panel-empty">还没有书签。<br />点 ☆、在内容上右键，或按 m 给当前提问加书签。</div>;
  }
  return (
    <div className="marks">
      {sorted.map((m) => {
        const missing = !turnOrder.has(m.turnId);
        return (
          <div key={m.key} className={`mark-item ${missing ? "missing" : ""}`}>
            <div className="mark-row">
              <button
                className="mark-dot"
                style={{ background: MARK_COLORS[m.color] }}
                title="切换颜色"
                onClick={() => api.update(m.key, { color: (m.color + 1) % MARK_COLORS.length })}
              />
              {editing === m.key ? (
                <input
                  className="mark-name-input"
                  autoFocus
                  defaultValue={m.name ?? ""}
                  placeholder={firstLine(m.preview)}
                  onFocus={(e) => e.currentTarget.select()}
                  onBlur={(e) => {
                    api.update(m.key, { name: e.currentTarget.value.trim() });
                    setEditing(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    else if (e.key === "Escape") {
                      e.stopPropagation();
                      setEditing(null);
                    }
                  }}
                />
              ) : (
                <button
                  className={`mark-preview ${m.name ? "named" : ""}`}
                  onClick={() => onJump(m)}
                  onDoubleClick={() => setEditing(m.key)}
                  disabled={missing}
                  title={`${m.preview}\n\n（双击或点 ✎ 命名）`}
                >
                  {missing && <span className="muted">[不在当前分支] </span>}
                  {m.name ? "" : m.key.endsWith(":u") ? "问 · " : "答 · "}
                  {markTitle(m)}
                </button>
              )}
              <button className="mark-del" title="命名书签" onClick={() => setEditing(m.key)}>✎</button>
              <button className="mark-del" title="删除书签" onClick={() => api.remove(m.key)}>✕</button>
            </div>
            {m.name && <div className="mark-sub muted">{m.key.endsWith(":u") ? "问 · " : "答 · "}{firstLine(m.preview)}</div>}
            <input
              className="mark-note"
              value={m.note}
              placeholder="备注…"
              onChange={(e) => api.update(m.key, { note: e.target.value })}
            />
          </div>
        );
      })}
    </div>
  );
}
