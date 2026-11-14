import fs from 'node:fs';
import path from 'node:path';
import chokidar from 'chokidar';
import { buildApp } from './app.ts';
import { AuthGate } from './auth.ts';
import { loadConfig, WEB_DIST } from './config.ts';
import { readInventory, type AgentsCache } from './inventory.ts';
import { resolvePaths, type ClaudePaths } from './paths.ts';
import { LaunchPortsCache, PortScanner } from './ports.ts';
import { OfficeStore } from './store.ts';

const RESCAN_MS = 10_000;
const PORT_SCAN_MS = 10_000;
const REDISCOVER_MS = 60_000;
const DEBOUNCE_MS = 300;

const config = loadConfig();
const store = new OfficeStore();
let paths: ClaudePaths = resolvePaths();
/** Agent definitions change rarely: their folders are read at most once a minute. */
const agentsCache: AgentsCache = new Map();

function rescan(): void {
  try {
    store.ingestInventory(readInventory(paths, undefined, agentsCache));
  } catch (err) {
    console.error('[inventaire] lecture impossible :', (err as Error).message);
  }
}

let debounce: NodeJS.Timeout | null = null;
function scheduleRescan(): void {
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(rescan, DEBOUNCE_MS);
}

function watchTargets(p: ClaudePaths): string[] {
  return [p.liveDir, ...p.sessionDirs, ...(p.presetsFile ? [p.presetsFile] : [])];
}

function startWatcher(p: ClaudePaths) {
  const w = chokidar.watch(watchTargets(p), { depth: 0, ignoreInitial: true });
  w.on('all', scheduleRescan);
  // Without a listener an EPERM on a vanished folder would crash the server, and every hook with it.
  w.on('error', (err) => console.error('[surveillance]', (err as Error).message));
  return w;
}

let watcher = startWatcher(paths);

rescan();
setInterval(() => {
  rescan();
  store.tick();
}, RESCAN_MS);
const launchCache = new LaunchPortsCache();
const portScanner = new PortScanner(config.port);
let portScanRunning = false;
let portScanFailed = false;
/** Rounds still to skip after failures: 1, 2, 4… up to 6 rounds (one minute), reset on success. */
let portScanSkip = 0;
let portScanBackoff = 0;
/** Finds the web servers of the live sessions. Never two scans at once; skipped with no live session. */
async function scanPorts(): Promise<void> {
  if (portScanRunning) return;
  if (portScanSkip > 0) {
    portScanSkip--;
    return;
  }
  portScanRunning = true;
  try {
    const now = Date.now();
    const targets = store.portTargets((cwd) => launchCache.get(cwd, now));
    launchCache.keepOnly(targets.map((t) => t.cwd));
    store.ingestServers(await portScanner.scan(targets));
    portScanFailed = false;
    portScanBackoff = 0;
  } catch (err) {
    // The previous result is kept; one line per failure streak, not one every 10 s.
    if (!portScanFailed) console.error('[ports] détection impossible :', (err as Error).message.split('\n')[0].slice(0, 200));
    portScanFailed = true;
    portScanBackoff = Math.min(6, Math.max(1, portScanBackoff * 2));
    portScanSkip = portScanBackoff;
  } finally {
    portScanRunning = false;
  }
}
void scanPorts();
setInterval(() => void scanPorts(), PORT_SCAN_MS);

setInterval(() => {
  try {
    const next = resolvePaths();
    // A folder that still exists but failed to list during discovery stays watched: its
    // sessions are then reported as an incomplete scan instead of being deleted.
    const kept = paths.sessionDirs.filter((d) => !next.sessionDirs.includes(d) && fs.existsSync(d));
    next.sessionDirs = [...next.sessionDirs, ...kept];
    if (JSON.stringify(watchTargets(next)) !== JSON.stringify(watchTargets(paths))) {
      paths = next;
      void watcher.close();
      watcher = startWatcher(paths);
      rescan();
    }
  } catch (err) {
    console.error('[découverte] échec :', (err as Error).message);
  }
}, REDISCOVER_MS);

// Without a build, the page is served by Vite (port 5173), which proxies /login here.
const loginOrigin = fs.existsSync(WEB_DIST) ? `http://127.0.0.1:${config.port}` : 'http://127.0.0.1:5173';
let listening = false;
let pendingLink: string | null = null;
const printLink = (code: string) => {
  const link = `${loginOrigin}/login?code=${code}`;
  if (listening) console.log(`Lien de connexion (usage unique, 10 min) : ${link}`);
  else pendingLink = link;
};
const auth = new AuthGate(printLink);

const app = await buildApp({
  store,
  port: config.port,
  token: config.token,
  webDist: WEB_DIST,
  auth,
  projectsDir: path.join(paths.claudeHome, 'projects'),
});
await app.listen({ host: '127.0.0.1', port: config.port });

console.log(`Agent Office : http://127.0.0.1:${config.port}`);
console.log(`  données desktop : ${paths.desktopData ?? 'introuvables'} (${paths.sessionDirs.length} dossier(s) de sessions)`);
listening = true;
if (pendingLink) console.log(`  lien de connexion (usage unique, 10 min) : ${pendingLink}`);
if (!config.token) {
  console.warn('  aucun jeton : les hooks sont refusés. Lance `npm run hooks:install`.');
}
