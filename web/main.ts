// Frontend de prueba: el motor corre en el navegador con la IA falsa (sin
// tokens, sin backend). Cuando exista el Worker, este frontend le hablará a él.
import { pack } from "./pack.js";
import { GameSession } from "../src/session/session.js";
import { FakeNarrator, FakeNpcService } from "../src/ai/fake.js";

const SAVE_KEY = "la-garganta:partida";
const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const out = $<HTMLDivElement>("#out");
const form = $<HTMLFormElement>("#form");
const input = $<HTMLInputElement>("#cmd");
const bar = $<HTMLDivElement>("#bar");

interface Save { seed: number; cmds: string[] }

const store = {
  load(): Save | null { try { return JSON.parse(localStorage.getItem(SAVE_KEY) ?? "null"); } catch { return null; } },
  save(s: Save) { try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch { /* sin almacenamiento: partida en memoria */ } },
  clear() { try { localStorage.removeItem(SAVE_KEY); } catch { /* nada */ } },
};

let game: GameSession;
let save: Save;

function print(lines: string[], cls = "") {
  for (const l of lines) {
    const p = document.createElement("p");
    if (cls) p.className = cls;
    p.textContent = l;
    out.appendChild(p);
  }
  out.scrollTop = out.scrollHeight;
}

function status() {
  const s = game.state;
  const room = pack.location(s.sala).nombre;
  const grafts = Object.keys(s.injertos).join(", ") || "ninguno";
  bar.textContent = `${room} · Vida ${s.vida}/${s.vida_max} · Corrupción ${s.corrupcion} · Injertos: ${grafts}`;
  bar.dataset.corr = String(s.corrupcion >= 75 ? 75 : s.corrupcion >= 50 ? 50 : s.corrupcion >= 25 ? 25 : 0);
  input.placeholder = game.finished ? "escribe «reiniciar»" : game.inDialog ? "dile algo… («adiós» para terminar)" : "¿qué haces?";
}

async function newGame(seed: number, replay: string[] = []) {
  out.innerHTML = "";
  game = GameSession.create(pack, { narrator: new FakeNarrator(), npcs: new FakeNpcService() }, seed);
  save = { seed, cmds: [] };
  print([`=== ${pack.quest.titulo.toUpperCase()} ===`, `Semilla ${seed} · «ayuda» para ver comandos · «reiniciar» para empezar de nuevo`], "sys");
  print(await game.start());
  // La partida se guarda como semilla + comandos y se reproduce: el motor es determinista.
  for (const c of replay) {
    const res = await game.input(c);
    save.cmds.push(c);
    print([`> ${c}`], "me");
    print(res);
  }
  store.save(save);
  status();
}

async function send(cmd: string) {
  const c = cmd.trim();
  if (!c) return;
  if (["reiniciar", "reinicio", "nueva partida"].includes(c.toLowerCase())) {
    store.clear();
    return newGame(Math.floor(Math.random() * 2 ** 31));
  }
  print([`${game.inDialog ? "»" : ">"} ${c}`], "me");
  print(await game.input(c));
  save.cmds.push(c);
  store.save(save);
  status();
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const v = input.value;
  input.value = "";
  void send(v);
});
document.querySelectorAll<HTMLButtonElement>("[data-cmd]").forEach((b) =>
  b.addEventListener("click", () => { void send(b.dataset.cmd!); input.focus({ preventScroll: true }); }),
);

const urlSeed = Number(new URLSearchParams(location.search).get("seed"));
const prev = store.load();
if (urlSeed) void newGame(urlSeed);
else if (prev) void newGame(prev.seed, prev.cmds);
else void newGame(Math.floor(Math.random() * 2 ** 31));
