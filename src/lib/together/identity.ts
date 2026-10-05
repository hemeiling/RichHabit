import { EVENT_COLORS } from "@/lib/importantDates";

/**
 * A Together board's visual identity: a colour and an initial, both derived —
 * nothing is stored, so there is no schema behind it and every member of a
 * board sees the same mark.
 *
 * The colour is one of the palette Important Dates already uses, chosen by a
 * stable hash of the board's id, so RichHabit has one colour vocabulary. The
 * mark's text, fill and hairlines are computed per theme here rather than left
 * to the browser, so their contrast is a tested fact: the initial always reaches
 * MIN_CONTRAST (4.6:1, above WCAG AA) against its own fill, in light and in dark.
 */

/** Slate is left out: a grey board reads as archived or disabled. */
export const BOARD_COLORS = EVENT_COLORS.filter((c) => c.key !== "slate");

/** FNV-1a over the id: stable, well spread, and cheap. */
export function boardColor(id: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return BOARD_COLORS[h % BOARD_COLORS.length].hex;
}

/** The first character as people perceive it — 头 in 头绳生意, H in headband, an emoji whole. */
export function boardInitial(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "·";
  let first: string;
  try {
    const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    first = seg.segment(trimmed)[Symbol.iterator]().next().value?.segment ?? [...trimmed][0];
  } catch {
    first = [...trimmed][0];
  }
  return first.toLocaleUpperCase();
}

/* ------------------------------- colour maths ------------------------------ */

type RGB = [number, number, number];
const toRgb = (hex: string): RGB => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as RGB;
const toHex = (c: RGB) => `#${c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;
/** `amount` of `a` over `b`. */
const mix = (a: string, b: string, amount: number) => {
  const [x, y] = [toRgb(a), toRgb(b)];
  return toHex([0, 1, 2].map((i) => x[i] * amount + y[i] * (1 - amount)) as RGB);
};
const luminance = (hex: string) => {
  const [r, g, b] = toRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** WCAG contrast ratio. */
export function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (l1 + 0.05) / (l2 + 0.05);
}

const SURFACE = { light: "#FFFFFF", dark: "#17191C" } as const;
/** Every initial reaches at least this against its fill — above WCAG AA's 4.5:1. */
export const MIN_CONTRAST = 4.6;

export interface MarkColors { ink: string; fill: string; edge: string; grid: string }

/** The mark's colours for one theme: a soft fill of the colour, and an initial dark (or light) enough to read on it. */
function forTheme(hex: string, theme: keyof typeof SURFACE): MarkColors {
  const surface = SURFACE[theme];
  const fill = mix(hex, surface, theme === "light" ? 0.13 : 0.24);
  const toward = theme === "light" ? "#000000" : "#FFFFFF";
  let ink = hex;
  for (let step = 0; step <= 20 && contrast(ink, fill) < MIN_CONTRAST; step++) ink = mix(toward, hex, step * 0.05);
  return { ink, fill, edge: mix(hex, fill, theme === "light" ? 0.3 : 0.38), grid: mix(hex, fill, theme === "light" ? 0.14 : 0.2) };
}

export function markColors(hex: string): { light: MarkColors; dark: MarkColors } {
  return { light: forTheme(hex, "light"), dark: forTheme(hex, "dark") };
}
