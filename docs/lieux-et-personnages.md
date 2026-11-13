# Agent Office : lieux et personnages

*Rédigé le 2026-11-13. Document de conception pour la scène 3D décrite dans
`plans/plan-agent-office-2026-11-13.md`.*

Ce document liste les pièces du bureau, les postes de travail qu'elles contiennent et les
personnages qui y travaillent. Il sert de référence pour la modélisation (formes simples
en phase 1, modèles animés en phase 3).

## Ambiance

Un **donjon de fantasy coloré et joyeux**, pas sombre : proportions trapues, couleurs
franches, esprit « jouet ». Les familles d'assets CC0 qui collent à ce style sont KayKit
(https://kaylousberg.itch.io/) et Quaternius (https://quaternius.com/). On n'en
choisira qu'une, pour garder un style cohérent. La licence se vérifie pack par pack :
par exemple, *Characters – Fantasy Races* de Quaternius n'est pas en CC0.

## Principes de représentation

- **La silhouette dit qui c'est.** Chaque type d'agent est une *classe* de personnage
  reconnaissable à sa tenue et à son accessoire. Deux Hermione ont toujours la même
  silhouette.
- **La couleur dit pour qui il travaille.** Tous les agents d'une même session portent la
  couleur de cette session, sur la cape ou le tabard par exemple. Deux Hermione de deux
  sessions différentes se distinguent donc par leur couleur.
- **Un même personnage peut apparaître plusieurs fois, y compris dans une seule session.**
  La session principale peut lancer plusieurs sous-agents du même type en parallèle, par
  exemple trois Explore ou deux Oracle sur des sujets différents. Dans ce cas, même
  couleur et même silhouette : on ajoute un petit badge numéroté (1, 2, 3) au-dessus de la
  tête, ou une légère variation de teinte. Voir le cycle de vie dans la taverne, plus bas.
- **Le poste suit le rôle, pas l'outil, pour les agents spécialisés.** Aujourd'hui le
  personnage change de pièce selon l'outil utilisé (`Read` → bibliothèque, `Bash` → salle
  des machines). Ça ne marche pas pour les agents spécialisés : Hermione ne fait que lire,
  elle irait donc à la bibliothèque au lieu de la salle des épreuves, et Turing ou Hancock
  iraient en salle des machines dès qu'ils lancent une commande. Règle proposée :
  - un **agent spécialisé** reste à son poste attitré ; l'outil en cours ne change que son
    animation (il feuillette, il écrit, il calcule) ;
  - l'**agent principal** et les **agents génériques** (Explore, general-purpose…) se
    déplacent selon l'outil, comme aujourd'hui.
- **Clichés, pas copies.** Plusieurs noms viennent d'œuvres protégées (Barbapapa,
  Hermione, Neo, Dexter, Gatsby, Dora, Bob le bricoleur…), et le style s'inspire du
  genre « Warcraft » sans en reprendre les modèles. On s'inspire du *métier* que le nom
  évoque, jamais du look du personnage d'origine : pas de blob rose pour Barbapapa, pas
  de baguette ni de robe de sorcier pour Hermione. C'est aussi ce qui permet d'utiliser
  des modèles CC0.

## Les lieux

### Agencement

Plan de référence, dessiné par l'utilisateur. Les espaces entre les blocs sont des
couloirs : les agents circulent par là pour aller d'une pièce à l'autre.

```
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
└─────────────┴─────────────────┴────────────┘ └──────────────┘ └─────────┘
```

- **L'Autel** est au centre de la composition, sous l'Atelier. La file d'attente déborde
  dans le couloir qui l'entoure.
- **Les grandes pièces** sont celles qui accueillent le plus d'agents en même temps :
  l'Atelier, la Salle des cartes, la Bibliothèque et la Taverne, qui doit loger un
  exemplaire de chaque type.
- **Les contrôles** forment une bande continue en bas à gauche : sécurité, revue et
  tests, puis accessibilité et SEO.
- **Le Scriptorium** (rédaction de documentation) est un coin de la Bibliothèque, avec
  des pupitres de copistes.

### Liste des lieux

