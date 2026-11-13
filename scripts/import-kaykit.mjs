// Copies the KayKit models listed in packages/web/src/scene/kit-manifest.json from the unzipped
// packs in assets-src/ (not in git) to packages/web/public/kaykit/ (in git).
//
// Usage: unzip each pack in its own folder under assets-src/ (dungeon/, rpg-tools/, weapons/),
// then run `npm run kaykit:import`. The script only reads and copies files: it never runs
// anything from the packs, and refuses a model that points at an unexpected file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'assets-src');
const DEST = path.join(ROOT, 'packages/web/public/kaykit');
const MANIFEST = path.join(ROOT, 'packages/web/src/scene/kit-manifest.json');

const SAFE_NAME = /^[A-Za-z0-9_]+$/;
const SAFE_FILE = /^[A-Za-z0-9_]+\.(png|bin)$/;

/** Copies a regular file only: a symbolic link in a pack could point at a private file. */
function copyRegular(src, dest) {
  const st = fs.lstatSync(src);
  if (st.isSymbolicLink() || !st.isFile()) throw new Error(`pas un fichier ordinaire : ${src}`);
  fs.copyFileSync(src, dest);
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
let copied = 0;
const errors = [];

for (const [pack, spec] of Object.entries(manifest)) {
  if (!SAFE_NAME.test(pack)) throw new Error(`nom de pack invalide : ${pack}`);
  for (const p of [spec.source, spec.license]) {
    if (p && (path.isAbsolute(p) || p.split(/[\\/]/).includes('..'))) throw new Error(`chemin invalide : ${p}`);
  }
  const from = path.join(SRC, spec.source);
  const to = path.join(DEST, pack);
  if (!fs.existsSync(from)) {
    errors.push(`${pack} : dossier introuvable ${path.relative(ROOT, from)} (zip décompressé ?)`);
    continue;
  }
  fs.mkdirSync(to, { recursive: true });

  for (const tex of spec.textures) {
    if (!SAFE_FILE.test(tex)) throw new Error(`texture invalide : ${tex}`);
    copyRegular(path.join(from, tex), path.join(to, tex));
    copied++;
  }

  for (const name of spec.models) {
    if (!SAFE_NAME.test(name)) throw new Error(`nom de modèle invalide : ${name}`);
    const gltfFile = path.join(from, `${name}.gltf`);
    if (!fs.existsSync(gltfFile)) {
      errors.push(`${pack}/${name}.gltf introuvable`);
      continue;
    }
    const gltf = JSON.parse(fs.readFileSync(gltfFile, 'utf8'));
    // A model may only point at its own buffer and at the pack's textures, side by side.
    const buffers = (gltf.buffers ?? []).map((b) => b.uri);
    const images = (gltf.images ?? []).map((i) => i.uri);
    // An extension (Draco, Meshopt…) could make the browser fetch a decoder from a third-party site.
    const ext = [...(gltf.extensionsUsed ?? []), ...(gltf.extensionsRequired ?? [])];
    if (ext.length) {
      errors.push(`${pack}/${name}.gltf utilise des extensions : ${ext.join(', ')}`);
      continue;
    }
    const bad = [...buffers.filter((u) => u !== `${name}.bin`), ...images.filter((u) => !spec.textures.includes(u))];
    if (bad.length) {
      errors.push(`${pack}/${name}.gltf référence des fichiers inattendus : ${bad.join(', ')}`);
      continue;
    }
    copyRegular(gltfFile, path.join(to, `${name}.gltf`));
    copyRegular(path.join(from, `${name}.bin`), path.join(to, `${name}.bin`));
    copied += 2;
  }

  if (spec.license) copyRegular(path.join(SRC, spec.license), path.join(to, 'License.txt'));
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`${copied} fichiers copiés dans ${path.relative(ROOT, DEST)}`);
