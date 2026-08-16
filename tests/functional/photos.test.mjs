/**
 * Functional tests for visit and bowl photo attachment flows.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

import { fixturePng, PROJECT_ROOT, withApp } from '../helpers/app.mjs';

const FIXTURE = {
  people: [
    { name: 'Alice', hasPass: true, passCost: 100, passPurchasedOn: '2026-07-16' },
    { name: 'Bob', hasPass: false },
  ],
  locations: [
    { name: 'OG Brookfield', city: 'Brookfield', state: 'WI', defaultMealPrice: 15.99, defaultToppingPrice: 4.99 },
  ],
};

async function addBowl(app, index = 0) {
  await app.click('Add bowl');
  const base = 1 + index * 5;
  await app.setSelectByText('select', index ? 'Bob' : 'Alice', base);
  await app.setSelectByText('select', index ? 'Rigatoni' : 'Fettuccine', base + 1);
  await app.setSelectByText('select', index ? 'Alfredo' : 'Spicy Alfredo', base + 2);
  await app.setSelectByText('select', 'No topping', base + 3);
}

async function saveVisit(app, date = '2026-09-07') {
  await app.setInput('input[type=date]', date);
  await app.click('Save');
  await app.waitFor(
    `location.hash.startsWith('#/visits/') && !location.hash.endsWith('/new') && !location.hash.endsWith('/edit')`,
    { label: 'visit detail after save' },
  );
}

async function uploadFixture(app, selector, index, name) {
  const png = fixturePng(name);
  try {
    await app.upload(selector, png.path, index);
    await app.waitFor(`(await (await import('${app.origin}/js/db.js')).getAll('photos')).length > 0`, {
      label: 'photo stored',
    });
  } finally {
    png.cleanup();
  }
}

function largeFixturePng(name = 'ppt-large-fixture.png') {
  const width = 640;
  const height = 640;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const i = row + 1 + x * 4;
      raw[i] = x % 256;
      raw[i + 1] = y % 256;
      raw[i + 2] = (x + y) % 256;
      raw[i + 3] = 255;
    }
  }
  const chunk = (type, data) => {
    const typeBuf = Buffer.from(type);
    const crcInput = Buffer.concat([typeBuf, data]);
    let crc = 0xffffffff;
    for (const byte of crcInput) {
      crc ^= byte;
      for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    typeBuf.copy(out, 4);
    data.copy(out, 8);
    out.writeUInt32BE(crc, 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const path = resolve(PROJECT_ROOT, 'tests', 'functional', name);
  writeFileSync(path, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]));
  return {
    path,
    cleanup: () => { try { rmSync(path, { force: true }); } catch { /* ignore */ } },
  };
}

test('visit gallery upload stores a visit photo with original and thumbnail blobs', async () => {
  await withApp(async (app) => {
    await app.goto('/visits/new');
    await uploadFixture(app, 'input[type=file]', 0, 'ppt-visit-gallery.png');
    await addBowl(app);
    await saveVisit(app);

    const [visit] = await app.store('visits');
    const [photo] = await app.store('photos');
    const hasBlobs = await app.run(`
      const [row] = await db.getAll('photos');
      return {
        blob: row.blob instanceof Blob && row.blob.size > 0,
        thumbBlob: row.thumbBlob instanceof Blob && row.thumbBlob.size > 0,
      };
    `);
    assert.equal(photo.ownerType, 'visit');
    assert.equal(photo.ownerId, visit.id);
    assert.equal(hasBlobs.blob, true);
    assert.equal(hasBlobs.thumbBlob, true);
    app.assertNoErrors();
  }, { seed: FIXTURE });
});

test('uploaded visit thumbnails are smaller than their original photos', async () => {
  await withApp(async (app) => {
    await app.goto('/visits/new');
    const png = largeFixturePng('ppt-thumb-size.png');
    try {
      await app.upload('input[type=file]', png.path, 0);
      await app.waitFor(`(await (await import('${app.origin}/js/db.js')).getAll('photos')).length > 0`, {
        label: 'photo stored',
      });
    } finally {
      png.cleanup();
    }
    const sizes = await app.run(`
      const [photo] = await db.getAll('photos');
      return { blob: photo.blob.size, thumb: photo.thumbBlob.size };
    `);
    assert.ok(sizes.thumb < sizes.blob, `expected thumbnail ${sizes.thumb} to be smaller than original ${sizes.blob}`);
    app.assertNoErrors();
  }, { seed: FIXTURE });
});

