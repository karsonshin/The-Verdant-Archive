import { $, $$, h, esc, md, plain, fmtDur, debounce, mediaUrl, wall } from './util.js';
import { createLightbox } from './lightbox.js';
import * as social from './social.js';
import { createOrb } from './orb.js';

let CFG, DB, ALL = [], BY_ID = new Map(), ALBUMS = new Map();
const app = $('#app');
const cur = { base: null, list: [] };
const lbCtx = { cfg: null, list: [], albumName: (id) => ALBUMS.get(id)?.name, navigate: (id) => nav(withV(cur.base, id), { replace: true, lb: !!history.state?.lb }), close(skip) { if (skip) return; history.state?.lb ? history.back() : nav(cur.base, { replace: true }); } };
let lightbox;

const monthName = (m, style = 'long') => new Date(Date.UTC(2000, m - 1, 1)).toLocaleString(undefined, { month: style, timeZone: 'UTC' });
const countLabel = (n, one, many = one + 's') => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const withV = (base, id) => `${base}${base.includes('?') ? '&' : '?'}v=${id}`;
const link = (path, params = {}) => {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null));
  return `#/${path}${q.size ? '?' + q : ''}`;
};

// ---------------------------------------------------------------- data
const camName = ({ make, model } = {}) => (model ? (make && !model.toLowerCase().startsWith(make.toLowerCase().split(' ')[0]) ? `${make} ${model}` : model) : null);

function prep(it) {
  const d = wall(it.taken?.local || it.added);
  it.t = d.getTime(); it.year = d.getUTCFullYear(); it.month = d.getUTCMonth() + 1;
  it.placeKey = it.place?.text || (it.gps ? `Unnamed place (${it.gps.lat.toFixed(2)}, ${it.gps.lon.toFixed(2)})` : null);
  it.cam = camName(it.camera);
  const dates = it.taken?.local ? [it.taken.local.slice(0, 10), d.toLocaleDateString('en', { timeZone: 'UTC', dateStyle: 'long' }), d.toLocaleDateString('en', { timeZone: 'UTC', month: 'long', year: 'numeric' }), d.toLocaleDateString('en', { timeZone: 'UTC', month: 'short', year: 'numeric' }), String(it.year)] : [];
  it.hay = [it.file, it.title, it.caption, ...(it.tags || []), it.placeKey, it.place?.country, it.category, it.cam, ...(it.albums || []).map((a) => ALBUMS.get(a)?.name), ...dates].filter(Boolean).join(' \n').toLowerCase();
  return it;
}

const SORTS = {
  newest: (a, b) => b.t - a.t,
  oldest: (a, b) => a.t - b.t,
  name: (a, b) => a.file.localeCompare(b.file, undefined, { numeric: true })
};

/** An album's own items plus those of its (one-level) sub-albums. */
const albumIds = (id) => new Set([id, ...DB.albums.filter((a) => a.parent === id).map((a) => a.id)]);

function filterItems(p) {
  const ids = p.album ? albumIds(p.album) : null;
  const terms = (p.q || '').toLowerCase().split(/\s+/).filter(Boolean);
  return ALL.filter((i) =>
    (!p.cat || i.category === p.cat) && (!p.tag || i.tags?.includes(p.tag)) && (!ids || i.albums?.some((a) => ids.has(a))) &&
    (!p.year || i.year === +p.year) && (!p.month || i.month === +p.month) && (!p.place || i.placeKey === p.place || i.place?.country === p.place) &&
    (!p.camera || i.cam === p.camera) && terms.every((t) => i.hay.includes(t))
  ).sort(SORTS[p.sort] || SORTS.newest);
}

// ---------------------------------------------------------------- grid
const HOVER = matchMedia('(hover: hover) and (pointer: fine)');
const natW = (it, k) => Math.round(it.w * Math.min(1, (CFG.derivatives[k]?.size ?? 2560) / Math.max(it.w, it.h)));
// The grid accepts ~35% upscaling softness so retina screens don't always pull the 1600 px file for a 300 px tile.
const GRID_SOFTNESS = 0.65;

function justify(items, W, target, gap) {
  const rows = [];
  let row = [], sum = 0;
  const flush = (last) => {
    if (!row.length) return;
    let hgt = (W - gap * (row.length - 1)) / sum;
    if (last && hgt > target * 1.3) hgt = target; // don't blow up a short last row
    rows.push({ items: row, h: Math.floor(hgt), ws: row.map((i) => Math.floor((i.w / i.h) * hgt)) });
    row = []; sum = 0;
  };
  for (const it of items) {
    row.push(it); sum += it.w / it.h;
    if (sum * target + gap * (row.length - 1) >= W) flush(false);
  }
  flush(true);
  return rows;
}

