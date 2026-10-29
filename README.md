# Verdant Archive

Karson Shin's personal photo and video gallery, live at `https://karsonshin.github.io/The-Verdant-Archive/`.

This repo is the **public site**: a static site (plain HTML, CSS and JS, no build step) that GitHub Pages serves, plus the optimized pictures it shows. It never contains, links to, or can reach your original files.

```
 you ──► ingest CLI / admin app / drop files in inbox/ on GitHub
            │
            ├─► The-Verdant-Archive-Storage  (PRIVATE)  exact originals, manifest.json, Git LFS, all tooling + the admin app
            │
            └─► The-Verdant-Archive          (PUBLIC)   the site at the repo root + resized copies + photos.json  ──► GitHub Pages
```

On your PC the private repo is cloned **inside** this one, in a folder this repo ignores:

```
D:\Projects\verdantArchive\                 <- the public repo (this one); Pages serves its root
  index.html  css/  js/  data/  media/  site.config.json  .nojekyll
  verdant-archive-originals/                <- the private repo; git-ignored here
```

**Never remove `verdant-archive-originals/` from `.gitignore`.** That folder holds your originals and must only ever be pushed to the private repo.

---

## What's on the site

**Landing page.** A slowly turning 3D ball of your photos (one full turn about every 90 seconds), in a different random order on every visit. Drag it to spin it; click or tap a photo and the ball rotates it to the front and opens it. Below it: your name as the headline, **KarsonShin.jpg**, framed by camera viewfinder brackets, with the photo, video and place counts in the top right. The stage is warm sand in light mode and deep green-black in dark mode.

- **Hover Over Me!** A small arrow and message beside the name (it reads *Tap Me!* on touch screens) jiggles every few seconds. Rest the mouse on the name for about half a second (or click, tap, or press Enter) and a **popup** opens over the page: an introduction to the Verdant Archive on a specimen-card plate, with *More about me* and *Browse the gallery*, and a pinboard of your photos pinned behind it with a vine growing through them. The prints can be dragged, and a click on one opens it in the viewer. Close it with the X, Esc, or by clicking outside. Resting the mouse for under half a second does nothing, so brushing past the name won't trigger it.
- The popup text is the `intro` setting in `site.config.json` (Markdown). Your own bio stays on the About page.

**Gallery.** A justified grid with filters for category, tag, album, year, month, location, camera and **mood**, plus sorting. See *Smart search* below.

**Albums.** One level of nesting, covers and descriptions, then **Collections by feel**: groups the site builds automatically from how photos look (golden, foggy, moody...), each a one-click search.

**The Trunk of Time** (the *Timeline* tab). Every photo and video on **one continuous line** that starts at the heart of a tree trunk and winds outward, one ring per turn, seen from above. The oldest photo is in the middle and the newest is on the bark (the **Newest / Oldest** chips flip that). Photos are cut to fit their stretch of the spiral exactly, so nothing shows between them. Around the trunk: dark bark and thick roots that run to the edges of the page, soil, pebbles, grass, flowers, mushrooms and insects, drawn the same way every visit. Zoom with the **slider**, by scrolling over the trunk, or by pinching; it always zooms around the middle, glides smoothly, and remembers your level. A floating date follows you as you scroll, and clicking any photo opens it.

**Places.** A map where each location is a **circle**, never a pin. See *Location privacy*.

**Gear.** Cameras are detected from your photos' EXIF. Each gets a row of the photos it took; add lenses and accessories, each with an optional photo, in the admin's Gear tab.

**About.** Your portrait in an arch with a vine up its left side, your bio, a facts line worked out from your archive (counts, places, since when, main camera), links, a **Shoot Me a Message** card (the `contact` setting), and your six newest photos.

