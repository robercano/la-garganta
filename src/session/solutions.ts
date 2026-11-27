// Juega las soluciones de un pack con la IA falsa y comprueba que cada una llega a su final.
import type { Pack } from "../engine/pack.js";
import { GameSession } from "./session.js";
import { FakeNarrator, FakeNpcService } from "../ai/fake.js";

export interface SolutionResult {
  final: string;
  ok: boolean;
  obtenido?: string;
  detalle?: string; // últimas líneas de salida si falla
}

export async function playSolutions(pack: Pack): Promise<SolutionResult[]> {
  const out: SolutionResult[] = [];
  for (const sol of pack.data.soluciones) {
    const g = GameSession.create(pack, { narrator: new FakeNarrator(), npcs: new FakeNpcService() }, sol.semilla);
    const log: string[] = [...(await g.start())];
    for (const raw of sol.comandos) {
      const c = raw.trim();
      if (!c || c.startsWith("#") || g.finished) continue;
      const fight = c.match(/^@luchar\s+(.+)$/);
      if (fight) {
        for (let i = 0; i < 40 && !g.finished; i++) {
          log.push(`> atacar ${fight[1]}`, ...(await g.input(`atacar ${fight[1]}`)));
          if (!g.state.combate) break;
        }
        continue;
      }
      log.push(`> ${c}`, ...(await g.input(c)));
    }
    const ok = g.state.final === sol.final;
    out.push({ final: sol.final, ok, obtenido: g.state.final, detalle: ok ? undefined : log.slice(-12).join("\n") });
  }
  return out;
}
