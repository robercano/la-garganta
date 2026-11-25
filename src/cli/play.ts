// npm run play [-- --seed 123]: juega en la terminal con la IA falsa (sin tokens).
// También acepta comandos por stdin: printf "mirar\ni\n" | npm run play
import { createInterface } from "node:readline";
import { loadPackDir } from "./fsPack.js";
import { GameSession } from "../session/session.js";
import { FakeNarrator, FakeNpcService } from "../ai/fake.js";

const args = process.argv.slice(2);
const seedArg = args.indexOf("--seed");
const seed = seedArg >= 0 ? Number(args[seedArg + 1]) : Math.floor(Math.random() * 2 ** 31);
const packDir = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--seed") ?? "packs/la-garganta";

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
const print = (lines: string[]) => { for (const l of lines) console.log(wrap(l) + "\n"); };

const pack = loadPackDir(packDir);
const game = GameSession.create(pack, { narrator: new FakeNarrator(), npcs: new FakeNpcService() }, seed);
console.log(`\n=== ${pack.quest.titulo.toUpperCase()} ===  (semilla ${seed}; «ayuda» para ver comandos)\n`);
print(await game.start());

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
const prompt = () => { if (process.stdin.isTTY) rl.setPrompt(game.inDialog ? "» " : "> "), rl.prompt(); };
prompt();
for await (const line of rl) {
  if (!process.stdin.isTTY) console.log(`${game.inDialog ? "»" : ">"} ${line}`);
  print(await game.input(line));
  if (game.finished) break;
  prompt();
}
rl.close();
