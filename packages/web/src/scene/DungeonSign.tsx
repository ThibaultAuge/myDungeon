import { memo, useEffect, useMemo } from 'react';
import { BoxGeometry, CanvasTexture, CylinderGeometry, DoubleSide, MeshStandardMaterial, Shape, ShapeGeometry, SRGBColorSpace } from 'three';
import { GROUND_Y, PENNANTS, SIGN, SIGN_WIDTH, SIGN_YAW } from './forest.ts';
import { fitLabel } from './heraldry.ts';

// The dungeon's name on a wooden sign past the drawbridge, and its colour on two pennants
// framing the bridge. Next to the castle, so lit like it: no night shading. No new light: the
// painted board glows faintly through its emissive map, readable at night.

/** Height of the sign's board. */
const BOARD_H = 1.7;
/** Canvas painted on the board's front, same aspect ratio as the board. */
const CANVAS_W = 1024;
const CANVAS_H = Math.round((CANVAS_W * BOARD_H) / SIGN_WIDTH);
/** The whole sign leans back a little, towards the camera looking down on it. */
const LEAN = -0.5;
const POLE_H = 5;

const noRaycast = () => {};

const UNIT_BOX = new BoxGeometry(1, 1, 1);
const POLE = new CylinderGeometry(0.07, 0.09, POLE_H, 8);
POLE.translate(0, POLE_H / 2, 0);
const WOOD = new MeshStandardMaterial({ color: '#5b3d24', roughness: 1 });
const DARK_WOOD = new MeshStandardMaterial({ color: '#3d2918', roughness: 1 });
const IRON = new MeshStandardMaterial({ color: '#3a3a3e', roughness: 0.6, metalness: 0.5 });

/** A hanging banner with a swallowtail end, its top edge at y = 0. */
function swallowtail(w: number, h: number, notch: number): ShapeGeometry {
  const s = new Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(w / 2, -h);
  s.lineTo(0, -h + notch);
  s.lineTo(-w / 2, -h);
  s.closePath();
  return new ShapeGeometry(s);
}

const CLOTH = swallowtail(1.1, 2.6, 0.5);
const FLAG = swallowtail(0.6, 0.8, 0.22);

/** Paints the board: planks, a band of the dungeon's colour top and bottom, and the name. */
function paintBoard(name: string, color: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const g = canvas.getContext('2d');
  if (!g) return canvas;
  g.fillStyle = '#6b4a2e';
  g.fillRect(0, 0, CANVAS_W, CANVAS_H);
  // Plank joints and a little grain, always the same.
  g.strokeStyle = 'rgba(30, 18, 8, 0.55)';
  g.lineWidth = 4;
  for (const y of [CANVAS_H / 3, (CANVAS_H * 2) / 3]) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(CANVAS_W, y);
    g.stroke();
  }
  g.strokeStyle = 'rgba(30, 18, 8, 0.18)';
  g.lineWidth = 2;
  for (let i = 0; i < 14; i++) {
    const y = ((i * 37) % CANVAS_H) + 6;
    g.beginPath();
    g.moveTo(0, y);
    g.bezierCurveTo(CANVAS_W * 0.3, y + 6, CANVAS_W * 0.6, y - 6, CANVAS_W, y + 3);
    g.stroke();
  }
  const band = 22;
  g.fillStyle = color;
  g.fillRect(0, 18, CANVAS_W, band);
  g.fillRect(0, CANVAS_H - 18 - band, CANVAS_W, band);

  const font = (size: number) => `bold ${size}px Georgia, 'Times New Roman', serif`;
  const label = fitLabel(name, CANVAS_W - 140, (text, size) => {
    g.font = font(size);
    return g.measureText(text).width;
  });
  g.font = font(label.size);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = Math.max(6, label.size / 12);
  g.strokeStyle = '#21140a';
  g.strokeText(label.text, CANVAS_W / 2, CANVAS_H / 2 + 4);
  g.fillStyle = '#f4e6c4';
  g.fillText(label.text, CANVAS_W / 2, CANVAS_H / 2 + 4);
  return canvas;
}

