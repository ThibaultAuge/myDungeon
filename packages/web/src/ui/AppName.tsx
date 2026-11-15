import { APP_NAME_PARTS } from '../i18n/index.ts';

/**
 * The product name with "AI" in bold, as shown in the header brand. The name is English
 * whatever the interface language, hence `lang="en"`; the bold is visual only, hence a span.
 */
export function AppName() {
  return (
    <span lang="en">
      {APP_NAME_PARTS.before}
      <span className="brand__ai">{APP_NAME_PARTS.bold}</span>
      {APP_NAME_PARTS.after}
    </span>
  );
}
