import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useState } from "react";
import { toast } from "./actions";

export type ThemePref = "auto" | "light" | "dark";

const ZOOM_KEY = "smp.zoom";
const THEME_KEY = "smp.theme";
const TOP_KEY = "smp.onTop";
/** Browser-like zoom levels. */
const LEVELS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
/** Wheel distance (in unzoomed pixels) per zoom step: one mouse notch, or a few touchpad pinch events. */
const WHEEL_STEP = 50;

function loadZoom(): number {
  const z = Number(localStorage.getItem(ZOOM_KEY));
  return LEVELS.includes(z) ? z : 1;
}

function loadTheme(): ThemePref {
  const t = localStorage.getItem(THEME_KEY);
  return t === "light" || t === "dark" ? t : "auto";
}

/**
 * Window-level preferences persisted across launches: Ctrl+wheel zoom (also Ctrl+0 / Ctrl+= / Ctrl+-),
 * light/dark theme and always-on-top.
 */
export function useWindowPrefs() {
  const [zoom, setZoom] = useState(loadZoom);
  const [theme, setTheme] = useState(loadTheme);
  const [onTop, setOnTop] = useState(() => localStorage.getItem(TOP_KEY) === "1");

  useEffect(() => {
    localStorage.setItem(ZOOM_KEY, String(zoom));
    getCurrentWebview().setZoom(zoom).catch(console.error);
  }, [zoom]);

  useEffect(() => {
    localStorage.setItem(THEME_KEY, theme);
    // CSS colors follow `color-scheme`, forced via data-theme (see :root in styles.css). "auto" resolves the
    // system theme from the window rather than prefers-color-scheme: once setTheme("light"|"dark") has run,
    // WebView2 keeps that scheme even after setTheme(null).
    const win = getCurrentWindow();
    const apply = (t: "light" | "dark" | null) => (document.documentElement.dataset.theme = t ?? "light");
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    win
      .setTheme(theme === "auto" ? null : theme)
      .then(() => (theme === "auto" ? win.theme() : theme))
      .then((t) => !cancelled && apply(t))
      .catch(console.error);
    if (theme === "auto")
      win
        .onThemeChanged(({ payload }) => apply(payload))
        .then((u) => (cancelled ? u() : (unlisten = u)))
        .catch(console.error);
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(TOP_KEY, onTop ? "1" : "0");
    getCurrentWindow().setAlwaysOnTop(onTop).catch(console.error);
  }, [onTop]);

  useEffect(() => {
    let current = zoom;
    let acc = 0;
    const step = (dir: number) => {
      const i = LEVELS.indexOf(current) + dir;
      if (i < 0 || i >= LEVELS.length) return;
      current = LEVELS[i];
      setZoom(current);
      toast(`缩放 ${Math.round(current * 100)}%`);
    };
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      // deltaY is in CSS pixels, which shrink as the zoom grows; scale back so a notch is a notch at any zoom.
      acc += e.deltaY * current;
      if (Math.abs(acc) < WHEEL_STEP) return;
      step(acc < 0 ? 1 : -1);
      acc = 0;
    };
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key === "0") {
        current = 1;
        setZoom(1);
        toast("缩放 100%");
      } else if (e.key === "=" || e.key === "+") step(1);
      else if (e.key === "-") step(-1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
    };
    // `zoom` only seeds `current`; re-subscribing on every step would drop the accumulated wheel delta.
  }, []);

  const cycleTheme = useCallback(() => setTheme((t) => (t === "auto" ? "light" : t === "light" ? "dark" : "auto")), []);
  const toggleOnTop = useCallback(() => setOnTop((v) => !v), []);
  return { zoom, theme, cycleTheme, onTop, toggleOnTop };
}
