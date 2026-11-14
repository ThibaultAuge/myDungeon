import { KIT_SCALE, type KitItem } from './dungeon.ts';
import type { PropKind, RoomDef } from './layout.ts';

// Decoration pieces as data: each decor kind is a few KayKit models placed around the prop's
// origin. Being plain data, every copy of a model across the whole map is drawn by one
// instanced mesh (see decorPlacement). Pure, no three.js: testable in node.

/** One model of a decor kind, relative to the prop: metres, Y turn, scale × KIT_SCALE. */
export interface DecorPiece {
  /** Manifest pack. */
  pack: string;
  name: string;
  x: number;
  z: number;
  y?: number;
  rot?: number;
  s?: number;
  /** Casts a shadow (default: only when big enough to show one). */
  shadow?: boolean;
}

const Q = Math.PI / 2;

/** Height for a model whose lowest point is minY (pack units) to rest on y at scale s. */
function rest(y: number, minY: number, s: number): number {
  return y - minY * KIT_SCALE * s;
}

/**
 * Decor kinds drawn from models only. A decor kind missing here (the animated skeleton) has
 * its own renderer in PROPS.
 */
export const DECOR_RECIPES: Partial<Record<PropKind, readonly DecorPiece[]>> = {
  crates: [{ pack: 'dungeon', name: 'crates_stacked', x: 0, z: 0, s: 0.7 }],
  barrels: [
    { pack: 'dungeon', name: 'barrel_small', x: -0.4, z: 0 },
    { pack: 'dungeon', name: 'barrel_small', x: 0.4, z: 0.05 },
  ],
  chest: [{ pack: 'dungeon', name: 'chest_gold', x: 0, z: 0, s: 0.75 }],
  coins: [{ pack: 'dungeon', name: 'coin_stack_large', x: 0, z: 0, s: 0.45 }],
  candle: [{ pack: 'dungeon', name: 'candle_lit', x: 0, z: 0, s: 0.8 }],
  // A KayKit rug, 3 × 2 m in the pack: about 2.8 × 1.9 m here.
  rug: [{ pack: 'furniture', name: 'rug_rectangle_stripes_A', x: 0, z: 0, s: 1.25, shadow: false }],
  chartChest: [
    { pack: 'dungeon', name: 'trunk_medium_A', x: 0, z: 0, s: 0.9 },
    { pack: 'tools', name: 'map_rolled', x: -0.1, z: 0.05, y: rest(0.5, -0.12, 0.8), rot: Q + 0.2, s: 0.8 },
    { pack: 'tools', name: 'map_rolled', x: 0.15, z: -0.1, y: rest(0.5, -0.12, 0.8), rot: Q - 0.3, s: 0.8 },
  ],
  sacks: [
    { pack: 'resources', name: 'Textiles_Stack_Small', x: 0, z: 0, s: 0.8 },
    { pack: 'mixed1', name: 'flax_flower_A', x: 0.65, z: 0.45, s: 0.8 },
  ],
  weeds: [
    { pack: 'nature', name: 'Grass_2_B_Color1', x: 0, z: 0, s: 0.8, shadow: false },
    { pack: 'nature', name: 'Grass_1_A_Color1', x: 0.3, z: 0.2, rot: 1.1, s: 0.9, shadow: false },
    { pack: 'nature', name: 'Rock_1_A_Color1', x: -0.3, z: 0.15, s: 0.5 },
  ],
  bookPile: [
    { pack: 'furniture', name: 'book_set', x: -0.1, z: 0, y: rest(0, -0.25, 0.8), rot: 0.3, s: 0.8 },
    { pack: 'mixed2', name: 'book_mimic', x: 0.25, z: 0.25, y: rest(0, -0.14, 0.7), rot: -0.6, s: 0.7 },
  ],
  lumber: [
    { pack: 'resources', name: 'Wood_Planks_Stack_Medium', x: 0, z: -0.15, s: 0.7 },
    { pack: 'resources', name: 'Wood_Log_Stack', x: 0.05, z: 0.35, rot: Q, s: 0.45 },
  ],
  forge: [
    { pack: 'tools', name: 'anvil', x: -0.25, z: 0, s: 0.7 },
    { pack: 'tools', name: 'grindstone', x: 0.45, z: 0, rot: Q, s: 0.4 },
  ],
  fuel: [
    { pack: 'resources', name: 'Fuel_A_Barrels', x: 0, z: -0.1, s: 0.75 },
    { pack: 'resources', name: 'Parts_Pile_Small', x: -0.3, z: 0.4, s: 0.6 },
    { pack: 'resources', name: 'Parts_Cog', x: 0.45, z: 0.45, y: rest(0, -0.2, 0.8), rot: 0.4, s: 0.8 },
  ],
  treasury: [
    { pack: 'resources', name: 'Gold_Bars_Stack_Medium', x: -0.3, z: -0.05, s: 0.9 },
    { pack: 'resources', name: 'Silver_Bars_Stack_Small', x: 0.4, z: -0.1, rot: 0.3, s: 0.9 },
    { pack: 'resources', name: 'Gold_Nuggets', x: 0.3, z: 0.4, s: 0.7 },
    { pack: 'dungeon', name: 'coin_stack_large', x: -0.5, z: 0.4, s: 0.5 },
  ],
  gamerCorner: [
    { pack: 'mixed2', name: 'gamer_chair_A', x: 0, z: 0, s: 0.75 },
    { pack: 'mixed2', name: 'handheld_console', x: 0, z: 0.06, y: 0.38, rot: 0.2, s: 0.5 },
    { pack: 'mixed1', name: 'guitar_A', x: 0.55, z: -0.3, y: rest(0, -1.35, 0.6), rot: -0.4, s: 0.6 },
  ],
  // A corner web hanging from the top of the wall; it sits in the room's back corners.
  cobwebs: [{ pack: 'mixed2', name: 'cobweb_C', x: 0, z: 0, y: 2.7, rot: Math.PI, s: 0.55, shadow: false }],
  prison: [
    { pack: 'halloween', name: 'ribcage', x: -0.15, z: 0, y: rest(0, -0.39, 0.6), rot: 0.6, s: 0.6 },
    { pack: 'halloween', name: 'bone_A', x: 0.35, z: 0.25, y: rest(0, -0.14, 0.6), rot: 1.2, s: 0.6 },
    { pack: 'mixed1', name: 'chain_shackle', x: 0.3, z: -0.25, y: rest(0, -0.08, 0.9), rot: 0.4, s: 0.9 },
  ],
  beartrap: [{ pack: 'mixed2', name: 'beartrap_A', x: 0, z: 0, rot: 0.3, s: 0.55 }],
  logs: [{ pack: 'resources', name: 'Wood_Log_Stack', x: 0, z: 0, s: 0.75 }],
  pantry: [
    { pack: 'restaurant', name: 'crate_carrots', x: -0.42, z: 0, s: 0.38 },
    { pack: 'restaurant', name: 'crate_potatoes', x: 0.42, z: 0, rot: 0.2, s: 0.38 },
  ],
};

