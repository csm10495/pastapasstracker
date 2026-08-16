/**
 * Theme engine.
 *
 * Two independent axes:
 *   mode    = system | light | dark   (system follows the OS, live)
 *   palette = marinara | alfredo | basil | breadstick | chianti | slate | custom
 *
 * The active choice is mirrored into localStorage because the inline
 * bootstrap in index.html must read it synchronously before first paint.
 * IndexedDB is async and would arrive too late, producing a colour flash.
 */

import { PALETTES } from './schema.js';

const LS_KEY = 'ppt.theme';

const CUSTOM_VARS = ['accent', 'accent-contrast', 'accent-soft', 'accent-tint'];

const DEFAULTS = { mode: 'system', palette: 'marinara', custom: null };

const listeners = new Set();
let media = null;

function read() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

function write(value) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(value));
  } catch { /* storage may be unavailable; the session still themes correctly */ }
}

export function getTheme() {
  return read();
}

export function getPalettes() {
  return PALETTES;
}

/** Resolves 'system' against the OS preference. */
export function resolveScheme(mode = read().mode) {
  if (mode === 'light' || mode === 'dark') return mode;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function metaThemeColor(scheme) {
  const el = document.getElementById('meta-theme-color');
  if (!el) return;
  // Read the resolved surface colour so system chrome matches the app.
  const styles = getComputedStyle(document.documentElement);
  const color = styles.getPropertyValue('--accent').trim()
    || (scheme === 'dark' ? '#16120f' : '#faf6f4');
  el.setAttribute('content', color);
}

/** Applies a theme to the document and persists it. */
export function applyTheme(next = {}) {
  const current = read();
  const theme = { ...current, ...next };
  if (!PALETTES.some((p) => p.id === theme.palette)) theme.palette = DEFAULTS.palette;
  if (!['system', 'light', 'dark'].includes(theme.mode)) theme.mode = DEFAULTS.mode;

  const scheme = resolveScheme(theme.mode);
  const root = document.documentElement;

  root.setAttribute('data-theme', theme.palette);
  root.setAttribute('data-scheme', scheme);

  // Clear any previous custom overrides, then re-apply if the custom palette
  // is selected. Leaving stale values would leak colours across palettes.
  for (const name of CUSTOM_VARS) root.style.removeProperty('--' + name);
  if (theme.palette === 'custom' && theme.custom) {
    for (const [k, v] of Object.entries(theme.custom)) {
      if (v && CUSTOM_VARS.includes(k)) root.style.setProperty('--' + k, v);
    }
  }

  write(theme);
  metaThemeColor(scheme);
  updateSchemeGlyph(scheme);

  for (const fn of listeners) {
    try { fn(theme, scheme); } catch { /* a bad listener must not break theming */ }
  }
  return theme;
}

function updateSchemeGlyph(scheme) {
  for (const el of document.querySelectorAll('[data-scheme-glyph]')) {
    el.textContent = scheme === 'dark' ? '☀️' : '🌙';
  }
}

export function onThemeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Cycles the header toggle. From 'system' it jumps to the opposite of whatever
 * the OS currently gives, so the first tap always visibly changes something.
 */
export function toggleScheme() {
  const theme = read();
  const scheme = resolveScheme(theme.mode);
  return applyTheme({ mode: scheme === 'dark' ? 'light' : 'dark' });
}

/** Builds a custom palette from a single accent colour. */
export function deriveCustom(accent, scheme = resolveScheme()) {
  const rgb = hexToRgb(accent);
  if (!rgb) return null;
  const dark = scheme === 'dark';
  return {
    // Normalised so callers always get a canonical #rrggbb value, whatever
    // casing or missing hash they passed in.
    accent: toHex(rgb),
    'accent-contrast': luminance(rgb) > 0.55 ? '#101010' : '#ffffff',
    'accent-soft': mix(rgb, dark ? [34, 28, 25] : [255, 255, 255], dark ? 0.78 : 0.86),
    'accent-tint': mix(rgb, dark ? [22, 18, 15] : [255, 255, 255], dark ? 0.94 : 0.96),
  };
}

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex).trim());
  if (!m) return null;
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

function luminance([r, g, b]) {
  const f = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function mix(rgb, towards, amount) {
  const out = rgb.map((c, i) => Math.round(c + (towards[i] - c) * amount));
  return toHex(out);
}

function toHex(rgb) {
  return '#' + rgb.map((c) => c.toString(16).padStart(2, '0')).join('');
}

/**
 * Starts theming. Called once at boot. Attaches the OS-scheme listener so
 * 'system' mode retints live without a reload.
 */
export function initTheme() {
  applyTheme({});

  media = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => {
    if (read().mode === 'system') applyTheme({});
  };
  if (media.addEventListener) media.addEventListener('change', onChange);
  else media.addListener(onChange);

  const toggle = document.getElementById('scheme-toggle');
  if (toggle) toggle.addEventListener('click', () => toggleScheme());
}
