/**
 * Manifest identity.
 *
 * The `id` member is resolved against the *origin* of `start_url`, not against
 * the manifest URL. A relative `"id": "./"` therefore collapses to the domain
 * root, which on a GitHub Pages account makes every project site claim the same
 * app identity — and Chrome stops offering an install prompt for the second app
 * it sees. Regression test for that: the computed id must be the app's own path.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { PROJECT_ROOT } from '../helpers/app.mjs';

const MANIFEST_URL = 'https://csm10495.github.io/pastapasstracker/manifest.webmanifest';
const APP_BASE = 'https://csm10495.github.io/pastapasstracker/';

async function readManifest() {
  return JSON.parse(await readFile(resolve(PROJECT_ROOT, 'manifest.webmanifest'), 'utf8'));
}

/** Mirrors the manifest spec: `id` is parsed with the start URL's origin as base. */
function computeAppId(manifest, manifestUrl) {
  const startUrl = new URL(manifest.start_url ?? './', manifestUrl);
  if (typeof manifest.id !== 'string') return startUrl.href;
  return new URL(manifest.id, new URL(startUrl).origin).href;
}

test('the computed app id is unique to the app, not the whole origin', async () => {
  const manifest = await readManifest();
  const id = computeAppId(manifest, MANIFEST_URL);

  assert.equal(id, APP_BASE);
  assert.notEqual(id, 'https://csm10495.github.io/',
    'an origin-root id collides with every other PWA on the same GitHub Pages account');
});

test('start_url and scope stay relative so subpath hosting works', async () => {
  const manifest = await readManifest();

  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.equal(new URL(manifest.start_url, MANIFEST_URL).href, APP_BASE);
});

test('the manifest keeps the members Chrome requires before it offers an install', async () => {
  const manifest = await readManifest();

  assert.ok(manifest.name?.length > 0);
  assert.ok(manifest.short_name?.length > 0);
  assert.ok(['standalone', 'fullscreen', 'minimal-ui'].includes(manifest.display));

  const sizes = manifest.icons.map((icon) => icon.sizes);
  assert.ok(sizes.includes('192x192'));
  assert.ok(sizes.includes('512x512'));
  assert.ok(manifest.icons.some((icon) => (icon.purpose || 'any').includes('maskable')));
  assert.ok(manifest.icons.every((icon) => icon.src.startsWith('./')),
    'icon paths must be relative for subpath hosting');
});
