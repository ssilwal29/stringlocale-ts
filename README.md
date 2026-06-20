# stringlocale

[![CI](https://github.com/ssilwal29/stringlocale-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/ssilwal29/stringlocale-ts/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/stringlocale.svg)](https://www.npmjs.com/package/stringlocale)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Your UI strings have parameters — a count, a name, a price, a date. Translating
them isn't just swapping words:

* **Spanish** needs gender agreement — *"Bienvenido"* vs *"Bienvenida"*.
* **Arabic** has six plural forms and its own digits (٥, not 5).
* **Nepali** writes numbers in Devanagari (१२००) and pluralizes differently again.

Normally you hand-maintain every one of those variants, per language, in JSON
files that drift from your code. **stringlocale** flips it around: you declare
each string **once in English** and tag every parameter with what it is — a
number, a plural count, a currency, a date, a gendered subject. A build-time
compiler then generates **every axis variant** (gender × plural × …) for **every
target language**, drafted by an LLM, into static JSON. At runtime your app just
looks them up — digits, currency, dates, and plurals formatted by the platform
`Intl` APIs, with no translation API call.

This package is the **TypeScript/React runtime plus a CLI** (`compile`, `check`,
`prune`, `review`). The compiler writes plain-JSON locale bundles and the runtime reads
them back — one portable set of translations.

## Quick start

**1. Install**

```bash
npm install stringlocale
```

The runtime is dependency-free; React bindings are an optional peer dependency
under `stringlocale/react`.

**2. Declare your strings** — once, in English, with a `Param` per `{placeholder}`:

```ts
// strings.ts
import { Param, StringLocale } from "stringlocale";

export const greeting = new StringLocale("Welcome back, {name}", {
  id: "greeting",
  params: { name: Param.literal() },
  gendered: true,                       // gendered languages get both forms
});

export const inbox = new StringLocale("You have {count} messages", {
  id: "inbox",
  params: { count: Param.plural() },    // each language's plural forms
});

export const fee = new StringLocale("{creator} charges {amount} per post", {
  id: "fee",
  params: { creator: Param.literal(), amount: Param.currency("USD") },
});
```

**3. Set your translator key** — the compiler drafts translations via an
OpenAI-compatible chat-completions endpoint (OpenRouter by default):

```bash
export STRINGLOCALE_API_KEY=your-api-key
# optional endpoint override:
# export STRINGLOCALE_TRANSLATION_ENDPOINT=https://openrouter.ai/api/v1/chat/completions
# no key? add --stub to emit placeholders and wire up the pipeline first
```

**4. Compile to your target languages** (the CLI reads your `.ts` via `tsx`):

```bash
npx tsx node_modules/stringlocale/dist/cli/index.js compile \
  --sources strings.ts \
  --source-locale en-US \
  --locales es-ES ne-NP ar-SA \
  --out public/i18n
```

This writes `public/i18n/manifest.json` plus one `bundle.<locale>.json` per
language, with every gender/plural variant filled in. Re-running only
re-translates strings whose source text changed.

> Plain-JS declarations build to `.js`? Call the bundled bin directly:
> `npx stringlocale compile --sources dist/strings.js …` (Node can't import `.ts`).

**5. Use them — same call, any language:**

```ts
import { loadFromUrl } from "stringlocale";
import { greeting, inbox } from "./strings";

const store = await loadFromUrl("/i18n");

greeting.resolve({ store, locale: "es-ES" }, { name: "María", gender: "female" });
// e.g. "Bienvenida de nuevo, María"  (feminine variant)

inbox.resolve({ store, locale: "ne-NP" }, { count: 5 });
// "तपाईंसँग ५ सन्देशहरू छन्"  (Devanagari digits, Nepali plural)
```

In React, wrap the app in `<StringLocaleProvider>` and call `useTranslation()` —
see [Resolving](#resolving).

**6. Keep bundles in sync as code changes:**

```bash
npx tsx node_modules/stringlocale/dist/cli/index.js check --sources strings.ts --out public/i18n   # CI gate: fail on drift
npx tsx node_modules/stringlocale/dist/cli/index.js prune --sources strings.ts --out public/i18n   # remove deleted strings
```

## Declaring strings

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

## CLI reference: compile · check · prune · review

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
| `--model <id>` | `google/gemini-2.5-flash` | Model used to draft translations (env: `STRINGLOCALE_MODEL`) |
| `--translator-endpoint <url>` | `https://openrouter.ai/api/v1/chat/completions` | OpenAI-compatible chat-completions endpoint (env: `STRINGLOCALE_TRANSLATION_ENDPOINT`) |
| `--combined` | off | Emit one `bundle.json` instead of split per-locale files |
| `--no-incremental` | off | Re-draft every cell instead of reusing unchanged ones |
| `--stub` | off | Use the offline deterministic stub translator |
| `--strict-discover` | off | Abort if a source file fails to import (default: warn and skip) |
| `--openrouter-timeout <s>` | `60` | Per-request timeout for the OpenRouter translator |
| `--openrouter-retries <n>` | `3` | Attempts per request, including the first |

**Translator key.** `compile` drafts translations through an OpenAI-compatible
endpoint. Pass your key via `STRINGLOCALE_API_KEY` (or legacy
`OPENROUTER_API_KEY`) — export it for the session/CI, or inline it for one run:

```bash
export STRINGLOCALE_API_KEY=your-api-key
npx stringlocale compile --sources strings.js --locales es-ES ne-NP ar-SA --out public/i18n

# …or just for this command:
STRINGLOCALE_API_KEY=your-api-key npx stringlocale compile --sources strings.js --locales es-ES --out public/i18n
```

Tune requests with `--openrouter-timeout` and `--openrouter-retries`. With **no
key set** (or with `--stub`), the compiler falls back to the deterministic
`StubTranslator`, which emits placeholders like `ne-NP:You have {count} messages`
— handy for wiring up the pipeline before any real translations exist.

**Incremental.** By default the compiler loads the previous bundle from `--out`
and reuses any cell whose source text is unchanged, so only new or edited strings
hit the translator. `--no-incremental` forces a full redraft.

**Model.** The model that produced a bundle is recorded in the manifest (and in
each bundle file). When you compile with a different `--model`, that reuse is
invalidated and **every translation is redrafted** with the new model, so a
bundle never mixes output from two models. Defaults to
`google/gemini-2.5-flash`; override per run with `--model` or globally with the
`STRINGLOCALE_MODEL` env var.

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

### `review`

Serves a local web UI for browsing and editing the compiled bundle — a
language-by-language dashboard for translators to review drafts and fix copy
without touching JSON. It reads the bundle from `--out`, serves it over HTTP, and
writes edits straight back to disk on save. No external dependencies and no build
step — it's a single self-contained page served from Node.

```bash
stringlocale review --out public/i18n            # http://localhost:3000
stringlocale review --out public/i18n --port 4000
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--out <dir>` | `dist` | Directory holding the compiled bundle(s) to review |
| `--port <n>` | `3000` | Port for the local server (binds `127.0.0.1` only) |

The layout (split per-locale vs. combined `bundle.json`) is detected
automatically from `--out`. The dashboard lets you:

* **filter by locale** — review one language at a time, or all at once;
* **see when each bundle/locale was generated** (from the file timestamps) and
  which model drafted it;
* **edit any cell** — each plural form, gender, or axis variant — with inline
  placeholder validation, and **save** the changes back to the bundle on disk.

The server binds to `127.0.0.1`, so it's only reachable from your machine. Stop
it with `Ctrl-C`.

> **Note on `.ts` sources.** The published `stringlocale` bin runs under plain
> Node, which can't import `.ts` files. Point `--sources` at compiled JS, or run
> the CLI through a TypeScript loader (e.g. `tsx`) when discovering `.ts`
> declarations directly.

## Resolving

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

## Live (online) translation via `userAdapted`

Declared strings are translated ahead of time. **Dynamic text you can't compile**
(a bio someone is typing, a comment) is handled by the `Param.userAdapted` param
— its value is run through an **adapter** at resolve time. Give the provider a
`liveTranslator` and that adapter becomes an online translator: the param is
translated at runtime through the API.

`createChatTranslator` returns an `AsyncTranslator`
(`(text, locale, context?, signal?) => Promise<string>`):

```ts
import { createChatTranslator } from "stringlocale";

const live = createChatTranslator({
  apiKey,
  endpoint: "https://openrouter.ai/api/v1/chat/completions", // any OpenAI-compatible endpoint
  model: "google/gemini-2.5-flash",
});
```

Hand it to the provider; any `userAdapted` value then translates online. The
React layer bridges the async call into the synchronous `resolve()`: it caches
by `(locale, context, text)`, shows the source text until the translation lands,
then re-renders. Debounce the input you feed in so you don't translate on every
keystroke.

```tsx
// strings.ts
export const note = new StringLocale("{text}", {
  id: "note",
  params: { text: Param.userAdapted({ context: "user note" }) },
});

// App.tsx
<StringLocaleProvider store={store} locale="ne-NP" liveTranslator={live}>

function LiveNote() {
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  const debounced = useDebounced(input, 400);     // your own debounce
  return (
    <>
      <textarea value={input} onChange={(e) => setInput(e.target.value)} />
      <p>{t(note, { text: debounced })}</p>        {/* translates live */}
    </>
  );
}
```

A plain sync `adapter` prop still works for offline adaptation (e.g. localizing
digits); if both are set, `liveTranslator` wins. Without either, `userAdapted`
passes the text through unchanged.

> **Security.** `apiKey` is visible to whoever runs the code. Use it only on a
> server or in local dev — never ship a real key in a browser bundle. For
> production, set `endpoint` to your own backend route that injects the key
> server-side: `createChatTranslator({ endpoint: "/api/translate" })`.

The [`examples/simple-app`](examples/simple-app) "This month" row wires this up;
set `VITE_TRANSLATION_API_KEY` to enable it.

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
| `Param.userAdapted({ context })` | Free user text adapted at runtime | Adapter / live translator |

### Free user text: `user` vs `userAdapted`

Some values aren't yours to compile — a bio someone typed, a comment, a name.

* **`Param.user()`** — passed through **exactly as given**, in every locale.
  Never sent to a translator, never reformatted. The surrounding template is
  still localized; only the user's text is left alone.

  ```ts
  export const bio = new StringLocale("Bio — {text}", {
    id: "bio",
    params: { text: Param.user() },
  });
  // ne-NP: "जीवनी — Travel & food creator based in Pokhara"  (label translated, text verbatim)
  ```

* **`Param.userAdapted({ context })`** — user text run through an **adapter** at
  resolve time. The adapter can be:
  * a **sync** function for offline adjustments (e.g. localizing digits/dates), or
  * the provider's **`liveTranslator`** for online translation — see
    [Live (online) translation](#live-online-translation-via-useradapted).

  With neither, it behaves like `Param.user()`.

  ```ts
  export const monthly = new StringLocale("This month: {text}", {
    id: "monthly",
    params: { text: Param.userAdapted({ context: "creator monthly stats" }) },
  });

  // offline sync adapter — localize digits: 1200 -> १२०० (ne), ١٢٠٠ (ar)
  import { convertDigits } from "stringlocale";
  const adapter = (locale, _context, text) => convertDigits(text, locale);
  // <StringLocaleProvider store={store} adapter={adapter} locale="ne-NP">
  ```

## Runtime behavior

Offline by default — no LLM, translation API, or remote service is called while
your app runs; it only resolves already-compiled translations. Formatting uses
`Intl.NumberFormat`, `Intl.PluralRules`, `Intl.DateTimeFormat`, and
`Intl.RelativeTimeFormat`, with a handwritten fallback table for environments
that lack `Intl`.

The compiled bundle is a plain, portable JSON artifact, so the same translations
can be reused anywhere that reads the format — covering fallback chains, plural
forms, digit conversion, gender/custom axes, and enum substitution.

LLM-drafted translations are written to plain JSON, so you can review, diff, and
version them like any other build artifact before shipping.

## Develop

```bash
npm run build       # tsup -> ESM + CJS + .d.ts (runtime, react, cli)
npm run typecheck
npm test            # vitest, resolving against compiled bundle fixtures
```
