# Implementation Plan — Gag du pigeon de Samuel-Morse

*Generated on 2026-11-15*

## Business Objective

Un des cinq gags retenus pour le donjon (dans l'esprit de la baffe). Quand un agent du
Pigeonnier (Samuel-Morse) lance un appel HTTP avec curl, un pigeon s'envole de la volière.
Si l'appel réussit, le pigeon revient. Si c'est une erreur, une issue est tirée au sort :
il revient plumé, il ne revient pas, ou il lâche une fiente sur la tête de l'agent. Une
commande JavaScript, gardée pour de bon, déclenche l'animation à la demande.

## Requirements Summary

### Functional Requirements
- **Déclencheur (choix de l'utilisateur) :** seulement un agent qui travaille au Pigeonnier
  et lance via `Bash` ou `PowerShell` une commande `curl` / `wget` / `Invoke-WebRequest` /
  `Invoke-RestMethod` / `iwr` / `irm`. Le pigeon part sur `PreToolUse` et revient sur
  `PostToolUse` ou `PostToolUseFailure`.
- **Succès / échec (serveur) :**
  - `PostToolUseFailure` → erreur (curl qui sort en erreur, réseau, timeout) ;
  - `PostToolUse` → on prend le dernier code HTTP de `tool_response.stdout` (marqueur
    `--- HTTP nnn` de Samuel-Morse en priorité, sinon la dernière ligne `HTTP/x nnn` de
    `-i`) ; un code ≥ 400 → erreur, sinon succès ;
  - aucun code trouvé → succès (curl est sorti à 0, donc une réponse est bien arrivée).
- **Issue en cas d'erreur (choix de l'utilisateur) :** tirée au hasard, à parts égales,
  entre `plucked` (plumé), `lost` (perdu) et `dropping` (fiente). Le succès donne `back`.
- **Animations :**
  - départ : le pigeon (la peluche-poulet déjà utilisée dans la volière, petite échelle,
    battement d'ailes simulé par roulis et rebond) s'envole de la volière, monte et sort
    du cadre ;
  - `back` : il revient se poser sur la volière puis disparaît ;
  - `plucked` : même retour, teinte rosée, et une gerbe de plumes (petits plans blancs)
    tombe en tournoyant ;
  - `lost` : pas de retour ; après un moment, une seule plume redescend lentement
    au-dessus de la volière ;
  - `dropping` : il passe au-dessus de la tête de l'agent, une goutte blanche tombe et
    reste sur sa tête quelques secondes (en suivant la figurine), puis il rentre.
- **Rythme :** l'aller dure au moins le temps de son animation, même si le
  `PostToolUse` arrive tout de suite (un curl dure souvent moins d'une seconde). Pas de
  `Post` après 60 s → `lost`. Au plus 4 pigeons en vol, les appels en trop sont ignorés.
  Appariement Pre/Post en file (FIFO) par agent.
- **Commande de test (choix de l'utilisateur : toujours disponible, dev et build) :**
  `iaia.pigeon(issue?, agentId?)` dans la console du navigateur, avec
  `issue` ∈ `'back' | 'plucked' | 'lost' | 'dropping'` (défaut `'back'`). Sans `agentId`,
  elle vise le premier agent présent au Pigeonnier ; s'il n'y en a pas, la fiente tombe
  sur le pupitre. Elle passe par le même module pur que les vrais événements.
  `window.iaia` est fusionné (`Object.assign`) pour que les autres gags y ajoutent leurs
  commandes sans conflit ; je laisse une note dans le dossier partagé des sessions pour
  le proposer.

### Non-Functional Requirements
- **Performance :** un modèle KayKit par pigeon en vol (4 au plus), géométries des plumes
  et de la goutte partagées au niveau du module. Analyse de `stdout` bornée (64 premiers Ko
  et 4 derniers Ko), regex sans backtracking.
- **Security :** le serveur n'envoie au client qu'une valeur d'énumération
  (`httpCall: 'start' | 'ok' | 'error'`), jamais le contenu de la réponse, l'URL au-delà de
  `detail` existant, ni le code HTTP. Aucun texte affiché venant du serveur.
- **UX/UI :** décoratif, 3D seule, `aria-hidden` ; aucun texte visible, donc pas de clé
  i18n. Avec `prefers-reduced-motion` : aucun vol ; seule la fiente reste visible, statique,
  sur la tête de l'agent pour la même durée.

### Out of Scope
- Les curl de l'agent principal (Salle des machines) et `WebFetch` (Observatoire).
- Toute réutilisation des autres gags (chaudière, autel, potion, héraut).

## Technical Approach

### Architecture
1. **Serveur** — nouveau module pur `packages/server/src/http-call.ts` :
   `isHttpCommand(command)`, `httpStatus(stdout)` (dernier code), `httpCallOf(ev, room)`
   → `'start' | 'ok' | 'error' | undefined`. `summarize` (reducer.ts) ajoute ce champ
   seulement si l'agent de l'événement travaille au Pigeonnier après `applyHook`
   (une ligne pour retrouver l'agent, une ligne pour le champ). `tool_response` est lu par
   le `passthrough()` existant de `hookEventSchema`, sans nouvelle clé dans le schéma.
2. **Contrat partagé** — `HookEventSummary.httpCall?: 'start' | 'ok' | 'error'` dans
   `packages/shared/src/index.ts` (un seul champ optionnel).
3. **Client, logique pure** — `packages/web/src/scene/pigeon.ts` (testé) :
   `pigeonOutcome(result, rng)`, classe `Pigeons` (machine à états comme `Ambush` :
   phases `leaving → away → returning → landed → gone`, `lost` sans retour, fiente avec
   `dropAt` / `splatUntil`), `pigeonPoint(flight, now, places)` pour la position à chaque
   image, `MAX_PIGEONS`, durées.
4. **Client, rendu** — `packages/web/src/scene/Pigeons.tsx` : lit les nouveaux événements du
   store (`seq` > dernier vu) qui portent `httpCall`, appelle `Pigeons`, et dessine les
   pigeons, les plumes et la goutte (la tête est suivie via `agentPositions` de
   `AgentFigure.tsx`). Monté par une ligne dans `Office.tsx`. Position de la volière et du
   pupitre lues dans `layout.ts` (pièce `pigeonnier`, props `aviary` et `lectern`).
5. **Commande de test** — `packages/web/src/debug-commands.ts` : installe
   `window.iaia.pigeon`, qui appelle un petit bus (`launchPigeon`, sur le modèle de
   `slap.ts`) écouté par `Pigeons.tsx`. Importé une fois depuis `main.tsx`.

### Stack & Tools
- **Frontend :** React, react-three-fiber, zustand (store existant), modèles KayKit
  (`chicken_plushie_A`, pack `mixed1`).
- **Backend :** Fastify, zod (schéma existant).
- **External APIs :** aucune.

### Files to Create/Modify
1. `packages/server/src/http-call.ts` — nouveau, classement de la commande et du résultat.
2. `packages/server/src/reducer.ts` — `summarize` ajoute `httpCall` (modification minimale).
3. `packages/shared/src/index.ts` — champ `httpCall` de `HookEventSummary`.
4. `packages/web/src/scene/pigeon.ts` — nouveau, logique pure.
5. `packages/web/src/scene/Pigeons.tsx` — nouveau, rendu.
6. `packages/web/src/scene/Office.tsx` — monte `<Pigeons />` (une ligne).
7. `packages/web/src/debug-commands.ts` et `packages/web/src/main.tsx` — commande `iaia`.
8. Tests : `packages/server/test/http-call.test.ts`, ajouts dans
   `packages/server/test/reducer.test.ts` (summarize), `packages/web/test/pigeon.test.ts`.
9. Docs : `docs/ai/` via `curator` (dungeon-scene ou room-identity : le gag, le champ
   `httpCall`, la commande `iaia`) ; doc humaine via `otis` : `docs/lieux.md` (Pigeonnier),
   `docs/utilisation.md` (commande de test), `docs/fonctionnement.md` (champ de
   l'événement), `docs/securite.md` (ce qui est lu de `stdout` et ce qui ne sort jamais).

Travail sur une branche dédiée `feat/pigeon-samuel-morse`, créée depuis `origin/main` à jour.

## Work Breakdown

Single lot — main session

## Performance Considerations

- **Expected bottlenecks :** un `stdout` de curl très gros ; analyse bornée comme décrit.
- **Scale target :** 4 pigeons en vol au plus.
- **Optimizations planned :** géométries et matériaux partagés, pas de nouveau rendu
  React à chaque image (positions dans `useFrame` et des refs).

## Edge Cases & Error Handling

- Un `Post` sans `Pre` en attente (serveur démarré en plein appel) : ignoré.
- Un agent qui quitte la scène pendant que la fiente est sur sa tête : la goutte disparaît.
- Un événement d'une autre session ou d'un autre environnement : on l'ignore si l'agent
  n'est pas dans les sessions affichées.
- Une commande où `curl` n'apparaît que dans une chaîne (`echo curl`) : accepté, sans gravité.
- `prefers-reduced-motion` activé en plein vol : le pigeon disparaît aussitôt.
- Fusions avec les autres gags : modifications de `reducer.ts`, `shared/index.ts`,
  `Office.tsx` et `main.tsx` réduites à quelques lignes.

## Verification

- `npm test` et `npm run typecheck` au vert.
- Aperçu : build du client puis second serveur sur un autre port
  (`AGENT_OFFICE_PORT`, `AGENT_OFFICE_TOKEN`). POST de faux hooks : `SubagentStart`
  `samuel-morse`, puis `PreToolUse` Bash `curl -s -i …`, puis `PostToolUse` avec un
  `stdout` contenant `--- HTTP 200` puis `--- HTTP 404`, et enfin `PostToolUseFailure`.
  Captures d'écran du départ, du retour et de la fiente.
- Console : `iaia.pigeon('plucked')`, `iaia.pigeon('lost')`, `iaia.pigeon('dropping')`.
- Pipeline qualité : dexter, puis hermione + timmy (rendu 3D décoratif) + neo (lecture
  du payload des hooks), puis curator et otis.

## Complexity Estimate

**Size:** M

**Justification:** un module serveur, un contrat d'un champ, une machine à états et un
rendu 3D animé côté client, avec des tests et la doc.