**Viewer.** Zoom up to 1.5 screen pixels per photo pixel (wheel, double-click, pinch, `Z`), pan by dragging, swipe or arrow keys to move on. The **Info** panel shows the details and a **palette** from the photo (click a color to copy it) with **Find photos that look like this**. Keys: `←/→` navigate, `Esc` close, `Z` zoom, `I` info. Video: `Space` play/pause, `←/→` seek 5 s, `M` mute, `F` fullscreen. Grid videos play muted on hover.

**Everywhere.** A light/dark **switch** (the knob sits under the sun or the moon, and the page fades between them), fan ratings and comments (optional), and a footer with your contact. Right-click-save and drag-out are off on images; that's a deterrent, not security, because anything a browser can show can be saved. The real protection is that only reduced files are public.

### Smart search

The search box in the header understands sentences, such as `foggy muted green photos from Toronto in 2025`. It reads:

- **moods**: foggy, moody, nostalgic, warm, cool, golden, dreamy, minimal, busy, vibrant, muted, pastel, dark, bright, calm, dramatic, black and white
- **colors**, **years**, **months**, **seasons**, and a hex code such as `#c9a46a`
- **plain words**, matched against tags, captions, places, albums, cameras, file names and dates (with a few synonyms, so `ocean` finds `beach`)

A line under the search shows how it was read, with each part removable by its ×. Words nothing matches are left out, and a search that finds nothing suggests things to try. Moods are judged against the rest of *your* library, so "foggy" means among your foggiest.

It works from `data/vision.json`: per photo, a five-color palette, brightness, contrast, color strength, warmth, busyness and a coarse layout fingerprint, about 200 bytes each. Ingest adds them for new photos. No model runs in the browser and nothing leaves the page. **It does not recognize objects** (a dog, a bridge) unless that word is in a tag or caption.

### Location privacy

The real GPS point never reaches the public site. At ingest it is snapped to the center of a fixed grid cell (`locationAreaKm`, default 5 km), the map draws a circle covering that area, and the only text is the nearest city, region and country. The exact point stays in the EXIF of your private original. Public images contain no GPS at all. For photos added before this existed, run `npm --prefix verdant-archive-originals run scrub-locations` (add `-- --dry-run` to preview). Old versions of `photos.json` still exist in this repo's git history.

---

## Setup (about 15 minutes)

### 0. Prerequisites

| Tool | Why | Check |
|---|---|---|
| Node.js 20+ | ingest and admin | `node -v` |
| ffmpeg (with `libx264` and `libwebp`) | video transcodes and previews | `ffmpeg -version` |
| git and **git-lfs** | two repos, big originals | `git lfs version`, then `git lfs install` once |

Windows: `winget install Gyan.FFmpeg Git.Git GitHub.GitLFS OpenJS.NodeJS.LTS`. macOS: `brew install ffmpeg git-lfs node`. Ubuntu/WSL: `sudo apt install ffmpeg git-lfs`.

**Windows and WSL.** Running the admin from **PowerShell** is noticeably faster than from WSL, because git on `/mnt/d` is slow. If a video upload fails with `spawn ffprobe EACCES` or `ENOENT` (common in WSL, where PATH mixes Linux and Windows folders), the tool couldn't run ffmpeg. It already tries your `FFMPEG` / `FFPROBE` variables, the plain name and the `.exe` name; fix it by installing ffmpeg in the same environment you run the admin in, or set `FFMPEG` and `FFPROBE` to full paths before `npm run admin`.

### 1. The two GitHub repos

1. **Public** `The-Verdant-Archive` (this folder).
2. **Private** `The-Verdant-Archive-Storage`. Set it to private *before* ingesting any real photo.

```bash
# public site (this folder)
git remote add origin https://github.com/karsonshin/The-Verdant-Archive.git
git push -u origin main

# private originals + tooling
cd verdant-archive-originals
git lfs install
git remote add origin https://github.com/karsonshin/The-Verdant-Archive-Storage.git
git push -u origin main
npm ci
```

### 2. GitHub Pages