| Lieu | Ancien nom | Postes | Activité | Qui y travaille |
|---|---|---|---|---|
| **Autel des requêtes** (centre) | Accueil | Pupitre-autel, allée pour la file d'attente | Implorer l'humain : permission, question, prompt suivant | Tout agent en attente |
| **Salle des cartes** | Salle de planification | Grande table couverte de cartes, globe | Explorer le besoin, concevoir, écrire le plan | Agent principal en exploration, Plan |
| **Atelier** | Atelier | Établis, outils, coin de l'enlumineur avec chevalet | Écrire et modifier le code, découper des maquettes | Agent principal en réalisation, general-purpose, fork, Barbapapa |
| **Bibliothèque** | Bibliothèque | Rayonnages de grimoires, tables de lecture | Lire et chercher dans le code local | Explore, agent principal quand il lit |
| **Observatoire** | Salle Internet | Grande lunette, cartes du ciel | Recherche web, documentation officielle | Oracle |
| **Pigeonnier** | Standard télécom | Volière, pupitre à messages | Tester des API externes : un pigeon part, un pigeon revient | Samuel Morse |
| **Salle des machines** | Salle serveur | Machines à vapeur, engrenages, chaudière | Lancer des commandes, compiler, exécuter les tests, git | Agent principal et agents génériques quand ils utilisent `Bash` |
| **Cabinet de l'arithméticien** | Bureau de calcul | Boulier géant, abaque, tableau d'ardoise | Calculs et statistiques | Turing |
| **Poste de garde** | PC sécurité | Herse, râtelier d'armes, lanternes | Audit sécurité | Neo |
| **Salle des épreuves** | Salle de revue | Table de relecture, laboratoire d'alchimie | Revue de code, tests | Hermione, Dexter |
| **Salle Accessibilité / SEO** | Salle de revue | Estrade du héraut, pupitre d'inspection | Audits SEO et accessibilité | Gatsby, Timmy |
| **Coin détente** | Coin brainstorming | Banquettes, jeu de dés, mur d'affiches | Idées décalées | Butt Stallion |
| **Scriptorium** (dans la Bibliothèque) | Salle de rédaction | Pupitres de copistes | Documentation | Curator (pour les IA), Otis (pour les humains) |
| **Réduit du concierge** | Local d'entretien | Balais, seaux, chariot | Base de Hancock, qui fait des tournées dans l'Atelier | Hancock |
| **Taverne** | Salle de repos | Grandes tables, cheminée, tonneaux, casiers | Agents disponibles, sans tâche | Un exemplaire de chaque type d'agent |

### L'autel et la file d'attente

Les agents qui attendent l'humain viennent devant l'autel. Plutôt que de s'agglutiner,
ils **se mettent en file**, les uns derrière les autres dans l'allée :

- le **premier** de la file est à genoux devant l'autel, avec la bulle ambre de sa
  demande ;
- les **suivants** attendent debout derrière lui, par ordre d'arrivée (le plus ancien en
  tête) ;
- quand l'humain répond au premier, il repart vers son poste et toute la file **avance
  d'une place**.

La file est visuelle : elle ne change rien côté Claude Code. L'humain peut toujours
répondre dans l'app desktop dans l'ordre qu'il veut, et l'agent concerné sort alors de la
file, où qu'il soit. Elle aide seulement à voir quelle demande attend depuis le plus
longtemps. En phase 4, quand on pourra répondre depuis la 3D, l'autel deviendra le
guichet naturel : on traite la demande du premier de la file.

Si la file dépasse la longueur de l'allée, elle tourne autour de la nef.

### Plusieurs places par pièce

Deux agents ne se tiennent jamais au même endroit.

