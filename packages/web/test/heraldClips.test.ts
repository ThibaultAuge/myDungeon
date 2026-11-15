// The herald's one-shot gestures, checked against the KayKit animation files themselves: the
// lengths celebrate.ts hard-codes must match the clips, or the wave and the cheer would be cut
// short or held on a frozen frame. Helpers copied from dungeon.test.ts (kept separate on purpose).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CLIP_FILE, type KitClip } from '../src/scene/clipCatalog.ts';
import { CHEERING_CLIP_TIME, TRUMPET_CLIP, WAVING_CLIP_TIME } from '../src/scene/celebrate.ts';

const PUBLIC_KAYKIT = fileURLToPath(new URL('../public/kaykit/', import.meta.url));
const JSON_CHUNK = 0x4e4f534a;

/** The parts of a glTF JSON chunk the clip checks read. */
interface RigJson {
  accessors?: { max?: number[] }[];
  animations?: { name?: string; samplers: { input: number }[] }[];
}

/** The JSON chunk of a binary glTF 2 file (the first chunk, as the format requires). */
function readGlbJson(buf: Buffer): RigJson {
  if (buf.length < 20 || buf.toString('latin1', 0, 4) !== 'glTF') throw new Error('not a binary glTF');
  const length = buf.readUInt32LE(12);
  if (buf.readUInt32LE(16) !== JSON_CHUNK) throw new Error('no JSON chunk first');
  return JSON.parse(buf.toString('utf8', 20, 20 + length)) as RigJson;
}

const glbJson = (pack: string, name: string): RigJson =>
  readGlbJson(fs.readFileSync(path.join(PUBLIC_KAYKIT, pack, `${name}.glb`)));

/** A clip's length in seconds (its last keyframe: the largest time of all its sampler inputs), or undefined when absent. */
function clipLength(clip: KitClip): number | undefined {
  const json = glbJson('animations', CLIP_FILE[clip]);
  const anim = json.animations?.find((a) => a.name === clip);
  if (!anim) return undefined;
  return Math.max(...anim.samplers.map((s) => json.accessors?.[s.input]?.max?.[0] ?? 0));
}

describe('herald clips in the animation files', () => {
  /**
   * Verifies that each herald one-shot clip constant matches the clip length in the file
   */
  it.each([
    ['Cheering', CHEERING_CLIP_TIME],
    ['Waving', WAVING_CLIP_TIME],
  ] as const)('times %s as long as the clip in Rig_Medium', (clip, time) => {
    expect(CLIP_FILE[clip]).toBe('Rig_Medium_Simulation');
    const length = clipLength(clip);
    expect(length, `${clip} found`).toBeDefined();
    expect(length!).toBeGreaterThan(0);
    expect(length!).toBeCloseTo(time, 3);
  });

  /** Verifies that the trumpet clip exists, in the file the catalog names, with a length */
  it('finds TRUMPET_CLIP in its animation file', () => {
    expect(CLIP_FILE[TRUMPET_CLIP]).toBeDefined();
    const length = clipLength(TRUMPET_CLIP);
    expect(length, `${TRUMPET_CLIP} found`).toBeDefined();
    expect(length!).toBeGreaterThan(0);
  });
});
