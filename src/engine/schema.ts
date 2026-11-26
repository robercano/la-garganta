// Esquemas Zod del pack de aventura. El pack es la única fuente de verdad:
// si algo no está aquí, no existe en el juego.
import { z } from "zod";
import { isCondition, isEffect } from "./conditions.js";

const Id = z.string().regex(/^[a-z0-9_]+$/, "ids en minúsculas, números y _");
const Cond = z.string().refine(isCondition, { error: (iss) => `condición no válida: ${String(iss.input)}` });
const Effect = z.string().refine(isEffect, { error: (iss) => `efecto no válido: ${String(iss.input)}` });
const Conds = z.array(Cond).default([]);
const Effects = z.array(Effect).default([]);

export const EQUIP_SLOTS = ["mano", "cuerpo", "cabeza"] as const;
export const GRAFT_SLOTS = ["ojo", "brazo", "piel", "pulmon", "lengua"] as const;
export const DIRECTIONS = ["norte", "sur", "este", "oeste", "subir", "bajar", "entrar", "salir"] as const;

const Uso = z.object({
  con: Id.optional(), // "usar X con Y"; sin "con" es "usar X" a secas
  si: Conds,
  efectos: Effects,
  texto: z.string(),
  consume: z.boolean().default(false),
  una_vez: z.boolean().default(false),
});

export const ItemSchema = z.object({
  id: Id,
  nombre: z.string(),
  alias: z.array(z.string()).min(1),
  tipo: z.enum(["herramienta", "arma", "consumible", "injerto", "pista", "material", "reliquia", "escenario"]),
  slot: z.enum([...EQUIP_SLOTS, ...GRAFT_SLOTS]).optional(),
  stats: z.object({ ataque: z.number().int().default(0), defensa: z.number().int().default(0) }).optional(),
  poderes: z.array(Id).default([]), // se activan al llevarlo encima, equiparlo o injertarlo (ver poder_si)
  poder_si: z.enum(["inventario", "equipado"]).default("inventario"),
  corrupcion: z.number().int().min(0).max(100).optional(), // solo injertos
  texto_injerto: z.string().optional(), // solo injertos
  injerta_al_coger: z.boolean().default(false), // solo injertos: al cogerlo se injerta solo, sin instrumento
  efectos_consumir: Effects, // consumibles
  usos: z.array(Uso).default([]),
  desc_base: z.string(),
  examinar: z.string().optional(), // detalle al examinar
  al_examinar: Effects, // p. ej. marcar una pista como vista
  fijo: z.boolean().default(false), // no se puede coger
  al_coger: z.string().optional(), // respuesta propia si se intenta coger algo fijo
  listar: z.boolean().optional(), // el decorado (tipo escenario) no sale en «Ves: ...» salvo que se marque
  palpable: z.boolean().default(false), // se encuentra aunque la sala esté a oscuras
  oir: z.string().optional(), // lo que se oye de él al «escuchar» (si está en la sala)
  oler: z.string().optional(),
  visible_si: Conds,
  tags: z.array(z.string()).default([]),
});

export const RecipeSchema = z.object({
  id: Id,
  entradas: z.array(Id).min(2).max(3),
  salida: Id,
  conserva: z.array(Id).default([]), // entradas que no se gastan
  texto: z.string(),
});

const Salida = z.object({
  a: Id.optional(), // sala destino; si falta, la salida solo aplica efectos (p. ej. escapar)
  si: Conds,
  bloqueo: z.string().default("No puedes ir por ahí."),
  visible_si: Conds, // salidas ocultas
  efectos: Effects,
  texto: z.string().optional(),
});

const AccionSala = z.object({
  verbo: z.enum(["rezar", "escuchar", "oler", "esperar"]),
  si: Conds,
  efectos: Effects,
  texto: z.string(),
  una_vez: z.boolean().default(false),
  texto_repetido: z.string().optional(),
});

const Sentido = z.enum(["oir", "oler"]);

const Disparador = z.object({
  id: Id,
  si: Conds,
  efectos: Effects,
  texto: z.string(),
  sentido: Sentido.optional(), // si es algo que se oye o se huele, queda para «escuchar»/«oler»
});

