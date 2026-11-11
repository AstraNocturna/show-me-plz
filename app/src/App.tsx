import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { handleContentClick, TOAST_EVENT } from "./actions";
import { Markers, type MarkerSpec } from "./components/Markers";
import { MarksPanel, sortMarks } from "./components/MarksPanel";
import { Outline } from "./components/Outline";
import { SearchBar } from "./components/SearchBar";
import { TurnView, type Mode } from "./components/TurnView";
import { MARK_COLORS, MarksContext, useMarks, type Mark } from "./marks/marks";
import { RevealContext, type Reveal } from "./reveal";
import { findUnitEl } from "./search/dom";
import { useSearch } from "./search/useSearch";
import { activeBranch } from "./session/branch";
import { userKey } from "./session/units";
import { useSession } from "./session/useSession";
import { buildTurns } from "./session/viewModel";
import "./styles.css";

const MODE_KEY = "smp.mode";
const BOTTOM_SLACK = 60;
const INPUT_GRACE_MS = 800;
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

const SHORTCUTS: Array<[string, string]> = [
  ["Ctrl+F", "搜索（Enter / Shift+Enter 切换结果，F3 同样可用）"],
  ["j / k", "下一个 / 上一个提问"],
  ["g / G", "回到顶部 / 跳到底部"],
  ["m", "给当前提问加/取消书签"],
  ["] / [", "下一个 / 上一个书签"],
  ["'", "打开书签面板"],
  ["v", "切换 对话 / 完整 模式"],
  ["Esc", "关闭搜索、图片、帮助"],
  ["?", "显示/隐藏本帮助"],
];

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
}

