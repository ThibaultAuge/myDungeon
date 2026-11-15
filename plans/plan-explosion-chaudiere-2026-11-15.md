# Implementation Plan — Gag « Explosion de chaudière » (et fiole d'alchimie)

*Generated on 2026-11-15* — copié dans `plans/plan-explosion-chaudiere-2026-11-15.md` dès l'approbation.

## Business Objective

Un gag visuel, dans l'esprit de la baffe, qui rend lisible un échec d'outil : quand un agent
rate une commande dans la salle des machines, la chaudière fait « pouf » et l'agent reste noirci
de suie ; quand une commande de tests échoue, la fiole du labo de la salle des épreuves explose
en vert. Purement visuel, aucun effet sur le travail des agents.

## Requirements Summary

### Functional Requirements
- Déclencheur : un hook `PostToolUseFailure` reçu par le client (message WebSocket `event`, déjà
  diffusé aujourd'hui avec `event`, `sessionId`, `agentId`, `tool`, `detail` = commande tronquée
  à 200 caractères).
- **Fiole** (choix utilisateur) : outil `Bash` ou `PowerShell` dont la commande ressemble à un
  lanceur de tests (`npm test`, `npm run test…`, `pnpm/yarn/bun test`, `npx vitest`, `vitest`,
  `jest`, `pytest`, `python -m pytest`, `mvn test|verify`, `gradle test`, `./gradlew test`,
  `cargo test`, `go test`, `dotnet test`, `phpunit`, `rspec`…, cherché n'importe où dans une
  commande chaînée) → la fiole du poste `labo` explose en vert, l'agent (resté aux machines) est
  couvert de suie **verte**.
- **Chaudière** : tout autre `PostToolUseFailure` d'un agent dont la pièce courante est
  `machines` → bouffée de fumée sur la chaudière + suie **noire** sur l'agent.
- Effet sur l'agent : suie (teinte des matériaux de la figure) pendant `SOOT_MS` ≈ 4 s, puis
  retour progressif à la normale ; petite bulle BD traduite (« POUF ! » / « BLOUP ! »), comme la
  bulle de la baffe.
