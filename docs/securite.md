# Sécurité

Agent Office est un outil mono-utilisateur, lancé à la main sur ton propre poste. Ce document décrit ce qu'il protège, ce qu'il ne protège pas, et comment restreindre l'accès aux fichiers.

## Sécurité

- Le serveur écoute sur `127.0.0.1` uniquement. Il refuse un en-tête `Host` ou `Origin` inconnu, ce qui protège contre le DNS rebinding et les pages web malveillantes.
- `POST /hooks` exige le jeton, vérifié avant même la lecture de la requête.
- Les pages ne peuvent pas être intégrées dans une iframe (`X-Frame-Options: DENY`, `frame-ancestors 'none'`).
- **Conversations.** `GET /api/transcript` renvoie la conversation de l'agent ouvert, sans authentification (voir « Accès aux conversations » ci-dessous).
- **Chemin du transcript.** Il est déduit de l'état du serveur, jamais d'une valeur envoyée par le navigateur ou par un hook.
- **Métadonnées seulement.** Pour distinguer une session qui a travaillé d'un fantôme, le serveur fait un `lstat` du transcript de chaque processus Claude en cours. Il ne lit jamais ce fichier et ne suit aucun lien symbolique.
- **Lecture bornée.** Le serveur ne lit qu'une partie bornée de la conversation. Le texte est affiché comme du texte, jamais interprété en HTML.
- **Limite connue.** Les routes `/api/*` (inventaire et `/api/transcript`) et le WebSocket ne demandent pas d'authentification. Tout programme local peut donc lire les titres, dossiers, prompts et commandes (tronqués), ainsi que la conversation de l'agent ouvert. Toute action future sur les agents aura sa propre protection.
- **Sur un poste partagé**, restreins les droits du dossier du projet. Un lecteur secondaire comme `F:\` donne souvent le contrôle total aux « Utilisateurs authentifiés ». Dans une invite de commandes administrateur :

```bash
icacls "C:\chemin\vers\agent-office" /inheritance:r /grant:r "%USERNAME%:(OI)(CI)F" "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F"
```

## Accès aux conversations

Aucune connexion n'est requise. La page charge la conversation de l'agent ouvert directement depuis le serveur local (`GET /api/transcript`).

Ce choix convient à un outil mono-utilisateur, lancé à la main sur ton propre poste. L'accès reste limité à la machine :

- le serveur n'écoute que sur `127.0.0.1` ;
- il refuse tout en-tête `Host` ou `Origin` inconnu, ce qui bloque le DNS rebinding et les requêtes venues d'autres sites.

Exposer le serveur au-delà de la machine serait un projet distinct, avec son propre contrôle d'accès. Ne change pas l'adresse d'écoute sans cette protection.
