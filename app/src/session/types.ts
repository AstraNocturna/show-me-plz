// Minimal shapes of pi session JSONL entries. See pi docs: session-format.md, message-types.md.
// Unknown fields and entry types are tolerated; only what the viewer reads is typed.

export interface TextContent { type: "text"; text: string }
export interface ImageContent { type: "image"; data: string; mimeType: string }
export interface ThinkingContent { type: "thinking"; thinking: string; redacted?: boolean }
export interface ToolCall { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> }
export type ContentBlock = TextContent | ImageContent | ThinkingContent | ToolCall;

export interface AgentMessage {
  role: string;
  content?: string | ContentBlock[];
  timestamp?: number;
  [key: string]: unknown;
}

export interface SessionEntry {
  type: string;
  id?: string;
  parentId?: string | null;
  timestamp?: string;
  message?: AgentMessage;
  [key: string]: unknown;
}

export interface Snapshot {
  generation: number;
  file: string | null;
  entries: SessionEntry[];
  leafOverride: string | null;
}
