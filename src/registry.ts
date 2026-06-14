/**
 * Registry of declared StringLocale objects, keyed by id.
 * Mirrors Python `registry.py`. Duplicate ids throw.
 *
 * The Map is pinned to `globalThis` under a shared key so there is exactly one
 * registry per process, even when more than one copy of this module is loaded —
 * which happens with the bundled CLI entry (a separate chunk from the runtime
 * entry) and with the ESM/CJS dual-package hazard. Without this, a strings file
 * registering against the runtime build and the CLI reading the registry would
 * touch two different Maps, and discovery would find nothing.
 */
import type { StringLocale } from "./core";

const REGISTRY_KEY = Symbol.for("stringlocale.registry");
const globalScope = globalThis as unknown as Record<
  symbol,
  Map<string, StringLocale> | undefined
>;
const registry: Map<string, StringLocale> =
  globalScope[REGISTRY_KEY] ?? (globalScope[REGISTRY_KEY] = new Map());

export function register(obj: StringLocale): void {
  const existing = registry.get(obj.id);
  if (existing && existing !== obj) {
    if (existing.source !== obj.source) {
      throw new Error(`duplicate string id: ${obj.id}`);
    }
    // Same source, different instance — allow re-registration.
    // Happens when the declaring module re-evaluates (e.g. HMR).
  }
  registry.set(obj.id, obj);
}

export function allStrings(): StringLocale[] {
  return [...registry.values()];
}

export function get(id: string): StringLocale | undefined {
  return registry.get(id);
}

export function clear(): void {
  registry.clear();
}

export function count(): number {
  return registry.size;
}
