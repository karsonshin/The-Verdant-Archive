# Verdant Archive

A personal photo and video gallery. **All photos and videos taken by Karson Shin.**

This repo is the **public site**: a static site (plain HTML/CSS/JS, no build step) that GitHub Pages serves, plus the optimized derivatives it displays. It never contains, links to, or can reach your originals.

```
 you ──► ingest CLI / admin UI / drop files in inbox/ on GitHub
            │
            ├─► verdant-archive-originals  (PRIVATE)   exact originals, manifest.json, Git LFS, all tooling
            │
            └─► verdant-archive            (PUBLIC)    site/ + WebP/JPEG/MP4 derivatives + photos.json  ──► GitHub Pages
```

The two repos live side by side on your machine:

```
Projects/
  verdant-archive/             <- this repo (public)
  verdant-archive-originals/   <- private repo; contains the ingest tool, admin UI, tests
```

The ingest tooling lives in the private repo because both the local CLI and the GitHub Action run it from there, which is what guarantees identical results from either path. See that repo's README for the tool reference.

---

## Setup (about 15 minutes)

### 0. Prerequisites

| Tool | Why | Check |
|---|---|---|
| Node.js 20+ | ingest + admin | `node -v` |
| ffmpeg (with `libx264` and `libwebp`) | video transcodes, previews | `ffmpeg -version` |
| git and **git-lfs** | two repos, big originals | `git lfs version`, then run `git lfs install` once |

Windows: `winget install Gyan.FFmpeg Git.Git GitHub.GitLFS OpenJS.NodeJS.LTS`. macOS: `brew install ffmpeg git-lfs node`.

### 1. Create the two GitHub repos

1. **Public** repo named exactly `verdant-archive` (this one).
2. **Private** repo named exactly `verdant-archive-originals`.

Push this folder to the first and the `verdant-archive-originals` folder to the second:

```bash
cd verdant-archive
git init -b main && git add -A && git commit -m "Verdant Archive"
git remote add origin https://github.com/<you>/verdant-archive.git && git push -u origin main

cd ../verdant-archive-originals
git lfs install
git init -b main && git add -A && git commit -m "Originals + tooling"
git remote add origin https://github.com/<you>/verdant-archive-originals.git && git push -u origin main
npm ci
```

### 2. Turn on GitHub Pages

Public repo → **Settings → Pages → Build and deployment → Source: GitHub Actions**. The `Deploy to GitHub Pages` workflow publishes the `site/` folder on every push to `main`. Your site appears at `https://<you>.github.io/verdant-archive/`.

All URLs in the site are relative and routing uses `#/…` hashes, so it works unchanged at the project path **and** at a custom domain: add your domain under Settings → Pages (and a `site/CNAME` file containing it), then set `basePath` to `/` in Settings.

### 3. (Only for the drop-files-on-GitHub.com path) a token for the cross-repo push

The Action in the private repo needs permission to push to the public repo.

1. GitHub → Settings → Developer settings → **Fine-grained personal access tokens → Generate new token**.
2. Resource owner: you. Repository access: **Only select repositories → `verdant-archive`**. Permissions: **Contents: Read and write**. Set an expiry you'll remember.
3. In the **private** repo: Settings → Secrets and variables → Actions → **New repository secret** named `PUBLIC_REPO_TOKEN`, value = the token.
4. If the public repo isn't named `<owner>/verdant-archive`, add a repository *variable* `PUBLIC_REPO` = `owner/name`.

The local CLI and admin use your normal git credentials; no token needed there.

### 4. Replace the placeholder content

Sample entries (drawn illustrations, flagged `"sample": true`) are included so the site renders on day one. After your first real ingest, remove them:

```bash
cd verdant-archive-originals
node tools/ingest.mjs --remove-samples
```

Your watermark: `assets/karson-shin-watermark-white.png` is the white-ink file you supplied. `assets/karson-shin-watermark.png` (black ink) was **derived from it** (same shape, ink recolored black) because only the white file was attached. Overwrite it with your real black file any time and run `node tools/ingest.mjs --regenerate`.

---

## Adding photos

### A. Local CLI

```bash
cd verdant-archive-originals
node tools/ingest.mjs ~/Pictures/Iceland --album "Trips/Iceland" --tags sea,sky,ice --category Travel --push
```