- Agent visé : `agentId` de l'événement, sinon l'agent principal `${sessionId}#main`. Pas de
  figure dans la scène (autre environnement, fantôme, figure mourante) → seul l'effet de la pièce
  joue (s'il concerne la route courante) ou rien.
- **Commande de test** (choix utilisateur : toujours disponible, côté client) :
  `window.agentOfficeGags.boiler(agentId?)` et `window.agentOfficeGags.flask(agentId?)` ; sans
  argument, l'agent sélectionné, sinon le premier agent principal visible. Renvoie l'id visé (ou
  `null`). Enregistrée par fusion (`window.agentOfficeGags = { ...existant, boiler, flask }`) pour
  que les gags des sessions sœurs ajoutent leurs propres clés sans conflit.

### Non-Functional Requirements
- **Performance :** aucune géométrie ni matériau créé par événement hors de la suie ; géométries
  et matériaux de la fumée partagés au niveau module ; la suie clone les matériaux de la seule
  figure touchée pendant l'effet et les libère ensuite.
- **Security :** aucun changement serveur ni `shared` ; le texte de la commande (déjà diffusé)
  n'est utilisé que pour la classification, jamais affiché ; la commande console est purement
  visuelle et n'envoie rien au serveur.
- **UX/UI :** bulles via i18n FR/DE/EN (`aria-hidden`, décoratives, comme la bulle de la baffe ;
  l'échec reste annoncé par l'existant). `prefers-reduced-motion` : pas de particules ni de
  flash, bulle statique, suie appliquée puis retirée sans fondu.

### Out of Scope
- Son (pas demandé). Autres gags (autel, pigeon, potion, héraut — sessions sœurs).
- Détection des tests réussis (gag du héraut).

## Technical Approach

### Architecture
Tout côté client.

1. `scene/mishap.ts` (pur, sans three.js, testé) :
   - `isTestCommand(command)` — regex à bornes de mots, pas de backtracking catastrophique.
   - `mishapFor(event, agentRoom)` → `'boiler' | 'flask' | null`.
   - `mishapTarget(event)` → id de figure (`agentId` ou `<sessionId>#main`).
   - Bus calqué sur `slap.ts` : `triggerMishap(id, kind)`, `onMishap(id, cb)`, et un bus de pièce
     `onRoomMishap(cb)` pour la chaudière et la fiole.
   - Constantes `SOOT_MS`, `PUFF_MS`, couleurs de suie ; `sootAmount(elapsedMs)` (1 pendant le
     maintien, puis fondu linéaire vers 0).
2. `scene/MishapWatcher.tsx` : s'abonne au store (`useOffice.subscribe`), traite chaque nouvel
   événement une seule fois (`WeakSet` des objets déjà vus, robuste au redémarrage du serveur qui
   remet `seq` à zéro), cherche la pièce de l'agent dans `sessions`, appelle `triggerMishap`.
   Installe aussi `window.agentOfficeGags` (et le retire au démontage).
3. `scene/MishapProps.tsx` : effets de pièce placés d'après les définitions de `layout.ts`
   (prop `boiler` de `machines`, prop `alchemyBench` de `epreuves`, coordonnées pièce + prop) —
   sphères de fumée grises / vertes qui gonflent et s'estompent + bref `pointLight`. Hors des
   props fusionnés (`merge.ts` intouché).
4. `scene/Soot.tsx` : hook `useSoot(rootRef)` — remplace temporairement les matériaux des meshes
   de la figure par des clones teintés, anime `sootAmount`, restaure et `dispose` à la fin ou au
   démontage. `MishapEffect.tsx` : bulle BD (classes CSS `.mishap*`, calquées sur `.slap*`).
5. `AgentFigure.tsx` (modif minimale) : abonnement `onMishap(agent.id, …)` dans un `useEffect`,
   appel de `useSoot`, `<MishapEffect>` dans l'ancre `<Html>` existante de la baffe.
6. `Office.tsx` (modif minimale) : monte `<MishapWatcher />` et `<MishapProps />`.

### Stack & Tools
- **Frontend :** React, react-three-fiber, drei `<Html>`, Zustand (store existant), Vitest.
- **Backend :** aucun changement.

### Files to Create/Modify
1. `packages/web/src/scene/mishap.ts` — logique pure + bus (nouveau)
2. `packages/web/src/scene/MishapWatcher.tsx` — événements → gags, commande console (nouveau)
3. `packages/web/src/scene/MishapProps.tsx` — fumée chaudière / explosion fiole (nouveau)
4. `packages/web/src/scene/Soot.tsx`, `packages/web/src/scene/MishapEffect.tsx` — suie et bulle (nouveaux)
5. `packages/web/src/scene/AgentFigure.tsx`, `packages/web/src/scene/Office.tsx` — branchements de quelques lignes
6. `packages/web/src/i18n/*` — clés `mishap.boiler`, `mishap.flask` (FR/DE/EN), ajoutées en bloc isolé
7. `packages/web/src/styles.css` — bloc `.mishap*` (reduced motion, forced-colors)
8. `packages/web/test/mishap.test.ts` — tests du module pur
9. Docs : `docs/ai/dungeon-scene.md` (curator), doc humaine `docs/utilisation.md` ou `docs/lieux.md` (otis), dont la commande console

## Work Breakdown

Single lot — main session.

## Performance Considerations
- **Expected bottlenecks :** rafales d'échecs (boucle de commandes en erreur) → plusieurs
  effets superposés. Un nouvel événement redémarre l'effet en cours (clé de remontage) au lieu
  d'en empiler ; la suie est réarmée, pas re-clonée.
- **Optimizations planned :** géométries/matériaux de fumée partagés au module ; aucun coût
  quand rien n'échoue (composants rendent `null`).

## Edge Cases & Error Handling
- Événement d'un autre environnement : le bus ne trouve aucune figure ; l'effet de pièce ne joue
  que si l'agent appartient à une session de la route courante.
- `PostToolUseFailure` d'un agent hors des machines et pas une commande de test → rien.
- Figure démontée pendant la suie → matériaux restaurés/libérés au démontage.
- Figure mourante (embuscade) ou fantôme : non visés (pas d'abonnement).
- `detail` absent ou tronqué : classification sur ce qui reste, sinon chaudière.
- Commande console avec un id inconnu → renvoie `null`, ne lève pas.

## Verification
- `npm test` (nouveau `mishap.test.ts` : classification, détection des lanceurs de tests, cible,
  `sootAmount`, bus), `npm run typecheck`.
- Aperçu : build web + serveur de test (méthode `docs/ai/agent-lifecycle.md`, Usage), faux hooks
  `PreToolUse` Bash puis `PostToolUseFailure` (commande quelconque → chaudière ; `npm test` →
  fiole) ; puis `agentOfficeGags.boiler()` / `.flask()` dans la console. Capture d'écran.
- Pipeline qualité (dexter, hermione + timmy + neo, curator, otis).

## Complexity Estimate

**Size:** M

**Justification:** plusieurs composants 3D nouveaux (fumée, suie par matériaux clonés) et un
branchement store → scène, sans changement serveur.
