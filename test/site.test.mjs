// Dependency-free checks for the static site. Run: node --test test/
// Read-only: never writes, never touches verdant-archive-originals/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const json = (f) => JSON.parse(readFileSync(path.join(ROOT, f), 'utf8'));
const db = json('data/photos.json');
const cfg = json('site.config.json');

test('site.config.json: required fields and a Pages-style basePath', () => {
  for (const k of ['siteName', 'owner', 'basePath', 'derivatives']) assert.ok(cfg[k], `missing ${k}`);
  assert.match(cfg.basePath, /^\/.*\/$|^\/$/);
});

test('index.html: local css/js references exist', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="([^"#:]+)"/g)].map((m) => m[1]).filter((r) => !r.startsWith('data:'));
  assert.ok(refs.length >= 2);
  for (const r of refs) assert.ok(existsSync(path.join(ROOT, r)), `index.html references missing ${r}`);
});

test('every js file parses', () => {
  for (const f of readdirSync(path.join(ROOT, 'js')).filter((f) => f.endsWith('.js')))
    execFileSync(process.execPath, ['--check', path.join(ROOT, 'js', f)]);
});

test('photos.json: unique ids, valid categories, albums and parents', () => {
  const ids = db.items.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate item ids');
  const albums = new Set(db.albums.map((a) => a.id));
  assert.equal(albums.size, db.albums.length, 'duplicate album ids');
  for (const a of db.albums) {
    if (a.parent) assert.ok(albums.has(a.parent), `album ${a.id}: unknown parent`);
    if (a.cover) assert.ok(ids.includes(a.cover), `album ${a.id}: cover is not an item`);
  }
  for (const i of db.items) {
    assert.ok(['photo', 'video'].includes(i.type), `${i.id}: bad type`);
    if (i.category) assert.ok(db.categories.includes(i.category), `${i.id}: unknown category ${i.category}`);
    for (const a of i.albums || []) assert.ok(albums.has(a), `${i.id}: unknown album ${a}`);
  }
});

test('photos.json: no private data leaks (GPS lives only in the db, never raw EXIF blobs)', () => {
  for (const i of db.items) assert.ok(!('originalPath' in i) && !('sha256' in i), `${i.id}: private field present`);
});

test('every item lists derivative files that exist in media/', () => {
  const missing = [];
  for (const i of db.items) for (const f of i.files || []) if (!existsSync(path.join(ROOT, 'media', i.id, f))) missing.push(`${i.id}/${f}`);
  assert.deepEqual(missing, []);
});

test('gear and portrait images referenced by config exist', () => {
  for (const p of [cfg.portrait, ...(cfg.gear || []).map((g) => g.image)].filter(Boolean)) assert.ok(existsSync(path.join(ROOT, p)), `missing ${p}`);
});

test('location privacy: no exact coordinates, no street-level text anywhere in the published data', () => {
  const dec = (n) => String(n).split('.')[1]?.length || 0;
  for (const i of db.items) {
    if (i.gps) assert.ok(dec(i.gps.lat) <= 3 && dec(i.gps.lon) <= 3, `${i.id}: coordinates are more precise than a coarse area`);
    assert.deepEqual(Object.keys(i.place || {}).filter((k) => !['city', 'region', 'country', 'text'].includes(k)), [], `${i.id}: place has fields beyond city, region and country`);
  }
  assert.ok(cfg.locationAreaKm >= 1, 'site.config.json needs locationAreaKm');
  assert.ok(!('gpsDecimals' in cfg), 'gpsDecimals is gone');
});
