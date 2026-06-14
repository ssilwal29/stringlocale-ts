/**
 * Translator interface and implementations for the compile CLI.
 *
 * StubTranslator — offline, deterministic, matches the test fixture format.
 * OpenRouterTranslator — calls the OpenRouter chat-completions API.
 */
import https from "node:https";

export interface Translator {
  translateCell(
    source: string,
    locale: string,
    ckey: string,
    context?: string,
  ): Promise<string>;
  translateEnum(
    values: readonly string[],
    locale: string,
    context?: string,
  ): Promise<Record<string, string>>;
}

export class StubTranslator implements Translator {
  async translateCell(
    source: string,
    locale: string,
    ckey: string,
  ): Promise<string> {
    return ckey ? `${locale}:${source} «${ckey}»` : `${locale}:${source}`;
  }

  async translateEnum(
    values: readonly string[],
    locale: string,
  ): Promise<Record<string, string>> {
    return Object.fromEntries(values.map((v) => [v, `${locale}:${v}`]));
  }
}

interface ChatResponse {
  choices: Array<{ message: { content: string } }>;
}

/**
 * Parse a JSON object out of an LLM reply, tolerating markdown code fences and
 * surrounding prose. Returns null if no object can be recovered.
 */
function parseJsonObject(text: string): Record<string, unknown> | null {
  let s = text.trim();
  // Strip ```json ... ``` or ``` ... ``` fences.
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  // Otherwise narrow to the outermost { ... } span.
  if (!s.startsWith("{")) {
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    s = s.slice(start, end + 1);
  }
  try {
    const obj = JSON.parse(s);
    return obj && typeof obj === "object" ? (obj as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export class OpenRouterTranslator implements Translator {
  readonly model: string;
  readonly timeout: number;
  readonly retries: number;
  private readonly apiKey: string;
  private readonly progress: (msg: string) => void;

  constructor(opts: {
    apiKey?: string;
    model?: string;
    timeoutMs?: number;
    retries?: number;
    progress?: (msg: string) => void;
  } = {}) {
    this.apiKey = opts.apiKey ?? process.env["OPENROUTER_API_KEY"] ?? "";
    this.model = opts.model ?? "anthropic/claude-haiku-4-5";
    this.timeout = opts.timeoutMs ?? 60_000;
    this.retries = opts.retries ?? 3;
    this.progress = opts.progress ?? (() => {});
  }

  async translateCell(
    source: string,
    locale: string,
    ckey: string,
    context?: string,
  ): Promise<string> {
    const parts = [
      `Translate the string below to locale "${locale}".`,
      context ? `Context: ${context}` : "",
      ckey ? `Axis selection (grammar variant): ${ckey}` : "",
      "Rules:\n- Keep {placeholder} variables exactly as-is.\n- Return ONLY the translated string, nothing else.",
    ].filter(Boolean);

    const resp = await this.post({
      model: this.model,
      messages: [
        { role: "system", content: parts.join("\n") },
        { role: "user", content: source },
      ],
    });
    return resp.choices[0]?.message.content.trim() ?? source;
  }

  async translateEnum(
    values: readonly string[],
    locale: string,
    context?: string,
  ): Promise<Record<string, string>> {
    const contextLine = context ? `\nContext: ${context}` : "";
    const system =
      `Translate the following values to locale "${locale}".${contextLine}\n` +
      `Return a JSON object mapping each original value to its translation. No explanation.`;

    const resp = await this.post({
      model: this.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(values) },
      ],
    });
    const raw = resp.choices[0]?.message.content ?? "{}";
    const parsed = parseJsonObject(raw);
    if (!parsed) return Object.fromEntries(values.map((v) => [v, v]));
    // Keep only the requested keys; fall back to identity for any the model dropped.
    return Object.fromEntries(
      values.map((v) => [v, typeof parsed[v] === "string" ? parsed[v] : v]),
    );
  }

  private async post(payload: object): Promise<ChatResponse> {
    const body = JSON.stringify(payload);
    let lastErr: unknown;
    for (let attempt = 1; attempt <= this.retries; attempt++) {
      try {
        return await this.fetchJson(body);
      } catch (err) {
        lastErr = err;
        if (attempt < this.retries) {
          this.progress(`[openrouter] attempt ${attempt} failed: ${err}`);
        }
      }
    }
    throw lastErr;
  }

  private fetchJson(body: string): Promise<ChatResponse> {
    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: "openrouter.ai",
          path: "/api/v1/chat/completions",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
            "HTTP-Referer": "https://github.com/stringlocale/stringlocale",
          },
          timeout: this.timeout,
        },
        (res) => {
          let data = "";
          res.on("data", (chunk: Buffer) => (data += chunk.toString()));
          res.on("end", () => {
            try {
              resolve(JSON.parse(data) as ChatResponse);
            } catch {
              reject(new Error(`Invalid JSON from OpenRouter: ${data.slice(0, 200)}`));
            }
          });
        },
      );
      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("OpenRouter request timed out"));
      });
      req.write(body);
      req.end();
    });
  }
}
