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

function largeFixturePng(name = 'ppt-large-fixture.png', size = 640) {
  const width = size;
  const height = size;
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

test('photo quality controls stored resolution and never re-encodes existing photos', async () => {
  await withApp(async (app) => {
    await app.seed({
      ...FIXTURE,
      visits: [{
        date: '2026-09-11',
        location: 'OG Brookfield',
        bowls: [{ person: 'Alice', pasta: 'Fettuccine', sauce: 'Alfredo' }],
      }],
    });
    const [visit] = await app.store('visits');
    // Larger than the balanced edge but below the higher ones, so each level
    // produces a distinguishable stored size.
    const png = largeFixturePng('ppt-quality-source.png', 2000);

    const readPhotos = () => app.run(`
      const rows = (await db.getAll('photos')).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
      const out = [];
      for (const photo of rows) {
        const full = await createImageBitmap(photo.blob);
        const thumb = await createImageBitmap(photo.thumbBlob);
        out.push({
          quality: photo.quality ?? null,
          storedWidth: photo.storedWidth ?? null,
          sourceWidth: photo.width,
          fullEdge: Math.max(full.width, full.height),
          thumbEdge: Math.max(thumb.width, thumb.height),
          size: photo.blob.size,
          type: photo.blob.type,
        });
      }
      return out;`);

    const upload = async (level, expectedCount) => {
      await app.run(`await db.setSetting('photoQuality', ${JSON.stringify(level)});`);
      await app.goto(`/visits/${visit.id}/edit`);
      await app.upload('input[type=file]', png.path, 0);
      await app.waitFor(
        `(await (await import('${app.origin}/js/db.js')).getAll('photos')).length === ${expectedCount}`,
        { label: `photo stored at ${level}` },
      );
    };

    try {
      await upload('balanced', 1);
      const [balanced] = await readPhotos();
      assert.equal(balanced.quality, 'balanced');
      assert.equal(balanced.fullEdge, 1400, 'balanced must keep the original 1400px behaviour');
      assert.equal(balanced.storedWidth, 1400);
      assert.equal(balanced.sourceWidth, 2000, 'the source dimensions stay recorded');
      assert.equal(balanced.thumbEdge, 320);
      assert.equal(balanced.type, 'image/jpeg');

      await upload('max', 2);
      const [existing, captured] = await readPhotos();

      // The whole point: raising the setting must not touch what is already saved.
      assert.deepEqual(existing, balanced, 'an existing photo must not be re-encoded');

      assert.equal(captured.quality, 'max');
      assert.equal(captured.fullEdge, 2000, 'a higher level must not downscale a 2000px source');
      assert.equal(captured.storedWidth, 2000);
      assert.equal(captured.type, 'image/jpeg');
      assert.ok(captured.size > balanced.size,
        `expected a larger file at max (${captured.size}) than balanced (${balanced.size})`);

      // Lists decode thumbnails, so they must stay small at every level.
      assert.equal(captured.thumbEdge, 320);
      app.assertNoErrors();
    } finally {
      png.cleanup();
    }
  });
});

test('updating the app and database preserves existing records and exact photo bytes', async () => {
  await withApp(async (app) => {
    await app.waitFor(
      `(async () => !!(await navigator.serviceWorker.getRegistration())?.active)()`,
      { timeout: 15000, label: 'service worker activation before upgrade' },
    );

    await app.run(`
      const schema = await import('${app.origin}/js/schema.js');
      const current = await db.getDb();
      current.close();

      await new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(schema.DB_NAME);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('Legacy database reset was blocked'));
      });

      const legacy = await new Promise((resolve, reject) => {
        const request = indexedDB.open(schema.DB_NAME, 1);
        request.onupgradeneeded = () => {
          const legacyDb = request.result;
          for (const [name, definition] of Object.entries(schema.STORES)) {
            const store = legacyDb.createObjectStore(name, { keyPath: definition.keyPath });
            for (const index of definition.indexes) {
              store.createIndex(index.name, index.keyPath, index.options || {});
            }
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

      const pngBase64 =
        'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAP0lEQVR42u3OMQEAAAgDoC1p'
        + 'b3vAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAvA0K2AABtLuA'
        + 'CQAAAABJRU5ErkJggg==';
      const pngBytes = Uint8Array.from(atob(pngBase64), (char) => char.charCodeAt(0));
      const jpegBytes = Uint8Array.from([255, 216, 255, 224, 1, 2, 3, 255, 217]);
      const thumbBytes = Uint8Array.from([255, 216, 255, 225, 9, 8, 7, 255, 217]);
      const createdAt = '2026-08-20T18:30:00.000Z';
      const stores = Object.keys(schema.STORES);
      const tx = legacy.transaction(stores, 'readwrite');

      tx.objectStore('people').put({
        id: 'legacy-person',
        name: 'Legacy Diner',
        color: '#123456',
        hasPass: true,
        passCost: 87.65,
        passPurchasedOn: '2026-07-15',
        active: true,
        createdAt,
        updatedAt: createdAt,
      });
      tx.objectStore('locations').put({
        id: 'legacy-location',
        name: 'Legacy Olive Garden',
        city: 'Orlando',
        state: 'FL',
        notes: 'Keep this note',
        defaultMealPrice: null,
        defaultToppingPrice: 3.21,
        createdAt,
        updatedAt: createdAt,
      });
      tx.objectStore('visits').put({
        id: 'legacy-visit',
        date: '2026-08-20',
        locationId: 'legacy-location',
        notes: 'Existing visit',
        mealPrice: 12.34,
        toppingPrice: 3.21,
        createdAt,
        updatedAt: createdAt,
      });
      tx.objectStore('bowls').put({
        id: 'legacy-bowl',
        visitId: 'legacy-visit',
        personId: 'legacy-person',
        pastaId: 'legacy-pasta',
        sauceId: 'legacy-sauce',
        toppingId: null,
        rating: 5,
        notes: 'Existing bowl',
        seq: 0,
        createdAt,
        updatedAt: createdAt,
      });
      tx.objectStore('menuItems').put({
        id: 'legacy-pasta',
        kind: 'pasta',
        name: 'Legacy Pasta',
        isNew: false,
        sortOrder: 0,
        deletedAt: null,
        createdAt,
        updatedAt: createdAt,
      });
      tx.objectStore('menuItems').put({
        id: 'legacy-sauce',
        kind: 'sauce',
        name: 'Legacy Sauce',
        isNew: false,
        sortOrder: 1,
        deletedAt: null,
        createdAt,
        updatedAt: createdAt,
      });
      tx.objectStore('photos').put({
        id: 'legacy-visit-photo',
        ownerType: 'visit',
        ownerId: 'legacy-visit',
        blob: new Blob([pngBytes], { type: 'image/png' }),
        thumbBlob: new Blob([pngBytes], { type: 'image/png' }),
        width: 64,
        height: 64,
        caption: 'Existing visit photo',
        seq: 0,
        createdAt,
        updatedAt: createdAt,
      });
      tx.objectStore('photos').put({
        id: 'legacy-bowl-photo',
        ownerType: 'bowl',
        ownerId: 'legacy-bowl',
        blob: new Blob([jpegBytes], { type: 'image/jpeg' }),
        thumbBlob: new Blob([thumbBytes], { type: 'image/jpeg' }),
        width: 1,
        height: 1,
        caption: 'Existing bowl photo',
        seq: 0,
        createdAt,
        updatedAt: createdAt,
      });
      tx.objectStore('settings').put({ key: 'seeded', value: true });
      tx.objectStore('settings').put({ key: 'mealPrice', value: 18.76 });

      await new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('Legacy seed transaction aborted'));
      });
      legacy.close();

      const oldCache = await caches.open('ppt-v3');
      await oldCache.put('./legacy-shell-marker', new Response('old app shell'));
      return {
        png: Array.from(pngBytes),
        jpeg: Array.from(jpegBytes),
        thumb: Array.from(thumbBytes),
      };
    `).then((bytes) => { app.legacyPhotoBytes = bytes; });

    await app.eval(`(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      await registration?.unregister();
    })()`);
    await app.reload();

    await app.waitFor(
      `(async () => !!(await navigator.serviceWorker.getRegistration())?.active)()`,
      { timeout: 15000, label: 'service worker activation after upgrade' },
    );
    await app.waitFor(
      `(async () => !(await caches.keys()).includes('ppt-v3'))()`,
      { timeout: 15000, label: 'old app cache removal' },
    );

    const preserved = await app.run(`
      const connection = await db.getDb();
      const [people, locations, visits, bowls, menuItems, photos, settings] = await Promise.all([
        db.getAll('people'),
        db.getAll('locations'),
        db.getAll('visits'),
        db.getAll('bowls'),
        db.getAll('menuItems'),
        db.getAll('photos'),
        db.getAll('settings'),
      ]);
      const photoBytes = {};
      for (const photo of photos) {
        photoBytes[photo.id] = {
          blob: Array.from(new Uint8Array(await photo.blob.arrayBuffer())),
          thumb: Array.from(new Uint8Array(await photo.thumbBlob.arrayBuffer())),
          blobType: photo.blob.type,
          thumbType: photo.thumbBlob.type,
        };
      }
      return {
        version: connection.version,
        people,
        locations,
        visits,
        bowls,
        menuItems,
        photos: photos.map(({ blob, thumbBlob, ...photo }) => photo),
        settings,
        photoBytes,
      };
    `);

    assert.equal(preserved.version, 2);
    assert.deepEqual(preserved.people.map((person) => person.id), ['legacy-person']);
    assert.equal(preserved.people[0].passCost, 87.65);
    assert.deepEqual(preserved.locations.map((location) => location.id), ['legacy-location']);
    assert.equal(preserved.locations[0].defaultMealPrice, null);
    assert.deepEqual(preserved.visits.map((visit) => visit.id), ['legacy-visit']);
    assert.equal(preserved.visits[0].mealPrice, 12.34);
    assert.equal(preserved.visits[0].endedAt, '2026-08-20T18:30:00.000Z');
    assert.deepEqual(preserved.bowls.map((bowl) => bowl.id), ['legacy-bowl']);
    assert.equal(preserved.bowls[0].toppingId, null);
    assert.deepEqual(
      preserved.menuItems.map((item) => item.name).sort(),
      ['Legacy Pasta', 'Legacy Sauce'],
    );
    assert.deepEqual(
      Object.fromEntries(preserved.settings.map((setting) => [setting.key, setting.value])),
      { mealPrice: 18.76, seeded: true },
    );
    assert.deepEqual(
      preserved.photos.map((photo) => photo.id).sort(),
      ['legacy-bowl-photo', 'legacy-visit-photo'],
    );
    assert.deepEqual(
      preserved.photoBytes['legacy-visit-photo'].blob,
      app.legacyPhotoBytes.png,
    );
    assert.deepEqual(
      preserved.photoBytes['legacy-visit-photo'].thumb,
      app.legacyPhotoBytes.png,
    );
    assert.equal(preserved.photoBytes['legacy-visit-photo'].blobType, 'image/png');
    assert.deepEqual(
      preserved.photoBytes['legacy-bowl-photo'].blob,
      app.legacyPhotoBytes.jpeg,
    );
    assert.deepEqual(
      preserved.photoBytes['legacy-bowl-photo'].thumb,
      app.legacyPhotoBytes.thumb,
    );
    assert.equal(preserved.photoBytes['legacy-bowl-photo'].blobType, 'image/jpeg');
    assert.equal(preserved.photoBytes['legacy-bowl-photo'].thumbType, 'image/jpeg');
    app.assertNoErrors();
  });
});
