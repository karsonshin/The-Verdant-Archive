// Smart search: understands a sentence like "foggy muted green photos from Toronto in 2025", finds photos that look like a given photo,
// reads a palette from any photo, and groups the archive into mood collections. No servers, no models in the browser: it works from
// data/vision.json (palette, tone, warmth, busyness... per photo, built at ingest) plus the text the archive already has (tags, captions,
// places, albums, cameras, dates). Moods are judged against the rest of the library, so "foggy" means "among your foggiest" whatever the library holds.
// Pure functions, no DOM: easy to test.

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const up = (x, a, b) => clamp01((x - a) / (b - a));
const down = (x, a, b) => 1 - up(x, a, b);
const avg = (...v) => v.reduce((s, x) => s + x, 0) / v.length;
const all = (...v) => 0.5 * Math.min(...v) + 0.5 * avg(...v); // a photo must show every trait of a mood, not just most of them

// ---------------------------------------------------------------- colour maths
export const hexToRgb = (hex) => { const h = hex.replace('#', ''); const f = h.length === 3 ? [...h].map((c) => c + c).join('') : h; return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16)); };
export function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  const h = d === 0 ? 0 : (mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
  return [h, mx === 0 ? 0 : d / mx, mx];
}
export function rgbToLab(r, g, b) {
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047), y = f(0.2126 * R + 0.7152 * G + 0.0722 * B), z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
const labDist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// ---------------------------------------------------------------- the index: each photo's facts, plus how it ranks in this library
export function buildIndex(items) {
  const ids = Object.keys(items || {}), n = ids.length, sorted = {};
  for (const k of ['b', 'c', 's', 'w', 'e']) sorted[k] = ids.map((i) => items[i][k]).sort((a, b) => a - b);
  const pct = (k, v) => { const arr = sorted[k]; let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < v) lo = m + 1; else hi = m; } let up2 = lo; while (up2 < arr.length && arr[up2] === v) up2++; return n > 1 ? (lo + up2 - 1) / 2 / (n - 1) : 0.5; };
  const rec = new Map();
  for (const id of ids) {
    const f = items[id], h = f.h || [], pal = (f.p || []).map(([hex, p]) => { const rgb = hexToRgb(hex); return { hex: '#' + hex, pct: p, hsv: rgbToHsv(...rgb), lab: rgbToLab(...rgb) }; });
    const sh = (...i) => i.reduce((s, k) => s + (h[k] || 0), 0) / 100;
    rec.set(id, {
      ...f, id, pal, top: pal[0]?.pct || 0, labels: new Set(f.l || []),
      q: { b: pct('b', f.b), c: pct('c', f.c), s: pct('s', f.s), w: pct('w', f.w), e: pct('e', f.e) },
      gold: sh(0, 1, 2) - (h[0] || 0) * 0.3 / 100, cool: sh(6, 7, 8), green: sh(3, 4, 5)
    });
  }
  return { n, ids, rec, get: (id) => rec.get(id) };
}

