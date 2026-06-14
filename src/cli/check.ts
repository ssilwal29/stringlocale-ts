/**
 * Check command: CI gate that fails when the compiled bundle is out of sync
 * with the registered strings.
 *
 * Reports four problem classes (mirrors Python `compile.check`):
 *   missing   — id registered in source but absent from bundle
 *   orphaned  — id present in bundle but not in source
 *   stale     — bundle entry's recorded source text differs from current source
 *   drift     — placeholder set in source differs from the recorded source
 */
import * as registry from "../registry";
import type { BundleData } from "../bundle";

export interface CheckReport {
  missing: string[];
  orphaned: string[];
  stale: string[];
  drift: string[];
  ok: boolean;
}

export function check(bundle: BundleData): CheckReport {
  const strings = registry.allStrings();
  const registeredIds = new Set(strings.map((s) => s.id));
  const bundleIds = new Set(Object.keys(bundle.entries));

  const missing = strings
    .filter((s) => !bundleIds.has(s.id))
    .map((s) => s.id);

  const orphaned = [...bundleIds].filter((id) => !registeredIds.has(id));

  const stale: string[] = [];
  const drift: string[] = [];

  for (const str of strings) {
    const entry = bundle.entries[str.id];
    if (!entry) continue;
    if (entry.source !== str.source) {
      stale.push(str.id);
    }
    // Placeholder drift: recorded source placeholders vs current.
    const bundlePhs = extractPlaceholders(entry.source);
    const sourcePhs = extractPlaceholders(str.source);
    if (!setsEqual(bundlePhs, sourcePhs)) {
      drift.push(str.id);
    }
  }

  const ok =
    missing.length === 0 &&
    orphaned.length === 0 &&
    stale.length === 0 &&
    drift.length === 0;

  return { missing, orphaned, stale, drift, ok };
}

function extractPlaceholders(source: string): Set<string> {
  const re = /(?<!\{)\{([a-zA-Z_][a-zA-Z0-9_]*)\}(?!\})/g;
  const result = new Set<string>();
  for (const m of source.matchAll(re)) result.add(m[1]);
  return result;
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

export function formatReport(report: CheckReport): string {
  const lines: string[] = [];
  if (report.ok) {
    lines.push("check passed: bundle is in sync.");
    return lines.join("\n");
  }
  if (report.missing.length)
    lines.push(`missing (${report.missing.length}): ${report.missing.join(", ")}`);
  if (report.orphaned.length)
    lines.push(`orphaned (${report.orphaned.length}): ${report.orphaned.join(", ")}`);
  if (report.stale.length)
    lines.push(`stale (${report.stale.length}): ${report.stale.join(", ")}`);
  if (report.drift.length)
    lines.push(`placeholder drift (${report.drift.length}): ${report.drift.join(", ")}`);
  return lines.join("\n");
}
