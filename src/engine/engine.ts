// Motor de reglas determinista. Único componente que escribe en el estado.
// apply(state, pack, cmd) devuelve un estado nuevo y los eventos del turno.
import type { Pack } from "./pack.js";
import type { GameState } from "./state.js";
import { attack, carried, defense, powers } from "./state.js";
import type { Command, Candidate, Ref } from "./parser.js";
import { evalAll, type CondContext } from "./conditions.js";
import { ev, type GameEvent } from "./events.js";
import { pick, roll } from "./rng.js";
import type { Direction, GraftSlot, EquipSlot, Item } from "./schema.js";
import { GRAFT_SLOTS } from "./schema.js";

export interface TurnResult {
  state: GameState;
  events: GameEvent[];
}

const FREE_VERBS = new Set(["inventario", "mapa", "estado", "ayuda", "mirar", "examinar"]);
// En combate se puede cambiar de arma, pero cuesta el turno: el enemigo ataca mientras tanto.
const COMBAT_VERBS = new Set(["atacar", "huir", "consumir", "usar", "equipar", "desequipar", "inventario", "mapa", "estado", "ayuda", "mirar", "examinar"]);

class Turn {
  events: GameEvent[] = [];
  constructor(public s: GameState, public pack: Pack) {}
  ctx(npc?: string): CondContext { return { state: this.s, pack: this.pack, npc }; }
  ok(conds: readonly string[], npc?: string) { return evalAll(conds, this.ctx(npc)); }
  say(texto: string) { this.events.push(ev("texto", texto)); }
  err(texto: string) { this.events.push(ev("error", texto)); }
  get room() { return this.pack.location(this.s.sala); }
  get roomState() { return this.s.salas[this.s.sala]!; }
}

// ───────────────────────── API pública ─────────────────────────

/** Arranque de partida: intro y primera sala. */
export function start(state: GameState, pack: Pack): TurnResult {
  const t = new Turn(structuredClone(state), pack);
  t.say(pack.quest.intro);
  enterRoom(t, true, false, "estar");
  return { state: t.s, events: t.events };
}

export function apply(state: GameState, pack: Pack, cmd: Command): TurnResult {
  const t = new Turn(structuredClone(state), pack);
  if (t.s.final) {
    t.err("La partida ha terminado.");
    return { state: t.s, events: t.events };
  }
  if (t.s.combate && !COMBAT_VERBS.has(cmd.verbo)) {
    t.err("¡No es momento para eso! Lucha o huye.");
    return { state: t.s, events: t.events };
  }
  const before = t.events.length;
  run(t, cmd);
  const failed = t.events.length > before && t.events.slice(before).every((e) => e.tipo === "error");
  if (!FREE_VERBS.has(cmd.verbo) && !failed) {
    t.s.turno++;
    otherTurns(t, cmd);
  }
  checkEndings(t);
  return { state: t.s, events: t.events };
}

/** Lo que el jugador puede nombrar ahora mismo. */
export function scope(s: GameState, pack: Pack): Candidate[] {
  const out: Candidate[] = [];
  const t = new Turn(s, pack);
  const addItem = (id: string) => {
    const it = pack.item(id);
    out.push({ kind: "item", id, nombre: it.nombre, alias: it.alias, consumible: it.tipo === "consumible", fijo: it.fijo, texto: [it.desc_base, it.examinar].filter(Boolean).join(" ") }); // lo que nombra su descripción se refiere a él
  };
  for (const id of carried(s)) addItem(id);
  for (const id of visibleItems(t)) addItem(id);
  if (!isDark(t)) {
    for (const n of t.room.npcs) if (s.npcs[n]?.vivo) out.push({ kind: "npc", id: n, nombre: pack.npc(n).nombre, alias: pack.npc(n).alias });
  }
  for (const e of t.room.enemigos) if (s.enemigos[e]?.vivo) out.push({ kind: "enemigo", id: e, nombre: pack.enemy(e).nombre, alias: pack.enemy(e).alias });
  const g = pack.quest.grupo;
  if (g && s.grupo && groupPresent(t)) out.push({ kind: "grupo", id: g.id, nombre: g.nombre, alias: g.alias });
  return out;
}

/** Todo lo nombrable del pack, para distinguir "no está aquí" de "no existe". */
export function catalog(pack: Pack): Candidate[] {
  return [
    ...pack.data.items.map((i) => ({ kind: "item" as const, id: i.id, nombre: i.nombre, alias: i.alias })),
    ...pack.data.npcs.map((n) => ({ kind: "npc" as const, id: n.id, nombre: n.nombre, alias: n.alias })),
    ...pack.data.enemies.map((e) => ({ kind: "enemigo" as const, id: e.id, nombre: e.nombre, alias: e.alias })),
  ];
}

// ───────────────────────── Comandos ─────────────────────────

