/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleParts, visibleSteps } from "./view.ts";
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
  user: { entryId: "t", text: "question", images: [] },
  parts: [
    { kind: "text", entryId: "a", text: "Let me look." },
    { kind: "process", entryId: "b", steps: [thinking, tool("c1")] },
    { kind: "text", entryId: "c", text: "Found it, fixing." },
    { kind: "process", entryId: "d", steps: [tool("c2"), meta] },
    { kind: "text", entryId: "e", text: "Done: the final answer." },
    { kind: "error", entryId: "f", text: "aborted" },
  ],
};

test("final mode keeps only the closing answer: text and errors after the last process block", () => {
  const parts = visibleParts(turn, { mode: "final", tools: true });
  assert.deepEqual(parts.map((p) => p.index), [4, 5], "original indexes are kept for unit keys");
});

test("final mode is empty while a turn is still working (it ends on a process block)", () => {
  const working: Turn = { ...turn, parts: turn.parts.slice(0, 4) };
  assert.deepEqual(visibleParts(working, { mode: "final", tools: true }), []);
  const noTools: Turn = { ...turn, parts: [{ kind: "text", entryId: "x", text: "Plain reply." }] };
  assert.deepEqual(visibleParts(noTools, { mode: "final", tools: true }).map((p) => p.index), [0]);
});

test("tools off hides tool steps and blocks left with nothing but meta lines", () => {
  const view = { mode: "chat" as const, tools: false };
  assert.deepEqual(visibleParts(turn, view).map((p) => p.index), [0, 1, 2, 4, 5], "block d had only a tool + meta");
  const steps = visibleSteps((turn.parts[1] as { steps: Step[] }).steps, view);
  assert.deepEqual(steps.map((s) => [s.item.kind, s.index]), [["thinking", 0]]);
  assert.equal(visibleParts(turn, { mode: "chat", tools: true }).length, 6);
});

test("search only covers what the view shows", () => {
  const re = makeMatcher("out c", { regex: false, caseSensitive: false }) as RegExp;
  assert.equal(findHits(buildUnits([turn], undefined, { mode: "full", tools: true }), re, "all").length, 2);
  assert.equal(findHits(buildUnits([turn], undefined, { mode: "full", tools: false }), re, "all").length, 0);
  const fix = makeMatcher("fixing", { regex: false, caseSensitive: false }) as RegExp;
  assert.equal(findHits(buildUnits([turn], undefined, { mode: "final", tools: true }), fix, "all").length, 0);
  assert.equal(findHits(buildUnits([turn], undefined, { mode: "chat", tools: true }), fix, "all").length, 1);
});
