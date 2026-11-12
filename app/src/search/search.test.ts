/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildUnits, findHits, makeMatcher } from "./search.ts";
import type { Turn } from "../session/viewModel.ts";

const turns: Turn[] = [
  {
    id: "t1",
    user: { entryId: "t1", text: "Fix the Parser bug", images: [] },
    parts: [
      {
        kind: "process",
        entryId: "a",
        steps: [
          { kind: "thinking", entryId: "a", text: "parser looks off" },
          {
            kind: "tool",
            entryId: "a",
            call: { id: "c", name: "read", args: { path: "src/parser.ts" }, result: { text: "export function parse", images: [], isError: false } },
          },
        ],
      },
      { kind: "text", entryId: "b", text: "Fixed the parser. Parser tests pass." },
    ],
  },
];

test("search covers folded thinking and tool output, with per-unit ordinals", () => {
  const re = makeMatcher("parser", { regex: false, caseSensitive: false }) as RegExp;
  const hits = findHits(buildUnits(turns), re, "all");
  assert.deepEqual(
    hits.map((h) => `${h.unitKey}#${h.ordinal}`),
    ["t1:u#0", "t1:p0:s0#0", "t1:p0:s1#0", "t1:p0:s1#1", "t1:p1#0", "t1:p1#1"],
  );
});

test("scope, case sensitivity and regex options narrow results", () => {
  const units = buildUnits(turns);
  const ci = makeMatcher("parser", { regex: false, caseSensitive: false }) as RegExp;
  assert.equal(findHits(units, ci, "answer").length, 2);
  assert.equal(findHits(units, ci, "user").length, 1);

  const cs = makeMatcher("Parser", { regex: false, caseSensitive: true }) as RegExp;
  assert.deepEqual(findHits(units, cs, "all").map((h) => h.unitKey), ["t1:u", "t1:p1"]);

  // Answer text: "Fixed the parser. Parser tests pass."
  const literal = makeMatcher("parser.", { regex: false, caseSensitive: false }) as RegExp;
  assert.equal(findHits(units, literal, "answer").length, 1, "plain mode: '.' is literal");
  const anyChar = makeMatcher("parser.", { regex: true, caseSensitive: false }) as RegExp;
  assert.equal(findHits(units, anyChar, "answer").length, 2, "regex mode: '.' matches any char");
  const rx = makeMatcher("pars(er|e)\\b", { regex: true, caseSensitive: false }) as RegExp;
  assert.equal(findHits(units, rx, "process").length, 4);
});

test("invalid regex reports an error and zero-width patterns do not hang", () => {
  assert.equal(typeof makeMatcher("(", { regex: true, caseSensitive: false }), "string");
  assert.equal(makeMatcher("", { regex: true, caseSensitive: false }), null);
  const zw = makeMatcher("(?=p)", { regex: true, caseSensitive: false }) as RegExp;
  assert.equal(findHits(buildUnits(turns), zw, "all").length, 0);
});

test("an edit with a diff is searched as shown: the diff, not its raw edits JSON", () => {
  const edit: Turn = {
    id: "t2",
    user: null,
    parts: [
      {
        kind: "process",
        entryId: "e",
        steps: [
          {
            kind: "tool",
            entryId: "e",
            call: {
              id: "c2",
              name: "edit",
              args: { path: "a.ts", edits: [{ oldText: "let x = 1", newText: "let x = 2" }] },
              result: { text: "Successfully replaced 1 block(s)", images: [], isError: false, diff: "-3 let x = 1\n+3 let x = 2" },
            },
          },
        ],
      },
    ],
  };
  const units = buildUnits([edit]);
  const count = (q: string) => findHits(units, makeMatcher(q, { regex: false, caseSensitive: true }) as RegExp, "all").length;
  assert.equal(count("oldText"), 0, "raw edits JSON is not displayed, so it must not be searchable");
  assert.equal(count("let x"), 2, "each changed line is found once, via the diff");
  assert.equal(count("a.ts"), 2, "path stays visible (summary + path arg)");
});
