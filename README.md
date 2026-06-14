# stringlocale

Typed, build-time localization. You declare each user-facing string once as a
typed object; a CLI drafts the translations into static JSON bundles at build
time; your app resolves them offline with native `Intl` formatting. No
translation API is called at runtime.

This package is the **TypeScript/React runtime plus a CLI** (`compile`, `check`,
`prune`). It reads and writes the same bundle format as the Python `stringlocale`
compiler, so backend and frontend can share one set of compiled translations.

## The flow

| Step | Command / API | What you write | What you get |
| --- | --- | --- | --- |
| **1. Declare** | `new StringLocale(...)` | strings in code, with typed params | type-safe references, one source of truth |
| **2. Compile** | `stringlocale compile` | — | static `*.json` locale bundles, drafted per locale |
| **3. Resolve** | `t(str, args)` / `<Tr>` | call sites | offline, `Intl`-formatted output per locale |

Two more CLI commands keep step 2 honest as the code changes:

* `stringlocale check` — fail CI when the bundle is out of sync with the code.
* `stringlocale prune` — drop entries for strings you deleted.

## Install

```bash
npm install stringlocale
```

The core runtime has zero dependencies. React bindings are an optional peer
dependency, imported from the `/react` entry. The CLI ships in the same package
as the `stringlocale` bin.

## 1. Declare

Each string is one typed object: a stable `id`, the source text, and a `Param`
per `{placeholder}` describing how that value renders. Placeholders are
validated against the params at construction time.

```ts
// strings.ts
import { Param, StringLocale } from "stringlocale";

export const followers = new StringLocale("{n} followers", {
  id: "followers",
  params: { n: Param.number() },           // locale digits & grouping
});

export const inbox = new StringLocale("You have {count} messages", {
  id: "inbox",
  params: { count: Param.plural() },        // CLDR plural forms per locale
});

export const fee = new StringLocale("{creator} charges {amount} per post", {
  id: "fee",
  params: {
    creator: Param.literal(),               // passed through verbatim
    amount: Param.currency("NPR"),          // locale currency formatting
  },
});

export const greeting = new StringLocale("{name}, your account is ready", {
  id: "greeting",
  params: { name: Param.literal() },
  gendered: true,                           // male/female variants (an axis)
});
```

You do not write translation keys, per-locale JSON, plural tables, or formatting
code — the params carry enough structure for the compiler to translate and the
runtime to format.

## 2. Compile, check, prune

### `compile`

Discovers every declared `StringLocale`, drafts a translation for each **cell**
(one per axis combination — each plural form, each gender, …) across the target
locales, and writes the bundles.

```bash
stringlocale compile \
  --sources strings.ts \
  --source-locale en-US \
  --locales ne-NP nl-NL ar-SA \
  --out public/i18n
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--sources <paths...>` | `.` | Files or directories to import for discovery |
| `--locales <tags...>` | required | Target locales — full `language-REGION` tags (`ne-NP`, not `ne`) |
| `--out <dir>` | `dist` | Output directory |
| `--source-locale <tag>` | `en` | Locale of the source strings |
| `--combined` | off | Emit one `bundle.json` instead of split per-locale files |
| `--no-incremental` | off | Re-draft every cell instead of reusing unchanged ones |
| `--stub` | off | Use the offline deterministic stub translator |
| `--strict-discover` | off | Abort if a source file fails to import (default: warn and skip) |
| `--openrouter-timeout <s>` | `60` | Per-request timeout for the OpenRouter translator |
| `--openrouter-retries <n>` | `3` | Attempts per request, including the first |

**Translator.** With `OPENROUTER_API_KEY` set (and no `--stub`), the compiler
calls OpenRouter to draft translations. Otherwise it uses the deterministic
`StubTranslator`, which emits placeholders like `ne-NP:You have {count} messages`
— useful for wiring up the pipeline before any real translations exist.

**Incremental.** By default the compiler loads the previous bundle from `--out`
and reuses any cell whose source text is unchanged, so only new or edited strings
hit the translator. `--no-incremental` forces a full redraft.

**Output** — a manifest plus one file per locale (or a single combined bundle):

```text
public/i18n/
  manifest.json
  bundle.ne-NP.json
  bundle.nl-NL.json
  bundle.ar-SA.json
```

### `check`

Discovers the current strings, reads the compiled bundle, and reports drift.
Exits non-zero on problems, so it drops straight into CI.

