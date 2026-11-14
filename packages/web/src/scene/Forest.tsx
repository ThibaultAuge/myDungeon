import { useLayoutEffect, useMemo, useRef } from 'react';
import {
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  IcosahedronGeometry,
  Matrix4,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  Shape,
  ShapeGeometry,
  SRGBColorSpace,
  Vector3,
  Vector4,
  type InstancedMesh,
  type Material,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { OUTER } from './dungeon.ts';
import { BRIDGE, GROUND_Y, MOAT, NIGHT_SKY, PATH_HALF_WIDTH, pathPoints, scatterTrees, WATER_Y, type Tree } from './forest.ts';

// The night forest around the castle. The castle keeps its warm light; everything here is
// darkened and tinted by `nightify`, and fades into the sky with the distance to the castle.

const nightUniforms = {
  uNightSky: { value: new Color(NIGHT_SKY) },
  uCastle: { value: new Vector4(OUTER.x0, OUTER.z0, OUTER.x1, OUTER.z1) },
  /** Share of the light kept right next to the castle walls (the castle's glow)… */
  uNearLight: { value: 0.34 },
  /** …and in the forest, past the glow. */
  uFarLight: { value: 0.11 },
};

/** Replaces a shader chunk, and says so in development when three renamed it. */
function inject(source: string, chunk: string, code: string): string {
  if (import.meta.env.DEV && !source.includes(chunk)) console.warn(`nightify: ${chunk} not found, the forest is not darkened`);
  return source.replace(chunk, `${chunk}\n${code}`);
}

/**
 * Night shading for a material of the surroundings: the lit colour is dimmed and tinted
 * moon-blue, a little less near the castle, then fades into the sky colour far away. Done
 * per material instead of with scene fog, which would also darken the castle when the camera
 * moves back.
 */
function nightify<T extends Material>(material: T): T {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, nightUniforms);
    let vs = inject(shader.vertexShader, '#include <common>', 'varying vec3 vNightPos;');
    vs = inject(
      vs,
      '#include <project_vertex>',
      `vec4 nightPos = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        nightPos = instanceMatrix * nightPos;
      #endif
      vNightPos = (modelMatrix * nightPos).xyz;`,
    );
    let fs = inject(
      shader.fragmentShader,
      '#include <common>',
      'varying vec3 vNightPos;\nuniform vec3 uNightSky;\nuniform vec4 uCastle;\nuniform float uNearLight;\nuniform float uFarLight;',
    );
    fs = inject(
      fs,
      '#include <opaque_fragment>',
      `vec2 nightOut = max(uCastle.xy - vNightPos.xz, vNightPos.xz - uCastle.zw);
      float nightDist = length(max(nightOut, 0.0));
      float nightLight = mix(uNearLight, uFarLight, smoothstep(0.0, 14.0, nightDist));
      vec3 nightColor = gl_FragColor.rgb * nightLight * vec3(0.62, 0.72, 1.0);
      gl_FragColor.rgb = mix(nightColor, uNightSky, smoothstep(30.0, 150.0, nightDist));`,
    );
    shader.vertexShader = vs;
    shader.fragmentShader = fs;
  };
  material.customProgramCacheKey = () => 'night';
  // The background colour is not tone mapped: the far fade must not be either, or the
  // horizon shows a band of another blue. Neutral tone mapping barely changes such dark colours.
  material.toneMapped = false;
  return material;
}

// The scenery is static and lives as long as the page, like the kit's shared materials: one
// material per surface, created once.
const MAT = {
  tree: nightify(new MeshLambertMaterial({ vertexColors: true, flatShading: true })),
  ground: nightify(new MeshLambertMaterial({ color: '#33402a' })),
  bank: nightify(new MeshLambertMaterial({ color: '#3a2e22' })),
  water: nightify(new MeshStandardMaterial({ color: '#0f2236', roughness: 0.12, metalness: 0.3 })),
  plank: nightify(new MeshLambertMaterial({ color: '#6b4a2e' })),
  beam: nightify(new MeshLambertMaterial({ color: '#4a3220' })),
  // Drawn just above the ground without fighting it, even far from the camera.
  path: nightify(new MeshLambertMaterial({ color: '#5a4630', polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })),
};

/** A geometry built once for a component and freed when it unmounts. */
function useGeometry<T extends BufferGeometry>(build: () => T): T {
  const geometry = useMemo(build, []); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => () => geometry.dispose(), [geometry]);
  return geometry;
}

/** Colours a geometry with one vertex colour (merged trees keep trunk and foliage apart). */
function painted(geometry: BufferGeometry, hex: string, y = 0): BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  if (g !== geometry) geometry.dispose();
  g.translate(0, y, 0);
  const c = new Color(hex);
  const n = g.getAttribute('position').count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new BufferAttribute(colors, 3));
  g.deleteAttribute('uv');
  return g;
}

const TRUNK = '#5a3f2c';
const PINE = ['#24503a', '#2a5a41', '#316548'];
const LEAVES = ['#3b6a35', '#467640'];

