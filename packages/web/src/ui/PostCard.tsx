import { useEffect } from 'react';
import { useT } from '../i18n/useT.ts';
import { POST_ROOM, type PostId } from '../scene/layout.ts';
import { useOffice } from '../store.ts';
import { postButtonId } from './PostList.tsx';

/**
 * The card unmounts on close: give focus back to the workstation's button in the side panel.
 * After a mouse close the panel does not scroll to it: the user never went there.
 */
function focusPostButton(post: PostId, preventScroll = false): void {
  requestAnimationFrame(() => document.getElementById(postButtonId(post))?.focus({ preventScroll }));
}

/** Card of the clicked workstation, in the top right corner of the scene. */
export function PostCard() {
  const post = useOffice((s) => s.selectedPost);
  const selectPost = useOffice((s) => s.selectPost);
  const { t } = useT();

  useEffect(() => {
    if (!post) return;
    const onKey = (e: KeyboardEvent) => {
      // Leave an Escape that another widget or an input method already handled.
      if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return;
      // Focus moves only if it was in the card; otherwise it stays where the user left it.
      const inCard = document.querySelector('.post-card')?.contains(document.activeElement);
      selectPost(null);
      if (inCard) focusPostButton(post);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [post, selectPost]);

  const text = post ? t.posts[post] : undefined;
  const room = post ? POST_ROOM.get(post) : undefined;
  return (
    // The live region stays mounted so that the card's content is announced when it appears or changes.
    <div className="post-card-region" aria-live="polite">
      {post && text && (
        <section className="post-card" aria-labelledby="post-card-title">
          <div className="post-card__head">
            <div>
              {room && <p className="post-card__room">{t.rooms[room]}</p>}
              <h2 id="post-card-title">{text.title}</h2>
            </div>
            <button type="button" className="icon-button" aria-label={t.postCard.close} onClick={(e) => {
                selectPost(null);
                // detail is 0 for a keyboard activation, the click count for a pointer.
                focusPostButton(post, e.detail > 0);
              }}>
              ×
            </button>
          </div>
          <p className="post-card__role">{text.role}</p>
          <p className="post-card__who">{t.labelled(t.postCard.who, text.who)}</p>
        </section>
      )}
    </div>
  );
}
