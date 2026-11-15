# Utilisation

Ce document décrit ce que tu vois à l'écran et ce que tu peux faire. Pour l'installation, voir le [README](../README.md).

## Le donjon en un coup d'œil

La scène montre un donjon de 14 lieux, reliés par des couloirs. Chaque agent est un personnage. Les personnages passent par les portes et les couloirs, jamais à travers un mur. Le plan des lieux est dans [lieux.md](lieux.md).

Chaque donjon se reconnaît à son panneau de bois, juste après le pont-levis : son nom y est peint, et deux fanions de sa couleur encadrent le pont-levis. Les sessions hors environnement forment un groupe gris. Le détail est dans [Le panneau du donjon](lieux.md#le-panneau-du-donjon).

## Choisir un donjon

La page d'accueil, « Choisis ton donjon », affiche une carte par environnement de l'app Claude. Chaque carte donne son nom, le nombre de sessions en cours (ou « Au calme ») et le premier dossier de l'environnement. Un clic ouvre le donjon. Une fois dans un donjon, le sélecteur « Donjon », en haut de la page, passe à un autre donjon.

## Où va chaque agent

### Agent principal et sous-agents génériques

L'agent principal et les sous-agents génériques (Explore, general-purpose…) vont dans la pièce de l'outil qu'ils utilisent :

| Outils | Pièce |
|---|---|
| `Read`, `Grep`, `Glob`, `LS` | Bibliothèque |
| `WebFetch`, `WebSearch` | Observatoire |
| `Edit`, `Write`, `MultiEdit`, `NotebookEdit` | Atelier |
| `Bash`, `PowerShell`, `BashOutput`, `KillShell`, `Monitor` | Salle des machines |
| `EnterPlanMode`, `ExitPlanMode`, `TodoWrite`, et chaque nouveau prompt | Salle des cartes |

Le sous-agent `Plan` va en Salle des cartes. Le sous-agent `claude-code-guide` se tient à côté de l'autel.

### Sous-agents spécialisés

Les sous-agents spécialisés restent à leur poste, quel que soit l'outil qu'ils utilisent. L'outil en cours ne change que leur animation. Par exemple, Hermione et Dexter restent en Salle des épreuves, Oracle à l'observatoire, Turing au cabinet de l'arithméticien, Curator et Otis au Scriptorium. La liste complète est dans [personnages.md](personnages.md).

Hancock fait exception : il quitte son réduit pour l'Atelier quand il modifie du code.

### L'autel des requêtes

L'autel est au centre de la scène. Tout agent qui a besoin de toi y fait la queue : permission, question ou erreur.

- Le premier de la file est à genoux devant l'autel, avec sa bulle de requête.
- Les suivants attendent debout derrière lui, le plus ancien en tête.
- Quand tu réponds au premier, il repart vers son poste et la file avance d'une place.
- Si la file s'allonge, elle contourne la nef par les couloirs.
- Plus un agent attend, plus il se lasse : il fait les cent pas, s'assoit, s'endort, puis se couvre de toiles d'araignée. Le détail est dans [L'attente interminable](lieux.md#lattente-interminable).

Un agent qui attend seulement ton prochain message ne fait pas la queue. Il reste à la taverne.

### La taverne

La taverne montre l'équipe disponible, même quand rien ne tourne. Elle contient un exemplaire de chaque type d'agent connu. Quand une session lance un sous-agent, son exemplaire quitte la taverne et prend la couleur de la session. Quand le sous-agent a fini, il retourne à la taverne et disparaît. L'agent principal attend ton prochain message à la taverne, dans la couleur de sa session. Une session arrêtée, mais reprenable, y garde son chevalier endormi : il ne se sélectionne pas en 3D. Une session arrêtée qui n'a jamais travaillé n'a pas de chevalier : elle apparaît en fantôme, qui erre dans les couloirs (voir [personnages.md](personnages.md#le-fantôme)).

Le détail du fonctionnement est dans [lieux.md](lieux.md#la-taverne-et-le-cycle-de-vie-dun-agent).

## Les murs qui s'effacent

Déplace la souris pour découvrir les salles. Les murs situés devant le curseur s'enfoncent dans le sol, et il ne reste qu'un muret qui marque le contour des pièces. Les murs situés derrière restent debout.

Les quatre tours d'angle, bâties dans la pierre des murs, s'enfoncent avec eux. Voir [Les tours d'angle](lieux.md#les-tours-dangle).

## Les postes de travail

Le mobilier de chaque pièce forme des postes de travail.

- **Survol.** Les meubles du poste s'éclairent légèrement, et le curseur devient une main.
- **Clic.** Une carte s'ouvre en haut à droite de la 3D, dans le même style que la fiche d'agent et la boîte de dialogue.
  - Sa plaque porte le pictogramme du poste, celui qui s'affiche au-dessus d'un agent qui s'y rend, et son titre.
  - Dessous, on lit le nom de la pièce, la fonction du poste en quelques mots et les agents qui y travaillent.
  - À l'observatoire et au Scriptorium, la carte affiche le pictogramme de la pièce. Le télescope et les pupitres du Scriptorium ont chacun le leur.
  - Le poste dont la carte est ouverte reste éclairé.
- **Fermer.** Ferme la carte avec ×, avec Échap, ou en cliquant dans le vide. Un clic après un glissement de caméra ne fait rien.

Les pièces à plusieurs fonctions ont un poste par fonction :

- la Bibliothèque (rayonnages et tables) et son Scriptorium (pupitres des copistes) ;
- l'Atelier (établis) et le chevalet de l'enlumineur ;
- la Salle des épreuves (table de relecture et laboratoire d'alchimie) ;
- la Salle Accessibilité / SEO (estrade du héraut et pupitre d'inspection).

Chaque pièce a aussi son identité : ses variantes de murs, des objets accrochés (cadres, boucliers, chaînes, clés), une lumière d'ambiance à sa couleur et son propre décor, sur un ton médiéval avec quelques clins d'œil modernes. Le détail par pièce est dans [Lieux](lieux.md#décor-propre-à-chaque-pièce).

Le décor (caisses, tonneaux, coffres, pièces, bougies, tapis, et le décor propre à chaque pièce) ne réagit pas au survol. Si un agent se tient devant un meuble, le plus proche sous le pointeur l'emporte : l'agent ou le poste.

## La forêt de nuit

Des arbres en 3D entourent le donjon : détaillés près du château, plus simples au loin, puis une lisière peinte à l'horizon. Des douves longent le sud. Un pont-levis baissé mène à la porte du château, et un chemin de terre se perd dans la forêt.

La forêt est sombre pour que le château, aux lumières chaudes, ressorte. La vue reste limitée autour du château.

## Les trois états

Chaque agent a un état. Il se lit à la couleur de l'étiquette, à la forme de l'icône et, pour l'état « attend ta réponse », à la bulle de requête.

| État | Couleur | Icône | Ce qu'on voit à l'écran |
|---|---|---|---|
| Il travaille | Vert | Marteau | Il marche ou travaille à son poste. |
| Il attend ton prochain message | Ambre | Sablier | Un petit losange ambre s'affiche au-dessus de son étiquette. |
| Il a besoin de toi | Rouge | Bulle rouge « … » | Une bulle de requête rouge s'affiche (voir plus bas). |
| Il a terminé | Gris | « Zzz » | Il reste immobile, en pose calme. |

Les icônes de la liste latérale et de la fiche d'agent portent l'état sans couleur, grâce à leur forme. Dans la 3D, le losange ambre et la bulle rouge gardent leur rôle.

## La bulle de requête

Un agent qui a besoin de toi porte au-dessus de son étiquette une bulle de BD rouge :

- « … » pour une permission ;
- « ? » pour une question ;
- « ! » pour une erreur.

Il se place alors à l'[autel des requêtes](lieux.md#lautel-et-la-file-dattente).

## Le pictogramme de destination

Pendant qu'un agent marche vers un lieu, un pictogramme de sa destination (pièce ou poste) s'affiche au-dessus de son étiquette, à la place de la bulle de requête.

## Les sous-agents

Un sous-agent apparaît comme un collègue de la même couleur que sa session. Il surgit du sol à son arrivée. Quand il a fini, il retourne à la taverne et disparaît.

## La présentation d'un sous-agent

Un clic sur un exemplaire au repos, à la taverne, ouvre sa présentation. La carte s'affiche en haut à droite de la scène, dans le même cadre que la carte d'un poste. Elle donne :

- le nom du type, par exemple « Oracle » ou « Samuel-Morse » ;
- la mention « Sous-agent » ;
- son rôle en quelques mots, par exemple « Cherche la documentation et les sources sur le web. » pour Oracle.

Un type sans présentation connue, comme un agent propre à un autre projet ou à un plugin, reçoit une ligne générique.

- **Baffer.** Le bouton « Baffer » apparaît tant que l'exemplaire est à la taverne. Il fait la même chose que le clic droit.
- **Fermer.** Ferme la présentation avec ×, ou avec Échap.
- **Au travail.** Un sous-agent qui travaille ne s'ouvre pas par cette carte. Son clic ouvre sa fiche et sa conversation.

## Les personnages animés

Les personnages viennent du pack KayKit Adventurers 2.0 :

- un chevalier pour l'agent principal ;
- pour chaque type de sous-agent, une tenue de son rôle (barbare, mage, rôdeur, voleur, voleur encapuchonné), avec un objet en main.

Tous les agents d'un même type se ressemblent, y compris au repos à la taverne. La liste complète est dans [personnages.md](personnages.md).

- **Déplacement.** Ils marchent ou courent entre les pièces. Ils font une animation de travail quand ils travaillent.
- **Gestes de travail.** Chaque pièce a son geste : on martèle et on scie à l'Atelier, on actionne les leviers dans la Salle des machines, on lit ou on écrit à la Bibliothèque, au Scriptorium, dans la Salle des cartes et au Cabinet de l'arithméticien, on lance un sort à l'Observatoire, on se tient en garde derrière son bouclier au Poste de garde, on s'entraîne à l'épée ou à l'arc dans la Salle des épreuves (on lit à la table de relecture, on manipule les fioles au laboratoire), on crochète une serrure dans le Réduit du concierge. Au Pigeonnier, l'agent lance un pigeon chaque fois qu'il en part un.
- **Assis.** À la taverne, les personnages au repos, l'agent principal qui attend ton message et le chevalier d'une session arrêtée s'assoient sur des tabourets autour des grandes tables, ou par terre le long des murs quand les tables sont pleines. Au Coin détente, Butt-Stallion s'assoit sur le canapé ou autour de la table de dés, par terre le long des murs, et l'un d'eux fait des pompes.
- **Attente.** Ils regardent autour d'eux, le losange ambre restant affiché. Le premier de la file s'agenouille devant l'autel, puis se relève au bout d'une minute.
- **Couleur.** Chaque personnage a un disque au sol de la couleur de sa session, et le bord de son étiquette porte cette même couleur. L'étiquette du personnage sélectionné a un contour bleu et du texte en gras.
- **Réduction des animations.** Si la réduction des animations est activée dans le système, les personnages gardent une pose fixe et n'effectuent pas de surgissement. Les personnages assis le restent, immobiles ; ceux qui travaillent debout se figent dans leur pose calme, sans pompes ni lancer de pigeon. Ils se déplacent toujours d'une pièce à l'autre. Le chevalier d'une session supprimée disparaît sans marche ni combat, et les squelettes ne s'affichent pas.

## Une baffe sur un personnage

Un clic droit sans glisser sur un personnage le baffe : une grande main en 3D arrive par le côté et lui balaie le visage du revers. Il encaisse le coup : des étoiles tournent au-dessus de son étiquette, et une bulle « PAF ! » apparaît (« SLAP! » en anglais, « KLATSCH! » en allemand), avec un bruit de claque.

Cet effet est purement esthétique : rien n'agit sur l'agent ni sur sa session.

- **Glisser.** Un clic droit glissé déplace toujours la caméra, sans baffer.
- **Clavier.** Le bouton « Baffer » de la fiche de l'agent, ou de la présentation d'un sous-agent au repos, fait la même chose. Il n'apparaît que tant que l'agent a un personnage dans la scène.
- **Réduction des animations.** Ni main ni coup : seule la bulle s'affiche, immobile.

## La potion d'oubli

Quand Claude Code compacte le contexte d'une session, l'agent concerné boit une fiole verte. Il titube, des étoiles tournent autour de sa tête, et une bulle « Où suis-je ? » apparaît. L'effet dure environ 4,6 s. Le compactage peut être automatique ou lancé avec `/compact`. Le gag concerne l'agent principal comme un sous-agent.

Cet effet est purement esthétique, comme la baffe : rien n'agit sur le travail de l'agent. Il suppose les hooks installés. Après une mise à jour, relance `npm run hooks:install`.

- **Réduction des animations.** Ni fiole, ni gorgée, ni titubation : les étoiles et la bulle restent immobiles.

## Le pigeon de Samuel-Morse

Samuel-Morse teste les API externes depuis le Pigeonnier. Chaque fois qu'il lance une requête HTTP avec `curl`, `wget`, `Invoke-WebRequest` ou `Invoke-RestMethod`, depuis `Bash` ou `PowerShell`, un pigeon quitte la volière et s'envole vers le ciel. C'est une peluche de poulet, comme celles de la volière. Quand la commande se termine, le pigeon revient, ou non, selon le résultat :

| Résultat de la commande | Ce qu'on voit |
|---|---|
| Succès (code HTTP inférieur à 400) | Le pigeon revient et se pose dans la volière. |
| Erreur (code 400 ou plus, `000` quand aucune réponse n'arrive, ou commande en échec) | Une issue tirée au hasard, décrite ci-dessous. |
| Aucun résultat après 60 s | Le pigeon est perdu : une plume retombe, il ne revient pas. |

Il y a trois issues possibles en cas d'erreur :

- **Plumé.** Le pigeon revient maigre, et des plumes tombent pendant son retour.
- **Perdu.** Une plume retombe, et le pigeon ne revient pas.
- **Fiente.** Le pigeon survole la tête de l'agent et lâche une fiente blanche. Elle reste environ 6 s sur sa tête, puis le pigeon rentre à la volière.

Deux règles encadrent le gag :

- **Quatre pigeons au plus.** Quatre pigeons peuvent voler en même temps. Au-delà, l'appel n'envoie aucun pigeon, mais son résultat reste rattaché au bon appel, dans l'ordre.
- **Le lancer.** L'agent fait le geste de lancer chaque fois qu'un pigeon part, y compris avec la commande de console. Quand aucun pigeon ne part (quatre déjà en vol), il ne lance rien.
- **Réduction des animations.** Ni vol ni plume. Seule la fiente s'affiche, immobile, sur la tête de l'agent. Les autres issues ne montrent rien.

Cet effet est purement esthétique : il ne change rien à la requête ni à son résultat, et il n'affiche aucun texte. Il ne montre ni le contenu de la réponse, ni son code HTTP. Il utilise les hooks d'outil déjà installés, sans réinstallation. Le détail est dans [Appels HTTP du Pigeonnier](fonctionnement.md#appels-http-du-pigeonnier).

## La chaudière et la fiole

Deux accidents visuels, déclenchés par un outil qui échoue. Ils ne jouent jamais sur une réussite.

- **La chaudière.** Quand un outil échoue alors que l'agent se trouve dans la salle des machines, la chaudière fait « pouf » : une bouffée de fumée claire et une brève lueur. L'agent reste noirci de suie environ 4,5 s : 3 s pleines, puis la suie disparaît peu à peu. Une bulle « POUF ! » apparaît (« POOF! » en anglais, « PUFF! » en allemand).
- **La fiole.** Quand une commande `Bash` ou `PowerShell` qui lance des tests échoue, la fiole du labo de la salle des épreuves explose en vert. L'agent, en général dans la salle des machines, est couvert de suie verte environ 4,5 s, avec une bulle « BLOUP ! » (« BLOOP! » en anglais, « BLUBB! » en allemand). La commande peut enchaîner plusieurs instructions : le gag la reconnaît tant que la commande de test figure dans ses 200 premiers caractères.

Le déclencheur, les commandes de test reconnues et les commandes pour tester ces gags sont décrits dans [Commandes console](commandes-console.md).

Ces effets sont purement esthétiques, comme la baffe et la potion : rien n'est envoyé au serveur, et rien n'agit sur le travail de l'agent. Ils lisent seulement les événements de hooks déjà diffusés, et supposent les hooks installés.

- **Réduction des animations.** Ni fumée, ni lueur : la bulle reste fixe, et la suie disparaît d'un coup au lieu de s'estomper.

## Le héraut des tours d'angle

Quand un agent réussit un `git commit` ou un `git push` dans une commande `Bash` ou `PowerShell`, un héraut sort d'une trappe sur une tour d'angle libre. Il se tourne vers la cour, sonne de la trompette, puis redescend dans la trappe. Des notes ♪ flottent autour de lui pendant qu'il joue.

- **Commit.** Une sonnerie courte, d'environ 5 s en tout.
- **Push.** Une fanfare longue, d'environ 8,6 s en tout, avec un fanion rouge au bout de la trompette.

Le héraut ne représente aucun agent. Il ne change rien à la liste des sessions.

- Une tour porte au plus un héraut. Si les quatre tours sont occupées, rien ne se passe.
- Si la coupe fait baisser la tour, le héraut reste caché tant qu'elle est basse.
- Si une même commande fait un commit puis un push, seule la fanfare du push joue. Un `--dry-run` ne compte pas.
- Un commit ou un push qui échoue ne déclenche rien.
- Seuls les événements du donjon affiché déclenchent le gag. Un commit fait dans un autre donjon n'apparaît pas ici.
- Un gag ne se joue que pour un événement reçu pendant que la page est ouverte : une reconnexion ne le rejoue pas.
- **Limite acceptée.** Un push d'une branche déjà à jour sonne quand même la fanfare.

Ces effets sont purement esthétiques : rien n'agit sur le travail de l'agent. Le serveur ne fait que lire la commande et la sortie, puis n'envoie à la page que le type de célébration (`commit`, `push` ou `tests`). Le fonctionnement est décrit dans [Fonctionnement](fonctionnement.md).

- **Réduction des animations.** Le héraut se tient immobile sur sa tour, sans monter ni descendre.

Le déclencheur et les commandes pour tester ce gag sont décrits dans [Commandes console](commandes-console.md).

## Le feu d'artifice

Quand une suite de tests passe, cinq gerbes éclatent dans le ciel au-dessus du château, pendant environ 4,3 s. Le gag ne joue que si la sortie de la commande ne signale aucun échec.

Les commandes reconnues sont `npm`, `pnpm`, `yarn` ou `bun` lancés avec `test`, `vitest`, `jest` (sans `watch`), `playwright test`, `pytest`, `mvn test` ou `mvn verify`, `gradle test` ou `gradle check`, `cargo test`, `go test`, `dotnet test` et `node --test`.

- Un passage de tests pendant un spectacle est ignoré.
- Seuls les événements du donjon affiché déclenchent le gag.
- Un gag ne se joue que pour un événement reçu pendant que la page est ouverte : une reconnexion ne le rejoue pas.
- **Limite acceptée.** Un échec masqué par un tube (`|`) n'est repéré que si la sortie contient `FAIL`, `FAILED`, « N failed » ou `BUILD FAILURE`. Dans les autres cas, le feu part alors que les tests ont échoué.

Ce feu est purement esthétique : rien n'agit sur le travail de l'agent. Le serveur ne fait que lire la commande et la sortie, puis n'envoie à la page que le type de célébration (`tests`).

- **Réduction des animations.** Pas de gerbes qui partent : un bouquet fixe, plus discret, s'allume puis s'éteint en fondu, pendant environ 2 s.

Le déclencheur et les commandes pour tester ce gag sont décrits dans [Commandes console](commandes-console.md).

## La fiche d'agent

Un clic sur un personnage, ou sur sa ligne dans la liste, ouvre sa **fiche** en haut à droite de la scène. Un sous-agent au repos fait exception : son clic ouvre sa [présentation](#la-présentation-dun-sous-agent). Elle est dans le même style que la [boîte de dialogue](#dialogue-avec-un-agent) en bas.

La fiche affiche :

- son état et depuis quand, sa tâche ou sa dernière requête, son outil, la session qui l'a lancé (« lancée depuis »), et son dernier message ;
- le contexte de sa session : origine (app Claude ou terminal, en cours ou terminée), worktree (oui ou non) et son nom, dossier, branche et branche d'origine, modèle, effort, mode de permission, heure de début (sessions de l'app), nombre de tours, sous-agents actifs, version de Claude Code ;
- les serveurs web que la session a lancés, sous forme de liens `http://localhost:<port>` qui s'ouvrent dans un nouvel onglet.

Les serveurs web sont détectés toutes les 10 s :

- un port en écoute ouvert par un processus lancé par la session ;
- un port déclaré dans `.claude/launch.json` du dossier de la session et servi depuis ce dossier.

Un port ouvert par un outil ou un serveur MCP lancé par Claude apparaît aussi. Seules les adresses locales sont détectées.

Le × de la fiche désélectionne l'agent. La fiche et la boîte de dialogue se ferment.

## La liste latérale

Le panneau latéral s'appelle « Agents et lieux ». Il est l'équivalent complet de la vue 3D au clavier et au lecteur d'écran.

- **Sessions en cours.** Une ligne par agent, avec son icône d'état. Un clic ouvre la fiche et la boîte de dialogue.
- **Compagnie de la taverne.** Un bouton par type de sous-agent de l'environnement. Il ouvre la même présentation que le clic sur l'exemplaire au repos. Fermer la présentation rend le focus au bouton choisi.
- **Lieux du donjon.** Les postes, groupés par pièce. Un clic ouvre la même carte que le clic sur un poste. Fermer la carte rend le focus au bouton choisi.

## Dialogue avec un agent

Clique sur un personnage dans la 3D, ou sur sa ligne dans la liste des sessions. Une boîte de dialogue s'ouvre en bas de la scène et affiche la conversation de l'agent, comme dans un jeu de rôle :

- tes messages ;
- les réponses de l'agent ;
- une ligne courte pour chaque outil appelé. Le contenu brut des résultats et la réflexion de l'agent ne s'affichent pas.

Pour un sous-agent, la boîte affiche sa propre conversation. La consigne qu'il a reçue s'affiche sous le nom « Agent principal ».

Un sous-agent au repos, à la taverne, n'a pas de conversation : son clic ouvre sa présentation, et la boîte reste fermée.

- **Historique.** Fais défiler vers le haut, ou clique sur « Charger les messages précédents ».
- **Nouveaux messages.** Ils arrivent tout seuls : le serveur relit la conversation toutes les 2 s.
- **Fermer.** Clique sur × ou appuie sur Échap. La boîte se ferme et l'agent reste sélectionné.
- **Lecture seule.** La boîte n'a pas encore de zone de saisie. Répondre à un agent depuis la 3D est prévu, voir [conception.md](conception.md).

Les messages sont mis en forme en Markdown, comme dans Claude Code : titres, listes, tableaux, blocs de code, citations, séparateurs, gras, italique et code en ligne. Les liens n'affichent que leur texte, sans lien cliquable ni adresse. Un tableau de plus de 30 colonnes reste du texte brut, et un tableau très long est coupé. Le contenu n'est jamais interprété comme du HTML.

Qui peut lire ces conversations est décrit dans [securite.md](securite.md).

## Langues

L'interface existe en français, en allemand et en anglais. Les boutons `FR | DE | EN`, en haut à droite, changent la langue à la volée, sur toutes les pages. À la première visite, la page suit la langue du navigateur, ou le français s'il n'est réglé sur aucune des trois. Le choix est ensuite mémorisé dans le navigateur.

Les titres de sessions, noms des donjons, tâches et messages des agents s'affichent tels qu'ils ont été écrits. Les journaux du serveur restent en français.

## Historique

L'historique liste les sessions terminées.

## Débogage

`/debug` montre le flux brut des événements reçus.

Dans la console du navigateur, `agentOffice.potion()` fait boire l'agent sélectionné. `agentOffice.potion('rest:hermione')` vise une figure précise de la taverne : l'identifiant est en minuscules. La commande renvoie `true` si une figure a réagi. Elle reste disponible en production et n'appelle pas le serveur. `agentOffice.pigeon('dropping')` lâche une fiente sur l'agent sélectionné. Toutes les commandes de ce type sont listées dans [Commandes console](commandes-console.md).
