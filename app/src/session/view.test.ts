/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_VIEW, visibleParts, visibleSteps } from "./view.ts";
import { buildUnits, findHits, makeMatcher } from "../search/search.ts";
import type { Step, Turn } from "./viewModel.ts";

const tool = (id: string): Step => ({
  kind: "tool",
  entryId: id,
  call: { id, name: "bash", args: { command: `echo ${id}` }, result: { text: `out ${id}`, images: [], isError: false } },
});
const thinking: Step = { kind: "thinking", entryId: "th", text: "let me think" };
const meta: Step = { kind: "meta", entryId: "m", text: "模型 → x/y" };

const turn: Turn = {
  id: "t",
  user: { entryId: "t", text: "question", label: "question", images: [] },
  parts: [
    { kind: "text", entryId: "a", text: "Let me look." },
    { kind: "process", entryId: "b", steps: [thinking, tool("c1")] },
    { kind: "text", entryId: "c", text: "Found it, fixing." },
    { kind: "process", entryId: "d", steps: [tool("c2")] },
    { kind: "process", entryId: "g", steps: [meta] },
    { kind: "text", entryId: "e", text: "Done: the final answer." },
    { kind: "error", entryId: "f", text: "aborted" },
  ],
};
const indexes = (v: typeof DEFAULT_VIEW, t: Turn = turn) => visibleParts(t, v).map((p) => p.index);

test("default view shows everything except blocks holding only meta lines", () => {
  assert.deepEqual(indexes(DEFAULT_VIEW), [0, 1, 2, 3, 5, 6]);
});

test("without interim text and process, only the closing answer remains (original indexes kept)", () => {
  assert.deepEqual(indexes({ interim: false, process: false, expand: false }), [5, 6]);
});

test("the closing answer is empty while a turn is still working (it ends on a process block)", () => {
  const working: Turn = { ...turn, parts: turn.parts.slice(0, 4) };
  assert.deepEqual(indexes({ interim: false, process: false, expand: false }, working), []);
  const plain: Turn = { ...turn, parts: [{ kind: "text", entryId: "x", text: "Plain reply." }] };
  assert.deepEqual(indexes({ interim: false, process: false, expand: false }, plain), [0]);
});

test("hiding the process hides thinking and tools together; interim text stays", () => {
  assert.deepEqual(indexes({ interim: true, process: false, expand: false }), [0, 2, 5, 6]);
  assert.deepEqual(visibleSteps([thinking, tool("x")], { ...DEFAULT_VIEW, process: false }), []);
  assert.deepEqual(indexes({ interim: false, process: true, expand: false }), [1, 3, 5, 6], "process without interim text");
});

test("search only covers what the view shows", () => {
  const count = (q: string, v: typeof DEFAULT_VIEW) =>
    findHits(buildUnits([turn], undefined, v), makeMatcher(q, { regex: false, caseSensitive: false }) as RegExp, "all").length;
  assert.equal(count("out c", DEFAULT_VIEW), 2);
  assert.equal(count("let me think", DEFAULT_VIEW), 1);
  assert.equal(count("out c", { ...DEFAULT_VIEW, process: false }), 0);
  assert.equal(count("let me think", { ...DEFAULT_VIEW, process: false }), 0);
  assert.equal(count("fixing", { ...DEFAULT_VIEW, interim: false }), 0);
  assert.equal(count("final answer", { interim: false, process: false, expand: false }), 1);
});
