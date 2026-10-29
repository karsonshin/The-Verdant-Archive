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
function headline() {
  const btn = h('button', { type: 'button', class: 'name-btn', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', html: brandline() });
  const el = h('h1', { class: 'brandline', tabindex: '-1' }, btn);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const COPY = ['fontFamily', 'fontSize', 'fontWeight', 'fontStretch', 'fontStyle', 'letterSpacing', 'lineHeight', 'whiteSpace', 'display', 'verticalAlign', 'marginLeft'];
  let layer = null, copy = null, card = null, plate = null, board = null, opened = false, armed = true, hoverT = 0, gone = 0, settleT = 0, held = [], fillT = 0, px = -1, py = -1, z = 1000, hoverRaf = 0, extW = 0, vines = {}; // extW: width of ".jpg", which melts away as the name rises

  const facts = () => {
    const vids = ALL.filter((i) => i.type === 'video').length, ym = ALL.map((i) => i.year * 12 + i.month - 1);
    const places = new Set(ALL.map((i) => i.placeKey).filter(Boolean)).size, when = (v) => `${monthName((v % 12) + 1, 'short')} ${Math.floor(v / 12)}`;
    const [lo, hi] = [Math.min(...ym), Math.max(...ym)];
    return [[countLabel(ALL.length - vids, 'photo'), vids ? countLabel(vids, 'video') : null].filter(Boolean).join(' and '), ym.length ? (lo === hi ? when(lo) : `${when(lo)} to ${when(hi)}`) : null, places ? countLabel(places, 'place') : null].filter(Boolean).join(', ');
  };

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

  const place = () => { // the name starts exactly where the real one is, then rises to the middle at a size that still fits
    const r = btn.getBoundingClientRect(), fs = parseFloat(getComputedStyle(el).fontSize);
    const gap = fs * 0.26, bare = r.width - extW + gap, s = Math.max(1, Math.min(96 / fs, (innerWidth * 0.8) / bare)), ty = innerHeight * 0.4, nameW = bare * s, nameH = r.height * s;
    layer.style.setProperty('--cx', r.left + r.width / 2 + 'px'); layer.style.setProperty('--cy', r.top + r.height / 2 + 'px');
    Object.assign(copy.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    copy.style.setProperty('--dy', ty - (r.top + r.height / 2) + 'px'); copy.style.setProperty('--s', s); copy.style.setProperty('--ex', (extW * s) / 2 + 'px');
    card.style.top = ty + nameH / 2 + 22 + 'px';
    const pw = Math.min(innerWidth - 24, Math.max(nameW, Math.min(card.offsetWidth, innerWidth * 0.9)) + 72), top = ty - nameH / 2 - 30, ph = nameH + 22 + card.offsetHeight + 64;
    Object.assign(plate.style, { left: (innerWidth - pw) / 2 + 'px', top: top + 'px', width: pw + 'px', height: ph + 'px' });
    const box = { left: (innerWidth - pw) / 2, right: (innerWidth + pw) / 2, top, bottom: top + ph };
    scatter(box); grow(box);
  };

  const build = () => { // a black, decorative copy of the name; the dialog's real content is the card
    copy = h('div', { class: 'flip-name', 'aria-hidden': 'true', html: btn.innerHTML });
    const pairs = [[el, copy], ...[...btn.children].map((n, i) => [n, copy.children[i]])];
    for (const [src, dst] of pairs) {
      const cs = getComputedStyle(src);
      for (const p of COPY) dst.style[p] = cs[p];
      dst.style.color = dst === copy || src.classList.contains('by') ? '#000' : 'rgb(0 0 0 / .5)';
      if (dst !== copy) dst.removeAttribute('class');
    }
    const by = copy.children[0], words = CFG.owner?.split(' ') ?? []; // "KarsonShin" opens up into "Karson Shin" while the board appears
    if (by && words.length === 2 && by.textContent === words.join('')) by.replaceChildren(h('span', { class: 'flip-w1' }, words[0]), h('span', { class: 'flip-w2' }, words[1]));
    const ext = copy.children[1]; // the extension collapses and fades while the circle opens, leaving the bare name centred
    if (ext) { extW = btn.children[1].getBoundingClientRect().width; ext.classList.add('flip-ext'); }
    copy.style.textAlign = 'center';
    const link = (href, text, cls) => h('a', { href, class: cls }, text);
    card = h('div', { class: 'flip-card' }, divider(), h('p', { class: 'flip-facts' }, facts()),
      h('div', { class: 'flip-links' }, link('#/gallery', ['Browse Gallery', h('span', { 'aria-hidden': 'true' }, ' →')], 'flip-cta'), ['Albums', 'Timeline', 'Places', 'Gear', 'About'].map((n) => link('#/' + n.toLowerCase(), n))));
    plate = h('div', { class: 'flip-plate' }, ['tl', 'tr', 'bl', 'br'].map(flourish));
    board = h('div', { class: 'board', 'aria-hidden': 'true' });
    for (const k of ['front', 'top']) vines[k] = sv('svg', { class: 'vine', 'aria-hidden': 'true', viewBox: `0 0 ${innerWidth} ${innerHeight}`, preserveAspectRatio: 'none' });
    layer = h('div', { class: 'flip', role: 'dialog', 'aria-modal': 'true', 'aria-label': CFG.tagline }, board, vines.front, plate, vines.top, copy, card, h('button', { type: 'button', class: 'flip-close', html: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg><span>Close</span>' }));
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
    opened = true; armed = false; clearTimeout(hoverT); clearTimeout(gone); clearTimeout(settleT); clearTimeout(fillT);
    if (!layer) build();
    layer.classList.remove('settled', 'filled'); document.body.append(layer); document.body.classList.add('board-open'); place();
    held = [...document.body.children].filter((n) => n !== layer && !n.inert && !/^(SCRIPT|STYLE|LINK)$/.test(n.tagName)); held.forEach((n) => (n.inert = true)); // nothing behind can be tabbed to or clicked
    const sb = innerWidth - document.documentElement.clientWidth; document.documentElement.style.cssText += `overflow:hidden;padding-right:${sb}px`;
    btn.setAttribute('aria-expanded', 'true');
    addEventListener('pointermove', track, { passive: true }); addEventListener('keydown', onKey); addEventListener('resize', relayout);
    layer.getBoundingClientRect(); // commit the closed state so everything grows from the name
    layer.classList.add('on');
    fillT = setTimeout(() => layer?.classList.add('filled'), reduce ? 0 : 850); // prints and vine start only once the circle has finished opening: animating both at once is what makes it heavy
    settleT = setTimeout(() => layer?.classList.add('settled'), reduce ? 0 : 2400); // after the fly-in, hover and drag respond without the entrance delays
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
    clearTimeout(gone); layer?.remove(); layer = null; document.body.classList.remove('board-open'); removeEventListener('pointermove', track);
    const r = btn.getBoundingClientRect(); armed = !(px >= r.left && px <= r.right && py >= r.top && py <= r.bottom); // pointer still on the name: wait for it to leave before hover can reopen
  }
  btn.addEventListener('click', (e) => (opened ? shut() : open(e.detail === 0)));
  el.addEventListener('pointermove', track, { passive: true }); // so we always know whether the pointer is still on the name when the board closes
  el.addEventListener('pointerenter', (e) => { track(e); if (e.pointerType === 'mouse' && !reduce && armed && !opened) hoverT = setTimeout(() => open(false), 140); });
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

/**
 * Every photo and video in one gapless mosaic, like zooming out in Photos. The order still snakes (left to right, then right
 * to left), so each row picks up exactly where the last one ended. Zoom with + / -, Ctrl+scroll or a pinch: tiles glide.
 */
function pageTimeline(q) {
  const order = q.get('order') === 'oldest' ? 'oldest' : 'newest';
  const list = ALL.slice().sort(order === 'oldest' ? SORTS.oldest : SORTS.newest);
  const base = order === 'oldest' ? '#/timeline?order=oldest' : '#/timeline';
  setList(list, base);
  const LEVELS = [34, 54, 82, 126, 190]; // ring thickness = tile size in px: from "years at a glance" to "big pictures"
  const store = { get: () => { try { return +localStorage.getItem('va-flow'); } catch { return NaN; } }, set: (v) => { try { localStorage.setItem('va-flow', v); } catch { /* fine */ } } };
  let level = Number.isFinite(store.get()) && localStorage.getItem('va-flow') !== null ? Math.min(4, Math.max(0, store.get())) : 2;
  // The line starts at the heart of the trunk and winds outward, one ring per turn, like growth rings. wrap scrolls sideways when the trunk is wider than the page.
  const stage = h('div', { class: 'flow', role: 'list', 'aria-label': 'Timeline of photos and videos, winding outward from the centre like tree rings' });
  const wrap = h('div', { class: 'flow-wrap' }, stage);
  const NS = 'http://www.w3.org/2000/svg';
  const svgEl = (tag, attrs = {}) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
  const bark = svgEl('svg', { class: 'flow-bark', 'aria-hidden': 'true' }), line = svgEl('svg', { class: 'flow-line', 'aria-hidden': 'true' });

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
  stage.append(bark, ...tiles, line, ...labels.map(([, l]) => l)); // bark and wood under the tiles, the thin spiral line and the labels over them

  const centres = []; // tile centres in stage pixels, for the date pill
  let ringH = 100;
  function layout() {
    const W = wrap.clientWidth;
    if (!W) return;
    const base = LEVELS[level] * (W < 520 ? 0.75 : 1), n = tiles.length, TAU = Math.PI * 2, th0 = -Math.PI / 2; // start at the top, wind clockwise
    const plan = (s) => {
      const r0 = s * 0.75, BARK = Math.max(24, s * 0.5), rAt = (t) => r0 + (s * (t - th0)) / TAU; // Archimedean spiral: the radius grows by one tile per turn
      let th = th0; const place = [];
      for (let i = 0; i < n; i++) {
        let dth = s / rAt(th); dth = s / rAt(th + dth / 2); // an arc of about one tile at the tile's middle radius
        const mid = th + dth / 2, rm = rAt(mid);
        place.push({ rm, mid, dth, wOut: dth * (rm + s / 2), wIn: dth * (rm - s / 2) });
        th += dth;
      }
      const rEnd = rAt(th) + s / 2;
      return { s, BARK, rAt, place, th, rEnd, size: Math.ceil((rEnd + BARK * 1.5 + 8) * 2) };
    };
    let P = plan(base);
    if (level <= 2 && P.size > W) { const f = (W - 6) / P.size; if (f >= 0.7) P = plan(base * f); } // zoomed-out levels fit the page; zoomed-in ones scroll sideways
    const { s, BARK, rAt, place, th, rEnd, size } = P, cx = size / 2, cy = size / 2;
    ringH = s; centres.length = 0;
    tiles.forEach((a, i) => {
      const t = place[i], x = cx + t.rm * Math.cos(t.mid), y = cy + t.rm * Math.sin(t.mid), w = t.wOut, shrink = (t.wOut - t.wIn) / 2, ang = (t.mid * 180) / Math.PI + 90, d = Math.hypot(w, s);
      const st = a.style;
      st.width = w.toFixed(1) + 'px'; st.height = s + 'px'; st.left = (x - w / 2).toFixed(1) + 'px'; st.top = (y - s / 2).toFixed(1) + 'px';
      st.transform = `rotate(${ang.toFixed(2)}deg)`; // the tile's top edge faces outward
      st.clipPath = `polygon(0 0, 100% 0, calc(100% - ${shrink.toFixed(1)}px) 100%, ${shrink.toFixed(1)}px 100%)`; // a wedge: narrower on the inside, so rings meet without gaps
      st.setProperty('--d', d.toFixed(1) + 'px'); st.setProperty('--ir', (-ang).toFixed(2) + 'deg'); // the photo turns back the other way, so it stays upright
      centres.push([x, y]);
      const lab = labelOf.get(a);
      if (lab) { lab.style.left = x.toFixed(1) + 'px'; lab.style.top = y.toFixed(1) + 'px'; }
    });
    stage.style.width = size + 'px'; stage.style.height = size + 'px';
    stage.classList.toggle('dense', s < 60);
    drawBark(cx, cy, rEnd, BARK, size);
    drawLine(cx, cy, rAt, th, s, size);
    if (size > W) wrap.scrollLeft = (size - W) / 2; // wide trunks open centred
    pillUpdate();
  }

  // The trunk outline: a wobbly closed ring of bark around the last ring, with a few darker layers and short bark marks.
  function drawBark(cx, cy, rEnd, B, size) {
    bark.replaceChildren(); bark.setAttribute('viewBox', `0 0 ${size} ${size}`); bark.setAttribute('width', size); bark.setAttribute('height', size);
    let seed = (tiles.length * 2654435761) >>> 0; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296); // fixed seed: the same trunk every visit
    const ph = [rnd() * 6.28, rnd() * 6.28, rnd() * 6.28, rnd() * 6.28];
    const wob = (a, amp) => amp * (0.55 * Math.sin(3 * a + ph[0]) + 0.3 * Math.sin(5 * a + ph[1]) + 0.2 * Math.sin(8 * a + ph[2]) + 0.12 * Math.sin(13 * a + ph[3]));
    const ring = (r, amp, steps = 120) => { let d = ''; for (let k = 0; k <= steps; k++) { const a = (k / steps) * Math.PI * 2, rr = r + wob(a, amp); d += `${k ? 'L' : 'M'}${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`; } return d + 'Z'; };
    const inner = rEnd + 3, outer = rEnd + B * 1.45;
    bark.append(svgEl('circle', { cx, cy, r: inner, class: 'wood' })); // pale wood under the rings, so the unfinished last turn is not bare page
    // the filled bark band between the tiles and the outer edge (even-odd keeps the middle open)
    bark.append(svgEl('path', { d: ring(outer, B * 0.22) + ring(inner, B * 0.06), 'fill-rule': 'evenodd', class: 'bark-fill' }));
    for (const [r, amp, w, cls] of [[outer, B * 0.22, 3, 'bark-edge'], [outer - B * 0.36, B * 0.18, 1.6, 'bark-mid'], [outer - B * 0.7, B * 0.12, 1.2, 'bark-mid'], [inner, B * 0.06, 2, 'bark-edge']]) bark.append(svgEl('path', { d: ring(r, amp), class: cls, 'stroke-width': w }));
    let marks = ''; // short, slightly slanted bark furrows
    for (let k = 0; k < 150; k++) {
      const a = rnd() * Math.PI * 2, r1 = inner + B * (0.18 + rnd() * 0.3), len = B * (0.25 + rnd() * 0.5), sl = (rnd() - 0.5) * 0.09, w = wob(a, B * 0.12);
      marks += `M${(cx + (r1 + w) * Math.cos(a)).toFixed(1)},${(cy + (r1 + w) * Math.sin(a)).toFixed(1)}L${(cx + (r1 + w + len) * Math.cos(a + sl)).toFixed(1)},${(cy + (r1 + w + len) * Math.sin(a + sl)).toFixed(1)}`;
    }
    bark.append(svgEl('path', { d: marks, class: 'bark-mid', 'stroke-width': 1.3, 'stroke-linecap': 'round' }));
    bark.append(svgEl('circle', { cx, cy, r: Math.max(5, ringH * 0.22), class: 'pith' })); // the pith, where it all started
  }

  // One thin continuous line along the outer edge of every tile: the whole timeline is a single spiral.
  function drawLine(cx, cy, rAt, thEnd, s, size) {
    line.replaceChildren(); line.setAttribute('viewBox', `0 0 ${size} ${size}`); line.setAttribute('width', size); line.setAttribute('height', size);
    const th0 = -Math.PI / 2; let d = '';
    for (let t = th0, k = 0; t <= thEnd + 0.02; t += 0.07, k++) { const r = rAt(t) + s / 2; d += `${k ? 'L' : 'M'}${(cx + r * Math.cos(t)).toFixed(1)},${(cy + r * Math.sin(t)).toFixed(1)}`; }
    line.append(svgEl('path', { d, class: 'spiral' }));
  }

  const pill = h('span', { class: 'flow-pill', 'aria-hidden': 'true' });
  function pillUpdate() { // the date of the photo nearest the middle of the screen
    if (!centres.length || !stage.isConnected) return;
    const r = stage.getBoundingClientRect(), hdr = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--hdr')) || 64;
    const vx = Math.min(innerWidth, r.right) / 2 + Math.max(0, r.left) / 2 - r.left, vy = (hdr + innerHeight) / 2 - r.top;
    let best = 0, bd = Infinity;
    centres.forEach(([x, y], i) => { const d = (x - vx) ** 2 + (y - vy) ** 2; if (d < bd) { bd = d; best = i; } });
    const it = list[best];
    pill.textContent = it?.taken?.local ? wall(it.taken.local).toLocaleDateString(undefined, { timeZone: 'UTC', month: 'long', year: 'numeric' }) : '';
  }
  addEventListener('scroll', () => requestAnimationFrame(pillUpdate), { passive: true });
  wrap.addEventListener('scroll', () => requestAnimationFrame(pillUpdate), { passive: true });
  const zoom = (d) => { const v = Math.min(4, Math.max(0, level + d)); if (v === level) return; level = v; store.set(v); stage.classList.remove('ready'); layout(); requestAnimationFrame(() => stage.classList.add('ready')); minus.disabled = level === 0; plus.disabled = level === 4; };
  const minus = h('button', { type: 'button', class: 'flow-btn', 'aria-label': 'Zoom out: more photos at once', title: 'Zoom out', onclick: () => zoom(-1) }, '−');
  const plus = h('button', { type: 'button', class: 'flow-btn', 'aria-label': 'Zoom in: bigger photos', title: 'Zoom in', onclick: () => zoom(1) }, '+');
  minus.disabled = level === 0; plus.disabled = level === 4;

  let lastWheel = 0;
  stage.addEventListener('wheel', (e) => { if (!e.ctrlKey) return; e.preventDefault(); if (Date.now() - lastWheel < 220) return; lastWheel = Date.now(); zoom(e.deltaY < 0 ? 1 : -1); }, { passive: false });
  const ptr = new Map(); let pinch0 = 0;
  const dist = () => { const [p, r] = [...ptr.values()]; return Math.hypot(p.x - r.x, p.y - r.y); };
  stage.addEventListener('pointerdown', (e) => { ptr.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (ptr.size === 2) pinch0 = dist(); });
  stage.addEventListener('pointermove', (e) => { if (!ptr.has(e.pointerId)) return; ptr.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (ptr.size === 2 && pinch0) { const ratio = dist() / pinch0; if (ratio > 1.3) { zoom(1); pinch0 = dist(); } else if (ratio < 0.77) { zoom(-1); pinch0 = dist(); } } });
  const up = (e) => { ptr.delete(e.pointerId); if (ptr.size < 2) pinch0 = 0; };
  stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);

  const sw = (key, label) => h('a', { class: 'chip', href: key === 'newest' ? '#/timeline' : '#/timeline?order=oldest', 'aria-pressed': String(order === key) }, label);
  new ResizeObserver(() => { layout(); requestAnimationFrame(() => stage.classList.add('ready')); }).observe(wrap);
  queueMicrotask(layout);
  return h('div', { class: 'page flow-page' }, pageHead('Timeline', 'Every photo, one continuous line winding out from the heart of the trunk, one ring at a time. Pinch, Ctrl+scroll or use + and − to zoom; click any photo to view it.'),
    list.length ? h('div', { class: 'flow-bar' }, h('div', { class: 'chips', role: 'group', 'aria-label': 'Order' }, sw('newest', 'Newest first'), sw('oldest', 'Oldest first')), pill, h('div', { class: 'flow-zoom', role: 'group', 'aria-label': 'Zoom' }, minus, plus)) : null,
    list.length ? wrap : empty('The timeline starts with the first photo.'));
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
