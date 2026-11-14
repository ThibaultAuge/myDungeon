import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_LANG, LANGS, MESSAGES, STORAGE_KEY, detectLang, initialLang, isLang, saveLang, type Lang } from '../src/i18n/index.ts';
import { plural } from '../src/i18n/plural.ts';
import { POST_IDS } from '../src/scene/layout.ts';

const ALL_LANGS: Lang[] = ['fr', 'de', 'en'];

type Kind = 'string' | 'function' | 'object' | 'other';

/** Flattens a dictionary into `path → kind` for every leaf (strings and functions). */
function shape(node: unknown, prefix = ''): Map<string, Kind> {
  const out = new Map<string, Kind>();
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const p = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object') {
      for (const [k, v] of shape(value, p)) out.set(k, v);
    } else {
      out.set(p, typeof value === 'string' ? 'string' : typeof value === 'function' ? 'function' : 'other');
    }
  }
  return out;
}

/** Every leaf of a dictionary with its path, for value-level checks. */
function leaves(node: unknown, prefix = ''): [string, unknown][] {
  const out: [string, unknown][] = [];
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const p = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object') out.push(...leaves(value, p));
    else out.push([p, value]);
  }
  return out;
}

/** RoomId members read from the shared source, so a new room cannot be forgotten by this test. */
function roomIdsFromShared(): string[] {
  const file = fileURLToPath(new URL('../../shared/src/index.ts', import.meta.url));
  const src = fs.readFileSync(file, 'utf8');
  const union = /export type RoomId\s*=\s*([^;]+);/.exec(src);
  if (!union) throw new Error('RoomId union not found in packages/shared/src/index.ts');
  return [...union[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/** In-memory storage stub with the two methods the module uses. */
function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
  };
}

describe('isLang', () => {
  /**
   * Verifies that only the three supported lowercase codes are accepted
   */
  it.each([
    ['fr', true],
    ['de', true],
    ['en', true],
    ['FR', false],
    ['it', false],
    ['', false],
    [null, false],
    [undefined, false],
    [1, false],
  ])('isLang(%j) is %s', (v, expected) => {
    expect(isLang(v)).toBe(expected);
  });
});

describe('detectLang', () => {
  /**
   * Verifies that a regional tag is reduced to its supported base language
   */
  it('maps de-AT to de', () => {
    expect(detectLang(['de-AT'])).toBe('de');
  });

  /**
   * Verifies that unsupported languages are skipped until a supported one is found
   */
  it('picks the first supported language of the list', () => {
    expect(detectLang(['it', 'en-GB'])).toBe('en');
  });

  /**
   * Verifies that list order wins when several supported languages are present
   */
  it('respects the preference order', () => {
    expect(detectLang(['en-US', 'de-DE', 'fr-FR'])).toBe('en');
    expect(detectLang(['de', 'en'])).toBe('de');
  });

  /**
   * Verifies that French is chosen when no listed language is supported
   */
  it('falls back to French when nothing matches', () => {
    expect(detectLang(['it'])).toBe('fr');
    expect(detectLang(['it'])).toBe(DEFAULT_LANG);
  });

  /**
   * Verifies that an empty list falls back to the single language argument
   */
  it('uses the language argument when the list is empty', () => {
    expect(detectLang([], 'de-CH')).toBe('de');
    expect(detectLang([], 'en')).toBe('en');
  });

  /**
   * Verifies that a missing list falls back to the single language argument
   */
  it('uses the language argument when the list is undefined', () => {
    expect(detectLang(undefined, 'en-US')).toBe('en');
  });

  /**
   * Verifies that the language argument is ignored when the list is non-empty
   */
  it('ignores the language argument when the list has entries', () => {
    expect(detectLang(['it'], 'de')).toBe('fr');
  });

  /**
   * Verifies that French is returned when neither list nor language is given
   */
  it('returns French without any input', () => {
    expect(detectLang(undefined)).toBe('fr');
    expect(detectLang([], undefined)).toBe('fr');
    expect(detectLang([], '')).toBe('fr');
  });

  /**
   * Verifies that tags are matched case-insensitively
   */
  it.each([
    ['DE-AT', 'de'],
    ['EN', 'en'],
    ['Fr-CA', 'fr'],
  ])('maps uppercase tag %s to %s', (tag, expected) => {
    expect(detectLang([tag])).toBe(expected);
  });

  /**
   * Verifies that a tag merely starting with a supported code is not accepted
   */
  it('does not match a longer base tag sharing a prefix', () => {
    expect(detectLang(['english', 'deutsch'])).toBe('fr');
  });
});

describe('initialLang', () => {
  /**
   * Verifies that a valid saved choice wins over the browser language
   */
  it('returns a saved valid language', () => {
    const storage = memoryStorage({ [STORAGE_KEY]: 'de' });
    expect(initialLang(storage, { languages: ['en-US'], language: 'en-US' })).toBe('de');
  });

  /**
   * Verifies that an invalid saved value is ignored in favour of detection
   */
  it('ignores an invalid saved value', () => {
    const storage = memoryStorage({ [STORAGE_KEY]: 'es' });
    expect(initialLang(storage, { languages: ['en-GB'] })).toBe('en');
  });

  /**
   * Verifies that a value saved under another key is not used
   */
  it('reads only its own storage key', () => {
    const storage = memoryStorage({ 'other.key': 'de' });
    expect(initialLang(storage, { languages: ['en'] })).toBe('en');
  });

  /**
   * Verifies that detection is used when nothing is saved
   */
  it('detects the language when storage is empty', () => {
    expect(initialLang(memoryStorage(), { languages: ['de-AT'] })).toBe('de');
  });

  /**
   * Verifies that a throwing storage falls back to detection without throwing
   */
  it('swallows a getItem exception', () => {
    const storage = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {},
    };
    expect(() => initialLang(storage, { languages: ['en'] })).not.toThrow();
    expect(initialLang(storage, { languages: ['en'] })).toBe('en');
  });

  /**
   * Verifies that missing storage still detects from the navigator
   */
  it('detects without storage', () => {
    expect(initialLang(undefined, { language: 'de-DE' })).toBe('de');
  });

  /**
   * Verifies that missing storage and navigator yield French
   */
  it('returns French without storage nor navigator', () => {
    expect(initialLang(undefined, undefined)).toBe('fr');
  });

  /**
   * Verifies that a saved choice is honoured even without a navigator
   */
  it('returns the saved choice without navigator', () => {
    expect(initialLang(memoryStorage({ [STORAGE_KEY]: 'en' }), undefined)).toBe('en');
  });
});

