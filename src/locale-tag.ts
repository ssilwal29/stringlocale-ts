/**
 * Branded `LocaleTag` type — enforces full `language-REGION` format (BCP 47
 * with both subtags, e.g. "en-US", "ne-NP") at compile time.
 *
 * Use `asLocaleTag()` to convert a plain string and get a runtime error for
 * bare language codes ("en", "ar") or malformed values.
 */

declare const __brand: unique symbol;
export type LocaleTag = string & { readonly [__brand]: "LocaleTag" };

const LOCALE_RE = /^[a-zA-Z]{2,3}-[a-zA-Z]{2}$/;

/** Validate and cast a string to `LocaleTag`. Throws for bare language codes. */
export function asLocaleTag(tag: string): LocaleTag {
  if (!LOCALE_RE.test(tag)) {
    throw new Error(
      `Invalid locale tag "${tag}": must be language-REGION (e.g. "en-US", "ne-NP")`,
    );
  }
  return tag as LocaleTag;
}

/** Type-guard: returns true for strings that match the language-REGION pattern. */
export function isLocaleTag(tag: string): tag is LocaleTag {
  return LOCALE_RE.test(tag);
}
