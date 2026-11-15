---
description: Use when changing the web UI's colours or chrome styling — root CSS tokens, the single dark dungeon theme, top bar, side panel, home page, its logo (SVG source, PNG re-render) and castle-gate background image (and how to re-capture it).
---

# UI theme (dark dungeon palette)

## Current State
- One theme only: no light variant, no `prefers-color-scheme` block. `styles.css` `:root`
  sets `color-scheme: dark` (and `index.html` has `<meta name="color-scheme" content="dark">`)
  and defines the palette tokens: `--bg`, `--surface`, `--surface-2` (plates), `--text`,
  `--text-2`, `--border` (gold at 30%), `--gold`, `--control-border` (control outlines,
  3:1 contrast for WCAG 1.4.11), `--accent` (links, focus, selected states), `--ok`, `--ko`.
- Chrome matches the RPG cards: `.topbar` (gradient `--surface-2` → `--surface`, 3px double
  gold bottom border, gold uppercase brand); `.office__side` (3px double gold left border,
  gold uppercase `h2` with a bottom rule, tinted session cards, gold room labels, gold
  hover / pressed tints).
- RPG cards (`.agent-dialog`, `.agent-info`, `.post-card`) keep their `--dlg-*` tokens, but
  `--dlg-text` / `--dlg-muted` / `--dlg-gold` now derive from `--text` / `--text-2` /
  `--gold`; `--dlg-bg` stays its own rgba.
- Home page: `#root:has(.home)` shows `/images/castle-gate.jpg` (1920x1080 JPEG) under a
  dark gradient. `.env-card` is a small dark-parchment card with a gold border; its focus
  ring gets a dark halo (`box-shadow: 0 0 0 6px var(--bg)`) because it sits on the photo.
  The image lives in `packages/web/public/images`, served by Vite in dev and by
  `@fastify/static` from `dist` in prod.
- Home logo: `App.tsx` renders `<img className="home__logo">` from
  `/images/agents-lair-logo.png` (820x520 transparent PNG) above the `t.home.title` h1.
  `alt={APP_NAME}` with `lang="en"`: the product name is never translated
  (`docs/ai/i18n.md`), and the image holds no other text. `.home__logo` is centred,
  `width: min(400px, 100%)`, with a drop-shadow; `.home .home__logo + h1` sets the h1 top
  margin and is scoped under `.home` to outweigh `.home h1`.
- The PNG is rendered from `docs/brand/agents-lair-logo.svg`, which `@import`s Cinzel /
  Cinzel Decorative from Google Fonts. Never serve that SVG: an SVG in `<img>` cannot load
  web fonts, and it would call Google Fonts.

## Relevant Files
- `packages/web/src/styles.css` — `:root` tokens, `.topbar`, `.office__side`, home /
  `.env-card`, card `--dlg-*` declarations.
- `packages/web/index.html` — `color-scheme` meta.
- `packages/web/public/images/castle-gate.jpg` — home background.
- `packages/web/src/App.tsx` — home page, logo `<img>`.
- `packages/web/public/images/agents-lair-logo.png` — served logo.
- `docs/brand/agents-lair-logo.svg` — logo source; its header comment holds the re-render
  steps.

## Usage
- New chrome or UI colours use the root tokens; never hard-code a colour, and never add a
  light-theme branch. New card-like panels reuse the `--dlg-*` parchment tokens (see
  `docs/ai/dungeon-scene.md`, post card).
- Text on the home photo needs its own dark backing and a halo around focus rings, as
  `.env-card` does.
- Re-capture `castle-gate.jpg` if the gate, walls or forest change visibly. It is a render of
  the scene itself, not external art. Procedure: Playwright at 1920x1080 on an env URL that
  matches no environment (e.g. `/env/capture-sans-nom`), so the dungeon name sign and
  pennants (`docs/ai/night-forest.md`) are not drawn and no project name ends up in the
  committed image (public repo);
  hide the top bar, side panel, legend and agent tags with an injected style; park the mouse
  on the canvas's bottom edge so the cutaway (`inForeground` in `dungeon.ts`) leaves the
  walls standing; set OrbitControls from the page through a temporary window hook (OrbitControls is
  `makeDefault`, so a temporary component reading `useThree()` `{ controls, camera }` and
  putting them on `window` works; target
  (5.5, 2.8, 9), camera (5.5, 2.4, 26), damping off, `minDistance` 1); remove the hook
  afterwards. Playwright and worktree preview tips: `docs/ai/dungeon-scene.md` (Usage,
  Preview).
- To change the logo artwork, edit the SVG and re-render the PNG with the steps in the SVG's
  header comment (inline in a page, remove `#bg-plate`, wait for `document.fonts.ready`,
  transparent screenshot clipped to the 820x520 area). Keep the `<img>` alt on `APP_NAME`.

## Notes
- Forced-colors rules in `styles.css` still apply to the cards and controls; keep them when
  restyling.