// ---------------------------------------------------------------- moods: words -> how well a photo fits
export const MOODS = {
  foggy: { label: 'Foggy', words: ['foggy', 'fog', 'misty', 'mist', 'hazy', 'haze', 'overcast', 'smoky'], score: (f) => all(down(f.q.c, 0.25, 0.6), down(f.q.e, 0.3, 0.7), down(f.q.s, 0.4, 0.8), up(f.b, 38, 60)) },
  moody: { label: 'Moody', words: ['moody', 'brooding', 'gloomy', 'somber', 'sombre'], score: (f) => all(down(f.q.b, 0.2, 0.5), up(f.c, 55, 85), down(f.b, 30, 55)) },
  nostalgic: { label: 'Nostalgic', words: ['nostalgic', 'nostalgia', 'vintage', 'retro', 'faded', 'filmic', 'film'], score: (f) => all(up(f.q.w, 0.5, 0.85), down(f.q.s, 0.35, 0.75), down(f.q.c, 0.3, 0.7), up(f.b, 35, 50)) },
  warm: { label: 'Warm', words: ['warm', 'cozy', 'cosy'], score: (f) => up(f.q.w, 0.55, 0.9) * up(f.w, 0, 20) },
  cool: { label: 'Cool', words: ['cool', 'cold', 'chilly', 'icy', 'wintry'], score: (f) => all(down(f.w, -5, 15), up(f.cool, 0.1, 0.4)) },
  golden: { label: 'Golden', words: ['golden', 'gold', 'sunset', 'sunrise', 'dusk', 'dawn', 'glow', 'glowing', 'amber'], score: (f) => all(up(f.w, 15, 40), up(f.gold, 0.2, 0.5), up(f.q.s, 0.3, 0.6), up(f.b, 35, 55)) },
  dreamy: { label: 'Dreamy', words: ['dreamy', 'soft', 'airy', 'ethereal', 'gentle'], score: (f) => all(up(f.q.b, 0.5, 0.8), down(f.q.c, 0.3, 0.65), down(f.q.e, 0.3, 0.7)) },
  minimal: { label: 'Minimal', words: ['minimal', 'minimalist', 'clean', 'simple', 'empty', 'quiet'], score: (f) => all(down(f.q.e, 0.2, 0.55), up(f.top, 35, 60)) },
  busy: { label: 'Busy', words: ['busy', 'chaotic', 'crowded', 'cluttered', 'detailed', 'texture', 'textured'], score: (f) => up(f.q.e, 0.65, 0.95) },
  vibrant: { label: 'Vibrant', words: ['vibrant', 'vivid', 'colorful', 'colourful', 'saturated', 'bold', 'lively', 'punchy'], score: (f) => all(up(f.q.s, 0.6, 0.9), up(f.s, 35, 55)) },
  muted: { label: 'Muted', words: ['muted', 'subdued', 'desaturated', 'earthy', 'dull', 'understated'], score: (f) => all(down(f.q.s, 0.15, 0.45), down(f.s, 18, 32)) },
  pastel: { label: 'Pastel', words: ['pastel'], score: (f) => all(up(f.q.b, 0.5, 0.8), down(f.q.s, 0.2, 0.55), down(f.q.c, 0.3, 0.65)) },
  dark: { label: 'Dark', words: ['dark', 'night', 'nighttime', 'shadowy', 'evening'], score: (f) => all(down(f.b, 22, 40), down(f.q.b, 0.1, 0.35)) },
  bright: { label: 'Bright', words: ['bright', 'sunny', 'light', 'luminous'], score: (f) => all(up(f.b, 55, 70), up(f.q.b, 0.65, 0.9)) },
  calm: { label: 'Calm', words: ['calm', 'peaceful', 'serene', 'tranquil', 'relaxing', 'still'], score: (f) => all(down(f.q.c, 0.2, 0.6), down(f.q.e, 0.2, 0.6), down(f.q.s, 0.3, 0.8)) },
  dramatic: { label: 'Dramatic', words: ['dramatic', 'contrasty', 'striking', 'intense'], score: (f) => all(up(f.q.c, 0.7, 0.95), up(f.c, 75, 92)) },
  monochrome: { label: 'Black and white', words: ['monochrome', 'bw', 'grayscale', 'greyscale'], score: (f) => down(f.s, 4, 12) }
};
const MOOD_OF = new Map(Object.entries(MOODS).flatMap(([k, m]) => m.words.map((w) => [w, k])));