function run(t: Turn, cmd: Command) {
  switch (cmd.verbo) {
    case "ir": return go(t, cmd.dir);
    case "mirar": return enterRoom(t, false, true);
    case "inventario": return inventory(t);
    case "mapa": return t.events.push(ev("mapa", renderMap(t.s, t.pack)));
    case "estado": return status(t);
    case "ayuda": return t.say(help(t.s));
    case "examinar": return examine(t, cmd.obj);
    case "coger": return take(t, cmd.obj);
    case "dejar": return drop(t, cmd.obj);
    case "equipar": return equip(t, cmd.obj);
    case "desequipar": return unequip(t, cmd.obj);
    case "consumir": return consume(t, cmd.obj);
    case "usar": return use(t, cmd.obj, cmd.con);
    case "combinar": return combine(t, cmd.objs);
    case "injertar": return graft(t, cmd.obj);
    case "atacar": return attackCmd(t, cmd.obj, cmd.con);
    case "cortar": return cut(t, cmd.obj);
    case "huir": return flee(t);
    case "hablar": return talk(t, cmd.obj);
    case "rezar": case "escuchar": case "oler": case "esperar": return roomAction(t, cmd.verbo);
  }
}

function go(t: Turn, dir: Direction) {
  if (t.s.combate) return t.err("Con esa cosa encima no puedes irte sin más. Puedes intentar huir.");
  const exit = t.room.salidas[dir];
  if (!exit || !t.ok(exit.visible_si)) return t.err("No puedes ir por ahí.");
  if (!t.ok(exit.si)) return t.err(exit.bloqueo);
  if (exit.texto) t.say(exit.texto);
  applyEffects(t, exit.efectos);
  if (exit.a) moveTo(t, exit.a);
}

function moveTo(t: Turn, to: string) {
  t.s.sala_anterior = t.s.sala;
  t.s.sala = to;
  enterRoom(t, true);
}

function enterRoom(t: Turn, arriving: boolean, looking = false, how: "llegar" | "estar" = arriving ? "llegar" : "estar") {
  const head = roomHeader(t.room.nombre, how);
  const room = t.room;
  const rs = t.roomState;
  rs.explorada = true;
  if (isDark(t)) {
    const touch = visibleItems(t).map((i) => t.pack.item(i).nombre);
    t.events.push({ ...ev("texto", `${head} Oscuridad total: no ves ni tus propias manos.`), detalle: touch.length ? `A tientas notas: ${list(touch)}.` : undefined });
  } else {
    const first = !rs.visitada;
    rs.visitada = true;
    const prose = [rs.desc_generada ?? room.desc_base, ...rs.cambios.map((f) => room.cambios[f]!)].join(" ");
    t.events.push({ ...ev(first ? "sala_nueva" : "sala", `${head} ${prose}`, room.id), detalle: roomDetail(t), cabecera: head });
  }
  if (!arriving) return;
  for (const trg of room.al_entrar) {
    if (rs.disparados.includes(trg.id) || !t.ok(trg.si)) continue;
    rs.disparados.push(trg.id);
    if (trg.sentido) rs.percibido[trg.sentido].push(trg.texto);
    t.say(trg.texto);
    applyEffects(t, trg.efectos);
  }
  groupReunion(t);
  const foe = room.enemigos.find((e) => t.s.enemigos[e]?.vivo);
  if (foe && !t.s.combate && !looking) startCombat(t, foe);
}

/** «Llegas al frente de trabajo.» / «Estás en las galerías viejas.» a partir del nombre de la sala. */
export function roomHeader(nombre: string, how: "llegar" | "estar"): string {
  const n = nombre.charAt(0).toLowerCase() + nombre.slice(1);
  if (how === "estar") return `Estás en ${n}.`;
  return `Llegas ${n.startsWith("el ") ? `al ${n.slice(3)}` : `a ${n}`}.`;
}

function roomDetail(t: Turn): string {
  const parts: string[] = [];
  const items = visibleItems(t).map((i) => t.pack.item(i)).filter((it) => it.tipo !== "escenario" || it.listar).map((it) => it.nombre);
  const npcs = t.room.npcs.filter((n) => t.s.npcs[n]?.vivo).map((n) => t.pack.npc(n).nombre);
  const foes = t.room.enemigos.filter((e) => t.s.enemigos[e]?.vivo).map((e) => t.pack.enemy(e).nombre);
  if (items.length) parts.push(`Ves: ${list(items)}.`);
  if (npcs.length) parts.push(`Aquí está ${list(npcs)}.`);
  if (foes.length) parts.push(`¡Cuidado: ${list(foes)}!`);
  if (t.pack.quest.grupo && t.s.grupo && groupPresent(t)) parts.push(`${cap(t.pack.quest.grupo.nombre)} está contigo.`);
  const exits = (Object.entries(t.room.salidas) as [Direction, (typeof t.room.salidas)[Direction]][])
    .filter(([, x]) => x && t.ok(x.visible_si))
    .map(([d]) => d);
  parts.push(exits.length ? `Salidas: ${exits.join(", ")}.` : "No ves salidas.");
  return parts.join(" ");
}

function inventory(t: Turn) {
  const inv = t.s.inventario.map((i) => t.pack.item(i).nombre);
  const eq = Object.entries(t.s.equipo).filter(([, v]) => v).map(([k, v]) => `${t.pack.item(v!).nombre} (${k})`);
  const inj = Object.entries(t.s.injertos).filter(([, v]) => v).map(([k, v]) => `${t.pack.item(v!).nombre} (${k})`);
  t.say([
    inv.length ? `Llevas: ${list(inv)}.` : "No llevas nada en las manos ni en los bolsillos.",
    eq.length ? `Equipado: ${list(eq)}.` : "",
    inj.length ? `Injertado: ${list(inj)}.` : "",
  ].filter(Boolean).join(" "));
}

