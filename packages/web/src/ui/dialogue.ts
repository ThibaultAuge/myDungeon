// Pure merging of transcript pages for the dialogue box. No React, no store: tested in node.
import type { DialogueEntry, TranscriptPage } from '@agent-office/shared';

export interface DialogueState {
  /** Transcript file the entries come from, null before the first page. */
  file: string | null;
  entries: DialogueEntry[];
  /** Cursor of the next older page, null when the start of the file is loaded. */
  older: number | null;
}

export const EMPTY_DIALOGUE: DialogueState = { file: null, entries: [], older: null };

/** Byte offset of the transcript line an entry comes from (its key is `<offset>:<block>`). */
export function entryOffset(e: DialogueEntry): number {
  const n = Number.parseInt(e.key, 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Applies the latest page of the transcript. Entries older than the page are kept, the page
 * replaces the rest (a line rewritten since, or completed, is taken from the page). Another
 * file means another transcript: everything starts over.
 */
export function mergeLatest(prev: DialogueState, page: TranscriptPage): DialogueState {
  if (prev.file !== page.file) return { file: page.file, entries: page.entries, older: page.before };
  const cutoff = page.before ?? 0;
  const kept = prev.entries.filter((e) => entryOffset(e) < cutoff);
  // The older cursor only moves back: a fresh latest page never undoes "load earlier".
  const older = kept.length > 0 ? prev.older : page.before;
  return { file: page.file, entries: [...kept, ...page.entries], older };
}

/** Prepends an older page, dropping entries already shown. */
export function prependOlder(prev: DialogueState, page: TranscriptPage): DialogueState {
  if (prev.file !== page.file) return prev;
  const shown = new Set(prev.entries.map((e) => e.key));
  return { file: prev.file, entries: [...page.entries.filter((e) => !shown.has(e.key)), ...prev.entries], older: page.before };
}
