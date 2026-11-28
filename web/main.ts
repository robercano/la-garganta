// Frontend de prueba: el motor corre en el navegador con la IA falsa (sin
// tokens, sin backend). Cuando exista el Worker, este frontend le hablará a él.
import { pack } from "./pack.js";
import { GameSession, type SessionDeps } from "../src/session/session.js";
import { FakeNarrator, FakeNpcService } from "../src/ai/fake.js";
import { ClaudeNarrator, ClaudeNpcService } from "../src/ai/haiku.js";
import type { GameState } from "../src/engine/state.js";
import { getSample, SampleTransport } from "./sample.js";

const SAVE_KEY = "la-garganta:partida";
const IA_KEY = "la-garganta:ia";
const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const out = $<HTMLDivElement>("#out");
const form = $<HTMLFormElement>("#form");
const input = $<HTMLInputElement>("#cmd");
const bar = $<HTMLDivElement>("#bar");
const iaBtn = $<HTMLButtonElement>("#iabtn");

// La partida se guarda como foto del estado + lo que se ve en pantalla. (Antes era
// semilla + comandos reproducidos, pero con la IA real los diálogos no se pueden
// reproducir igual; las partidas antiguas se siguen cargando así, con la IA falsa.)
interface SaveV1 { seed: number; cmds: string[] }
interface SaveV2 { v: 2; state: GameState; lines: [string, string][]; hist: string[] }
type IaMode = "falsa" | "real";

const store = {
  load(): SaveV1 | SaveV2 | null { try { return JSON.parse(localStorage.getItem(SAVE_KEY) ?? "null"); } catch { return null; } },
  save(s: SaveV2) { try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch { /* sin almacenamiento: partida en memoria */ } },
  clear() { try { localStorage.removeItem(SAVE_KEY); } catch { /* nada */ } },
  ia(): IaMode { try { return localStorage.getItem(IA_KEY) === "real" ? "real" : "falsa"; } catch { return "falsa"; } },
  setIa(m: IaMode) { try { localStorage.setItem(IA_KEY, m); } catch { /* nada */ } },
};

let game: GameSession;
let lines: [string, string][] = []; // [texto, clase] de lo que hay en pantalla
let ia: IaMode = store.ia();
let transport: SampleTransport | null = null;
let busy = false;

function print(ls: string[], cls = "") {
  for (const l of ls) {
    const c = cls || (l.startsWith("MAPA") ? "map" : "");
    lines.push([l, c]);
    const p = document.createElement("p");
    if (c) p.className = c;
    p.textContent = l;
    out.appendChild(p);
  }
  if (lines.length > 400) lines = lines.slice(-400);
  out.scrollTop = out.scrollHeight;
}

function persist() {
  store.save({ v: 2, state: game.state, lines, hist: history.slice(-100) });
}

function status() {
  const s = game.state;
  const room = pack.location(s.sala).nombre;
  const grafts = Object.keys(s.injertos).join(", ") || "ninguno";
  const known = Object.keys(s.injertos).length > 0; // corrupción e injertos: secretos hasta el primer injerto
  bar.textContent = `${room} · Vida ${s.vida}/${s.vida_max}` + (known ? ` · Corrupción ${s.corrupcion} · Injertos: ${grafts}` : "");
  bar.dataset.corr = String(s.corrupcion >= 75 ? 75 : s.corrupcion >= 50 ? 50 : s.corrupcion >= 25 ? 25 : 0);
  input.placeholder = game.finished ? "escribe «reiniciar»" : game.inDialog ? "dile algo… («adiós» para terminar)" : "¿qué haces?";
  iaBtn.textContent = ia === "real" ? "IA: real" : "IA: falsa";
  iaBtn.setAttribute("aria-pressed", String(ia === "real"));
}

function fakeDeps(): SessionDeps { return { narrator: new FakeNarrator(), npcs: new FakeNpcService() }; }

/** IA real con el puente de Claude; si esta vista no lo ofrece, vuelve a la falsa y lo dice. */
async function aiDeps(): Promise<SessionDeps> {
  if (ia !== "real") return fakeDeps();
  const sample = await getSample();
  if (!sample) {
    ia = "falsa";
    store.setIa(ia);
    print(["[La IA real no está disponible en esta vista. Sigues con la IA falsa.]"], "sys");
    return fakeDeps();
  }
  transport = new SampleTransport(sample, (code) => {
    print([code === "rate_limited" ? "[La IA real está saturada ahora mismo: uso los textos fijos un rato.]" : "[Sin permiso para usar la IA real. Vuelves a la IA falsa.]"], "sys");
    if (code === "not_granted") { ia = "falsa"; store.setIa(ia); game.setAi(fakeDeps()); status(); }
  });
  return { narrator: new ClaudeNarrator(transport), npcs: new ClaudeNpcService(transport) };
}

