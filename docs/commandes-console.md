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
| `agentOffice.autel(palier?, id?)` | Impose un palier de l'attente interminable à l'autel : `'calme'`, `'cent-pas'`, `'assis'`, `'endormi'` (Zzz) ou `'toile'` (toiles d'araignée). Le palier reste jusqu'à `agentOffice.autel(null, id)` ; `agentOffice.autel()` les retire tous. Sans `id` et sans sélection, vise tous les agents à l'autel. | Attente à l'autel (permission, question, erreur) : 1, 3, 5 et 10 min |

Un nouveau gag qui ajoute une commande la déclare ici, sur une ligne de ce tableau.
