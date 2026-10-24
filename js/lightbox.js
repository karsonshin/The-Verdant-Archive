import { h, $, fmtWall, fmtBytes, mediaUrl } from './util.js';
import { createPlayer } from './player.js';
import * as social from './social.js';

const I = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICON = {
  close: I('<path d="M6 6l12 12M18 6L6 18"/>'),
  prev: I('<path d="M15 5l-7 7 7 7"/>'),
  next: I('<path d="M9 5l7 7-7 7"/>'),
  info: I('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'),
  zoom: I('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.5-4.5M11 8.5v5M8.5 11h5"/>'),
  down: I('<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>'),
  chat: I('<path d="M4 5h16v11H9l-5 4z"/>')
};

// size 0 in the config means "the photo's own resolution" (capped by WebP's 16383 px limit)
const edge = (cfg, k) => cfg.derivatives[k].size || 16383;
const natW = (it, cfg, k) => Math.round(it.w * Math.min(1, edge(cfg, k) / Math.max(it.w, it.h)));
const natH = (it, cfg, k) => Math.round(it.h * Math.min(1, edge(cfg, k) / Math.max(it.w, it.h)));
/** Viewing sizes this item really has on disk, smallest first (the watermarked download is never used for viewing). */
const sizesOf = (it, cfg) => ['thumb', 'medium', 'large', 'full'].filter((k) => cfg.derivatives[k] && it.files?.includes(k + '.webp'));

/**
 * Full-screen viewer. `ctx` = { cfg, list, albumName(id), navigate(id), close() }.
 * The URL (?v=id) is the single source of truth: the router calls show(id) whenever it changes.
 */
