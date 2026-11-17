# BuildShop

A Path of Exile toolkit in one site. Plain HTML, CSS and JavaScript, with no libraries and no build step. It's hosted on GitHub Pages.

| Page | What it is |
| --- | --- |
| `index.html` | Home: search across every guide section and priced item, market pulse (risers/fallers), links to community tools |
| `cost.html` | Build cost: paste a PoB code, get the price and trade searches (details below) |
| `market.html` | Live poe.ninja prices for every category plus uniques and gems, with search and sorting |
| `farming.html` | Farming guide: each mechanic, what it drops, live value of the loot, links to Wealthy Exile strategies |
| `crafting.html` | Crafting guide: what each orb does (live prices), methods, craft-or-buy, links to Craft of Exile |
| `basics.html` | Basics: defences, items, currency, trading, campaign, atlas, with PoEDB links |

The guides are written for this site. Wealthy Exile, PoEDB and Craft of Exile have no public API, so the
site links to them instead of copying their content. Guide pages can use these hooks (see `js/site.js`):

- `<span class="px" data-item="Divine Orb"></span>`: live price chip
- `<div class="px-table" data-cat="Oil" data-limit="8"></div>`: top items of a category (`data-match="regex"` filters by name, `data-items="A|B"` picks items)
- `<a data-poedb="Delirium">`, `<a data-ninja="Oil">`, `<a data-ext="craft">`: outbound links

## Build cost

- Decodes the PoB code in the browser and reads the active item set, tree jewels, flasks and gems.
- Prices uniques and gems from a [poe.ninja](https://poe.ninja) snapshot.
- Builds a trade-site search link for every item. For rares you tick the mods you need,
  untick the ones you already cover elsewhere, and adjust minimum values. Life, resistances
  and attributes are folded into the trade site's *total* (pseudo) stats.
- **Trade ↗** opens the search in a new browser tab. **Copy** copies the link.
- PoB **loadouts** are supported: when a build has several (e.g. "LvL 81 - 4th Lab", "LvL 100 Min-Max"),
  a picker under each code box selects which tree, item set and skill set to price.
- Rares have no reliable automatic price. Check them on trade and type in **My price** if you want them in the total.

## How the data works

poe.ninja and the official trade API don't allow requests from other websites (no CORS),
so the page can't call them directly. Instead a GitHub Action
([`.github/workflows/update-prices.yml`](.github/workflows/update-prices.yml)) runs
[`scripts/fetch-data.mjs`](scripts/fetch-data.mjs) every 4 hours and commits fresh JSON into `data/`:

- `data/leagues.json`: leagues with economy data
- `data/prices/<league>.json`: currency, unique and gem prices
- `data/market/<league>.json`: bulk items (currency, fragments, essences, oils, fossils, omens, cards…) with 7-day change and volume
- `data/stats.json`: trade-site stat ids, used to turn mod text into search filters

## Run locally

```bash
node scripts/fetch-data.mjs
python -m http.server 8765
```

Then open http://localhost:8765. ES modules need a server, so opening `index.html` as a file won't work.

## Deploy to GitHub Pages

1. Push this folder to a GitHub repository.
2. **Settings → Pages**: deploy from branch `main`, folder `/ (root)`.
3. **Settings → Actions → General → Workflow permissions**: *Read and write*, so the price job can commit.
4. Run **Update market data** once from the Actions tab (or wait for the schedule).

## Limits

- Path of Exile 1 only. PoE 2 builds are detected and rejected.
- pobb.in / pastebin links can't be fetched from the browser, so paste the code itself.
- Trade links for transfigured gems may need the gem picked by hand on the trade site.