test('per-bowl photo upload stores a bowl-owned photo when the visit is saved', async () => {
  await withApp(async (app) => {
    await app.goto('/visits/new');
    await addBowl(app);
    await uploadFixture(app, 'input[type=file]', 1, 'ppt-bowl-photo.png');
    await saveVisit(app);

    const [bowl] = await app.store('bowls');
    const [photo] = await app.store('photos');
    assert.equal(photo.ownerType, 'bowl');
    assert.equal(photo.ownerId, bowl.id);
    app.assertNoErrors();
  }, { seed: FIXTURE });
});

test('abandoning a new visit cleans up photos attached before saving', async () => {
  await withApp(async (app) => {
    await app.goto('/visits/new');
    await uploadFixture(app, 'input[type=file]', 0, 'ppt-abandon-new.png');
    assert.equal((await app.store('photos')).length, 1);

    await app.goto('/stats');
    await app.waitFor(`(await (await import('${app.origin}/js/db.js')).getAll('photos')).length === 0`, {
      label: 'orphan photo cleanup',
    });
    assert.equal((await app.store('photos')).length, 0);
    app.assertNoErrors();
  }, { seed: FIXTURE });
});

test('editing an existing visit and navigating away preserves its saved photos', async () => {
  await withApp(async (app) => {
    await app.seed({
      ...FIXTURE,
      visits: [{ date: '2026-09-08', location: 'OG Brookfield', bowls: [{ person: 'Alice', pasta: 'Fettuccine', sauce: 'Alfredo' }] }],
    });
    const [visit] = await app.store('visits');
    await app.goto(`/visits/${visit.id}/edit`);
    await uploadFixture(app, 'input[type=file]', 0, 'ppt-edit-preserve.png');

    await app.goto('/stats');
    const [photo] = await app.store('photos');
    assert.equal(photo.ownerType, 'visit');
    assert.equal(photo.ownerId, visit.id);
    app.assertNoErrors();
  });
});

test('deleting a visit removes visit gallery photos and bowl photos', async () => {
  await withApp(async (app) => {
    await app.goto('/visits/new');
    await uploadFixture(app, 'input[type=file]', 0, 'ppt-delete-visit-gallery.png');
    await addBowl(app);
    await uploadFixture(app, 'input[type=file]', 1, 'ppt-delete-visit-bowl.png');
    await saveVisit(app);
    assert.equal((await app.store('photos')).length, 2);

    const [visit] = await app.store('visits');
    await app.goto(`/visits/${visit.id}`);
    await app.click('Delete visit');
    await app.clickSelector('#modal-host button.btn--danger');
    await app.waitFor(`(await (await import('${app.origin}/js/db.js')).getAll('photos')).length === 0`, {
      label: 'visit photo cascade',
    });
    assert.equal((await app.store('photos')).length, 0);
    app.assertNoErrors();
  }, { seed: FIXTURE });
});

test('deleting a person removes their bowls and those bowls photos', async () => {
  await withApp(async (app) => {
    await app.goto('/visits/new');
    await addBowl(app);
    await uploadFixture(app, 'input[type=file]', 1, 'ppt-delete-person-bowl.png');
    await saveVisit(app);

    const [person] = (await app.store('people')).filter((p) => p.name === 'Alice');
    await app.run(`await db.deletePersonDeep(${JSON.stringify(person.id)});`);
    assert.equal((await app.store('bowls')).some((b) => b.personId === person.id), false);
    assert.equal((await app.store('photos')).length, 0);
    app.assertNoErrors();
  }, { seed: FIXTURE });
});

test('multiple photos can attach to one visit and removing one leaves the others', async () => {
  await withApp(async (app) => {
    await app.seed({
      ...FIXTURE,
      visits: [{ date: '2026-09-09', location: 'OG Brookfield', bowls: [{ person: 'Alice', pasta: 'Fettuccine', sauce: 'Alfredo' }] }],
    });
    const [visit] = await app.store('visits');
    await app.goto(`/visits/${visit.id}/edit`);
    await uploadFixture(app, 'input[type=file]', 0, 'ppt-gallery-one.png');
    await uploadFixture(app, 'input[type=file]', 0, 'ppt-gallery-two.png');
    assert.equal((await app.store('photos')).length, 2);

    await app.clickSelector('.photo-slot__remove', 0);
    const photos = await app.store('photos');
    assert.equal(photos.length, 1);
    assert.equal(photos[0].ownerType, 'visit');
    assert.equal(photos[0].ownerId, visit.id);
    app.assertNoErrors();
  });
});
