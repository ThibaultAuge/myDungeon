import { useSyncExternalStore } from 'react';
import { useT } from '../i18n/useT.ts';
import { fpsState, onFpsChange } from '../scene/fps.ts';

/**
 * Reminder of the first-person controls while that view is on, plus a prompt to click when
 * the browser did not capture the mouse. The live region stays mounted so the change is announced.
 */
export function FpsHint() {
  const { t } = useT();
  const state = useSyncExternalStore(onFpsChange, fpsState);
  return (
    <div className="fps-hint" role="status">
      {state !== 'off' && (
        <p className="fps-hint__text">
          {t.fps.hint}
          {state === 'fallback' && <span className="fps-hint__capture">{t.fps.capture}</span>}
        </p>
      )}
    </div>
  );
}
