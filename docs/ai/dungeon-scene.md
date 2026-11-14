---
description: Use when changing the 3D dungeon map — rooms, floors, walls, castle gate, cutaway, props, lighting, KayKit models or their import — clickable workstations (posts, hover glow, post card and list), pointer/cursor handling of 3D targets, agent figures (walking motion, character models, role looks and held props, animations, destination badge), room or post icons, or when previewing the web scene.
---

# 3D dungeon scene (KayKit assets)

## Current State
- The map is built from KayKit CC0 models (Dungeon Pack 1.1, RPG Tools Bits 1.0, Fantasy
  Weapons Bits 1.0, free tiers), grouped in three packs: `dungeon`, `tools`, `weapons`.
  Agents use KayKit Adventurers 2.0 (CC0): packs `adventurers` (character bodies),
  `adventurers_anim` (shared `Rig_Medium_General`, `Rig_Medium_MovementBasic` clips) and
  `adventurers_props` (8 held props, gltf + 4 textures). Pack `forest` (trees around the
  castle): `docs/ai/night-forest.md`.
- KayKit is about 1.33x our scene: every model is scaled by `KIT_SCALE = 0.75`. After
  scaling: small floor tile 1.5 m, wall 3 m high per 3 m chunk, table 0.75 m.
- Rooms (`RoomDef` in `layout.ts`) carry `floorKind` (`stone`, `stoneFancy`, `grate`, `wood`,
  `woodDark`, `dirt`) and `accent` (one of 6 KayKit banner colours). Decor `PropKind`s
  `crates`, `barrels`, `chest`, `coins`, `candle` have footprints.
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
  pointer starts at screen centre and keeps its last position.
- Lighting: Canvas shadows, drei `SoftShadows`, `NeutralToneMapping`, one shadow-casting
  sun. Floors and small shapes/models (< 0.3 m, or scale < 0.6) cast no shadow.
