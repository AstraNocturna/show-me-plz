import { formatCount, type FooterStats, type Todo } from "../session/footer";
import type { GitInfo, HostStatus } from "../session/useHostStatus";

interface Props {
  status: HostStatus;
  stats: FooterStats;
  git: GitInfo | null;
  cwd?: string;
  todos: Todo[];
  onTodos(): void;
}

function Seg({ icon, text, title, warn }: { icon: string; text: string; title?: string; warn?: boolean }) {
  return (
    <span className={`seg ${warn ? "warn" : ""}`} title={title}>
      {icon} {text}
    </span>
  );
}

/** The terminal footer's key facts (model, thinking, folder, branch, context, tokens, cache, cost). */
export function StatusBar({ status, stats, git, cwd, todos, onTodos }: Props) {
  const model: { provider: string; id: string; name?: string } | null | undefined = status.model ?? stats.model;
  const ctx = status.context;
  const thinking = status.thinking ?? stats.thinking;
  const folder = cwd?.split(/[\\/]/).filter(Boolean).pop();
  const done = todos.filter((t) => t.status === "completed").length;

  // Prefer pi's own figure; without it fall back to the last request's size (window unknown).
  let context: { text: string; title: string; warn: boolean } | undefined;
  if (ctx && ctx.window > 0) {
    const pct = ctx.percent ?? (ctx.tokens !== null ? (ctx.tokens / ctx.window) * 100 : null);
    context = {
      text: `${pct === null ? "?" : pct.toFixed(1) + "%"}/${formatCount(ctx.window)}`,
      title: `上下文占用：${ctx.tokens === null ? "未知" : ctx.tokens.toLocaleString()} / ${ctx.window.toLocaleString()} tokens`,
      warn: pct !== null && pct >= 80,
    };
  } else if (stats.contextTokens) {
    context = { text: formatCount(stats.contextTokens), title: `最近一次请求约 ${stats.contextTokens.toLocaleString()} tokens`, warn: false };
  }

  const prompt = stats.input + stats.cacheRead + stats.cacheWrite;
  return (
    <footer className="statusbar">
      {model && (
        <Seg icon="🤖" text={model.name ?? model.id} title={`${model.provider}/${model.id}`} />
      )}
      {thinking && <Seg icon="🧠" text={thinking} title="思考等级" />}
      {folder && <Seg icon="📁" text={folder} title={cwd} />}
      {git?.branch && (
        <Seg
          icon="🌿"
          text={`${git.branch}${git.changed ? ` ~${git.changed}` : ""}`}
          title={git.changed ? `分支 ${git.branch}，${git.changed} 个文件有改动` : `分支 ${git.branch}`}
        />
      )}
      {context && <Seg icon="🪟" text={`ctx ${context.text}`} title={context.title} warn={context.warn} />}
      {prompt > 0 && (
        <Seg
          icon="🔢"
          text={`↑${formatCount(stats.input)} ↓${formatCount(stats.output)} R${formatCount(stats.cacheRead)} W${formatCount(stats.cacheWrite)}`}
          title={`本会话累计 tokens：新输入 ${stats.input.toLocaleString()}，输出 ${stats.output.toLocaleString()}，缓存读取 R ${stats.cacheRead.toLocaleString()}，缓存写入 W ${stats.cacheWrite.toLocaleString()}`}
        />
      )}
      {stats.lastCacheHit !== undefined && (
        <Seg icon="⚡" text={`缓存 ${Math.round(stats.lastCacheHit)}%`} title="最近一次请求的提示缓存命中率" />
      )}
      {stats.cost > 0 && <Seg icon="💲" text={stats.cost.toFixed(2)} title="本会话累计费用（按 pi 记录的用量）" />}
      <span className="spacer" />
      {todos.length > 0 && (
        <button className="seg todo-seg" onClick={onTodos} title="查看待办">
          ✓ 待办 {done}/{todos.length}
        </button>
      )}
    </footer>
  );
}
