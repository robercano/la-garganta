// Parser clásico en español, sin IA. Solo resuelve nombres contra lo que el
// jugador tiene al alcance (sala, inventario, equipo, injertos).
import type { Direction } from "./schema.js";
import { normalize } from "./normalize.js";

export type RefKind = "item" | "npc" | "enemigo" | "grupo";
export interface Ref { kind: RefKind; id: string }
export interface Candidate extends Ref {
  nombre: string;
  alias: string[];
  consumible?: boolean;
  texto?: string; // descripción del decorado: lo que nombra se resuelve a él («el ojo» de los exvotos)
}

export type Command =
  | { verbo: "ir"; dir: Direction }
  | { verbo: "mirar" }
  | { verbo: "inventario" }
  | { verbo: "mapa" }
  | { verbo: "estado" }
  | { verbo: "ayuda" }
  | { verbo: "huir" }
  | { verbo: "rezar" | "escuchar" | "oler" | "esperar" }
  | { verbo: "examinar" | "coger" | "dejar" | "equipar" | "desequipar" | "consumir" | "injertar" | "atacar" | "hablar"; obj: Ref }
  | { verbo: "usar"; obj: Ref; con?: Ref }
  | { verbo: "combinar"; objs: Ref[] };

export type ParseResult = { ok: true; cmd: Command } | { ok: false; texto: string };

const DIRS: Record<string, Direction> = {
  n: "norte", norte: "norte", s: "sur", sur: "sur", e: "este", este: "este", o: "oeste", oeste: "oeste",
  subir: "subir", sube: "subir", arriba: "subir", bajar: "bajar", baja: "bajar", abajo: "bajar",
  trepar: "subir", trepa: "subir", escalar: "subir", escala: "subir",
  entrar: "entrar", entra: "entrar", meterse: "entrar", metete: "entrar", dentro: "entrar", salir: "salir", sal: "salir", fuera: "salir",
};

const VERBS: Record<string, string> = {
  ir: "ir", ve: "ir", anda: "ir", camina: "ir", avanzar: "ir",
  mirar: "mirar", m: "mirar", l: "mirar", ver: "mirar",
  examinar: "examinar", examina: "examinar", x: "examinar", inspeccionar: "examinar", inspecciona: "examinar", leer: "examinar", lee: "examinar",
  coger: "coger", coge: "coger", tomar: "tomar", toma: "tomar", recoger: "coger", recoge: "coger", agarrar: "coger", agarra: "coger", pillar: "coger",
  dejar: "dejar", deja: "dejar", soltar: "dejar", suelta: "dejar", tirar: "dejar", tira: "dejar",
  inventario: "inventario", i: "inventario", inv: "inventario",
  mapa: "mapa", plano: "mapa",
  estado: "estado", diagnostico: "estado",
  ayuda: "ayuda", "?": "ayuda", comandos: "ayuda",
  equipar: "equipar", equipa: "equipar", ponerse: "equipar", ponte: "equipar", poner: "equipar", empuñar: "equipar", empuña: "equipar",
  desequipar: "desequipar", desequipa: "desequipar", quitarse: "desequipar", quitate: "desequipar", quitar: "desequipar", guardar: "desequipar", guarda: "desequipar",
  usar: "usar", usa: "usar", utilizar: "usar", utiliza: "usar", encender: "usar", enciende: "usar",
  consumir: "consumir", consume: "consumir", comer: "consumir", come: "consumir", beber: "consumir", bebe: "consumir",
  combinar: "combinar", combina: "combinar", craftear: "combinar", mezclar: "combinar", mezcla: "combinar", juntar: "combinar", junta: "combinar",
  hablar: "hablar", habla: "hablar", saludar: "hablar", saluda: "hablar",
  atacar: "atacar", ataca: "atacar", golpear: "atacar", golpea: "atacar", pegar: "atacar", pega: "atacar", matar: "atacar", mata: "atacar", luchar: "atacar", lucha: "atacar",
  injertar: "injertar", injerta: "injertar", implantar: "injertar", implanta: "injertar", injertarse: "injertar",
  rezar: "rezar", reza: "rezar", orar: "rezar", ora: "rezar",
  escuchar: "escuchar", escucha: "escuchar", oir: "escuchar", oye: "escuchar",
  oler: "oler", huele: "oler", olfatear: "oler", olfatea: "oler", olisquear: "oler", olisquea: "oler",
  esperar: "esperar", espera: "esperar", z: "esperar",
  huir: "huir", huye: "huir", escapar: "huir", escapa: "huir",
};

const FILLER = new Set(["a", "al", "hacia", "por", "con", "en", "de", "mi", "tu", "su"]);

