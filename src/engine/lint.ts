// Lint de diseño del pack: avisos sobre cosas que no rompen el juego pero que
// sabemos que lo empeoran (aprendido jugando La Garganta). Cada regla enlaza
// con su apartado de docs/guia-de-diseno.md.
//
// `npm run validate` los muestra; `npm run validate -- --strict` (y la CI) falla si hay alguno.
// Para aceptar un caso concreto a sabiendas, añade su código a `lint_ignorar` del objeto o sala.
import type { Pack } from "./pack.js";
import { normalize } from "./normalize.js";

export interface LintWarning {
  regla: string; // código corto, p. ej. "sentido-sin-etiqueta"
  donde: string;
  mensaje: string;
}

const SOUND = /\b(se oye|oyes|oir|suena|sonido|canto|cantan?|rumor|eco|susurr\w*|murmur\w*|cruj\w+|chisporrot\w+|gote\w+|respiraci[oó]n|silb\w+|zumb\w+|grit\w+)\b/i;
const SMELL = /\b(huele|olor|hedor|aroma|apesta|peste|tufo)\b/i;
const TAKES = /\b(coges|recoges|te guardas|guardas|te quedas con|en el bolsillo|te lo llevas|te la llevas)\b/i;
const STOP = new Set(["de", "del", "la", "el", "los", "las", "un", "una", "unos", "unas", "y", "con", "en", "tu", "su", "al"]);

export function lintPack(pack: Pack): LintWarning[] {
  const d = pack.data;
  const w: LintWarning[] = [];
  const add = (regla: string, donde: string, mensaje: string, ignorar: readonly string[] = []) => {
    if (!ignorar.includes(regla)) w.push({ regla, donde, mensaje });
  };

  for (const l of d.locations) {
    const ign = l.lint_ignorar;
    const tagged = new Set([...l.percepcion.oir, ...l.percepcion.oler]);
    // 1. Lo que se oye o se huele debe estar etiquetado para «escuchar»/«oler» (guía §3)
    for (const h of l.hechos) {
      if (tagged.has(h)) continue;
      if (SOUND.test(h)) add("sentido-sin-etiqueta", `sala ${l.id}`, `el hecho «${h}» suena a algo audible: etiquétalo con [oir]`, ign);
      else if (SMELL.test(h)) add("sentido-sin-etiqueta", `sala ${l.id}`, `el hecho «${h}» habla de un olor: etiquétalo con [oler]`, ign);
    }
    for (const t of l.al_entrar) {
      if (t.sentido) continue;
      if (SOUND.test(t.texto)) add("sentido-sin-etiqueta", `sala ${l.id} disparador ${t.id}`, `el texto suena a algo audible: añade "sentido": "oir"`, ign);
      else if (SMELL.test(t.texto)) add("sentido-sin-etiqueta", `sala ${l.id} disparador ${t.id}`, `el texto habla de un olor: añade "sentido": "oler"`, ign);
    }
    // 2. Las piezas injertables no se dejan a la vista (guía §5)
    for (const o of l.objetos) {
      const it = pack.item(o);
      if (it.tipo === "injerto" && !it.injerta_al_coger && it.visible_si.length === 0) {
        add("injerto-a-la-vista", `sala ${l.id}`, `${it.id} está a la vista en «Ves:». Escóndelo dentro de algo (usos con navaja → aparece) o con visible_si`, [...ign, ...it.lint_ignorar]);
      }
    }
    // 3. Darle algo al jugador sin decirlo (guía §4)
    for (const a of l.acciones) for (const e of a.efectos) if (e.startsWith("dar:") && !TAKES.test(a.texto)) add("dar-en-silencio", `sala ${l.id} acción ${a.verbo}`, `«${e}» mete el objeto en el inventario sin que el texto lo diga: usa aparece: o dilo («coges…»)`, ign);
    for (const t of l.al_entrar) for (const e of t.efectos) if (e.startsWith("dar:") && !TAKES.test(t.texto)) add("dar-en-silencio", `sala ${l.id} disparador ${t.id}`, `«${e}» mete el objeto en el inventario sin que el texto lo diga`, ign);
  }

  for (const it of d.items) {
    const ign = it.lint_ignorar;
    for (const u of it.usos) for (const e of u.efectos) if (e.startsWith("dar:") && !TAKES.test(u.texto)) {
      add("dar-en-silencio", `objeto ${it.id} usos`, `«${e}» mete el objeto en el inventario sin que el texto lo diga: usa aparece: para que caiga en la sala, o dilo («coges…»)`, ign);
    }
    // 8. Lo que aparece se llama como lo nombra el texto que lo hace aparecer (guía §4)
    for (const u of it.usos) for (const e of u.efectos) if (e.startsWith("aparece:")) {
      const x = e.slice(8);
      if (!pack.hasItem(x)) continue;
      const nuc = headNoun(pack.item(x).nombre);
      if (nuc && !normalize(u.texto).split(" ").some((w) => w === nuc || w === `${nuc}s`)) add("aparece-sin-nombre", `objeto ${it.id} usos`, `hace aparecer «${pack.item(x).nombre}», pero el texto no dice «${nuc}»: el jugador no sabrá cómo llamarlo`, ign);
    }
    // 4. Los alias cubren cómo se nombra el objeto en su propio texto (guía §2)
    // (las palabras del nombre no hace falta repetirlas: el parser también busca por el nombre)
    const aliasWords = new Set([it.nombre, ...it.alias].flatMap((a) => normalize(a).split(" ")));
    for (const m of normalize([it.desc_base, it.examinar ?? ""].join(" ")).matchAll(/\b([a-zñ]{4,}) de ([a-zñ]{3,})\b/g)) {
      const [, x, y] = m as unknown as [string, string, string];
      if (/(ad|id)[oa]s?$/.test(x)) continue; // participios («forradas de membrana»), no son nombres
      if (aliasWords.has(y) && !aliasWords.has(x) && !STOP.has(x)) add("alias-incompleto", `objeto ${it.id}`, `la descripción dice «${x} de ${y}»: ¿falta el alias «${x}»?`, ign);
    }
    // 7. Los injertos se narran con la voz de la fase de corrupción (guía §8)
    if (it.tipo === "injerto" && !it.injerta_al_coger && !it.injerto_nucleo) add("injerto-sin-nucleo", `objeto ${it.id}`, `usa injerto_nucleo (lo físico, en neutro) para que la voz cambie con la corrupción`, ign);
    // 5. Lo fijo que no es decorado necesita una razón para no poder cogerse (guía §2)
    if (it.fijo && it.tipo !== "escenario" && !it.al_coger) add("fijo-sin-razon", `objeto ${it.id}`, `es fijo pero no es decorado: añade al_coger con el motivo`, ign);
  }

  // 10. Lo que llevas al empezar se cuenta en la intro, y una receta nombra lo que usa (guía §4)
  const intro = normalize(d.quest.intro).split(" ");
  for (const id of [...d.quest.inicio.inventario, ...Object.values(d.quest.inicio.equipo)]) {
    if (!id || !pack.hasItem(id)) continue;
    const nuc = headNoun(pack.item(id).nombre);
    if (nuc && !mentions(intro, pack.item(id))) add("inicio-sin-contar", `quest.inicio`, `empiezas con «${pack.item(id).nombre}», pero la intro no lo menciona: el jugador no sabrá que lo lleva`);
  }
  for (const r of d.recipes) {
    const words = normalize(r.texto).split(" ");
    for (const e of r.entradas) {
      const nuc = headNoun(pack.item(e).nombre);
      if (nuc && !mentions(words, pack.item(e))) add("receta-sin-nombrar", `receta ${r.id}`, `usa «${pack.item(e).nombre}», pero su texto no dice «${nuc}»: no se entiende de dónde sale`);
    }
  }

  // 11. Cada sala tiene frases de tránsito para cubrir la espera de la IA (guía §8)
  for (const l of d.locations) if (l.transito.length < 3) add("sala-sin-transito", `sala ${l.id}`, `tiene ${l.transito.length} frases de tránsito; pon al menos 3 para que la espera de la IA no se note`, l.lint_ignorar);

  // 9. Los NPC no sueltan nada a la primera (guía §5)
  for (const n of d.npcs) for (const s of n.sabe) {
    if (s.si.length === 0) add("npc-sin-reticencia", `npc ${n.id}`, `sabe «${s.dato.slice(0, 60)}…» sin condición: lo soltará a la primera. Ponle al menos confianza>=1`, n.lint_ignorar);
  }

  // 6. Todo poder que da un objeto tiene que notarse en algún sitio (guía §5)
  const used = new Set(allConditions(pack).flatMap((c) => [...c.matchAll(/poder:([a-z0-9_]+)/g)].map((m) => m[1]!)));
  for (const it of d.items) for (const p of it.poderes) {
    if (!used.has(p)) add("poder-sin-uso", `objeto ${it.id}`, `da el poder «${p}», pero ninguna condición del pack lo usa: el jugador no notará nada`, it.lint_ignorar);
  }

  for (const e of d.enemies) for (const b of e.botin) {
    const nuc = headNoun(pack.item(b).nombre);
    if (nuc && !normalize(e.muerte).split(" ").some((w) => w === nuc || w === `${nuc}s`)) add("aparece-sin-nombre", `enemigo ${e.id}`, `suelta «${pack.item(b).nombre}», pero su texto de muerte no dice «${nuc}»`);
  }
  for (const e of d.enemies) for (const ef of e.al_morir) if (ef.startsWith("dar:")) add("dar-en-silencio", `enemigo ${e.id}`, `«${ef}» al morir: usa botín o aparece: para que caiga en la sala`);
  return w;
}

