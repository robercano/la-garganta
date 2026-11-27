// Jugar en la terminal.
//   npm run play                              IA falsa (sin tokens)
//   npm run play -- --seed 42                 partida reproducible
//   npm run play -- --ia claude               narrador y NPC con Claude (necesita ANTHROPIC_API_KEY)
//   npm run play -- --ia claude --modelo X    otro modelo
// En la partida, «coste» muestra los tokens y el coste acumulados (no es un comando del juego).
// También acepta comandos por stdin: printf "mirar\ni\n" | npm run play
import { createInterface } from "node:readline";
import { writeFileSync, mkdirSync } from "node:fs";
import { loadPackDir } from "./fsPack.js";
import { GameSession, type SessionDeps } from "../session/session.js";
import { FakeNarrator, FakeNpcService } from "../ai/fake.js";
import { ClaudeClient, DEFAULT_MODEL } from "../ai/claude.js";
import { ClaudeNarrator, ClaudeNpcService } from "../ai/haiku.js";

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const seed = opt("seed") ? Number(opt("seed")) : Math.floor(Math.random() * 2 ** 31);
const ia = opt("ia") ?? "falsa";
const flagValues = new Set(["--seed", "--ia", "--modelo"].map((f) => opt(f.slice(2))));
const packDir = args.find((a, i) => !a.startsWith("--") && !(args[i - 1]?.startsWith("--") && flagValues.has(a))) ?? "packs/la-garganta";

const WIDTH = Math.min(process.stdout.columns || 80, 80);
const wrap = (s: string) =>
  s.split("\n").map((line) => {
    const out: string[] = [];
    let cur = "";
    for (const w of line.split(" ")) {
      if ((cur + " " + w).trim().length > WIDTH) { out.push(cur); cur = w; }
      else cur = (cur + " " + w).trim();
    }
    out.push(cur);
    return out.join("\n");
  }).join("\n");
const print = (lines: string[]) => { for (const l of lines) console.log((l.startsWith("MAPA") ? l : wrap(l)) + "\n"); };

let client: ClaudeClient | undefined;
let deps: SessionDeps = { narrator: new FakeNarrator(), npcs: new FakeNpcService() };
if (ia === "claude") {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("Falta ANTHROPIC_API_KEY en el entorno.");
    process.exit(1);
  }
  client = new ClaudeClient({ apiKey, model: opt("modelo") ?? DEFAULT_MODEL });
  deps = { narrator: new ClaudeNarrator(client), npcs: new ClaudeNpcService(client) };
}

const pack = loadPackDir(packDir);
const game = GameSession.create(pack, deps, seed);
console.log(`\n=== ${pack.quest.titulo.toUpperCase()} ===  (semilla ${seed}; IA: ${client ? client.model : "falsa"}; «ayuda» para ver comandos)\n`);
print(await game.start());

function costReport(): string {
  if (!client) return "Con la IA falsa no hay coste.";
  const s = client.log.summary();
  const t = s.tokens;
  return [
    `Llamadas: ${s.llamadas} (${Object.entries(s.por_tipo).map(([k, v]) => `${k} ${v}`).join(", ")}), errores: ${s.errores}, latencia media: ${s.latencia_media_ms} ms`,
    `Tokens: entrada ${t.entrada}, salida ${t.salida}, caché escrita ${t.cache_escritura}, caché leída ${t.cache_lectura}`,
    `Coste: ${s.coste_usd === null ? "sin precio configurado para este modelo (ver src/ai/cost.ts)" : `$${s.coste_usd.toFixed(4)}`}`,
  ].join("\n");
}

function saveLog() {
  if (!client || !client.log.calls.length) return;
  mkdirSync("logs", { recursive: true });
  const file = `logs/partida-${seed}-${Date.now()}.json`;
  writeFileSync(file, JSON.stringify({ semilla: seed, modelo: client.model, final: game.state.final ?? null, turnos: game.state.turno, resumen: client.log.summary(), llamadas: client.log.calls }, null, 2));
  console.log(`Registro de llamadas guardado en ${file}`);
}

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
const prompt = () => { if (process.stdin.isTTY) rl.setPrompt(game.inDialog ? "» " : "> "), rl.prompt(); };
prompt();
for await (const line of rl) {
  if (!process.stdin.isTTY) console.log(`${game.inDialog ? "»" : ">"} ${line}`);
  if (line.trim().toLowerCase() === "coste") { console.log(costReport() + "\n"); prompt(); continue; }
  print(await game.input(line));
  if (game.finished) break;
  prompt();
}
rl.close();
if (client) console.log("\n" + costReport());
saveLog();
