/**
 * Locale-aware value formatting, all offline.
 *
 * Uses the platform `Intl` APIs (`NumberFormat`, `DateTimeFormat`,
 * `RelativeTimeFormat`) — the browser-native CLDR source — with compact
 * fallbacks otherwise. Digit conversion is handwritten so it works regardless
 * of `Intl` availability.
 */

const DIGIT_BASES: Record<string, number> = {
  ne: 0x0966, // Devanagari
  hi: 0x0966,
  mr: 0x0966,
  ar: 0x0660, // Arabic-Indic
  fa: 0x06f0, // Extended Arabic-Indic
  ur: 0x06f0,
  bn: 0x09e6, // Bengali
  ta: 0x0be6, // Tamil
  th: 0x0e50, // Thai
};

const HAVE_INTL = typeof Intl !== "undefined";

export function convertDigits(text: string, locale: string): string {
  const lang = locale.split("-", 1)[0].toLowerCase();
  const base = DIGIT_BASES[lang];
  if (base === undefined) return text;
  let out = "";
  for (const ch of text) {
    if (ch >= "0" && ch <= "9") {
      out += String.fromCodePoint(base + (ch.charCodeAt(0) - 48));
    } else {
      out += ch;
    }
  }
  return out;
}

export function formatNumber(n: number, locale: string): string {
  // Force ASCII digits from Intl, then apply our own digit conversion so the
  // output is stable regardless of how the platform localizes digits.
  let s: string;
  if (HAVE_INTL) {
    try {
      s = new Intl.NumberFormat("en-US", { useGrouping: false }).format(n);
    } catch {
      s = String(n);
    }
  } else {
    s = String(n);
  }
  return convertDigits(s, locale);
}

function coerceDate(value: Date | string | number): Date {
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value);
  // Treat bare ISO dates as UTC to avoid timezone-dependent day shifts.
  return new Date(value.slice(0, 10) + "T00:00:00Z");
}

const DATE_STYLE: Record<string, Intl.DateTimeFormatOptions> = {
  short: { year: "numeric", month: "numeric", day: "numeric" },
  medium: { year: "numeric", month: "short", day: "numeric" },
  long: { year: "numeric", month: "long", day: "numeric" },
  full: { weekday: "long", year: "numeric", month: "long", day: "numeric" },
};

export function formatLocalizedDate(
  value: Date | string | number,
  fmt: string,
  locale: string,
): string {
  const d = coerceDate(value);
  if (HAVE_INTL) {
    try {
      const opts = DATE_STYLE[fmt] ?? DATE_STYLE.medium;
      const s = new Intl.DateTimeFormat(locale, opts).format(d);
      return convertDigits(s, locale);
    } catch {
      /* fall through */
    }
  }
  return convertDigits(d.toISOString().slice(0, 10), locale);
}

export function formatLocalizedCurrency(
  amount: number,
  code: string,
  locale: string,
): string {
  if (HAVE_INTL) {
    try {
      const s = new Intl.NumberFormat(locale, {
        style: "currency",
        currency: code,
      }).format(amount);
      return convertDigits(s, locale);
    } catch {
      /* fall through */
    }
  }
  const s = `${code} ${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
  return convertDigits(s, locale);
}

const REL_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 86400],
  ["month", 30 * 86400],
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
  ["second", 1],
];

/** Accepts seconds (number, negative = past) or a Date. */
export function formatRelative(
  value: number | Date,
  locale: string,
): string {
  let seconds: number;
  if (value instanceof Date) {
    seconds = (value.getTime() - Date.now()) / 1000;
  } else {
    seconds = value;
  }

  const haveRtf =
    HAVE_INTL && typeof Intl.RelativeTimeFormat === "function";

  for (const [unit, size] of REL_UNITS) {
    if (Math.abs(seconds) >= size) {
      const v = Math.trunc(seconds / size);
      if (haveRtf) {
        try {
          const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
          return convertDigits(rtf.format(v, unit), locale);
        } catch {
          /* fall through */
        }
      }
      const abs = Math.abs(v);
      const u = abs === 1 ? unit : unit + "s";
      const s = seconds < 0 ? `${abs} ${u} ago` : `in ${abs} ${u}`;
      return convertDigits(s, locale);
    }
  }
  return haveRtf ? "now" : "just now";
}
