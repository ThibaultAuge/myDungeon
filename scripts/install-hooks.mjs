// Adds the Agent Office hooks to the global Claude Code settings (every session).
// Each hook runs the relay in the background: it forwards the event to the local server and
// ignores the answer, so the channel is observation-only by construction. The relay is copied to
// the user's profile (~/.claude/agent-office) so it never runs from the repository folder.
// settings.json is backed up first and only our handlers are touched.
import crypto from 'node:crypto';
import {
  addOurs,
  backupSettings,
  ENV_FILE,
  EVENTS,
  installRelay,
  readEnvFile,
  readSettings,
  RELAY_SCRIPT,
  relayCommand,
  SETTINGS_FILE,
  writeEnvFile,
  writeSettings,
} from './hooks-lib.mjs';

let settings;
try {
  settings = readSettings();
} catch (err) {
  console.error(`Impossible de lire ${SETTINGS_FILE} : ${err.message}`);
  console.error('Rien n’a été modifié.');
  process.exit(1);
}

relayCommand(RELAY_SCRIPT); // throws before any change if the path is unsafe for a shell command
installRelay();
const env = readEnvFile();
const port = Number(process.env.AGENT_OFFICE_PORT ?? env.AGENT_OFFICE_PORT ?? 4777);
const rotate = process.argv.includes('--rotate');
const token =
  !rotate && env.AGENT_OFFICE_TOKEN && env.AGENT_OFFICE_TOKEN.length >= 32 ? env.AGENT_OFFICE_TOKEN : crypto.randomBytes(32).toString('hex');
writeEnvFile({ ...env, AGENT_OFFICE_PORT: String(port), AGENT_OFFICE_TOKEN: token });

const backup = backupSettings();
writeSettings(addOurs(settings, { relayPath: RELAY_SCRIPT }));

console.log(`Hooks Agents’ lAIr installés dans ${SETTINGS_FILE}`);
console.log(`  événements : ${EVENTS.join(', ')}`);
console.log(`  relais     : ${RELAY_SCRIPT} (copie dans ton profil)`);
console.log(`  commande   : ${relayCommand()} (async, réponse ignorée : observation seule)`);
console.log('  après une modification de scripts/hook-relay.mjs, relance cette installation.');
console.log(`  cible      : http://127.0.0.1:${port}/hooks`);
console.log(`  jeton      : ${ENV_FILE} (absent de settings.json)${rotate ? ', régénéré' : ''}`);
if (backup) console.log(`  sauvegarde : ${backup}`);
console.log('Redémarre le serveur Agents’ lAIr s’il tourne, pour qu’il prenne le jeton.');
