// Tests for js/vision.js (the smart search brain). It is an ES module in a folder with no package.json, so load a copy as .mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'vision-'));
copyFileSync(path.join(ROOT, 'js/vision.js'), path.join(tmp, 'vision.mjs'));
const V = await import(pathToFileURL(path.join(tmp, 'vision.mjs')).href);

// A tiny library with known looks. Facts use the same fields data/vision.json has.
const feat = (o) => ({ b: 50, c: 60, s: 30, w: 10, e: 50, h: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 100], g: Array(16).fill(50), p: [['808080', 100]], ...o });
const LIB = {
  fog:   feat({ b: 62, c: 20, s: 8, w: 2, e: 8, h: [0, 0, 0, 40, 60, 0, 0, 0, 0, 0, 0, 0], p: [['8fb09a', 70], ['c9d3cb', 30]] }),
  gold:  feat({ b: 58, c: 62, s: 60, w: 60, e: 55, h: [20, 70, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0], p: [['e0a040', 60], ['6b3a1a', 40]] }),
  night: feat({ b: 12, c: 90, s: 22, w: -10, e: 70, h: [0, 0, 0, 0, 0, 0, 0, 100, 0, 0, 0, 0], p: [['0a0f1f', 80], ['d9c27a', 20]] }),
  sea:   feat({ b: 55, c: 55, s: 45, w: -50, e: 40, h: [0, 0, 0, 0, 0, 0, 40, 60, 0, 0, 0, 0], p: [['2a6fb0', 70], ['d8e6f2', 30]] }),
  busy:  feat({ b: 48, c: 85, s: 40, w: 20, e: 98, p: [['aa5533', 30], ['335577', 30], ['779944', 40]] }),
  plain: feat({ b: 50, c: 50, s: 25, w: 10, e: 20, p: [['bbbbbb', 90], ['555555', 10]] })
};
const photo = (id, extra = {}) => ({ id, year: 2025, month: 6, t: 1, hay: `${id}.jpg`, ...extra });
const ITEMS = [photo('fog', { year: 2025, month: 11, hay: 'fog.jpg toronto, ontario, canada autumn walk', t: 5 }), photo('gold', { year: 2024, month: 7, hay: 'gold.jpg lisbon, portugal harbour', t: 4 }),
  photo('night', { year: 2025, month: 12, hay: 'night.jpg seattle, washington', t: 6 }), photo('sea', { year: 2025, month: 7, hay: 'sea.jpg nice, france beach', t: 3 }), photo('busy', { hay: 'busy.jpg market', t: 2 }), photo('plain', { hay: 'plain.jpg', t: 1 })];
const IDX = V.buildIndex(LIB);
const ids = (r) => r.items.map((i) => i.id);

test('parseQuery: moods, colours, years, months, seasons and plain words; filler is ignored', () => {
  const p = V.parseQuery('Show me foggy, muted green photos from Toronto in 2025 summer');
  assert.deepEqual(p.moods.map((m) => m.key), ['foggy', 'muted']);
  assert.deepEqual(p.colors.map((c) => c.key), ['green']);
  assert.deepEqual(p.years.map((y) => y.v), [2025]); assert.deepEqual(p.seasons.map((s) => s.v), ['summer']);
  assert.deepEqual(p.words.map((w) => w.w), ['toronto']);
  assert.deepEqual(V.parseQuery('black and white, golden hour, high-contrast').moods.map((m) => m.key), ['monochrome', 'golden', 'dramatic']);
  assert.deepEqual(V.parseQuery('sept').months.map((m) => m.v), [9]);
  assert.equal(V.parseQuery('#E0A040 sunsets').hex.hex, '#e0a040');
});

test('search: a mood finds the photo that looks like it, best first', () => {
  assert.equal(ids(V.search('foggy', ITEMS, IDX))[0], 'fog');
  assert.equal(ids(V.search('golden sunset', ITEMS, IDX))[0], 'gold');
  assert.deepEqual(ids(V.search('night', ITEMS, IDX)), ['night']);
  assert.equal(ids(V.search('busy', ITEMS, IDX))[0], 'busy');
});

