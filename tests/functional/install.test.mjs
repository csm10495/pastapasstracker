/**
 * Functional tests for install/deployment UI and related PWA details.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PROJECT_ROOT, withApp } from '../helpers/app.mjs';

const COMMIT_FILE = resolve(PROJECT_ROOT, 'commit_hash.txt');
const BUILD_FILE = resolve(PROJECT_ROOT, 'build_date.txt');
const FULL_HASH = '1234567890abcdef1234567890abcdef12345678';
const BUILD_DATE = '2026-08-15T18:09:57Z';
const PHOTO_ACCEPT = 'image/*;capture=camera';

function removeBuildFiles() {
  rmSync(COMMIT_FILE, { force: true });
  rmSync(BUILD_FILE, { force: true });
}

async function installCardText(app) {
  return app.text('[data-install-card]');
}

async function setDeferredPrompt(app, outcome) {
  await app.eval(`(() => {
    window.__pptPromptCalls = 0;
    window.__pptInstallPrompt = {
      prompt() { window.__pptPromptCalls += 1; },
      userChoice: Promise.resolve({ outcome: ${JSON.stringify(outcome)} }),
    };
    window.dispatchEvent(new CustomEvent('ppt:installavailable'));
  })()`);
}

async function photoInputDetails(app) {
  return app.eval(`(() => [...document.querySelectorAll('input[type=file]')].map((input) => ({
    accept: input.getAttribute('accept'),
    capture: input.hasAttribute('capture'),
  })))()`);
}

function assertPhotoInputs(details, label) {
  assert.ok(details.length > 0, `${label} should expose at least one photo input`);
  assert.ok(details.some((input) => input.accept === PHOTO_ACCEPT), `${label} should use the photo capture hint`);
  for (const input of details.filter((item) => item.accept?.startsWith('image/'))) {
    assert.equal(input.accept, PHOTO_ACCEPT, `${label} image input accept`);
    assert.equal(input.capture, false, `${label} must not use standalone capture`);
  }
}

test('settings explains when the browser has not offered install yet', async () => {
  await withApp(async (app) => {
    await app.goto('/settings');
    await app.eval(`(() => {
      window.__pptInstallPrompt = null;
      window.dispatchEvent(new CustomEvent('ppt:installed'));
    })()`);

    const text = await installCardText(app);
    assert.match(text, /not offered an install prompt yet/i);
    // Android users can always install from the browser menu, so say so.
    assert.match(text, /Add to Home screen/i);
    assert.equal(await app.exists('[data-install-card] button'), false);
    app.assertNoErrors();
  });
});

test('settings shows an install button when a deferred prompt is available and accepted', async () => {
  await withApp(async (app) => {
    await app.goto('/settings');
    await setDeferredPrompt(app, 'accepted');
    await app.waitFor(`!![...document.querySelectorAll('[data-install-card] button')]
      .find((button) => button.textContent.includes('Install app'))`, { label: 'install button' });

    await app.click('Install app', '[data-install-card] button');

    assert.equal(await app.eval('window.__pptPromptCalls'), 1);
    assert.match(await app.toastText(), /Installing/);
    assert.equal(await app.exists('[data-install-card] button'), false);
    app.assertNoErrors();
  });
});

test('settings reports when the install prompt is dismissed', async () => {
  await withApp(async (app) => {
    await app.goto('/settings');
    await setDeferredPrompt(app, 'dismissed');
    await app.waitFor(`document.querySelector('[data-install-card] button')?.textContent.includes('Install app')`, {
      label: 'install button',
    });

    await app.click('Install app', '[data-install-card] button');

    assert.match(await app.toastText(), /Install dismissed/);
    assert.equal(await app.eval('window.__pptInstallPrompt'), null);
    app.assertNoErrors();
  });
});

test('settings install card updates live when the app becomes installed', async () => {
  await withApp(async (app) => {
    await app.goto('/settings');
    await app.eval(`(() => {
      const original = window.matchMedia.bind(window);
      window.matchMedia = (query) => query === '(display-mode: standalone)'
        ? { matches: true, media: query, addEventListener() {}, removeEventListener() {} }
        : original(query);
      window.__pptInstallPrompt = null;
      window.dispatchEvent(new CustomEvent('ppt:installed'));
    })()`);
    await app.waitFor(`document.querySelector('[data-install-card]')?.innerText.includes('Installed')`, {
      label: 'installed card',
    });

    assert.equal(await app.eval(`(async () => (await import('${app.origin}/js/install.js')).isInstalled())()`), true);
    assert.match(await installCardText(app), /running as an app/i);
    app.assertNoErrors();
  });
});

test('settings gives iOS Add to Home Screen guidance instead of a dead install button', async () => {
  await withApp(async (app) => {
    await app.eval(`(() => {
      Object.defineProperty(Navigator.prototype, 'userAgent', {
        configurable: true,
        get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      });
      Object.defineProperty(Navigator.prototype, 'platform', { configurable: true, get: () => 'iPhone' });
      Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { configurable: true, get: () => 5 });
    })()`);
    await app.goto('/settings');
    await app.eval(`(() => {
      window.__pptInstallPrompt = null;
      window.dispatchEvent(new CustomEvent('ppt:installed'));
    })()`);

    assert.match(await installCardText(app), /Share button.*Add to Home Screen/i);
    assert.equal(await app.exists('[data-install-card] button'), false);
    app.assertNoErrors();
  });
});

test('about card says development build when deploy identity files are absent', async () => {
  removeBuildFiles();
  await withApp(async (app) => {
    await app.goto('/settings');

    assert.match(await app.text(), /Development build/i);
    assert.match(await app.text(), /running from source/i);
    app.assertNoErrors();
  });
});

test('getBuildInfo reports development for missing files and HTML error pages', async () => {
  removeBuildFiles();
  await withApp(async (app) => {
    const missing = await app.eval(`(async () => {
      const { getBuildInfo } = await import('${app.origin}/js/install.js');
      return getBuildInfo();
    })()`);
    assert.equal(missing.development, true);

    const htmlError = await app.eval(`(async () => {
      const { getBuildInfo } = await import('${app.origin}/js/install.js');
      const originalFetch = window.fetch;
      window.fetch = async () => new Response('<!doctype html><title>Not found</title>', { status: 200 });
      try { return await getBuildInfo(); }
      finally { window.fetch = originalFetch; }
    })()`);
    assert.deepEqual(htmlError, { development: true, commit: null, built: null, short: null });
    app.assertNoErrors();
  });
});

test('about card links deployed builds to the exact GitHub commit', async () => {
  writeFileSync(COMMIT_FILE, `${FULL_HASH}\n`);
  writeFileSync(BUILD_FILE, `${BUILD_DATE}\n`);
  try {
    await withApp(async (app) => {
      await app.goto('/settings');
      await app.waitFor(`document.querySelector('#view')?.innerText.includes('1234567')`, { label: 'deployed about card' });

      const about = await app.eval(`(() => {
        const link = [...document.querySelectorAll('#view a')].find((a) => a.textContent.trim() === '1234567');
        return { text: document.getElementById('view').innerText, href: link?.href || null };
      })()`);
      const { REPO_URL } = await import('../../js/install.js');
      assert.match(about.text, /1234567/);
      assert.match(about.text, new RegExp(BUILD_DATE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.equal(about.href, `${REPO_URL}/commit/${FULL_HASH}`);
      app.assertNoErrors();
    });
  } finally {
    removeBuildFiles();
  }
});

test('service worker fetches build identity network-first instead of serving a stale commit hash', async () => {
  writeFileSync(COMMIT_FILE, 'first-commit\n');
  try {
    await withApp(async (app) => {
      await app.waitFor(`(async () => !!(await navigator.serviceWorker.getRegistration())?.active)()`, {
        timeout: 15000,
        label: 'service worker activation',
      });
      await app.reload();
      assert.equal(await app.eval("fetch('./commit_hash.txt').then((r) => r.text()).then((t) => t.trim())"), 'first-commit');

      writeFileSync(COMMIT_FILE, 'second-commit\n');
      await app.waitFor(`fetch('./commit_hash.txt').then((r) => r.text()).then((t) => t.trim() === 'second-commit')`, {
        label: 'fresh commit hash',
      });
      assert.equal(await app.eval("fetch('./commit_hash.txt').then((r) => r.text()).then((t) => t.trim())"), 'second-commit');
      app.assertNoErrors();
    });
  } finally {
    removeBuildFiles();
  }
});

test('photo inputs keep capture inside accept on diner visit and menu surfaces', async () => {
  await withApp(async (app) => {
    await app.goto('/people');
    await app.click('Add diner');
    await app.waitFor('!document.getElementById("modal-host").hidden', { label: 'diner modal' });
    assertPhotoInputs(await photoInputDetails(app), 'diner modal');

    await app.goto('/visits/new');
    assertPhotoInputs(await photoInputDetails(app), 'visit form');

    await app.goto('/settings');
    assertPhotoInputs(await photoInputDetails(app), 'menu editor');
    app.assertNoErrors();
  });
});
