// A slowly turning, draggable ball of photos, drawn with WebGL2 (no libraries).
// The sphere is cut into latitude bands of near-square patches that share their edges exactly, and each photo is mapped onto one
// patch of the curved surface: no overlaps, no gaps, and every photo follows the curvature. Hover outlines the patch under the pointer.
import { h, mediaUrl } from './util.js';

const RAD = Math.PI / 180;
const AUTO_DEG_PER_S = 4; // one full turn in 90 seconds
const D = 4; // camera distance in sphere radii (mild perspective)
const ICON = {
  x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
};
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const ease = (t) => 1 - Math.pow(1 - t, 3);

const VERT = `#version 300 es
in vec3 aPos; in vec2 aUV; in vec2 aCell;
uniform vec2 uRot; uniform vec4 uProj;
out vec2 vUV; out vec2 vCell; out float vFacing;
void main() {
  float cb = cos(uRot.y), sb = sin(uRot.y), ca = cos(uRot.x), sa = sin(uRot.x);
  float x1 = aPos.x * cb + aPos.z * sb, z1 = -aPos.x * sb + aPos.z * cb;
  vec3 r = vec3(x1, aPos.y * ca - z1 * sa, aPos.y * sa + z1 * ca);
  float w = ${D.toFixed(1)} - r.z;
  gl_Position = vec4(r.x * uProj.x + uProj.z * w, -r.y * uProj.y + uProj.w * w, (w - ${D.toFixed(1)}) * 0.9, w);
  vUV = aUV; vCell = aCell; vFacing = r.z;
}`;
const FRAG = `#version 300 es
precision mediump float;
in vec2 vUV; in vec2 vCell; in float vFacing;
uniform sampler2D uTex; uniform float uHover;
out vec4 o;
void main() {
  vec3 c = texture(uTex, vUV).rgb * mix(0.55, 1.0, smoothstep(0.0, 0.75, vFacing)); // edges of the ball fall into shade
  float e = min(min(vCell.x, 1.0 - vCell.x), min(vCell.y, 1.0 - vCell.y));
  float ring = uHover * (1.0 - smoothstep(0.03, 0.055, e));                        // outline of the hovered patch
  c = mix(c + uHover * 0.05, vec3(0.56, 0.88, 0.70), ring * 0.95);
  o = vec4(c, 1.0);
}`;

/**
 * @param items   photos to show, best first (the best sit at the front when the page loads)
 * @param onOpen  called with an item when the visitor asks for the full viewer
 * @param social  the social module (ratings), used only if enabled
 * @returns null when WebGL2 is unavailable (the page then simply shows its other sections)
 */
