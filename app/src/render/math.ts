import type MarkdownIt from "markdown-it";
import type { StateBlock, StateInline } from "markdown-it";

// Markers only: KaTeX itself is loaded on demand (see extras.ts), so sessions without formulas never pay for it.

// `$a$` is also how prose writes shell variables and prices, so a `$…$` span must look like math:
// no padding spaces, no digit right after the closer, and either a math character or a short symbol.
const MATH_CHARS = /[\\^_{}=<>|+-]/;
const SHORT_SYMBOL = /^[A-Za-z]{1,2}$/;

function mathInline(state: StateInline, silent: boolean): boolean {
  const src = state.src;
  const start = state.pos;
  let open: string, close: string, display = false;
  if (src.startsWith("\\(", start)) [open, close] = ["\\(", "\\)"];
  else if (src.startsWith("$$", start)) [open, close, display] = ["$$", "$$", true];
  else if (src[start] === "$") [open, close] = ["$", "$"];
  else return false;

  const from = start + open.length;
  let end = -1;
  for (let i = from; i < state.posMax; i++) {
    if (src[i] === "\\" && open !== "\\(") { i++; continue; }
    if (src[i] === "\n" && open === "$") return false;
    if (src.startsWith(close, i)) { end = i; break; }
  }
  if (end <= from) return false;
  const tex = src.slice(from, end);
  if (open === "$") {
    if (/^\s|\s$/.test(tex) || /\d/.test(src[end + 1] ?? "")) return false;
    if (!MATH_CHARS.test(tex) && !SHORT_SYMBOL.test(tex)) return false;
  }
  if (!silent) {
    const t = state.push("math", "", 0);
    t.content = tex;
    t.meta = { display };
  }
  state.pos = end + close.length;
  return true;
}

function mathBlock(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;
  const first = state.bMarks[startLine] + state.tShift[startLine];
  const max = state.eMarks[startLine];
  const open = state.src.startsWith("$$", first) ? "$$" : state.src.startsWith("\\[", first) ? "\\[" : null;
  if (!open) return false;
  const close = open === "$$" ? "$$" : "\\]";

  const head = state.src.slice(first + 2, max).trimEnd();
  let tex: string;
  let next = startLine + 1;
  if (head.endsWith(close)) {
    tex = head.slice(0, -2);
  } else {
    const lines = [head];
    let found = false;
    for (; next < endLine; next++) {
      const line = state.src.slice(state.bMarks[next] + state.tShift[next], state.eMarks[next]).trimEnd();
      if (line.endsWith(close)) {
        lines.push(line.slice(0, -2));
        found = true;
        next++;
        break;
      }
      lines.push(line);
    }
    if (!found) return false;
    tex = lines.join("\n");
  }
  if (!tex.trim()) return false;
  if (silent) return true;
  const t = state.push("math", "", 0);
  t.block = true;
  t.content = tex.trim();
  t.meta = { display: true };
  t.map = [startLine, next];
  state.line = next;
  return true;
}

export function mathPlugin(md: InstanceType<typeof MarkdownIt>): void {
  md.inline.ruler.before("escape", "math", mathInline);
  md.block.ruler.before("fence", "math", mathBlock, { alt: ["paragraph", "reference", "blockquote", "list"] });
  md.renderer.rules.math = (tokens, idx) => {
    const t = tokens[idx];
    const tex = md.utils.escapeHtml(t.content);
    return t.meta?.display
      ? `<span class="math display" data-tex="${tex}">${tex}</span>`
      : `<span class="math" data-tex="${tex}">${tex}</span>`;
  };
}