function status(t: Turn) {
  const s = t.s;
  const name = (id: string) => t.pack.item(id).nombre;
  const eq = (Object.entries(s.equipo) as [EquipSlot, string][]).filter(([, v]) => v).map(([k, v]) => `${name(v)} (${k})`);
  const inj = (Object.entries(s.injertos) as [GraftSlot, string][]).filter(([, v]) => v).map(([k, v]) => `${name(v)} (${SLOT_NAMES[k].replace(/^(el|la) /, "")})`);
  t.say([
    `Vida ${s.vida}/${s.vida_max}. Ataque ${attack(s, t.pack)}. Defensa ${defense(s, t.pack)}.${graftsKnown(s) ? ` Corrupción ${s.corrupcion}/100.` : ""}`,
    `Equipado: ${eq.length ? list(eq) : "nada"}.`,
    // Hasta el primer injerto, el jugador no sabe que existen
    ...(inj.length ? [`Injertos: ${list(inj)}.`] : []),
  ].join("\n"));
}

function examine(t: Turn, ref: Ref) {
  if (ref.kind === "npc") return t.say(t.pack.npc(ref.id).desc_base);
  if (ref.kind === "enemigo") return t.say(t.pack.enemy(ref.id).desc_base);
  if (ref.kind === "grupo") return t.say(t.pack.quest.grupo!.desc[t.s.grupo!.estado] ?? t.pack.quest.grupo!.nombre);
  const it = t.pack.item(ref.id);
  t.say([it.desc_base, it.examinar].filter(Boolean).join(" "));
  applyEffects(t, it.al_examinar);
}

function take(t: Turn, ref: Ref) {
  if (ref.kind !== "item") return t.err("Eso no se puede coger.");
  if (carried(t.s).includes(ref.id)) return t.err("Ya lo llevas.");
  const it = t.pack.item(ref.id);
  if (it.fijo && it.al_coger) return t.err(it.al_coger);
  if (it.fijo) return t.err(it.tipo === "escenario" ? `No merece la pena cargar con ${it.nombre}.` : `No puedes llevarte ${it.nombre}.`);
  t.roomState.objetos = t.roomState.objetos.filter((o) => o !== ref.id);
  if (it.tipo === "injerto" && it.injerta_al_coger) return doGraft(t, it.id); // te atrapa
  t.s.inventario.push(ref.id);
  t.say(`Coges ${it.nombre}.`);
}

function drop(t: Turn, ref: Ref) {
  if (ref.kind !== "item" || !t.s.inventario.includes(ref.id)) return t.err("No llevas eso suelto.");
  t.s.inventario = t.s.inventario.filter((i) => i !== ref.id);
  t.roomState.objetos.push(ref.id);
  t.say(`Dejas ${t.pack.item(ref.id).nombre}.`);
}

/**
 * Si el objeto está suelto en la sala y se puede coger, lo coge antes de usarlo
 * ("(Primero coges el pico.)"), como en las aventuras clásicas.
 */
function hold(t: Turn, ref: Ref): boolean {
  if (ref.kind !== "item") return false;
  if (carried(t.s).includes(ref.id)) return true;
  if (!visibleItems(t).includes(ref.id) || t.pack.item(ref.id).fijo) return false;
  if (t.pack.item(ref.id).injerta_al_coger) { take(t, ref); return carried(t.s).includes(ref.id); }
  t.roomState.objetos = t.roomState.objetos.filter((o) => o !== ref.id);
  t.s.inventario.push(ref.id);
  t.say(`(Primero coges ${t.pack.item(ref.id).nombre}.)`);
  return true;
}

function equip(t: Turn, ref: Ref) {
  if (ref.kind !== "item" || !hold(t, ref)) return t.err("No llevas eso.");
  if (!t.s.inventario.includes(ref.id)) return t.err("Ya lo llevas puesto.");
  const it = t.pack.item(ref.id);
  if (it.tipo === "injerto") return t.err("Eso no se equipa: se injerta.");
  if (!it.slot) return t.err(it.tipo === "herramienta" ? `No hace falta equipar ${it.nombre}: basta con llevarla encima.` : `No sabes cómo ponerte ${it.nombre}.`);
  const slot = it.slot as EquipSlot;
  const prev = t.s.equipo[slot];
  if (prev) t.s.inventario.push(prev);
  t.s.inventario = t.s.inventario.filter((i) => i !== ref.id);
  t.s.equipo[slot] = ref.id;
  t.say(prev ? `Cambias ${t.pack.item(prev).nombre} por ${it.nombre}.` : it.tipo === "arma" ? `Empuñas ${it.nombre}.` : `Te pones ${it.nombre}.`);
}

function unequip(t: Turn, ref: Ref) {
  if (ref.kind === "item" && Object.values(t.s.injertos).includes(ref.id)) return t.err("Eso ya es parte de ti. No sale.");
  const slot = (Object.keys(t.s.equipo) as EquipSlot[]).find((k) => t.s.equipo[k] === (ref as Ref).id);
  if (ref.kind !== "item" || !slot) return t.err("No llevas eso puesto.");
  delete t.s.equipo[slot];
  t.s.inventario.push(ref.id);
  t.say(`Te quitas ${t.pack.item(ref.id).nombre}.`);
}