/** Key of an instanced decor batch: one per pack, model and shadow choice. */
export interface DecorBatch {
  pack: string;
  name: string;
  shadow: boolean;
  items: KitItem[];
}

/**
 * Every decor piece of the given rooms in world coordinates, grouped by model so that each
 * model is one instanced draw (per mesh) for the whole map.
 */
export function decorPlacement(rooms: readonly RoomDef[]): DecorBatch[] {
  const batches = new Map<string, DecorBatch>();
  for (const room of rooms) {
    for (const prop of room.props) {
      const pieces = DECOR_RECIPES[prop.kind];
      if (!pieces || prop.post) continue;
      const turn = prop.rot ?? 0;
      const c = Math.cos(turn);
      const sn = Math.sin(turn);
      for (const p of pieces) {
        const s = (p.s ?? 1) * KIT_SCALE;
        const shadow = p.shadow ?? (p.s ?? 1) >= 0.6;
        const key = `${p.pack}/${p.name}/${shadow}`;
        let batch = batches.get(key);
        if (!batch) {
          batch = { pack: p.pack, name: p.name, shadow, items: [] };
          batches.set(key, batch);
        }
        // Same turn convention as a three.js Y rotation of the prop's group.
        batch.items.push({
          x: room.cx + prop.x + p.x * c + p.z * sn,
          y: p.y ?? 0,
          z: room.cz + prop.z - p.x * sn + p.z * c,
          rotY: turn + (p.rot ?? 0),
          scale: [s, s, s],
        });
      }
    }
  }
  return [...batches.values()];
}
