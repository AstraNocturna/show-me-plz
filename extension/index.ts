/**
 * show-me-plz: opens a separate read-only window that mirrors the current pi session.
 *
 * Deliberately context-neutral: no tools, no prompt/context hooks, no session writes.
 * It only reads the session file path / leaf id and observes notification events (what the agent is
 * doing right now, and permission prompts waiting for the user), and forwards them to the viewer over stdin.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

type HostMessage =
  | { type: "session"; file: string | null; leaf: string | null }
  | { type: "leaf"; id: string | null }
  | { type: "focus" }
  | { type: "host"; node: string; cli: string; args: string[]; guard: string }
  | Status
  | Activity;

/** What the terminal footer shows (model, thinking level, context fill), for the viewer's status bar. */
type Status = {
  type: "status";
  model: { provider: string; id: string; name?: string } | null;
  thinking: string | null;
  context: { tokens: number | null; window: number; percent: number | null } | null;
};

/** Live agent state for the viewer's "working" indicator; entries only reach the file once complete. */
type Activity = { type: "activity"; state: "idle" | "thinking" | "writing" | "tool" | "waiting"; detail?: string };

// pi reloads the extension runtime on /new, /resume, /fork and /reload; keep the window across them.
type Shared = {
  child?: ChildProcess;
  /** Last activity sent to the viewer. */
  activity?: Activity;
  /** What the agent is doing, ignoring prompts. */
  base?: Activity;
  /** Permission prompts the user has not answered yet: requestId -> description. */
  pending?: Map<string, string>;
  unsubscribe?: Array<() => void>;
  status?: string;
};
const G = globalThis as typeof globalThis & { __showMePlz?: Shared };
const shared = (G.__showMePlz ??= {});

const DETAIL_ARGS = ["command", "path", "file_path", "query", "url", "pattern"];

function toolDetail(name: string, args: unknown): string {
  const a = (args ?? {}) as Record<string, unknown>;
  const key = DETAIL_ARGS.find((k) => typeof a[k] === "string");
  const value = key ? String(a[key]).split(/\r?\n/, 1)[0] : "";
  return value ? `${name}: ${value.length > 80 ? value.slice(0, 80) + "…" : value}` : name;
}

/** Sends the state only when it changes: message_update fires for every streamed token. */
function publishActivity(): void {
  const pending = shared.pending;
  let next: Activity = shared.base ?? { type: "activity", state: "idle" };
  if (pending && pending.size > 0) {
    const first = pending.values().next().value as string;
    next = { type: "activity", state: "waiting", detail: pending.size > 1 ? `${first}（共 ${pending.size} 项待确认）` : first };
  }
  const prev = shared.activity;
  if (prev && prev.state === next.state && prev.detail === next.detail) return;
  shared.activity = next;
  send(next);
}

function setActivity(state: Activity["state"], detail?: string): void {
  shared.base = { type: "activity", state, detail };
  if (state === "idle") shared.pending?.clear(); // nobody is waiting once the agent has settled
  publishActivity();
}

function oneLine(s: string, max = 80): string {
  const line = s.split(/\r?\n/, 1)[0];
  return line.length > max ? line.slice(0, max) + "…" : line;
}

/**
 * pi-permission-system announces the confirmation dialog on the shared event bus (documented
 * `permissions:ui_prompt`, answered by `permissions:decision`). That is the only way to learn the terminal
 * is waiting for the user; other extensions' dialogs are not observable.
 */
function watchPermissionPrompts(pi: ExtensionAPI): void {
  shared.unsubscribe?.forEach((off) => off());
  const pending = (shared.pending ??= new Map());
  shared.unsubscribe = [
    pi.events.on("permissions:ui_prompt", (raw) => {
      const e = (raw ?? {}) as { requestId?: unknown; surface?: unknown; value?: unknown; forwarding?: unknown };
      if (typeof e.requestId !== "string") return;
      const what = [typeof e.surface === "string" ? e.surface : "", typeof e.value === "string" ? oneLine(e.value) : ""]
        .filter(Boolean)
        .join(": ");
      pending.set(e.requestId, `${e.forwarding ? "子代理请求 " : ""}${what || "权限请求"}`);
      publishActivity();
    }),
    pi.events.on("permissions:decision", (raw) => {
      const id = (raw as { requestId?: unknown } | null)?.requestId;
      if (typeof id === "string" && pending.delete(id)) publishActivity();
    }),
  ];
}

function viewerExe(): string | undefined {
  if (process.env.SHOW_ME_PLZ_EXE) return process.env.SHOW_ME_PLZ_EXE;
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "app", "src-tauri", "target", "release", "show-me-plz.exe");
}

function alive(): ChildProcess | undefined {
  const c = shared.child;
  return c && c.exitCode === null && c.stdin?.writable ? c : undefined;
}

function send(msg: HostMessage): void {
  alive()?.stdin?.write(JSON.stringify(msg) + "\n");
}

