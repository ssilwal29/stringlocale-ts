import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import {
  Param,
  StringLocale,
  loadCombined,
  loadManifest,
  convertDigits,
  pluralCategory,
  setFallbackChain,
  clearFallbackChains,
  registry,
} from "../src/index";
import type { BundleData, ManifestData, ResolveContext } from "../src/index";
import { Store } from "../src/runtime/store";

const FIX = join(__dirname, "fixtures");
const FIX_SPLIT = join(__dirname, "fixtures-split");

function combinedStore(adapter?: any): Store {
  const data = JSON.parse(
    readFileSync(join(FIX, "bundle.json"), "utf-8"),
  ) as BundleData;
  return loadCombined(data, adapter);
}

function ctx(store: Store, locale: string, adapter?: any): ResolveContext {
  return { store, locale, adapter };
}

// Re-declare the example strings so the runtime has objects to resolve.
// (In a real app these live in the app's source and are imported.)
function declareAll() {
  registry.clear();
  clearFallbackChains();
  return {
    joined: new StringLocale("{creator} joined the platform", {
      id: "joined",
      params: { creator: Param.literal() },
    }),
    followers: new StringLocale("{n} followers", {
      id: "followers",
      params: { n: Param.number() },
    }),
    inbox: new StringLocale("You have {count} messages", {
      id: "inbox",
      params: { count: Param.plural() },
    }),
    status: new StringLocale("Campaign is {status}", {
      id: "campaign_status",
      params: {
        status: Param.translatable(["approved", "pending", "rejected"], {
          context: "campaign review status",
        }),
      },
    }),
    deadline: new StringLocale("Deliver by {date}", {
      id: "deadline",
      params: { date: Param.date("long") },
    }),
    fee: new StringLocale("{creator} charges {amount} per post", {
      id: "fee",
      params: { creator: Param.literal(), amount: Param.currency("NPR") },
    }),
    posted: new StringLocale("Posted {when}", {
      id: "posted",
      params: { when: Param.relative() },
    }),
    brief: new StringLocale("Brief: {text}", {
      id: "brief",
      params: { text: Param.user() },
    }),
    summary: new StringLocale("Summary: {text}", {
      id: "summary",
      params: { text: Param.userAdapted({ context: "campaign summary" }) },
    }),
    greeting: new StringLocale("{name}, your account is ready", {
      id: "greeting",
      params: { name: Param.literal() },
      gendered: true,
    }),
  };
}

describe("formatters", () => {
  it("converts digits to native numerals", () => {
    expect(convertDigits("1200", "ne-NP")).toBe("१२००");
    expect(convertDigits("1200", "ar")).toBe("١٢٠٠");
    expect(convertDigits("1200", "en")).toBe("1200");
  });
});

describe("plural categories", () => {
  it("matches CLDR expectations", () => {
    expect(pluralCategory("en", 1)).toBe("one");
    expect(pluralCategory("en", 5)).toBe("other");
    expect(pluralCategory("ja", 5)).toBe("other");
    expect(pluralCategory("ar", 0)).toBe("zero");
    expect(pluralCategory("ar", 2)).toBe("two");
  });
});

