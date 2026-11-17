import { esc, initLeague, loadMarket, setFreshness, hydrate, formatChaos, formatChange, poedbUrl } from './site.js';

const $ = (s) => document.querySelector(s);
const GUIDES = [['farming.html', 'Farming'], ['crafting.html', 'Crafting'], ['basics.html', 'Basics']];

let market = null;
let topics = [];

initLeague(async (league) => {
  market = await loadMarket(league);
  setFreshness(market.updated, market.divine);
  hydrate(document, market);
  renderMovers();
}).catch((e) => console.error(e));

// Index guide sections by reading the guide pages themselves.
(async () => {
  for (const [page, label] of GUIDES) {
    try {
      const html = await (await fetch(page)).text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      for (const h of doc.querySelectorAll('main h2[id]')) {
        let text = '';
        for (let n = h.nextElementSibling; n && n.tagName !== 'H2'; n = n.nextElementSibling) text += ' ' + n.textContent;
        topics.push({ title: h.textContent.trim(), url: `${page}#${h.id}`, where: label, text: text.toLowerCase() });
      }
    } catch { /* offline: search still finds items */ }
  }
})();

function renderMovers() {
  const all = [...market.byName.values()].filter((r) => r.change != null && r.volume >= 500 && r.chaos >= 2);
  const row = (r) => `<tr><td>${r.icon ? `<img src="${esc(r.icon)}" alt="" loading="lazy">` : ''}<a href="${esc(poedbUrl(r.name))}" target="_blank" rel="noopener">${esc(r.name)}</a></td>
    <td class="num">${esc(formatChaos(r.chaos, market.divine))}</td><td class="num">${formatChange(r.change)}</td></tr>`;
  const table = (rows) => rows.length ? `<table class="mini">${rows.map(row).join('')}</table>` : '<p class="muted small">Not enough trading data yet.</p>';
  $('#risers').innerHTML = table(all.filter((r) => r.change > 0).sort((a, b) => b.change - a.change).slice(0, 6));
  $('#fallers').innerHTML = table(all.filter((r) => r.change < 0).sort((a, b) => a.change - b.change).slice(0, 6));
}

// ------------------------------------------------------------------ search

const input = $('#search');
const box = $('#results');
let hits = [];
let sel = -1;

input.addEventListener('input', search);
input.addEventListener('focus', search);
input.addEventListener('keydown', (e) => {
  if (box.hidden) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length;
    paint();
  } else if (e.key === 'Enter' && hits.length) {
    e.preventDefault();
    location.href = hits[Math.max(sel, 0)].url;
  } else if (e.key === 'Escape') {
    box.hidden = true;
  }
});
document.addEventListener('click', (e) => { if (!e.target.closest('.search-wrap')) box.hidden = true; });

function search() {
  const q = input.value.trim().toLowerCase();
  if (q.length < 2) { box.hidden = true; return; }
  const words = q.split(/\s+/);
  const scored = [];
  for (const t of topics) {
    const title = t.title.toLowerCase();
    let s = 0;
    for (const w of words) {
      if (title.includes(w)) s += 10;
      else if (t.text.includes(w)) s += 3;
      else { s = 0; break; }
    }
    if (s) scored.push({ s: s + 5, label: t.title, where: t.where, url: t.url });
  }
  if (market) {
    for (const r of market.byName.values()) {
      const n = r.name.toLowerCase();
      if (!words.every((w) => n.includes(w))) continue;
      const s = (n.startsWith(q) ? 8 : 4) + Math.min(r.volume / 1e5, 2);
      scored.push({ s, label: r.name, where: formatChaos(r.chaos, market.divine), url: `market.html?q=${encodeURIComponent(r.name)}`, icon: r.icon });
    }
  }
  hits = scored.sort((a, b) => b.s - a.s).slice(0, 8);
  hits.push({ label: `Search the market for “${input.value.trim()}”`, where: 'Market', url: `market.html?q=${encodeURIComponent(input.value.trim())}` });
  sel = -1;
  paint();
}

function paint() {
  box.innerHTML = hits.map((h, i) => `<a href="${esc(h.url)}" class="${i === sel ? 'on' : ''}"><span>${esc(h.label)}</span><span class="where">${esc(h.where)}</span></a>`).join('');
  box.hidden = false;
}
