import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useState, type RefObject } from "react";
import { isImagePath } from "../files/fileRef";

/** How long the pointer must rest on an image path before the small preview appears. */
export const HOVER_DELAY_MS = 1000;
const POPUP_W = 360;
const POPUP_H = 300;

interface Shown {
  path: string;
  left: number;
  /** Sits up and to the right of the pointer (the text still to be read is below and to the left); below only when there is no room above. */
  top?: number;
  bottom?: number;
}

function refAt(target: EventTarget | null): HTMLElement | null {
  const el = (target as HTMLElement | null)?.closest?.<HTMLElement>(".file-ref");
  return el && isImagePath(el.dataset.filePath ?? "") ? el : null;
}

/**
 * A small floating preview of an image file mentioned in the conversation: it appears once the pointer
 * has rested on the path for a few seconds and goes away as soon as the pointer leaves (or anything is
 * clicked or scrolled). It never takes the pointer, so it cannot get in the way.
 */
export function ImageHover({ root }: { root: RefObject<HTMLElement | null> }) {
  const [shown, setShown] = useState<Shown | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // On the document, not on `root`: the timeline mounts only after the session has loaded.
    let timer: number | undefined;
    let current: HTMLElement | null = null;
    let x = 0;
    let y = 0;
    const hide = () => {
      clearTimeout(timer);
      current = null;
      setShown(null);
    };
    const onOver = (e: MouseEvent) => {
      const ref = root.current?.contains(e.target as Node) ? refAt(e.target) : null;
      if (ref === current) return;
      x = e.clientX;
      y = e.clientY;
      hide();
      if (!ref) return;
      current = ref;
      timer = window.setTimeout(() => {
        setFailed(false);
        setShown({
          path: ref.dataset.filePath!,
          left: Math.max(8, Math.min(x + 14, window.innerWidth - POPUP_W - 16)),
          ...(y >= POPUP_H + 24 ? { bottom: window.innerHeight - y + 12 } : { top: y + 20 }),
        });
      }, HOVER_DELAY_MS);
    };
    const onMove = (e: MouseEvent) => {
      x = e.clientX;
      y = e.clientY;
    };
    const onOut = (e: MouseEvent) => {
      if (current && !current.contains(e.relatedTarget as Node | null)) hide();
    };
    document.addEventListener("mouseover", onOver);
    document.addEventListener("mouseout", onOut);
    document.addEventListener("mousemove", onMove);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("wheel", hide, true);
    window.addEventListener("mousedown", hide, true);
    window.addEventListener("keydown", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      hide();
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("mouseout", onOut);
      document.removeEventListener("mousemove", onMove);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("wheel", hide, true);
      window.removeEventListener("mousedown", hide, true);
      window.removeEventListener("keydown", hide, true);
      window.removeEventListener("blur", hide);
    };
  }, [root]);

  if (!shown) return null;
  return (
    <div className="image-hover" style={{ left: shown.left, top: shown.top, bottom: shown.bottom }}>
      {failed ? (
        <div className="image-hover-error">图片无法显示</div>
      ) : (
        <img src={convertFileSrc(shown.path)} alt="" onError={() => setFailed(true)} />
      )}
    </div>
  );
}
