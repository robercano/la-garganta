// Sesión de juego: une parser, motor y servicios de IA. Es lo que usarán tanto
// la CLI como el Durable Object. No escribe en el estado: todo pasa por el motor.
import type { Pack } from "../engine/pack.js";
import { initialState, type GameState } from "../engine/state.js";
import { ambientText, apply, catalog, mapData, scope, start, storeRoomDescription, type MapData } from "../engine/engine.js";
import { parse } from "../engine/parser.js";
import { applyNpcReply, endDialog, npcContext, MAX_PLAYER_CHARS } from "../engine/dialog.js";
import type { GameEvent } from "../engine/events.js";
import { normalize } from "../engine/normalize.js";
import type { CorruptionStage, DialogLine, Narrator, NpcService } from "../ai/types.js";
import { proseIsSafe } from "../ai/guard.js";

const END_DIALOG = new Set(["adios", "agur", "hasta luego", "salir", "fin", "terminar", "nada"]);

export interface SessionDeps {
  narrator: Narrator;
  npcs: NpcService;
}

export class GameSession {
  private history: DialogLine[] = [];

  constructor(public state: GameState, private readonly pack: Pack, private ai: SessionDeps) {}

  /** Cambia el narrador y los NPC en mitad de la partida (p. ej. IA falsa ↔ real). No toca el estado. */
  setAi(ai: SessionDeps) { this.ai = ai; }

  static create(pack: Pack, ai: SessionDeps, seed: number): GameSession {
    return new GameSession(initialState(pack, seed), pack, ai);
  }

  get finished() { return !!this.state.final; }
  /** Datos del mapa para que el frontend lo dibuje (no gasta turno). */
  map(): MapData | null { return mapData(this.state, this.pack); }
  get inDialog() { return !!this.state.dialogo; }

  /**
   * onProgress recibe líneas que conviene mostrar YA, mientras se espera a la IA
   * (frases de tránsito). Las líneas que pasan por ahí no se repiten en el resultado.
   */
  private onProgress?: (line: string) => void;

  async start(onProgress?: (line: string) => void): Promise<string[]> {
    this.onProgress = onProgress;
    const r = start(this.state, this.pack);
    this.state = r.state;
    return this.render(r.events);
  }

  async input(line: string, onProgress?: (line: string) => void): Promise<string[]> {
    this.onProgress = onProgress;
    const text = line.trim();
    if (!text) return [];
    if (this.state.dialogo) return this.dialogTurn(text);
    const p = parse(text, scope(this.state, this.pack), catalog(this.pack), ambientText(this.state, this.pack));
    if (!p.ok) return [p.texto];
    const r = apply(this.state, this.pack, p.cmd);
    this.state = r.state;
    if (r.state.dialogo) this.history = [];
    return this.render(r.events);
  }

  private async dialogTurn(text: string): Promise<string[]> {
    const npcId = this.state.dialogo!.npc;
    if (END_DIALOG.has(normalize(text))) {
      const resumen = await this.ai.npcs.summarize(npcContext(this.state, this.pack, npcId), this.history).catch(() => undefined);
      const r = endDialog(this.state, this.pack, resumen);
      this.state = r.state;
      return this.render(r.events);
    }
    const msg = text.slice(0, MAX_PLAYER_CHARS);
    const ctx = npcContext(this.state, this.pack, npcId);
    let reply;
    try {
      reply = await this.ai.npcs.reply(ctx, this.history, msg);
    } catch {
      reply = { texto: ctx.respuestas_fijas[0]!, delta_confianza: 0, accion: null };
    }
    this.history.push({ quien: "jugador", texto: msg }, { quien: "npc", texto: reply.texto });
    const r = applyNpcReply(this.state, this.pack, reply);
    this.state = r.state;
    return this.render(r.events);
  }

  /** Mientras la IA escribe, va soltando frases de tránsito (la primera a los 0,5 s, luego cada 2 s). */
  private coverWait(job: Promise<unknown>, lines: string[]): () => void {
    const emit = this.onProgress;
    if (!emit || !lines.length || (this.ai.narrator as { instant?: boolean }).instant) return () => {};
    let i = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let done = false;
    const next = (delay: number) => {
      timer = setTimeout(() => {
        if (done || i >= lines.length) return;
        emit(lines[i++]!);
        next(2000);
      }, delay);
    };
    next(500);
    job.finally(() => { done = true; });
    return () => { done = true; if (timer) clearTimeout(timer); };
  }

  private stage(): CorruptionStage {
    const c = this.state.corrupcion;
    return c >= 75 ? 75 : c >= 50 ? 50 : c >= 25 ? 25 : 0;
  }

  private async render(events: GameEvent[]): Promise<string[]> {
    const out: string[] = [];
    for (const e of events) {
      if (e.tipo === "sala_nueva" && e.ref) {
        const room = this.pack.location(e.ref);
        let prose: string | undefined;
        const variante = hash(`${this.state.seed}:${room.id}`);
        const transito = shuffle(room.transito, variante).slice(0, 4);
        const job = this.ai.narrator.describeRoom({ id: room.id, nombre: room.nombre, tono: room.tono, hechos: room.hechos, tramo: this.stage(), variante, transito });
        const stop = this.coverWait(job, transito);
        try {
          prose = await job;
          if (!proseIsSafe(prose, this.pack, room.id)) prose = undefined;
        } catch {
          prose = undefined;
        } finally {
          stop();
        }
        if (prose) this.state = storeRoomDescription(this.state, room.id, prose);
        const extra = this.state.salas[room.id]!.cambios.map((f) => room.cambios[f]!);
        out.push([`${e.cabecera ?? `${room.nombre}.`} ${prose ?? room.desc_base}`, ...extra].join(" "));
      } else if (e.clave) {
        out.push(await this.ai.narrator.narrate(e, { sala: this.state.sala, tramo: this.stage() }).catch(() => e.texto));
      } else if (e.tipo === "npc_dice") {
        out.push(`${cap(this.pack.npc(e.ref!).nombre)}: ${e.texto}`);
      } else {
        out.push(e.texto);
      }
      if (e.detalle) out.push(e.detalle);
      if (e.tipo === "dialogo_inicio") out.push("(Escribe lo que le dices. «adiós» para terminar.)");
    }
    return out;
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Barajado estable: misma partida y sala, mismo orden. */
function shuffle<T>(xs: readonly T[], seed: number): T[] {
  const a = [...xs];
  let x = seed || 1;
  for (let i = a.length - 1; i > 0; i--) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    const j = x % (i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
