import { invoke } from "@tauri-apps/api/core";
import { findRefsInText, parseFileRef, resolvePath, type FileRef } from "./fileRef";

/** Negative results expire, since the agent may create the file later in the session. */
const MISSING_TTL = 10_000;
const known = new Map<string, { ok: boolean; at: number }>();
let pending: Map<string, Array<(ok: boolean) => void>> | null = null;

/** Batched, cached existence check; one backend call per microtask burst. */
function exists(path: string): Promise<boolean> {
  const hit = known.get(path);
  if (hit && (hit.ok || Date.now() - hit.at < MISSING_TTL)) return Promise.resolve(hit.ok);
  return new Promise((resolve) => {
    if (!pending) {
      pending = new Map();
      queueMicrotask(flush);
    }
    const waiters = pending.get(path) ?? [];
    waiters.push(resolve);
    pending.set(path, waiters);
  });
}

function flush(): void {
  const batch = pending!;
  pending = null;
  const paths = [...batch.keys()];
  invoke<boolean[]>("check_paths", { paths })
    .catch(() => paths.map(() => false))
    .then((res) => {
      paths.forEach((p, i) => {
        known.set(p, { ok: res[i], at: Date.now() });
        batch.get(p)!.forEach((r) => r(res[i]));
      });
    });
}

export function setRefData(el: HTMLElement, abs: string, ref: FileRef): void {
  el.classList.add("file-ref");
  el.dataset.filePath = abs;
  if (ref.line) el.dataset.fileLine = String(ref.line);
  if (ref.endLine) el.dataset.fileEnd = String(ref.endLine);
  el.title = `预览 ${abs}${ref.line ? `:${ref.line}` : ""}`;
}

export function readRefData(el: HTMLElement): FileRef {
  return {
    path: el.dataset.filePath!,
    line: Number(el.dataset.fileLine) || undefined,
    endLine: Number(el.dataset.fileEnd) || undefined,
  };
}

const SKIP = "a, code, pre, .shiki, .file-ref";

/** Turns references to existing local files (inline code and prose) into clickable preview links. */
export async function linkifyFileRefs(root: HTMLElement, base?: string): Promise<void> {
  const jobs: Array<Promise<void>> = [];

  for (const code of root.querySelectorAll<HTMLElement>("code")) {
    if (code.closest("pre, a")) continue;
    const ref = parseFileRef(code.textContent ?? "");
    const abs = ref && resolvePath(ref.path, base);
    if (!ref || !abs) continue;
    jobs.push(exists(abs).then((ok) => void (ok && code.isConnected && setRefData(code, abs, ref))));
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const texts: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n as Text);
  for (const node of texts) {
    const found = findRefsInText(node.data)
      .map((f) => ({ ...f, abs: resolvePath(f.ref.path, base) }))
      .filter((f): f is typeof f & { abs: string } => !!f.abs);
    if (!found.length) continue;
    jobs.push(
      Promise.all(found.map((f) => exists(f.abs))).then((oks) => {
        if (!node.isConnected) return;
        // Wrap from the end: surroundContents splits `node` and leaves the text before the range in it,
        // so earlier offsets stay valid.
        for (let i = found.length - 1; i >= 0; i--) {
          if (!oks[i]) continue;
          const f = found[i];
          const range = document.createRange();
          range.setStart(node, f.start);
          range.setEnd(node, f.end);
          const span = document.createElement("span");
          setRefData(span, f.abs, f.ref);
          range.surroundContents(span);
        }
      }),
    );
  }
  await Promise.all(jobs);
}

/** A markdown link pointing at a local file (`[x](src/a.ts#L3)`), resolved against `base`. */
export function localLinkRef(href: string, base?: string): FileRef | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^[a-z]:[\\/]/i.test(href) && !/^file:/i.test(href)) return null;
  let decoded = href;
  try {
    decoded = decodeURI(href);
  } catch {
    /* keep */
  }
  const ref = parseFileRef(decoded);
  const abs = ref && resolvePath(ref.path, base);
  return ref && abs ? { ...ref, path: abs } : null;
}
