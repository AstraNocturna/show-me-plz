import { test } from "node:test";
import assert from "node:assert/strict";
import { displayPath, findRefsInText, parseFileRef, resolvePath } from "./fileRef.ts";

test("parseFileRef reads paths with line, range and column suffixes", () => {
  assert.deepEqual(parseFileRef("src/a.ts"), { path: "src/a.ts", line: undefined, endLine: undefined });
  assert.deepEqual(parseFileRef("src/a.ts:42"), { path: "src/a.ts", line: 42, endLine: undefined });
  assert.deepEqual(parseFileRef("src/a.ts:42-50"), { path: "src/a.ts", line: 42, endLine: 50 });
  assert.deepEqual(parseFileRef("src/a.ts:42:7"), { path: "src/a.ts", line: 42, endLine: undefined });
  assert.deepEqual(parseFileRef("src/a.ts#L3-L9"), { path: "src/a.ts", line: 3, endLine: 9 });
  assert.deepEqual(parseFileRef("D:\\my dir\\a.rs:7"), { path: "D:\\my dir\\a.rs", line: 7, endLine: undefined });
  assert.deepEqual(parseFileRef(".gitignore"), { path: ".gitignore", line: undefined, endLine: undefined });
  assert.equal(parseFileRef("D:\\develop\\proj")?.path, "D:\\develop\\proj", "absolute dirs are allowed");
});

test("parseFileRef rejects things that are not file references", () => {
  for (const s of ["https://x.com/a.js", "e.g.", "pnpm test", "foo", "a b.ts", "<a.ts>", "", "..", "src/"]) {
    assert.equal(parseFileRef(s), null, s);
  }
});

test("resolvePath joins relative paths and normalizes separators and dot segments", () => {
  assert.equal(resolvePath("src/a.ts", "D:\\proj"), "D:\\proj\\src\\a.ts");
  assert.equal(resolvePath("./src/../lib/b.ts", "D:/proj/"), "D:\\proj\\lib\\b.ts");
  assert.equal(resolvePath("C:/x/y.md", "D:\\proj"), "C:\\x\\y.md");
  assert.equal(resolvePath("/c/Users/a.txt"), "c:\\Users\\a.txt");
  assert.equal(resolvePath("src/a.ts"), null, "relative without base");
  assert.equal(resolvePath("~/a.ts", "D:\\proj"), null);
});

test("displayPath shows paths inside base as relative", () => {
  assert.equal(displayPath("D:\\Proj\\src\\a.ts", "d:/proj"), "src/a.ts");
  assert.equal(displayPath("C:\\other\\a.ts", "D:\\proj"), "C:/other/a.ts");
});

test("findRefsInText finds path-like spans in prose, not bare words or URL tails", () => {
  const text = "改了 src/App.tsx:12 和 D:\\p\\lib.rs，见 README.md 与 x/y。也看 app/src-tauri/src/marks.rs.";
  const found = findRefsInText(text).map((r) => text.slice(r.start, r.end));
  assert.deepEqual(found, ["src/App.tsx:12", "D:\\p\\lib.rs", "app/src-tauri/src/marks.rs"]);
  assert.equal(findRefsInText("see example.com/a/b.js")[0]?.ref.path, "example.com/a/b.js", "existence check filters these later");
  assert.deepEqual(findRefsInText("http://h/a/b.js"), [], "URL tails are skipped");
});