export default function App() {
  const session = useSession();
  const [mode, setMode] = useState<Mode>(() => (localStorage.getItem(MODE_KEY) === "full" ? "full" : "chat"));
  const [tab, setTab] = useState<"outline" | "marks">("outline");
  const [activeId, setActiveId] = useState<string>();
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const [toastText, setToastText] = useState<string | null>(null);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [searchFocus, setSearchFocus] = useState(0);
  const [hasNew, setHasNew] = useState(false);
  const timeline = useRef<HTMLElement>(null);

  const header = useMemo(() => session.entries.find((e) => e.type === "session"), [session.entries]);
  const cwd = typeof header?.cwd === "string" ? header.cwd : undefined;
  const sessionId = typeof header?.id === "string" ? header.id : undefined;
  const turns = useMemo(
    () => buildTurns(activeBranch(session.entries, session.leafOverride)),
    [session.entries, session.leafOverride],
  );
  const turnOrder = useMemo(() => new Map(turns.map((t, i) => [t.id, i])), [turns]);

  const revealKey = useCallback((key: string) => setReveal((r) => ({ key, nonce: (r?.nonce ?? 0) + 1 })), []);
  const marks = useMarks(sessionId);
  const sortedMarks = useMemo(() => sortMarks(marks.marks, turnOrder), [marks.marks, turnOrder]);
  const markedTurns = useMemo(() => new Set(marks.marks.map((m) => m.turnId)), [marks.marks]);
  const search = useSearch({ turns, cwd, timeline, activeTurnId: activeId, reveal: revealKey });

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

  // ---- Scrolling: scroll spy, follow-bottom, jumps ----
  // Following the bottom: only user input can leave it. Layout growth (lazy content-visibility rendering,
  // async highlighting, images) and scroll anchoring move scrollTop too, but must not count as leaving.
  const atBottom = useRef(true);
  const lastInput = useRef(0);
  const userActive = () => Date.now() - lastInput.current < INPUT_GRACE_MS;
  const onScroll = useCallback(() => {
    const el = timeline.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_SLACK;
    if (bottom) {
      atBottom.current = true;
      setHasNew(false);
    } else if (userActive()) {
      atBottom.current = false;
    }
    const limit = el.getBoundingClientRect().top + 80;
    let current: string | undefined;
    for (const node of el.querySelectorAll<HTMLElement>("[data-turn-id]")) {
      if (node.getBoundingClientRect().top <= limit) current = node.dataset.turnId;
      else break;
    }
    setActiveId(current ?? turns[0]?.id);
  }, [turns]);
  useEffect(onScroll, [onScroll]);

  const scrollToBottom = useCallback(() => {
    const el = timeline.current;
    if (!el) return;
    lastInput.current = 0; // an explicit "go to bottom" keeps following through the growth that follows
    el.scrollTop = el.scrollHeight;
    atBottom.current = true;
    setHasNew(false);
  }, []);
  useEffect(() => {
    const el = timeline.current;
    const inner = el?.firstElementChild;
    if (!el || !inner) return;
    const ro = new ResizeObserver(() => {
      if (!atBottom.current) return;
      // The user just expanded something: let it grow in place instead of yanking to the bottom.
      if (userActive()) atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_SLACK;
      else el.scrollTop = el.scrollHeight;
    });
    ro.observe(inner);
    const markInput = () => (lastInput.current = Date.now());
    const events = ["wheel", "mousedown", "keydown", "touchstart"] as const;
    events.forEach((ev) => window.addEventListener(ev, markInput, { capture: true }));
    return () => {
      ro.disconnect();
      events.forEach((ev) => window.removeEventListener(ev, markInput, { capture: true }));
    };
  }, []);

  // Open at the latest message; on a new session too.
  useLayoutEffect(() => {
    atBottom.current = true;
  }, [session.generation]);
  const entryCount = session.entries.length;
  const prevCount = useRef(0);
  useLayoutEffect(() => {
    const grew = entryCount > prevCount.current;
    prevCount.current = entryCount;
    if (!grew) return;
    if (atBottom.current) scrollToBottom();
    else setHasNew(true);
  }, [entryCount, scrollToBottom]);

  const jumpToTurn = useCallback((id: string) => {
    timeline.current?.querySelector(`[data-turn-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "start" });
  }, []);

  const jumpToMark = useCallback(
    (m: Pick<Mark, "key" | "turnId">) => {
      revealKey(m.key);
      void nextFrame()
        .then(nextFrame)
        .then(() => {
          const root = timeline.current;
          const el = root && findUnitEl(root, m.key, m.turnId);
          if (!root || !el) return;
          root.scrollTop += el.getBoundingClientRect().top - root.getBoundingClientRect().top - 8;
          el.classList.remove("flash");
          void el.offsetWidth; // restart the animation
          el.classList.add("flash");
        });
    },
    [revealKey],
  );

  // ---- Keyboard ----
  const stateRef = useRef({ turns, activeId, sortedMarks, turnOrder, search, lightbox, help });
  stateRef.current = { turns, activeId, sortedMarks, turnOrder, search, lightbox, help };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = stateRef.current;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        s.search.setOpen(true);
        setSearchFocus((n) => n + 1);
        return;
      }
      if (e.key === "F3") {
        e.preventDefault();
        if (e.shiftKey) s.search.prev();
        else s.search.next();
        return;
      }
      if (e.key === "Escape") {
        if (s.lightbox) setLightbox(null);
        else if (s.help) setHelp(false);
        else if (s.search.open) s.search.setOpen(false);
        return;
      }
      if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;

      const idx = s.turns.findIndex((t) => t.id === s.activeId);
      const go = (i: number) => s.turns[i] && jumpToTurn(s.turns[i].id);
      const markPos = (m: Mark) => s.turnOrder.get(m.turnId) ?? -1;
      switch (e.key) {
        case "j":
          go(Math.min(idx + 1, s.turns.length - 1));
          break;
        case "k":
          go(Math.max(idx - 1, 0));
          break;
        case "g":
          if (timeline.current) timeline.current.scrollTop = 0;
          break;
        case "G":
          scrollToBottom();
          break;
        case "m": {
          const t = s.turns[idx];
          if (t?.user) marks.toggle({ key: userKey(t.id), turnId: t.id, preview: t.user.text.slice(0, 200) });
          break;
        }
        case "]": {
          const m = s.sortedMarks.find((x) => markPos(x) > idx);
          if (m) jumpToMark(m);
          break;
        }
        case "[": {
          const m = [...s.sortedMarks].reverse().find((x) => markPos(x) >= 0 && markPos(x) < idx);
          if (m) jumpToMark(m);
          break;
        }
        case "'":
          setTab("marks");
          break;
        case "v":
          setMode((m) => (m === "chat" ? "full" : "chat"));
          break;
        case "?":
          setHelp((h) => !h);
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [jumpToTurn, jumpToMark, scrollToBottom, marks.toggle]);

  // ---- Scrollbar markers ----
  const markerSpecs = useMemo<MarkerSpec[]>(() => {
    const out: MarkerSpec[] = sortedMarks.map((m) => ({ key: m.key, turnId: m.turnId, color: MARK_COLORS[m.color], kind: "mark" }));
    if (search.open) {
      const seen = new Set<string>();
      for (const h of search.hits) {
        if (seen.has(h.unitKey)) continue;
        seen.add(h.unitKey);
        out.push({ key: h.unitKey, turnId: h.turnId, color: "var(--hit)", kind: "hit" });
      }
    }
    return out;
  }, [sortedMarks, search.open, search.hits]);

  return (
    <MarksContext.Provider value={marks}>
      <RevealContext.Provider value={reveal}>
        <div className="app">
          <header className="topbar">
            <span className="file" title={session.file ?? ""}>
              {session.file ? session.file.split(/[\\/]/).pop() : "未连接会话"}
            </span>
            <button
              className="toggle"
              title="搜索 (Ctrl+F)"
              onClick={() => {
                search.setOpen(true);
                setSearchFocus((n) => n + 1);
              }}
            >
              🔍
            </button>
            <div className="segmented">
              <button className={mode === "chat" ? "on" : ""} onClick={() => setMode("chat")} title="只突出提问与回答，过程折叠 (v)">
                对话
              </button>
              <button className={mode === "full" ? "on" : ""} onClick={() => setMode("full")} title="展开思考与工具调用 (v)">
                完整
              </button>
            </div>
            <button className="toggle" title="快捷键 (?)" onClick={() => setHelp(!help)}>⌨</button>
            <span className="status">{session.hostConnected ? "● 同步中" : "○ pi 已退出"}</span>
          </header>
          <div className="body">
            <aside className="sidebar">
              <div className="tabs">
                <button className={tab === "outline" ? "on" : ""} onClick={() => setTab("outline")}>
                  提问 · {turns.filter((t) => t.user).length}
                </button>
                <button className={tab === "marks" ? "on" : ""} onClick={() => setTab("marks")}>
                  书签 · {marks.marks.length}
                </button>
              </div>
              {tab === "outline" ? (
                <Outline turns={turns} activeId={activeId} marked={markedTurns} onJump={jumpToTurn} />
              ) : (
                <MarksPanel api={marks} sorted={sortedMarks} turnOrder={turnOrder} onJump={jumpToMark} />
              )}
            </aside>
            <div className="main">
              {search.open && <SearchBar s={search} focusNonce={searchFocus} />}
              <div className="timeline-wrap">
                <main className="timeline" ref={timeline} onScroll={onScroll} onClick={(e) => handleContentClick(e, setLightbox)}>
                  <div className="timeline-inner">
                    {turns.length === 0 && <div className="empty">暂无对话</div>}
                    {turns.map((t) => (
                      <TurnView key={`${mode}:${t.id}`} turn={t} mode={mode} cwd={cwd} />
                    ))}
                  </div>
                </main>
                <Markers specs={markerSpecs} timeline={timeline} onJump={jumpToMark} />
                {hasNew && (
                  <button className="new-pill" onClick={scrollToBottom}>↓ 有新消息</button>
                )}
              </div>
            </div>
          </div>
          {help && (
            <div className="help" onClick={() => setHelp(false)}>
              <div className="help-card" onClick={(e) => e.stopPropagation()}>
                <div className="help-title">快捷键</div>
                {SHORTCUTS.map(([k, d]) => (
                  <div key={k} className="help-row"><kbd>{k}</kbd><span>{d}</span></div>
                ))}
              </div>
            </div>
          )}
          {lightbox && (
            <div className="lightbox" onClick={() => setLightbox(null)}>
              <img src={lightbox} alt="" />
            </div>
          )}
          {toastText && <div className="toast">{toastText}</div>}
        </div>
      </RevealContext.Provider>
    </MarksContext.Provider>
  );
}