function consume(t: Turn, ref: Ref) {
  if (ref.kind !== "item") return t.err("Eso no se come ni se bebe.");
  const it = t.pack.item(ref.id);
  if (it.tipo !== "consumible") return t.err("Eso no se come ni se bebe.");
  if (!hold(t, ref) || !t.s.inventario.includes(ref.id)) return t.err("No llevas eso.");
  t.s.inventario = t.s.inventario.filter((i) => i !== ref.id);
  t.say(`Das cuenta de ${it.nombre}.`);
  applyEffects(t, it.efectos_consumir);
}

function use(t: Turn, ref: Ref, con?: Ref) {
  if (ref.kind !== "item") return t.err("No ocurre nada.");
  if (con && con.kind !== "item") return t.err("No ocurre nada.");
  // "usar X con Y" también vale para combinar si hay receta
  if (con && findRecipe(t, [ref.id, con.id])) return combine(t, [ref, con]);
  if (!hold(t, ref)) return t.err(`No puedes coger ${t.pack.item(ref.id).nombre}.`);
  const tryUses = (owner: Item, other?: string) =>
    owner.usos.findIndex((u, i) => u.con === other && !(u.una_vez && t.s.usos_hechos.includes(`${owner.id}:${i}`)) && t.ok(u.si));
  const a = t.pack.item(ref.id);
  let owner = a;
  let idx = tryUses(a, con?.id);
  if (idx < 0 && con) {
    owner = t.pack.item(con.id);
    idx = tryUses(owner, ref.id);
  }
  if (idx < 0) return t.err(con ? "No ocurre nada." : `No se te ocurre cómo usar ${a.nombre} aquí.`);
  const u = owner.usos[idx]!;
  if (u.una_vez) t.s.usos_hechos.push(`${owner.id}:${idx}`);
  t.say(u.texto);
  if (u.consume) removeItem(t, owner.id);
  applyEffects(t, u.efectos);
}

function combine(t: Turn, refs: Ref[]) {
  const ids = refs.map((r) => r.id);
  if (refs.some((r) => r.kind !== "item")) return t.err("No parece que eso combine.");
  const r = findRecipe(t, ids);
  if (!r) return t.err("No parece que eso combine.");
  const missing = refs.find((x) => !hold(t, x) || !t.s.inventario.includes(x.id));
  if (missing) return t.err(`No puedes coger ${t.pack.item(missing.id).nombre}.`);
  for (const e of r.entradas) if (!r.conserva.includes(e)) t.s.inventario = t.s.inventario.filter((i) => i !== e);
  t.s.inventario.push(r.salida);
  t.say(r.texto);
}

/** «cortar X» = usar la navaja con X. Lo que se puede sacar lo define el pack con usos «con: navaja». */
const BLADE = "navaja";
function cut(t: Turn, ref: Ref) {
  if (ref.kind === "enemigo") return t.err("Primero tendrías que matarlo.");
  if (ref.kind !== "item") return t.err("No vas a hacer eso.");
  if (!t.pack.hasItem(BLADE) || !hold(t, { kind: "item", id: BLADE })) return t.err("Necesitarías algo con filo.");
  const it = t.pack.item(ref.id);
  const fromIt = it.usos.some((u, i) => u.con === BLADE && !(u.una_vez && t.s.usos_hechos.includes(`${it.id}:${i}`)));
  const fromBlade = t.pack.item(BLADE).usos.some((u) => u.con === ref.id);
  if (!fromIt && !fromBlade) return t.err(it.usos.some((u) => u.con === BLADE) ? "Ya no queda nada que sacar de ahí." : `No hay nada que sacar de ${it.nombre}.`);
  use(t, { kind: "item", id: BLADE }, ref);
}

function findRecipe(t: Turn, ids: string[]) {
  const key = [...ids].sort().join("+");
  return t.pack.data.recipes.find((x) => [...x.entradas].sort().join("+") === key);
}

function graft(t: Turn, ref: Ref) {
  if (!graftsKnown(t.s)) return t.err("No entiendo eso."); // el verbo no existe hasta el primer injerto
  if (ref.kind !== "item") return t.err("Eso no se puede injertar. Gracias a Dios.");
  const it = t.pack.item(ref.id);
  if (it.tipo !== "injerto") return t.err("Eso no se puede injertar. Gracias a Dios.");
  if (Object.values(t.s.injertos).includes(ref.id)) return t.err("Eso ya es parte de ti.");
  if (!hold(t, ref)) return t.err("No llevas eso.");
  if (!t.ok(t.pack.quest.injertar.requiere)) return t.err(t.pack.quest.injertar.texto_sin_instrumento);
  if (t.s.injertos[it.slot as GraftSlot]) return t.err(`Ya tienes algo injertado en ${SLOT_NAMES[it.slot as GraftSlot]}.`);
  doGraft(t, it.id);
}