Public repo → **Settings → Pages → Source: Deploy from a branch → `main` / `(root)`**. There is no workflow to run; `.nojekyll` tells Pages to serve the files as they are. All URLs are relative and routing uses `#/…`, so the site works at the project path *and* at a custom domain (add the domain under Pages, add a `CNAME` file, set `basePath` to `/` in Settings).

> **Size warning.** GitHub Pages sites are limited to about **1 GB**. `media/` is currently about **2.9 GB**, mostly because every photo keeps a full-resolution viewing copy and a full-resolution download. See *How storage works* for ways to shrink it, and [`docs/OPERATIONS.md`](docs/OPERATIONS.md) for hosting somewhere without that limit. The admin's **Health** tab flags this.

### 3. (Only for dropping files on GitHub.com) a token for the cross-repo push

The Action in the private repo needs permission to push to the public repo. Create a fine-grained token (GitHub → Settings → Developer settings), limited to **The-Verdant-Archive** with **Contents: Read and write**, and save it in the **private** repo as an Actions secret named `PUBLIC_REPO_TOKEN`. If the public repo isn't `<owner>/The-Verdant-Archive`, also add the variable `PUBLIC_REPO`. The local CLI and admin use your normal git login.

### 4. Watermark

`assets/karson-shin-watermark-white.png` is the white-ink file you supplied; `karson-shin-watermark.png` (black ink) was derived from it. Overwrite either with your real file at any time, then run `node tools/ingest.mjs --regenerate`.

---

## Adding photos

### A. The admin app (drag, drop, edit, publish)

```bash
npm run admin          # from the project root (via a git-ignored package.json); or inside verdant-archive-originals/
```

Then open http://127.0.0.1:4321. Tabs: **Library** (titles, captions, tags, categories, albums, hide, delete), **Upload**, **Albums & categories**, **Gear**, **Settings** (name, brand message, intro, bio, portrait, watermark, sizes, location privacy, contact), **Health**, and **Publish**.

- **Everything saves itself** about a second after you stop typing and **publishes** a couple of seconds later (committed and pushed in the background). The header shows "Unsaved changes…", "Saving…" or "All changes saved". Set `"autoPublish": false` in `verdant-archive-originals/verdant.config.json` for manual control; the Publish tab then does it.
- **Select mode** in Library: click photos, Shift-click for a range, or drag a box, then change them all at once (albums, tags, category, hide, fan favorite).
- **Health** shows system checks, error budgets, charts, a request and error log, and storage. Details in [`docs/OPERATIONS.md`](docs/OPERATIONS.md).
- If it shows a red "admin server is out of date" banner (or a button says "no such endpoint"), stop it with Ctrl+C and run `npm run admin` again.
- If the Library comes up empty, the admin is looking at the wrong public folder. It falls back to the folder above `verdant-archive-originals/` automatically; you can also set `VERDANT_PUBLIC=..` or start it with `npm run admin -- --public ..`.

It listens on `127.0.0.1` only, rejects foreign `Host` headers, and requires a custom header on every write, so a web page you visit can't drive it. It is never deployed.

### B. The command line

```bash
cd verdant-archive-originals
node tools/ingest.mjs ~/Pictures/Iceland --album "Trips/Iceland" --tags sea,sky --category Travel
```

For each file it reads metadata, looks up the place, builds the resized copies into this repo, copies the **untouched original** to the private repo (LFS over 10 MB), updates `photos.json`, `manifest.json` and `vision.json`, commits both repos and pushes them. `--no-push` only commits. `node tools/ingest.mjs --help` lists everything.

### C. Drop files on GitHub.com

In the **private** repo, upload into `inbox/` (`inbox/Iceland/…` makes an album, `inbox/Trips/Iceland/…` nests it). The *Ingest inbox* Action runs the same code and pushes to this repo. Caveats: the web uploader caps files at 25 MB, and an `inbox/` file over 10 MB lands in git history once as a plain file before it's converted to LFS; for big files use A or B. Actions → *Ingest inbox* → *Run workflow* → **regenerate** rebuilds every copy from the originals.

