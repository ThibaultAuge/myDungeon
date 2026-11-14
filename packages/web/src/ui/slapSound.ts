// Slap sound: a recorded slap (Freesound #667099 by thenerdclubboi, CC0, see
// packages/web/public/sounds/LICENSE.txt), played through Web Audio so that quick slaps
// overlap instead of cutting each other off.

const SLAP_URL = `${import.meta.env.BASE_URL}sounds/slap.m4a`;
const VOLUME = 0.6;
/** Sounds playing at once: more would only clip. */
const MAX_VOICES = 3;

/** The one AudioContext of the page, never closed nor recreated (the decoded sound relies on it). */
let context: AudioContext | null = null;
/** The file's bytes, fetched once. A failure clears it, so the next slap tries again. */
let bytes: Promise<ArrayBuffer | null> | null = null;
/** The decoded sound. A failure clears it too. */
let decoded: Promise<AudioBuffer | null> | null = null;
let resuming: Promise<void> | null = null;
let voices = 0;
let warned = false;

function audio(): AudioContext | null {
  if (context) return context;
  const Ctor = typeof window !== 'undefined' ? window.AudioContext : undefined;
  if (!Ctor) return null;
  try {
    context = new Ctor();
  } catch {
    return null;
  }
  return context;
}

function failed(): null {
  bytes = null;
  decoded = null;
  if (!warned) {
    warned = true;
    console.warn('Slap sound unavailable', SLAP_URL);
  }
  return null;
}

function fetchBytes(): Promise<ArrayBuffer | null> {
  bytes ??= fetch(SLAP_URL)
    .then((r) => (r.ok ? r.arrayBuffer() : failed()))
    .catch(failed);
  return bytes;
}

/**
 * Fetches the file ahead of the first slap, so that it plays without delay. Needs no
 * AudioContext: one created outside a user gesture would be blocked by the browser.
 */
export function preloadSlapSound(): void {
  void fetchBytes();
}

function sound(ctx: AudioContext): Promise<AudioBuffer | null> {
  // decodeAudioData detaches the buffer it is given: decode a copy, once.
  decoded ??= fetchBytes()
    .then((b) => (b ? ctx.decodeAudioData(b.slice(0)) : failed()))
    .catch(failed);
  return decoded;
}

/** Plays the slap. Silent when Web Audio or the file is missing, or the browser keeps audio blocked. */
export function playSlapSound(): void {
  const ctx = audio();
  if (!ctx) return;
  // Resumed inside the click: the browser's autoplay policy allows it then. Slaps made
  // while a resume is pending are dropped, so blocked slaps never pile up into one burst.
  if (ctx.state === 'running') void sound(ctx).then((b) => b && play(ctx, b));
  else if (!resuming)
    resuming = ctx
      .resume()
      .then(() => sound(ctx))
      .then((b) => {
        if (b) play(ctx, b);
      })
      .catch(() => {})
      .finally(() => (resuming = null));
}

function play(ctx: AudioContext, buffer: AudioBuffer): void {
  if (voices >= MAX_VOICES) return;
  try {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = VOLUME;
    source.connect(gain).connect(ctx.destination);
    voices++;
    source.onended = () => {
      voices--;
      gain.disconnect();
    };
    source.start();
  } catch {
    // A sound effect never breaks the scene.
  }
}
