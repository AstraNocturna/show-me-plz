/**
 * show-me-plz: opens a separate read-only window that mirrors the current pi session.
 *
 * Deliberately context-neutral: no tools, no prompt/context hooks, no session writes.
 * It only reads the session file path / leaf id and observes notification events (what the agent is
 * doing right now), and forwards them to the viewer over stdin.
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
  | { type: "host"; node: string; cli: string }
  | Activity;

/** Live agent state for the viewer's "working" indicator; entries only reach the file once complete. */
type Activity = { type: "activity"; state: "idle" | "thinking" | "writing" | "tool"; detail?: string };

// pi reloads the extension runtime on /new, /resume, /fork and /reload; keep the window across them.
const G = globalThis as typeof globalThis & { __showMePlz?: { child?: ChildProcess; activity?: Activity } };
const shared = (G.__showMePlz ??= {});

const DETAIL_ARGS = ["command", "path", "file_path", "query", "url", "pattern"];

function toolDetail(name: string, args: unknown): string {
  const a = (args ?? {}) as Record<string, unknown>;
  const key = DETAIL_ARGS.find((k) => typeof a[k] === "string");
  const value = key ? String(a[key]).split(/\r?\n/, 1)[0] : "";
  return value ? `${name}: ${value.length > 80 ? value.slice(0, 80) + "…" : value}` : name;
}

/** Sends the state only when it changes: message_update fires for every streamed token. */
function setActivity(state: Activity["state"], detail?: string): void {
  const prev = shared.activity;
  if (prev && prev.state === state && prev.detail === detail) return;
  shared.activity = { type: "activity", state, detail };
  send(shared.activity);
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

/** The session to show, plus how to start this same pi (the viewer forks it for side questions). */
function sendSession(ctx: ExtensionContext): void {
  send({ type: "host", node: process.execPath, cli: process.argv[1] ?? "" });
  send({
    type: "session",
    file: ctx.sessionManager.getSessionFile() ?? null,
    leaf: ctx.sessionManager.getLeafId() ?? null,
  });
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    sendSession(ctx);
  });

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
        sendSession(ctx);
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
      sendSession(ctx);
      if (shared.activity) send(shared.activity);
    },
  });
}
