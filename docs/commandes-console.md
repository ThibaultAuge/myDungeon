# Commandes console

Commandes à taper dans la console du navigateur (F12), sur la page du donjon, pour déclencher un gag à la demande et le tester. Elles sont toutes rangées sous `agentOffice` : tape `agentOffice` pour voir celles qui sont disponibles.

Elles sont purement visuelles : elles n'appellent pas le serveur et ne changent rien au travail des agents. Elles restent disponibles en production (`npm run start`).

## Viser un agent

Sans argument, une commande vise l'agent sélectionné (clique d'abord sur une figure ou sur une ligne du panneau latéral). Avec un identifiant, elle vise cet agent :

- figure au repos dans la taverne : `rest:<type>` en minuscules, par exemple `rest:hancock` ou `rest:hermione` ;
- agent principal d'une session : `<id de session>#main` ;
- sous-agent : son identifiant d'agent.

Chaque commande renvoie `true` si une figure a réagi, `false` sinon (aucune sélection, ou agent sans figure dans la scène).

Les célébrations (`heraut`, `feuArtifice`) ne visent aucun agent : elles se jouent sur le château. Elles renvoient `true` dès que la scène d'un donjon est affichée.

Astuce : les mages portent un grand chapeau qui cache leurs mains. Pour bien voir un objet tenu, vise un personnage sans chapeau, comme Hancock.

## Commandes

| Commande | Effet | Déclencheur réel |
|---|---|---|
| `agentOffice.potion(id?)` | L'agent boit la potion d'oubli : gorgée, titubation, étoiles et bulle « Où suis-je ? » (≈ 4,6 s). | Hook `PreCompact` (compaction du contexte) |
| `agentOffice.heraut(type?)` | Un héraut monte sur une tour d'angle libre et sonne de la trompette. `'commit'` : sonnerie courte (≈ 5 s en tout) ; `'push'` (par défaut) : fanfare longue avec fanion (≈ 8,6 s). Rien si les quatre tours sont déjà occupées ; caché tant que sa tour est baissée par la coupe. | `git commit` / `git push` réussi dans une commande Bash ou PowerShell (`PostToolUse`) |
| `agentOffice.feuArtifice()` | Feu d'artifice de cinq gerbes dans le ciel au-dessus du château (≈ 4,2 s). Relancé s'il est déjà en cours. | Suite de tests réussie (`npm test`, `vitest`, `pytest`, `mvn test`…) sans échec dans la sortie (`PostToolUse`) |

Un nouveau gag qui ajoute une commande la déclare ici, sur une ligne de ce tableau.
