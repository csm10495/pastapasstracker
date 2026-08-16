/**
 * Subpath hosting.
 *
 * GitHub Pages project sites are served from https://user.github.io/<repo>/,
 * not a domain root. Every asset path, the manifest, and the service worker
 * scope must therefore be relative. A single leading slash anywhere breaks
 * installation and offline support, so this is pinned by tests.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, sep } from 'node:path';

import { launchBrowser, Cdp, sleep } from '../helpers/cdp.mjs';
import { PROJECT_ROOT } from '../helpers/app.mjs';

const PREFIX = '/pasta-pass-tracker';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

/** Serves the project under PREFIX, mimicking a GitHub Pages project site. */
async function startSubpathServer() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let pathname = decodeURIComponent(url.pathname);

    // Anything outside the prefix 404s, exactly as it would on Pages.
    if (!pathname.startsWith(PREFIX)) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      return;
    }
    pathname = pathname.slice(PREFIX.length) || '/';
    if (pathname.endsWith('/')) pathname += 'index.html';

    const resolved = normalize(join(PROJECT_ROOT, pathname));
    const rootNorm = normalize(PROJECT_ROOT);
    if (!resolved.startsWith(rootNorm + sep) && resolved !== rootNorm) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    const info = await stat(resolved).catch(() => null);
    if (!info || info.isDirectory()) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      return;
    }
    const body = await readFile(resolved);
    res.writeHead(200, {
      'content-type': TYPES[extname(resolved).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache',
    }).end(body);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return {
    base: `http://127.0.0.1:${port}${PREFIX}/`,
    close: () => new Promise((done) => {
      server.closeAllConnections?.();
      server.close(() => done());
    }),
  };
}

/** Boots the app at a subpath and hands the CDP session plus base URL to fn. */
async function withSubpathApp(fn) {
  const server = await startSubpathServer();
  const browser = await launchBrowser();
  let cdp;
  try {
    const page = browser.targets.find((t) => t.type === 'page') || browser.targets[0];
    cdp = await Cdp.attach(page.webSocketDebuggerUrl);
    await cdp.send('Page.navigate', { url: server.base });

    // Wait for the router to paint rather than sleeping blindly.
    for (let i = 0; i < 60; i++) {
      const chars = await cdp.eval(
        `(() => { const v = document.getElementById('view');
                  return v && !v.querySelector('.loading') ? v.innerText.trim().length : 0; })()`,
      );
      if (chars > 20) break;
      await sleep(200);
    }
    return await fn({ cdp, base: server.base });
  } finally {
    cdp?.close();
    await browser.close();
    await server.close();
  }
}

/** Waits for the service worker to activate, returning its registration info. */
async function waitForServiceWorker(cdp) {
  for (let i = 0; i < 50; i++) {
    const sw = await cdp.eval(`(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg || !reg.active) return null;
      return { scope: reg.scope, script: reg.active.scriptURL };
    })()`);
    if (sw) return sw;
    await sleep(300);
  }
  return null;
}

test('the app boots when served from a repository subpath', async () => {
  await withSubpathApp(async ({ cdp }) => {
    const chars = await cdp.eval(
      `document.getElementById('view').innerText.trim().length`,
    );
    assert.ok(chars > 20, `only ${chars} characters rendered`);
    assert.deepEqual(cdp.errors, [], 'console errors while booting from a subpath');
  });
});

