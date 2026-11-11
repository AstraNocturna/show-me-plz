import { memo, useState } from "react";
import { copyText } from "../actions";
import { MarkButton } from "../marks/marks";
import { useRevealOpen } from "../reveal";
import { partKey, stepKey, userKey } from "../session/units";
import { toolIcon, toolSummary } from "../session/toolSummary";
import type { ImageContent } from "../session/types";
import type { Part, Step, ToolCallView, Turn } from "../session/viewModel";
import { Markdown } from "./Markdown";

export type Mode = "chat" | "full";

const MAX_RESULT_CHARS = 20000;

function Images({ images }: { images: ImageContent[] }) {
  if (!images.length) return null;
  return (
    <div className="images">
      {images.map((img, i) => (
        <img key={i} className="thumb" src={`data:${img.mimeType};base64,${img.data}`} alt="" />
      ))}
    </div>
  );
}

function formatTime(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleString("zh-CN", { hour12: false });
}

function answerText(turn: Turn): string {
  return turn.parts.flatMap((p) => (p.kind === "text" ? [p.text] : [])).join("\n\n");
}

function ToolArgs({ args }: { args: Record<string, unknown> }) {
  const entries = Object.entries(args);
  if (!entries.length) return null;
  return (
    <div className="tool-args">
      {entries.map(([k, v]) =>
        typeof v === "string" && v.includes("\n") ? (
          <div key={k}>
            <div className="arg-key">{k}</div>
            <pre className="plain">{v}</pre>
          </div>
        ) : (
          <div key={k} className="arg-inline">
            <span className="arg-key">{k}</span> <code>{typeof v === "string" ? v : JSON.stringify(v)}</code>
          </div>
        ),
      )}
    </div>
  );
}

