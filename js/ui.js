/**
 * DOM helpers, formatting, toasts, modals, and the photo lightbox.
 * Kept dependency-free and shared by every view.
 */

/** Creates an element. Children may be nodes or strings. */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === 'html') node.innerHTML = v;
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  appendAll(node, children);
  return node;
}

function appendAll(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* ------------------------------------------------------------ formatting - */

const currency = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' });

export function money(value) {
  if (value == null || !isFinite(value)) return '—';
  return currency.format(value);
}

/** Money with cents dropped when whole, for dense stat tiles. */
export function moneyShort(value) {
  if (value == null || !isFinite(value)) return '—';
  return Number.isInteger(value) ? currency.format(value).replace('.00', '') : currency.format(value);
}

export function num(value, digits = 0) {
  if (value == null || !isFinite(value)) return '—';
  return value.toFixed(digits);
}

export function pct(value) {
  if (value == null || !isFinite(value)) return '—';
  return Math.round(value * 100) + '%';
}

/** Today as a local YYYY-MM-DD string, never UTC-shifted. */
export function todayISO() {
  const d = new Date();
  return toISODate(d);
}

export function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Parses YYYY-MM-DD as a local calendar date (avoids the UTC off-by-one).
 * Rejects malformed input and impossible dates such as 2026-02-30, which
 * `new Date` would otherwise silently roll over into March.
 */
export function fromISODate(iso) {
  if (!iso) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso).trim());
  if (!match) return null;
  const [, ys, ms, ds] = match;
  const y = Number(ys);
  const m = Number(ms);
  const d = Number(ds);
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
    return null;
  }
  return date;
}

export function formatDate(iso, opts = { month: 'short', day: 'numeric', year: 'numeric' }) {
  const d = fromISODate(iso);
  if (!d) return '—';
  return d.toLocaleDateString(undefined, opts);
}

export function formatDateShort(iso) {
  return formatDate(iso, { month: 'short', day: 'numeric' });
}

export function daysBetween(aISO, bISO) {
  const a = fromISODate(aISO);
  const b = fromISODate(bISO);
  if (!a || !b) return null;
  return Math.round((b - a) / 86400000);
}

export function plural(n, one, many) {
  return `${n} ${n === 1 ? one : (many || one + 's')}`;
}

export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/* ---------------------------------------------------------------- toasts - */

export function toast(message, kind = '') {
  const host = document.getElementById('toast-host');
  if (!host) return;
  const node = el('div', { class: 'toast' + (kind ? ` toast--${kind}` : '') }, message);
  host.append(node);
  setTimeout(() => {
    node.style.opacity = '0';
    setTimeout(() => node.remove(), 200);
  }, 2600);
}

/* ---------------------------------------------------------------- modals - */

let closeActiveModal = null;

/**
 * Opens a modal. `build(close)` returns the modal body.
 * Resolves when the modal closes, with whatever value close() was given.
 */
export function modal(build, { wide = false } = {}) {
  const host = document.getElementById('modal-host');
  if (!host) return Promise.resolve();

  if (closeActiveModal) closeActiveModal();

  return new Promise((resolve) => {
    const previouslyFocused = document.activeElement;

    const close = (value) => {
      document.removeEventListener('keydown', onKey);
      host.hidden = true;
      clear(host);
      closeActiveModal = null;
      if (previouslyFocused?.focus) previouslyFocused.focus();
      resolve(value);
    };
    closeActiveModal = close;

    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(undefined); }
    };
    document.addEventListener('keydown', onKey);

    const box = el('div', {
      class: 'modal' + (wide ? ' modal--wide' : ''),
      role: 'dialog',
      'aria-modal': 'true',
    });
    appendAll(box, [build(close)]);

    clear(host);
    host.append(box);
    host.hidden = false;
    host.onclick = (e) => { if (e.target === host) close(undefined); };

    const focusable = box.querySelector(
      'input, select, textarea, button, [tabindex]:not([tabindex="-1"])',
    );
    if (focusable) focusable.focus();
  });
}

/** Confirmation dialog. Resolves true only when confirmed. */
export function confirmDialog({
  title = 'Are you sure?',
  message = '',
  confirmLabel = 'Confirm',
  danger = false,
} = {}) {
  return modal((close) => el('div', {},
    el('h2', {}, title),
    message ? el('p', { class: 'muted' }, message) : null,
    el('div', { class: 'btn-row btn-row--end', style: { marginTop: '1rem' } },
      el('button', { class: 'btn', onClick: () => close(false) }, 'Cancel'),
      el('button', {
        class: 'btn ' + (danger ? 'btn--danger' : 'btn--primary'),
        onClick: () => close(true),
      }, confirmLabel),
    ),
  )).then((v) => v === true);
}

/** Full-size photo viewer. */
export function lightbox(url, caption = '') {
  return modal((close) => el('div', { class: 'lightbox' },
    el('img', { src: url, alt: caption || 'Photo' }),
    caption ? el('p', { class: 'muted small center', style: { marginTop: '.5rem' } }, caption) : null,
    el('div', { class: 'btn-row btn-row--end', style: { marginTop: '.75rem' } },
      el('button', { class: 'btn', onClick: () => close() }, 'Close'),
    ),
  ), { wide: true });
}

/* ------------------------------------------------------------- fragments - */

export function empty(glyph, title, hint, action) {
  return el('div', { class: 'empty' },
    el('span', { class: 'empty__glyph' }, glyph),
    el('p', { style: { fontWeight: '650', color: 'var(--text)' } }, title),
    hint ? el('p', { class: 'small' }, hint) : null,
    action || null,
  );
}

export function statTile(value, label, { sub = '', tone = '' } = {}) {
  return el('div', { class: 'stat' },
    el('div', { class: 'stat__value' + (tone ? ` stat__value--${tone}` : '') }, value),
    el('div', { class: 'stat__label' }, label),
    sub ? el('div', { class: 'stat__sub' }, sub) : null,
  );
}

export function card(title, ...children) {
  return el('div', { class: 'card' },
    title ? el('div', { class: 'card__title' }, title) : null,
    ...children,
  );
}

export function field(label, control, hint) {
  return el('label', { class: 'field' },
    el('span', { class: 'field__label' }, label),
    control,
    hint ? el('span', { class: 'field__hint' }, hint) : null,
  );
}

export function bar(fraction) {
  const p = Math.max(0, Math.min(1, fraction || 0));
  return el('div', { class: 'bar' },
    el('div', { class: 'bar__fill', style: { width: (p * 100).toFixed(1) + '%' } }),
  );
}

/** Debounces a function, used for live-updating inputs. */
export function debounce(fn, ms = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
