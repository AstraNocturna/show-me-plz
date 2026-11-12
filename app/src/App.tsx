import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { handleContentClick, TOAST_EVENT } from "./actions";
import { FilePreview } from "./components/FilePreview";
import { Markers, type MarkerSpec } from "./components/Markers";
import { MarksPanel, sortMarks } from "./components/MarksPanel";
import { Outline } from "./components/Outline";
import { SearchBar } from "./components/SearchBar";
import { TurnView } from "./components/TurnView";
import { ViewMenu } from "./components/ViewMenu";
import { MARK_COLORS, MarksContext, useMarks, type Mark } from "./marks/marks";
import type { FileRef } from "./files/fileRef";
import { RevealContext, type Reveal } from "./reveal";
import { findUnitEl } from "./search/dom";
import { useSearch } from "./search/useSearch";
import { activeBranch } from "./session/branch";
import { userKey } from "./session/units";
import { DEFAULT_VIEW, type ViewOpts } from "./session/view";
import { isWorking, useActivity, type Activity } from "./session/useActivity";
import { useSession } from "./session/useSession";
import { buildTurns } from "./session/viewModel";
import { useSplit } from "./useSplit";
import { useWindowPrefs, type ThemePref } from "./useWindowPrefs";
import "./styles.css";

const VIEW_KEY = "smp.view";

function loadView(): ViewOpts {
  try {
    return { ...DEFAULT_VIEW, ...(JSON.parse(localStorage.getItem(VIEW_KEY) ?? "{}") as Partial<ViewOpts>) };
  } catch {
    return DEFAULT_VIEW;
  }
}

function activityLabel(a: Activity): string {
  if (a.state === "tool") return a.detail ? `正在调用 ${a.detail}` : "正在准备工具调用";
  return a.state === "writing" ? "AI 正在回复" : "AI 正在思考";
}
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
  ["Esc", "依次关闭图片、帮助、搜索、文件预览"],
  ["Ctrl+滚轮", "缩放（Ctrl+= / Ctrl+- 同样可用，Ctrl+0 还原）"],
  ["?", "显示/隐藏本帮助"],
];

const THEME_LABEL: Record<ThemePref, [string, string]> = {
  auto: ["◐", "主题：跟随系统"],
  light: ["☀", "主题：浅色"],
  dark: ["☾", "主题：深色"],
};

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
}

