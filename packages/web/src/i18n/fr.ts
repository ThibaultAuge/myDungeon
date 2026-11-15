import type { RoomId } from '@agent-office/shared';
import type { PostId } from '../scene/layout.ts';
import { plural } from './plural.ts';

/**
 * Reference dictionary: its shape is the `Messages` type that `de.ts` and `en.ts` must match
 * key for key. A text shown in the interface is added here and in the two other languages,
 * or the typecheck fails.
 */
export const fr = {
  conn: {
    ok: 'Connecté',
    ko: 'Serveur injoignable, nouvelle tentative…',
  },
  langSwitcher: {
    label: 'Langue de l’interface',
  },
  home: {
    title: 'Choisis ton donjon',
    intro: 'Chaque environnement de l’app Claude est un donjon du royaume, avec ses sessions et ses agents.',
    activeSessions: (n: number) => plural('fr', n, `${n} session en cours`, `${n} sessions en cours`),
    quiet: 'Au calme',
    empty: 'Aucun environnement trouvé. Le serveur tourne-t-il ?',
  },
  env: {
    none: 'Hors environnement',
    unknown: 'Environnement inconnu',
  },
  envSwitcher: {
    label: 'Donjon',
    active: (n: number) => ` (${n} en cours)`,
    open: 'Ouvrir',
  },
  legend: {
    label: 'Légende',
    working: 'Travaille',
    waitingPrompt: 'Attend ton message',
    urgent: 'Attend ta permission ou ta réponse',
    done: 'Terminé',
  },
  office: {
    heading: (name: string) => `Donjon ${name}`,
    canvas: 'Vue 3D du donjon. Les agents sont aussi listés dans « Sessions en cours », et les lieux dans « Lieux du donjon ».',
    side: 'Agents et lieux',
  },
  state: {
    working: 'Travaille',
    done: 'Terminé',
    permission: 'Attend ta permission',
    question: 'Te pose une question',
    error: 'Bloqué par une erreur',
    prompt: 'Attend ton prochain message',
  },
  session: {
    untitled: 'Session sans titre',
  },
  panel: {
    close: 'Fermer le détail et la conversation',
    stateSince: (state: string, duration: string) => `${state} depuis ${duration}`,
    agent: 'Agent',
    mainAgent: 'Agent principal',
    subagent: (type: string) => `Sous-agent ${type}`,
    lastRequest: 'Dernière demande',
    task: 'Tâche',
    tool: 'Outil',
    detail: 'Détail',
    apiError: 'Erreur API',
    launchedFrom: 'Lancée depuis',
    otherSession: 'une autre session',
    folder: 'Dossier',
    lastMessage: 'Dernier message',
  },
  altarWait: {
    /** Snoring of an agent asleep at the altar after waiting too long for the human. */
    snore: 'Zzz',
  },
  slap: {
    /** Comic sound word of the slap, shown in a bubble over the slapped agent. */
    sound: 'PAF !',
  },
  mishap: {
    /** Comic word over an agent whose command failed in the engine room (the boiler goes poof). */
    boiler: 'POUF !',
    /** Comic word over an agent whose test run failed (the alchemy flask blows up). */
    flask: 'BLOUP !',
  },
  potion: {
    /** Dazed words of an agent that just drank the potion of oblivion (context compaction), in a bubble over its head. */
    bubble: 'Où suis-je ?',
  },
  info: {
    label: (name: string) => `Informations sur ${name}`,
    slap: 'Baffer',
    slapLabel: (name: string) => `Baffer ${name} (pour rire, sans effet sur l’agent)`,
    session: 'Session',
    agent: 'Agent',
    sessionName: 'Nom',
    origin: 'Origine',
    desktop: 'App Claude',
    cli: 'Terminal',
    live: 'en cours',
    ended: 'terminée',
    worktree: 'Worktree',
    worktreeYes: (name: string) => `Oui (${name})`,
    no: 'Non',
    branch: 'Branche',
    branchFrom: (branch: string, source: string) => `${branch} (depuis ${source})`,
    model: 'Modèle',
    effort: 'Effort',
    efforts: { low: 'faible', medium: 'moyen', high: 'élevé', xhigh: 'très élevé', max: 'maximal' } as Record<string, string>,
    permissions: 'Permissions',
    permissionModes: {
      default: 'Demander à chaque fois',
      acceptEdits: 'Accepter les modifications',
      plan: 'Mode plan',
      auto: 'Auto',
      bypassPermissions: 'Sans contrôle',
    } as Record<string, string>,
    started: 'Démarrée',
    activity: 'Activité',
    turns: (n: number) => plural('fr', n, `${n} tour`, `${n} tours`),
    activeSubagents: (n: number) => plural('fr', n, `${n} sous-agent actif`, `${n} sous-agents actifs`),
    version: 'Claude Code',
    servers: 'Serveurs web',
    none: 'Aucun',
    openServer: (url: string) => `${url}, s’ouvre dans un nouvel onglet`,
  },
  dialog: {
    label: (name: string) => `Conversation de ${name}`,
    opened: (name: string) => `Conversation de ${name} ouverte en bas de la scène`,
    close: 'Fermer la conversation',
    you: 'Toi',
    tool: 'Outil',
    older: 'Charger les messages précédents',
    loading: 'Chargement de la conversation…',
    start: 'Début de la conversation',
    empty: 'Pas encore de conversation pour cet agent.',
    error: 'Impossible de lire la conversation pour l’instant. Nouvelle tentative en cours…',
    truncated: 'Message raccourci.',
  },
  sessionList: {
    title: 'Sessions en cours',
    empty: 'Aucune session ouverte dans cet environnement.',
    subagentsOf: (title: string) => `Sous-agents de ${title}`,
  },
  history: {
    title: 'Historique',
    empty: 'Aucune session terminée.',
  },
  debug: {
    environments: 'Environnements',
    name: 'Nom',
    activeSessions: 'Sessions en cours',
    folders: 'Dossiers',
    events: (n: number) => `Flux des hooks (${n})`,
    time: 'Heure',
    event: 'Événement',
    environment: 'Environnement',
    session: 'Session',
    agent: 'Agent',
    tool: 'Outil',
    detail: 'Détail',
    mainAgent: 'principal',
  },
  rooms: {
    autel: 'Autel des requêtes',
    cartes: 'Salle des cartes',
    atelier: 'Atelier',
    biblio: 'Bibliothèque',
    scriptorium: 'Scriptorium',
    observatoire: 'Observatoire',
    pigeonnier: 'Pigeonnier',
    machines: 'Salle des machines',
    arithmetique: 'Cabinet de l’arithméticien',
    garde: 'Poste de garde',
    epreuves: 'Salle des épreuves',
    heraut: 'Salle Accessibilité / SEO',
    detente: 'Coin détente',
    concierge: 'Réduit du concierge',
    taverne: 'Taverne',
  } satisfies Record<RoomId, string>,
  /** Workstation cards: title, function in a few words, who works there. */
  posts: {
    autel: {
      title: 'Autel des requêtes',
      role: 'Se prosterner devant toi, humain tout-puissant, pour implorer une permission, une réponse ou ta clémence après une erreur',
      who: 'Tout agent qui a besoin de toi, et claude-code-guide',
    },
    cartes: {
      title: 'Table des cartes',
      role: 'Explorer le besoin et tracer le plan de conquête, avant de creuser le moindre couloir',
      who: 'L’agent principal quand il planifie, Plan',
    },
    atelier: {
      title: 'Établis',
      role: 'Marteler le code jusqu’à ce qu’il compile (en général)',
      who: 'L’agent principal, general-purpose, fork, et Hancock en tournée',
    },
    chevalet: {
      title: 'Chevalet de l’enlumineur',
      role: 'Changer de jolies maquettes en templates HTML/CSS, pixel par pixel',
      who: 'Barbapapa',
    },
    biblio: {
      title: 'Rayonnages et tables de lecture',
      role: 'Fouiller le code local en soufflant la poussière des vieux fichiers',
      who: 'Explore, et l’agent principal quand il lit',
    },
    scriptorium: {
      title: 'Pupitres des copistes',
      role: 'Copier à la plume la documentation, pour les IA et pour les humains (qui la liront peut-être)',
      who: 'Curator (IA), Otis (humains)',
    },
    observatoire: {
      title: 'Grande lunette',
      role: 'Scruter le web et la documentation officielle en quête d’une réponse lointaine',
      who: 'Oracle, et l’agent principal quand il cherche en ligne',
    },
    pigeonnier: {
      title: 'Volière',
      role: 'Tester des API externes : un pigeon part, un pigeon revient (le plus souvent)',
      who: 'Samuel Morse',
    },
    machines: {
      title: 'Machines à vapeur',
      role: 'Lancer des commandes, compiler, exécuter les tests, git, et prier pour que rien n’explose',
      who: 'L’agent principal et les agents génériques',
    },
    arithmetique: {
      title: 'Boulier et ardoise',
      role: 'Calculs et statistiques, exécutés en Python : ici, on ne fait pas confiance au calcul mental',
      who: 'Turing',
    },
    garde: {
      title: 'Table de garde',
      role: 'Audit de sécurité : traquer les intrus et les secrets qui traînent',
      who: 'Neo',
    },
    relecture: {
      title: 'Table de relecture',
      role: 'Revue de code, sans pitié pour les fautes',
      who: 'Hermione',
    },
    labo: {
      title: 'Laboratoire d’alchimie',
      role: 'Écrire les tests, ces potions qui révèlent les bugs',
      who: 'Dexter',
    },
    estrade: {
      title: 'Estrade du héraut',
      role: 'Audit SEO : crier le nom du donjon jusqu’aux moteurs de recherche',
      who: 'Gatsby',
    },
    inspection: {
      title: 'Pupitre d’inspection',
      role: 'Audit d’accessibilité : que chaque visiteur trouve son chemin dans le donjon',
      who: 'Timmy',
    },
    detente: {
      title: 'Banquette et jeu de dés',
      role: 'Idées décalées et brainstorming, entre deux lancers de dés',
      who: 'Butt Stallion',
    },
    concierge: {
      title: 'Balais et chariot',
      role: 'Balayer le code mort, sans rien jeter sans ta permission',
      who: 'Hancock',
    },
    taverne: {
      title: 'Tables de la taverne',
      role: 'Repos : l’équipe disponible boit un coup en attendant qu’on la siffle',
      who: 'Un exemplaire de chaque type d’agent, et l’agent principal qui attend ton prochain message',
    },
  } satisfies Record<PostId, { title: string; role: string; who: string }>,
  postList: {
    title: 'Lieux du donjon',
  },
  postCard: {
    who: 'Qui y travaille',
    close: 'Fermer la fiche',
  },
  roster: {
    title: 'Compagnie de la taverne',
  },
  restCard: {
    kind: 'Sous-agent',
    close: 'Fermer la présentation',
    unknownRole: 'Agent propre à cet environnement, sans présentation connue.',
  },
  /** Presentation of each known agent type, in a few words. Keys are lower case, like LOOKS. */
  agentRoles: {
    hermione: 'Relit ton code à la chandelle et y traque bugs, lenteurs et sortilèges impossibles à maintenir.',
    dexter: 'Concocte tests unitaires, d’intégration et de contrat d’API, puis attend que la fiole fume vert.',
    neo: 'Garde la herse : fouille code, API et dépendances en quête de failles de sécurité et de secrets oubliés.',
    hancock: 'Balaie le code mort hors des couloirs, mais seulement après ta bénédiction.',
    timmy: 'Vérifie que chaque sujet du royaume, au clavier comme au lecteur d’écran, peut entrer dans tes pages (accessibilité WCAG 2.1 AA).',
    gatsby: 'Héraut du référencement (SEO) : soigne balises et titres pour que les moteurs de recherche crient ton nom sur toutes les places.',
    oracle: 'Scrute le web dans sa boule de cristal et en rapporte documentation et sources, citations à l’appui.',
    curator: 'Archiviste des grimoires des IA : tient leur contexte à jour pour qu’elles n’oublient rien d’une session à l’autre.',
    otis: 'Copie à la plume la documentation des humains : README, guides et changelog, que quelqu’un lira peut-être un jour.',
    turing: 'Ne fait confiance à aucun calcul mental : chaque chiffre passe par son boulier Python.',
    'samuel-morse': 'Envoie ses pigeons frapper aux portes des vraies API et note ce qui revient : réponses, erreurs, authentification.',
    barbapapa: 'Enlumine des gabarits HTML/CSS d’après une maquette, pixel par pixel.',
    'butt-stallion': 'Bouffon de la cour : lance des idées farfelues pendant la conception, dont une ou deux brillantes.',
    grumpy: 'Râle contre chaque plan avant qu’on ose le valider. Rien ne trouve grâce à ses yeux, et tout le donjon le sait.',
    'phoenix-wright': 'Juriste du royaume : crie « Objection ! » dès qu’une donnée des sujets franchit les remparts sans édit royal (RGPD).',
    explore: 'Éclaireur lanterne au poing : fouille le code local pour trouver fichiers et réponses.',
    plan: 'Cartographe : trace le plan d’implémentation avant qu’on creuse le moindre couloir.',
    'general-purpose': 'Bon à tout faire du donjon : prend les tâches en plusieurs étapes que personne d’autre ne réclame.',
    'claude-code-guide': 'Sacristain de l’autel : connaît par cœur les règles de Claude Code et de l’API Claude.',
    'statusline-setup': 'Peint l’enseigne du donjon : configure la ligne de statut de Claude Code.',
  },
  time: {
    seconds: (n: number) => `${n} s`,
    minutes: (n: number) => `${n} min`,
    hours: (h: number, min: string) => `${h} h ${min}`,
    days: (n: number) => `${n} j`,
    ago: (duration: string) => `il y a ${duration}`,
    /** Days in the past: German needs its own case after "vor". */
    daysAgo: (n: number) => `il y a ${n} j`,
  },
  /** "Name : detail", with the French non-breaking space before the colon. */
  labelled: (label: string, detail: string) => `${label} : ${detail}`,
};

export type Messages = typeof fr;
