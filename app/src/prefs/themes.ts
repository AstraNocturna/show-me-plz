/** Color themes. "auto" follows Windows; the others are fixed palettes (see `data-palette` in styles.css). */
export type ThemePref = "auto" | "light" | "dark" | "solarized" | "nord" | "onedark";

interface ThemeInfo {
  id: ThemePref;
  label: string;
  /** The color scheme a fixed theme uses (native controls, scrollbars, code highlighting); null: follows the system. */
  scheme: "light" | "dark" | null;
  /** Page, text and accent colors, for the swatch in the menu. */
  swatch: [bg: string, fg: string, accent: string];
}

export const THEMES: ThemeInfo[] = [
  { id: "auto", label: "跟随系统", scheme: null, swatch: ["#f6f7f9", "#1f2328", "#0969da"] },
  { id: "light", label: "浅色", scheme: "light", swatch: ["#f6f7f9", "#1f2328", "#0969da"] },
  { id: "dark", label: "深色", scheme: "dark", swatch: ["#15171b", "#e6e8eb", "#4493f8"] },
  { id: "solarized", label: "护眼 Solarized", scheme: "light", swatch: ["#fdf6e3", "#4a5f66", "#268bd2"] },
  { id: "nord", label: "Nord", scheme: "dark", swatch: ["#2e3440", "#d8dee9", "#88c0d0"] },
  { id: "onedark", label: "One Dark", scheme: "dark", swatch: ["#21252b", "#b6bdca", "#61afef"] },
];

export const isTheme = (v: unknown): v is ThemePref => THEMES.some((t) => t.id === v);
export const schemeOf = (id: ThemePref) => THEMES.find((t) => t.id === id)?.scheme ?? null;
/** Fixed palettes other than the two defaults carry a `data-palette` attribute. */
export const paletteOf = (id: ThemePref) => (id === "solarized" || id === "nord" || id === "onedark" ? id : null);
