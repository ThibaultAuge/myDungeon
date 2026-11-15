---
description: Use when changing the 3D dungeon map — rooms, floors, walls, castle gate, cutaway, props, lighting, KayKit models or their import — workstations (posts, hover glow, post card and list), pointer handling of 3D targets, agent figures (walking, models, role looks, held props, clips, destination badge), the slap, potion and mishap gags, the agentOffice console namespace, room or post icons, or when previewing the web scene.
---

# 3D dungeon scene (KayKit assets)

## Current State
- The map is built from KayKit CC0 models (Dungeon Pack 1.1, RPG Tools Bits 1.0, Fantasy
  Weapons Bits 1.0, free tiers), grouped in three packs: `dungeon`, `tools`, `weapons`.
  Agents use KayKit Adventurers 2.0 (CC0): packs `adventurers` (character bodies) and
  `adventurers_props` (8 held props, gltf + 4 textures). Pack `animations`: the 8
  `Rig_Medium_*` clip files of KayKit Character Animations 1.1 (CC0; General,
  MovementBasic, MovementAdvanced, CombatMelee, CombatRanged, Simulation, Special, Tools),
  shared by every Adventurers and Skeletons body; only the files holding a used clip are
  fetched (see Clips loading below). Pack `forest` (trees around the
  castle, plus grass tufts and a rock used as room decor): `docs/ai/night-forest.md`.
- Room-decor packs (KayKit CC0, free tiers): `furniture`, `halloween`, `restaurant`
  (Furniture / Halloween / Restaurant Bits 1.0), `resources` (Resource Bits), `mixed1`,
  `mixed2` (Mixed Bag 1 / 2). Their use: `docs/ai/room-identity.md`.
- KayKit Skeletons 1.1 (free tier), two packs:
  `skeletons` (glb, only `Skeleton_Minion`, used only by the ambush attackers,
  `docs/ai/agent-lifecycle.md`) and
  `skeleton_props` (gltf, texture `skeleton_texture.png`: `Skeleton_Shield_Large_A` as decor,
  `Skeleton_Blade` / `Skeleton_Axe` held by the attackers).
- KayKit is about 1.33x our scene: every model is scaled by `KIT_SCALE = 0.75`. After
  scaling: small floor tile 1.5 m, wall 3 m high per 3 m chunk, table 0.75 m.
- Rooms (`RoomDef` in `layout.ts`) carry `floorKind` (`stone`, `stoneFancy`, `grate`, `wood`,
  `woodDark`, `dirt`) and `accent` (one of 6 KayKit banner colours). Per-room wall
  variants, wall hangs, room lights and decor kinds / recipes: `docs/ai/room-identity.md`.
- Inner walls: wall line `WALL_INSET` (0.15 m) inside the room edge, thickness `WALL_T`
  (0.25 m). Back-to-back rooms (garde / epreuves / heraut) share ONE wall on the common
  edge, drawn by the west/north room; wide pillars bridge corners.
- Outer walls (user request): thickness `PERIMETER_T` 0.6, outer face flush with the map
  edge (`OUTER`), centre on `PERIMETER_LINE` (OUTER ± T/2), inner face `PERIMETER_INNER`
  (OUTER ± T), about 0.1 m inside the room edge. `BOUND_LINE` is the `BOUNDS` line per side;
  `perimeterSides(room)` gives a room's sides on it. Those room sides and `edgeRuns` (corridor
  ends) lie on `PERIMETER_LINE` with `WallRun.thick = PERIMETER_T`; `edgeRuns` skips rooms'
  stretches with the same `perimeterSides` predicate, so nothing is doubled. Any run meeting
  an outer wall stops at its inner face. `placeRun` uses `run.thick` for wall, barrier and
  decor depth; `wallIsFree` measures `FREE_AHEAD` from the inner face.
- Perimeter pillars: map corners always get a T×T pillar; room corners on two outer sides are
  skipped; a slot pillar between two edge rooms goes through the wall; other edge corners
  stand against the inner face. Pillars as deep as the wall (gate jambs, slots) are
  T + `PERIMETER_PILLAR_EXTRA` (0.06) deep, extending inward only, and the gate lintel is
  T − 0.04 deep, to avoid coplanar z-fighting.
- No room door may sit on a map-edge side (tested): door pillars assume the inset wall line.
- Castle gate: `GATE` in `layout.ts` (south side only, x 4→7, end of the x=5 corridor).
  `edgeRuns` leaves it open; `gate()` in `dungeon.ts` adds two `GATE_JAMB` (0.6 m) jambs, a
  lintel at `GATE_H` 2.2 (squashed wall model) and two outward torches, all on
  `PERIMETER_LINE.s`. Every gate piece shares the gate-middle anchor so the gate sinks as
  one piece with the cutaway. The Concierge (cx 10.5, w 7)
  has its door on the north (z=5.5 corridor). Not verified: gate jambs vs the nearby
  Concierge wall seat / Héraut chest overlap.
- Outside the castle (forest, moat, drawbridge, night shading, pan clamp):
  `docs/ai/night-forest.md`.
- Cutaway (user-designed rule): each tall wall piece, with the torch/banner sharing its
  anchor, sinks when its anchor projects below an upside-down parabola through the mouse
  cursor (`inForeground`, NDC, `CUT_CURVE = 0.3`). Low barrier walls always stand. The
  pointer starts at screen centre and keeps its last position. Sinking height steps through
  the pure `cutHeight(prev, target, dt, reduced)` (`dungeon.ts`, `CUT_SPEED` 10), shared by
  `CutawayKit` (`Structure.tsx`) and the corner towers.
- Corner towers (four, outside the `OUTER` corners, celebration heralds stand on them):
  `docs/ai/celebrations.md`.
- Lighting: Canvas shadows, drei `SoftShadows`, `NeutralToneMapping`, one shadow-casting
  sun. Floors and small shapes/models (< 0.3 m, or scale < 0.6) cast no shadow.
