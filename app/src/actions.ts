import { openUrl } from "@tauri-apps/plugin-opener";

export const TOAST_EVENT = "smp-toast";

export function toast(text: string): void {
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: text }));
}

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast("已复制");
  } catch (err) {
    toast(`复制失败: ${String(err)}`);
  }
}

/**
 * Delegated click handling for rendered content: links must never navigate the app window,
 * code-block copy buttons, and image zoom.
 */
export function handleContentClick(e: React.MouseEvent, onImage: (src: string) => void): void {
  const el = e.target as HTMLElement;

  const copyBtn = el.closest<HTMLElement>("[data-copy-code]");
  if (copyBtn) {
    const code = copyBtn.closest(".code-block")?.querySelector("pre");
    if (code) void copyText(code.textContent ?? "");
    return;
  }

  const link = el.closest<HTMLAnchorElement>("a[href]");
  if (link) {
    e.preventDefault();
    const href = link.getAttribute("href") ?? "";
    if (/^(https?:|mailto:)/i.test(href)) void openUrl(href).catch((err) => toast(`打开失败: ${String(err)}`));
    return;
  }

  const img = el.closest<HTMLImageElement>(".md img, img.thumb");
  if (img) onImage(img.src);
}