test('search: colours come from the palette, and combine with moods and places', () => {
  assert.ok(ids(V.search('blue', ITEMS, IDX)).includes('sea'));
  assert.ok(!ids(V.search('blue', ITEMS, IDX)).includes('gold'));
  assert.equal(ids(V.search('foggy green from toronto', ITEMS, IDX))[0], 'fog');
  assert.ok(!ids(V.search('foggy green from toronto', ITEMS, IDX)).includes('night'), 'a different city is left out');
  assert.equal(ids(V.search('orange', ITEMS, IDX))[0], 'gold');
});

test('search: dates narrow the set; a word nothing matches is reported, not fatal', () => {
  assert.deepEqual(ids(V.search('2024', ITEMS, IDX)), ['gold']);
  assert.deepEqual(ids(V.search('december', ITEMS, IDX)), ['night']);
  assert.deepEqual(ids(V.search('dragon', ITEMS, IDX)), [], 'a search that understood nothing lists nothing');
  const r = V.search('foggy dragon', ITEMS, IDX);
  assert.equal(ids(r)[0], 'fog', 'the foggiest photo leads'); assert.deepEqual(r.unmatched, ['dragon']);
  assert.ok(r.chips.some((c) => c.kind === 'mood' && c.label === 'foggy'));
});

test('search: synonyms reach captions and tags; object labels in the index are searchable too', () => {
  assert.ok(ids(V.search('ocean', ITEMS, IDX)).includes('sea'), 'ocean ~ beach');
  const labelled = V.buildIndex({ ...LIB, plain: feat({ ...LIB.plain, l: ['dog', 'grass'] }) });
  assert.deepEqual(ids(V.search('dog', ITEMS, labelled)), ['plain']);
});

test('search without visual data still works on text, and says so', () => {
  const r = V.search('foggy toronto', ITEMS, null);
  assert.ok(Array.isArray(ids(r))); // never throws without visual data
  assert.deepEqual(ids(V.search('toronto', ITEMS, null)), ['fog']);
});

test('similar: nearest look first, never itself', () => {
  const s = V.similar('fog', ITEMS, IDX, 5).map((i) => i.id);
  assert.ok(!s.includes('fog')); assert.equal(s[0], 'plain', `got ${s}`);
  assert.ok(!['sea', 'night'].includes(V.similar('gold', ITEMS, IDX, 5)[0].id), 'a golden photo is not closest to a blue one');
});

test('collections: only moods with enough photos, no near-duplicate sets', () => {
  const many = {}; const items = [];
  for (let i = 0; i < 12; i++) { many['f' + i] = feat({ ...LIB.fog, b: 60 + (i % 3) }); items.push(photo('f' + i)); }
  for (let i = 0; i < 12; i++) { many['g' + i] = feat({ ...LIB.gold, b: 55 + (i % 3) }); items.push(photo('g' + i)); }
  const idx = V.buildIndex(many), cols = V.collections(items, idx, { min: 4, strength: 0.6, maxShare: 0.7 });
  assert.ok(cols.some((c) => c.key === 'foggy') && cols.some((c) => c.key === 'golden'));
  assert.ok(cols.every((c) => c.items.length >= 4));
  const keys = cols.map((c) => c.key); assert.equal(new Set(keys).size, keys.length);
  assert.deepEqual(V.collections(items, null), []);
});

test('dropToken removes one understood word and tidies spaces', () => {
  assert.equal(V.dropToken('foggy muted green', 'muted'), 'foggy green');
  assert.equal(V.dropToken('foggy', 'foggy'), '');
  assert.equal(V.dropToken('mutedgreen muted', 'muted'), 'mutedgreen');
});

test('the real library: every photo has facts, and the common moods each fit a sensible handful', async () => {
  const { readFileSync, existsSync } = await import('node:fs');
  const f = path.join(ROOT, 'data/vision.json');
  if (!existsSync(f)) return;
  const v = JSON.parse(readFileSync(f, 'utf8')), db = JSON.parse(readFileSync(path.join(ROOT, 'data/photos.json'), 'utf8'));
  assert.equal(Object.keys(v.items).length, db.items.length, 'run: npm run vision, in the private repo');
  const idx = V.buildIndex(v.items), n = db.items.length;
  for (const key of ['foggy', 'golden', 'moody', 'vibrant', 'dark']) {
    const hits = Object.keys(v.items).filter((id) => V.MOODS[key].score(idx.get(id)) >= 0.6).length;
    assert.ok(hits <= n * 0.5, `${key} fits ${hits} of ${n}: too loose to be useful`);
  }
});