/**
 * ambient: texto que el jugador está leyendo de la sala (descripción y hechos).
 * Si nombra algo que aparece ahí pero no es un objeto del pack, el juego lo
 * reconoce como decorado en vez de decir «No sé a qué te refieres».
 */
export function parse(input: string, scope: Candidate[], catalog: Candidate[] = [], ambient = ""): ParseResult {
  env = { ambient, verbo: "" };
  const words = normalize(input).split(" ").filter(Boolean);
  if (!words.length) return { ok: false, texto: "¿Perdón?" };
  const [w0, ...rest] = words as [string, ...string[]];

  // Dirección a secas o con complemento: "n", "bajar", "entrar en la grieta", "salir de la sima"
  if (DIRS[w0] && !(w0 in VERBS && VERBS[w0] !== "ir")) return { ok: true, cmd: { verbo: "ir", dir: DIRS[w0]! } };
  const verb = VERBS[w0];
  if (!verb) return { ok: false, texto: "No entiendo eso." };
  env.verbo = verb;

  switch (verb) {
    case "ir": {
      const d = rest.filter((w) => !FILLER.has(w)).map((w) => DIRS[w]).find(Boolean);
      return d ? { ok: true, cmd: { verbo: "ir", dir: d } } : { ok: false, texto: "¿Hacia dónde?" };
    }
    case "mirar":
      if (rest.length === 0) return { ok: true, cmd: { verbo: "mirar" } };
      return one("examinar", rest, scope, catalog);
    case "inventario": case "mapa": case "estado": case "ayuda": case "huir": case "rezar": case "escuchar": case "oler": case "esperar":
      return { ok: true, cmd: { verbo: verb } as Command };
    case "tomar": {
      const r = resolve(rest, scope, catalog, "¿Qué quieres tomar?");
      if (!r.ok) return r;
      return { ok: true, cmd: { verbo: r.ref.consumible ? "consumir" : "coger", obj: strip(r.ref) } };
    }
    case "hablar": case "examinar": case "coger": case "dejar": case "equipar": case "desequipar": case "consumir": case "atacar": case "injertar": {
      // "injertar pulmon en pecho": se ignora el destino; el slot lo define el objeto
      const words = verb === "injertar" ? cutAt(rest, "en") : rest;
      return one(verb, words, scope, catalog);
    }
    case "usar": {
      const [a, b] = splitOn(rest, ["con", "en", "sobre"]);
      const ra = resolve(a, scope, catalog, "¿Qué quieres usar?");
      if (!ra.ok) return ra;
      if (!b.length) return { ok: true, cmd: { verbo: "usar", obj: strip(ra.ref) } };
      const rb = resolve(b, scope, catalog, "¿Con qué?");
      if (!rb.ok) return rb;
      return { ok: true, cmd: { verbo: "usar", obj: strip(ra.ref), con: strip(rb.ref) } };
    }
    case "combinar": {
      const parts = splitAll(rest, ["con", "y"]);
      if (parts.length < 2) return { ok: false, texto: "¿Combinar qué con qué?" };
      const refs: Ref[] = [];
      for (const p of parts) {
        const r = resolve(p, scope, catalog, "¿Combinar qué?");
        if (!r.ok) return r;
        refs.push(strip(r.ref));
      }
      return { ok: true, cmd: { verbo: "combinar", objs: refs } };
    }
  }
  return { ok: false, texto: "No entiendo eso." };
}

type Resolved = Candidate;

function one(verbo: string, words: string[], scope: Candidate[], catalog: Candidate[]): ParseResult {
  const r = resolve(words, scope, catalog, `¿Qué quieres ${verbo}?`);
  if (!r.ok) return r;
  return { ok: true, cmd: { verbo, obj: strip(r.ref) } as Command };
}

const strip = (c: Candidate): Ref => ({ kind: c.kind, id: c.id });

function resolve(words: string[], scope: Candidate[], catalog: Candidate[], ask: string): { ok: true; ref: Resolved } | { ok: false; texto: string } {
  const phrase = words.filter((w) => !FILLER.has(w)).join(" ");
  if (!phrase) return { ok: false, texto: ask };
  const matches = match(phrase, scope);
  if (matches.length === 1) return { ok: true, ref: matches[0]! };
  if (matches.length > 1) {
    const names = matches.map((m) => m.nombre);
    return { ok: false, texto: `¿Cuál: ${names.slice(0, -1).join(", ")} o ${names.at(-1)}?` };
  }
  // Algo que se menciona en la descripción de un decorado presente es parte de ese decorado
  const inDecor = scope.filter((c) => c.texto && ambientNoun(phrase, c.texto));
  const exact = inDecor.filter((c) => ambientNoun(phrase, c.texto!, true));
  const pick = inDecor.length === 1 ? inDecor : exact.length === 1 ? exact : [];
  if (pick.length === 1) return { ok: true, ref: pick[0]! };
  if (match(phrase, catalog).length) return { ok: false, texto: "No ves eso por aquí." };
  const deco = ambientNoun(phrase, env.ambient);
  if (deco) return { ok: false, texto: decorText(env.verbo, deco) };
  return { ok: false, texto: "No sé a qué te refieres." };
}

