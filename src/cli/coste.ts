// npm run coste -- --ia claude: juega las soluciones del pack con la IA real y mide
// tokens y coste por partida (cada solución es una partida completa hasta un final).
// Sin --ia claude usa la IA falsa (útil para comprobar que el script funciona).
import { writeFileSync, mkdirSync } from "node:fs";
import { loadPackDir } from "./fsPack.js";
import { playSolutions } from "../session/solutions.js";
import { FakeNarrator, FakeNpcService } from "../ai/fake.js";
import { ClaudeClient, DEFAULT_MODEL } from "../ai/claude.js";
import { ClaudeNarrator, ClaudeNpcService } from "../ai/haiku.js";
import { CostLog } from "../ai/cost.js";

const args = process.argv.slice(2);
const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const dir = opt("pack") ?? "packs/la-garganta";
const real = opt("ia") === "claude";
const model = opt("modelo") ?? DEFAULT_MODEL;
if (real && !process.env.ANTHROPIC_API_KEY) { console.error("Falta ANTHROPIC_API_KEY en el entorno."); process.exit(1); }

const pack = loadPackDir(dir);
let log = new CostLog();
const rows: unknown[] = [];
const transcripts: Record<string, string[]> = {};
await playSolutions(
  pack,
  () => {
    log = new CostLog();
    if (!real) return { narrator: new FakeNarrator(), npcs: new FakeNpcService() };
    const c = new ClaudeClient({ apiKey: process.env.ANTHROPIC_API_KEY!, model, log });
    return { narrator: new ClaudeNarrator(c), npcs: new ClaudeNpcService(c) };
  },
  (r, out) => {
    const s = log.summary();
    rows.push({ final: r.final, llega: r.ok, ...s });
    transcripts[r.final] = out;
    const t = s.tokens;
    console.log(`${r.ok ? "OK " : "MAL"} ${r.final.padEnd(14)} llamadas ${String(s.llamadas).padStart(3)}  entrada ${t.entrada}  salida ${t.salida}  caché leída ${t.cache_lectura}  escrita ${t.cache_escritura}  coste ${s.coste_usd === null ? "sin precio" : `$${s.coste_usd.toFixed(4)}`}`);
  },
);
mkdirSync("logs", { recursive: true });
const file = `logs/coste-${pack.data.id}-${Date.now()}.json`;
writeFileSync(file, JSON.stringify({ modelo: real ? model : "falsa", partidas: rows, transcripciones: transcripts }, null, 2));
console.log(`\nDetalle y transcripciones en ${file}`);
