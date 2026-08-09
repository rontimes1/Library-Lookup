# Library Lookup

Scan or type an ISBN, look it up on [arbookfind.com](https://www.arbookfind.com), and build a color-coded, reading-level catalog of your library. Print spine labels on Avery 5160 sheets or a single-label maker, read results aloud, and export or back up your session. Built for a classroom or school library where a teacher catalogs books quickly with a barcode scanner.

**Live app:** https://library-lookup.netlify.app

## Features

- **Scan or type ISBNs.** Works with a USB/Bluetooth barcode scanner (which types the number and presses Enter) or manual entry. Handles the extra price/supplement digits some scanners append, and validates the ISBN check digit before looking anything up.
- **Automatic AR data.** Pulls title, author, ATOS book level, AR points, interest level, quiz number, fiction/nonfiction, series, and more.
- **Color coding by reading level.** Each book gets a color band based on its ATOS level. The bands and colors are fully configurable.
- **Session table.** Sortable, resizable columns; inline editing; adjustable row density; per-row and bulk actions; select rows for targeted printing or export.
- **Printing.** 3-across Avery 5160 label sheets and single labels for a label maker, each with its own field layout and color-mark style. Includes per-printer calibration profiles (nudge the layout to match your printer) and an alignment test page.
- **Read aloud.** Optional text-to-speech announces each result, with a configurable spoken template.
- **Bulk add.** Paste a list of ISBNs and process them one at a time.
- **Save, load, merge, export.** Sessions persist in the browser and can be saved to a JSON file, reloaded, merged, or exported to CSV / clipboard.

## How it works

Library Lookup is a static front end plus one serverless function.

- **Front end** (`public/`): a single-page vanilla-JavaScript app. `app.js` holds pure, testable helpers (color mapping, ISBN cleaning, CSV/label/legend generation, calibration math, sorting) plus the DOM wiring. Books are stored in the browser via `localStorage`.
- **Serverless proxy** (`netlify/functions/lookup.mjs`): the browser cannot call arbookfind.com directly (cross-origin), so a small Netlify Function fetches the lookup server-side and returns clean JSON. It performs the site's persona handshake, submits the ISBN, and parses the book detail page with `cheerio`.
- **Shared logic** (`src/`): `scraper.mjs` (fetch + parse) and `colors.mjs` (color bands) are used by the function.

## Tech stack

Vanilla JavaScript (ES modules), HTML, and CSS on the front end. Node.js Netlify Function with `cheerio` for parsing. No front-end framework and no build step for the client. Deployed on Netlify.

## Project structure

```
.
├── public/                 # static front end (deployed as-is)
│   ├── index.html
│   ├── app.js
│   └── favicon.png
├── src/                    # shared server-side logic
│   ├── scraper.mjs
│   └── colors.mjs
├── netlify/
│   └── functions/
│       └── lookup.mjs      # GET /api/lookup?isbn=...
├── scripts/
│   └── test-local.mjs      # local smoke test
├── netlify.toml            # Netlify build/dev config
├── package.json
├── LICENSE
└── README.md
```

## Local development

Requires Node.js 20.18.1 or newer.

```bash
npm install
npm run dev        # starts Netlify dev (front end + function) on localhost
```

Then open the printed local URL in your browser. To run the local smoke test:

```bash
npm run test:local
```

## Deployment (Netlify)

The app is configured by `netlify.toml` (publish directory `public`, functions in `netlify/functions`, Node 22). To deploy from the command line:

```bash
npx netlify-cli deploy --build --prod
```

You can also connect this repository to Netlify for automatic deploys on push.

## Printing and alignment

Labels print best at **100% / Actual size** with browser margins set to **Default**. If your printer lands labels slightly off, open **Settings**, pick the **Sheet labels** or **Label maker** tab, and use the calibration pad to nudge the layout in 0.01 inch steps. Print the alignment test to check the fit on plain paper before using label stock. See the in-app **Printing help** (the ⓘ button) for details.

## Data source and disclaimer

Book data comes from [arbookfind.com](https://www.arbookfind.com) (Renaissance Learning). This project is an independent tool and is **not affiliated with, endorsed by, or sponsored by Renaissance Learning**. Scanned ISBNs are sent to arbookfind.com only to look up book information; no other data is collected, and your catalog stays in your own browser. Please use the tool responsibly and in line with arbookfind.com's terms of use.

## License

Released under the **GNU General Public License v3.0 with the Commons Clause**. You are free to use, modify, and share the software under the terms of the GPLv3, but the Commons Clause condition means you may not Sell it (that is, you may not charge a fee for a product or service whose value derives substantially from this software, including paid hosting or support). See the [LICENSE](LICENSE) file for the full terms.
