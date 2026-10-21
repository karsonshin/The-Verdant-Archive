// Ratings and comments. GitHub Pages is static, so these live in a free Supabase project (see supabase/setup.sql and the README).
// With no project configured every function is a no-op and the UI hides itself.
import { h } from './util.js';

let cfg = null;
export const summary = new Map(); // media id -> { avg, n }
export const enabled = () => !!cfg;

const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode: fine */ } }
};
const voterId = () => {
  let v = store.get('va-voter');
  if (!v) { v = (crypto.randomUUID?.() || 'v' + Math.random().toString(36).slice(2) + Date.now().toString(36)); store.set('va-voter', v); }
  return v;
};

export function init(social) {
  if (social?.supabaseUrl && social?.supabaseAnonKey) cfg = { url: social.supabaseUrl.replace(/\/+$/, ''), key: social.supabaseAnonKey };
}

async function req(path, opts = {}) {
  const res = await fetch(`${cfg.url}/rest/v1/${path}`, { ...opts, headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json', ...opts.headers } });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || `HTTP ${res.status}`);
  return res.status === 204 ? null : res.json().catch(() => null);
}

export async function loadSummary() {
  if (!cfg) return;
  try { for (const r of await req('rating_summary?select=media_id,avg,n')) summary.set(r.media_id, { avg: +r.avg, n: +r.n }); } catch { /* offline: no ratings shown */ }
}

export const myRating = (id) => +store.get('va-r-' + id) || 0;

export async function rate(id, stars) {
  await req('rpc/rate_media', { method: 'POST', body: JSON.stringify({ p_media: id, p_voter: voterId(), p_stars: stars }) });
  const prev = myRating(id), s = summary.get(id) || { avg: 0, n: 0 };
  summary.set(id, prev ? { n: s.n, avg: (s.avg * s.n - prev + stars) / s.n } : { n: s.n + 1, avg: (s.avg * s.n + stars) / (s.n + 1) });
  store.set('va-r-' + id, String(stars));
}

export const fetchComments = (id) => req(`comments?media_id=eq.${encodeURIComponent(id)}&select=id,name,body,created_at&order=created_at.desc&limit=100`);
export const postComment = (id, name, body) => req('comments', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ media_id: id, name, body }) });

// ---------------------------------------------------------------- UI
const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8l2.9 6 6.5.9-4.7 4.6 1.1 6.5L12 17.7l-5.8 3.1 1.1-6.5L2.6 9.7l6.5-.9z"/></svg>';

/** Five clickable stars with a live average. Returns { el, refresh }. */
export function stars(id, { compact = false } = {}) {
  const wrap = h('div', { class: 'rate' + (compact ? ' compact' : ''), role: 'radiogroup', 'aria-label': 'Rate this' });
  const label = h('span', { class: 'rate-label' });
  const btns = [1, 2, 3, 4, 5].map((n) => h('button', {
    type: 'button', class: 'star', role: 'radio', 'aria-label': `${n} star${n > 1 ? 's' : ''}`, html: STAR,
    onclick: async () => { try { await rate(id, n); label.dataset.err = ''; } catch (e) { label.textContent = 'Could not save rating'; return; } paint(); },
    onmouseenter: () => paint(n), onfocus: () => paint(n), onmouseleave: () => paint(), onblur: () => paint(),
    onkeydown: (e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { btns[Math.min(4, n)].focus(); e.preventDefault(); } if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { btns[Math.max(0, n - 2)].focus(); e.preventDefault(); } }
  }));
  function paint(hover) {
    const s = summary.get(id), mine = myRating(id), shown = hover || mine || Math.round(s?.avg || 0);
    btns.forEach((b, i) => { b.classList.toggle('on', i < shown); b.classList.toggle('mine', !!mine && !hover && i < mine); b.setAttribute('aria-checked', String(mine === i + 1)); b.tabIndex = i === Math.max(0, (mine || 1) - 1) ? 0 : -1; });
    label.textContent = hover ? `${hover} star${hover > 1 ? 's' : ''}` : s ? `${s.avg.toFixed(1)} · ${s.n} rating${s.n === 1 ? '' : 's'}${mine ? ` · you gave ${mine}` : ''}` : 'Be the first to rate';
  }
  wrap.append(...btns, label);
  paint();
  return { el: wrap, refresh: paint };
}

/** Read-only star line, e.g. for slideshow captions. Empty string element when unrated. */
export function starLine(id) {
  const s = summary.get(id);
  return s ? h('span', { class: 'starline', title: `${s.avg.toFixed(1)} out of 5 from ${s.n} rating${s.n === 1 ? '' : 's'}` }, h('span', { class: 'starline-icon', html: STAR }), `${s.avg.toFixed(1)}`) : null;
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
function ago(iso) {
  const s = (new Date(iso) - Date.now()) / 1000, a = Math.abs(s);
  for (const [lim, unit, div] of [[60, 'second', 1], [3600, 'minute', 60], [86400, 'hour', 3600], [2592000, 'day', 86400], [31536000, 'month', 2592000], [Infinity, 'year', 31536000]]) if (a < lim) return rtf.format(Math.round(s / div), unit);
}

/** Comment list + form. Text is always set via textContent, never as HTML. */
export function commentsPanel(id, onCount = () => {}) {
  const list = h('ul', { class: 'comments' }), status = h('p', { class: 'c-status', role: 'status' });
  const name = h('input', { name: 'name', maxlength: '60', required: true, autocomplete: 'nickname', placeholder: 'Your name', 'aria-label': 'Your name' });
  name.value = store.get('va-name') || '';
  const body = h('textarea', { name: 'body', maxlength: '1000', required: true, rows: '3', placeholder: 'Write a comment…', 'aria-label': 'Comment' });
  const trap = h('input', { name: 'website', tabindex: '-1', autocomplete: 'off', class: 'hp', 'aria-hidden': 'true' }); // honeypot for bots
  const submit = h('button', { type: 'submit', class: 'primary' }, 'Post comment');
  const draw = (rows) => {
    onCount(rows.length);
    list.replaceChildren(...(rows.length ? rows.map((c) => h('li', {}, h('div', { class: 'c-head' }, h('strong', {}, c.name), h('time', { datetime: c.created_at, title: new Date(c.created_at).toLocaleString() }, `${new Date(c.created_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} · ${ago(c.created_at)}`)), h('p', {}, c.body))) : [h('li', { class: 'c-empty' }, 'No comments yet. Say something kind.')]));
  };
  const form = h('form', { class: 'c-form', onsubmit: async (e) => {
    e.preventDefault();
    if (trap.value) { body.value = ''; return; }
    const last = +store.get('va-last-comment') || 0;
    if (Date.now() - last < 15000) { status.textContent = 'Please wait a few seconds between comments.'; return; }
    const n = name.value.trim(), b = body.value.trim();
    if (!n || !b) return;
    submit.disabled = true; status.textContent = 'Posting…';
    try {
      await postComment(id, n, b);
      store.set('va-name', n); store.set('va-last-comment', String(Date.now()));
      body.value = ''; status.textContent = 'Posted.'; draw(await fetchComments(id));
    } catch (err) { status.textContent = 'Could not post: ' + err.message; }
    submit.disabled = false;
  } }, name, body, trap, h('div', { class: 'c-row' }, submit, status));
  status.textContent = 'Loading comments…';
  fetchComments(id).then((rows) => { status.textContent = ''; draw(rows); }).catch(() => { status.textContent = 'Comments could not be loaded.'; });
  return h('div', { class: 'c-panel' }, form, list);
}
