import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "./actions";
import { isTheme, paletteOf, schemeOf, type ThemePref } from "./prefs/themes";

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
  return isTheme(t) ? t : "auto";
}

/**
 * Window-level preferences persisted across launches: Ctrl+wheel zoom (also Ctrl+0 / Ctrl+= / Ctrl+-),
 * color theme and always-on-top.
 */
export function useWindowPrefs() {
  const [zoom, setZoom] = useState(loadZoom);
  const [theme, setTheme] = useState(loadTheme);
  const [onTop, setOnTop] = useState(() => localStorage.getItem(TOP_KEY) === "1");
  // Read by the wheel handler between renders, so quick notches step from the latest level.
  const zoomRef = useRef(zoom);

  const applyZoom = useCallback((z: number) => {
    zoomRef.current = z;
    setZoom(z);
    toast(`缩放 ${Math.round(z * 100)}%`);
  }, []);
  const stepZoom = useCallback(
    (dir: 1 | -1) => {
      const i = LEVELS.indexOf(zoomRef.current) + dir;
      if (i >= 0 && i < LEVELS.length) applyZoom(LEVELS[i]);
    },
    [applyZoom],
  );
  const resetZoom = useCallback(() => applyZoom(1), [applyZoom]);

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
    const apply = (t: "light" | "dark" | null) => {
      const root = document.documentElement;
      root.dataset.theme = t ?? "light";
      const palette = paletteOf(theme);
      if (palette) root.dataset.palette = palette;
      else delete root.dataset.palette;
    };
    const scheme = schemeOf(theme);
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    win
      .setTheme(scheme)
      .then(() => scheme ?? win.theme())
      .then((t) => !cancelled && apply(t))
      .catch(console.error);
    if (!scheme)
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
    let acc = 0;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      // deltaY is in CSS pixels, which shrink as the zoom grows; scale back so a notch is a notch at any zoom.
      acc += e.deltaY * zoomRef.current;
      if (Math.abs(acc) < WHEEL_STEP) return;
      stepZoom(acc < 0 ? 1 : -1);
      acc = 0;
    };
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key === "0") resetZoom();
      else if (e.key === "=" || e.key === "+") stepZoom(1);
      else if (e.key === "-") stepZoom(-1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
    };
  }, [stepZoom, resetZoom]);

  const toggleOnTop = useCallback(() => setOnTop((v) => !v), []);
  return { zoom, stepZoom, resetZoom, theme, setTheme, onTop, toggleOnTop };
}
