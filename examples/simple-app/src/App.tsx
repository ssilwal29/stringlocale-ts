/**
 * App.tsx — provider at the root, components call t() underneath.
 *
 * Each row shows two things: the resolved value for the active locale, and the
 * exact declaration the developer wrote (read live from the StringLocale's
 * .source / .params). Switch locale and the values re-resolve; the declaration
 * never changes — that's the point.
 */
import * as React from "react";
import type { Param, ResolveArgs, Store, StringLocale } from "stringlocale";
import { StringLocaleProvider, useTranslation } from "stringlocale/react";

import {
  campaignStatus,
  deadline,
  fee,
  followers,
  greeting,
  inbox,
} from "./strings";

// en-US is the source locale (no bundle — resolves to the declared text).
const LOCALES = [
  { tag: "en-US", flag: "🇺🇸", name: "English" },
  { tag: "ne-NP", flag: "🇳🇵", name: "नेपाली" },
  { tag: "nl-NL", flag: "🇳🇱", name: "Nederlands" },
  { tag: "ar-SA", flag: "🇸🇦", name: "العربية" },
] as const;

const USER = "Jane Doe";

// ── syntax-highlighted declaration, reconstructed from the StringLocale ───────
type Tok = [text: string, color: keyof typeof COLORS];

const COLORS = {
  kw: "#9333ea", // new
  cls: "#7c3aed", // StringLocale / Param
  fn: "#2563eb", // .literal / .number / ...
  str: "#0d9488", // string + array literals
  key: "#475569", // object keys
  bool: "#c2410c", // true
  punc: "#94a3b8", // braces, commas, dots
} as const;

function paramTokens(p: Param): Tok[] {
  const method = p.kind === "user_adapted" ? "userAdapted" : p.kind;
  const t: Tok[] = [["Param", "cls"], [".", "punc"], [method, "fn"], ["(", "punc"]];
  if (p.kind === "currency") t.push([`"${p.currencyCode}"`, "str"]);
  else if (p.kind === "date") t.push([`"${p.fmt}"`, "str"]);
  else if (p.kind === "translatable") {
    t.push(["[", "punc"]);
    p.values.forEach((v, i) => {
      if (i) t.push([", ", "punc"]);
      t.push([`"${v}"`, "str"]);
    });
    t.push(["]", "punc"]);
  }
  t.push([")", "punc"]);
  return t;
}

function declTokens(str: StringLocale): Tok[] {
  const entries = Object.entries(str.params);
  const nl: Tok = ["\n", "punc"];
  const out: Tok[] = [
    ["new ", "kw"], ["StringLocale", "cls"], ["(", "punc"],
    [`"${str.source}"`, "str"], [", {", "punc"], nl,
    ["  id", "key"], [": ", "punc"], [`"${str.id}"`, "str"], [",", "punc"], nl,
  ];
  if (entries.length > 1) {
    out.push(["  params", "key"], [": {", "punc"], nl);
    for (const [name, p] of entries) {
      out.push([`    ${name}`, "key"], [": ", "punc"], ...paramTokens(p), [",", "punc"], nl);
    }
    out.push(["  }", "punc"], [",", "punc"], nl);
  } else if (entries.length === 1) {
    const [name, p] = entries[0];
    out.push(
      ["  params", "key"], [": { ", "punc"], [name, "key"], [": ", "punc"],
      ...paramTokens(p), [" }", "punc"], [",", "punc"], nl,
    );
  }
  if (str.axes.gender) {
    out.push(["  gendered", "key"], [": ", "punc"], ["true", "bool"], [",", "punc"], nl);
  }
  out.push(["})", "punc"]);
  return out;
}

function Decl({ str }: { str: StringLocale }) {
  return (
    <pre className="decl" dir="ltr">
      {declTokens(str).map(([text, color], i) => (
        <span key={i} style={{ color: COLORS[color] }}>
          {text}
        </span>
      ))}
    </pre>
  );
}

