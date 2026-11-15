# Lieux

Ce document décrit le donjon : son plan, ses pièces, ses postes, l'autel, la taverne. Pour les personnages, voir [personnages.md](personnages.md). Pour l'usage à l'écran, voir [utilisation.md](utilisation.md).

## Agencement

Plan de référence, dessiné par l'utilisateur. Les espaces entre les blocs sont des couloirs : les agents circulent par là pour aller d'une pièce à l'autre.

```text
┌─────────────┐ ┌─────────────┐ ┌────────────┐ ┌──────────────┐ ┌─────────┐
│ Observatoire│ │  Pigeonnier │ │            │ │ Salle des    │ │         │
└─────────────┘ └─────────────┘ │  ATELIER   │ │ machines     │ │         │
┌─────────────┐ ┌─────────────┐ │            │ └──────────────┘ │         │
│             │ │             │ │            │ ┌──────────────┐ │         │
│ Salle des   │ │ BIBLIO-     │ └────────────┘ │ Cabinet de   │ │ TAVERNE │
│ cartes      │ │ THÈQUE      │ ┌────────────┐ │ l'arithmét.  │ │ (repos) │
│ (planif.)   │ │ +Scriptorium│ │   AUTEL    │ └──────────────┘ │         │
│             │ │             │ │            │ ┌──────────────┐ │         │
└─────────────┘ └─────────────┘ └────────────┘ │ Coin détente │ │         │
┌─────────────┬─────────────────┬────────────┐ └──────────────┘ │         │
│ Poste de    │ SALLE DES       │ Accessibi- │ ┌──────────────┐ │         │
│ garde       │ ÉPREUVES        │ lité / SEO │ │ Réduit du    │ │         │
│ (sécurité)  │ (contrôles)     │            │ │ concierge    │ │         │
└─────────────┴─────────────────┴────────────┘║└──────────────┘ └─────────┘
```

Le `║` sur le bord sud marque la porte du château, entre l'Accessibilité / SEO et le Réduit du concierge, au bout sud du couloir qui les sépare. Le pont-levis baissé franchit les douves et mène au chemin qui s'enfonce dans la forêt de nuit.

- **L'Autel** est au centre de la composition, sous l'Atelier. La file d'attente déborde dans le couloir qui l'entoure.
- **Les grandes pièces** sont celles qui accueillent le plus d'agents en même temps : l'Atelier, la Salle des cartes, la Bibliothèque et la Taverne, qui doit loger un exemplaire de chaque type.
- **Les contrôles** forment une bande continue en bas à gauche : sécurité, revue et tests, puis accessibilité et SEO.
- **Le Scriptorium** (rédaction de documentation) est un coin de la Bibliothèque, avec des pupitres de copistes.

## Le panneau du donjon

Hors du château, juste après le pont-levis et au bord du chemin, un panneau de bois porte le nom du donjon affiché. Deux fanions encadrent le pont-levis, et un petit drapeau surmonte le poteau gauche du panneau. Fanions et drapeau sont de la couleur du donjon.

- **Couleur.** Chaque donjon a sa couleur, choisie parmi neuf teintes faciles à distinguer de nuit. Elle dépend de l'identifiant interne de l'environnement, et non de son nom : renommer un donjon ne change pas sa couleur. Deux donjons peuvent partager une teinte, au-delà de neuf donjons ou par hasard. Le nom écrit sur le panneau les distingue.
- **Hors environnement.** Les sessions qui n'appartiennent à aucun environnement forment un groupe gris. Son nom, « Hors environnement », s'affiche dans la langue choisie.
- **Nom long.** Le nom rétrécit pour tenir sur le panneau. S'il reste trop long, il est coupé et se termine par « … ».
- **Décor seul.** Le panneau et les fanions ne réagissent ni au survol ni au clic. La couleur ne porte aucun sens à elle seule : c'est le nom écrit sur le panneau qui identifie le donjon.
- **Intérieur du château.** Rien ne change à l'intérieur : les bannières gardent la couleur propre à chaque pièce.

## Liste des lieux

