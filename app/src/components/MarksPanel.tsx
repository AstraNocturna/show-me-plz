import { MARK_COLORS, type Mark, type MarksApi } from "../marks/marks";

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

export function MarksPanel(props: {
  api: MarksApi;
  sorted: Mark[];
  turnOrder: Map<string, number>;
  onJump(m: Mark): void;
}) {
  const { api, sorted, turnOrder, onJump } = props;
  if (!sorted.length) {
    return <div className="panel-empty">还没有书签。<br />点 ☆ 或按 m 给当前提问加书签。</div>;
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
              <button className="mark-preview" onClick={() => onJump(m)} disabled={missing} title={m.preview}>
                {missing && <span className="muted">[不在当前分支] </span>}
                {m.key.endsWith(":u") ? "问 · " : "答 · "}
                {firstLine(m.preview)}
              </button>
              <button className="mark-del" title="删除书签" onClick={() => api.remove(m.key)}>✕</button>
            </div>
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
