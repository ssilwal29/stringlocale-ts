/**
 * Compile command: discover registered StringLocale objects, translate every
 * cell for each target locale, and write the bundle(s) to disk.
 *
 * What it does:
 *   - Stub translation when OPENROUTER_API_KEY is absent or --stub is passed.
 *   - Incremental reuse: cells whose source text is unchanged are copied from
 *     the previous bundle without a translator round-trip.
 *   - Axes (plural, gender, inline-translatable) drive the cell key space.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { BundleData, Entry, ParamDict } from "../bundle";
import { BUNDLE_VERSION, cellKey } from "../bundle";
import type { StringLocale } from "../core";
import { categoriesFor } from "../runtime/plurals";
import * as registry from "../registry";
import { contentHash } from "./bundle-io";
import type { Translator } from "./translate";

// ── discovery ────────────────────────────────────────────────────────────────

const SOURCE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

function collectFiles(target: string): string[] {
  const abs = resolve(target);
  if (!existsSync(abs)) throw new Error(`Source not found: ${abs}`);
  const st = statSync(abs);
  if (st.isFile()) return [abs];
  const files: string[] = [];
  function walk(dir: string) {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, ent.name);
      if (
        ent.isDirectory() &&
        !ent.name.startsWith(".") &&
        ent.name !== "node_modules"
      ) {
        walk(full);
      } else if (ent.isFile()) {
        const ext = `.${ent.name.split(".").pop() ?? ""}`;
        if (SOURCE_EXTS.has(ext)) files.push(full);
      }
    }
  }
  walk(abs);
  return files;
}

export async function discover(
  sources: string[],
  opts: { strict?: boolean; progress?: (msg: string) => void } = {},
): Promise<number> {
  const { strict = false, progress = () => {} } = opts;
  const files = [...new Set(sources.flatMap(collectFiles))];
  for (const file of files) {
    try {
      await import(pathToFileURL(file).href);
    } catch (err) {
      if (strict) throw new Error(`Failed to import ${file}: ${err}`);
      progress(`[warn] skipping ${file}: ${err}`);
    }
  }
  return registry.count();
}

// ── axis helpers ─────────────────────────────────────────────────────────────

function cartesian(axes: Record<string, string[]>): Record<string, string>[] {
  const keys = Object.keys(axes).sort();
  if (keys.length === 0) return [{}];
  let result: Record<string, string>[] = [{}];
  for (const key of keys) {
    const next: Record<string, string>[] = [];
    for (const row of result) {
      for (const val of axes[key]) {
        next.push({ ...row, [key]: val });
      }
    }
    result = next;
  }
  return result;
}

// ── serialisation ─────────────────────────────────────────────────────────────

function paramToDict(p: { kind: string; values?: readonly string[]; inline?: boolean; context?: string; fmt?: string; currencyCode?: string }): ParamDict {
  const d: ParamDict = { kind: p.kind as ParamDict["kind"] };
  if (p.kind === "translatable") {
    d.values = [...(p.values ?? [])];
    d.inline = p.inline ?? false;
    if (p.context) d.context = p.context;
  } else if (p.kind === "date") {
    d.fmt = (p.fmt ?? "medium") as ParamDict["fmt"];
  } else if (p.kind === "currency") {
    d.currency_code = p.currencyCode;
  } else if (p.kind === "user_adapted" && p.context) {
    d.context = p.context;
  }
  return d;
}

// ── per-string compilation ────────────────────────────────────────────────────

async function compileEntry(
  str: StringLocale,
  locales: string[],
  translator: Translator,
  previous: BundleData | null,
  progress: (msg: string) => void,
): Promise<Entry> {
  const params: Record<string, ParamDict> = {};
  for (const [name, p] of Object.entries(str.params)) {
    params[name] = paramToDict(p);
  }

  const entry: Entry = {
    id: str.id,
    source: str.source,
    params,
    axes: { ...str.axes },
    cells: {},
    enums: {},
    hashes: {},
  };

  const prev = previous?.entries[str.id] ?? null;
  const sourceUnchanged = prev !== null && prev.source === str.source;

  for (const locale of locales) {
    if (sourceUnchanged && prev.cells[locale]) {
      // Reuse previous translation verbatim.
      entry.cells[locale] = prev.cells[locale];
      if (prev.enums[locale]) entry.enums[locale] = prev.enums[locale];
      for (const [k, v] of Object.entries(prev.hashes)) {
        if (k.startsWith(`${locale}::`)) entry.hashes[k] = v;
      }
      progress(`  ${str.id} [${locale}] reused`);
      continue;
    }

    const categories = categoriesFor(locale);
    const templateAxes = str.templateAxes(categories);

    // Merge plural into the stored axes for this string.
    if (str.pluralParam) entry.axes.plural = categories;

    const combos = cartesian(templateAxes);
    const cells: Record<string, string> = {};

    for (const combo of combos) {
      const ckey = cellKey(combo);
      const tmpl = await translator.translateCell(
        str.source,
        locale,
        ckey,
        str.context,
      );
      cells[ckey] = tmpl;
      entry.hashes[`${locale}::${ckey}`] = contentHash(tmpl);
    }
    entry.cells[locale] = cells;

    // Non-inline translatable params → enum translations.
    for (const [name, p] of Object.entries(str.params)) {
      if (p.kind !== "translatable" || p.inline) continue;
      const enumMap = await translator.translateEnum(p.values, locale, p.context);
      if (!entry.enums[locale]) entry.enums[locale] = {};
      entry.enums[locale][name] = enumMap;
      entry.hashes[`${locale}::enum::${name}`] = contentHash(
        JSON.stringify(enumMap),
      );
    }

    progress(`  ${str.id} [${locale}] ${combos.length} cell(s)`);
  }

  return entry;
}

// ── public compile API ────────────────────────────────────────────────────────

export async function compileStrings(
  locales: string[],
  opts: {
    sourceLocale?: string;
    translator: Translator;
    previous?: BundleData | null;
    progress?: (msg: string) => void;
  },
): Promise<BundleData> {
  const {
    sourceLocale = "en",
    translator,
    previous = null,
    progress = () => {},
  } = opts;

  const strings = registry.allStrings();
  const entries: Record<string, Entry> = {};

  for (const str of strings) {
    entries[str.id] = await compileEntry(
      str,
      locales,
      translator,
      previous,
      progress,
    );
  }

  return {
    version: BUNDLE_VERSION,
    source_locale: sourceLocale,
    locales,
    entries,
    model: translator.model,
  };
}

export function cellCount(bundle: BundleData): number {
  let n = 0;
  for (const entry of Object.values(bundle.entries)) {
    for (const cells of Object.values(entry.cells)) {
      n += Object.keys(cells).length;
    }
  }
  return n;
}
