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
    // 4. Los alias cubren cómo se nombra el objeto en su propio texto (guía §2)
    // (las palabras del nombre no hace falta repetirlas: el parser también busca por el nombre)
    const aliasWords = new Set([it.nombre, ...it.alias].flatMap((a) => normalize(a).split(" ")));
    for (const m of normalize([it.desc_base, it.examinar ?? ""].join(" ")).matchAll(/\b([a-zñ]{4,}) de ([a-zñ]{3,})\b/g)) {
      const [, x, y] = m as unknown as [string, string, string];
      if (/(ad|id)[oa]s?$/.test(x)) continue; // participios («forradas de membrana»), no son nombres
      if (aliasWords.has(y) && !aliasWords.has(x) && !STOP.has(x)) add("alias-incompleto", `objeto ${it.id}`, `la descripción dice «${x} de ${y}»: ¿falta el alias «${x}»?`, ign);
    }
    // 5. Lo fijo que no es decorado necesita una razón para no poder cogerse (guía §2)
    if (it.fijo && it.tipo !== "escenario" && !it.al_coger) add("fijo-sin-razon", `objeto ${it.id}`, `es fijo pero no es decorado: añade al_coger con el motivo`, ign);
  }

  for (const e of d.enemies) for (const ef of e.al_morir) if (ef.startsWith("dar:")) add("dar-en-silencio", `enemigo ${e.id}`, `«${ef}» al morir: usa botín o aparece: para que caiga en la sala`);
  return w;
}
