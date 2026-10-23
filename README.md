# Verdant Archive

A personal photo and video gallery. **All photos and videos taken by Karson Shin.**

This repo is the **public site**: a static site (plain HTML/CSS/JS, no build step) that GitHub Pages serves, plus the optimized derivatives it displays. It never contains, links to, or can reach your originals.

```
 you ──► ingest CLI / admin UI / drop files in inbox/ on GitHub
            │
            ├─► verdant-archive-originals  (PRIVATE)   exact originals, manifest.json, Git LFS, all tooling
            │
            └─► The-Verdant-Archive        (PUBLIC)    the site itself at the repo root + derivatives + photos.json  ──► GitHub Pages
```

The repo root **is** the site (`index.html`, `css/`, `js/`, `data/photos.json`, `media/`, `site.config.json`), so GitHub Pages serves it straight from the `main` branch with no build step. The private tooling repo sits in a git-ignored sub-folder of it:

```
Projects/verdantArchive/                 <- the public repo (this one); Pages serves its root
  index.html  css/  js/  data/  media/  site.config.json  .nojekyll
  verdant-archive-originals/             <- the private repo, cloned here; git-ignored by this repo
```

**Never remove `verdant-archive-originals/` from `.gitignore`**: that folder holds your originals and must only ever be pushed to the private repo.

The ingest tooling lives in the private repo because both the local CLI and the GitHub Action run it from there, which is what guarantees identical results from either path. See that repo's README for the tool reference.

---

## Setup (about 15 minutes)

### 0. Prerequisites

| Tool | Why | Check |
|---|---|---|
| Node.js 20+ | ingest + admin | `node -v` |
| ffmpeg (with `libx264` and `libwebp`) | video transcodes, previews | `ffmpeg -version` |
| git and **git-lfs** | two repos, big originals | `git lfs version`, then run `git lfs install` once |

Windows: `winget install Gyan.FFmpeg Git.Git GitHub.GitLFS OpenJS.NodeJS.LTS`. macOS: `brew install ffmpeg git-lfs node`. Ubuntu/WSL: `sudo apt install ffmpeg git-lfs`.

If a video upload fails with `spawn ffprobe EACCES` (common in WSL, where PATH mixes Linux and Windows folders) or `ENOENT`, the tool could not run ffmpeg/ffprobe. It already tries your `FFMPEG`/`FFPROBE` environment variables, the plain name, and the `.exe` name, and its error message lists what it tried. Fix it by installing ffmpeg inside the same environment you run the admin in (in WSL: `sudo apt install ffmpeg`), or by setting `FFPROBE=/usr/bin/ffprobe FFMPEG=/usr/bin/ffmpeg` before `npm run admin`.

### 1. Create the two GitHub repos

1. **Public** repo `The-Verdant-Archive` (this folder).
2. **Private** repo `The-Verdant-Archive-Storage`. Set it to private before ingesting any real photo.

The public repo is this folder; the private repo is the `verdant-archive-originals` folder inside it:

```bash
# public site (this folder)
git remote add origin https://github.com/<you>/The-Verdant-Archive.git
git push -u origin main

# private originals + tooling
cd verdant-archive-originals
git lfs install
git remote add origin https://github.com/<you>/The-Verdant-Archive-Storage.git
git push -u origin main
npm ci
```

### 2. Turn on GitHub Pages

Public repo → **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main`, folder: `/ (root)` → Save**. Because `index.html` is at the repo root, that is all it takes; there is no workflow to run. Your site appears at `https://<you>.github.io/The-Verdant-Archive/` within a minute or two of each push. (`.nojekyll` in the root tells Pages to serve the files as-is instead of running Jekyll.)

All URLs in the site are relative and routing uses `#/…` hashes, so it works unchanged at the project path **and** at a custom domain: add your domain under Settings → Pages (and a `CNAME` file containing it), then set `basePath` to `/` in Settings.

### 3. (Only for the drop-files-on-GitHub.com path) a token for the cross-repo push

The Action in the private repo needs permission to push to the public repo.