/**
 * The materials of one dungeon: the painted board face and the coloured cloth. Created in
 * useMemo and freed in an effect cleanup, like `useGeometry` in Forest.tsx: under StrictMode
 * the cleanup runs once while the memo is kept, which is safe because three.js uploads a
 * disposed texture or material again on its next use.
 */
function useDungeonMaterials(name: string, color: string) {
  const materials = useMemo(() => {
    const texture = new CanvasTexture(paintBoard(name, color));
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 8;
    const face = new MeshStandardMaterial({ map: texture, emissiveMap: texture, emissive: '#ffffff', emissiveIntensity: 0.35, roughness: 0.9 });
    const cloth = new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.25, roughness: 0.85, side: DoubleSide });
    return { texture, face, cloth };
  }, [name, color]);
  useEffect(
    () => () => {
      materials.texture.dispose();
      materials.face.dispose();
      materials.cloth.dispose();
    },
    [materials],
  );
  return materials;
}

function Pennant({ x, z, cloth }: { x: number; z: number; cloth: MeshStandardMaterial }) {
  return (
    <group position={[x, GROUND_Y, z]}>
      <mesh geometry={POLE} material={DARK_WOOD} castShadow raycast={noRaycast} />
      <mesh geometry={UNIT_BOX} material={DARK_WOOD} position={[0, POLE_H - 0.12, 0.02]} scale={[1.3, 0.09, 0.09]} raycast={noRaycast} />
      <mesh geometry={UNIT_BOX} material={IRON} position={[0, POLE_H + 0.03, 0]} scale={[0.16, 0.16, 0.16]} raycast={noRaycast} />
      <mesh geometry={CLOTH} material={cloth} position={[0, POLE_H - 0.18, 0.08]} castShadow raycast={noRaycast} />
    </group>
  );
}

/**
 * The sign with the dungeon's name and the two pennants of its colour. Decorative: the name
 * is also the page's sr-only h1 and the environment select, and the colour carries no meaning
 * of its own (keep it so, or give that meaning as text too). Memoised: OfficeScene renders
 * often and the sign only changes with the dungeon.
 */
export const DungeonSign = memo(function DungeonSign({ name, color }: { name: string; color: string }) {
  const { face, cloth } = useDungeonMaterials(name, color);
  // Box faces: +x, -x, +y, -y, +z (front, painted), -z.
  const board = useMemo(() => [WOOD, WOOD, WOOD, WOOD, face, WOOD], [face]);
  const postX = SIGN_WIDTH / 2 - 0.45;
  const postH = 3.4;
  return (
    <group name="dungeon-sign">
      {/* Turned towards the path first, then leant back in its own frame. */}
      <group position={[SIGN.x, GROUND_Y, SIGN.z]} rotation={[0, SIGN_YAW, 0]}>
      <group rotation={[LEAN, 0, 0]}>
        {[-postX, postX].map((x) => (
          <mesh key={x} geometry={UNIT_BOX} material={DARK_WOOD} position={[x, postH / 2 - 0.4, -0.1]} scale={[0.22, postH, 0.22]} castShadow raycast={noRaycast} />
        ))}
        <mesh geometry={UNIT_BOX} material={board} position={[0, 1.95, 0]} scale={[SIGN_WIDTH, BOARD_H, 0.14]} castShadow raycast={noRaycast} />
        {/* A small flag of the dungeon's colour on top of the left post. */}
        <mesh geometry={UNIT_BOX} material={DARK_WOOD} position={[-postX, postH - 0.4 + 0.5, -0.1]} scale={[0.07, 1, 0.07]} raycast={noRaycast} />
        <mesh geometry={FLAG} material={cloth} position={[-postX + 0.33, postH - 0.4 + 0.95, -0.08]} raycast={noRaycast} />
      </group>
      </group>
      {PENNANTS.map((p) => (
        <Pennant key={p.x} x={p.x} z={p.z} cloth={cloth} />
      ))}
    </group>
  );
});
