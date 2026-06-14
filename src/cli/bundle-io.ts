/**
 * Bundle I/O: read and write the compiled bundle format.
 *
 * Supports two layouts:
 *   combined — one bundle.json with all locales
 *   split    — per-locale bundle.<locale>.json + manifest.json
 *
 * readBundle merges split files into a single in-memory BundleData so the
 * rest of the CLI never has to care which layout is on disk.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BundleData, Entry, ManifestData } from "../bundle";
import { BUNDLE_VERSION } from "../bundle";

export function readBundle(outDir: string): BundleData {
  const manifestPath = join(outDir, "manifest.json");
  if (existsSync(manifestPath)) {
    return readSplitBundle(outDir, manifestPath);
  }
  const bundlePath = join(outDir, "bundle.json");
  if (!existsSync(bundlePath)) {
    throw new Error(
      `No bundle found in ${outDir}. Run 'stringlocale compile' first.`,
    );
  }
  return JSON.parse(readFileSync(bundlePath, "utf-8")) as BundleData;
}

function readSplitBundle(outDir: string, manifestPath: string): BundleData {
  const manifest = JSON.parse(
    readFileSync(manifestPath, "utf-8"),
  ) as ManifestData;

  const combined: BundleData = {
    version: BUNDLE_VERSION,
    source_locale: manifest.source_locale,
    locales: [...manifest.locales],
    entries: {},
  };

  for (const [locale, filename] of Object.entries(manifest.files)) {
    const localePath = join(outDir, filename);
    const lb = JSON.parse(readFileSync(localePath, "utf-8")) as BundleData;
    for (const [id, entry] of Object.entries(lb.entries)) {
      if (!combined.entries[id]) {
        combined.entries[id] = {
          ...entry,
          cells: {},
          enums: {},
          hashes: {},
        };
      }
      const dst = combined.entries[id] as Entry;
      const cells = entry.cells[locale];
      if (cells) dst.cells[locale] = cells;
      const enums = entry.enums[locale];
      if (enums) dst.enums[locale] = enums;
      Object.assign(dst.hashes, entry.hashes);
    }
  }
  return combined;
}

export function writeBundle(
  bundle: BundleData,
  outDir: string,
  combined: boolean,
): string[] {
  mkdirSync(outDir, { recursive: true });
  return combined
    ? writeCombined(bundle, outDir)
    : writeSplit(bundle, outDir);
}

function writeCombined(bundle: BundleData, outDir: string): string[] {
  const path = join(outDir, "bundle.json");
  writeFileSync(path, JSON.stringify(bundle, null, 2));
  return [path];
}

function writeSplit(bundle: BundleData, outDir: string): string[] {
  const written: string[] = [];
  const files: Record<string, string> = {};

  for (const locale of bundle.locales) {
    const localeEntries: Record<string, Entry> = {};
    for (const [id, entry] of Object.entries(bundle.entries)) {
      if (!entry.cells[locale] && !entry.enums[locale]) continue;
      localeEntries[id] = {
        ...entry,
        cells: { [locale]: entry.cells[locale] ?? {} },
        enums: { [locale]: entry.enums[locale] ?? {} },
        hashes: Object.fromEntries(
          Object.entries(entry.hashes).filter(([k]) =>
            k.startsWith(`${locale}::`)
          ),
        ),
      };
    }
    const filename = `bundle.${locale}.json`;
    const localeBundle: BundleData = {
      version: bundle.version,
      source_locale: bundle.source_locale,
      locales: [locale],
      entries: localeEntries,
    };
    const path = join(outDir, filename);
    writeFileSync(path, JSON.stringify(localeBundle, null, 2));
    written.push(path);
    files[locale] = filename;
  }

  const manifest: ManifestData = {
    version: BUNDLE_VERSION,
    source_locale: bundle.source_locale,
    locales: bundle.locales,
    files,
  };
  const manifestPath = join(outDir, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  written.push(manifestPath);

  return written;
}

export function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}
