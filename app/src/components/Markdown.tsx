import { memo, useEffect, useMemo, useRef } from "react";
import { linkifyFileRefs } from "../files/links";
import { renderDiagram, renderMath } from "../render/extras";
import { highlight } from "../render/highlight";
import { renderMarkdown } from "../render/markdown";

interface Props {
  source: string;
  cwd?: string;
  user?: boolean;
}

/** Renders markdown, then upgrades fenced code blocks with syntax highlighting asynchronously. */
export const Markdown = memo(function Markdown({ source, cwd, user }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const html = useMemo(() => renderMarkdown(source, { cwd }, { user }), [source, cwd, user]);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    let cancelled = false;
    void linkifyFileRefs(root, cwd);
    void renderMath(root, () => cancelled);
    root.querySelectorAll<HTMLElement>("code[data-lang]").forEach((code) => {
      const lang = code.dataset.lang;
      const pre = code.parentElement;
      if (!lang || !pre) return;
      const upgrade = () =>
        void highlight(code.textContent ?? "", lang).then((out) => {
          if (!out || cancelled || !pre.isConnected) return;
          pre.outerHTML = out;
        });
      const block = pre.closest<HTMLElement>(".code-block");
      if (lang === "mermaid" && block) {
        // The source is highlighted only when the diagram cannot be drawn.
        void renderDiagram(block, code.textContent ?? "", () => cancelled).then((ok) => ok || upgrade());
      } else upgrade();
    });
    return () => {
      cancelled = true;
    };
  }, [html, cwd]);

  return <div ref={ref} className="md" data-cwd={cwd} dangerouslySetInnerHTML={{ __html: html }} />;
});
