// Run with: pnpm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { footerStats, formatCount, todosOf } from "./footer.ts";
import type { SessionEntry } from "./types.ts";

const assistant = (usage: object, extra: object = {}): SessionEntry => ({
  type: "message",
  message: { role: "assistant", provider: "p", model: "m", usage, ...extra },
});
const state = (tasks: object[]): SessionEntry => ({ type: "custom", customType: "rpiv-todo-state", data: { tasks, nextId: 9 } });

test("todos: the latest state snapshot wins and deleted tasks are dropped", () => {
  const todos = todosOf([
    state([{ id: 1, subject: "a", status: "pending" }]),
    { type: "message", message: { role: "user", content: "x" } },
    state([
      { id: 1, subject: "a", status: "completed" },
      { id: 2, subject: "b", status: "in_progress", activeForm: "doing b" },
      { id: 3, subject: "c", status: "deleted" },
    ]),
  ]);
  assert.deepEqual(todos.map((t) => [t.id, t.status]), [[1, "completed"], [2, "in_progress"]]);
});

test("todos: without snapshots, falls back to the last todo tool result; an unreadable snapshot is skipped", () => {
  const result = (tasks: unknown): SessionEntry => ({
    type: "message",
    message: { role: "toolResult", toolName: "todo", details: { tasks, nextId: 2 } },
  });
  assert.equal(todosOf([result([{ id: 1, subject: "a", status: "pending" }])]).length, 1);
  assert.equal(todosOf([state([{ id: 1, subject: "a", status: "pending" }]), state([{ nope: true }])]).length, 1);
  assert.deepEqual(todosOf([]), []);
});

test("footer stats: totals, latest cache hit, model and thinking follow the branch", () => {
  const s = footerStats([
    { type: "model_change", provider: "a", modelId: "one" },
    { type: "thinking_level_change", thinkingLevel: "high" },
    assistant({ input: 100, output: 10, cacheRead: 0, cacheWrite: 900, cost: { total: 0.5 } }),
    assistant({ input: 20, output: 30, cacheRead: 980, cacheWrite: 0, cost: { total: 0.25 } }, { model: "two" }),
  ]);
  assert.deepEqual(s.model, { provider: "p", id: "two" });
  assert.equal(s.thinking, "high");
  assert.equal(s.input, 120);
  assert.equal(s.cacheRead, 980);
  assert.equal(s.cost, 0.75);
  assert.equal(Math.round(s.lastCacheHit ?? -1), 98);
  assert.equal(s.contextTokens, 1030);
});

test("footer stats: a reply without usage does not reset the context figure", () => {
  const s = footerStats([assistant({ input: 5, output: 5, cacheRead: 90, cacheWrite: 5 }), assistant({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })]);
  assert.equal(s.contextTokens, 105);
});

test("formatCount", () => {
  assert.equal(formatCount(950), "950");
  assert.equal(formatCount(1234), "1.2k");
  assert.equal(formatCount(200_000), "200k");
  assert.equal(formatCount(1_500_000), "1.5M");
});
