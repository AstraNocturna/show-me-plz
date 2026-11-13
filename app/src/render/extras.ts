// Formulas and diagrams: both libraries are large, so they are imported only when a message needs them.

let katexReady: Promise<typeof import("katex").default> | undefined;
let mermaidReady: Promise<typeof import("mermaid").default> | undefined;
let queue: Promise<unknown> = Promise.resolve();
let seq = 0;

/** Typesets every `.math` span under `root`; failures keep the TeX source visible. */
export async function renderMath(root: HTMLElement, isStale: () => boolean): Promise<void> {
  const spans = root.querySelectorAll<HTMLElement>(".math[data-tex]");
  if (!spans.length) return;
  try {
    const katex = await (katexReady ??= Promise.all([import("katex"), import("katex/dist/katex.min.css")]).then(([m]) => m.default));
    if (isStale()) return;
    spans.forEach((el) => {
      katex.render(el.dataset.tex ?? "", el, { displayMode: el.classList.contains("display"), throwOnError: false, output: "html" });
      el.removeAttribute("data-tex");
    });
  } catch {
    /* leave the TeX text */
  }
}

/** Draws a mermaid fence as an SVG in place of its source; returns false (source stays) if it cannot. */
export async function renderDiagram(block: HTMLElement, source: string, isStale: () => boolean): Promise<boolean> {
  const run = async (): Promise<boolean> => {
    const id = `smp-mmd-${++seq}`;
    try {
      const mermaid = await (mermaidReady ??= import("mermaid").then((m) => m.default));
      // The diagram sits on its own light surface (see .diagram), so one theme serves light and dark.
      mermaid.initialize({ startOnLoad: false, theme: "default", securityLevel: "strict" });
      const { svg } = await mermaid.render(id, source);
      if (isStale() || !block.isConnected) return false;
      const holder = document.createElement("div");
      holder.className = "diagram";
      holder.innerHTML = svg;
      block.querySelector("pre")?.before(holder);
      block.classList.add("diagram-ok");
      return true;
    } catch {
      document.getElementById(`d${id}`)?.remove(); // mermaid leaves its scratch node behind on errors
      return false;
    }
  };
  // Mermaid keeps global state while rendering; draw one diagram at a time.
  const result = queue.then(run, run);
  queue = result;
  return result;
}
