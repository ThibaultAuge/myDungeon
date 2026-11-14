import { useT } from '../i18n/useT.ts';
import { postGroups, ROOMS, type PostId } from '../scene/layout.ts';
import { useOffice } from '../store.ts';

/** DOM id of a workstation's button, where focus goes back when its card closes. */
export function postButtonId(post: PostId): string {
  return `post-button-${post}`;
}

/** Rooms that hold a workstation, with their posts, in plan order. */
const ROOM_POSTS = ROOMS.map((r) => ({ room: r.id, posts: postGroups(r).posts.map((g) => g.post) })).filter(
  (r) => r.posts.length > 0,
);

/** Keyboard and screen-reader route to the workstation cards that the 3D scene opens on click. */
export function PostList() {
  const selected = useOffice((s) => s.selectedPost);
  const selectPost = useOffice((s) => s.selectPost);
  const { t } = useT();
  return (
    <section aria-labelledby="post-list-title">
      <h2 id="post-list-title">{t.postList.title}</h2>
      <ul className="post-list" role="list">
        {ROOM_POSTS.map(({ room, posts }) => (
          <li key={room}>
            <h3 className="post-list__room" id={`post-room-${room}`}>
              {t.rooms[room]}
            </h3>
            <ul role="list" aria-labelledby={`post-room-${room}`}>
              {posts.map((post) => (
                <li key={post}>
                  <button
                    type="button"
                    id={postButtonId(post)}
                    className="agent-row"
                    aria-pressed={selected === post}
                    onClick={() => selectPost(selected === post ? null : post)}
                  >
                    {t.posts[post].title}
                  </button>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}
