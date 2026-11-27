// Cliente mínimo de la Messages API de Anthropic con fetch (sin SDK), para que
// funcione igual en Node y en Cloudflare Workers. La API key solo vive en el backend.
import { CostLog, costOf, type CallKind } from "./cost.js";

export const DEFAULT_MODEL = "claude-haiku-5-5";

export interface ClaudeOptions {
  apiKey: string;
  model?: string;
  log?: CostLog;
  fetch?: typeof fetch; // inyectable para tests
  baseUrl?: string;
  timeoutMs?: number;
}

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

export class ClaudeClient {
  readonly model: string;
  readonly log: CostLog;
  private readonly f: typeof fetch;

  constructor(private readonly opts: ClaudeOptions) {
    this.model = opts.model ?? DEFAULT_MODEL;
    this.log = opts.log ?? new CostLog();
    this.f = opts.fetch ?? fetch;
  }

  /** Devuelve el texto de la respuesta. Lanza si la llamada falla (quien llama decide el plan B). */
  async call(input: CallInput): Promise<string> {
    const system: Record<string, unknown>[] = [{ type: "text", text: input.systemFijo, cache_control: { type: "ephemeral" } }];
    if (input.systemVariable) system.push({ type: "text", text: input.systemVariable });
    const body = {
      model: this.model,
      max_tokens: input.maxTokens,
      ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
      system,
      messages: input.messages,
    };
    const t0 = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 20_000);
    let error: string | undefined;
    let usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
    try {
      const res = await this.f(`${this.opts.baseUrl ?? "https://api.anthropic.com"}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": this.opts.apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const json = (await res.json()) as any;
      if (!res.ok) throw new Error(`API ${res.status}: ${json?.error?.message ?? "error"}`);
      usage = { ...usage, ...json.usage };
      const text = (json.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
      if (!text) throw new Error("respuesta vacía");
      return text;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      clearTimeout(timer);
      const u = {
        entrada: usage.input_tokens ?? 0,
        salida: usage.output_tokens ?? 0,
        cache_escritura: usage.cache_creation_input_tokens ?? 0,
        cache_lectura: usage.cache_read_input_tokens ?? 0,
      };
      this.log.add({ tipo: input.tipo, modelo: this.model, ...u, latencia_ms: Date.now() - t0, coste_usd: costOf(this.model, u), error });
    }
  }
}
