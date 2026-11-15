// The dungeon's own colour and the fitting of its name on the sign. Pure, no three.js:
// testable in node.

/**
 * Hues told apart at night, one per dungeon. A single green and no teal: two greens, or a
 * green next to a teal, looked alike on the pennants.
 */
export const DUNGEON_PALETTE = [
  '#d1343a', // crimson
  '#e8792b', // orange
  '#e6c229', // gold
  '#3fae4a', // green
  '#3fa9f5', // sky
  '#3b5bdb', // royal blue
  '#8e44c9', // violet
  '#d6409f', // magenta
  '#ece3cf', // ivory
] as const;

/** The sessions out of any environment: neutral grey, not a real dungeon. */
export const VIRTUAL_COLOR = '#8a8f98';

/** 32-bit FNV-1a hash of a string. */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The dungeon's colour, from its id: renaming the dungeon keeps it. */
export function dungeonColor(envId: string, virtual = false): string {
  if (virtual) return VIRTUAL_COLOR;
  return DUNGEON_PALETTE[fnv1a(envId) % DUNGEON_PALETTE.length];
}

/** Width of `text` drawn at font size `size`, in the same unit as the maximum width. */
export type Measure = (text: string, size: number) => number;

/** Longest prefix `fitLabel` tries when it has to cut a name. */
const MAX_CHARS = 120;

export interface FittedLabel {
  text: string;
  size: number;
}

/**
 * The largest font size from `max` down to `min` (steps of `step`) at which `text` fits in
 * `maxWidth`. Still too wide at `min`: the text is cut and ends with an ellipsis.
 */
export function fitLabel(text: string, maxWidth: number, measure: Measure, max = 150, min = 64, step = 4): FittedLabel {
  // A non-positive step would never reach `min`.
  const stride = step > 0 ? step : 1;
  // The last step is clamped to `min`, so `min` itself is always tried.
  for (let size = Math.max(max, min); ; size = Math.max(min, size - stride)) {
    if (measure(text, size) <= maxWidth) return { text, size };
    if (size <= min) break;
  }
  // Cut by code points (a surrogate pair is never split; a grapheme cluster such as a ZWJ
  // emoji may be). Only the first MAX_CHARS are tried: far more than a sign can show, and it
  // bounds the measuring of an absurdly long name.
  const chars = Array.from(text).slice(0, MAX_CHARS);
  for (let n = chars.length - 1; n > 0; n--) {
    const cut = `${chars.slice(0, n).join('').trimEnd()}…`;
    if (measure(cut, min) <= maxWidth) return { text: cut, size: min };
  }
  return { text: '…', size: min };
}
