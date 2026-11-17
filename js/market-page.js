import {
  esc, store, fetchJSON, initLeague, loadMarket, setFreshness, CATEGORIES,
  formatChaos, formatChange, poedbUrl, ninjaUrl, iconUrl, tradeUrl,
} from './site.js';

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);

const state = {
  market: null,
  prices: null, // uniques + gems from data/prices
  cat: params.get('cat') || store.get('market-cat', 'Currency'),
  q: params.get('q') || '',
  all: params.has('q'),
  sort: { key: 'chaos', dir: -1 },
  limit: 150,
};

const EXTRA = {
  Unique: { label: 'Uniques', ninja: 'unique-armours' },
  Gem: { label: 'Gems', ninja: 'skill-gems' },
};

$('#q').value = state.q;
$('#all-cats').checked = state.all;

initLeague(async (league) => {
  const [market, prices] = await Promise.all([loadMarket(league), fetchJSON(`data/prices/${league.file}`)]);
  state.market = market;
  state.prices = prices;
  setFreshness(market.updated, market.divine);
  render();
}).catch((e) => ($('#table').innerHTML = `<p class="error">Could not load market data: ${esc(e.message)}</p>`));

$('#q').addEventListener('input', (e) => { state.q = e.target.value; state.limit = 150; renderTable(); });
$('#all-cats').addEventListener('change', (e) => { state.all = e.target.checked; renderTable(); });
$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-cat]');
  if (!b) return;
  state.cat = b.dataset.cat;
  state.limit = 150;
  store.set('market-cat', state.cat);
  render();
});
$('#table').addEventListener('click', (e) => {
  const th = e.target.closest('th[data-sort]');
  if (th) {
    const k = th.dataset.sort;
    state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : k === 'name' ? 1 : -1 };
    return renderTable();
  }
  if (e.target.closest('#more')) { state.limit += 300; renderTable(); }
});

function cats() {
  const m = state.market.categories;
  return [...Object.keys(CATEGORIES).filter((c) => m[c]?.length), 'Unique', 'Gem'];
}

function rowsFor(cat) {
  if (cat === 'Unique') {
    return state.prices.uniques.map(([name, base, variant, links, chaos, listings, icon]) => ({
      name, sub: [base, variant, links ? `${links}L` : ''].filter(Boolean).join(' · '), chaos, volume: null, listings, change: null,
      icon: iconUrl(icon), cat, trade: { query: { status: { option: 'online' }, name, type: base || undefined }, sort: { price: 'asc' } },
    }));
  }
  if (cat === 'Gem') {
    return state.prices.gems.map(([name, level, quality, corrupted, chaos, listings]) => ({
      name, sub: `Level ${level}${quality ? ` · ${quality}%` : ''}${corrupted ? ' · corrupted' : ''}`, chaos, volume: null, listings, change: null, icon: '', cat,
    }));
  }
  return (state.market.categories[cat] || []).map(([name, chaos, volume, change, icon]) => ({ name, sub: '', chaos, volume, change, icon: iconUrl(icon), cat }));
}

function render() {
  const list = cats();
  if (!list.includes(state.cat)) state.cat = list[0];
  $('#tabs').innerHTML = list.map((c) => {
    const label = (CATEGORIES[c] || EXTRA[c]).label;
    return `<button role="tab" class="tab" data-cat="${c}" aria-selected="${c === state.cat}">${esc(label)}</button>`;
  }).join('');
  renderTable();
}

function renderTable() {
  if (!state.market) return;
  const q = state.q.trim().toLowerCase();
  let rows = q && state.all ? cats().flatMap(rowsFor) : rowsFor(state.cat);
  if (q) rows = rows.filter((r) => r.name.toLowerCase().includes(q) || r.sub.toLowerCase().includes(q));
  const { key, dir } = state.sort;
  rows.sort((a, b) => {
    const x = a[key] ?? -Infinity, y = b[key] ?? -Infinity;
    return (typeof x === 'string' ? x.localeCompare(y) : x - y) * dir;
  });
  const total = rows.length;
  rows = rows.slice(0, state.limit);
  const div = state.market.divine;
  const league = state.market.league;
  const showVol = rows.some((r) => r.volume != null);
  const showListings = rows.some((r) => r.listings != null);
  const arrow = (k) => (state.sort.key === k ? (state.sort.dir > 0 ? ' ↑' : ' ↓') : '');
  const head = `<tr>
      <th data-sort="name">Item${arrow('name')}</th>
      ${q && state.all ? '<th>Category</th>' : ''}
      <th data-sort="chaos" class="num">Price${arrow('chaos')}</th>
      <th data-sort="change" class="num">7 days${arrow('change')}</th>
      ${showVol ? `<th data-sort="volume" class="num hide-sm">Volume${arrow('volume')}</th>` : ''}
      ${showListings ? `<th data-sort="listings" class="num hide-sm">Listed${arrow('listings')}</th>` : ''}
      <th class="num"><span class="sr-only">Links</span></th></tr>`;
  const thin = (r) => (r.listings != null && r.listings < 3) || (r.volume != null && r.volume < 20);
  const body = rows.map((r) => `<tr class="${thin(r) ? 'thin' : ''}">
      <td class="item">${r.icon ? `<img src="${esc(r.icon)}" alt="" loading="lazy">` : '<span class="noicon"></span>'}
        <span><a href="${esc(poedbUrl(r.name))}" target="_blank" rel="noopener">${esc(r.name)}</a>${thin(r) ? ' <span class="badge warn" title="Very little trading — this price may be wrong">few listed</span>' : ''}${r.sub ? `<span class="sub">${esc(r.sub)}</span>` : ''}</span></td>
      ${q && state.all ? `<td class="muted small">${esc((CATEGORIES[r.cat] || EXTRA[r.cat]).label)}</td>` : ''}
      <td class="num strong">${esc(formatChaos(r.chaos, div))}${div && r.chaos >= div * 0.9 ? `<span class="sub">${Math.round(r.chaos).toLocaleString()}c</span>` : ''}</td>
      <td class="num">${formatChange(r.change)}</td>
      ${showVol ? `<td class="num hide-sm muted">${r.volume != null ? esc(formatChaos(r.volume, div)) : ''}</td>` : ''}
      ${showListings ? `<td class="num hide-sm muted">${r.listings ?? ''}</td>` : ''}
      <td class="num links">
        ${r.trade ? `<a href="${esc(tradeUrl(league, r.trade))}" target="_blank" rel="noopener" title="Search on the trade site">trade</a>` : ''}
        <a href="${esc(ninjaUrl(league, (CATEGORIES[r.cat] ? r.cat : EXTRA[r.cat].ninja)))}" target="_blank" rel="noopener" title="Open category on poe.ninja">ninja ↗</a></td>
    </tr>`).join('');
  $('#table').innerHTML = total
    ? `<table class="big"><thead>${head}</thead><tbody>${body}</tbody></table>
       ${total > rows.length ? `<button class="btn" id="more">Show more (${total - rows.length} left)</button>` : ''}`
    : `<p class="muted">Nothing matches “${esc(state.q)}”${state.all ? '' : ' in this category. Tick “Search all categories” to look everywhere'}.</p>`;
}