// ---------------------------------------------------------------- colours: names -> does the palette hold that colour
const COLORS = {
  red: { label: 'red', swatch: '#c0392b', test: ([h, s, v]) => (h <= 15 || h >= 345) && s >= 0.35 && v >= 0.25 },
  orange: { label: 'orange', swatch: '#e67e22', test: ([h, s, v]) => h > 15 && h <= 45 && s >= 0.45 && v >= 0.5 },
  yellow: { label: 'yellow', swatch: '#f1c40f', test: ([h, s, v]) => h > 45 && h <= 70 && s >= 0.35 && v >= 0.5 },
  green: { label: 'green', swatch: '#4f9d5d', test: ([h, s, v]) => h > 70 && h <= 165 && s >= 0.12 && v >= 0.2 },
  teal: { label: 'teal', swatch: '#1f9e9a', test: ([h, s, v]) => h > 165 && h <= 200 && s >= 0.15 && v >= 0.25 },
  blue: { label: 'blue', swatch: '#3b78c2', test: ([h, s, v]) => h > 200 && h <= 255 && s >= 0.14 && v >= 0.2 },
  purple: { label: 'purple', swatch: '#8e5ab8', test: ([h, s, v]) => h > 255 && h <= 300 && s >= 0.2 && v >= 0.2 },
  pink: { label: 'pink', swatch: '#e68ab0', test: ([h, s, v]) => h > 300 && h < 345 && s >= 0.2 && v >= 0.5 },
  brown: { label: 'brown', swatch: '#8b5e3c', test: ([h, s, v]) => h > 10 && h <= 45 && s >= 0.3 && v >= 0.2 && v < 0.55 },
  beige: { label: 'beige', swatch: '#d9c7a8', test: ([h, s, v]) => h > 25 && h < 55 && s >= 0.08 && s < 0.35 && v > 0.65 },
  white: { label: 'white', swatch: '#f4f4f1', test: ([, s, v]) => s < 0.12 && v > 0.85 },
  black: { label: 'black', swatch: '#1b1b1b', test: ([, , v]) => v < 0.15 },
  gray: { label: 'gray', swatch: '#8a8a8a', test: ([, s, v]) => s < 0.12 && v > 0.2 && v <= 0.85 }
};
const COLOR_WORDS = { red: 'red', crimson: 'red', scarlet: 'red', orange: 'orange', yellow: 'yellow', green: 'green', greenery: 'green', lush: 'green', teal: 'teal', turquoise: 'teal', cyan: 'teal', aqua: 'teal', blue: 'blue', navy: 'blue', purple: 'purple', violet: 'purple', lavender: 'purple', pink: 'pink', rose: 'pink', brown: 'brown', beige: 'beige', cream: 'beige', sand: 'beige', white: 'white', black: 'black', gray: 'gray', grey: 'gray' };
export const colorScore = (rec, key) => clamp01(rec.pal.filter((p) => COLORS[key].test(p.hsv)).reduce((s, p) => s + p.pct, 0) / 22);

// ---------------------------------------------------------------- reading a sentence
const STOP = new Set('a an the of in on at from to for with and or but photo photos picture pictures image images pic pics shot shots taken that are is show me find some any all feel feeling feels vibe vibes look looks looking kind sort type'.split(' '));
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH_OF = new Map([...MONTHS.flatMap((m, i) => [[m, i + 1], [m.slice(0, 3), i + 1]]), ['sept', 9]]);
const SEASONS = { winter: [12, 1, 2], spring: [3, 4, 5], summer: [6, 7, 8], autumn: [9, 10, 11], fall: [9, 10, 11] };
// words that mean the same thing in a caption, tag or place name (used only for text; the visual part is above)
const SYN = [['sea', 'ocean', 'beach', 'coast', 'shore', 'harbor', 'harbour', 'port', 'boat', 'wave'], ['mountain', 'alps', 'hill', 'peak', 'summit', 'valley', 'cliff'], ['city', 'street', 'urban', 'downtown', 'town', 'square'],
  ['food', 'restaurant', 'cafe', 'coffee', 'dessert', 'cake', 'lunch', 'dinner', 'breakfast', 'market', 'meal'], ['people', 'person', 'portrait', 'friend', 'family', 'selfie'], ['building', 'architecture', 'church', 'cathedral', 'castle', 'tower', 'bridge', 'palace'],
  ['nature', 'forest', 'tree', 'park', 'garden', 'flower', 'plant', 'leaf', 'jungle', 'lake', 'river', 'waterfall'], ['animal', 'cat', 'dog', 'bird', 'horse', 'fish', 'seagull'], ['travel', 'trip', 'airport', 'plane', 'train', 'hotel']];
