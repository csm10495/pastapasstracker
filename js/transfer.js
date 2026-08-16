/**
 * Full JSON backup and restore.
 *
 * Data lives only in this browser, so export/import is the only safety net
 * against cleared site data. Photos are base64-encoded and included by
 * default so a backup is genuinely complete; a data-only mode keeps the file
 * small when photos are not wanted.
 */

import { STORE_NAMES, BACKUP_VERSION } from './schema.js';
import { getAll, putMany, clearAll, getDb } from './db.js';
import { invalidateMenuCache } from './menu.js';

const PHOTO_BLOB_FIELDS = ['blob', 'thumbBlob'];

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function dataUrlToBlob(dataUrl) {
  const res = await fetch(dataUrl);
  return res.blob();
}

/**
 * Builds a backup object.
 * @param {boolean} includePhotos embed photo binaries as data URLs
 */
export async function buildBackup({ includePhotos = true } = {}) {
  const data = {};
  for (const store of STORE_NAMES) {
    data[store] = await getAll(store);
  }

  if (includePhotos) {
    const encoded = [];
    for (const photo of data.photos) {
      const row = { ...photo };
      for (const f of PHOTO_BLOB_FIELDS) {
        if (row[f] instanceof Blob) row[f] = await blobToDataUrl(row[f]);
        else delete row[f];
      }
      encoded.push(row);
    }
    data.photos = encoded;
  } else {
    data.photos = [];
  }

  return {
    app: 'pasta-pass-tracker',
    backupVersion: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    includesPhotos: includePhotos,
    counts: Object.fromEntries(STORE_NAMES.map((s) => [s, data[s].length])),
    data,
  };
}

/** Triggers a file download of the backup. */
export async function downloadBackup({ includePhotos = true } = {}) {
  const backup = await buildBackup({ includePhotos });
  const json = JSON.stringify(backup, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 10);
  const suffix = includePhotos ? '' : '-data-only';
  const a = document.createElement('a');
  a.href = url;
  a.download = `pasta-pass-backup-${stamp}${suffix}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return backup;
}

/** Validates a parsed backup and summarises what it contains. */
export function inspectBackup(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('That file is not valid JSON.');
  }
  if (parsed.app !== 'pasta-pass-tracker') {
    throw new Error('That file was not exported by Pasta Pass Tracker.');
  }
  if (typeof parsed.backupVersion !== 'number') {
    throw new Error('Backup is missing a version stamp.');
  }
  if (parsed.backupVersion > BACKUP_VERSION) {
    throw new Error(
      `Backup version ${parsed.backupVersion} is newer than this app understands `
      + `(${BACKUP_VERSION}). Update the app first.`,
    );
  }
  if (!parsed.data || typeof parsed.data !== 'object') {
    throw new Error('Backup contains no data.');
  }

  const counts = {};
  for (const store of STORE_NAMES) {
    const rows = parsed.data[store];
    if (rows != null && !Array.isArray(rows)) {
      throw new Error(`Backup store "${store}" is malformed.`);
    }
    counts[store] = rows ? rows.length : 0;
  }

  return {
    exportedAt: parsed.exportedAt || null,
    includesPhotos: !!parsed.includesPhotos,
    counts,
  };
}

export async function readBackupFile(file) {
  const text = await file.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  inspectBackup(parsed);
  return parsed;
}

/**
 * Restores a backup.
 * @param mode 'replace' wipes everything first; 'merge' keeps existing rows
 *             and overwrites only those whose id matches.
 */
export async function restoreBackup(parsed, { mode = 'replace' } = {}) {
  inspectBackup(parsed);

  if (mode === 'replace') {
    await clearAll();
  }

  const summary = {};
  for (const store of STORE_NAMES) {
    const rows = parsed.data[store];
    if (!Array.isArray(rows) || !rows.length) { summary[store] = 0; continue; }

    let prepared = rows;
    if (store === 'photos') {
      prepared = [];
      for (const row of rows) {
        const rec = { ...row };
        let usable = true;
        for (const f of PHOTO_BLOB_FIELDS) {
          if (typeof rec[f] === 'string' && rec[f].startsWith('data:')) {
            rec[f] = await dataUrlToBlob(rec[f]);
          } else if (!(rec[f] instanceof Blob)) {
            delete rec[f];
          }
        }
        // A photo with no image data is useless; skip it rather than storing
        // a broken record that would render as a blank tile.
        if (!(rec.blob instanceof Blob) && !(rec.thumbBlob instanceof Blob)) usable = false;
        if (usable) prepared.push(rec);
      }
    }

    await putMany(store, prepared);
    summary[store] = prepared.length;
  }

  invalidateMenuCache();
  return summary;
}

/** Wipes every store. */
export async function wipeEverything() {
  await clearAll();
  invalidateMenuCache();
  // Touch the connection so the next read reopens cleanly.
  await getDb();
}