export function createLightbox(ctx) {
  let root, stage, img, infoEl, titleEl, counter, dlBtn, zoomBtn, player, item, idx = -1, opener, rateHost, chatBtn, tab = 'info', cCount = null;
  let s = 1, tx = 0, ty = 0, fw = 0, fh = 0, maxS = 1, cur = -1, token = 0, infoOpen = false;
  const ptrs = new Map();
  let pinch0 = null, drag0 = null, swipe0 = null, lastTap = { t: 0, x: 0, y: 0 };

  function build() {
    img = h('img', { class: 'lb-img', alt: '', draggable: 'false' });
    stage = h('div', { class: 'lb-stage' }, img);
    infoEl = h('aside', { class: 'lb-info', id: 'lb-info', 'aria-label': 'Information', hidden: true });
    titleEl = h('div', { class: 'lb-title' });
    counter = h('span', { class: 'lb-count', 'aria-live': 'polite' });
    dlBtn = h('a', { class: 'lb-btn', 'aria-label': 'Download 1080 px watermarked copy', title: 'Download (1080 px, watermarked)', html: ICON.down });
    zoomBtn = h('button', { class: 'lb-btn', type: 'button', 'aria-label': 'Toggle zoom (Z)', title: 'Zoom (Z)', html: ICON.zoom, onclick: () => toggleZoom() });
    const infoBtn = h('button', { class: 'lb-btn', type: 'button', 'aria-label': 'Toggle info (I)', title: 'Info (I)', 'aria-controls': 'lb-info', 'aria-expanded': 'false', html: ICON.info, onclick: () => setInfo(!infoOpen) });
    rateHost = h('div', { class: 'lb-rate' });
    chatBtn = h('button', { class: 'lb-btn', type: 'button', 'aria-label': 'Comments', title: 'Comments', html: ICON.chat, hidden: !social.enabled(), onclick: () => { setInfo(true); setTab('comments'); } });
    root = h('div', { class: 'lb', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Viewer' },
      h('div', { class: 'lb-top' }, titleEl, rateHost, counter, zoomBtn, dlBtn, chatBtn, infoBtn, h('button', { class: 'lb-btn', type: 'button', 'aria-label': 'Close (Esc)', title: 'Close (Esc)', html: ICON.close, onclick: () => ctx.close() })),
      stage,
      h('button', { class: 'lb-nav lb-prev', type: 'button', 'aria-label': 'Previous (←)', html: ICON.prev, onclick: () => go(-1) }),
      h('button', { class: 'lb-nav lb-next', type: 'button', 'aria-label': 'Next (→)', html: ICON.next, onclick: () => go(1) }),
      infoEl);
    root.infoBtn = infoBtn;
    // best-effort deterrents (not a security claim; see README)
    root.addEventListener('contextmenu', (e) => { if (e.target.closest('img, video')) e.preventDefault(); });
    root.addEventListener('dragstart', (e) => e.preventDefault());
    stage.addEventListener('wheel', onWheel, { passive: false });
    stage.addEventListener('pointerdown', onDown);
    stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerup', onUp);
    stage.addEventListener('pointercancel', onUp);
    new ResizeObserver(() => item && item.type === 'photo' && layout(false)).observe(stage);
    document.body.append(root);
  }

  const go = (d) => { const n = ctx.list[idx + d]; if (n) ctx.navigate(n.id); };
  const setInfo = (on) => { infoOpen = on; infoEl.hidden = !on; root.classList.toggle('info-open', on); root.infoBtn.setAttribute('aria-expanded', on); try { localStorage.setItem('va-info', on ? '1' : '0'); } catch {} item && item.type === 'photo' && layout(false); };

  // ---------- zoom / pan ----------
  function apply(smooth) {
    img.style.transition = smooth ? 'transform .2s ease-out' : 'none';
    img.style.transform = `translate(-50%,-50%) translate(${tx}px,${ty}px) scale(${s})`;
    root.classList.toggle('zoomed', s > 1.01);
    zoomBtn.setAttribute('aria-pressed', s > 1.01);
  }
  function clamp() {
    const mx = Math.max(0, (fw * s - stage.clientWidth) / 2), my = Math.max(0, (fh * s - stage.clientHeight) / 2);
    tx = Math.min(mx, Math.max(-mx, tx)); ty = Math.min(my, Math.max(-my, ty));
  }
  function layout(smooth) {
    const sw = stage.clientWidth, sh = stage.clientHeight;
    if (!sw || !sh || !item) return;
    const top = sizesOf(item, ctx.cfg).pop() || 'medium';
    const lw = natW(item, ctx.cfg, top), lh = natH(item, ctx.cfg, top);
    const f = Math.min(sw / lw, sh / lh, 1);
    fw = Math.round(lw * f); fh = Math.round(lh * f);
    img.style.width = fw + 'px'; img.style.height = fh + 'px';
    maxS = Math.max(3, (lw / fw) * 1.5); // all the way in: past 1:1 on the full-resolution file, and at least 3x for small images
    s = Math.min(s, maxS); clamp(); apply(smooth); quality();
  }
  function zoomAt(ns, cx, cy, smooth = true) {
    ns = Math.min(maxS, Math.max(1, ns));
    const r = ns / s;
    tx = cx - (cx - tx) * r; ty = cy - (cy - ty) * r; s = ns;
    if (s === 1) { tx = ty = 0; }
    clamp(); apply(smooth); quality();
  }
  const center = (e) => { const r = stage.getBoundingClientRect(); return [e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2]; };
  function toggleZoom(e) {
    if (item.type !== 'photo') return;
    const [cx, cy] = e ? center(e) : [0, 0];
    s > 1.01 ? zoomAt(1, 0, 0) : zoomAt(Math.min(maxS, 2.5), cx, cy);
  }
  function onWheel(e) {
    if (item.type !== 'photo') return;
    e.preventDefault();
    const [cx, cy] = center(e);
    zoomAt(s * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)), cx, cy, false);
  }
  const dist = () => { const [a, b] = [...ptrs.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  function onDown(e) {
    if (item.type !== 'photo' || e.target.closest('button')) return;
    stage.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 2) { pinch0 = { d: dist(), s }; swipe0 = null; drag0 = null; }
    else {
      drag0 = { x: e.clientX, y: e.clientY, tx, ty };
      swipe0 = { x: e.clientX, y: e.clientY, t: Date.now(), touch: e.pointerType !== 'mouse' };
      const now = Date.now();
      // double-tap (touch) and double-click (mouse) both land here
      if (now - lastTap.t < 300 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40) { toggleZoom(e); lastTap.t = 0; drag0 = null; swipe0 = null; return; }
      lastTap = { t: now, x: e.clientX, y: e.clientY };
    }
  }
  function onMove(e) {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 2 && pinch0) {
      const [a, b] = [...ptrs.values()], r = stage.getBoundingClientRect();
      zoomAt(pinch0.s * (dist() / pinch0.d), (a.x + b.x) / 2 - r.left - r.width / 2, (a.y + b.y) / 2 - r.top - r.height / 2, false);
    } else if (drag0 && s > 1.01) {
      tx = drag0.tx + e.clientX - drag0.x; ty = drag0.ty + e.clientY - drag0.y; clamp(); apply(false);
      root.classList.add('panning');
    }
  }
  function onUp(e) {
    const had = ptrs.delete(e.pointerId);
    if (ptrs.size < 2) pinch0 = null;
    root.classList.remove('panning');
    if (had && swipe0 && s <= 1.01 && swipe0.touch) {
      const dx = e.clientX - swipe0.x, dy = e.clientY - swipe0.y;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
    }
    swipe0 = null; drag0 = null;
    if (ptrs.size === 1) { const [p] = ptrs.values(); drag0 = { x: p.x, y: p.y, tx, ty }; }
  }

  // ---------- progressive loading: thumb -> medium -> large ----------
  /** Smallest derivative that is sharp at the current zoom on this screen. */
  function quality() {
    if (item.type !== 'photo') return;
    const need = fw * s * Math.min(devicePixelRatio || 1, 3);
    const have = sizesOf(item, ctx.cfg);
    const pick = have.find((k) => natW(item, ctx.cfg, k) >= need) || have[have.length - 1];
    const rank = have.indexOf(pick);
    if (rank > cur) load(pick, rank);
  }
  function load(k, rank) {
    const my = token, src = mediaUrl(item, k + '.webp');
    const pre = new Image(), big = k === 'full' || k === 'large';
    if (big) root.classList.add('loading-hq');
    const done = () => { if (my === token) root.classList.remove('loading-hq'); };
    pre.onerror = done;
    pre.onload = () => { done(); if (my === token && rank > cur) { img.src = src; cur = rank; } };
    pre.src = src;
  }
  function preloadNeighbours() {
    for (const d of [1, -1]) { const n = ctx.list[idx + d]; if (n && n.type === 'photo') new Image().src = mediaUrl(n, 'medium.webp'); else if (n) new Image().src = mediaUrl(n, 'thumb.webp'); }
  }

  // ---------- info panel ----------
  function row(label, value) { return value ? h('div', { class: 'kv' }, h('dt', {}, label), h('dd', {}, value)) : null; }
  function renderInfo() {
    const it = item, t = it.taken || {}, cam = it.camera || {}, ex = it.exif || {};
    const wallStr = t.local ? fmtWall(t.local, { dateStyle: 'full', timeStyle: 'short' }) : null;
    const when = [];
    if (wallStr) when.push(h('div', {}, wallStr, t.tz ? h('span', { class: 'muted' }, `  (UTC${t.tz})`) : h('span', { class: 'muted' }, '  (time zone not recorded)')));
    if (t.utc) when.push(h('div', { class: 'muted' }, 'Your local time: ' + new Date(t.utc).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })));
    const where = it.gps || it.place ? [
      it.place?.text ? h('div', {}, it.place.text) : null,
      it.gps ? h('a', { href: `https://www.openstreetmap.org/?mlat=${it.gps.lat}&mlon=${it.gps.lon}#map=13/${it.gps.lat}/${it.gps.lon}`, target: '_blank', rel: 'noopener', class: 'maplink' }, `${it.gps.lat.toFixed(4)}, ${it.gps.lon.toFixed(4)} · map ↗`) : null
    ] : null;
    const exposure = [ex.focal && `${ex.focal} mm`, ex.aperture && `f/${ex.aperture}`, ex.shutter && `${ex.shutter}${/s$/.test(ex.shutter) ? '' : ' s'}`, ex.iso && `ISO ${ex.iso}`].filter(Boolean).join(' · ');
    const albums = (it.albums || []).map(ctx.albumName).filter(Boolean).join(', ');
    const details = [
      h('h2', {}, it.title || it.file),
      it.caption ? h('p', { class: 'cap' }, it.caption) : null,
      h('dl', {},
        row('Taken', when.length ? h('div', {}, when) : null),
        row('Place', where && h('div', {}, where)),
        row('Camera', [cam.make, cam.model].filter(Boolean).join(' ').replace(/^(\S+) \1/i, '$1')),
        row('Lens', cam.lens), row('Exposure', exposure),
        row('Dimensions', `${it.w} × ${it.h}${it.duration ? ` · ${Math.round(it.duration)} s` : ''}`),
        row('Original file', it.file), row('Original size', it.bytes ? fmtBytes(it.bytes) : null),
        row('Category', it.category), row('Albums', albums),
        row('Tags', it.tags?.length ? it.tags.map((t) => h('a', { class: 'tag', href: `#/gallery?tag=${encodeURIComponent(t)}`, onclick: () => ctx.close(true) }, t)) : null))];
    if (!social.enabled()) return infoEl.replaceChildren(...details);
    const tabs = h('div', { class: 'lb-tabs', role: 'tablist' },
      h('button', { type: 'button', role: 'tab', id: 'tab-info', 'aria-selected': String(tab === 'info'), onclick: () => setTab('info') }, 'Details'),
      h('button', { type: 'button', role: 'tab', id: 'tab-comments', 'aria-selected': String(tab === 'comments'), onclick: () => setTab('comments') }, cCount == null ? 'Comments' : `Comments (${cCount})`));
    const pane = tab === 'comments' ? social.commentsPanel(it.id, (n) => { cCount = n; const t = $('#tab-comments', infoEl); if (t) t.textContent = `Comments (${n})`; }) : h('div', {}, details);
    infoEl.replaceChildren(tabs, pane);
  }
  function setTab(t) { tab = t; cCount = null; if (item) renderInfo(); }

  // ---------- show / hide ----------
  function show(id) {
    const i = ctx.list.findIndex((x) => x.id === id);
    if (i < 0) return hide();
    if (!root) build();
    const first = !root.classList.contains('open');
    if (first) { opener = document.activeElement; document.body.classList.add('lb-open'); $('#app')?.setAttribute('inert', ''); $('header.site')?.setAttribute('inert', ''); $('footer.site')?.setAttribute('inert', ''); try { infoOpen = localStorage.getItem('va-info') === '1'; } catch {} }
    root.classList.add('open');
    player?.destroy(); player = null; root.querySelector('.vp')?.remove();
    idx = i; item = ctx.list[i]; token++; cur = -1; s = 1; tx = ty = 0;
    titleEl.textContent = item.title || item.file;
    counter.textContent = `${i + 1} / ${ctx.list.length}`;
    root.classList.toggle('is-video', item.type === 'video'); root.classList.remove('loading-hq');
    root.querySelector('.lb-prev').hidden = i === 0; root.querySelector('.lb-next').hidden = i === ctx.list.length - 1;
    const dl = item.type === 'video' ? 'v1080.mp4' : 'download.jpg';
    dlBtn.href = mediaUrl(item, dl);
    dlBtn.setAttribute('download', `${item.file.replace(/\.[^.]+$/, '')}-verdant-archive${item.type === 'video' ? '.mp4' : '.jpg'}`);
    zoomBtn.hidden = item.type === 'video';
    if (item.type === 'video') {
      img.hidden = true;
      player = createPlayer(item);
      stage.append(player.el);
    } else {
      img.hidden = false;
      img.alt = item.caption || item.title || (item.place?.text ? `Photo taken in ${item.place.text}` : `Photo ${item.file}`);
      img.src = mediaUrl(item, 'thumb.webp'); cur = 0; // already cached by the grid, so it paints instantly
      layout(false);
    }
    tab = tab === 'comments' && social.enabled() ? 'comments' : 'info'; cCount = null;
    rateHost.replaceChildren(); chatBtn.hidden = !social.enabled();
    if (social.enabled()) rateHost.append(social.stars(item.id, { compact: true }).el);
    setInfo(infoOpen); renderInfo();
    preloadNeighbours();
    if (first) (player ? player.el : root.querySelector('.lb-btn[aria-label^="Close"]')).focus();
    else if (player && root.contains(document.activeElement) && !document.activeElement.closest('.lb-top')) player.el.focus();
  }
  function hide() {
    if (!root || !root.classList.contains('open')) return;
    player?.destroy(); player = null; root.querySelector('.vp')?.remove();
    root.classList.remove('open'); token++;
    document.body.classList.remove('lb-open');
    for (const sel of ['#app', 'header.site', 'footer.site']) $(sel)?.removeAttribute('inert');
    img.removeAttribute('src');
    opener?.focus?.();
  }

  document.addEventListener('keydown', (e) => {
    if (!root?.classList.contains('open') || e.defaultPrevented) return;
    const typing = e.target.matches?.('input, textarea, select');
    if (player && !typing && player.handleKey(e)) { e.preventDefault(); return; }
    if (e.key === 'Escape') { if (document.fullscreenElement) return; e.preventDefault(); ctx.close(); }
    else if (e.key === 'ArrowRight' && !typing) { e.preventDefault(); go(1); }
    else if (e.key === 'ArrowLeft' && !typing) { e.preventDefault(); go(-1); }
    else if ((e.key === 'z' || e.key === 'Z') && !typing) toggleZoom();
    else if ((e.key === 'i' || e.key === 'I') && !typing) setInfo(!infoOpen);
    else if (e.key === 'Tab') { // keep focus inside the dialog
      const f = [...root.querySelectorAll('button, a[href], input, [tabindex="0"]')].filter((n) => !n.hidden && n.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
      else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
      else if (!root.contains(document.activeElement)) { first.focus(); e.preventDefault(); }
    }
  });

  return { show, hide, isOpen: () => !!root?.classList.contains('open') };
}
