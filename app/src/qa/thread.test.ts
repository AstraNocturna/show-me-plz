/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyRecord, composePrompt, endReply, type Assistant, type QaMsg } from "./thread.ts";

const run = (records: object[], start: QaMsg[] = [{ role: "user", text: "q" }]) => records.reduce(applyRecord, start);
const reply = (msgs: QaMsg[]) => msgs[msgs.length - 1] as Assistant;
const upd = (e: object) => ({ type: "message_update", assistantMessageEvent: e });

test("streams deltas into blocks, across a tool loop, and settles", () => {
  const msgs = run([
    { type: "response", command: "prompt", success: true },
    { type: "agent_start" },
    { type: "message_start", message: { role: "assistant" } },
    upd({ type: "thinking_start", contentIndex: 0 }),
    upd({ type: "thinking_delta", contentIndex: 0, delta: "hmm" }),
    upd({ type: "toolcall_start", contentIndex: 1, toolName: "read" }),
    upd({ type: "toolcall_end", contentIndex: 1, toolCall: { name: "read", arguments: { path: "a.ts" } } }),
    { type: "tool_execution_start", toolName: "read" },
  ]);
  assert.equal(reply(msgs).running, "read");
  assert.deepEqual(reply(msgs).blocks, [
    { kind: "thinking", text: "hmm" },
    { kind: "tool", name: "read", args: { path: "a.ts" } },
  ]);

  const done = run(
    [
      { type: "tool_execution_end", toolName: "read" },
      { type: "message_start", message: { role: "toolResult" } },
      { type: "message_start", message: { role: "assistant" } },
      upd({ type: "text_start", contentIndex: 0 }),
      upd({ type: "text_delta", contentIndex: 0, delta: "Ans" }),
      upd({ type: "text_delta", contentIndex: 0, delta: "wer" }),
      { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Answer." }], usage: { input: 10, output: 2, cacheRead: 5, cacheWrite: 7, cost: { total: 0.01 } } } },
      { type: "agent_settled", aborted: false },
    ],
    msgs,
  );
  const r = reply(done);
  assert.equal(done.length, 2, "one question, one reply");
  assert.deepEqual(r.blocks.map((b) => b.kind), ["thinking", "tool", "text"], "second message appends after the first");
  assert.deepEqual(r.blocks[2], { kind: "text", text: "Answer." }, "message_end replaces the rebuilt text");
  assert.equal(r.done, true);
  assert.equal(r.running, undefined);
  assert.equal(r.error, undefined);
  assert.deepEqual(r.usage, { input: 10, output: 2, cacheRead: 5, cacheWrite: 7, cost: 0.01 });
});

test("provider errors, aborts, rejected prompts and dead processes end the reply with a reason", () => {
  const err = run([
    { type: "agent_start" },
    { type: "message_end", message: { role: "assistant", content: [], stopReason: "error", errorMessage: "overloaded" } },
    { type: "agent_settled" },
  ]);
  assert.equal(reply(err).error, "overloaded");
  assert.equal(reply(run([{ type: "agent_start" }, { type: "agent_settled", aborted: true }])).error, "已停止");
  const rejected = run([{ type: "response", command: "prompt", success: false, error: "busy" }]);
  assert.deepEqual([reply(rejected).done, reply(rejected).error], [true, "busy"]);
  const dead = endReply(run([{ type: "agent_start" }]), "子代理已退出");
  assert.deepEqual([reply(dead).done, reply(dead).error], [true, "子代理已退出"]);
  const early = endReply([{ role: "user", text: "q" }], "子代理已退出：boom");
  assert.deepEqual([early.length, reply(early).done, reply(early).error], [2, true, "子代理已退出：boom"], "dying before any reply still answers the question");
  assert.equal(run([{ type: "response", command: "get_state", success: true }]).length, 1, "other responses are ignored");
});

test("the first question carries the side-question preamble; quotes are block-quoted", () => {
  const first = composePrompt("why?", "line 1\nline 2", true);
  assert.match(first, /^【旁路问答】/);
  assert.match(first, /> line 1\n> line 2/);
  assert.match(first, /我的问题：why\?$/);
  assert.equal(composePrompt("and then?", undefined, false), "and then?");
});
