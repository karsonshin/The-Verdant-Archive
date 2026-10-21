import { h, fmtDur, mediaUrl } from './util.js';

const ICON = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>',
  vol: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5zM15 8.5a5 5 0 0 1 0 7M17.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  mute: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z"/><path d="M15.5 9.5l5 5m0-5l-5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  loop: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 3l3 3-3 3M4 11V9a3 3 0 0 1 3-3h13M7 21l-3-3 3-3m13-2v2a3 3 0 0 1-3 3H4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  full: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
};
const btn = (label, icon, onclick) => h('button', { type: 'button', class: 'vp-btn', 'aria-label': label, title: label, html: icon, onclick });

/** Custom video player. Keyboard handling is exposed as handleKey() so the lightbox can route keys to it. */
export function createPlayer(item) {
  const video = h('video', { playsinline: true, preload: 'metadata', poster: mediaUrl(item, 'medium.webp'), 'aria-label': item.title || item.file });
  const files = item.files || [];
  const small = Math.min(innerWidth, innerHeight) * devicePixelRatio < 900 || navigator.connection?.saveData;
  const order = (small ? ['v720.mp4', 'v1080.mp4'] : ['v1080.mp4', 'v720.mp4']).filter((f) => files.includes(f));
  let srcIdx = 0;
  video.src = mediaUrl(item, order[0]);
  video.addEventListener('error', () => { if (++srcIdx < order.length) { const t = video.currentTime; video.src = mediaUrl(item, order[srcIdx]); video.currentTime = t; } });
  video.addEventListener('contextmenu', (e) => e.preventDefault());

  const playBtn = btn('Play', ICON.play, () => toggle());
  const time = h('span', { class: 'vp-time' }, '0:00 / 0:00');
  const played = h('div', { class: 'vp-played' }), buffered = h('div', { class: 'vp-buffered' });
  const bar = h('div', { class: 'vp-bar', role: 'slider', tabindex: '0', 'aria-label': 'Seek', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, buffered, played);
  const muteBtn = btn('Mute', ICON.vol, () => { video.muted = !video.muted; });
  const vol = h('input', { type: 'range', min: '0', max: '1', step: '0.05', value: '1', class: 'vp-vol', 'aria-label': 'Volume', oninput: () => { video.volume = +vol.value; video.muted = video.volume === 0; } });
  const loopBtn = btn('Loop', ICON.loop, () => { video.loop = !video.loop; loopBtn.setAttribute('aria-pressed', video.loop); });
  loopBtn.setAttribute('aria-pressed', 'false');
  const root = h('div', { class: 'vp', tabindex: '-1', role: 'group', 'aria-label': 'Video player' }, video,
    h('div', { class: 'vp-controls' }, bar, h('div', { class: 'vp-row' }, playBtn, time, h('span', { class: 'vp-spacer' }), muteBtn, vol, loopBtn, btn('Fullscreen', ICON.full, () => fullscreen()))));

  const dur = () => (isFinite(video.duration) && video.duration) || item.duration || 0;
  function toggle() { video.paused ? video.play().catch(() => {}) : video.pause(); }
  function fullscreen() { document.fullscreenElement ? document.exitFullscreen() : root.requestFullscreen?.(); }
  const seek = (d) => { video.currentTime = Math.min(dur(), Math.max(0, video.currentTime + d)); };

  function paint() {
    const d = dur(), p = d ? (video.currentTime / d) * 100 : 0;
    played.style.width = p + '%';
    bar.setAttribute('aria-valuenow', Math.round(p));
    bar.setAttribute('aria-valuetext', `${fmtDur(video.currentTime)} of ${fmtDur(d)}`);
    time.textContent = `${fmtDur(video.currentTime)} / ${fmtDur(d)}`;
    if (video.buffered.length) buffered.style.width = (video.buffered.end(video.buffered.length - 1) / (d || 1)) * 100 + '%';
  }
  video.addEventListener('timeupdate', paint);
  video.addEventListener('progress', paint);
  video.addEventListener('loadedmetadata', paint);
  video.addEventListener('click', toggle);
  const onPlayState = () => {
    playBtn.innerHTML = video.paused ? ICON.play : ICON.pause;
    playBtn.setAttribute('aria-label', video.paused ? 'Play' : 'Pause');
    root.classList.toggle('is-paused', video.paused);
  };
  video.addEventListener('play', onPlayState); video.addEventListener('pause', onPlayState);
  video.addEventListener('volumechange', () => {
    muteBtn.innerHTML = video.muted || video.volume === 0 ? ICON.mute : ICON.vol;
    muteBtn.setAttribute('aria-label', video.muted ? 'Unmute' : 'Mute');
    vol.value = video.muted ? 0 : video.volume;
  });
  onPlayState();

  // Scrubbing: drag anywhere on the bar; pointer capture keeps the drag alive outside it.
  const scrubTo = (e) => { const r = bar.getBoundingClientRect(); video.currentTime = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * dur(); paint(); };
  bar.addEventListener('pointerdown', (e) => { bar.setPointerCapture(e.pointerId); bar.dataset.drag = '1'; scrubTo(e); });
  bar.addEventListener('pointermove', (e) => { if (bar.dataset.drag) scrubTo(e); });
  bar.addEventListener('pointerup', () => delete bar.dataset.drag);
  bar.addEventListener('pointercancel', () => delete bar.dataset.drag);
  bar.addEventListener('keydown', (e) => {
    if (e.key === 'Home') { video.currentTime = 0; e.preventDefault(); }
    if (e.key === 'End') { video.currentTime = dur(); e.preventDefault(); }
  });

  // Controls fade out while playing and the pointer is idle.
  let idle;
  const wake = () => { root.classList.remove('idle'); clearTimeout(idle); if (!video.paused) idle = setTimeout(() => root.classList.add('idle'), 2500); };
  root.addEventListener('pointermove', wake); root.addEventListener('focusin', wake); video.addEventListener('play', wake); video.addEventListener('pause', wake);

  return {
    el: root, video,
    play: () => video.play().catch(() => {}),
    /** Returns true if the key was consumed. */
    handleKey(e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return false;
      const k = e.key;
      if (e.target.closest?.('input[type=range], .vp-bar') && (k === 'ArrowLeft' || k === 'ArrowRight') ) { seek(k === 'ArrowLeft' ? -5 : 5); return true; }
      if (k === ' ' || k === 'k') { if (e.target.closest?.('.vp button')) return false; toggle(); return true; }
      if (k === 'ArrowLeft' && !e.shiftKey) { seek(-5); return true; }
      if (k === 'ArrowRight' && !e.shiftKey) { seek(5); return true; }
      if (k === 'm' || k === 'M') { video.muted = !video.muted; return true; }
      if (k === 'f' || k === 'F') { fullscreen(); return true; }
      return false;
    },
    destroy() { video.pause(); video.removeAttribute('src'); video.load(); }
  };
}