describe('saveLang', () => {
  /**
   * Verifies that the chosen language is stored under the module key
   */
  it('stores the language under STORAGE_KEY', () => {
    const storage = memoryStorage();
    saveLang(storage, 'en');
    expect(storage.data.get(STORAGE_KEY)).toBe('en');
  });

  /**
   * Verifies that a saved language is read back by initialLang (round trip)
   */
  it('round-trips with initialLang', () => {
    const storage = memoryStorage();
    saveLang(storage, 'de');
    expect(initialLang(storage, { languages: ['en'] })).toBe('de');
  });

  /**
   * Verifies that a throwing setItem does not propagate
   */
  it('swallows a setItem exception', () => {
    const setItem = vi.fn(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => saveLang({ getItem: () => null, setItem }, 'de')).not.toThrow();
  });

  /**
   * Verifies that saving without storage is a no-op rather than an error
   */
  it('does nothing without storage', () => {
    expect(() => saveLang(undefined, 'fr')).not.toThrow();
  });
});

describe('LANGS', () => {
  /**
   * Verifies that the switcher lists every language once, each with a dictionary
   */
  it('lists each supported language once with non-empty labels', () => {
    expect(LANGS.map((l) => l.lang).sort()).toEqual([...ALL_LANGS].sort());
    for (const l of LANGS) {
      expect(MESSAGES[l.lang]).toBeDefined();
      expect(l.short.trim()).not.toBe('');
      expect(l.name.trim()).not.toBe('');
    }
  });
});

