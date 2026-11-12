import type { ToolCallView } from "./viewModel";

const ICONS: Record<string, string> = {
  read: "📄",
  write: "📝",
  edit: "✏️",
  bash: "⌨️",
  "!bash": "⌨️",
  powershell: "⌨️",
  web_search: "🔎",
  fetch_content: "🌐",
  todo: "☑️",
};

/** Arguments shown in a tool step's detail. An edit with a diff shows the diff instead of its raw `edits`. */
export function shownArgs(call: ToolCallView): Array<[string, unknown]> {
  const entries = Object.entries(call.args);
  return call.result?.diff ? entries.filter(([k]) => k !== "edits") : entries;
}

// Argument names, in priority order, that best describe what a call did.
const KEY_ARGS = ["path", "file_path", "command", "query", "url", "pattern", "subject", "action"];

function firstLine(s: string, max = 120): string {
  const line = s.split(/\r?\n/, 1)[0];
  return line.length > max ? line.slice(0, max) + "…" : line;
}

export function toolIcon(name: string): string {
  return ICONS[name] ?? "⚙️";
}

/** Strips the session cwd prefix so paths read as `src/a.ts` (case-insensitive, either slash). */
function relative(path: string, cwd?: string): string {
  if (!cwd) return path;
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const base = norm(cwd) + "/";
  const p = norm(path);
  return p.toLowerCase().startsWith(base.toLowerCase()) ? p.slice(base.length) : path;
}

/** One-line human summary, e.g. `src/a.ts` for read, the command for bash. */
export function toolSummary(call: ToolCallView, cwd?: string): string {
  const args = call.args;
  for (const k of KEY_ARGS) {
    const v = args[k];
    if (typeof v === "string" && v.trim()) return firstLine(k === "path" || k === "file_path" ? relative(v, cwd) : v);
  }
  if (Array.isArray(args.queries) && typeof args.queries[0] === "string") return firstLine(args.queries.join(" | "));
  const anyString = Object.values(args).find((v): v is string => typeof v === "string" && v.trim() !== "");
  return anyString ? firstLine(anyString) : "";
}
