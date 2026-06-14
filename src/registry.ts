/**
 * Registry of declared StringLocale objects, keyed by id.
 * Mirrors Python `registry.py`. Duplicate ids throw.
 */
import type { StringLocale } from "./core";

const registry = new Map<string, StringLocale>();

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
