import { useMemo } from "react";
import { activeBranch } from "./session/branch";
import { useSession } from "./session/useSession";
import type { ContentBlock, SessionEntry } from "./session/types";
import "./styles.css";

function blocks(content: string | ContentBlock[] | undefined): ContentBlock[] {
  if (content == null) return [];
  return typeof content === "string" ? [{ type: "text", text: content }] : content;
}

// M0: plain rendering only. Markdown, folding and noise filtering arrive in M1.
function EntryView({ entry }: { entry: SessionEntry }) {
  const msg = entry.message;
  if (entry.type !== "message" || !msg) return null;
  if (msg.role !== "user" && msg.role !== "assistant") return null;

  const parts = blocks(msg.content);
  const text = parts.filter((b) => b.type === "text").map((b) => b.text).join("\n\n");
  const tools = parts.filter((b) => b.type === "toolCall");
  if (!text && tools.length === 0) return null;

  return (
    <article className={`msg msg-${msg.role}`}>
      <header className="msg-role">{msg.role === "user" ? "你" : "Agent"}</header>
      {text && <div className="msg-text">{text}</div>}
      {tools.map((t) => (
        <div key={t.id} className="tool-chip">⚙ {t.name}</div>
      ))}
    </article>
  );
}

export default function App() {
  const session = useSession();
  const branch = useMemo(
    () => activeBranch(session.entries, session.leafOverride),
    [session.entries, session.leafOverride],
  );

  return (
    <div className="app">
      <header className="topbar">
        <span className="file" title={session.file ?? ""}>
          {session.file ? session.file.split(/[\\/]/).pop() : "未连接会话"}
        </span>
        <span className="status">
          {branch.length} 条 · {session.hostConnected ? "同步中" : "pi 已退出"}
        </span>
      </header>
      <main className="timeline">
        {branch.map((e, i) => (
          <EntryView key={e.id ?? i} entry={e} />
        ))}
      </main>
    </div>
  );
}
