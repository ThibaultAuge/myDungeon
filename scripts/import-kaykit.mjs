// Copies the KayKit models listed in packages/web/src/scene/kit-manifest.json from the unzipped
// packs in assets-src/ (not in git) to packages/web/public/kaykit/ (in git).
//
// Usage: unzip each pack in its own folder under assets-src/ (dungeon/, rpg-tools/, weapons/,
// adventurers/), then run `npm run kaykit:import`. A pack is `.gltf` + `.bin` + shared
// textures, or with `"format": "glb"` self-contained binary glTF files. The script only reads and copies files: it never runs
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

/**
 * Checks a binary glTF: everything must be inside the file. No external buffer or image
 * (it could point anywhere), no extension (Draco, Meshopt… fetch a decoder from a CDN).
 * Returns the problem, or null when the file is safe to copy.
 */
function checkGlb(buf) {
  if (buf.length < 20 || buf.toString('latin1', 0, 4) !== 'glTF') return 'n’est pas un glTF binaire';
  if (buf.readUInt32LE(4) !== 2) return 'n’est pas en version 2';
  if (buf.readUInt32LE(8) !== buf.length) return 'a une longueur incohérente';
  // Every chunk, not just the first: the browser's loader keeps the LAST JSON chunk, so a
  // clean first chunk could hide a second one with external URIs or extensions.
  const chunks = [];
  for (let offset = 12; offset < buf.length; ) {
    if (offset + 8 > buf.length) return 'a un chunk tronqué';
    const length = buf.readUInt32LE(offset);
    const type = buf.readUInt32LE(offset + 4);
    if (length % 4 !== 0 || offset + 8 + length > buf.length) return 'a un chunk de longueur invalide';
    chunks.push({ type, start: offset + 8, length });
    offset += 8 + length;
  }
  const JSON_CHUNK = 0x4e4f534a;
  const BIN_CHUNK = 0x004e4942;
  if (chunks[0]?.type !== JSON_CHUNK) return 'n’a pas de chunk JSON en tête';
  if (chunks.length > 2 || (chunks.length === 2 && chunks[1].type !== BIN_CHUNK)) return 'a des chunks inattendus';
  let gltf;
  try {
    gltf = JSON.parse(buf.toString('utf8', chunks[0].start, chunks[0].start + chunks[0].length));
  } catch {
    return 'a un JSON illisible';
  }
  const ext = [...(gltf.extensionsUsed ?? []), ...(gltf.extensionsRequired ?? [])];
  if (ext.length) return `utilise des extensions : ${ext.join(', ')}`;
  if ((gltf.buffers ?? []).some((b) => b.uri !== undefined)) return 'référence un buffer externe';
  if ((gltf.images ?? []).some((i) => i.uri !== undefined || i.bufferView === undefined)) return 'référence une image externe';
  return null;
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

  const format = spec.format ?? 'gltf';
  if (format !== 'gltf' && format !== 'glb') throw new Error(`format invalide : ${format}`);

  for (const name of spec.models) {
    if (!SAFE_NAME.test(name)) throw new Error(`nom de modèle invalide : ${name}`);
    if (format === 'glb') {
      const glbFile = path.join(from, `${name}.glb`);
      if (!fs.existsSync(glbFile)) {
        errors.push(`${pack}/${name}.glb introuvable`);
        continue;
      }
      const st = fs.lstatSync(glbFile);
      if (st.isSymbolicLink() || !st.isFile()) throw new Error(`pas un fichier ordinaire : ${glbFile}`);
      const buf = fs.readFileSync(glbFile);
      const problem = checkGlb(buf);
      if (problem) {
        errors.push(`${pack}/${name}.glb ${problem}`);
        continue;
      }
      // Writes the very bytes that were checked, not a second read of the path.
      fs.writeFileSync(path.join(to, `${name}.glb`), buf);
      copied++;
      continue;
    }
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