- Rooms have no title signs (removed at the user's request).

### Workstations (posts)
- `layout.ts`: `POST_IDS` (18), `PostId`, optional `Prop.post`, `postGroups(room)` →
  `{ posts: { post, props }[], decor }`, `POST_ROOM` (`Map<PostId, RoomId>`). Every
  functional prop carries a post; decoration kinds (`DECOR_KINDS`) never do (tested). A multi-function room has one post per function:
  biblio / scriptorium, atelier / chevalet, epreuves → relecture / labo, heraut → estrade /
  inspection.
- `Post.tsx` wraps a post's pieces. In `useLayoutEffect` it computes, once, one padded
  `Box3` hit box PER PIECE (furniture is already loaded: it sits inside the dungeon's single
  Suspense). Hit boxes are `visible=false` but still raycast; only the hit-box group has
  handlers, the furniture itself is never raycast.
- Hover glow: `highlight.ts` `setHighlight(root, on)` swaps each `MeshStandardMaterial` for a
  cached emissive clone, keeps `{ original, glow }` in `userData`, and restores only if the
  mesh still holds the glow. Shared kit materials are never mutated. The post whose card is
  open stays lit.
- Pointer rules (`cursor.ts`): `setPointerHover(key, on)` is the single cursor owner (keys
  `agent:<id>`, `post:<id>`). Clickable objects carry the frozen `TARGET_USER_DATA`;
  `nearestTarget(e.intersections)` picks the nearest target along the ray, re-decided on
  every pointer over/move and on click. Posts never `stopPropagation` on hover;
  `AgentFigure` stops on pointerover and click. `CLICK_MAX_DRAG_PX = 2` (R3F's pointer-missed
  limit) is shared by agents and posts: a release after a camera drag selects nothing.
  Right click on an agent slaps it (see Slap gag below). Resting tavern figures are
  selectable like the others (`onSelect` switches on all pointer interactions; their card:
  `docs/ai/agent-lifecycle.md`).
- Store: `selectedPost` / `selectPost`, reset on route change; Canvas `onPointerMissed`
  clears both agent and post selection.
- `ui/PostCard.tsx`: card at the top right of `.office__scene` (top 24px, width
  `min(320px, 100% - 24px)`) inside a persistent `aria-live` wrapper. Same dark parchment
  style as `.agent-dialog` / `.agent-info` (the `--dlg-*` tokens are declared on
  `.post-card`, double gold border). Order: overhanging title plate `.post-card__plate`
  (h2 with the post icon `<DestinationIcon kind={postDestination(post)}
  className="post-card__icon">` at its left), then the room name as a gold uppercase
  eyebrow below the plate, then role, then the "who" line via `t.labelled`. The close
  button `.post-card__close` shares the `.agent-dialog__close, .agent-info__close` rule
  and focus rule. Escape closes
  (ignores `defaultPrevented` / `isComposing`; moves focus to the list button only if focus
  was in the card); × focuses the post's list button (`preventScroll` on mouse).
- `ui/PostList.tsx`: "Lieux du donjon" in the side panel, grouped by room, `aria-pressed`
  buttons with ids `postButtonId(post)`. It is the keyboard / screen-reader route to posts
  (WCAG 2.1.1; the accessibility gate blocked without it). The side panel is labelled
  "Agents et lieux" and the canvas label names both lists.
- Post texts: `docs/ai/i18n.md`.

### Agent figures
- Ghosts (stopped `cli` sessions that never worked) are procedural meshes, not KayKit
  figures: `docs/ai/agent-lifecycle.md`.
- Looks (`characters.ts`): a `Look` is a body (`pack`: `'adventurers'` by default, or
  `'skeletons'`) plus optional `right` / `left` held props
  (`PropRef { pack: 'adventurers_props' | 'tools' | 'skeleton_props' | 'dungeon'; model }`;
  `'dungeon'` serves the potion bottle `POTION_PROP`).
  `SKELETON_LOOKS`: three bare `Skeleton_Minion` bodies (Blade, Axe, Blade); `SkeletonModel`
  is only `'Skeleton_Minion'`. Main agents use `MAIN_BODY`
  (`Knight`). Every subagent figure, whatever its look, is scaled 0.85 by kind in
  `AgentFigure` (whole group: model, tag, ring, disc). Subagents get a role look from `LOOKS`, keyed by the
  lower-case agent TYPE (20 entries: the user's agents plus `Explore`, `Plan`,
  `general-purpose`, `claude-code-guide`, `statusline-setup`). `lookFor(kind, agentType)`
  looks up case-insensitively with `Object.hasOwn`; an unknown type gets
  `SUB_BODIES[FNV-1a(type) % 5]` with empty hands, `''` gets `SUB_BODIES[0]`. Keying by
  type, not agent id, makes every agent of a type and its resting figure `rest:<type>` look
  alike. `LOOKS` entries, `PropRef`s and grips are frozen.
- Held props: `Held` in `AgentFigure.tsx` clones the prop (`scene.clone()`, geometry and
  materials shared, `castShadow` on the clone's meshes) and mounts it via R3F `createPortal`
  into bone `handslotr` / `handslotl` (GLTFLoader strips the dots of `handslot.r`), inside a
  group carrying the grip. A dev warning fires when a hand slot is missing. Grips:
  `PROP_GRIP` / `gripFor` hold position/rotation/scale for `tools` models and the `dungeon`
  potion bottle; Adventurers props fit
  the slot as they are. The slot's local X points down, so upright tools turn a quarter turn
  on Z; the lantern turns on −Z (hangs).
- Walking: cruise `CRUISE_SPEED` 9 u/s, `ACCELERATION` 18 u/s², `MIN_SPEED` 0.3, with
  ease-in / ease-out over the WHOLE route (braking curve `sqrt(2·A·remaining)` on the total
  remaining distance, so no stop at corners). Speed lives in a ref in `AgentFigure`, reset
  to 0 when the path empties; a reroute keeps the current speed. Facing uses `turnToward`
  with exponential rates (`WALK_TURN_RATE` 14, `REST_TURN_RATE` 6).
- Clips: `clipFor` (pure, in `characters.ts`) picks, in priority order: `ClipInput.scripted`
  (a clip imposed by a scripted scene such as the ambush; ignored under reduced motion) > spawn
  (`Spawn_Ground`, once, ×1.5, only for a figure whose `start` is the lockers `SPAWN` and not
  done; one coming from a resting seat just walks) > hit (`Hit_A` / `Hit_B`, once, not
  looped; ignored under reduced motion) > drinking (`ClipInput.drinking`: `Use_Item` once,
  potion gag; ignored under reduced motion) > moving (`Walking_A`, or `Running_A` above
  `RUN_THRESHOLD`; rate = speed / measured clip speed, capped at `MAX_CLIP_RATE`, with a
  0.5 floor for `Walking_A` only) > altar wait pose (`ClipInput.altar`: sleeping, sitting,
  then pacing, which reduced motion skips; `docs/ai/altar-wait.md`) >
  kneeling at the altar (`PickUp` frozen at `KNEEL_POSE_TIME`) > place (`ClipInput.place`:
  work gesture or seated pose, see Work gestures below) > done (`Idle_A` frozen, no
  transparency) > working (`Interact`) > waiting (`Idle_B`). Reduced motion: still poses,
  turns snap, no spawn; position still moves. Measured clip lengths (`SPAWN_CLIP_TIME`,
  `HIT_CLIP_TIME`, `DEATH_CLIP_TIME`, `USE_ITEM_CLIP_TIME`) are checked against the GLB by a
  test (helper pattern in `dungeon.test.ts`).
- Clips loading: `clipCatalog.ts` holds `ANIM_FILES` (same list and order as the manifest's
  `animations` models, tested), the frozen `CLIP_FILE` catalog of all 131 clips (T-Pose
  excluded) → file (checked against the GLBs by a test), the `KitClip` type and
  `animFilesFor(clips)`. In `characters.ts`, `CLIPS` is the deduplicated union of the theme
  arrays `BASE_CLIPS`, `ALTAR_CLIPS`, `AMBUSH_CLIPS`, `HERALD_CLIPS`, `WORK_CLIPS`,
  `BONUS_CLIPS` (each `as const satisfies readonly KitClip[]`, one clip per line, separated
  by frozen comments so parallel branches merge cleanly); `ClipName` is their union;
  `ANIM_FILES_USED = animFilesFor(CLIPS)`. `kit.ts` `useAnimFiles()` loads the module-level
  `ANIM_URLS` (from `ANIM_FILES_USED`) with one `useGLTF(array, false)`; `preloadKit` skips
  the `animations` pack and preloads the same array (r3f caches an array load under the
  whole array, so it must be the same key). `AgentFigure`'s `useClips` flattens the loaded
  animations, filters them by `CLIPS` and warns in DEV on missing or duplicate clips.
  Agents, ambush skeletons (`Ambush.tsx`) and heralds (`Herald.tsx`) all go through
  `Character` → `useClips`.
- Work gestures and seated poses (`workGestures.ts`, pure; plan
  `plans/plan-gestes-travail-2026-11-15.md`): a figure standing still at its place plays a
  gesture fitting its room or post, or sits.
  - Seat: `seatOf(spot.id, room, station)` parses `<room>:<kind>:<n>` into `SeatRef`
    (`station` / `seat` / `wall` / `scatter` / `other`; queue, spawn, outside and other
    rooms' ids are `other`). `AgentFigure` memoises it per spot.
  - `placeClip({room, station, seat, state, reducedMotion, throwing})` → `ClipChoice | null`
    (null = default chain). `AgentFigure`'s `useFrame` writes it to `Motion.place` only when
    at its place (`atPlace`) and `m.altar === null`; `clipFor` plays it after the altar
    poses and kneeling.
  - Working gestures: `ROOM_GESTURES` (per `RoomId`, list picked by `seat.index % length`
    so neighbours differ), overridden by `STATION_GESTURES` for `chevalet`, `boulier`,
    `relecture` and `labo` only (`estrade` / `inspection` use their room's). `autel` and
    `taverne` have no entry (altar: `docs/ai/altar-wait.md`); a non-working figure outside
    the tavern gets null.
  - Seated poses: `CHAIR_CLIP` `Sit_Chair_Idle` on `seat`-kind places of `taverne` and
    `detente` (stools / couch); `FLOOR_CLIP` `Sit_Floor_Idle` on wall and scatter places.
    Tavern: any non-working state sits (resting figures, waiting mains:
    `docs/ai/agent-lifecycle.md`). Detente: working figures sit, except `PUSH_UPS_CLIP` on
    wall place 0.
  - Reduced motion: seated poses are held at `SIT_STILL_AT`; push-ups give way to the held
    floor pose; standing gestures (and the throw) return null, so `Idle_A` held.
  - Dovecote throw: `THROW_CLIP` `Throw`, once, while `Motion.throwAt ≥ 0`
    (`advanceThrow`, `THROW_CLIP_TIME` 41/30 s, tested against the GLB). Trigger:
    `docs/ai/pigeon-gag.md`.
  - `WORK_CLIPS` pulls `Rig_Medium_Tools`, `Simulation`, `CombatMelee` and `CombatRanged`
    (about 1 MB each) into `ANIM_FILES_USED`, loaded before any figure appears (accepted
    cost).
- `AgentFigure` structure: the parent runs the walk and writes a `Motion` ref (exported,
  with `scripted`); the exported
  `Character` child (own `Suspense` + `CharacterBoundary` error boundary with a capsule
  fallback) clones the model with `SkeletonUtils`, animates through drei `useAnimations`
  with manual weight blending (`FADE` 0.2 s), hides the model until the first clip is
  applied, and disposes skeletons on unmount.
- Tag (drei `<Html>`, wrapper class `agent-tag-anchor`): name in `<span class="agent-tag"
  aria-hidden>` (the side list is the accessible source); waiting markers (gem, altar
  request bubble): `docs/ai/agent-lifecycle.md`; border = session colour via `--session-color`; selection = outline `#185fa5`
  offset 2px + bold (not colour alone); forced-colors rules in `styles.css`. A floor disc
  in the session colour sits inside the state ring.
- Destination badge (user feature): a walking figure shows a round `DestinationBadge`
  (`.destination-badge`, 28px, session-colour border) above its name, inside the tag
  `<Html>`. Visible only while the path is non-empty: hidden at rest, during the spawn clip
  and on arrival; follows reroutes. While shown it hides the altar request bubble (CSS
  `.agent-tag-anchor[data-travelling] .request-bubble`). Icon = `destinationOf(spot)`:
  the post when the assigned seat is one of that post's seats, else the room (post full,
  shared/wall/scatter seat, altar queue). Bobs with `request-bob` (off under reduced
  motion); forced-colors uses Canvas/CanvasText.
- Icons (user decision: one per room AND per dedicated post): 25 hand-drawn 24×24 line SVGs
  in `ICONS: Record<Destination, ReactNode>` (15 `RoomId`s + 10 `StationId`s), decorative
  (`aria-hidden`, `focusable=false`, no i18n key; the side list and `StatusAnnouncer` stay
  the accessible source). `DestinationIcon` is used by `DestinationBadge` and by the post
  card (icon of `postDestination(post)`, the same SVG an agent carries while walking to
  that post). Rooms have no title signs, so no room-sign icon exists.
- Slap gag (user request: purely visual and humorous, à la Dungeon Keeper, no other effect):
  - Trigger: right click without drag on a selectable figure; left click still selects.
    Decided on RELEASE: `onPointerDown` / `onPointerUp` with `button === 2`, distance
    ≤ `CLICK_MAX_DRAG_PX` from `clientX/Y`, both gated by `nearestTarget(e.intersections)`
    being the figure's group. `onContextMenu` only calls `preventDefault`: `contextmenu`
    fires on press on macOS/Linux, so it cannot tell a click from an OrbitControls right-drag
    pan. Resting tavern figures can be slapped too.
  - Bus (`slap.ts`): `slapAgent(id)` / `onSlap(id, cb)` per agent; `hasSlapTarget(id)` +
    `watchSlapTargets(cb)` (notified on first listener added / last removed).
    `hitClipFor(count)` alternates `Hit_A` / `Hit_B` (NaN/Infinity → `Hit_A`);
    `SLAP_EFFECT_MS` 1500.
  - Figure: `Motion` gains `hit` / `hitId` / `hitLeft`. The walk pauses while `hitLeft > 0`
    (`HIT_FALLBACK` 0.6 s until `Character` sets the clip's real duration), then
    re-accelerates from 0. `Character` restarts the hit clip on a new `hitId` (`reset().play()`
    if it is the current action, else deletes it from the weights so the normal path restarts
    it). While spawning/loading (`spawnLeft !== 0`) or under reduced motion the hit clip is
    skipped but the DOM effect and sound still play. `Motion.hitWait` (`SWING_IMPACT`) delays
    the hit clip until the hand lands; the walk pause covers wait + hit (`hitLeft` frozen
    during the wait).
  - Swing math (`slapSwing.ts`, pure, tested): `SWING_DURATION` 0.32 s, `SWING_IMPACT`
    0.12 s; `swingAngle(time)` linear, 0 at impact; `swingPose(time, dir)` returns
    `{right, up, toward, tangentRight, tangentToward, roll, scale}` in the camera's
    horizontal frame around the head, `null` outside the sweep; scale grows/shrinks at the
    ends. `RADIUS` 1.4 m with the pivot 0.5 m behind the head so the hand crosses in front
    of the face; wide on purpose (at the usual camera distance a figure is a few dozen px
    and the name tag covers the head).
  - 3D hand (`SlapHand.tsx`): three.js primitives (leather cuff + brass band, box palm, 4
    capsule fingers, capsule thumb, KayKit palette; no KayKit pack has a hand); geometries
    and materials shared at module scope (`dispose={null}`). Keyed by slap count in
    `AgentFigure`, not mounted under reduced motion; `dir` alternates per slap. `useFrame`:
    camera frame from `camera.matrixWorld` (right flattened, `toward = right × up` so it
    stays defined top-down), head at `HEAD_Y` 1.25 local, world pose → parent-local
    (`worldToLocal` + inverse parent world quaternion); back of hand blended `FACE_CAMERA`
    0.8 toward the camera (a hand facing its motion is seen edge-on from above), fingers
    toward screen-up, `HAND_SCALE` 2 (inherits the sub-agent 0.85 scale, intended).
    Drawn over walls: materials `transparent: true`, opacity 1, so they render in the last
    (transparent) pass; cuff mesh `renderOrder` 1000, `frustumCulled` false, its
    `onBeforeRender` sets the depth mask true then calls `renderer.clearDepth()`; other parts
    `renderOrder` 1001. Raycast disabled on hand meshes.
  - Effect: one stable drei `<Html>` per selectable figure at `SLAP_Y` 1.5 (class
    `slap-anchor`, `zIndexRange [30, 20]`) holding `<SlapEffect key={slap}>`; the key remount
    restarts the CSS animations. State is cleared after `SLAP_EFFECT_MS` and in the effect
    cleanup (Suspense re-run). `SlapEffect`: 3 ★ stars spinning above the name tag, comic
    bubble `t.slap.sound`. CSS `.slap*`: reduced motion hides the stars and keeps the bubble
    static; forced-colors rules.
  - Sound (`ui/slapSound.ts`): recorded file `public/sounds/slap.wav` (PCM 16-bit
    mono 22050 Hz, 0.86 s; supplied by the user as `SLAP.WAV` in the gitignored
    `assets-src/`, copied unmodified; the user confirmed it is a free sound, exact source
    and licence not recorded yet; SHA-256 and status in `public/sounds/LICENSE.txt`). `preloadSlapSound()` (called in `AgentFigure`'s slap
    effect) fetches the bytes with no `AudioContext`. On a slap, the single page
    `AudioContext` (created lazily in the gesture, never closed or recreated) decodes a copy
    once and plays an `AudioBufferSourceNode` at gain 0.6, max 3 overlapping voices. A failed
    fetch or decode clears the cache (next slap retries) and logs one `console.warn`. Plays
    only when `running`, else after one in-flight `resume()`; slaps during a pending resume
    are dropped, not queued. `playSlapSound(delay)` schedules the sound `SWING_IMPACT`
    after the click via `source.start(currentTime + delay)`; on a suspended context the
    delay counts from the resume.
  - Keyboard route: `AgentInfo` "Baffer" button `.agent-info__slap`, `aria-label`
    `t.info.slapLabel(name)` containing the visible text (tested in `i18n.test.ts`), shown
    only while `hasSlapTarget` (`useSyncExternalStore`); if it disappears while focused,
    focus moves to `#agent-info-title`. For a resting tavern figure, the `RestCard` slap
    button plays that role (`docs/ai/agent-lifecycle.md`).
- Potion gag, "potion of oblivion" (user request: one of five humorous gags, like the slap;
  purely visual, nothing sent to the server, work untouched): when Claude Code compacts a
  session's context, its agent drinks a bottle, staggers, and stars orbit its head.
  - Hook: `'PreCompact'` is in `EVENTS` of `scripts/hooks-lib.mjs`; existing installs must
    rerun `npm run hooks:install`. Server code unchanged: `applyHook` hits `default:` (only
    the generic `live` / `lastActivityAt`; not in `ACTIVITY_EVENTS`), `hookEventSchema`
    unchanged, `summarize` broadcasts it as a live `{type:'event'}`. Payload `trigger` /
    `custom_instructions` are never read, stored or broadcast. Live events are not replayed
    on reconnect.
  - Bus (`potion.ts`, pure): `store.ts` `onMessage` event branch calls
    `potionTarget(event, sessions)` (only `POTION_EVENT`; a subagent id only if that subagent
    is in the snapshot, else null; main → `session.main.id`, never rebuilt from the session
    id) then `drinkPotion(id)`. `onPotion(id, cb)` per-id listeners, like `slap.ts`;
    `hasPotionTarget` is used only by tests for now.
  - Timing (`potion.ts`): `DRINK_S` = `USE_ITEM_CLIP_TIME` (1.6 s), `STAGGER_S` 3,
    `POTION_S`, `POTION_EFFECT_MS` 4600; `potionPhase(elapsed)` → `'drinking' |
    'staggering' | null`; `staggerSway(elapsed)` → `{roll, pitch}` (≤ `SWAY_ROLL`,
    `SWAY_PITCH`), zero while drinking, squared decay to zero.
  - Figure: `Motion.potionAt` (seconds since drinking started; absent or -1 = inactive) and
    `potionId` are OPTIONAL so the skeletons' `Motion` literal in `Ambush.tsx` stays
    untouched. Gulp = `ClipInput.drinking` in `clipFor`, walk paused; `Character` restarts
    the gulp on a new `potionId`. Stagger: inner `<group ref={sway}>` around
    `CharacterBoundary` gets `staggerSway(potionAt)`, only while active. A slap during the
    gulp jumps `potionAt` to `DRINK_S` (straight to staggering). A figure still
    spawning/loading ignores the potion (unless reduced motion); doomed (`exit`) figures
    ignore it. Suspense cleanup resets `potionAt` and the HTML state.
  - Bottle: `POTION_PROP` (`dungeon` pack `bottle_C_green`, `PROP_GRIP` entry
    rotation `[0, 0, 0]`, scale 0.8, position `[0, -0.62, 0]` so the neck sits in the fist
    and the body hangs below the hand) is mounted through `Character`'s `extra` prop in its own Suspense for the
    whole effect. Its visibility, and hiding the look's right prop (only once the bottle has
    loaded), is set per frame from the chosen clip (`choice.name === 'Use_Item' &&
    !scripted`), never from a timer.
  - HTML: separate drei `<Html className="potion-anchor">` at `POTION_Y` 1.75, mounted only
    while active, holding `<PotionEffect key={potion}>` (`PotionEffect.tsx`): 4 ★ orbiting
    the head (CSS `potion-orbit`) and bubble `t.potion.bubble`, both delayed by CSS var
    `--potion-drink` and faded over `--potion-stagger` (set from the `potion.ts` constants).
    Reduced motion: no clip, sway or bottle; static stars and bubble. Forced-colors rules in
    `styles.css`. `aria-hidden`, decorative (accessibility audit accepted, like the slap).
  - Test command: `installPotionCommand(selected, window)`, called in `store.ts`, installs
    `window.agentOffice.potion(id?)` (selected agent when no id; returns true if a figure
    reacted). Kept in production builds on purpose (visual only, no network). Rest figure
    ids are lower case (`rest:hermione`).
- Console namespace: `gagCommands(window)` (`gagCommands.ts`, pure, type `GagCommands`)
  returns the shared `window.agentOffice` record, creating it or replacing a non-object
  value; used by `potion.ts`, `mishap.ts`, `altarWait.ts`, `celebrate.ts` and
  `Pigeons.tsx`, each adding its own key.
- Mishap gag, boiler and flask (user request: purely visual, client-only, no server or
  shared change): a failed tool call blows up a room prop and covers the agent in soot.
  - Trigger: the store's `events` list (`HookEventSummary`, already broadcast), only
    `PostToolUseFailure`. `mishapFor(event, agentRoom)`: flask = Bash/PowerShell command
    that `isTestCommand` recognises as a test runner (tokenised parser, no
    nested-repetition regex, reads at most `MAX_COMMAND` 1000 chars) → green blast at the
    `epreuves` alchemyBench + green soot on the agent wherever it stands; boiler = any other
    failure of an agent whose room is `machines` → light-grey puff at the `machines` boiler
    + black soot. `mishapTarget` = `agentId`, or `<sessionId>#main`; agents not in the
    route's sessions are ignored.
  - Watcher (`MishapWatcher.tsx`): queues failures and decides after the next `sessions`
    change (snapshots are throttled 100 ms server-side, the event is sent at once, so the
    agent's room is only known after it) or after `MISHAP_SETTLE_MS` 400. Dedupe by a
    `WeakSet` of event objects (`seq` restarts with the server); events present at mount
    never replay.
  - Bus (`mishap.ts`, pure): `triggerMishap(id | null, kind)`, per-figure `onMishap(id, cb)`,
    room-level `onRoomMishap(cb)`, `hasMishapTarget(id)`. Constants `SOOT_HOLD_MS` 3000,
    `SOOT_FADE_MS` 1500, `SOOT_MS`, `MISHAP_BUBBLE_MS` 1500, `PUFF_MS` 1400, `PUFF_GAP_MS`
    400, `SOOT_COLORS`, `PUFF_COLORS`; `sootAmount(elapsed, reduced)`,
    `puffParticles(progress)`.
  - Soot (`Soot.tsx`): one `<Soot root={group} mishap>` per non-doomed figure in
    `AgentFigure`, re-armed by `mishap.n` (counter kept in a ref). Swaps the figure's
    `SkinnedMesh` materials for tinted clones flagged `userData.sootClone`, restores the
    originals and disposes the clones in the frame loop or on unmount; never mutates shared
    KayKit materials; retries the swap until the model has loaded. Reduced motion: full soot
    for `SOOT_MS`, then off at once.
  - Room effects (`MishapProps.tsx`, mounted in `Office.tsx`): one PERMANENT dark
    `pointLight` per source, only animated during a puff (constant light count: a transient
    light made three.js recompile every lit material); module-scope shared sphere geometry
    and one material per kind (`dispose={null}`); puffs throttled by `PUFF_GAP_MS`
    (WCAG 2.3.1); none under reduced motion.
  - Bubble: `MishapEffect.tsx` inside the existing slap `<Html>` anchor (`.mishap`,
    `.mishap--flask`), `aria-hidden`, text `t.mishap.boiler` / `t.mishap.flask`; `.mishap*`
    in `styles.css`.
  - Test commands: `installMishapCommands(selected, window)` in `store.ts` adds
    `agentOffice.boiler(id?)` / `agentOffice.flask(id?)` (always available, production
    included, user decision); no id = selected agent; the room effect plays even with no
    figure; returns true when a figure reacted. Human console doc:
    [docs/commandes-console.md](../commandes-console.md).
- Samuel-Morse pigeon gag (pigeons leave the dovecote on HTTP calls):
  `docs/ai/pigeon-gag.md`.
- Spots (`layout.ts`): `Spot` carries `room: RoomId` and optional `station?: StationId`
  (key absent, not `undefined`). `RoomDef.stations` is `Partial<Record<StationId, Seat[]>>`,
  `STATIONS` maps agent type → `StationId`, `candidateSeats` returns
  `Candidate {id, seat, station?}`, `toSpot(room, seat, id, station?)`. Every `queueSpot`
  rank has room `autel`; `SPAWN` has room `taverne`.

## Relevant Files
- `packages/web/src/scene/dungeon.ts` — pure geometry, no three scene: `KIT_SCALE`,
  `KitItem`, `Placement` (`Map<model, KitItem[]>`), `roomFloor`, `corridorFloor`,
  `foundation`, `OUTER`, `PERIMETER_T`, `BOUND_LINE`, `PERIMETER_LINE`, `PERIMETER_INNER`,
  `PERIMETER_PILLAR_EXTRA`, `perimeterSides`, `WallRun`, `wallRuns`, `edgeRuns`,
  `sharedSides`, `wallLayout`, `GATE_JAMB`, `GATE_H`, `WALL_T`, `WALL_INSET`, `CUT_CURVE`,
  `inForeground`, `CUT_SPEED`, `cutHeight` (towers: `docs/ai/celebrations.md`).
- `packages/web/src/scene/Structure.tsx` — `Floors` (instanced), `Walls`, `CutawayKit`.
- `packages/web/src/scene/gagCommands.ts` — shared `agentOffice` console namespace
  (`packages/web/test/gagCommands.test.ts`).
- `packages/web/src/scene/KitInstances.tsx` — `<KitInstances>` (one InstancedMesh per model
  part, for repeated pieces; optional `material` override and `receiveShadow`) and `<Kit>`
  (single model, for furniture).
- `packages/web/src/scene/props.tsx` — `PROPS` renderer per `PropKind` (KayKit models plus
  simple shapes in a KayKit-matched palette).
- `packages/web/src/scene/kit.ts` — `useKitGLTF` (drei `useGLTF(url, false)`: Draco off, so
  no third-party decoder fetch); one shared material per pack + material name. `kitUrl` is
  module-private and throws unless the pack / model is listed in the manifest.
  `useAnimFiles`, `ANIM_URLS`, `preloadKit`.
- `packages/web/src/scene/clipCatalog.ts` — `ANIM_FILES`, `CLIP_FILE`, `KitClip`,
  `animFilesFor`. Never edited to add a clip.
- `packages/web/src/scene/kit-manifest.json` — models and textures per pack; a pack may set
  `"format": "glb"` (self-contained, `textures: []`).
- `scripts/import-kaykit.mjs` (`npm run kaykit:import`) — copies manifest entries from
  `assets-src/<pack>/` (gitignored, unzipped by the user) to `packages/web/public/kaykit/<pack>/`
  (committed). Source of `furniture`, `halloween`, `restaurant`: GitHub repos
  `KayKit-Game-Assets/KayKit-{Furniture,Halloween,Restaurant}-Bits-1.0` at commits
  `96d5930a8dbdb363409bbc2d3341718b00e17c9c` / `6dc69bf6b2fa766a985754f35ec6a0324090e6c6` /
  `153c8a7535b48237854cb54ff6890679f8c574d1`, unpacked as
  `assets-src/gh-<name>/repo/addons/kaykit_<name>_bits/Assets/gltf`; their `LICENSE.txt`
  was fetched separately (the zipball omits it).
- `packages/web/src/scene/characters.ts` — pure, no three.js: `MAIN_BODY`, `SUB_BODIES`,
  `LOOKS`, `SKELETON_LOOKS`, `lookFor`, `PROP_GRIP`, `gripFor`, `clipFor`, the clip theme
  arrays, `CLIPS`, `ClipName`, `ANIM_FILES_USED` and the clip constants / measured clip times.
- `packages/web/src/scene/workGestures.ts` — pure: `seatOf`, `SeatRef`, `ROOM_GESTURES`,
  `STATION_GESTURES`, `placeClip`, seated / throw clip constants, `SIT_STILL_AT`, throw bus
  (`throwPigeon`, `onThrow`), `advanceThrow` (`packages/web/test/workGestures.test.ts`).
  Stools: `TABLE_STOOLS` / `DICE_STOOLS` in `props.tsx`.
- `packages/web/src/scene/AgentFigure.tsx` — walk, `Motion`, `Character` (takes a `Look`;
  both exported, reused by `Ambush.tsx`), `Held`, `CharacterBoundary`, tag, destination
  badge toggle, slap handlers and anchor.
- `packages/web/src/scene/slap.ts` (pure bus and clip choice), `scene/slapSwing.ts` (pure
  swing pose), `scene/SlapHand.tsx` (3D hand), `scene/SlapEffect.tsx` (stars, bubble),
  `ui/slapSound.ts`, slap button in `ui/AgentInfo.tsx`; `.slap*` in `styles.css`;
  `packages/web/public/sounds/` (`slap.wav`, `LICENSE.txt`).
- `packages/web/src/scene/potion.ts` (pure: timing, sway, `potionTarget`, bus,
  `installPotionCommand`), `scene/PotionEffect.tsx` (stars, bubble); `POTION_PROP` and
  `ClipInput.drinking` in `characters.ts`; potion handling in `AgentFigure.tsx`; wiring in
  `store.ts`; `.potion*` in `styles.css`; `PreCompact` in `scripts/hooks-lib.mjs`
  (`packages/server/test/hooks-lib.test.ts`).
- `packages/web/src/scene/mishap.ts` (pure: classification, target, soot/puff curves, bus,
  `installMishapCommands`), `scene/MishapWatcher.tsx`, `scene/MishapProps.tsx`,
  `scene/Soot.tsx`, `scene/MishapEffect.tsx`; wiring in `AgentFigure.tsx`, `Office.tsx`,
  `store.ts`; `.mishap*` in `styles.css`; `packages/web/test/mishap.test.ts`.
- `packages/web/src/scene/destinations.ts` — pure: `Destination = RoomId | StationId`,
  `destinationOf(spot)` (station ?? room), `postDestination(post: PostId)` (identity; it
  compiles only because every `PostId` is a `RoomId` or a `StationId`).
- `packages/web/src/scene/DestinationIcon.tsx` — `ICONS`, `DestinationIcon`,
  `DestinationBadge`. Badge styles in `packages/web/src/styles.css`.
- `packages/web/src/scene/walk.ts` — pure walking motion, no three.js: `remainingDistance`,
  `nextSpeed`, `advance` (mutates the position, shifts reached waypoints, carries leftover
  step past corners, lands exactly on the last waypoint), `turnToward`, `approach`.
- `packages/web/src/scene/layout.ts`, `Room.tsx`, `Office.tsx`.
- `packages/web/src/scene/Post.tsx`, `highlight.ts`, `cursor.ts` — posts, hover glow,
  pointer rules.
- `packages/web/src/ui/PostCard.tsx`, `PostList.tsx`; `packages/web/src/store.ts`
  (`selectedPost`, `selectPost`); Canvas `onPointerMissed` is in `Office.tsx`.
- `packages/web/test/dungeon.test.ts`, `walk.test.ts`, `characters.test.ts`, `slap.test.ts`,
  `slapSwing.test.ts`, `potion.test.ts`, `mishap.test.ts`, `layout.test.ts` (`layout.ts`: `ROOMS`, seats and `assignSpots`, altar `queueSpot`,
  `SPAWN`, `corridorPath`, `routeBetween`, `reroute`, post tagging, `postGroups`,
  `POST_ROOM`, spot `room`/`station`), `highlight.test.ts`, `cursor.test.ts`,
  `destinations.test.ts` (`destinationOf`; room ids and post names never overlap;
  `postDestination`: every `POST_IDS` entry is a `ROOMS` id or a stations key, and the
  room-wide icon choice below is pinned).

## Usage
- New model: add it to `kit-manifest.json`, run `npm run kaykit:import`. Never hand-copy
  files into `public/kaykit/`. Load every model through `useKitGLTF`, never `useGLTF` directly.
  Only free-tier CC0 assets may be committed (public repo); the Mixed Bag preview images
  show EXTRA-only items that are not in the free zip. The import needs every listed pack
  folder in `assets-src/` (gitignored, so absent from a worktree): make the main checkout's
  `assets-src` reachable at the worktree root first (a junction or a copy works). Skeleton
  sources: `assets-src/skeletons/KayKit_Skeletons_1.1_FREE`. Animation sources:
  `assets-src/animations/KayKit_Character_Animations_1.1/Animations/gltf/Rig_Medium`.
- New or changed role look: edit `LOOKS` (lower-case type key) and, for a new prop, the
  manifest models of its pack. A `tools` prop also needs a `PROP_GRIP` entry calibrated by
  eye (tested: every `tools` prop in `LOOKS` has a grip, every `adventurers_props` model is
  used). All six bodies (Barbarian, Knight, Mage, Ranger, Rogue, Rogue_Hooded) share the
  Rig_Medium skeleton (23 identical bones), so the shared clip files apply to every body.
- New clip: add its name on a new line inside the matching theme array of `characters.ts`
  (any `CLIP_FILE` key; typecheck rejects typos). Its file is then loaded automatically and
  a clip listed in two themes loads once; touch neither `clipCatalog.ts`, `kit.ts` nor the
  tests (they assert `ANIM_FILES_USED` only as a lower bound). A new clip-length constant
  reads its length from the GLB with the `dungeon.test.ts` helper pattern.
- Grip calibration workflow: in Playwright, import the store by the URL actually loaded
  (take it from performance resource entries; Vite appends `?t=` after edits) and call
  `useOffice.setState({ sessions: [], roster: [...] })` so the tavern shows one resting
  figure per type. Hide other objects and move the camera for close-ups, mutate the grip
  group under the hand bone live, then copy the values into `PROP_GRIP`.
  `dungeon`-pack models are modelled upright with the origin at their base, unlike RPG
  Tools items: no quarter turn (it lays them on their side); offset `position` instead.
- Repeated pieces go through `<KitInstances>`; one-off furniture through `<Kit>`; a new
  prop is a `PROPS` entry; multi-piece room decor is a recipe (`docs/ai/room-identity.md`).
  Put placement logic in `dungeon.ts` so it stays testable.
- Any other per-agent visual reaction: reuse the `slap.ts` bus pattern (per-id listeners,
  target watch for a keyboard button) and the keyed `<Html>` remount to replay CSS effects.
  A hook-driven reaction follows `potion.ts`: a pure `xxxTarget(event, sessions)` in the
  `store.ts` event branch, then the bus. A reaction that depends on the agent's room or on
  other snapshot state (e.g. tool failures) reuses `MishapWatcher`'s approach instead:
  queue the event, decide after the next `sessions` change or a settle timeout, dedupe by
  event object identity, skip events present at mount.
- Per-figure material effects (tints, soot, flashes) follow `Soot.tsx`: swap the figure's
  meshes to flagged clones, restore and dispose in the frame loop or on unmount, retry until
  the model has loaded. A room-level light effect keeps a permanent light and animates its
  intensity, never mounts a transient light. Reuse the existing slap `<Html>` anchor for a
  new per-figure bubble rather than adding another drei `<Html>`.
- New gag fields on `Motion` must be optional (absent = inactive), like `potionAt` /
  `potionId`: several sibling gags edit the same interface, and the skeletons' `Motion`
  literal must stay untouched. A gag's console test command adds its own key on the record
  returned by `gagCommands(window)`, never replaces the namespace object, and gets a row in
  the human list `docs/commandes-console.md` (owned by `otis`).
- Scene-wide reactions to hooks (heralds, fireworks) are classified server-side:
  `docs/ai/celebrations.md`.
- Endless wait at the altar (pacing, sitting, Zzz, cobwebs, `agentOffice.autel`):
  `docs/ai/altar-wait.md`.
- Rat gag (corridor holes, tavern cheese theft, `agentOffice.rat`): `docs/ai/rat-gag.md`.
- Potion verification: build web, run a second server (port 4779, `AGENT_OFFICE_TOKEN`
  env, `docs/ai/agent-lifecycle.md`), POST hooks including
  `{"hook_event_name":"PreCompact",...}`, or call `agentOffice.potion('rest:<type>')` in
  Playwright. Resting figures are good close-up targets: hatless bodies (e.g. Hancock's)
  show the bottle; mage hats hide the hands.
- Hook-driven gag verification (potion, mishap): the test server needs an
  `AGENT_OFFICE_TOKEN` of at least 32 chars, otherwise hooks get 401. Post hooks with a
  small node `fetch` script, not curl from Git Bash (it mangled the JSON). Mishap: post a
  `PostToolUseFailure` or call `agentOffice.boiler()` / `agentOffice.flask()`. Capturing
  the puff headless needs the frozen, hand-stepped `performance.now` described for the slap
  hand under Preview below.
- Agent motion logic goes in `walk.ts`, clip choice in `clipFor` (both tested), never
  inline in `AgentFigure`'s `useFrame`, which only calls them.
- New or changed work gesture or seated pose: edit the tables in `workGestures.ts` (and add
  the clip to `WORK_CLIPS`), never a new branch in `clipFor`; a one-shot per-agent gesture
  reuses the `throwPigeon` / `onThrow` bus and an optional `Motion` timer like `throwAt`.
- Gesture preview: Vite on a free port from the worktree, Playwright, store-injected
  gallery (setup below) with working subagents placed in every room. Close-ups from the
  front or side: find the figure's `root` bone world direction and put the camera along it.
- New decor must not cover seats or a door entry (tested in `dungeon.test.ts`).
- Anything placed against or through the outer wall uses `perimeterSides` and the
  `PERIMETER_*` constants (never `WALL_INSET` there); new runs carry `thick`.
- New `RoomId` or new seat post (`StationId`, not the clickable `PostId`): add an `ICONS` entry (the `Record` type fails
  typecheck otherwise) and keep its name distinct from every room id (tested). Reuse
  `DestinationIcon` for any other place icon; never add a translated label for it.
- Scene gallery with walking figures from a worktree: Vite on 5174, Playwright,
  `useOffice.getState().navigate({page:'env', envId:'demo'})` then
  `useOffice.setState({sessions, roster: [], snapshotReceived: true})` with hand-built
  sessions; changing an agent's `room` makes it walk. Without navigating to an env route
  the home page shows and no scene renders.
- A new functional prop needs a `post`; a new function in a room needs a new `PostId` plus
  its texts in fr / de / en (typecheck and tests enforce both). A new `PostId` must also be
  a room id or a `StationId` (typecheck via `postDestination`, plus a test), so the post card
  has an icon. Decoration kinds stay post-less.
- Post card styling: reuse the agent-dialog parchment tokens and close-button rule; do not
  give the card its own palette.
- New clickable 3D object: give its hit object `TARGET_USER_DATA`, drive the cursor only
  through `setPointerHover` (never write `document.body.style.cursor` elsewhere), choose
  with `nearestTarget`, and reject drags with `CLICK_MAX_DRAG_PX`. Every clickable 3D thing
  also needs a keyboard route in the side panel (as `PostList` does).
- Visual states (hover, selection) go through `setHighlight`-style material swaps; never
  mutate kit materials, which are shared per pack.
- Preview: `.claude/launch.json` entry `agent-office-web` runs Vite dev on 5173, proxying to
  the test server on 4778. `agent-office` / `agent-office-test` serve `packages/web/dist`,
  which needs `npm run build` first. Previewing from a worktree with fake hooks:
  `docs/ai/agent-lifecycle.md`. The preview launcher reads the main folder's
  `.claude/launch.json`, so from a worktree run Vite on another port (the WebSocket is
  refused there, which is fine for store-injected galleries; `/env/<anything>` renders the
  scene without a server). Ports 5174, 5175 and 5181 may already be held by another
  session's Vite: check with `netstat` that the port belongs to this worktree's process (or
  pick a free one), otherwise the page shown is another branch's code. A worktree can
  also serve its build on another port: `npm run build`, then
  `AGENT_OFFICE_PORT=4790 AGENT_OFFICE_TOKEN=… npm run start`. The in-app Browser pane, when
  hidden, gives the Canvas size 0 and renders no frames, and shown it renders about 3 fps;
  use Playwright for visual verification. Headless Playwright renders about 1–2 fps (software GL): wait about 2 s
  before checking rAF-driven effects (focus return, highlight screenshots). Give Playwright
  file outputs absolute paths inside the worktree; relative paths resolve elsewhere.
  A headless screenshot takes about 4 s, longer than the 1.5 s slap effect: to capture it,
  patch `window.setTimeout` for the 1500 ms delay and pause `document.getAnimations()` on
  `.slap*` elements first. For the 0.32 s 3D hand sweep: zoom the camera with the mouse
  wheel first (the hand is small at the default distance), override `performance.now` with
  a frozen value (`THREE.Clock` reads it), slap, then step the frozen value to chosen ms and
  screenshot; restore with `delete performance.now`.
  `.playwright-mcp/` is gitignored because captures may show real session names; keep it so.
  Per-room screenshots: reach the R3F store through the fiber module's `_roots` (import the
  `@react-three_fiber` dep URL taken from performance entries) and move camera / controls.
  Draw calls: wrap the `WebGL2RenderingContext` draw functions in an init script (guard
  against double install).
- Where figures rest, wait, appear and leave (tavern, altar, forest entry, ambush, roster):
  `docs/ai/agent-lifecycle.md`.
- A visible change to the castle gate, walls or forest means re-capturing the home page
  image: `docs/ai/ui-theme.md`.

## Notes
- The import script rejects unsafe names, `..` paths, symlinks, glTF extensions (Draco /
  Meshopt would fetch a decoder from a CDN), and glTF referencing files other than its own
  `.bin` and the pack textures. For `.glb`, `checkGlb` walks every chunk (exactly one JSON
  chunk first, an optional BIN, nothing else, aligned lengths) because the browser keeps
  the LAST JSON chunk; no buffer/image `uri`; it writes the validated buffer. Keep these
  checks when editing it.
- Running the import rewrites existing `.gltf` files with LF→CRLF noise under
  `core.autocrlf`: restore them with `git checkout` on the `dungeon`, `tools`, `weapons`
  folders.
- Models of the `dungeon`, `tools`, `weapons` and adventurer packs that are unused are kept
  on purpose for upcoming 3D work (user decision); do not prune them as dead code. The
  room-decor packs list only models actually used.
- Inner wall footprint matches the pre-KayKit one, so seat positions are unaffected.
- Accepted limits of the thick outer walls: wall variants with relief (`wall_shelves`,
  `wall_arched`) are stretched by the 0.6 depth scale (not yet checked visually); props near
  outer walls may stand up to 0.175 m off the inner face, which moved outward from 0.275 m
  to 0.1 m inside the room edge.
- Orientation-based cutaway was tried and rejected; keep the cursor parabola.
- Attacking skeletons stay bare `Skeleton_Minion` bodies (user decision): do not use
  Skeleton_Warrior / Rogue / Mage, whose helmet or hood hides the skull from the top-down
  camera so they did not read as skeletons. Only Minion is in the manifest's `skeletons` pack.
- Tests must not import `kit.ts` or any `.tsx` file (drei / `import.meta.env`); test
  `dungeon.ts`, `layout.ts`, `walk.ts`, `characters.ts`, `slap.ts`, `slapSwing.ts`,
  `destinations.ts`, `forest.ts`, `outside.ts`, `stage.ts`, `ambush.ts`, `tavern.ts`,
  `decor.ts`, `merge.ts`, `potion.ts`, `mishap.ts`, `altarWait.ts`, `pigeon.ts`, `celebrate.ts`,
  `workGestures.ts`,
  `gagCommands.ts` and the manifest JSON.
- Walk speed was set so figures reach the room before short tasks finish (user request).
  The chibi legs walk naturally at 0.57 (`Walking_A`) and 1.4 u/s (`Running_A`) at
  `KIT_SCALE`, so feet slide at cruise speed by design. Accepted limits: a reroute to a
  target within braking distance drops speed in one frame; a doubling-back reroute turns
  at speed.
- No prop node name may equal a rig bone name: a clash would hijack animation tracks.
  Checked for the current props; re-check when adding one.
- Accepted limits of held props (review suggestions not done): props keep per-file
  materials (one texture copy per distinct held model, no `shareMaterial`); every held mesh
  casts a shadow; one R3F portal per prop (`bone.add` in a layout effect would be lighter).
- Clip blending must step weights with `approach(value, target, step)` from `walk.ts`
  (tested in `walk.test.ts`). An inline blend that took the decrease branch at
  `weight === target` flickered 1→0 every other slow frame, showing a T-pose.
- Kneeling replaced the old 30 cm sink at the altar; done agents are no longer transparent.
- Stools are render-only (no footprint, no seat data): `TABLE_STOOLS` (six per table, in
  the `longTable` recipe) and `DICE_STOOLS` (three, in `diceTable`) sit `STOOL_BACK` 1.25 from
  the table at `STOOL_SCALE` 0.7, under the `layout.ts` table seats; the detente couch seats
  sit at z −1.15 so the seated pose lands on the cushions. Moving a table seat in
  `layout.ts` means moving the `props.tsx` constants by hand: tests pin only the seat counts
  (18 tavern table seats, 2 couch + 3 dice seats).
- Work gesture accepted limits (review findings not done): one possible frame of the new
  room's gesture before the walk starts (`place` derives from the `spot` prop, the walk from
  `last.current`); stools have no footprint, so figures may brush through them on the way
  in; slapped seated figures stand for the hit; `placeClip` allocates a `ClipChoice` per
  frame, like `clipFor`.
- First-load Suspense gotcha: an upper Suspense hides and re-shows the scene while the kit
  loads; React 19.2 runs passive effect cleanups then, so `useAnimations` stops every action
  while `Character`'s refs survive. `Character` restarts its clip when the current action
  is no longer `isScheduled()`. Keep this check.
- drei `<Html>` loses its content if mounted before the canvas events connect. Agent tags
  wait for `useThree(s => !!s.events.connected)`.
- Posts must not `stopPropagation` on hover: R3F re-applies a stored stopped flag on later
  moves, which made the target choice sticky (rejected earlier design). Keep the
  `nearestTarget` decision instead.
- Destination badge mechanism, keep it: `AgentFigure`'s `useFrame` toggles
  `data-travelling` on the tag anchor (ref on drei `<Html>`, which lands on the
  `agent-tag-anchor` div) only when the state changes, so no per-frame React render. It
  also requires `badge.dataset.destination === destinationOf(spot)`: the `<Html>` content is
  a separate React root rendered asynchronously, and without that check the previous icon
  showed about 100 ms at departure. Accepted cost: a 1-2 frame badge flicker on a reroute.
- Destination badge accepted limits (not done): an altar-queue shuffle (rank n → n-1)
  shows the altar badge about 1 s and hides an urgent agent's request bubble meanwhile; the
  visibility logic has no unit test (depends on drei ref placement; verified in Playwright).
- Slap accepted limits (not done): rapid alternating slaps snap the weight of a fading-out
  hit clip for a frame; `Character`'s restart logic has no unit test (in `.tsx`); a stale
  right-press position is only cleared by a right release on that figure; one extra drei
  `<Html>` per selectable figure (per-frame projection cost); no mute switch for the sound;
  the server SPA fallback answers a missing `/sounds/` file with `index.html` (status 200),
  so a missing `slap.wav` fails decoding silently and is refetched on every slap.
- Potion accepted limits (not done): an event whose `agent_id` was refused (null) reaches
  the client as the main agent's (`summarize` collapses null); a repeated PreCompact within
  4.6 s restarts the effect; with the tab hidden the HTML timer and the frame clock can
  drift (stars without stagger briefly).
- Mishap accepted limits (not done): the server collapses newlines and cuts commands at 200
  chars, so a test run past the cut counts as a boiler; the server places an agent by its
  current tool, so a parallel tool call before the snapshot can hide a boiler; soot misses a
  character model swapped mid-effect.
- Sound files rule: before shipping a new sound under `public/sounds/`, record its source
  and licence in `public/sounds/LICENSE.txt`. Never commit a sound ripped from a commercial
  game.
- Slap hand rules, keep them: the hand casts no shadow (the depth clear never runs in the
  shadow pass); nothing else may use `renderOrder` ≥ 1000. Accepted limits: two hands on
  screen at the same instant share the depth clear and may overlap wrongly; the hand's
  clock starts 1-2 frames (~16-33 ms) after the click while the hit clip and sound start
  from the click; the first slap may compile a new shader program.
- Post card plate layout, keep it: `.post-card__plate` is IN THE FLOW with
  `margin-top: -16px` (not `position: absolute` like the agent plates), so a two-line title
  (FR "Rayonnages et tables de lecture" wraps) pushes the text down. Its
  `max-width: calc(100% - 44px)` and the room line's `padding-right: 30px` keep both clear of
  the absolute close button; the h2 has `overflow-wrap: anywhere`. Verified in Playwright
  for all 18 posts in FR/DE/EN at 1300 and 375 px wide.
- Post card icon, accepted design: room-wide posts keep the room icon. `observatoire` shows
  the moon although an agent at the telescope seat carries the `lunette` badge, and
  `scriptorium` shows the quill although agents at the `ia` / `humains` seats carry those
  badges (pinned in `destinations.test.ts`).
- Post card open items (accessibility audit, not done): opening a card from the keyboard
  list does not move focus into it; the card has no max-height / scroll for very short
  scenes or 400% zoom.
- Draw-call count and post mesh merging: `docs/ai/room-identity.md`. Open item: the
  scene-wide Suspense hide/show causes about 15 "synchronously unmount a root" warnings
  per load.