- Rooms have no title signs (removed at the user's request).

### Workstations (posts)
- `layout.ts`: `POST_IDS` (18), `PostId`, optional `Prop.post`, `postGroups(room)` →
  `{ posts: { post, props }[], decor }`, `POST_ROOM` (`Map<PostId, RoomId>`). Every
  functional prop carries a post; decoration kinds (`crates`, `barrels`, `chest`, `coins`,
  `candle`, `rug`) never do (tested). A multi-function room has one post per function:
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
  Resting tavern figures have no handlers and no target flag.
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
- `ui/PostList.tsx`: "Lieux du bureau" in the side panel, grouped by room, `aria-pressed`
  buttons with ids `postButtonId(post)`. It is the keyboard / screen-reader route to posts
  (WCAG 2.1.1; the accessibility gate blocked without it). The side panel is labelled
  "Agents et lieux" and the canvas label names both lists.
- Post texts: `docs/ai/i18n.md`.

### Agent figures
- Looks (`characters.ts`): a `Look` is a body plus optional `right` / `left` held props
  (`PropRef { pack: 'adventurers_props' | 'tools'; model }`). Main agents use `MAIN_BODY`
  (`Knight`). Every subagent figure, whatever its look, is scaled 0.85 by kind in
  `AgentFigure` (whole group: model, tag, ring, disc). Subagents get a role look from `LOOKS`, keyed by the
  lower-case agent TYPE (18 entries: the user's agents plus `Explore`, `Plan`,
  `general-purpose`, `claude-code-guide`, `statusline-setup`). `lookFor(kind, agentType)`
  looks up case-insensitively with `Object.hasOwn`; an unknown type gets
  `SUB_BODIES[FNV-1a(type) % 5]` with empty hands, `''` gets `SUB_BODIES[0]`. Keying by
  type, not agent id, makes every agent of a type and its resting figure `rest:<type>` look
  alike. `LOOKS` entries, `PropRef`s and grips are frozen.
- Held props: `Held` in `AgentFigure.tsx` clones the prop (`scene.clone()`, geometry and
  materials shared, `castShadow` on the clone's meshes) and mounts it via R3F `createPortal`
  into bone `handslotr` / `handslotl` (GLTFLoader strips the dots of `handslot.r`), inside a
  group carrying the grip. A dev warning fires when a hand slot is missing. Grips:
  `PROP_GRIP` / `gripFor` hold rotation/scale for `tools` models only; Adventurers props fit
  the slot as they are. The slot's local X points down, so upright tools turn a quarter turn
  on Z; the lantern turns on −Z (hangs).
- Walking: cruise `CRUISE_SPEED` 9 u/s, `ACCELERATION` 18 u/s², `MIN_SPEED` 0.3, with
  ease-in / ease-out over the WHOLE route (braking curve `sqrt(2·A·remaining)` on the total
  remaining distance, so no stop at corners). Speed lives in a ref in `AgentFigure`, reset
  to 0 when the path empties; a reroute keeps the current speed. Facing uses `turnToward`
  with exponential rates (`WALK_TURN_RATE` 14, `REST_TURN_RATE` 6).
- Clips: `clipFor` (pure, in `characters.ts`) picks, in priority order: spawn
  (`Spawn_Ground`, once, ×1.5, only for a figure whose `start` is the lockers `SPAWN` and not
  done; one coming from a resting seat just walks) > moving (`Walking_A`, or `Running_A` above
  `RUN_THRESHOLD`; rate = speed / measured clip speed, capped at `MAX_CLIP_RATE`, with a
  0.5 floor for `Walking_A` only) >
  kneeling at the altar (`PickUp` frozen at `KNEEL_POSE_TIME`) > done (`Idle_A` frozen, no
  transparency) > working (`Interact`) > waiting (`Idle_B`). Reduced motion: still poses,
  turns snap, no spawn; position still moves.
- `AgentFigure` structure: the parent runs the walk and writes a `Motion` ref; the
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
  `inForeground`.
- `packages/web/src/scene/Structure.tsx` — `Floors` (instanced) and `Walls`.
- `packages/web/src/scene/KitInstances.tsx` — `<KitInstances>` (one InstancedMesh per model
  part, for repeated pieces; optional `material` override and `receiveShadow`) and `<Kit>`
  (single model, for furniture).
- `packages/web/src/scene/props.tsx` — `PROPS` renderer per `PropKind` (KayKit models plus
  simple shapes in a KayKit-matched palette).
- `packages/web/src/scene/kit.ts` — `useKitGLTF` (drei `useGLTF(url, false)`: Draco off, so
  no third-party decoder fetch); one shared material per pack + material name. `kitUrl` is
  module-private.
- `packages/web/src/scene/kit-manifest.json` — models and textures per pack; a pack may set
  `"format": "glb"` (self-contained, `textures: []`).
- `scripts/import-kaykit.mjs` (`npm run kaykit:import`) — copies manifest entries from
  `assets-src/<pack>/` (gitignored, unzipped by the user) to `packages/web/public/kaykit/<pack>/`
  (committed).
- `packages/web/src/scene/characters.ts` — pure, no three.js: `MAIN_BODY`, `SUB_BODIES`,
  `LOOKS`, `lookFor`, `PROP_GRIP`, `gripFor`, `clipFor` and the clip constants.
- `packages/web/src/scene/AgentFigure.tsx` — walk, `Character` (takes a `Look`), `Held`,
  `CharacterBoundary`, tag, destination badge toggle.
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
- `packages/web/test/dungeon.test.ts`, `walk.test.ts`, `characters.test.ts`,
  `layout.test.ts` (`layout.ts`: `ROOMS`, seats and `assignSpots`, altar `queueSpot`,
  `SPAWN`, `corridorPath`, `routeBetween`, `reroute`, post tagging, `postGroups`,
  `POST_ROOM`, spot `room`/`station`), `highlight.test.ts`, `cursor.test.ts`,
  `destinations.test.ts` (`destinationOf`; room ids and post names never overlap;
  `postDestination`: every `POST_IDS` entry is a `ROOMS` id or a stations key, and the
  room-wide icon choice below is pinned).

## Usage
- New model: add it to `kit-manifest.json`, run `npm run kaykit:import`. Never hand-copy
  files into `public/kaykit/`. Load every model through `useKitGLTF`, never `useGLTF` directly.
- New or changed role look: edit `LOOKS` (lower-case type key) and, for a new prop, the
  manifest models of its pack. A `tools` prop also needs a `PROP_GRIP` entry calibrated by
  eye (tested: every `tools` prop in `LOOKS` has a grip, every `adventurers_props` model is
  used). All six bodies (Barbarian, Knight, Mage, Ranger, Rogue, Rogue_Hooded) share the
  Rig_Medium skeleton (23 identical bones), so the shared clip files apply to every body.
- Grip calibration workflow: in Playwright, import the store by the URL actually loaded
  (take it from performance resource entries; Vite appends `?t=` after edits) and call
  `useOffice.setState({ sessions: [], roster: [...] })` so the tavern shows one resting
  figure per type. Hide other objects and move the camera for close-ups, mutate the grip
  group under the hand bone live, then copy the values into `PROP_GRIP`.
- Repeated pieces go through `<KitInstances>`; one-off furniture through `<Kit>`; a new
  prop is a `PROPS` entry. Put placement logic in `dungeon.ts` so it stays testable.
- Agent motion logic goes in `walk.ts`, clip choice in `clipFor` (both tested), never
  inline in `AgentFigure`'s `useFrame`, which only calls them.
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
  scene without a server). Ports 5174 and 5175 may already be held by another worktree's
  Vite: check with `netstat` that the port belongs to this worktree's process (or pick a
  free one such as 5181), otherwise the page shown is another branch's code. A worktree can
  also serve its build on another port: `npm run build`, then
  `AGENT_OFFICE_PORT=4790 AGENT_OFFICE_TOKEN=… npm run start`. The in-app Browser pane, when
  hidden, gives the Canvas size 0 and renders no frames; use Playwright for visual
  verification. Headless Playwright renders about 1–2 fps (software GL): wait about 2 s
  before checking rAF-driven effects (focus return, highlight screenshots). Give Playwright
  file outputs absolute paths inside the worktree; relative paths resolve elsewhere.
  `.playwright-mcp/` is gitignored because captures may show real session names; keep it so.
- Where figures rest, wait, appear and leave (tavern, altar, roster):
  `docs/ai/agent-lifecycle.md`.

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
- Some manifest models are unused on purpose, kept for upcoming 3D work (user decision).
  Do not prune them as dead code.
- Inner wall footprint matches the pre-KayKit one, so seat positions are unaffected.
- Accepted limits of the thick outer walls: wall variants with relief (`wall_shelves`,
  `wall_arched`) are stretched by the 0.6 depth scale (not yet checked visually); props near
  outer walls may stand up to 0.175 m off the inner face, which moved outward from 0.275 m
  to 0.1 m inside the room edge.
- Orientation-based cutaway was tried and rejected; keep the cursor parabola.
- Tests must not import `kit.ts` or any `.tsx` file (drei / `import.meta.env`); test
  `dungeon.ts`, `layout.ts`, `walk.ts`, `characters.ts`, `destinations.ts`, `forest.ts` and
  the manifest JSON.
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
- Open items: about 700 draw calls per frame because props are not instanced (planned fix:
  drei `<Instances>` for shapes); the scene-wide Suspense hide/show also causes about 15
  "synchronously unmount a root" warnings per load.