---

## How storage works

**Originals (private repo).** `originals/<id>/<exact file name>`, byte for byte with all EXIF, SHA-256 verified. `manifest.json` maps `id → { path, sha256, size, originalName }`. Nothing is recompressed, stripped or deleted unless you pass `--purge-original` (admin: a checkbox, then type the item id).

**Display copies (this repo).** Per photo, under `media/<id>/`:

| File | Longest edge | Format | Watermark |
|---|---|---|---|
| `thumb.webp` | 400 px | WebP q72 | no |
| `medium.webp` | 1080 px | WebP q80 | no |
| `full.webp` | the photo's own size | WebP q90 | no |
| `download.jpg` | the photo's own size | JPEG q95 | **yes, and only here** |

Videos: `v1080.mp4` (plus `v720.mp4` when the source is larger), a `medium.webp` poster, `thumb.webp` and an animated `preview.webp`; the MP4s have the watermark burned in. Every public copy has its metadata, including GPS, stripped.

**The trade-off you chose:** nothing is watermarked while viewing, and the watermark appears on the file a visitor saves with the Download button. It also means anyone can save `full.webp` unwatermarked, and each photo costs roughly 10 to 25 MB of this repo. To shrink the repo, set `derivatives.full.size` (and/or `derivatives.download.size`) in `site.config.json` to a cap such as `2560`, then run `node tools/ingest.mjs --regenerate`. A `full.webp` over 80 MB is re-encoded smaller so it can never hit GitHub's 100 MB file limit.

**Smart storage:** responsive `srcset` (the browser picks the smallest sharp file), the viewer upgrades thumb → medium → full only as you zoom, duplicates are caught by SHA-256 even under a new name, existing copies are skipped (`--force` or `--regenerate` rebuilds), and originals never enter this repo.

**Watermark color:** the average brightness of exactly the box the mark will cover (bottom-right) decides white or black ink. Currently 11.5% of the image width, set in from the corner by 1.4% of the width (never less than 24 px), at 75% opacity; on a 5,000 px photo that's about 70 px up and left of the corner. For video the average over four frames decides.

**Optional CDN.** Set `"mediaBase": "https://cdn.example.com/"` in `site.config.json` and every photo and video is loaded from there instead of this repo (your portrait and gear photos stay local). The CDN just needs to mirror `media/`.

---

## Metadata

Per item, in `data/photos.json` (paths and metadata only, one item per line so diffs read well): original file name, capture date, time and **time zone**, coarse location and place name, camera, lens, focal length, aperture, shutter, ISO, dimensions, orientation, size.

- **Time zone:** `OffsetTimeOriginal` if the camera wrote it; otherwise derived from the GPS clock; otherwise recorded as unknown. The Info panel shows the capture time with its offset *and* your local time.
- **Place names:** free OpenStreetMap Nominatim at ingest, one request a second, cached in `geocache.json` so re-runs and CI agree. If it's unreachable the place stays blank and ingest continues. Set `geocode.enabled: false` to skip it.
- **Videos:** capture time zone is only known when the file says so (Apple `creationdate`); otherwise it's shown as UTC.

## Ratings and comments (optional, free Supabase project)

GitHub Pages can't store data, so ratings and comments live in a free [Supabase](https://supabase.com) project the site talks to directly. Until you connect one, the star bar, comments tab and fan ratings are hidden.

1. Create a free project. 2. SQL Editor → paste [`supabase/setup.sql`](supabase/setup.sql) → Run. 3. Project Settings → API: copy the **Project URL** and the **anon public** key. 4. In the admin: Settings → *Ratings & comments*, paste both, Save.

