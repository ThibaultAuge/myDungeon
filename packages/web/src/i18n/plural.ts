const rules = new Map<string, Intl.PluralRules>();

/** Singular or plural form following the language's own rules (French treats 0 as singular, English and German do not). */
export function plural(lang: string, n: number, one: string, other: string): string {
  let r = rules.get(lang);
  if (!r) {
    r = new Intl.PluralRules(lang);
    rules.set(lang, r);
  }
  return r.select(n) === 'one' ? one : other;
}
