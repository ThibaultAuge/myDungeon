# Agents’ l**AI**r

Agents’ l**AI**r est un petit repaire en 3D. Le nom reste en anglais dans toutes les langues de l'interface. *Lair* signifie « repaire » en anglais, et le « AI » (IA) se cache au milieu du mot. Chaque environnement de l'app Claude en est un donjon. Dans un donjon, chaque agent Claude Code du poste local est un personnage. On voit qui travaille, sur quoi, qui attend une réponse et qui a fini.

> Les identifiants techniques gardent le nom historique `agent-office` : packages `@agent-office/*`, variables `AGENT_OFFICE_*`, en-tête `x-agent-office-token`, dossier `~/.claude/agent-office`, sauvegardes `settings.json.agent-office-<date>.bak`, et configurations `agent-office`, `agent-office-test` et `agent-office-web` de `.claude/launch.json`.

- **Un donjon en 3D** de 14 lieux, entouré d'une forêt de nuit.
- **Un personnage par agent**, de la couleur de sa session. Les sous-agents apparaissent, puis retournent à la taverne.
- **Une baffe façon Dungeon Keeper** : clic droit sur un personnage, purement pour rire.
- **Une potion d'oubli** : quand une session compacte son contexte, son agent boit une fiole et titube, purement pour rire.
- **Entrées et sorties** : le chevalier d'une session entre au château par le pont-levis. Quand la session disparaît, il sort par la porte et meurt sous les coups de squelettes.
- **Trois états lisibles** : il travaille, il attend ton prochain message, il a terminé.
- **L'autel des requêtes** : les agents qui ont besoin de toi (permission, question, erreur) font la queue.
- **L'attente interminable** : plus un agent attend ta réponse à l'autel, plus il se lasse. Il fait les cent pas, s'assoit, s'endort, puis se couvre de toiles d'araignée, purement pour rire.
- **Une fiche par agent** : contexte de sa session, serveurs web locaux, conversation en lecture seule.
- **Trois langues** : français, allemand et anglais.
- **Temps réel, sans influence sur Claude** : les hooks et les fichiers locaux de l'app desktop alimentent le serveur, qui ne fait qu'observer.

## Prérequis

- Windows, avec Node.js 22 ou plus récent (testé avec Node 26).
- L'app desktop Claude et/ou Claude Code en ligne de commande.

## Installation

```bash
npm install
```

```bash
npm run build
```

```bash
npm run hooks:install
```

```bash
npm start
```

Ouvre ensuite http://127.0.0.1:4777.

Si le port 4777 est déjà pris (par exemple par une autre session), la configuration `agent-office-test` de `.claude/launch.json` lance un second serveur sur le port 4778. Elle ne contient pas de jeton : sans `AGENT_OFFICE_TOKEN` dans l'environnement, elle affiche l'inventaire mais refuse les hooks.

Pour le développement, `npm run dev` lance le serveur et Vite (http://127.0.0.1:5173, qui relaie `/api` et `/ws` vers le port 4777). La configuration `agent-office-web` de `.claude/launch.json` lance Vite seul, relayé vers le serveur de test du port 4778.

## Tests

```bash
npm test
```

```bash
npm run typecheck
```

## Documentation

- [Utilisation](docs/utilisation.md) : ce que tu vois et ce que tu peux faire dans la scène.
- [Commandes console](docs/commandes-console.md) : commandes du navigateur pour déclencher les gags et les tester.
- [Fonctionnement](docs/fonctionnement.md) : flux de données, hooks, données lues, variables d'environnement.
- [Sécurité](docs/securite.md) : accès local, conversations, poste partagé.
- [Modèles 3D](docs/modeles-3d.md) : packs KayKit, licence, ajout d'un modèle.
- [Lieux](docs/lieux.md) : plan du donjon, pièces, places, taverne et cycle de vie.
- [Personnages](docs/personnages.md) : représentation des agents, tenues, entrée et sortie du chevalier, changement de look.
- [Conception](docs/conception.md) : ambiance, décisions, état de l'implémentation, limites.
