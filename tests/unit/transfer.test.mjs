/**
 * Unit tests for backup validation.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { BACKUP_VERSION, STORE_NAMES } from '../../js/schema.js';
import {
  buildZipArchive, inspectBackup, photoArchiveFilename,
} from '../../js/transfer.js';

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

function readStoredZip(blob) {
  return blob.arrayBuffer().then((arrayBuffer) => {
    const bytes = Buffer.from(arrayBuffer);
    const endOffset = bytes.length - 22;
    assert.equal(bytes.readUInt32LE(endOffset), 0x06054b50);

    const count = bytes.readUInt16LE(endOffset + 10);
    const centralSize = bytes.readUInt32LE(endOffset + 12);
    const centralOffset = bytes.readUInt32LE(endOffset + 16);
    let offset = centralOffset;
    const entries = [];

    for (let index = 0; index < count; index++) {
      assert.equal(bytes.readUInt32LE(offset), 0x02014b50);
      assert.equal(bytes.readUInt16LE(offset + 10), 0, 'photos should use ZIP store mode');
      const crc = bytes.readUInt32LE(offset + 16);
      const size = bytes.readUInt32LE(offset + 24);
      const nameLength = bytes.readUInt16LE(offset + 28);
      const extraLength = bytes.readUInt16LE(offset + 30);
      const commentLength = bytes.readUInt16LE(offset + 32);
      const localOffset = bytes.readUInt32LE(offset + 42);
      const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString();

      assert.equal(bytes.readUInt32LE(localOffset), 0x04034b50);
      const localNameLength = bytes.readUInt16LE(localOffset + 26);
      const localExtraLength = bytes.readUInt16LE(localOffset + 28);
      const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
      entries.push({
        name,
        crc,
        data: bytes.subarray(dataOffset, dataOffset + size),
      });

      offset += 46 + nameLength + extraLength + commentLength;
    }

    assert.equal(offset, centralOffset + centralSize);
    return entries;
  });
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

test('photo archive filenames use Windows-safe timestamps, image extensions, and collision suffixes', () => {
  const used = new Set();

  assert.equal(
    photoArchiveFilename('2026-08-28T19:10:26.288Z', 'image/jpeg', used),
    '2026-08-28T19-10-26.288Z.jpg',
  );
  assert.equal(
    photoArchiveFilename('2026-08-28T19:10:26.288Z', 'image/jpeg', used),
    '2026-08-28T19-10-26.288Z-2.jpg',
  );
  assert.equal(
    photoArchiveFilename('2026-08-28T19:10:26.288Z', 'image/png', used),
    '2026-08-28T19-10-26.288Z.png',
  );
  assert.throws(
    () => photoArchiveFilename('not-a-date', 'image/jpeg', used),
    /valid creation timestamp/i,
  );
  assert.throws(
    () => photoArchiveFilename('2026-08-28T19:10:26.288Z', 'application/octet-stream', used),
    /unsupported photo type/i,
  );
});

test('photo ZIP builder preserves every stored entry with valid CRC and central offsets', async () => {
  const archive = await buildZipArchive([
    {
      name: '2026-08-28T19-10-26.288Z.jpg',
      blob: new Blob(['123456789'], { type: 'image/jpeg' }),
      modifiedAt: '2026-08-28T19:10:26.288Z',
    },
    {
      name: '2026-08-28T19-11-00.000Z.png',
      blob: new Blob([Uint8Array.from([1, 2, 3, 4])], { type: 'image/png' }),
      modifiedAt: '2026-08-28T19:11:00.000Z',
    },
  ]);
  const entries = await readStoredZip(archive);

  assert.equal(archive.type, 'application/zip');
  assert.deepEqual(entries.map((entry) => entry.name), [
    '2026-08-28T19-10-26.288Z.jpg',
    '2026-08-28T19-11-00.000Z.png',
  ]);
  assert.equal(entries[0].crc, 0xcbf43926, 'CRC32 for 123456789');
  assert.equal(entries[0].data.toString(), '123456789');
  assert.deepEqual([...entries[1].data], [1, 2, 3, 4]);
});
