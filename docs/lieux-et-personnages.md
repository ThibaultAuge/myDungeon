# Agent Office : lieux et personnages

*Rédigé le 2026-11-13. Document de conception pour la scène 3D décrite dans
`plans/plan-agent-office-2026-11-13.md`.*

Ce document liste les pièces du bureau, les postes de travail qu'elles contiennent et les
personnages qui y travaillent. Il sert de référence pour la modélisation (formes simples
en phase 1, modèles animés en phase 3).

## Principes de représentation

- **La silhouette dit qui c'est.** Chaque type d'agent est une *classe* de personnage
  reconnaissable à sa tenue et à son accessoire. Deux Hermione ont toujours la même
  silhouette.
- **La couleur dit pour qui il travaille.** Tous les agents d'une même session portent la
  couleur de cette session (le principe existe déjà dans le plan : les sous-agents sont
  des « collègues de la même couleur »). Deux Hermione de deux sessions différentes se
  distinguent donc par leur couleur.
- **Un même personnage peut apparaître plusieurs fois, y compris dans une seule session.**
  La session principale peut lancer plusieurs sous-agents du même type en parallèle, par
  exemple trois Explore ou deux Oracle sur des sujets différents. Dans ce cas, même
  couleur et même silhouette : on ajoute un petit badge numéroté (1, 2, 3) au-dessus de la
  tête, ou une légère variation de teinte. Voir le cycle de vie dans la salle de repos
  plus bas.
- **Le poste suit le rôle, pas l'outil, pour les agents spécialisés.** Aujourd'hui le
  personnage change de pièce selon l'outil utilisé (`Read` → bibliothèque, `Bash` → salle
  serveur). Ça ne marche pas pour les agents spécialisés : Hermione ne fait que lire, elle
  irait donc à la bibliothèque au lieu de la salle de revue, et Turing ou Hancock iraient
  en salle serveur dès qu'ils lancent une commande. Règle proposée :
  - un **agent spécialisé** reste à son poste attitré ; l'outil en cours ne change que son
    animation (il feuillette, il tape, il calcule) ;
  - l'**agent principal** et les **agents génériques** (Explore, general-purpose…) se
    déplacent selon l'outil, comme aujourd'hui.
- **Clichés, pas copies.** Plusieurs noms viennent d'œuvres protégées (Barbapapa,
  Hermione, Neo, Dexter, Gatsby, Dora, Bob le bricoleur…). On s'inspire du *métier* que
  le nom évoque, jamais du look du personnage d'origine : pas de blob rose pour
  Barbapapa, pas de baguette ni de robe de sorcier pour Hermione, pas de manteau noir
  façon film pour Neo. C'est aussi ce qui permettra d'utiliser des modèles CC0 en phase 3.

## Les lieux

Le bureau actuel a quatre pièces (Accueil, Atelier, Bibliothèque, Salle serveur). La
liste ci-dessous les garde et ajoute les postes nécessaires aux agents spécialisés. On
peut regrouper plusieurs postes dans une même pièce pour garder une scène lisible.

