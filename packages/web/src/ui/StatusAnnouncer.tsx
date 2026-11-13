import { useEffect, useRef, useState } from 'react';
import type { SessionView } from '@agent-office/shared';
import { agentName, stateLabel } from '../format.ts';
import { MESSAGES } from '../i18n/index.ts';
import { useOffice } from '../store.ts';

/**
 * Announces to screen readers only the transitions that call for the user
 * (permission, question, error) and agents finishing. Never the elapsed time.
 */
export function StatusAnnouncer({ sessions }: { sessions: SessionView[] }) {
  const previous = useRef<Map<string, string> | null>(null);
  // Lines waiting to be announced: snapshots arriving in a burst add to them instead of cancelling them.
  const pending = useRef<string[]>([]);
  const timer = useRef<number | undefined>(undefined);
  const [message, setMessage] = useState('');

  useEffect(() => () => window.clearTimeout(timer.current), []);

  useEffect(() => {
    // Navigation empties the list: the next snapshot becomes the silent baseline of the new environment.
    if (sessions.length === 0) {
      previous.current = null;
      pending.current = [];
      return;
    }
    const next = new Map<string, string>();
    for (const s of sessions) {
      if (!s.live) continue;
      for (const a of [s.main, ...s.subagents]) {
        const key = `${a.state}:${a.waitReason ?? ''}`;
        next.set(a.id, key);
        const before = previous.current?.get(a.id);
        if (previous.current === null || before === key) continue;
        const urgent = a.state === 'waiting' && a.waitReason !== 'prompt';
        if (urgent || a.state === 'done') {
          // Read when the change is detected, not subscribed: a language change alone must not re-run this diff.
          const t = MESSAGES[useOffice.getState().lang];
          pending.current.push(t.labelled(agentName(a, s, t), stateLabel(a, t)));
        }
      }
    }
    previous.current = next;
    if (pending.current.length === 0 || timer.current !== undefined) return;
    // Clear first so an identical message is announced again, then speak everything gathered.
    setMessage('');
    timer.current = window.setTimeout(() => {
      timer.current = undefined;
      setMessage(pending.current.join('. '));
      pending.current = [];
    }, 50);
  }, [sessions]);

  return (
    <div className="sr-only" role="status">
      {message}
    </div>
  );
}
