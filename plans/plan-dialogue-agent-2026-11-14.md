# Plan d'implémentation — Dialogue d'agent et bulle de requête

*Généré le 2026-11-14*

## Objectif

Cliquer sur un personnage ouvre sa conversation dans une boîte de dialogue en bas de
l'écran, façon jeu de rôle, avec l'historique scrollable. Un agent qui vient à l'autel
avec une requête porte une bulle de dialogue au-dessus de la tête.

## Résumé des exigences

### Fonctionnelles
- **Boîte de dialogue.**
  - Elle s'ouvre au clic sur un personnage, sur la scène comme dans la liste latérale.
  - Elle s'ancre en bas de l'écran, sur toute la largeur utile. Un cartouche de nom aux couleurs de la session est posé sur son bord haut, comme dans un RPG.
- **Contenu.**
  - Les messages du transcript, du plus ancien en haut au plus récent en bas : tes prompts, les réponses texte de l'agent, et une ligne compacte par appel d'outil (`Read packages/…`, `Bash npm test`…).
  - Les blocs `thinking` et le contenu brut des `tool_result` ne sont pas affichés.
- **Défilement.**
  - À l'ouverture, la boîte se place sur le dernier message.
  - Remonter en haut charge la page précédente, par pages de 50 messages.
  - Les nouveaux messages arrivent pendant que la boîte est ouverte. Ils ne font défiler la vue que si tu étais déjà en bas.
- **Historique affiché.**
  - Pour un sous-agent, son propre transcript, `subagents/agent-<id>.jsonl`.
  - Pour l'agent principal, celui de la session. Si la session a plusieurs `cliSessionIds`, c'est le plus récent.
- **Fermeture.** Le bouton × ou `Échap` ferme la boîte, sans désélectionner l'agent. Une nouvelle sélection la rouvre.
- **Bulle de dialogue.**
  - Les agents en attente pour `permission`, `question` ou `error`, c'est-à-dire ceux de l'autel, remplacent l'octaèdre rouge par une bulle de BD rouge tournée vers la caméra.
  - L'intérieur de la bulle varie : trois points pour une permission, « ? » pour une question, « ! » pour une erreur. Ces signes sont en géométrie, sans police chargée.
  - L'agent principal qui attend ton prochain prompt, à la taverne, garde le petit octaèdre ambre.
- **Connexion par lien à usage unique.**
  - Au démarrage, le serveur affiche dans la console un lien `http://127.0.0.1:<port>/login?code=<code>`. Le code est à usage unique et expire en 10 minutes.
  - Le lien échange le code contre un cookie de session, puis redirige vers `/`.
  - Sans cookie, la boîte affiche un message traduit : « Ouvre le lien de connexion affiché par le serveur ». La 3D et le panneau restent visibles sans connexion, comme aujourd'hui.

### Non fonctionnelles
- **Performance.** Le transcript n'est jamais lu en entier à chaque requête : lecture par la fin, en blocs, jusqu'à obtenir la page demandée. Pendant que la boîte est ouverte, le client relit toutes les 2 s avec un `ETag` (taille + mtime), et le serveur répond `304` si rien n'a changé.
- **Sécurité.** Détails dans la section dédiée.
- **UX et accessibilité.**
  - La boîte est un `<section role="dialog" aria-modal="false">` qui porte un titre.
  - La liste des messages est un `role="log"`.
  - La boîte se ferme avec `Échap`, et le focus revient au personnage ou à sa ligne dans la liste.
  - Le contraste vise AA, et la mise en page tient à 375 px de large.
  - Tous les textes passent par l'i18n (FR, DE, EN), libellés des rôles compris (« Toi », nom de l'agent, « Outil »).

### Hors périmètre
- Envoyer une réponse : il n'y a ni zone de saisie ni hook bloquant, et le relais reste à sens unique. Ce sera un plan séparé, la phase 4, qui réutilisera la connexion posée ici.
- La recherche dans l'historique et l'affichage du contenu des fichiers lus ou écrits.

## Approche technique

### Architecture

```
clic personnage ─► store.select(id) + dialogOpen=true
AgentDialog ─GET /api/transcript?session=<id>&agent=<id>&before=<curseur>  (cookie)
serveur : requireSession ─► transcript.ts
   résout le fichier à partir de l'état (session → cliSessionId → cwd), jamais d'un chemin reçu
   lit par la fin ─► normalise en DialogueEntry[] ─► { entries, before, etag }
```

- **Résolution du chemin, côté serveur uniquement.**
  - La session est cherchée dans le store. Le transcript principal est `<claudeHome>/projects/<cwd encodé>/<cliSessionId>.jsonl`.
  - Si ce fichier est absent, le serveur cherche `projects/*/<cliSessionId>.jsonl`, avec un id validé comme UUID.
  - Le transcript d'un sous-agent est `<dossier session>/subagents/agent-<agentId>.jsonl`. L'`agentId` doit passer `AGENT_ID` et appartenir à cette session dans le store.
  - Le chemin résolu est vérifié avec `path.relative`, et il doit rester sous `<claudeHome>/projects`.
- **Normalisation.**
  - Seules les lignes `type: user | assistant` sont gardées. Un `content` texte donne `{ role: 'user' | 'assistant', text }`, et un `tool_use` donne `{ role: 'tool', tool, detail }`, avec `detail` tronqué à 200 caractères comme aujourd'hui.
  - Le texte d'un message est tronqué à 4 000 caractères, avec un indicateur `truncated`.
  - Une ligne JSON invalide, en général la dernière en cours d'écriture, est ignorée.
