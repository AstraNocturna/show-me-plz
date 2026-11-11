import { bundledLanguages, createHighlighter, type BundledLanguage, type Highlighter } from "shiki";

let highlighter: Promise<Highlighter> | undefined;
const cache = new Map<string, Promise<string | null>>();

async function load(lang: BundledLanguage): Promise<Highlighter> {
  const h = await (highlighter ??= createHighlighter({ themes: ["github-light", "github-dark"], langs: [] }));
  if (!h.getLoadedLanguages().includes(lang)) await h.loadLanguage(lang);
  return h;
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
