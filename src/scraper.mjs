// Core arbookfind lookup - framework-agnostic.
// Proven flow (see ARCHITECTURE.md §15):
//   usertype.aspx (persona=Teacher) -> advanced.aspx (ISBN search) -> bookdetail.aspx -> parse.
//
// Uses global fetch (Node 18+/Netlify) with a manual cookie jar and manual
// redirect handling so the ASP.NET session + persona cookie survive every hop.

import * as cheerio from 'cheerio';

const BASE = 'https://www.arbookfind.com';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// ---- tiny cookie jar -------------------------------------------------------
class Jar {
  constructor() { this.c = new Map(); }
  set(name, value) { this.c.set(name, value); }
  store(res) {
    const set = res.headers.getSetCookie?.() ?? [];
    for (const line of set) {
      const [pair] = line.split(';');
      const i = pair.indexOf('=');
      if (i > 0) this.c.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  }
  header() { return [...this.c.entries()].map(([k, v]) => `${k}=${v}`).join('; '); }
}

const HOP_TIMEOUT_MS = 7000; // fail a single request cleanly well before Netlify's function cap

// Fetch with cookies + manual redirect following (max 6 hops).
async function hop(jar, url, { method = 'GET', body } = {}) {
  let current = new URL(url, BASE).href;
  for (let i = 0; i < 6; i++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), HOP_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(current, {
        method,
        redirect: 'manual',
        signal: ctl.signal,
        headers: {
          'User-Agent': UA,
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
          ...(jar.header() ? { Cookie: jar.header() } : {}),
          ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        },
        body,
      });
    } catch (e) {
      throw new Error(e?.name === 'AbortError' ? 'Upstream timeout' : 'Upstream request failed');
    } finally {
      clearTimeout(timer);
    }
    jar.store(res);
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location'), current).href;
      method = 'GET'; body = undefined;       // redirects become GETs
      continue;
    }
    const html = await res.text();
    return { status: res.status, url: current, html };
  }
  throw new Error('Too many redirects');
}

// Serialize every hidden input in a form, then apply overrides.
function formBody($, formSel, overrides) {
  const params = new URLSearchParams();
  $(`${formSel} input[type=hidden]`).each((_, el) => {
    const n = $(el).attr('name');
    if (n) params.set(n, $(el).attr('value') ?? '');
  });
  for (const [k, v] of Object.entries(overrides)) params.set(k, v);
  return params.toString();
}

const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
const num = (s) => { const m = clean(s).match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : null; };

// Detail element ids (confirmed live, Aug 2026). Prefix added below.
const P = 'ctl00_ContentPlaceHolder1_ucBookDetail_';
const FIELDS = {
  title: 'lblBookTitle', author: 'lblAuthor', quizNumber: 'lblQuizNumber',
  language: 'lblLanguageCode', quizAvailability: 'lblQuizStatusLabel',
  atosBookLevel: 'lblBookLevel', interestLevel: 'lblInterestLevel',
  points: 'lblPoints', wordCount: 'lblWordCount',
  fictionNonfiction: 'lblFictionNonFiction', series: 'lblSeriesLabel',
  summary: 'lblBookSummary', topics: 'lblTopicLabel',
};

function parseDetail($, isbn, detailUrl) {
  const val = (id) => clean($('#' + P + id).text());
  const b = {};
  for (const [key, id] of Object.entries(FIELDS)) b[key] = val(id);
  return {
    isbn,
    title: b.title, author: b.author,
    atosBookLevel: num(b.atosBookLevel),
    interestLevel: b.interestLevel,
    points: num(b.points),
    arQuizNumber: b.quizNumber,
    quizAvailability: b.quizAvailability,
    wordCount: num(b.wordCount),
    fictionNonfiction: b.fictionNonfiction,
    series: b.series.replace(/;\s*$/, ''),
    topics: b.topics ? b.topics.split(/;\s*/).map(clean).filter(Boolean) : [],
    language: b.language,
    summary: b.summary,
    coverUrl: `https://coverscans.renlearn.com/${isbn}.jpg`,
    detailUrl,
    source: 'arbookfind',
    scannedAt: new Date().toISOString(),
  };
}

export function normalizeIsbn(raw) {
  const s = String(raw).replace(/[^0-9Xx]/g, '').toUpperCase();
  // Strip a trailing Bookland price/supplement add-on (978/979 + 10 + 5-or-2 digits).
  const m = s.match(/^(97[89]\d{10})(?:\d{5}|\d{2})$/);
  return m ? m[1] : s;
}

// Main entry. Returns a Book object, or { isbn, notFound: true }.
// Pass a shared `jar` to reuse the Teacher session across many lookups.
export async function lookupIsbn(rawIsbn, jar = new Jar(), opts = {}) {
  const isbn = normalizeIsbn(rawIsbn);
  if (!isbn) throw new Error('Empty/invalid ISBN');

  // 1) Persona. Fast path: the persona is just a `BFUserType=Teacher` cookie,
  //    so seed it and skip the usertype.aspx handshake. If the advanced-search
  //    page doesn't come back (cookie alone wasn't enough), fall back to the
  //    full handshake POST once, then retry.
  if (!opts.personaSeeded) {
    jar.set('BFUserType', 'Teacher');
    jar.set('BFLexile', 'False');
    opts.personaSeeded = true;
  }
  let adv = await hop(jar, '/advanced.aspx');
  let $adv = cheerio.load(adv.html);
  if (!$adv('#ctl00_ContentPlaceHolder1_txtISBN').length) {
    const ut = await hop(jar, '/usertype.aspx');
    const $ut = cheerio.load(ut.html);
    const submit = $ut('input[type=submit]').first();
    const overrides = { radUserType: 'radTeacher' };
    const sn = submit.attr('name');
    if (sn) overrides[sn] = submit.attr('value') ?? 'Submit';
    else overrides['btnSubmitUserType'] = 'Submit';
    await hop(jar, '/usertype.aspx', { method: 'POST', body: formBody($ut, 'form', overrides) });
    adv = await hop(jar, '/advanced.aspx');
    $adv = cheerio.load(adv.html);
  }

  // 2) Advanced search by ISBN.
  const searchBtn = $adv('#ctl00_ContentPlaceHolder1_btnDoIt');
  const results = await hop(jar, '/advanced.aspx', {
    method: 'POST',
    body: formBody($adv, 'form', {
      'ctl00$ContentPlaceHolder1$txtISBN': isbn,
      'ctl00$ContentPlaceHolder1$btnDoIt': searchBtn.attr('value') || 'Search',
    }),
  });

  // 3) Find the detail link on the results page.
  const $res = cheerio.load(results.html);
  let href = null;
  $res('a[href*="bookdetail.aspx"]').each((_, el) => {
    if (!href) href = $res(el).attr('href');
  });
  if (!href) return { isbn, notFound: true, source: 'arbookfind' };

  // 4) Detail page -> parse.
  const detail = await hop(jar, href);
  const $d = cheerio.load(detail.html);
  return parseDetail($d, isbn, detail.url);
}

export { Jar };
