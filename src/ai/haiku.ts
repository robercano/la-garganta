// Narrador y NPC con Claude. Implementan los mismos contratos que la IA falsa,
// así que la sesión no cambia. Si algo falla, devuelven el texto fijo del pack.
import type { Narrator, NpcService, RoomContext, NarrationContext, DialogLine } from "./types.js";
import type { NpcContext, NpcReply } from "../engine/dialog.js";
import type { GameEvent } from "../engine/events.js";
import type { LlmTransport } from "./transport.js";
import { NARRATOR_SYSTEM, SUMMARY_SYSTEM, eventPrompt, npcSystemFixed, npcSystemState, roomPrompt } from "./prompts.js";

export class ClaudeNarrator implements Narrator {
  constructor(private readonly client: LlmTransport) {}

  async describeRoom(room: RoomContext): Promise<string> {
    const text = await this.client.call({ tipo: "sala", systemFijo: NARRATOR_SYSTEM, messages: [{ role: "user", content: roomPrompt(room) }], maxTokens: 300, temperature: 1 });
    return clean(text);
  }

  async narrate(event: GameEvent, ctx: NarrationContext): Promise<string> {
    try {
      const text = await this.client.call({ tipo: "evento", systemFijo: NARRATOR_SYSTEM, messages: [{ role: "user", content: eventPrompt(event.texto, ctx.tramo) }], maxTokens: 250 });
      return clean(text);
    } catch {
      return event.texto;
    }
  }
}

export class ClaudeNpcService implements NpcService {
  constructor(private readonly client: LlmTransport) {}

  async reply(ctx: NpcContext, history: DialogLine[], mensaje: string): Promise<NpcReply> {
    const messages = [
      ...history.slice(-12).map((h) => ({ role: h.quien === "jugador" ? ("user" as const) : ("assistant" as const), content: h.quien === "npc" ? JSON.stringify({ texto: h.texto }) : h.texto })),
      { role: "user" as const, content: mensaje },
    ];
    const raw = await this.client.call({ tipo: "npc", systemFijo: npcSystemFixed(ctx), systemVariable: npcSystemState(ctx), messages, maxTokens: 250 });
    return parseNpcReply(raw, ctx);
  }

  async summarize(ctx: NpcContext, history: DialogLine[]): Promise<string> {
    if (!history.length) return ctx.memoria_resumen;
    const transcript = history.map((h) => `${h.quien === "jugador" ? "Jugador" : ctx.nombre}: ${h.texto}`).join("\n");
    const prev = ctx.memoria_resumen ? `Memoria anterior: ${ctx.memoria_resumen}\n\n` : "";
    const text = await this.client.call({ tipo: "resumen", systemFijo: SUMMARY_SYSTEM, messages: [{ role: "user", content: `${prev}Conversación con ${ctx.nombre}:\n${transcript}` }], maxTokens: 200 });
    return clean(text);
  }
}

/**
 * Convierte la respuesta del modelo en {texto, delta_confianza, accion}.
 * Tolera texto alrededor del JSON. Si no hay JSON válido, usa lo que haya como texto
 * y no propone nada: el motor nunca recibe una acción que no venga bien formada.
 */
export function parseNpcReply(raw: string, ctx: NpcContext): NpcReply {
  const m = raw.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const j = JSON.parse(m[0]);
      const texto = typeof j.texto === "string" && j.texto.trim() ? j.texto.trim() : ctx.respuestas_fijas[0]!;
      const d = Number(j.delta_confianza);
      const accion = typeof j.accion === "string" && j.accion ? j.accion : null;
      return { texto: texto.slice(0, 400), delta_confianza: Number.isFinite(d) ? d : 0, accion };
    } catch {
      /* sigue abajo */
    }
  }
  const fallback = clean(raw.replace(/\{[\s\S]*\}/, "")) || ctx.respuestas_fijas[0]!;
  return { texto: fallback.slice(0, 400), delta_confianza: 0, accion: null };
}

function clean(s: string): string {
  return s.trim().replace(/^["«]|["»]$/g, "").trim();
}
