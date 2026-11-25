// Generador determinista (mulberry32). El estado vive en GameState.rng, así que
// con el mismo estado y el mismo comando el resultado es siempre el mismo.
import type { GameState } from "./state.js";

export function nextRandom(s: GameState): number {
  let t = (s.rng = (s.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Entero en [min, max]. */
export function roll(s: GameState, min: number, max: number): number {
  return min + Math.floor(nextRandom(s) * (max - min + 1));
}

export function pick<T>(s: GameState, arr: readonly T[]): T {
  return arr[roll(s, 0, arr.length - 1)]!;
}
