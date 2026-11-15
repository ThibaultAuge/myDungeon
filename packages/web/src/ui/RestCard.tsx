import { useEffect, useRef, useSyncExternalStore } from 'react';
import { agentRole, typeLabel } from '../format.ts';
import { useT } from '../i18n/useT.ts';
import { hasSlapTarget, slapAgent, watchSlapTargets } from '../scene/slap.ts';
import { restType } from '../scene/tavern.ts';
import { useOffice } from '../store.ts';
import { rosterButtonId } from './RosterList.tsx';

const TITLE_ID = 'rest-card-title';

/**
 * The card closes (unmounts): give focus back to the type's button in the side panel.
 * After a mouse close the panel does not scroll to it: the user never went there.
 */
function focusRosterButton(type: string, preventScroll = false): void {
  requestAnimationFrame(() => document.getElementById(rosterButtonId(type))?.focus({ preventScroll }));
}

/**
 * Short introduction of a resting agent type, opened by clicking its figure in the tavern
 * (or its button in the roster list): who it is and its role, in a few words. Same frame
 * and place as the workstation card.
 */
export function RestCard() {
  const selectedId = useOffice((s) => s.selectedAgentId);
  const roster = useOffice((s) => s.roster);
  const select = useOffice((s) => s.select);
  const { t } = useT();
  const type = selectedId ? restType(selectedId, roster) : undefined;
  // The slap button only while the type rests in the tavern (not while out working).
  const slappable = useSyncExternalStore(watchSlapTargets, () => !!selectedId && hasSlapTarget(selectedId));
  /** True while the slap button holds the focus: removing a focused node fires no blur. */
  const slapFocused = useRef(false);
  /** True while the focus is inside the card, for the same reason. */
  const hasFocus = useRef(false);
  useEffect(() => {
    if (slappable || !slapFocused.current) return;
    slapFocused.current = false;
    document.getElementById(TITLE_ID)?.focus();
  }, [slappable]);

  // The card can also close on its own (type gone from the roster, navigation, another
  // selection): when it held the focus, give it to the type's button rather than <body>.
  useEffect(() => {
    if (!type) return;
    return () => {
      if (!hasFocus.current) return;
      hasFocus.current = false;
      requestAnimationFrame(() => {
        // The close button and Escape already moved the focus; only a lost focus is rescued.
        if (document.activeElement && document.activeElement !== document.body) return;
        (document.getElementById(rosterButtonId(type)) ?? document.getElementById('roster-list-title'))?.focus();
      });
    };
  }, [type]);

  useEffect(() => {
    if (!type) return;
    const onKey = (e: KeyboardEvent) => {
      // Leave an Escape that another widget or an input method already handled.
      if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return;
      // Focus in the workstation card: that one closes first.
      if (document.querySelector('.post-card:not(.rest-card)')?.contains(document.activeElement)) return;
      const inCard = document.querySelector('.rest-card')?.contains(document.activeElement);
      e.preventDefault();
      select(null);
      if (inCard) focusRosterButton(type);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [type, select]);

  const name = type ? typeLabel(type) : '';
  return (
    // The live region stays mounted so that the card's content is announced when it appears or changes.
    <div className="post-card-region rest-card-region" aria-live="polite">
      {type && (
        <section
          className="post-card rest-card"
          aria-labelledby={TITLE_ID}
          onFocus={() => (hasFocus.current = true)}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) hasFocus.current = false;
          }}
        >
          <div className="post-card__plate">
            <h2 id={TITLE_ID} tabIndex={-1}>
              {name}
            </h2>
          </div>
          <button
            type="button"
            className="post-card__close"
            aria-label={t.restCard.close}
            onClick={(e) => {
              select(null);
              // detail is 0 for a keyboard activation, the click count for a pointer.
              focusRosterButton(type, e.detail > 0);
            }}
          >
            ×
          </button>
          <p className="post-card__room">{t.restCard.kind}</p>
          <p className="post-card__role">{agentRole(type, t)}</p>
          {/* The keyboard route to the right-click slap, as on the agent card. */}
          {slappable && (
            <button
              type="button"
              className="agent-info__slap"
              aria-label={t.info.slapLabel(name)}
              onClick={() => selectedId && slapAgent(selectedId)}
              onFocus={() => (slapFocused.current = true)}
              onBlur={() => (slapFocused.current = false)}
            >
              {t.info.slap}
            </button>
          )}
        </section>
      )}
    </div>
  );
}
