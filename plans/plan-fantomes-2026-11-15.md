# Plan d'implémentation — Fantômes errants pour les sessions sans activité

*Rédigé le 2026-11-15. À copier dans `plans/plan-fantomes-2026-11-15.md` après approbation.*

## Objectif

Aujourd'hui, un processus Claude Code qui n'a jamais rien fait s'affiche dans le donjon comme un vrai agent assis dans la taverne. C'est le cas d'un processus préparé à l'avance par l'app de bureau, ou de celui d'une session de bureau qu'on vient de supprimer (vu avec `claudeworkshop` et `claudeworkshop-1b`). Ça trompe l'utilisateur.

Désormais, ces sessions apparaîtront sous la forme d'un **fantôme dessiné en code**, qui erre lentement dans les couloirs et **s'évapore** quand la session disparaît.

## Exigences

### Fonctionnelles
- **Ce qu'est un fantôme :** une session `cli` arrêtée (`live: false`) qui n'a **jamais eu d'activité réelle**.
  - Le serveur considère qu'une session a été active dès que l'un de ces signaux arrive :
    - un hook de travail : `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`, `SubagentStart`, `SubagentStop`, `Stop` ou `StopFailure` ;
    - un statut de processus `busy` ;
    - un transcript non vide présent sur le disque au moment où la session est découverte.
  - Ne comptent **pas** comme activité : `SessionStart`, `SessionEnd`, `Notification`, ni un simple processus `idle`.
  - Une session de bureau (`desktop`) n'est jamais un fantôme.
