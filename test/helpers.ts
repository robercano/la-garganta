import { loadPackDir } from "../src/cli/fsPack.js";
import { GameSession } from "../src/session/session.js";
import { FakeNarrator, FakeNpcService } from "../src/ai/fake.js";

export const pack = loadPackDir("packs/la-garganta");

export async function newGame(seed = 1) {
  const g = GameSession.create(pack, { narrator: new FakeNarrator(), npcs: new FakeNpcService() }, seed);
  await g.start();
  return g;
}

/** Ejecuta comandos y devuelve toda la salida concatenada. */
export async function play(g: GameSession, cmds: string[]): Promise<string> {
  const out: string[] = [];
  for (const c of cmds) out.push(...(await g.input(c)));
  return out.join("\n");
}

/** Ataca hasta que el combate termina (o 30 intentos). */
export async function fight(g: GameSession, target: string): Promise<string> {
  const out: string[] = [];
  for (let i = 0; i < 30 && (g.state.combate || i === 0) && !g.finished; i++) out.push(...(await g.input(`atacar ${target}`)));
  return out.join("\n");
}

export const LIGHT = ["coger lampara", "coger carburo", "combinar lampara con carburo", "combinar lampara con cantimplora", "coger pico", "equipar pico"];
export const TO_HORNACINA = ["este", "coger cuerda", "coger trapo", "bajar"];
