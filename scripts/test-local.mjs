// Validate the scraper from THIS machine (your residential IP), no browser.
// Usage:  node scripts/test-local.mjs 978-0-439-02352-8 [more ISBNs...]
//
// This is the fast feasibility check for the lightweight-HTTP path: if it prints
// the right book here, the same code should run as the Netlify Function.

import { lookupIsbn, Jar } from '../src/scraper.mjs';
import { colorFor } from '../src/colors.mjs';

const isbns = process.argv.slice(2);
if (!isbns.length) isbns.push('978-0-439-02352-8'); // The Hunger Games

const jar = new Jar();
const opts = {}; // reused so the Teacher persona handshake happens only once
for (const isbn of isbns) {
  const t = Date.now();
  try {
    const book = await lookupIsbn(isbn, jar, opts);
    const withColor = book.notFound ? book : { ...book, ...colorFor(book) };
    console.log(`\n[${isbn}]  (${Date.now() - t} ms)`);
    console.log(JSON.stringify(withColor, null, 2));
  } catch (e) {
    console.error(`\n[${isbn}]  ERROR after ${Date.now() - t} ms:`, e.message);
  }
}