function LocaleSwitcher() {
  const { locale, setLocale, loading } = useTranslation();
  return (
    <div className="switcher">
      {LOCALES.map((l) => (
        <button
          key={l.tag}
          onClick={() => setLocale(l.tag)}
          aria-pressed={l.tag === locale}
        >
          <span className="flag">{l.flag}</span>
          {l.name}
        </button>
      ))}
      {loading && <span className="spinner">loading…</span>}
    </div>
  );
}

function DemoRow({
  label,
  str,
  args,
  pill,
}: {
  label: string;
  str: StringLocale;
  args: ResolveArgs;
  pill?: boolean;
}) {
  const { t } = useTranslation();
  const value = t(str, args);
  return (
    <div className="row">
      <div className="row-main">
        <span className="label">{label}</span>
        <span className="value">
          {pill ? <span className="pill">{value}</span> : value}
        </span>
      </div>
      {/* the actual string the developer declared */}
      <Decl str={str} />
    </div>
  );
}

function CreatorCard() {
  const { t, locale } = useTranslation();
  const rtl = locale.startsWith("ar");
  return (
    <section className="card" dir={rtl ? "rtl" : "ltr"}>
      <h2>{t(greeting, { name: USER, gender: "female" })}</h2>
      <Decl str={greeting} />

      <DemoRow label="Rate" str={fee} args={{ creator: USER, amount: 2500 }} />
      <DemoRow label="Audience" str={followers} args={{ n: 1200 }} />
      <DemoRow label="Inbox" str={inbox} args={{ count: 5 }} />
      <DemoRow
        label="Latest campaign"
        str={campaignStatus}
        args={{ status: "approved" }}
        pill
      />
      <DemoRow
        label="Next deadline"
        str={deadline}
        args={{ date: "2025-09-30" }}
      />
    </section>
  );
}

function Explainer() {
  return (
    <div className="explainer">
      <div className="panel">
        <h3>
          <span className="step">1</span> You declare (src/strings.ts)
        </h3>
        <p>
          One typed object per string. Params say <em>how</em> each value
          renders — number, plural, currency, date, enum.
        </p>
        <pre>
          <span className="k">new</span> StringLocale(
          <span className="s">"{"{n}"} followers"</span>, {"{"}
          {"\n"}  id: <span className="s">"followers"</span>,
          {"\n"}  params: {"{"} n: Param.<span className="k">number</span>() {"}"},
          {"\n"}
          {"}"});
        </pre>
      </div>

      <div className="panel">
        <h3>
          <span className="step">2</span> Compile emits (public/i18n/)
        </h3>
        <p>
          <code style={{ color: "#5eead4" }}>npm run i18n</code> drafts every
          locale into static JSON — a manifest + one file per locale.
        </p>
        <pre>
          <span className="c">// bundle.ne-NP.json</span>
          {"\n"}<span className="s">"followers"</span>: {"{"}
          {"\n"}  cells: {"{"} <span className="s">"ne-NP"</span>:
          {"\n"}    {"{"} <span className="s">""</span>:{" "}
          <span className="s">"{"{n}"} अनुयायी"</span> {"}"}
          {"\n"}  {"}"}
          {"\n"}{"}"}
        </pre>
      </div>

      <div className="flow">
        <span className="chip">declare in code</span>
        <span className="arrow">→</span>
        <span className="chip">stringlocale compile</span>
        <span className="arrow">→</span>
        <span className="chip">resolve offline</span>
      </div>
    </div>
  );
}

export default function App({ store }: { store: Store }) {
  return (
    <StringLocaleProvider
      store={store}
      locale="ne-NP"
      fallback={<p style={{ color: "#94a3b8" }}>Loading translations…</p>}
    >
      <div className="page">
        <header className="masthead">
          <h1>
            <span className="brand">stringlocale</span> — live demo
          </h1>
          <p>
            Each value below is resolved for the selected language; the gray line
            under it is the exact string the developer declared. Switch language
            to re-resolve — the declarations stay put.
          </p>
        </header>

        <LocaleSwitcher />
        <CreatorCard />
        <Explainer />

        <p className="footnote">
          Numbers, currency, dates &amp; plurals are formatted by the platform{" "}
          <code>Intl</code> APIs — note native digits (१२००, ١٢٠٠) and RTL for
          Arabic.
        </p>
      </div>
    </StringLocaleProvider>
  );
}
