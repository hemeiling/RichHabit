/**
 * The workspace's icons, drawn in the same open-stroke language as the
 * sidebar's: 24×24, round caps, no fills.
 */
export function Icon({ d, size = 18, strokeWidth = 1.7 }: { d: string; size?: number; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      style={{ flex: "none" }}>
      <path d={d} />
    </svg>
  );
}

export const ICONS = {
  /* Two sparks: the larger one the answer, the smaller one the question. */
  spark: "M11 3.5c.7 4.3 2.9 6.5 7.2 7.2-4.3.7-6.5 2.9-7.2 7.2-.7-4.3-2.9-6.5-7.2-7.2 4.3-.7 6.5-2.9 7.2-7.2z M18.5 15c.3 1.7 1.1 2.5 2.8 2.8-1.7.3-2.5 1.1-2.8 2.8-.3-1.7-1.1-2.5-2.8-2.8 1.7-.3 2.5-1.1 2.8-2.8z",
  close: "M6 6l12 12 M18 6L6 18",
  plus: "M12 5v14 M5 12h14",
  menu: "M4 7h16 M4 12h16 M4 17h10",
  expand: "M14 4h6v6 M10 20H4v-6 M20 4l-6.5 6.5 M4 20l6.5-6.5",
  shrink: "M4 14h6v6 M20 10h-6V4 M10 14l-6.5 6.5 M14 10l6.5-6.5",
  send: "M12 19V5 M5.5 11.5L12 5l6.5 6.5",
  stop: "M8 8h8v8H8z",
  paperclip: "M20.5 11.5l-8.2 8.2a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8",
  copy: "M9 9h10v11H9z M5 15V4h10",
  check: "M5 12.5l4.5 4.5L19 7.5",
  retry: "M20 11a8 8 0 1 0-2.3 5.7 M20 4v7h-7",
  continue: "M5 12h13 M13 6l6 6-6 6",
  more: "M5 12h.01 M12 12h.01 M19 12h.01",
  folder: "M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z",
  chat: "M20 15a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z",
  file: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z M14 3v5h5",
  image: "M4 5h16v14H4z M4 16l4.5-4.5 3.5 3.5 2.5-2.5L20 18 M15.5 9.5h.01",
  trash: "M4 7h16 M10 11v6 M14 11v6 M6 7l1 13h10l1-13 M9 7V4h6v3",
  back: "M15 5l-7 7 7 7",
  upload: "M12 16V4 M7 9l5-5 5 5 M5 20h14",
  settings: "M4 7h10 M18 7h2 M4 17h2 M10 17h10 M14 5v4 M6 15v4",
} as const;
