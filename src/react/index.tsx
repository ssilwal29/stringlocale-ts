/**
 * React bindings for stringlocale.
 *
 * <StringLocaleProvider> owns the loaded Store and the active locale, and
 * re-renders consumers when either changes. useTranslation() returns a `t`
 * bound to the current context, plus the locale and a setter. <Tr> is the
 * declarative form: <Tr str={welcome} name="Anisha" />.
 *
 * Split bundles load lazily: switching to a not-yet-loaded locale triggers a
 * fetch via the provider's `loader`, and consumers re-render once it lands.
 */
import * as React from "react";

import type { ResolveArgs, ResolveContext, StringLocale } from "../core";
import type { AsyncTranslator } from "../live";
import type { LocaleTag } from "../locale-tag";
import { asLocaleTag } from "../locale-tag";
import type { Adapter, Store } from "../runtime/store";
import { clearFallbackChain, setFallbackChain } from "../runtime/locale";

export interface StringLocaleContextValue {
  store?: Store;
  locale: LocaleTag;
  sourceLocale: string;
  setLocale: (locale: LocaleTag) => void;
  /** True while a lazily-loaded split locale is being fetched. */
  loading: boolean;
  ready: boolean;
}

const Ctx = React.createContext<StringLocaleContextValue | null>(null);

export interface StringLocaleProviderProps {
  store: Store;
  /** Initial active locale (must be a full language-REGION tag, e.g. "en-US"). */
  locale: LocaleTag;
  adapter?: Adapter;
  /**
   * Custom fallback chains. Keys must be full locale tags; chain values may
   * include bare language codes for bundle lookup (e.g. "pt").
   */
  fallbacks?: Record<string, string[]>;
  /** Shown while the initial locale's split file loads. */
  fallback?: React.ReactNode;
  /** Called when a locale file fails to fetch or parse. */
  onError?: (err: Error, locale: LocaleTag) => void;
  /**
   * Online translator for `Param.userAdapted` values. When set, those params
   * are translated at runtime: resolution returns the source text first, then
   * re-renders with the translation once it lands. Debounce on the caller's
   * side (e.g. the input value) to limit requests. Takes precedence over
   * `adapter`.
   */
  liveTranslator?: AsyncTranslator;
  children: React.ReactNode;
}

// Bridge an async translator into the synchronous Adapter that resolve() calls
// for Param.userAdapted: serve from cache, kick off the request on a miss, and
// re-render when it resolves. Caches are process-wide (translations are stable).
//
// liveLastKnown tracks the last translated text per (locale, context) — so when
// a new text value is in-flight, we keep showing the previous translation rather
// than reverting to source text.
const liveCache = new Map<string, string>();
const liveLastKnown = new Map<string, string>();
const liveInflight = new Set<string>();

function makeLiveAdapter(
  translator: AsyncTranslator,
  sourceLocale: string,
  onResolved: () => void,
): Adapter {
  return (locale, context, text) => {
    if (!text.trim() || locale === sourceLocale) return text;
    // \x00 as separator prevents collisions between (locale+context, text) fragments
    const key = `${locale}\x00${context ?? ""}\x00${text}`;
    const ctxKey = `${locale}\x00${context ?? ""}`;
    const cached = liveCache.get(key);
    if (cached !== undefined) return cached;
    if (!liveInflight.has(key)) {
      liveInflight.add(key);
      Promise.resolve(translator(text, locale, context))
        .then((out) => {
          liveCache.set(key, out);
          liveLastKnown.set(ctxKey, out);
        })
        .catch(() => liveCache.set(key, text))
        .finally(() => {
          liveInflight.delete(key);
          onResolved();
        });
    }
    // While the request is in-flight, show the last known translation for this
    // locale+context rather than reverting to source text.
    return liveLastKnown.get(ctxKey) ?? text;
  };
}

