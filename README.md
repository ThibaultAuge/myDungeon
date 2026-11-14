# Agent Office

Un petit bureau en 3D où chaque agent Claude Code du poste local est un personnage. On voit qui travaille, sur quoi, qui attend une réponse et qui a fini.

- **Un donjon en 3D** de 14 lieux, entouré d'une forêt de nuit.
- **Un personnage par agent**, de la couleur de sa session. Les sous-agents apparaissent, puis retournent à la taverne.
- **Une baffe façon Dungeon Keeper** : clic droit sur un personnage, purement pour rire.
- **Entrées et sorties** : le chevalier d'une session entre au château par le pont-levis. Quand la session disparaît, il sort par la porte et meurt sous les coups de squelettes.
- **Trois états lisibles** : il travaille, il attend ton prochain message, il a terminé.
- **L'autel des requêtes** : les agents qui ont besoin de toi (permission, question, erreur) font la queue.
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
- [Fonctionnement](docs/fonctionnement.md) : flux de données, hooks, données lues, variables d'environnement.
- [Sécurité](docs/securite.md) : accès local, conversations, poste partagé.
- [Modèles 3D](docs/modeles-3d.md) : packs KayKit, licence, ajout d'un modèle.
- [Lieux](docs/lieux.md) : plan du donjon, pièces, places, taverne et cycle de vie.
- [Personnages](docs/personnages.md) : représentation des agents, tenues, entrée et sortie du chevalier, changement de look.
- [Conception](docs/conception.md) : ambiance, décisions, état de l'implémentation, limites.
