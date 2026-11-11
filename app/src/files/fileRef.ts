/** A reference to a local file, optionally to a line or line range (1-based, inclusive). */
export interface FileRef {
  path: string;
  line?: number;
  endLine?: number;
}

const SUFFIX = /^(.*?)(?::(\d+)(?:([-:])(\d+))?|#L(\d+)(?:-L?(\d+))?)?$/;
const BAD_CHARS = /[<>"|?*\r\n\t]/;
const HAS_EXT = /[^\\/]\.[A-Za-z0-9_+-]{1,12}$|^\.[A-Za-z0-9_-][\w.-]*$/;
const DRIVE = /^[A-Za-z]:[\\/]/;

function isAbsolute(p: string): boolean {
  return DRIVE.test(p) || p.startsWith("\\\\") || /^\/[A-Za-z]\//.test(p);
}

/**
 * Parses `src/a.ts`, `src/a.ts:42`, `a.ts:42-50`, `a.ts:42:7` (column ignored), `a.ts#L42-L50`.
 * Deliberately permissive: callers confirm the file exists before showing a link.
 */
export function parseFileRef(text: string): FileRef | null {
  let s = text.trim().replace(/^file:\/\/\/?/i, "");
  if (!s || s.length > 400 || s.includes("://") || BAD_CHARS.test(s)) return null;
  const m = SUFFIX.exec(s);
  if (!m) return null;
  s = m[1];
  const line = Number(m[2] ?? m[5]) || undefined;
  const end = m[3] === ":" ? undefined : Number(m[4] ?? m[6]) || undefined;
  if (!s || (/\s/.test(s) && !isAbsolute(s))) return null;
  const last = s.split(/[\\/]/).pop() ?? "";
  if (!last || last === "." || last === "..") return null;
  if (!HAS_EXT.test(last) && !isAbsolute(s)) return null;
  return { path: s, line, endLine: line && end && end >= line ? end : undefined };
}

/** Absolute Windows path for `path`, resolving relative paths against `base`; null if not resolvable. */
export function resolvePath(path: string, base?: string): string | null {
  let p = path.replace(/^file:\/\/\/?/i, "").replace(/^\/([A-Za-z])\//, "$1:/").replace(/\//g, "\\");
  if (!DRIVE.test(p) && !p.startsWith("\\\\")) {
    if (!base || p.startsWith("\\") || p.startsWith("~")) return null;
    p = `${base.replace(/[\\/]+$/, "").replace(/\//g, "\\")}\\${p}`;
  }
  const unc = p.startsWith("\\\\");
  const out: string[] = [];
  for (const seg of p.slice(unc ? 2 : 0).split("\\")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (out.length > 1) out.pop();
      continue;
    }
    out.push(seg);
  }
  return (unc ? "\\\\" : "") + out.join("\\");
}

export function dirname(path: string): string {
  const i = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return i > 0 ? path.slice(0, i) : path;
}

/** Display form: relative to `base` when inside it, with forward slashes. */
export function displayPath(path: string, base?: string): string {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const p = norm(path);
  if (!base) return p;
  const b = norm(base) + "/";
  return p.toLowerCase().startsWith(b.toLowerCase()) ? p.slice(b.length) : p;
}

// Path-looking spans in prose: at least one separator and an extension, optional :line / #L suffix.
const SEG = "[\\w\\-.@\\u4e00-\\u9fff]";
const CANDIDATE = new RegExp(
  `(?<![\\w\\\\/.:\\-])(?:[A-Za-z]:[\\\\/]|\\.{1,2}[\\\\/])?(?:${SEG}+[\\\\/])+${SEG}+\\.[A-Za-z0-9]{1,12}(?::\\d+(?:-\\d+)?|#L\\d+(?:-L?\\d+)?)?`,
  "gu",
);

export function findRefsInText(text: string): Array<{ start: number; end: number; ref: FileRef }> {
  const out: Array<{ start: number; end: number; ref: FileRef }> = [];
  for (const m of text.matchAll(CANDIDATE)) {
    const ref = parseFileRef(m[0]);
    if (ref) out.push({ start: m.index, end: m.index + m[0].length, ref });
  }
  return out;
}
