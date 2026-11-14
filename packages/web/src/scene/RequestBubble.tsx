import type { WaitReason } from '@agent-office/shared';

/** Glyph inside the bubble: a request waits for a go-ahead, an answer, or help with an error. */
const GLYPHS: Record<Exclude<WaitReason, 'prompt'>, string> = { permission: '…', question: '?', error: '!' };

/**
 * Comic speech bubble over an agent at the altar with a request. HTML, inside the name tag:
 * a 3D bubble would be hidden by the tags and room signs, which are drawn over the canvas.
 * Decorative: the list and the status announcer already say what the agent waits for.
 */
export function RequestBubble({ reason }: { reason: WaitReason | undefined }) {
  const kind = reason && reason !== 'prompt' ? reason : 'permission';
  return (
    <span className={`request-bubble request-bubble--${kind}`} aria-hidden="true">
      <svg viewBox="0 0 36 30" width="36" height="30" focusable="false">
        <path
          d="M8 2h20a6 6 0 0 1 6 6v8a6 6 0 0 1-6 6H15l-8 6 2-6H8a6 6 0 0 1-6-6V8a6 6 0 0 1 6-6z"
          className="request-bubble__shape"
        />
        <text x="18" y="12" className="request-bubble__glyph" textAnchor="middle" dominantBaseline="central">
          {GLYPHS[kind]}
        </text>
      </svg>
    </span>
  );
}