async function newGame(seed: number, replay: string[] = []) {
  out.innerHTML = "";
  lines = [];
  history = [...replay].filter((c, i, a) => c !== a[i - 1]);
  histPos = -1;
  // Una partida antigua (semilla + comandos) se reproduce siempre con la IA falsa
  game = GameSession.create(pack, replay.length ? fakeDeps() : await aiDeps(), seed);
  print([`=== ${pack.quest.titulo.toUpperCase()} ===`, `Semilla ${seed} · «ayuda» para ver comandos · «reiniciar» para empezar de nuevo`], "sys");
  await withBusy(async () => print(await game.start()));
  for (const c of replay) {
    print([`> ${c}`], "me");
    print(await game.input(c));
  }
  if (replay.length) game.setAi(await aiDeps());
  persist();
  status();
}

async function restore(sv: SaveV2) {
  out.innerHTML = "";
  lines = [];
  game = new GameSession(sv.state, pack, await aiDeps());
  history = sv.hist ?? [];
  for (const [t, c] of sv.lines) print([t], c);
  status();
}

/** Mientras responde la IA: indicador y entrada bloqueada. */
async function withBusy<T>(fn: () => Promise<T>): Promise<T> {
  busy = true;
  input.disabled = true;
  const p = document.createElement("p");
  p.className = "wait";
  p.textContent = ia === "real" ? "…" : "";
  out.appendChild(p);
  out.scrollTop = out.scrollHeight;
  try {
    return await fn();
  } finally {
    p.remove();
    busy = false;
    input.disabled = false;
    input.focus({ preventScroll: true });
  }
}

async function send(cmd: string) {
  const c = cmd.trim();
  if (!c || busy) return;
  if (["mapa", "plano", "m"].includes(c.toLowerCase())) return openMap();
  if (["reiniciar", "reinicio", "nueva partida"].includes(c.toLowerCase())) {
    store.clear();
    return newGame(Math.floor(Math.random() * 2 ** 31));
  }
  print([`${game.inDialog ? "»" : ">"} ${c}`], "me");
  print(await withBusy(() => game.input(c)));
  persist();
  status();
}

async function toggleIa() {
  if (busy) return;
  ia = ia === "real" ? "falsa" : "real";
  store.setIa(ia);
  const wanted = ia;
  game.setAi(await aiDeps());
  if (ia === wanted) print([ia === "real" ? "[IA real activada: Claude Haiku pone la voz. Las salas ya descritas no cambian.]" : "[IA falsa activada: textos fijos, sin esperas.]"], "sys");
  persist();
  status();
}

// ───────────── Historial de comandos (flechas ↑ ↓) ─────────────
let history: string[] = [];
let histPos = -1; // -1: escribiendo una línea nueva
let draft = "";

function remember(c: string) {
  if (c && history[history.length - 1] !== c) history.push(c);
  histPos = -1;
  draft = "";
}

input.addEventListener("keydown", (e) => {
  if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
  if (!history.length) return;
  e.preventDefault();
  if (histPos === -1) draft = input.value;
  if (e.key === "ArrowUp") histPos = histPos === -1 ? history.length - 1 : Math.max(0, histPos - 1);
  else histPos = histPos === -1 ? -1 : histPos + 1 >= history.length ? -1 : histPos + 1;
  input.value = histPos === -1 ? draft : history[histPos]!;
  requestAnimationFrame(() => input.setSelectionRange(input.value.length, input.value.length));
});

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const v = input.value;
  remember(v.trim());
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

iaBtn.addEventListener("click", () => void toggleIa());

const urlSeed = Number(new URLSearchParams(location.search).get("seed"));
const prev = store.load();
if (urlSeed) void newGame(urlSeed);
else if (prev && "v" in prev && prev.v === 2) void restore(prev);
else if (prev && "cmds" in prev) void newGame(prev.seed, prev.cmds);
else void newGame(Math.floor(Math.random() * 2 ** 31));
