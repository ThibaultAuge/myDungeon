# Conception

Ce document garde les choix de conception, l'état de l'implémentation et les limites connues. Pour l'usage, voir [utilisation.md](utilisation.md). Pour les lieux et les personnages, voir [lieux.md](lieux.md) et [personnages.md](personnages.md).

## Ambiance

Un **donjon de fantasy coloré et joyeux**, pas sombre : proportions trapues, couleurs franches, esprit « jouet ». Tous les modèles viennent de KayKit (https://kaylousberg.itch.io/), pour garder un style cohérent. Quaternius (https://quaternius.com/) n'est pas utilisé. La licence se vérifie pack par pack : par exemple, *Characters – Fantasy Races* de Quaternius n'est pas en CC0.

## Décisions

- **L'humain n'est pas représenté.** La bulle et la file à l'autel suffisent.
- **Sessions lancées par une autre session** (`spawnedFrom`). Chacune est un agent principal à part entière, avec sa propre couleur. En général elle travaille dans son propre worktree et ne dépend pas de la session qui l'a lancée. Le lien est donc secondaire : une mention « lancée depuis… » dans la fiche de l'agent suffit, un repère visuel dans la 3D est facultatif.
- **Skills** (`jira-comment`, `knowledge`…). Ce ne sont pas des personnages. Un agent qui utilise un skill porte un **badge** à son nom : un petit insigne en 3D sur le personnage, ou au minimum un badge dans la fiche de l'agent. Ce badge n'est pas encore en place (voir « Reste à faire »).
- **Le Scriptorium** est un coin de la Bibliothèque.
- **Nombre de pièces.** On part sur 14 lieux. La lisibilité et les 60 images/s seront vérifiées à l'usage.

## État de l'implémentation

*Mis à jour le 2026-11-14.*

### Fait

- les personnages animés KayKit Adventurers 2.0 : un chevalier pour l'agent principal, et une tenue par type de sous-agent (table `LOOKS`), identique pour la figure au repos de la taverne. Marche, course, travail, attente, agenouillement à l'autel et pose calme, et une couleur de session sur le disque au sol et l'étiquette ;
- le plan du donjon, ses 14 lieux et ses couloirs (`packages/web/src/scene/layout.ts`, rendu dans `Room.tsx`) ;
- les déplacements par les portes et les couloirs, y compris quand un agent change de destination en chemin ;
- le tableau outil → pièce et les postes attitrés des agents spécialisés (`packages/server/src/reducer.ts`) ;
- les places par pièce, les postes attitrés, le débordement le long des murs ;
- la file d'attente à l'autel, réservée aux permissions, questions et erreurs ;
- le cycle de vie de la taverne : un exemplaire neutre de chaque type au repos, appel, appels simultanés depuis les casiers, retour et disparition, et l'agent principal au repos pendant l'attente d'un prompt ;
- la bulle de requête à l'autel (« … », « ? », « ! ») et le losange ambre de l'attente d'un prompt ;
- les icônes d'état (marteau, sablier, main ouverte levée, « Zzz ») dans la liste latérale et la fiche d'agent ;
- le pictogramme de destination au-dessus d'un agent qui marche ;
- la boîte de dialogue en lecture seule, ouverte par un clic sur un personnage ou sur sa ligne, lisible sans connexion depuis la page servie en local ;
- la fiche d'agent avec le contexte de la session et les serveurs web détectés ;
- les postes de travail : survol et clic sur le mobilier (`packages/web/src/scene/Post.tsx`), carte du poste (`packages/web/src/ui/PostCard.tsx`), un poste par fonction dans les pièces à plusieurs fonctions, et la liste « Lieux du bureau » du panneau latéral ;
- la forêt de nuit, avec les douves, le pont-levis et la porte du château.

### Reste à faire

- la zone de saisie dans la boîte de dialogue, pour répondre depuis la 3D. Cette phase aura sa propre protection d'accès ;
- un badge numéroté (1, 2, 3) ou une variation de teinte pour distinguer les doublons d'un même type. Aujourd'hui, ils ont des figures identiques ;
- la tenue de l'agent principal selon le mode de travail. Aujourd'hui, c'est toujours le chevalier : le champ `permission_mode` n'est pas utilisé. Voir la table ci-dessous ;
- les badges de skills. Le hook `PreToolUse` de l'outil `Skill` donne le nom du skill (à vérifier) ;
- rapprocher les tenues du cliché visuel quand des modèles plus proches existent (lunettes, plume, pinceau, pigeon…).

#### Tenues prévues de l'agent principal

| Mode | Cliché | Où |
|---|---|---|
| **Exploration et planification** | Éclaireuse cartographe : sac à dos, carte dépliée, longue-vue | Salle des cartes, Bibliothèque |
| **Réalisation et coordination** | Maître d'œuvre de chantier : tablier de cuir, marteau, plan roulé sous le bras | Atelier, Salle des machines |

Les événements de hook portent un champ `permission_mode` (`plan` en mode plan). Il devrait suffire pour choisir la tenue, mais ce n'est pas encore testé.

## Limites et suite

- La scène fait environ 700 appels de dessin par image, ombres comprises, parce que le mobilier isolé n'est pas encore regroupé en instances. Les pièces répétées (sols, forêt, pièces de kit répétées) passent déjà par des instances (`KitInstances.tsx`). Des assets Unreal ne seraient utilisables que si leur licence Fab autorise un usage hors Unreal Engine.
- La boîte de dialogue est en lecture seule. Répondre aux agents depuis la 3D (permission, question) fera l'objet d'une phase distincte, avec sa propre protection d'accès. Envoyer un prompt libre à une session déjà ouverte n'a pas encore de solution officielle.
- Le plan complet se trouve dans [plans/plan-agent-office-2026-11-13.md](../plans/plan-agent-office-2026-11-13.md).
