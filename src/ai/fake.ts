// "IA falsa": textos fijos y comportamiento determinista. Permite jugar y testear
// el juego entero sin gastar tokens.
import type { Narrator, NpcService, RoomContext, DialogLine } from "./types.js";
import type { NpcContext, NpcReply } from "../engine/dialog.js";
import type { GameEvent } from "../engine/events.js";

export class FakeNarrator implements Narrator {
  readonly instant = true; // responde al momento: no hacen falta frases de tránsito
  constructor(private readonly descs: Record<string, string> = {}) {}
  async describeRoom(room: RoomContext): Promise<string> {
    return this.descs[room.id] ?? `${room.hechos.slice(0, 3).map(cap).join(". ")}.`;
  }
  async narrate(event: GameEvent): Promise<string> {
    return event.texto;
  }
}

/**
 * NPC falso: contesta con sus respuestas fijas, sube la confianza en +1 por
 * turno y, si tiene algo que revelar o dar, lo hace. Suficiente para probar
 * las condiciones del motor.
 */
export class FakeNpcService implements NpcService {
  async reply(ctx: NpcContext, history: DialogLine[]): Promise<NpcReply> {
    const turn = history.filter((h) => h.quien === "npc").length;
    const base = ctx.respuestas_fijas[turn % ctx.respuestas_fijas.length]!;
    const secret = ctx.sabe_ahora[turn % Math.max(1, ctx.sabe_ahora.length)];
    return {
      texto: secret ? `${base} [sabe: ${secret}]` : base,
      delta_confianza: 1,
      accion: ctx.acciones_disponibles[0] ?? null,
    };
  }
  async summarize(_ctx: NpcContext, history: DialogLine[]): Promise<string> {
    return `Habló con el jugador ${history.filter((h) => h.quien === "jugador").length} veces.`;
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