| Pièce | Postes | Activité | Qui y travaille |
|---|---|---|---|
| **Accueil** | Comptoir avec sonnette, bancs | Attendre une réponse humaine (bulle ambre), arrivée des nouveaux agents | Tout agent en attente |
| **Salle de planification** | Grande table, tableau blanc, plans affichés | Explorer le besoin, concevoir, écrire le plan | Agent principal en mode exploration, agent Plan |
| **Atelier (open space dev)** | Postes de code | Écrire et modifier le code | Agent principal en mode réalisation, general-purpose, fork |
| | Paillasse de labo | Écrire les tests | Dexter |
| | Chevalet et table à dessin | Découper des maquettes en templates HTML/CSS | Barbapapa |
| **Bibliothèque (archives du code)** | Rayonnages, tables de lecture | Lire et chercher dans le code local | Explore, agent principal quand il lit |
| **Salle Internet / observatoire** | Longue-vue, écrans du monde | Recherche web, documentation officielle | Oracle |
| **Standard télécom** | Pupitre radio, clé morse, câbles | Tester des API externes | Samuel Morse |
| **Salle des machines (serveur)** | Baies, terminal | Lancer des commandes, compiler, exécuter les tests, git | Agent principal et agents génériques quand ils utilisent `Bash` |
| **Bureau de calcul** | Tableau noir, calculateur mécanique | Calculs et statistiques | Turing |
| **Salle de revue** | Grande table de relecture | Revue de code, SEO, accessibilité | Hermione, Gatsby, Timmy |
| | PC sécurité attenant (écrans de surveillance, porte blindée) | Audit sécurité | Neo |
| **Salle de rédaction** | Deux bureaux côte à côte | Documentation | Curator (pour les IA), Otis (pour les humains) |
| **Coin détente / brainstorming** | Canapé, baby-foot, mur de post-it | Idées décalées | Butt Stallion |
| **Local d'entretien** | Placard, chariot | Base de Hancock, qui fait des tournées dans l'atelier | Hancock |
| **Salle de repos** | Canapés, machine à café, casiers | Agents disponibles, sans tâche | Un exemplaire de chaque type d'agent |

### La salle de repos et le cycle de vie d'un agent

La salle de repos remplace la « pause café » du plan initial. Elle montre l'équipe
disponible même quand rien ne tourne.

1. **Au repos.** Elle contient **un seul exemplaire de chaque type** d'agent spécialisé :
   une Hermione, un Dexter, un Turing… Ils ont une couleur neutre, puisqu'ils ne
   travaillent pour aucune session.
2. **Appel.** Quand une session lance une Hermione, celle du repos se lève, prend la
   couleur de la session et va à son poste.
3. **Appels simultanés.** Si deux ou trois Hermione sont lancées en même temps (même
   session ou sessions différentes), les exemplaires manquants sont créés : ils sortent
   des casiers et partent chacun vers un poste libre de la salle de revue.
4. **Fin de tâche.** Chaque Hermione qui a fini revient à la salle de repos et reprend la
   couleur neutre. Les exemplaires en trop disparaissent en arrivant (retour au casier) :
   on redescend toujours à une seule Hermione au repos.

À décider : quels types sont présents au repos. Proposition : les agents globaux de
`~/.claude/agents/`, plus ceux du `.claude/agents/` de l'environnement affiché. Les
agents intégrés (Explore, general-purpose…) n'y apparaissent qu'à leur premier appel,
sinon la salle serait encombrée. L'agent principal n'y va jamais : il représente la
session elle-même et reste à l'accueil quand elle est au repos.

## Les personnages

### L'agent principal : Claude

C'est le personnage central de chaque session, celui qui dialogue avec l'humain et
coordonne les autres. Il a deux tenues selon la phase de travail :

| Mode | Ancien nom (OpenCode) | Cliché | Où |
|---|---|---|---|
| **Exploration et planification** | Dora l'exploratrice | Exploratrice : sac à dos, carte dépliée, jumelles | Salle de planification, bibliothèque |
| **Réalisation et coordination** | Bob le bricoleur | Chef de chantier : casque, gilet, ceinture à outils, plan roulé sous le bras | Atelier, salle des machines |

À vérifier : les événements de hook portent un champ `permission_mode` (`plan` en mode
plan). Il devrait suffire pour choisir la tenue, mais ce n'est pas encore testé.

### Les sous-agents spécialisés

Ce sont les agents définis dans `~/.claude/agents/`. Le hook `SubagentStart` donne leur
type dans `agent_type`, ce qui permet de choisir la silhouette.

