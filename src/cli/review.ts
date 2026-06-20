/**
 * review command: serves a local web UI for browsing and editing translation
 * bundles. Reads the bundle from --out, serves it over HTTP, and writes edits
 * back to disk on save — no external dependencies, no build step required.
 */
import { createServer, IncomingMessage } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { readBundle, writeBundle } from "./bundle-io";
import type { BundleData } from "../bundle";

function detectCombined(outDir: string): boolean {
  return !existsSync(join(outDir, "manifest.json"));
}

function applyEdit(
  bundle: BundleData,
  id: string,
  locale: string,
  cells: Record<string, string>,
  enums: Record<string, Record<string, string>>,
): BundleData {
  const entry = bundle.entries[id];
  if (!entry) throw new Error(`unknown entry: ${id}`);
  return {
    ...bundle,
    entries: {
      ...bundle.entries,
      [id]: {
        ...entry,
        cells: { ...entry.cells, [locale]: cells },
        enums: { ...entry.enums, [locale]: enums },
      },
    },
  };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk));
    req.on("end", () => resolve(body));
  });
}

function getBundleMeta(outDir: string, bundle: BundleData, combined: boolean): {
  bundle_generated_at?: string;
  locales: Record<string, { generated_at?: string }>;
} {
  const locales: Record<string, { generated_at?: string }> = {};
  let bundleGeneratedAt: string | undefined;

  if (combined) {
    try {
      const mtime = statSync(join(outDir, "bundle.json")).mtime.toISOString();
      bundleGeneratedAt = mtime;
      for (const locale of bundle.locales) locales[locale] = { generated_at: mtime };
    } catch {
      for (const locale of bundle.locales) locales[locale] = {};
    }
    return { bundle_generated_at: bundleGeneratedAt, locales };
  }

  let manifestFiles: Record<string, string> = {};
  try {
    const manifestPath = join(outDir, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      files?: Record<string, string>;
    };
    manifestFiles = manifest.files ?? {};
    bundleGeneratedAt = statSync(manifestPath).mtime.toISOString();
  } catch {
    // Keep graceful fallback metadata when manifest is unavailable.
  }

  for (const locale of bundle.locales) {
    const filename = manifestFiles[locale] ?? `bundle.${locale}.json`;
    try {
      locales[locale] = {
        generated_at: statSync(join(outDir, filename)).mtime.toISOString(),
      };
    } catch {
      locales[locale] = {};
    }
  }

  return { bundle_generated_at: bundleGeneratedAt, locales };
}

// ── HTML UI (self-contained) ──────────────────────────────────────────────────
// Written with vanilla JS and no external deps so it works straight out of the
// CLI with zero install — no bundler, no framework.

const PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>stringlocale review</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'SF Mono',ui-monospace,Menlo,Monaco,monospace;font-size:14px;color:#1f1f1f;background:#ececec;display:flex;flex-direction:column;height:100vh;overflow:hidden}

