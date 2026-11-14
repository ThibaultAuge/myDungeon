import type { DialogueEntry, TranscriptPage } from '@agent-office/shared';
import { describe, expect, it } from 'vitest';
import { EMPTY_DIALOGUE, entryOffset, mergeLatest, prependOlder, type DialogueState } from '../src/ui/dialogue.ts';

function e(key: string, text = `t${key}`): DialogueEntry {
  return { key, role: 'user', text };
}

function page(file: string, entries: DialogueEntry[], before: number | null): TranscriptPage {
  return { file, entries, before };
}

function state(file: string | null, entries: DialogueEntry[], older: number | null): DialogueState {
  return { file, entries, older };
}

const keys = (s: DialogueState) => s.entries.map((x) => x.key);

describe('entryOffset', () => {
  /**
   * Verifies that the line byte offset is read from the entry key
   */
  it.each([
    ['0:0', 0],
    ['123:4', 123],
    ['98765:0', 98765],
  ])('reads %s as %d', (key, expected) => {
    expect(entryOffset(e(key))).toBe(expected);
  });

  /**
   * Verifies that a key without a numeric offset falls back to 0
   */
  it.each([['garbage'], [''], [':3']])('returns 0 for key %j', (key) => {
    expect(entryOffset(e(key))).toBe(0);
  });

  /**
   * Verifies that tool entries are read the same way
   */
  it('works for tool entries', () => {
    expect(entryOffset({ key: '77:2', role: 'tool', tool: 'Read' })).toBe(77);
  });
});

describe('mergeLatest', () => {
  /**
   * Verifies that the first page fills an empty dialogue and sets the cursor
   */
  it('fills an empty dialogue', () => {
    const p = page('f1', [e('100:0'), e('200:0')], 100);
    expect(mergeLatest(EMPTY_DIALOGUE, p)).toEqual(state('f1', [e('100:0'), e('200:0')], 100));
  });

  /**
   * Verifies that a page from another transcript file replaces everything
   */
  it('starts over for another file', () => {
    const prev = state('f1', [e('0:0'), e('10:0')], null);
    const next = mergeLatest(prev, page('f2', [e('500:0')], 500));
    expect(next).toEqual(state('f2', [e('500:0')], 500));
  });

  /**
   * Verifies that entries older than the page are kept and the rest is replaced by the page
   */
  it('keeps older entries and replaces the overlapping ones', () => {
    const prev = state('f1', [e('0:0'), e('100:0'), e('200:0', 'partial')], null);
    const next = mergeLatest(prev, page('f1', [e('200:0', 'complete'), e('300:0')], 200));
    expect(next.entries).toEqual([e('0:0'), e('100:0'), e('200:0', 'complete'), e('300:0')]);
  });

  /**
   * Verifies that the older cursor is preserved when earlier entries were kept
   */
  it('keeps the older cursor when earlier entries are kept', () => {
    const prev = state('f1', [e('0:0'), e('100:0')], null);
    expect(mergeLatest(prev, page('f1', [e('100:0'), e('200:0')], 100)).older).toBeNull();
    const prev2 = state('f1', [e('50:0'), e('100:0')], 50);
    expect(mergeLatest(prev2, page('f1', [e('100:0'), e('200:0')], 100)).older).toBe(50);
  });

  /**
   * Verifies that the cursor comes from the page when no earlier entry is kept
   */
  it("takes the page's cursor when nothing older is kept", () => {
    // Nothing before 400 was loaded: the previous cursor (450) is obsolete.
    const prev = state('f1', [e('450:0')], 450);
    const next = mergeLatest(prev, page('f1', [e('400:0'), e('450:0'), e('500:0')], 400));
    expect(keys(next)).toEqual(['400:0', '450:0', '500:0']);
    expect(next.older).toBe(400);
  });

  /**
   * Verifies that a page reaching the start of the file replaces everything and clears the cursor
   */
  it('replaces everything when the page starts at the file start', () => {
    const prev = state('f1', [e('0:0', 'old'), e('100:0')], null);
    const next = mergeLatest(prev, page('f1', [e('0:0', 'new'), e('100:0'), e('200:0')], null));
    expect(next).toEqual(state('f1', [e('0:0', 'new'), e('100:0'), e('200:0')], null));
  });

  /**
   * Verifies that all blocks of a line are kept or dropped together
   */
  it('treats the blocks of one line as a unit', () => {
    const prev = state('f1', [e('0:0'), e('0:1'), e('100:0'), e('100:1')], null);
    const next = mergeLatest(prev, page('f1', [e('100:0'), e('100:1'), e('100:2')], 100));
    expect(keys(next)).toEqual(['0:0', '0:1', '100:0', '100:1', '100:2']);
  });

  /**
   * Verifies that an empty latest page keeps the older entries
   */
  it('keeps older entries for an empty page', () => {
    const prev = state('f1', [e('0:0'), e('100:0')], null);
    const next = mergeLatest(prev, page('f1', [], 100));
    expect(keys(next)).toEqual(['0:0']);
    expect(next.older).toBeNull();
  });

  /**
   * Verifies that the previous state is not mutated
   */
  it('does not mutate the previous state', () => {
    const prev = state('f1', [e('0:0'), e('100:0')], null);
    const copy = structuredClone(prev);
    mergeLatest(prev, page('f1', [e('100:0', 'x')], 100));
    mergeLatest(prev, page('f2', [], null));
    expect(prev).toEqual(copy);
  });
});

