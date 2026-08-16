/**
 * Unit tests for install helpers that do not require a browser DOM.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  REPO_URL, canInstall, isInstalled, onInstallChange, promptInstall,
} from '../../js/install.js';

test('REPO_URL is a well-formed GitHub URL', () => {
  const url = new URL(REPO_URL);

  assert.equal(url.protocol, 'https:');
  assert.equal(url.hostname, 'github.com');
  assert.match(url.pathname, /^\/[\w.-]+\/[\w.-]+$/);
});

test('canInstall reports whether a deferred prompt is parked on window', () => {
  const previous = globalThis.window;
  try {
    globalThis.window = { __pptInstallPrompt: null };
    assert.equal(canInstall(), false);

    globalThis.window.__pptInstallPrompt = { prompt() {} };
    assert.equal(canInstall(), true);
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
});

test('promptInstall consumes a deferred prompt and returns the user outcome', async () => {
  const previous = globalThis.window;
  let prompted = false;
  try {
    globalThis.window = {
      __pptInstallPrompt: {
        prompt() { prompted = true; },
        userChoice: Promise.resolve({ outcome: 'accepted' }),
      },
    };

    assert.equal(await promptInstall(), 'accepted');
    assert.equal(prompted, true);
    assert.equal(globalThis.window.__pptInstallPrompt, null);

    assert.equal(await promptInstall(), 'unavailable');
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
});

test('isInstalled uses standalone display mode when a window is available', () => {
  const previous = globalThis.window;
  try {
    globalThis.window = {
      matchMedia: (query) => ({ matches: query === '(display-mode: standalone)' }),
      navigator: { standalone: false },
    };

    assert.equal(isInstalled(), true);
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
});

test('onInstallChange listens for install availability and installed events', () => {
  const previous = globalThis.window;
  const target = new EventTarget();
  let calls = 0;
  try {
    globalThis.window = target;
    const dispose = onInstallChange(() => { calls += 1; });

    target.dispatchEvent(new Event('ppt:installavailable'));
    target.dispatchEvent(new Event('ppt:installed'));
    assert.equal(calls, 2);

    dispose();
    target.dispatchEvent(new Event('ppt:installed'));
    assert.equal(calls, 2);
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
});

// iOS detection depends on browser-specific navigator details, so the user-facing
// guidance branch is covered by the functional settings tests instead.