| Agent | Rôle | Cliché visuel | Accessoire | Poste |
|---|---|---|---|---|
| **barbapapa** | Découpe des maquettes en templates HTML/CSS | Artiste peintre : béret, blouse tachée de couleurs | Palette et pinceau | Atelier, chevalet |
| **butt-stallion** | Idées loufoques, brainstorming | Comique / inventeur farfelu : casquette à hélice, nœud papillon | Ampoule qui s'allume au-dessus de la tête | Coin détente |
| **samuel-morse** | Teste les API externes | Télégraphiste : visière, casque audio | Clé morse, ondes qui partent | Standard télécom |
| **neo** | Audit sécurité | Agent de sécurité : lunettes noires, oreillette, badge | Lampe torche ou cadenas | PC sécurité |
| **oracle** | Recherche sur Internet | Voyante-documentaliste : châle, foulard | Boule de cristal qui affiche des pages web | Salle Internet |
| **dexter** | Écrit les tests | Scientifique : blouse blanche, lunettes de protection | Éprouvettes, coche verte ou croix rouge | Atelier, paillasse |
| **hermione** | Revue de code | Relectrice studieuse : lunettes, pile de livres | Stylo rouge | Salle de revue |
| **gatsby** | Audit SEO (référencement) | Dandy années 20 : costume, canotier | Projecteur ou mégaphone (« être vu ») | Salle de revue |
| **timmy** | Audit accessibilité | Inspecteur : gilet fluo, casque audio (lecteur d'écran) | Loupe | Salle de revue |
| **hancock** | Nettoyage du code mort | Agent d'entretien : combinaison, casquette | Balai et chariot | Local d'entretien, tournées dans l'atelier |
| **curator** | Documentation pour les IA | Conservateur de musée : gants blancs, gilet | Fiches et classeur | Salle de rédaction |
| **otis** | Documentation pour les humains | Écrivain public / journaliste : chapeau, bretelles | Machine à écrire | Salle de rédaction |
| **turing** | Calculs (exécute du Python) | Mathématicien : pull, craie à la main | Tableau noir couvert d'équations | Bureau de calcul |

### Les agents intégrés à Claude Code

Ils n'ont pas de fichier dans `~/.claude/agents/` mais apparaissent souvent, Explore en
particulier.

| Agent | Rôle | Cliché visuel | Comportement |
|---|---|---|---|
| **Explore** | Fouille le code local | Éclaireur : lampe frontale, carnet de notes | Se déplace selon l'outil, surtout bibliothèque |
| **Plan** | Conçoit un plan d'implémentation | Architecte : plans roulés, crayon sur l'oreille | Salle de planification |
| **general-purpose** | Tâches variées | Intérimaire polyvalent : salopette, caisse à outils | Se déplace selon l'outil |
| **fork** | Copie de l'agent principal | Même tenue que l'agent principal, un peu translucide | Se déplace selon l'outil |
| **claude-code-guide** | Répond aux questions sur Claude Code | Agent d'information : panneau « ? » | Accueil |
| **Type inconnu** | Agent d'un autre projet, d'un plugin, ou ajouté plus tard | Silhouette neutre avec une étiquette au nom du type | Se déplace selon l'outil |

Le type inconnu est indispensable : chaque environnement peut avoir ses propres agents
dans son `.claude/agents/`, et les plugins en ajoutent.

## Points ouverts

- **Représenter l'humain ?** L'utilisateur pourrait apparaître comme un visiteur à
  l'accueil, ou rester hors scène (la bulle ambre suffit).
- **Sessions lancées par une autre session** (`spawnedFrom`). Chacune a son propre agent
  principal et sa propre couleur ; le fil vers la session parente reste à dessiner.
- **Skills** (`jira-comment`, `knowledge`…). Ils s'exécutent dans la session principale et
  ne sont pas des personnages. On pourrait les montrer comme un objet que l'agent
  principal tient en main.
- **Nombre de pièces.** La liste passe de 4 à une douzaine de lieux. Il faudra vérifier
  la lisibilité et les 60 images/s, quitte à regrouper des postes dans une même pièce.
