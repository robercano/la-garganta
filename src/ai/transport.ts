// Cómo llega un prompt a un modelo. El narrador y los NPC solo conocen esta
// interfaz: detrás puede estar la API de Anthropic (ClaudeClient, producción y CLI)
// o el puente de las páginas publicadas en Claude (web/sample.ts, solo para probar).
import type { CallKind } from "./cost.js";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CallInput {
  tipo: CallKind;
  /** Parte fija del prompt de sistema: se marca para la caché del proveedor. */
  systemFijo: string;
  /** Parte variable del sistema (estado del momento): no se cachea. */
  systemVariable?: string;
  messages: ChatMessage[];
  maxTokens: number;
  temperature?: number;
}

export interface LlmTransport {
  /** Devuelve el texto de la respuesta. Lanza si falla: quien llama usa el texto fijo. */
  call(input: CallInput): Promise<string>;
}
