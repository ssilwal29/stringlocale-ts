/**
 * React usage — strings live in their own module, imported wherever needed.
 *
 *   strings.ts ─ declarations (the source the compiler reads)
 *   App.tsx    ─ provider + components calling t() / <Tr>
 */

// ---------------------------------------------------------------- strings.ts
import { Param, StringLocale } from "stringlocale";

export const followers = new StringLocale("{n} followers", {
  id: "followers",
  params: { n: Param.number() },
});

export const inbox = new StringLocale("You have {count} messages", {
  id: "inbox",
  params: { count: Param.plural() },
});

export const campaignStatus = new StringLocale("Campaign is {status}", {
  id: "campaign_status",
  params: {
    status: Param.translatable(["approved", "pending", "rejected"], {
      context: "campaign review status",
    }),
  },
});

export const fee = new StringLocale("{creator} charges {amount} per post", {
  id: "fee",
  params: { creator: Param.literal(), amount: Param.currency("NPR") },
});

export const greeting = new StringLocale("{name}, your account is ready", {
  id: "greeting",
  params: { name: Param.literal() },
  gendered: true,
});

// ------------------------------------------------------------------- App.tsx
import * as React from "react";
import { loadFromUrl, type Store } from "stringlocale";
import {
  StringLocaleProvider,
  Tr,
  useTranslation,
} from "stringlocale/react";

function LocaleSwitcher() {
  const { locale, setLocale, loading } = useTranslation();
  return (
    <div>
      {["en", "ne-NP", "ar"].map((l) => (
        <button
          key={l}
          onClick={() => setLocale(l)}
          aria-pressed={l === locale}
        >
          {l}
        </button>
      ))}
      {loading && <span> loading…</span>}
    </div>
  );
}

function CreatorCard() {
  const { t } = useTranslation();
  return (
    <article>
      <h2>{t(greeting, { name: "Anisha", gender: "female" })}</h2>
      {/* declarative form */}
      <p>
        <Tr str={fee} creator="Anisha" amount={2500} />
      </p>
      <p>{t(followers, { n: 1200 })}</p>
      <p>{t(inbox, { count: 5 })}</p>
      <p>{t(campaignStatus, { status: "approved" })}</p>
    </article>
  );
}

export default function App({ store }: { store: Store }) {
  return (
    <StringLocaleProvider
      store={store}
      locale="ne-NP"
      fallbacks={{ "pt-BR": ["pt-BR", "pt", "es"] }}
      fallback={<p>Loading translations…</p>}
    >
      <LocaleSwitcher />
      <CreatorCard />
    </StringLocaleProvider>
  );
}

// Bootstrapping: load the compiler's output (served as static JSON) once.
export async function bootstrap(): Promise<Store> {
  // Optional runtime hatch for Param.userAdapted — omit to stay fully offline.
  return loadFromUrl("/i18n", { preload: ["ne-NP"] });
}
