import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Quaternion, Vector3, type Euler, type PerspectiveCamera } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import {
  EYE_HEIGHT,
  FPS_FOV,
  FPS_START,
  fpsObstacles,
  fpsState,
  isFps,
  isShortcut,
  isTypingTarget,
  LOOK_SPEED,
  MAX_DT,
  MOVE_KEYS,
  moveVector,
  moveWithCollision,
  PITCH_MAX,
  TURN_SPEED,
  turnInput,
  RUN_FACTOR,
  setFpsState,
  WALK_SPEED,
} from './fps.ts';
import { groundY } from './outside.ts';

/** The overhead view to give back when the visitor leaves. */
interface Saved {
  position: Vector3;
  target: Vector3;
  fov: number;
  order: Euler['order'];
  quaternion: Quaternion;
  /** The element that had focus: it gets it back on exit (keyboard users keep their place). */
  focus: HTMLElement | null;
}

/**
 * First-person view: Shift+F puts the camera on the forest path facing the gate, the physical
 * WASD keys (ZQSD on AZERTY) or the arrows walk, the mouse (pointer lock) or Q/E (A/E on
 * AZERTY) turn, Shift runs, and Escape gives the overhead view back. Only walls, pillars and towers stop the
 * visitor. While it is on, the cutaway, the orbit controls and the scene's pointer events are off.
 */
export function FpsControls() {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const gl = useThree((s) => s.gl);
  const setEvents = useThree((s) => s.setEvents);
  const get = useThree((s) => s.get);
  const pose = useRef({ x: FPS_START.x, z: FPS_START.z, yaw: FPS_START.yaw, pitch: 0 });
  const pressed = useRef(new Set<string>());
  // From each key event's shiftKey: the Shift still held from Shift+F counts.
  const running = useRef(false);
  const saved = useRef<Saved | null>(null);

  useEffect(() => {
    const canvas = gl.domElement;
    const controls = () => get().controls as OrbitControlsImpl | null;

    const requestLock = () => {
      try {
        // Recent Chromium returns a promise; it rejects when the browser refuses (for instance
        // right after the user left the lock with Escape).
        const result = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
        result?.catch?.(() => {
          if (isFps() && document.pointerLockElement !== canvas) setFpsState('fallback');
        });
      } catch {
        setFpsState('fallback');
      }
    };

    const enter = () => {
      if (isFps()) return;
      const c = controls();
      if (c) {
        // Spend any orbit momentum now, so the view saved is the one given back.
        const damping = c.enableDamping;
        c.enableDamping = false;
        c.update();
        c.enableDamping = damping;
      }
      saved.current = {
        position: camera.position.clone(),
        target: c ? c.target.clone() : new Vector3(),
        fov: camera.fov,
        order: camera.rotation.order,
        quaternion: camera.quaternion.clone(),
        focus: document.activeElement instanceof HTMLElement ? document.activeElement : null,
      };
      // Focus left on a panel or a select would take the walking keys for itself.
      saved.current.focus?.blur();
      pose.current = { x: FPS_START.x, z: FPS_START.z, yaw: FPS_START.yaw, pitch: 0 };
      pressed.current.clear();
      setEvents({ enabled: false });
      setFpsState('requesting');
      camera.fov = FPS_FOV;
      camera.updateProjectionMatrix();
      requestLock();
    };

    // Idempotent: the lock loss, an Escape key and the unmount may all call it.
    const exit = (unmounting = false) => {
      if (!isFps()) return;
      setFpsState('off');
      pressed.current.clear();
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      const s = saved.current;
      saved.current = null;
      if (s) {
        camera.position.copy(s.position);
        camera.fov = s.fov;
        camera.rotation.order = s.order;
        camera.quaternion.copy(s.quaternion);
        camera.updateProjectionMatrix();
        const c = controls();
        if (c) {
          c.target.copy(s.target);
          c.update();
        }
      }
      setEvents({ enabled: true });
      if (!unmounting && s?.focus?.isConnected) s.focus.focus({ preventScroll: true });
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (!isFps()) {
        if (isShortcut(e) && !isTypingTarget(e.target)) {
          e.preventDefault();
          enter();
        }
        return;
      }
      if (e.code === 'Escape') {
        // Captured first, so open cards and dialogs keep their own Escape for later.
        e.preventDefault();
        e.stopImmediatePropagation();
        exit();
        return;
      }
      running.current = e.shiftKey;
      // A control the user focused again (the environment select) keeps its keys.
      if (isTypingTarget(e.target)) return;
      if (MOVE_KEYS.has(e.code)) e.preventDefault();
      pressed.current.add(e.code);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      running.current = e.shiftKey;
      pressed.current.delete(e.code);
    };
    const onBlur = () => pressed.current.clear();
    const onLockChange = () => {
      if (!isFps()) {
        // A lock granted after the visitor already left (Escape while it was pending).
        if (document.pointerLockElement === canvas) document.exitPointerLock();
        return;
      }
      if (document.pointerLockElement === canvas) setFpsState('locked');
      // Escape (or the browser) released the mouse: the visitor leaves.
      else if (fpsState() === 'locked') exit();
    };
    const onLockError = () => {
      if (isFps()) setFpsState('fallback');
    };
    const onMouseMove = (e: MouseEvent) => {
      if (fpsState() !== 'locked') return;
      const p = pose.current;
      p.yaw -= e.movementX * LOOK_SPEED;
      p.pitch = Math.min(Math.max(p.pitch - e.movementY * LOOK_SPEED, -PITCH_MAX), PITCH_MAX);
    };
    const onCanvasClick = () => {
      if (fpsState() === 'fallback') requestLock();
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', onBlur);
    document.addEventListener('pointerlockchange', onLockChange);
    document.addEventListener('pointerlockerror', onLockError);
    document.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('click', onCanvasClick);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('pointerlockchange', onLockChange);
      document.removeEventListener('pointerlockerror', onLockError);
      document.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('click', onCanvasClick);
      // Leaving the page while walking: the overhead view and the mouse come back.
      exit(true);
    };
  }, [camera, gl, setEvents, get]);

  useFrame((_, delta) => {
    if (!isFps()) return;
    const p = pose.current;
    const keys = pressed.current;
    const dt = Math.min(delta, MAX_DT);
    p.yaw -= turnInput(keys) * TURN_SPEED * dt;
    const dir = moveVector(keys, p.yaw);
    if (dir.x !== 0 || dir.z !== 0) {
      const step = WALK_SPEED * (running.current ? RUN_FACTOR : 1) * dt;
      const next = moveWithCollision(p, dir.x * step, dir.z * step, fpsObstacles());
      p.x = next.x;
      p.z = next.z;
    }
    camera.position.set(p.x, groundY(p) + EYE_HEIGHT, p.z);
    camera.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
  });

  return null;
}
