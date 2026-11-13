import type { Todo } from "../session/footer";

const GLYPH = { pending: "○", in_progress: "◐", completed: "●" } as const;

function Item({ t }: { t: Todo }) {
  return (
    <div className={`todo ${t.status}`} title={t.description}>
      <span className="todo-glyph">{GLYPH[t.status]}</span>
      <div className="todo-body">
        <div className="todo-subject">{t.status === "in_progress" && t.activeForm ? t.activeForm : t.subject}</div>
        {t.status === "in_progress" && t.activeForm && <div className="todo-sub muted">{t.subject}</div>}
        {t.blockedBy && t.blockedBy.length > 0 && t.status !== "completed" && (
          <div className="todo-sub muted">等待 {t.blockedBy.map((b) => `#${b}`).join(" ")}</div>
        )}
      </div>
    </div>
  );
}

/** The agent's todo list (read-only), grouped by state; finished items are folded away. */
export function TodoPanel({ todos }: { todos: Todo[] }) {
  const of = (s: Todo["status"]) => todos.filter((t) => t.status === s);
  const doing = of("in_progress");
  const pending = of("pending");
  const done = of("completed");
  return (
    <div className="todos">
      {doing.map((t) => <Item key={t.id} t={t} />)}
      {pending.map((t) => <Item key={t.id} t={t} />)}
      {done.length > 0 && (
        <details className="todo-done" open={doing.length + pending.length === 0}>
          <summary>已完成 · {done.length}</summary>
          {done.map((t) => <Item key={t.id} t={t} />)}
        </details>
      )}
    </div>
  );
}
