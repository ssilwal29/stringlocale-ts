/**
 * Parameter kinds.
 *
 * Each param declares *how* an interpolated value resolves at runtime.
 * Construct via the helpers (`Param.literal()`, `Param.number()`, ...) so the
 * kind-specific fields stay coherent. The serialized form matches the on-disk
 * `ParamDict`, so declarations compile against the bundle format.
 */
import type { DateFmt, ParamDict, ParamKind } from "../bundle";

export class Param {
  readonly kind: ParamKind;
  readonly values: readonly string[];
  readonly context?: string;
  readonly inline: boolean;
  readonly fmt: DateFmt;
  readonly currencyCode?: string;

  private constructor(init: {
    kind: ParamKind;
    values?: readonly string[];
    context?: string;
    inline?: boolean;
    fmt?: DateFmt;
    currencyCode?: string;
  }) {
    this.kind = init.kind;
    this.values = init.values ?? [];
    this.context = init.context;
    this.inline = init.inline ?? false;
    this.fmt = init.fmt ?? "medium";
    this.currencyCode = init.currencyCode;
  }

  /** Verbatim pass-through: brand names, usernames, URLs, IDs. */
  static literal(): Param {
    return new Param({ kind: "literal" });
  }

  /** Numeric value rendered in the locale's native digits. */
  static number(): Param {
    return new Param({ kind: "number" });
  }

  /** Count that changes the surrounding wording (CLDR plural forms). */
  static plural(): Param {
    return new Param({ kind: "plural" });
  }

  /**
   * Value from a fixed set; each value pre-translated and substituted.
   * `inline` folds the enum into the template for grammatical agreement.
   */
  static translatable(
    values: readonly string[],
    opts: { context?: string; inline?: boolean } = {},
  ): Param {
    if (values.length === 0) {
      throw new Error("translatable() requires at least one value");
    }
    return new Param({
      kind: "translatable",
      values: [...values],
      context: opts.context,
      inline: opts.inline ?? false,
    });
  }

  /** Locale-formatted Gregorian date. */
  static date(fmt: DateFmt = "medium"): Param {
    return new Param({ kind: "date", fmt });
  }

  /** Monetary amount formatted per locale. code: ISO 4217. */
  static currency(code: string): Param {
    return new Param({ kind: "currency", currencyCode: code });
  }

  /** Relative time ("3 days ago", "in 2 hours"). */
  static relative(): Param {
    return new Param({ kind: "relative" });
  }

  /** Free user-authored text, passed through verbatim. */
  static user(): Param {
    return new Param({ kind: "user" });
  }

  /** Free prose whose numbers/dates are reformatted at runtime via an adapter. */
  static userAdapted(opts: { context?: string } = {}): Param {
    return new Param({ kind: "user_adapted", context: opts.context });
  }

  get isEnumerable(): boolean {
    return this.kind === "translatable";
  }

  get touchesNetworkAtRuntime(): boolean {
    return this.kind === "user_adapted";
  }

  toDict(): ParamDict {
    const d: ParamDict = { kind: this.kind };
    if (this.kind === "translatable") {
      d.values = [...this.values];
      d.inline = this.inline;
      if (this.context) d.context = this.context;
    } else if (this.kind === "date") {
      d.fmt = this.fmt;
    } else if (this.kind === "currency") {
      d.currency_code = this.currencyCode;
    } else if (this.kind === "user_adapted" && this.context) {
      d.context = this.context;
    }
    return d;
  }

  static fromDict(d: ParamDict): Param {
    switch (d.kind) {
      case "translatable":
        return Param.translatable(d.values ?? [], {
          context: d.context,
          inline: d.inline ?? false,
        });
      case "date":
        return Param.date(d.fmt ?? "medium");
      case "currency":
        return Param.currency(d.currency_code as string);
      case "user_adapted":
        return Param.userAdapted({ context: d.context });
      default:
        return new Param({ kind: d.kind });
    }
  }
}
