// The console namespace `agentOffice` shared by the gags' test commands (docs/commandes-console.md).
// Pure module, no three.js.

/** Test commands of the gags, by name (`potion`, `heraut`, `feuArtifice`…). */
export interface GagCommands {
  [name: string]: unknown;
  potion?: (id?: string) => boolean;
}

/**
 * The `agentOffice` record on `host` (the window), created by the first gag that installs a
 * command and extended by the next ones. Something else already under that name (set by hand in
 * the console) is replaced.
 */
export function gagCommands(host: object): GagCommands {
  const holder = host as { agentOffice?: unknown };
  if (typeof holder.agentOffice !== 'object' || holder.agentOffice === null) holder.agentOffice = {};
  return holder.agentOffice as GagCommands;
}