```bash
stringlocale check --sources strings.ts --out public/i18n
```

Reports four problem classes:

* **missing** — id declared in code but absent from the bundle (run `compile`)
* **orphaned** — id in the bundle but no longer in code (run `prune`)
* **stale** — the bundle's recorded source text differs from the current source
* **placeholder drift** — the `{placeholder}` set changed without recompiling

### `prune`

Removes orphaned entries — ids in the bundle that no longer exist in code —
without re-translating anything.

```bash
stringlocale prune --sources strings.ts --out public/i18n
```

Pass `--combined` if the bundle was written combined, so it's rewritten in the
same layout.

> **Note on `.ts` sources.** The published `stringlocale` bin runs under plain
> Node, which can't import `.ts` files. Point `--sources` at compiled JS, or run
> the CLI through a TypeScript loader (e.g. `tsx`) when discovering `.ts`
> declarations directly. If your source of truth is Python, the Python CLI takes
> `--sources strings.py` and writes the identical bundle format.

## 3. Resolve

Load the bundles once at startup, then resolve strings anywhere. No LLM or
network call happens at resolve time — it's a pure lookup, with numbers, dates,
currency, and plurals formatted by the platform `Intl` APIs.

### React

```tsx
import { loadFromUrl } from "stringlocale";
import { StringLocaleProvider, useTranslation, Tr } from "stringlocale/react";
import { followers, inbox, fee, greeting } from "./strings";

const store = await loadFromUrl("/i18n", { preload: ["ne-NP"] });

function Card() {
  const { t } = useTranslation();
  return (
    <>
      <h2>{t(greeting, { name: "Jane Doe", gender: "female" })}</h2>
      <Tr str={fee} creator="Jane Doe" amount={2500} />   {/* declarative form */}
      <p>{t(followers, { n: 1200 })}</p>
      <p>{t(inbox, { count: 5 })}</p>
    </>
  );
}

export default function App() {
  return (
    <StringLocaleProvider store={store} locale="ne-NP">
      <Card />
    </StringLocaleProvider>
  );
}
```

Switching to a not-yet-loaded locale (split bundles) lazily fetches it and
re-renders consumers when it lands; `useTranslation().loading` reflects this.

### Plain TypeScript (no React)

```ts
import { loadCombined } from "stringlocale";
import bundle from "./i18n/bundle.json";
import { fee } from "./strings";

const store = loadCombined(bundle);
fee.resolve({ store, locale: "ne-NP" }, { creator: "Jane Doe", amount: 2500 });
```

See [`examples/simple-app`](examples/simple-app) for a runnable Vite + React app
that walks through all three steps.

## Parameter types

| Helper | Use for | Runtime behavior |
| --- | --- | --- |
| `Param.literal()` | Brand names, usernames, URLs, proper nouns | Passed through verbatim |
| `Param.number()` | Numeric values | Locale digits and separators |
| `Param.plural()` | Counts that affect wording | CLDR plural categories |
| `Param.translatable([...], { context, inline })` | Fixed enum-like values | Translated at compile time |
| `Param.date(fmt)` | Dates | `Intl.DateTimeFormat` |
| `Param.currency("NPR")` | Money | `Intl.NumberFormat` |
| `Param.relative()` | Relative time ("3 days ago") | `Intl.RelativeTimeFormat` |
| `Param.user()` | Free user text | Passed through untouched |
| `Param.userAdapted({ context })` | Free prose needing number/date adaptation | Adapter only |

## Runtime behavior

Offline by default — no LLM, translation API, or remote service is called while
your app runs; it only resolves already-compiled translations. Formatting uses
`Intl.NumberFormat`, `Intl.PluralRules`, `Intl.DateTimeFormat`, and
`Intl.RelativeTimeFormat`, with a handwritten fallback table for environments
that lack `Intl`, matching the Python runtime.

Because the bundle format is shared with the Python compiler, the same compiled
artifact resolves identically across a Python backend and a TS/React frontend —
including fallback chains, plural forms, digit conversion, gender/custom axes,
and enum substitution.

LLM-drafted translations are written to plain JSON, so you can review, diff, and
version them like any other build artifact before shipping.

## Develop

```bash
npm run build       # tsup -> ESM + CJS + .d.ts (runtime, react, cli)
npm run typecheck
npm test            # vitest, resolving against Python-compiled fixtures
```
