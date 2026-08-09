// Library Lookup - client app.
// Pure helpers are exported (and testable in Node); DOM wiring is guarded so the
// module can be imported without a browser.

// ---- color scheme (client copy; editable later via the config UI) ----------
export const DEFAULT_COLOR_SCHEME = {
  field: 'atosBookLevel',
  bands: [
    { min: 0.1, max: 1.9, color: '#E8912A', label: 'Orange' },
    { min: 2.0, max: 2.9, color: '#3AA757', label: 'Green' },
    { min: 3.0, max: 3.9, color: '#F4D000', label: 'Yellow' },
    { min: 4.0, max: 4.9, color: '#2E7CD6', label: 'Blue' },
    { min: 5.0, max: 5.9, color: '#E23B2E', label: 'Red' },
    { min: 6.0, max: 6.9, color: '#3A2E2A', label: 'Black' },
    { min: 7.0, max: 999, color: '#EE9BB8', label: 'Pink' },
  ],
};

export function colorFor(book, scheme = DEFAULT_COLOR_SCHEME) {
  const v = book?.[scheme.field];
  if (typeof v !== 'number' || Number.isNaN(v)) return { color: null, colorLabel: null };
  const b = scheme.bands.find((x) => v >= x.min && v <= x.max);
  return b ? { color: b.color, colorLabel: b.label } : { color: null, colorLabel: null };
}

export function normalizeIsbn(raw) {
  return String(raw ?? '').replace(/[^0-9Xx]/g, '').toUpperCase();
}

// Clean a raw scan into a bare ISBN. Handles scanners that append the printed
// price/supplement barcode: a Bookland EAN-13 (978/979...) may arrive with a
// trailing 5-digit (price) or 2-digit add-on; strip it back to the 13-digit ISBN.
export function cleanIsbn(raw) {
  const s = normalizeIsbn(raw);
  const m = s.match(/^(97[89]\d{10})(?:\d{5}|\d{2})$/);
  return m ? m[1] : s;
}

// Verify an ISBN-13 (EAN) or ISBN-10 check digit to catch garbled/partial scans.
export function isValidIsbn(s) {
  if (/^\d{13}$/.test(s)) {
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += (+s[i]) * (i % 2 ? 3 : 1);
    return (10 - (sum % 10)) % 10 === +s[12];
  }
  if (/^\d{9}[\dX]$/.test(s)) {
    let sum = 0;
    for (let i = 0; i < 9; i++) sum += (+s[i]) * (10 - i);
    sum += s[9] === 'X' ? 10 : +s[9];
    return sum % 11 === 0;
  }
  return false;
}

// Validate color bands. Returns { severity, type, i, j?, message } issues.
// severity 'error' (min>max, overlap, non-numeric) blocks saving; severity
// 'warn' (a gap where some levels get no color) is allowed but flagged.
export function validateBands(bands) {
  const issues = [];
  const nm = (b, i) => `"${b.label || 'Band ' + (i + 1)}"`;
  bands.forEach((b, i) => {
    const mn = Number(b.min), mx = Number(b.max);
    if (Number.isNaN(mn) || Number.isNaN(mx)) issues.push({ severity: 'error', type: 'nan', i, message: `${nm(b, i)}: min and max must be numbers.` });
    else if (mn > mx) issues.push({ severity: 'error', type: 'range', i, message: `${nm(b, i)}: min (${b.min}) is greater than max (${b.max}).` });
  });
  for (let i = 0; i < bands.length; i++) {
    for (let j = i + 1; j < bands.length; j++) {
      const a = bands[i], b = bands[j];
      const amn = Number(a.min), amx = Number(a.max), bmn = Number(b.min), bmx = Number(b.max);
      if ([amn, amx, bmn, bmx].some(Number.isNaN)) continue;
      if (amn <= bmx && bmn <= amx)
        issues.push({ severity: 'error', type: 'overlap', i, j, message: `${nm(a, i)} (${a.min} to ${a.max}) overlaps ${nm(b, j)} (${b.min} to ${b.max}).` });
    }
  }
  // Gaps: sort valid bands by min; a jump larger than one 0.1 step leaves levels uncovered.
  const valid = bands
    .map((b, i) => ({ i, mn: Number(b.min), mx: Number(b.max), label: b.label }))
    .filter((x) => !Number.isNaN(x.mn) && !Number.isNaN(x.mx) && x.mn <= x.mx)
    .sort((a, b) => a.mn - b.mn);
  for (let k = 1; k < valid.length; k++) {
    const prev = valid[k - 1], cur = valid[k];
    if (cur.mn - prev.mx > 0.1 + 1e-9) {
      const from = +(prev.mx + 0.1).toFixed(1), to = +(cur.mn - 0.1).toFixed(1);
      issues.push({ severity: 'warn', type: 'gap', i: prev.i, j: cur.i,
        message: `Gap: levels ${from} to ${to} get no color (between "${prev.label || 'Band'}" and "${cur.label || 'Band'}").` });
    }
  }
  return issues;
}

export const DEFAULT_SPEECH_TEMPLATE =
  '{title} by {authorNatural}. Level {atosBookLevel}, {colorLabel}. {points} points.';

export function speechText(book, template) {
  const b = deriveBook(book); // ensure name parts exist
  const t = template || DEFAULT_SPEECH_TEMPLATE;
  return t.replace(/\{(\w+)\}/g, (_, k) => {
    const v = b[k];
    return v === null || v === undefined || v === '' ? '' : Array.isArray(v) ? v.join(', ') : String(v);
  }).replace(/\s+/g, ' ').trim();
}

export const DEFAULT_CSV_KEYS = [
  'isbn', 'title', 'author', 'authorNatural', 'atosBookLevel', 'colorLabel', 'interestLevel',
  'points', 'arQuizNumber', 'fictionNonfiction', 'series', 'wordCount',
  'language', 'quizAvailability', 'detailUrl',
];
export const CSV_COLUMNS = DEFAULT_CSV_KEYS; // back-compat alias

// fields: resolved [{key,label}] (from selectedFields) or a plain key array.
// delim ',' -> CSV, '\t' -> TSV (handy for pasting into a spreadsheet).
export function toCSV(books, fields = DEFAULT_CSV_KEYS, delim = ',') {
  const cols = fields.map((f) => (typeof f === 'string' ? { key: f, label: registryLabel(f) } : f));
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : Array.isArray(v) ? v.join('; ') : String(v);
    return (s.includes(delim) || s.includes('"') || s.includes('\n')) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const head = cols.map((c) => esc(c.label)).join(delim);
  const body = books.map((b) => cols.map((c) => esc(fieldValue(deriveBook(b), c.key))).join(delim)).join('\n');
  return head + '\n' + body + '\n';
}

