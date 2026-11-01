import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

import { Param, StringLocale, loadFromUrl, registry } from "../src/index";
import { loadFromFile } from "../src/node";

const FIX = join(__dirname, "fixtures");
const FIX_SPLIT = join(__dirname, "fixtures-split");

function followers() {
  registry.clear();
  return new StringLocale("{n} followers", { id: "followers", params: { n: Param.number() } });
}

describe("loadFromFile (stringlocale/node)", () => {
  it("loads a combined bundle from its directory", () => {
    const s = followers();
    const store = loadFromFile(FIX);
    expect(store.hasLocale("ne-NP")).toBe(true);
    expect(s.resolve({ store, locale: "ne-NP" }, { n: 1200 })).toContain("१२००");
  });

  it("loads a bundle.json file path directly", () => {
    const s = followers();
    const store = loadFromFile(join(FIX, "bundle.json"));
    expect(s.resolve({ store, locale: "ne-NP" }, { n: 5 })).toContain("५");
  });

  it("accepts a file: URL", () => {
    const s = followers();
    const store = loadFromFile(pathToFileURL(FIX));
    expect(s.resolve({ store, locale: "ne-NP" }, { n: 5 })).toContain("५");
  });

  it("merges every locale of a split (manifest) layout eagerly", () => {
    const s = followers();
    const store = loadFromFile(FIX_SPLIT);
    for (const loc of ["ne-NP", "ar-SA", "fa-IR", "ar"]) expect(store.hasLocale(loc)).toBe(true);
    expect(s.resolve({ store, locale: "ar" }, { n: 1200 })).toContain("١٢٠٠");
    expect(s.resolve({ store, locale: "ne-NP" }, { n: 1200 })).toContain("१२००");
  });

  it("passes an adapter through to the store", () => {
    registry.clear();
    const note = new StringLocale("Summary: {text}", { id: "summary", params: { text: Param.userAdapted({ context: "x" }) } });
    const store = loadFromFile(FIX, { adapter: (_l, _c, t) => t.toUpperCase() });
    expect(note.resolve({ store, locale: "ne-NP" }, { text: "hi" })).toContain("HI");
  });

  it("throws a clear error for a missing path", () => {
    expect(() => loadFromFile(join(FIX, "nope"))).toThrow(/no such file or directory/);
  });
});

describe("loadFromUrl in Node", () => {
  it("rejects a bare path with a pointer to loadFromFile", async () => {
    await expect(loadFromUrl("i18n")).rejects.toThrow(/loadFromFile/);
  });
});
