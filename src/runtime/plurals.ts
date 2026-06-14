/**
 * CLDR plural category selection.
 *
 * Uses the platform's `Intl.PluralRules` (CLDR-backed, ~full coverage) when
 * available, with a handwritten fallback table for environments that lack it,
 * so categories stay consistent everywhere.
 */

export type PluralCategory = "zero" | "one" | "two" | "few" | "many" | "other";

export const CATEGORIES: PluralCategory[] = [
  "zero",
  "one",
  "two",
  "few",
  "many",
  "other",
];

const HAVE_INTL =
  typeof Intl !== "undefined" && typeof Intl.PluralRules === "function";

const rulesCache = new Map<string, Intl.PluralRules>();

function intlCategory(locale: string, n: number): PluralCategory | null {
  if (!HAVE_INTL) return null;
  try {
    let rules = rulesCache.get(locale);
    if (!rules) {
      rules = new Intl.PluralRules(locale);
      rulesCache.set(locale, rules);
    }
    return rules.select(Math.abs(n)) as PluralCategory;
  } catch {
    return null;
  }
}

/** Handwritten rules for common families, used when `Intl.PluralRules` is unavailable. */
function fallbackCategory(lang: string, n: number): PluralCategory {
  n = Math.abs(n);
  if (["ja", "zh", "ko", "th", "vi", "id", "ms"].includes(lang)) return "other";
  if (lang === "ar") {
    if (n === 0) return "zero";
    if (n === 1) return "one";
    if (n === 2) return "two";
    const m100 = n % 100;
    if (m100 >= 3 && m100 <= 10) return "few";
    if (m100 >= 11 && m100 <= 99) return "many";
    return "other";
  }
  if (["ru", "uk"].includes(lang)) {
    const m10 = n % 10;
    const m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return "one";
    if (m10 >= 2 && m10 <= 4 && !(m100 >= 12 && m100 <= 14)) return "few";
    return "many";
  }
  if (lang === "cy") {
    const map: Record<number, PluralCategory> = {
      0: "zero",
      1: "one",
      2: "two",
      3: "few",
      6: "many",
    };
    return map[n] ?? "other";
  }
  if (lang === "pl") {
    const m10 = n % 10;
    const m100 = n % 100;
    if (n === 1) return "one";
    if (m10 >= 2 && m10 <= 4 && !(m100 >= 12 && m100 <= 14)) return "few";
    return "many";
  }
  return n === 1 ? "one" : "other";
}

export function pluralCategory(locale: string, n: number): PluralCategory {
  const c = intlCategory(locale, n);
  if (c) return c;
  const lang = locale.split("-", 1)[0].toLowerCase();
  return fallbackCategory(lang, n);
}

/** Categories a locale uses, in canonical order — for compile-time parity. */
export function categoriesFor(locale: string): PluralCategory[] {
  // Wide probe to cover all CLDR families: Welsh needs 6→"many"; Arabic
  // needs 3-10 (few) and 11-99 (many); Russian/Polish need m10 variants.
  const probe = [0, 1, 2, 3, 4, 5, 6, 7, 10, 11, 12, 13, 19, 20, 21, 100, 101, 1000];
  const seen = new Set<PluralCategory>();
  for (const n of probe) seen.add(pluralCategory(locale, n));
  return CATEGORIES.filter((c) => seen.has(c));
}
