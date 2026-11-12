import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Markdown } from "./Markdown";
import { toolIcon, toolSummary } from "../session/toolSummary";
import type { QaApi } from "../qa/useQa";
import type { Assistant, Block, Usage } from "../qa/thread";

const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

function UsageLine({ u }: { u: Usage }) {
  return (
    <div className="qa-usage muted">
      输入 {fmt(u.input + u.cacheRead + u.cacheWrite)} tokens{u.cacheRead > 0 && `（缓存命中 ${fmt(u.cacheRead)}）`} · 输出 {fmt(u.output)}
      {u.cost > 0 && ` · $${u.cost.toFixed(3)}`}
    </div>
  );
}

function BlockView({ b, cwd }: { b: Block; cwd?: string }) {
  if (b.kind === "text") return b.text ? <Markdown source={b.text} cwd={cwd} /> : null;
  if (b.kind === "thinking")
    return b.text ? (
      <details className="qa-thinking">
        <summary>思考</summary>
        <div className="qa-thinking-text">{b.text}</div>
      </details>
    ) : null;
  return (
    <div className="qa-tool">
      {toolIcon(b.name)} {toolSummary({ id: "", name: b.name, args: b.args }, cwd)}
    </div>
  );
}

function ReplyView({ r, cwd }: { r: Assistant; cwd?: string }) {
  const writing = r.blocks.some((b) => b.kind === "text" && b.text);
  return (
    <div className="qa-reply">
      {r.blocks.map((b, i) => (
        <BlockView key={i} b={b} cwd={cwd} />
      ))}
      {!r.done && (
        <div className="activity qa-working">
          <span className="dots"><i /><i /><i /></span>
          <span className="activity-text">{r.running ? `正在调用 ${r.running}` : writing ? "正在回复" : "正在思考"}</span>
        </div>
      )}
      {r.error && <div className="error-box">⚠ {r.error}</div>}
      {r.done && r.usage && <UsageLine u={r.usage} />}
    </div>
  );
}

interface Props {
  qa: QaApi;
  cwd?: string;
  /** Changes when the panel should take focus (e.g. after 问 was clicked). */
  focusNonce: number;
  onClose(): void;
  onContentClick(e: React.MouseEvent): void;
}

/** Side questions against a fork of the session; lives in the split pane next to the conversation. */
export function QaPanel({ qa, cwd, focusNonce, onClose, onContentClick }: Props) {
  const [input, setInput] = useState("");
  const log = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => box.current?.focus(), [focusNonce]);
  useLayoutEffect(() => {
    if (stick.current && log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [qa.msgs]);

  const exited = qa.status === "exited";
  const submit = () => {
    const q = input.trim();
    if (!q || qa.busy || exited) return;
    setInput("");
    stick.current = true;
    void qa.send(q);
  };

  return (
    <div className="qa">
      <header className="qa-head">
        <span className="qa-title">问答</span>
        <span className="muted qa-model">{qa.model ?? (qa.status === "starting" ? "正在启动子代理…" : "")}</span>
        <span className="spacer" />
        {(qa.msgs.length > 0 || exited) && (
          <button className="copy-btn" onClick={qa.reset} title="结束当前问答，下次提问重新从主会话分出（会包含主会话的最新内容）">
            新问答
          </button>
        )}
        <button className="toggle" onClick={onClose} title="收起面板（问答保留，关闭窗口才会丢弃）">✕</button>
      </header>
      <div
        className="qa-log"
        ref={log}
        onClick={onContentClick}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {qa.msgs.length === 0 && (
          <div className="panel-empty">
            在对话里选中一段文字点「问 AI」，或点回答右上角的「问」，再输入问题。
            <br />
            子代理继承主会话到提问时为止的全部上下文，只能读文件，不会影响主 agent。
          </div>
        )}
        {qa.msgs.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="qa-user">
              {m.quote && <blockquote className="qa-quote">{m.quote}</blockquote>}
              <div className="qa-question">{m.text}</div>
            </div>
          ) : (
            <ReplyView key={i} r={m} cwd={cwd} />
          ),
        )}
      </div>
      <div className="qa-compose">
        {qa.quote && (
          <div className="qa-pending-quote">
            <span className="qa-pending-text">引用：{qa.quote}</span>
            <button className="toggle" onClick={() => qa.setQuote(undefined)} title="去掉引用">✕</button>
          </div>
        )}
        <div className="qa-input-row">
          <textarea
            ref={box}
            rows={3}
            value={input}
            disabled={exited}
            placeholder={exited ? "子代理已退出，点「新问答」重新开始" : "输入问题，Enter 发送，Shift+Enter 换行"}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
          />
          {qa.busy && qa.status !== "starting" ? (
            <button className="qa-send stop" onClick={qa.abort}>停止</button>
          ) : (
            <button className="qa-send" onClick={submit} disabled={!input.trim() || qa.busy || exited}>发送</button>
          )}
        </div>
        <div className="muted qa-hint">每次提问都会把主会话的完整上下文发给模型，长会话费用较高。关闭窗口即丢弃问答。</div>
      </div>
    </div>
  );
}
