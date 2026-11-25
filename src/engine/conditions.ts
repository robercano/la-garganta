// Mini-lenguaje de condiciones y efectos del pack, escrito a mano en los JSON.
//
// Condiciones (una lista se cumple si se cumplen todas):
//   flag:x  !flag:x        tiene:item  !tiene:item     poder:p  !poder:p
//   injerto:slot|item      en:sala     visitada:sala   muerto:enemigo
//   grupo:cuadrilla=sigue|sigue_recelo
//   corrupcion>=25  vida<=0  confianza>=3  turno>10    (>= <= > < ==)
//
// Efectos:
//   flag:x  !flag:x  corrupcion+10  corrupcion-5  vida+5  vida-2
//   dar:item  quitar:item  aparece:item  ir:sala
import type { GameState } from "./state.js";
import { carried, powers } from "./state.js";
import type { Pack } from "./pack.js";

const ID = "[a-z0-9_]+";
const COND_RES = [
  new RegExp(`^!?(flag|tiene|poder|injerto|en|visitada|muerto):${ID}$`),
  new RegExp(`^!?grupo:${ID}=${ID}(\\|${ID})*$`),
  /^(corrupcion|vida|confianza|turno)(>=|<=|==|>|<)-?\d+$/,
];
const EFFECT_RES = [new RegExp(`^!?flag:${ID}$`), /^(corrupcion|vida)[+-]\d+$/, new RegExp(`^(dar|quitar|aparece|ir):${ID}$`)];

export const isCondition = (s: string) => COND_RES.some((r) => r.test(s));
export const isEffect = (s: string) => EFFECT_RES.some((r) => r.test(s));

export interface CondContext {
  state: GameState;
  pack: Pack;
  npc?: string; // para confianza
}

export function evalCond(c: string, ctx: CondContext): boolean {
  const { state: s, pack } = ctx;
  const cmp = c.match(/^(corrupcion|vida|confianza|turno)(>=|<=|==|>|<)(-?\d+)$/);
  if (cmp) {
    const [, v, op, n] = cmp;
    const val =
      v === "corrupcion" ? s.corrupcion : v === "vida" ? s.vida : v === "turno" ? s.turno : ctx.npc ? (s.npcs[ctx.npc]?.confianza ?? 0) : 0;
    const k = Number(n);
    switch (op) {
      case ">=": return val >= k;
      case "<=": return val <= k;
      case ">": return val > k;
      case "<": return val < k;
      default: return val === k;
    }
  }
  const neg = c.startsWith("!");
  const body = neg ? c.slice(1) : c;
  const idx = body.indexOf(":");
  const kind = body.slice(0, idx);
  const arg = body.slice(idx + 1);
  let r: boolean;
  switch (kind) {
    case "flag": r = !!s.flags[arg]; break;
    case "tiene": r = carried(s).includes(arg); break;
    case "poder": r = powers(s, pack).has(arg); break;
    case "injerto": r = arg in s.injertos ? !!s.injertos[arg as keyof typeof s.injertos] : Object.values(s.injertos).includes(arg); break;
    case "en": r = s.sala === arg; break;
    case "visitada": r = !!s.salas[arg]?.visitada; break;
    case "muerto": r = s.enemigos[arg]?.vivo === false; break;
    case "grupo": {
      const [, estados] = arg.split("=");
      r = !!s.grupo && (estados ?? "").split("|").includes(s.grupo.estado);
      break;
    }
    default: throw new Error(`condición desconocida: ${c}`);
  }
  return neg ? !r : r;
}

export const evalAll = (conds: readonly string[], ctx: CondContext) => conds.every((c) => evalCond(c, ctx));

/** Ids que aparecen en condiciones y efectos, para validar referencias al cargar el pack. */
export function refsOf(expr: string): { kind: string; id: string } | null {
  const m = expr.match(/^!?(flag|tiene|poder|injerto|en|visitada|muerto|dar|quitar|aparece|ir|grupo):([a-z0-9_]+)/);
  return m ? { kind: m[1]!, id: m[2]! } : null;
}
