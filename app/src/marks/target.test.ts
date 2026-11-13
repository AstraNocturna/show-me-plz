import assert from "node:assert/strict";
import { test } from "node:test";
import { markTarget } from "./target.ts";
import type { Turn } from "../session/viewModel.ts";

const turn = {
  id: "t1",
  user: { text: "问题", images: [] },
  parts: [
    { kind: "process", steps: [] },
    { kind: "text", text: "最终回答" },
  ],
} as unknown as Turn;

test("a prompt and a text part can be bookmarked; a process block cannot", () => {
  assert.deepEqual(markTarget([turn], "t1:u"), { key: "t1:u", turnId: "t1", preview: "问题" });
  assert.deepEqual(markTarget([turn], "t1:p1"), { key: "t1:p1", turnId: "t1", preview: "最终回答" });
  assert.equal(markTarget([turn], "t1:p0"), null);
  assert.equal(markTarget([turn], "t1:p1:s0"), null);
  assert.equal(markTarget([turn], "nope:u"), null);
});

test("turn ids containing regex characters are matched literally", () => {
  const odd = { ...turn, id: "a.b+c" } as Turn;
  assert.equal(markTarget([odd], "a.b+c:p1")?.preview, "最终回答");
  assert.equal(markTarget([odd], "aXb+c:p1"), null);
});
