// Run with: cd app && pnpm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Handler = (event: { toolName: string }) => Promise<{ block?: boolean; reason?: string } | undefined>;

async function load(dir: string | undefined): Promise<Handler | undefined> {
  if (dir) process.env.SMP_QA_DIR = dir;
  else delete process.env.SMP_QA_DIR;
  const { default: guard } = await import("./qa-guard.ts");
  let handler: Handler | undefined;
  guard({ on: (_event: string, h: Handler) => (handler = h) } as never);
  return handler;
}

test("the guard blocks everything but read-only tools until modification is switched on, and back off", async () => {
  const dir = mkdtempSync(join(tmpdir(), "smp-guard-"));
  try {
    const h = (await load(dir))!;
    assert.ok(existsSync(join(dir, "guard-ok")), "the viewer relies on this marker to know the guard is loaded");
    for (const t of ["read", "grep", "find", "ls"]) assert.equal(await h({ toolName: t }), undefined, t);
    // codemode and MCP tools can run other tools or have side effects: they are blocked too
    for (const t of ["bash", "edit", "write", "codemode", "mcp__playwright__browser_click", "todo"]) {
      assert.equal((await h({ toolName: t }))?.block, true, t);
    }
    writeFileSync(join(dir, "allow-write"), "1");
    assert.equal(await h({ toolName: "bash" }), undefined);
    writeFileSync(join(dir, "allow-write"), "0");
    assert.equal((await h({ toolName: "bash" }))?.block, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("outside a side-question fork the guard does nothing", async () => {
  assert.equal(await load(undefined), undefined);
});
