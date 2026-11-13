/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { activeBranch } from "./branch.ts";
import { buildTurns } from "./viewModel.ts";
import type { ContentBlock, SessionEntry } from "./types.ts";

let n = 0;
function chain(...msgs: Array<Partial<SessionEntry> & { type: string }>): SessionEntry[] {
  let parent: string | null = null;
  return msgs.map((m) => {
    const id = m.id ?? `e${++n}`;
    const e = { parentId: parent, ...m, id } as SessionEntry;
    parent = id;
    return e;
  });
}
const user = (text: string) => ({ type: "message", message: { role: "user", content: text } });
const assistant = (content: unknown[], extra: Record<string, unknown> = {}) => ({
  type: "message",
  message: { role: "assistant", content: content as ContentBlock[], ...extra },
});
const result = (toolCallId: string, text: string, isError = false) => ({
  type: "message",
  message: { role: "toolResult", toolCallId, toolName: "x", content: [{ type: "text" as const, text }], isError },
});

test("thinking and tool calls fold into process blocks split by answer text; results pair by id", () => {
  const turns = buildTurns(
    chain(
      { type: "model_change", provider: "p", modelId: "m" },
      { type: "message", message: { role: "system", content: "prompt" } },
      user("fix it"),
      assistant([{ type: "thinking", thinking: "hmm" }, { type: "text", text: "Looking." }, { type: "toolCall", id: "c1", name: "read", arguments: { path: "a.ts" } }]),
      result("c1", "file body"),
      assistant([{ type: "thinking", thinking: "again" }, { type: "toolCall", id: "c2", name: "bash", arguments: { command: "ls" } }]),
      result("c2", "boom", true),
      assistant([{ type: "text", text: "Done." }]),
    ),
  );

  assert.equal(turns.length, 1, "leading metadata-only pseudo-turn and system message are dropped");
  const [t] = turns;
  assert.equal(t.user?.text, "fix it");
  assert.deepEqual(t.parts.map((p) => p.kind), ["process", "text", "process", "text"]);
  const proc = t.parts[2];
  assert.ok(proc.kind === "process");
  assert.deepEqual(proc.steps.map((s) => s.kind), ["tool", "thinking", "tool"], "one block across assistant messages");
  const calls = proc.steps.flatMap((s) => (s.kind === "tool" ? [s.call] : []));
  assert.deepEqual(calls.map((c) => [c.name, c.result?.text, c.result?.isError]), [
    ["read", "file body", false],
    ["bash", "boom", true],
  ]);
});

test("each user prompt starts a new turn; errors and compactions are surfaced", () => {
  const turns = buildTurns(
    chain(
      user("one"),
      assistant([], { stopReason: "error", errorMessage: "rate limited" }),
      { type: "compaction", summary: "earlier stuff" },
      user("two"),
      assistant([{ type: "text", text: "ok" }]),
    ),
  );
  assert.deepEqual(turns.map((t) => t.user?.text), ["one", "two"]);
  assert.deepEqual(turns[0].parts.map((p) => p.kind), ["error", "notice"]);
});

test("active branch follows the leaf, ignoring abandoned siblings and the header", () => {
  const header = { type: "session", id: "uuid-header" } as SessionEntry;
  const [a, b] = chain(user("root"), user("abandoned"));
  const c = { ...user("current"), id: "c", parentId: a.id } as SessionEntry;
  const entries = [header, a, b, c];

  assert.deepEqual(activeBranch(entries, null).map((e) => e.id), [a.id, "c"], "last entry is the default leaf");
  assert.deepEqual(activeBranch(entries, b.id!).map((e) => e.id), [a.id, b.id], "host leaf override wins");
});

test("tool summaries show cwd-relative paths and the key argument", async () => {
  const { toolSummary } = await import("./toolSummary.ts");
  const call = (name: string, args: Record<string, unknown>) => ({ id: "x", name, args });
  assert.equal(toolSummary(call("read", { path: "D:\\proj\\src\\a.ts" }), "d:/proj"), "src/a.ts");
  assert.equal(toolSummary(call("read", { path: "C:/other/b.ts" }), "D:\\proj"), "C:/other/b.ts");
  assert.equal(toolSummary(call("bash", { command: "pnpm test\necho done" })), "pnpm test");
});

test("a skill invocation keeps the SKILL.md out of the prompt text and labels the turn /skill:name", () => {
  const body = "References are relative to C:\s.\n\n# REA";
  const entries = [
    { type: "message", id: "u1", message: { role: "user", content: `<skill name="rea" location="C:\s\SKILL.md">\n${body}\n</skill>\n\n看这个 exe` } },
    { type: "message", id: "u2", message: { role: "user", content: `<skill name="rea" location="C:\s\SKILL.md">\n${body}\n</skill>` } },
  ] as SessionEntry[];
  const [a, b] = buildTurns(entries);
  assert.equal(a.user?.text, "看这个 exe");
  assert.equal(a.user?.label, "/skill:rea 看这个 exe");
  assert.equal(a.user?.skill?.body, body);
  assert.equal(b.user?.text, "");
  assert.equal(b.user?.label, "/skill:rea");
});
