import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

import { PROJECT_ROOT, withApp } from '../helpers/app.mjs';

const FIXTURE = {
  people: [
    { name: 'Alice', hasPass: true, passCost: 100 },
    { name: 'Bob', hasPass: false },
  ],
  locations: [{ name: 'OG', city: 'Orlando', state: 'FL' }],
  visits: [{
    date: '2026-08-24',
    location: 'OG',
    bowls: [
      { person: 'Alice', pasta: 'Fettuccine', sauce: 'Alfredo', topping: null },
      { person: 'Bob', pasta: 'Spaghetti', sauce: 'Meat Sauce', topping: 'Meatballs' },
    ],
  }],
  settings: { mealPrice: 16.5 },
};

async function counts(app) {
  return app.run(`const out = {};
    for (const s of ['people', 'locations', 'visits', 'bowls', 'menuItems', 'photos', 'settings']) {
      out[s] = (await db.getAll(s)).length;
    }
    return out;`);
}

async function addBlobPhoto(app) {
  return app.run(`const visit = (await db.getAll('visits'))[0];
    const blob = new Blob([Uint8Array.from([137, 80, 78, 71, 1, 2, 3, 4])], { type: 'image/png' });
    const thumbBlob = new Blob([Uint8Array.from([1, 2, 3])], { type: 'image/png' });
    await db.save('photos', { ownerType: 'visit', ownerId: visit.id, blob, thumbBlob, width: 1, height: 1, caption: 'backup photo', seq: 0 });
    return true;`);
}

async function addArchivePhotos(app) {
  return app.run(`const [visit] = await db.getAll('visits');
    const [bowl] = await db.getAll('bowls');
    const [person] = await db.getAll('people');
    const [menuItem] = await db.getAll('menuItems');
    const rows = [
      {
        id: 'archive-visit-photo',
        ownerType: 'visit',
        ownerId: visit.id,
        blob: new Blob([Uint8Array.from([1, 2, 3])], { type: 'image/png' }),
        createdAt: '2026-08-24T12:34:56.789Z',
      },
      {
        id: 'archive-bowl-photo',
        ownerType: 'bowl',
        ownerId: bowl.id,
        blob: new Blob([Uint8Array.from([4, 5, 6])], { type: 'image/jpeg' }),
        createdAt: '2026-08-24T13:00:00.000Z',
      },
      {
        id: 'archive-avatar-photo',
        ownerType: 'person',
        ownerId: person.id,
        blob: new Blob([Uint8Array.from([7])], { type: 'image/png' }),
        createdAt: '2026-08-24T14:00:00.000Z',
      },
      {
        id: 'archive-menu-photo',
        ownerType: 'menuItem',
        ownerId: menuItem.id,
        blob: new Blob([Uint8Array.from([8])], { type: 'image/png' }),
        createdAt: '2026-08-24T15:00:00.000Z',
      },
    ];
    for (const row of rows) {
      await db.put('photos', {
        ...row,
        thumbBlob: row.blob,
        width: 1,
        height: 1,
        caption: '',
        seq: 0,
        updatedAt: row.createdAt,
      });
    }
    return true;`);
}

