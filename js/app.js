import { $, $$, h, esc, md, plain, fmtDur, debounce, mediaUrl, setMediaBase, wall } from './util.js';
import { createLightbox } from './lightbox.js';
import * as social from './social.js';
import { createOrb } from './orb.js';
import * as Vision from './vision.js';

let CFG, DB, ALL = [], BY_ID = new Map(), ALBUMS = new Map();
let VIS = null; // smart-search index built from data/vision.json (palette, tone, mood facts per photo); null = plain text search
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
  it.placeKey = it.place?.text || (it.gps ? 'Unnamed area' : null);
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

/**
 * The gallery's search and filters. The smart search reads the sentence (moods, colours, dates, places, plain words) and ranks by how well
 * photos fit; `found` says what it understood. ?like=<id> lists photos that look like one photo; ?color=#rrggbb photos whose palette holds a colour.
 */
function runSearch(p) {
  const ids = p.album ? albumIds(p.album) : null;
  let list = ALL.filter((i) =>
    (!p.cat || i.category === p.cat) && (!p.tag || i.tags?.includes(p.tag)) && (!ids || i.albums?.some((a) => ids.has(a))) &&
    (!p.year || i.year === +p.year) && (!p.month || i.month === +p.month) && (!p.place || i.placeKey === p.place || i.place?.country === p.place) &&
    (!p.camera || i.cam === p.camera));
  if (p.like && VIS?.get(p.like)) return { list: Vision.similar(p.like, list, VIS, 48), found: null, ranked: true };
  const text = [p.q, p.mood, p.color].filter(Boolean).join(' ').trim();
  const found = text ? Vision.search(text, list, VIS) : null;
  if (found) list = found.items;
  const ranked = !!found?.visual && !p.sort;
  return { list: ranked ? list : list.slice().sort(SORTS[p.sort] || SORTS.newest), found, ranked };
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
function grid(items, base, { maxRows = Infinity } = {}) {
  const el = h('div', { class: 'grid', role: 'list', 'aria-label': 'Photos and videos' });
  el._items = items; el._base = base; el._maxRows = maxRows; grids.add(el);
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
    const rows = justify(el._items, W, narrow ? 150 : W < 1000 ? 210 : 270, gap).slice(0, el._maxRows);
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
// A tagline shaped like a file name ("KarsonShin.jpg") is set as name + extension; anything else highlights the owner's name as before.
const brandline = () => {
  const f = /^(\S+)(\.[a-z0-9]{2,4})$/i.exec(CFG.tagline || '');
  return f ? `<span class="by">${esc(f[1])}</span><span class="ext">${esc(f[2])}</span>` : esc(CFG.tagline).replace(esc(CFG.owner), `<span class="by">${esc(CFG.owner)}</span>`);
};

// The headline is a button. Hovering it (or pressing Enter) floods the page with a pinboard of your photos: the name rises to the middle in
// black on a white plate with a title card under it, and prints from the archive fly out around it. Prints drift with the pointer, lift on
// hover, can be dragged, and open in the viewer when clicked. It stays until Esc, a click on the empty board, Close, or a link.
// Under reduced motion it opens on click only, with no animation.
const DEFAULT_INTRO = ['Welcome to the **Verdant Archive**, a living archive of places, people, and passing moments. From distant landscapes to familiar streets, this portfolio is where my photographs and videos take root.',
  'Spin the sphere, follow the Trunk of Time, wander the albums, or search by mood. Every frame tells a story, and every moment is my own. This garden is always growing. Stay awhile, and watch it bloom.'].join('\n\n');
function headline() {
  const btn = h('button', { type: 'button', class: 'name-btn', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', html: brandline() });
  const el = h('h1', { class: 'brandline', tabindex: '-1' }, btn);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // A small arrow and a hint pointing at the name from its south-east corner. It stays, and jiggles every few seconds; it only steps aside while the popup is open.
  const canHover = matchMedia('(hover: hover)').matches;
  const hint = h('span', { class: 'hover-hint', 'aria-hidden': 'true', html: '<svg viewBox="0 0 56 44"><path d="M50 40C53 21 31 9 9 9M9 9l9-5M9 9l8 7"/></svg><span>' + (canHover && !reduce ? 'Hover Over Me!' : canHover ? 'Click Me!' : 'Tap Me!') + '</span>' });
  el.append(hint);
  let layer = null, card = null, plate = null, board = null, opened = false, armed = true, hoverT = 0, gone = 0, settleT = 0, held = [], fillT = 0, px = -1, py = -1, z = 1000, hoverRaf = 0, vines = {};


  // Prints are laid out on a loose grid of cells with jitter. Sizes vary (larger ones drift more, as if closer), prints may tuck partly behind
  // the plate, New random layout every time.
  const scatter = (box) => {
    const vw = innerWidth, vh = innerHeight, phone = vw < 600, cols = phone ? 3 : vw < 1000 ? 6 : 8, rows = phone ? 6 : 5, cw = vw / cols, ch = vh / rows;
    const base = Math.round(Math.max(78, Math.min(210, cw * 1.2, ch * 1.05))), pool = ALL.filter((i) => i.type === 'photo' && i.files?.includes('thumb.webp')).sort(() => Math.random() - 0.5);
    const cells = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x = (c + 0.5 + (Math.random() - 0.5) * 0.76) * cw, y = (r + 0.5 + (Math.random() - 0.5) * 0.76) * ch, w = Math.round(base * [0.78, 1, 1, 1.25][Math.floor(Math.random() * 4)]), tuck = w * 0.1;
      if (x > box.left + tuck && x < box.right - tuck && y > box.top + tuck && y < box.bottom - tuck) continue; // the plate covers the middle; edges of prints may peek out from under it
      cells.push([x, y, w]);
    }
    cells.sort(() => Math.random() - 0.5);
    const cx = vw / 2, cy = box.top + (box.bottom - box.top) / 2;
    board.replaceChildren(...cells.map(([x, y, w], i) => {
      const it = pool[i % pool.length]; if (!it) return null;
      return h('div', { class: 'print' + (Math.random() < 0.45 ? ' taped' : ''), 'data-id': it.id, style: `left:${(x - w / 2).toFixed(1)}px;top:${(y - w * 0.66).toFixed(1)}px;width:${w}px;--r:${((Math.random() - 0.5) * 20).toFixed(1)}deg;--tr:${((Math.random() - 0.5) * 14).toFixed(1)}deg;--i:${i};--ox:${(cx - x).toFixed(1)}px;--oy:${(cy - y).toFixed(1)}px` },
        h('div', { class: 'print-in' }, h('img', { src: mediaUrl(it, 'thumb.webp'), alt: '', draggable: 'false', decoding: 'async' })));
    }));
  };

  // A vine: two long curves wind across the whole screen and thread through the prints. Each print the vine crosses is put in front of it or
  // behind it, alternating along the vine, so it really weaves (prints and the vine share one stacking order; see the z-index notes in the CSS).
  // Leaves grow along the vine, and short sprigs drape over two corners of the plate. All SVG, grown on open.
  const SVG = 'http://www.w3.org/2000/svg';
  const sv = (tag, attrs = {}, ...kids) => { const n = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); n.append(...kids); return n; };
  const LEAVES = ['#3f9a63', '#56b47a', '#2f7f50', '#7fd3a0', '#8fe0b2', '#4aa571'], LEAF = 'M0,0 C10,-12 28,-12 38,0 C28,12 10,12 0,0Z', CURL = 'M0,0 C7,-12 24,-10 21,4 C18,14 5,11 9,2';
  const f1 = (n) => n.toFixed(1);
  const spline = (pts) => { // Catmull-Rom through the points, as cubic Beziers
    let d = `M${f1(pts[0][0])},${f1(pts[0][1])}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      d += ` C${f1(p1[0] + (p2[0] - p0[0]) / 6)},${f1(p1[1] + (p2[1] - p0[1]) / 6)} ${f1(p2[0] - (p3[0] - p1[0]) / 6)},${f1(p2[1] - (p3[1] - p1[1]) / 6)} ${f1(p2[0])},${f1(p2[1])}`;
    }
    return d;
  };
  // Walk the measured path and drop leaves (and the odd curl) alternately on either side.
  const foliage = (path, len, scale, step = 1) => {
    const g = sv('g');
    let side = Math.random() < 0.5 ? 1 : -1, n = 0;
    for (let s = 22 + Math.random() * 18; s < len - 8; s += (38 + Math.random() * 30) * step) {
      const a = path.getPointAtLength(s), b = path.getPointAtLength(Math.min(len, s + 3)), ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
      side = -side; n++;
      const anim = `--d:${(0.45 + (s / len) * 2.3).toFixed(2)}s;--w:${(-Math.random() * 5).toFixed(1)}s`;
      const put = (rot, kid, sc) => sv('g', { style: `transform:translate(${f1(a.x)}px,${f1(a.y)}px) rotate(${f1(rot)}deg)` }, sv('g', { class: 'leaf', style: `--sc:${sc.toFixed(2)};${anim}` }, sv('g', { class: 'sway' }, ...kid)));
      g.append(put(ang + side * (32 + Math.random() * 42), [sv('path', { d: LEAF, fill: LEAVES[Math.floor(Math.random() * LEAVES.length)], stroke: '#06100a', 'stroke-opacity': '.35', 'stroke-width': '1' }), sv('path', { d: 'M3,0 L33,0', fill: 'none', stroke: '#fff', 'stroke-opacity': '.3', 'stroke-width': '1' })], scale * (0.7 + Math.random() * 0.75)));
    }
    return g;
  };
  const stem = (d, len) => { // the vine itself: a dark stem with a thin highlight, drawn on by animating its dash offset
    const g = sv('g');
    for (const p of [sv('path', { d, fill: 'none', stroke: '#06130c', 'stroke-opacity': '.55', 'stroke-width': '11', 'stroke-linejoin': 'round' }), sv('path', { d, fill: 'none', stroke: '#3fa56a', 'stroke-width': '7', 'stroke-linejoin': 'round' }), sv('path', { d, fill: 'none', stroke: '#8fe0b2', 'stroke-opacity': '.55', 'stroke-width': '1.8', 'stroke-linejoin': 'round', transform: 'translate(-1.4,-1.4)' })]) { p.setAttribute('class', 'grow'); p.setAttribute('style', `--L:${Math.ceil(len)}`); g.append(p); }
    return g;
  };
  // Prints the vine crosses go over or under it alternately, in the order the vine meets them. Others sit behind it at random depths.
  const weave = (paths) => {
    const prints = [...board.children].map((el) => { const w = parseFloat(el.style.width); return { el, x: parseFloat(el.style.left), y: parseFloat(el.style.top), w, h: (w - 12) * 1.25 + 36, hit: Infinity }; });
    paths.forEach(({ probe, len }, k) => {
      for (let s = 0; s < len; s += 16) {
        const pt = probe.getPointAtLength(s);
        for (const p of prints) if (p.hit === Infinity && pt.x > p.x + 6 && pt.x < p.x + p.w - 6 && pt.y > p.y + 6 && pt.y < p.y + p.h - 6) p.hit = k * 1e5 + s;
      }
    });
    prints.filter((p) => p.hit < Infinity).sort((a, b) => a.hit - b.hit).forEach((p, i) => { p.el.style.zIndex = i % 2 ? 600 + (i % 20) * 10 : 100 + (i % 20) * 10; }); // over: 600s, under: 100s; the vine sits at 500
    prints.filter((p) => p.hit === Infinity).forEach((p) => { p.el.style.zIndex = 10 + Math.floor(Math.random() * 80); });
  };
  const grow = (box) => {
    const vw = innerWidth, vh = innerHeight, phone = vw < 600, scale = phone ? 0.85 : 1.2;
    for (const v of Object.values(vines)) v.replaceChildren();
    const curves = [0, 1].map((k) => { // one rising left to right, one falling, so they cross behind the plate
      const n = phone ? 6 : 8, pts = Array.from({ length: n + 1 }, (_, i) => { const t = i / n; return [-70 + t * (vw + 140), vh * (k ? 0.12 + 0.76 * t : 0.88 - 0.76 * t) + (Math.random() - 0.5) * vh * 0.24]; });
      return spline(pts);
    });
    const paths = curves.map((d) => { const probe = sv('path', { d }); vines.front.append(probe); return { d, probe, len: probe.getTotalLength() }; });
    weave(paths);
    for (const { d, probe, len } of paths) { const leaves = foliage(probe, len, scale); probe.remove(); vines.front.append(stem(d, len), leaves); }
    for (const [sx, sy, dir] of [[box.left, box.top, 1], [box.right, box.bottom, -1]]) { // sprigs over two corners of the plate
      const d = spline([[sx + dir * 70, sy - dir * 8], [sx + dir * 18, sy + dir * 4], [sx - dir * 34, sy + dir * 36], [sx - dir * 52, sy + dir * 96], [sx - dir * 30, sy + dir * 150]]);
      const probe = sv('path', { d }); vines.top.append(probe); const len = probe.getTotalLength();
      const leaves = foliage(probe, len, scale * 0.9, 0.8); probe.remove();
      vines.top.append(stem(d, len), leaves);
    }
  };

  // Line-art botanicals for the specimen card: a leafy flourish for each corner, and a small divider under the name.
  const ink = { fill: 'none', stroke: '#1d4a30', 'stroke-width': '1.4', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
  const flourish = (pos) => sv('svg', { class: `corner c-${pos}`, viewBox: '0 0 64 64', 'aria-hidden': 'true' },
    sv('path', { ...ink, d: 'M6,58 C8,36 22,16 52,8' }),
    ...[[14, 44, -20], [20, 31, -36], [30, 21, -52], [40, 14, -66]].flatMap(([x, y, a]) => [sv('path', { d: 'M0,0 C4,-6 13,-6 18,0 C13,6 4,6 0,0Z', transform: `translate(${x},${y}) rotate(${a})`, fill: 'rgb(111 197 146 / .45)', stroke: '#1d4a30', 'stroke-width': '1.1' }), sv('path', { d: 'M0,0 C4,-6 13,-6 18,0 C13,6 4,6 0,0Z', transform: `translate(${x - 1},${y + 3}) rotate(${a + 150}) scale(.8)`, fill: 'rgb(111 197 146 / .3)', stroke: '#1d4a30', 'stroke-width': '1' })]));
  const divider = () => sv('svg', { class: 'flip-orn', viewBox: '0 0 180 22', 'aria-hidden': 'true' },
    sv('path', { ...ink, d: 'M4,11 H70 M110,11 H176' }),
    sv('path', { ...ink, d: 'M70,11 C78,3 86,3 90,11 C94,19 102,19 110,11' }),
    sv('path', { d: 'M90,11 C84,0 74,1 72,6 C80,8 86,9 90,11Z', fill: 'rgb(111 197 146 / .6)', stroke: '#1d4a30', 'stroke-width': '1.1' }),
    sv('path', { d: 'M90,11 C96,22 106,21 108,16 C100,14 94,13 90,11Z', fill: 'rgb(111 197 146 / .6)', stroke: '#1d4a30', 'stroke-width': '1.1' }));

  const place = () => { // the popup sits in the middle of the screen: the plate is wrapped round the card
    card.style.maxHeight = Math.max(140, innerHeight - 32 - 74) + 'px'; // a long message scrolls inside the card instead of running off a small screen
    const ph = card.offsetHeight + 74, top = Math.max(16, (innerHeight - ph) / 2);
    card.style.top = top + 34 + 'px';
    const pw = Math.min(innerWidth - 24, card.offsetWidth + 72);
    Object.assign(plate.style, { left: (innerWidth - pw) / 2 + 'px', top: top + 'px', width: pw + 'px', height: ph + 'px' });
    const box = { left: (innerWidth - pw) / 2, right: (innerWidth + pw) / 2, top, bottom: top + ph };
    scatter(box); grow(box);
  };

  const build = () => {
    const link = (href, text, cls) => h('a', { href, class: cls }, text);
    card = h('div', { class: 'flip-card' }, divider(), h('div', { class: 'flip-bio', html: md(CFG.intro || DEFAULT_INTRO) }),
      h('div', { class: 'flip-links' }, link('#/about', ['More about me', h('span', { 'aria-hidden': 'true' }, ' →')], 'flip-cta'), link('#/gallery', 'Browse the gallery')));
    const closeBtn = h('button', { type: 'button', class: 'flip-close', 'aria-label': 'Close', title: 'Close (Esc)', html: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>' });
    plate = h('div', { class: 'flip-plate' }, ['tl', 'bl', 'br'].map(flourish), closeBtn);
    board = h('div', { class: 'board', 'aria-hidden': 'true' });
    for (const k of ['front', 'top']) vines[k] = sv('svg', { class: 'vine', 'aria-hidden': 'true', viewBox: `0 0 ${innerWidth} ${innerHeight}`, preserveAspectRatio: 'none' });
    layer = h('div', { class: 'flip', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Welcome to the ' + CFG.siteName }, board, vines.front, plate, vines.top, card);
    layer.addEventListener('click', (e) => { if (e.target.closest('a')) shut(false); else if (e.target.closest('.flip-close') || !e.target.closest('.flip-card, .print, .flip-plate')) shut(); });
    layer.addEventListener('transitionend', (e) => { if (e.target === layer && !opened) finish(); });
    layer.addEventListener('pointerdown', drag);
  };

  function drag(e) { // drag a print around; a click without movement opens that photo in the viewer
    const pr = e.target.closest('.print'); if (!pr || e.button) return;
    e.preventDefault(); pr.setPointerCapture(e.pointerId); pr.style.zIndex = ++z; pr.classList.add('drag');
    const sx = e.clientX, sy = e.clientY, bx = parseFloat(pr.style.getPropertyValue('--dx')) || 0, by = parseFloat(pr.style.getPropertyValue('--dy')) || 0;
    let moved = false;
    const move = (ev) => { const dx = ev.clientX - sx, dy = ev.clientY - sy; if (Math.hypot(dx, dy) > 5) moved = true; pr.style.setProperty('--dx', bx + dx + 'px'); pr.style.setProperty('--dy', by + dy + 'px'); };
    const up = () => {
      pr.classList.remove('drag'); pr.removeEventListener('pointermove', move); pr.removeEventListener('pointerup', up); pr.removeEventListener('pointercancel', up);
      if (!moved) { shut(false); nav(withV('#/', pr.dataset.id), { lb: true }); }
    };
    pr.addEventListener('pointermove', move); pr.addEventListener('pointerup', up); pr.addEventListener('pointercancel', up);
  }

  const track = (e) => { px = e.clientX; py = e.clientY; };
  const onKey = (e) => { if (e.key === 'Escape') shut(); };
  const relayout = () => layer && place();
  function open(viaKeyboard) {
    if (opened) return;
    hint.classList.add('gone');
    opened = true; armed = false; clearTimeout(hoverT); clearTimeout(gone); clearTimeout(settleT); clearTimeout(fillT);
    if (!layer) build();
    layer.classList.remove('settled', 'filled'); document.body.append(layer); document.body.classList.add('board-open'); place();
    held = [...document.body.children].filter((n) => n !== layer && !n.inert && !/^(SCRIPT|STYLE|LINK)$/.test(n.tagName)); held.forEach((n) => (n.inert = true)); // nothing behind can be tabbed to or clicked
    const sb = innerWidth - document.documentElement.clientWidth; document.documentElement.style.cssText += `overflow:hidden;padding-right:${sb}px`;
    btn.setAttribute('aria-expanded', 'true');
    addEventListener('pointermove', track, { passive: true }); addEventListener('keydown', onKey); addEventListener('resize', relayout);
    layer.getBoundingClientRect(); // commit the closed state so everything grows from the name
    layer.classList.add('on');
    fillT = setTimeout(() => layer?.classList.add('filled'), reduce ? 0 : 120); // prints and vine start a moment after the popup, so they do not all animate in the same frame
    settleT = setTimeout(() => layer?.classList.add('settled'), reduce ? 0 : 2200); // after the fly-in, hover and drag respond without the entrance delays
    layer.tabIndex = -1; (viaKeyboard ? layer.querySelector('a') : layer).focus({ preventScroll: true }); // a modal owns focus, so Esc and Tab work however it was opened
  }
  function shut(restoreFocus = true) {
    if (!opened) return;
    opened = false; clearTimeout(settleT); clearTimeout(fillT); layer.classList.remove('on', 'settled', 'filled'); btn.setAttribute('aria-expanded', 'false');
    held.forEach((n) => (n.inert = false)); held = [];
    document.documentElement.style.overflow = ''; document.documentElement.style.paddingRight = '';
    removeEventListener('keydown', onKey); removeEventListener('resize', relayout);
    if (restoreFocus && layer.contains(document.activeElement)) btn.focus({ preventScroll: true });
    if (reduce) finish(); else gone = setTimeout(finish, 1200); // normally transitionend gets there first
  }
  function finish() {
    hint.classList.remove('gone'); clearTimeout(gone); layer?.remove(); layer = null; document.body.classList.remove('board-open'); removeEventListener('pointermove', track);
    const r = btn.getBoundingClientRect(); armed = !(px >= r.left && px <= r.right && py >= r.top && py <= r.bottom); // pointer still on the name: wait for it to leave before hover can reopen
  }
  btn.addEventListener('click', (e) => (opened ? shut() : open(e.detail === 0)));
  el.addEventListener('pointermove', track, { passive: true }); // so we always know whether the pointer is still on the name when the board closes
  // opening on hover needs a pause of 450ms, not a pass-through: the viewfinder brackets close in while you wait
  el.addEventListener('pointerenter', (e) => { track(e); if (e.pointerType === 'mouse' && !reduce && armed && !opened) hoverT = setTimeout(() => open(false), 450); });
  el.addEventListener('pointerleave', () => { clearTimeout(hoverT); if (!opened && !layer) armed = true; });
  return el;
}


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

/** Order for the ball: every photo, shuffled. Picked once per page load, so coming back to the landing page keeps the same ball, and the
 *  viewer steps through the same random order (the list given to setList below). A reload deals a new one. */
let ORB_ORDER = null;
function orbOrder() {
  const pool = ALL.filter((i) => i.type === 'photo' || i.featured);
  if (ORB_ORDER?.length !== pool.length) { // first visit, or the library changed
    ORB_ORDER = pool.slice();
    for (let i = ORB_ORDER.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ORB_ORDER[i], ORB_ORDER[j]] = [ORB_ORDER[j], ORB_ORDER[i]]; }
  }
  return ORB_ORDER;
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

  let stage;
  const orb = order.length ? createOrb({ items: order, social, onOpen: (it) => nav(withV('#/', it.id), { lb: true }) }) : null;
  if (orb) { cleanup = orb.destroy; stage = orb.el; }
  else stage = h('div', { class: 'orb-empty' }, h('p', {}, order.length ? 'This browser cannot draw the 3D photo ball. Everything is below and in the gallery.' : 'The archive is waiting for its first photo.'));

  return h('div', { class: 'page home' },
    h('section', { class: 'orbhero', 'aria-label': 'Photo ball' }, stage,
      h('p', { class: 'orb-count' }, [countLabel(photos, 'photo'), videos ? countLabel(videos, 'video') : null, places ? countLabel(places, 'place') : null].filter(Boolean).join('  ·  ')),
      h('div', { class: 'orb-copy' },
        headline(),
        h('div', { class: 'orb-links' }, h('a', { class: 'cta', href: '#/gallery' }, 'Browse Gallery', h('span', { 'aria-hidden': 'true' }, ' →')), h('a', { class: 'ghost', href: '#/albums' }, 'Albums'))),
      ),
    tops.length ? h('section', { class: 'band' }, h('div', { class: 'band-head' }, h('h2', {}, 'Albums'), h('a', { href: '#/albums' }, 'All albums →')), h('div', { class: 'cards' }, tops.map(albumCard))) : null,
    h('section', { class: 'band', 'aria-labelledby': 'recent' }, h('div', { class: 'band-head' }, h('h2', { id: 'recent' }, 'Latest'), h('a', { href: '#/gallery' }, 'See everything →')), latest.length ? grid(latest, '#/') : empty('The archive is waiting for its first photo.')),
    cats.length ? h('section', { class: 'band', 'aria-labelledby': 'cats-h' }, h('div', { class: 'band-head' }, h('h2', { id: 'cats-h' }, 'Browse by subject'), h('a', { href: '#/gallery' }, 'All work →')), h('div', { class: 'cats' }, cats.map(catTile))) : null,
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
    const { list, found } = runSearch(p);
    setList(list, cur.base);
    drawChips(); drawAssist(found, list);
    const keys = Object.keys(p).filter((k) => labels[k] && p[k]);
    nActive.textContent = keys.filter((k) => k !== 'cat').length || '';
    active.replaceChildren(...keys.filter((k) => !((k === 'q' || k === 'mood') && found?.chips.length)).map((k) => h('button', { class: 'chip', type: 'button', 'aria-label': 'Remove filter ' + labels[k] + ': ' + p[k],
      onclick: () => { const s = $('#f-' + k); if (s) s.value = ''; if (k === 'q') $('#q').value = ''; set(k, ''); } }, k === 'month' ? monthName(+p[k]) : k === 'like' ? 'this photo' : p[k])));
    count.textContent = countLabel(list.length, p.like ? 'similar photo' : 'result') + (p.q || p.mood ? ` for “${[p.q, p.mood].filter(Boolean).join(' ')}”` : '');
    results.replaceChildren(list.length ? grid(list, cur.base) : empty('No matches. Try clearing a filter.'));
    layoutGrids();
  }
  const moods = VIS ? Vision.moodSuggestions(ALL, VIS) : [];
  const bar = h('div', { class: 'filters' },
    select('Album', 'f-album', p.album, DB.albums.map((a) => [a.id, (a.parent ? '— ' : '') + a.name]), (v) => set('album', v)),
    select('Tag', 'f-tag', p.tag, tags.map(([t, n]) => [t, `${t} (${n})`]), (v) => set('tag', v)),
    select('Year', 'f-year', p.year, years.map((y) => [y, y]), (v) => set('year', v)),
    select('Month', 'f-month', p.month, Array.from({ length: 12 }, (_, i) => [i + 1, monthName(i + 1)]), (v) => set('month', v)),
    select('Location', 'f-place', p.place, places.map((x) => [x, x]), (v) => set('place', v)),
    select('Camera', 'f-camera', p.camera, cams.map((x) => [x, x]), (v) => set('camera', v)),
    ...(moods.length ? [select('Mood', 'f-mood', p.mood, moods.map((m) => [m.label.toLowerCase(), m.label]), (v) => set('mood', v))] : []),
    h('select', { id: 'f-sort', 'aria-label': 'Sort', onchange: (e) => set('sort', e.target.value === 'newest' ? '' : e.target.value) },
      [['newest', 'Newest first'], ['oldest', 'Oldest first'], ['name', 'File name']].map(([v, t]) => h('option', { value: v, selected: (p.sort || 'newest') === v }, t))),
    h('a', { class: 'clear', href: '#/gallery' }, 'Clear all'));
  const labels = { cat: 'Category', tag: 'Tag', album: 'Album', year: 'Year', month: 'Month', place: 'Location', camera: 'Camera', q: 'Search', mood: 'Mood', like: 'Looks like', color: 'Color' };
  const active = h('div', { class: 'active', 'aria-label': 'Active filters' });
  const nActive = h('span', { class: 'n' });
  const panel = h('details', { class: 'filter-panel' }, h('summary', {}, 'Filters', nActive), bar);
  panel.open = innerWidth > 760 || Object.keys(p).some((k) => k !== 'sort' && k !== 'cat' && p[k]);
  // The assistant: says how it read the search, lets you drop any part of it, and is honest about words it could not match.
  const assist = h('div', { class: 'assist', 'aria-live': 'polite' });
  function drawAssist(found, list) {
    const kids = [];
    if (p.like && VIS?.get(p.like)) {
      const it = BY_ID.get(p.like);
      kids.push(h('p', { class: 'assist-line' }, it ? h('img', { class: 'assist-thumb', src: mediaUrl(it, 'thumb.webp'), alt: '' }) : null, 'Photos that look like this one: similar palette, light and mood. ', h('button', { type: 'button', class: 'linkish', onclick: () => set('like', '') }, 'Clear')));
    } else if (found?.chips.length) {
      kids.push(h('p', { class: 'assist-line' }, 'I read that as: ', ...found.chips.map((c) => h('button', { type: 'button', class: 'chip understood', 'data-kind': c.kind, title: 'Remove this from the search', 'aria-label': `Remove ${c.kind} ${c.label}`,
        onclick: () => { if (c.kind === 'mood' && p.mood && c.tokens[0] === p.mood) { const m = $('#f-mood'); if (m) m.value = ''; set('mood', ''); } else if (c.tokens[0].startsWith('#') && p.color) set('color', ''); else set('q', Vision.dropToken(p.q || '', c.tokens[0])); const sb = $('#q'); if (sb) sb.value = p.q || ''; } },
        c.swatch ? h('i', { class: 'sw', style: `background:${c.swatch}` }) : null, c.label, h('span', { 'aria-hidden': 'true' }, ' ×')))));
    }
    if (found && (!list.length || found.unmatched.length)) {
      const place = places[0]?.split(',')[0], year = years[0], looks = (VIS ? Vision.moodSuggestions(ALL, VIS).slice(0, 2).map((m) => m.label.toLowerCase()) : []);
      kids.push(h('p', { class: 'assist-note' }, `Try a look, color, place or date, like ${[looks[0] && `“${looks[0]}”`, looks[1] && `“${looks[1]} green”`, place && `“${place}”`, year && `“${year}”`].filter(Boolean).join(', ')}.`));
    }
    assist.replaceChildren(...kids);
  }

  const page = h('div', { class: 'page' }, pageHead('Gallery'), chips, panel, active, assist, count, results);
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
    }) : empty('No albums yet.'),
    feelCollections());
}

/** Groups made by how the photos look (see js/vision.js collections): shown under the albums, each a one-click search. */
function feelCollections() {
  const cols = Vision.collections(ALL, VIS, { strength: 0.65, max: 8 });
  if (!cols.length) return null;
  const used = new Set();
  return h('section', { class: 'band feel', 'aria-labelledby': 'feel-h' }, h('div', { class: 'band-head' }, h('h2', { id: 'feel-h' }, 'Collections by feel')),
    h('p', { class: 'muted feel-note' }, 'Grouped automatically by how the photos look: color, light and mood. Click one to search it.'),
    h('div', { class: 'cards' }, cols.map((c) => {
      const cover = c.items.find((i) => !used.has(i.id)) || c.items[0], pal = VIS.get(cover.id)?.pal || []; // a different cover for each collection
      used.add(cover.id);
      return h('a', { class: 'card', href: link('gallery', { mood: c.label.toLowerCase() }) },
        h('div', { class: 'card-img' }, h('img', { src: mediaUrl(cover, 'medium.webp'), srcset: `${mediaUrl(cover, 'thumb.webp')} ${natW(cover, 'thumb')}w, ${mediaUrl(cover, 'medium.webp')} ${natW(cover, 'medium')}w`, sizes: '(min-width: 900px) 380px, 90vw', alt: '', loading: 'lazy', decoding: 'async' })),
        h('div', { class: 'card-body' }, h('h3', {}, c.label), h('p', { class: 'muted' }, countLabel(c.items.length, 'photo')), h('div', { class: 'pal-bar small', 'aria-hidden': 'true' }, pal.map((p) => h('i', { style: `background:${p.hex};flex:${p.pct}` })))));
    })));
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

/**
 * Every photo and video in one gapless mosaic, like zooming out in Photos. The order still snakes (left to right, then right
 * to left), so each row picks up exactly where the last one ended. Zoom with + / -, Ctrl+scroll or a pinch: tiles glide.
 */
function pageTimeline(q) {
  const order = q.get('order') === 'oldest' ? 'oldest' : 'newest';
  // The line starts at the heart of the trunk and winds outward. By default the oldest photo is at the heart and the newest on the bark.
  const list = ALL.slice().sort(order === 'oldest' ? SORTS.newest : SORTS.oldest);
  const base = order === 'oldest' ? '#/timeline?order=oldest' : '#/timeline';
  setList(list, base);
  const store = { get: () => { try { const r = localStorage.getItem('va-flow3'); return r === null ? NaN : +r; } catch { return NaN; } }, set: (v) => { try { localStorage.setItem('va-flow3', v); } catch { /* fine */ } } }; // zoom, 0 (all the years at a glance) to 1 (big pictures)
  // wrap scrolls sideways when the trunk is wider than the page
  const stage = h('div', { class: 'flow', role: 'list', 'aria-label': 'Timeline of photos and videos, winding outward from the centre like tree rings' });
  const wrap = h('div', { class: 'flow-wrap' }, stage);
  const NS = 'http://www.w3.org/2000/svg';
  const svgEl = (tag, attrs = {}) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
  const bark = svgEl('svg', { class: 'flow-bark', 'aria-hidden': 'true' });

  let prev = null;
  const labels = [];
  const tiles = list.map((it) => {
    const key = it.year * 100 + it.month, newMonth = key !== prev, newYear = prev === null || Math.floor(prev / 100) !== it.year;
    prev = key;
    const a = h('a', { class: 'flow-tile', role: 'listitem', href: withV(base, it.id), title: [it.title, it.taken?.local && fmtDay(it)].filter(Boolean).join(' · ') || it.file, 'aria-label': (it.title || it.file) + (it.taken?.local ? ', ' + fmtDay(it) : '') },
      h('img', { src: mediaUrl(it, 'thumb.webp'), alt: '', loading: 'lazy', decoding: 'async', draggable: 'false' }));
    if (newMonth) labels.push([a, h('span', { class: 'flow-label' + (newYear ? ' yr' : ''), 'aria-hidden': 'true' }, monthName(it.month, 'short'), newYear ? h('b', {}, ' ' + it.year) : null)]);
    if (it.type === 'video') a.append(h('span', { class: 'badge', html: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>' }));
    a.addEventListener('contextmenu', (ev) => ev.preventDefault());
    a.addEventListener('click', (ev) => { if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button) return; ev.preventDefault(); nav(a.getAttribute('href'), { lb: true }); });
    return a;
  });
  const labelOf = new Map(labels);
  stage.append(bark, ...tiles, ...labels.map(([, l]) => l)); // bark, roots and wood under the tiles; labels over them

  const centres = []; // tile centres in stage pixels, for the date pill
  let ringH = 100, cxS = 0, cyS = 0, curS = 0; // the trunk's centre and ring thickness, so zooming can keep the middle where it is
  const n = tiles.length, TAU = Math.PI * 2, th0 = -Math.PI / 2; // start at the top, wind clockwise
  const plan = (s) => {
    const r0 = s * 0.75, BARK = Math.max(24, s * 0.5), rs = (t) => r0 + (s * (t - th0)) / TAU; // Archimedean spiral: the line moves out by one tile per turn
    let th = th0; const span = [];
    for (let i = 0; i < n; i++) { // each photo takes the stretch of the band, between this turn and the next, that is about one tile long
      let dth = s / (rs(th) + s / 2); dth = s / (rs(th + dth / 2) + s / 2);
      span.push([th, th + dth]); th += dth;
    }
    const rEnd = rs(th) + s;
    return { s, BARK, rs, span, th, rEnd, trunk: Math.ceil((rEnd + BARK * 1.45 + 8) * 2) }; // trunk: its diameter, bark included
  };
  const bounds = () => (wrap.clientWidth < 520 ? [25, 142] : [34, 190]); // ring thickness range in px
  const sOf = (t, lo, hi) => lo * (hi / lo) ** t, tOf = (s, lo, hi) => Math.log(s / lo) / Math.log(hi / lo); // zoom is spread evenly in how big things look
  const fitSize = (W, lo, hi) => { const goal = W * 0.62; if (plan(lo).trunk >= goal) return lo; if (plan(hi).trunk <= goal) return hi; let x = lo, y = hi; for (let i = 0; i < 24; i++) { const m = (x + y) / 2; if (plan(m).trunk > goal) y = m; else x = m; } return x; }; // the size at which the trunk leaves room for roots either side
  let tNow = null;
  let barkS = 0, barkCx = 0, barkCy = 0; // what the bark was last drawn at, so zooming can scale it cheaply
  function layout(quick = false) { // quick: only the photos are redone; the bark is scaled to match and redrawn crisply once zooming pauses
    const W = wrap.clientWidth;
    if (!W) return;
    const [lo, hi] = bounds();
    if (tNow === null) { const raw = store.get(); tNow = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : tOf(fitSize(W, lo, hi), lo, hi); } // first visit: the size that fits this screen
    const { s, BARK, rs, span, rEnd, trunk } = plan(sOf(tNow, lo, hi));
    const SW = Math.ceil(Math.max(W, trunk + BARK * 8)), SH = Math.ceil(trunk + BARK * 10.5), cx = SW / 2, cy = SH / 2; // the stage is as wide as the page, so roots can run all the way to its edges
    cxS = cx; cyS = cy; curS = s;
    ringH = s; centres.length = 0;
    tiles.forEach((a, i) => {
      // The photo is exactly the piece of the band between two radial lines and the spiral above and below: neighbours share every edge, so nothing shows between them.
      const [ta, tb] = span[i], K = Math.max(2, Math.ceil((tb - ta) / 0.1)), np = (K + 1) * 2, xs = new Array(np), ys = new Array(np);
      let sx = 0, sy = 0;
      for (let k = 0; k <= K; k++) { // outer edge going one way, inner edge coming back
        const t = ta + ((tb - ta) * k) / K, c = Math.cos(t), sn = Math.sin(t), ro = rs(t) + s, ri = ro - s, j = np - 1 - k;
        xs[k] = cx + ro * c; ys[k] = cy + ro * sn; xs[j] = cx + ri * c; ys[j] = cy + ri * sn; sx += xs[k] + xs[j]; sy += ys[k] + ys[j];
      }
      const mx = sx / np, my = sy / np;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let j = 0; j < np; j++) { // 0.6px of overlap hides hairlines between neighbours
        const dx = xs[j] - mx, dy = ys[j] - my, d = Math.hypot(dx, dy) || 1;
        xs[j] += (dx / d) * 0.6; ys[j] += (dy / d) * 0.6;
        if (xs[j] < x0) x0 = xs[j]; if (xs[j] > x1) x1 = xs[j]; if (ys[j] < y0) y0 = ys[j]; if (ys[j] > y1) y1 = ys[j];
      }
      let poly = '';
      for (let j = 0; j < np; j++) poly += (j ? ',' : '') + (xs[j] - x0).toFixed(1) + 'px ' + (ys[j] - y0).toFixed(1) + 'px';
      const st = a.style;
      st.left = x0.toFixed(1) + 'px'; st.top = y0.toFixed(1) + 'px'; st.width = (x1 - x0).toFixed(1) + 'px'; st.height = (y1 - y0).toFixed(1) + 'px';
      st.clipPath = `polygon(${poly})`;
      const tm = (ta + tb) / 2, rm = rs(tm) + s / 2, x = cx + rm * Math.cos(tm), y = cy + rm * Math.sin(tm);
      centres.push([x, y]);
      const lab = labelOf.get(a);
      if (lab) { lab.style.left = x.toFixed(1) + 'px'; lab.style.top = y.toFixed(1) + 'px'; }
    });
    stage.style.width = SW + 'px'; stage.style.height = SH + 'px';
    stage.classList.toggle('dense', s < 60);
    if (quick && barkS) { bark.style.transformOrigin = `${barkCx}px ${barkCy}px`; bark.style.transform = `translate(${cx - barkCx}px, ${cy - barkCy}px) scale(${s / barkS})`; }
    else { drawBark(cx, cy, rEnd, BARK, SW, SH); barkS = s; barkCx = cx; barkCy = cy; bark.style.transform = ''; }
    if (SW > W) wrap.scrollLeft = (SW - W) / 2; // wide trunks open centred
    paintSlider();
    pillUpdate();
  }

  // The trunk seen from above: pale wood under the rings, a dark wobbly band of bark around them, and a few thick roots flaring out of it.
  function drawBark(cx, cy, rEnd, B, SW, SH) {
    bark.replaceChildren(); bark.setAttribute('viewBox', `0 0 ${SW} ${SH}`); bark.setAttribute('width', SW); bark.setAttribute('height', SH);
    let seed = (tiles.length * 2654435761) >>> 0; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296); // fixed seed: the same trunk every visit
    const ph = [rnd() * 6.28, rnd() * 6.28, rnd() * 6.28, rnd() * 6.28];
    const wob = (a, amp) => amp * (0.55 * Math.sin(3 * a + ph[0]) + 0.3 * Math.sin(5 * a + ph[1]) + 0.2 * Math.sin(8 * a + ph[2]) + 0.12 * Math.sin(13 * a + ph[3]));
    const ring = (r, amp, steps = 120) => { let d = ''; for (let k = 0; k <= steps; k++) { const a = (k / steps) * Math.PI * 2, rr = r + wob(a, amp); d += `${k ? 'L' : 'M'}${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`; } return d + 'Z'; };
    const inner = rEnd + 3, outer = rEnd + B * 1.45, pt = (r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    const gGround = svgEl('g'), gMid = svgEl('g'), gTop = svgEl('g'), rootPts = []; // rootPts: points along every root with its half-width, so the scenery keeps clear of them
    bark.append(gGround, gMid);
    bark.append(svgEl('circle', { cx, cy, r: inner, class: 'wood' }));
    bark.append(svgEl('path', { d: ring(outer, B * 0.22) + ring(inner, B * 0.06), 'fill-rule': 'evenodd', class: 'bark-fill' }));
    for (const [r, amp, w, cls] of [[outer - B * 0.36, B * 0.18, 1.6, 'bark-mid'], [outer - B * 0.7, B * 0.12, 1.2, 'bark-mid'], [inner, B * 0.06, 2, 'bark-edge'], [outer, B * 0.22, 3, 'bark-edge']]) bark.append(svgEl('path', { d: ring(r, amp), class: cls, 'stroke-width': w }));
    let marks = ''; // short, slightly slanted bark furrows
    for (let k = 0; k < 150; k++) {
      const a = rnd() * Math.PI * 2, r1 = inner + B * (0.18 + rnd() * 0.3), len = B * (0.25 + rnd() * 0.5), sl = (rnd() - 0.5) * 0.09, w = wob(a, B * 0.12);
      marks += `M${(cx + (r1 + w) * Math.cos(a)).toFixed(1)},${(cy + (r1 + w) * Math.sin(a)).toFixed(1)}L${(cx + (r1 + w + len) * Math.cos(a + sl)).toFixed(1)},${(cy + (r1 + w + len) * Math.sin(a + sl)).toFixed(1)}`;
    }
    bark.append(svgEl('path', { d: marks, class: 'bark-mid', 'stroke-width': 1.3, 'stroke-linecap': 'round' }));

    // roots: thick, winding flares that leave the bark, twist as they grow, fork, and taper to rounded tips. Each one steers by a changing heading,
    // so it can wander without swinging round the trunk. Drawn over the bark's outer edge so they grow out of it.
    const root = (ox, oy, dir, L, wBase, bend, wind, depth = 0) => {
      const N = Math.max(44, Math.min(130, Math.round(L / 9))), C = [], heading = [], ph = rnd() * 6.28, waves = (1.3 + rnd() * 1.3) * Math.max(1, L / (B * 7)); // longer roots wander more
      const wAt = (k) => { const t = k / N; return wBase * (0.2 + 0.8 * Math.pow(1 - t, 1.1)) * Math.sqrt(Math.max(0, 1 - t ** 6)) * (1 + 0.1 * Math.sin(t * 13 + ph)) + 1.4; }; // thick at the trunk, then a long tapering tail; a little knobbly, rounded tip
      let x = ox, y = oy;
      for (let k = 0; k <= N; k++) {
        const t = k / N, a = dir + bend * t + wind * Math.sin(t * Math.PI * 2 * waves + ph) * Math.min(1, t * 5);
        C.push([x, y]); heading.push(a); x += (L / N) * Math.cos(a); y += (L / N) * Math.sin(a);
      }
      for (let k = 0; k <= N; k += 2) rootPts.push([C[k][0], C[k][1], wAt(k)]);
      const edge = (side) => C.map(([px, py], k) => { const [x2, y2] = C[Math.min(N, k + 1)], [x1, y1] = C[Math.max(0, k - 1)], d = Math.hypot(x2 - x1, y2 - y1) || 1, w = wAt(k); return [px + (-(y2 - y1) / d) * w * side, py + ((x2 - x1) / d) * w * side]; });
      const Lp = edge(1), Rp = edge(-1), P = (a) => a.map(([px, py], k) => `${k ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('');
      bark.append(svgEl('path', { d: P(Lp) + P(Rp.slice().reverse()).replace('M', 'L') + 'Z', class: 'bark-fill root-fill' }));
      bark.append(svgEl('path', { d: P(Lp.slice(3)), class: 'bark-edge', 'stroke-width': 2.6, 'stroke-linecap': 'round', fill: 'none' }), svgEl('path', { d: P(Rp.slice(3)), class: 'bark-edge', 'stroke-width': 2.6, 'stroke-linecap': 'round', fill: 'none' }));
      for (const off of [-0.5, -0.18, 0.18, 0.5]) bark.append(svgEl('path', { d: C.slice(2, N - 3).map(([px, py], k) => { const i = k + 2, [x2, y2] = C[i + 1], [x1, y1] = C[i - 1], d = Math.hypot(x2 - x1, y2 - y1) || 1, w = wAt(i) * off; return `${k ? 'L' : 'M'}${(px + (-(y2 - y1) / d) * w).toFixed(1)},${(py + ((x2 - x1) / d) * w).toFixed(1)}`; }).join(''), class: 'bark-mid', 'stroke-width': 1.3, fill: 'none', 'stroke-linecap': 'round' }));
      if (depth < 2) { // smaller roots forking off, each starting exactly on its parent and twisting in its own way
        const fork = (frac, side, lenK, widK) => { const i = Math.round(N * frac); root(C[i][0], C[i][1], heading[i] + side * (0.5 + rnd() * 0.3), L * lenK, wBase * widK, side * (0.3 + rnd() * 0.4), 0.5 + rnd() * 0.4, depth + 1); };
        fork(0.3, 1, 0.62, 0.55);
        if (depth === 0 && L > B * 5) fork(0.6, -1, 0.5, 0.36);
      }
    };
    // eight roots spread round the trunk. Each runs until it reaches the edge of the stage (the edge of the page, sideways), winding as it goes.
    const reach = (ox, oy, a) => { const dx = Math.cos(a), dy = Math.sin(a), tx = dx > 0.001 ? (SW - ox) / dx : dx < -0.001 ? -ox / dx : Infinity, ty = dy > 0.001 ? (SH - oy) / dy : dy < -0.001 ? -oy / dy : Infinity; return Math.max(B * 3, Math.min(tx, ty)); };
    // nine roots at random spots (a fixed seed, so it is the same trunk every visit): some bunch together, some leave a wide gap, and each has its own thickness
    const gaps = Array.from({ length: 9 }, () => 0.42 + rnd() * 1.0), gapSum = gaps.reduce((x, y) => x + y, 0);
    let ang = rnd() * Math.PI * 2;
    gaps.forEach((g, i) => {
      ang += (g / gapSum) * Math.PI * 2;
      const wK = 0.85 + rnd() * 0.55, [ox, oy] = pt(outer - B * 0.8 + wob(ang, B * 0.22), ang), side = i % 2 ? -1 : 1;
      root(ox, oy, ang, reach(ox, oy, ang) * (1.12 + rnd() * 0.08), B * wK * 2.0, side * (0.15 + rnd() * 0.3), 0.6 + rnd() * 0.35); // the extra length makes up for the wandering, so the tip really gets there
    });
    // ---- the ground around the trunk, seen from above: soil along the roots, grass, plants, flowers, mushrooms, and a few insects.
    // Everything is placed near the roots (never on them), from the same fixed seed, so the scene is the same every visit.
    const u = Math.max(14, B * 0.62), K = Math.min(2.4, Math.max(0.7, (SW * SH) / (1280 * 1058))) * 1.5;
    const P2 = (v) => v.toFixed(1), R = (a, b) => a + rnd() * (b - a), pick = (a) => a[Math.floor(rnd() * a.length)];
    const grp = (x, y, rot = 0, sc = 1) => svgEl('g', { transform: `translate(${P2(x)} ${P2(y)}) rotate(${P2(rot)}) scale(${sc.toFixed(2)})` });
    const add = (g, ...kids) => { for (const k of kids) g.append(k); return g; };
    const blob = (x, y, r, irr = 0.3, n = 12) => { // a soft irregular patch
      const p = Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2, rr = r * (1 - irr / 2 + rnd() * irr); return [x + rr * Math.cos(a), y + rr * Math.sin(a)]; });
      const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], m0 = mid(p[n - 1], p[0]);
      return `M${P2(m0[0])},${P2(m0[1])}` + p.map((q, i) => { const m = mid(q, p[(i + 1) % n]); return `Q${P2(q[0])},${P2(q[1])} ${P2(m[0])},${P2(m[1])}`; }).join('') + 'Z';
    };
    const grass = (x, y) => { const g = grp(x, y, R(0, 360), R(0.8, 1.3)); const n = 8 + Math.floor(rnd() * 6); for (let i = 0; i < n; i++) { const l = u * R(0.9, 1.7), c = (rnd() - 0.5) * l * 0.5; add(g, add(svgEl('g', { transform: `rotate(${P2((i / n) * 360 + R(-14, 14))})` }), svgEl('path', { d: `M0,-1.5Q${P2(l * 0.5)},${P2(-1.5 + c)} ${P2(l)},${P2(c)}Q${P2(l * 0.5)},${P2(1.5 + c)} 0,1.5Z`, class: i % 2 ? 'grassA' : 'grassB' }))); } return g; };
    const plant = (x, y) => { const g = grp(x, y, R(0, 360), R(0.85, 1.25)), n = 6 + Math.floor(rnd() * 3), l = u * R(1.3, 1.9); for (let i = 0; i < n; i++) add(g, add(svgEl('g', { transform: `rotate(${P2((i / n) * 360 + R(-8, 8))})` }), svgEl('path', { d: `M0,0C${P2(l * 0.3)},${P2(-l * 0.3)} ${P2(l * 0.75)},${P2(-l * 0.3)} ${P2(l)},0C${P2(l * 0.75)},${P2(l * 0.3)} ${P2(l * 0.3)},${P2(l * 0.3)} 0,0Z`, class: i % 2 ? 'leafA' : 'leafB' }), svgEl('path', { d: `M${P2(l * 0.1)},0L${P2(l * 0.85)},0`, class: 'vein' }))); return g; };
    const clover = (x, y) => { const g = grp(x, y, R(0, 360), R(0.8, 1.2)); for (const a of [0, 120, 240]) add(g, svgEl('circle', { cx: P2(u * 0.4 * Math.cos((a * Math.PI) / 180)), cy: P2(u * 0.4 * Math.sin((a * Math.PI) / 180)), r: P2(u * 0.36), class: 'leafA' })); return g; };
    const shadow = (rx, ry, dx = 1.6, dy = 2.6) => svgEl('ellipse', { cx: P2(dx), cy: P2(dy), rx: P2(rx), ry: P2(ry), class: 'shade' });
    const flower = (x, y) => { const g = grp(x, y, R(0, 360), R(0.8, 1.25)), col = pick(['#f4a6c0', '#f7d44c', '#ffffff', '#b99be0', '#f08a4b', '#e86a8a']), n = 5 + Math.floor(rnd() * 3); add(g, shadow(u * 0.85, u * 0.85)); for (let i = 0; i < n; i++) add(g, add(svgEl('g', { transform: `rotate(${P2((i / n) * 360)}) translate(${P2(u * 0.5)} 0)` }), svgEl('ellipse', { rx: P2(u * 0.5), ry: P2(u * 0.27), fill: col, stroke: 'rgb(60 40 30 / .3)', 'stroke-width': 0.8 }))); add(g, svgEl('circle', { r: P2(u * 0.22), fill: col === '#f7d44c' ? '#b8741a' : '#f2c230', stroke: 'rgb(60 40 30 / .35)', 'stroke-width': 0.8 })); return g; };
    const mushroom = (x, y) => { const g = grp(x, y, R(0, 360), R(0.8, 1.3)), kind = pick([['#c9372c', '#fff'], ['#c9372c', '#fff'], ['#a9744a', '#d8b98f'], ['#d9c3a0', '#a88a62']]), r = u * 0.75; add(g, shadow(r, r, 2, 3), svgEl('circle', { r: P2(r), fill: kind[0], stroke: 'rgb(30 15 10 / .45)', 'stroke-width': 1.4 }), svgEl('circle', { r: P2(r * 0.62), fill: 'none', stroke: 'rgb(0 0 0 / .12)', 'stroke-width': 1 }), svgEl('ellipse', { cx: P2(-r * 0.3), cy: P2(-r * 0.32), rx: P2(r * 0.3), ry: P2(r * 0.17), fill: 'rgb(255 255 255 / .28)', transform: 'rotate(-35)' })); for (let i = 0; i < 6; i++) { const a = rnd() * 6.28, d = r * R(0.15, 0.7); add(g, svgEl('circle', { cx: P2(d * Math.cos(a)), cy: P2(d * Math.sin(a)), r: P2(r * R(0.08, 0.16)), fill: kind[1], opacity: 0.92 })); } return g; };
    const ladybug = (x, y) => { const g = grp(x, y, R(0, 360), R(0.8, 1.1)); add(g, shadow(u * 0.5, u * 0.6)); for (const s of [-1, 1]) for (const k of [-0.25, 0.1, 0.4]) add(g, svgEl('path', { d: `M${P2(s * u * 0.4)},${P2(u * k)}l${P2(s * u * 0.28)},${P2(u * 0.14)}`, class: 'legs' })); add(g, svgEl('ellipse', { rx: P2(u * 0.46), ry: P2(u * 0.56), fill: '#d52a1f', stroke: '#1a0e0b', 'stroke-width': 1.3 }), svgEl('path', { d: `M0,${P2(-u * 0.5)}L0,${P2(u * 0.56)}`, stroke: '#1a0e0b', 'stroke-width': 1.2 }), svgEl('circle', { cy: P2(-u * 0.6), r: P2(u * 0.24), fill: '#1a0e0b' }), svgEl('ellipse', { cx: P2(-u * 0.1), cy: P2(-u * 0.12), rx: P2(u * 0.1), ry: P2(u * 0.18), fill: 'rgb(255 255 255 / .35)' })); for (const [sx, sy] of [[-0.24, -0.22], [0.24, -0.22], [-0.27, 0.12], [0.27, 0.12], [-0.14, 0.38], [0.14, 0.38]]) add(g, svgEl('circle', { cx: P2(u * sx), cy: P2(u * sy), r: P2(u * 0.09), fill: '#1a0e0b' })); return g; };
    const butterfly = (x, y) => {
      const g = grp(x, y, R(0, 360), R(1, 1.5)), c = pick([['#f0892f', '#2b1a10'], ['#4f8fe0', '#101c36'], ['#f4d24a', '#3a2a08'], ['#c46bd6', '#2a1033']]);
      const wing = (s) => add(svgEl('g', { transform: `scale(${s} 1)` }), svgEl('path', { d: `M0,0C${P2(u * 0.3)},${P2(-u * 0.95)} ${P2(u * 1.35)},${P2(-u * 1.15)} ${P2(u * 1.25)},${P2(-u * 0.2)}C${P2(u * 1.1)},${P2(u * 0.15)} ${P2(u * 0.4)},${P2(u * 0.1)} 0,0Z`, fill: c[0], stroke: c[1], 'stroke-width': 1.3 }), svgEl('path', { d: `M0,0C${P2(u * 0.5)},${P2(u * 0.1)} ${P2(u * 1.05)},${P2(u * 0.5)} ${P2(u * 0.72)},${P2(u * 0.98)}C${P2(u * 0.4)},${P2(u * 1.12)} ${P2(u * 0.1)},${P2(u * 0.5)} 0,0Z`, fill: c[0], stroke: c[1], 'stroke-width': 1.3, opacity: 0.95 }), svgEl('circle', { cx: P2(u * 0.82), cy: P2(-u * 0.5), r: P2(u * 0.14), fill: 'rgb(255 255 255 / .8)' }), svgEl('circle', { cx: P2(u * 0.55), cy: P2(u * 0.62), r: P2(u * 0.09), fill: 'rgb(255 255 255 / .7)' }), svgEl('path', { d: `M${P2(u * 0.15)},${P2(-u * 0.3)}C${P2(u * 0.5)},${P2(-u * 0.7)} ${P2(u * 0.9)},${P2(-u * 0.75)} ${P2(u * 1.05)},${P2(-u * 0.35)}`, fill: 'none', stroke: c[1], 'stroke-width': 0.9, opacity: 0.55 }));
      return add(g, shadow(u * 1.1, u * 0.7, 6, 8), wing(1), wing(-1), svgEl('ellipse', { ry: P2(u * 0.5), rx: P2(u * 0.09), cy: P2(u * 0.05), fill: c[1] }), svgEl('path', { d: `M0,${P2(-u * 0.48)}Q${P2(-u * 0.2)},${P2(-u * 0.85)} ${P2(-u * 0.4)},${P2(-u * 0.9)}M0,${P2(-u * 0.48)}Q${P2(u * 0.2)},${P2(-u * 0.85)} ${P2(u * 0.4)},${P2(-u * 0.9)}`, fill: 'none', stroke: c[1], 'stroke-width': 0.9 }));
    };
    const bee = (x, y) => { const g = grp(x, y, R(0, 360), R(0.9, 1.15)); return add(g, shadow(u * 0.5, u * 0.7, 5, 7), svgEl('ellipse', { cx: P2(-u * 0.38), cy: P2(-u * 0.12), rx: P2(u * 0.5), ry: P2(u * 0.24), fill: 'rgb(235 245 255 / .75)', stroke: 'rgb(60 70 90 / .45)', 'stroke-width': 0.8, transform: `rotate(-25 ${P2(-u * 0.2)} 0)` }), svgEl('ellipse', { cx: P2(u * 0.38), cy: P2(-u * 0.12), rx: P2(u * 0.5), ry: P2(u * 0.24), fill: 'rgb(235 245 255 / .75)', stroke: 'rgb(60 70 90 / .45)', 'stroke-width': 0.8, transform: `rotate(25 ${P2(u * 0.2)} 0)` }), svgEl('ellipse', { cy: P2(u * 0.3), rx: P2(u * 0.3), ry: P2(u * 0.5), fill: '#f2c230', stroke: '#2a1c06', 'stroke-width': 1.1 }), svgEl('path', { d: `M${P2(-u * 0.29)},${P2(u * 0.2)}Q0,${P2(u * 0.28)} ${P2(u * 0.29)},${P2(u * 0.2)}M${P2(-u * 0.27)},${P2(u * 0.46)}Q0,${P2(u * 0.54)} ${P2(u * 0.27)},${P2(u * 0.46)}`, fill: 'none', stroke: '#2a1c06', 'stroke-width': 3 }), svgEl('circle', { cy: P2(-u * 0.18), r: P2(u * 0.24), fill: '#3a2a10' }), svgEl('circle', { cy: P2(-u * 0.5), r: P2(u * 0.16), fill: '#2a1c06' })); };
    const beetle = (x, y) => { const g = grp(x, y, R(0, 360), R(0.8, 1.1)); return add(g, shadow(u * 0.4, u * 0.55), svgEl('ellipse', { rx: P2(u * 0.38), ry: P2(u * 0.56), fill: '#1f4a36', stroke: '#08150f', 'stroke-width': 1.2 }), svgEl('path', { d: `M0,${P2(-u * 0.4)}L0,${P2(u * 0.55)}`, stroke: '#08150f', 'stroke-width': 1 }), svgEl('ellipse', { cx: P2(-u * 0.14), cy: P2(-u * 0.05), rx: P2(u * 0.08), ry: P2(u * 0.22), fill: 'rgb(180 255 220 / .35)' }), svgEl('circle', { cy: P2(-u * 0.62), r: P2(u * 0.2), fill: '#08150f' })); };

    const near = (top) => { // a spot outside the trunk: half the time close to a root, half the time anywhere on the ground; clear of every root body when `top` is set
      for (let tries = 0; tries < 30; tries++) {
        let x, y;
        if (rnd() < 0.5) { const [rx, ry, w] = pick(rootPts), a = rnd() * Math.PI * 2, d = w + u * R(0.5, 3.2) + (top ? u * 0.4 : 0); x = rx + d * Math.cos(a); y = ry + d * Math.sin(a); }
        else { x = R(8, SW - 8); y = R(8, SH - 8); }
        if (x < 8 || y < 8 || x > SW - 8 || y > SH - 8 || Math.hypot(x - cx, y - cy) < outer + u * 0.4) continue;
        if (rootPts.some(([px, py, pw]) => Math.hypot(x - px, y - py) < pw + u * (top ? 0.75 : 0.25))) continue;
        return [x, y];
      }
      return null;
    };
    // ---- the ground: one soil bed under everything, then darker and lighter patches, speckles, and deeper shade hugging every root
    gGround.append(svgEl('rect', { x: 0, y: 0, width: SW, height: SH, class: 'soil' }));
    let dark = '', light = '', shade = '';
    for (let i = 0; i < Math.round(46 * K); i++) dark += blob(R(0, SW), R(0, SH), u * R(1.3, 3.6), 0.55);
    for (let i = 0; i < Math.round(30 * K); i++) light += blob(R(0, SW), R(0, SH), u * R(1.1, 3), 0.55);
    rootPts.forEach(([x, y, w], i) => { if (i % 4 === 0) shade += blob(x + R(-4, 4), y + R(-4, 4), w * 1.25 + u * 0.8, 0.5); });
    gGround.append(svgEl('path', { d: dark, class: 'soil2', opacity: 0.55 }), svgEl('path', { d: light, class: 'soil3', opacity: 0.6 }), svgEl('path', { d: shade, class: 'soil2', opacity: 0.8 }));
    let dotsA = '', dotsB = '';
    for (let i = 0; i < Math.round(380 * K); i++) { const x = R(2, SW - 2), y = R(2, SH - 2); if (Math.hypot(x - cx, y - cy) < outer) continue; if (i % 2) dotsA += `M${P2(x)} ${P2(y)}h.1`; else dotsB += `M${P2(x)} ${P2(y)}h.1`; }
    gGround.append(svgEl('path', { d: dotsA, class: 'speck1' }), svgEl('path', { d: dotsB, class: 'speck2' }));
    const pebble = (x, y, r) => add(grp(x, y, R(0, 180)), svgEl('ellipse', { cx: 1, cy: 1.4, rx: P2(r * 1.05), ry: P2(r * 0.8), class: 'shade' }), svgEl('ellipse', { rx: P2(r), ry: P2(r * R(0.66, 0.9)), class: pick(['pebble', 'pebble2', 'pebble3']), stroke: 'rgb(30 20 10 / .35)', 'stroke-width': 0.8 }), svgEl('ellipse', { cx: P2(-r * 0.28), cy: P2(-r * 0.25), rx: P2(r * 0.34), ry: P2(r * 0.2), fill: 'rgb(255 255 255 / .3)' }));
    for (let i = 0; i < Math.round(26 * K); i++) { // pebbles come in little clusters, big and small together
      const p = near(false); if (!p) continue;
      const n = 3 + Math.floor(rnd() * 5);
      for (let k = 0; k < n; k++) gGround.append(pebble(p[0] + R(-u * 1.1, u * 1.1), p[1] + R(-u * 1.1, u * 1.1), u * R(0.1, 0.34)));
    }
    for (let i = 0; i < Math.round(10 * K); i++) { const p = near(false); if (p) gGround.append(pebble(p[0], p[1], u * R(0.45, 0.8))); } // a few big stones
    const moss = (x, y) => { const g = grp(x, y, R(0, 360)); let d = ''; for (let k = 0; k < 4; k++) d += blob(R(-u, u), R(-u * 0.7, u * 0.7), u * R(0.5, 0.95), 0.5, 9); add(g, svgEl('path', { d, class: 'moss' })); for (let k = 0; k < 10; k++) add(g, svgEl('circle', { cx: P2(R(-u * 1.2, u * 1.2)), cy: P2(R(-u, u)), r: P2(u * R(0.05, 0.12)), fill: pick(['#9acb6e', '#7bb35a', '#b6dc8a']), opacity: 0.8 })); return g; };
    const twig = (x, y) => { const g = grp(x, y, R(0, 360), R(0.8, 1.4)), l = u * R(1.6, 3); return add(g, svgEl('path', { d: `M${P2(-l / 2)},0Q${P2(-l * 0.1)},${P2(R(-4, 4))} ${P2(l / 2)},${P2(R(-3, 3))}M${P2(-l * 0.05)},0l${P2(l * 0.18)},${P2(-u * 0.5)}M${P2(l * 0.2)},${P2(R(-1, 1))}l${P2(l * 0.14)},${P2(u * 0.4)}`, class: 'twig' }), svgEl('path', { d: `M${P2(-l / 2)},0Q${P2(-l * 0.1)},${P2(R(-4, 4))} ${P2(l / 2)},${P2(R(-3, 3))}`, class: 'twig2' })); };
    const fallen = (x, y) => { const g = grp(x, y, R(0, 360), R(0.9, 1.5)), l = u * 1.2, col = pick(['#b5651d', '#c98a2b', '#9a3b1e', '#7d8c2e', '#c4572a']); return add(g, shadow(l * 0.55, l * 0.3, 1.5, 2.2), svgEl('path', { d: `M${P2(-l * 0.5)},0C${P2(-l * 0.25)},${P2(-l * 0.42)} ${P2(l * 0.25)},${P2(-l * 0.42)} ${P2(l * 0.5)},0C${P2(l * 0.25)},${P2(l * 0.42)} ${P2(-l * 0.25)},${P2(l * 0.42)} ${P2(-l * 0.5)},0Z`, fill: col, stroke: 'rgb(40 20 8 / .45)', 'stroke-width': 0.9 }), svgEl('path', { d: `M${P2(-l * 0.62)},0L${P2(l * 0.42)},0M${P2(-l * 0.15)},0l${P2(l * 0.14)},${P2(-l * 0.18)}M${P2(l * 0.1)},0l${P2(l * 0.14)},${P2(l * 0.17)}`, fill: 'none', stroke: 'rgb(40 20 8 / .5)', 'stroke-width': 0.9, 'stroke-linecap': 'round' })); };
    const acorn = (x, y) => { const g = grp(x, y, R(0, 360)); return add(g, shadow(u * 0.32, u * 0.4, 1.5, 2.4), svgEl('ellipse', { rx: P2(u * 0.28), ry: P2(u * 0.38), fill: '#b8873f', stroke: 'rgb(40 20 8 / .5)', 'stroke-width': 0.9 }), svgEl('circle', { cy: P2(-u * 0.14), r: P2(u * 0.3), fill: '#7a5326', stroke: 'rgb(40 20 8 / .5)', 'stroke-width': 0.9 }), svgEl('path', { d: `M${P2(-u * 0.2)},${P2(-u * 0.18)}h${P2(u * 0.4)}M${P2(-u * 0.14)},${P2(-u * 0.05)}h${P2(u * 0.28)}`, stroke: 'rgb(30 15 5 / .4)', 'stroke-width': 0.8 }), svgEl('circle', { cy: P2(-u * 0.5), r: P2(u * 0.06), fill: '#4a3118' })); };
    const worm = (x, y) => { const g = grp(x, y, R(0, 360), R(0.8, 1.2)), l = u * 2; return add(g, svgEl('path', { d: `M${P2(-l / 2)},0C${P2(-l * 0.3)},${P2(-u * 0.7)} ${P2(-l * 0.1)},${P2(u * 0.7)} ${P2(l * 0.1)},0S${P2(l * 0.35)},${P2(-u * 0.6)} ${P2(l / 2)},${P2(-u * 0.1)}`, fill: 'none', stroke: 'rgb(40 20 10 / .3)', 'stroke-width': P2(u * 0.3), 'stroke-linecap': 'round', transform: 'translate(1.5 2)' }), svgEl('path', { d: `M${P2(-l / 2)},0C${P2(-l * 0.3)},${P2(-u * 0.7)} ${P2(-l * 0.1)},${P2(u * 0.7)} ${P2(l * 0.1)},0S${P2(l * 0.35)},${P2(-u * 0.6)} ${P2(l / 2)},${P2(-u * 0.1)}`, fill: 'none', stroke: '#c98a86', 'stroke-width': P2(u * 0.26), 'stroke-linecap': 'round' }), svgEl('path', { d: `M${P2(l * 0.28)},${P2(-u * 0.38)}l.1,${P2(u * 0.2)}`, stroke: '#e0b0aa', 'stroke-width': P2(u * 0.14), 'stroke-linecap': 'round' })); };
    const snail = (x, y) => { const g = grp(x, y, R(0, 360), R(0.9, 1.2)); return add(g, shadow(u * 0.9, u * 0.5, 2, 3), svgEl('path', { d: `M${P2(u * 0.3)},${P2(u * 0.2)}C${P2(u * 0.9)},${P2(u * 0.3)} ${P2(u * 1.3)},${P2(u * 0.1)} ${P2(u * 1.5)},${P2(-u * 0.05)}C${P2(u * 1.3)},${P2(-u * 0.25)} ${P2(u * 0.8)},${P2(-u * 0.3)} ${P2(u * 0.3)},${P2(-u * 0.25)}Z`, fill: '#c9b48a', stroke: 'rgb(60 40 20 / .5)', 'stroke-width': 0.9 }), svgEl('path', { d: `M${P2(u * 1.45)},${P2(-u * 0.1)}l${P2(u * 0.2)},${P2(-u * 0.25)}M${P2(u * 1.5)},${P2(u * 0.0)}l${P2(u * 0.25)},${P2(-u * 0.05)}`, stroke: '#a89268', 'stroke-width': 1.2, 'stroke-linecap': 'round' }), svgEl('circle', { r: P2(u * 0.55), fill: '#a8703a', stroke: 'rgb(50 28 10 / .6)', 'stroke-width': 1 }), svgEl('path', { d: `M0,0m${P2(u * 0.08)},0a${P2(u * 0.08)},${P2(u * 0.08)} 0 1 1 ${P2(-u * 0.16)},0a${P2(u * 0.2)},${P2(u * 0.2)} 0 1 1 ${P2(u * 0.4)},0a${P2(u * 0.33)},${P2(u * 0.33)} 0 1 1 ${P2(-u * 0.66)},0`, fill: 'none', stroke: 'rgb(50 28 10 / .55)', 'stroke-width': 1 })); };
    const puff = (x, y) => { const g = grp(x, y, R(0, 360)); for (let k = 0; k < 16; k++) add(g, svgEl('path', { d: `M0,0L${P2(u * 0.6 * Math.cos((k / 16) * 6.28))},${P2(u * 0.6 * Math.sin((k / 16) * 6.28))}`, stroke: 'rgb(255 255 255 / .85)', 'stroke-width': 1 })); return add(g, svgEl('circle', { r: P2(u * 0.07), fill: '#cfc7b0' }), svgEl('circle', { r: P2(u * 0.62), fill: 'rgb(255 255 255 / .22)', stroke: 'rgb(255 255 255 / .55)', 'stroke-width': 0.8 })); };
    const place = (count, draw, layer) => { for (let i = 0; i < Math.round(count * K); i++) { const p = near(layer === gTop); if (p) layer.append(draw(p[0], p[1])); } };
    place(30, moss, gMid); place(12, twig, gMid); place(10, fallen, gMid); place(6, acorn, gMid); place(2, worm, gMid); place(2, snail, gMid);   // on the ground, under the roots' edges
    place(60, grass, gMid); place(22, plant, gMid); place(14, clover, gMid);
    place(40, flower, gTop); place(20, mushroom, gTop); place(8, ladybug, gTop); place(7, puff, gTop);                                              // on top
    place(6, butterfly, gTop); place(5, bee, gTop); place(4, beetle, gTop);
    bark.append(gTop);
    bark.append(svgEl('circle', { cx, cy, r: Math.max(5, ringH * 0.22), class: 'pith' })); // the pith, where it all started
  }

  const pill = h('span', { class: 'flow-pill', 'aria-hidden': 'true' });
  let zooming = false; // while the trunk is being zoomed, the date pill waits: measuring the page every frame would slow the zoom
  function pillUpdate() { // the date of the photo nearest the middle of the screen
    if (!centres.length || !stage.isConnected || zooming) return;
    const r = stage.getBoundingClientRect(), hdr = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--hdr')) || 64;
    const vx = Math.min(innerWidth, r.right) / 2 + Math.max(0, r.left) / 2 - r.left, vy = (hdr + innerHeight) / 2 - r.top;
    let best = 0, bd = Infinity;
    centres.forEach(([x, y], i) => { const d = (x - vx) ** 2 + (y - vy) ** 2; if (d < bd) { bd = d; best = i; } });
    const it = list[best];
    pill.textContent = it?.taken?.local ? wall(it.taken.local).toLocaleDateString(undefined, { timeZone: 'UTC', month: 'long', year: 'numeric' }) : '';
  }
  addEventListener('scroll', () => requestAnimationFrame(pillUpdate), { passive: true });
  wrap.addEventListener('scroll', () => requestAnimationFrame(pillUpdate), { passive: true });
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Zoom about the middle of the trunk: it stays where it is on screen while the rings grow or shrink around it.
  let settleT = 0;
  const zoomTo = (t) => {
    t = Math.min(1, Math.max(0, t));
    if (t === tNow) return;
    const before = cyS; // the stage's top edge does not move when it is resized, so the middle only needs to move by how much its own centre line moved
    tNow = t; zooming = true; store.set(t.toFixed(4)); layout(true); clearTimeout(settleT); settleT = setTimeout(() => { zooming = false; layout(); }, 160);
    const dy = cyS - before;
    if (dy) scrollTo({ top: scrollY + dy, behavior: 'instant' });
  };
  let wantRaf = 0, want = 0, glideRaf = 0, glideTo = null;
  const request = (t) => { cancelAnimationFrame(glideRaf); glideTo = null; want = t; if (!wantRaf) wantRaf = requestAnimationFrame(() => { wantRaf = 0; zoomTo(want); }); }; // many input events, one redraw per frame
  const glide = (target) => { // a wheel notch eases to its new size instead of jumping
    cancelAnimationFrame(glideRaf); glideTo = target;
    const from = tNow, t0 = performance.now(), dur = calm ? 1 : 220;
    const step = (now) => { const p = Math.min(1, (now - t0) / dur), e = 1 - (1 - p) ** 3; zoomTo(from + (target - from) * e); if (p < 1) glideRaf = requestAnimationFrame(step); else glideTo = null; };
    glideRaf = requestAnimationFrame(step);
  };
  const slider = h('input', { type: 'range', class: 'flow-slider', min: 0, max: 1000, step: 1, value: 500, 'aria-label': 'Zoom', title: 'Zoom: drag right for bigger photos', oninput: () => request(+slider.value / 1000) });
  const paintSlider = () => { const t = tNow ?? 0.5; slider.value = Math.round(t * 1000); slider.style.setProperty('--p', t * 100 + '%'); slider.setAttribute('aria-valuetext', `Zoom ${Math.round(t * 100)} percent`); }; // the fill follows the thumb; wheel and pinch move it too

  let acc = 0, lastWheel = 0;
  stage.addEventListener('wheel', (e) => { // scroll or pinch while over the trunk zooms it; at either end of the range the page scrolls as usual
    const inward = e.deltaY < 0;
    if (inward ? tNow >= 0.999 : tNow <= 0.001) { acc = 0; return; }
    e.preventDefault();
    const [lo, hi] = bounds();
    if (e.ctrlKey) { request(tOf(sOf(glideTo ?? tNow, lo, hi) * Math.exp(-e.deltaY * 0.012), lo, hi)); return; } // a trackpad pinch: continuous
    acc += Math.abs(e.deltaY) * (e.deltaMode === 1 ? 16 : 1);
    if (acc < 50 || Date.now() - lastWheel < 60) return;
    acc = 0; lastWheel = Date.now(); glide(Math.min(1, Math.max(0, (glideTo ?? tNow) + (inward ? 0.09 : -0.09))));
  }, { passive: false });
  const ptr = new Map(); let pinch0 = 0;
  const dist = () => { const [p, r] = [...ptr.values()]; return Math.hypot(p.x - r.x, p.y - r.y); };
  stage.addEventListener('pointerdown', (e) => { ptr.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (ptr.size === 2) pinch0 = dist(); });
  stage.addEventListener('pointermove', (e) => { // two fingers: the trunk follows the pinch continuously
    if (!ptr.has(e.pointerId)) return;
    ptr.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptr.size === 2 && pinch0) { const [lo, hi] = bounds(), d = dist(); request(tOf(sOf(want || tNow, lo, hi) * (d / pinch0), lo, hi)); pinch0 = d; }
  });
  const up = (e) => { ptr.delete(e.pointerId); if (ptr.size < 2) pinch0 = 0; };
  stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);

  const sw = (key, label) => h('a', { class: 'chip', href: key === 'newest' ? '#/timeline' : '#/timeline?order=oldest', 'aria-pressed': String(order === key) }, label);
  let seenW = 0; // only a change in width needs a full redraw: zooming changes the height every frame, and that must not trigger one
  new ResizeObserver(() => { const w = wrap.clientWidth; if (w === seenW) return; seenW = w; layout(); requestAnimationFrame(() => stage.classList.add('ready')); }).observe(wrap);
  queueMicrotask(layout);
  return h('div', { class: 'page flow-page' }, pageHead('The Trunk of Time', 'Every photo, one continuous line winding out from the heart of the trunk, one ring at a time: the oldest in the middle, the newest on the bark. Scroll or pinch over the trunk to zoom in and out around its middle, or drag the zoom slider; click any photo to view it.'),
    list.length ? h('div', { class: 'flow-bar' }, h('div', { class: 'chips', role: 'group', 'aria-label': 'Order' }, sw('newest', 'Newest'), sw('oldest', 'Oldest')), pill, h('div', { class: 'flow-zoom', role: 'group', 'aria-label': 'Zoom' }, slider)) : null,
    list.length ? wrap : empty('The trunk grows with the first photo.'));
}

