// Contratos entre la sesión y los servicios de IA. Los LLM solo devuelven texto
// o propuestas; nunca reciben ni devuelven el estado de la partida.
import type { NpcContext, NpcReply } from "../engine/dialog.js";
import type { GameEvent } from "../engine/events.js";

export type CorruptionStage = 0 | 25 | 50 | 75; // el narrador cambia de voz por tramos

export interface RoomContext {
  id: string;
  nombre: string;
  tono: string;
  hechos: string[]; // lo único que puede describir: nada de objetos ni salidas
  tramo: CorruptionStage;
  variante: number; // distinta en cada partida: el narrador elige enfoque con ella
  transito: string[]; // frases que el jugador puede haber leído justo antes (no repetirlas)
}

export interface NarrationContext {
  sala: string;
  tramo: CorruptionStage;
}

export interface Narrator {
  /** 3–5 líneas de prosa para una sala. Se llama una vez por sala y partida. */
  describeRoom(room: RoomContext): Promise<string>;
  /** Reescribe un evento clave (inicio de combate, golpe final, muerte, umbral, final). */
  narrate(event: GameEvent, ctx: NarrationContext): Promise<string>;
}

export interface DialogLine {
  quien: "jugador" | "npc";
  texto: string;
}

export interface NpcService {
  reply(ctx: NpcContext, history: DialogLine[], mensaje: string): Promise<NpcReply>;
  summarize(ctx: NpcContext, history: DialogLine[]): Promise<string>;
}
