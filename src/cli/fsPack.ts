// Carga un pack desde una carpeta (solo Node: CLI y tests). El Worker importará
// los JSON directamente en el bundle.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadPack, type Pack } from "../engine/pack.js";

const FILES = ["quest", "items", "recipes", "locations", "npcs", "enemies"] as const;

export function readPackDir(dir: string): unknown {
  const read = (f: string) => JSON.parse(readFileSync(join(dir, `${f}.json`), "utf8"));
  const meta = read("pack");
  const out: Record<string, unknown> = { ...meta };
  for (const f of FILES) out[f] = read(f);
  return out;
}

export function loadPackDir(dir: string): Pack {
  return loadPack(readPackDir(dir));
}
