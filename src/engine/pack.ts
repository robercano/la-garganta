// Carga y validación del pack. Cualquier error de contenido falla aquí, al
// arrancar, y no en mitad de una partida.
import { PackSchema, type PackData, type PackInput, type Item, type Location, type Npc, type Enemy, GRAFT_SLOTS, EQUIP_SLOTS } from "./schema.js";
import { refsOf } from "./conditions.js";

export class PackError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Pack no válido:\n- ${problems.join("\n- ")}`);
  }
}

export class Pack {
  private items = new Map<string, Item>();
  private locations = new Map<string, Location>();
  private npcs = new Map<string, Npc>();
  private enemies = new Map<string, Enemy>();

  constructor(public readonly data: PackData) {
    for (const i of data.items) this.items.set(i.id, i);
    for (const l of data.locations) this.locations.set(l.id, l);
    for (const n of data.npcs) this.npcs.set(n.id, n);
    for (const e of data.enemies) this.enemies.set(e.id, e);
  }
  get quest() { return this.data.quest; }
  item(id: string): Item { return must(this.items.get(id), "objeto", id); }
  location(id: string): Location { return must(this.locations.get(id), "sala", id); }
  npc(id: string): Npc { return must(this.npcs.get(id), "NPC", id); }
  enemy(id: string): Enemy { return must(this.enemies.get(id), "enemigo", id); }
  hasItem(id: string) { return this.items.has(id); }
}

function must<T>(v: T | undefined, kind: string, id: string): T {
  if (!v) throw new Error(`${kind} desconocido: ${id}`);
  return v;
}

export function loadPack(raw: PackInput | unknown): Pack {
  const parsed = PackSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PackError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  }
  const data = parsed.data;
  const problems = crossCheck(data);
  if (problems.length) throw new PackError(problems);
  return new Pack(data);
}

function crossCheck(d: PackData): string[] {
  const p: string[] = [];
  const dup = (kind: string, ids: string[]) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) p.push(`${kind} duplicado: ${id}`);
      seen.add(id);
    }
    return seen;
  };
  const items = dup("objeto", d.items.map((i) => i.id));
  const rooms = dup("sala", d.locations.map((l) => l.id));
  const npcs = dup("NPC", d.npcs.map((n) => n.id));
  const enemies = dup("enemigo", d.enemies.map((e) => e.id));
  const powers = new Set(d.items.flatMap((i) => i.poderes));
  const grafts = new Set<string>(GRAFT_SLOTS);

  const check = (where: string, exprs: readonly string[]) => {
    for (const e of exprs) {
      const r = refsOf(e);
      if (!r) continue;
      const ok =
        r.kind === "tiene" || r.kind === "dar" || r.kind === "quitar" || r.kind === "aparece" ? items.has(r.id)
        : r.kind === "en" || r.kind === "visitada" || r.kind === "ir" ? rooms.has(r.id)
        : r.kind === "muerto" ? enemies.has(r.id)
        : r.kind === "poder" ? powers.has(r.id)
        : r.kind === "injerto" ? grafts.has(r.id) || items.has(r.id)
        : r.kind === "grupo" ? d.quest.grupo?.id === r.id
        : true;
      if (!ok) p.push(`${where}: referencia desconocida en "${e}"`);
    }
  };
  const ref = (where: string, set: Set<string>, id: string) => { if (!set.has(id)) p.push(`${where}: no existe "${id}"`); };

  for (const i of d.items) {
    if (i.tipo === "injerto") {
      if (!i.slot || !grafts.has(i.slot)) p.push(`objeto ${i.id}: un injerto necesita slot de cuerpo (${GRAFT_SLOTS.join(", ")})`);
      if (i.corrupcion === undefined) p.push(`objeto ${i.id}: un injerto necesita "corrupcion"`);
    } else if (i.slot && !(EQUIP_SLOTS as readonly string[]).includes(i.slot)) {
      p.push(`objeto ${i.id}: el slot ${i.slot} es solo para injertos`);
    }
    if (i.tipo === "consumible" && i.efectos_consumir.length === 0) p.push(`objeto ${i.id}: consumible sin efectos`);
    check(`objeto ${i.id}`, [...i.visible_si, ...i.al_examinar, ...i.efectos_consumir]);
    for (const u of i.usos) {
      if (u.con) ref(`objeto ${i.id} usos`, items, u.con);
      check(`objeto ${i.id} usos`, [...u.si, ...u.efectos]);
    }
  }
  for (const r of d.recipes) {
    for (const e of r.entradas) ref(`receta ${r.id}`, items, e);
    for (const e of r.conserva) if (!r.entradas.includes(e)) p.push(`receta ${r.id}: conserva "${e}" no es una entrada`);
    ref(`receta ${r.id}`, items, r.salida);
  }
  const placed = new Map<string, string>();
  for (const l of d.locations) {
    for (const [dir, s] of Object.entries(l.salidas)) {
      if (s.a) ref(`sala ${l.id} salida ${dir}`, rooms, s.a);
      if (!s.a && s.efectos.length === 0) p.push(`sala ${l.id} salida ${dir}: sin destino ni efectos`);
      check(`sala ${l.id} salida ${dir}`, [...s.si, ...s.visible_si, ...s.efectos]);
    }
    for (const o of l.objetos) {
      ref(`sala ${l.id}`, items, o);
      if (placed.has(o)) p.push(`objeto ${o} colocado en dos salas (${placed.get(o)} y ${l.id})`);
      placed.set(o, l.id);
    }
    for (const n of l.npcs) ref(`sala ${l.id}`, npcs, n);
    for (const e of l.enemigos) ref(`sala ${l.id}`, enemies, e);
    for (const a of l.acciones) check(`sala ${l.id} acción ${a.verbo}`, [...a.si, ...a.efectos]);
    for (const t of l.al_entrar) check(`sala ${l.id} disparador ${t.id}`, [...t.si, ...t.efectos]);
  }
  for (const n of d.npcs) {
    for (const s of n.sabe) check(`npc ${n.id} sabe`, s.si);
    for (const a of n.acciones) {
      ref(`npc ${n.id} acción`, items, a.id.slice(4));
      check(`npc ${n.id} acción ${a.id}`, a.si);
    }
    check(`npc ${n.id} se_niega_si`, n.se_niega_si);
  }
  for (const e of d.enemies) {
    for (const b of e.botin) ref(`enemigo ${e.id} botín`, items, b);
    check(`enemigo ${e.id}`, e.al_morir);
  }
  const q = d.quest;
  ref("quest.inicio", rooms, q.inicio.sala);
  for (const i of [...q.inicio.inventario, ...Object.values(q.inicio.equipo)]) if (i) ref("quest.inicio", items, i);
  check("quest.injertar", q.injertar.requiere);
  if (q.grupo) {
    ref("quest.grupo", rooms, q.grupo.sala);
    const sorted = [...q.grupo.bandas].sort((a, b) => a.max - b.max);
    if (sorted.some((b, i) => b !== q.grupo!.bandas[i])) p.push("quest.grupo.bandas: deben ir ordenadas por max");
    check("quest.grupo.atacar", q.grupo.atacar.efectos);
  }
  for (const f of q.finales) check(`final ${f.id}`, f.si);
  return p;
}
