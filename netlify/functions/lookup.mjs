// Netlify Function (v2): GET /api/lookup?isbn=...  ->  Book JSON.
// A fresh Teacher session is established per invocation. (A later optimization
// can cache the session cookie across invocations to cut latency.)

import { lookupIsbn, normalizeIsbn } from '../../src/scraper.mjs';
import { colorFor, DEFAULT_COLOR_SCHEME } from '../../src/colors.mjs';

export default async (req) => {
  const url = new URL(req.url);
  const raw = url.searchParams.get('isbn') || '';
  const isbn = normalizeIsbn(raw);

  const json = (obj, status = 200) =>
    new Response(JSON.stringify(obj), {
      status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });

  if (!isbn) return json({ error: 'Provide ?isbn=' }, 400);

  try {
    const book = await lookupIsbn(isbn);
    if (book.notFound) return json({ isbn, notFound: true }, 404);
    const c = colorFor(book, DEFAULT_COLOR_SCHEME);
    return json({ ...book, ...c });
  } catch (e) {
    return json({ isbn, error: String(e?.message || e) }, 502);
  }
};

export const config = { path: '/api/lookup' };
