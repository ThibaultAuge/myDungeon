// Removes the Agent Office hooks from the global Claude Code settings, leaves everything else as
// it was, and deletes the relay folder (~/.claude/agent-office: relay copy and its token).
import { backupSettings, readSettings, RELAY_DIR, removeRelay, SETTINGS_FILE, stripOurs, writeSettings } from './hooks-lib.mjs';

let settings;
try {
  settings = readSettings();
} catch (err) {
  console.error(`Impossible de lire ${SETTINGS_FILE} : ${err.message}`);
  process.exit(1);
}

const before = JSON.stringify(settings);
stripOurs(settings);
if (JSON.stringify(settings) !== before) {
  const backup = backupSettings();
  writeSettings(settings);
  console.log(`Hooks Agents’ lAIr retirés de ${SETTINGS_FILE}`);
  if (backup) console.log(`  sauvegarde : ${backup}`);
} else {
  console.log('Aucun hook Agents’ lAIr dans les réglages.');
}
removeRelay();
console.log(`Dossier du relais supprimé : ${RELAY_DIR}`);
