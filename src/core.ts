/**
 * The one object: declaration *and* resolver — the TS mirror of Python
 * `core.StringLocale`.
 *
 * `new StringLocale("Welcome, {name}", { id, params })` declares a string and
 * registers it (so a future TS compiler/discovery step can find it; the
 * canonical compiler today is the Python CLI). `.resolve()` renders it.
 *
 * Difference from Python: there is no thread-local "active locale". Resolution
 * needs a `ResolveContext` (store + locale). App code rarely calls this
 * directly — the React `useTranslation`/`<Tr>` layer threads the context from
 * a provider, so components only ever call `t(str, args)`.
 */
import type { Entry, ParamDict } from "./bundle";
import { SOURCE, cellKey } from "./bundle";
import { Param } from "./params/kinds";
import * as fmt from "./runtime/format";
import { fallbackChain } from "./runtime/locale";
import { categoriesFor, pluralCategory } from "./runtime/plurals";
import type { Adapter, Store } from "./runtime/store";
import { placeholders, substitute } from "./template";
import * as registry from "./registry";

export interface ResolveContext {
  store?: Store;
  locale: string;
  adapter?: Adapter;
}

export interface StringLocaleOptions {
  id: string;
  params?: Record<string, Param>;
  context?: string;
  gendered?: boolean;
  axes?: Record<string, string[]>;
}

export type ResolveArgs = Record<string, unknown>;

export class StringLocale {
  readonly source: string;
  readonly id: string;
  readonly params: Record<string, Param>;
  readonly context?: string;
  readonly axes: Record<string, string[]>;

  constructor(source: string, opts: StringLocaleOptions) {
    this.source = source;
    this.id = opts.id;
    this.params = opts.params ?? {};
    this.context = opts.context;
    this.axes = { ...(opts.axes ?? {}) };
    if (opts.gendered && !this.axes.gender) {
      this.axes.gender = ["male", "female"];
    }

    const ph = new Set(placeholders(source));
    const missing = [...ph].filter((p) => !(p in this.params));
    if (missing.length > 0) {
      throw new Error(
        `${this.id}: placeholders without params: ${missing.sort().join(", ")}`,
      );
    }

    registry.register(this);
  }

  get pluralParam(): string | undefined {
    for (const [name, p] of Object.entries(this.params)) {
      if (p.kind === "plural") return name;
    }
    return undefined;
  }

  get inlineTranslatableParams(): Record<string, Param> {
    const out: Record<string, Param> = {};
    for (const [name, p] of Object.entries(this.params)) {
      if (p.kind === "translatable" && p.inline) out[name] = p;
    }
    return out;
  }

  templateAxes(localeCategories: string[]): Record<string, string[]> {
    const out: Record<string, string[]> = { ...this.axes };
    if (this.pluralParam) out.plural = [...localeCategories];
    for (const [name, p] of Object.entries(this.inlineTranslatableParams)) {
      out[name] = [...p.values];
    }
    return out;
  }

  resolve(ctx: ResolveContext, args: ResolveArgs = {}): string {
    const { store, locale } = ctx;

    let entry: Entry | undefined;
    let chosenLocale: string = SOURCE;
    if (store) {
      for (const candidate of fallbackChain(locale)) {
        const e = store.entryFor(this.id, candidate);
        if (e) {
          entry = e;
          chosenLocale = candidate;
          break;
        }
      }
    }

    // Use chosenLocale (the actual fallback result) so the plural category
    // matches the cells compiled for that locale, not the requested locale.
    const axisValues = this.selectAxes(chosenLocale, args);

    let tmpl: string;
    if (entry) {
      const ckey = this.cellKeyFor(entry, axisValues);
      tmpl =
        entry.cells[chosenLocale]?.[ckey] ??
        entry.cells[chosenLocale]?.[""] ??
        this.source;
    } else {
      tmpl = this.source;
      chosenLocale = SOURCE;
    }

    const values = this.formatValues(ctx, chosenLocale, entry, args);
    return substitute(tmpl, values);
  }

  private selectAxes(locale: string, args: ResolveArgs): Record<string, string> {
    const sel: Record<string, string> = {};
    for (const axis of Object.keys(this.axes)) {
      if (axis in args) sel[axis] = String(args[axis]);
    }
    const pp = this.pluralParam;
    if (pp && pp in args) {
      const n = Number(args[pp]);
      if (Number.isFinite(n)) sel.plural = pluralCategory(locale, n);
    }
    for (const name of Object.keys(this.inlineTranslatableParams)) {
      if (name in args) sel[name] = String(args[name]);
    }
    return sel;
  }

  private cellKeyFor(entry: Entry, axisValues: Record<string, string>): string {
    const known: Record<string, string> = {};
    for (const [k, v] of Object.entries(axisValues)) {
      if (k in entry.axes) known[k] = v;
    }
    return cellKey(known);
  }

  private formatValues(
    ctx: ResolveContext,
    chosenLocale: string,
    entry: Entry | undefined,
    args: ResolveArgs,
  ): Record<string, string> {
    const { locale } = ctx;
    const values: Record<string, string> = {};
    for (const [name, p] of Object.entries(this.params)) {
      if (!(name in args)) continue;
      const raw = args[name];
      switch (p.kind) {
        case "literal":
        case "user":
          values[name] = String(raw);
          break;
        case "number":
        case "plural":
          values[name] = fmt.formatNumber(Number(raw), locale);
          break;
        case "date":
          values[name] = fmt.formatLocalizedDate(
            raw as Date | string | number,
            p.fmt,
            locale,
          );
          break;
        case "currency":
          values[name] = fmt.formatLocalizedCurrency(
            Number(raw),
            p.currencyCode as string,
            locale,
          );
          break;
        case "relative":
          values[name] = fmt.formatRelative(raw as number | Date, locale);
          break;
        case "translatable":
          values[name] = p.inline
            ? String(raw)
            : this.translateEnum(entry, chosenLocale, name, String(raw));
          break;
        case "user_adapted":
          values[name] = this.adapt(ctx, p, String(raw));
          break;
      }
    }
    return values;
  }

  private translateEnum(
    entry: Entry | undefined,
    chosenLocale: string,
    name: string,
    value: string,
  ): string {
    if (!entry || chosenLocale === SOURCE) return value;
    return entry.enums[chosenLocale]?.[name]?.[value] ?? value;
  }

  private adapt(ctx: ResolveContext, p: Param, text: string): string {
    const adapter = ctx.adapter ?? ctx.store?.adapter;
    if (!adapter) return text; // stays offline
    if (ctx.store) {
      return ctx.store.adaptCached(ctx.locale, p.context, text, adapter);
    }
    return adapter(ctx.locale, p.context, text);
  }

  toString(): string {
    return `StringLocale(id=${this.id})`;
  }
}

export { categoriesFor };
export type { ParamDict };
