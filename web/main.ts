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
    else if (l.startsWith("MAPA (")) p.className = "map";
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
  if (["mapa", "plano", "m"].includes(c.toLowerCase())) return openMap();
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

// ───────────── Mapa emergente ─────────────
const mapEl = $<HTMLDivElement>("#mapa");
const mapSvg = document.querySelector("#mapsvg") as SVGSVGElement;
let mapLevel = 0;

function openMap() {
  const data = game.map();
  if (!data || !data.niveles.length) return print(["Aún no sabes dónde estás."]);
  mapLevel = data.niveles.findIndex((n) => n.nivel === data.actual);
  drawMap();
  mapEl.hidden = false;
}
function closeMap() { mapEl.hidden = true; input.focus({ preventScroll: true }); }

function drawMap() {
  const data = game.map()!;
  const lvl = data.niveles[mapLevel]!;
  $("#maplvl").textContent = `Nivel ${lvl.nivel}`;
  $("#mapname").textContent = lvl.nombre;
  ($("#mapup") as HTMLButtonElement).disabled = mapLevel === 0;
  ($("#mapdown") as HTMLButtonElement).disabled = mapLevel === data.niveles.length - 1;
  mapSvg.innerHTML = renderLevel(lvl);
}

function renderLevel(lvl: NonNullable<ReturnType<GameSession["map"]>>["niveles"][number]): string {
  const CW = 140, CH = 120, PAD = 78;
  const xs = lvl.salas.map((r) => r.x), ys = lvl.salas.map((r) => r.y);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const W = Math.max(320, (Math.max(...xs) - minX) * CW + PAD * 2);
  const H = Math.max(230, (Math.max(...ys) - minY) * CH + PAD * 2);
  const cx = (x: number) => (W - (Math.max(...xs) - minX) * CW) / 2 + (x - minX) * CW;
  const cy = (y: number) => (H - (Math.max(...ys) - minY) * CH) / 2 + (y - minY) * CH + 10;
  const at = new Map(lvl.salas.map((r) => [r.id, r]));
  let out = "";
  for (const { a, b } of lvl.tuneles) {
    const ra = at.get(a)!, rb = at.get(b)!;
    const x1 = cx(ra.x), y1 = cy(ra.y), x2 = cx(rb.x), y2 = cy(rb.y);
    const k = (hash(a + b) % 17) - 8; // curva propia y estable para cada túnel
    const mx = (x1 + x2) / 2 + (y2 - y1 !== 0 ? k : 0), my = (y1 + y2) / 2 + (x2 - x1 !== 0 ? k : 0);
    const unknown = ra.estado === "intuida" || rb.estado === "intuida";
    out += `<path d="M${x1} ${y1} Q${mx} ${my} ${x2} ${y2}" stroke="#7a5520" stroke-width="${unknown ? 3 : 16}" fill="none" stroke-linecap="round"${unknown ? ' stroke-dasharray="4 7"' : ""}/>`;
  }
  for (const r of lvl.salas) {
    const x = cx(r.x), y = cy(r.y), seed = hash(r.id);
    if (r.estado === "intuida") {
      out += `<path d="${blob(x, y, 30, 20, seed)}" fill="#120b04" stroke="#9a6a24" stroke-dasharray="4 5"/><text x="${x}" y="${y + 5}" text-anchor="middle" font-size="15" fill="#9a6a24">?</text>`;
      continue;
    }
    const cur = r.estado === "actual";
    const label = `${cur ? "◆ " : ""}${r.etiqueta}${r.sube ? " ↑" : ""}${r.baja ? " ↓" : ""}`;
    const rx = Math.max(46, label.length * 4.6 + 14);
    out += `<path d="${blob(x, y, rx, 30, seed)}" fill="${cur ? "#3a2408" : "#2a1a09"}" stroke="${cur ? "#f2b04a" : "#9a6a24"}" stroke-width="${cur ? 2.5 : 1.5}"/>`;
    out += `<text x="${x}" y="${y + 5}" text-anchor="middle" font-size="14" fill="#f2b04a">${esc(label)}</text>`;
  }
  out += compass(W - 34, 34);
  mapSvg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  return `<rect width="${W}" height="${H}" fill="#120b04"/>${out}`;
}

/** Contorno irregular de cueva, siempre igual para la misma sala. */
function blob(cx: number, cy: number, rx: number, ry: number, seed: number): string {
  const n = 14;
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const w = 1 + 0.12 * Math.sin(a * 3 + seed) + 0.07 * Math.cos(a * 5 + seed * 1.7);
    pts.push([cx + Math.cos(a) * rx * w, cy + Math.sin(a) * ry * w]);
  }
  // curva suave que pasa por los puntos medios: contorno orgánico, sin picos
  const mid = (i: number) => { const p = pts[i % n]!, q = pts[(i + 1) % n]!; return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]; };
  let d = `M${mid(0)[0]!.toFixed(1)} ${mid(0)[1]!.toFixed(1)}`;
  for (let i = 1; i <= n; i++) { const p = pts[i % n]!, m = mid(i); d += `Q${p[0].toFixed(1)} ${p[1].toFixed(1)} ${m[0]!.toFixed(1)} ${m[1]!.toFixed(1)}`; }
  return d + "Z";
}

/** Rosa de los vientos simplificada. */
function compass(x: number, y: number): string {
  const r = 15, c = "#9a6a24";
  const star = `M${x} ${y - r} L${x + 4} ${y - 4} L${x + r} ${y} L${x + 4} ${y + 4} L${x} ${y + r} L${x - 4} ${y + 4} L${x - r} ${y} L${x - 4} ${y - 4}Z`;
  const t = (tx: number, ty: number, s: string, col = c) => `<text x="${tx}" y="${ty}" text-anchor="middle" font-size="10" fill="${col}">${s}</text>`;
  return `<path d="${star}" fill="none" stroke="${c}"/><path d="M${x} ${y - r} L${x + 4} ${y - 4} L${x} ${y} L${x - 4} ${y - 4}Z" fill="#f2b04a"/>` +
    t(x, y - r - 4, "N", "#f2b04a") + t(x, y + r + 11, "S") + t(x + r + 7, y + 4, "E") + t(x - r - 7, y + 4, "O");
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) % 1000;
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

$("#mapup").addEventListener("click", () => { if (mapLevel > 0) { mapLevel--; drawMap(); } });
$("#mapdown").addEventListener("click", () => { if (mapLevel < game.map()!.niveles.length - 1) { mapLevel++; drawMap(); } });
$("#mapclose").addEventListener("click", closeMap);
mapEl.addEventListener("click", (e) => { if (e.target === mapEl) closeMap(); });
document.addEventListener("keydown", (e) => { if (!mapEl.hidden && e.key === "Escape") closeMap(); });

const urlSeed = Number(new URLSearchParams(location.search).get("seed"));
const prev = store.load();
if (urlSeed) void newGame(urlSeed);
else if (prev) void newGame(prev.seed, prev.cmds);
else void newGame(Math.floor(Math.random() * 2 ** 31));
