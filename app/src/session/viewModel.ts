import { parseSkillMessage, promptLabel, type SkillInvocation } from "./skill.ts";
import type { ContentBlock, ImageContent, SessionEntry } from "./types";

export interface ToolResultView {
  text: string;
  images: ImageContent[];
  isError: boolean;
  /** Unified diff with line numbers that pi's edit tool reports in `details`. */
  diff?: string;
  firstChangedLine?: number;
}

export interface ToolCallView {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: ToolResultView;
}

/** A step inside a process block: the agent's working, as opposed to its answer. */
export type Step =
  | { kind: "thinking"; entryId: string; text: string }
  | { kind: "tool"; entryId: string; call: ToolCallView }
  | { kind: "meta"; entryId: string; text: string };

/**
 * One rendered piece of an agent response. Answer text breaks process blocks, so a response
 * reads as alternating answer text and (foldable) process. `entryId` is the source entry.
 */
export type Part =
  | { kind: "text"; entryId: string; text: string }
  | { kind: "process"; entryId: string; steps: Step[] }
  | { kind: "error"; entryId: string; text: string }
  | { kind: "notice"; entryId: string; title: string; text: string };

export interface UserView {
  entryId: string;
  /** What the user typed; for a skill invocation, only what followed the skill name. */
  text: string;
  /** Set when the message invokes a skill (`/skill:name`): the inlined SKILL.md is kept here, out of `text`. */
  skill?: Omit<SkillInvocation, "args">;
  /** One line standing for the prompt in lists, previews and copies (see `promptLabel`). */
  label: string;
  images: ImageContent[];
  timestamp?: string;
}

/** A user prompt plus everything that followed it until the next prompt. */
export interface Turn {
  id: string;
  /** Null for activity before the first user prompt. */
  user: UserView | null;
  parts: Part[];
}

function toBlocks(content: string | ContentBlock[] | undefined): ContentBlock[] {
  if (content == null) return [];
  return typeof content === "string" ? [{ type: "text", text: content }] : content;
}

function joinText(blocks: ContentBlock[]): string {
  return blocks
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join("\n\n")
    .trim();
}

function images(blocks: ContentBlock[]): ImageContent[] {
  return blocks.filter((b): b is ImageContent => b.type === "image");
}

export function buildTurns(branch: SessionEntry[]): Turn[] {
  const turns: Turn[] = [];
  const callsById = new Map<string, ToolCallView>();
  let cur: Turn | undefined;

  const turn = (): Turn => {
    if (!cur) {
      cur = { id: "start", user: null, parts: [] };
      turns.push(cur);
    }
    return cur;
  };
  const push = (part: Part) => turn().parts.push(part);
  const step = (st: Step) => {
    const parts = turn().parts;
    const last = parts[parts.length - 1];
    if (last?.kind === "process") last.steps.push(st);
    else parts.push({ kind: "process", entryId: st.entryId, steps: [st] });
  };

  for (const e of branch) {
    const id = e.id ?? "";
    switch (e.type) {
      case "message": {
        const m = e.message;
        if (!m) break;
        const blocks = toBlocks(m.content);
        if (m.role === "user") {
          const typed = joinText(blocks);
          const invoked = parseSkillMessage(typed);
          const text = invoked ? invoked.args : typed;
          const skill = invoked ? { name: invoked.name, location: invoked.location, body: invoked.body } : undefined;
          cur = {
            id,
            user: { entryId: id, text, skill, label: promptLabel(text, skill), images: images(blocks), timestamp: e.timestamp },
            parts: [],
          };
          turns.push(cur);
        } else if (m.role === "assistant") {
          for (const b of blocks) {
            if (b.type === "text" && b.text.trim()) push({ kind: "text", entryId: id, text: b.text });
            else if (b.type === "thinking" && b.thinking?.trim())
              step({ kind: "thinking", entryId: id, text: b.thinking });
            else if (b.type === "toolCall") {
              const call: ToolCallView = { id: b.id, name: b.name, args: b.arguments ?? {} };
              callsById.set(b.id, call);
              step({ kind: "tool", entryId: id, call });
            }
          }
          if (m.stopReason === "error" || m.stopReason === "aborted") {
            const msg = typeof m.errorMessage === "string" ? m.errorMessage : String(m.stopReason);
            push({ kind: "error", entryId: id, text: msg });
          }
        } else if (m.role === "toolResult") {
          const call = callsById.get(String(m.toolCallId));
          const details = (m.details ?? {}) as { diff?: unknown; firstChangedLine?: unknown };
          if (call)
            call.result = {
              text: joinText(blocks),
              images: images(blocks),
              isError: m.isError === true,
              diff: typeof details.diff === "string" ? details.diff : undefined,
              firstChangedLine: typeof details.firstChangedLine === "number" ? details.firstChangedLine : undefined,
            };
        } else if (m.role === "bashExecution") {
          // User-run `!cmd`: show it like a tool call so it folds the same way.
          const call: ToolCallView = {
            id,
            name: "!bash",
            args: { command: m.command },
            result: { text: String(m.output ?? ""), images: [], isError: (m.exitCode ?? 0) !== 0 },
          };
          step({ kind: "tool", entryId: id, call });
        } else if (m.role === "custom" && m.display) {
          push({ kind: "notice", entryId: id, title: String(m.customType ?? "custom"), text: joinText(blocks) });
        }
        // system and hidden custom messages are intentionally not shown.
        break;
      }
      case "compaction":
        push({ kind: "notice", entryId: id, title: "上下文已压缩", text: String(e.summary ?? "") });
        break;
      case "branch_summary":
        push({ kind: "notice", entryId: id, title: "分支摘要", text: String(e.summary ?? "") });
        break;
      case "custom_message":
        if (e.display) {
          const text = joinText(toBlocks(e.content as string | ContentBlock[] | undefined));
          push({ kind: "notice", entryId: id, title: String(e.customType ?? "custom"), text });
        }
        break;
      case "model_change":
        step({ kind: "meta", entryId: id, text: `模型 → ${e.provider}/${e.modelId}` });
        break;
      // thinking_level_change, custom, label, session_info, usage, context_edit: not shown.
    }
  }
  // Drop a leading pseudo-turn that holds only metadata.
  const first = turns[0];
  if (first?.user === null && first.parts.every((p) => p.kind === "process" && p.steps.every((s) => s.kind === "meta")))
    turns.shift();
  return turns;
}
