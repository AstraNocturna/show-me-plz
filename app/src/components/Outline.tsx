import type { Turn } from "../session/viewModel";

function label(turn: Turn): string {
  const line = turn.user?.text.split(/\r?\n/).find((l) => l.trim()) ?? "";
  return line.trim() || (turn.user ? "（图片）" : "（会话开始）");
}

export function Outline({ turns, activeId, onJump }: { turns: Turn[]; activeId?: string; onJump: (id: string) => void }) {
  return (
    <nav className="outline">
      <div className="outline-title">提问 · {turns.filter((t) => t.user).length}</div>
      {turns.map((t, i) => (
        <button
          key={t.id}
          className={`outline-item ${t.id === activeId ? "active" : ""}`}
          onClick={() => onJump(t.id)}
          title={t.user?.text.slice(0, 500)}
        >
          <span className="outline-index">{i + 1}</span>
          <span className="outline-label">{label(t)}</span>
        </button>
      ))}
    </nav>
  );
}
