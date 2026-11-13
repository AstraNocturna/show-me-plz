import { useEffect, useRef, useState } from "react";
import type { MarkTarget } from "../marks/marks";

function firstLine(s: string): string {
  return s.split(/\r?\n/).find((l) => l.trim())?.trim() ?? "";
}

/** Asked when a bookmark is added: type a name, or let the AI suggest one (then edit it if you like). */
export function NameMarkDialog(props: {
  target: MarkTarget;
  onCommit(name: string): void;
  onCancel(): void;
  suggest(kind: "user" | "agent", text: string): Promise<string>;
}) {
  const { target, onCommit, onCancel, suggest } = props;
  const [value, setValue] = useState("");
  const [ai, setAi] = useState<{ state: "idle" | "loading" } | { state: "error"; message: string }>({ state: "idle" });
  /** Bumped by every request and by closing, so a late reply from an abandoned request is dropped. */
  const token = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => () => void token.current++, []);

  const ask = () => {
    const mine = ++token.current;
    setAi({ state: "loading" });
    suggest(target.key.endsWith(":u") ? "user" : "agent", target.preview).then(
      (name) => {
        if (token.current !== mine) return;
        setValue(name);
        setAi({ state: "idle" });
        input.current?.focus();
        input.current?.select();
      },
      (err) => {
        if (token.current !== mine) return;
        setAi({ state: "error", message: String(err?.message ?? err) });
      },
    );
  };

  const loading = ai.state === "loading";
  return (
    <div className="help" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="help-card name-card" role="dialog" aria-label="给书签起名" onKeyDown={(e) => e.stopPropagation()}>
        <div className="help-title">给书签起个名</div>
        <div className="name-quote muted">{target.key.endsWith(":u") ? "问 · " : "答 · "}{firstLine(target.preview)}</div>
        <input
          ref={input}
          className="name-input"
          autoFocus
          value={value}
          placeholder="名称（留空则用原文开头）"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) onCommit(value);
            else if (e.key === "Escape") onCancel();
          }}
        />
        <div className="name-actions">
          <button
            className="toggle"
            disabled={loading}
            title="让 AI 根据这段内容起名（用和主会话相同的模型，会复用主会话的缓存）"
            onClick={ask}
          >
            {loading ? "AI 起名中…" : "✨ AI 起名"}
          </button>
          <span className="spacer" />
          <button className="toggle" onClick={onCancel}>取消</button>
          <button className="toggle on" onClick={() => onCommit(value)}>添加书签</button>
        </div>
        {loading && <div className="name-hint muted">第一次需要启动子代理，可能要几十秒；之后会快很多。你也可以直接手写名称。</div>}
        {ai.state === "error" && <div className="name-hint name-error">AI 起名失败：{ai.message}</div>}
      </div>
    </div>
  );
}