// A printable catalog list (a normal table). Opened via the print path; the user
// can Save as PDF from the print dialog. columns = resolved [{key,label}].
export function catalogHTML(books, columns, title = 'Library Catalog') {
  const cell = (b, key) => key === 'colorLabel'
    ? `<span class="dot" style="background:${b.color || '#ccc'}"></span>${htmlEscape(b.colorLabel || '')}`
    : htmlEscape(fieldValue(b, key));
  const head = columns.map((c) => `<th>${htmlEscape(c.label)}</th>`).join('');
  const rows = books.map((b) => { const bk = deriveBook(b); return `<tr>${columns.map((c) => `<td>${cell(bk, c.key)}</td>`).join('')}</tr>`; }).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${htmlEscape(title)}</title><style>
    * { box-sizing:border-box; }
    html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font:11pt/1.35 -apple-system,Segoe UI,Arial,sans-serif; color:#111; margin:24px; }
    h1 { font-size:16pt; margin:0 0 2px; }
    .meta { color:#555; font-size:9pt; margin:0 0 14px; }
    table { width:100%; border-collapse:collapse; }
    thead { display:table-header-group; }
    th, td { border:1px solid #ccc; padding:5px 8px; text-align:left; font-size:9.5pt; vertical-align:top; }
    th { background:#f0f3f7; }
    .dot { display:inline-block; width:10px; height:10px; border-radius:50%; vertical-align:middle; margin-right:6px; }
    @page { margin:0.5in; }
  </style></head><body onload="window.print()">
    <h1>${htmlEscape(title)}</h1>
    <div class="meta">${books.length} book${books.length === 1 ? '' : 's'} &middot; ${htmlEscape(new Date().toLocaleDateString())}</div>
    <table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>
  </body></html>`;
}

// A printable color-key legend (2-up Level/Color table) with a configurable
// title and the date at the bottom. Opened via the print path.
export function legendHTML(scheme = DEFAULT_COLOR_SCHEME, opts = {}) {
  const title = opts.title || 'Reading Level Colors';
  const date = opts.date || new Date().toLocaleDateString();
  const bands = (scheme && scheme.bands) || [];
  const fmt = (b) => (Number(b.max) >= 999 ? `${b.min} - Up` : `${b.min} - ${b.max}`);
  const half = Math.ceil(bands.length / 2);
  const left = bands.slice(0, half), right = bands.slice(half);
  const n = Math.max(left.length, right.length);
  const pair = (b) => b
    ? `<td class="lvl">${htmlEscape(fmt(b))}</td><td class="clr"><span class="dot" style="background:${b.color}"></span></td>`
    : `<td class="lvl"></td><td class="clr"></td>`;
  let body = '';
  for (let i = 0; i < n; i++) body += `<tr>${pair(left[i])}${pair(right[i])}</tr>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${htmlEscape(title)}</title><style>
    html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font:14pt/1.4 -apple-system,Segoe UI,Arial,sans-serif; color:#111; margin:0.75in; text-align:center; }
    h1 { font-size:26pt; font-weight:700; margin:0 0 28px; }
    table { border-collapse:collapse; margin:0 auto; }
    th, td { border:1px solid #333; padding:12px 26px; font-size:16pt; }
    th { background:#e9e9e9; }
    td.lvl { text-align:center; white-space:nowrap; } td.clr { text-align:center; }
    .dot { display:inline-block; width:34px; height:34px; border-radius:50%; vertical-align:middle; }
    .foot { margin-top:26px; color:#555; font-size:10pt; }
    @page { margin:0.5in; }
  </style></head><body onload="window.print()">
    <h1>${htmlEscape(title)}</h1>
    <table><thead><tr><th>Level</th><th>Color</th><th>Level</th><th>Color</th></tr></thead><tbody>${body}</tbody></table>
    <div class="foot">${htmlEscape(date)}</div>
  </body></html>`;
}

// Count books per color-band label (plus a "no color" bucket). For the summary.
export function summarize(books, scheme = DEFAULT_COLOR_SCHEME) {
  const counts = new Map();
  for (const b of scheme.bands) counts.set(b.label, { label: b.label, color: b.color, n: 0 });
  let noColor = 0;
  for (const bk of books) {
    const c = colorFor(bk, scheme);
    if (c.colorLabel && counts.has(c.colorLabel)) counts.get(c.colorLabel).n++;
    else noColor++;
  }
  return { bands: [...counts.values()], noColor, total: books.length };
}

// Dedupe: newest wins, moved to front. Returns { books, wasNew }.
export function upsertBook(books, book) {
  const i = books.findIndex((b) => b.isbn === book.isbn);
  const next = books.filter((b) => b.isbn !== book.isbn);
  next.unshift(book);
  return { books: next, wasNew: i === -1 };
}

export const htmlEscape = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---- shared field registry (key -> default display label) ------------------
export const FIELD_REGISTRY = [
  ['title', 'Title'],
  ['author', 'Author (as listed)'], ['authorNatural', 'Author (First Last)'],
  ['authorFirst', 'Author First Name'], ['authorLast', 'Author Last Name'],
  ['atosBookLevel', 'ATOS Book Level'],
  ['colorLabel', 'Color'], ['points', 'AR Points'], ['interestLevel', 'Interest Level'], ['interestShort', 'Interest Level (short)'],
  ['arQuizNumber', 'AR Quiz #'], ['quizAvailability', 'Quiz Availability'],
  ['fictionNonfiction', 'Fiction/Nonfiction'], ['series', 'Series'], ['topics', 'Topics'],
  ['wordCount', 'Word Count'], ['language', 'Language'], ['isbn', 'ISBN'],
  ['summary', 'Summary'], ['coverUrl', 'Cover URL'], ['detailUrl', 'Detail URL'], ['scannedAt', 'Scanned At'],
];

// Split "Last, First Middle" (arbookfind's format) into usable name parts.
export function splitAuthor(author) {
  const a = String(author ?? '').trim();
  if (!a) return { authorFirst: '', authorLast: '', authorNatural: '' };
  if (a.includes(',')) {
    const idx = a.indexOf(',');
    const authorLast = a.slice(0, idx).trim();
    const authorFirst = a.slice(idx + 1).trim();
    return { authorFirst, authorLast, authorNatural: (authorFirst + ' ' + authorLast).trim() };
  }
  const parts = a.split(/\s+/);
  const authorLast = parts.length > 1 ? parts[parts.length - 1] : a;
  const authorFirst = parts.slice(0, -1).join(' ');
  return { authorFirst, authorLast, authorNatural: a };
}
// Short interest-level code (e.g. "MG+", "LG", "UG") pulled from the full label
// like "Middle Grades Plus (MG+ 6 and up)". Nicer to hear/print than the long text.
export function interestShort(interestLevel) {
  const s = String(interestLevel ?? '');
  const m = s.match(/\(([A-Za-z]+\+?)/);
  return m ? m[1].toUpperCase() : s;
}
// Add derived fields to a book record (idempotent).
export function deriveBook(book) {
  return { ...book, ...splitAuthor(book.author), interestShort: interestShort(book.interestLevel) };
}
export const registryLabel = (key) => (FIELD_REGISTRY.find((f) => f[0] === key) || [key, key])[1];
const REGISTRY_KEYS = FIELD_REGISTRY.map((f) => f[0]);

// A "picker" is an ordered list of items. A registry item is { key, on, label, b, i, u }
// (b/i/u = bold/italic/underline for label printing; label '' = use default).
// A custom item is { custom:true, key, on, label, value, b, i, u } - a constant text
// line (label = its name, value = the text that prints).
// normalizePicker accepts a picker, a plain key array, or nothing, and returns a full
// ordered picker containing every registry field exactly once, plus any custom items
// preserved in place.
// Per-item meta: bold/italic/underline styling + "join" (share the printed line
// with the previous field, for multi-column rows) + "wrap" (allow a 2nd line
// before truncating, e.g. for long titles).
const metaOf = (x) => ({ b: !!x.b, i: !!x.i, u: !!x.u, join: !!x.join, wrap: !!x.wrap });
export function makeCustomField(name = '', value = '') {
  return { custom: true, key: 'custom:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), on: true, label: name, value, b: false, i: false, u: false, join: false, wrap: false };
}
export function normalizePicker(input, defaultSelected = []) {
  const provided = Array.isArray(input) ? input : [];
  const norm = provided.map((x) => (typeof x === 'string' ? { key: x, on: true, label: '' } : x)).filter(Boolean);
  const ordered = [];
  const usedRegistry = new Set();
  for (const x of norm) {
    if (x.custom || (typeof x.key === 'string' && x.key.startsWith('custom:'))) {
      ordered.push({ custom: true, key: x.key || makeCustomField().key, on: x.on !== false, label: x.label || '', value: x.value || '', ...metaOf(x) });
    } else if (REGISTRY_KEYS.includes(x.key) && !usedRegistry.has(x.key)) {
      usedRegistry.add(x.key);
      ordered.push({ key: x.key, on: x.on !== false, label: x.label || '', ...metaOf(x) });
    }
  }
  for (const key of REGISTRY_KEYS) if (!usedRegistry.has(key)) {
    ordered.push({ key, on: input ? false : defaultSelected.includes(key), label: '', b: false, i: false, u: false, join: false, wrap: false });
  }
  return ordered;
}
// Resolve a picker to the selected, ordered field descriptors with overrides + meta.
export function selectedFields(picker) {
  return (picker || []).filter((p) => p.on).map((p) => ({
    key: p.key, custom: !!p.custom, value: p.value,
    label: p.label || (p.custom ? '' : registryLabel(p.key)),
    b: !!p.b, i: !!p.i, u: !!p.u, join: !!p.join, wrap: !!p.wrap,
  }));
}
// Group selected fields into printed rows: an item with join=true shares the row
// with the previous item (multi-column); otherwise it starts a new row.
export function groupRows(fields) {
  const rows = [];
  for (const f of fields) {
    if (f.join && rows.length) rows[rows.length - 1].push(f);
    else rows.push([f]);
  }
  return rows;
}
// Effective printed line count: each row is as tall as its tallest column, and a
// wrapped field can take 2 lines. Used for font scaling and the fit warning.
export function labelLineCount(fields) {
  return groupRows(fields).reduce((sum, row) => sum + row.reduce((m, f) => Math.max(m, f.wrap ? 2 : 1), 0), 0);
}
// Default label field set with the title pre-bolded (users can turn it off).
export function defaultLabelFields() {
  const p = normalizePicker(null, DEFAULT_LABEL_KEYS);
  const t = p.find((x) => x.key === 'title'); if (t) t.b = true;
  return p;
}

export const DEFAULT_COLUMN_KEYS = ['title', 'author', 'atosBookLevel', 'colorLabel', 'points', 'arQuizNumber'];
export const DEFAULT_LABEL_KEYS = ['title', 'author', 'atosBookLevel', 'points'];
export const DEFAULT_PRINT = {
  format: 'avery3',           // 'avery3' | 'single'
  colorStyle: 'circleTR',     // 'none' | 'dotInline' | 'barLeft' | 'circleTR'
  fields: normalizePicker(null, DEFAULT_LABEL_KEYS),
};
// Two independent print profiles. Each carries its own layout + fields + calibration.
export const DEFAULT_SHEET = () => ({ format: 'avery3', colorStyle: 'barLeft', fields: defaultLabelFields(), calibration: defaultCalProfiles() });
export const DEFAULT_LABELMAKER = () => ({ format: 'single', colorStyle: 'none', fields: defaultLabelFields(), calibration: defaultCalProfiles() });

// ---- printer calibration (per print profile) -------------------------------
// Printers differ: the same sheet can land a little high/low or left/right on one
// printer vs another. A calibration profile shifts the whole label block by a
// small offset (inches) without resizing or reflowing it. Positive x = move
// right, positive y = move down. Users keep named profiles (home vs office);
// the first profile is the permanent, locked "Default Template" (0,0 = the
// official Avery specs). CAL_STEP is the per-click nudge; CAL_MAX clamps the
// offset so @page margins never go negative.
export const CAL_STEP = 0.01;
export const CAL_MAX = 0.4;
export const clampOffset = (v) => Math.max(-CAL_MAX, Math.min(CAL_MAX, Number(v) || 0));
export function defaultCalProfiles() {
  return { activeId: 'default', profiles: [{ id: 'default', name: 'Default Template', x: 0, y: 0, locked: true }] };
}
// Return a valid calibration object: always exactly one locked default first,
// user profiles (clamped, deduped ids) after, and a valid activeId.
export function normalizeCal(cal) {
  const profiles = [{ id: 'default', name: 'Default Template', x: 0, y: 0, locked: true }];
  const seen = new Set(['default']);
  const src = cal && Array.isArray(cal.profiles) ? cal.profiles : [];
  for (const p of src) {
    if (!p || p.locked || p.id === 'default') continue;      // never duplicate or unlock the default
    let id = String(p.id || '');
    if (!id || seen.has(id)) id = 'p' + Math.random().toString(36).slice(2, 8);
    seen.add(id);
    profiles.push({ id, name: String(p.name || 'Printer').trim() || 'Printer', x: clampOffset(p.x), y: clampOffset(p.y) });
  }
  let activeId = cal && cal.activeId;
  if (!profiles.some((p) => p.id === activeId)) activeId = 'default';
  return { activeId, profiles };
}
// The active profile's effective offset (clamped) plus its name.
export function activeCal(cal) {
  const c = normalizeCal(cal);
  const p = c.profiles.find((x) => x.id === c.activeId) || c.profiles[0];
  return { x: clampOffset(p.x), y: clampOffset(p.y), name: p.name };
}
// Build a CSS @page margin (top right bottom left) from a base margin (inches)
// plus a calibration offset, shifting content symmetrically so usable area is
// unchanged. Margins are clamped at 0 so they never go negative.
export function pageMargins(baseV, baseH, off = { x: 0, y: 0 }) {
  const x = clampOffset(off.x), y = clampOffset(off.y);
  const m = (v) => Math.max(0, v).toFixed(3) + 'in';
  return `${m(baseV + y)} ${m(baseH - x)} ${m(baseV - y)} ${m(baseH + x)}`;
}

// Format one field's value for display (cell or label line).
export function fieldValue(book, key) {
  const v = book[key];
  if (v === null || v === undefined) return '';
  return Array.isArray(v) ? v.join('; ') : String(v);
}

// Roughly how many fields fit legibly on one label before text risks overflowing.
export const LABEL_FIT_MAX = 6;
// Font scale factor by field count, so more fields shrink to fit the 1in label.
export function labelFontScale(n) {
  return n <= 4 ? 1 : n === 5 ? 0.9 : n === 6 ? 0.82 : n === 7 ? 0.74 : n === 8 ? 0.68 : 0.6;
}

// Build a complete printable HTML document for a set of books.
// Pure (no DOM) so it can be unit-tested; the app opens it in a print window.
export function labelSheetHTML(books, opts = {}) {
  const print = { ...DEFAULT_PRINT, ...(opts.print || {}) };
  const scheme = opts.colorScheme;
  const fields = selectedFields(print.fields);
  const style = print.colorStyle || 'none';
  const rows = groupRows(fields);
  // Starting size assumes each row is one line (optimistic). The on-load fit
  // script below measures the REAL rendered height per label and shrinks only if
  // it actually overflows - so a wrap that doesn't wrap costs nothing.
  const scale = labelFontScale(rows.length);
  const tPt = (9.5 * scale).toFixed(2), mPt = (8 * scale).toFixed(2), lh = (1.25 - (1 - scale) * 0.35).toFixed(2);
  const fmt = (f) => `${f.b ? 'font-weight:700;' : ''}${f.i ? 'font-style:italic;' : ''}${f.u ? 'text-decoration:underline;' : ''}`;
  const clsOf = (f) => `${f.custom ? 'm' : f.key === 'title' ? 't' : f.key === 'author' ? 'a' : 'm'}${f.wrap ? ' wrap' : ''}`;

  const labelHtml = (bk) => {
    const c = bk.color ? { color: bk.color, colorLabel: bk.colorLabel } : colorFor(bk, scheme);
    const dot = style === 'dotInline';
    const content = (f) => {
      if (f.custom) return htmlEscape(f.value ?? '');
      if (f.key === 'title') return htmlEscape(bk.title);
      if (f.key === 'author') return htmlEscape(bk.author);
      if (f.key === 'colorLabel')
        return `${dot ? `<span class="dot" style="background:${c.color || '#999'}"></span>` : ''}${htmlEscape(f.label)}: ${htmlEscape(c.colorLabel || '')}`;
      return `${htmlEscape(f.label)}: ${htmlEscape(fieldValue(bk, f.key))}`;
    };
    const rowHtml = (grp) => grp.length === 1
      ? `<div class="line ${clsOf(grp[0])}" style="${fmt(grp[0])}">${content(grp[0])}</div>`
      : `<div class="jrow">${grp.map((f) => `<span class="jcol ${clsOf(f)}" style="${fmt(f)}">${content(f)}</span>`).join('')}</div>`;
    const mark =
      style === 'barLeft' ? `<div class="cbar" style="background:${c.color || '#999'}"></div>` :
      style === 'circleTR' ? `<div class="ccirc" style="background:${c.color || '#999'}"></div>` : '';
    return `<div class="label ${style}">${mark}<div class="lbody">${rows.map(rowHtml).join('')}</div></div>`;
  };

  const off = { x: clampOffset(opts.offset && opts.offset.x), y: clampOffset(opts.offset && opts.offset.y) };
  const grid = print.format === 'single'
    ? `html, body { height: 100%; }
       @page { size: 2.625in 1in; margin: ${pageMargins(0.08, 0.08, off)}; }
       .label { width:100%; height:100%; page-break-after: always; }`
    : `@page { size: letter; margin: ${pageMargins(0.5, 0.1875, off)}; }
       .sheet { display:grid; grid-template-columns: repeat(3, 2.625in); column-gap: 0.125in; row-gap: 0; }
       .label { height:1in; overflow:hidden; }`;

  return `<!doctype html><html><head><meta charset="utf-8"><title>Library Lookup Labels</title><style>
    * { box-sizing:border-box; }
    /* Force color marks to actually print in color */
    html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { margin:0; font-family:-apple-system,Segoe UI,Arial,sans-serif; color:#111; line-height:${lh}; }
    .label { position:relative; padding:5px 8px; }
    .label.barLeft .lbody { padding-left:8px; }
    .line, .jcol { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .line.wrap, .jcol.wrap { white-space:normal; text-overflow:clip; display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; }
    .jrow { display:flex; gap:10px; align-items:flex-start; }
    .jcol { flex:1; min-width:0; }
    .label .t { font-size:${tPt}pt; }
    .label .a { font-size:${mPt}pt; color:#444; }
    .label .m { font-size:${mPt}pt; color:#222; }
    .dot { display:inline-block; width:9px; height:9px; border-radius:50%; vertical-align:middle; margin-right:4px; }
    /* Color bar spans ~90% of the label height, vertically centered, and is inset
       slightly from the edge, so a small print misalignment cannot leave a sliver
       of the wrong color bleeding onto a neighbouring label. */
    .cbar { position:absolute; left:2px; top:5%; height:90%; width:0.13in; border-radius:2px; }
    .ccirc { position:absolute; top:7px; right:7px; width:0.17in; height:0.17in; border-radius:50%; }
    ${grid}
  </style></head><body>
    <div class="sheet">${books.map(labelHtml).join('')}</div>
    <script>
      (function () {
        var MINPX = 7; // don't shrink below ~5pt
        // A cell overflows horizontally (nowrap) or, if wrapped, vertically past 2 lines.
        function cellOverflow(c) {
          return c.classList.contains('wrap')
            ? c.scrollHeight > c.clientHeight + 1
            : c.scrollWidth > c.clientWidth + 0.5;
        }
        // Shrink a set of cells uniformly while test() is true (or until the floor).
        function shrink(cells, test) {
          for (var g = 0; g < 80 && test(); g++) {
            var shrank = false;
            for (var i = 0; i < cells.length; i++) {
              var s = parseFloat(getComputedStyle(cells[i]).fontSize);
              if (s > MINPX) { cells[i].style.fontSize = (s - 0.5) + 'px'; shrank = true; }
            }
            if (!shrank) break;
          }
        }
        function fitRow(row) {
          var cols = row.classList.contains('jrow') ? [].slice.call(row.children) : [row];
          shrink(cols, function () { for (var i = 0; i < cols.length; i++) if (cellOverflow(cols[i])) return true; return false; });
        }
        function fitLabel(label) {
          var rows = label.querySelectorAll('.lbody > *');
          for (var i = 0; i < rows.length; i++) fitRow(rows[i]);                 // fit each row's width / wrap
          var cells = [].slice.call(label.querySelectorAll('.line, .jcol'));
          shrink(cells, function () { return label.scrollHeight > label.clientHeight + 1; }); // fit the label's real height
        }
        function fitAll() { var ls = document.querySelectorAll('.label'); for (var i = 0; i < ls.length; i++) fitLabel(ls[i]); }
        window.addEventListener('load', function () { try { fitAll(); } catch (e) {} window.print(); });
      })();
    </script>
  </body></html>`;
}

// Build a calibration test page: empty label outlines with centering crosshairs,
// laid out with the exact same geometry (and offset) as a real print. The teacher
// prints this on plain paper, holds it against a blank label sheet, and nudges the
// calibration until the boxes line up. No caption is placed in the page flow (it
// would shift the grid and defeat the test); the offset is shown in the title.
export function alignmentSheetHTML(opts = {}) {
  const single = opts.format === 'single';
  const off = { x: clampOffset(opts.offset && opts.offset.x), y: clampOffset(opts.offset && opts.offset.y) };
  const grid = single
    ? `html, body { height: 100%; }
       @page { size: 2.625in 1in; margin: ${pageMargins(0.08, 0.08, off)}; }
       .sheet { height: 100%; }
       .label { width:100%; height:100%; page-break-after: always; }`
    : `@page { size: letter; margin: ${pageMargins(0.5, 0.1875, off)}; }
       .sheet { display:grid; grid-template-columns: repeat(3, 2.625in); column-gap: 0.125in; row-gap: 0; }
       .label { height:1in; }`;
  const count = single ? 1 : 30;
  const hx = off.x > 0 ? `right ${off.x.toFixed(2)}in` : off.x < 0 ? `left ${(-off.x).toFixed(2)}in` : 'centered';
  const vy = off.y > 0 ? `down ${off.y.toFixed(2)}in` : off.y < 0 ? `up ${(-off.y).toFixed(2)}in` : 'centered';
  let cells = '';
  for (let i = 1; i <= count; i++) cells += `<div class="label"><span class="pos">${i}</span></div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Label alignment test (${hx}, ${vy})</title><style>
    * { box-sizing:border-box; }
    html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { margin:0; font-family:-apple-system,Segoe UI,Arial,sans-serif; color:#111; }
    /* Solid rounded edges match the die-cut label shape; dotted crosshairs mark
       the centre. The position number sits in the corner so it never overlaps a
       crosshair line and stays easy to read. */
    .label { position:relative; border:1px solid #999; border-radius:6px; display:flex; align-items:center; justify-content:center; }
    .label .pos { position:absolute; top:3px; left:6px; font-size:8pt; color:#bbb; }
    .label::before, .label::after { content:''; position:absolute; }
    .label::before { left:50%; top:7px; bottom:7px; border-left:1px dotted #b8b8b8; }
    .label::after { top:50%; left:7px; right:7px; border-top:1px dotted #b8b8b8; }
    ${grid}
  </style></head><body onload="window.print()">
    <div class="sheet">${cells}</div>
  </body></html>`;
}

// ============================ DOM app =======================================
if (typeof document !== 'undefined') {
  const $ = (id) => document.getElementById(id);
  const STORAGE_KEY = 'arcat.v1';

  const state = {
    settings: {
      workflow: { autoSee: true, autoSpeak: false, autoPrint: false, autoAdvance: true },
      speech: { rate: 1.0, template: null },
      colorScheme: structuredClone(DEFAULT_COLOR_SCHEME),
      columns: normalizePicker(null, DEFAULT_COLUMN_KEYS),
      csv: normalizePicker(null, DEFAULT_CSV_KEYS),
      sheet: DEFAULT_SHEET(),
      labelMaker: DEFAULT_LABELMAKER(),
      display: { truncate: true, limit: 60, density: 'comfortable', showActions: true },
      legendTitle: 'Accelerated Reading Colors',
      colWidths: {}, // per-column pixel widths (field key -> px), set by resizing
    },
    books: [],
  };

  // Settings edited in the dialog are staged in `draft` and only committed on Save.
  // S() returns the live copy to edit (draft while the dialog is open).
  const DIALOG_KEYS = ['colorScheme', 'columns', 'csv', 'sheet', 'labelMaker', 'speech', 'display', 'legendTitle'];
  let draft = null;
  const S = () => draft || state.settings;

  // ---- persistence ----
  let saveWarned = false;
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ settings: state.settings, books: state.books }));
      return;
    } catch {}
    // Session too big for browser storage: retry a lighter copy (drop the bulky
    // summary/topics from what's stored; they stay in memory for this session).
    try {
      const lean = { settings: state.settings, books: state.books.map(({ summary, topics, ...rest }) => rest) };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(lean));
      if (!saveWarned) { setStatus('Large session: auto-save is keeping a lighter copy. Use “Save session” to store a full backup file.', 'err'); saveWarned = true; }
    } catch {
      if (!saveWarned) { setStatus('Session too large to auto-save in the browser. Use “Save session” to keep your work in a file.', 'err'); saveWarned = true; }
    }
  }
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (d.settings) Object.assign(state.settings, d.settings);
      if (Array.isArray(d.books)) state.books = d.books;
    } catch {}
    migrateSettings();
  }
  // Keep settings valid across versions (pickers get normalized, defaults filled).
  function migrateSettings() {
    const s = state.settings;
    s.columns = normalizePicker(s.columns, DEFAULT_COLUMN_KEYS);
    s.csv = normalizePicker(s.csv, DEFAULT_CSV_KEYS);
    // Migrate the old single `print` config into the new `sheet` profile.
    if (s.print && !s.sheet) s.sheet = { format: 'avery3', colorStyle: s.print.colorStyle || 'circleTR', fields: s.print.fields };
    delete s.print;
    s.sheet = { ...DEFAULT_SHEET(), ...(s.sheet || {}), format: 'avery3' };
    s.sheet.fields = normalizePicker(s.sheet.fields, DEFAULT_LABEL_KEYS);
    s.sheet.calibration = normalizeCal(s.sheet.calibration);
    s.labelMaker = { ...DEFAULT_LABELMAKER(), ...(s.labelMaker || {}), format: 'single' };
    s.labelMaker.fields = normalizePicker(s.labelMaker.fields, DEFAULT_LABEL_KEYS);
    s.labelMaker.calibration = normalizeCal(s.labelMaker.calibration);
    s.display = { truncate: true, limit: 60, density: 'comfortable', showActions: true, ...(s.display || {}) };
    if (typeof s.legendTitle !== 'string') s.legendTitle = 'Accelerated Reading Colors';
    if (!s.colWidths || typeof s.colWidths !== 'object') s.colWidths = {};
    state.books = state.books.map(deriveBook); // backfill name parts on old sessions
  }

  // ---- lookup ----
  // Turn transport/server conditions into short, human messages.
  function friendlyError(status) {
    if (status === 429) return 'Too many lookups too quickly. Wait a few seconds and try again.';
    if (status === 502 || status === 503 || status === 504) return 'The book lookup service is temporarily unavailable. Try again in a moment.';
    if (status >= 500) return 'The lookup service had a problem. Please try again.';
    return 'Something went wrong looking that up. Please try again.';
  }
  async function lookup(isbn) {
    let r;
    try {
      r = await fetch('/api/lookup?isbn=' + encodeURIComponent(isbn));
    } catch {
      throw new Error('Network problem. Check your connection and try again.');
    }
    let data = {};
    try { data = await r.json(); } catch {}
    if (r.status === 404 || data.notFound) return null;              // treated as "not found"
    if (r.status === 400) throw new Error('That does not look like a valid ISBN.');
    if (!r.ok || data.error) throw new Error(friendlyError(r.status));
    return deriveBook({ ...data, ...colorFor(data, state.settings.colorScheme) });
  }

  // ---- speech ----
  function speak(book) {
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(speechText(book, state.settings.speech.template));
    u.rate = state.settings.speech.rate || 1;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }

  // ---- printing ----
  // Print a set of books using a named profile ('sheet' = 3-across, 'labelMaker' = single).
  // Uses a hidden iframe (no pop-up, nothing to close). The generated document
  // auto-calls window.print() on load. With Chrome launched using --kiosk-printing,
  // that prints straight to the default printer with no dialog, enabling a smooth
  // scan -> auto-print -> repeat workflow. Without the flag, the normal dialog shows.
  // Open an HTML document in a hidden iframe and let it print itself (works with
  // Chrome --kiosk-printing for no-dialog printing). Shared by labels + catalog.
  function printDoc(html) {
    const iframe = document.createElement('iframe');
    Object.assign(iframe.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
    iframe.setAttribute('aria-hidden', 'true');
    iframe.onload = () => {
      const win = iframe.contentWindow;
      try { win.addEventListener('afterprint', () => setTimeout(() => iframe.remove(), 200)); } catch {}
      setTimeout(() => { if (document.body.contains(iframe)) iframe.remove(); }, 120000); // safety cleanup
    };
    document.body.appendChild(iframe);
    const doc = iframe.contentWindow.document;
    doc.open(); doc.write(html); doc.close();
  }
  function printWith(profileName, books) {
    if (!books.length) { setStatus('Nothing to print.', 'err'); return; }
    const prof = state.settings[profileName];
    printDoc(labelSheetHTML(books, { print: prof, colorScheme: state.settings.colorScheme, offset: activeCal(prof.calibration) }));
  }
  // Show the active calibration profile name under the Print menu buttons.
  function updateCalNotes() {
    const set = (id, cal) => { const el = $(id); if (el) el.textContent = 'Calibration: ' + activeCal(cal).name; };
    set('calNoteSheet', state.settings.sheet.calibration);
    set('calNoteLabel', state.settings.labelMaker.calibration);
  }
  function printCatalog(books) {
    if (!books.length) { setStatus('No books to print.', 'err'); return; }
    printDoc(catalogHTML(books, selectedFields(state.settings.columns)));
  }
  function printLegend() {
    printDoc(legendHTML(state.settings.colorScheme, { title: state.settings.legendTitle }));
  }
  const printLabel = (book) => printWith('labelMaker', [book]); // per-row/card = one single label
  const escapeHtml = htmlEscape;

  // Recompute colors on every stored book (used when the scheme changes).
  function recolorAll() {
    state.books = state.books.map((b) => ({ ...b, ...colorFor(b, state.settings.colorScheme) }));
  }

  // Speak a short spoken cue on failures, but only when Speak is on (so a
  // hands-free scanner user hears misses, not just hits).
  function speakCue(text) {
    if (!state.settings.workflow.autoSpeak || !('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.rate = state.settings.speech.rate || 1;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }

  // ---- outputs pipeline (each stage independently gated) ----
  function runOutputs(book) {
    const wf = state.settings.workflow;
    if (wf.autoSee) showCard(book);
    if (wf.autoSpeak) speak(book);
    if (wf.autoPrint) printLabel(book);
  }

  // ---- render ----
  const statusEl = () => $('status');
  function setStatus(msg, cls = '') { const e = statusEl(); e.textContent = msg; e.className = 'status ' + cls; }

  function showCard(b) {
    $('strip').style.background = b.color || '#ccc';
    $('c_pill').style.background = b.color || '#999';
    $('c_pill').textContent = b.colorLabel || '-';
    $('cover').src = b.coverUrl || ''; $('cover').style.visibility = 'visible';
    $('c_title').textContent = b.title || '(untitled)';
    $('c_author').textContent = b.author || '';
    $('c_level').textContent = b.atosBookLevel ?? '-';
    $('c_interest').textContent = b.interestLevel || '-';
    $('c_points').textContent = b.points ?? '-';
    $('c_type').textContent = b.fictionNonfiction || '-';
    $('c_quiz').textContent = b.arQuizNumber || '-';
    $('card').dataset.isbn = b.isbn;
    $('card').style.display = 'block';
  }

  function truncateText(s) {
    const d = state.settings.display || {};
    const lim = Number(d.limit) || 0;
    if (!d.truncate || lim <= 0 || s.length <= lim) return { shown: s, full: s };
    return { shown: s.slice(0, lim).trimEnd() + '…', full: s };
  }
  const URL_FIELDS = new Set(['coverUrl', 'detailUrl']);
  const URL_TITLES = { coverUrl: 'Cover image', detailUrl: 'AR detail page' };
  function cellHtml(b, key) {
    if (key === 'colorLabel')
      return `<span class="dot" style="background:${b.color || '#ddd'}; margin-right:6px"></span>${escapeHtml(b.colorLabel || '-')}`;
    const v = fieldValue(b, key);
    if (v === '') return '-';
    if (URL_FIELDS.has(key)) // show a friendly title that links out; never the raw URL
      return `<a href="${escapeHtml(v)}" target="_blank" rel="noopener noreferrer">${escapeHtml(URL_TITLES[key] || 'Open')}</a>`;
    const { shown, full } = truncateText(v);
    return shown === full ? escapeHtml(shown) : `<span title="${escapeHtml(full)}">${escapeHtml(shown)}</span>`;
  }
  // ---- sorting (view only; state.books keeps the canonical insertion order) ----
  let sortState = { key: null, dir: 'asc' };
  // Resolve one field to a sortable pair: a lowercased string and a number (NaN
  // if not numeric). Blank values are flagged so they always sort to the bottom.
  function sortCell(bk, key) {
    if (key === 'colorLabel') { const s = (bk.colorLabel || '').toLowerCase(); return { blank: s === '', s, n: NaN }; }
    let v = bk[key];
    if (Array.isArray(v)) v = v.join('; ');
    if (v === null || v === undefined || String(v).trim() === '') return { blank: true, s: '', n: NaN };
    const str = String(v);
    const isNum = typeof v === 'number' || /^-?\d*\.?\d+$/.test(str.trim());
    return { blank: false, s: str.toLowerCase(), n: isNum ? Number(str) : NaN };
  }
  function compareBooks(a, b, key, dir) {
    const av = sortCell(a, key), bv = sortCell(b, key);
    if (av.blank && bv.blank) return 0;
    if (av.blank) return 1;                          // blanks always last
    if (bv.blank) return -1;
    let r = (!Number.isNaN(av.n) && !Number.isNaN(bv.n)) ? av.n - bv.n : av.s.localeCompare(bv.s);
    return dir === 'desc' ? -r : r;
  }
  // The books in the order shown in the table (and used by all print/export/copy).
  function displayedBooks() {
    if (!sortState.key) return state.books;
    return state.books.slice().sort((a, b) => compareBooks(a, b, sortState.key, sortState.dir));
  }
  function setSort(key) {
    if (sortState.key === key) sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
    else { sortState.key = key; sortState.dir = 'asc'; }
    renderAll();
  }
  function resetSort() { sortState = { key: null, dir: 'asc' }; renderAll(); }

  // ---- selection (for batch print / export) ----
  const selected = new Set();
  const getSelectedBooks = () => displayedBooks().filter((b) => selected.has(b.isbn));
  function updateSelectionUI() {
    const present = new Set(state.books.map((b) => b.isbn));
    for (const x of [...selected]) if (!present.has(x)) selected.delete(x);
    const n = selected.size, total = state.books.length, hasBooks = total > 0;
    const selAll = $('selAll');
    if (selAll) { selAll.checked = n > 0 && n === total; selAll.indeterminate = n > 0 && n < total; }
    const setSel = (id, base) => { const el = $(id); if (el) { el.textContent = base + ' - selected (' + n + ')'; el.disabled = n === 0; } };
    const setAll = (id) => { const el = $(id); if (el) el.disabled = !hasBooks; };
    setSel('pr-sheet-sel', '🖨️ Sheet'); setSel('pr-label-sel', '🏷️ Labels');
    setSel('exp-csv-sel', 'Export CSV'); setSel('exp-copy-sel', 'Copy to clipboard');
    setSel('delSelBtn', 'Delete');
    ['pr-sheet-all', 'pr-label-all', 'exp-csv-all', 'exp-copy-all', 'exp-print-list'].forEach(setAll);
  }
  async function copyToClipboard(books) {
    if (!books.length) { setStatus('No books to copy.', 'err'); return; }
    const tsv = toCSV(books, selectedFields(state.settings.csv), '\t');
    try {
      await navigator.clipboard.writeText(tsv);
      setStatus('Copied ' + books.length + ' book' + (books.length === 1 ? '' : 's') + ' to the clipboard - paste into Excel or Google Sheets.', 'ok');
    } catch {
      setStatus('Could not copy (the browser blocked clipboard access).', 'err');
    }
  }

  // ---- resizable columns ----
  const SEL_W = 34, ACT_W = 152, ACT_W_SMALL = 48;
  const mqSmall = window.matchMedia('(max-width: 640px)'); // matches the CSS breakpoint
  const actWidth = () => (mqSmall.matches ? ACT_W_SMALL : ACT_W); // narrow when collapsed to a ⋯
  const DEFAULT_COL_WIDTH = {
    title: 220, author: 170, authorNatural: 170, authorFirst: 120, authorLast: 120,
    atosBookLevel: 90, colorLabel: 110, interestLevel: 160, points: 80, arQuizNumber: 90,
    quizAvailability: 190, fictionNonfiction: 120, series: 160, topics: 240, wordCount: 90,
    language: 90, isbn: 130, summary: 280, coverUrl: 120, detailUrl: 120, scannedAt: 160,
  };
  const colWidthFor = (key) => (state.settings.colWidths && state.settings.colWidths[key]) || DEFAULT_COL_WIDTH[key] || 140;
  const colFor = (key) => [...$('colg').children].find((c) => c.dataset.k === key);
  function setTableWidth() {
    let t = 0; for (const c of $('colg').children) t += parseInt(c.style.width, 10) || 0;
    $('tbl').style.width = t + 'px';
  }
  function wireResize(handle) {
    const key = handle.dataset.k;
    handle.addEventListener('click', (e) => e.stopPropagation());
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault(); e.stopPropagation();
      const col = colFor(key); if (!col) return;
      const startX = e.clientX, startW = parseInt(col.style.width, 10) || col.getBoundingClientRect().width;
      const move = (ev) => { col.style.width = Math.max(50, Math.round(startW + (ev.clientX - startX))) + 'px'; setTableWidth(); };
      const up = () => {
        document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
        state.settings.colWidths = state.settings.colWidths || {};
        state.settings.colWidths[key] = parseInt(col.style.width, 10) || startW; save();
      };
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    });
    handle.addEventListener('dblclick', (e) => { e.preventDefault(); e.stopPropagation(); autoFitColumn(key); });
  }
  function autoFitColumn(key) {
    const cols = selectedFields(state.settings.columns);
    const label = (cols.find((c) => c.key === key) || {}).label || key;
    const meas = document.createElement('span');
    meas.style.cssText = 'position:absolute; visibility:hidden; left:-9999px; top:-9999px; white-space:nowrap; font:600 13px -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;';
    document.body.appendChild(meas);
    meas.textContent = label;
    let max = meas.offsetWidth + 28;           // header (bold) + room for the resize handle
    meas.style.fontWeight = '400';
    for (const b of state.books) {
      let text, extra = 20;
      if (key === 'colorLabel') { text = b.colorLabel || ''; extra = 40; }       // dot + gap
      else if (URL_FIELDS.has(key)) { text = URL_TITLES[key] || 'Open'; }
      else { text = truncateText(fieldValue(b, key)).shown; }
      meas.textContent = text || '';
      max = Math.max(max, meas.offsetWidth + extra);
    }
    document.body.removeChild(meas);
    const w = Math.min(600, Math.max(50, max));
    const col = colFor(key); if (col) { col.style.width = w + 'px'; setTableWidth(); }
    state.settings.colWidths = state.settings.colWidths || {}; state.settings.colWidths[key] = w; save();
  }

  // ---- floating menus (shared by header dropdowns and per-row action menus) ----
  function positionMenu(btn, list) {
    const margin = 8;
    list.style.position = 'fixed'; list.style.right = 'auto';
    list.style.maxWidth = (window.innerWidth - margin * 2) + 'px';
    const r = btn.getBoundingClientRect();
    const lw = list.offsetWidth, lh = list.offsetHeight;
    let left = Math.max(margin, Math.min(r.left, window.innerWidth - margin - lw));
    let top = r.bottom + 4;
    if (top + lh > window.innerHeight - margin) top = Math.max(margin, r.top - 4 - lh);
    list.style.left = left + 'px'; list.style.top = top + 'px';
  }
  function closeAllMenus() {
    document.querySelectorAll('.menu > .menu-list').forEach((l) => { l.hidden = true; });
    document.querySelectorAll('.rowmenu').forEach((l) => l.remove());
  }
  // Per-row action menu (used when the buttons collapse to a ⋯ on small screens).
  function openRowActions(btn, b) {
    closeAllMenus();
    const list = document.createElement('div'); list.className = 'menu-list rowmenu';
    const add = (label, fn, cls) => { const it = document.createElement('button'); it.textContent = label; if (cls) it.className = cls; it.onclick = () => { list.remove(); fn(); }; list.appendChild(it); };
    add('🔊 Speak', () => speak(b));
    add('🏷️ Print label', () => printLabel(b));
    add('✏️ Edit', () => { editingIsbn = b.isbn; renderAll(); });
    add('✕ Delete', () => { state.books = state.books.filter((x) => x.isbn !== b.isbn); selected.delete(b.isbn); save(); renderAll(); }, 'danger');
    document.body.appendChild(list);
    positionMenu(btn, list);
    setTimeout(() => document.addEventListener('click', function onDoc(e) {
      if (!list.contains(e.target) && e.target !== btn) { list.remove(); document.removeEventListener('click', onDoc); }
    }), 0);
  }

  const showActions = () => state.settings.display.showActions !== false;
  function renderHead() {
    const cols = selectedFields(state.settings.columns);
    const act = showActions();
    $('colg').innerHTML =
      `<col style="width:${SEL_W}px">` +
      cols.map((c) => `<col data-k="${escapeHtml(c.key)}" style="width:${colWidthFor(c.key)}px">`).join('') +
      (act ? `<col style="width:${actWidth()}px">` : '');
    $('thead').innerHTML =
      '<tr><th class="selcol"><input type="checkbox" id="selAll" title="Select all"></th>' +
      cols.map((c) => {
        const active = sortState.key === c.key;
        const ind = active ? (sortState.dir === 'asc' ? '▲' : '▼') : '';
        return `<th data-k="${escapeHtml(c.key)}" class="sortable${active ? ' sorted' : ''}" title="Click to sort by ${escapeHtml(c.label)}">${escapeHtml(c.label)}<span class="sortind">${ind}</span><span class="colresize" data-k="${escapeHtml(c.key)}" title="Drag to resize this column. Double-click to fit the contents."></span></th>`;
      }).join('') +
      (act ? `<th class="actcol">${mqSmall.matches ? '' : 'Actions'}</th>` : '') + '</tr>';
    setTableWidth();
    $('selAll').onchange = (e) => {
      if (e.target.checked) state.books.forEach((b) => selected.add(b.isbn)); else selected.clear();
      document.querySelectorAll('.rowsel').forEach((cb) => { cb.checked = e.target.checked; });
      updateSelectionUI();
    };
    $('thead').querySelectorAll('.colresize').forEach(wireResize);
    $('thead').querySelectorAll('th.sortable').forEach((th) => {
      th.addEventListener('click', (e) => { if (e.target.classList.contains('colresize')) return; setSort(th.dataset.k); });
    });
  }
  // ---- inline editing ----
  let editingIsbn = null;
  const NUMERIC_FIELDS = new Set(['atosBookLevel', 'points', 'wordCount']);
  const READONLY_EDIT = new Set(['colorLabel', 'coverUrl', 'detailUrl', 'authorNatural', 'authorFirst', 'authorLast', 'isbn', 'scannedAt', 'source', 'topics', 'summary']);
  function editCellHtml(b, key) {
    if (key === 'colorLabel')
      return `<span class="dot" style="background:${b.color || '#ddd'}; margin-right:6px"></span>${escapeHtml(b.colorLabel || '-')}`;
    if (READONLY_EDIT.has(key)) { const v = fieldValue(b, key); return `<input value="${escapeHtml(v)}" readonly />`; }
    const raw = b[key] == null ? '' : String(b[key]);
    return `<input data-k="${key}" type="${NUMERIC_FIELDS.has(key) ? 'number' : 'text'}"${NUMERIC_FIELDS.has(key) ? ' step="0.1"' : ''} value="${escapeHtml(raw)}" />`;
  }
  function saveEdit(b, tr) {
    tr.querySelectorAll('input[data-k]').forEach((inp) => {
      const k = inp.dataset.k;
      if (NUMERIC_FIELDS.has(k)) { const t = inp.value.trim(); const nn = t === '' ? null : Number(t); b[k] = Number.isNaN(nn) ? null : nn; }
      else b[k] = inp.value;
    });
    let nb = deriveBook(b);
    nb = { ...nb, ...colorFor(nb, state.settings.colorScheme) };
    state.books = state.books.map((x) => (x.isbn === b.isbn ? nb : x));
    editingIsbn = null; save(); renderAll();
  }

  function renderTable() {
    const dens = (state.settings.display && state.settings.display.density) || 'comfortable';
    $('tbl').classList.remove('dens-compact', 'dens-cozy', 'dens-comfortable', 'dens-spacious');
    $('tbl').classList.add('dens-' + dens);
    const act = showActions();
    if (!act) editingIsbn = null; // no actions column means no edit controls
    renderHead();
    const cols = selectedFields(state.settings.columns);
    const rows = $('rows');
    rows.innerHTML = '';
    for (const b of displayedBooks()) {
      const tr = document.createElement('tr');
      const editing = act && b.isbn === editingIsbn;
      if (editing) {
        tr.innerHTML =
          `<td class="selcol"></td>` +
          cols.map((c) => `<td class="editing ${c.key === 'colorLabel' ? 'dot' : ''}">${editCellHtml(b, c.key)}</td>`).join('') +
          `<td class="row-actions actcol">
            <button data-act="savedit" class="save" title="Save">✔</button>
            <button data-act="canceledit" class="cancel" title="Cancel">✖</button>
          </td>`;
        tr.querySelector('[data-act=savedit]').onclick = () => saveEdit(b, tr);
        tr.querySelector('[data-act=canceledit]').onclick = () => { editingIsbn = null; renderAll(); };
      } else {
        tr.innerHTML =
          `<td class="selcol"><input type="checkbox" class="rowsel" title="Check to include this book when printing or exporting the selected books" ${selected.has(b.isbn) ? 'checked' : ''}></td>` +
          cols.map((c) => `<td class="${c.key === 'colorLabel' ? 'dot' : ''}">${cellHtml(b, c.key)}</td>`).join('') +
          (act ? `<td class="row-actions actcol">
            <span class="rowbtns">
              <button data-act="speak" title="Speak">🔊</button>
              <button data-act="print" title="Print single label (label maker)">🏷️</button>
              <button data-act="edit" title="Edit this row">✏️</button>
              <button data-act="del" class="del" title="Remove">✕</button>
            </span>
            <button data-act="more" class="rowmore" title="Actions for this book">⋯</button>
          </td>` : '');
        tr.querySelector('.rowsel').onchange = (e) => { e.target.checked ? selected.add(b.isbn) : selected.delete(b.isbn); updateSelectionUI(); };
        if (act) {
          tr.querySelector('[data-act=speak]').onclick = () => speak(b);
          tr.querySelector('[data-act=print]').onclick = () => printLabel(b);
          tr.querySelector('[data-act=edit]').onclick = () => { editingIsbn = b.isbn; renderAll(); };
          tr.querySelector('[data-act=del]').onclick = () => { state.books = state.books.filter((x) => x.isbn !== b.isbn); selected.delete(b.isbn); save(); renderAll(); };
          tr.querySelector('[data-act=more]').onclick = (e) => { e.stopPropagation(); openRowActions(e.currentTarget, b); };
        }
      }
      rows.appendChild(tr);
    }
    $('empty').style.display = state.books.length ? 'none' : 'block';
    $('tbl').style.display = state.books.length ? '' : 'none';
    $('count').textContent = state.books.length + (state.books.length === 1 ? ' book' : ' books');
    const rb = $('resetSortBtn'); if (rb) rb.hidden = !sortState.key;
    renderSummary();
    updateSelectionUI();
  }
  function renderSummary() {
    const el = $('summary'); if (!el) return;
    if (!state.books.length) { el.innerHTML = ''; return; }
    const s = summarize(state.books, state.settings.colorScheme);
    let html = `<span class="total">${s.total} book${s.total === 1 ? '' : 's'}</span>`;
    for (const band of s.bands) if (band.n) html += `<span class="chip"><span class="dot" style="background:${band.color}"></span>${escapeHtml(band.label)} ${band.n}</span>`;
    if (s.noColor) html += `<span class="chip"><span class="dot" style="background:#ddd"></span>No color ${s.noColor}</span>`;
    el.innerHTML = html;
  }
  function renderAll() { renderTable(); }

  // ---- scan handling ----
  async function handleScan(raw) {
    const isbn = cleanIsbn(raw);
    if (!isbn) return;
    if (!isValidIsbn(isbn)) {
      const isUpc = /^\d{12}$/.test(isbn);
      setStatus(isUpc
        ? 'That looks like a store (UPC) barcode, not the book’s ISBN - older books often have this. Type the ISBN printed near the barcode (it starts with 978, or a 0/1 and may end in X) and press Enter.'
        : 'That scan did not look like a complete ISBN. Please scan or type it again.', 'err');
      speakCue(isUpc ? 'Store barcode, not an ISBN' : 'Not a valid ISBN');
      return;
    }
    setStatus('Looking up ' + isbn + '…');
    try {
      const book = await lookup(isbn);
      if (!book) { setStatus('No AR record found for ' + isbn + '.', 'err'); speakCue('Not found'); return; }
      const { books, wasNew } = upsertBook(state.books, book);
      state.books = books; save(); renderAll();
      runOutputs(book);
      setStatus((wasNew ? 'Added: ' : 'Updated: ') + book.title + ' (' + (book.colorLabel || 'no color') + ')', 'ok');
    } catch (e) {
      setStatus(e.message, 'err');
      speakCue('Lookup error, try again');
    }
  }

  // ---- bulk queue ----
  let queueRunning = false;
  let queueStop = false;
  function bulkUI(running) {
    $('bulkStart').style.display = running ? 'none' : '';
    $('bulkStop').style.display = running ? '' : 'none';
    $('qbar').style.display = running ? '' : ($('qfill').style.width && $('qfill').style.width !== '0%' ? '' : 'none');
  }
  function bulkProgress(done, total) {
    const pct = total ? Math.round((done / total) * 100) : 0;
    $('qfill').style.width = pct + '%';
  }
  async function processBulk(text) {
    if (queueRunning) return;
    const raw = text.split(/[\s,;]+/).map(cleanIsbn).filter(Boolean);
    const seen = new Set(); const uniq = raw.filter((x) => (seen.has(x) ? false : seen.add(x)));
    const fails = [];
    const list = uniq.filter((x) => { if (isValidIsbn(x)) return true; fails.push(x + ' (not a valid ISBN)'); return false; });
    if (!list.length && !fails.length) return;
    queueRunning = true; queueStop = false;
    bulkUI(true); bulkProgress(0, list.length);
    let added = 0, stopped = false;
    for (let i = 0; i < list.length; i++) {
      if (queueStop) { stopped = true; break; }
      $('qprog').textContent = `Processing ${i + 1} of ${list.length}… (${added} added)`;
      bulkProgress(i, list.length);
      try {
        const book = await lookup(list[i]);
        if (!book) { fails.push(list[i] + ' (not found)'); }
        else { const { books } = upsertBook(state.books, book); state.books = books; save(); renderAll(); added++; }
      } catch (e) {
        try { await sleep(1200); const book = await lookup(list[i]); if (book) { const { books } = upsertBook(state.books, book); state.books = books; save(); renderAll(); added++; } else fails.push(list[i] + ' (not found)'); }
        catch (e2) { fails.push(list[i] + ' (' + e2.message + ')'); }
      }
      await sleep(700); // politeness delay
    }
    bulkProgress(stopped ? 0 : list.length, list.length);
    $('qprog').textContent = `${stopped ? 'Stopped. ' : 'Done. '}${added} of ${uniq.length} added.` +
      (fails.length ? ' Skipped: ' + fails.join(', ') : '');
    queueRunning = false; queueStop = false;
    bulkUI(false);
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---- file helpers ----
  function download(name, text, type = 'text/plain') {
    const blob = new Blob([text], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---- init / wiring ----
  function syncTogglesFromState() {
    document.querySelectorAll('#toggles [data-flag]').forEach((el) => { el.checked = !!state.settings.workflow[el.dataset.flag]; });
    $('rate').value = state.settings.speech.rate;
  }

  // ---- settings dialog ----
  function renderBands() {
    const bands = S().colorScheme.bands;
    const issues = validateBands(bands);
    const errRows = new Set(issues.filter((x) => x.severity === 'error').flatMap((x) => [x.i, x.j].filter((n) => n !== undefined)));
    const warnRows = new Set(issues.filter((x) => x.severity === 'warn').flatMap((x) => [x.i, x.j].filter((n) => n !== undefined)));
    const tb = $('bandRows'); tb.innerHTML = '';
    bands.forEach((band, idx) => {
      const tr = document.createElement('tr');
      if (errRows.has(idx)) tr.style.background = '#fdecea';
      else if (warnRows.has(idx)) tr.style.background = '#fff6e5';
      tr.innerHTML = `
        <td><input type="number" step="0.1" value="${band.min}" style="width:64px" title="Lowest reading level in this color band"></td>
        <td><input type="number" step="0.1" value="${band.max}" style="width:64px" title="Highest reading level in this color band"></td>
        <td><input type="color" value="${band.color}" title="Pick the color for this band"></td>
        <td><input type="text" value="${htmlEscape(band.label)}" style="width:90px" title="Name for this color (e.g. Red)"></td>
        <td class="row-actions"><button class="del" title="Remove this color band">✕</button></td>`;
      const [minI, maxI, colI, labI] = tr.querySelectorAll('input');
      const commit = () => {
        band.min = Number(minI.value); band.max = Number(maxI.value);
        band.color = colI.value; band.label = labI.value;
        renderBands();
      };
      [minI, maxI, colI, labI].forEach((i) => i.addEventListener('change', commit));
      tr.querySelector('button.del').onclick = () => {
        bands.splice(idx, 1); renderBands();
      };
      tb.appendChild(tr);
    });
    const msg = $('bandMsg');
    const errors = issues.filter((x) => x.severity === 'error');
    const warns = issues.filter((x) => x.severity === 'warn');
    msg.style.display = 'block';
    msg.classList.remove('ok', 'warn');
    if (errors.length) {
      msg.innerHTML = errors.map((x) => '&#9888; ' + htmlEscape(x.message)).join('<br>')
        + (warns.length ? '<br>' + warns.map((x) => '&#9432; ' + htmlEscape(x.message)).join('<br>') : '');
    } else if (warns.length) {
      msg.classList.add('warn');
      msg.innerHTML = warns.map((x) => '&#9432; ' + htmlEscape(x.message)).join('<br>')
        + '<br>You can still save; some levels just will not get a color.';
    } else {
      msg.classList.add('ok');
      msg.textContent = 'No overlaps or gaps. Every level maps to one color.';
    }
  }
  // Reorderable pickers with per-field override, select-all, and copy-from.
  // All edits mutate the draft (via S()); nothing is persisted until Save.
  const PICKERS = {
    columns:    { el: 'columnPicker', short: 'Table', get: () => S().columns, set: (a) => { S().columns = a; } },
    csv:        { el: 'csvPicker', short: 'CSV', get: () => S().csv, set: (a) => { S().csv = a; } },
    sheet:      { el: 'sheetPicker', short: 'Sheet', styles: true, fitEl: 'sheetFit', get: () => S().sheet.fields, set: (a) => { S().sheet.fields = a; } },
    labelMaker: { el: 'labelMakerPicker', short: 'Label', styles: true, fitEl: 'labelMakerFit', get: () => S().labelMaker.fields, set: (a) => { S().labelMaker.fields = a; } },
  };
  const LABEL_MAX_COLS = 3;
  function updateFitWarning(name) {
    const cfg = PICKERS[name]; if (!cfg.fitEl) return;
    const el = $(cfg.fitEl); if (!el) return;
    const sel = selectedFields(cfg.get());
    const grouped = groupRows(sel);
    const lines = labelLineCount(sel);                              // printed lines (wrap counts as 2)
    const maxCols = grouped.reduce((m, r) => Math.max(m, r.length), 0);
    el.classList.remove('info');
    if (lines === 0) {
      el.style.display = 'block'; el.classList.add('info');
      el.textContent = 'No fields are checked - these labels will print blank.';
      return;
    }
    const parts = [];
    if (lines > LABEL_FIT_MAX) parts.push(`${lines} lines`);
    if (maxCols > LABEL_MAX_COLS) parts.push(`${maxCols} columns on one line`);
    if (parts.length) {
      el.style.display = 'block';
      el.textContent = `⚠ ${parts.join(' and ')} - text may not fit. The app shrinks the font to help fit everything, but you may need to drop a field or two (or use fewer columns) for labels to print correctly.`;
    } else { el.style.display = 'none'; }
  }
  function renderPicker(name) {
    const cfg = PICKERS[name];
    const picker = cfg.get();
    const el = $(cfg.el); el.innerHTML = '';

    const bar = document.createElement('div'); bar.className = 'ptoolbar';
    const allOn = picker.length > 0 && picker.every((p) => p.on);
    const noneOn = picker.every((p) => !p.on);
    const master = document.createElement('label'); master.className = 'pall';
    master.innerHTML = `<input type="checkbox" ${allOn ? 'checked' : ''}> Select all`;
    const mchk = master.querySelector('input'); mchk.indeterminate = !allOn && !noneOn;
    mchk.title = 'Turn every field in this list on or off';
    mchk.onchange = () => { picker.forEach((p) => (p.on = mchk.checked)); renderPicker(name); };
    bar.appendChild(master);
    if (cfg.styles) {
      const add = document.createElement('button'); add.className = 'btn tiny'; add.textContent = 'Add Custom Line';
      add.title = 'Add a constant text line (e.g. a class or room name)';
      add.onclick = () => { picker.push(makeCustomField('', '')); renderPicker(name); };
      bar.appendChild(add);
    }
    const grow = document.createElement('span'); grow.style.flex = '1'; bar.appendChild(grow);
    const lab = document.createElement('span'); lab.className = 'psync'; lab.textContent = 'Copy from:'; bar.appendChild(lab);
    for (const src of Object.keys(PICKERS)) if (src !== name) {
      const btn = document.createElement('button'); btn.className = 'btn tiny'; btn.textContent = PICKERS[src].short;
      btn.title = 'Copy selection, order and names from ' + PICKERS[src].short;
      btn.onclick = () => { cfg.set(structuredClone(PICKERS[src].get())); renderPicker(name); };
      bar.appendChild(btn);
    }
    el.appendChild(bar);

    const firstOnIdx = picker.findIndex((p) => p.on); // top printed line: nothing above to join
    picker.forEach((item, idx) => {
      const row = document.createElement('div');
      row.className = 'prow' + (item.on ? '' : ' off');

      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = item.on;
      cb.title = 'Check to include this field';
      cb.onchange = (e) => { item.on = e.target.checked; renderPicker(name); };
      row.appendChild(cb);

      if (item.custom) {
        const nameI = document.createElement('input'); nameI.type = 'text'; nameI.className = 'pname-in'; nameI.placeholder = 'Name'; nameI.value = item.label || '';
        nameI.title = 'A name to help you identify this custom line (not printed)';
        nameI.onchange = (e) => { item.label = e.target.value; };
        const valI = document.createElement('input'); valI.type = 'text'; valI.placeholder = 'Custom text to print'; valI.value = item.value || '';
        valI.title = 'The exact text that will print on the label';
        valI.onchange = (e) => { item.value = e.target.value; };
        row.appendChild(nameI); row.appendChild(valI);
      } else {
        const nm = document.createElement('span'); nm.className = 'name'; nm.textContent = registryLabel(item.key); row.appendChild(nm);
        const ov = document.createElement('input'); ov.type = 'text'; ov.placeholder = registryLabel(item.key); ov.value = item.label || '';
        ov.title = 'Type a custom name to show for this field, or leave blank to use the default';
        ov.onchange = (e) => { item.label = e.target.value.trim(); };
        row.appendChild(ov);
      }

      if (cfg.styles) {
        // The first checked field is the top printed line - it has nothing above to join to.
        const isTopLine = idx === firstOnIdx;
        const joinActive = item.join && !isTopLine;
        if (joinActive) row.classList.add('joined');
        const jb = document.createElement('button'); jb.type = 'button'; jb.className = 'joinbtn' + (joinActive ? ' on' : '');
        jb.textContent = 'join';
        if (isTopLine) {
          jb.disabled = true;
          jb.title = 'The top printed line has nothing above it to join to.';
        } else {
          jb.title = 'Join to the line above (put on the same printed row to make columns)';
          jb.onclick = () => { item.join = !item.join; renderPicker(name); };
        }
        row.appendChild(jb);

        const wb = document.createElement('button'); wb.type = 'button'; wb.className = 'joinbtn' + (item.wrap ? ' on' : '');
        wb.textContent = 'wrap'; wb.title = 'Allow this field to use a 2nd line before truncating (good for long titles)';
        wb.onclick = () => { item.wrap = !item.wrap; renderPicker(name); };
        row.appendChild(wb);

        const biu = document.createElement('span'); biu.className = 'biu';
        for (const [k, glyph] of [['b', 'B'], ['i', 'I'], ['u', 'U']]) {
          const bt = document.createElement('button'); bt.type = 'button'; bt.textContent = glyph;
          bt.className = item[k] ? 'on' : '';
          bt.title = { b: 'Bold', i: 'Italic', u: 'Underline' }[k];
          bt.onclick = () => { item[k] = !item[k]; renderPicker(name); };
          biu.appendChild(bt);
        }
        row.appendChild(biu);
      }

      const len = picker.length;
      const move = (target) => { const [it] = picker.splice(idx, 1); picker.splice(target, 0, it); renderPicker(name); };
      const ord = document.createElement('span'); ord.className = 'ord';
      const up = document.createElement('button'); up.textContent = '▲'; up.title = 'Move up (wraps to bottom)';
      up.onclick = () => move(idx === 0 ? len - 1 : idx - 1);
      const down = document.createElement('button'); down.textContent = '▼'; down.title = 'Move down (wraps to top)';
      down.onclick = () => move(idx === len - 1 ? 0 : idx + 1);
      ord.appendChild(up); ord.appendChild(down);
      row.appendChild(ord);

      // Fixed-width remove slot in every row keeps columns aligned (empty for non-custom).
      const rm = document.createElement('span'); rm.className = 'rm';
      if (item.custom) {
        const b = document.createElement('button'); b.textContent = '✕'; b.className = 'del'; b.title = 'Remove custom line';
        b.onclick = () => { picker.splice(idx, 1); renderPicker(name); };
        rm.appendChild(b);
      }
      row.appendChild(rm);
      el.appendChild(row);
    });

    updateFitWarning(name);
  }

  // ---- printer calibration UI (TV-remote D-pad, one per print profile) ----
  // All edits mutate the draft calibration; nothing persists until Save.
  const CALS = {
    sheet:      { el: 'sheetCal', format: 'avery3', get: () => S().sheet.calibration, set: (c) => { S().sheet.calibration = c; } },
    labelMaker: { el: 'labelMakerCal', format: 'single', get: () => S().labelMaker.calibration, set: (c) => { S().labelMaker.calibration = c; } },
  };
  const calId = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  function calUniqueName(cal, base) {
    const names = new Set(cal.profiles.map((p) => p.name));
    if (!names.has(base)) return base;
    for (let i = 2; ; i++) if (!names.has(base + ' ' + i)) return base + ' ' + i;
  }
  function calReadout(p) {
    const h = p.x > 1e-4 ? `right ${p.x.toFixed(2)} in` : p.x < -1e-4 ? `left ${(-p.x).toFixed(2)} in` : 'centered';
    const v = p.y > 1e-4 ? `down ${p.y.toFixed(2)} in` : p.y < -1e-4 ? `up ${(-p.y).toFixed(2)} in` : 'centered';
    return `Left/Right: <b>${h}</b> &middot; Up/Down: <b>${v}</b>`;
  }
  function renderCal(name) {
    const cfg = CALS[name];
    const el = $(cfg.el); if (!el) return;
    const cal = normalizeCal(cfg.get()); cfg.set(cal);              // keep the draft valid
    const prof = cal.profiles.find((p) => p.id === cal.activeId) || cal.profiles[0];
    const locked = !!prof.locked;
    el.innerHTML = '';

    // Header: profile picker + add/delete.
    const head = document.createElement('div'); head.className = 'calhead';
    const pl = document.createElement('label'); pl.className = 'callbl'; pl.textContent = 'Printer profile:';
    const sel = document.createElement('select'); sel.title = 'Choose which calibration to use for this label type';
    cal.profiles.forEach((p) => { const o = document.createElement('option'); o.value = p.id; o.textContent = p.name; if (p.id === prof.id) o.selected = true; sel.appendChild(o); });
    sel.onchange = () => { cal.activeId = sel.value; renderCal(name); };
    pl.appendChild(sel);
    const addB = document.createElement('button'); addB.type = 'button'; addB.className = 'btn tiny'; addB.textContent = 'Add';
    addB.title = 'Add a new named calibration profile (e.g. for a different printer)';
    addB.onclick = () => { const np = { id: calId(), name: calUniqueName(cal, 'Printer'), x: prof.x, y: prof.y }; cal.profiles.push(np); cal.activeId = np.id; renderCal(name); };
    const delB = document.createElement('button'); delB.type = 'button'; delB.className = 'btn tiny'; delB.textContent = 'Delete';
    delB.title = locked ? 'The Default Template profile cannot be deleted' : 'Delete this calibration profile';
    delB.disabled = locked;
    delB.onclick = () => { cal.profiles = cal.profiles.filter((p) => p.id !== prof.id); cal.activeId = 'default'; renderCal(name); };
    head.appendChild(pl); head.appendChild(addB); head.appendChild(delB);
    el.appendChild(head);

    // Editable name for user profiles (the locked default is not renamable).
    if (!locked) {
      const nameRow = document.createElement('div'); nameRow.className = 'calname-row';
      const nl = document.createElement('label'); nl.className = 'callbl'; nl.textContent = 'Name:';
      const ni = document.createElement('input'); ni.type = 'text'; ni.className = 'calname'; ni.value = prof.name; ni.title = 'Rename this profile';
      ni.onchange = () => { prof.name = ni.value.trim() || prof.name; renderCal(name); };
      nl.appendChild(ni); nameRow.appendChild(nl); el.appendChild(nameRow);
    }

    // Body: D-pad (up / left-reset-right / down) + readout + alignment test.
    // Nudging only updates the offset + readout in place (it does NOT rebuild the
    // pad) so a held-down button keeps firing.
    const body = document.createElement('div'); body.className = 'calbody';
    const read = document.createElement('div'); read.className = 'calread'; read.innerHTML = calReadout(prof);
    const refresh = () => { read.innerHTML = calReadout(prof); };

    const pad = document.createElement('div'); pad.className = 'dpad';
    // Press and hold to repeat, accelerating the longer it is held.
    const hold = (btn, stepFn) => {
      let timer = null, on = false;
      const stop = () => { on = false; if (timer) { clearTimeout(timer); timer = null; } };
      btn.addEventListener('pointerdown', (e) => {
        if (btn.disabled) return;
        e.preventDefault();
        try { btn.setPointerCapture(e.pointerId); } catch (_) {}
        on = true; stepFn(); let delay = 340;
        const tick = () => { if (!on) return; stepFn(); delay = Math.max(45, delay * 0.82); timer = setTimeout(tick, delay); };
        timer = setTimeout(tick, delay);
      });
      ['pointerup', 'pointercancel'].forEach((ev) => btn.addEventListener(ev, stop));
    };
    const mk = (cls, glyph, title, dx, dy) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.textContent = glyph; b.title = title;
      b.disabled = locked;
      hold(b, () => { prof.x = clampOffset(prof.x + dx); prof.y = clampOffset(prof.y + dy); refresh(); });
      return b;
    };
    pad.appendChild(mk('up', '▲', 'Move labels up 0.01 in (hold to repeat)', 0, -CAL_STEP));
    pad.appendChild(mk('left', '◀', 'Move labels left 0.01 in (hold to repeat)', -CAL_STEP, 0));
    const rb = document.createElement('button'); rb.type = 'button'; rb.className = 'reset'; rb.textContent = '⟳'; rb.title = 'Reset this profile to no shift';
    rb.disabled = locked; rb.onclick = () => { prof.x = 0; prof.y = 0; refresh(); };
    pad.appendChild(rb);
    pad.appendChild(mk('right', '▶', 'Move labels right 0.01 in (hold to repeat)', CAL_STEP, 0));
    pad.appendChild(mk('down', '▼', 'Move labels down 0.01 in (hold to repeat)', 0, CAL_STEP));
    body.appendChild(pad);

    const side = document.createElement('div'); side.className = 'calside';
    const test = document.createElement('button'); test.type = 'button'; test.className = 'btn tiny'; test.textContent = 'Print alignment test';
    test.title = 'Print empty label outlines with this calibration to check alignment on plain paper';
    test.onclick = () => printDoc(alignmentSheetHTML({ format: cfg.format, offset: activeCal(cal) }));
    side.appendChild(read); side.appendChild(test);
    body.appendChild(side);
    el.appendChild(body);

    const hint = document.createElement('div'); hint.className = 'calhint';
    hint.textContent = locked
      ? 'Default Template uses the official label specs (no shift). Add a profile to calibrate for a specific printer.'
      : 'Each click nudges 0.01 in. Print the alignment test, hold it against a blank label sheet, and adjust until the boxes line up.';
    el.appendChild(hint);
  }

  function updateDensityPreview() {
    const el = $('densityPreview'); if (!el) return;
    el.className = 'density-preview dens-' + (S().display.density || 'comfortable');
  }
  // Populate all dialog controls from the current draft.
  function refreshDialog() {
    $('colorField').value = S().colorScheme.field;
    $('legendTitle').value = S().legendTitle || '';
    $('speechTpl').value = S().speech.template || DEFAULT_SPEECH_TEMPLATE;
    $('sheetColorStyle').value = S().sheet.colorStyle;
    $('labelMakerColorStyle').value = S().labelMaker.colorStyle;
    $('truncateOn').checked = !!S().display.truncate;
    $('truncateLimit').value = S().display.limit;
    $('rowDensity').value = S().display.density || 'comfortable';
    $('showActions').checked = S().display.showActions !== false;
    updateDensityPreview();
    renderBands(); renderPicker('columns'); renderPicker('csv'); renderPicker('sheet'); renderPicker('labelMaker');
    renderCal('sheet'); renderCal('labelMaker');
  }
  function activateTab(name) {
    document.querySelectorAll('#settingsTabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('#settingsDlg .tabpanel').forEach((pnl) => { pnl.hidden = pnl.dataset.tab !== name; });
  }
  function openSettings() {
    draft = {};
    for (const k of DIALOG_KEYS) draft[k] = structuredClone(state.settings[k]);
    refreshDialog();
    activateTab('colors');
    $('settingsDlg').showModal();
  }
  function commitSettings() {
    const issues = validateBands(S().colorScheme.bands);
    if (issues.some((x) => x.severity === 'error')) { activateTab('colors'); renderBands(); $('bandMsg').scrollIntoView({ block: 'center' }); return; }
    draft.speech.rate = state.settings.speech.rate; // preserve live rate slider
    for (const k of DIALOG_KEYS) state.settings[k] = draft[k];
    draft = null;
    recolorAll(); save(); renderAll(); updateCalNotes();
    $('settingsDlg').close();
  }

  // Speak a preview using the current template and the most recent (or a sample) book.
  function previewSpeech() {
    const sample = state.books[0] || { title: 'The Hunger Games', author: 'Collins, Suzanne', atosBookLevel: 5.3, points: 15, colorLabel: 'Red' };
    const tpl = $('speechTpl').value.trim() || DEFAULT_SPEECH_TEMPLATE;
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(speechText(sample, tpl));
    u.rate = state.settings.speech.rate || 1;
    window.speechSynthesis.cancel(); window.speechSynthesis.speak(u);
  }

  function init() {
    load();
    syncTogglesFromState();
    renderAll();
    updateCalNotes();

    $('scanForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = $('isbn').value.trim();
      if (v) handleScan(v);
      if (state.settings.workflow.autoAdvance) { $('isbn').value = ''; $('isbn').focus(); }
      else { $('isbn').select(); }
    });

    document.querySelectorAll('#toggles [data-flag]').forEach((el) => {
      el.addEventListener('change', () => { state.settings.workflow[el.dataset.flag] = el.checked; save(); });
    });
    $('rate').addEventListener('input', (e) => { state.settings.speech.rate = Number(e.target.value); save(); });

    $('c_speak').onclick = () => { const b = state.books.find((x) => x.isbn === $('card').dataset.isbn); if (b) speak(b); };
    $('c_print').onclick = () => { const b = state.books.find((x) => x.isbn === $('card').dataset.isbn); if (b) printLabel(b); };

    // Export menu
    const csvFields = () => selectedFields(state.settings.csv);
    $('exp-csv-all').onclick = () => download('library-lookup-books-' + stamp() + '.csv', toCSV(displayedBooks(), csvFields()), 'text/csv');
    $('exp-csv-sel').onclick = () => download('library-lookup-books-selected-' + stamp() + '.csv', toCSV(getSelectedBooks(), csvFields()), 'text/csv');
    $('exp-copy-all').onclick = () => copyToClipboard(displayedBooks());
    $('exp-copy-sel').onclick = () => copyToClipboard(getSelectedBooks());
    $('exp-print-list').onclick = () => printCatalog(displayedBooks());
    $('exp-print-key').onclick = () => printLegend();
    $('saveBtn').onclick = () => download('library-lookup-session-' + stamp() + '.json', JSON.stringify({ settings: state.settings, books: state.books }, null, 2), 'application/json');
    let loadMode = 'replace';
    $('loadBtn').onclick = () => { loadMode = 'replace'; $('fileInput').click(); };
    $('mergeBtn').onclick = () => { loadMode = 'merge'; $('fileInput').click(); };
    $('fileInput').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const d = JSON.parse(await f.text());
        const incoming = Array.isArray(d.books) ? d.books.map(deriveBook) : [];
        if (loadMode === 'merge') {
          // Keep current settings; add incoming books, deduped by ISBN (incoming wins), recolored to current scheme.
          let added = 0;
          for (const bk of incoming) {
            const colored = { ...bk, ...colorFor(bk, state.settings.colorScheme) };
            const r = upsertBook(state.books, colored); state.books = r.books; if (r.wasNew) added++;
          }
          save(); renderAll();
          setStatus(`Merged ${incoming.length} book${incoming.length === 1 ? '' : 's'} (${added} new). Now ${state.books.length} total.`, 'ok');
        } else {
          if (d.settings) Object.assign(state.settings, d.settings);
          state.books = incoming;
          migrateSettings(); save(); syncTogglesFromState(); renderAll();
          setStatus('Loaded ' + state.books.length + ' books (replaced current session).', 'ok');
        }
      } catch (err) { setStatus('Could not load session: ' + err.message, 'err'); }
      e.target.value = '';
    };
    $('delSelBtn').onclick = () => {
      const n = selected.size; if (!n) return;
      if (confirm('Delete ' + n + ' selected book' + (n === 1 ? '' : 's') + ' from this session?')) {
        state.books = state.books.filter((b) => !selected.has(b.isbn)); selected.clear(); save(); renderAll();
      }
    };
    $('clearBtn').onclick = () => { if (confirm('Clear all scanned books from this session?')) { state.books = []; selected.clear(); save(); renderAll(); $('card').style.display = 'none'; } };

    $('kioskInfo').onclick = () => $('kioskDlg').showModal();
    $('kioskClose').onclick = () => $('kioskDlg').close();

    // Printing / alignment help (shared by the ⓘ in the print tabs and the menu item)
    const openPrintHelp = () => $('printHelpDlg').showModal();
    $('printHelpClose').onclick = () => $('printHelpDlg').close();
    $('pr-help').onclick = openPrintHelp;
    $('sheetHelpInfo').onclick = openPrintHelp;
    $('labelHelpInfo').onclick = openPrintHelp;

    $('bulkBtn').onclick = () => $('bulkDlg').showModal();
    $('bulkClose').onclick = () => $('bulkDlg').close();
    $('bulkStart').onclick = () => processBulk($('bulkText').value);
    $('bulkStop').onclick = () => { queueStop = true; $('qprog').textContent = 'Stopping…'; };

    // Print menu (Session) - all print/export paths follow the displayed order.
    $('pr-sheet-all').onclick = () => printWith('sheet', displayedBooks());
    $('pr-sheet-sel').onclick = () => printWith('sheet', getSelectedBooks());
    $('pr-label-all').onclick = () => printWith('labelMaker', displayedBooks());
    $('pr-label-sel').onclick = () => printWith('labelMaker', getSelectedBooks());
    $('resetSortBtn').onclick = resetSort;

    // Dropdown menu behavior (uses the shared positionMenu / closeAllMenus helpers).
    document.querySelectorAll('.menu').forEach((m) => {
      const btn = m.querySelector(':scope > button');
      const list = m.querySelector(':scope > .menu-list');
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const willOpen = list.hidden;
        closeAllMenus();
        if (willOpen) { list.hidden = false; positionMenu(btn, list); }
      });
      list.querySelectorAll('button').forEach((it) => it.addEventListener('click', () => { list.hidden = true; }));
    });
    document.addEventListener('click', () => closeAllMenus());
    window.addEventListener('resize', () => closeAllMenus());
    window.addEventListener('scroll', () => closeAllMenus(), true);
    mqSmall.addEventListener('change', () => renderAll()); // re-render when crossing the small-screen breakpoint

    $('settingsBtn').onclick = openSettings;
    document.querySelectorAll('#settingsTabs .tab').forEach((t) => { t.onclick = () => activateTab(t.dataset.tab); });
    $('settingsSave').onclick = commitSettings;
    $('settingsCancel').onclick = () => $('settingsDlg').close(); // 'close' handler discards draft
    $('settingsDlg').addEventListener('close', () => { draft = null; });
    $('colorField').onchange = (e) => { S().colorScheme.field = e.target.value; };
    $('legendTitle').onchange = (e) => { S().legendTitle = e.target.value; };
    $('speechTpl').onchange = (e) => { S().speech.template = e.target.value.trim() || null; };
    $('speechPreview').onclick = previewSpeech;
    $('sheetColorStyle').onchange = (e) => { S().sheet.colorStyle = e.target.value; };
    $('labelMakerColorStyle').onchange = (e) => { S().labelMaker.colorStyle = e.target.value; };
    $('truncateOn').onchange = (e) => { S().display.truncate = e.target.checked; };
    $('truncateLimit').onchange = (e) => { S().display.limit = Math.max(0, Number(e.target.value) || 0); };
    $('rowDensity').onchange = (e) => { S().display.density = e.target.value; updateDensityPreview(); };
    $('showActions').onchange = (e) => { S().display.showActions = e.target.checked; };
    $('addBand').onclick = () => { S().colorScheme.bands.push({ min: 0, max: 0, color: '#888888', label: 'New' }); renderBands(); };
    $('settingsReset').onclick = () => {
      draft.colorScheme = structuredClone(DEFAULT_COLOR_SCHEME);
      draft.sheet = DEFAULT_SHEET();
      draft.labelMaker = DEFAULT_LABELMAKER();
      draft.columns = normalizePicker(null, DEFAULT_COLUMN_KEYS);
      draft.csv = normalizePicker(null, DEFAULT_CSV_KEYS);
      draft.speech = { ...draft.speech, template: null };
      draft.display = { truncate: true, limit: 60, density: 'comfortable', showActions: true };
      draft.legendTitle = 'Accelerated Reading Colors';
      refreshDialog();
    };

    // keep the scanner target focused
    document.addEventListener('click', (e) => { if (!e.target.closest('button,input,textarea,a,dialog')) $('isbn').focus(); });
    if ('speechSynthesis' in window) window.speechSynthesis.getVoices();
  }
  const stamp = () => new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  const pad2 = (n) => String(n).padStart(2, '0');

  init();
}
