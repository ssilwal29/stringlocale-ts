#!/usr/bin/env node
/**
 * stringlocale CLI.
 *
 * Subcommands:
 *   compile   discover strings, draft translations, write bundles
 *   check     CI gate: fail on missing/orphaned/stale/placeholder drift
 *   prune     remove orphaned entries from a bundle (no re-translation)
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// ── TypeScript source bootstrap ───────────────────────────────────────────────
// The published bin is plain Node and cannot import .ts files directly.
// When --sources includes a .ts/.tsx path we find tsx in the project's
// node_modules or global PATH and re-execute through it automatically.
// A sentinel env var prevents infinite re-entry.

const _TS_LOADER = "_STRINGLOCALE_TS_LOADER";

function findTsx(): string | undefined {
  // Project-local tsx (most common: installed as a devDependency).
  const local = resolve(process.cwd(), "node_modules/.bin/tsx");
  if (existsSync(local)) return local;
  // Fall back to a global install.
  const which = process.platform === "win32" ? "where" : "which";
  const r = spawnSync(which, ["tsx"], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim().split("\n")[0] : undefined;
}

(function maybeRespawnWithTsx() {
  if (process.env[_TS_LOADER]) return; // already running via tsx
  const argv = process.argv.slice(2);
  // Scan only the values that follow --sources (stop at the next flag).
  let hasTsSource = false;
  const si = argv.indexOf("--sources");
  if (si !== -1) {
    for (let i = si + 1; i < argv.length && !argv[i].startsWith("--"); i++) {
      if (/\.tsx?$/.test(argv[i])) { hasTsSource = true; break; }
    }
  }
  if (!hasTsSource) return;

  const tsx = findTsx();
  if (!tsx) {
    process.stderr.write(
      "error: .ts sources require a TypeScript loader.\n" +
        "  Install one:  npm install -D tsx\n" +
        "  The CLI picks it up automatically on next run.\n",
    );
    process.exit(1);
  }
  // Re-run this exact script through tsx and exit when it finishes.
  const result = spawnSync(tsx, [process.argv[1], ...argv], {
    stdio: "inherit",
    env: { ...process.env, [_TS_LOADER]: "1" },
  });
  process.exit(result.status ?? 1);
})();

import * as registry from "../registry";
import { readBundle, writeBundle } from "./bundle-io";
import { cellCount, compileStrings, discover } from "./compile";
import { check, formatReport } from "./check";
import { prune } from "./prune";
import { OpenRouterTranslator, StubTranslator } from "./translate";

// ── locale validation ─────────────────────────────────────────────────────────

const FULL_LOCALE_RE = /^[a-z]{2,3}-(?:[A-Z]{2}|\d{3})$/;

function validateLocales(locales: string[]): boolean {
  const invalid = locales.filter((l) => !FULL_LOCALE_RE.test(l));
  if (!invalid.length) return true;
  err(
    `invalid locale tag(s): ${invalid.join(", ")}. ` +
      `Use full language-REGION tags like ne-NP, fr-FR, en-US, ar-SA.`,
  );
  return false;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function progress(msg: string) {
  process.stderr.write(`[stringlocale] ${msg}\n`);
}

function err(msg: string) {
  process.stderr.write(`error: ${msg}\n`);
}

function usage() {
  process.stdout.write(
    `stringlocale <subcommand> [options]\n\n` +
      `Subcommands:\n` +
      `  compile   discover strings, draft translations, write bundles\n` +
      `  check     CI gate: fail on missing/orphaned/stale/drift\n` +
      `  prune     remove orphaned entries from a bundle\n\n` +
      `Run 'stringlocale <subcommand> --help' for subcommand options.\n`,
  );
}

// ── argument parsing (minimal, no external deps) ──────────────────────────────

interface ParsedArgs {
  cmd: string;
  sources: string[];
  out: string;
  locales: string[];
  sourceLocale: string;
  combined: boolean;
  incremental: boolean;
  stub: boolean;
  strictDiscover: boolean;
  maxWorkers: number | undefined;
  model: string;
  openrouterTimeout: number;
  openrouterRetries: number;
  help: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    cmd: "",
    sources: ["."],
    out: "dist",
    locales: [],
    sourceLocale: "en",
    combined: false,
    incremental: true,
    stub: false,
    strictDiscover: false,
    maxWorkers: undefined,
    model: process.env["STRINGLOCALE_MODEL"] ?? "google/gemini-2.5-flash",
    openrouterTimeout: Number(process.env["STRINGLOCALE_OPENROUTER_TIMEOUT"] ?? 60),
    openrouterRetries: Number(process.env["STRINGLOCALE_OPENROUTER_RETRIES"] ?? 3),
    help: false,
  };

  let i = 0;

  function next(flag: string): string {
    if (i + 1 >= argv.length) throw new Error(`${flag} requires a value`);
    return argv[++i];
  }

  // First positional arg is the subcommand.
  if (argv[0] && !argv[0].startsWith("-")) {
    args.cmd = argv[i++];
  }

  for (; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--help":
      case "-h":
        args.help = true;
        break;
      case "--sources":
        args.sources = [];
        while (i + 1 < argv.length && !argv[i + 1].startsWith("-")) {
          args.sources.push(argv[++i]);
        }
        if (!args.sources.length) args.sources.push(next("--sources"));
        break;
      case "--out":
        args.out = next("--out");
        break;
      case "--locales":
        args.locales = [];
        while (i + 1 < argv.length && !argv[i + 1].startsWith("-")) {
          args.locales.push(argv[++i]);
        }
        if (!args.locales.length) args.locales.push(next("--locales"));
        break;
      case "--source-locale":
        args.sourceLocale = next("--source-locale");
        break;
      case "--combined":
        args.combined = true;
        break;
      case "--no-incremental":
        args.incremental = false;
        break;
      case "--stub":
        args.stub = true;
        break;
      case "--strict-discover":
        args.strictDiscover = true;
        break;
      case "--max-workers":
        args.maxWorkers = Number(next("--max-workers"));
        break;
      case "--model":
        args.model = next("--model");
        break;
      case "--openrouter-timeout":
        args.openrouterTimeout = Number(next("--openrouter-timeout"));
        break;
      case "--openrouter-retries":
        args.openrouterRetries = Number(next("--openrouter-retries"));
        break;
      default:
        // Positional after cmd — treat as extra source.
        if (!a.startsWith("-")) break;
        throw new Error(`unknown flag: ${a}`);
    }
  }

  return args;
}

// ── subcommand handlers ───────────────────────────────────────────────────────

async function cmdCompile(args: ParsedArgs): Promise<number> {
  if (!args.locales.length) {
    err("--locales is required for compile");
    return 2;
  }
  if (!validateLocales(args.locales)) return 2;

  progress(`discovering strings from ${args.sources.join(", ")}`);
  registry.clear();
  const n = await discover(args.sources, {
    strict: args.strictDiscover,
    progress,
  });
  if (n === 0) {
    err("no strings discovered; check --sources");
    return 1;
  }
  progress(`found ${n} string(s)`);

  // Select translator.
  let translator;
  if (args.stub || !process.env["OPENROUTER_API_KEY"]) {
    const reason = args.stub
      ? "--stub flag"
      : "OPENROUTER_API_KEY not set";
    progress(`StubTranslator selected (${reason})`);
    translator = new StubTranslator();
  } else {
    translator = new OpenRouterTranslator({
      model: args.model,
      timeoutMs: args.openrouterTimeout * 1000,
      retries: args.openrouterRetries,
      progress,
    });
    progress(
      `OpenRouterTranslator selected (model=${translator.model}, ` +
        `timeout=${translator.timeout / 1000}s, retries=${translator.retries})`,
    );
  }

  // Load previous bundle for incremental reuse.
  let previous = null;
  if (args.incremental) {
    progress(`checking for previous bundle in ${args.out}`);
    try {
      previous = readBundle(args.out);
      progress(`loaded previous bundle (${Object.keys(previous.entries).length} string(s))`);
      // A model switch invalidates every reused cell: redraft from scratch so
      // the whole bundle reflects one model.
      if (previous.model && previous.model !== translator.model) {
        progress(
          `model changed (${previous.model} -> ${translator.model}); redrafting all translations`,
        );
        previous = null;
      }
    } catch {
      progress("no previous bundle found; all cells will be drafted");
    }
  } else {
    progress("incremental reuse disabled");
  }

  const bundle = await compileStrings(args.locales, {
    sourceLocale: args.sourceLocale,
    translator,
    previous,
    progress,
  });

  const layout = args.combined ? "combined bundle" : "split locale bundles";
  progress(`writing ${layout} to ${args.out}`);
  const written = writeBundle(bundle, args.out, args.combined);

  const cells = cellCount(bundle);
  process.stdout.write(
    `compiled ${n} strings × ${args.locales.length} locales` +
      ` = ${cells} cells -> ${written.length} file(s) in ${args.out}\n`,
  );
  return 0;
}

async function cmdCheck(args: ParsedArgs): Promise<number> {
  progress(`discovering strings from ${args.sources.join(", ")}`);
  registry.clear();
  await discover(args.sources, { strict: args.strictDiscover, progress });

  const bundle = readBundle(args.out);
  const report = check(bundle);
  process.stdout.write(formatReport(report) + "\n");
  return report.ok ? 0 : 2;
}

async function cmdPrune(args: ParsedArgs): Promise<number> {
  progress(`discovering strings from ${args.sources.join(", ")}`);
  registry.clear();
  await discover(args.sources, { strict: args.strictDiscover, progress });

  const bundle = readBundle(args.out);
  const { bundle: pruned, removed } = prune(bundle);
  if (removed.length) {
    writeBundle(pruned, args.out, args.combined);
    process.stdout.write(
      `pruned ${removed.length} orphaned key(s): ${removed.join(", ")}\n`,
    );
  } else {
    process.stdout.write("nothing to prune.\n");
  }
  return 0;
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main(argv: string[]): Promise<number> {
  if (!argv.length || argv[0] === "--help" || argv[0] === "-h") {
    usage();
    return 0;
  }

  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (e) {
    err(String(e));
    return 2;
  }

  if (args.help) {
    usage();
    return 0;
  }

  switch (args.cmd) {
    case "compile":
      return cmdCompile(args);
    case "check":
      return cmdCheck(args);
    case "prune":
      return cmdPrune(args);
    default:
      err(`unknown subcommand: ${args.cmd || "(none)"}. Use compile, check, or prune.`);
      usage();
      return 2;
  }
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((e) => {
    process.stderr.write(`fatal: ${e}\n`);
    process.exit(1);
  });
