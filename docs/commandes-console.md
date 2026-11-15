# Commandes console

Commandes à taper dans la console du navigateur (F12), sur la page du donjon, pour déclencher un gag à la demande et le tester. Elles sont toutes rangées sous `agentOffice` : tape `agentOffice` pour voir celles qui sont disponibles.

Elles sont purement visuelles : elles n'appellent pas le serveur et ne changent rien au travail des agents. Elles restent disponibles en production (`npm run start`).

## Viser un agent

Sans argument, une commande vise l'agent sélectionné (clique d'abord sur une figure ou sur une ligne du panneau latéral). Avec un identifiant, elle vise cet agent :

- figure au repos dans la taverne : `rest:<type>` en minuscules, par exemple `rest:hancock` ou `rest:hermione` ;
- agent principal d'une session : `<id de session>#main` ;
- sous-agent : son identifiant d'agent.

Chaque commande renvoie `true` si une figure a réagi, `false` sinon (aucune sélection, ou agent sans figure dans la scène).

Exception : `agentOffice.autel` prend d'abord le palier, puis l'identifiant. Sans aucun argument, `agentOffice.autel()` ne vise aucun agent : il retire tous les paliers imposés.

`agentOffice.rat` ne vise aucun agent : son argument désigne le passage (`'couloir'` ou `'fromage'`), jamais un identifiant.

Astuce : les mages portent un grand chapeau qui cache leurs mains. Pour bien voir un objet tenu, vise un personnage sans chapeau, comme Hancock.

## Commandes

| Commande | Effet | Déclencheur réel |
|---|---|---|
| `agentOffice.potion(id?)` | L'agent boit la potion d'oubli : gorgée, titubation, étoiles et bulle « Où suis-je ? » (≈ 4,6 s). | Hook `PreCompact` (compaction du contexte) |
| `agentOffice.boiler(id?)` | La chaudière de la salle des machines fait « pouf » (bouffée de fumée et lueur) ; l'agent reste noirci de suie ≈ 4,5 s, avec la bulle « POUF ! ». La fumée joue même sans agent visé. | Hook `PostToolUseFailure` d'un agent qui se trouve dans la salle des machines |
| `agentOffice.flask(id?)` | La fiole du labo de la salle des épreuves explose en vert ; l'agent est couvert de suie verte ≈ 4,5 s, avec la bulle « BLOUP ! ». L'explosion joue même sans agent visé. | Hook `PostToolUseFailure` d'une commande `Bash` ou `PowerShell` qui lance des tests (`npm test`, `vitest`, `pytest`, `mvn test`, `cargo test`…) |
| `agentOffice.autel(palier?, id?)` | Impose un palier de l'attente interminable à l'autel : `'calme'`, `'cent-pas'`, `'assis'`, `'endormi'` (Zzz) ou `'toile'` (toiles d'araignée). Le palier reste jusqu'à `agentOffice.autel(null, id)`, qui le retire. Sans `id`, vise l'agent sélectionné, ou tous les agents à l'autel s'il n'y a pas de sélection. `agentOffice.autel()` sans argument retire tous les paliers imposés. Renvoie `true` seulement si une figure a été forcée ou libérée. | Attente à l'autel (permission, question, erreur) : paliers à 1, 3, 5 et 10 min |
| `agentOffice.pigeon(issue?, id?)` | Un pigeon s'envole de la volière du Pigeonnier et revient selon `issue` : `'back'` (il revient, par défaut), `'plucked'` (il revient plumé dans une gerbe de plumes), `'lost'` (il ne revient pas, une plume retombe), `'dropping'` (il lâche une fiente qui reste ≈ 6 s sur la tête de l'agent visé). Le premier argument est l'issue, l'agent vient en second ; sans agent sélectionné, il vise le premier agent du Pigeonnier, sinon la fiente tombe sur le pupitre. Renvoie `false` pour une issue inconnue ou quand 4 pigeons volent déjà. | Commande `curl`, `wget`, `Invoke-WebRequest` ou `Invoke-RestMethod` (Bash ou PowerShell) lancée par un agent du Pigeonnier : succès (code HTTP < 400) → `'back'` ; erreur (code ≥ 400, `000` sans réponse, ou commande en échec) → `'plucked'`, `'lost'` ou `'dropping'` au hasard |
| `agentOffice.rat(passage?)` | Lance un passage du rat. `'couloir'` (par défaut) : il traverse les couloirs d'un trou à l'autre. `'fromage'` : il vole le fromage de la taverne et s'enfuit avec. Un nouvel appel remplace le passage en cours, et le fromage revient aussitôt. Renvoie `true` si un rat part, `false` sinon (argument inconnu, mouvement réduit). Disponible une fois la scène 3D chargée. | Minuteur aléatoire, toutes les 3 à 6 min ; 1 passage sur 4 est un vol (voir [Le rat et le fromage](lieux.md#le-rat-et-le-fromage)) |

Un nouveau gag qui ajoute une commande la déclare ici, sur une ligne de ce tableau.
