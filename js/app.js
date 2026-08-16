/**
 * App bootstrap and hash router.
 *
 * Views are lazily imported and each exports:
 *   export async function render(container, params) -> optional cleanup fn
 *
 * The container arrives already cleared. Returning a function lets a view
 * unsubscribe listeners when the user navigates away.
 */

import { initTheme } from './theme.js';
import { ensureSeeded } from './db.js';
import { revokeAllUrls } from './photos.js';
import { el, clear, toast } from './ui.js';

const ROUTES = [
  { pattern: '/', load: () => import('./views/dashboard.js') },
  { pattern: '/visits', load: () => import('./views/visits.js') },
  { pattern: '/log', load: () => import('./views/log.js') },
  { pattern: '/visits/new', load: () => import('./views/visit-form.js') },
  { pattern: '/visits/:id/edit', load: () => import('./views/visit-form.js') },
  { pattern: '/visits/:id', load: () => import('./views/visit-detail.js') },
  { pattern: '/people', load: () => import('./views/people.js') },
  { pattern: '/locations', load: () => import('./views/locations.js') },
  { pattern: '/combos', load: () => import('./views/combos.js') },
  { pattern: '/stats', load: () => import('./views/stats-view.js') },
  { pattern: '/settings', load: () => import('./views/settings.js') },
];

function matchRoute(path) {
  const parts = path.split('/').filter(Boolean);
  for (const route of ROUTES) {
    const routeParts = route.pattern.split('/').filter(Boolean);
    if (routeParts.length !== parts.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < routeParts.length; i++) {
      const rp = routeParts[i];
      if (rp.startsWith(':')) params[rp.slice(1)] = decodeURIComponent(parts[i]);
      else if (rp !== parts[i]) { ok = false; break; }
    }
    if (ok) return { route, params };
  }
  return null;
}

function currentPath() {
  const hash = window.location.hash || '#/';
  return hash.replace(/^#/, '') || '/';
}

let cleanup = null;
let renderToken = 0;

/**
 * A cache-first service worker can pin a broken script indefinitely, leaving
 * the app stuck with no way out. When a lazily imported view fails to load or
 * parse, purge the caches and reload once so the next boot fetches fresh code.
 */
async function recoverFromBadModule(err) {
  const message = String(err?.message || err);
  const looksLikeLoadFailure = /Unexpected end of input|Unexpected token|Failed to fetch|error loading dynamically imported module|Importing a module script failed/i
    .test(message);
  if (!looksLikeLoadFailure) return false;

  // Only attempt this once per session, or a genuinely broken build would
  // reload forever.
  const KEY = 'ppt.recovered';
  try {
    if (sessionStorage.getItem(KEY)) return false;
    sessionStorage.setItem(KEY, '1');
  } catch {
    return false;
  }

  try {
    if (globalThis.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.unregister();
  } catch {
    /* recovery is best effort */
  }
  window.location.reload();
  return true;
}

async function renderRoute() {
  const token = ++renderToken;
  const path = currentPath();
  const container = document.getElementById('view');
  if (!container) return;

  if (typeof cleanup === 'function') {
    try { cleanup(); } catch { /* a failing cleanup must not block navigation */ }
    cleanup = null;
  }
  revokeAllUrls();

  const match = matchRoute(path);
  clear(container);

  if (!match) {
    container.append(el('div', { class: 'empty' },
      el('span', { class: 'empty__glyph' }, '🍽️'),
      el('p', {}, 'That page does not exist.'),
      el('a', { class: 'btn', href: '#/' }, 'Go home'),
    ));
    updateNav(path);
    return;
  }

  container.append(el('div', { class: 'loading' }, 'Loading…'));
  updateNav(path);

  try {
    const module = await match.route.load();
    if (token !== renderToken) return; // a newer navigation superseded this one
    clear(container);
    cleanup = await module.render(container, match.params);
  } catch (err) {
    if (token !== renderToken) return;
    console.error(err);
    if (await recoverFromBadModule(err)) return;
    clear(container);
    container.append(el('div', { class: 'empty' },
      el('span', { class: 'empty__glyph' }, '⚠️'),
      el('p', {}, 'Something went wrong loading this page.'),
      el('p', { class: 'small muted' }, err?.message || String(err)),
      el('div', { class: 'btn-row', style: { justifyContent: 'center', marginTop: '.75rem' } },
        el('a', { class: 'btn', href: '#/' }, 'Go home'),
        el('button', {
          class: 'btn btn--primary',
          onClick: async () => {
            try {
              if (globalThis.caches) {
                const keys = await caches.keys();
                await Promise.all(keys.map((k) => caches.delete(k)));
              }
              const reg = await navigator.serviceWorker?.getRegistration();
              await reg?.unregister();
            } catch { /* best effort */ }
            try { sessionStorage.removeItem('ppt.recovered'); } catch { /* ignore */ }
            window.location.reload();
          },
        }, 'Clear cache and reload'),
      ),
    ));
  }

  container.focus?.();
  window.scrollTo(0, 0);
}

function updateNav(path) {
  for (const link of document.querySelectorAll('[data-nav]')) {
    const target = link.getAttribute('data-nav');
    const active = target === '/'
      ? path === '/'
      : path === target || path.startsWith(target + '/');
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

/** Navigates programmatically. */
export function go(path) {
  const next = '#' + (path.startsWith('/') ? path : '/' + path);
  if (window.location.hash === next) renderRoute();
  else window.location.hash = next;
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // Relative URL keeps the scope correct when hosted from a repo subpath.
  if (window.location.protocol === 'file:') return;
  try {
    const reg = await navigator.serviceWorker.register('./sw.js');
    reg.addEventListener('updatefound', () => {
      const installing = reg.installing;
      if (!installing) return;
      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
          toast('Update available — reopen the app to apply.');
        }
      });
    });
  } catch {
    /* offline support is a progressive enhancement; ignore failures */
  }
}

async function boot() {
  initTheme();

  try {
    await ensureSeeded();
  } catch (err) {
    console.error(err);
    const container = document.getElementById('view');
    clear(container);
    container.append(el('div', { class: 'empty' },
      el('span', { class: 'empty__glyph' }, '💾'),
      el('p', {}, 'Could not open local storage.'),
      el('p', { class: 'small muted' },
        'Private browsing or blocked site data can prevent this app from saving.'),
    ));
    return;
  }

  window.addEventListener('hashchange', renderRoute);
  if (!window.location.hash) window.location.hash = '#/';
  await renderRoute();
  registerServiceWorker();
}

boot();
