/**
 * Convenience loaders that turn the compiler's output into a Store.
 *
 *   - `loadCombined(bundle)` — a `bundle.json` already parsed.
 *   - `loadManifest(manifest, fetcher)` — split layout; `fetcher(filename)`
 *     returns the parsed `bundle.<locale>.json` on demand.
 *   - `loadFromUrl(baseUrl)` — fetches `manifest.json` (preferred) or
 *     `bundle.json` from a directory served over HTTP, wiring lazy loading.
 */
import { BUNDLE_VERSION } from "./bundle";
import type { BundleData, ManifestData } from "./bundle";
import type { Adapter } from "./runtime/store";
import { Store } from "./runtime/store";

export function loadCombined(bundle: BundleData, adapter?: Adapter): Store {
  return Store.fromData(bundle, adapter);
}

export function loadManifest(
  manifest: ManifestData,
  fetcher: (filename: string) => BundleData | Promise<BundleData>,
  adapter?: Adapter,
): Store {
  if (manifest.version !== undefined && manifest.version !== BUNDLE_VERSION) {
    throw new Error(
      `manifest version mismatch: expected ${BUNDLE_VERSION}, got ${manifest.version}`,
    );
  }
  return Store.fromManifest(manifest, fetcher, adapter);
}

/**
 * Load a bundle directory served over HTTP. Tries `manifest.json` first
 * (split, lazy per-locale), then `bundle.json` (combined, eager).
 * `baseUrl` may or may not end in a slash. `timeoutMs` aborts each fetch
 * if it hasn't responded within the given number of milliseconds.
 */
export async function loadFromUrl(
  baseUrl: string,
  opts: { adapter?: Adapter; preload?: string[]; timeoutMs?: number } = {},
): Promise<Store> {
  const base = baseUrl.endsWith("/") ? baseUrl : baseUrl + "/";

  function doFetch(url: string): Promise<Response> {
    if (opts.timeoutMs === undefined) return fetch(url);
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), opts.timeoutMs);
    return fetch(url, { signal: controller.signal }).finally(() =>
      clearTimeout(id),
    );
  }

  const manifestResp = await doFetch(base + "manifest.json");
  if (manifestResp.ok) {
    const manifest = (await manifestResp.json()) as ManifestData;
    if (manifest.version !== undefined && manifest.version !== BUNDLE_VERSION) {
      throw new Error(
        `manifest version mismatch: expected ${BUNDLE_VERSION}, got ${manifest.version}`,
      );
    }
    const store = Store.fromManifest(
      manifest,
      async (filename) => {
        const r = await doFetch(base + filename);
        if (!r.ok) throw new Error(`failed to load ${filename}: ${r.status}`);
        return (await r.json()) as BundleData;
      },
      opts.adapter,
    );
    if (opts.preload?.length) await store.preload(opts.preload);
    return store;
  }

  const combinedResp = await doFetch(base + "bundle.json");
  if (combinedResp.ok) {
    const bundle = (await combinedResp.json()) as BundleData;
    return Store.fromData(bundle, opts.adapter);
  }

  throw new Error(`no manifest.json or bundle.json under ${baseUrl}`);
}
