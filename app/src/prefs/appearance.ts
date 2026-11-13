import { useCallback, useEffect, useState } from "react";

/** Reading style of one side of the conversation. Empty / 0 means the built-in default. */
export interface RoleStyle {
  /** CSS font-family; "" = default. */
  font: string;
  /** Pixels; 0 = default. */
  size: number;
  /** CSS color; "" = the theme's text color. */
  color: string;
}

export type Spacing = "compact" | "normal" | "loose";
export type Width = "narrow" | "normal" | "wide" | "full";

export interface Appearance {
  user: RoleStyle;
  agent: RoleStyle;
  /** Line height and paragraph gap of the conversation text. */
  spacing: Spacing;
  /** How wide the conversation column grows when the window is enlarged. */
  width: Width;
}

export const SIZE_MIN = 12;
export const SIZE_MAX = 26;
/** What `size: 0` renders at; keep in sync with `--msg-size` in styles.css. */
export const DEFAULT_SIZE = 16;

const NONE: RoleStyle = { font: "", size: 0, color: "" };
export const DEFAULT_APPEARANCE: Appearance = { user: NONE, agent: NONE, spacing: "normal", width: "normal" };

export const SPACINGS: Array<[Spacing, string, { lh: string; para: string }]> = [
  ["compact", "紧凑", { lh: "1.55", para: "0.5em" }],
  ["normal", "标准", { lh: "1.75", para: "0.8em" }],
  ["loose", "宽松", { lh: "1.95", para: "1.05em" }],
];

export const WIDTHS: Array<[Width, string, string]> = [
  ["narrow", "窄", "860px"],
  ["normal", "适中", "1100px"],
  ["wide", "宽", "1400px"],
  ["full", "铺满", "none"],
];

/** Font choices for the 提问/回答 text; fonts the machine lacks fall back to the next family. */
export const FONTS: Array<[css: string, label: string]> = [
  ["", "默认（系统无衬线）"],
  ['"Microsoft YaHei UI", "Microsoft YaHei", sans-serif', "微软雅黑"],
  ['DengXian, "等线", sans-serif', "等线"],
  ['"Noto Sans SC", "Source Han Sans SC", "Microsoft YaHei UI", sans-serif', "思源黑体"],
  ['SimSun, "宋体", serif', "宋体"],
  ['KaiTi, "楷体", serif', "楷体"],
  ['Georgia, SimSun, serif', "Georgia 衬线"],
  ['"Cascadia Code", Consolas, "Microsoft YaHei UI", monospace', "等宽"],
];

/** A font name typed by the user becomes a quoted family with a generic fallback; full CSS lists pass through. */
export function fontCss(input: string): string {
  const s = input.replace(/[;{}<>\\]/g, "").trim();
  if (!s) return "";
  return /[",]/.test(s) ? s : `"${s}", sans-serif`;
}

const COLOR = /^#[0-9a-f]{6}$/i;

function cleanRole(v: unknown): RoleStyle {
  const r = (v && typeof v === "object" ? v : {}) as Partial<RoleStyle>;
  const size = Number(r.size);
  return {
    font: typeof r.font === "string" ? fontCss(r.font) : "",
    size: Number.isFinite(size) && size >= SIZE_MIN && size <= SIZE_MAX ? Math.round(size) : 0,
    color: typeof r.color === "string" && COLOR.test(r.color) ? r.color : "",
  };
}

/** Reads stored (or otherwise untrusted) preferences, replacing anything invalid with the default. */
export function cleanAppearance(v: unknown): Appearance {
  const a = (v && typeof v === "object" ? v : {}) as Partial<Appearance>;
  return {
    user: cleanRole(a.user),
    agent: cleanRole(a.agent),
    spacing: SPACINGS.some(([id]) => id === a.spacing) ? (a.spacing as Spacing) : "normal",
    width: WIDTHS.some(([id]) => id === a.width) ? (a.width as Width) : "normal",
  };
}

/** The CSS custom properties that carry the preferences; unset ones fall back to the stylesheet defaults. */
export function cssVars(a: Appearance): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, r] of [["user", a.user], ["agent", a.agent]] as const) {
    if (r.font) out[`--${name}-font`] = r.font;
    if (r.size) out[`--${name}-size`] = `${r.size}px`;
    if (r.color) out[`--${name}-color`] = r.color;
  }
  const sp = SPACINGS.find(([id]) => id === a.spacing)![2];
  out["--lh"] = sp.lh;
  out["--para"] = sp.para;
  out["--content-max"] = WIDTHS.find(([id]) => id === a.width)![2];
  return out;
}

const KEY = "smp.appearance";
const ALL_VARS = ["user", "agent"].flatMap((n) => ["font", "size", "color"].map((k) => `--${n}-${k}`)).concat(["--lh", "--para", "--content-max"]);

function load(): Appearance {
  try {
    return cleanAppearance(JSON.parse(localStorage.getItem(KEY) ?? "null"));
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

/** Fonts, sizes, colors, spacing and width of the conversation, persisted across launches. */
export function useAppearance() {
  const [appearance, setAppearance] = useState(load);

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(appearance));
    const root = document.documentElement.style;
    ALL_VARS.forEach((v) => root.removeProperty(v));
    for (const [k, v] of Object.entries(cssVars(appearance))) root.setProperty(k, v);
  }, [appearance]);

  const update = useCallback((fn: (a: Appearance) => Appearance) => setAppearance((a) => cleanAppearance(fn(a))), []);
  const reset = useCallback(() => setAppearance(DEFAULT_APPEARANCE), []);
  return { appearance, update, reset };
}
