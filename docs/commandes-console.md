# Commandes console

Commandes à taper dans la console du navigateur (F12), sur la page du donjon, pour déclencher un gag à la demande et le tester. Elles sont toutes rangées sous `agentOffice` : tape `agentOffice` pour voir celles qui sont disponibles.

Elles sont purement visuelles : elles n'appellent pas le serveur et ne changent rien au travail des agents. Elles restent disponibles en production (`npm run start`).

## Viser un agent

Sans argument, une commande vise l'agent sélectionné (clique d'abord sur une figure ou sur une ligne du panneau latéral). Avec un identifiant, elle vise cet agent :

- figure au repos dans la taverne : `rest:<type>` en minuscules, par exemple `rest:hancock` ou `rest:hermione` ;
- agent principal d'une session : `<id de session>#main` ;
- sous-agent : son identifiant d'agent.

Chaque commande renvoie `true` si une figure a réagi, `false` sinon (aucune sélection, ou agent sans figure dans la scène).

Astuce : les mages portent un grand chapeau qui cache leurs mains. Pour bien voir un objet tenu, vise un personnage sans chapeau, comme Hancock.

## Commandes

| Commande | Effet | Déclencheur réel |
|---|---|---|
| `agentOffice.potion(id?)` | L'agent boit la potion d'oubli : gorgée, titubation, étoiles et bulle « Où suis-je ? » (≈ 4,6 s). | Hook `PreCompact` (compaction du contexte) |
| `agentOffice.boiler(id?)` | La chaudière de la salle des machines fait « pouf » (bouffée de fumée et lueur) ; l'agent reste noirci de suie ≈ 4,5 s, avec la bulle « POUF ! ». La fumée joue même sans agent visé. | Hook `PostToolUseFailure` d'un agent qui se trouve dans la salle des machines |
| `agentOffice.flask(id?)` | La fiole du labo de la salle des épreuves explose en vert ; l'agent est couvert de suie verte ≈ 4,5 s, avec la bulle « BLOUP ! ». L'explosion joue même sans agent visé. | Hook `PostToolUseFailure` d'une commande `Bash` ou `PowerShell` qui lance des tests (`npm test`, `vitest`, `pytest`, `mvn test`, `cargo test`…) |

Un nouveau gag qui ajoute une commande la déclare ici, sur une ligne de ce tableau.
