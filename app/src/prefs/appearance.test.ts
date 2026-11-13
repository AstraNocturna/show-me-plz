import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanAppearance, cssVars, DEFAULT_APPEARANCE, fontCss } from "./appearance.ts";

test("garbage preferences fall back to defaults", () => {
  assert.deepEqual(cleanAppearance(null), DEFAULT_APPEARANCE);
  assert.deepEqual(cleanAppearance({ user: { size: 999, color: "red; x" }, spacing: "huge", width: 5 }), DEFAULT_APPEARANCE);
});

test("valid preferences survive and only customised values become CSS variables", () => {
  const a = cleanAppearance({ agent: { size: 18, color: "#112233", font: "LXGW WenKai" }, width: "wide" });
  assert.equal(a.agent.font, '"LXGW WenKai", sans-serif');
  const vars = cssVars(a);
  assert.equal(vars["--agent-size"], "18px");
  assert.equal(vars["--agent-color"], "#112233");
  assert.equal(vars["--content-max"], "1400px");
  assert.equal("--user-size" in vars, false);
});

test("a typed font name is quoted; full lists pass through; CSS-breaking characters are dropped", () => {
  assert.equal(fontCss("Segoe UI"), '"Segoe UI", sans-serif');
  assert.equal(fontCss('Georgia, serif'), "Georgia, serif");
  assert.equal(fontCss("a;}b"), '"ab", sans-serif');
  assert.equal(fontCss("  "), "");
});
