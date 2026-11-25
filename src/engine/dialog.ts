// Diálogo con NPC, lado motor. El motor decide qué sabe el NPC en cada momento
// (los secretos solo entran cuando se cumple su condición) y valida lo que
// propone el LLM. El LLM nunca toca el estado.
import type { Pack } from "./pack.js";
import type { GameState } from "./state.js";
import { evalAll } from "./conditions.js";
import { ev, type GameEvent } from "./events.js";
import { SLOT_NAMES } from "./engine.js";
import type { GraftSlot } from "./schema.js";

export const MAX_PLAYER_CHARS = 200;
export const MAX_TURNS_PER_NPC = 15;

/** Lo único que el servicio de NPC puede ver. */
export interface NpcContext {
  id: string;
  nombre: string;
  arquetipo: string;
  backstory: string;
  tono: string;
  idioma: string;
  limites: string[];
  confianza: number;
  memoria_resumen: string;
  sabe_ahora: string[]; // solo lo que puede revelar YA
  acciones_disponibles: string[]; // p. ej. "dar:rosario"
  jugador: { injertos_visibles: string[]; corrupcion_aparente: "ninguna" | "leve" | "evidente" | "monstruosa" };
  respuestas_fijas: string[];
}

export interface NpcReply {
  texto: string;
  delta_confianza: number;
  accion: string | null;
}

export function npcContext(s: GameState, pack: Pack, npcId: string): NpcContext {
  const n = pack.npc(npcId);
  const ns = s.npcs[npcId]!;
  const ctx = { state: s, pack, npc: npcId };
  const c = s.corrupcion;
  return {
    id: n.id,
    nombre: n.nombre,
    arquetipo: n.arquetipo,
    backstory: n.backstory,
    tono: n.tono,
    idioma: n.idioma,
    limites: n.limites,
    confianza: ns.confianza,
    memoria_resumen: ns.memoria_resumen,
    sabe_ahora: n.sabe.filter((x) => evalAll(x.si, ctx)).map((x) => x.dato),
    acciones_disponibles: n.acciones.filter((a) => !ns.acciones_hechas.includes(a.id) && evalAll(a.si, ctx)).map((a) => a.id),
    // Por debajo de 25 los NPC no notan los injertos.
    jugador: {
      injertos_visibles: c >= 25 ? (Object.entries(s.injertos) as [GraftSlot, string][]).map(([slot, id]) => `${pack.item(id).nombre} en ${SLOT_NAMES[slot]}`) : [],
      corrupcion_aparente: c < 25 ? "ninguna" : c < 50 ? "leve" : c < 75 ? "evidente" : "monstruosa",
    },
    respuestas_fijas: n.respuestas_fijas,
  };
}

/** Valida y aplica la respuesta del NPC. Devuelve el estado nuevo y los eventos. */
export function applyNpcReply(state: GameState, pack: Pack, raw: NpcReply): { state: GameState; events: GameEvent[] } {
  const s = structuredClone(state);
  const events: GameEvent[] = [];
  const npcId = s.dialogo?.npc;
  if (!npcId) return { state: s, events };
  const ns = s.npcs[npcId]!;
  const allowed = npcContext(s, pack, npcId).acciones_disponibles;
  const delta = Math.max(-1, Math.min(1, Math.round(Number(raw.delta_confianza) || 0)));
  ns.confianza += delta;
  ns.turnos_dialogo++;
  events.push(ev("npc_dice", String(raw.texto ?? "").slice(0, 600), npcId));
  if (raw.accion && allowed.includes(raw.accion)) {
    const item = raw.accion.slice(4);
    ns.acciones_hechas.push(raw.accion);
    s.inventario.push(item);
    const def = pack.npc(npcId).acciones.find((a) => a.id === raw.accion);
    events.push(ev("texto", def?.texto ?? `${pack.npc(npcId).nombre} te da ${pack.item(item).nombre}.`));
  }
  if (ns.turnos_dialogo >= MAX_TURNS_PER_NPC) {
    events.push(...endDialogEvents(s, pack));
    s.dialogo = undefined;
  }
  return { state: s, events };
}

export function endDialog(state: GameState, pack: Pack, resumen?: string): { state: GameState; events: GameEvent[] } {
  const s = structuredClone(state);
  const npcId = s.dialogo?.npc;
  if (!npcId) return { state: s, events: [] };
  if (resumen) s.npcs[npcId]!.memoria_resumen = resumen.slice(0, 400);
  const events = endDialogEvents(s, pack);
  s.dialogo = undefined;
  return { state: s, events };
}

function endDialogEvents(s: GameState, pack: Pack): GameEvent[] {
  const id = s.dialogo!.npc;
  return [ev("dialogo_fin", `${pack.npc(id).nombre} vuelve a su silencio.`, id)];
}