const singular = (w) => (w.endsWith('ies') && w.length > 4 ? w.slice(0, -3) + 'y' : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
const expand = (w) => SYN.find((g) => g.includes(w)) || [w];

export function parseQuery(q) {
  let s = ' ' + String(q || '').toLowerCase().replace(/[“”"]/g, '') + ' ';
  const out = { moods: [], colors: [], years: [], months: [], seasons: [], words: [], hex: null, tokens: [] };
  const hx = s.match(/#([0-9a-f]{6}|[0-9a-f]{3})\b/);
  if (hx) { out.hex = { hex: '#' + hx[1], token: hx[0] }; s = s.replace(hx[0], ' '); }
  s = s.replace(/black\s*(and|&|n)\s*white|\bb\s*&\s*w\b/g, ' monochrome ').replace(/golden hour/g, ' golden ').replace(/high[- ]contrast/g, ' dramatic ');
  for (const raw of s.replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(Boolean)) {
    const w = raw.replace(/^-+|-+$/g, ''), sg = singular(w);
    if (!w || STOP.has(w)) continue;
    if (/^(19|20)\d\d$/.test(w)) out.years.push({ v: +w, token: raw });
    else if (MONTH_OF.has(w)) out.months.push({ v: MONTH_OF.get(w), token: raw });
    else if (SEASONS[w]) out.seasons.push({ v: w, token: raw });
    else if (MOOD_OF.has(w) || MOOD_OF.has(sg)) out.moods.push({ key: MOOD_OF.get(w) || MOOD_OF.get(sg), token: raw });
    else if (COLOR_WORDS[w] || COLOR_WORDS[sg]) out.colors.push({ key: COLOR_WORDS[w] || COLOR_WORDS[sg], token: raw });
    else out.words.push({ w: sg, token: raw });
  }
  return out;
}

/** Remove a word the assistant understood from the query text (so its chip can be dismissed). */
export const dropToken = (q, token) => String(q).replace(new RegExp(`(^|\\s)${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`, 'i'), ' ').replace(/\s+/g, ' ').trim();

/**
 * items: the photos to consider (already narrowed by the other filters). index: from buildIndex, or null when vision.json is missing.
 * Returns { items (best first), chips (what was understood), unmatched (words that matched nothing), visual (whether looks were used) }.
 */
export function search(q, items, index) {
  const P = parseQuery(q), chips = [], unmatched = [];
  let list = items.slice(), visual = false;
  const keep = (fn) => { list = list.filter(fn); };
  for (const y of P.years) { keep((i) => i.year === y.v); chips.push({ kind: 'year', label: String(y.v), tokens: [y.token] }); }
  for (const m of P.months) { keep((i) => i.month === m.v); chips.push({ kind: 'month', label: MONTHS[m.v - 1][0].toUpperCase() + MONTHS[m.v - 1].slice(1), tokens: [m.token] }); }
  for (const s of P.seasons) { keep((i) => SEASONS[s.v].includes(i.month)); chips.push({ kind: 'season', label: s.v, tokens: [s.token] }); }
  // plain words: tags, captions, places, albums, cameras, dates... and any object labels the index carries. A word nothing matches is ignored (and reported) instead of emptying the page.
  for (const { w, token } of P.words) {
    const alts = expand(w), has = (i) => alts.some((a) => i.hay.includes(a) || index?.get(i.id)?.labels.has(a));
    if (list.some(has)) { keep(has); chips.push({ kind: 'word', label: w, tokens: [token] }); } else unmatched.push(token);
  }
  const scored = new Map(list.map((i) => [i.id, []]));
  const need = (terms, scoreOf, min, chip) => {
    if (!index) { for (const t of terms) { const w = t.token; const has = (i) => i.hay.includes(w); if (list.some(has)) { keep(has); chips.push({ ...chip(t), kind: 'word' }); } else unmatched.push(w); } return; }
    visual = visual || terms.length > 0;
    for (const t of terms) {
      keep((i) => { const r = index.get(i.id); const sc = r ? scoreOf(r, t) : 0; if (sc >= min) { scored.get(i.id)?.push(sc); return true; } return false; });
      chips.push(chip(t));
    }
  };
  need(P.moods, (r, t) => MOODS[t.key].score(r), 0.5, (t) => ({ kind: 'mood', label: MOODS[t.key].label.toLowerCase(), tokens: [t.token] }));
  need(P.colors, (r, t) => colorScore(r, t.key), 0.4, (t) => ({ kind: 'color', label: COLORS[t.key].label, swatch: COLORS[t.key].swatch, tokens: [t.token] }));
  if (P.hex && index) {
    const lab = rgbToLab(...hexToRgb(P.hex.hex)); visual = true;
    keep((i) => { const r = index.get(i.id); if (!r) return false; const d = Math.min(...r.pal.map((p) => labDist(p.lab, lab) - Math.min(8, p.pct / 6))); if (d <= 22) { scored.get(i.id)?.push(1 - d / 30); return true; } return false; });
    chips.push({ kind: 'color', label: P.hex.hex, swatch: P.hex.hex, tokens: [P.hex.token] });
  }
  if (!chips.length && unmatched.length) list = []; // nothing at all was understood: say so, instead of listing everything as if it matched
  const rel = (i) => { const s = scored.get(i.id) || []; return s.length ? s.reduce((a, b) => a + b, 0) / s.length : 0; };
  if (visual) list.sort((a, b) => rel(b) - rel(a) || b.t - a.t);
  return { items: list, chips, unmatched, visual };
}

// ---------------------------------------------------------------- looks like
/** How different two photos look, 0 (same) to about 1: palette, hue profile, where the light falls, and overall tone. */
export function distance(a, b) {
  const near = (x, y) => x.pal.reduce((s, p) => s + (p.pct / 100) * Math.min(...y.pal.map((o) => labDist(p.lab, o.lab))), 0) / 80;
  const dPal = Math.min(1, (near(a, b) + near(b, a)) / 2), dHue = a.h.reduce((s, v, i) => s + Math.abs(v - b.h[i]), 0) / 200;
  const dGrid = a.g.reduce((s, v, i) => s + Math.abs(v - b.g[i]), 0) / a.g.length / 100, dTone = ['b', 'c', 's', 'w', 'e'].reduce((s, k) => s + Math.abs(a[k] - b[k]), 0) / 500;
  return 0.4 * dPal + 0.2 * dHue + 0.2 * dGrid + 0.2 * dTone;
}
export function similar(id, items, index, n = 36) {
  const me = index?.get(id); if (!me) return [];
  return items.filter((i) => i.id !== id && index.get(i.id)).map((i) => [i, distance(me, index.get(i.id))]).sort((a, b) => a[1] - b[1]).slice(0, n).map(([i]) => i);
}

// ---------------------------------------------------------------- collections: the archive grouped by how it looks
const COLLECTION_ORDER = ['golden', 'foggy', 'moody', 'nostalgic', 'dreamy', 'vibrant', 'muted', 'minimal', 'calm', 'dramatic', 'cool', 'bright', 'dark', 'busy', 'pastel', 'warm'];
export function collections(items, index, { min = 4, strength = 0.6, maxShare = 0.6, max = 99 } = {}) {
  if (!index) return [];
  const out = [];
  for (const key of COLLECTION_ORDER) {
    const hits = items.map((i) => [i, index.get(i.id) ? MOODS[key].score(index.get(i.id)) : 0]).filter(([, s]) => s >= strength).sort((a, b) => b[1] - a[1]).map(([i]) => i);
    if (hits.length < min || hits.length > items.length * maxShare) continue;
    const ids = new Set(hits.map((i) => i.id));
    if (out.some((c) => { const same = c.items.filter((i) => ids.has(i.id)).length; return same / Math.min(c.items.length, hits.length) > 0.8; })) continue; // nearly the same set as one we already have
    out.push({ key, label: MOODS[key].label, items: hits });
    if (out.length >= max) break;
  }
  return out;
}
/** Moods worth offering as one-click suggestions: the ones at least `min` photos fit. */
export const moodSuggestions = (items, index, min = 3) => (index ? COLLECTION_ORDER.filter((k) => items.filter((i) => index.get(i.id) && MOODS[k].score(index.get(i.id)) >= 0.6).length >= min).map((k) => ({ key: k, label: MOODS[k].label })) : []);