describe("resolve against a compiled bundle", () => {
  let s: ReturnType<typeof declareAll>;
  let store: Store;

  beforeEach(() => {
    s = declareAll();
    store = combinedStore();
  });

  it("literal stays verbatim", () => {
    const out = s.joined.resolve(ctx(store, "ne-NP"), {
      creator: "Anisha Sharma",
    });
    expect(out).toContain("Anisha Sharma");
  });

  it("number is digit-converted", () => {
    expect(s.followers.resolve(ctx(store, "ne-NP"), { n: 1200 })).toContain(
      "१२००",
    );
    expect(s.followers.resolve(ctx(store, "ar"), { n: 1200 })).toContain(
      "١٢٠٠",
    );
  });

  it("plural selects the right cell per locale", () => {
    const one = s.inbox.resolve(ctx(store, "ar"), { count: 1 });
    const other = s.inbox.resolve(ctx(store, "ar"), { count: 100 });
    expect(one).not.toBe(other);
  });

  it("translatable substitutes the pre-translated value", () => {
    const out = s.status.resolve(ctx(store, "ne-NP"), { status: "approved" });
    expect(out).toContain("ne-NP:approved");
  });

  it("currency + date localize", () => {
    const out = s.fee.resolve(ctx(store, "ne-NP"), {
      creator: "Anisha",
      amount: 2500,
    });
    // digits converted somewhere in the amount
    expect(/[०१२३४५६७८९]/.test(out)).toBe(true);
  });

  it("date renders localized", () => {
    const out = s.deadline.resolve(ctx(store, "ne-NP"), {
      date: "2025-02-15",
    });
    expect(/[०१२३४५६७८९]/.test(out)).toBe(true);
  });

  it("relative time formats", () => {
    const out = s.posted.resolve(ctx(store, "en"), { when: -86400 * 3 });
    expect(out.toLowerCase()).toMatch(/3 days ago|days/);
  });

  it("user text passes through untouched", () => {
    const txt = "Looking for travel creators in Pokhara";
    expect(s.brief.resolve(ctx(store, "ne-NP"), { text: txt })).toContain(txt);
  });

  it("user_adapted stays offline without an adapter", () => {
    const out = s.summary.resolve(ctx(store, "ne-NP"), { text: "Ends Feb 15" });
    expect(out).toBe("ne-NP:Summary: Ends Feb 15");
  });

  it("user_adapted uses the adapter when provided", () => {
    const adapter = (locale: string, _c: string | undefined, text: string) =>
      convertDigits(text, locale);
    const aStore = combinedStore(adapter);
    const out = s.summary.resolve(ctx(aStore, "ne-NP", adapter), {
      text: "reached 1234",
    });
    expect(out).toContain("१२३४");
  });

  it("gender axis selects distinct cells", () => {
    const m = s.greeting.resolve(ctx(store, "ne-NP"), {
      name: "Mira",
      gender: "male",
    });
    const f = s.greeting.resolve(ctx(store, "ne-NP"), {
      name: "Mira",
      gender: "female",
    });
    expect(m).not.toBe(f);
  });
});

describe("fallback chains", () => {
  it("falls back ne-NP -> ne when only ne compiled", () => {
    registry.clear();
    const hello = new StringLocale("Hello", { id: "h_fb" });
    // craft a tiny in-memory bundle with only "ne"
    const data: BundleData = {
      version: 1,
      source_locale: "en",
      locales: ["ne"],
      entries: {
        h_fb: {
          id: "h_fb",
          source: "Hello",
          params: {},
          axes: {},
          cells: { ne: { "": "ne:Hello" } },
          enums: {},
          hashes: {},
        },
      },
    };
    const store = loadCombined(data);
    expect(hello.resolve(ctx(store, "ne-NP"))).toBe("ne:Hello");
  });

  it("honors a custom chain", () => {
    registry.clear();
    const hi = new StringLocale("Hi", { id: "h_custom" });
    const data: BundleData = {
      version: 1,
      source_locale: "en",
      locales: ["es"],
      entries: {
        h_custom: {
          id: "h_custom",
          source: "Hi",
          params: {},
          axes: {},
          cells: { es: { "": "es:Hi" } },
          enums: {},
          hashes: {},
        },
      },
    };
    const store = loadCombined(data);
    setFallbackChain("pt-BR", ["pt-BR", "pt", "es"]);
    expect(hi.resolve(ctx(store, "pt-BR"))).toBe("es:Hi");
  });
});

describe("split bundle (lazy)", () => {
  it("loads a locale file on demand via manifest", async () => {
    declareAll();
    const manifest = JSON.parse(
      readFileSync(join(FIX_SPLIT, "manifest.json"), "utf-8"),
    ) as ManifestData;
    const store = loadManifest(manifest, (filename) =>
      JSON.parse(readFileSync(join(FIX_SPLIT, filename), "utf-8")),
    );
    expect(store.hasLocale("ar")).toBe(false);
    await store.ensureLocale("ar");
    expect(store.hasLocale("ar")).toBe(true);
    const followers = registry.get("followers")!;
    const out = followers.resolve({ store, locale: "ar" }, { n: 1200 });
    expect(out).toContain("١٢٠٠");
  });
});

describe("placeholder validation", () => {
  it("throws when a placeholder has no param", () => {
    registry.clear();
    expect(() => new StringLocale("Hi {name}", { id: "bad" })).toThrow();
  });
});
