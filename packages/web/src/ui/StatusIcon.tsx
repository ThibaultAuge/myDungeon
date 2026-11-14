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
  // Hourglass: waiting for the next message. Not a speech bubble, which is kept for urgent requests.
  prompt: (
    <path d="M2.5 1h11v2h-1.2v1.4c0 1.7-1.1 2.9-2.6 3.6 1.5.7 2.6 1.9 2.6 3.6V13h1.2v2h-11v-2h1.2v-1.4c0-1.7 1.1-2.9 2.6-3.6C4.8 7.3 3.7 6.1 3.7 4.4V3H2.5z" />
  ),
  // Speech bubble with "…" cut out: the agent needs you. Same shape as the scene's RequestBubble.
  urgent: (
    <path
      fillRule="evenodd"
      d="M4 1.5h8a3 3 0 0 1 3 3v4a3 3 0 0 1-3 3H7.2l-3.7 3 .9-3H4a3 3 0 0 1-3-3v-4a3 3 0 0 1 3-3zM4 6.5a1 1 0 1 0 2 0a1 1 0 1 0-2 0zM7 6.5a1 1 0 1 0 2 0a1 1 0 1 0-2 0zM10 6.5a1 1 0 1 0 2 0a1 1 0 1 0-2 0z"
    />
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