- **Pagination.**
  - Le curseur `before` est un offset en octets dans le fichier.
  - La réponse renvoie le nouvel offset tant qu'il reste des messages plus anciens.
- **Connexion.**
  - `auth.ts` génère au démarrage un code de 32 octets aléatoires, consommé à la première utilisation.
  - `GET /login?code=` le compare en temps constant, crée un id de session aléatoire, gardé en mémoire avec une expiration glissante de 12 h, et pose le cookie `agent_office_session`.
  - Le cookie est `HttpOnly; SameSite=Strict; Path=/`, sans `Secure` puisque le serveur sert en HTTP local. Un cookie localhost ne dépend pas du port, il marche donc aussi derrière le proxy Vite.
  - `POST /logout` existe pour la suite. Un redémarrage du serveur oblige à se reconnecter avec le nouveau lien.
  - Le proxy Vite ajoute `/login`.
- **Bulle.** Un composant `RequestBubble`, dans un `<Billboard>` drei, utilise une `ShapeGeometry` (rectangle arrondi + queue) et trois petites géométries pour le signe. Les géométries sont partagées au niveau du module, pas recréées par personnage.

### Stack
- Rien de nouveau : Fastify et zod côté serveur, React, zustand et drei côté client. Le cookie est lu par un parseur minimal maison, ou `@fastify/cookie` : on choisira à l'implémentation et on le dira. Une dépendance ajoutée déclenchera `neo`.

### Fichiers à créer ou modifier
1. `packages/shared/src/index.ts` — `DialogueEntry`, `TranscriptPage`.
2. `packages/server/src/transcript.ts` (nouveau) — résolution de chemin, lecture par la fin et normalisation. Il est pur autant que possible, pour être testable.
3. `packages/server/src/auth.ts` (nouveau) — code à usage unique, sessions et `requireSession`.
4. `packages/server/src/app.ts` — routes `/login`, `/logout` et `/api/transcript`. `/login` est ajouté aux exceptions du fallback SPA.
5. `packages/server/src/index.ts` — affiche le lien de connexion au démarrage.
6. `packages/server/src/store.ts` — accesseur session et agent pour la résolution.
7. `packages/web/vite.config.ts` — proxy `/login`.
8. `packages/web/src/store.ts` — `dialogOpen` et `openDialog`/`closeDialog`, ouvert par `select`.
9. `packages/web/src/ui/AgentDialog.tsx` (nouveau) et `packages/web/src/ui/useTranscript.ts` (nouveau) — chargement, polling avec ETag, pagination et ancrage du défilement.
10. `packages/web/src/App.tsx` — monte `AgentDialog`.
11. `packages/web/src/styles.css` — cadre RPG : bordure épaisse, coins, cartouche de nom, fond parchemin sombre.
12. `packages/web/src/scene/AgentFigure.tsx` et `packages/web/src/scene/RequestBubble.tsx` (nouveau) — la bulle.
13. `packages/web/src/i18n/fr.ts`, `de.ts`, `en.ts` — clés `dialog.*`.
14. Tests : `packages/server/test/transcript.test.ts`, `packages/server/test/auth.test.ts`, et les routes dans le test d'app existant.
15. Docs : `README.md` (connexion, ligne « Limites ») par `otis`, et `docs/ai/agent-lifecycle.md` ou un nouveau `docs/ai/dialogue.md` par `curator`.

## Sécurité
- Le transcript contient tout : code, sorties de commandes, peut-être des secrets. C'est la raison de la connexion obligatoire, même en lecture seule.
- Aucun chemin ne vient du client ni des hooks. `transcript_path` reçu par hook n'est pas utilisé.
- Les contrôles host et origine existants restent en place. `/api/transcript` refuse sans cookie valide (`401`).
- Le code de connexion n'est jamais renvoyé par l'API ni journalisé ailleurs que dans le lien de démarrage. Il est comparé en temps constant et à usage unique.
- Le texte du transcript est rendu comme du texte React, jamais en HTML ni en Markdown interprété.
- Les tailles sont bornées : 50 messages par page, 4 000 caractères par message, 1 Mo lu au plus par requête.

## Performance
- **Goulot possible :** les longs transcripts, de plusieurs dizaines de Mo. La lecture par la fin et l'ETag évitent de les relire.
- **Cible :** une seule boîte ouverte à la fois, une requête toutes les 2 s, en général `304`.
- Une seule `RequestBubble` à géométries partagées, pour quelques agents à l'autel au plus.

## Cas limites
- **Transcript absent :** session desktop sans `cliSessionId`, ou sous-agent pas encore écrit. La boîte affiche un message traduit, « Pas encore de conversation ».
- **Agent rangé à la taverne :** les figures `rest:<type>` ne sont pas sélectionnables. Un sous-agent `done` reste consultable tant qu'il est dans l'état.
- **Agent qui disparaît pendant que la boîte est ouverte :** la boîte se ferme avec la sélection, comme le panneau aujourd'hui.
- **Session reprise avec un nouveau `cliSessionId` :** le transcript le plus récent prend le relais au polling suivant.
- **Ligne JSONL coupée en fin de fichier :** elle est ignorée et relue au tour suivant.
- **Cookie expiré :** le `401` est traduit en message de connexion, sans boucle de requêtes.

## Avant l'implémentation
La branche courante `feat/tavern-followups` a deux fichiers modifiés non commités
(`inventory.ts`, `reducer.ts`). Il faudra décider quoi en faire avant de partir de `main`.

## Estimation

**Taille :** L

**Justification :** une nouvelle route authentifiée (le premier mécanisme d'auth du projet), la lecture paginée de transcripts, un composant UI riche avec défilement et polling, et une nouvelle géométrie 3D, sur les trois packages.