- **Chaque pièce a une liste de places** : une position et une orientation (face à
  l'établi, au rayonnage, à la machine). Le code actuel fonctionne déjà comme ça, avec 8
  places par pièce dans `packages/web/src/scene/layout.ts`.
- **Un agent qui arrive prend la première place libre.** Il la garde tant qu'il reste dans
  la pièce, pour ne pas sauter d'une place à l'autre à chaque événement.
- **Une pièce pleine** déborde sur des places debout le long des murs. Si elles sont
  pleines aussi, on garde un léger décalage aléatoire pour éviter les superpositions.
- **Le nombre de places** suit la taille de la pièce : plus dans l'Atelier ou la
  Bibliothèque, moins dans le Pigeonnier.
- **Les postes attitrés** (le chevalet de Barbapapa, la lunette d'Oracle…) ont leurs
  propres places. Les doublons, par exemple trois Hermione, occupent les places voisines
  du même poste.

### La taverne et le cycle de vie d'un agent

La taverne remplace la « pause café » du plan initial. Elle montre l'équipe disponible
même quand rien ne tourne.

1. **Au repos.** Elle contient **un seul exemplaire de chaque type** d'agent spécialisé :
   une Hermione, un Dexter, un Turing… Ils ont une couleur neutre, puisqu'ils ne
   travaillent pour aucune session.
2. **Appel.** Quand une session lance une Hermione, celle de la taverne se lève, prend la
   couleur de la session et va à son poste.
3. **Appels simultanés.** Si deux ou trois Hermione sont lancées en même temps (même
   session ou sessions différentes), les exemplaires manquants sont créés : ils sortent
   des casiers et partent chacun vers une place libre de la Salle des épreuves.
4. **Fin de tâche.** Chaque Hermione qui a fini revient à la taverne et reprend la
   couleur neutre. Les exemplaires en trop disparaissent en arrivant (retour au casier) :
   on redescend toujours à une seule Hermione au repos.

À décider : quels types sont présents au repos. Proposition : les agents globaux de
`~/.claude/agents/`, plus ceux du `.claude/agents/` de l'environnement affiché. Les
agents intégrés (Explore, general-purpose…) n'y apparaissent qu'à leur premier appel,
sinon la taverne serait encombrée. L'agent principal n'y va jamais : il représente la
session elle-même. Quand elle attend ton prochain prompt, il fait la queue à l'autel.

## Les personnages

### L'agent principal : Claude

C'est le personnage central de chaque session, celui qui dialogue avec l'humain et
coordonne les autres. Il a deux tenues selon la phase de travail :

| Mode | Ancien nom (OpenCode) | Cliché | Où |
|---|---|---|---|
| **Exploration et planification** | Dora l'exploratrice | Éclaireuse cartographe : sac à dos, carte dépliée, longue-vue | Salle des cartes, Bibliothèque |
| **Réalisation et coordination** | Bob le bricoleur | Maître d'œuvre de chantier : tablier de cuir, marteau, plan roulé sous le bras | Atelier, Salle des machines |

À vérifier : les événements de hook portent un champ `permission_mode` (`plan` en mode
plan). Il devrait suffire pour choisir la tenue, mais ce n'est pas encore testé.

### Les sous-agents spécialisés

Ce sont les agents définis dans `~/.claude/agents/`. Le hook `SubagentStart` donne leur
type dans `agent_type`, ce qui permet de choisir la silhouette.

| Agent | Rôle | Cliché visuel | Accessoire | Poste |
|---|---|---|---|---|
| **barbapapa** | Découpe des maquettes en templates HTML/CSS | Enlumineur : béret, blouse tachée de couleurs | Palette et pinceau | Atelier, coin de l'enlumineur |
| **butt-stallion** | Idées loufoques, brainstorming | Bouffon : chapeau à grelots, habit bariolé | Marotte, ampoule magique qui s'allume au-dessus de la tête | Coin détente |
| **samuel-morse** | Teste les API externes | Colombophile messager : sacoche, gants de cuir | Pigeon sur l'épaule, rouleaux de messages | Pigeonnier |
| **neo** | Audit sécurité | Garde de la herse : armure légère, capuche | Lanterne, trousseau de clés | Poste de garde |
| **oracle** | Recherche sur Internet | Astrologue voyante : robe étoilée, châle | Boule de cristal qui affiche des pages, lunette | Observatoire |
| **dexter** | Écrit les tests | Alchimiste : tablier brûlé, lunettes de protection | Fioles qui fument en vert (réussi) ou en rouge (échec) | Salle des épreuves, laboratoire |
| **hermione** | Revue de code | Érudite relectrice : lunettes, pile de grimoires | Plume rouge | Salle des épreuves, table de relecture |
| **gatsby** | Audit SEO (référencement) | Héraut : tabard, chapeau à plume | Trompette et bannière (« faire connaître ») | Salle Accessibilité / SEO, estrade |
| **timmy** | Audit accessibilité | Inspecteur : manteau, besace | Loupe, cornet acoustique (lecteur d'écran) | Salle Accessibilité / SEO |
| **hancock** | Nettoyage du code mort | Concierge : tablier, foulard | Balai et seau | Réduit du concierge, tournées dans l'Atelier |
| **curator** | Documentation pour les IA | Archiviste : robe de moine, gants | Registres et trousseau de clés des archives | Scriptorium |
| **otis** | Documentation pour les humains | Scribe copiste : bonnet, manches retroussées | Plume d'oie et parchemin | Scriptorium |
| **turing** | Calculs (exécute du Python) | Arithméticien : toque, craie à la main | Boulier géant, ardoise couverte de chiffres | Cabinet de l'arithméticien |

### Les agents intégrés à Claude Code

Ils n'ont pas de fichier dans `~/.claude/agents/` mais apparaissent souvent, Explore en
particulier.

| Agent | Rôle | Cliché visuel | Comportement |
|---|---|---|---|
| **Explore** | Fouille le code local | Éclaireur : lanterne, carnet de notes | Se déplace selon l'outil, surtout Bibliothèque |
| **Plan** | Conçoit un plan d'implémentation | Cartographe : compas, cartes roulées | Salle des cartes |
| **general-purpose** | Tâches variées | Apprenti compagnon : besace d'outils | Se déplace selon l'outil |
| **fork** | Copie de l'agent principal | Même tenue que l'agent principal, un peu fantomatique | Se déplace selon l'outil |
| **claude-code-guide** | Répond aux questions sur Claude Code | Sacristain : lanterne, livre de règles | À côté de l'autel |
| **Type inconnu** | Agent d'un autre projet, d'un plugin, ou ajouté plus tard | Villageois neutre avec une étiquette au nom du type | Se déplace selon l'outil |

Le type inconnu est indispensable : chaque environnement peut avoir ses propres agents
dans son `.claude/agents/`, et les plugins en ajoutent.

## Décisions

- **L'humain n'est pas représenté.** La bulle et la file à l'autel suffisent.
- **Sessions lancées par une autre session** (`spawnedFrom`). Chacune est un agent
  principal à part entière, avec sa propre couleur. En général elle travaille dans son
  propre worktree et ne dépend pas de la session qui l'a lancée. Le lien est donc
  secondaire : une mention « lancée depuis… » dans le panneau de détail suffit, un repère
  visuel dans la 3D est facultatif.
- **Skills** (`jira-comment`, `knowledge`…). Ce ne sont pas des personnages. Quand un
  agent utilise un skill, il porte un **badge** à son nom : un petit insigne en 3D sur le
  personnage, ou au minimum un badge dans le panneau de détail HTML. Le hook
  `PreToolUse` de l'outil `Skill` donne le nom du skill (à vérifier).
- **Le Scriptorium** est un coin de la Bibliothèque.
- **Nombre de pièces.** On part sur 14 lieux. La lisibilité et les 60 images/s seront
  vérifiées à l'usage.

## État de l'implémentation

*Mis à jour le 2026-11-13.*

Fait :

- le plan du donjon, ses 14 lieux et ses couloirs (`packages/web/src/scene/layout.ts`, rendu dans
  `Room.tsx`) ;
- les déplacements par les portes et les couloirs, y compris quand un agent change de destination en
  chemin ;
- le tableau outil → pièce et les postes attitrés des agents spécialisés
  (`packages/server/src/reducer.ts`) ;
- les places par pièce, les postes attitrés, le débordement le long des murs ;
- la file d'attente à l'autel ;
- la taverne comme point d'apparition et de retour des sous-agents.

Reste à faire :

- le cycle de vie complet de la taverne (un exemplaire neutre de chaque type au repos) ;
- les silhouettes par type d'agent ;
- la tenue de l'agent principal selon le mode plan (`permission_mode`, toujours à vérifier) ;
- les badges de skills.
