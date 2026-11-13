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

/** The agent's todo list (read-only) above the question outline: foldable, finished items folded away. */
export function TodoSection({ todos, open, onToggle }: { todos: Todo[]; open: boolean; onToggle(): void }) {
  const of = (s: Todo["status"]) => todos.filter((t) => t.status === s);
  const doing = of("in_progress");
  const pending = of("pending");
  const done = of("completed");
  return (
    <section className="todo-section">
      <button className="todo-head" onClick={onToggle} aria-expanded={open} title={open ? "折叠待办" : "展开待办"}>
        <span className="caret">{open ? "▾" : "▸"}</span>
        <span>待办 · {done.length}/{todos.length}</span>
        {!open && doing[0] && <span className="fold-preview">{doing[0].activeForm ?? doing[0].subject}</span>}
      </button>
      {open && (
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
      )}
    </section>
  );
}
