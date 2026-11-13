/**
 * Safety net for the viewer's side-question subagent (a `pi --fork` of the main session).
 *
 * The fork declares exactly the same tools as the main session so it can reuse the main session's prompt
 * cache, which means it *has* write-capable tools. This extension takes them away at call time: it blocks
 * every tool call except the read-only ones, unless the viewer has switched modification on by creating
 * `allow-write` in the fork directory with the content "1" ("0" or anything else, or no file, means
 * read-only; the content is compared instead of the file's existence because on Windows a just-deleted
 * file can still look present for a moment). Registering no tools and changing no prompts keeps the request
 * prefix, and therefore the cache, untouched.
 *
 * Outside a side-question fork (no SMP_QA_DIR) it does nothing.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const READ_ONLY = new Set(["read", "grep", "find", "ls"]);

export default function (pi: ExtensionAPI) {
  const dir = process.env.SMP_QA_DIR;
  if (!dir) return;

  // The viewer refuses to talk to a fork that did not load this guard.
  writeFileSync(join(dir, "guard-ok"), "1");

  const writeAllowed = () => {
    try {
      return readFileSync(join(dir, "allow-write"), "utf8").trim() === "1";
    } catch {
      return false; // missing or unreadable: stay read-only
    }
  };

  pi.on("tool_call", async (event) => {
    if (READ_ONLY.has(event.toolName) || writeAllowed()) return;
    return {
      block: true,
      reason:
        `旁路问答处于只读模式：工具 ${event.toolName} 已被拦截，没有执行任何操作。` +
        "只能使用 read / grep / find / ls 查看文件；如果确实需要修改或执行命令，请告诉用户在问答面板里打开「允许子代理修改」。",
    };
  });
}