- **Pendant que le processus tourne** (session `live`, même inactive), la session garde son affichage actuel, en chevalier dans la taverne. Elle ne devient fantôme qu'une fois arrêtée.
- **Le fantôme :**
  - Il apparaît à la dernière position connue du chevalier (« l'âme quitte le corps »), sinon à un point de couloir.
  - Il erre le long des `CORRIDORS` : il choisit des points de couloir au hasard et y va par `corridorPath`, à vitesse lente, en ondulant de haut en bas. Le hasard est initialisé avec l'id de la session, donc le trajet est reproductible.
  - Il porte la teinte de la session, en léger reflet, et son étiquette de nom (le titre de session, comme aujourd'hui).
  - Il n'est pas sélectionnable et n'a ni disque ni anneau. Il n'est pas listé dans le panneau, comme les sessions arrêtées actuelles.
- **Départ** (nettoyage après 60 min, suppression ou archivage) : le fantôme s'estompe et monte en 1,5 s environ, puis il est retiré. Il n'y a pas d'embuscade de squelettes.
- **Retour à la vie** (le processus revient ou un hook arrive) : la session n'est plus un fantôme. Le fantôme s'évapore et le chevalier réapparaît à sa place normale.

### Non fonctionnelles
- **Performance :** une géométrie et un matériau partagés au niveau du module, comme `SlapHand.tsx`. Pas d'ombre. Aucun objet alloué à chaque image.
- **Animations réduites** (`reducedMotion()`) : le fantôme reste immobile sur un point de couloir, sans ondulation, et disparaît d'un coup à son départ.
- **Accessibilité / i18n :** aucun nouveau texte affiché. L'étiquette reste `aria-hidden` comme les autres, et un fantôme n'est pas une cible cliquable en 3D seulement.

### Hors périmètre
- Masquer les processus inactifs pendant qu'ils tournent.
- Les sous-agents fantômes.
- Un modèle 3D importé.

## Approche technique

### Contrat (`packages/shared/src/index.ts`)
- Ajouter à `SessionView` le champ `everActive: boolean`, documenté : vrai dès la première activité réelle, ne redevient jamais faux.
- Ajouter à `LiveProcess` (`packages/server/src/inventory.ts`) le champ `transcript?: boolean`.

### Serveur
- **`reducer.ts`**
  - `createSession` initialise `everActive` à `origin === 'desktop'`.
  - `applyHook` le passe à vrai pour les hooks de travail listés plus haut (un ensemble `ACTIVITY_EVENTS`).
  - `mainFromLiveStatus` le passe à vrai sur `busy`.
  - La boucle `inv.live` le passe à vrai si `p.transcript`.
  - Une session `cli` absorbée par une session de bureau suit l'absorption sans traitement particulier, puisque le bureau vaut `true`.
- **`inventory.ts`, dans `readInventory`** : pour chaque processus vivant, remplir `transcript` avec un `fs.statSync` sur `<projectsDir>/<projectDirName(cwd)>/<cliSessionId>.jsonl` (taille > 0). On réutilise `projectDirName` de `transcript.ts`. Une erreur donne `false`. L'id passe déjà la validation de `parseLiveProcess` ; on vérifie avec `isInside` que le chemin reste sous `projectsDir`.

### Web
- **`scene/ghost.ts`** (nouveau, pur, testable) :
  - `isGhost(session)` = `origin === 'cli' && !live && !everActive`.
  - `GHOST_SPEED`, `EVAPORATE_MS`.
  - Un générateur pseudo-aléatoire initialisé par une chaîne.
  - `corridorPoints()`, qui renvoie les extrémités et jonctions des `CORRIDORS`.
  - `nextWander(rng, from)`, qui choisit un point différent et renvoie le trajet par `corridorPath`.
  - `snapToCorridor(p)`, qui ramène une position de départ hors couloir sur le couloir le plus proche.
  - `evaporation(t)`, qui renvoie l'opacité et l'élévation.
- **`scene/GhostFigure.tsx`** (nouveau) :
  - Le corps est un drap : une `LatheGeometry` en dôme prolongée d'une jupe au bas ondulé (les sommets sont déplacés une seule fois, à la construction), plus deux yeux sombres en `SphereGeometry` aplaties.
  - Le matériau est un `MeshStandardMaterial` blanc bleuté, `transparent`, opacité ~0,7, avec un léger émissif mélangé à la couleur de session. Il est cloné par fantôme seulement pour la teinte et l'opacité.
  - Le `useFrame` avance le long du trajet, oriente le fantôme dans le sens de la marche, fait l'ondulation et applique l'évaporation quand la prop `leaving` est posée, puis appelle `onGone`.
  - L'étiquette `<Html>` reprend la classe `agent-tag` des figures.
- **`scene/Office.tsx`** :
  - `visibleAgents` exclut l'agent principal d'une session fantôme, ce qui évite le siège, le `Stage` et l'embuscade.
  - Un petit état local garde les fantômes qui partent jusqu'à `onGone`. C'est la même idée que `stage.leaving`, mais sans embuscade.
  - Au rendu : un `GhostFigure` par session fantôme, avec comme départ `agentPositions.get(main.id)` s'il existe.
  - On vérifie que `Stage` ne compte pas comme « parti » un chevalier devenu fantôme : la session reste dans le snapshot, donc elle n'est pas dans `departed`, et la figure se démonte simplement.

### Fichiers
1. `packages/shared/src/index.ts` : champ `everActive`.
2. `packages/server/src/inventory.ts` : `LiveProcess.transcript` et le test du transcript dans `readInventory`.
3. `packages/server/src/reducer.ts` : `everActive`.
4. `packages/server/test/reducer.test.ts` (+ le test d'inventaire existant s'il y en a un) : nouveaux cas.
5. `packages/web/src/scene/ghost.ts` + `packages/web/test/ghost.test.ts` (nouveaux).
6. `packages/web/src/scene/GhostFigure.tsx` (nouveau).
7. `packages/web/src/scene/Office.tsx` : exclusion, rendu et évaporation.
8. Les fixtures de test qui construisent des `SessionView` : ajouter `everActive`.

## Découpage du travail

### Contrat (session principale, d'abord)
- `SessionView.everActive` et `LiveProcess.transcript`, avec leurs commentaires de documentation.
- **Commit du contrat :** non, tous les lots partagent le même checkout.

### Lots

| Lot | Fichiers (exclusifs) | Dépend de | Délégable | Vérification |
|---|---|---|---|---|
| A — serveur | `packages/server/src/reducer.ts`, `packages/server/src/inventory.ts`, `packages/server/test/**` | contrat | oui, même checkout | `npx vitest run packages/server` |
| B — web | `packages/web/src/scene/ghost.ts`, `GhostFigure.tsx`, `Office.tsx`, `packages/web/test/ghost.test.ts`, fixtures web | contrat | non : réglage visuel itératif dans l'aperçu | `npx vitest run packages/web` + aperçu |

## Cas limites
- **Redémarrage du serveur avec un vieux processus inactif mais réel :** le test du transcript le classe comme actif, donc ce n'est pas un faux fantôme.
- **Hook `SessionEnd` sur une session jamais vue** (`resolveSession`) : elle n'a pas d'activité, donc elle devient un fantôme. C'est voulu.
- **Fantôme qui redevient vivant pendant qu'il s'évapore :** l'évaporation se termine et le chevalier réapparaît, avec des clés React distinctes (`ghost:<id>`).
- **Position de départ dans une pièce :** `snapToCorridor` passe par la porte la plus proche, sinon le fantôme repart du couloir le plus proche (pas de blocage).
- **Plusieurs fantômes :** chacun a son propre aléa, donc ils ne se suivent pas en file.

## Vérification
1. `npm test` et `npm run typecheck`.
2. Aperçu (`npm run dev`) :
   - Avec des faux hooks (`docs/ai/agent-lifecycle.md`, section des tests en faux hooks), une session `cli` qui reçoit seulement `SessionStart` puis `SessionEnd` doit errer en fantôme.
   - Une session qui reçoit `UserPromptSubmit` puis `SessionEnd` doit rester en chevalier dans la taverne.
   - Après suppression, le fantôme s'évapore.
   - Avec les animations réduites, le fantôme reste immobile et disparaît d'un coup.
   - Une capture d'écran sert de preuve.
3. Portes de qualité selon le pipeline :
   - dexter, hermione, timmy (rendu 3D), neo (lecture du système de fichiers dans `readInventory`) ;
   - curator pour `docs/ai/agent-lifecycle.md` et `dungeon-scene.md` ;
   - otis pour `docs/personnages.md`, `docs/lieux.md` et `docs/fonctionnement.md`.

## Estimation

**Taille :** M. **Justification :** le changement est petit côté serveur, mais il faut un nouveau composant 3D animé et son intégration au cycle de vie de la scène.