test('the manifest satisfies installability and resolves inside the subpath', async () => {
  await withSubpathApp(async ({ cdp, base }) => {
    const manifest = await cdp.eval(`(async () => {
      const link = document.querySelector('link[rel=manifest]');
      const href = new URL(link.getAttribute('href'), location.href).href;
      const res = await fetch(href);
      const m = await res.json();
      return {
        status: res.status,
        start: new URL(m.start_url, href).href,
        scope: new URL(m.scope, href).href,
        id: new URL(m.id ?? m.start_url, href).href,
        display: m.display,
        name: m.name,
        shortName: m.short_name,
        sizes: m.icons.map((i) => i.sizes),
        purposes: m.icons.map((i) => i.purpose || 'any'),
        iconUrls: m.icons.map((i) => new URL(i.src, href).href),
      };
    })()`);

    assert.equal(manifest.status, 200);
    assert.equal(manifest.start, base, 'start_url must stay inside the subpath');
    assert.equal(manifest.scope, base, 'scope must stay inside the subpath');
    assert.ok(manifest.id.startsWith(base), 'manifest id must stay inside the subpath');

    // Chrome's installability requirements.
    assert.ok(['standalone', 'fullscreen', 'minimal-ui'].includes(manifest.display));
    assert.ok(manifest.name?.length > 0);
    assert.ok(manifest.shortName?.length > 0);
    assert.ok(manifest.sizes.includes('192x192'), 'a 192px icon is required');
    assert.ok(manifest.sizes.includes('512x512'), 'a 512px icon is required');
    assert.ok(manifest.purposes.some((p) => p.includes('maskable')),
      'a maskable icon is needed for a good Android install');

    const icons = await cdp.eval(`(async () => {
      const out = [];
      for (const u of ${JSON.stringify(manifest.iconUrls)}) {
        const r = await fetch(u).catch(() => ({ status: 0 }));
        out.push(r.status);
      }
      return out;
    })()`);
    assert.ok(icons.every((s) => s === 200), `icon fetch statuses: ${icons.join(', ')}`);
  });
});

test('the service worker registers scoped to the subpath, not the domain root', async () => {
  await withSubpathApp(async ({ cdp, base }) => {
    const sw = await waitForServiceWorker(cdp);
    assert.ok(sw, 'service worker never activated');
    // A leading-slash registration would claim the whole origin and break
    // any other site hosted on the same github.io account.
    assert.equal(sw.scope, base);
    assert.equal(sw.script, `${base}sw.js`);
  });
});

test('the cached shell is stored under the subpath', async () => {
  await withSubpathApp(async ({ cdp, base }) => {
    assert.ok(await waitForServiceWorker(cdp), 'service worker never activated');
    const cache = await cdp.eval(`(async () => {
      const keys = await caches.keys();
      const c = await caches.open(keys[0]);
      const reqs = await c.keys();
      return { entries: reqs.length, urls: reqs.map((r) => r.url) };
    })()`);
    assert.ok(cache.entries > 10, `only ${cache.entries} entries cached`);
    assert.ok(cache.urls.every((u) => u.startsWith(base)),
      'every cached entry must live under the subpath');
  });
});

test('the app works offline when hosted at a subpath', async () => {
  await withSubpathApp(async ({ cdp }) => {
    assert.ok(await waitForServiceWorker(cdp), 'service worker never activated');

    // Reload once so the worker controls the page.
    await cdp.send('Page.reload');
    await sleep(1500);

    await cdp.send('Network.emulateNetworkConditions', {
      offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
    });
    try {
      await cdp.send('Page.reload');
      await sleep(2500);
      const home = await cdp.eval(`document.getElementById('view').innerText.trim().length`);
      assert.ok(home > 20, 'dashboard did not render offline at a subpath');

      const route = await cdp.eval(`(async () => {
        location.hash = '#/settings';
        await new Promise((r) => setTimeout(r, 1500));
        return document.getElementById('view').innerText.trim().length;
      })()`);
      assert.ok(route > 20, 'a lazily imported route failed to load offline at a subpath');
    } finally {
      await cdp.send('Network.emulateNetworkConditions', {
        offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
      });
    }
  });
});

test('no source file uses a root-absolute path', async () => {
  const { readdir } = await import('node:fs/promises');

  async function walk(dir, out = []) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', 'tests', 'icons'].includes(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full, out);
      else if (/\.(js|html|webmanifest|css)$/.test(entry.name)) out.push(full);
    }
    return out;
  }

  // Matches src="/x", href="/x", import from '/x', fetch('/x'), and
  // "start_url": "/" — all of which break subpath hosting.
  const offenders = [];
  for (const file of await walk(PROJECT_ROOT)) {
    const src = await readFile(file, 'utf8');
    const patterns = [
      /\b(?:src|href)\s*=\s*["']\/(?!\/)/g,
      /\bfrom\s+["']\/(?!\/)/g,
      /\b(?:fetch|register|import)\(\s*["']\/(?!\/)/g,
      /"(?:start_url|scope)"\s*:\s*"\/(?!\/)/g,
    ];
    for (const re of patterns) {
      if (re.test(src)) offenders.push(`${file.replace(PROJECT_ROOT, '')} (${re.source})`);
    }
  }
  assert.deepEqual(offenders, [], 'root-absolute paths break GitHub Pages subpath hosting');
});
