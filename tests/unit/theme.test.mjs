/**
 * Unit tests for pure theme helpers.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveCustom, getPalettes } from '../../js/theme.js';

const HEX = /^#[a-f\d]{6}$/i;

test('deriveCustom returns every custom palette key as a hex colour', () => {
  const custom = deriveCustom('#b3261e', 'light');

  assert.deepEqual(Object.keys(custom).sort(), [
    'accent',
    'accent-contrast',
    'accent-soft',
    'accent-tint',
  ].sort());
  for (const value of Object.values(custom)) {
    assert.match(value, HEX);
  }
});

test('deriveCustom chooses dark contrast for a very light accent', () => {
  const custom = deriveCustom('#ffee88', 'light');

  assert.equal(custom['accent-contrast'], '#101010');
});

test('deriveCustom chooses light contrast for a very dark accent', () => {
  const custom = deriveCustom('#101010', 'dark');

  assert.equal(custom['accent-contrast'], '#ffffff');
});

test('deriveCustom produces different soft and tint colours for light and dark schemes', () => {
  const light = deriveCustom('#b3261e', 'light');
  const dark = deriveCustom('#b3261e', 'dark');

  assert.notEqual(light['accent-soft'], dark['accent-soft']);
  assert.notEqual(light['accent-tint'], dark['accent-tint']);
});

test('deriveCustom returns null for invalid input instead of throwing', () => {
  assert.equal(deriveCustom('nope', 'light'), null);
  assert.equal(deriveCustom('', 'light'), null);
  assert.equal(deriveCustom(null, 'light'), null);
});

test('deriveCustom accepts hex colours with a leading hash', () => {
  assert.equal(deriveCustom('#b3261e', 'light').accent, '#b3261e');
});

// Regression: the caller's raw string used to be passed straight through, so
// an unprefixed hex produced an invalid CSS custom property value.
test('deriveCustom normalizes hex colours without a leading hash to #rrggbb', () => {
  const custom = deriveCustom('b3261e', 'light');

  assert.equal(custom.accent, '#b3261e');
  for (const value of Object.values(custom)) {
    assert.match(value, HEX);
  }
});

test('getPalettes includes marinara and custom palettes', () => {
  const ids = getPalettes().map((palette) => palette.id);

  assert.equal(ids.includes('marinara'), true);
  assert.equal(ids.includes('custom'), true);
});

test('getPalettes returns entries with ids and labels', () => {
  for (const palette of getPalettes()) {
    assert.equal(typeof palette.id, 'string');
    assert.equal(palette.id.length > 0, true);
    assert.equal(typeof palette.label, 'string');
    assert.equal(palette.label.length > 0, true);
  }
});
