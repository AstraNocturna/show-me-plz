import { createContext, useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { applyRecord, composePrompt, endReply, type QaMsg } from "./thread";

/** Opens the Q&A panel with `quote` attached to the next question; null outside the provider. */
export const AskContext = createContext<((quote: string) => void) | null>(null);

export type QaStatus = "idle" | "starting" | "ready" | "exited";

/** A question an extension in the subagent is waiting on (e.g. a permission prompt). */
export interface QaDialog {
  id: string;
  method: "select" | "confirm" | "input" | "editor";
  title: string;
  message?: string;
  options?: string[];
  prefill?: string;
}

/** What the user chose; sent back as the `extension_ui_response`. */
export type QaDialogAnswer = { value: string } | { confirmed: boolean } | { cancelled: true };

export interface QaApi {
  msgs: QaMsg[];
  status: QaStatus;
  model?: string;
  thinking?: string;
  /** How full the subagent's context is after its last reply. */
  context?: { tokens: number; window: number };
  /** A question is out and its reply has not settled. */
  busy: boolean;
  quote?: string;
  setQuote(q: string | undefined): void;
  /** Whether the subagent may modify files and run commands. Off by default and after every reset. */
  allowWrite: boolean;
  setAllowWrite(v: boolean): void;
  dialogs: QaDialog[];
  answer(id: string, a: QaDialogAnswer): void;
  send(question: string): Promise<void>;
  abort(): void;
  /** Ends the thread and discards its fork; the next question forks the session afresh. */
  reset(): void;
}

interface QaEvent { id: number; record: Record<string, any> }
interface QaExit { id: number; stderr: string }

const DIALOG_METHODS = new Set(["select", "confirm", "input", "editor"]);

/**
 * One side-question thread against a fork of `session`. The fork is taken at the first question, so it
 * sees the main conversation up to that moment.
 */
export function useQa(session: string | null, cwd?: string): QaApi {
  const [msgs, setMsgs] = useState<QaMsg[]>([]);
  const [status, setStatus] = useState<QaStatus>("idle");
  const [model, setModel] = useState<string>();
  const [thinking, setThinking] = useState<string>();
  const [window_, setWindow] = useState<number>();
  const [tokens, setTokens] = useState<number>();
  const [quote, setQuote] = useState<string>();
  const [allowWrite, setAllowWriteState] = useState(false);
  const [dialogs, setDialogs] = useState<QaDialog[]>([]);
  const idRef = useRef<number | null>(null);
  const allowRef = useRef(false);
  /** What the model was last told about its permission; it is told again when this differs. */
  const toldRef = useRef<boolean | null>(null);

  useEffect(() => {
    const unlisteners = Promise.all([
      listen<QaEvent>("qa-event", ({ payload }) => {
        if (payload.id !== idRef.current) return;
        const r = payload.record;
        if (r.type === "response" && r.command === "get_state") {
          const m = r.data?.model;
          if (m) {
            setModel(`${m.provider}/${m.id}`);
            setWindow(m.contextWindow);
          }
          setThinking(r.data?.thinkingLevel);
          return;
        }
        if (r.type === "extension_ui_request") {
          if (DIALOG_METHODS.has(r.method)) {
            setDialogs((d) => [
              ...d,
              { id: r.id, method: r.method, title: String(r.title ?? ""), message: r.message, options: r.options, prefill: r.prefill },
            ]);
          }
          return;
        }
        if (r.type === "message_end" && r.message?.role === "assistant" && r.message.usage) {
          const u = r.message.usage;
          setTokens((u.input ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0) + (u.output ?? 0));
        }
        if (r.type === "agent_settled") setDialogs([]);
        setMsgs((m) => applyRecord(m, r));
      }),
      listen<QaExit>("qa-exit", ({ payload }) => {
        if (payload.id !== idRef.current) return;
        idRef.current = null;
        setStatus("exited");
        setDialogs([]);
        // A stack trace ends in noise ("}", "Node.js v24"); the line naming the error says more.
        const lines = payload.stderr.split("\n").map((l) => l.trim()).filter(Boolean);
        const why = lines.find((l) => /error/i.test(l)) ?? lines.slice(-3).join("\n");
        setMsgs((m) => endReply(m, why ? `子代理已退出：${why}` : "子代理已退出"));
      }),
    ]);
    return () => void unlisteners.then((fns) => fns.forEach((f) => f()));
  }, []);

  const setAllowWrite = useCallback((v: boolean) => {
    allowRef.current = v;
    setAllowWriteState(v);
    const id = idRef.current;
    if (id !== null) void invoke("qa_set_write", { id, allow: v }).catch(() => {});
  }, []);

  const reset = useCallback(() => {
    const id = idRef.current;
    idRef.current = null;
    if (id !== null) void invoke("qa_stop", { id });
    setMsgs([]);
    setStatus("idle");
    setModel(undefined);
    setThinking(undefined);
    setWindow(undefined);
    setTokens(undefined);
    setDialogs([]);
    // Permission to modify things never carries over to a new thread.
    allowRef.current = false;
    setAllowWriteState(false);
    toldRef.current = null;
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
          await invoke("qa_start", { id, session, cwd, allowWrite: allowRef.current });
        } catch (err) {
          // Already gone (qa-exit reported it): nothing more to add.
          if (idRef.current !== id) return;
          idRef.current = null;
          setStatus("idle");
          return fail(err);
        }
        // The process may already have exited (qa-exit clears idRef) before this call returned.
        if (idRef.current !== id) return;
        setStatus("ready");
      }
      const write = allowRef.current;
      const message = composePrompt(question, q, { first, write, changed: toldRef.current !== write });
      toldRef.current = write;
      await invoke("qa_send", { id, command: { type: "prompt", message } }).catch(fail);
    },
    [session, cwd, quote],
  );

  const abort = useCallback(() => {
    const id = idRef.current;
    if (id !== null) void invoke("qa_send", { id, command: { type: "abort" } }).catch(() => {});
  }, []);

  const answer = useCallback((dialogId: string, a: QaDialogAnswer) => {
    const id = idRef.current;
    setDialogs((d) => d.filter((x) => x.id !== dialogId));
    if (id !== null) {
      void invoke("qa_send", { id, command: { type: "extension_ui_response", id: dialogId, ...a } }).catch(() => {});
    }
  }, []);

  const last = msgs[msgs.length - 1];
  const busy = status === "starting" || (!!last && (last.role === "user" || !last.done));
  const context = tokens !== undefined && window_ ? { tokens, window: window_ } : undefined;
  return { msgs, status, model, thinking, context, busy, quote, setQuote, allowWrite, setAllowWrite, dialogs, answer, send, abort, reset };
}
