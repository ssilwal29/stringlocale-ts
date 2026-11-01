/**
 * Node-only helpers (`stringlocale/node`) for scripts, servers and CLIs that
 * read compiled bundles straight from disk. Kept out of the main entry so the
 * browser runtime never pulls in `node:fs`.
 *
 *   import { loadFromFile } from "stringlocale/node";
 *   import { inbox } from "./strings.js";
 *
 *   const store = loadFromFile(new URL("./i18n", import.meta.url));
 *   inbox.resolve({ store, locale: "ne-NP" }, { count: 5 });
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { BUNDLE_VERSION } from "./bundle";
import type { BundleData, Entry, ManifestData } from "./bundle";
import type { Adapter } from "./runtime/store";
import { Store } from "./runtime/store";

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function isManifest(data: unknown): data is ManifestData {
  return typeof data === "object" && data !== null && "files" in data && !("entries" in data);
}

function mergeEntry(into: Entry, from: Entry): void {
  Object.assign(into.cells, from.cells);
  for (const [param, byLocale] of Object.entries(from.enums ?? {})) {
    into.enums[param] = { ...(into.enums[param] ?? {}), ...byLocale };
  }
  Object.assign(into.hashes, from.hashes ?? {});
}

/** Read every per-locale file listed in a manifest and merge them into one combined bundle. */
function mergeSplit(manifest: ManifestData, dir: string): BundleData {
  if (manifest.version !== undefined && manifest.version !== BUNDLE_VERSION) {
    throw new Error(`manifest version mismatch: expected ${BUNDLE_VERSION}, got ${manifest.version}`);
  }
  const merged: BundleData = {
    version: BUNDLE_VERSION,
    source_locale: manifest.source_locale,
    locales: [...manifest.locales],
    entries: {},
    ...(manifest.model ? { model: manifest.model } : {}),
  };
  for (const filename of new Set(Object.values(manifest.files))) {
    const bundle = readJson<BundleData>(join(dir, filename));
    if (bundle.version !== BUNDLE_VERSION) {
      throw new Error(`bundle version mismatch in ${filename}: expected ${BUNDLE_VERSION}, got ${bundle.version}`);
    }
    for (const [id, entry] of Object.entries(bundle.entries)) {
      const existing = merged.entries[id];
      if (existing) mergeEntry(existing, entry);
      else merged.entries[id] = { ...entry, cells: { ...entry.cells }, enums: { ...(entry.enums ?? {}) }, hashes: { ...(entry.hashes ?? {}) } };
    }
  }
  return merged;
}

/**
 * Load compiled bundles from disk and return a ready-to-use {@link Store}.
 *
 * `path` may be:
 *   - the `--out` directory of `stringlocale compile` — `manifest.json`
 *     (split layout) is preferred, otherwise `bundle.json` (combined);
 *   - a path to a `bundle.json` or `manifest.json` file;
 *   - a `file:` URL (e.g. `new URL("./i18n", import.meta.url)`) for paths
 *     relative to the calling module rather than the working directory.
 *
 * Relative string paths resolve against `process.cwd()`. Split bundles are
 * read eagerly and merged, so the returned store resolves every locale
 * synchronously — no `ensureLocale`/`preload` step is needed.
 */
export function loadFromFile(path: string | URL, opts: { adapter?: Adapter } = {}): Store {
  const p = resolvePath(path instanceof URL || String(path).startsWith("file:") ? fileURLToPath(path) : path);
  if (!existsSync(p)) throw new Error(`stringlocale: no such file or directory: ${p}`);

  let file: string;
  if (statSync(p).isDirectory()) {
    const manifest = join(p, "manifest.json");
    const combined = join(p, "bundle.json");
    if (existsSync(manifest)) file = manifest;
    else if (existsSync(combined)) file = combined;
    else throw new Error(`stringlocale: no manifest.json or bundle.json in ${p}`);
  } else {
    file = p;
  }

  const data = readJson<BundleData | ManifestData>(file);
  const bundle = isManifest(data) ? mergeSplit(data, dirname(file)) : data;
  return Store.fromData(bundle, opts.adapter);
}
