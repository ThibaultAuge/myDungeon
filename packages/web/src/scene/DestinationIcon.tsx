import type { ReactNode, Ref } from 'react';
import type { Destination } from './destinations.ts';

// One pictogram per room and per dedicated post: 24×24 line drawings in the current colour.
// Decorative everywhere: the room name is on the sign, in the side list and the announcer.

const dot = (cx: number, cy: number, r = 1.4) => <circle cx={cx} cy={cy} r={r} fill="currentColor" stroke="none" />;

const ICONS: Record<Destination, ReactNode> = {
  // Rooms
  autel: <path d="M7 3h10v4a5 5 0 0 1-10 0z M12 12v7 M8 21h8" />, // chalice
  cartes: <path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z M9 3v15 M15 6v15" />, // folded map
  atelier: <path d="M3 4h11v5H3z M8.5 9v12 M14 6.5h4l3-2.5" />, // hammer
  biblio: <path d="M3 4h4v16H3z M9 4h4v16H9z M14.5 5l3.8-1 3.9 15.4-3.8 1z" />, // books
  scriptorium: <path d="M20 3C11 4 6 10 5 19 M20 3c0 7-5 12-13 13 M5 19l-2 2" />, // quill
  observatoire: <path d="M20 14A8 8 0 1 1 10 4a6 6 0 0 0 10 10z M17 2v4 M15 4h4" />, // moon and star
  pigeonnier: <path d="M3 6h18v12H3z M3 6l9 7 9-7" />, // letter
  machines: (
    <>
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.8" />
      <path d="M12 2v5 M12 17v5 M2 12h5 M17 12h5 M4.9 4.9l3.6 3.6 M15.5 15.5l3.6 3.6 M4.9 19.1l3.6-3.6 M15.5 8.5l3.6-3.6" />
    </>
  ), // gear
  arithmetique: <path d="M7 3v8 M3 7h8 M14 7h7 M4 15l6 6 M10 15l-6 6 M14 16h7 M14 20h7" />, // + − × =
  garde: <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />, // shield
  epreuves: <path d="M9 3h6 M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3 M7.5 15h9" />, // flask
  heraut: <path d="M3 10v4h3l9 5V5L6 10z M18 9a4 4 0 0 1 0 6 M20.5 6.5a8 8 0 0 1 0 11" />, // horn calling out
  detente: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      {dot(8.5, 8.5)}
      {dot(12, 12)}
      {dot(15.5, 15.5)}
    </>
  ), // die
  concierge: <path d="M20 3l-8 8 M12 11l-6 1.5L3 21l8.5-3L13 12z M7 17l-2 2" />, // broom
  taverne: <path d="M5 7h10v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z M15 10h2a3 3 0 0 1 0 6h-2 M5 7c0-2 2-3 3.5-2 1-1.5 3.5-1.5 4.5 0 1.5-.5 2 1 2 2" />, // mug
  // Dedicated posts
  lunette: <path d="M4 13l12-6.5 2 4L6 17z M16 6.5l3-1.5 2 4-3 1.5 M11 15l-3 6 M12 15l3 6" />, // telescope
  ia: <path d="M7 7h10v10H7z M10 10h4v4h-4z M10 3v4 M14 3v4 M10 17v4 M14 17v4 M3 10h4 M3 14h4 M17 10h4 M17 14h4" />, // chip
  humains: (
    <>
      <circle cx="12" cy="7" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ), // person
  chevalet: <path d="M5 3h14v11H5z M8 14l-3 7 M16 14l3 7 M12 14v4" />, // easel
  sacristain: <path d="M9 11h6v10H9z M12 3c2 2 2.5 4 0 6-2.5-2-2-4 0-6z" />, // candle
  boulier: (
    <>
      <path d="M3 4h18v16H3z M3 9.5h18 M3 15h18" />
      {dot(7, 9.5, 1.8)}
      {dot(11, 9.5, 1.8)}
      {dot(13, 15, 1.8)}
      {dot(17, 15, 1.8)}
    </>
  ), // abacus
  relecture: (
    <>
      <circle cx="10" cy="10" r="6" />
      <path d="M14.5 14.5L21 21" />
    </>
  ), // magnifier
  labo: <path d="M8 3h8 M14 3v14a2 2 0 0 1-4 0V3 M10 11h4" />, // test tube
  estrade: <path d="M9 3h6v9a3 3 0 0 1-6 0z M5 11a7 7 0 0 0 14 0 M12 18v3 M8 21h8" />, // microphone
  inspection: (
    <>
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ), // eye
};

/** The pictogram of a room or a post, drawn in `currentColor`. */
export function DestinationIcon({ kind, className }: { kind: Destination; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {ICONS[kind]}
    </svg>
  );
}

/**
 * Round badge above the name tag of a walking agent. Hidden by CSS until the figure's
 * anchor carries `data-travelling`, which `AgentFigure` toggles from its frame loop.
 * `data-destination` tells the frame loop which icon the DOM shows right now.
 */
export function DestinationBadge({ kind, ref }: { kind: Destination; ref?: Ref<HTMLSpanElement> }) {
  return (
    <span ref={ref} className="destination-badge" data-destination={kind} aria-hidden="true">
      <DestinationIcon kind={kind} className="destination-badge__icon" />
    </span>
  );
}