Each file: reads metadata, reverse-geocodes GPS, builds derivatives into the public repo, copies the **untouched original** to the private repo (LFS if over 10 MB), updates `photos.json` and `manifest.json`, and commits to both repos. `--push` pushes both (originals first). Run `node tools/ingest.mjs --help` for everything.

### B. Admin UI (drag and drop, edit text, publish)

```bash
cd verdant-archive-originals
npm run admin          # http://127.0.0.1:4321   (add  -- --port 5000  to change)
```

Library (edit titles, captions, tags, categories, albums, hide/unhide, delete), Upload, Albums & categories (create, rename, reorder, nest one level, covers, descriptions), Settings (name, brand message, **bio in Markdown + portrait**, watermark, sizes, limits), and **Publish** (commits and pushes both repos). Text and organization edits only touch `photos.json`/`site.config.json`; no image is regenerated. "Preview site" opens the site served at your real `basePath`.

The admin binds to `127.0.0.1` only, rejects foreign `Host` headers, and requires a custom header on every write, so a web page you visit can't drive it. It is never deployed (the Pages workflow publishes only `site/`).

### C. Drop files on GitHub.com

In the **private** repo, upload files into `inbox/` (use `inbox/Iceland/…` for an album, `inbox/Trips/Iceland/…` to nest). The `Ingest inbox` Action runs the same code, moves originals into `originals/<id>/`, writes derivatives, and pushes to the public repo, which redeploys. Caveats: the GitHub.com web uploader caps files at 25 MB, and a file pushed through `inbox/` over 10 MB lands in git history once as a plain blob before the Action converts it to LFS. For big files prefer path A or B.

Actions → **Ingest inbox → Run workflow → regenerate** rebuilds every derivative from the originals (after you change sizes or the watermark).

---

## How storage works

**Tier 1, originals (private repo).** `originals/<id>/<exact original file name>`, byte-for-byte, with all EXIF/GPS/IPTC/XMP intact; the copy is SHA-256 verified. `.gitattributes` marks `originals/**` as binary (no line-ending conversion, ever) and adds an LFS rule per original over 10 MB. `manifest.json` maps `id → { path, sha256, size, originalName }`. Nothing here is recompressed or stripped, and nothing is deleted unless you pass `--purge-original` (admin: a checkbox plus typing the item id).

**Tier 2, display (public repo).** Per photo, under `site/media/<id>/`:

| File | Longest edge | Format | Watermark |
|---|---|---|---|
| `thumb.webp` | 400 px | WebP q72 | no (too small to be worth taking) |
| `medium.webp` | 1600 px | WebP q78 | **yes** |
| `large.webp` | 2560 px | WebP q80 | **yes** |
| `download.jpg` | 1080 px | JPEG q88 | **yes** |

Videos: `v1080.mp4` (+ `v720.mp4` when the source is bigger than 720p), `medium.webp` poster, `thumb.webp`, and an animated `preview.webp`; MP4s have the watermark burned in. All public derivatives have metadata (including GPS) stripped.

**Decision: watermark the large derivatives rather than cap them at 1080.** Viewers can zoom to the full 2560 px and stay sharp, and nothing unwatermarked above 400 px is public. Only `download.jpg` (or `v1080.mp4`) is offered for download, and the viewer links to nothing else.

