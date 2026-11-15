import { de } from './de.ts';
import { en } from './en.ts';
import { fr, type Messages } from './fr.ts';

export type { Messages };

/** Product name (a pun on "La La Land"): a proper noun, identical in every language. */
export const APP_NAME = 'IA IA Land';

export type Lang = 'fr' | 'de' | 'en';

export const DEFAULT_LANG: Lang = 'fr';

/** Order of the switcher buttons, each with its name written in its own language. */
export const LANGS: { lang: Lang; short: string; name: string }[] = [
  { lang: 'fr', short: 'FR', name: 'Français' },
  { lang: 'de', short: 'DE', name: 'Deutsch' },
  { lang: 'en', short: 'EN', name: 'English' },
];

export const MESSAGES: Record<Lang, Messages> = { fr, de, en };

export const STORAGE_KEY = 'agent-office.lang';

export function isLang(v: unknown): v is Lang {
  return v === 'fr' || v === 'de' || v === 'en';
}

/** First browser language we support (`de-AT` → `de`), or French. */
export function detectLang(languages: readonly string[] | undefined, language?: string): Lang {
  const list = languages && languages.length > 0 ? languages : language ? [language] : [];
  for (const tag of list) {
    const base = tag.toLowerCase().split('-')[0];
    if (isLang(base)) return base;
  }
  return DEFAULT_LANG;
}

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;

/** Saved choice if any, else the browser language. A blocked storage (private mode, policy) only loses the memory. */
export function initialLang(storage: Storage | undefined, nav: { languages?: readonly string[]; language?: string } | undefined): Lang {
  try {
    const saved = storage?.getItem(STORAGE_KEY);
    if (isLang(saved)) return saved;
  } catch {
    /* storage unavailable: fall back to detection */
  }
  return detectLang(nav?.languages, nav?.language);
}

export function saveLang(storage: Storage | undefined, lang: Lang): void {
  try {
    storage?.setItem(STORAGE_KEY, lang);
  } catch {
    /* storage unavailable: the choice lasts for this page only */
  }
}
