import { LANGS } from '../i18n/index.ts';
import { useT } from '../i18n/useT.ts';
import { useOffice } from '../store.ts';

/**
 * FR | DE | EN toggle buttons. The accessible name is the visible code (WCAG 2.5.3, so voice control can say "FR"),
 * pronounced through the button's own `lang`; the full name, in its own language, is the tooltip and description.
 */
export function LangSwitcher() {
  const { t, lang } = useT();
  const setLang = useOffice((s) => s.setLang);
  return (
    <div className="lang-switcher" role="group" aria-label={t.langSwitcher.label}>
      {LANGS.map((l) => (
        <button
          key={l.lang}
          type="button"
          lang={l.lang}
          className="lang-switcher__button"
          aria-pressed={l.lang === lang}
          title={l.name}
          onClick={() => setLang(l.lang)}
        >
          {l.short}
        </button>
      ))}
    </div>
  );
}
