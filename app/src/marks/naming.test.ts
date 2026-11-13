import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanName, namePrompt, NAME_MAX } from "./naming.ts";

test("cleanName reduces a chatty reply to a bare name", () => {
  assert.equal(cleanName("部署三步"), "部署三步");
  assert.equal(cleanName("\n  「部署三步」。\n\n这个名字概括了…"), "部署三步");
  assert.equal(cleanName("书签名：**构建与启动**"), "构建与启动");
  assert.equal(cleanName('"Q&A 缓存复用"'), "Q&A 缓存复用");
  assert.equal(cleanName(""), "");
});

test("cleanName caps the length", () => {
  assert.equal(cleanName("一".repeat(100)).length, NAME_MAX);
});

test("namePrompt carries the text to name and tells the fork to stay out of the main work", () => {
  const p = namePrompt("agent", "这是回答正文");
  assert.match(p, /这是回答正文/);
  assert.match(p, /AI 的回答/);
  assert.match(p, /不要调用任何工具/);
});
