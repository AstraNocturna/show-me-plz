import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSkillMessage, promptLabel } from "./skill.ts";

const body = 'References are relative to C:\skills\rea.\n\n# REA\n\nUse REA when…';

test("a skill invocation is split into the skill and what the user typed", () => {
  const text = `<skill name="rea" location="C:\skills\rea\SKILL.md">\n${body}\n</skill>\n\n分析一下这个 exe`;
  assert.deepEqual(parseSkillMessage(text), { name: "rea", location: "C:\skills\rea\SKILL.md", body, args: "分析一下这个 exe" });
});

test("a skill invoked without arguments has empty args", () => {
  const text = `<skill name="rea" location="x">\n${body}\n</skill>`;
  assert.equal(parseSkillMessage(text)?.args, "");
});

test("a skill body that itself mentions </skill> is kept whole", () => {
  const inner = "see <skill name=\"a\" location=\"b\">…</skill> blocks";
  const parsed = parseSkillMessage(`<skill name="rea" location="x">\n${inner}\n</skill>\n\n问题`);
  assert.equal(parsed?.body, inner);
  assert.equal(parsed?.args, "问题");
});

test("ordinary text, even mentioning a skill tag, is not a skill invocation", () => {
  assert.equal(parseSkillMessage("请解释 <skill> 标签"), null);
  assert.equal(parseSkillMessage("先说一句 <skill name=\"a\" location=\"b\">\nx\n</skill>"), null);
});

test("promptLabel shows a skill as /skill:name plus the user's words", () => {
  assert.equal(promptLabel("", { name: "rea" }), "/skill:rea");
  assert.equal(promptLabel("看看这个", { name: "rea" }), "/skill:rea 看看这个");
  assert.equal(promptLabel("普通提问", undefined), "普通提问");
});