/** Texto del injerto con la voz de la fase de corrupción en la que está el personaje al hacerlo. */
function graftText(t: Turn, it: Item): string {
  if (it.injerta_al_coger && it.texto_injerto) return it.texto_injerto; // escena forzada: texto propio
  const fases = [...t.pack.quest.voz_injerto].sort((a, b) => a.desde - b.desde);
  const fase = fases.filter((f) => f.desde <= t.s.corrupcion).at(-1);
  if (fase && it.texto_injerto_fase[String(fase.desde)]) return it.texto_injerto_fase[String(fase.desde)]!;
  if (it.injerto_nucleo) return fase ? `${fase.antes} ${it.injerto_nucleo} ${fase.despues}` : it.injerto_nucleo;
  return it.texto_injerto ?? `Te injertas ${it.nombre}.`;
}

const graftsKnown = (s: GameState) => Object.keys(s.injertos).length > 0;

/** Injerta sin más comprobaciones (las hace quien llama). El primero descubre el verbo «injertar». */
function doGraft(t: Turn, id: string) {
  const it = t.pack.item(id);
  const slot = it.slot as GraftSlot;
  const first = !graftsKnown(t.s);
  t.s.inventario = t.s.inventario.filter((i) => i !== id);
  t.s.injertos[slot] = id;
  t.say(graftText(t, it));
  changeCorruption(t, it.corrupcion ?? 0);
  if (first) t.say("[Ahora sabes que tu cuerpo acepta partes ajenas. Nuevo comando: injertar X.]");
  if (t.pack.quest.grupo?.recomprobar_al_injertar) groupRecheck(t);
}

function talk(t: Turn, ref: Ref) {
  if (ref.kind === "grupo") return t.say(t.pack.quest.grupo!.desc[t.s.grupo!.estado] ?? "No contestan.");
  if (ref.kind !== "npc") return t.err("No parece muy hablador.");
  const npc = t.pack.npc(ref.id);
  if (npc.se_niega_si.length && t.ok(npc.se_niega_si, npc.id)) return t.say(npc.texto_negativa);
  t.s.dialogo = { npc: npc.id };
  t.events.push(ev("dialogo_inicio", npc.saludo_fijo, npc.id));
}

function roomAction(t: Turn, verbo: "rezar" | "escuchar" | "oler" | "esperar") {
  const rs = t.roomState;
  const acts = t.room.acciones.filter((a) => a.verbo === verbo);
  for (const [i, a] of acts.entries()) {
    const key = `${verbo}:${i}`;
    if (!t.ok(a.si)) continue;
    if (a.una_vez && rs.acciones_hechas.includes(key)) {
      if (a.texto_repetido) return t.say(a.texto_repetido);
      continue;
    }
    if (a.una_vez) rs.acciones_hechas.push(key);
    t.say(a.texto);
    return applyEffects(t, a.efectos);
  }
  if (verbo === "escuchar" || verbo === "oler") {
    const lines = perceive(t, verbo === "escuchar" ? "oir" : "oler");
    if (lines.length) return t.say(lines.map(sentence).join(" "));
  }
  t.say(DEFAULT_ACTIONS[verbo]);
}

/**
 * Todo lo que se puede oír u oler aquí y ahora: hechos etiquetados de la sala,
 * disparadores con sentido que ya han ocurrido, y objetos, NPC y enemigos presentes.
 */
function perceive(t: Turn, sense: "oir" | "oler"): string[] {
  const room = t.room;
  const rs = t.roomState;
  const out = [...room.percepcion[sense], ...rs.percibido[sense]];
  for (const id of rs.objetos) {
    const it = t.pack.item(id);
    if (it[sense] && t.ok(it.visible_si)) out.push(it[sense]!);
  }
  for (const n of room.npcs) if (t.s.npcs[n]?.vivo && t.pack.npc(n)[sense]) out.push(t.pack.npc(n)[sense]!);
  for (const e of room.enemigos) if (t.s.enemigos[e]?.vivo && t.pack.enemy(e)[sense]) out.push(t.pack.enemy(e)[sense]!);
  for (const p of room.percepciones) if (p.sentido === sense && t.ok(p.si)) out.push(p.texto);
  for (const a of t.pack.quest.ambiente) if (a.sentido === sense && t.ok(a.si)) out.push(a.texto);
  return out;
}

const sentence = (s: string) => {
  const c = s.charAt(0).toUpperCase() + s.slice(1);
  return /[.!?…»]$/.test(c) ? c : `${c}.`;
};

// ───────────────────────── Combate ─────────────────────────

function startCombat(t: Turn, enemy: string) {
  t.s.combate = { enemigo: enemy };
  t.events.push(ev("combate_inicio", t.pack.enemy(enemy).inicio, enemy));
}

function attackCmd(t: Turn, ref: Ref, con?: Ref) {
  if (con && !readyWeapon(t, ref, con)) return;
  if (t.s.vida <= 0) return;
  if (ref.kind === "grupo") return attackGroup(t);
  if (ref.kind === "npc") return t.err("No vas a ponerle la mano encima. Todavía.");
  if (ref.kind !== "enemigo") return t.err("Eso no tiene sentido.");
  if (!t.s.combate) startCombat(t, ref.id);
  const e = t.pack.enemy(ref.id);
  const es = t.s.enemigos[ref.id]!;
  const dmg = Math.max(0, roll(t.s, 0, 3) + attack(t.s, t.pack) - e.defensa);
  if (dmg === 0) return t.events.push(ev("golpe", pick(t.s, e.golpes.fallo)));
  es.vida -= dmg;
  if (es.vida > 0) return t.events.push(ev("golpe", pick(t.s, e.golpes.jugador)));
  es.vivo = false;
  t.s.combate = undefined;
  t.events.push(ev("enemigo_muerto", e.muerte, e.id));
  for (const b of e.botin) t.roomState.objetos.push(b);
  applyEffects(t, e.al_morir);
}

