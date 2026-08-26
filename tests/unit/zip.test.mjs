/**
 * Unit tests for the dependency-free zip writer and the photo export naming
 * and ordering helpers it is used with.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createZip, crc32, uniqueName } from '../../js/zip.js';
import { photoFileName, sortPhotosByUpload } from '../../js/transfer.js';

/** Minimal reader for stored (uncompressed) entries. */
async function readZip(blob) {
  const buf = Buffer.from(await blob.arrayBuffer());
  const entries = [];
  let i = 0;
  while (i + 4 <= buf.length && buf.readUInt32LE(i) === 0x04034b50) {
    const method = buf.readUInt16LE(i + 8);
    const crc = buf.readUInt32LE(i + 14);
    const size = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    const name = buf.slice(i + 30, i + 30 + nameLen).toString('utf8');
    const start = i + 30 + nameLen + extraLen;
    entries.push({ name, method, crc, data: buf.slice(start, start + size) });
    i = start + size;
  }
  return { entries, buf };
}

test('crc32 matches the known checksum for a reference string', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('createZip writes stored entries that round-trip byte for byte', async () => {
  const blob = await createZip([
    { name: 'a.txt', data: 'hello' },
    { name: 'b.bin', data: new Uint8Array([1, 2, 3, 250]) },
  ]);
  const { entries, buf } = await readZip(blob);
  assert.equal(blob.type, 'application/zip');
  assert.deepEqual(entries.map((e) => e.name), ['a.txt', 'b.bin']);
  assert.equal(entries[0].method, 0);
  assert.equal(entries[0].data.toString('utf8'), 'hello');
  assert.deepEqual([...entries[1].data], [1, 2, 3, 250]);
  assert.equal(entries[0].crc, crc32(new TextEncoder().encode('hello')));
  // End-of-central-directory signature closes a valid archive.
  assert.equal(buf.readUInt32LE(buf.length - 22), 0x06054b50);
  assert.equal(buf.readUInt16LE(buf.length - 22 + 10), 2);
});

test('createZip produces a readable empty archive when there are no entries', async () => {
  const blob = await createZip([]);
  const buf = Buffer.from(await blob.arrayBuffer());
  assert.equal(buf.length, 22);
  assert.equal(buf.readUInt32LE(0), 0x06054b50);
});

test('uniqueName de-duplicates repeats and strips path separators', () => {
  const taken = new Set();
  assert.equal(uniqueName('shot.jpg', taken), 'shot.jpg');
  assert.equal(uniqueName('shot.jpg', taken), 'shot-2.jpg');
  assert.equal(uniqueName('shot.jpg', taken), 'shot-3.jpg');
  assert.equal(uniqueName('../../etc/passwd', taken), 'etc-passwd');
});

test('sortPhotosByUpload orders by creation time then sequence', () => {
  const rows = [
    { id: 'c', createdAt: '2026-09-02T10:00:00.000Z', seq: 0 },
    { id: 'b', createdAt: '2026-09-01T10:00:00.000Z', seq: 1 },
    { id: 'a', createdAt: '2026-09-01T10:00:00.000Z', seq: 0 },
  ];
  assert.deepEqual(sortPhotosByUpload(rows).map((r) => r.id), ['a', 'b', 'c']);
  // The input array is not mutated.
  assert.equal(rows[0].id, 'c');
});

test('photoFileName prefixes upload position and keeps the original extension', () => {
  assert.equal(
    photoFileName({ id: 'abcdefgh-1234', ownerType: 'visit', filename: 'IMG_0042.HEIC' }, 0),
    '001-visit-abcdefgh.heic',
  );
  assert.equal(
    photoFileName({ id: 'zzzzzzzz-1', ownerType: 'bowl', type: 'image/png' }, 11),
    '012-bowl-zzzzzzzz.png',
  );
  assert.equal(
    photoFileName({ id: 'qqqqqqqq-1', ownerType: 'person' }, 2),
    '003-person-qqqqqqqq.jpg',
  );
});