function match(phrase: string, cands: Candidate[]): Resolved[] {
  const exact = cands.filter((c) => c.alias.some((a) => normalize(a) === phrase) || normalize(c.nombre) === phrase);
  if (exact.length) return dedupe(exact);
  const pw = phrase.split(" ");
  const words = (c: Candidate) => [c.nombre, ...c.alias].map((a) => normalize(a).split(" "));
  const all = dedupe(cands.filter((c) => words(c).some((aw) => pw.every((w) => aw.includes(w)))));
  if (all.length) return all;
  // Último recurso: el objeto que comparta más palabras con lo escrito
  // ("piedras de carburo" -> el bote de carburo). Si empatan, se pregunta.
  const score = (c: Candidate) => Math.max(...words(c).map((aw) => pw.filter((w) => !FILLER.has(w) && aw.includes(w)).length));
  const scored = cands.map((c) => ({ c, n: score(c) })).filter((x) => x.n > 0);
  const best = Math.max(0, ...scored.map((x) => x.n));
  return dedupe(scored.filter((x) => x.n === best).map((x) => x.c));
}

function dedupe(c: Resolved[]): Resolved[] {
  const seen = new Set<string>();
  return c.filter((x) => (seen.has(x.kind + x.id) ? false : (seen.add(x.kind + x.id), true)));
}

function cutAt(words: string[], sep: string): string[] {
  const i = words.indexOf(sep);
  return i < 0 ? words : words.slice(0, i);
}

function splitOn(words: string[], seps: string[]): [string[], string[]] {
  const i = words.findIndex((w) => seps.includes(w));
  return i < 0 ? [words, []] : [words.slice(0, i), words.slice(i + 1)];
}

function splitAll(words: string[], seps: string[]): string[][] {
  const out: string[][] = [[]];
  for (const w of words) {
    if (seps.includes(w)) out.push([]);
    else out[out.length - 1]!.push(w);
  }
  return out.filter((p) => p.length);
}

// ───────────── Decorado: cosas que el texto nombra pero no son objetos ─────────────

let env = { ambient: "", verbo: "" };

const ART = new Set(["el", "la", "los", "las", "un", "una", "unos", "unas"]);
const NOT_NOUNS = new Set(["como", "pero", "para", "desde", "hacia", "entre", "sobre", "todo", "toda", "todos", "nadie", "algo", "aqui", "alli", "ahora", "solo", "muy", "mas", "tras", "que", "sin", "asi", "ahi", "aun", "ese", "esa", "eso", "este", "esta", "esto", "hay"]);

/** Busca en el texto de la sala la palabra que el jugador ha nombrado y la devuelve con su artículo. */
export function ambientNoun(phrase: string, ambient: string, exactOnly = false): string | null {
  if (!ambient) return null;
  const words = ambient.split(/[\s,.;:()«»"]+/).filter(Boolean);
  const norm = words.map((w) => normalizeWord(w));
  const wanted = phrase.split(" ").filter((w) => w.length >= 3 && !NOT_NOUNS.has(w) && !FILLER.has(w));
  for (const w of wanted) {
    const i = norm.findIndex((n) => n === w || (!exactOnly && (n === `${w}s` || `${n}s` === w || n === `${w}es`)));
    if (i < 0) continue;
    const prev = words[i - 1]?.toLowerCase();
    return prev && ART.has(prev) ? `${prev} ${words[i]}` : words[i]!.toLowerCase();
  }
  return null;
}

function normalizeWord(w: string): string {
  return normalize(w).split(" ")[0] ?? "";
}

function decorText(verbo: string, cosa: string): string {
  const Cosa = cosa.charAt(0).toUpperCase() + cosa.slice(1);
  const plural = /^(los|las|unos|unas) /.test(cosa) || /s$/.test(cosa);
  const sirve = plural ? "sirven" : "sirve";
  switch (verbo) {
    case "examinar": case "mirar": return `Te fijas en ${cosa}. No ves nada que te vaya a servir.`;
    case "coger": case "tomar": return `No merece la pena cargar con ${cosa}.`;
    case "atacar": return `Golpear ${cosa} no va a arreglar nada.`;
    case "hablar": return `${Cosa} no te ${plural ? "van" : "va"} a contestar.`;
    default: return `${Cosa} no te ${sirve} para eso. Es solo parte del sitio.`;
  }
}
