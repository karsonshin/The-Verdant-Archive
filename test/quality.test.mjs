// Quality and safety gates for the published site. Dependency-free: node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');
const html = read('index.html'), cfg = JSON.parse(read('site.config.json')), db = JSON.parse(read('data/photos.json'));

test('index.html basics: language, viewport, title, description, one h1 target, skip link', () => {
  assert.match(html, /<html lang="en"/);
  assert.match(html, /<meta name="viewport"[^>]*width=device-width/);
  assert.match(html, /<title>[^<]+<\/title>/);
  assert.match(html, /<meta name="description" content="[^"]{20,}"/);
  assert.match(html, /class="skip"/, 'a skip-to-content link');
  assert.match(html, /id="app"/);
});

test('accessibility: every button and icon-only control in index.html has a name', () => {
  for (const m of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
    const named = /aria-label=|title=/.test(m[1]) || m[2].replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, '').trim().length > 0;
    assert.ok(named, `unnamed button: ${m[0].slice(0, 80)}`);
  }
  for (const m of html.matchAll(/<input\b([^>]*)>/g)) assert.match(m[1], /aria-label=|id=/, `unlabelled input: ${m[0].slice(0, 60)}`);
});

test('no personal or leftover text: the old tagline is gone everywhere that ships', () => {
  for (const f of ['index.html', 'site.config.json', 'js/app.js', 'README.md']) assert.ok(!/All photos and videos taken by/i.test(read(f)), `${f} still has the old tagline`);
});

test('privacy: no private repo folder, key, token or street-level text can ship', () => {
  const shipped = ['index.html', 'site.config.json', 'data/photos.json', ...readdirSync(path.join(ROOT, 'js')).map((f) => 'js/' + f), ...readdirSync(path.join(ROOT, 'css')).map((f) => 'css/' + f)];
  for (const f of shipped) {
    const t = read(f);
    assert.ok(!/verdant-archive-originals/.test(t), `${f} mentions the private folder`);
    assert.ok(!/(ghp_|github_pat_|sk_live_|service_role|-----BEGIN [A-Z ]*PRIVATE KEY)/.test(t), `${f} looks like it contains a secret`);
  }
  assert.equal(cfg.social.supabaseUrl === '' || /^https:\/\/[a-z0-9]+\.supabase\.co$/.test(cfg.social.supabaseUrl), true, 'supabaseUrl must be empty or a supabase.co address');
  assert.ok(!cfg.social.supabaseAnonKey || !/service_role/.test(cfg.social.supabaseAnonKey), 'only the public anon key may be in the site');
  for (const i of db.items) for (const k of Object.keys(i)) assert.ok(!['exifRaw', 'originalPath', 'sha256', 'address', 'street'].includes(k), `${i.id}: private field ${k}`);
});

test('performance budgets: shipped code stays small and every thumbnail stays light', () => {
  const size = (f) => statSync(path.join(ROOT, f)).size;
  const js = readdirSync(path.join(ROOT, 'js')).reduce((n, f) => n + size('js/' + f), 0), css = readdirSync(path.join(ROOT, 'css')).reduce((n, f) => n + size('css/' + f), 0);
  assert.ok(js < 450 * 1024, `javascript is ${(js / 1024).toFixed(0)} KB, over the 450 KB budget`);
  assert.ok(css < 120 * 1024, `css is ${(css / 1024).toFixed(0)} KB, over the 120 KB budget`);
  assert.ok(size('data/vision.json') < 80 * 1024 + db.items.length * 200, 'vision.json grew far beyond ~200 bytes a photo');
  const heavy = db.items.filter((i) => existsSync(path.join(ROOT, `media/${i.id}/thumb.webp`)) && size(`media/${i.id}/thumb.webp`) > 60 * 1024).map((i) => i.id);
  assert.deepEqual(heavy, [], 'thumbnails over 60 KB slow the gallery down');
});

test('size awareness: media/ stays under the container image budget, and reports against the Pages limit', (t) => {
  let bytes = 0;
  for (const d of readdirSync(path.join(ROOT, 'media'))) { try { for (const f of readdirSync(path.join(ROOT, 'media', d))) bytes += statSync(path.join(ROOT, 'media', d, f)).size; } catch { /* a loose file */ } }
  const gb = bytes / 2 ** 30;
  t.diagnostic(`media/ is ${gb.toFixed(2)} GB (GitHub Pages limit is about 1 GB)`);
  assert.ok(gb < 8, `media/ is ${gb.toFixed(1)} GB: too large to build and push as a container image`);
});

test('data integrity: every photo has dimensions, a date, and a unique id; hidden photos are flagged, not missing', () => {
  const seen = new Set();
  for (const i of db.items) {
    assert.ok(!seen.has(i.id), `duplicate ${i.id}`); seen.add(i.id);
    assert.ok(i.w > 0 && i.h > 0, `${i.id}: no dimensions`);
    assert.ok(i.taken?.local || i.added, `${i.id}: no date`);
    assert.ok(typeof i.hidden === 'boolean', `${i.id}: hidden must be true or false`);
  }
});

test('search data matches the library: every photo has visual facts, and no facts are orphaned', () => {
  const v = JSON.parse(read('data/vision.json')), ids = new Set(db.items.map((i) => i.id));
  assert.deepEqual(db.items.filter((i) => !v.items[i.id]).map((i) => i.id), [], 'run: npm run vision, in the private repo');
  assert.deepEqual(Object.keys(v.items).filter((id) => !ids.has(id)), [], 'vision.json has entries for photos that no longer exist');
});

test('deployment files agree with each other: image, compose, k8s and CI all point at the same things', () => {
  const docker = read('Dockerfile'), compose = read('docker-compose.yml'), dep = read('k8s/deployment.yaml'), nginx = read('nginx.conf');
  for (const f of ['index.html', 'site.config.json', 'css', 'js', 'data', 'media']) assert.ok(docker.split('\n').some((l) => l.startsWith('COPY ') && l.includes(f)), `Dockerfile does not copy ${f}`);
  assert.ok(!/verdant-archive-originals/.test(docker.replace(/#.*$/gm, '')), 'the image must never contain the private folder');
  assert.match(read('.dockerignore'), /verdant-archive-originals/);
  assert.match(nginx, /location = \/healthz/); assert.match(nginx, /listen 8080/);
  assert.match(dep, /path: \/healthz/); assert.match(dep, /containerPort: 8080/); assert.match(compose, /8080:8080/);
  assert.match(dep, /runAsNonRoot: true/); assert.match(dep, /readOnlyRootFilesystem: true/);
});

test('workflows: pinned actions, least-privilege permissions, and no secrets echoed', () => {
  for (const f of readdirSync(path.join(ROOT, '.github/workflows')).filter((x) => x.endsWith('.yml'))) {
    const t = read('.github/workflows/' + f);
    assert.match(t, /^permissions:/m, `${f} must declare permissions`);
    assert.ok(!/echo\s+.*\$\{\{\s*secrets\./.test(t), `${f} echoes a secret`);
    for (const m of t.matchAll(/uses:\s*([\w./-]+)@([\w.-]+)/g)) assert.match(m[2], /^(v\d|[0-9a-f]{40}|\d)/, `${f}: ${m[1]} is not pinned to a version`);
  }
});