| Lieu | Postes | Activité | Qui y travaille |
|---|---|---|---|
| **Autel des requêtes** (centre) | Pupitre-autel, allée pour la file d'attente | Implorer l'humain : permission, question, erreur | Tout agent qui a besoin de l'humain |
| **Salle des cartes** | Grande table couverte de cartes, globe | Explorer le besoin, concevoir, écrire le plan | Agent principal en exploration, Plan |
| **Atelier** | Établis, outils, coin de l'enlumineur avec chevalet | Écrire et modifier le code, découper des maquettes | Agent principal en réalisation, general-purpose, fork, Barbapapa |
| **Bibliothèque** | Rayonnages de grimoires, tables de lecture | Lire et chercher dans le code local | Explore, agent principal quand il lit |
| **Observatoire** | Grande lunette, cartes du ciel | Recherche web, documentation officielle | Oracle |
| **Pigeonnier** | Volière, pupitre à messages | Tester des API externes : un pigeon part, un pigeon revient | Samuel-Morse |
| **Salle des machines** | Machines à vapeur, engrenages, chaudière | Lancer des commandes, compiler, exécuter les tests, git | Agent principal et agents génériques quand ils utilisent une commande (`Bash`, `PowerShell`…) |
| **Cabinet de l'arithméticien** | Boulier géant, abaque, tableau d'ardoise | Calculs et statistiques | Turing |
| **Poste de garde** | Herse, râtelier d'armes, lanternes | Audit sécurité | Neo |
| **Salle des épreuves** | Table de relecture, laboratoire d'alchimie | Revue de code, tests | Hermione, Dexter |
| **Salle Accessibilité / SEO** | Estrade du héraut, pupitre d'inspection | Audits SEO et accessibilité | Gatsby, Timmy |
| **Coin détente** | Banquettes, jeu de dés, mur d'affiches | Idées décalées | Butt-Stallion |
| **Scriptorium** (dans la Bibliothèque) | Pupitres de copistes | Documentation | Curator (pour les IA), Otis (pour les humains) |
| **Réduit du concierge** | Balais, seaux, chariot | Base de Hancock, qui fait des tournées dans l'Atelier | Hancock |
| **Taverne** | Grandes tables, cheminée, tonneaux, casiers | Agents disponibles, sans tâche | Un exemplaire de chaque type d'agent, l'agent principal en attente de ton prochain prompt, et le chevalier endormi d'une session arrêtée |

## Décor propre à chaque pièce

Chaque pièce a ses variantes de murs, des objets accrochés, une lumière d'ambiance à sa
couleur et son décor. Ce décor s'ajoute aux postes du tableau ci-dessus. Il ne réagit pas
au survol.

| Lieu | Décor propre |
|---|---|
| Observatoire | Coffre à cartes, fenêtres en arc |
| Pigeonnier | Sacs, herbe, poulets en peluche en guise de pigeons dans la volière |
| Salle des cartes | Coffre à cartes, cadres et boucliers aux murs |
| Bibliothèque | Étagères murales, pile de livres dont un livre piège (mimic) |
| Atelier | Bois d'œuvre, forge (enclume, meule), murs d'échafaudage |
| Autel des requêtes | Autel de bougies (thème Halloween), triple bannière |
| Salle des machines | Poêle à bois, tonneaux de combustible, chaînes suspendues |
| Cabinet de l'arithméticien | Trésor : lingots d'or et d'argent |
| Coin détente | Canapé, tapis ovale, coin gamer (fauteuil, console portable, guitare), cube-énigme |
| Réduit du concierge | Toiles d'araignée dans les coins, murs fissurés |
| Poste de garde | Ossements, entraves, piège à ours, boucliers, trousseau de clés et épées aux murs |
| Salle des épreuves | Tonneaux |
| Salle Accessibilité / SEO | Cadres aux murs |
| Taverne | Bûches, caisses de réserve, tonneaux, ragoût et assiettes |

## L'autel et la file d'attente

Les agents qui ont besoin de l'humain (permission, question, erreur) viennent devant l'autel. Un agent qui attend seulement ton prochain prompt reste à la taverne. Plutôt que de s'agglutiner, les agents de l'autel **se mettent en file**, les uns derrière les autres dans l'allée :

- le **premier** de la file est à genoux devant l'autel, avec la bulle rouge de sa demande (« … » pour une permission, « ? » pour une question, « ! » pour une erreur) ;
- les **suivants** attendent debout derrière lui, par ordre d'arrivée (le plus ancien en tête) ;
- quand l'humain répond au premier, il repart vers son poste et toute la file **avance d'une place**.