1. GitHub → Settings → Developer settings → **Fine-grained personal access tokens → Generate new token**.
2. Resource owner: you. Repository access: **Only select repositories → `The-Verdant-Archive`**. Permissions: **Contents: Read and write**. Set an expiry you'll remember.
3. In the **private** repo: Settings → Secrets and variables → Actions → **New repository secret** named `PUBLIC_REPO_TOKEN`, value = the token.
4. If the public repo isn't named `<owner>/The-Verdant-Archive`, add a repository *variable* `PUBLIC_REPO` = `owner/name`.

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
node tools/ingest.mjs ~/Pictures/Iceland --album "Trips/Iceland" --tags sea,sky,ice --category Travel
```

Each file: reads metadata, reverse-geocodes GPS, builds derivatives into the public repo, copies the **untouched original** to the private repo (LFS if over 10 MB), updates `photos.json` and `manifest.json`, and commits to both repos. It then **pushes both repos automatically** (originals first; add `--no-push` to only commit), and GitHub Pages rebuilds from that push on its own. Run `node tools/ingest.mjs --help` for everything.

### B. Admin UI (drag and drop, edit text, publish)

```bash
cd verdant-archive-originals
npm run admin          # http://127.0.0.1:4321 (also works from the project root, via a git-ignored package.json)   (add  -- --port 5000  to change)
```

Library (edit titles, captions, tags, categories, albums, hide/unhide, delete), Upload, Albums & categories (create, rename, reorder, nest one level, covers, descriptions), Settings (name, brand message, **bio in Markdown + portrait**, watermark, sizes, limits), and a Publish tab that is now only a manual retry. **Everything you save publishes itself:** uploads, edits, hide/delete, albums, categories, bio and settings are committed and pushed in the background, and a status bar shows "Publishing…" then "Published" (or the error, with a Retry button). Pages updates about a minute after the push. Set `"autoPublish": false` in `verdant-archive-originals/verdant.config.json` if you ever want manual control. Text and organization edits only touch `photos.json`/`site.config.json`; no image is regenerated. "Preview site" opens the site served at your real `basePath`.

**Select mode:** in Library, click **Select** (or just start dragging) to pick many photos: click them, Shift-click for a range, drag a box across them (hold Ctrl or Shift to add to the selection), or "Select all shown", then change them all at once: add to or remove from an album (or create a new one), add or remove tags, set or clear a category, hide or unhide, mark or unmark as fan favorite.

**Nothing to forget to save:** every edit in the admin (photo details, tags, albums, categories, gear, settings) saves itself about a second after you stop typing and is published a couple of seconds later; the Save buttons just do it immediately. A status pill in the header shows "Unsaved changes…", "Saving…" or "All changes saved", closing the tab flushes anything pending, and stopping the admin publishes anything still waiting.

If the admin ever shows a red "admin server is out of date" banner (or a button says "no such endpoint"), the page on screen is newer than the program running behind it: stop it with Ctrl+C and run `npm run admin` again.

The admin binds to `127.0.0.1` only, rejects foreign `Host` headers, and requires a custom header on every write, so a web page you visit can't drive it. It is never deployed (its code lives in the git-ignored private repo folder).

### C. Drop files on GitHub.com

In the **private** repo, upload files into `inbox/` (use `inbox/Iceland/…` for an album, `inbox/Trips/Iceland/…` to nest). The `Ingest inbox` Action runs the same code, moves originals into `originals/<id>/`, writes derivatives, and pushes to the public repo, which redeploys. Caveats: the GitHub.com web uploader caps files at 25 MB, and a file pushed through `inbox/` over 10 MB lands in git history once as a plain blob before the Action converts it to LFS. For big files prefer path A or B.

Actions → **Ingest inbox → Run workflow → regenerate** rebuilds every derivative from the originals (after you change sizes or the watermark).

---

## How storage works

**Tier 1, originals (private repo).** `originals/<id>/<exact original file name>`, byte-for-byte, with all EXIF/GPS/IPTC/XMP intact; the copy is SHA-256 verified. `.gitattributes` marks `originals/**` as binary (no line-ending conversion, ever) and adds an LFS rule per original over 10 MB. `manifest.json` maps `id → { path, sha256, size, originalName }`. Nothing here is recompressed or stripped, and nothing is deleted unless you pass `--purge-original` (admin: a checkbox plus typing the item id).

**Tier 2, display (public repo).** Per photo, under `media/<id>/`:

| File | Longest edge | Format | Watermark |
|---|---|---|---|
| `thumb.webp` | 400 px | WebP q72 | no |
| `medium.webp` | 1080 px | WebP q80 | no |
| `full.webp` | the photo's own resolution | WebP q90 | no |
| `download.jpg` | 1080 px | JPEG q88 | **yes, and only here** |

Videos: `v1080.mp4` (+ `v720.mp4` when the source is bigger than 720p), `medium.webp` poster, `thumb.webp`, and an animated `preview.webp`; the MP4s have the watermark burned in. All public derivatives have metadata (including GPS) stripped.

**Decision: no watermark while viewing; the watermark appears only on the file a visitor saves.** Viewers zoom all the way into `full.webp`, the photo at its own pixel dimensions (never upscaled, metadata and GPS stripped, re-encoded, not your original file), and the Download button gives `download.jpg`, a 1080 px copy with the watermark. **The trade-off you chose:** anyone can also save `full.webp` from their browser, unwatermarked, and each photo costs roughly 3 to 12 MB of the public repo (GitHub Pages sites should stay under about 1 GB, so roughly 100 to 300 photos). To limit either, set `derivatives.full.size` in `site.config.json` to a cap such as `2560` (or `watermark: true` to stamp it), then run `node tools/ingest.mjs --regenerate`. A `full.webp` that would exceed 80 MB is re-encoded at lower quality so it can never hit GitHub's 100 MB file limit.

**"Intelligent" storage:** responsive `srcset` (the browser picks the smallest sharp file; the grid tolerates ~35% softness so retina screens don't pull 1600 px files for 300 px tiles), the lightbox swaps thumb → medium → large only as zoom demands, dedupe by SHA-256 (also catches the same file under a new name), derivatives that already exist are skipped (`--force` or `--regenerate` rebuilds), and originals never enter this repo. GitHub itself rejects any file over 100 MB, and ingest never writes anything but derivatives into this repo.

**Watermark colour:** on the download, the mean luminance of exactly the box the mark will cover (bottom-right) is measured; below 128 uses the white file, otherwise black. Size 12% of the image width, 24 px padding, 85% opacity (all configurable). For video the average over four frames decides the ink.

---

## Metadata

Per item, stored in `data/photos.json` (paths and metadata only, no base64, one item per line so diffs read well): original file name, capture date/time/**time zone**, GPS, reverse-geocoded place (city, region, country), camera make/model, lens, focal length, aperture, shutter, ISO, dimensions, orientation, original size.

- **Time zone**: `OffsetTimeOriginal` if the camera wrote it; otherwise derived from the GPS clock (local time minus GPS UTC); otherwise recorded as unknown. The Info panel shows the capture wall-clock time with its offset *and* your local time.
- **Geocoding**: free OpenStreetMap Nominatim at ingest time (one request per second, results cached in `geocache.json` in ~1 km cells so reruns and CI agree). If it's unreachable the place stays blank and ingest continues.
- **Privacy note:** GPS coordinates are public in `photos.json` because the Info panel's map link needs them. They're rounded to `gpsDecimals` (default 5, about 1 m); set it to 2 for roughly 1 km, or `geocode.enabled: false` to skip place names. Public images themselves contain no GPS.

## Site features

**Landing page:** a dark full-screen stage with a slowly turning 3D ball of your photos (about one turn every 90 seconds). Drag it to spin it (it keeps its momentum, then eases back to the slow drift), click or tap any photo and the ball rotates it to the front and opens it large with its title, place, rating and previous/next arrows, and "Open full view" opens the full viewer. Arrow keys turn the ball and Enter focuses the photo facing you. The brand line sits beneath the ball, and below the stage are albums, the latest work, subject tiles and an About teaser. Photos you mark **Fan favorite** in the admin sit nearest the middle of the ball, then anything fans rated 4 stars or more, then the newest. The ball pauses while the viewer is open or scrolled off-screen, and holds still if your system asks for reduced motion (it stays draggable).

**Footer contact:** Settings → "Footer contact" takes Markdown (an email address, links). It appears in the footer on every page; leave it empty to hide it.


**Ratings and comments:** visitors can rate any photo or video 1 to 5 stars and leave timestamped comments with a name. See the next section.


Justified grid (stored dimensions reserve space: no layout shift), lazy rows, dark/light following the system with a manual toggle, filters (category, tag, album, year, month, location, camera), sorting (newest, oldest, file name), search over file names, titles, captions, tags, places, albums, cameras and dates (`2024`, `May 2024`, `2024-05-12`), plus Albums (one level of nesting), Timeline, Places (Leaflet + OpenStreetMap map) and Gear pages (Gear is the list you maintain in the admin's Gear tab, plus cameras and lenses found in your photos' EXIF data), and an About page with your Markdown bio.

**Viewer zoom:** mouse wheel, double-click or double-tap, pinch, and `Z` all zoom, up to 1.5 screen pixels per photo pixel on the full-resolution file; drag to pan. The sharpest file the screen needs is loaded automatically (a small "Loading full quality…" note shows while it arrives).

**Timeline:** every photo and video in one gapless mosaic, like zooming out in Photos: tiles meet edge to edge, and the order snakes (left to right, then right to left) so each row continues where the last ended. Zoom with the + and − buttons, Ctrl+scroll or a pinch (tiles glide to their new places, and your zoom level is remembered); month markers label the tiles, and a floating date follows you as you scroll. Switch between newest and oldest first, and click any photo to open it.

**Gear:** cameras are detected automatically from your photos' EXIF data. Each camera gets its own section showing one row of the photos it took, with "See all" to open the whole set in the gallery. Add lenses, accessories or notes (use a camera's name to attach notes to it) in the admin's Gear tab, where each item can also have a photo of the actual camera or lens (resized, converted to WebP and shown on the Gear page; photos you replace or remove are deleted from the repo).

**Viewer keys:** `←/→` navigate, `Esc` close, `Z` zoom, `I` info, wheel / pinch / double-tap to zoom, drag to pan, swipe to navigate. **Video:** `Space` play/pause, `←/→` seek 5 s (so use `Shift+←/→` or the arrows on screen to move between items), `M` mute, `F` fullscreen, `↑/↓` are native on the volume slider. Grid videos play muted on hover (desktop) or show the animated preview (touch).

Right-click-save and drag-out are disabled on images and video. That is a deterrent, not a security measure: anything a browser can display can be saved. The real protection is that only watermarked, reduced files are public.

## Ratings and comments (free Supabase project)

GitHub Pages cannot store data, so ratings and comments live in a free [Supabase](https://supabase.com) project that the site talks to directly. Until you connect one the star bar, comments tab and fan ratings are simply hidden.

1. Create a free project at supabase.com.
2. SQL Editor → New query → paste the contents of [`supabase/setup.sql`](supabase/setup.sql) → Run. It creates the tables, row-level security and a voting function.
3. Project Settings → API: copy the **Project URL** and the **anon public** key (it is designed to be public).
4. In the admin: Settings → "Ratings & comments", paste both, Save. It publishes itself.

What the setup enforces: visitors can only read comments, add comments (name up to 60 characters, text up to 1000), and vote through a function that allows one vote per browser and lets them change it. The comment time is set by the server. Visitors cannot edit or delete anything, and the voter ids are never exposed.

Honest limits: this is a personal-site setup, not a hardened one. A determined person can script extra votes or spam comments (there is a hidden honeypot field and a 15-second per-browser delay, which stop casual bots only). To moderate, open the `comments` table in the Supabase dashboard and delete rows. Comments are shown as plain text, never as HTML.

## Configuration

`site.config.json` (editable by hand or in the admin): `siteName`, `owner`, `tagline` (the brand message; it styles the owner's name when it appears in it), `bio` (Markdown), `portrait`, `contact` (Markdown, shown in the footer), `social {supabaseUrl, supabaseAnonKey}`, `basePath`, `watermark {widthPct, padding, opacity, luminanceThreshold}`, `derivatives {thumb|medium|download: {size, quality, watermark}}`, `video {maxSeconds: 60, crf, previewSeconds}`, `gpsDecimals`, `geocode`. Categories, albums and each photo's `featured` flag live in `photos.json` and are edited in the admin.

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