describe('prependOlder', () => {
  /**
   * Verifies that an older page is prepended and its cursor becomes the new one
   */
  it('prepends the older page and moves the cursor', () => {
    const prev = state('f1', [e('200:0'), e('300:0')], 200);
    const next = prependOlder(prev, page('f1', [e('0:0'), e('100:0')], null));
    expect(next).toEqual(state('f1', [e('0:0'), e('100:0'), e('200:0'), e('300:0')], null));
  });

  /**
   * Verifies that the cursor is taken from the page when more remains
   */
  it('keeps a non-null cursor from the page', () => {
    const prev = state('f1', [e('200:0')], 200);
    expect(prependOlder(prev, page('f1', [e('100:0')], 100)).older).toBe(100);
  });

  /**
   * Verifies that entries already shown are not duplicated
   */
  it('drops entries already shown', () => {
    const prev = state('f1', [e('100:0', 'shown'), e('200:0')], 100);
    const next = prependOlder(prev, page('f1', [e('0:0'), e('100:0', 'dup')], null));
    expect(next.entries).toEqual([e('0:0'), e('100:0', 'shown'), e('200:0')]);
  });

  /**
   * Verifies that a page from another file is ignored entirely
   */
  it('ignores a page from another file', () => {
    const prev = state('f1', [e('200:0')], 200);
    expect(prependOlder(prev, page('f2', [e('0:0')], null))).toBe(prev);
  });

  /**
   * Verifies that an older page arriving before any latest page is ignored
   */
  it('ignores an older page on an empty dialogue', () => {
    expect(prependOlder(EMPTY_DIALOGUE, page('f1', [e('0:0')], null))).toBe(EMPTY_DIALOGUE);
  });

  /**
   * Verifies that the previous state is not mutated
   */
  it('does not mutate the previous state', () => {
    const prev = state('f1', [e('200:0')], 200);
    const copy = structuredClone(prev);
    prependOlder(prev, page('f1', [e('100:0')], 100));
    expect(prev).toEqual(copy);
  });

  /**
   * Verifies that a later latest page keeps entries loaded by prependOlder and the moved cursor
   */
  it('keeps loaded history across a following latest page', () => {
    let s = mergeLatest(EMPTY_DIALOGUE, page('f1', [e('200:0'), e('300:0')], 200));
    s = prependOlder(s, page('f1', [e('0:0'), e('100:0')], null));
    s = mergeLatest(s, page('f1', [e('300:0', 'updated'), e('400:0')], 300));
    expect(s.entries).toEqual([e('0:0'), e('100:0'), e('200:0'), e('300:0', 'updated'), e('400:0')]);
    expect(s.older).toBeNull();
  });
});