// Launch flags that decide which tools, extensions, skills and prompt text a pi has. A fork must load the
// same ones, or its request prefix differs and the main session's prompt cache cannot be reused.
// Session-selecting flags (-c, --session, -p, positional messages ...) are deliberately not passed on.
const KEEP_FLAGS_WITH_VALUE = new Set([
  "-e", "--extension", "--skill", "--prompt-template", "--system-prompt", "--append-system-prompt",
  "-t", "--tools", "-xt", "--exclude-tools",
]);
const KEEP_FLAGS = new Set([
  "-ne", "--no-extensions", "--no-mcp", "-ns", "--no-skills", "-np", "--no-prompt-templates",
  "-nc", "--no-context-files", "-nbt", "--no-builtin-tools", "-nt", "--no-tools",
]);

function forkArgs(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const [flag] = a.split("=", 1);
    if (KEEP_FLAGS.has(a)) out.push(a);
    else if (KEEP_FLAGS_WITH_VALUE.has(flag)) {
      out.push(a);
      if (a === flag && i + 1 < argv.length) out.push(argv[++i]);
    }
  }
  return out;
}

/** Same footer data the terminal shows; sent only when it changes. */
function sendStatus(pi: ExtensionAPI, ctx: ExtensionContext): void {
  const m = ctx.model;
  const u = ctx.getContextUsage();
  const status: Status = {
    type: "status",
    model: m ? { provider: m.provider, id: m.id, name: m.name } : null,
    thinking: pi.getThinkingLevel() ?? null,
    context: m
      ? {
          tokens: u?.tokens ?? null,
          window: u?.contextWindow ?? m.contextWindow ?? 0,
          percent: u?.percent ?? null,
        }
      : null,
  };
  const key = JSON.stringify(status);
  if (shared.status === key) return;
  shared.status = key;
  send(status);
}

/** The session to show, plus how to start this same pi (the viewer forks it for side questions). */
function sendSession(pi: ExtensionAPI, ctx: ExtensionContext): void {
  send({
    type: "host",
    node: process.execPath,
    cli: process.argv[1] ?? "",
    args: forkArgs(process.argv.slice(2)),
    guard: join(dirname(fileURLToPath(import.meta.url)), "qa-guard.ts"),
  });
  send({
    type: "session",
    file: ctx.sessionManager.getSessionFile() ?? null,
    leaf: ctx.sessionManager.getLeafId() ?? null,
  });
  shared.status = undefined; // a new viewer has not seen the last status
  sendStatus(pi, ctx);
}

export default function (pi: ExtensionAPI) {
  watchPermissionPrompts(pi);

  pi.on("session_start", async (_event, ctx) => {
    shared.pending?.clear();
    publishActivity();
    sendSession(pi, ctx);
  });

  // Footer data: model, thinking level and context fill change at these points.
  pi.on("model_select", async (_event, ctx) => sendStatus(pi, ctx));
  pi.on("thinking_level_select", async (_event, ctx) => sendStatus(pi, ctx));
  pi.on("turn_end", async (_event, ctx) => sendStatus(pi, ctx));
  pi.on("session_compact", async (_event, ctx) => sendStatus(pi, ctx));

  pi.on("session_tree", async (event) => {
    send({ type: "leaf", id: event.newLeafId ?? null });
  });

  pi.on("agent_start", async () => setActivity("thinking"));
  pi.on("message_update", async (event) => {
    const t = event.assistantMessageEvent?.type ?? "";
    if (t.startsWith("thinking")) setActivity("thinking");
    else if (t.startsWith("text")) setActivity("writing");
    else if (t.startsWith("toolcall")) setActivity("tool");
  });
  pi.on("tool_execution_start", async (event) => setActivity("tool", toolDetail(event.toolName, event.args)));
  pi.on("tool_execution_end", async () => setActivity("thinking"));
  // agent_end is not final (retries, compaction, queued messages); agent_settled is.
  pi.on("agent_settled", async () => setActivity("idle"));

  pi.on("session_shutdown", async (event) => {
    // On quit, closing stdin tells the viewer pi is gone; the window stays open for reading.
    if (event.reason === "quit") alive()?.stdin?.end();
  });

  pi.registerCommand("viewer", {
    description: "打开/聚焦 show-me-plz 会话阅读窗口",
    handler: async (_args, ctx) => {
      if (alive()) {
        sendSession(pi, ctx);
        send({ type: "focus" });
        return;
      }
      const exe = viewerExe();
      if (!exe || !existsSync(exe)) {
        ctx.ui.notify(`show-me-plz: 找不到阅读器程序 ${exe ?? ""}（可设置 SHOW_ME_PLZ_EXE）`, "error");
        return;
      }
      // detached: otherwise libuv puts the child in a kill-on-close job and the window dies with pi.
      const child = spawn(exe, [], { stdio: ["pipe", "ignore", "ignore"], windowsHide: true, detached: true });
      child.on("error", (err) => ctx.ui.notify(`show-me-plz 启动失败: ${err.message}`, "error"));
      child.stdin?.on("error", () => {}); // viewer closed: ignore EPIPE
      child.unref();
      shared.child = child;
      sendSession(pi, ctx);
      if (shared.activity) send(shared.activity);
    },
  });
}
