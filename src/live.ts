/**
 * Live (online) translation — for dynamic, user-generated text that can't be
 * pre-compiled into a bundle. Unlike the offline runtime, this calls a
 * translation API at request time.
 *
 * Keep this separate in your head from `compile`/`resolve`: those are the
 * offline path for strings you declare. `AsyncTranslator` is the online path
 * for text your app receives at runtime (a bio someone is typing, a comment).
 *
 * SECURITY: `createChatTranslator({ apiKey })` puts your key in the
 * caller. That's fine for local dev or a trusted server, but DO NOT ship a real
 * key to a browser bundle — anyone can read it. In production, point `endpoint`
 * at your own backend route that injects the key server-side.
 */

/** Translate free text to `locale` at request time. `signal` cancels in-flight calls. */
export type AsyncTranslator = (
  text: string,
  locale: string,
  context?: string,
  signal?: AbortSignal,
) => Promise<string>;

interface ChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

export interface ChatLiveOptions {
  /** API key used as `Authorization: Bearer ...`. Prefer a proxy `endpoint` in browsers. */
  apiKey?: string;
  /** Model id. Defaults to "google/gemini-2.5-flash". */
  model?: string;
  /** OpenAI-compatible chat completions URL. */
  endpoint?: string;
  /** Sent as HTTP-Referer (used by OpenRouter attribution). */
  referer?: string;
  /** Additional headers for provider-specific requirements. */
  headers?: Record<string, string>;
}

/** Backward-compatible alias. */
export type OpenRouterLiveOptions = ChatLiveOptions;

/**
 * Build an `AsyncTranslator` backed by an OpenAI-compatible chat-completions
 * API, using the platform `fetch` (browser or Node 18+).
 */
export function createChatTranslator(
  opts: ChatLiveOptions = {},
): AsyncTranslator {
  const model = opts.model ?? "google/gemini-2.5-flash";
  const endpoint =
    opts.endpoint ?? "https://openrouter.ai/api/v1/chat/completions";

  return async (text, locale, context, signal) => {
    if (!text.trim()) return text;

    const system = [
      `Translate the user's message to locale "${locale}".`,
      context ? `Context: ${context}` : "",
      "Preserve any {placeholder} tokens exactly. Return ONLY the translation —",
      "no quotes, no explanation.",
    ]
      .filter(Boolean)
      .join("\n");

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(opts.headers ?? {}),
    };
    if (opts.apiKey) headers["Authorization"] = `Bearer ${opts.apiKey}`;
    if (opts.referer) headers["HTTP-Referer"] = opts.referer;

    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: text },
        ],
      }),
      signal,
    });

    if (!res.ok) {
      throw new Error(`live translate failed: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as ChatResponse;
    return data.choices?.[0]?.message?.content?.trim() || text;
  };
}

/**
 * Backward-compatible OpenRouter-named helper.
 */
export function createOpenRouterTranslator(
  opts: OpenRouterLiveOptions = {},
): AsyncTranslator {
  return createChatTranslator(opts);
}
