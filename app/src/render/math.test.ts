import assert from "node:assert/strict";
import test from "node:test";
import { renderMarkdown } from "./markdown.ts";

const html = (s: string) => renderMarkdown(s, {});
const texOf = (h: string) => [...h.matchAll(/class="math( display)?" data-tex="([^"]*)"/g)].map((m) => [m[2], !!m[1]]);

test("math: $…$, \\(…\\), $$…$$ and \\[…\\] become math spans", () => {
  assert.deepEqual(texOf(html("inline $x^2$ and \\(a_i\\) here")), [["x^2", false], ["a_i", false]]);
  assert.deepEqual(texOf(html("$$\nE = mc^2\n$$")), [["E = mc^2", true]]);
  assert.deepEqual(texOf(html("\\[ a + b \\]")), [["a + b", true]]);
  assert.deepEqual(texOf(html("see $$a=b$$ ok")), [["a=b", true]]);
});

test("math: prices, shell variables and code are left alone", () => {
  assert.equal(texOf(html("costs $5 and $10 total")).length, 0);
  assert.equal(texOf(html("export $HOME and $PATH")).length, 0);
  assert.equal(texOf(html("`$x^2$` in code")).length, 0);
  assert.equal(texOf(html("```\n$$\na\n$$\n```")).length, 0);
  assert.equal(texOf(html("an unclosed $$ block\nstays text")).length, 0);
});

test("math: TeX is escaped, never injected as HTML", () => {
  const h = html("$a<b$");
  assert.match(h, /data-tex="a&lt;b"/);
  assert.ok(!h.includes("<b"));
});

test("mermaid fences get a source/diagram toggle; other fences do not", () => {
  assert.match(html("```mermaid\ngraph TD; A-->B\n```"), /data-toggle-diagram/);
  assert.doesNotMatch(html("```js\nx\n```"), /data-toggle-diagram/);
});
