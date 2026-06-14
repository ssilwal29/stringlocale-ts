/**
 * Runtime store: holds compiled entries and serves them to resolve().
 *
 * Two construction paths, both reading the Python compiler's output:
 *   - `Store.fromData(bundle)` — a combined bundle object already in memory.
 *   - `Store.fromManifest(manifest, loader)` — split per-locale, lazily
 *     fetching each `bundle.<locale>.json` on demand via the loader.
 *
 * Holds the optional `user_adapted` adapter and an in-memory result cache.
 */
import { BUNDLE_VERSION } from "../bundle";
import type { BundleData, Entry, ManifestData } from "../bundle";
import { fallbackChain } from "./locale";

/** (locale, context, text) -> adapted text. Must be synchronous. */
export type Adapter = (
  locale: string,
  context: string | undefined,
  text: string,
) => string;

/** Fetches a split locale file by name, returning its parsed bundle. */
export type LocaleLoader = (filename: string) => BundleData | Promise<BundleData>;

export class Store {
  sourceLocale: string;
  adapter?: Adapter;

  private byLocale = new Map<string, Map<string, Entry>>();
  private loadedLocales = new Set<string>();
  private adaptCache = new Map<string, string>();
  private manifest?: ManifestData;
  private loader?: LocaleLoader;
  private pending = new Map<string, Promise<void>>();

  constructor(sourceLocale: string, adapter?: Adapter) {
    this.sourceLocale = sourceLocale;
    this.adapter = adapter;
  }

  /** Build from a combined bundle (all locales in one object). */
  static fromData(bundle: BundleData, adapter?: Adapter): Store {
    const store = new Store(bundle.source_locale, adapter);
    store.ingest(bundle);
    return store;
  }

  /** Build from a manifest; locale files are fetched lazily via `loader`. */
  static fromManifest(
    manifest: ManifestData,
    loader: LocaleLoader,
    adapter?: Adapter,
  ): Store {
    const store = new Store(manifest.source_locale, adapter);
    store.manifest = manifest;
    store.loader = loader;
    return store;
  }

  private ingest(bundle: BundleData): void {
    if (bundle.version !== BUNDLE_VERSION) {
      throw new Error(
        `bundle version mismatch: expected ${BUNDLE_VERSION}, got ${bundle.version}`,
      );
    }
    for (const entry of Object.values(bundle.entries)) {
      for (const locale of Object.keys(entry.cells)) {
        let map = this.byLocale.get(locale);
        if (!map) {
          map = new Map();
          this.byLocale.set(locale, map);
        }
        map.set(entry.id, entry);
        this.loadedLocales.add(locale);
      }
    }
  }

  /**
   * True if the locale (or any entry in its fallback chain) is already loaded.
   * e.g. `hasLocale("ne-NP")` returns true when the "ne" base bundle is loaded.
   */
  hasLocale(locale: string): boolean {
    return fallbackChain(locale).some((c) => this.loadedLocales.has(c));
  }

  /** Ensure a locale's split file is loaded (no-op for combined bundles). */
  async ensureLocale(locale: string): Promise<void> {
    if (this.hasLocale(locale)) return;
    if (!this.manifest || !this.loader) return;
    const fname = this.manifest.files[locale];
    if (!fname) return;

    let p = this.pending.get(locale);
    if (!p) {
      p = Promise.resolve(this.loader(fname))
        .then((bundle) => {
          this.ingest(bundle);
          this.pending.delete(locale);
        })
        .catch((err) => {
          // Remove the rejected promise so callers can retry.
          this.pending.delete(locale);
          throw err;
        });
      this.pending.set(locale, p);
    }
    await p;
  }

  /** Preload several locales at once. */
  async preload(locales: string[]): Promise<void> {
    await Promise.all(locales.map((l) => this.ensureLocale(l)));
  }

  entryFor(stringId: string, locale: string): Entry | undefined {
    return this.byLocale.get(locale)?.get(stringId);
  }

  adaptCached(
    locale: string,
    context: string | undefined,
    text: string,
    adapter: Adapter,
  ): string {
    const key = `${locale} ${context ?? ""} ${text}`;
    const hit = this.adaptCache.get(key);
    if (hit !== undefined) return hit;
    const result = adapter(locale, context, text);
    this.adaptCache.set(key, result);
    return result;
  }
}
