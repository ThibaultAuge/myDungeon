import { describe, expect, it } from 'vitest';
import { DUNGEON_PALETTE, VIRTUAL_COLOR, dungeonColor, fitLabel, fnv1a, type Measure } from '../src/scene/heraldry.ts';

// heraldry.ts is pure: the dungeon colour and the fitting of its name on the sign. The
// three.js sign (DungeonSign.tsx) is not imported here.

const HEX = /^#[0-9a-f]{6}$/i;

/** Fake text width: half the font size per code point. */
const byCodePoint: Measure = (text, size) => Array.from(text).length * size * 0.5;
/** Fake text width: half the font size per UTF-16 unit, so a split surrogate would still "fit". */
const byUnit: Measure = (text, size) => text.length * size * 0.5;

/** True when the string holds no lone (unpaired) surrogate. */
function wellFormed(text: string): boolean {
  return /^(?:[\uD800-\uDBFF][\uDC00-\uDFFF]|[^\uD800-\uDFFF])*$/.test(text);
}

// ---------------------------------------------------------------- palette

describe('DUNGEON_PALETTE and VIRTUAL_COLOR', () => {
  /**
   * Verifies that the palette holds nine valid #rrggbb colours
   */
  it('holds nine #rrggbb colours', () => {
    expect(DUNGEON_PALETTE).toHaveLength(9);
    for (const c of DUNGEON_PALETTE) expect(c).toMatch(HEX);
  });

  /**
   * Verifies that no two palette entries are the same colour (case-insensitive)
   */
  it('has distinct entries', () => {
    const lower = DUNGEON_PALETTE.map((c) => c.toLowerCase());
    expect(new Set(lower).size).toBe(lower.length);
  });

  /**
   * Verifies that the virtual grey is a valid colour that no real dungeon can get
   */
  it('keeps VIRTUAL_COLOR valid and out of the palette', () => {
    expect(VIRTUAL_COLOR).toMatch(HEX);
    expect(DUNGEON_PALETTE.map((c) => c.toLowerCase())).not.toContain(VIRTUAL_COLOR.toLowerCase());
  });
});

// ---------------------------------------------------------------- fnv1a

describe('fnv1a', () => {
  /**
   * Verifies that the hash matches the published 32-bit FNV-1a test vectors
   */
  it.each([
    ['', 0x811c9dc5],
    ['a', 0xe40c292c],
    ['foobar', 0xbf9cf968],
  ])('hashes %j to the reference value', (text, expected) => {
    expect(fnv1a(text)).toBe(expected);
  });

  /**
   * Verifies that the hash is always an unsigned 32-bit integer
   */
  it('returns an unsigned 32-bit integer', () => {
    for (const s of ['', 'a', 'foobar', 'env-1', 'é', '😀', 'x'.repeat(500)]) {
      const h = fnv1a(s);
      expect(Number.isInteger(h), s).toBe(true);
      expect(h, s).toBeGreaterThanOrEqual(0);
      expect(h, s).toBeLessThanOrEqual(0xffffffff);
    }
  });

  /**
   * Verifies that the same input always gives the same hash and close inputs differ
   */
  it('is deterministic and tells close strings apart', () => {
    expect(fnv1a('dungeon')).toBe(fnv1a('dungeon'));
    expect(fnv1a('dungeon-1')).not.toBe(fnv1a('dungeon-2'));
  });
});

// ---------------------------------------------------------------- dungeonColor