/** One tree model per kind and level of detail, about 4.5 m high, standing on y = 0. */
function treeGeometry(kind: Tree['kind'], detailed: boolean): BufferGeometry {
  const seg = detailed ? 7 : 5;
  const parts =
    kind === 'pine'
      ? [
          painted(new CylinderGeometry(0.12, 0.2, 1.2, detailed ? 6 : 4), TRUNK, 0.6),
          painted(new ConeGeometry(1.25, 1.9, seg), PINE[0], 1.75),
          ...(detailed ? [painted(new ConeGeometry(0.95, 1.6, seg), PINE[1], 2.65)] : []),
          painted(new ConeGeometry(0.62, 1.4, seg), PINE[2], detailed ? 3.55 : 3.0),
        ]
      : [
          painted(new CylinderGeometry(0.14, 0.22, 1.8, detailed ? 6 : 4), TRUNK, 0.9),
          painted(new IcosahedronGeometry(1.3, 0), LEAVES[0], 2.7),
          ...(detailed ? [painted(new IcosahedronGeometry(0.85, 0), LEAVES[1], 3.6)] : []),
        ];
  const merged = mergeGeometries(parts)!;
  merged.computeVertexNormals();
  for (const p of parts) p.dispose();
  return merged;
}

const m = new Matrix4();
const q = new Quaternion();
const up = new Vector3(0, 1, 0);
const pos = new Vector3();
const size = new Vector3();
const tint = new Color();

function TreeInstances({ trees, kind, detailed }: { trees: Tree[]; kind: Tree['kind']; detailed: boolean }) {
  const ref = useRef<InstancedMesh>(null);
  const geometry = useGeometry(() => treeGeometry(kind, detailed));
  const mine = useMemo(() => trees.filter((t) => t.kind === kind), [trees, kind]);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    mine.forEach((t, i) => {
      q.setFromAxisAngle(up, t.rotY);
      mesh.setMatrixAt(i, m.compose(pos.set(t.x, GROUND_Y, t.z), q, size.setScalar(t.scale)));
      mesh.setColorAt(i, tint.setScalar(t.shade));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [mine]);
  return <instancedMesh key={mine.length} ref={ref} args={[geometry, MAT.tree, mine.length]} />;
}

/** The forest floor, out to the horizon, with the moat cut out. */
function Ground() {
  const geometry = useGeometry(() => {
    const shape = new Shape();
    shape.absarc(0, 0, 320, 0, Math.PI * 2, false);
    // The shape is drawn in x/y and laid flat by a -90° turn on x: y becomes -z.
    const hole = new Shape();
    hole.moveTo(MOAT.x0, -MOAT.z0);
    hole.lineTo(MOAT.x1, -MOAT.z0);
    hole.lineTo(MOAT.x1, -MOAT.z1);
    hole.lineTo(MOAT.x0, -MOAT.z1);
    hole.closePath();
    shape.holes.push(hole);
    return new ShapeGeometry(shape, 48);
  });
  return <mesh geometry={geometry} material={MAT.ground} rotation={[-Math.PI / 2, 0, 0]} position={[0, GROUND_Y, 0]} />;
}

/** Thickness of the earth banks around the moat. */
const BANK_T = 0.3;
/** The bank tops stop just under the ground, so the two never fight over the same pixels. */
const BANK_TOP = GROUND_Y - 0.01;

/** The moat: dark water between earth banks; the castle's stone base is its north side. */
function Moat() {
  const unit = useGeometry(() => new BoxGeometry(1, 1, 1));
  const plane = useGeometry(() => new PlaneGeometry(MOAT.x1 - MOAT.x0, MOAT.z1 - MOAT.z0));
  const bottom = WATER_Y - 0.4;
  const h = BANK_TOP - bottom;
  const cy = (BANK_TOP + bottom) / 2;
  const cx = (MOAT.x0 + MOAT.x1) / 2;
  const cz = (MOAT.z0 + MOAT.z1) / 2;
  const w = MOAT.x1 - MOAT.x0;
  const d = MOAT.z1 - MOAT.z0;
  const t = BANK_T;
  // The north bank beyond the castle corners, where the stone base no longer closes the moat.
  const westSpan = OUTER.x0 - MOAT.x0;
  const eastSpan = MOAT.x1 - OUTER.x1;
  const banks: [number, number, number, number, number][] = [
    [cx, MOAT.z1 + t / 2, w + 2 * t, t, 0],
    [MOAT.x0 - t / 2, cz, t, d, 1],
    [MOAT.x1 + t / 2, cz, t, d, 2],
    [MOAT.x0 + westSpan / 2, MOAT.z0 - t / 2, westSpan, t, 3],
    [MOAT.x1 - eastSpan / 2, MOAT.z0 - t / 2, eastSpan, t, 4],
  ];
  return (
    <group>
      <mesh geometry={plane} material={MAT.water} position={[cx, WATER_Y, cz]} rotation={[-Math.PI / 2, 0, 0]} />
      {banks.map(([x, z, sx, sz, k]) => (
        <mesh key={k} geometry={unit} material={MAT.bank} position={[x, cy, z]} scale={[sx, h, sz]} />
      ))}
    </group>
  );
}

/**
 * The lowered drawbridge: planks on two beams, sloping from the gate to the far bank. It has
 * no chains: they would hang from the gate, which sinks with the cutaway, and float in the air.
 */
function Drawbridge() {
  const unit = useGeometry(() => new BoxGeometry(1, 1, 1));
  const len = BRIDGE.z1 - BRIDGE.z0;
  const drop = -GROUND_Y;
  const tilt = Math.atan2(drop, len);
  const width = BRIDGE.x1 - BRIDGE.x0;
  const cx = (BRIDGE.x0 + BRIDGE.x1) / 2;
  const planks = Math.round(len / 0.36);
  const step = Math.hypot(len, drop) / planks;
  return (
    <group position={[cx, -0.06, BRIDGE.z0]} rotation={[tilt, 0, 0]}>
      {Array.from({ length: planks }, (_, i) => (
        <mesh key={i} geometry={unit} material={MAT.plank} position={[0, 0, (i + 0.5) * step]} scale={[width, 0.1, step - 0.04]} />
      ))}
      {[-1, 1].map((s) => (
        <mesh
          key={s}
          geometry={unit}
          material={MAT.beam}
          position={[(s * (width - 0.16)) / 2, -0.12, (planks * step) / 2]}
          scale={[0.16, 0.18, planks * step]}
        />
      ))}
    </group>
  );
}

/** The dirt path from the drawbridge into the forest, as a flat ribbon. */
function Path() {
  const geometry = useGeometry(() => {
    const pts = pathPoints();
    const positions = new Float32Array(pts.length * 2 * 3);
    const index: number[] = [];
    pts.forEach((p, i) => {
      const a = pts[Math.max(i - 1, 0)];
      const b = pts[Math.min(i + 1, pts.length - 1)];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz) || 1;
      // Perpendicular to the direction of travel, to its left.
      const nx = -dz / len;
      const nz = dx / len;
      positions.set([p.x + nx * PATH_HALF_WIDTH, GROUND_Y, p.z + nz * PATH_HALF_WIDTH], i * 6);
      positions.set([p.x - nx * PATH_HALF_WIDTH, GROUND_Y, p.z - nz * PATH_HALF_WIDTH], i * 6 + 3);
      // Counter-clockwise seen from above: the faces look up.
      if (i > 0) {
        const k = i * 2;
        index.push(k - 2, k, k - 1, k - 1, k, k + 1);
      }
    });
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(positions, 3));
    g.setIndex(index);
    g.computeVertexNormals();
    return g;
  });
  return <mesh geometry={geometry} material={MAT.path} />;
}

