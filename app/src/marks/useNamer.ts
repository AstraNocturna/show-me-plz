import { useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { cleanName, namePrompt } from "./naming";

/** A reply that has not settled after this long is given up on. */
const REPLY_TIMEOUT = 90_000;

interface Waiter {
  resolve(text: string): void;
  reject(err: Error): void;
  text: string;
}

interface Thread {
  id: number;
  ready: Promise<void>;
  /** Requests run one after another: the thread answers one prompt at a time. */
  chain: Promise<unknown>;
  waiter: Waiter | null;
}

/**
 * Suggests bookmark names with a hidden fork of the session. The fork is the same kind the Q&A panel
 * uses (same model, extensions and tools, read-only), so its requests share the main session's prompt
 * cache. It is started at the first suggestion and kept for later ones, which then cost little.
 */
export function useNamer(session: string | null, cwd?: string) {
  const thread = useRef<Thread | null>(null);

  const stop = useCallback(() => {
    const t = thread.current;
    thread.current = null;
    if (!t) return;
    t.waiter?.reject(new Error("已取消"));
    void invoke("qa_stop", { id: t.id }).catch(() => {});
  }, []);

  useEffect(() => {
    const unlisteners = Promise.all([
      listen<{ id: number; record: Record<string, any> }>("qa-event", ({ payload }) => {
        const t = thread.current;
        if (!t || payload.id !== t.id || !t.waiter) return;
        const r = payload.record;
        if (r.type === "message_end" && r.message?.role === "assistant" && Array.isArray(r.message.content)) {
          t.waiter.text = r.message.content.filter((c: any) => c.type === "text").map((c: any) => String(c.text ?? "")).join("");
        } else if (r.type === "agent_settled") {
          const w = t.waiter;
          t.waiter = null;
          w.resolve(w.text);
        }
      }),
      listen<{ id: number; stderr: string }>("qa-exit", ({ payload }) => {
        const t = thread.current;
        if (!t || payload.id !== t.id) return;
        thread.current = null;
        t.waiter?.reject(new Error("子代理已退出"));
      }),
    ]);
    return () => void unlisteners.then((fns) => fns.forEach((f) => f()));
  }, []);

  // A fork of the previous session would name things from the wrong conversation.
  useEffect(() => stop, [session, stop]);

  /** A short name for `text`; rejects with a readable reason. */
  const suggest = useCallback(
    async (kind: "user" | "agent", text: string): Promise<string> => {
      if (!session) throw new Error("没有可用的会话");
      let t = thread.current;
      if (!t) {
        const id = Date.now();
        const fresh: Thread = {
          id,
          ready: invoke<void>("qa_start", { id, session, cwd, allowWrite: false }).catch((e) => {
            if (thread.current === fresh) thread.current = null;
            throw new Error(String(e));
          }),
          chain: Promise.resolve(),
          waiter: null,
        };
        thread.current = t = fresh;
      }
      const th = t;
      const run = th.chain.then(async () => {
        await th.ready;
        if (thread.current !== th) throw new Error("已取消");
        const reply = new Promise<string>((resolve, reject) => {
          th.waiter = { resolve, reject, text: "" };
        });
        const timer = setTimeout(() => {
          th.waiter?.reject(new Error("AI 没有及时回复"));
          th.waiter = null;
          void invoke("qa_send", { id: th.id, command: { type: "abort" } }).catch(() => {});
        }, REPLY_TIMEOUT);
        try {
          await invoke("qa_send", { id: th.id, command: { type: "prompt", message: namePrompt(kind, text) } });
          return await reply;
        } finally {
          clearTimeout(timer);
        }
      });
      th.chain = run.catch(() => {});
      const name = cleanName(await run);
      if (!name) throw new Error("AI 没有给出名称");
      return name;
    },
    [session, cwd],
  );

  return { suggest };
}