describe('dungeonColor', () => {
  const IDS = Array.from({ length: 50 }, (_, i) => `env-${i}`);

  /**
   * Verifies that one id always maps to one colour
   */
  it('is deterministic', () => {
    for (const id of IDS) expect(dungeonColor(id)).toBe(dungeonColor(id));
  });

  /**
   * Verifies that a real dungeon always gets a palette colour, never the virtual grey
   */
  it('always returns a palette member for a real dungeon', () => {
    for (const id of ['', ...IDS]) {
      expect(DUNGEON_PALETTE as readonly string[]).toContain(dungeonColor(id));
      expect(dungeonColor(id, false)).toBe(dungeonColor(id));
    }
  });

  /**
   * Verifies that the colour is the palette entry picked by the id hash
   */
  it('picks palette[fnv1a(id) % length]', () => {
    for (const id of IDS) expect(dungeonColor(id)).toBe(DUNGEON_PALETTE[fnv1a(id) % DUNGEON_PALETTE.length]);
  });

  /**
   * Verifies that the virtual dungeon is grey whatever its id
   */
  it('returns VIRTUAL_COLOR for a virtual dungeon regardless of id', () => {
    for (const id of ['', ...IDS]) expect(dungeonColor(id, true)).toBe(VIRTUAL_COLOR);
  });

  /**
   * Verifies that several ids spread over more than one colour
   */
  it('spreads several ids over several colours', () => {
    expect(new Set(IDS.map((id) => dungeonColor(id))).size).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------- fitLabel

describe('fitLabel', () => {
  /**
   * Verifies that a text that fits at the maximum size keeps that size, untouched
   */
  it('keeps the max size when the text fits (width equal to the limit fits)', () => {
    // 4 chars at 150: 4 × 75 = 300, exactly the limit.
    expect(fitLabel('abcd', 300, byCodePoint)).toEqual({ text: 'abcd', size: 150 });
  });

  /**
   * Verifies that an empty text fits at the maximum size
   */
  it('returns an empty text at max size', () => {
    expect(fitLabel('', 10, byCodePoint)).toEqual({ text: '', size: 150 });
  });

  /**
   * Verifies that a text too wide at max shrinks to the largest step that fits
   */
  it('shrinks to the largest fitting step', () => {
    // 6 chars: 3 × size ≤ 300 → size ≤ 100; steps 150, 146, … → 98.
    const r = fitLabel('abcdef', 300, byCodePoint);
    expect(r).toEqual({ text: 'abcdef', size: 98 });
    expect(byCodePoint(r.text, r.size)).toBeLessThanOrEqual(300);
    expect(byCodePoint(r.text, r.size + 4)).toBeGreaterThan(300);
  });

  /**
   * Verifies that custom max, min and step are honoured
   */
  it('honours custom max, min and step', () => {
    // 3 × size ≤ 300 → size ≤ 100; steps 120, 110, 100.
    expect(fitLabel('abcdef', 300, byCodePoint, 120, 60, 10)).toEqual({ text: 'abcdef', size: 100 });
  });

  /**
   * Verifies that a text fitting only at the minimum size is not truncated
   */
  it('keeps the whole text at min size when it fits only there', () => {
    // Regression guard: 64 is not on the 4-step ladder from 150 (…, 66, 62), so the last step
    // is clamped to min. 6 chars: 198 at 66 (> 195), 192 at 64 (≤ 195).
    expect(fitLabel('abcdef', 195, byCodePoint)).toEqual({ text: 'abcdef', size: 64 });
  });

  /**
   * Verifies that a text too wide even at min is cut with an ellipsis at min size
   */
  it('truncates with an ellipsis at min size', () => {
    // At 64, 32 per char: ≤ 100 → at most 3 chars, ellipsis included.
    expect(fitLabel('abcdefgh', 100, byCodePoint)).toEqual({ text: 'ab…', size: 64 });
  });

  /**
   * Verifies that truncation keeps the longest prefix that fits
   */
  it('keeps the longest fitting prefix', () => {
    // ≤ 200 at 64 → at most 6 chars: 5 letters + ellipsis.
    const r = fitLabel('abcdefghijkl', 200, byCodePoint);
    expect(r).toEqual({ text: 'abcde…', size: 64 });
  });

  /**
   * Verifies that truncation never splits an emoji's surrogate pair
   */
  it('never splits a surrogate pair', () => {
    // byUnit counts UTF-16 units: ≤ 128 at 64 → at most 4 units. A unit cut would give
    // '😀\uD83D…' (4 units); a code-point cut gives '😀…' (3 units).
    const r = fitLabel('😀😀😀😀😀', 128, byUnit);
    expect(r).toEqual({ text: '😀…', size: 64 });
    expect(wellFormed(r.text)).toBe(true);
  });

  /**
   * Verifies that trailing spaces are trimmed before the ellipsis
   */
  it('trims trailing space before the ellipsis', () => {
    // ≤ 128 at 64 → at most 4 chars; the prefix 'ab ' becomes 'ab…', not 'ab …'.
    expect(fitLabel('ab cdefgh', 128, byCodePoint)).toEqual({ text: 'ab…', size: 64 });
  });

  /**
   * Verifies that a lone ellipsis at min size is returned when no prefix fits
   */
  it('falls back to a lone ellipsis when not even one char fits', () => {
    expect(fitLabel('abcdef', 10, byCodePoint)).toEqual({ text: '…', size: 64 });
  });

  /**
   * Verifies that a single too-wide character falls back to a lone ellipsis
   */
  it('falls back to a lone ellipsis for a single too-wide character', () => {
    expect(fitLabel('W', 10, byCodePoint)).toEqual({ text: '…', size: 64 });
  });

  /**
   * Verifies that every truncated result fits at min size and ends with the ellipsis
   */
  it('returns a fitting, ellipsis-terminated label whenever it truncates', () => {
    for (const w of [70, 100, 150, 200, 250]) {
      const r = fitLabel('The Dungeon Of Endless Queues', w, byCodePoint);
      expect(r.size, `width ${w}`).toBe(64);
      expect(r.text.endsWith('…'), `width ${w}`).toBe(true);
      expect(byCodePoint(r.text, r.size), `width ${w}`).toBeLessThanOrEqual(w);
      expect(r.text, `width ${w}`).not.toMatch(/\s…$/);
    }
  });

  // ---------------------------------------------------------- degenerate parameters

  /** Wraps a measure to record every size it was called with. */
  function recording(inner: Measure): { measure: Measure; sizes: number[]; texts: string[] } {
    const sizes: number[] = [];
    const texts: string[] = [];
    return {
      sizes,
      texts,
      measure: (text, size) => {
        sizes.push(size);
        texts.push(text);
        return inner(text, size);
      },
    };
  }

  /**
   * Verifies that a zero, negative or NaN step still terminates at min size (text kept)
   */
  it.each([
    ['zero', 0],
    ['negative', -4],
    ['NaN', Number.NaN],
  ])('terminates with a %s step and returns the min-size fit', (_label, step) => {
    // 6 chars: 3 × size ≤ 192 → only size 64 fits (65 gives 195).
    const rec = recording(byCodePoint);
    expect(fitLabel('abcdef', 192, rec.measure, 150, 64, step)).toEqual({ text: 'abcdef', size: 64 });
    // Falls back to a stride of 1: every size from 150 down to 64 once, never below min.
    expect(rec.sizes).toHaveLength(150 - 64 + 1);
    expect(Math.min(...rec.sizes)).toBe(64);
  });

  /**
   * Verifies that a zero or negative step still truncates at min size when nothing fits
   */
  it.each([
    ['zero', 0],
    ['negative', -1],
  ])('truncates at min size with a %s step', (_label, step) => {
    expect(fitLabel('abcdefgh', 100, byCodePoint, 150, 64, step)).toEqual({ text: 'ab…', size: 64 });
  });

  /**
   * Verifies that max below min tries only min and returns size min when the text fits
   */
  it('returns size min when max < min', () => {
    const rec = recording(byCodePoint);
    expect(fitLabel('abcd', 1000, rec.measure, 50, 64)).toEqual({ text: 'abcd', size: 64 });
    expect(rec.sizes).toEqual([64]);
  });

  /**
   * Verifies that max below min truncates at size min when the text does not fit there
   */
  it('truncates at size min when max < min and the text is too wide', () => {
    const r = fitLabel('abcdefgh', 100, byCodePoint, 50, 64);
    expect(r).toEqual({ text: 'ab…', size: 64 });
  });

  // ---------------------------------------------------------- very long names

  const HUGE = 'a'.repeat(10_000);

  /**
   * Verifies that a 10 000-char name is cut from a bounded prefix and still fits
   */
  it('cuts a 10 000-char name to at most 121 code points that fit', () => {
    // At 64, 32 per char: 3872 allows 121 chars, more than the 120-char prefix can give.
    const rec = recording(byCodePoint);
    const r = fitLabel(HUGE, 3872, rec.measure);
    expect(r.size).toBe(64);
    expect(r.text.endsWith('…')).toBe(true);
    expect(Array.from(r.text).length).toBeLessThanOrEqual(121);
    expect(byCodePoint(r.text, r.size)).toBeLessThanOrEqual(3872);
    expect(HUGE.startsWith(r.text.slice(0, -1))).toBe(true);
    expect(rec.sizes.length).toBeLessThan(200);
  });

  /**
   * Verifies that a 10 000-char name on a narrow sign needs a bounded number of measures
   */
  it('measures a 10 000-char name a bounded number of times on a narrow sign', () => {
    // Worst case for the cut loop: only 3 chars fit, so it walks down the whole prefix.
    const rec = recording(byCodePoint);
    const r = fitLabel(HUGE, 100, rec.measure);
    expect(r).toEqual({ text: 'aa…', size: 64 });
    expect(rec.sizes.length).toBeLessThan(200);
    // No candidate measured during the cut is longer than the 120-char prefix + ellipsis.
    const cutTexts = rec.texts.filter((t) => t.endsWith('…'));
    expect(cutTexts.length).toBeGreaterThan(0);
    for (const t of cutTexts) expect(Array.from(t).length).toBeLessThanOrEqual(121);
  });
});