function tile(it, w, hgt, base, eager) {
  const img = h('img', { alt: it.caption || it.title || (it.place?.text ? `Photo, ${it.place.text}` : it.file), width: w, height: hgt, decoding: 'async', draggable: 'false' });
  if (!eager) img.loading = 'lazy';
  const keys = ['thumb', 'medium', 'large'].filter((k) => it.files?.includes(`${k}.webp`) && (it.type === 'photo' || k !== 'large'));
  const touchVideo = it.type === 'video' && !HOVER.matches && it.files.includes('preview.webp');
  if (touchVideo) img.src = mediaUrl(it, 'preview.webp');
  else {
    img.src = mediaUrl(it, 'thumb.webp');
    img.srcset = keys.map((k) => `${mediaUrl(it, k + '.webp')} ${natW(it, k)}w`).join(', ');
    img.sizes = `${Math.round(w * GRID_SOFTNESS)}px`;
  }
  const a = h('a', { class: 'tile', role: 'listitem', href: withV(base, it.id), style: `width:${w}px;height:${hgt}px`, 'aria-label': it.title || it.caption || it.file }, img);
  a.addEventListener('contextmenu', (e) => e.preventDefault());
  a.addEventListener('click', (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); nav(a.getAttribute('href'), { lb: true }); });
  const cap = it.title || it.place?.city;
  if (cap && it.type !== 'video') a.append(h('span', { class: 'tile-cap' }, cap));
  if (it.type === 'video') {
    a.append(h('span', { class: 'badge', html: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>${it.duration ? fmtDur(it.duration) : 'Video'}` }));
    let vid;
    if (HOVER.matches) {
      a.addEventListener('pointerenter', () => {
        const src = it.files.includes('v720.mp4') ? 'v720.mp4' : 'v1080.mp4';
        vid = h('video', { muted: true, loop: true, playsinline: true, preload: 'auto', 'aria-hidden': 'true', class: 'hover-vid', src: mediaUrl(it, src) });
        vid.muted = true; a.append(vid); vid.play().catch(() => {});
      });
      a.addEventListener('pointerleave', () => { vid?.remove(); vid = null; });
    }
  }
  return a;
}

const grids = new Set();
function grid(items, base) {
  const el = h('div', { class: 'grid', role: 'list', 'aria-label': 'Photos and videos' });
  el._items = items; el._base = base; grids.add(el);
  return el;
}

/** (Re)lay out every grid in the page. Rows are built in chunks as the user scrolls. */
function layoutGrids() {
  for (const el of [...grids]) {
    if (!el.isConnected) { grids.delete(el); continue; }
    const W = el.clientWidth;
    if (!W || el._w === W) continue;
    el._w = W; el._io?.disconnect();
    const narrow = W < 600;
    const gap = narrow ? 4 : 8;
    el.style.setProperty('--gap', gap + 'px');
    const rows = justify(el._items, W, narrow ? 150 : W < 1000 ? 210 : 270, gap);
    el.replaceChildren();
    let next = 0;
    const more = () => {
      for (const r of rows.slice(next, next + 8)) {
        el.append(h('div', { class: 'row' }, r.items.map((it, i) => tile(it, r.ws[i], r.h, el._base, next < 2))));
        next++;
      }
      if (next < rows.length) { sentinel.style.display = ''; el._io.observe(sentinel); } else sentinel.remove();
    };
    const sentinel = h('div', { class: 'sentinel', 'aria-hidden': 'true' });
    el.after(sentinel);
    el._io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { el._io.disconnect(); more(); } }, { rootMargin: '1200px' });
    el._sentinel?.remove(); el._sentinel = sentinel;
    more();
  }
}
let lastW = innerWidth;
addEventListener('resize', debounce(() => { if (innerWidth !== lastW) { lastW = innerWidth; grids.forEach((g) => (g._w = 0)); layoutGrids(); } }, 150));

// ---------------------------------------------------------------- pages
const brandline = () => esc(CFG.tagline).replace(esc(CFG.owner), `<span class="by">${esc(CFG.owner)}</span>`);


function setList(list, base) { cur.list = list; lbCtx.list = list; cur.base = base; }
const empty = (msg = 'Nothing here yet.') => h('p', { class: 'empty' }, msg);
const pageHead = (title, sub) => h('header', { class: 'page-head' }, h('h1', { tabindex: '-1' }, title), sub ? h('p', { class: 'sub' }, sub) : null);

function albumCover(a) {
  const ids = albumIds(a.id);
  const items = ALL.filter((i) => i.albums?.some((x) => ids.has(x)));
  return { items, cover: BY_ID.get(a.cover) || items.sort(SORTS.newest)[0] };
}
function albumCard(a) {
  const { items, cover } = albumCover(a);
  return h('a', { class: 'card', href: `#/album/${a.id}` },
    h('div', { class: 'card-img' }, cover ? h('img', { src: mediaUrl(cover, 'thumb.webp'), srcset: `${mediaUrl(cover, 'thumb.webp')} ${natW(cover, 'thumb')}w, ${mediaUrl(cover, 'medium.webp')} ${natW(cover, 'medium')}w`, sizes: '(min-width: 900px) 380px, 90vw', alt: '', loading: 'lazy', draggable: 'false' }) : null),
    h('div', { class: 'card-body' }, h('h3', {}, a.name), h('p', { class: 'muted' }, countLabel(items.length, 'item'))));
}

/** Order for the ball: the owner's favorites, then fan-rated (4+ stars), then everything else newest first. */
function orbOrder() {
  const pool = ALL.filter((i) => i.type === 'photo' || i.featured);
  const rated = pool.filter((i) => (social.summary.get(i.id)?.avg || 0) >= 4)
    .sort((a, b) => social.summary.get(b.id).avg - social.summary.get(a.id).avg || social.summary.get(b.id).n - social.summary.get(a.id).n);
  const first = [...new Map([...pool.filter((i) => i.featured), ...rated].map((i) => [i.id, i])).values()];
  return [...first, ...pool.filter((i) => !first.includes(i)).sort(SORTS.newest)];
}

let cleanup = null; // tears down the landing page's animation loop when the route changes

function pageHome() {
  const order = orbOrder();
  const latest = ALL.slice().sort(SORTS.newest).slice(0, 18);
  setList([...new Map([...order, ...latest].map((i) => [i.id, i])).values()], '#/');
  const photos = ALL.filter((i) => i.type === 'photo').length, videos = ALL.length - photos;
  const places = new Set(ALL.map((i) => i.placeKey).filter(Boolean)).size;
  const bioText = plain(CFG.bio || '');
  const excerpt = bioText.length > 260 ? bioText.slice(0, 260).replace(/\s\S*$/, '') + '…' : bioText;
  const cats = DB.categories.map((c) => ({ c, items: ALL.filter((i) => i.category === c).sort(SORTS.newest) })).filter((x) => x.items.length);
  const tops = DB.albums.filter((a) => !a.parent).slice(0, 4);
  const catTile = ({ c, items }) => {
    const cover = items.find((i) => i.featured) || items[0];
    return h('a', { class: 'cat', href: link('gallery', { c: undefined, cat: c }) },
      h('img', { src: mediaUrl(cover, 'thumb.webp'), srcset: `${mediaUrl(cover, 'thumb.webp')} ${natW(cover, 'thumb')}w, ${mediaUrl(cover, 'medium.webp')} ${natW(cover, 'medium')}w`, sizes: '(min-width: 900px) 20vw, 45vw', alt: '', loading: 'lazy', draggable: 'false' }),
      h('span', { class: 'cat-name' }, h('strong', {}, c), h('small', {}, countLabel(items.length, 'item'))));
  };

  const hint = h('p', { class: 'orb-hint' }, h('span', { class: 'orb-dot', 'aria-hidden': 'true' }), 'Drag to spin · select a photo');
  let stage;
  const orb = order.length ? createOrb({ items: order, social, onFirstInteraction: () => hint.classList.add('gone'), onOpen: (it) => nav(withV('#/', it.id), { lb: true }) }) : null;
  if (orb) { cleanup = orb.destroy; stage = orb.el; }
  else stage = h('div', { class: 'orb-empty' }, h('p', {}, order.length ? 'This browser cannot draw the 3D photo ball. Everything is below and in the gallery.' : 'The archive is waiting for its first photo.'));

  return h('div', { class: 'page home' },
    h('section', { class: 'orbhero', 'aria-label': 'Photo ball' }, stage,
      h('p', { class: 'orb-count' }, [countLabel(photos, 'photo'), videos ? countLabel(videos, 'video') : null, places ? countLabel(places, 'place') : null].filter(Boolean).join('  ·  ')),
      h('div', { class: 'orb-copy' },
        h('h1', { class: 'brandline', tabindex: '-1', html: brandline() }),
        h('div', { class: 'orb-links' }, h('a', { class: 'cta', href: '#/gallery' }, 'Browse the archive', h('span', { 'aria-hidden': 'true' }, ' →')), h('a', { class: 'ghost', href: '#/albums' }, 'Albums'))),
      orb ? hint : null),
    cats.length ? h('section', { class: 'band', 'aria-labelledby': 'cats-h' }, h('div', { class: 'band-head' }, h('h2', { id: 'cats-h' }, 'Browse by subject'), h('a', { href: '#/gallery' }, 'All work →')), h('div', { class: 'cats' }, cats.map(catTile))) : null,
    h('section', { class: 'band', 'aria-labelledby': 'recent' }, h('div', { class: 'band-head' }, h('h2', { id: 'recent' }, 'Latest'), h('a', { href: '#/gallery' }, 'See everything →')), latest.length ? grid(latest, '#/') : empty('The archive is waiting for its first photo.')),
    tops.length ? h('section', { class: 'band' }, h('div', { class: 'band-head' }, h('h2', {}, 'Albums'), h('a', { href: '#/albums' }, 'All albums →')), h('div', { class: 'cards' }, tops.map(albumCard))) : null,
    (excerpt || CFG.portrait) ? h('section', { class: 'band about-teaser' }, CFG.portrait ? h('img', { class: 'portrait', src: CFG.portrait, alt: `Portrait of ${CFG.owner}`, draggable: 'false' }) : null, h('div', {}, h('h2', {}, 'About Me'), h('p', {}, excerpt), h('a', { href: '#/about' }, 'Read more →'))) : null);
}

function select(label, id, value, options, onchange) {
  const sel = h('select', { id, 'aria-label': label, onchange: () => onchange(sel.value) }, h('option', { value: '' }, label), options.map(([v, t]) => h('option', { value: v, selected: String(v) === String(value) }, t)));
  return sel;
}

function pageGallery(q) {
  const p = Object.fromEntries([...q].filter(([k]) => k !== 'v'));
  const catCount = (c) => ALL.filter((i) => i.category === c).length;
  const tags = [...ALL.flatMap((i) => i.tags || []).reduce((m, t) => m.set(t, (m.get(t) || 0) + 1), new Map())].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const years = [...new Set(ALL.map((i) => i.year))].sort((a, b) => b - a);
  const places = [...new Set(ALL.map((i) => i.placeKey).filter(Boolean))].sort();
  const cams = [...new Set(ALL.map((i) => i.cam).filter(Boolean))].sort();
  const count = h('p', { class: 'count', 'aria-live': 'polite' });
  const results = h('div', { class: 'results' });
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Category' });
  const set = (k, v) => {
    if (v) p[k] = v; else delete p[k];
    const hash = link('gallery', p);
    history.replaceState(history.state, '', hash);
    cur.base = hash; refresh();
  };
  function drawChips() {
    chips.replaceChildren(h('button', { class: 'chip', type: 'button', 'aria-pressed': !p.cat, onclick: () => set('cat', '') }, 'All'),
      ...DB.categories.map((c) => h('button', { class: 'chip', type: 'button', 'aria-pressed': p.cat === c, onclick: () => set('cat', p.cat === c ? '' : c) }, c, h('span', { class: 'n' }, catCount(c)))));
  }
  function refresh() {
    const list = filterItems(p);
    setList(list, cur.base);
    drawChips();
    const keys = Object.keys(p).filter((k) => labels[k] && p[k]);
    nActive.textContent = keys.filter((k) => k !== 'cat').length || '';
    active.replaceChildren(...keys.map((k) => h('button', { class: 'chip', type: 'button', 'aria-label': 'Remove filter ' + labels[k] + ': ' + p[k],
      onclick: () => { const s = $('#f-' + k); if (s) s.value = ''; if (k === 'q') $('#q').value = ''; set(k, ''); } }, k === 'month' ? monthName(+p[k]) : p[k])));
    count.textContent = countLabel(list.length, 'result') + (p.q ? ` for “${p.q}”` : '');
    results.replaceChildren(list.length ? grid(list, cur.base) : empty('No matches. Try clearing a filter.'));
    layoutGrids();
  }
  const bar = h('div', { class: 'filters' },
    select('Album', 'f-album', p.album, DB.albums.map((a) => [a.id, (a.parent ? '— ' : '') + a.name]), (v) => set('album', v)),
    select('Tag', 'f-tag', p.tag, tags.map(([t, n]) => [t, `${t} (${n})`]), (v) => set('tag', v)),
    select('Year', 'f-year', p.year, years.map((y) => [y, y]), (v) => set('year', v)),
    select('Month', 'f-month', p.month, Array.from({ length: 12 }, (_, i) => [i + 1, monthName(i + 1)]), (v) => set('month', v)),
    select('Location', 'f-place', p.place, places.map((x) => [x, x]), (v) => set('place', v)),
    select('Camera', 'f-camera', p.camera, cams.map((x) => [x, x]), (v) => set('camera', v)),
    h('select', { id: 'f-sort', 'aria-label': 'Sort', onchange: (e) => set('sort', e.target.value === 'newest' ? '' : e.target.value) },
      [['newest', 'Newest first'], ['oldest', 'Oldest first'], ['name', 'File name']].map(([v, t]) => h('option', { value: v, selected: (p.sort || 'newest') === v }, t))),
    h('a', { class: 'clear', href: '#/gallery' }, 'Clear all'));
  const labels = { cat: 'Category', tag: 'Tag', album: 'Album', year: 'Year', month: 'Month', place: 'Location', camera: 'Camera', q: 'Search' };
  const active = h('div', { class: 'active', 'aria-label': 'Active filters' });
  const nActive = h('span', { class: 'n' });
  const panel = h('details', { class: 'filter-panel' }, h('summary', {}, 'Filters', nActive), bar);
  panel.open = innerWidth > 760 || Object.keys(p).some((k) => k !== 'sort' && k !== 'cat' && p[k]);
  const page = h('div', { class: 'page' }, pageHead('Gallery'), chips, panel, active, count, results);
  cur.base = link('gallery', p);
  queueMicrotask(refresh);
  return page;
}

function pageAlbums() {
  const tops = DB.albums.filter((a) => !a.parent);
  setList(ALL.slice().sort(SORTS.newest), '#/albums');
  return h('div', { class: 'page' }, pageHead('Albums', 'Collections, in the order I like to tell them.'),
    tops.length ? tops.map((a) => {
      const kids = DB.albums.filter((k) => k.parent === a.id);
      return h('section', { class: 'album-group' }, h('div', { class: 'cards' }, albumCard(a), kids.map(albumCard)));
    }) : empty('No albums yet.'));
}

function pageAlbum(id) {
  const a = ALBUMS.get(id);
  if (!a) return pageNotFound();
  const ids = albumIds(id);
  const items = ALL.filter((i) => i.albums?.some((x) => ids.has(x))).sort(SORTS.newest);
  const base = `#/album/${id}`;
  setList(items, base);
  const kids = DB.albums.filter((k) => k.parent === id);
  const parent = a.parent && ALBUMS.get(a.parent);
  return h('div', { class: 'page' },
    h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' }, h('a', { href: '#/albums' }, 'Albums'), parent ? [' / ', h('a', { href: `#/album/${parent.id}` }, parent.name)] : null),
    pageHead(a.name, countLabel(items.length, 'item')),
    a.description ? h('div', { class: 'prose album-desc', html: md(a.description) }) : null,
    kids.length ? h('div', { class: 'cards sub' }, kids.map(albumCard)) : null,
    items.length ? grid(items, base) : empty('This album is empty.'));
}

/** One continuous, winding line of every photo and video: left to right, a turn, right to left, and so on. */
function pageTimeline(q) {
  const order = q.get('order') === 'oldest' ? 'oldest' : 'newest';
  const list = ALL.slice().sort(order === 'oldest' ? SORTS.oldest : SORTS.newest);
  const base = order === 'oldest' ? '#/timeline?order=oldest' : '#/timeline';
  setList(list, base);
  const NS = 'http://www.w3.org/2000/svg';
  const stage = h('div', { class: 'snake', role: 'list', 'aria-label': 'Timeline of photos and videos' });
  const sw = (key, label) => h('a', { class: 'chip', href: key === 'newest' ? '#/timeline' : '#/timeline?order=oldest', 'aria-pressed': String(order === key) }, label);
  let drew = false;

  function layout() {
    const W = stage.clientWidth;
    if (!W || !list.length) return;
    const narrow = W < 520, s = narrow ? 64 : W < 900 ? 92 : 116, g = narrow ? 18 : 26, M = narrow ? 8 : 24;
    const TURN = 56, step = s + g;                       // room each end for the line to loop round
    const n = Math.max(2, Math.floor((W - 2 * (M + TURN) - s) / step) + 1);
    const rows = Math.ceil(list.length / n), rowH = s + 88, top = 56;
    const xa = W / 2 - ((n - 1) * step) / 2, xb = xa + (n - 1) * step;
    const yc = (r) => top + r * rowH + s / 2;
    const xAt = (r, k) => (r % 2 === 0 ? xa + k * step : xb - k * step);
    const e = s / 2 + 18, bulge = 38;

    // the line
    const lastRow = rows - 1, lastK = (list.length - 1) % n;
    let d = `M ${xa - 30} ${yc(0)}`;
    for (let r = 0; r < rows; r++) {
      const dir = r % 2 === 0 ? 1 : -1, y = yc(r);
      if (r === lastRow) { d += ` L ${xAt(r, lastK) + dir * 30} ${y}`; break; }
      const xe = dir > 0 ? xb + e : xa - e, y2 = yc(r + 1);
      d += ` L ${xe} ${y} C ${xe + dir * bulge} ${y} ${xe + dir * bulge} ${y2} ${xe} ${y2}`;
    }
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'snake-line' + (drew ? '' : ' draw')); svg.setAttribute('width', W); svg.setAttribute('height', top + rows * rowH); svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(NS, 'path'); path.setAttribute('d', d); path.setAttribute('pathLength', '1'); svg.append(path);
    drew = true;

    // the photos and month markers
    const nodes = [svg];
    let prev = null, labelX = -1e9, labelRow = -1;
    list.forEach((it, i) => {
      const r = Math.floor(i / n), k = i % n, x = xAt(r, k), y = yc(r);
      const key = it.year * 100 + it.month;
      if (key !== prev) {
        if (r !== labelRow || Math.abs(x - labelX) > 96) {
          const first = prev === null || Math.floor(prev / 100) !== it.year;
          nodes.push(h('div', { class: 'snake-label', style: `left:${x - s / 2}px;top:${y - s / 2 - 30}px` }, monthName(it.month, 'short'), first ? h('b', {}, ' ' + it.year) : null));
          labelX = x; labelRow = r;
        }
        prev = key;
      }
      const a = h('a', { class: 'snake-photo', role: 'listitem', href: withV(base, it.id), style: `left:${x - s / 2}px;top:${y - s / 2}px;width:${s}px;height:${s}px`, title: [it.title, it.taken?.local && fmtDay(it)].filter(Boolean).join(' · ') || it.file, 'aria-label': (it.title || it.file) + (it.taken?.local ? ', ' + fmtDay(it) : '') },
        h('img', { src: mediaUrl(it, 'thumb.webp'), srcset: `${mediaUrl(it, 'thumb.webp')} ${natW(it, 'thumb')}w, ${mediaUrl(it, 'medium.webp')} ${natW(it, 'medium')}w`, sizes: `${s}px`, alt: '', loading: 'lazy', decoding: 'async', draggable: 'false' }));
      if (it.type === 'video') a.append(h('span', { class: 'badge', html: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>' }));
      a.addEventListener('contextmenu', (ev) => ev.preventDefault());
      a.addEventListener('click', (ev) => { if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button) return; ev.preventDefault(); nav(a.getAttribute('href'), { lb: true }); });
      nodes.push(a);
    });
    stage.style.height = top + rows * rowH + 24 + 'px';
    stage.replaceChildren(...nodes);
  }
  new ResizeObserver(layout).observe(stage);
  queueMicrotask(layout);
  return h('div', { class: 'page' }, pageHead('Timeline', 'One long line, from the first shot to the latest. Click any photo to view it.'),
    list.length ? h('div', { class: 'chips snake-order', role: 'group', 'aria-label': 'Order' }, sw('newest', 'Newest first'), sw('oldest', 'Oldest first')) : null,
    list.length ? stage : empty('The timeline starts with the first photo.'));
}

const fmtDay = (it) => wall(it.taken.local).toLocaleDateString(undefined, { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' });

function placeGroups() {
  const g = new Map();
  for (const i of ALL) {
    if (!i.placeKey) continue;
    const e = g.get(i.placeKey) || { key: i.placeKey, country: i.place?.country || 'Elsewhere', items: [], lat: 0, lon: 0, n: 0 };
    e.items.push(i);
    if (i.gps) { e.lat += i.gps.lat; e.lon += i.gps.lon; e.n++; }
    g.set(i.placeKey, e);
  }
  return [...g.values()];
}

let leafletP;
const loadLeaflet = () => (leafletP ||= new Promise((res, rej) => {
  const base = 'https://unpkg.com/leaflet@1.9.4/dist/';
  document.head.append(h('link', { rel: 'stylesheet', href: base + 'leaflet.css' }));
  document.head.append(h('script', { src: base + 'leaflet.js', onload: () => res(window.L), onerror: () => { leafletP = null; rej(new Error('Leaflet failed to load')); } }));
}));

function pageMapped(kind) { // places
  setList(ALL.slice().sort(SORTS.newest), '#/places');
  const groups = placeGroups().sort((a, b) => b.items.length - a.items.length);
  const mapEl = h('div', { class: 'map', role: 'region', 'aria-label': 'Map of places' });
  const geo = groups.filter((g) => g.n);
  const byCountry = new Map();
  for (const g of groups) byCountry.set(g.country, [...(byCountry.get(g.country) || []), g]);
  if (geo.length) loadLeaflet().then((L) => {
    if (!mapEl.isConnected) return;
    const map = L.map(mapEl, { scrollWheelZoom: false }).setView([20, 0], 2);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map);
    const pts = geo.map((g) => {
      const ll = [g.lat / g.n, g.lon / g.n];
      const pop = h('div', { class: 'pop' }, h('strong', {}, g.key), h('br'), h('a', { href: link('gallery', { place: g.key }) }, countLabel(g.items.length, 'item') + ' →'));
      L.circleMarker(ll, { radius: 7 + Math.min(14, Math.sqrt(g.items.length) * 3), color: '#2f5d3a', weight: 2, fillColor: '#7aa66a', fillOpacity: 0.8 }).bindPopup(pop).addTo(map);
      return ll;
    });
    pts.length === 1 ? map.setView(pts[0], 8) : map.fitBounds(pts, { padding: [40, 40], maxZoom: 9 });
    map.once('focus', () => map.scrollWheelZoom.enable());
  }).catch(() => mapEl.replaceChildren(h('p', { class: 'empty' }, 'The map could not load (offline?). The list below still works.')));
  return h('div', { class: 'page' }, pageHead('Places', 'Where these were taken.'),
    geo.length ? mapEl : empty('No geotagged photos yet.'),
    [...byCountry].sort().map(([country, gs]) => h('section', { class: 'place-group' }, h('h2', {}, country),
      h('ul', { class: 'list' }, gs.map((g) => h('li', {}, h('a', { href: link('gallery', { place: g.key }) }, g.key), h('span', { class: 'muted' }, countLabel(g.items.length, 'item'))))))));
}

const GEAR_TYPES = ['Camera', 'Lens', 'Accessory', 'Software', 'Other'];
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : null);

function pageGear() {
  // Cameras are detected from the photos' own EXIF data; every camera gets a section with the photos it took.
  const seen = new Map();
  for (const i of ALL) if (i.cam) { const e = seen.get(i.cam) || { items: [], lenses: new Map() }; e.items.push(i); if (i.camera.lens) e.lenses.set(i.camera.lens, (e.lenses.get(i.camera.lens) || 0) + 1); seen.set(i.cam, e); }
  const listed = (CFG.gear || []).filter((g) => g.name);
  const norm = (x) => x.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const same = (x, y) => { x = norm(x); y = norm(y); return x && y && (x.includes(y) || y.includes(x)); };
  const cams = [...seen].sort((p, q) => q[1].items.length - p[1].items.length).map(([name, e]) => ({ name, ...e, items: e.items.slice().sort(SORTS.newest), info: listed.find((g) => g.type === 'Camera' && same(g.name, name)) }));
  const extraCams = listed.filter((g) => g.type === 'Camera' && !cams.some((c) => c.info === g)); // listed by hand, no photos matched
  const others = listed.filter((g) => g.type !== 'Camera');
  const SHOWN = 12, base = '#/gear';
  setList([...new Map(cams.flatMap((c) => c.items.slice(0, SHOWN)).map((i) => [i.id, i])).values()], base);
  const links = (g) => (safeUrl(g?.link) ? h('a', { href: safeUrl(g.link), target: '_blank', rel: 'noopener' }, 'Details ↗') : null);
  const card = (g) => h('article', { class: 'gear-card' }, h('h3', {}, g.name), g.notes ? h('p', {}, g.notes) : null, links(g) ? h('p', { class: 'gear-links' }, links(g)) : null);
  const plural = { Camera: 'Cameras', Lens: 'Lenses', Accessory: 'Accessories', Software: 'Software', Other: 'Other' };
  const groups = GEAR_TYPES.filter((t) => t !== 'Camera').map((t) => [t, others.filter((g) => (GEAR_TYPES.includes(g.type) ? g.type : 'Other') === t)]).filter(([, l]) => l.length);
  return h('div', { class: 'page' }, pageHead('Gear', 'What I shoot with, and what each one made.'),
    cams.map((c) => h('section', { class: 'gear-cam', 'aria-labelledby': 'cam-' + norm(c.name) },
      h('div', { class: 'gear-cam-head' },
        h('div', {}, h('h2', { id: 'cam-' + norm(c.name) }, c.name), c.info?.notes ? h('p', { class: 'muted' }, c.info.notes) : null,
          c.lenses.size ? h('p', { class: 'lenses' }, 'Lenses: ' + [...c.lenses].map(([l, n]) => l + ' (' + n + ')').join(' · ')) : null),
        h('div', { class: 'gear-cam-meta' }, h('span', { class: 'muted' }, countLabel(c.items.length, 'photo')), links(c.info), c.items.length > SHOWN ? h('a', { href: link('gallery', { camera: c.name }) }, 'See all ' + c.items.length + ' →') : null)),
      grid(c.items.slice(0, SHOWN), base))),
    extraCams.length ? h('section', { class: 'gear-group' }, h('h2', {}, cams.length ? 'More cameras' : 'Cameras'), h('div', { class: 'gear-grid' }, extraCams.map(card))) : null,
    groups.map(([t, l]) => h('section', { class: 'gear-group' }, h('h2', {}, plural[t]), h('div', { class: 'gear-grid' }, l.map(card)))),
    !listed.length && !cams.length ? empty('No gear yet. Cameras appear here automatically as you add photos.') : null);
}

function pageAbout() {
  setList(ALL.slice().sort(SORTS.newest), '#/about');
  const photos = ALL.filter((i) => i.type === 'photo').length;
  return h('div', { class: 'page about' },
    pageHead('About Me'),
    h('div', { class: 'about-grid' + (CFG.portrait ? '' : ' solo') },
      CFG.portrait ? h('img', { class: 'portrait big', src: CFG.portrait, alt: `Portrait of ${CFG.owner}`, draggable: 'false' }) : null,
      h('div', { class: 'about-copy' },
        h('div', { class: 'prose', html: md(CFG.bio || '') }),
        h('p', { class: 'muted about-count' }, `${countLabel(photos, 'photo')} and ${countLabel(ALL.length - photos, 'video')} so far.`))));
}

const pageNotFound = () => { setList([], '#/'); return h('div', { class: 'page' }, pageHead('Lost in the trees'), h('p', {}, h('a', { href: '#/' }, 'Back to the clearing →'))); };

/** Sections and tiles fade up as they scroll into view. Only armed when IntersectionObserver exists, so content is never left hidden. */
function reveal(root) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -6% 0px' });
  root.querySelectorAll('.band, .cats .cat, .cards .card, .year, .cam, .place-group').forEach((el, i) => { el.classList.add('rv'); el.style.setProperty('--d', (i % 6) * 70 + 'ms'); io.observe(el); });
}

// ---------------------------------------------------------------- router
function nav(href, { replace = false, lb = false } = {}) {
  (replace ? history.replaceState : history.pushState).call(history, lb ? { lb: 1 } : null, '', href);
  route();
}

let rendered = false;
function route() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs = ''] = raw.split('?');
  const q = new URLSearchParams(qs);
  const v = q.get('v'); q.delete('v');
  const base = '#' + path + (q.size ? '?' + q : '');
  if (!rendered || base !== cur.base) {
    rendered = true;
    const seg = path.split('/').filter(Boolean);
    grids.clear();
    cleanup?.(); cleanup = null; // stop the previous page's animation loop
    document.body.classList.toggle('on-home', !seg[0]);
    const page = ({ '': pageHome, gallery: () => pageGallery(q), albums: pageAlbums, album: () => pageAlbum(seg[1]), timeline: () => pageTimeline(q), places: pageMapped, gear: pageGear, cameras: pageGear, about: pageAbout }[seg[0] || ''] || pageNotFound)();
    app.replaceChildren(page);
    cur.base = base;
    layoutGrids();
    reveal(page);
    if (!v) { scrollTo(0, 0); $('h1', app)?.focus({ preventScroll: true }); }
    $$('nav.main a').forEach((a) => (a.getAttribute('href').split('/')[1] === (seg[0] || '') ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
    const sb = $('#q'); if (sb && document.activeElement !== sb) sb.value = seg[0] === 'gallery' ? q.get('q') || '' : '';
  }
  if (v) {
    if (!cur.list.some((i) => i.id === v)) { if (BY_ID.has(v)) { setList(ALL.slice().sort(SORTS.newest), cur.base); } }
    lightbox.show(v);
  } else lightbox.hide();
}

// ---------------------------------------------------------------- chrome
function theme() {
  const root = document.documentElement, btn = $('#theme');
  const eff = () => root.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const paint = () => { btn.setAttribute('aria-label', `Switch to ${eff() === 'dark' ? 'light' : 'dark'} mode`); btn.dataset.mode = eff(); };
  btn.addEventListener('click', () => { const n = eff() === 'dark' ? 'light' : 'dark'; root.dataset.theme = n; try { localStorage.setItem('va-theme', n); } catch {} paint(); });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paint);
  paint();
}

function chrome() {
  document.title = CFG.siteName;
  $$('.brand-name').forEach((n) => (n.textContent = CFG.siteName));
  $('footer.site .brandline').innerHTML = brandline();
  $('#year').textContent = new Date().getFullYear();
  $('#owner').textContent = CFG.owner;
  const contact = $('footer.site .contact');
  if (CFG.contact?.trim()) { contact.hidden = false; contact.querySelector('.contact-body').innerHTML = md(CFG.contact); }
  const sb = $('#q');
  const go = () => { const v = sb.value.trim(); nav(v ? link('gallery', { q: v }) : '#/gallery', { replace: location.hash.startsWith('#/gallery') }); };
  sb.addEventListener('input', debounce(go, 300));
  sb.closest('form').addEventListener('submit', (e) => { e.preventDefault(); go(); });
  addEventListener('keydown', (e) => { if (e.key === '/' && !e.target.matches('input, textarea, select') && !lightbox.isOpen()) { e.preventDefault(); sb.focus(); } });
  theme();
  const hd = $('header.site');
  const setHdr = () => document.documentElement.style.setProperty('--hdr', hd.offsetHeight + 'px'); // landing stage fills exactly the rest of the screen
  setHdr(); addEventListener('resize', setHdr); document.fonts?.ready.then(setHdr); const onScroll = () => hd.classList.toggle('scrolled', scrollY > 8); addEventListener('scroll', onScroll, { passive: true }); onScroll();
}

async function boot() {
  try {
    const get = (u) => fetch(u, { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`); return r.json(); });
    [CFG, DB] = await Promise.all([get('site.config.json'), get('data/photos.json')]);
  } catch (e) {
    app.replaceChildren(h('p', { class: 'empty' }, `Could not load the archive (${e.message}).`));
    return;
  }
  lbCtx.cfg = CFG;
  social.init(CFG.social);
  // give fan ratings a moment to arrive so the homepage slideshow can use them, but never hold the page up for long
  await Promise.race([social.loadSummary(), new Promise((r) => setTimeout(r, 1200))]);
  DB.albums.forEach((a) => ALBUMS.set(a.id, a));
  ALL = DB.items.filter((i) => !i.hidden).map(prep);
  ALL.forEach((i) => BY_ID.set(i.id, i));
  lightbox = createLightbox(lbCtx);
  chrome();
  addEventListener('hashchange', route);
  addEventListener('popstate', route);
  route();
}
boot();
