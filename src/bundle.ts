/**
 * Compiled bundle format — the contract shared with the Python compiler.
 *
 * The TypeScript runtime reads the exact same JSON that
 * `stringlocale compile` writes (split per-locale or combined), so a
 * full-stack app shares one set of compiled translations across backend
 * and frontend.
 */

export const BUNDLE_VERSION = 1;
export const SOURCE = "__source__";

/** A param's serialized shape (mirrors Python `Param.to_dict`). */
export interface ParamDict {
  kind: ParamKind;
  values?: string[];
  inline?: boolean;
  context?: string;
  fmt?: DateFmt;
  currency_code?: string;
}

export type ParamKind =
  | "literal"
  | "number"
  | "plural"
  | "translatable"
  | "date"
  | "currency"
  | "relative"
  | "user"
  | "user_adapted";

export type DateFmt = "short" | "medium" | "long" | "full";

/** One declared string, compiled across locales. */
export interface Entry {
  id: string;
  source: string;
  params: Record<string, ParamDict>;
  axes: Record<string, string[]>;
  /** locale -> { cellKey: template } */
  cells: Record<string, Record<string, string>>;
  /** locale -> { paramName: { value: translation } } */
  enums: Record<string, Record<string, Record<string, string>>>;
  /** content hash per "locale::cellKey" (unused at runtime) */
  hashes: Record<string, string>;
}

export interface BundleData {
  version: number;
  source_locale: string;
  locales: string[];
  entries: Record<string, Entry>;
}

export interface ManifestData {
  version?: number;
  source_locale: string;
  locales: string[];
  files: Record<string, string>;
}

/**
 * Build the canonical cell key from axis selections: `axis=value` pairs
 * sorted by axis name, joined by `|`. The empty key is the base template.
 * Must match Python `bundle.cell_key`.
 */
export function cellKey(axisValues: Record<string, string>): string {
  const keys = Object.keys(axisValues).sort();
  if (keys.length === 0) return "";
  return keys.map((k) => `${k}=${axisValues[k]}`).join("|");
}
