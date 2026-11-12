import { createContext, useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { applyRecord, composePrompt, endReply, type QaMsg } from "./thread";

/** Opens the Q&A panel with `quote` attached to the next question; null outside the provider. */
export const AskContext = createContext<((quote: string) => void) | null>(null);

export type QaStatus = "idle" | "starting" | "ready" | "exited";

export interface QaApi {
  msgs: QaMsg[];
  status: QaStatus;
  model?: string;
  /** A question is out and its reply has not settled. */
  busy: boolean;
  quote?: string;
  setQuote(q: string | undefined): void;
  send(question: string): Promise<void>;
  abort(): void;
  /** Ends the thread and discards its fork; the next question forks the session afresh. */
  reset(): void;
}

interface QaEvent { id: number; record: Record<string, any> }
interface QaExit { id: number; stderr: string }

/**
 * One side-question thread against a fork of `session`. The fork is taken at the first question, so it
 * sees the main conversation up to that moment.
 */
export function useQa(session: string | null, cwd?: string): QaApi {
  const [msgs, setMsgs] = useState<QaMsg[]>([]);
  const [status, setStatus] = useState<QaStatus>("idle");
  const [model, setModel] = useState<string>();
  const [quote, setQuote] = useState<string>();
  const idRef = useRef<number | null>(null);

  useEffect(() => {
    const unlisteners = Promise.all([
      listen<QaEvent>("qa-event", ({ payload }) => {
        if (payload.id !== idRef.current) return;
        const r = payload.record;
        if (r.type === "response" && r.command === "get_state") {
          const m = r.data?.model;
          if (m) setModel(`${m.provider}/${m.id}`);
          return;
        }
        setMsgs((m) => applyRecord(m, r));
      }),
      listen<QaExit>("qa-exit", ({ payload }) => {
        if (payload.id !== idRef.current) return;
        idRef.current = null;
        setStatus("exited");
        // A stack trace ends in noise ("}", "Node.js v24"); the line naming the error says more.
        const lines = payload.stderr.split("\n").map((l) => l.trim()).filter(Boolean);
        const why = lines.find((l) => /error/i.test(l)) ?? lines.slice(-3).join("\n");
        setMsgs((m) => endReply(m, why ? `子代理已退出：${why}` : "子代理已退出"));
      }),
    ]);
    return () => void unlisteners.then((fns) => fns.forEach((f) => f()));
  }, []);

  const reset = useCallback(() => {
    const id = idRef.current;
    idRef.current = null;
    if (id !== null) void invoke("qa_stop", { id });
    setMsgs([]);
    setStatus("idle");
    setModel(undefined);
  }, []);

  // A fork of the previous session would answer about the wrong conversation.
  useEffect(() => reset, [session, reset]);

  const send = useCallback(
    async (question: string) => {
      const fail = (err: unknown) =>
        setMsgs((m) => endReply([...m, { role: "assistant", blocks: [], base: 0, done: false }], String(err)));
      const q = quote;
      setQuote(undefined);
      setMsgs((m) => [...m, { role: "user", text: question, quote: q }]);
      let id = idRef.current;
      const first = id === null;
      if (first) {
        if (!session) return fail("没有可用的会话");
        id = Date.now();
        idRef.current = id;
        setStatus("starting");
        try {
          await invoke("qa_start", { id, session, cwd });
        } catch (err) {
          idRef.current = null;
          setStatus("idle");
          return fail(err);
        }
        // The process may already have exited (qa-exit clears idRef) before this call returned.
        if (idRef.current !== id) return;
        setStatus("ready");
        void invoke("qa_send", { id, command: { type: "get_state" } }).catch(() => {});
      }
      const message = composePrompt(question, q, first);
      await invoke("qa_send", { id, command: { type: "prompt", message } }).catch(fail);
    },
    [session, cwd, quote],
  );

  const abort = useCallback(() => {
    const id = idRef.current;
    if (id !== null) void invoke("qa_send", { id, command: { type: "abort" } }).catch(() => {});
  }, []);

  const last = msgs[msgs.length - 1];
  const busy = status === "starting" || (!!last && (last.role === "user" || !last.done));
  return { msgs, status, model, busy, quote, setQuote, send, abort, reset };
}
