// Shared bits for every page: header + nav, league picker, market data,
// live price chips and outbound links (poe.ninja, PoEDB, ...).

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const store = {
  get(k, d) { try { const v = localStorage.getItem('bs:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('bs:' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};

const NAV = [
  ['index.html', 'Home'],
  ['cost.html', 'Build cost'],
  ['market.html', 'Market'],
  ['farming.html', 'Farming'],
  ['crafting.html', 'Crafting'],
  ['basics.html', 'Basics'],
];

// Render synchronously on import so page scripts can find #league / #freshness.
(function renderHeader() {
  const el = document.getElementById('site-header');
  if (!el) return;
  const here = location.pathname.split('/').pop() || 'index.html';
  el.className = 'top';
  el.innerHTML = `
    <div class="wrap top-row">
      <a class="logo" href="index.html">Build<span>Shop</span></a>
      <nav class="nav" aria-label="Sections">
        ${NAV.map(([href, label]) => `<a href="${href}"${href === here ? ' aria-current="page"' : ''}>${label}</a>`).join('')}
      </nav>
      <div class="top-controls">
        <label class="field-inline"><span class="sr-only">League</span><select id="league" aria-label="League"></select></label>
        <span id="freshness" class="muted small"></span>
      </div>
    </div>`;
})();

export const fetchJSON = async (url) => {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
};

// Fill the league picker; calls onChange(league) now and whenever it changes.
export async function initLeague(onChange) {
  const idx = await fetchJSON('data/leagues.json');
  const sel = document.getElementById('league');
  sel.innerHTML = idx.leagues.map((l) => `<option value="${esc(l.file)}">${esc(l.name)}</option>`).join('');
  const saved = store.get('league');
  if (saved && idx.leagues.some((l) => l.file === saved)) sel.value = saved;
  const current = () => idx.leagues.find((l) => l.file === sel.value);
  sel.addEventListener('change', () => { store.set('league', sel.value); onChange(current()); });
  await onChange(current());
  return current;
}

export function setFreshness(updated, divine) {
  const mins = Math.round((Date.now() - new Date(updated)) / 60000);
  const ago = mins < 90 ? `${mins} min ago` : mins < 2880 ? `${Math.round(mins / 60)} h ago` : `${Math.round(mins / 1440)} days ago`;
  const el = document.getElementById('freshness');
  if (el) el.textContent = `Prices ${ago}${divine ? ` · 1 div = ${Math.round(divine)}c` : ''}`;
}

// ------------------------------------------------------------------ market data

export const CATEGORIES = {
  Currency: { label: 'Currency', ninja: 'currency' },
  Fragment: { label: 'Fragments', ninja: 'fragments' },
  Essence: { label: 'Essences', ninja: 'essences' },
  Fossil: { label: 'Fossils', ninja: 'fossils' },
  Resonator: { label: 'Resonators', ninja: 'resonators' },
  Oil: { label: 'Oils', ninja: 'oils' },
  DeliriumOrb: { label: 'Delirium orbs', ninja: 'delirium-orbs' },
  Scarab: { label: 'Scarabs', ninja: 'scarabs' },
  Omen: { label: 'Omens', ninja: 'omens' },
  Tattoo: { label: 'Tattoos', ninja: 'tattoos' },
  Artifact: { label: 'Expedition', ninja: 'artifacts' },
  Catalyst: { label: 'Catalysts', ninja: 'catalysts' },
  DivinationCard: { label: 'Divination cards', ninja: 'divination-cards' },
};

export class Market {
  constructor(data, league) {
    this.league = league;
    this.updated = data.updated;
    this.categories = data.categories || {};
    this.byName = new Map();
    for (const [cat, rows] of Object.entries(this.categories)) {
      for (const [name, chaos, volume, change, icon] of rows) {
        this.byName.set(name.toLowerCase(), { name, chaos, volume, change, icon: iconUrl(icon), cat });
      }
    }
    this.divine = this.byName.get('divine orb')?.chaos || 0;
  }
  get(name) { return this.byName.get(name.toLowerCase()) || null; }
}

export async function loadMarket(league) {
  return new Market(await fetchJSON(`data/market/${league.file}`), league);
}

export const iconUrl = (p) => (!p ? '' : p.startsWith('http') ? p : 'https://web.poecdn.com' + p);

export function formatChaos(chaos, divine) {
  if (chaos == null || !isFinite(chaos)) return '—';
  if (divine && chaos >= divine * 0.9 && Math.abs(chaos - divine) > 0.01) {
    const v = chaos / divine;
    return `${v >= 100 ? Math.round(v).toLocaleString() : v >= 10 ? v.toFixed(1) : v.toFixed(2)} div`;
  }
  return `${chaos >= 10 ? Math.round(chaos) : chaos >= 1 ? +chaos.toFixed(1) : +chaos.toFixed(2)}c`;
}

export function formatChange(c) {
  if (c == null) return '';
  const cls = c > 0 ? 'up' : c < 0 ? 'down' : '';
  const v = Math.abs(c) >= 100 ? Math.round(c) : c.toFixed(1);
  return `<span class="chg ${cls}">${c > 0 ? '+' : ''}${v}%</span>`;
}

// ------------------------------------------------------------------ links

export const poedbUrl = (name) => 'https://poedb.tw/us/' + encodeURI(name.replace(/['’]/g, '').trim().replace(/\s+/g, '_'));
export const ninjaUrl = (league, cat) => `https://poe.ninja/poe1/economy/${league?.ninja || 'standard'}/${CATEGORIES[cat]?.ninja || cat}`;
export const ninjaBuildsUrl = (league) => `https://poe.ninja/poe1/builds/${league?.ninja || 'standard'}`;
export const tradeUrl = (league, q) => `https://www.pathofexile.com/trade/search/${encodeURIComponent(league?.name || 'Standard')}?q=${encodeURIComponent(JSON.stringify(q))}`;
export const EXT = {
  wealthy: 'https://wealthyexile.com/strategies/public',
  wealthyStash: 'https://wealthyexile.com/',
  craft: 'https://www.craftofexile.com/',
  poedb: 'https://poedb.tw/us/',
  filterblade: 'https://www.filterblade.xyz/',
  pob: 'https://pathofbuilding.community/',
};

// ------------------------------------------------------------------ hydration

// <span class="px" data-item="Divine Orb"></span>            -> live price chip
// <div class="px-table" data-cat="Oil" data-limit="8"></div>  -> top items of a category
// <div class="px-table" data-items="A|B|C"></div>             -> chosen items
// <a data-poedb="Delirium">..</a>                              -> PoEDB link
export function hydrate(root, market) {
  for (const a of root.querySelectorAll('a[data-poedb]')) {
    a.href = poedbUrl(a.dataset.poedb || a.textContent);
    a.target = '_blank';
    a.rel = 'noopener';
    if (!a.title) a.title = 'Open on PoEDB';
  }
  for (const a of root.querySelectorAll('a[data-ext]')) {
    a.href = EXT[a.dataset.ext] || a.href;
    a.target = '_blank';
    a.rel = 'noopener';
  }
  for (const a of root.querySelectorAll('a[data-ninja]')) {
    a.href = a.dataset.ninja === 'builds' ? ninjaBuildsUrl(market?.league) : ninjaUrl(market?.league, a.dataset.ninja);
    a.target = '_blank';
    a.rel = 'noopener';
  }
  if (!market) return;
  for (const el of root.querySelectorAll('.px[data-item]')) {
    const it = market.get(el.dataset.item);
    el.innerHTML = it
      ? `${it.icon ? `<img src="${esc(it.icon)}" alt="" onerror="this.remove()">` : ''}${esc(formatChaos(it.chaos, market.divine))}`
      : '';
    el.title = it ? `${it.name}: ${formatChaos(it.chaos, market.divine)} on poe.ninja (${market.league.name})` : '';
    el.hidden = !it;
  }
  for (const el of root.querySelectorAll('.px-table')) {
    let rows;
    if (el.dataset.items) rows = el.dataset.items.split('|').map((n) => market.get(n)).filter(Boolean);
    else rows = (market.categories[el.dataset.cat] || []).map((r) => market.get(r[0]));
    if (el.dataset.match) {
      const re = new RegExp(el.dataset.match, 'i');
      rows = rows.filter((r) => re.test(r.name));
    }
    rows = rows.slice(0, +(el.dataset.limit || 8));
    const cat = el.dataset.cat || rows[0]?.cat;
    el.innerHTML = rows.length
      ? `<table class="mini">${rows.map((r) => `<tr>
          <td>${r.icon ? `<img src="${esc(r.icon)}" alt="" loading="lazy">` : ''}<a href="${esc(poedbUrl(r.name))}" target="_blank" rel="noopener">${esc(r.name)}</a></td>
          <td class="num">${esc(formatChaos(r.chaos, market.divine))}</td>
          <td class="num">${formatChange(r.change)}</td></tr>`).join('')}</table>
        ${cat ? `<a class="more" href="market.html?cat=${esc(cat)}">All ${esc((CATEGORIES[cat]?.label || cat).toLowerCase())} →</a>` : ''}`
      : `<p class="muted small">No price data for this in ${esc(market.league.name)}.</p>`;
  }
}

// Guide pages: league picker + hydrate + table of contents.
export async function initGuide() {
  buildToc();
  try {
    await initLeague(async (league) => {
      const market = await loadMarket(league);
      setFreshness(market.updated, market.divine);
      hydrate(document, market);
    });
  } catch (e) {
    hydrate(document, null);
    console.error(e);
  }
}

function buildToc() {
  const toc = document.getElementById('toc');
  if (!toc) return;
  const hs = [...document.querySelectorAll('main h2[id]')];
  toc.innerHTML = `<div class="toc-title">On this page</div>` + hs.map((h) => `<a href="#${h.id}">${esc(h.dataset.short || h.textContent)}</a>`).join('');
  const links = [...toc.querySelectorAll('a')];
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      links.forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '#' + e.target.id));
    }
  }, { rootMargin: '-20% 0px -70% 0px' });
  hs.forEach((h) => io.observe(h));
}
