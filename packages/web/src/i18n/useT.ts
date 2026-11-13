import { useOffice } from '../store.ts';
import { MESSAGES, type Lang, type Messages } from './index.ts';

/** Dictionary of the current language; components using it re-render when the language changes. */
export function useT(): { t: Messages; lang: Lang } {
  const lang = useOffice((s) => s.lang);
  return { t: MESSAGES[lang], lang };
}