La file est visuelle : elle ne change rien côté Claude Code. L'humain peut toujours répondre dans l'app desktop dans l'ordre qu'il veut, et l'agent concerné sort alors de la file, où qu'il soit. Elle aide seulement à voir quelle demande attend depuis le plus longtemps.

Quand la réponse depuis la 3D sera possible (voir [conception.md](conception.md)), l'autel deviendra le guichet : on traitera la demande du premier de la file.

Si la file dépasse la longueur de l'allée, elle tourne autour de la nef.

## Places par pièce

Deux agents ne se tiennent jamais au même endroit.

- **Chaque pièce a sa liste de places**, définie dans `packages/web/src/scene/layout.ts`. Une place a une position et une orientation (face à l'établi, au rayonnage, à la machine). Chaque poste de travail a aussi ses propres places, puis viennent des places debout le long des murs.
- **Un agent qui arrive prend la première place libre.** Il la garde tant qu'il reste dans la pièce, pour ne pas sauter d'une place à l'autre à chaque événement.
- **Une pièce pleine** déborde sur des places debout le long des murs. Si elles sont pleines aussi, un léger décalage aléatoire évite les superpositions.
- **Le nombre de places suit la taille de la pièce** : plus dans l'Atelier ou la Bibliothèque, moins dans le Pigeonnier.
- **Les postes attitrés** (le chevalet de Barbapapa, la lunette d'Oracle…) ont leurs propres places. Les doublons, par exemple trois Hermione, occupent les places voisines du même poste.

## La taverne et le cycle de vie d'un agent

La taverne montre l'équipe disponible, même quand rien ne tourne. La liste latérale « Compagnie de la taverne » en donne le même accès au clavier.

1. **Au repos.** Elle contient **un seul exemplaire de chaque type** d'agent connu du donjon affiché : une Hermione, un Dexter, un Turing… Ils ont une couleur neutre, puisqu'ils ne travaillent pour aucune session. Un clic sur un exemplaire au repos ouvre sa présentation, sans conversation : voir [La présentation d'un sous-agent](utilisation.md#la-présentation-dun-sous-agent).
2. **Appel.** Quand une session lance un sous-agent de ce type, l'exemplaire de la taverne se lève, prend la couleur de la session et va à son poste.
3. **Appels simultanés.** Si deux ou trois Hermione sont lancées en même temps (même session ou sessions différentes), les exemplaires manquants sortent des casiers et partent chacun vers une place libre de la Salle des épreuves.
4. **Fin de tâche.** Le sous-agent qui a fini reprend la couleur neutre et retourne à la taverne. Il disparaît en arrivant. Le type reprend alors une seule figure au repos, sur la place occupée par le dernier agent revenu. Quand une session se termine, ses sous-agents retournent aussi à la taverne.
5. **Chargement de la page.** Les agents déjà au travail apparaissent directement à leur poste. Personne ne sort des casiers.

**L'agent principal fait exception.** Il représente la session elle-même. Quand elle attend ton prochain prompt, il se repose à la taverne, dans la couleur de sa session, avec un losange ambre au-dessus de son étiquette. Il ne fait la queue à l'autel que pour une permission, une question ou une erreur. Il entre au château et en sort par le pont-levis : voir [personnages.md](personnages.md#entrée-et-sortie-du-chevalier).

Une session arrêtée qui n'a jamais travaillé n'a pas de chevalier à la taverne. Elle est représentée par un fantôme qui erre dans les couloirs : voir [Le fantôme](personnages.md#le-fantôme).

### Liste des types au repos

Elle regroupe :

- les agents définis dans `~/.claude/agents/` et dans le `.claude/agents/` des dossiers du donjon affiché. Un fichier ne compte que si son en-tête contient un champ `name:`, comme dans Claude Code ;
- les types vus au travail dans ce donjon. Les agents intégrés (Explore, general-purpose…) y entrent à leur premier appel, et y restent jusqu'au redémarrage du serveur.

Les dossiers sont relus au plus une fois par minute.

## Voir aussi

- [Fonctionnement](fonctionnement.md) : d'où viennent les informations sur les agents.
- [Utilisation](utilisation.md) : le tableau outil → pièce, et l'usage des postes.
