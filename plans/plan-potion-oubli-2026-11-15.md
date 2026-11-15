# Plan d'implémentation : potion d'oubli à la compaction

*Rédigé le 2026-11-15. Sera copié dans `plans/plan-potion-oubli-2026-11-15.md` à l'approbation.*

## Contexte

C'est l'un des cinq gags humoristiques retenus par l'utilisateur, dans l'esprit de la baffe. Quand Claude Code compacte le contexte d'une session (hook `PreCompact`), l'agent concerné boit une « potion d'oubli », titube, et des étoiles lui tournent autour de la tête. L'humain voit ainsi, d'un coup d'œil et avec humour, que l'agent vient de « perdre la mémoire ».

L'utilisateur veut aussi garder une **commande JavaScript** qui déclenche l'animation à la demande, pour la tester.

État actuel :
- `PreCompact` n'est **pas** relayé : il manque dans `EVENTS` (`scripts/hooks-lib.mjs`).
- Les hooks reçus sont déjà diffusés en direct au client (`store.ts` serveur → `{ type: 'event', event: HookEventSummary }`, avec `sessionId` et `agentId`) et ne sont jamais rejoués à la connexion. C'est le point d'accroche naturel, sans nouveau champ dans le snapshot.

## Ce qu'on construit

1. **Relais.** Ajouter `'PreCompact'` à `EVENTS`. L'utilisateur devra relancer `npm run hooks:install`. Côté `reducer.ts`, aucun cas à ajouter : l'événement tombe dans `default` (pas de changement d'état) et `summarize` le diffuse déjà. Pas de changement de `hookEventSchema` non plus : on ne lit aucun champ nouveau (`trigger` manual/auto est ignoré), et `agent_id` / `agent_type` y sont déjà validés. `PreCompact` n'est pas ajouté à `ACTIVITY_EVENTS` (une compaction ne se produit que dans une session qui a déjà travaillé).
2. **Bus pur `scene/potion.ts`** (sur le modèle de `slap.ts`, testé en node) :
   - `drinkPotion(id)` / `onPotion(id, cb)` ;
   - `potionTarget(event, sessions)` : `HookEventSummary` → id de figure, ou `null`. Il renvoie `null` si l'événement n'est pas `PreCompact`, si la session est inconnue, ou si le sous-agent est absent. Sinon c'est `agentId` d'un sous-agent connu, ou `session.main.id` (jamais `${sessionId}#main` reconstruit) ;
   - constantes de durée : `DRINK_S` = durée du clip `Use_Item` (`USE_ITEM_CLIP_TIME` 1,6 s), `STAGGER_S` ≈ 3 s, `POTION_EFFECT_MS` = total ;
   - `potionPhase(elapsed)` (`'drinking' | 'staggering' | null`) et `staggerSway(t, elapsed)` (roulis/tangage en radians, amplitude qui décroît jusqu'à 0 en fin d'effet). Ce sont des fonctions pures, testées ;
   - la commande de test `agentOffice.potion(id?)`, enregistrée sur `window.agentOffice` (créé s'il n'existe pas, sans fichier commun avec les autres gags : convention proposée aux sessions sœurs dans les notes partagées). Sans argument, elle vise l'agent sélectionné (`useOffice.getState().selectedAgentId`). Elle renvoie `true` si une figure a réagi. Elle est active **aussi en build de production** : c'est purement visuel, sans appel serveur, et ça permet de tester avec `npm run start`.
3. **Branchement live.** Dans `packages/web/src/store.ts`, branche `msg.type === 'event'`, une ligne : `const id = potionTarget(msg.event, state.sessions); if (id) drinkPotion(id);`.
4. **Figure (`AgentFigure.tsx`, ajouts localisés)** :
   - `Motion` gagne `potionLeft` (secondes restantes) et `potionId`. Phase « boire » : clip `Use_Item` joué une fois (via `ClipInput.potion` dans `clipFor`, priorité juste sous la baffe), marche en pause comme pour `hitLeft`. Phase « tituber » : clip normal, mais un `<group>` intermédiaire autour de `Character` reçoit `staggerSway` à chaque frame (rotation x/z autour des pieds). La figure peut marcher en titubant ;
   - fiole en main droite pendant la phase « boire » : `Character` reçoit un prop optionnel `extra?: PropRef`, rendu par `Held` dans sa propre `<Suspense>`, pour que le chargement de la fiole ne masque jamais le personnage. Modèle : `bottle_C_green` du pack `dungeon`, déjà importé. `PropRef.pack` accepte `'dungeon'` et une entrée `PROP_GRIP` règle sa taille et son angle (à ajuster dans l'aperçu). `kit.ts` sait déjà charger ce pack ;
   - effet HTML : un `<Html>` à part, monté seulement pendant l'effet (sans toucher à `slap-anchor`), avec `<PotionEffect key={potionId}>`. Quatre étoiles ★ tournent en orbite autour de la tête (CSS), et une petite bulle traduite apparaît en phase « tituber » ;
   - pas d'effet sur une figure condamnée (`exit`) ni sur un fantôme. Une figure en train d'apparaître (`spawnLeft !== 0`) saute le clip mais garde étoiles et bulle, comme la baffe.
5. **i18n** : clé `potion.bubble`. FR « Où suis-je ? », DE « Wo bin ich? », EN « Where am I? ». Ajoutée en FR/DE/EN avec un commentaire, sur le modèle de `slap.sound`.
6. **CSS** (`styles.css`) : `.potion-anchor`, `.potion`, `.potion__stars`, `.potion__star`, `.potion__bubble`. En `prefers-reduced-motion`, les étoiles sont figées et la bulle statique. Règles `forced-colors` sur le modèle de `.slap*`.
7. **Mouvement réduit** : pas de clip, pas de roulis, pas de fiole animée. Les étoiles et la bulle restent affichées, statiques, pendant `POTION_EFFECT_MS`.

### Hors périmètre
Son de gorgée, annonce dans la région live (le gag reste décoratif, comme la baffe : la compaction n'est pas une information d'état), bouton clavier dans `AgentInfo`, distinction manuel/automatique.

## Fichiers

- `scripts/hooks-lib.mjs` : `EVENTS` + `'PreCompact'`.
- `packages/web/src/scene/potion.ts` (nouveau) : bus, `potionTarget`, phases, roulis, commande `window`.
- `packages/web/src/scene/PotionEffect.tsx` (nouveau) : étoiles et bulle.
- `packages/web/src/scene/characters.ts` : `ClipInput.potion`, branche dans `clipFor`, `PropRef.pack` + `'dungeon'`, grip `bottle_C_green`.
- `packages/web/src/scene/AgentFigure.tsx` : `Motion`, abonnement `onPotion`, groupe de roulis, `extra` sur `Character`, `<Html>` de l'effet.
- `packages/web/src/store.ts` : une ligne dans `onMessage`.
- `packages/web/src/i18n/{fr,de,en}.ts` : `potion.bubble`.
- `packages/web/src/styles.css` : `.potion*`.
- Tests : `packages/web/test/potion.test.ts` (nouveau), `characters.test.ts` (branche `potion` de `clipFor`, grip). Éventuellement `i18n.test.ts` si les clés y sont vérifiées.
- Docs : `docs/fonctionnement.md` (13 événements, PreCompact, relancer `hooks:install`), `docs/utilisation.md` ou `docs/personnages.md` (le gag et la commande `agentOffice.potion()`) via `otis`. Une section « Potion gag » dans `docs/ai/dungeon-scene.md` et la description d'index dans `AGENTS.md` via `curator`.

## Découpage du travail

Single lot — main session.

## Cas limites

- `PreCompact` d'un sous-agent inconnu ou d'une autre session/environnement que la vue courante : `potionTarget` → `null`, rien ne se passe.
- Deux compactions rapprochées : nouvel `potionId`, l'effet redémarre (remontage par clé).
- Une baffe pendant la potion : la baffe a priorité dans `clipFor`, la potion reprend ensuite. Le roulis continue.
- Suspense qui relance l'effet : nettoyage de l'état de l'effet dans le cleanup, comme pour la baffe.
- La reconnexion WebSocket ne rejoue rien (les événements ne sont que live).
- `agentOffice.potion()` sans sélection ou avec un id sans figure : renvoie `false`, sans erreur.

## Performance

Aucun coût hors effet : le `<Html>` n'est monté que pendant ~4,6 s, la fiole est un clone partagé, et le groupe de roulis ne fait qu'une affectation de rotation par frame.

## Vérification

1. `npm test` et `npm run typecheck` au vert.
2. Aperçu : client buildé + second serveur sur un autre port (procédure de `docs/ai/agent-lifecycle.md`, Usage). Envoyer en POST de faux hooks `SessionStart`, `UserPromptSubmit`, puis `PreCompact` (avec, puis sans, `agent_id` d'un sous-agent lancé par `SubagentStart`). Vérifier par capture d'écran : fiole, gorgée, titubation, étoiles et bulle.
3. Console : `agentOffice.potion()` avec un agent sélectionné, puis `agentOffice.potion('<id>')`. Vérifier la valeur renvoyée et l'animation.
4. Mouvement réduit émulé : étoiles et bulle statiques, sans clip ni roulis.
5. Langues FR/DE/EN : texte de la bulle.

## Estimation

**Taille :** M. L'effet touche la figure, le choix de clip, un nouveau prop tenu et le relais, avec l'aperçu 3D à régler (grip, amplitude du roulis).
