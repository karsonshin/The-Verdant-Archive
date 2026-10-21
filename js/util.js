export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Tiny element helper: h('a', {href}, 'text', childNode) */
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  return el;
}

/** Minimal, safe markdown: headings, lists, quotes, paragraphs, **bold**, *italic*, `code`, [links](http…). */
export function md(src = '') {
  const inline = (t) =>
    esc(t)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])[*_]([^*_]+)[*_](?=[\s).,;:!?]|$)/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\(((?:https?:\/\/|mailto:|#|\/)[^)\s]*)\)/g, '<a href="$2" rel="noopener">$1</a>')
      .replace(/(^|[\s(])([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g, '$1<a href="mailto:$2">$2</a>')
      .replace(/\n/g, '<br>');
  return src.replace(/\r/g, '').split(/\n{2,}/).map((b) => {
    b = b.trim();
    if (!b) return '';
    let m;
    if ((m = /^(#{1,3})\s+(.*)$/s.exec(b))) return `<h${m[1].length + 1}>${inline(m[2])}</h${m[1].length + 1}>`;
    if (/^([-*]\s)/.test(b)) return `<ul>${b.split('\n').map((l) => `<li>${inline(l.replace(/^[-*]\s+/, ''))}</li>`).join('')}</ul>`;
    if (/^>\s?/.test(b)) return `<blockquote>${inline(b.replace(/^>\s?/gm, ''))}</blockquote>`;
    return `<p>${inline(b)}</p>`;
  }).join('\n');
}

export const plain = (src = '') => src.replace(/[#>*_`]|\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim();

/** Capture time is stored as wall-clock text; parse it as UTC so formatting with timeZone:'UTC' reproduces it exactly. */
export const wall = (local) => new Date(local + 'Z');
export const fmtWall = (local, opts) => wall(local).toLocaleString(undefined, { timeZone: 'UTC', ...opts });

export const fmtBytes = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
export const fmtDur = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export const debounce = (fn, ms) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

export const mediaUrl = (item, name) => `media/${item.id}/${name}`;
