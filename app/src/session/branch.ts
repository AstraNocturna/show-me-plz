import type { SessionEntry } from "./types";

/**
 * Entries on the path root → leaf, in order. Unlike pi's context building this keeps
 * pre-compaction history, since the viewer is for reading what actually happened.
 * Without an explicit leaf, the last entry in the file is the leaf (pi appends at the leaf).
 */
export function activeBranch(entries: SessionEntry[], leafOverride: string | null): SessionEntry[] {
  const byId = new Map<string, SessionEntry>();
  let last: SessionEntry | undefined;
  for (const e of entries) {
    if (e.id && e.type !== "session") {
      byId.set(e.id, e);
      last = e;
    }
  }
  let cur = (leafOverride && byId.get(leafOverride)) || last;
  const path: SessionEntry[] = [];
  const seen = new Set<string>();
  while (cur?.id && !seen.has(cur.id)) {
    seen.add(cur.id);
    path.push(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return path.reverse();
}