export function createOrb({ items, onOpen, social, onFirstInteraction = () => {} }) {
  const canvas = h('canvas', { class: 'orb-canvas', 'aria-hidden': 'true' });
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: true });
  if (!gl) return null;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const small = innerWidth < 700;

  const stage = h('div', { class: 'orb', tabindex: '0', role: 'group', 'aria-label': 'Interactive ball of photos. Drag to rotate, click a photo to focus it. Arrow keys turn it and Enter focuses the photo in front. The same photos are listed below.' }, canvas);
  const live = h('p', { class: 'sr-only', 'aria-live': 'polite' });
  stage.append(live);

  // ---------------------------------------------------------------- program
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  let prog;
  try { prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG)); gl.linkProgram(prog); if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog)); } catch (e) { console.warn('orb: shader failed', e); return null; }
  gl.useProgram(prog);
  const U = Object.fromEntries(['uRot', 'uProj', 'uTex', 'uHover'].map((n) => [n, gl.getUniformLocation(prog, n)]));

  // ---------------------------------------------------------------- geometry: bands of near-square patches
  const targetN = small ? 48 : 84;
  const dLat = Math.PI / Math.max(4, Math.round(Math.PI / Math.sqrt((4 * Math.PI) / targetN)));
  const rows = Math.round(Math.PI / dLat);
  const cells = []; // { item, row, col, lon0, dLon, lat0, cLon, cLat, first, count }
  const rowCols = [];
  for (let r = 0; r < rows; r++) {
    const lat0 = Math.PI / 2 - r * dLat, mid = lat0 - dLat / 2;
    const cols = Math.max(4, Math.round((2 * Math.PI * Math.cos(mid)) / dLat));
    rowCols.push(cols);
    for (let c = 0; c < cols; c++) { const dLon = (2 * Math.PI) / cols; cells.push({ row: r, col: c, lat0, dLon, lon0: -Math.PI + c * dLon, cLat: mid, cLon: -Math.PI + (c + 0.5) * dLon }); }
  }
  // best photos go to the patches nearest the point that faces the viewer first
  [...cells].sort((a, b) => Math.acos(Math.cos(a.cLat) * Math.cos(a.cLon)) - Math.acos(Math.cos(b.cLat) * Math.cos(b.cLon))).forEach((cell, k) => { cell.item = items[k % items.length]; });

  const verts = [];
  for (const cell of cells) {
    cell.first = verts.length / 7;
    const su = clamp(Math.ceil(cell.dLon / RAD / 3), 4, 48), sv = 6;
    const A = (cell.dLon * Math.cos(cell.cLat)) / dLat, I = cell.item.w / cell.item.h; // patch aspect vs photo aspect: crop like object-fit: cover
    const vert = (i, j) => {
      const u = i / su, v = j / sv, lon = cell.lon0 + u * cell.dLon, lat = cell.lat0 - v * dLat;
      const tu = I > A ? 0.5 + (u - 0.5) * (A / I) : u, tv = I > A ? v : 0.5 + (v - 0.5) * (I / A);
      verts.push(Math.cos(lat) * Math.sin(lon), -Math.sin(lat), Math.cos(lat) * Math.cos(lon), tu, tv, u, v);
    };
    for (let j = 0; j < sv; j++) for (let i = 0; i < su; i++) { vert(i, j); vert(i + 1, j); vert(i, j + 1); vert(i + 1, j); vert(i + 1, j + 1); vert(i, j + 1); }
    cell.count = verts.length / 7 - cell.first;
  }
  gl.bindVertexArray(gl.createVertexArray());
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
  [['aPos', 3, 0], ['aUV', 2, 3], ['aCell', 2, 5]].forEach(([n, size, off]) => { const loc = gl.getAttribLocation(prog, n); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 28, off * 4); });
  gl.enable(gl.DEPTH_TEST); gl.clearColor(0, 0, 0, 0);

  // ---------------------------------------------------------------- textures (one per photo, shared by repeats)
  const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
  const mkTex = () => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); return t; };
  const blank = mkTex(); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([14, 33, 24, 255]));
  const textures = new Map();
  let destroyed = false;
  for (const it of new Set(cells.map((c) => c.item))) {
    textures.set(it, blank);
    const img = new Image(); img.decoding = 'async';
    img.onload = () => {
      if (destroyed) return;
      const t = mkTex(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(4, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
      textures.set(it, t);
    };
    img.src = mediaUrl(it, 'thumb.webp');
  }

  // ---------------------------------------------------------------- state + projection helpers
  let W = 1, H = 1, cyPx = 0, fPx = 1;
  let rx = -8, ry = 0, spinX = 0, spinY = reduce ? 0 : AUTO_DEG_PER_S;
  let dragging = false, moved = false, focusIdx = -1, hover = -1, anim = null, visible = true, raf = 0, interacted = false, card = null, last = performance.now();

  function layout() {
    W = stage.clientWidth || 1; H = stage.clientHeight || 1;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    const R = clamp(Math.min(W, H * 0.78) * (small ? 0.46 : 0.45), 140, 600);
    cyPx = H * (small ? 0.38 : 0.41);
    fPx = R * Math.sqrt(D * D - 1); // so the sphere's silhouette is R pixels in radius
  }
  const rotate = (x, y, z) => { // model -> view, same order as CSS rotateX(rx) rotateY(ry)
    const a = rx * RAD, b = ry * RAD, cb = Math.cos(b), sb = Math.sin(b), ca = Math.cos(a), sa = Math.sin(a);
    const x1 = x * cb + z * sb, z1 = -x * sb + z * cb;
    return [x1, y * ca - z1 * sa, y * sa + z1 * ca];
  };
  const project = (lon, lat) => { // screen position of a point on the sphere
    const [x, y, z] = rotate(Math.cos(lat) * Math.sin(lon), -Math.sin(lat), Math.cos(lat) * Math.cos(lon)), w = D - z;
    return { x: W / 2 + (x * fPx) / w, y: cyPx + (y * fPx) / w, z };
  };
  function pick(px, py) { // which patch is under this pixel (-1 for none): cast a ray at the sphere
    const a = (px - W / 2) / fPx, b = (py - cyPx) / fPx, A = a * a + b * b + 1, disc = D * D - A * (D * D - 1);
    if (disc < 0) return -1;
    const w = (D - Math.sqrt(disc)) / A, z = D - w, x = a * w, y = b * w;
    const ca = Math.cos(-rx * RAD), sa = Math.sin(-rx * RAD), cb = Math.cos(-ry * RAD), sb = Math.sin(-ry * RAD);
    const y1 = y * ca - z * sa, z1 = y * sa + z * ca;     // undo rotateX
    const mx = x * cb + z1 * sb, mz = -x * sb + z1 * cb;  // undo rotateY
    const lat = Math.asin(clamp(-y1, -1, 1)), lon = Math.atan2(mx, mz);
    const r = clamp(Math.floor((Math.PI / 2 - lat) / dLat), 0, rows - 1), cols = rowCols[r];
    const c = clamp(Math.floor(((lon + Math.PI) / (2 * Math.PI)) * cols), 0, cols - 1);
    return cells.findIndex((t) => t.row === r && t.col === c);
  }
  const facing = (t) => project(t.cLon, t.cLat).z; // > 0 faces the viewer
  const rect = (t) => { // screen box of a patch, for the grow-out animation
    const pts = [[t.lon0, t.lat0], [t.lon0 + t.dLon, t.lat0], [t.lon0, t.lat0 - dLat], [t.lon0 + t.dLon, t.lat0 - dLat]].map(([lo, la]) => project(lo, la));
    const l = Math.min(...pts.map((p) => p.x)), tp = Math.min(...pts.map((p) => p.y)), box = stage.getBoundingClientRect();
    return { left: box.left + l, top: box.top + tp, width: Math.max(...pts.map((p) => p.x)) - l, height: Math.max(...pts.map((p) => p.y)) - tp };
  };

  // ---------------------------------------------------------------- drawing + animation
  function draw() {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniform2f(U.uRot, rx * RAD, ry * RAD);
    gl.uniform4f(U.uProj, fPx / (W / 2), fPx / (H / 2), 0, 1 - (2 * cyPx) / H);
    gl.uniform1i(U.uTex, 0); gl.activeTexture(gl.TEXTURE0);
    cells.forEach((t, k) => { gl.bindTexture(gl.TEXTURE_2D, textures.get(t.item) || blank); gl.uniform1f(U.uHover, k === hover ? 1 : 0); gl.drawArrays(gl.TRIANGLES, t.first, t.count); });
  }
  function tick(now) {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (!visible || document.body.classList.contains('lb-open') || document.body.classList.contains('board-open')) return; // nothing to draw behind the lightbox or the headline board
    if (anim) {
      const p = clamp((now - anim.t0) / anim.dur, 0, 1), e = ease(p);
      rx = anim.fx + (anim.tx - anim.fx) * e; ry = anim.fy + (anim.ty - anim.fy) * e;
      if (p >= 1) { const done = anim.done; anim = null; done?.(); }
    } else if (!dragging && focusIdx < 0) {
      const auto = reduce ? 0 : AUTO_DEG_PER_S;
      spinY += (auto - spinY) * (1 - Math.exp(-1.1 * dt)); // coast back to the slow drift
      spinX *= Math.exp(-3 * dt);
      ry += spinY * dt; rx = clamp(rx + spinX * dt, -80, 80);
    }
    draw();
  }

  // ---------------------------------------------------------------- pointer: hover, drag, click
  const local = (e) => { const b = canvas.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
  let sx = 0, sy = 0, lx = 0, ly = 0, lt = 0, vx = 0, vy = 0;
  const k = 0.28; // degrees per pixel
  const setHover = (i) => { if (i !== hover) { hover = i; stage.classList.toggle('over', i >= 0); } };
  stage.addEventListener('pointerdown', (e) => {
    if (e.button || card) return;
    dragging = true; moved = false; anim = null; sx = lx = e.clientX; sy = ly = e.clientY; lt = performance.now(); vx = vy = 0;
  });
  stage.addEventListener('pointermove', (e) => {
    if (!dragging) { if (!card && e.pointerType === 'mouse') setHover(pick(...local(e))); return; }
    if (!moved && Math.hypot(e.clientX - sx, e.clientY - sy) > 6) { moved = true; setHover(-1); stage.setPointerCapture(e.pointerId); stage.classList.add('grabbing'); if (!interacted) { interacted = true; onFirstInteraction(); } }
    if (!moved) return;
    const now = performance.now(), dt = Math.max(1, now - lt) / 1000, dx = e.clientX - lx, dy = e.clientY - ly;
    ry += dx * k; rx = clamp(rx - dy * k, -80, 80);
    vy = vy * 0.6 + ((dx * k) / dt) * 0.4; vx = vx * 0.6 + ((-dy * k) / dt) * 0.4; // deg/s, smoothed
    lx = e.clientX; ly = e.clientY; lt = now;
  });
  stage.addEventListener('pointerup', (e) => {
    if (!dragging) return;
    dragging = false; stage.classList.remove('grabbing');
    if (moved) { spinY = clamp(vy, -240, 240); spinX = clamp(vx, -160, 160); if (performance.now() - lt > 90) spinX = spinY = 0; }
    else if (!card) { const i = pick(...local(e)); if (i >= 0) focusTile(i); }
  });
  const cancel = () => { dragging = false; stage.classList.remove('grabbing'); };
  stage.addEventListener('pointercancel', cancel); stage.addEventListener('lostpointercapture', cancel);
  stage.addEventListener('pointerleave', () => setHover(-1));
  stage.addEventListener('contextmenu', (e) => e.preventDefault());
  stage.addEventListener('dragstart', (e) => e.preventDefault());

  stage.addEventListener('keydown', (e) => { // arrows turn the ball, Enter focuses whatever faces you
    if (card) return;
    const step = 18;
    if (e.key === 'ArrowLeft') ry -= step; else if (e.key === 'ArrowRight') ry += step;
    else if (e.key === 'ArrowUp') rx = clamp(rx + step, -80, 80); else if (e.key === 'ArrowDown') rx = clamp(rx - step, -80, 80);
    else if ((e.key === 'Enter' || e.key === ' ') && e.target === stage) focusTile(cells.indexOf(cells.reduce((a, b) => (facing(b) > facing(a) ? b : a))));
    else return;
    e.preventDefault(); spinY = 0;
  });

  // ---------------------------------------------------------------- focus: rotate the chosen photo to the front, then open it large
  function focusTile(idx) {
    const t = cells[idx]; if (!t) return;
    if (!interacted) { interacted = true; onFirstInteraction(); }
    focusIdx = idx; spinX = spinY = 0; setHover(-1);
    const wrap = (from, to) => from + ((((to - from) % 360) + 540) % 360) - 180; // the short way round
    anim = { t0: performance.now(), dur: reduce ? 1 : 750, fx: rx, fy: ry, tx: clamp(-t.cLat / RAD, -80, 80), ty: wrap(ry, -t.cLon / RAD), done: () => openCard(idx) };
    stage.classList.add('focusing');
  }

  function openCard(idx) {
    const t = cells[idx], it = t.item, from = rect(t);
    const img = h('img', { src: mediaUrl(it, 'thumb.webp'), alt: it.caption || it.title || it.file, draggable: 'false' });
    const full = new Image(); full.onload = () => { if (card && img.isConnected) img.src = full.src; }; full.src = mediaUrl(it, 'medium.webp');
    const title = h('strong', {}, it.title || it.place?.city || it.file);
    const sub = h('span', {}, [it.place?.text, it.taken?.local && new Date(it.taken.local + 'Z').toLocaleDateString(undefined, { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' })].filter(Boolean).join(' · '));
    const rate = social?.enabled() ? social.stars(it.id, { compact: true }).el : null;
    const btn = (cls, label, icon, fn) => h('button', { type: 'button', class: 'orb-btn ' + cls, 'aria-label': label, title: label, html: icon, onclick: fn });
    card = h('div', { class: 'orb-focus', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Photo preview', onclick: (e) => { if (e.target === card) closeCard(); } },
      h('div', { class: 'orb-card' }, img,
        h('div', { class: 'orb-cap' }, h('div', {}, title, sub), rate),
        h('div', { class: 'orb-actions' }, btn('', 'Previous photo', ICON.prev, () => step(-1)), h('button', { type: 'button', class: 'cta', onclick: () => { const i = it; closeCard(); onOpen(i); } }, 'Open full view'), btn('', 'Next photo', ICON.next, () => step(1)))),
      btn('orb-x', 'Close', ICON.x, closeCard));
    card.addEventListener('contextmenu', (e) => e.preventDefault());
    stage.append(card);
    live.textContent = `Focused: ${it.title || it.file}`;
    card.querySelector('.cta').focus({ preventScroll: true });
    if (!reduce) { // grow out of the patch the visitor picked
      const to = img.getBoundingClientRect();
      if (to.width && from.width) img.animate([{ transform: `translate(${from.left + from.width / 2 - to.left - to.width / 2}px, ${from.top + from.height / 2 - to.top - to.height / 2}px) scale(${from.width / to.width}, ${from.height / to.height})`, opacity: 0.7 }, { transform: 'none', opacity: 1 }], { duration: 520, easing: 'cubic-bezier(.2,.7,.2,1)' });
    }
  }

  function step(d) { // next/previous photo in list order, via the copy of it that is nearest the front
    if (!card) return;
    const i = (items.indexOf(cells[focusIdx].item) + d + items.length) % items.length;
    const cands = cells.filter((t) => t.item === items[i]);
    if (!cands.length) return;
    card.remove(); card = null;
    focusTile(cells.indexOf(cands.reduce((a, b) => (facing(b) > facing(a) ? b : a))));
  }
  function closeCard() { card?.remove(); card = null; focusIdx = -1; anim = null; stage.classList.remove('focusing'); stage.focus({ preventScroll: true }); }

  const onKey = (e) => {
    if (!card || document.body.classList.contains('lb-open')) return;
    if (e.key === 'Escape') { e.preventDefault(); closeCard(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
  };
  document.addEventListener('keydown', onKey);

  const ro = new ResizeObserver(() => { layout(); draw(); }); ro.observe(stage);
  const io = new IntersectionObserver((es) => { visible = es[0].isIntersecting; }, { threshold: 0.05 }); io.observe(stage);
  layout();
  raf = requestAnimationFrame(tick);

  return {
    el: stage,
    destroy() {
      destroyed = true; cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); document.removeEventListener('keydown', onKey);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  };
}