describe('dictionaries', () => {
  const reference = shape(MESSAGES.fr);

  /**
   * Verifies that the French reference contains only strings, functions and objects
   */
  it('has only string and function leaves in the reference', () => {
    expect([...reference.values()].filter((k) => k === 'other')).toEqual([]);
    expect(reference.size).toBeGreaterThan(0);
  });

  /**
   * Verifies that each dictionary has exactly the reference key paths and value kinds
   */
  it.each(['de', 'en'] as const)('%s matches the French key paths and kinds', (lang) => {
    const actual = shape(MESSAGES[lang]);
    expect([...actual.entries()].sort()).toEqual([...reference.entries()].sort());
  });

  /**
   * Verifies that no dictionary contains an empty or blank string
   */
  it.each(ALL_LANGS)('%s has no empty string', (lang) => {
    const empty = leaves(MESSAGES[lang])
      .filter(([, v]) => typeof v === 'string' && v.trim() === '')
      .map(([p]) => p);
    expect(empty).toEqual([]);
  });

  /**
   * Verifies that a translation never drops a parameter of the French reference
   */
  it.each(['de', 'en'] as const)('%s function entries take as many parameters as French', (lang) => {
    const ref = new Map(leaves(MESSAGES.fr).filter(([, v]) => typeof v === 'function'));
    for (const [p, fn] of leaves(MESSAGES[lang])) {
      if (typeof fn !== 'function') continue;
      expect((fn as (...a: unknown[]) => unknown).length, p).toBe((ref.get(p) as (...a: unknown[]) => unknown).length);
    }
  });

  /**
   * Verifies that every function entry returns a non-empty string containing its arguments
   */
  it.each(ALL_LANGS)('%s function entries render their arguments', (lang) => {
    const samples = [7, 42, 913];
    const fns = leaves(MESSAGES[lang]).filter(([, v]) => typeof v === 'function') as [string, (...a: unknown[]) => unknown][];
    expect(fns.length).toBeGreaterThan(0);
    for (const [p, fn] of fns) {
      const args = samples.slice(0, fn.length);
      const out = fn(...args);
      expect(typeof out, p).toBe('string');
      expect((out as string).trim(), p).not.toBe('');
      for (const a of args) expect(out as string, `${p} should include ${a}`).toContain(String(a));
    }
  });

  /**
   * Verifies that every RoomId declared in shared has a non-empty name per language
   */
  it.each(ALL_LANGS)('%s names every room of the shared RoomId union', (lang) => {
    const ids = roomIdsFromShared();
    expect(ids.length).toBeGreaterThan(0);
    const rooms = MESSAGES[lang].rooms as Record<string, string>;
    for (const id of ids) {
      expect(typeof rooms[id], id).toBe('string');
      expect(rooms[id].trim(), id).not.toBe('');
    }
    expect(Object.keys(rooms).sort()).toEqual([...ids].sort());
  });

  /**
   * Verifies that every workstation has exactly one card per language, keyed by POST_IDS
   */
  it.each(ALL_LANGS)('%s has a card for every workstation and no other', (lang) => {
    const posts = MESSAGES[lang].posts as Record<string, unknown>;
    expect(Object.keys(posts).sort()).toEqual([...POST_IDS].sort());
  });

  /**
   * Verifies that each workstation card has a non-empty, trimmed title, role and who
   */
  it.each(ALL_LANGS)('%s workstation cards have trimmed non-empty title, role and who', (lang) => {
    const posts = MESSAGES[lang].posts as Record<string, Record<string, unknown>>;
    for (const id of POST_IDS) {
      const card = posts[id];
      expect(card, id).toBeDefined();
      expect(Object.keys(card).sort(), id).toEqual(['role', 'title', 'who']);
      for (const field of ['title', 'role', 'who']) {
        const v = card[field];
        expect(typeof v, `${id}.${field}`).toBe('string');
        expect((v as string).trim(), `${id}.${field}`).not.toBe('');
        expect(v, `${id}.${field} has stray whitespace`).toBe((v as string).trim());
      }
    }
  });

  /**
   * Verifies that workstation titles are distinct within a language
   */
  it.each(ALL_LANGS)('%s gives every workstation a distinct title', (lang) => {
    const titles = POST_IDS.map((id) => MESSAGES[lang].posts[id].title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  /**
   * Verifies that the workstation card chrome (who heading, close label) is non-empty
   */
  it.each(ALL_LANGS)('%s has non-empty postCard labels', (lang) => {
    const { who, close } = MESSAGES[lang].postCard;
    for (const [name, v] of [
      ['who', who],
      ['close', close],
    ] as const) {
      expect(typeof v, name).toBe('string');
      expect(v.trim(), name).not.toBe('');
      expect(v, name).toBe(v.trim());
    }
  });

  /**
   * Verifies that the workstation card labels are translated, not French copies
   */
  it.each(['de', 'en'] as const)('%s translates the postCard labels', (lang) => {
    expect(MESSAGES[lang].postCard.who).not.toBe(MESSAGES.fr.postCard.who);
    expect(MESSAGES[lang].postCard.close).not.toBe(MESSAGES.fr.postCard.close);
  });

  /**
   * Verifies that the slap button's accessible name contains its visible text (WCAG 2.5.3)
   */
  it.each(ALL_LANGS)('%s slap label contains the visible slap button text', (lang) => {
    const { slap, slapLabel } = MESSAGES[lang].info;
    const label = slapLabel('Hermione');
    expect(label.toLowerCase()).toContain(slap.trim().toLowerCase());
    expect(label).toContain('Hermione');
  });

  /**
   * Verifies that the slap texts are trimmed, and that the button and sound are translated
   */
  it.each(ALL_LANGS)('%s has trimmed, non-empty slap texts', (lang) => {
    for (const [name, v] of [
      ['info.slap', MESSAGES[lang].info.slap],
      ['slap.sound', MESSAGES[lang].slap.sound],
    ] as const) {
      expect(v.trim(), name).not.toBe('');
      expect(v, name).toBe(v.trim());
    }
  });

  /**
   * Verifies that the slap button text is translated in German and English
   */
  it.each(['de', 'en'] as const)('%s translates the slap button text', (lang) => {
    expect(MESSAGES[lang].info.slap).not.toBe(MESSAGES.fr.info.slap);
    expect(MESSAGES[lang].info.slapLabel('X')).not.toBe(MESSAGES.fr.info.slapLabel('X'));
  });

  /**
   * Verifies that German and English are actually translated, not French copies
   */
  it.each(['de', 'en'] as const)('%s differs from French for key interface texts', (lang) => {
    expect(MESSAGES[lang].session.untitled).not.toBe(MESSAGES.fr.session.untitled);
    expect(MESSAGES[lang].env.none).not.toBe(MESSAGES.fr.env.none);
  });
});

describe('plural rules through home.activeSessions', () => {
  /**
   * Verifies that French treats 0 and 1 as singular and 2 as plural
   */
  it('uses singular for 0 and 1 in French', () => {
    const f = MESSAGES.fr.home.activeSessions;
    expect(f(0)).toBe('0 session en cours');
    expect(f(1)).toBe('1 session en cours');
    expect(f(2)).toBe('2 sessions en cours');
  });

  /**
   * Verifies that English treats 0 as plural and 1 as singular
   */
  it('uses plural for 0 and singular for 1 in English', () => {
    const f = MESSAGES.en.home.activeSessions;
    expect(f(0)).toBe('0 active sessions');
    expect(f(1)).toBe('1 active session');
    expect(f(2)).toBe('2 active sessions');
  });

  /**
   * Verifies that German treats 0 as plural and 1 as singular
   */
  it('uses plural for 0 and singular for 1 in German', () => {
    const f = MESSAGES.de.home.activeSessions;
    expect(f(0)).toBe('0 laufende Sitzungen');
    expect(f(1)).toBe('1 laufende Sitzung');
    expect(f(2)).toBe('2 laufende Sitzungen');
  });
});

describe('plural', () => {
  /**
   * Verifies that the rule cache keeps languages apart whatever the call order
   */
  it('keeps per-language rules apart across calls', () => {
    expect(plural('en', 0, 'one', 'other')).toBe('other');
    expect(plural('fr', 0, 'one', 'other')).toBe('one');
    expect(plural('en', 0, 'one', 'other')).toBe('other');
    expect(plural('fr', 0, 'one', 'other')).toBe('one');
  });

  /**
   * Verifies that large counts use the plural form in every language
   */
  it.each(ALL_LANGS)('uses the plural form for 1000 in %s', (lang) => {
    expect(plural(lang, 1000, 'one', 'other')).toBe('other');
  });
});
