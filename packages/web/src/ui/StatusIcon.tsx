import type { ReactNode } from 'react';
import { STATUS_COLORS, type StatusKind } from '../format.ts';

/**
 * Shapes drawn on a 16×16 grid. The shape carries the status on its own, so it still reads
 * for someone who cannot tell the colours apart.
 */
const SHAPES: Record<StatusKind, ReactNode> = {
  // Hammer: at work.
  working: (
    <g transform="rotate(-45 8 8)">
      <rect x="7" y="5" width="2.2" height="10.5" rx="1.1" />
      <path d="M3 2.2h8.6a1.4 1.4 0 0 1 1.4 1.4v1.8a1.4 1.4 0 0 1-1.4 1.4H5.2L3 5.6z" />
    </g>
  ),
  // Hourglass: waiting for the next message. Not a speech bubble, which the scene keeps for
  // urgent requests (RequestBubble).
  prompt: (
    <path d="M2.5 1h11v2h-1.2v1.4c0 1.7-1.1 2.9-2.6 3.6 1.5.7 2.6 1.9 2.6 3.6V13h1.2v2h-11v-2h1.2v-1.4c0-1.7 1.1-2.9 2.6-3.6C4.8 7.3 3.7 6.1 3.7 4.4V3H2.5z" />
  ),
  // Raised open hand: stop, the agent needs you.
  urgent: (
    <>
      <rect x="4.3" y="3.2" width="2" height="8" rx="1" />
      <rect x="6.5" y="1.2" width="2" height="9" rx="1" />
      <rect x="8.7" y="1.8" width="2" height="9" rx="1" />
      <rect x="10.9" y="3.6" width="2" height="7.5" rx="1" />
      <rect x="4.3" y="7" width="8.6" height="8" rx="2.6" />
      <rect x="4.9" y="6" width="2.2" height="7.2" rx="1.1" transform="rotate(-38 6 12.6)" />
    </>
  ),
  // Zzz: finished, asleep.
  done: (
    <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.5 9h5.2l-5.2 5.5h5.2" />
      <path d="M8.3 4.8h3.8l-3.8 4h3.8" />
      <path d="M12.4 1.4h2.4l-2.4 2.6h2.4" />
    </g>
  ),
};

/** Decorative status icon: the state is always given as text next to it. */
export function StatusIcon({ kind }: { kind: StatusKind }) {
  const color = STATUS_COLORS[kind];
  return (
    <svg
      className={`status-icon status-icon--${kind}`}
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill={color}
      style={{ color }}
      aria-hidden="true"
      focusable="false"
    >
      {SHAPES[kind]}
    </svg>
  );
}