function ToolStepView({ call, cwd, unit }: { call: ToolCallView; cwd?: string; unit: string }) {
  const [open, setOpen] = useState(false);
  useRevealOpen(unit, () => setOpen(true));
  const status = !call.result ? "running" : call.result.isError ? "error" : "ok";
  const text = call.result?.text ?? "";
  const shown = text.length > MAX_RESULT_CHARS ? text.slice(0, MAX_RESULT_CHARS) : text;
  return (
    <div className={`step tool ${status}`} data-unit={unit}>
      <button className="step-row" onClick={() => setOpen(!open)}>
        <span className="caret">{open ? "▾" : "▸"}</span>
        <span>{toolIcon(call.name)}</span>
        <span className="tool-name">{call.name}</span>
        <span className="tool-summary">{toolSummary(call, cwd)}</span>
        <span className="tool-status">{status === "running" ? "…" : status === "error" ? "✗" : ""}</span>
      </button>
      {open && (
        <div className="step-detail">
          <ToolArgs args={call.args} />
          {call.result && (
            <>
              <div className="detail-head">
                <span>结果</span>
                {text && <button className="copy-btn" onClick={() => void copyText(text)}>复制</button>}
              </div>
              {shown && <pre className="plain result">{shown}</pre>}
              {shown.length < text.length && (
                <div className="muted">…已截断，共 {text.length.toLocaleString()} 字符（复制可得完整内容）</div>
              )}
              <Images images={call.result.images} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function StepView({ step, cwd, unit }: { step: Step; cwd?: string; unit: string }) {
  if (step.kind === "tool") return <ToolStepView call={step.call} cwd={cwd} unit={unit} />;
  if (step.kind === "meta") return <div className="step meta muted">{step.text}</div>;
  return <ThinkingStepView text={step.text} cwd={cwd} unit={unit} />;
}

function ThinkingStepView({ text, cwd, unit }: { text: string; cwd?: string; unit: string }) {
  const [open, setOpen] = useState(false);
  useRevealOpen(unit, () => setOpen(true));
  return (
    <div className="step thinking" data-unit={unit}>
      <button className="step-row" onClick={() => setOpen(!open)}>
        <span className="caret">{open ? "▾" : "▸"}</span>
        <span>💭</span>
        <span className="tool-summary">{text.split("\n", 1)[0].slice(0, 120)}</span>
      </button>
      {open && <div className="step-detail"><Markdown source={text} cwd={cwd} /></div>}
    </div>
  );
}

function ProcessView({ steps, mode, cwd, unit }: { steps: Step[]; mode: Mode; cwd?: string; unit: string }) {
  const [override, setOverride] = useState<boolean | null>(null);
  useRevealOpen(unit, () => setOverride(true));
  const open = override ?? mode === "full";
  const calls = steps.flatMap((s) => (s.kind === "tool" ? [s.call] : []));
  const thinking = steps.filter((s) => s.kind === "thinking").length;
  const errors = calls.filter((c) => c.result?.isError).length;
  const preview = calls.slice(0, 4).map((c) => `${toolIcon(c.name)} ${toolSummary(c, cwd) || c.name}`);

  return (
    <div className={`process ${open ? "open" : ""}`} data-unit={unit}>
      <button className="process-head" onClick={() => setOverride(!open)}>
        <span className="caret">{open ? "▾" : "▸"}</span>
        <span className="process-counts">
          {calls.length > 0 && `${calls.length} 个工具`}
          {calls.length > 0 && thinking > 0 && " · "}
          {thinking > 0 && `${thinking} 段思考`}
          {errors > 0 && <span className="err"> · {errors} 个失败</span>}
        </span>
        {!open && <span className="process-preview">{preview.join("   ")}{calls.length > 4 ? "  …" : ""}</span>}
      </button>
      {open && (
        <div className="steps">
          {steps.map((s, i) => (
            <StepView key={i} step={s} cwd={cwd} unit={stepKey(unit, i)} />
          ))}
        </div>
      )}
    </div>
  );
}

function NoticeView({ title, text, cwd, unit }: { title: string; text: string; cwd?: string; unit: string }) {
  const [open, setOpen] = useState(false);
  useRevealOpen(unit, () => setOpen(true));
  return (
    <div className="notice" data-unit={unit}>
      <button className="process-head" onClick={() => setOpen(!open)}>
        <span className="caret">{open ? "▾" : "▸"}</span>
        <span>{title}</span>
      </button>
      {open && text && <div className="step-detail"><Markdown source={text} cwd={cwd} /></div>}
    </div>
  );
}

function PartView(props: { part: Part; mode: Mode; cwd?: string; turnId: string; unit: string }) {
  const { part, mode, cwd, turnId, unit } = props;
  switch (part.kind) {
    case "text":
      return (
        <div className="answer" data-unit={unit}>
          <div className="float-actions">
            <MarkButton unitKey={unit} turnId={turnId} preview={part.text} />
            <button className="copy-btn" onClick={() => void copyText(part.text)} title="复制原始 Markdown">
              复制
            </button>
          </div>
          <Markdown source={part.text} cwd={cwd} />
        </div>
      );
    case "process":
      return <ProcessView steps={part.steps} mode={mode} cwd={cwd} unit={unit} />;
    case "error":
      return <div className="error-box" data-unit={unit}>⚠ {part.text}</div>;
    case "notice":
      return <NoticeView title={part.title} text={part.text} cwd={cwd} unit={unit} />;
  }
}

export const TurnView = memo(function TurnView({ turn, mode, cwd }: { turn: Turn; mode: Mode; cwd?: string }) {
  return (
    <section className="turn" data-turn-id={turn.id}>
      {turn.user && (
        <div className="user" data-unit={userKey(turn.id)}>
          <header className="card-head">
            <MarkButton unitKey={userKey(turn.id)} turnId={turn.id} preview={turn.user.text} />
            <span className="who">你</span>
            <span className="muted">{formatTime(turn.user.timestamp)}</span>
            <span className="spacer" />
            <button className="copy-btn" onClick={() => void copyText(turn.user!.text)}>复制提问</button>
            <button className="copy-btn" onClick={() => void copyText(answerText(turn))}>复制回答</button>
          </header>
          <Markdown source={turn.user.text} cwd={cwd} user />
          <Images images={turn.user.images} />
        </div>
      )}
      <div className="agent">
        {turn.parts.map((p, i) => (
          <PartView key={i} part={p} mode={mode} cwd={cwd} turnId={turn.id} unit={partKey(turn.id, i)} />
        ))}
      </div>
    </section>
  );
});
