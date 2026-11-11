/**
 * show-me-plz: opens a separate read-only window that mirrors the current pi session.
 *
 * Deliberately context-neutral: no tools, no prompt/context hooks, no session writes.
 * It only reads the session file path / leaf id and forwards them to the viewer over stdin.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

type HostMessage =
  | { type: "session"; file: string | null; leaf: string | null }
  | { type: "leaf"; id: string | null }
  | { type: "focus" };

// pi reloads the extension runtime on /new, /resume, /fork and /reload; keep the window across them.
const G = globalThis as typeof globalThis & { __showMePlz?: { child?: ChildProcess } };
const shared = (G.__showMePlz ??= {});

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

function sessionMessage(ctx: ExtensionContext): HostMessage {
  return {
    type: "session",
    file: ctx.sessionManager.getSessionFile() ?? null,
    leaf: ctx.sessionManager.getLeafId() ?? null,
  };
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    send(sessionMessage(ctx));
  });

  pi.on("session_tree", async (event) => {
    send({ type: "leaf", id: event.newLeafId ?? null });
  });

  pi.on("session_shutdown", async (event) => {
    // On quit, closing stdin tells the viewer pi is gone; the window stays open for reading.
    if (event.reason === "quit") alive()?.stdin?.end();
  });

  pi.registerCommand("viewer", {
    description: "打开/聚焦 show-me-plz 会话阅读窗口",
    handler: async (_args, ctx) => {
      if (alive()) {
        send(sessionMessage(ctx));
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
      send(sessionMessage(ctx));
    },
  });
}
