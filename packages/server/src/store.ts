import type { HookEventSummary, ServerMessage } from '@agent-office/shared';
import type { Inventory } from './inventory.ts';
import {
  applyHook,
  applyInventory,
  createState,
  environmentsView,
  prune,
  rosterView,
  sessionsView,
  summarize,
  type HookEvent,
  type OfficeState,
} from './reducer.ts';

const RECENT_EVENTS = 200;
const BROADCAST_THROTTLE_MS = 100;

export interface Subscriber {
  /** Environment shown by this client, or null for the debug page (events only). */
  envId: string | null;
  send(msg: ServerMessage): void;
}

/** Holds the office state and pushes snapshots to subscribers, batched every 100 ms. */
export class OfficeStore {
  readonly state: OfficeState = createState();
  private readonly recent: HookEventSummary[] = [];
  private readonly subscribers = new Set<Subscriber>();
  private timer: NodeJS.Timeout | null = null;
  private seq = 0;

  constructor(private readonly clock: () => number = Date.now) {}

  ingestInventory(inv: Inventory): void {
    applyInventory(this.state, inv, this.clock());
    this.schedule();
  }

  ingestHook(ev: HookEvent): HookEventSummary {
    const now = this.clock();
    const session = applyHook(this.state, ev, now);
    const summary = summarize(ev, session, now, ++this.seq);
    this.recent.push(summary);
    if (this.recent.length > RECENT_EVENTS) this.recent.shift();
    for (const sub of this.subscribers) sub.send({ type: 'event', event: summary });
    this.schedule();
    return summary;
  }

  tick(): void {
    prune(this.state, this.clock());
    this.schedule();
  }

  recentEvents(): HookEventSummary[] {
    return [...this.recent];
  }

  snapshot(envId: string): ServerMessage {
    return {
      type: 'snapshot',
      envId,
      sessions: sessionsView(this.state, envId),
      environments: environmentsView(this.state),
      roster: rosterView(this.state, envId),
      at: this.clock(),
    };
  }

  subscribe(sub: Subscriber): () => void {
    this.subscribers.add(sub);
    if (sub.envId) sub.send(this.snapshot(sub.envId));
    return () => this.subscribers.delete(sub);
  }

  private schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, BROADCAST_THROTTLE_MS);
  }

  flush(): void {
    const byEnv = new Map<string, ServerMessage>();
    for (const sub of this.subscribers) {
      if (!sub.envId) continue;
      let msg = byEnv.get(sub.envId);
      if (!msg) {
        msg = this.snapshot(sub.envId);
        byEnv.set(sub.envId, msg);
      }
      sub.send(msg);
    }
  }

  close(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.subscribers.clear();
  }
}
