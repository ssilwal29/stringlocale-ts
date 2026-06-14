/**
 * Prune command: remove orphaned entries from the compiled bundle without
 * triggering any re-translation.
 *
 * An entry is orphaned when its id no longer appears in the registered
 * StringLocale objects (i.e. it was deleted from the source).  Pruning keeps
 * the bundle tidy for CI checks and reduces download size.
 */
import * as registry from "../registry";
import type { BundleData } from "../bundle";

export function prune(bundle: BundleData): { bundle: BundleData; removed: string[] } {
  const registeredIds = new Set(registry.allStrings().map((s) => s.id));
  const removed: string[] = [];

  const entries = { ...bundle.entries };
  for (const id of Object.keys(entries)) {
    if (!registeredIds.has(id)) {
      delete entries[id];
      removed.push(id);
    }
  }

  return {
    bundle: { ...bundle, entries },
    removed,
  };
}
