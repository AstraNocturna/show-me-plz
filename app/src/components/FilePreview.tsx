import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { copyText, handleContentClick, toast } from "../actions";
import { dirname, displayPath, isImagePath, type FileRef } from "../files/fileRef";
import { highlightFile, langForFile } from "../render/highlight";
import { Markdown } from "./Markdown";

export type SplitDir = "row" | "col";

interface FileContent {
  size: number;
  isDir: boolean;
  binary: boolean;
  truncated: boolean;
  text: string | null;
}

type Load = { state: "loading" } | { state: "error"; error: string } | { state: "ok"; file: FileContent };

const MARKDOWN = /\.(md|markdown|mdx)$/i;
// "Open with default app" would run these instead of showing them.
const EXECUTABLE = /\.(exe|com|bat|cmd|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|msi|msp|scr|lnk|reg|hta|cpl|jar|pif|py|pyw|sh)$/i;
// Above these, highlighting gets slow; fall back to plain lines.
const HIGHLIGHT_MAX_CHARS = 300_000;
const HIGHLIGHT_MAX_LINES = 8_000;

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
}

function plainHtml(text: string): string {
  const lines = text.split(/\r?\n/).map((l, i) => `<span class="line" data-line="${i + 1}">${escapeHtml(l)}</span>`);
  return `<pre class="plain-file"><code>${lines.join("\n")}</code></pre>`;
}

function formatSize(n: number): string {
  return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Source view with line numbers; highlights `line..endLine` and centers it. */
function CodeView({ text, path, line, endLine }: { text: string; path: string; line?: number; endLine?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const plain = useMemo(() => plainHtml(text), [text]);
  const [highlighted, setHighlighted] = useState<{ text: string; html: string } | null>(null);
  const html = highlighted?.text === text ? highlighted.html : plain;

  useEffect(() => {
    const lang = langForFile(path);
    const big = text.length > HIGHLIGHT_MAX_CHARS || text.split("\n").length > HIGHLIGHT_MAX_LINES;
    if (!lang || big) return;
    let cancelled = false;
    void highlightFile(text, lang).then((out) => !cancelled && out && setHighlighted({ text, html: out }));
    return () => {
      cancelled = true;
    };
  }, [text, path]);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    root.querySelectorAll(".line.hl").forEach((el) => el.classList.remove("hl"));
    if (!line) return;
    const end = endLine ?? line;
    for (let n = line; n <= end; n++) root.querySelector(`.line[data-line="${n}"]`)?.classList.add("hl");
    const target = root.querySelector<HTMLElement>(`.line[data-line="${line}"]`);
    const scroller = root.closest<HTMLElement>(".preview-body");
    if (target && scroller) {
      const offset = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      scroller.scrollTop += offset - scroller.clientHeight / 3;
    }
  }, [html, line, endLine]);

  return <div ref={ref} className="code-view" dangerouslySetInnerHTML={{ __html: html }} />;
}

export function FilePreview(props: {
  target: FileRef;
  cwd?: string;
  dir: SplitDir;
  onToggleDir(): void;
  onClose(): void;
  onFile(ref: FileRef): void;
  onImage(src: string): void;
}) {
  const { target, cwd, dir, onToggleDir, onClose, onFile, onImage } = props;
  const { path, line, endLine } = target;
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [reload, setReload] = useState(0);
  const isImage = isImagePath(path);
  const isMd = MARKDOWN.test(path);
  const [rendered, setRendered] = useState(true);
  // A line target only makes sense in the source view.
  useEffect(() => setRendered(!line), [path, line]);

  useEffect(() => {
    setLoad({ state: "loading" });
    if (isImage) return; // shown straight from the asset protocol
    let cancelled = false;
    invoke<FileContent>("read_file", { path })
      .then((file) => !cancelled && setLoad({ state: "ok", file }))
      .catch((e) => !cancelled && setLoad({ state: "error", error: String(e) }));
    return () => {
      cancelled = true;
    };
  }, [path, isImage, reload]);

  const openDefault = useCallback(() => {
    if (EXECUTABLE.test(path)) {
      toast("可执行文件/脚本不会直接打开，已在资源管理器中定位");
      void revealItemInDir(path).catch((e) => toast(`定位失败: ${String(e)}`));
      return;
    }
    void openPath(path).catch((e) => toast(`打开失败: ${String(e)}`));
  }, [path]);

  const file = load.state === "ok" ? load.file : null;
  let body: React.ReactNode;
  if (isImage) body = <img className="preview-image" src={convertFileSrc(path)} alt="" onClick={() => onImage(convertFileSrc(path))} />;
  else if (load.state === "loading") body = <div className="preview-msg">读取中…</div>;
  else if (load.state === "error") body = <div className="preview-msg err">无法读取：{load.error}</div>;
  else if (file!.isDir) body = <div className="preview-msg">这是一个文件夹。可以在资源管理器中打开查看。</div>;
  else if (file!.binary) body = <div className="preview-msg">二进制文件（{formatSize(file!.size)}），不做预览。</div>;
  else if (isMd && rendered) body = <div className="preview-md"><Markdown source={file!.text!} cwd={dirname(path)} /></div>;
  else body = <CodeView text={file!.text!} path={path} line={line} endLine={endLine} />;

  const where = line ? `:${line}${endLine ? `-${endLine}` : ""}` : "";
  return (
    <section className="preview">
      <header className="preview-head">
        <span className="preview-path" title={path}>
          {displayPath(path, cwd)}
          <span className="muted">{where}</span>
        </span>
        {file && !file.isDir && <span className="muted preview-meta">{formatSize(file.size)}</span>}
        {isMd && file?.text != null && (
          <div className="segmented small">
            <button className={rendered ? "on" : ""} onClick={() => setRendered(true)}>渲染</button>
            <button className={!rendered ? "on" : ""} onClick={() => setRendered(false)}>源码</button>
          </div>
        )}
        <button className="toggle" title="重新读取" onClick={() => setReload((n) => n + 1)}>⟳</button>
        <button className="toggle" title="复制路径" onClick={() => void copyText(path)}>⧉</button>
        <button className="toggle" title="用默认程序打开" onClick={openDefault}>↗</button>
        <button className="toggle" title="在资源管理器中显示" onClick={() => void revealItemInDir(path).catch((e) => toast(`定位失败: ${String(e)}`))}>
          📂
        </button>
        <button className="toggle" title={dir === "row" ? "改为上下分屏" : "改为左右分屏"} onClick={onToggleDir}>
          {dir === "row" ? "⇅" : "⇆"}
        </button>
        <button className="toggle" title="关闭预览 (Esc)" onClick={onClose}>✕</button>
      </header>
      {file?.truncated && <div className="preview-note">文件较大，只显示前 4 MB。</div>}
      <div className="preview-body" onClick={(e) => handleContentClick(e, onImage, onFile)}>
        {body}
      </div>
    </section>
  );
}
