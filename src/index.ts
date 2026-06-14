/**
 * stringlocale — LLM-powered, build-time localization with an offline runtime.
 *
 * The runtime reads the bundles produced by `stringlocale compile` and renders
 * them with native `Intl` formatting — no translation API at runtime.
 *
 *   import { StringLocale, Param } from "stringlocale";
 *   import { StringLocaleProvider, useTranslation } from "stringlocale/react";
 *
 *   export const welcome = new StringLocale("Welcome, {name}", {
 *     id: "welcome",
 *     params: { name: Param.literal() },
 *   });
 */
export { StringLocale } from "./core";
export type {
  ResolveArgs,
  ResolveContext,
  StringLocaleOptions,
} from "./core";

export { Param } from "./params/kinds";

export { Store } from "./runtime/store";
export type { Adapter, LocaleLoader } from "./runtime/store";

export {
  fallbackChain,
  setFallbackChain,
  clearFallbackChains,
  clearFallbackChain,
} from "./runtime/locale";

export {
  pluralCategory,
  categoriesFor,
  CATEGORIES,
} from "./runtime/plurals";
export type { PluralCategory } from "./runtime/plurals";

export {
  convertDigits,
  formatNumber,
  formatLocalizedDate,
  formatLocalizedCurrency,
  formatRelative,
} from "./runtime/format";

export { loadCombined, loadManifest, loadFromUrl } from "./load";

export { cellKey, SOURCE, BUNDLE_VERSION } from "./bundle";

export { asLocaleTag, isLocaleTag } from "./locale-tag";
export type { LocaleTag } from "./locale-tag";
export type {
  BundleData,
  ManifestData,
  Entry,
  ParamDict,
  ParamKind,
  DateFmt,
} from "./bundle";

export * as registry from "./registry";

export const VERSION = "0.1.0";