**"Intelligent" storage:** responsive `srcset` (the browser picks the smallest sharp file; the grid tolerates ~35% softness so retina screens don't pull 1600 px files for 300 px tiles), the lightbox swaps thumb → medium → large only as zoom demands, dedupe by SHA-256 (also catches the same file under a new name), derivatives that already exist are skipped (`--force` or `--regenerate` rebuilds), and originals never enter this repo. A guardrail step in the Pages workflow fails the deploy if any file over 30 MB shows up in `site/`.

**Watermark colour:** the mean luminance of exactly the box the mark will cover (bottom-right) is measured on the resized image; below 128 uses the white file, otherwise black. Size 12% of the image width, 24 px padding, 85% opacity (all configurable). For video the average over four frames decides the ink.

---

## Metadata

Per item, stored in `site/data/photos.json` (paths and metadata only, no base64, one item per line so diffs read well): original file name, capture date/time/**time zone**, GPS, reverse-geocoded place (city, region, country), camera make/model, lens, focal length, aperture, shutter, ISO, dimensions, orientation, original size.

- **Time zone**: `OffsetTimeOriginal` if the camera wrote it; otherwise derived from the GPS clock (local time minus GPS UTC); otherwise recorded as unknown. The Info panel shows the capture wall-clock time with its offset *and* your local time.
- **Geocoding**: free OpenStreetMap Nominatim at ingest time (one request per second, results cached in `geocache.json` in ~1 km cells so reruns and CI agree). If it's unreachable the place stays blank and ingest continues.
- **Privacy note:** GPS coordinates are public in `photos.json` because the Info panel's map link needs them. They're rounded to `gpsDecimals` (default 5, about 1 m); set it to 2 for roughly 1 km, or `geocode.enabled: false` to skip place names. Public images themselves contain no GPS.

## Site features

Justified grid (stored dimensions reserve space: no layout shift), lazy rows, dark/light following the system with a manual toggle, filters (category, tag, album, year, month, location, camera), sorting (newest, oldest, file name), search over file names, titles, captions, tags, places, albums, cameras and dates (`2024`, `May 2024`, `2024-05-12`), plus Albums (one level of nesting), Timeline, Places (Leaflet + OpenStreetMap map) and Cameras views, and an About page with your Markdown bio.

**Viewer keys:** `←/→` navigate, `Esc` close, `Z` zoom, `I` info, wheel / pinch / double-tap to zoom, drag to pan, swipe to navigate. **Video:** `Space` play/pause, `←/→` seek 5 s (so use `Shift+←/→` or the arrows on screen to move between items), `M` mute, `F` fullscreen, `↑/↓` are native on the volume slider. Grid videos play muted on hover (desktop) or show the animated preview (touch).

Right-click-save and drag-out are disabled on images and video. That is a deterrent, not a security measure: anything a browser can display can be saved. The real protection is that only watermarked, reduced files are public.

## Configuration

`site/site.config.json` (editable by hand or in the admin): `siteName`, `owner`, `tagline` (the brand message; it styles the owner's name when it appears in it), `bio` (Markdown), `portrait`, `basePath`, `watermark {widthPct, padding, opacity, luminanceThreshold}`, `derivatives {thumb|medium|large|download: {size, quality, watermark}}` (download default 1080), `video {maxSeconds: 60, crf, previewSeconds}`, `gpsDecimals`, `geocode`. Categories and albums live in `photos.json` and are edited in the admin.

Changing sizes, quality, or watermark affects new ingests; run `node tools/ingest.mjs --regenerate` (or the admin's button / the Action's `regenerate` input) to rebuild existing items.

## Notes and known limits

- **Video limit** is 60 s with 0.5 s of slack (phone "60 s" clips often measure 60.03 s). Longer clips are rejected with a clear message; nothing is stored for them.
- **Hidden** items stay in `photos.json` with `hidden: true` and their files stay in the repo: the site doesn't show them, but this is not secrecy. Use delete if something must disappear.
- **Deleting** removes derivatives and the entry; the original stays in the private repo (re-ingesting it restores the entry without re-copying). Git history still contains deleted derivatives.
- **Git LFS quota:** GitHub's free tier gives 1 GB LFS storage and 1 GB/month bandwidth. Routine Action runs don't download LFS objects, but a full regenerate does. Only originals over 10 MB use LFS; normal photos are plain git blobs (100 MB hard limit per file on GitHub, so video originals near that size must go through LFS, which ingest does automatically).
- **HEIC/HEIF** needs a sharp/libvips build with HEVC support; the prebuilt one often lacks it and ingest will report a clear per-file error. Export those as JPEG first.
- **Video capture time zone** is only known when the file says so (Apple `creationdate`); otherwise it is shown as UTC.
- Fonts (Google Fonts) and Leaflet (unpkg) load from CDNs; everything else is self-contained.

## Tests

```bash
cd verdant-archive-originals && npm test
```

Covers metadata extraction (camera, exposure, time + zone, GPS, orientation), dedupe by hash (including restore after delete), derivative sizes/formats/GPS stripping/skip-if-exists/no upscaling, watermark placement, size, opacity and colour choice (only the corner decides), original byte-identity + manifest, inbox albums, and the 60-second video limit plus a real ffmpeg transcode.
