/**
 * Unit tests for photo capture quality resolution.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { resolvePhotoEncoding } from '../../js/photos.js';
import {
  DEFAULT_PHOTO_QUALITY, DEFAULT_SETTINGS, PHOTO_QUALITY_LEVELS, SETTING_KEYS,
} from '../../js/schema.js';

test('every quality level declares a usable JPEG edge and encoder quality', () => {
  for (const [id, level] of Object.entries(PHOTO_QUALITY_LEVELS)) {
    assert.equal(level.id, id);
    assert.equal(typeof level.label, 'string');
    assert.ok(level.label.length > 0);
    assert.ok(Number.isInteger(level.maxEdge) && level.maxEdge > 0, `${id} maxEdge`);
    assert.ok(level.quality > 0 && level.quality <= 1, `${id} quality`);
  }
});

test('quality levels increase in both resolution and encoder quality', () => {
  const ordered = ['balanced', 'high', 'max'].map((id) => PHOTO_QUALITY_LEVELS[id]);

  for (let i = 1; i < ordered.length; i++) {
    assert.ok(ordered[i].maxEdge > ordered[i - 1].maxEdge,
      `${ordered[i].id} should store a longer edge than ${ordered[i - 1].id}`);
    assert.ok(ordered[i].quality >= ordered[i - 1].quality,
      `${ordered[i].id} should not encode below ${ordered[i - 1].id}`);
  }
});

test('the default level keeps more detail than the original 1400px behaviour', () => {
  const fallback = resolvePhotoEncoding(DEFAULT_PHOTO_QUALITY);

  assert.equal(DEFAULT_SETTINGS[SETTING_KEYS.photoQuality], DEFAULT_PHOTO_QUALITY);
  assert.ok(fallback.maxEdge > PHOTO_QUALITY_LEVELS.balanced.maxEdge);
  assert.equal(PHOTO_QUALITY_LEVELS.balanced.maxEdge, 1400,
    'the balanced level must stay byte-compatible with previously captured photos');
});

test('resolvePhotoEncoding returns the requested level', () => {
  for (const id of Object.keys(PHOTO_QUALITY_LEVELS)) {
    assert.equal(resolvePhotoEncoding(id), PHOTO_QUALITY_LEVELS[id]);
  }
});

// Regression: an existing profile has no photoQuality row, and a backup taken
// from a newer build could name a level this version does not know. Neither
// may break photo capture.
test('unknown, missing, and malformed levels fall back to the default', () => {
  const expected = PHOTO_QUALITY_LEVELS[DEFAULT_PHOTO_QUALITY];

  for (const value of [undefined, null, '', 'ultra', 0, false, {}, []]) {
    assert.equal(resolvePhotoEncoding(value), expected);
  }
});

test('quality levels are frozen so a caller cannot corrupt later captures', () => {
  const level = resolvePhotoEncoding('balanced');

  assert.throws(() => { 'use strict'; level.maxEdge = 99; }, TypeError);
  assert.equal(PHOTO_QUALITY_LEVELS.balanced.maxEdge, 1400);
});
