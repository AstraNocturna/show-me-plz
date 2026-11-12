/**
 * A side-question thread: what the user asked and how the forked pi answered, rebuilt from its RPC
 * event stream (see pi docs/json.md, "Reconstruct streaming messages").
 */

export type Block =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool"; name: string; args: Record<string, unknown> };

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  /** Prompt tokens written to the cache: the first question on a fork usually pays its whole context here. */
  cacheWrite: number;
  cost: number;
}

export type QaMsg =
  | { role: "user"; text: string; quote?: string }
  | {
      role: "assistant";
      blocks: Block[];
      /** Index in `blocks` where the assistant message currently streaming starts. */
      base: number;
      /** Tool running right now, e.g. "read". */
      running?: string;
      error?: string;
      usage?: Usage;
      done: boolean;
    };

export type Assistant = Extract<QaMsg, { role: "assistant" }>;

/** Loose shape of the RPC records this reducer reads. */
type Rec = Record<string, any>;

function contentToBlocks(content: unknown): Block[] {
  if (!Array.isArray(content)) return [];
  return content.flatMap((c: Rec): Block[] => {
    if (c.type === "text") return [{ kind: "text", text: String(c.text ?? "") }];
    if (c.type === "thinking") return [{ kind: "thinking", text: String(c.thinking ?? "") }];
    if (c.type === "toolCall") return [{ kind: "tool", name: String(c.name), args: c.arguments ?? {} }];
    return [];
  });
}

function usageOf(u: Rec | undefined): Usage | undefined {
  if (!u) return undefined;
  return { input: u.input ?? 0, output: u.output ?? 0, cacheRead: u.cacheRead ?? 0, cacheWrite: u.cacheWrite ?? 0, cost: u.cost?.total ?? 0 };
}

/** Applies `fn` to the open reply (adding one if needed). */
function withReply(msgs: QaMsg[], fn: (r: Assistant) => Assistant): QaMsg[] {
  const last = msgs[msgs.length - 1];
  if (last?.role === "assistant" && !last.done) return [...msgs.slice(0, -1), fn(last)];
  return [...msgs, fn({ role: "assistant", blocks: [], base: 0, done: false })];
}

function setBlock(r: Assistant, i: number, fn: (b: Block | undefined) => Block): Assistant {
  const blocks = [...r.blocks];
  blocks[i] = fn(blocks[i]);
  return { ...r, blocks };
}

/** Folds one RPC stdout record into the thread. Records it does not care about leave it unchanged. */
export function applyRecord(msgs: QaMsg[], rec: Rec): QaMsg[] {
  switch (rec.type) {
    case "agent_start":
      return withReply(msgs, (r) => r);
    case "message_start":
      if (rec.message?.role !== "assistant") return msgs;
      return withReply(msgs, (r) => ({ ...r, base: r.blocks.length }));
    case "message_update": {
      const ev: Rec = rec.assistantMessageEvent ?? {};
      return withReply(msgs, (r) => {
        const i = r.base + (ev.contentIndex ?? 0);
        switch (ev.type) {
          case "text_start":
            return setBlock(r, i, () => ({ kind: "text", text: "" }));
          case "thinking_start":
            return setBlock(r, i, () => ({ kind: "thinking", text: "" }));
          case "toolcall_start":
            return setBlock(r, i, () => ({ kind: "tool", name: String(ev.toolName ?? ""), args: {} }));
          case "text_delta":
          case "thinking_delta":
            return setBlock(r, i, (b) =>
              b && b.kind !== "tool" ? { ...b, text: b.text + String(ev.delta ?? "") } : { kind: ev.type === "text_delta" ? "text" : "thinking", text: String(ev.delta ?? "") },
            );
          case "text_end":
            return setBlock(r, i, () => ({ kind: "text", text: String(ev.content ?? "") }));
          case "thinking_end":
            return setBlock(r, i, () => ({ kind: "thinking", text: String(ev.content ?? "") }));
          case "toolcall_end":
            return setBlock(r, i, () => ({ kind: "tool", name: String(ev.toolCall?.name ?? ""), args: ev.toolCall?.arguments ?? {} }));
          default:
            return r;
        }
      });
    }
    case "message_end": {
      const m: Rec | undefined = rec.message;
      if (m?.role !== "assistant") return msgs;
      // The final message is authoritative: replace what was rebuilt from deltas.
      return withReply(msgs, (r) => ({
        ...r,
        blocks: [...r.blocks.slice(0, r.base), ...contentToBlocks(m.content)],
        error: m.stopReason === "error" ? String(m.errorMessage ?? "模型调用出错") : r.error,
        usage: sumUsage(r.usage, usageOf(m.usage)),
      }));
    }
    case "tool_execution_start":
      return withReply(msgs, (r) => ({ ...r, running: String(rec.toolName ?? "") }));
    case "tool_execution_end":
      return withReply(msgs, (r) => ({ ...r, running: undefined }));
    case "agent_settled":
      return withReply(msgs, (r) => ({ ...r, running: undefined, done: true, error: r.error ?? (rec.aborted ? "已停止" : undefined) }));
    case "response":
      if (rec.success !== false || rec.command !== "prompt") return msgs;
      return withReply(msgs, (r) => ({ ...r, done: true, error: String(rec.error ?? "提问被拒绝") }));
    default:
      return msgs;
  }
}

function sumUsage(a: Usage | undefined, b: Usage | undefined): Usage | undefined {
  if (!a || !b) return a ?? b;
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    cost: a.cost + b.cost,
  };
}

/** Marks an unfinished reply as ended, e.g. when the process exits. */
export function endReply(msgs: QaMsg[], error: string): QaMsg[] {
  const last = msgs[msgs.length - 1];
  // The question got no reply at all (e.g. the process died first): report the error as its reply.
  if (last?.role === "user") return [...msgs, { role: "assistant", blocks: [], base: 0, done: true, error }];
  if (last?.role !== "assistant" || last.done) return msgs;
  return [...msgs.slice(0, -1), { ...last, running: undefined, done: true, error: last.error ?? error }];
}

const PREAMBLE =
  "【旁路问答】这是从主会话分出来的一个独立问答，用户在阅读对话记录时想问一个问题。" +
  "只回答这个问题，不要继续或重做之前的任务，不要修改任何文件（你只有只读工具）。用中文回答。";

/** The prompt sent to the forked pi: preamble on a thread's first question, quoted selection if any. */
export function composePrompt(question: string, quote: string | undefined, first: boolean): string {
  const parts: string[] = [];
  if (first) parts.push(PREAMBLE);
  if (quote) parts.push("我选中的对话内容：\n" + quote.split(/\r?\n/).map((l) => "> " + l).join("\n"));
  parts.push((quote ? "我的问题：" : "") + question);
  return parts.join("\n\n");
}