/**
 * «atacar X con Y»: si Y no está ya en la mano, hay que empuñarlo primero.
 * Eso cuesta tiempo: si hay un enemigo delante, aprovecha para golpear.
 * Devuelve false si no se puede atacar con Y.
 */
function readyWeapon(t: Turn, target: Ref, con: Ref): boolean {
  if (con.kind !== "item") return (t.err("Eso no es un arma."), false);
  if (Object.values(t.s.injertos).includes(con.id)) return true; // el brazo injertado ya es tuyo
  if (t.s.equipo.mano === con.id) return true;
  const it = t.pack.item(con.id);
  if (it.slot !== "mano" || !it.stats?.ataque) return (t.err(`No vas a pelear con ${it.nombre}.`), false);
  if (!hold(t, con)) return (t.err(`No llevas ${it.nombre}.`), false);
  equip(t, con);
  const foe = t.s.combate?.enemigo ?? (target.kind === "enemigo" && t.s.enemigos[target.id]?.vivo ? target.id : undefined);
  if (foe) {
    if (!t.s.combate) startCombat(t, foe);
    t.say(`${cap(t.pack.enemy(foe).nombre)} aprovecha mientras cambias de arma.`);
    enemyStrike(t, foe);
  }
  return true;
}

function enemyStrike(t: Turn, foe: string) {
  const e = t.pack.enemy(foe);
  const dmg = Math.max(0, roll(t.s, 0, 2) + e.ataque - defense(t.s, t.pack));
  if (dmg === 0) return t.events.push(ev("golpe", `${cap(e.nombre)} falla por poco.`));
  t.s.vida -= dmg;
  t.events.push(ev("golpe", `${pick(t.s, e.golpes.enemigo)} (-${dmg} vida)`));
}

function flee(t: Turn) {
  if (!t.s.combate) return t.err("No hay nada de lo que huir. De momento.");
  const back = t.s.sala_anterior;
  if (!back) return t.err("No hay por dónde huir.");
  t.s.combate = undefined;
  t.say("Das media vuelta y corres a ciegas por donde viniste.");
  moveTo(t, back);
}

function otherTurns(t: Turn, cmd: Command) {
  // El enemigo responde si el combate sigue (huir ya lo ha cerrado).
  if (t.s.combate && cmd.verbo !== "huir" && t.s.vida > 0) enemyStrike(t, t.s.combate.enemigo);
  const g = t.pack.quest.grupo;
  if (g && t.s.grupo && t.s.sala === g.sala && band(t, t.s.grupo.estado)?.hostil) {
    t.s.vida -= g.ataque_hostil;
    t.events.push(ev("golpe", `${g.texto_ataque_hostil} (-${g.ataque_hostil} vida)`));
  }
  if (t.s.vida <= 0) {
    t.s.combate = undefined;
    t.events.push(ev("jugador_muerto", "Caes de rodillas sobre el barro negro. La mina se cierra sobre ti como un puño."));
  }
}

// ───────────────────────── Cuadrilla ─────────────────────────

function band(t: Turn, estado: string) {
  return t.pack.quest.grupo?.bandas.find((b) => b.estado === estado);
}

function bandFor(t: Turn) {
  const bands = t.pack.quest.grupo!.bandas;
  return bands.find((b) => t.s.corrupcion <= b.max) ?? bands[bands.length - 1]!;
}

function groupPresent(t: Turn): boolean {
  const g = t.pack.quest.grupo!;
  const st = t.s.grupo!;
  if (!st.visto) return false;
  const b = band(t, st.estado);
  if (b?.sigue) return true; // te acompaña
  return t.s.sala === g.sala && !!b?.hostil;
}

function groupReunion(t: Turn) {
  const g = t.pack.quest.grupo;
  if (!g || !t.s.grupo || t.s.grupo.visto || t.s.sala !== g.sala || isDark(t)) return;
  const b = bandFor(t);
  t.s.grupo = { estado: b.estado, visto: true };
  t.events.push(ev("grupo", b.texto, b.estado));
}

function groupRecheck(t: Turn) {
  const st = t.s.grupo;
  if (!st?.visto || !band(t, st.estado)?.sigue) return;
  const b = bandFor(t);
  if (b.estado === st.estado) return;
  st.estado = b.estado;
  t.events.push(ev("grupo", b.texto, b.estado));
}

function attackGroup(t: Turn) {
  const g = t.pack.quest.grupo!;
  t.s.grupo!.estado = g.atacar.estado;
  t.say(g.atacar.texto);
  applyEffects(t, g.atacar.efectos);
}

// ───────────────────────── Efectos y finales ─────────────────────────

