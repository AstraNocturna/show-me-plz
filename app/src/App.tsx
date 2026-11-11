import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { handleContentClick, TOAST_EVENT } from "./actions";
import { Outline } from "./components/Outline";
import { TurnView, type Mode } from "./components/TurnView";
import { activeBranch } from "./session/branch";
import { useSession } from "./session/useSession";
import { buildTurns } from "./session/viewModel";
import "./styles.css";

const MODE_KEY = "smp.mode";

export default function App() {
  const session = useSession();
  const [mode, setMode] = useState<Mode>(() => (localStorage.getItem(MODE_KEY) === "full" ? "full" : "chat"));
  const [activeId, setActiveId] = useState<string>();
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [toastText, setToastText] = useState<string | null>(null);
  const timeline = useRef<HTMLElement>(null);

  const cwd = useMemo(() => {
    const header = session.entries.find((e) => e.type === "session");
    return typeof header?.cwd === "string" ? header.cwd : undefined;
  }, [session.entries]);
  const turns = useMemo(
    () => buildTurns(activeBranch(session.entries, session.leafOverride)),
    [session.entries, session.leafOverride],
  );

  useEffect(() => localStorage.setItem(MODE_KEY, mode), [mode]);

  useEffect(() => {
    let timer: number | undefined;
    const onToast = (e: Event) => {
      setToastText((e as CustomEvent<string>).detail);
      clearTimeout(timer);
      timer = window.setTimeout(() => setToastText(null), 1400);
    };
    window.addEventListener(TOAST_EVENT, onToast);
    return () => window.removeEventListener(TOAST_EVENT, onToast);
  }, []);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setLightbox(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  // Scroll spy: the active turn is the last one whose top is above the viewport's upper band.
  const onScroll = useCallback(() => {
    const el = timeline.current;
    if (!el) return;
    const limit = el.getBoundingClientRect().top + 80;
    let current: string | undefined;
    for (const node of el.querySelectorAll<HTMLElement>("[data-turn-id]")) {
      if (node.getBoundingClientRect().top <= limit) current = node.dataset.turnId;
      else break;
    }
    setActiveId(current ?? turns[0]?.id);
  }, [turns]);
  useEffect(onScroll, [onScroll]);

  const jump = useCallback((id: string) => {
    timeline.current?.querySelector(`[data-turn-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "start" });
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <span className="file" title={session.file ?? ""}>
          {session.file ? session.file.split(/[\\/]/).pop() : "未连接会话"}
        </span>
        <div className="segmented">
          <button className={mode === "chat" ? "on" : ""} onClick={() => setMode("chat")} title="只突出提问与回答，过程折叠">
            对话
          </button>
          <button className={mode === "full" ? "on" : ""} onClick={() => setMode("full")} title="展开思考与工具调用">
            完整
          </button>
        </div>
        <span className="status">{session.hostConnected ? "● 同步中" : "○ pi 已退出"}</span>
      </header>
      <div className="body">
        <Outline turns={turns} activeId={activeId} onJump={jump} />
        <main className="timeline" ref={timeline} onScroll={onScroll} onClick={(e) => handleContentClick(e, setLightbox)}>
          {turns.length === 0 && <div className="empty">暂无对话</div>}
          {turns.map((t) => (
            <TurnView key={`${mode}:${t.id}`} turn={t} mode={mode} cwd={cwd} />
          ))}
        </main>
      </div>
      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="" />
        </div>
      )}
      {toastText && <div className="toast">{toastText}</div>}
    </div>
  );
}
