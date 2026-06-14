/**
 * Locale resolution: fallback chains.
 *
 * Expands a locale into the ordered list the resolver tries before dropping
 * to source: `ne-NP -> ne -> source`. Custom chains override truncation.
 * Mirrors Python `runtime/locale.py` (minus thread-local active state, which
 * the TS runtime keeps on the Store / React context instead).
 */
const customChains = new Map<string, string[]>();

export function setFallbackChain(locale: string, chain: string[]): void {
  customChains.set(locale, [...chain]);
}

export function clearFallbackChains(): void {
  customChains.clear();
}

export function clearFallbackChain(locale: string): void {
  customChains.delete(locale);
}

export function fallbackChain(locale: string): string[] {
  const custom = customChains.get(locale);
  if (custom) {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const c of custom) {
      if (!seen.has(c)) {
        seen.add(c);
        out.push(c);
      }
    }
    return out;
  }
  const out: string[] = [locale];
  const base = locale.split("-", 1)[0];
  if (base !== locale) out.push(base);
  return out;
}