/** Todas las condiciones del pack, para saber qué se comprueba en algún sitio. */
function allConditions(pack: Pack): string[] {
  const d = pack.data;
  const c: string[] = [...d.quest.injertar.requiere, ...d.quest.ambiente.flatMap((a) => a.si), ...d.quest.finales.flatMap((f) => f.si)];
  for (const l of d.locations) {
    for (const s of Object.values(l.salidas)) if (s) c.push(...s.si, ...s.visible_si);
    for (const a of l.acciones) c.push(...a.si);
    for (const t of l.al_entrar) c.push(...t.si);
    for (const p of l.percepciones) c.push(...p.si);
  }
  for (const it of d.items) { c.push(...it.visible_si); for (const u of it.usos) c.push(...u.si); }
  for (const n of d.npcs) { c.push(...n.se_niega_si); for (const s of n.sabe) c.push(...s.si); for (const a of n.acciones) c.push(...a.si); }
  return c;
}

/** Núcleo de un nombre: la primera palabra que no es artículo («un jirón de membrana» → «jiron»). */
function headNoun(nombre: string): string | undefined {
  return normalize(nombre).split(" ").find((w) => !STOP.has(w));
}

/** ¿El texto nombra el objeto por su núcleo o por alguna palabra significativa de sus alias? */
function mentions(words: string[], it: { nombre: string; alias: string[] }): boolean {
  const names = new Set([it.nombre, ...it.alias].flatMap((a) => normalize(a).split(" ")).filter((w) => w.length >= 4 && !STOP.has(w)));
  return words.some((w) => names.has(w) || names.has(w.replace(/s$/, "")));
}
