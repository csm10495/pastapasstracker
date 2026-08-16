/**
 * Install prompt and build identity.
 *
 * `beforeinstallprompt` fires early — often before ES modules finish loading —
 * so the event itself is captured by a tiny inline script in index.html and
 * parked on `window`. This module is the typed interface to it.
 */

const PROMPT_KEY = '__pptInstallPrompt';

/** True once the app is running as an installed PWA. */
export function isInstalled() {
  return window.matchMedia?.('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}

/** True when the browser has offered us an install prompt we can replay. */
export function canInstall() {
  return !!window[PROMPT_KEY];
}

/**
 * iOS Safari never fires `beforeinstallprompt`; installing there is a manual
 * Share → "Add to Home Screen". Detecting it lets the UI explain rather than
 * show a button that cannot work.
 */
export function isIos() {
  const ua = navigator.userAgent || '';
  const iOsDevice = /iPad|iPhone|iPod/.test(ua)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return iOsDevice && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

/**
 * Shows the browser's install prompt.
 * @returns {Promise<'accepted'|'dismissed'|'unavailable'>}
 */
export async function promptInstall() {
  const deferred = window[PROMPT_KEY];
  if (!deferred) return 'unavailable';
  deferred.prompt();
  const choice = await deferred.userChoice.catch(() => null);
  // The event can only be used once.
  window[PROMPT_KEY] = null;
  return choice?.outcome === 'accepted' ? 'accepted' : 'dismissed';
}

/** Notifies when installability changes, so a rendered view can update. */
export function onInstallChange(fn) {
  const handler = () => fn();
  window.addEventListener('ppt:installavailable', handler);
  window.addEventListener('ppt:installed', handler);
  return () => {
    window.removeEventListener('ppt:installavailable', handler);
    window.removeEventListener('ppt:installed', handler);
  };
}

/* ------------------------------------------------------ build identity -- */

/**
 * Reads the commit hash and build date written by the deploy workflow.
 * Both files are absent during local development, which is reported rather
 * than treated as an error.
 */
export async function getBuildInfo() {
  const [commit, built] = await Promise.all([
    fetchText('./commit_hash.txt'),
    fetchText('./build_date.txt'),
  ]);
  if (!commit && !built) return { development: true, commit: null, built: null, short: null };
  return {
    development: false,
    commit,
    built,
    short: commit ? commit.slice(0, 7) : null,
  };
}

async function fetchText(url) {
  try {
    // Bypass the cache so an updated deployment reports its real identity.
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    const text = (await res.text()).trim();
    // A missing file on a static host often 200s with an HTML error page.
    if (!text || /<[a-z!]/i.test(text)) return null;
    return text;
  } catch {
    return null;
  }
}

/** Repository the build came from, for linking a commit. */
export const REPO_URL = 'https://github.com/csm10495/pastapasstracker';