const fmtDay = (it) => wall(it.taken.local).toLocaleDateString(undefined, { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' });

function placeGroups() {
  const g = new Map();
  for (const i of ALL) {
    if (!i.placeKey) continue;
    const e = g.get(i.placeKey) || { key: i.placeKey, country: i.place?.country || 'Elsewhere', items: [], cells: [], n: 0 };
    e.items.push(i);
    if (i.gps) { e.cells.push([i.gps.lat, i.gps.lon]); e.n++; }
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
    const areaKm = CFG.locationAreaKm || 5, pts = [], circles = []; // one translucent circle per area, big enough to cover the whole cell; the photo's real position is never on the page
    for (const g of geo) {
      const cells = new Map(g.cells.map((c) => [`${c[0]},${c[1]}`, c]));
      const pop = h('div', { class: 'pop' }, h('strong', {}, g.key), h('br'), h('a', { href: link('gallery', { place: g.key }) }, countLabel(g.items.length, 'item') + ' →'));
      for (const ll of cells.values()) {
        circles.push([L.circleMarker(ll, { radius: 10, color: '#2f5d3a', weight: 2, fillColor: '#7aa66a', fillOpacity: 0.35 }).bindPopup(pop).addTo(map), ll]);
        pts.push(ll);
      }
    }
    // each circle is the true area while zoomed in, and never smaller than a 10px dot when zoomed out (only ever vaguer, never more precise)
    const size = () => { for (const [m, ll] of circles) m.setRadius(Math.max(10, (areaKm * 750) / ((156543.03392 * Math.cos((ll[0] * Math.PI) / 180)) / 2 ** map.getZoom()))); };
    map.on('zoomend', size);
    pts.length === 1 ? map.setView(pts[0], 9) : map.fitBounds(pts, { padding: [40, 40], maxZoom: 9 });
    size();
    map.once('focus', () => map.scrollWheelZoom.enable());
  }).catch(() => mapEl.replaceChildren(h('p', { class: 'empty' }, 'The map could not load (offline?). The list below still works.')));
  return h('div', { class: 'page' }, pageHead('Places', `Where these were taken. Locations are approximate: each circle covers about ${CFG.locationAreaKm || 5} km, and the name is the nearest city.`),
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
  const base = '#/gear';
  setList([...new Map(cams.flatMap((c) => c.items).map((i) => [i.id, i])).values()], base); // the viewer can step through all of a camera's photos
  const gearImg = (g) => (/^media\/gear\/[0-9a-f]{10}\.webp$/.test(g?.image || '') ? h('img', { class: 'gear-img', src: g.image, alt: g.name, loading: 'lazy', draggable: 'false' }) : null);
  const links = (g) => (safeUrl(g?.link) ? h('a', { href: safeUrl(g.link), target: '_blank', rel: 'noopener' }, 'Details ↗') : null);
  const card = (g) => h('article', { class: 'gear-card' }, gearImg(g), h('h3', {}, g.name), g.notes ? h('p', {}, g.notes) : null, links(g) ? h('p', { class: 'gear-links' }, links(g)) : null);
  const plural = { Camera: 'Cameras', Lens: 'Lenses', Accessory: 'Accessories', Software: 'Software', Other: 'Other' };
  const groups = GEAR_TYPES.filter((t) => t !== 'Camera').map((t) => [t, others.filter((g) => (GEAR_TYPES.includes(g.type) ? g.type : 'Other') === t)]).filter(([, l]) => l.length);
  return h('div', { class: 'page' }, pageHead('Gear', 'What I shoot with, and what each one made.'),
    cams.map((c) => h('section', { class: 'gear-cam', 'aria-labelledby': 'cam-' + norm(c.name) },
      h('div', { class: 'gear-cam-head' },
        h('div', { class: 'gear-cam-id' }, gearImg(c.info), h('div', {}, h('h2', { id: 'cam-' + norm(c.name) }, c.name), c.info?.notes ? h('p', { class: 'muted' }, c.info.notes) : null,
          c.lenses.size ? h('p', { class: 'lenses' }, 'Lenses: ' + [...c.lenses].map(([l, n]) => l + ' (' + n + ')').join(' · ')) : null)),
        h('div', { class: 'gear-cam-meta' }, h('span', { class: 'muted' }, countLabel(c.items.length, 'photo')), links(c.info), h('a', { href: link('gallery', { camera: c.name }) }, 'See all ' + c.items.length + ' →'))),
      grid(c.items, base, { maxRows: 1 }))), // a single row; "See all" opens the rest
    extraCams.length ? h('section', { class: 'gear-group' }, h('h2', {}, cams.length ? 'More cameras' : 'Cameras'), h('div', { class: 'gear-grid' }, extraCams.map(card))) : null,
    groups.map(([t, l]) => h('section', { class: 'gear-group' }, h('h2', {}, plural[t]), h('div', { class: 'gear-grid' }, l.map(card)))),
    !listed.length && !cams.length ? empty('No gear yet. Cameras appear here automatically as you add photos.') : null);
}

function pageAbout() {
  setList(ALL.slice().sort(SORTS.newest), '#/about');
  const photos = ALL.filter((i) => i.type === 'photo'), videos = ALL.length - photos.length;
  const places = new Set(ALL.map((i) => i.placeKey).filter(Boolean)).size;
  const topCam = [...ALL.reduce((m, i) => (i.cam ? m.set(i.cam, (m.get(i.cam) || 0) + 1) : m), new Map())].sort((a, b) => b[1] - a[1])[0]?.[0];
  const oldest = ALL.reduce((a, i) => (!a || i.t < a.t ? i : a), null);
  const since = oldest?.taken?.local ? wall(oldest.taken.local).toLocaleDateString(undefined, { timeZone: 'UTC', month: 'long', year: 'numeric' }) : null;

  const facts = h('p', { class: 'about-facts' }, h('strong', {}, countLabel(photos.length, 'photo')), videos ? [' and ', h('strong', {}, countLabel(videos, 'video'))] : null, places ? [' from ', h('strong', {}, countLabel(places, 'place'))] : null,
    since ? `, kept since ${since}` : null, topCam ? [', mainly on the ', h('strong', {}, topCam)] : null, '.');
  const frames = photos.slice().sort(SORTS.newest).slice(0, 6);
  // A vine that runs all the way round the portrait's arch, following its curve. It is redrawn to fit whenever the portrait changes size.
  const vineHolder = h('span', { class: 'vine-arch', 'aria-hidden': 'true' }), archEl = h('div', { class: 'arch' }, h('img', { src: CFG.portrait, alt: `Portrait of ${CFG.owner}`, draggable: 'false' }));
  const drawArchVine = () => {
    const W = archEl.offsetWidth, H = archEl.offsetHeight;
    if (!W || !H) return;
    // The vine runs round the arch just outside its edge: up the left side, over the top and down the right side.
    const M = 44, g = W < 300 ? 12 : 16, r = W / 2, cx = M + r, cy = M + r, R = r + g, rc = 14 + g, xl = M - g, xr = M + W + g, yb = M + H + g, gap = 22;
    const seg = [ // up the left side, over the top, down the right side; the bottom under the portrait is left clear
      { len: yb - 10 - cy, at: (u) => ({ x: xl, y: yb - 10 - u, nx: -1, ny: 0 }) },
      { len: R * Math.PI, at: (u) => { const t = Math.PI + u / R; return { x: cx + R * Math.cos(t), y: cy + R * Math.sin(t), nx: Math.cos(t), ny: Math.sin(t) }; } },
      { len: yb - 10 - cy, at: (u) => ({ x: xr, y: cy + u, nx: 1, ny: 0 }) }
    ];
    const total = seg.reduce((n, q) => n + q.len, 0), at = (s) => { for (const q of seg) { if (s <= q.len) return q.at(Math.max(0, s)); s -= q.len; } const q = seg.at(-1); return q.at(q.len); };
    const pts = []; let d = '';
    for (let s = 0; s <= total; s += 4) { const p = at(s), w = 4.5 * Math.sin(s / 37 + 1) * Math.min(1, s / 50, (total - s) / 50); pts.push({ x: p.x + p.nx * w, y: p.y + p.ny * w }); d += `${s ? 'L' : 'M'}${pts.at(-1).x.toFixed(1)} ${pts.at(-1).y.toFixed(1)}`; }
    let leaves = '', side = 1, i = 0;
    for (let s = 22; s < total - 10; s += 30 + (i % 3) * 6, i++) {
      const k = Math.min(pts.length - 2, Math.round(s / 4)), p = pts[k], q = pts[k + 1], tang = (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI;
      side = -side;
      leaves += `<path d="M0 0C6-9 20-9 28 0C20 9 6 9 0 0Z" transform="translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) rotate(${(tang + side * (52 + (i % 4) * 7)).toFixed(1)}) scale(${(0.9 + (i % 3) * 0.22).toFixed(2)})" fill="currentColor" opacity="${(0.8 + (i % 3) * 0.1).toFixed(2)}"/>`;
    }
    vineHolder.innerHTML = `<svg width="${W + M * 2}" height="${H + M * 2}" viewBox="0 0 ${W + M * 2} ${H + M * 2}"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>${leaves}</svg>`;
  };
  if (CFG.portrait) new ResizeObserver(drawArchVine).observe(archEl);

  return h('div', { class: 'page about' },
    pageHead('About Me'),
    h('div', { class: 'about-hero' + (CFG.portrait ? '' : ' solo') },
      CFG.portrait ? h('figure', { class: 'about-portrait' }, archEl, vineHolder) : null,
      h('div', { class: 'about-copy' },
        h('div', { class: 'prose about-prose', html: md(CFG.bio || '') }),
        facts,
        h('div', { class: 'about-links' }, h('a', { class: 'cta', href: '#/gallery' }, 'Browse the gallery'), h('a', { class: 'alt', href: '#/places' }, 'Where I’ve been'), h('a', { class: 'alt', href: '#/gear' }, 'The gear')),
        CFG.contact?.trim() ? h('div', { class: 'about-contact' }, h('h2', {}, 'Shoot Me a Message 📷'), h('div', { class: 'prose', html: md(CFG.contact) })) : null)),
    frames.length ? h('section', { class: 'band about-frames', 'aria-labelledby': 'frames-h' }, h('div', { class: 'band-head' }, h('h2', { id: 'frames-h' }, 'Lately'), h('a', { href: '#/gallery' }, 'All photos →')),
      h('div', { class: 'frames' }, frames.map((it) => {
        const a = h('a', { class: 'frame', href: withV('#/about', it.id), 'aria-label': it.title || fmtDay(it) || it.file }, h('img', { src: mediaUrl(it, 'thumb.webp'), alt: '', loading: 'lazy', decoding: 'async', draggable: 'false' }));
        a.addEventListener('click', (ev) => { if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button) return; ev.preventDefault(); nav(a.getAttribute('href'), { lb: true }); });
        return a;
      }))) : null);
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
    if (!v) { scrollTo(0, 0); if (document.activeElement !== $('#q')) $('h1', app)?.focus({ preventScroll: true }); } // moving focus to the heading would pull you out of the search box while you type
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
  const root = document.documentElement, btn = $('#theme'), dark = matchMedia('(prefers-color-scheme: dark)');
  const eff = () => root.dataset.theme || (dark.matches ? 'dark' : 'light');
  const paint = () => { const d = eff() === 'dark'; btn.setAttribute('aria-checked', String(d)); btn.title = `Switch to ${d ? 'light' : 'dark'} mode`; };
  const fade = (change) => { // cross-fade instead of snapping
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return change();
    if (document.startViewTransition) return document.startViewTransition(change);
    root.classList.add('theme-fade'); change(); setTimeout(() => root.classList.remove('theme-fade'), 700);
  };
  btn.addEventListener('click', () => fade(() => { const n = eff() === 'dark' ? 'light' : 'dark'; root.dataset.theme = n; try { localStorage.setItem('va-theme', n); } catch {} paint(); }));
  dark.addEventListener('change', paint);
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
  setMediaBase(CFG.mediaBase); // optional CDN for media/ (see README)
  VIS = await fetch('data/vision.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).then((j) => (j?.items ? Vision.buildIndex(j.items) : null)).catch(() => null); // a bonus file: without it search is plain text
  lbCtx.vision = (id) => VIS?.get(id) || null;
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
