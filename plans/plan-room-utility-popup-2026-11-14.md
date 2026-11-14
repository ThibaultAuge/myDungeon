# Plan d'implémentation — Fiches des postes de travail (survol + popup)

*Rédigé le 2026-11-14. Copié dans `plans/plan-room-utility-popup-2026-11-14.md` au début de l'implémentation.*

## Objectif

Aujourd'hui, chaque salle porte une bulle de titre (`Html` de drei dans `Room.tsx`) qui encombre la vue et ne dit pas à quoi sert la salle. On les remplace par des **postes de travail interactifs** : au survol, les meubles du poste s'illuminent un peu ; au clic, une fiche s'ouvre en haut à droite de la scène avec le titre, la fonction en quelques mots et les agents qui y travaillent. Les salles à plusieurs fonctions ont un poste par fonction.

## Exigences

### Fonctionnelles
- On ne clique que sur les **postes** (meubles fonctionnels), jamais sur le sol ou les murs. La déco (`crates`, `barrels`, `chest`, `coins`, `candle`, `rug`) n'est pas interactive.
- Survol : tous les meubles du poste s'éclaircissent ensemble (lueur émissive chaude), curseur `pointer`.
- Clic : fiche en haut à droite de `.office__scene` avec titre, fonction, ligne « qui » (types d'agents, non traduits). Un clic sur un autre poste remplace la fiche.
- Fermeture : bouton ×, touche Échap, clic dans le vide (même `onPointerMissed` que pour désélectionner un agent).
- Un clic après un glissement de caméra (`e.delta` > 4 px) n'ouvre rien.
- Les bulles de titre des salles disparaissent.

### Découpage en postes (18)
| Poste | Salle | Meubles | Qui |
|---|---|---|---|
| `autel` | Autel | autel, bougies, bancs | tout agent qui attend l'humain, claude-code-guide |
| `cartes` | Cartes | table des cartes, globe | agent principal, Plan |
| `atelier` | Atelier | 4 établis, râtelier | agent principal, general-purpose, fork, Hancock en tournée |
| `chevalet` | Atelier | chevalet | Barbapapa |
| `biblio` | Bibliothèque | 4 rayonnages, 2 tables | Explore, agent principal |
| `scriptorium` | Scriptorium | 2 pupitres | Curator, Otis |
| `observatoire` | Observatoire | lunette, table du ciel | Oracle, agent principal |
| `pigeonnier` | Pigeonnier | volière, pupitre | Samuel Morse |
| `machines` | Machines | chaudière, 2 machines | agent principal, agents génériques |
| `arithmetique` | Arithméticien | boulier, ardoise | Turing |
| `garde` | Garde | table, râtelier d'armes, herse, lanternes | Neo |
| `relecture` | Épreuves | table de relecture | Hermione |
| `labo` | Épreuves | établi d'alchimie | Dexter |
| `estrade` | Héraut | estrade | Gatsby |
| `inspection` | Héraut | pupitre d'inspection | Timmy |
| `detente` | Détente | banquette, table de dés, affiches | Butt Stallion |
| `concierge` | Concierge | balais, chariot, tonneau | Hancock |
| `taverne` | Taverne | tables, cheminée, tonneaux, casiers | agents au repos, agent principal en attente |

Les « qui » reprennent `AGENT_POSTS` / `TOOL_ROOMS` de `packages/server/src/reducer.ts` et `docs/lieux-et-personnages.md`.

### Non fonctionnelles
- **i18n** : titres, fonctions, libellés (« Qui », « Fermer la fiche ») en FR/DE/EN. Les noms de types d'agents (`Hermione`, `Explore`…) sont des identifiants, comme dans `t.panel.subagent(type)` ; « agent principal », « agents génériques », « tout agent qui attend l'humain » sont traduits.
- **Accessibilité** : fiche en `<section aria-labelledby>` avec un `<h2>`, bouton de fermeture traduit, annoncée via `aria-live="polite"`. La lueur n'est qu'un indice visuel ; le canvas reste `role="img"`, l'info n'est pas essentielle à l'usage. Règles forced-colors comme pour `.agent-panel`.
- **Perf** : aucun mesh ajouté ; les matériaux sont clonés au survol (un clone par matériau source, mis en cache).

### Hors périmètre
- Accès clavier aux postes (le canvas n'est pas focalisable aujourd'hui) — à reprendre avec une liste des lieux dans le panneau latéral si `timmy` le juge bloquant.
- Liste des agents présents dans la fiche.
- Survol de la salle entière.

## Approche technique

### Données (pur, testable) — `packages/web/src/scene/layout.ts`
- `type PostId` (les 18 ids ci-dessus) et champ optionnel `post?: PostId` sur `Prop`. On le pose sur chaque meuble fonctionnel des `ROOMS`.
- `postGroups(room): { post: PostId; props: Prop[] }[]` (ordre stable) et `POST_IDS` dérivé.
- `POST_AGENTS: Record<PostId, string[]>` : types d'agents attitrés (noms propres non traduits). Les groupes génériques (« agent principal »…) sont des clés i18n, pas des chaînes ici.

### i18n — `i18n/fr.ts`, `de.ts`, `en.ts`
- `posts: { [id]: { title, role, who } } satisfies Record<PostId, …>` ; `who` est une chaîne traduite qui peut contenir les noms d'agents (« Hermione », « Explore et l'agent principal quand il lit »). Plus simple que de recomposer une liste, et ça reste traduisible.
- `postCard: { close: 'Fermer la fiche', who: 'Qui y travaille' }`.
- On garde `rooms` (utilisé par le panneau d'agent).

### Store — `store.ts`
- `selectedPost: PostId | null`, `selectPost(id)`. Remis à `null` au changement de route, comme `selectedAgentId`.

### Scène
- **Nouveau `scene/highlight.ts`** : `setHighlight(root: Object3D, on: boolean)` parcourt les meshes, remplace `MeshStandardMaterial` par un clone émissif (`emissive #ffd9a0`, intensité ~0.35, cache `WeakMap<Material, Material>`), garde l'original dans `userData` pour le restaurer. Ignore les `MeshBasicMaterial` (bougies `Blink`). Fonctionne aussi pour les `InstancedMesh` des rangées de livres.
- **Nouveau `scene/Post.tsx`** : `<group>` autour des meubles d'un poste, `onPointerOver/Out` (stopPropagation, curseur, `setHighlight`), `onClick` (ignore si `e.delta > 4`, puis `selectPost`). Remet le curseur au démontage, comme `AgentFigure`.
- **`Room.tsx`** : regroupe les props par poste avec `postGroups` ; meubles sans `post` rendus comme aujourd'hui. Supprime les `<Html>` des salles, l'état `signs` et l'import `Html`.
- **`Office.tsx`** : `onPointerMissed` ferme aussi la fiche. Les figures d'agents font déjà `stopPropagation`, donc un clic sur un agent devant un meuble sélectionne l'agent.

### UI — nouveau `ui/PostCard.tsx` + `App.tsx` + `styles.css`
- Rendue dans `.office__scene`, en `position: absolute; top: 12px; right: 12px; max-width: 280px`, style de `.legend` / `.agent-panel`. Échap ferme (écouteur `keydown` actif seulement quand la fiche est ouverte).
- Supprimer `.room-sign` de `styles.css`.

### Fichiers
1. `packages/web/src/scene/layout.ts` — `PostId`, `Prop.post`, `postGroups`, `POST_IDS`.
2. `packages/web/src/scene/highlight.ts` *(nouveau)* — lueur par clonage de matériaux.
3. `packages/web/src/scene/Post.tsx` *(nouveau)* — groupe interactif.
4. `packages/web/src/scene/Room.tsx` — postes, suppression des bulles.
5. `packages/web/src/scene/Office.tsx` — `onPointerMissed`.
6. `packages/web/src/store.ts` — `selectedPost`.
7. `packages/web/src/ui/PostCard.tsx` *(nouveau)*, `packages/web/src/App.tsx`, `packages/web/src/styles.css`.
8. `packages/web/src/i18n/{fr,de,en}.ts` — `posts`, `postCard`.
9. Tests : `test/layout.test.ts` (chaque `PostId` a au moins un meuble, aucun meuble de déco n'a de poste, chaque salle sauf les déco-seules a au moins un poste), `test/i18n.test.ts` (couverture de `posts` dans les 3 langues, chaînes non vides).

## Performance
- Pas de nouvelles draw calls. Le raycast R3F ne teste que les meshes sous un groupe avec handlers (postes + agents) : quelques centaines de meshes, à vérifier à l'usage.

## Cas limites
- Survol d'un poste puis passage sur un agent devant : l'agent stoppe la propagation, le poste reçoit `pointerout` et s'éteint.
- Fiche ouverte et changement de langue : la fiche se retraduit (lit `t` au rendu).
- Changement d'environnement : `selectedPost` remis à `null`.
- Matériaux partagés par pack : jamais modifiés en place, seulement remplacés sur le mesh survolé.

## Vérification
- `npm run typecheck`, `npm test`.
- Preview `agent-office-web` (Vite 5173) avec Playwright : capture survol (lueur sur les 4 rayonnages + 2 tables, pas sur les pupitres du scriptorium), clic → fiche en haut à droite, Échap ferme, plus de bulles de salles, bascule FR/DE/EN.

## Estimation
**Taille : M** — une dizaine de fichiers, logique simple mais touchant données, scène, store, UI et trois dictionnaires.
