// Estado de una partida. Solo el motor lo modifica.
import type { EquipSlot, GraftSlot } from "./schema.js";
import type { Pack } from "./pack.js";

export interface RoomState {
  visitada: boolean;
  desc_generada?: string; // la escribe el narrador una vez por partida
  cambios: string[]; // flags que han cambiado la sala (frases sueltas del pack)
  objetos: string[];
  disparados: string[];
  acciones_hechas: string[];
}

export interface NpcState {
  confianza: number;
  memoria_resumen: string;
  vivo: boolean;
  acciones_hechas: string[];
  turnos_dialogo: number;
}

export interface GameState {
  pack: string;
  pack_version: string;
  sala: string;
  sala_anterior?: string;
  inventario: string[];
  equipo: Partial<Record<EquipSlot, string>>;
  injertos: Partial<Record<GraftSlot, string>>;
  vida: number;
  vida_max: number;
  ataque_base: number;
  defensa_base: number;
  corrupcion: number;
  umbral_alcanzado: number; // último umbral de corrupción anunciado
  flags: Record<string, boolean>;
  salas: Record<string, RoomState>;
  npcs: Record<string, NpcState>;
  enemigos: Record<string, { vida: number; vivo: boolean }>;
  grupo?: { estado: string; visto: boolean };
  usos_hechos: string[];
  combate?: { enemigo: string };
  dialogo?: { npc: string };
  final?: string;
  turno: number;
  seed: number;
  rng: number; // estado interno del generador; avanza con cada tirada
}

export function initialState(pack: Pack, seed: number): GameState {
  const q = pack.quest;
  const salas: Record<string, RoomState> = {};
  for (const l of pack.data.locations) {
    salas[l.id] = { visitada: false, cambios: [], objetos: [...l.objetos], disparados: [], acciones_hechas: [] };
  }
  const npcs: Record<string, NpcState> = {};
  for (const n of pack.data.npcs) {
    npcs[n.id] = { confianza: n.confianza_inicial, memoria_resumen: "", vivo: true, acciones_hechas: [], turnos_dialogo: 0 };
  }
  const enemigos: Record<string, { vida: number; vivo: boolean }> = {};
  for (const e of pack.data.enemies) enemigos[e.id] = { vida: e.vida, vivo: true };
  return {
    pack: pack.data.id,
    pack_version: pack.data.version,
    sala: q.inicio.sala,
    inventario: [...q.inicio.inventario],
    equipo: { ...q.inicio.equipo },
    injertos: {},
    vida: q.inicio.vida,
    vida_max: q.inicio.vida,
    ataque_base: q.inicio.ataque,
    defensa_base: q.inicio.defensa,
    corrupcion: q.inicio.corrupcion,
    umbral_alcanzado: 0,
    flags: {},
    salas,
    npcs,
    enemigos,
    grupo: q.grupo ? { estado: "atrapada", visto: false } : undefined,
    usos_hechos: [],
    turno: 0,
    seed,
    rng: seed >>> 0,
  };
}

/** Todo lo que el jugador lleva: inventario, equipo e injertos. */
export function carried(s: GameState): string[] {
  return [...s.inventario, ...Object.values(s.equipo), ...Object.values(s.injertos)].filter((x): x is string => !!x);
}

export function powers(s: GameState, pack: Pack): Set<string> {
  const out = new Set<string>();
  const equipped = new Set([...Object.values(s.equipo), ...Object.values(s.injertos)]);
  for (const id of carried(s)) {
    const it = pack.item(id);
    if (it.poder_si === "equipado" && !equipped.has(id)) continue;
    for (const p of it.poderes) out.add(p);
  }
  return out;
}

export function attack(s: GameState, pack: Pack): number {
  let a = s.ataque_base;
  for (const id of [...Object.values(s.equipo), ...Object.values(s.injertos)]) if (id) a += pack.item(id).stats?.ataque ?? 0;
  return a;
}

export function defense(s: GameState, pack: Pack): number {
  let d = s.defensa_base;
  for (const id of [...Object.values(s.equipo), ...Object.values(s.injertos)]) if (id) d += pack.item(id).stats?.defensa ?? 0;
  return d;
}
