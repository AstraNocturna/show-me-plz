import type { Turn } from "../session/viewModel";

function label(turn: Turn): string {
  const line = turn.user?.text.split(/\r?\n/).find((l) => l.trim()) ?? "";
  return line.trim() || (turn.user ? "（图片）" : "（会话开始）");
}

export function Outline(props: { turns: Turn[]; activeId?: string; marked: Set<string>; onJump: (id: string) => void }) {
  const { turns, activeId, marked, onJump } = props;
  return (
    <nav className="outline">
      {turns.map((t, i) => (
        <button
          key={t.id}
          className={`outline-item ${t.id === activeId ? "active" : ""}`}
          onClick={() => onJump(t.id)}
          title={t.user?.text.slice(0, 500)}
        >
          <span className="outline-index">{i + 1}</span>
          <span className="outline-label">{label(t)}</span>
          {marked.has(t.id) && <span className="outline-star">★</span>}
        </button>
      ))}
    </nav>
  );
}