export default function App() {
  const session = useSession();
  const activity = useActivity();
  const [view, setView] = useState<ViewOpts>(loadView);
  const [tab, setTab] = useState<"outline" | "marks">("outline");
  const [activeId, setActiveId] = useState<string>();
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const [toastText, setToastText] = useState<string | null>(null);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [searchFocus, setSearchFocus] = useState(0);
  const [hasNew, setHasNew] = useState(false);
  const [preview, setPreview] = useState<FileRef | null>(null);
  const timeline = useRef<HTMLElement>(null);
  const workspace = useRef<HTMLDivElement>(null);
  const split = useSplit(workspace);
  const prefs = useWindowPrefs();

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
  const search = useSearch({ turns, cwd, view, timeline, activeTurnId: activeId, reveal: revealKey });

  useEffect(() => localStorage.setItem(VIEW_KEY, JSON.stringify(view)), [view]);

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
    const markInput = (e: Event) => {
      // Ctrl+wheel zooms; the relayout that follows must keep following the bottom.
      if (e instanceof WheelEvent && e.ctrlKey) return;
      lastInput.current = Date.now();
    };
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
  const stateRef = useRef({ turns, activeId, sortedMarks, turnOrder, search, lightbox, help, preview });
  stateRef.current = { turns, activeId, sortedMarks, turnOrder, search, lightbox, help, preview };

  // Navigation shared by the keyboard and the floating buttons; reads current state through stateRef.
  const nav = useMemo(() => {
    const s = () => stateRef.current;
    const idx = () => s().turns.findIndex((t) => t.id === s().activeId);
    const markPos = (m: Mark) => s().turnOrder.get(m.turnId) ?? -1;
    return {
      turn(delta: 1 | -1) {
        const t = s().turns[Math.min(Math.max(idx() + delta, 0), s().turns.length - 1)];
        if (t) jumpToTurn(t.id);
      },
      top() {
        if (timeline.current) timeline.current.scrollTop = 0;
      },
      bottom: scrollToBottom,
      toggleMark() {
        const t = s().turns[idx()];
        if (t?.user) marks.toggle({ key: userKey(t.id), turnId: t.id, preview: t.user.text.slice(0, 200) });
      },
      mark(dir: 1 | -1) {
        const i = idx();
        const list = dir > 0 ? s().sortedMarks : [...s().sortedMarks].reverse();
        const m = list.find((x) => (dir > 0 ? markPos(x) > i : markPos(x) >= 0 && markPos(x) < i));
        if (m) jumpToMark(m);
      },
    };
  }, [jumpToTurn, jumpToMark, scrollToBottom, marks.toggle]);

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
        else if (s.preview) setPreview(null);
        return;
      }
      if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;

      switch (e.key) {
        case "j":
          nav.turn(1);
          break;
        case "k":
          nav.turn(-1);
          break;
        case "g":
          nav.top();
          break;
        case "G":
          nav.bottom();
          break;
        case "m":
          nav.toggleMark();
          break;
        case "]":
          nav.mark(1);
          break;
        case "[":
          nav.mark(-1);
          break;
        case "'":
          setTab("marks");
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
  }, [nav]);

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
            <ViewMenu view={view} onChange={setView} />
            <div className="zoom">
              <button onClick={() => prefs.stepZoom(-1)} title="缩小（Ctrl+滚轮同样可用）">−</button>
              <button onClick={prefs.resetZoom} title="还原到 100%">{Math.round(prefs.zoom * 100)}%</button>
              <button onClick={() => prefs.stepZoom(1)} title="放大（Ctrl+滚轮同样可用）">+</button>
            </div>
            <button className="toggle" title={`${THEME_LABEL[prefs.theme][1]}（点击切换）`} onClick={prefs.cycleTheme}>
              {THEME_LABEL[prefs.theme][0]}
            </button>
            <button className={`toggle ${prefs.onTop ? "on" : ""}`} title={prefs.onTop ? "取消置顶" : "窗口置顶"} onClick={prefs.toggleOnTop}>
              📌
            </button>
            <button className="toggle" title="快捷键（可选，所有功能都有按钮）" onClick={() => setHelp(!help)}>⌨</button>
            <span className={`status ${isWorking(activity) ? "working" : ""}`}>
              {!session.hostConnected ? "○ pi 已退出" : isWorking(activity) ? "● AI 工作中" : "● 同步中"}
            </span>
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
            <div ref={workspace} className={`workspace ${split.dir}`}>
              <div className="main" style={preview ? { flex: `0 0 ${split.ratio * 100}%` } : undefined}>
                {search.open && <SearchBar s={search} focusNonce={searchFocus} />}
                <div className="timeline-wrap">
                  <main className="timeline" ref={timeline} onScroll={onScroll} onClick={(e) => handleContentClick(e, setLightbox, setPreview)}>
                    <div className="timeline-inner">
                      {turns.length === 0 && <div className="empty">暂无对话</div>}
                      {turns.map((t) => (
                        <TurnView key={`${view.expand}:${t.id}`} turn={t} view={view} cwd={cwd} />
                      ))}
                      {isWorking(activity) && (
                        <div className="activity" role="status">
                          <span className="dots"><i /><i /><i /></span>
                          <span className="activity-text">{activityLabel(activity)}</span>
                        </div>
                      )}
                    </div>
                  </main>
                  <Markers specs={markerSpecs} timeline={timeline} onJump={jumpToMark} />
                  <div className="nav-rail">
                    <button title="回到顶部" onClick={nav.top}>⤒</button>
                    <button title="上一个提问" onClick={() => nav.turn(-1)}>↑</button>
                    <button title="下一个提问" onClick={() => nav.turn(1)}>↓</button>
                    <button title="跳到底部" onClick={nav.bottom}>⤓</button>
                    {marks.marks.length > 0 && (
                      <>
                        <button className="mark-nav" title="上一个书签" onClick={() => nav.mark(-1)}>★↑</button>
                        <button className="mark-nav" title="下一个书签" onClick={() => nav.mark(1)}>★↓</button>
                      </>
                    )}
                  </div>
                  {hasNew && (
                    <button className="new-pill" onClick={scrollToBottom}>↓ 有新消息</button>
                  )}
                </div>
              </div>
              {preview && (
                <>
                  <div className="divider" onPointerDown={split.startDrag} title="拖动调整分屏比例" />
                  <FilePreview
                    target={preview}
                    cwd={cwd}
                    dir={split.dir}
                    onToggleDir={split.toggleDir}
                    onClose={() => setPreview(null)}
                    onFile={setPreview}
                    onImage={setLightbox}
                  />
                </>
              )}
            </div>
          </div>
          {help && (
            <div className="help" onClick={() => setHelp(false)}>
              <div className="help-card" onClick={(e) => e.stopPropagation()}>
                <div className="help-title">快捷键（可选，功能都有对应按钮）</div>
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
