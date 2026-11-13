import MarkdownIt from "markdown-it";
import { convertFileSrc } from "@tauri-apps/api/core";
import { mathPlugin } from "./math.ts";

export interface RenderEnv {
  /** Session working directory, used to resolve relative image paths. */
  cwd?: string;
  [key: string]: unknown;
}

const REMOTE = /^(https?:|data:|blob:|asset:)/i;
const WIN_ABS = /^([a-zA-Z]:[\\/]|\\\\)/;

/** Maps a markdown image src to something the webview can load; local files go through the asset protocol. */
export function resolveImageSrc(src: string, cwd?: string): string {
  if (REMOTE.test(src) || src.startsWith("http://asset.localhost")) return src;
  let path = src;
  try {
    path = decodeURI(src); // markdown-it percent-encodes non-ASCII and spaces
  } catch {
    /* keep as-is */
  }
  path = path.replace(/^file:\/\/\/?/i, "");
  if (!WIN_ABS.test(path) && cwd) path = `${cwd.replace(/[\\/]+$/, "")}\\${path.replace(/^\.[\\/]/, "")}`;
  return convertFileSrc(path.replace(/\//g, "\\"));
}

function create(user: boolean) {
  // html: false — agent output may contain tags that must show literally, never execute.
  const md = new MarkdownIt({ html: false, linkify: true, breaks: user });
  // What people type is plain text: in a pasted Windows path like C:\proj\.git the backslash is not an escape.
  if (user) md.disable("escape");
  // Only links with an explicit scheme: fuzzy matching turns `README.md` into http://readme.md.
  md.linkify.set({ fuzzyLink: false });
  md.use(mathPlugin);
  const esc = md.utils.escapeHtml;

  md.renderer.rules.fence = (tokens, idx) => {
    const t = tokens[idx];
    const lang = t.info.trim().split(/\s+/, 1)[0]?.toLowerCase() ?? "";
    return (
      `<div class="code-block"><div class="code-head"><span>${esc(lang || "text")}</span>` +
      `${lang === "mermaid" ? `<button class="copy-btn" data-toggle-diagram>源码</button>` : ""}` +
      `<button class="copy-btn" data-copy-code>复制</button></div>` +
      `<pre><code data-lang="${esc(lang)}">${esc(t.content)}</code></pre></div>`
    );
  };
  md.renderer.rules.code_block = md.renderer.rules.fence;

  const defaultImage = md.renderer.rules.image!;
  md.renderer.rules.image = (tokens, idx, options, env, self) => {
    const t = tokens[idx];
    const src = t.attrGet("src");
    if (src) t.attrSet("src", resolveImageSrc(String(src), (env as RenderEnv | undefined)?.cwd));
    t.attrSet("loading", "lazy");
    return defaultImage(tokens, idx, options, env, self);
  };
  return md;
}

const agentMd = create(false);
// User prompts are usually plain text where single newlines matter.
const userMd = create(true);

export function renderMarkdown(source: string, env: RenderEnv, opts: { user?: boolean } = {}): string {
  return (opts.user ? userMd : agentMd).render(source, { ...env });
}
