# Implementation Plan — L'attente interminable à l'autel

*Generated on 2026-11-15*

## Business Objective

Gag visuel dans la lignée de la baffe : plus un agent attend l'humain à l'autel, plus il se
dégrade (cent pas → assis → endormi avec Zzz → couvert de toiles d'araignée). L'humain voit
d'un coup d'œil depuis combien de temps il fait attendre ses agents, avec humour.

## Requirements Summary

### Functional Requirements
- Concerne tout agent en attente à l'autel : `waitReason` ∈ `permission`, `question`, `error`
  (pas `prompt`, qui reste à la taverne). Décision utilisateur.
- Toute la file se dégrade, chacun selon sa propre durée d'attente (décision utilisateur).
- Paliers (décision utilisateur), mesurés depuis `AgentView.since` (déjà remis à `now` par
  `patchAgent` à chaque changement d'état ou de raison, donc aucun changement serveur) :
  | Durée | Palier | Rendu |
  |---|---|---|
  | < 1 min | `calm` | comportement actuel (1er à genoux, suivants debout) |
  | ≥ 1 min | `pacing` | va-et-vient latéral sur place (±0,35 m, perpendiculaire à l'orientation), `Walking_A` lent ; remplace l'agenouillement |
  | ≥ 3 min | `sitting` | pose assise figée |
  | ≥ 5 min | `sleeping` | allongé (`Death_A_Pose` figé) + bulle « Zzz » |
  | ≥ 10 min | `webbed` | endormi + toiles d'araignée KayKit (`mixed2/cobweb_C`, déjà dans le manifeste) sur le corps |
- Dès que l'humain répond (état ≠ waiting), l'agent repart normalement (le palier retombe à `calm`).
- **Commande de test** (exigence utilisateur), convention commune proposée par la session
  potion : `window.agentOffice.autel(palier?, id?)`.
  - `palier` : `'calme' | 'cent-pas' | 'assis' | 'endormi' | 'toile'`, ou `null` pour retirer le forçage.
  - `id` absent → agent sélectionné ; sinon tous les agents actuellement à l'autel.
  - Le forçage s'applique à la figure quel que soit son état (purement visuel), sans attendre N minutes.
  - Exposée en permanence (dev et build), purement visuelle, sans effet serveur.
    Messages console en anglais (outil développeur, non affiché dans l'UI).

### Non-Functional Requirements
- **Performance :** le palier est calculé dans `Office` sur l'horloge 1 s existante (`useNow`)
  et passé en prop ; il ne change qu'aux transitions, donc `React.memo` d'`AgentFigure` tient.
  Le va-et-vient tourne dans le `useFrame` existant, sans rendu React.
- **Sécurité :** aucune donnée nouvelle du serveur, aucune route ; la commande ne touche que
  l'état visuel local.
- **UX/UI :** « Zzz » passe par l'i18n (FR/DE/EN, clé `altarWait.snore`), `aria-hidden`
  comme la bulle de demande (la liste latérale et `AgentInfo` « en attente depuis … » restent la
  source accessible). `prefers-reduced-motion` : pas de va-et-vient (la figure reste debout),
  poses figées conservées, Zzz statique, toiles affichées.

### Out of Scope
- Annonce lecteur d'écran du palier, son de ronflement, changement côté serveur.

## Technical Approach

### Architecture
- **`packages/web/src/scene/altarWait.ts`** (nouveau, pur, testé) :
  - `AltarStage`, `ALTAR_STAGE_MS` (paliers), `altarStage(agent, now)` (`calm` hors
    autel / hors waiting / raison `prompt` ; durée négative bornée à 0).
  - `paceOffset(t)` → `{ offset, dir }` (sinusoïde, période ~4 s, ±`PACE_AMPLITUDE` 0,35 m)
    et `paceHeading(facing, dir)`.
  - Bus de forçage sur le modèle de `slap.ts` : `forceAltarStage(id, stage | null)`,
    `forcedAltarStage(id)`, `onAltarForce(cb)` (pour `useSyncExternalStore`).
  - `parseStageArg` (noms français → `AltarStage`) et `installAltarCommand(target, deps)` qui
    pose `agentOffice.autel` sur l'objet passé (testable sans `window`), sans écraser les
    autres entrées de `agentOffice`.
- **`characters.ts`** (minimal) : `CLIPS` + `Death_A_Pose` (et le clip retenu pour l'assise) ;
  `ClipInput.altar?: AltarPose` ; dans `clipFor`, après `moving` et avant `kneeling` :
  `sleeping`/`webbed` → `hold('Death_A_Pose')`, `sitting` → `hold(SIT_CLIP, SIT_POSE_TIME)`,
  `pacing` → `play('Walking_A', PACE_CLIP_RATE)`. Réduit : `pacing` → `hold('Idle_A')`.
  Pose assise : pas de clip « Sit » dans le pack gratuit ; calibrée à l'œil dans Playwright
  parmi des images figées de `Death_B` / `Death_A` (chute en arrière à mi-course) ; repli :
  `PickUp` figé au plus bas. Durée mesurée ajoutée au test des longueurs de clips si un clip
  non-`_Pose` est utilisé.
- **`AgentFigure.tsx`** (bloc localisé) : prop `altarStage` ; `Motion.altar` ; dans
  `useFrame`, à l'arrêt sur sa place et palier `pacing`, décalage latéral appliqué à
  `g.position` seulement (jamais à `pos`, donc la marche et les reroutes ne sont pas
  touchés) et orientation dans le sens du pas ; `m.kneeling` faux dès `pacing`. Dans le tag
  `<Html>`, `<SnoreBubble>` à côté de `RequestBubble` pour `sleeping`/`webbed` (caché pendant le
  trajet, même règle CSS). Toiles : composant `<AltarCobwebs>` (2 `cobweb_C` via `<Kit>`,
  raycast désactivé, sans ombre) monté seulement en `webbed`.
- **`Office.tsx`** : calcule `altarStage(agent, now)` (ou le forçage via
  `useSyncExternalStore(onAltarForce, …)`) et le passe en prop ; installe la commande dans un
  `useEffect` (accès à `useOffice.getState().selected` et aux agents à l'autel).
- **i18n** : `altarWait.snore` FR/DE/EN (« Zzz »).
- **CSS** (`styles.css`) : `.snore-bubble` (Z qui montent, animation coupée en mouvement réduit,
  règles forced-colors).

### Files to Create/Modify
1. `packages/web/src/scene/altarWait.ts` — nouveau, logique pure + bus + commande.
2. `packages/web/test/altarWait.test.ts` — paliers, bornes, raisons, offset, parse, commande.
3. `packages/web/src/scene/characters.ts` + `test/characters.test.ts` — clips et `clipFor`.
4. `packages/web/src/scene/AgentFigure.tsx` — prop, motion, Zzz, toiles.
5. `packages/web/src/scene/SnoreBubble.tsx`, `packages/web/src/scene/AltarCobwebs.tsx` — nouveaux.
6. `packages/web/src/scene/Office.tsx` — calcul du palier, installation de la commande.
7. `packages/web/src/i18n/*` — clé `altarWait.snore`.
8. `packages/web/src/styles.css` — `.snore-bubble`.
9. Docs : `docs/ai/agent-lifecycle.md` (curator), `docs/lieux.md` section autel +
   `docs/utilisation.md` commande de test (otis).
10. `plans/plan-attente-autel-2026-11-15.md` — copie de ce plan dans le dépôt après approbation.

Coordination : note dans le dossier partagé des sessions sœurs (convention `agentOffice.autel`,
fichiers partagés touchés : `characters.ts` `CLIPS`/`clipFor`, `AgentFigure.tsx`, `Office.tsx`,
i18n, `styles.css`).

## Work Breakdown

Single lot — main session

## Edge Cases & Error Handling
- Horloge client en retard sur `since` : durée bornée à 0 (`calm`).
- Agent qui passe de `question` à `permission` : `since` est remis à zéro par le serveur, il
  repart de `calm` (accepté : nouvelle demande).
- Gifle pendant le sommeil : le clip de coup prime (déjà prioritaire dans `clipFor`), puis
  retour à la pose.
- Figure qui marche (file qui avance) : `moving` prime, le palier reprend à l'arrêt.
- Forçage sur un agent qui disparaît : entrée ignorée, nettoyée au prochain `null`.
- Agent condamné (`exit`) : aucun palier.

## Complexity Estimate

**Size:** M

**Justification:** plusieurs composants (logique pure, clips, figure, Office, i18n, CSS) et une
calibration visuelle de pose, sans intégration externe.

## Verification
- `npm test`, `npm run typecheck`.
- Playwright sur un Vite du worktree (port libre vérifié par `netstat`), galerie injectée
  dans le store : une session avec 4 agents à l'autel aux `since` de now−30 s, −2 min, −4 min,
  −6 min, −11 min ; captures de chaque palier. Puis `agentOffice.autel('toile')`,
  `agentOffice.autel(null)` sur l'agent sélectionné ; vérifier mouvement réduit
  (`emulateMedia`), langues FR/DE/EN pour Zzz.
- Faux hooks sur un serveur de test (`PermissionRequest`) + commande pour forcer le palier.