function applyEffects(t: Turn, effects: readonly string[]) {
  for (const e of effects) {
    let m: RegExpMatchArray | null;
    if ((m = e.match(/^(!?)flag:(.+)$/))) setFlag(t, m[2]!, !m[1]);
    else if ((m = e.match(/^corrupcion([+-]\d+)$/))) changeCorruption(t, Number(m[1]));
    else if ((m = e.match(/^vida([+-]\d+)$/))) t.s.vida = Math.min(t.s.vida_max, t.s.vida + Number(m[1]));
    else if ((m = e.match(/^dar:(.+)$/))) t.s.inventario.push(m[1]!);
    else if ((m = e.match(/^quitar:(.+)$/))) removeItem(t, m[1]!);
    else if ((m = e.match(/^aparece:(.+)$/))) t.roomState.objetos.push(m[1]!);
    else if ((m = e.match(/^ir:(.+)$/))) moveTo(t, m[1]!);
  }
}

function setFlag(t: Turn, flag: string, on: boolean) {
  t.s.flags[flag] = on;
  if (!on) return;
  for (const l of t.pack.data.locations) {
    const rs = t.s.salas[l.id]!;
    if (l.cambios[flag] && !rs.cambios.includes(flag)) rs.cambios.push(flag);
  }
}

function removeItem(t: Turn, id: string) {
  t.s.inventario = t.s.inventario.filter((i) => i !== id);
  for (const k of Object.keys(t.s.equipo) as EquipSlot[]) if (t.s.equipo[k] === id) delete t.s.equipo[k];
  for (const rs of Object.values(t.s.salas)) rs.objetos = rs.objetos.filter((o) => o !== id);
}

function changeCorruption(t: Turn, delta: number) {
  const before = t.s.corrupcion;
  t.s.corrupcion = Math.max(0, Math.min(100, t.s.corrupcion + delta));
  delta = t.s.corrupcion - before;
  if (!delta) return; // p. ej. rezar sin corrupción: no se dice nada (ni se delata que existe)
  t.events.push(ev("corrupcion", delta > 0 ? `[Corrupción +${delta} → ${t.s.corrupcion}]` : `[Corrupción ${delta} → ${t.s.corrupcion}]`));
  for (const u of t.pack.quest.umbrales) {
    if (u.valor > t.s.umbral_alcanzado && t.s.corrupcion >= u.valor) {
      t.s.umbral_alcanzado = u.valor;
      t.events.push(ev("umbral", u.texto, String(u.valor)));
    }
  }
}

function checkEndings(t: Turn) {
  if (t.s.final) return;
  for (const f of t.pack.quest.finales) {
    if (t.ok(f.si)) {
      t.s.final = f.id;
      t.s.combate = undefined;
      t.s.dialogo = undefined;
      t.events.push(ev("final", f.texto, f.id));
      return;
    }
  }
}

// ───────────────────────── Utilidades ─────────────────────────

function isDark(t: Turn): boolean {
  return t.room.oscura && !powers(t.s, t.pack).has("luz");
}

function visibleItems(t: Turn): string[] {
  const dark = isDark(t);
  return t.roomState.objetos.filter((id) => {
    const it = t.pack.item(id);
    return (!dark || it.palpable) && t.ok(it.visible_si);
  });
}

/** Para los NPC y el narrador: ¿qué poderes y visibilidad hay? */
export function darkHere(s: GameState, pack: Pack): boolean {
  return isDark(new Turn(s, pack));
}

