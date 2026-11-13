import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Markdown } from "./Markdown";
import { toolIcon, toolSummary } from "../session/toolSummary";
import type { QaApi, QaDialog, QaDialogAnswer } from "../qa/useQa";
import type { Assistant, Block, Usage } from "../qa/thread";

const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

function UsageLine({ u }: { u: Usage }) {
  const prompt = u.input + u.cacheRead + u.cacheWrite;
  const hit = prompt > 0 ? Math.round((u.cacheRead / prompt) * 100) : 0;
  return (
    <div className="qa-usage muted">
      输入 {fmt(prompt)} tokens{u.cacheRead > 0 && `（缓存命中 ${fmt(u.cacheRead)}，${hit}%）`} · 输出 {fmt(u.output)}
      {u.cost > 0 && ` · $${u.cost.toFixed(3)}`}
    </div>
  );
}

/** A question an extension in the subagent is blocked on, e.g. a permission prompt. */
function DialogCard({ d, onAnswer }: { d: QaDialog; onAnswer(a: QaDialogAnswer): void }) {
  const [text, setText] = useState(d.prefill ?? "");
  return (
    <div className="qa-dialog">
      <div className="qa-dialog-title">子代理在等你回答：{d.title}</div>
      {d.message && <div className="qa-dialog-msg">{d.message}</div>}
      {(d.method === "input" || d.method === "editor") && (
        <textarea rows={d.method === "editor" ? 5 : 1} value={text} onChange={(e) => setText(e.target.value)} />
      )}
      <div className="qa-dialog-actions">
        {d.method === "select" &&
          (d.options ?? []).map((o) => (
            <button key={o} className="copy-btn" onClick={() => onAnswer({ value: o })}>{o}</button>
          ))}
        {d.method === "confirm" && (
          <>
            <button className="copy-btn" onClick={() => onAnswer({ confirmed: true })}>允许</button>
            <button className="copy-btn" onClick={() => onAnswer({ confirmed: false })}>拒绝</button>
          </>
        )}
        {(d.method === "input" || d.method === "editor") && (
          <button className="copy-btn" onClick={() => onAnswer({ value: text })}>确定</button>
        )}
        <button className="copy-btn" onClick={() => onAnswer({ cancelled: true })}>取消</button>
      </div>
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
        <div className="qa-head-row">
          <span className="qa-title">问答</span>
          <span className="spacer" />
          {(qa.msgs.length > 0 || exited) && (
            <button className="copy-btn" onClick={qa.reset} title="结束当前问答，下次提问重新从主会话分出（会包含主会话的最新内容）">
              新问答
            </button>
          )}
          <button className="toggle" onClick={onClose} title="收起面板（问答保留，关闭窗口才会丢弃）">✕</button>
        </div>
        <div className="qa-info">
          <span className="muted qa-model">{qa.model ?? (qa.status === "starting" ? "正在启动子代理（加载扩展，可能要几十秒）…" : "")}</span>
          {qa.thinking && <span className="muted qa-model" title="思考等级">🧠 {qa.thinking}</span>}
          {qa.context && (
            <span className="muted qa-model" title={`子代理上下文：${qa.context.tokens} / ${qa.context.window} tokens`}>
              🪟 {((qa.context.tokens / qa.context.window) * 100).toFixed(1)}%/{fmt(qa.context.window)}
            </span>
          )}
        </div>
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
            子代理继承主会话到提问时为止的全部上下文，默认只能读文件，不会影响主 agent。
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
        {qa.dialogs.map((d) => (
          <DialogCard key={d.id} d={d} onAnswer={(a) => qa.answer(d.id, a)} />
        ))}
        {qa.allowWrite && (
          <div className="qa-warn">⚠ 子代理现在可以修改文件、执行命令，主会话不会知道它做了什么。</div>
        )}
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
        <div className="qa-foot">
          <button
            className={`toggle ${qa.allowWrite ? "on danger" : ""}`}
            onClick={() => qa.setAllowWrite(!qa.allowWrite)}
            disabled={exited}
            title={
              qa.allowWrite
                ? "点击恢复只读：之后子代理只能用 read/grep/find/ls"
                : "默认只读。打开后子代理可以修改文件、执行命令，改动不会写回主会话"
            }
          >
            ✎ 允许子代理修改{qa.allowWrite ? "：开" : ""}
          </button>
          <span className="muted qa-hint">与主会话共用提示缓存，通常只有新增内容计费。关闭窗口即丢弃问答。</span>
        </div>
      </div>
    </div>
  );
}
