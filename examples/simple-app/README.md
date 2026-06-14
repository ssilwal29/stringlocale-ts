# stringlocale — simple React app

A small, self-contained Vite + React app that runs the stringlocale workflow end
to end: **declare** strings once in typed code, **compile** them into static
locale bundles, and **resolve** them offline in components.

Source locale is `en-US`; the demo ships compiled `ne-NP` (Nepali), `nl-NL`
(Dutch) and `ar-SA` (Arabic, right-to-left) bundles.

```
simple-app/
  src/
    strings.ts   ← what YOU declare — the source of truth
    App.tsx      ← provider + components calling t()
    main.tsx     ← loads bundles, mounts the app
    styles.css   ← the demo styling
  public/
    i18n/        ← what COMPILE emits (committed so it runs as-is)
      manifest.json
      bundle.ne-NP.json
      bundle.nl-NL.json
      bundle.ar-SA.json
  index.html  vite.config.ts  tsconfig.json  package.json
```

## Run it

```bash
npm install      # links the local package via "stringlocale": "file:../.."
npm run dev
```

Open the dev server URL and click the language chips. `English` shows the
source text straight from the declaration; the others render compiled
translations. Switching to a not-yet-loaded locale fetches its bundle lazily.

The **This month** row is a `Param.userAdapted` value — the one online piece.
Type into it and the text is translated live via OpenRouter as you go (debounced).
Without a key it falls back to the offline sync adapter, which just localizes the
digits. To enable live translation:

```bash
cp .env.example .env.local      # then put your key in VITE_OPENROUTER_API_KEY
```

> **Dev-only key.** Vite inlines `VITE_*` vars into the browser bundle, so this
> exposes the key — fine for local dev, never for production. In a real app,
> point `createOpenRouterTranslator({ endpoint })` at your own backend proxy.

> **Local package.** `stringlocale` isn't on npm yet, so this example depends on
> the repo via `file:../..` and [vite.config.ts](vite.config.ts) aliases
> `stringlocale` to `../../src`, so dev always runs against the latest source
> with no build step. In a real app you'd `npm install stringlocale` and drop both.

---

## 1. What the developer declares

[src/strings.ts](src/strings.ts) — one typed object per user-facing string. You
write the **source text once** and tag each `{placeholder}` with a `Param` that
says *how* it renders. That's the entire authoring surface.

```ts
export const followers = new StringLocale("{n} followers", {
  id: "followers",
  params: { n: Param.number() },          // → locale digits & grouping
});

export const inbox = new StringLocale("You have {count} messages", {
  id: "inbox",
  params: { count: Param.plural() },      // → CLDR plural forms per locale
});

export const fee = new StringLocale("{creator} charges {amount} per post", {
  id: "fee",
  params: {
    creator: Param.literal(),             // → passed through verbatim
    amount: Param.currency("NPR"),        // → locale currency formatting
  },
});

export const campaignStatus = new StringLocale("Campaign is {status}", {
  id: "campaign_status",
  params: {
    status: Param.translatable(           // → each enum value pre-translated
      ["approved", "pending", "rejected"],
      { context: "campaign review status" },
    ),
  },
});

export const greeting = new StringLocale("{name}, your account is ready", {
  id: "greeting",
  params: { name: Param.literal() },
  gendered: true,                         // → male/female variants (an "axis")
});
```

You declare: a stable **id**, the **source text**, **typed params**, and
optional **axes** (gender / plural / custom). You do *not* write translation
keys, per-locale JSON, plural tables, or formatting code.

## 2. What `compile` outputs

```bash
npm run i18n          # compile --sources src/strings.ts --source-locale en-US
                      #         --locales ne-NP nl-NL ar-SA --out public/i18n
```

The compiler discovers every declared string, drafts a translation for each
**cell** (one per axis combination — e.g. each plural form, each gender) across
the target locales, and writes static JSON: a `manifest.json` plus one
`bundle.<locale>.json` per locale.

A single string becomes, for example:

```jsonc
// public/i18n/bundle.ne-NP.json
"inbox": {
  "source": "You have {count} messages",
  "cells": {
    "ne-NP": {                                  // one cell per plural form
      "plural=one":   "तपाईंसँग {count} सन्देश छ",
      "plural=other": "तपाईंसँग {count} सन्देशहरू छन्"
    }
  }
},
"campaign_status": {
  "cells": { "ne-NP": { "": "अभियान {status} छ" } },
  "enums": { "ne-NP": { "status": {            // translatable values resolved
    "approved": "अनुमोदित", "pending": "लंबित", "rejected": "अस्वीकृत"
  } } }
}
```

* Set `OPENROUTER_API_KEY` to draft real LLM translations; without it (or with
  `npm run i18n -- --stub`) you get deterministic placeholders to wire things up.
* Re-running only re-translates strings whose **source text changed**
  (incremental reuse) — adding `nl-NL` here reused the existing `ne-NP`/`ar-SA`
  cells and only translated Dutch.

Keep the bundle honest in CI:

```bash
npm run i18n:check    # fails on missing / orphaned / stale / placeholder drift
npm run i18n:prune    # drop entries whose id no longer exists in source
```

## 3. How it resolves at runtime

[src/main.tsx](src/main.tsx) loads the bundles **once**, then mounts the app:

```tsx
const store = await loadFromUrl("/i18n", { preload: ["ne-NP"] });
```

[src/App.tsx](src/App.tsx) wraps everything in a provider and resolves strings.
**No LLM or network call happens at resolve time** — it's a pure lookup, with
numbers / dates / currency / plurals formatted by the platform `Intl` APIs.

```tsx
const { t, locale, setLocale } = useTranslation();

t(greeting, { name: "Jane Doe", gender: "female" });
t(inbox, { count: 5 });
```

This demo calls `t()` directly. The package also exports a declarative
equivalent, `<Tr str={fee} creator="Jane Doe" amount={2500} />`, if you prefer
JSX over a function call.

The compiled bundles are plain JSON, so the same artifact can be reused by any
runtime that reads the format.

---

### Note on the in-repo wiring

The `i18n` scripts run the in-repo CLI through `tsx`, and
[tsconfig.json](tsconfig.json) maps `stringlocale` → `../../src` so the CLI and
`src/strings.ts` share one module instance (discovery works without a separate
compile-only file). None of this is needed in a real project — there you just
install the package and run `stringlocale compile`.