const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs.at(-1)}`);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const SLOT_NAMES: Record<GraftSlot, string> = { ojo: "el ojo", brazo: "el brazo", piel: "la piel", pulmon: "el pulmón", lengua: "la lengua" };
void GRAFT_SLOTS;

const DEFAULT_ACTIONS = {
  rezar: "Rezas en voz baja. La mina no contesta.",
  escuchar: "Solo oyes tu propia respiración.",
  oler: "Huele a mina: polvo de carbón, humedad y sudor viejo.",
  esperar: "Esperas. Nada cambia, salvo el miedo.",
} as const;

const help = (s: GameState) => [
  "Comandos: norte/sur/este/oeste (n s e o), subir, bajar, entrar, salir, mirar, mapa, examinar X, coger X, dejar X,",
  "inventario (i), estado, equipar X, desequipar X, usar X [con Y], combinar X con Y, comer/beber X,",
  `cortar X, ${graftsKnown(s) ? "injertar X, " : ""}atacar X [con Y], huir, hablar con X ("adiós" para terminar), rezar, escuchar, oler, esperar.`,
].join("\n");

/** Guarda la descripción que el narrador generó para una sala (una vez por partida). */
export function storeRoomDescription(state: GameState, roomId: string, prose: string): GameState {
  const s = structuredClone(state);
  const rs = s.salas[roomId];
  if (rs && !rs.desc_generada) rs.desc_generada = prose;
  return s;
}

/** Texto de la sala que el jugador tiene delante (vacío a oscuras), para reconocer el decorado. */
export function ambientText(s: GameState, pack: Pack): string {
  const t = new Turn(s, pack);
  if (isDark(t)) return "";
  const room = t.room;
  const rs = t.roomState;
  return [rs.desc_generada ?? "", room.desc_base, ...room.hechos, ...rs.cambios.map((f) => room.cambios[f] ?? "")].join(" ");
}

// ───────────────────────── Mapa ─────────────────────────

export interface MapRoom {
  id: string;
  etiqueta: string;
  x: number;
  y: number;
  estado: "actual" | "vista" | "intuida"; // intuida: se ve una salida hacia ella, pero no se ha pisado
  sube: boolean; // tiene una salida visible a un nivel superior
  baja: boolean;
}
export interface MapLevel {
  nivel: number;
  nombre: string;
  salas: MapRoom[];
  tuneles: { a: string; b: string }[];
}
export interface MapData {
  actual: number; // nivel donde está el jugador
  niveles: MapLevel[]; // solo los niveles con algo conocido, de arriba abajo
}

/** Lo que el jugador sabe del mapa. Lo calcula el motor; el frontend solo lo dibuja. */
export function mapData(s: GameState, pack: Pack): MapData | null {
  const t = new Turn(s, pack);
  if (!pack.location(s.sala).mapa) return null;
  const pos = (id: string) => pack.location(id).mapa!;
  const state = new Map<string, MapRoom["estado"]>();
  for (const l of pack.data.locations) if (s.salas[l.id]?.explorada) state.set(l.id, "vista");
  state.set(s.sala, "actual");
  const links = new Set<string>();
  const vertical = new Map<string, { sube: boolean; baja: boolean }>();
  for (const id of [...state.keys()]) {
    const v = { sube: false, baja: false };
    for (const [dir, exit] of Object.entries(pack.location(id).salidas)) {
      if (!exit || !t.ok(exit.visible_si)) continue;
      // Una salida sin destino solo cuenta si hace algo (la chimenea de escape), no si es un callejón
      if (!exit.a) { if (exit.efectos.length && dir === "subir") v.sube = true; if (exit.efectos.length && dir === "bajar") v.baja = true; continue; }
      if (!state.has(exit.a)) state.set(exit.a, "intuida");
      const dn = pos(exit.a).nivel - pos(id).nivel;
      if (dn < 0) v.sube = true;
      else if (dn > 0) v.baja = true;
      else links.add([id, exit.a].sort().join("|"));
    }
    vertical.set(id, v);
  }
  const byLevel = new Map<number, MapLevel>();
  for (const [id, estado] of state) {
    const m = pos(id);
    if (!byLevel.has(m.nivel)) byLevel.set(m.nivel, { nivel: m.nivel, nombre: pack.quest.niveles.find((n) => n.nivel === m.nivel)?.nombre ?? "", salas: [], tuneles: [] });
    const v = vertical.get(id) ?? { sube: false, baja: false };
    byLevel.get(m.nivel)!.salas.push({ id, etiqueta: m.etiqueta, x: m.x, y: m.y, estado, ...v });
  }
  for (const k of links) {
    const [a, b] = k.split("|") as [string, string];
    byLevel.get(pos(a).nivel)?.tuneles.push({ a, b });
  }
  return { actual: pos(s.sala).nivel, niveles: [...byLevel.values()].sort((a, b) => a.nivel - b.nivel) };
}

/** Versión en texto del nivel actual, para la terminal de desarrollo. */
export function renderMap(s: GameState, pack: Pack): string {
  const data = mapData(s, pack);
  const lvl = data?.niveles.find((n) => n.nivel === data.actual);
  if (!data || !lvl) return "Aún no sabes dónde estás.";
  const label = (r: MapRoom) => (r.estado === "intuida" ? "?" : `${r.estado === "actual" ? "*" : ""}${r.etiqueta}${r.sube ? "↑" : ""}${r.baja ? "↓" : ""}`);
  const W = Math.max(...lvl.salas.map((r) => label(r).length)) + 2;
  const G = 3;
  const maxX = Math.max(...lvl.salas.map((r) => r.x)), maxY = Math.max(...lvl.salas.map((r) => r.y));
  const minX = Math.min(...lvl.salas.map((r) => r.x)), minY = Math.min(...lvl.salas.map((r) => r.y));
  const cols = (maxX - minX + 1) * W + (maxX - minX) * G;
  const rows: string[][] = Array.from({ length: (maxY - minY) * 2 + 1 }, () => Array(cols).fill(" "));
  const put = (r: number, c: number, txt: string) => { for (let i = 0; i < txt.length; i++) if (rows[r] && c + i < cols) rows[r]![c + i] = txt[i]!; };
  const col = (x: number) => (x - minX) * (W + G);
  for (const r of lvl.salas) put((r.y - minY) * 2, col(r.x) + Math.floor((W - label(r).length) / 2), label(r));
  const at = new Map(lvl.salas.map((r) => [r.id, r]));
  for (const { a, b } of lvl.tuneles) {
    const ra = at.get(a)!, rb = at.get(b)!;
    if (ra.y === rb.y) put((ra.y - minY) * 2, col(Math.min(ra.x, rb.x)) + W, "─".repeat(G));
    else if (ra.x === rb.x) put((Math.min(ra.y, rb.y) - minY) * 2 + 1, col(ra.x) + Math.floor((W - 1) / 2), "│");
  }
  return [`MAPA · nivel ${lvl.nivel}: ${lvl.nombre} (norte arriba)`, "", ...rows.map((r) => r.join("").trimEnd()), "", "* estás aquí · ↑↓ cambia de nivel · ? sin explorar"].join("\n");
}