Visitors can only read and add comments (name up to 60 characters, text up to 1000) and cast one changeable vote per browser. They cannot edit or delete anything, and voter ids are never exposed. Honest limits: this is a personal-site setup, not a hardened one, so a determined person could script extra votes or spam (a hidden honeypot and a 15-second delay stop casual bots only). To moderate, delete rows in the `comments` table in the Supabase dashboard.

## Configuration

`site.config.json` (edit by hand or in the admin's Settings):

| Key | What it does |
|---|---|
| `siteName`, `owner` | names used across the site |
| `tagline` | the headline on the landing page and footer. A name with an extension (`KarsonShin.jpg`) is set as name plus extension |
| `intro` | the text in the landing-page hover popup (Markdown) |
| `bio`, `portrait` | the About page |
| `contact` | the "Shoot Me a Message" card on About, and the footer (Markdown) |
| `social` | Supabase URL and anon key for ratings and comments |
| `basePath` | `/The-Verdant-Archive/` on Pages, `/` on a custom domain |
| `mediaBase` | optional CDN for `media/` |
| `watermark`, `derivatives`, `video` | signature size (`widthPct`), position (`padding` px, `paddingPct` of the width), opacity; copy sizes and quality; video limit 60 s. Changes apply to new ingests until you regenerate |
| `locationAreaKm` | how coarse public locations are (default 5 km) |
| `geocode` | place-name lookup |
| `gear` | the Gear page |

Categories, albums and each photo's `featured` flag live in `photos.json`. Changing sizes or the watermark affects new ingests; run `node tools/ingest.mjs --regenerate` (or the admin's button, or the Action's `regenerate` input) to rebuild existing items.

## Hosting, CI and tests

Everything below is optional and doesn't change how the site works on Pages today. The runbook is [`docs/OPERATIONS.md`](docs/OPERATIONS.md).

- **Docker:** `docker compose up --build` serves the site from nginx at http://localhost:8080 (health check at `/healthz`). `docker compose run --rm --build e2e` runs the browser tests in `e2e/` against that container. They were written before the latest design changes and haven't been re-run since, so if one fails it probably needs its selector updated.
- **CI** (`.github/workflows/`): `ci.yml` runs the site tests, builds the image and smoke-tests it, and validates Terraform and the Kubernetes manifests. `pages.yml` can deploy Pages from Actions (inactive until you set the repository variable `PAGES_VIA_ACTIONS=true`). `docker.yml` publishes the image to GHCR when you push a `v*` tag.
- **Kubernetes and Terraform:** `k8s/` and `infra/terraform/` are ready for hosting without Pages' size limit. They have never been applied to a real cluster; CI only checks that they are well formed.
- **Tests:** `node --test test/` in this folder needs no install and checks the published data (every file exists, ids and albums line up, no precise coordinates, mood search logic). `npm test` from the project root runs the admin's suite (metadata, derivatives, watermark, dedupe, video, location privacy, telemetry, visual facts).

## Notes and known limits

- **Video** is limited to 60 s (with 0.5 s of slack, since phone "60 s" clips measure 60.03 s). Longer clips are rejected with a clear message.
- **Hidden** items stay in `photos.json` with `hidden: true` and their files stay in the repo: the site doesn't show them, but this is not secrecy. **Deleting** removes the copies and the entry; the original stays in the private repo (re-ingesting restores it), and git history still contains the deleted copies.
- **Git LFS quota:** GitHub's free tier gives 1 GB of LFS storage and 1 GB a month of bandwidth. Routine Action runs don't download LFS objects, but a full regenerate does.
- **HEIC/HEIF** needs a libvips build with HEVC support, which the prebuilt one often lacks; ingest reports a clear per-file error. Export those as JPEG first.
- **Fonts** (Google Fonts) and the map (Leaflet from unpkg, tiles from OpenStreetMap) load from the web; everything else is self-contained.
- **Reduced motion:** if a visitor's system asks for less motion, the ball holds still (it stays draggable), animations are skipped, and the popup opens on click only.