// Un hecho puede llevar una etiqueta de sentido al principio: "[oir] al fondo se oye gotear".
const HECHO_TAG = /^\[(oir|oír|oler)\]\s*/i;
const Hecho = z.string().regex(/^(?!\[)\S|^\[(oir|oír|oler)\]\s*\S/i, "hecho vacío o etiqueta no válida (usa [oir] u [oler] seguido del texto)");

export const LocationSchema = z.object({
  id: Id,
  nombre: z.string(),
  tono: z.string(),
  hechos: z.array(Hecho).min(1),
  desc_base: z.string(),
  oscura: z.boolean().default(false),
  salidas: z.partialRecord(z.enum(DIRECTIONS), Salida).default({}),
  objetos: z.array(Id).default([]),
  npcs: z.array(Id).default([]),
  enemigos: z.array(Id).default([]),
  acciones: z.array(AccionSala).default([]),
  al_entrar: z.array(Disparador).default([]), // se disparan una sola vez
  cambios: z.record(Id, z.string()).default({}), // flag -> frase que se añade a la descripción
  tags: z.array(z.string()).default([]),
  // Posición en el mapa: nivel (1 = el más alto) y casilla en la planta de ese nivel
  // (x crece hacia el este, y hacia el sur). La validación exige que cuadre con las salidas.
  mapa: z.object({ nivel: z.number().int().min(1), x: z.number().int().min(0), y: z.number().int().min(0), etiqueta: z.string().max(10) }).optional(),
}).transform((l) => {
  // Los hechos llegan limpios al narrador; los etiquetados quedan además como percepciones.
  const percepcion: Record<"oir" | "oler", string[]> = { oir: [], oler: [] };
  const hechos = l.hechos.map((h) => {
    const m = h.match(HECHO_TAG);
    if (!m) return h;
    const texto = h.slice(m[0].length);
    percepcion[m[1]!.toLowerCase().startsWith("ol") ? "oler" : "oir"].push(texto);
    return texto;
  });
  return { ...l, hechos, percepcion };
});

export const NpcSchema = z.object({
  id: Id,
  nombre: z.string(),
  alias: z.array(z.string()).min(1),
  arquetipo: z.string(),
  backstory: z.string(),
  tono: z.string(),
  idioma: z.string().default("español de la cuenca minera, con giros en asturiano"),
  limites: z.array(z.string()).default([]),
  confianza_inicial: z.number().int().default(0),
  sabe: z.array(z.object({ dato: z.string(), si: Conds })).default([]),
  acciones: z.array(z.object({ id: z.string().regex(/^dar:[a-z0-9_]+$/), si: Conds, texto: z.string().optional() })).default([]),
  se_niega_si: Conds,
  texto_negativa: z.string().default("No quiere hablar contigo."),
  saludo_fijo: z.string(), // texto sin IA (IA falsa y fallback)
  oir: z.string().optional(),
  oler: z.string().optional(),
  respuestas_fijas: z.array(z.string()).min(1), // IA falsa y fallback
  desc_base: z.string(),
});

export const EnemySchema = z.object({
  id: Id,
  nombre: z.string(),
  alias: z.array(z.string()).min(1),
  vida: z.number().int().positive(),
  ataque: z.number().int().min(0),
  defensa: z.number().int().min(0),
  desc_base: z.string(),
  botin: z.array(Id).default([]), // aparece en la sala al morir
  al_morir: Effects,
  golpes: z.object({ jugador: z.array(z.string()).min(1), enemigo: z.array(z.string()).min(1), fallo: z.array(z.string()).min(1) }),
  inicio: z.string(),
  muerte: z.string(),
  oir: z.string().optional(),
  oler: z.string().optional(),
});

const Banda = z.object({ max: z.number().int(), estado: Id, texto: z.string(), sigue: z.boolean(), hostil: z.boolean().default(false) });

export const QuestSchema = z.object({
  titulo: z.string(),
  intro: z.string(),
  inicio: z.object({
    sala: Id,
    inventario: z.array(Id).default([]),
    equipo: z.partialRecord(z.enum(EQUIP_SLOTS), Id).default({}),
    vida: z.number().int().positive(),
    ataque: z.number().int().min(0),
    defensa: z.number().int().min(0),
    corrupcion: z.number().int().min(0).max(100).default(0),
  }),
  umbrales: z.array(z.object({ valor: z.number().int(), texto: z.string() })),
  injertar: z.object({ requiere: Conds, texto_sin_instrumento: z.string() }),
  grupo: z
    .object({
      id: Id,
      nombre: z.string(),
      alias: z.array(z.string()).min(1),
      sala: Id, // donde se produce el reencuentro
      bandas: z.array(Banda).min(1), // ordenadas por max; se elige la primera con corrupcion <= max
      recomprobar_al_injertar: z.boolean().default(true),
      ataque_hostil: z.number().int().min(0),
      texto_ataque_hostil: z.string(),
      atacar: z.object({ efectos: Effects, texto: z.string(), estado: Id }),
      desc: z.record(Id, z.string()), // estado -> descripción al examinar
    })
    .optional(),
  niveles: z.array(z.object({ nivel: z.number().int().min(1), nombre: z.string() })).default([]),
  // Percepciones globales que dependen del estado (p. ej. voces en las paredes con corrupción alta)
  ambiente: z.array(z.object({ sentido: Sentido, si: z.array(Cond).min(1), texto: z.string() })).default([]),
  finales: z.array(z.object({ id: Id, tipo: z.enum(["victoria", "derrota", "neutral"]), si: z.array(Cond).min(1), texto: z.string() })).min(1),
});

export const PackSchema = z.object({
  id: Id,
  version: z.string(),
  quest: QuestSchema,
  items: z.array(ItemSchema),
  recipes: z.array(RecipeSchema),
  locations: z.array(LocationSchema),
  npcs: z.array(NpcSchema),
  enemies: z.array(EnemySchema),
});

export const SENSES = ["oir", "oler"] as const;
export type Sense = (typeof SENSES)[number];
export type PackInput = z.input<typeof PackSchema>;
export type PackData = z.output<typeof PackSchema>;
export type Item = z.output<typeof ItemSchema>;
export type Recipe = z.output<typeof RecipeSchema>;
export type Location = z.output<typeof LocationSchema>;
export type Npc = z.output<typeof NpcSchema>;
export type Enemy = z.output<typeof EnemySchema>;
export type Quest = z.output<typeof QuestSchema>;
export type Direction = (typeof DIRECTIONS)[number];
export type GraftSlot = (typeof GRAFT_SLOTS)[number];
export type EquipSlot = (typeof EQUIP_SLOTS)[number];
