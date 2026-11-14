# Implementation Plan — Icônes de destination des agents

*Generated on 2026-11-14 — à copier dans `plans/plan-icones-destination-2026-11-14.md` au début de l'implémentation.*

## Business Objective

Voir d'un coup d'œil où va un agent qui traverse le donjon : pendant le trajet, une icône
au-dessus du personnage montre sa destination (salle, ou poste dédié dans la salle). À
l'arrivée, l'icône disparaît. Les panneaux des salles portent la même icône, pour apprendre
la correspondance icône → salle.

## Requirements Summary

### Functional Requirements
- 25 pictogrammes SVG dessinés à la main : un par `RoomId` (15) et un par poste dédié (10 :
  `lunette`, `ia`, `humains`, `chevalet`, `sacristain`, `boulier`, `relecture`, `labo`,
  `estrade`, `inspection`).
- L'icône du **poste** s'affiche quand le siège attribué est un siège de ce poste ; sinon
  (poste plein, siège partagé, mur, dispersion, file de l'autel) celle de la **salle**.
- Visible seulement pendant le déplacement du modèle 3D (chemin non vide). Masquée à
  l'arrêt, pendant l'apparition (`Spawn_Ground`) et à l'arrivée.
- Changement de destination en route : l'icône suit la nouvelle `spot` immédiatement.
- Retour d'un sous-agent terminé ou repos du principal : icône de la taverne.
- Panneau de chaque salle (`Room.tsx`) : icône de la salle à gauche du nom.

### Non-Functional Requirements
- **Performance :** aucune re-render React par frame ; la visibilité est basculée par
  `style.visibility` sur un ref DOM depuis le `useFrame` existant, seulement quand l'état change.
- **UX/UI :** pastille ronde (fond clair, liseré sombre, ombre portée comme la bulle de
  requête), ~26 px, posée au-dessus de l'étiquette du nom dans le même `<Html>` (une bulle
  3D serait masquée par les étiquettes, déjà rejeté). Pendant le trajet, l'icône remplace la
  bulle de requête au même emplacement ; la bulle revient à l'arrivée.
- **Accessibilité :** décoratif (`aria-hidden`, `focusable="false"`) : la liste latérale et
  l'annonceur disent déjà la salle. Règles `forced-colors` (Canvas / CanvasText) et pas
  d'animation de rebond sous `prefers-reduced-motion`.
- **i18n :** aucun texte nouveau (pas de `title`, pas de libellé), donc pas de clé.

### Out of Scope
- Icônes dans la liste latérale ou le panneau d'agent.
- Icône sur les postes eux-mêmes dans la scène.

## Technical Approach

### Architecture
1. **Destination portée par la `Spot`** (`layout.ts`, pur, testé) : ajouter à `Spot`
   `room: RoomId` et `station?: string`. `toSpot` les reçoit ; `computeCandidates` attache
   `station` aux entrées de poste ; `assignSpots` le transmet (siège gardé ou nouveau) ;
   `queueSpot` → `room: 'autel'` ; `SPAWN` → `taverne`. Exporter un type
   `StationId` (union des 10 noms) et faire `satisfies` sur `STATIONS` / `stations` pour
   qu'un poste sans icône casse le typecheck.
2. **Fonction pure `destinationIcon(spot)`** dans un nouveau `scene/destinations.ts` :
   renvoie la clé d'icône (`station` si présent, sinon `room`). Testée.
3. **Pictogrammes** `scene/DestinationIcon.tsx` : `ICONS: Record<RoomId | StationId, ReactNode>`
   (chemins SVG 24×24, trait monochrome), composant `<DestinationIcon kind=… />` et
   `<DestinationBadge>` (la pastille). Idées : autel = calice, cartes = carte dépliée,
   atelier = marteau, biblio = livres, scriptorium = plume, observatoire = étoile/lune,
   pigeonnier = pigeon/lettre, machines = engrenage, arithmétique = « ± », garde = bouclier,
   épreuves = fiole, héraut = trompette, détente = dé, concierge = balai, taverne = chope ;
   postes : lunette = télescope, ia = puce, humains = silhouette, chevalet = chevalet,
   sacristain = cierge, boulier = boulier, relecture = loupe, labo = éprouvette,
   estrade = mégaphone, inspection = œil.
4. **`AgentFigure.tsx`** : rendre la pastille dans le `<Html>` du tag avec un `ref`; dans
   `useFrame`, `travelling = m.moving` ; si différent du dernier état, basculer
   `visibility` de la pastille et de la bulle de requête (refs). La clé d'icône vient de
   `destinationIcon(spot)` (prop `spot` déjà présente, donc `React.memo` reste efficace).
5. **`Room.tsx`** : `<DestinationIcon kind={r.id} />` dans le panneau ; CSS `.room-sign`
   en `inline-flex` avec un petit écart.

### Files to Create/Modify
1. `packages/web/src/scene/layout.ts` — `room`/`station` sur `Spot`, `StationId`.
2. `packages/web/src/scene/destinations.ts` — `destinationIcon` (nouveau, pur).
3. `packages/web/src/scene/DestinationIcon.tsx` — 25 SVG + pastille (nouveau).
4. `packages/web/src/scene/AgentFigure.tsx` — pastille + bascule de visibilité.
5. `packages/web/src/scene/Room.tsx` — icône sur les panneaux.
6. `packages/web/src/styles.css` — `.destination-badge`, `.room-sign` icône, forced-colors, reduced-motion.
7. `packages/web/test/layout.test.ts`, `packages/web/test/destinations.test.ts` — tests.
8. `docs/ai/dungeon-scene.md` / `agent-lifecycle.md` — via `curator` ; `docs/lieux-et-personnages.md` via `otis` si pertinent.

## Performance Considerations
- Un `<Html>` par figure existe déjà ; la pastille y est ajoutée, pas de nouveau portail.
- 25 petits SVG statiques, aucun asset chargé.

## Edge Cases & Error Handling
- Poste plein → siège partagé → icône de la salle (le `station` n'est posé que sur les sièges du poste).
- Scriptorium (dans la bibliothèque, `space` = biblio) : `room` explicite, pas déduit de `space`.
- Glissement dans la file de l'autel (rang n → n-1) : court trajet, icône de l'autel brièvement — accepté.
- Premier snapshot : figures placées sur place, chemin vide → pas d'icône.
- Reduced motion : les figures se déplacent quand même → l'icône s'affiche, sans rebond.
- Figures au repos `rest:<type>` : icône taverne pendant leur éventuel trajet.

## Verification
- `npm test` (layout : `room`/`station` des spots, file, SPAWN, poste plein ; destinations :
  station prioritaire, couverture des 25 clés) et `npm run typecheck`.
- Visuel via Playwright (Vite sur 5174 depuis le worktree, store injecté ou faux hooks sur un
  second serveur) : agent en marche avec pastille, arrivée sans pastille, changement de
  destination en route, panneaux avec icône ; capture en forced-colors.
- Pipeline : dexter → hermione → gatsby (⏭ probable, rendu 3D interne) → timmy → neo (⏭, pas
  de surface sensible) → curator.

## Complexity Estimate

**Size:** M

**Justification:** 25 pictogrammes à dessiner plus une extension du type `Spot` propagée dans l'attribution des sièges, le rendu et les tests.
