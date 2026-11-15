import { useT } from '../i18n/useT.ts';
import type { MishapKind } from './mishap.ts';

/**
 * The comic bubble of a mishap over the agent's head: "POOF!" from the boiler, "BLOOP!" from
 * the flask. Remounted on every mishap so the CSS animation starts over. Decorative: the
 * failure itself is already shown by the agent's tool line.
 */
export function MishapEffect({ kind }: { kind: MishapKind }) {
  const { t } = useT();
  return (
    <span className={`mishap mishap--${kind}`} aria-hidden="true">
      <span className="mishap__bubble">{t.mishap[kind]}</span>
    </span>
  );
}