export function StringLocaleProvider({
  store,
  locale: initialLocale,
  adapter,
  fallbacks,
  fallback = null,
  onError,
  liveTranslator,
  children,
}: StringLocaleProviderProps): React.ReactElement {
  const [locale, setLocaleState] = React.useState<LocaleTag>(initialLocale);
  const [loading, setLoading] = React.useState(
    !store.hasLocale(initialLocale) && initialLocale !== store.sourceLocale,
  );
  // bump to force re-render after an async locale load or live translation completes
  const [, force] = React.useReducer((x: number) => x + 1, 0);
  // Keep onError in a ref so the load effect doesn't need it as a dependency.
  const onErrorRef = React.useRef(onError);
  React.useEffect(() => {
    onErrorRef.current = onError;
  });

  // The adapter that resolve() uses for Param.userAdapted. A live translator
  // (wrapped to resolve asynchronously and re-render) takes precedence over a
  // plain sync adapter. Assigned during render so it's in place before children
  // resolve; only overwrites when we actually have one.
  const liveAdapter = React.useMemo(
    () =>
      liveTranslator
        ? makeLiveAdapter(liveTranslator, store.sourceLocale, force)
        : undefined,
    [liveTranslator, store, force],
  );
  const chosenAdapter = liveAdapter ?? adapter;
  if (chosenAdapter) store.adapter = chosenAdapter;

  React.useEffect(() => {
    if (!fallbacks) return;
    const locales = Object.keys(fallbacks);
    for (const [loc, chain] of Object.entries(fallbacks)) {
      setFallbackChain(asLocaleTag(loc), chain);
    }
    return () => {
      for (const loc of locales) {
        clearFallbackChain(asLocaleTag(loc));
      }
    };
  }, [fallbacks]);

  React.useEffect(() => {
    let cancelled = false;
    if (store.hasLocale(locale) || locale === store.sourceLocale) {
      setLoading(false);
      return;
    }
    setLoading(true);
    store
      .ensureLocale(locale)
      .then(() => {
        if (!cancelled) {
          setLoading(false);
          force();
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoading(false);
          const e = err instanceof Error ? err : new Error(String(err));
          onErrorRef.current?.(e, locale);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [store, locale]);

  const setLocale = React.useCallback((l: LocaleTag) => setLocaleState(l), []);

  const value = React.useMemo<StringLocaleContextValue>(
    () => ({
      store,
      locale,
      sourceLocale: store.sourceLocale,
      setLocale,
      loading,
      ready: store.hasLocale(locale) || locale === store.sourceLocale,
    }),
    [store, locale, loading, setLocale],
  );

  return (
    <Ctx.Provider value={value}>
      {value.ready ? children : fallback}
    </Ctx.Provider>
  );
}

function useCtx(): StringLocaleContextValue {
  const ctx = React.useContext(Ctx);
  if (!ctx) {
    throw new Error("stringlocale hooks must be used within <StringLocaleProvider>");
  }
  return ctx;
}

export interface UseTranslation {
  /** Resolve a declared string in the active locale. */
  t: (str: StringLocale, args?: ResolveArgs) => string;
  locale: LocaleTag;
  sourceLocale: string;
  setLocale: (locale: LocaleTag) => void;
  loading: boolean;
  ready: boolean;
}

export function useTranslation(): UseTranslation {
  const ctx = useCtx();
  const resolveCtx = React.useMemo<ResolveContext>(
    () => ({ store: ctx.store, locale: ctx.locale, adapter: ctx.store?.adapter }),
    [ctx.store, ctx.locale],
  );
  const t = React.useCallback(
    (str: StringLocale, args: ResolveArgs = {}) => str.resolve(resolveCtx, args),
    [resolveCtx],
  );
  return {
    t,
    locale: ctx.locale,
    sourceLocale: ctx.sourceLocale,
    setLocale: ctx.setLocale,
    loading: ctx.loading,
    ready: ctx.ready,
  };
}

export interface TrProps {
  str: StringLocale;
  /** Wrapping element; defaults to a Fragment (renders raw text). */
  as?: keyof JSX.IntrinsicElements;
  /** Props matching declared param names are passed as resolve args;
   *  all others are forwarded as element attributes when `as` is set. */
  [key: string]: unknown;
}

/** Declarative translation: <Tr str={welcome} name="Anisha" />. */
export function Tr({ str, as, ...rest }: TrProps): React.ReactElement {
  const { t } = useTranslation();
  const args: ResolveArgs = {};
  const elemProps: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rest)) {
    if (k in str.params) {
      args[k] = v;
    } else {
      elemProps[k] = v;
    }
  }
  const text = t(str, args);
  if (as) {
    return React.createElement(as, elemProps, text);
  }
  return <>{text}</>;
}

export { Ctx as StringLocaleContext };
