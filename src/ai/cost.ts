// Registro de cada llamada al LLM: tokens, latencia y coste. Es la cifra que decide
// si el producto se puede monetizar, así que se mide desde la primera llamada.

export type CallKind = "sala" | "evento" | "npc" | "resumen";

export interface CallLog {
  tipo: CallKind;
  modelo: string;
  entrada: number; // tokens de entrada sin caché
  salida: number;
  cache_escritura: number;
  cache_lectura: number;
  latencia_ms: number;
  coste_usd: number | null; // null si no hay precio configurado para el modelo
  error?: string;
}

/** Precio en USD por millón de tokens. */
export interface ModelPrice {
  entrada: number;
  salida: number;
  cache_escritura: number;
  cache_lectura: number;
}

/**
 * Precios por modelo. PENDIENTE DE CONFIRMAR con la página oficial de precios
 * (https://docs.claude.com/en/docs/about-claude/pricing) antes de usar las cifras de coste.
 * Mientras un modelo no tenga precio, se registran los tokens y el coste sale como null.
 */
export const PRICES: Record<string, ModelPrice | undefined> = {};

export function costOf(model: string, u: Omit<CallLog, "tipo" | "modelo" | "latencia_ms" | "coste_usd">, prices = PRICES): number | null {
  const p = prices[model];
  if (!p) return null;
  return (u.entrada * p.entrada + u.salida * p.salida + u.cache_escritura * p.cache_escritura + u.cache_lectura * p.cache_lectura) / 1_000_000;
}

export class CostLog {
  readonly calls: CallLog[] = [];
  add(c: CallLog) { this.calls.push(c); }

  summary() {
    const sum = (k: "entrada" | "salida" | "cache_escritura" | "cache_lectura" | "latencia_ms") => this.calls.reduce((a, c) => a + c[k], 0);
    const costs = this.calls.map((c) => c.coste_usd);
    const known = costs.every((c) => c !== null);
    const byKind: Record<string, number> = {};
    for (const c of this.calls) byKind[c.tipo] = (byKind[c.tipo] ?? 0) + 1;
    return {
      llamadas: this.calls.length,
      por_tipo: byKind,
      errores: this.calls.filter((c) => c.error).length,
      tokens: { entrada: sum("entrada"), salida: sum("salida"), cache_escritura: sum("cache_escritura"), cache_lectura: sum("cache_lectura") },
      latencia_media_ms: this.calls.length ? Math.round(sum("latencia_ms") / this.calls.length) : 0,
      coste_usd: known ? costs.reduce((a, c) => a! + c!, 0) : null,
    };
  }
}
