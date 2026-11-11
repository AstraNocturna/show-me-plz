import { bundledLanguages, createHighlighter, type BundledLanguage, type Highlighter } from "shiki";

let highlighter: Promise<Highlighter> | undefined;
const cache = new Map<string, Promise<string | null>>();

async function load(lang: BundledLanguage): Promise<Highlighter> {
  const h = await (highlighter ??= createHighlighter({ themes: ["github-light", "github-dark"], langs: [] }));
  if (!h.getLoadedLanguages().includes(lang)) await h.loadLanguage(lang);
  return h;
}

const EXT_LANG: Record<string, string> = { h: "c", hpp: "cpp", psm1: "powershell" };
const NAME_LANG: Record<string, string> = { dockerfile: "dockerfile", makefile: "makefile" };

/** Shiki language for a file name, or null when there is none. */
export function langForFile(path: string): string | null {
  const name = path.split(/[\\/]/).pop()!.toLowerCase();
  if (NAME_LANG[name]) return NAME_LANG[name];
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
  const lang = EXT_LANG[ext] ?? ext;
  return lang in bundledLanguages ? lang : null;
}

/** Whole-file highlighting with a `data-line` attribute on every line; not cached (files change). */
export async function highlightFile(code: string, lang: string): Promise<string | null> {
  try {
    const h = await load(lang as BundledLanguage);
    return h.codeToHtml(code, {
      lang,
      themes: { light: "github-light", dark: "github-dark" },
      transformers: [{ line: (node, line) => void (node.properties["data-line"] = line) }],
    });
  } catch {
    return null;
  }
}

/** Highlighted `<pre class="shiki">` HTML, or null for unknown languages (left as plain text). */
export function highlight(code: string, lang: string): Promise<string | null> {
  if (!(lang in bundledLanguages)) return Promise.resolve(null);
  const key = `${lang}\0${code}`;
  let p = cache.get(key);
  if (!p) {
    p = load(lang as BundledLanguage)
      .then((h) => h.codeToHtml(code, { lang, themes: { light: "github-light", dark: "github-dark" } }))
      .catch(() => null);
    cache.set(key, p);
  }
  return p;
}