function readStoredZip(byteValues) {
  const bytes = Buffer.from(byteValues);
  const endOffset = bytes.length - 22;
  assert.equal(bytes.readUInt32LE(endOffset), 0x06054b50);

  const count = bytes.readUInt16LE(endOffset + 10);
  let offset = bytes.readUInt32LE(endOffset + 16);
  const entries = [];
  for (let index = 0; index < count; index++) {
    assert.equal(bytes.readUInt32LE(offset), 0x02014b50);
    const size = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const localOffset = bytes.readUInt32LE(offset + 42);
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString();
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    entries.push({
      name,
      data: [...bytes.subarray(dataOffset, dataOffset + size)],
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

test('export counts match live stores and includesPhotos follows the selected mode', async () => {
  await withApp(async (app) => {
    await addBlobPhoto(app);
    const live = await counts(app);
    const full = await app.run('return transfer.buildBackup({ includePhotos: true });');
    const dataOnly = await app.run('return transfer.buildBackup({ includePhotos: false });');
    assert.deepEqual(full.counts, live);
    assert.equal(full.includesPhotos, true);
    assert.equal(dataOnly.includesPhotos, false);
    assert.equal(dataOnly.counts.photos, 0);
    assert.equal(dataOnly.data.photos.length, 0);
    app.assertNoErrors();
  }, { seed: FIXTURE });
});

test('full backup round-trips every store and decodes photo data URLs back to real Blobs', async () => {
  await withApp(async (app) => {
    await addBlobPhoto(app);
    const before = await counts(app);
    const backup = await app.run('return transfer.buildBackup({ includePhotos: true });');
    await app.run(`const backup = ${JSON.stringify(backup)};
      await transfer.wipeEverything();
      await transfer.restoreBackup(backup, { mode: 'replace' });`);
    assert.deepEqual(await counts(app), before);
    const photo = await app.run(`const p = (await db.getAll('photos'))[0];
      return { blob: p.blob instanceof Blob, thumbBlob: p.thumbBlob instanceof Blob, size: p.blob?.size || 0, thumbSize: p.thumbBlob?.size || 0 };`);
    assert.equal(photo.blob, true);
    assert.equal(photo.thumbBlob, true);
    assert.ok(photo.size > 0);
    assert.ok(photo.thumbSize > 0);
    app.assertNoErrors();
  }, { seed: FIXTURE });
});

test('replace restore removes rows not present in the backup', async () => {
  await withApp(async (app) => {
    const backup = await app.run('return transfer.buildBackup({ includePhotos: true });');
    await app.run("await db.save('people', { name: 'Extra', color: '#111111', hasPass: false, active: true });");
    assert.equal((await app.store('people')).length, 3);
    await app.run(`await transfer.restoreBackup(${JSON.stringify(backup)}, { mode: 'replace' });`);
    assert.deepEqual((await app.store('people')).map((p) => p.name).sort(), ['Alice', 'Bob']);
    app.assertNoErrors();
  }, { seed: FIXTURE });
});

test('merge restore overwrites matching ids and preserves rows absent from the backup', async () => {
  await withApp(async (app) => {
    const backup = await app.run('return transfer.buildBackup({ includePhotos: true });');
    const aliceId = backup.data.people.find((p) => p.name === 'Alice').id;
    await app.run(`await db.save('people', { id: ${JSON.stringify(aliceId)}, name: 'Changed Alice', color: '#222222', hasPass: false, active: true });
      await db.save('people', { id: 'merge-extra', name: 'Extra', color: '#333333', hasPass: false, active: true });`);
    await app.run(`await transfer.restoreBackup(${JSON.stringify(backup)}, { mode: 'merge' });`);
    const names = (await app.store('people')).map((p) => p.name).sort();
    assert.deepEqual(names, ['Alice', 'Bob', 'Extra']);
    app.assertNoErrors();
  }, { seed: FIXTURE });
});

test('invalid imports are rejected with friendly messages and no data loss', async () => {
  await withApp(async (app) => {
    const before = await counts(app);
    const errors = await app.run(`const cases = [
        async () => transfer.readBackupFile(new File(['{ nope'], 'bad.json', { type: 'application/json' })),
        async () => transfer.restoreBackup({ app: 'other-app', backupVersion: 1, data: {} }, { mode: 'replace' }),
        async () => transfer.restoreBackup({ app: 'pasta-pass-tracker', backupVersion: 999, data: {} }, { mode: 'replace' }),
      ];
      const out = [];
      for (const fn of cases) {
        try { await fn(); out.push('accepted'); } catch (err) { out.push(err.message); }
      }
      return out;`);
    assert.match(errors[0], /not valid JSON/i);
    assert.match(errors[1], /not exported by Pasta Pass Tracker/i);
    assert.match(errors[2], /newer than this app/i);
    assert.deepEqual(await counts(app), before);
    app.assertNoErrors();
  }, { seed: FIXTURE });
});

test('the settings import file input previews and restores a real JSON backup', async () => {
  const path = resolve(PROJECT_ROOT, 'tests', 'functional', 'backup-ui-import.json');
  try {
    await withApp(async (app) => {
      const backup = await app.run(`const b = await transfer.buildBackup({ includePhotos: false });
        b.data.people = [{ id: 'ui-person', name: 'Imported UI Person', color: '#9a2820', hasPass: false, active: true }];
        b.counts.people = 1;
        return b;`);
      writeFileSync(path, JSON.stringify(backup), 'utf8');

      await app.goto('/settings');
      await app.upload('#view input[accept="application/json"]', path);
      await app.waitFor('!document.getElementById("modal-host").hidden', { label: 'restore preview' });
      assert.match(await app.text('#modal-host'), /Restore backup/i);
      await app.click('Replace everything', '#modal-host button');
      // `document.readyState === 'complete'` is true immediately, so the old
      // condition let the assertion run before the restore had committed.
      await app.waitFor(`(async () => {
        const module = await import('${app.origin}/js/db.js');
        const people = await module.getAll('people');
        return people.length === 1 && people[0].name === 'Imported UI Person';
      })()`, { label: 'backup restored' });
      assert.deepEqual((await app.store('people')).map((p) => p.name), ['Imported UI Person']);
      app.assertNoErrors();
    }, { seed: FIXTURE });
  } finally {
    rmSync(path, { force: true });
  }
});

test('data-only backups restore all non-photo stores and no photo rows', async () => {
  await withApp(async (app) => {
    await addBlobPhoto(app);
    const backup = await app.run('return transfer.buildBackup({ includePhotos: false });');
    assert.equal(backup.data.photos.length, 0);
    const expected = { ...backup.counts };
    await app.run(`await transfer.wipeEverything();
      await transfer.restoreBackup(${JSON.stringify(backup)}, { mode: 'replace' });`);
    const after = await counts(app);
    for (const store of ['people', 'locations', 'visits', 'bowls', 'menuItems', 'settings']) {
      assert.equal(after[store], expected[store], store);
    }
    assert.equal(after.photos, 0);
    app.assertNoErrors();
  }, { seed: FIXTURE });
});

test('visit photo archive includes visit and bowl photos named by timestamp, excluding unrelated photos', async () => {
  await withApp(async (app) => {
    await addArchivePhotos(app);
    const archive = await app.run(`const result = await transfer.buildVisitPhotoArchive();
      const bytes = new Uint8Array(await result.blob.arrayBuffer());
      return {
        count: result.count,
        files: result.files,
        type: result.blob.type,
        bytes: Array.from(bytes),
      };`);
    const entries = readStoredZip(archive.bytes);

    assert.equal(archive.count, 2);
    assert.deepEqual(
      entries.map((entry) => entry.name),
      [
        '2026-08-24T12-34-56.789Z.png',
        '2026-08-24T13-00-00.000Z.jpg',
      ],
    );
    assert.deepEqual(entries.map((entry) => entry.data), [[1, 2, 3], [4, 5, 6]]);
    assert.deepEqual(archive.files.map((file) => file.name), entries.map((entry) => entry.name));
    assert.deepEqual(archive.files.map((file) => file.ownerType), ['visit', 'bowl']);
    assert.equal(archive.type, 'application/zip');
    app.assertNoErrors();
  }, { seed: FIXTURE });
});

test('settings downloads the visit photo ZIP and reports when there are no photos to export', async () => {
  await withApp(async (app) => {
    await addArchivePhotos(app);
    await app.goto('/settings');
    await app.eval(`(() => {
      window.__photoArchiveDownloads = [];
      URL.createObjectURL = (blob) => {
        window.__photoArchiveBlob = blob;
        return 'blob:pasta-pass-photo-archive';
      };
      HTMLAnchorElement.prototype.click = function () {
        window.__photoArchiveDownloads.push({ filename: this.download, href: this.href });
      };
    })()`);

    await app.click('Download all visit photos');
    await app.waitFor('window.__photoArchiveDownloads.length === 1', { label: 'photo archive download' });
    const download = await app.eval(`(async () => {
      const bytes = new Uint8Array(await window.__photoArchiveBlob.arrayBuffer());
      return {
        ...window.__photoArchiveDownloads[0],
        type: window.__photoArchiveBlob.type,
        signature: Array.from(bytes.slice(0, 4)),
      };
    })()`);
    assert.match(download.filename, /^pasta-pass-visit-photos-\d{4}-\d{2}-\d{2}\.zip$/);
    assert.equal(download.href, 'blob:pasta-pass-photo-archive');
    assert.equal(download.type, 'application/zip');
    assert.deepEqual(download.signature, [0x50, 0x4b, 0x03, 0x04]);
    assert.match(await app.toastText(), /2 photos downloaded/);

    await app.run("await db.clearStore('photos');");
    await app.click('Download all visit photos');
    await app.waitFor(
      "document.getElementById('toast-host').textContent.includes('No visit or bowl photos')",
      { label: 'empty photo archive message' },
    );
    assert.equal(await app.eval('window.__photoArchiveDownloads.length'), 1);
    app.assertNoErrors();
  }, { seed: FIXTURE });
});
