/** hopper's mark: its name in block letters beside the mark, a hopper: tasks wait above it and drop out its spout one at a time. */

const LETTERS = [
  "██╗  ██╗ ██████╗ ██████╗ ██████╗ ███████╗██████╗",
  "██║  ██║██╔═══██╗██╔══██╗██╔══██╗██╔════╝██╔══██╗",
  "███████║██║   ██║██████╔╝██████╔╝█████╗  ██████╔╝",
  "██╔══██║██║   ██║██╔═══╝ ██╔═══╝ ██╔══╝  ██╔══██╗",
  "██║  ██║╚██████╔╝██║     ██║     ███████╗██║  ██║",
  "╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝     ╚══════╝╚═╝  ╚═╝",
];

/**
 * The mark on an 18 by 12 grid: two tasks waiting above a funnel, and one
 * dropping out of its spout. The first and last rows are blank so a terminal,
 * drawing two rows a character, gives it as many rows as the letters.
 */
export const MARK_PIXELS = [
  "..................",
  "..................",
  "...####....####...",
  "...####....####...",
  "..................",
  "##################",
  ".###..........###.",
  "....###....###....",
  "......##..##......",
  ".......#..#.......",
  "........##........",
  "..................",
];

/** The mark as text, two pixels a character, for terminals; the page draws MARK_PIXELS as an image instead. */
const MARK = Array.from({ length: MARK_PIXELS.length / 2 }, (_, row) =>
  [...MARK_PIXELS[row * 2]!]
    .map((top, col) => {
      const t = top === "#", b = MARK_PIXELS[row * 2 + 1]![col] === "#";
      return t && b ? "█" : t ? "▀" : b ? "▄" : " ";
    })
    .join("")
    .trimEnd(),
);

/** The letters alone, for the page, which sets the mark beside them as an image. */
export const LETTERS_ONLY = LETTERS.join("\n");

const WIDTH = Math.max(...LETTERS.map((line) => line.length));
export const WORDMARK = LETTERS.map((line, i) => `${line.padEnd(WIDTH)}  ${MARK[i]}`.trimEnd()).join("\n");

/** The person's line for hopper, verbatim. */
export const TAGLINE = "Line up the work, and your agents take it from there.";
/** What hopper is, in one line. Every place that describes hopper in a line uses this or TAGLINE, verbatim. */
export const SUMMARY = "Feeds your queued tasks to agents, a few at a time, as they become ready.";

/** The pixel mark as an SVG drawn from its grid, in the current color: beside the block letters. */
export const MARK_PIXEL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" viewBox="0 0 ${MARK_PIXELS[0]!.length} ${MARK_PIXELS.length}" shape-rendering="crispEdges" fill="currentColor">${MARK_PIXELS.flatMap((row, y) =>
  [...row].flatMap((pixel, x) => (pixel === "#" ? [`<rect x="${x}" y="${y}" width="1" height="1"/>`] : [])),
).join("")}</svg>`;

/** The mark drawn smooth, as line art, for the page's header: `currentColor` strokes it, the panel fills the tasks and the funnel. */
export const MARK_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" viewBox="0 0 40 30"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round">` +
  `<rect x="8" y="1" width="6" height="6" rx="1" fill="var(--panel)"/><rect x="26" y="1" width="6" height="6" rx="1" fill="var(--panel)"/>` +
  `<path d="M1 10H39L24 19V23H16V19Z" fill="var(--panel)" stroke="none"/><path d="M16 23V19L1 10H39L24 19V23"/>` +
  `<rect x="17.5" y="25" width="5" height="4" rx="1" fill="var(--panel)"/></g></svg>`;

/**
 * The mark as the page's favicon: square, and solid so it reads at 16
 * pixels, leaf green in the tab's light or dark.
 */
export const MARK_ICON =
  `<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" viewBox="0 0 40 40"><style>svg{--ink:#3d7a1f}@media (prefers-color-scheme:dark){svg{--ink:#9ad36a}}</style><g fill="var(--ink)">` +
  `<rect x="6" y="1" width="10" height="9" rx="2"/><rect x="24" y="1" width="10" height="9" rx="2"/>` +
  `<path d="M1 13H39L25 26V30H15V26Z"/>` +
  `<rect x="15" y="32" width="10" height="7" rx="2"/></g></svg>`;

/** Colors only for a terminal that wants them (https://no-color.org). hopper's is leaf green, beside honed's teal and waypoint's terracotta. */
export function palette(enabled: boolean) {
  const paint = (code: string) => (text: string) => (enabled ? `\x1b[${code}m${text}\x1b[0m` : text);
  return { mark: paint("38;5;70"), bold: paint("1"), dim: paint("2") };
}

/** Whether to paint: a terminal, and NO_COLOR not set (https://no-color.org). */
export function wantsColor(env: NodeJS.ProcessEnv, isTTY: boolean | undefined): boolean {
  return Boolean(isTTY) && !env.NO_COLOR;
}

export interface BannerInfo {
  version: string;
  /** The commit it was built at; `unknown` from a checkout with no build.json. */
  commit: string;
  /** Where people and scripts reach it. */
  url: string;
  db: string;
  /** Seconds between looks. */
  every: number;
  color: boolean;
}

/** What hopper says when it starts: what it is, where its page and API are, and where it keeps its data. */
export function banner(b: BannerInfo): string {
  const c = palette(b.color);
  return [
    "",
    c.mark(WORDMARK),
    c.dim(b.commit === "unknown" ? `v${b.version}` : `v${b.version} (${b.commit.slice(0, 7)})`),
    "",
    c.bold(TAGLINE),
    SUMMARY,
    "",
    `  ${c.mark("▸")} Page      ${b.url}/`,
    `  ${c.mark("▸")} API       ${b.url}/queue`,
    "",
    `  ${c.dim(`looking every ${b.every}s, data in ${b.db}`)}`,
    `  ${c.dim("Ctrl+C to stop.")}`,
    "",
  ].join("\n");
}