.hdr{background:#e9e9e9;color:#1f1f1f;border-bottom:1px solid #d4d4d4;display:flex;align-items:stretch;flex-shrink:0;min-height:48px}
.brand{display:flex;align-items:center;padding:0 18px;border-right:1px solid #d4d4d4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-weight:700;font-size:14px;white-space:nowrap}
.brand span{color:#4b6cff}
.meta-grid{display:flex;align-items:stretch;flex:1;overflow-x:auto}
.meta-cell{display:flex;flex-direction:column;justify-content:center;gap:2px;padding:0 16px;border-right:1px solid #d4d4d4;white-space:nowrap;min-width:130px}
.meta-k{font-size:9px;letter-spacing:1.1px;text-transform:uppercase;color:#9a9a9a}
.meta-v{font-size:12px;font-weight:600;color:#2b2b2b}
.meta-rel{font-style:normal;font-size:10px;font-weight:500;color:#9a9a9a;margin-left:4px}
.hdr-ctrl{display:flex;align-items:center;gap:8px;padding:0 14px;border-left:1px solid #d4d4d4;background:#e1e1e1}
.hdr-ctrl label{font-size:9px;letter-spacing:1.1px;color:#8b8b8b;text-transform:uppercase}
.hdr-ctrl select{padding:5px 8px;border:1px solid #c4c4c4;background:#f7f7f7;color:#222;border-radius:4px;font-size:11px;outline:none;font-family:inherit}
.hdr-ctrl select:focus{border-color:#a8a8a8}

.layout{display:flex;flex:1;overflow:hidden}

.sidebar{width:250px;flex-shrink:0;background:#efefef;border-right:1px solid #d8d8d8;display:flex;flex-direction:column;overflow:hidden}
.search-wrap{padding:10px 12px;border-bottom:1px solid #dadada;flex-shrink:0}
.search-wrap input{width:100%;padding:8px 10px;border:1px solid #cfcfcf;border-radius:4px;font-size:12px;outline:none;background:#f7f7f7;color:#2d2d2d;font-family:inherit}
.search-wrap input:focus{background:#fff;border-color:#bdbdbd}
.str-count{font-size:11px;color:#8b8b8b;padding:6px 14px 2px;flex-shrink:0;letter-spacing:.8px;text-transform:lowercase}
.str-list{flex:1;overflow-y:auto}
.str-item{padding:8px 14px;cursor:pointer;display:flex;align-items:center;gap:8px;border-bottom:1px solid #e5e5e5;transition:background .1s}
.str-item:hover{background:#f7f7f7}
.str-item.active{background:#ffffff;border-right:2px solid #b5b5b5}
.str-item .sid{font-size:12px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
.dot-ok{background:#5fa65f}
.dot-warn{background:#b49b55}

.main{flex:1;overflow-y:auto;padding:26px 30px 38px}
.empty-state{display:flex;align-items:center;justify-content:center;height:100%;color:#9a9a9a;font-size:13px;text-align:center}

.str-id{font-size:19px;font-weight:700;line-height:1;color:#1f1f1f;margin-bottom:22px;letter-spacing:-.3px}
.str-id .hash{color:#bdbdbd;font-weight:400;margin-right:6px}
.src-block{background:#efece6;border-left:3px solid #c46d1c;padding:12px 15px;font-size:14px;line-height:1.5;color:#2a2a2a;margin-bottom:8px;word-break:break-word;max-width:720px;border-radius:0 4px 4px 0}
.params-row{display:flex;flex-wrap:wrap;gap:7px 16px;margin-bottom:4px}
.tag{font-size:11px;background:transparent;border:none;padding:0;color:#777}
.tag b{color:#555;font-weight:600}
.tag.axis{color:#7c3aed}

.sec{font-size:10px;font-weight:600;letter-spacing:1.4px;text-transform:uppercase;color:#9a9a9a;margin:26px 0 11px}

.tbl{width:100%;border-collapse:collapse;table-layout:fixed}
.tbl th{background:transparent;padding:4px 8px 8px 0;text-align:left;font-size:10px;font-weight:600;color:#9a9a9a;letter-spacing:.9px;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tbl th.cell-col{width:140px}
.tbl td{padding:4px 10px 13px 0;vertical-align:top}
.tbl tr:last-child td{border-bottom:none}
.cell-lbl{font-size:12px;color:#9a9a9a;padding:10px 8px 0 0;white-space:nowrap}
.cell-lbl.base{color:#9a9a9a}

textarea.tinput,input.tinput{width:100%;padding:9px 11px;border:1px solid #cfcfcf;border-radius:4px;font-family:inherit;font-size:13px;line-height:1.5;outline:none;color:#212121;background:#f6f6f6;resize:vertical;transition:border-color .12s,background .12s}
textarea.tinput{min-height:52px}
textarea.tinput:focus,input.tinput:focus{border-color:#9f9f9f;background:#fff}
.tinput.dirty{border-color:#cba35a;background:#fbf6ea}
.tinput.empty{border-color:#d6a3a3;background:#fdf4f4}
.tmeta{margin-top:5px;font-size:10px;color:#9a9a9a;letter-spacing:.3px}
.tmeta .ok{color:#5fa65f}
.tmeta .miss{color:#c46d1c}

.enum-param{font-size:12px;font-weight:600;color:#5f5f5f;margin:14px 0 7px}
.enum-val{font-size:12px;color:#808080;padding:10px 2px 0 0;white-space:nowrap}

.actions{margin-top:30px;padding-top:16px;border-top:1px solid #d6d6d6;display:flex;align-items:center;gap:18px}
.btn{padding:0;border:none;background:transparent;font-size:13px;cursor:pointer;color:#2b2b2b;line-height:1;display:flex;align-items:center;gap:6px;font-family:inherit}
.btn small{font-size:13px}
.btn:hover{color:#000}
.btn-save{font-weight:700}
.btn-reload{color:#6a6a6a}
.status{font-size:11px;color:#808080;letter-spacing:.6px;text-transform:lowercase}
.status.ok{color:#22c55e}
.status.err{color:#ef4444}

@media (max-width:860px){
  .layout{flex-direction:column}
  .sidebar{width:100%;max-height:200px;border-right:none;border-bottom:1px solid #d8d8d8}
  .main{padding:22px 18px 30px}
  .meta-cell{min-width:130px;padding:0 14px}
  .src-block{max-width:none}
}
</style>
</head>
<body>
<div class="hdr">
  <div class="brand">string<span>locale</span></div>
  <div class="meta-grid">
    <div class="meta-cell"><span class="meta-k">source</span><span class="meta-v" id="meta-source">-</span></div>
    <div class="meta-cell"><span class="meta-k">locale</span><span class="meta-v" id="meta-locale">all</span></div>
    <div class="meta-cell"><span class="meta-k">model</span><span class="meta-v" id="meta-model">-</span></div>
    <div class="meta-cell"><span class="meta-k">generated</span><span class="meta-v" id="meta-generated">unknown</span></div>
  </div>
  <div class="hdr-ctrl">
    <label for="locale-filter">Review locale</label>
    <select id="locale-filter"></select>
  </div>
</div>
<div class="layout">
  <div class="sidebar">
    <div class="search-wrap">
      <input type="text" id="search" placeholder="Filter strings..." autocomplete="off">
    </div>
    <div class="str-count" id="str-count"></div>
    <div class="str-list" id="str-list"></div>
  </div>
  <div class="main" id="main">
    <div class="empty-state">Select a string from the sidebar to review its translations.</div>
  </div>
</div>
<script>
(function() {
  'use strict';
  var bundle = null;
  var selected = null;
  var localeFilter = '__all__';
  // dirty[id][locale] = { cells, enums }
  var dirty = {};

  /* ── utils ── */
  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function attr(s) {
    return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;');
  }
  function cellLabel(key) {
    if (!key) return 'default';
    return key.split('|').map(function(p) {
      var i = p.indexOf('=');
      return p.slice(0,i) + ': ' + p.slice(i+1);
    }).join(' · ');
  }
  function allCellKeys(entry, locales) {
    var seen = {};
    locales.forEach(function(lc) {
      Object.keys(entry.cells[lc] || {}).forEach(function(k) { seen[k] = true; });
    });
    return Object.keys(seen).sort(function(a,b) {
      if (!a) return -1; if (!b) return 1; return a < b ? -1 : 1;
    });
  }
  function translatableParams(entry) {
    return Object.keys(entry.params).filter(function(p) {
      return entry.params[p].kind === 'translatable';
    });
  }
  function activeLocales() {
    if (localeFilter !== '__all__') return [localeFilter];
    return bundle.locales.slice();
  }

  function formatTs(ts) {
    if (!ts) return 'unknown';
    var d = new Date(ts);
    if (isNaN(d.getTime())) return 'unknown';
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var h = d.getHours();
    var ampm = h < 12 ? 'AM' : 'PM';
    var h12 = h % 12; if (h12 === 0) h12 = 12;
    var mins = ('0' + d.getMinutes()).slice(-2);
    var date = months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
    var time = h12 + ':' + mins + ' ' + ampm;
    return date + ' · ' + time;
  }

  function relativeTs(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    var diff = Date.now() - d.getTime();
    if (diff < 0) return '';
    var mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    var days = Math.floor(hrs / 24);
    if (days < 30) return days + 'd ago';
    var mos = Math.floor(days / 30);
    if (mos < 12) return mos + 'mo ago';
    return Math.floor(mos / 12) + 'y ago';
  }

  function metaForLocale(locale) {
    if (!bundle || !bundle._meta || !bundle._meta.locales) return null;
    return bundle._meta.locales[locale] || null;
  }

  function completionForLocale(locale) {
    var total = Object.keys(bundle.entries).length;
    var complete = Object.values(bundle.entries).filter(function(entry) {
      return entryComplete(entry, [locale]);
    }).length;
    return { complete: complete, total: total };
  }

  function extractPlaceholders(text) {
    var out = [];
    var seen = {};
    String(text).replace(/\{([a-zA-Z0-9_]+)\}/g, function(_, name) {
      if (!seen[name]) {
        seen[name] = true;
        out.push(name);
      }
      return '';
    });
    return out;
  }

  function buildTranslationMeta(source, value) {
    var placeholders = extractPlaceholders(source);
    var normalized = String(value || '');
    var checks = placeholders.map(function(name) {
      return normalized.indexOf('{' + name + '}') !== -1
        ? name + ' ✓'
        : name + ' !';
    });
    return 'placeholders ' + (checks.length ? checks.join('  ') : 'none') +
      '  ·  ' + normalized.length + ' chars';
  }

  function entryComplete(entry, locales) {
    return locales.every(function(lc) {
      var cells = entry.cells[lc];
      if (!cells || !Object.keys(cells).length) return false;
      return Object.keys(cells).every(function(k) { return !!cells[k]; });
    });
  }

  function renderLocaleFilter() {
    var sel = document.getElementById('locale-filter');
    var options = ['<option value="__all__">All locales</option>'];
    bundle.locales.forEach(function(lc) {
      options.push('<option value="' + attr(lc) + '">' + esc(lc) + '</option>');
    });
    sel.innerHTML = options.join('');
    if (bundle.locales.indexOf(localeFilter) === -1) localeFilter = '__all__';
    sel.value = localeFilter;
  }

  /* ── dirty state helpers ── */
  function getDirty(id, locale) {
    if (dirty[id] && dirty[id][locale]) return dirty[id][locale];
    var entry = bundle.entries[id];
    return {
      cells: Object.assign({}, entry.cells[locale] || {}),
      enums: JSON.parse(JSON.stringify(entry.enums[locale] || {}))
    };
  }
  function setDirty(id, locale, cells, enums) {
    if (!dirty[id]) dirty[id] = {};
    dirty[id][locale] = { cells: cells, enums: enums };
  }
  function hasDirty(id) {
    if (!dirty[id]) return false;
    return Object.keys(dirty[id]).length > 0;
  }

  /* ── render ── */
  function renderMeta() {
    if (!bundle || !Array.isArray(bundle.locales)) {
      document.getElementById('meta-source').textContent = '-';
      document.getElementById('meta-locale').textContent = 'unavailable';
      document.getElementById('meta-model').textContent = '-';
      document.getElementById('meta-generated').textContent = 'unknown';
      return;
    }
    var scope = localeFilter === '__all__' ? 'all' : localeFilter;
    var localeMeta = localeFilter !== '__all__' ? metaForLocale(localeFilter) : null;
    var genTs = localeMeta && localeMeta.generated_at
      ? localeMeta.generated_at
      : (bundle._meta && bundle._meta.bundle_generated_at
        ? bundle._meta.bundle_generated_at
        : null);
    document.getElementById('meta-source').textContent = bundle.source_locale;
    document.getElementById('meta-locale').textContent = scope;
    document.getElementById('meta-model').textContent = bundle.model || 'n/a';
    var genEl = document.getElementById('meta-generated');
    var rel = relativeTs(genTs);
    genEl.innerHTML = esc(formatTs(genTs)) + (rel ? ' <em class="meta-rel">' + esc(rel) + '</em>' : '');
  }

  function renderSidebar(filter) {
    var locales = activeLocales();
    var ids = Object.keys(bundle.entries).sort();
    if (filter) {
      var f = filter.toLowerCase();
      ids = ids.filter(function(id) { return id.toLowerCase().indexOf(f) !== -1; });
    }
    document.getElementById('str-count').textContent = ids.length + ' / ' + Object.keys(bundle.entries).length + ' strings';
    var html = '';
    ids.forEach(function(id) {
      var complete = entryComplete(bundle.entries[id], locales);
      var active = id === selected ? ' active' : '';
      html += '<div class="str-item' + active + '" data-id="' + attr(id) + '">' +
        '<div class="dot ' + (complete ? 'dot-ok' : 'dot-warn') + '"></div>' +
        '<div class="sid">' + esc(id) + '</div>' +
        '</div>';
    });
    var list = document.getElementById('str-list');
    list.innerHTML = html;
    list.querySelectorAll('.str-item').forEach(function(el) {
      el.addEventListener('click', function() { selectString(this.dataset.id); });
    });
  }

  function renderMain(id) {
    var entry = bundle.entries[id];
    var locales = activeLocales();
    var cellKeys = allCellKeys(entry, locales);
    var tParams = translatableParams(entry);

    var html = '<div class="str-id"><span class="hash">#</span>' + esc(id) + '</div>';
    html += '<div class="sec">Source · ' + esc(bundle.source_locale) + '</div>';
    html += '<div class="src-block">' + esc(entry.source) + '</div>';

    /* params / axes tags */
    var tags = [];
    Object.keys(entry.params).forEach(function(p) {
      tags.push('<span class="tag"><b>' + esc(p) + '</b> ' + esc(entry.params[p].kind) + '</span>');
    });
    Object.keys(entry.axes || {}).forEach(function(ax) {
      tags.push('<span class="tag axis"><b>axis/' + esc(ax) + '</b> [' + entry.axes[ax].map(esc).join(', ') + ']</span>');
    });
    if (tags.length) {
      html += '<div class="sec">Placeholders</div>';
      html += '<div class="params-row">' + tags.join('') + '</div>';
    }

    /* translations table */
    html += '<div class="sec">Translation · ' + esc(locales.join(', ')) + '</div>';
    if (!cellKeys.length) {
      html += '<p style="color:#94a3b8;font-size:13px">No cells compiled yet. Run <code>compile</code> first.</p>';
    } else {
      /* compute col width */
      var colPct = Math.floor(80 / locales.length);
      html += '<table class="tbl"><colgroup><col style="width:160px">';
      locales.forEach(function() { html += '<col style="width:' + colPct + '%">'; });
      html += '</colgroup><thead><tr><th class="cell-col">Cell</th>';
      locales.forEach(function(lc) { html += '<th>' + esc(lc) + '</th>'; });
      html += '</tr></thead><tbody>';

      cellKeys.forEach(function(key) {
        html += '<tr><td class="cell-lbl ' + (!key ? 'base' : '') + '">' + esc(cellLabel(key)) + '</td>';
        locales.forEach(function(lc) {
          var d = getDirty(id, lc);
          var val = d.cells[key] || '';
          var isEmpty = !val;
          var isDirty = !!(dirty[id] && dirty[id][lc]);
          html += '<td><textarea class="tinput' +
            (isDirty ? ' dirty' : '') + (isEmpty ? ' empty' : '') + '"' +
            ' data-id="' + attr(id) + '" data-locale="' + attr(lc) + '" data-key="' + attr(key) + '"' +
            ' rows="2">' + esc(val) + '</textarea>' +
            '<div class="tmeta">' + esc(buildTranslationMeta(entry.source, val)) + '</div></td>';
        });
        html += '</tr>';
      });
      html += '</tbody></table>';
    }

    /* enum translations */
    if (tParams.length) {
      html += '<div class="sec">Enum translations</div>';
      tParams.forEach(function(pname) {
        var values = entry.params[pname].values || [];
        html += '<div class="enum-param">' + esc(pname) + '</div>';
        html += '<table class="tbl"><colgroup><col style="width:160px">';
        locales.forEach(function() { html += '<col style="width:' + colPct + '%">'; });
        html += '</colgroup><thead><tr><th>Value</th>';
        locales.forEach(function(lc) { html += '<th>' + esc(lc) + '</th>'; });
        html += '</tr></thead><tbody>';
        values.forEach(function(val) {
          html += '<tr><td class="enum-val">' + esc(val) + '</td>';
          locales.forEach(function(lc) {
            var d = getDirty(id, lc);
            var translated = (d.enums[pname] && d.enums[pname][val]) || '';
            var isDirty = !!(dirty[id] && dirty[id][lc]);
            html += '<td><input type="text" class="tinput' + (isDirty ? ' dirty' : '') + '"' +
              ' data-id="' + attr(id) + '" data-locale="' + attr(lc) + '"' +
              ' data-param="' + attr(pname) + '" data-val="' + attr(val) + '"' +
              ' value="' + attr(translated) + '"></td>';
          });
          html += '</tr>';
        });
        html += '</tbody></table>';
      });
    }

    html += '<div class="actions">' +
      '<button class="btn btn-save" id="btn-save">↵ <small>save</small></button>' +
      '<button class="btn btn-reload" id="btn-reload">↺ <small>reload from disk</small></button>' +
      '<span class="status" id="save-status"></span>' +
      '</div>';

    var main = document.getElementById('main');
    main.innerHTML = html;

    /* cell textarea listeners */
    main.querySelectorAll('textarea.tinput').forEach(function(ta) {
      ta.addEventListener('input', function() {
        var eid = this.dataset.id, lc = this.dataset.locale, key = this.dataset.key;
        var d = getDirty(eid, lc);
        d.cells[key] = this.value;
        setDirty(eid, lc, d.cells, d.enums);
        this.classList.toggle('empty', !this.value);
        this.classList.add('dirty');
        if (this.nextElementSibling && this.nextElementSibling.classList.contains('tmeta')) {
          this.nextElementSibling.textContent = buildTranslationMeta(entry.source, this.value);
        }
        renderSidebar(document.getElementById('search').value);
      });
    });

    /* enum input listeners */
    main.querySelectorAll('input.tinput').forEach(function(inp) {
      inp.addEventListener('input', function() {
        var eid = this.dataset.id, lc = this.dataset.locale;
        var pname = this.dataset.param, val = this.dataset.val;
        var d = getDirty(eid, lc);
        if (!d.enums[pname]) d.enums[pname] = {};
        d.enums[pname][val] = this.value;
        setDirty(eid, lc, d.cells, d.enums);
        this.classList.add('dirty');
      });
    });

    /* save */
    document.getElementById('btn-save').addEventListener('click', function() { saveEntry(id); });

    /* reload */
    document.getElementById('btn-reload').addEventListener('click', function() {
      loadBundle(function() {
        if (dirty[id]) delete dirty[id];
        selectString(id);
      });
    });
  }

  function saveEntry(id) {
    var statusEl = document.getElementById('save-status');
    if (!hasDirty(id)) {
      statusEl.className = 'status ok';
      statusEl.textContent = 'No unsaved changes.';
      return;
    }
    statusEl.className = 'status';
    statusEl.textContent = 'Saving…';
    document.getElementById('btn-save').disabled = true;

    var locales = Object.keys(dirty[id] || {});
    var promises = locales.map(function(lc) {
      var d = dirty[id][lc];
      return fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: id, locale: lc, cells: d.cells, enums: d.enums })
      }).then(function(r) { return r.json(); });
    });

    Promise.all(promises).then(function(results) {
      var failed = results.filter(function(r) { return !r.ok; });
      if (failed.length) {
        statusEl.className = 'status err';
        statusEl.textContent = 'Error: ' + (failed[0].error || 'unknown');
        document.getElementById('btn-save').disabled = false;
        return;
      }
      delete dirty[id];
      loadBundle(function() {
        selectString(id);
        statusEl.className = 'status ok';
        statusEl.textContent = 'Saved ✓';
        document.getElementById('btn-save').disabled = false;
        setTimeout(function() {
          var s = document.getElementById('save-status');
          if (s && s.textContent === 'Saved ✓') s.textContent = '';
        }, 2500);
      });
    }).catch(function(e) {
      statusEl.className = 'status err';
      statusEl.textContent = 'Save failed: ' + e.message;
      document.getElementById('btn-save').disabled = false;
    });
  }

  function selectString(id) {
    selected = id;
    renderSidebar(document.getElementById('search').value);
    renderMain(id);
    document.getElementById('main').scrollTop = 0;
  }

  function loadBundle(cb) {
    fetch('/api/bundle')
      .then(function(r) {
        return r.json().then(function(payload) {
          if (!r.ok) {
            var msg = payload && payload.error ? payload.error : ('HTTP ' + r.status);
            throw new Error(msg);
          }
          return payload;
        });
      })
      .then(function(b) {
        if (!b || !Array.isArray(b.locales) || !b.entries || typeof b.entries !== 'object') {
          throw new Error('Invalid bundle format. Run compile first or check --out path.');
        }
        bundle = b;
        renderLocaleFilter();
        renderMeta();
        renderSidebar('');
        if (cb) cb();
      })
      .catch(function(e) {
        document.getElementById('main').innerHTML =
          '<div class="empty-state" style="color:#ef4444">Failed to load bundle: ' + esc(e.message) + '</div>';
      });
  }

  document.getElementById('locale-filter').addEventListener('change', function() {
    localeFilter = this.value;
    renderMeta();
    renderSidebar(document.getElementById('search').value);
    if (selected && bundle.entries[selected]) renderMain(selected);
  });

  /* search */
  document.getElementById('search').addEventListener('input', function() {
    renderSidebar(this.value);
  });

  /* boot */
  document.getElementById('main').innerHTML = '<div class="empty-state" style="color:#94a3b8">Loading bundle…</div>';
  loadBundle(null);
})();
</script>
</body>
</html>`;

// ── HTTP server ────────────────────────────────────────────────────────────────

export function serveReview(outDir: string, port: number): void {
  const combined = detectCombined(outDir);

  const server = createServer((req, res) => {
    const url = req.url ?? "/";

    if (req.method === "GET" && url === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(PAGE);
      return;
    }

    if (req.method === "GET" && url === "/api/bundle") {
      try {
        const bundle = readBundle(outDir);
        const meta = getBundleMeta(outDir, bundle, combined);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ...bundle, _meta: meta }));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(e) }));
      }
      return;
    }

    if (req.method === "POST" && url === "/api/save") {
      readBody(req)
        .then((body) => {
          const { id, locale, cells, enums } = JSON.parse(body);
          let bundle = readBundle(outDir);
          bundle = applyEdit(bundle, id, locale, cells, enums);
          writeBundle(bundle, outDir, combined);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        })
        .catch((e) => {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: String(e) }));
        });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  server.listen(port, "127.0.0.1", () => {
    process.stderr.write(`[stringlocale] review  →  http://localhost:${port}\n`);
  });
}
