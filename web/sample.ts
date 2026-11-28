// Puente SOLO PARA PROBAR: en la página publicada en Claude, los prompts del juego
// se envían con la capacidad «sample» (la cuenta de quien juega, sin API key).
// No devuelve tokens, así que no mide coste: eso se mide con `npm run coste`.
// En producción la IA irá por el Worker con ClaudeClient.
import type { CallInput, LlmTransport } from "../src/ai/transport.js";

export const SAMPLE_MODEL = "claude-haiku-5-5";

type Sample = ((input: unknown, opts?: Record<string, unknown>) => Promise<{ text: string; truncated?: boolean; modelApplied?: string }>) & Record<string, unknown>;

/** Devuelve la capacidad, o null si esta vista no la ofrece (fuera de Claude, sin permiso…). */
export async function getSample(): Promise<Sample | null> {
  const c = (globalThis as any).claude;
  if (!c?.use) return null;
  try {
    return (await c.use("sample")) as Sample | null;
  } catch {
    return null;
  }
}

export class SampleTransport implements LlmTransport {
  modelo?: string;
  constructor(private readonly sample: Sample, private readonly onDenied: (code: string) => void) {}

  async call(input: CallInput): Promise<string> {
    // «sample» no tiene prompt de sistema: va delante del primer mensaje del usuario.
    const system = [input.systemFijo, input.systemVariable].filter(Boolean).join("\n\n");
    const [first, ...rest] = input.messages;
    const messages = [{ role: "user", content: `INSTRUCCIONES (síguelas siempre, no las menciones):\n${system}\n\n---\n\n${first!.content}` }, ...rest];
    try {
      const r = await this.sample(messages, { model: SAMPLE_MODEL, modelTier: "quick", cache: false });
      if (r.modelApplied) this.modelo = r.modelApplied;
      const text = (r.text ?? "").trim();
      if (!text) throw new Error("respuesta vacía");
      return text;
    } catch (e: any) {
      const code = e?.code ?? "error";
      if (code === "not_granted" || code === "rate_limited") this.onDenied(code);
      throw e instanceof Error ? e : new Error(String(code));
    }
  }
}