/** Radius of the horizon ring, inside the edge of the ground. */
const HORIZON_R = 280;
const SKYLINE_W = 2048;
const SKYLINE_H = 256;

/** A jagged line of pine tops, painted once; it starts and ends at the same height so it tiles. */
function paintSkyline(ctx: CanvasRenderingContext2D): void {
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const base = SKYLINE_H * 0.75;
  ctx.fillStyle = '#060912';
  ctx.beginPath();
  ctx.moveTo(0, SKYLINE_H);
  ctx.lineTo(0, base);
  let x = 0;
  while (x < SKYLINE_W) {
    const w = Math.min(10 + rand() * 18, SKYLINE_W - x);
    const h = 40 + rand() * 75 + (rand() < 0.1 ? 25 : 0);
    ctx.lineTo(x + w / 2, SKYLINE_H - h);
    x += w;
    ctx.lineTo(x, base);
  }
  ctx.lineTo(SKYLINE_W, SKYLINE_H);
  ctx.closePath();
  ctx.fill();
}

/**
 * The forest beyond the last trees: a ring of treetop silhouettes painted once on a canvas at
 * start-up (no image file to load), just darker than the sky.
 */
function Horizon() {
  const material = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = SKYLINE_W;
    canvas.height = SKYLINE_H;
    const ctx = canvas.getContext('2d');
    if (ctx) paintSkyline(ctx);
    const map = new CanvasTexture(canvas);
    map.colorSpace = SRGBColorSpace;
    map.wrapS = RepeatWrapping;
    map.repeat.set(4, 1);
    return new MeshBasicMaterial({ map, side: BackSide, alphaTest: 0.5, toneMapped: false });
  }, []);
  useLayoutEffect(
    () => () => {
      material.map?.dispose();
      material.dispose();
    },
    [material],
  );
  const geometry = useGeometry(() => new CylinderGeometry(HORIZON_R, HORIZON_R, 40, 64, 1, true));
  return <mesh geometry={geometry} material={material} position={[0, GROUND_Y + 18, 0]} />;
}

/** Everything around the castle: ground, moat, drawbridge, path, trees and the horizon. */
export function Forest() {
  const trees = useMemo(() => scatterTrees(), []);
  return (
    <group>
      <Ground />
      <Moat />
      <Drawbridge />
      <Path />
      <TreeInstances trees={trees.near} kind="pine" detailed />
      <TreeInstances trees={trees.near} kind="round" detailed />
      <TreeInstances trees={trees.far} kind="pine" detailed={false} />
      <TreeInstances trees={trees.far} kind="round" detailed={false} />
      <Horizon />
    </group>
  );
}
