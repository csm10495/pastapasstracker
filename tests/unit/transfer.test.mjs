/**
 * Unit tests for backup validation.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { BACKUP_VERSION, STORE_NAMES } from '../../js/schema.js';
import { inspectBackup } from '../../js/transfer.js';

function backup(overrides = {}) {
  return {
    app: 'pasta-pass-tracker',
    backupVersion: BACKUP_VERSION,
    exportedAt: '2026-08-24T12:00:00.000Z',
    includesPhotos: true,
    data: Object.fromEntries(STORE_NAMES.map((store) => [store, []])),
    ...overrides,
  };
}

test('inspectBackup summarizes a well-formed backup with counts for every store', () => {
  const parsed = backup({
    data: {
      people: [{ id: 'p1' }, { id: 'p2' }],
      locations: [{ id: 'l1' }],
      visits: [{ id: 'v1' }],
      bowls: [{ id: 'b1' }, { id: 'b2' }, { id: 'b3' }],
      menuItems: [{ id: 'm1' }],
      photos: [{ id: 'ph1' }],
      settings: [{ key: 'mealPrice', value: 14.99 }],
    },
  });

  assert.deepEqual(inspectBackup(parsed), {
    exportedAt: '2026-08-24T12:00:00.000Z',
    includesPhotos: true,
    counts: {
      people: 2,
      locations: 1,
      visits: 1,
      bowls: 3,
      menuItems: 1,
      photos: 1,
      settings: 1,
    },
  });
});

test('inspectBackup treats omitted optional metadata as safe defaults', () => {
  const parsed = backup({ exportedAt: undefined, includesPhotos: undefined });

  assert.deepEqual(inspectBackup(parsed), {
    exportedAt: null,
    includesPhotos: false,
    counts: Object.fromEntries(STORE_NAMES.map((store) => [store, 0])),
  });
});

test('inspectBackup rejects null backups with a human-friendly message', () => {
  assert.throws(() => inspectBackup(null), /not valid JSON/i);
});

test('inspectBackup rejects non-object backups with a human-friendly message', () => {
  assert.throws(() => inspectBackup('not json'), /not valid JSON/i);
});

test('inspectBackup rejects backups from another app with a human-friendly message', () => {
  assert.throws(
    () => inspectBackup(backup({ app: 'other-app' })),
    /not exported by Pasta Pass Tracker/i,
  );
});

test('inspectBackup rejects backups without a version stamp', () => {
  assert.throws(
    () => inspectBackup(backup({ backupVersion: undefined })),
    /missing a version stamp/i,
  );
});

test('inspectBackup rejects backups newer than the app understands', () => {
  assert.throws(
    () => inspectBackup(backup({ backupVersion: BACKUP_VERSION + 1 })),
    /newer than this app understands/i,
  );
});

test('inspectBackup rejects backups without data', () => {
  assert.throws(
    () => inspectBackup(backup({ data: undefined })),
    /contains no data/i,
  );
});

test('inspectBackup rejects a malformed store value', () => {
  assert.throws(
    () => inspectBackup(backup({ data: { ...backup().data, people: {} } })),
    /store "people" is malformed/i,
  );
});
