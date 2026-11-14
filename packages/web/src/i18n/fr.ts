import type { RoomId } from '@agent-office/shared';
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
    title: 'Choisis une entreprise',
    intro: 'Chaque environnement de l’app Claude est un bureau, avec ses sessions et ses agents.',
    activeSessions: (n: number) => plural('fr', n, `${n} session en cours`, `${n} sessions en cours`),
    quiet: 'Au calme',
    empty: 'Aucun environnement trouvé. Le serveur tourne-t-il ?',
  },
  env: {
    none: 'Hors environnement',
    unknown: 'Environnement inconnu',
  },
  envSwitcher: {
    label: 'Entreprise',
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
    heading: (name: string) => `Bureau ${name}`,
    canvas: 'Vue 3D du bureau. La même information est disponible dans la liste des sessions.',
    side: 'Détail des agents',
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
    close: 'Fermer le détail',
    stateSince: (state: string, duration: string) => `${state} depuis ${duration}`,
    session: 'Session',
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
