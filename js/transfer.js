/**
 * Full JSON backup and restore.
 *
 * Data lives only in this browser, so export/import is the only safety net
 * against cleared site data. Photos are base64-encoded and included by
 * default so a backup is genuinely complete; a data-only mode keeps the file
 * small when photos are not wanted.
 */

import { STORE_NAMES, BACKUP_VERSION } from './schema.js';
import {
  clearAll, getAll, getDb, getPhotosByOwnerTypes, putMany,
} from './db.js';
import { invalidateMenuCache } from './menu.js';

const PHOTO_BLOB_FIELDS = ['blob', 'thumbBlob'];
const ZIP_UTF8_FLAG = 0x0800;
const ZIP_VERSION = 20;
const ZIP_MAX_ENTRIES = 0xffff;
const ZIP_MAX_SIZE = 0xffffffff;
const textEncoder = new TextEncoder();

const IMAGE_EXTENSIONS = {
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'image/tiff': 'tiff',
  'image/webp': 'webp',
  'image/x-icon': 'ico',
};

let crcTable = null;

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
  const stamp = new Date().toISOString().slice(0, 10);
  const suffix = includePhotos ? '' : '-data-only';
  downloadBlob(blob, `pasta-pass-backup-${stamp}${suffix}.json`);
  return backup;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* -------------------------------------------------------- photo archive -- */

/**
 * Creates a Windows-safe timestamp filename for an exported photo.
 * Duplicate timestamps keep the timestamp and receive a numeric suffix.
 */
export function photoArchiveFilename(createdAt, mimeType, usedNames = new Set()) {
  const date = new Date(createdAt);
  if (!Number.isFinite(date.getTime())) {
    throw new Error('Photo is missing a valid creation timestamp.');
  }

  const type = String(mimeType || '').split(';', 1)[0].trim().toLowerCase();
  const extension = IMAGE_EXTENSIONS[type];
  if (!extension) {
    throw new Error(`Unsupported photo type "${type || 'unknown'}".`);
  }

  const timestamp = date.toISOString().replace(/:/g, '-');
  let name = `${timestamp}.${extension}`;
  let suffix = 2;
  while (usedNames.has(name)) {
    name = `${timestamp}-${suffix}.${extension}`;
    suffix += 1;
  }
  usedNames.add(name);
  return name;
}

/**
 * Builds a standard ZIP archive using the store method. Images are already
 * compressed, so deflating them again would add complexity without useful
 * size savings.
 */
export async function buildZipArchive(entries) {
  if (!Array.isArray(entries)) throw new TypeError('ZIP entries must be an array.');
  if (entries.length > ZIP_MAX_ENTRIES) {
    throw new Error(`A ZIP archive cannot contain more than ${ZIP_MAX_ENTRIES} photos.`);
  }

  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  let centralSize = 0;

  for (const entry of entries) {
    if (!(entry?.blob instanceof Blob)) {
      throw new Error(`ZIP entry "${entry?.name || 'unnamed'}" has no file data.`);
    }

    const nameBytes = textEncoder.encode(String(entry.name || ''));
    if (!nameBytes.length) throw new Error('ZIP entries must have a filename.');
    if (nameBytes.length > 0xffff) throw new Error(`ZIP filename is too long: ${entry.name}`);

    const size = entry.blob.size;
    if (size > ZIP_MAX_SIZE) {
      throw new Error(`Photo is too large for a standard ZIP archive: ${entry.name}`);
    }

    const checksum = await crc32Blob(entry.blob);
    const { dosDate, dosTime } = zipDateTime(entry.modifiedAt);

    const localHeader = new Uint8Array(30);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, ZIP_VERSION, true);
    localView.setUint16(6, ZIP_UTF8_FLAG, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, dosTime, true);
    localView.setUint16(12, dosDate, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, size, true);
    localView.setUint32(22, size, true);
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, 0, true);

    const centralHeader = new Uint8Array(46);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, ZIP_VERSION, true);
    centralView.setUint16(6, ZIP_VERSION, true);
    centralView.setUint16(8, ZIP_UTF8_FLAG, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, dosTime, true);
    centralView.setUint16(14, dosDate, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, size, true);
    centralView.setUint32(24, size, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, localOffset, true);

    localParts.push(localHeader, nameBytes, entry.blob);
    centralParts.push(centralHeader, nameBytes);
    localOffset += localHeader.byteLength + nameBytes.byteLength + size;
    centralSize += centralHeader.byteLength + nameBytes.byteLength;

    if (localOffset > ZIP_MAX_SIZE || centralSize > ZIP_MAX_SIZE) {
      throw new Error('Photo archive is too large for a standard ZIP file.');
    }
  }

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, localOffset, true);
  endView.setUint16(20, 0, true);

  return new Blob([...localParts, ...centralParts, end], { type: 'application/zip' });
}

/** Builds a ZIP containing every visit-gallery and bowl photo. */
export async function buildVisitPhotoArchive() {
  const [visits, bowls, photos] = await Promise.all([
    getAll('visits'),
    getAll('bowls'),
    getPhotosByOwnerTypes(['visit', 'bowl']),
  ]);

  const visitIds = new Set(visits.map((visit) => visit.id));
  const visitByBowl = new Map(
    bowls
      .filter((bowl) => visitIds.has(bowl.visitId))
      .map((bowl) => [bowl.id, bowl.visitId]),
  );

  const selected = [];
  for (const photo of photos) {
    let visitId = null;
    if (photo.ownerType === 'visit' && visitIds.has(photo.ownerId)) {
      visitId = photo.ownerId;
    } else if (photo.ownerType === 'bowl') {
      visitId = visitByBowl.get(photo.ownerId) || null;
    }
    if (!visitId) continue;

    const blob = photo.blob instanceof Blob
      ? photo.blob
      : photo.thumbBlob instanceof Blob ? photo.thumbBlob : null;
    if (!blob) {
      throw new Error(`Photo "${photo.id || 'unknown'}" has no image data.`);
    }
    selected.push({ photo, blob, visitId });
  }

  selected.sort((a, b) => (
    String(a.photo.createdAt || '').localeCompare(String(b.photo.createdAt || ''))
    || String(a.photo.id || '').localeCompare(String(b.photo.id || ''))
  ));

  const usedNames = new Set();
  const entries = selected.map(({ photo, blob }) => {
    let name;
    try {
      name = photoArchiveFilename(photo.createdAt, blob.type, usedNames);
    } catch (err) {
      throw new Error(`Photo "${photo.id || 'unknown'}" cannot be exported: ${err.message}`);
    }
    return { name, blob, modifiedAt: photo.createdAt };
  });
  const blob = await buildZipArchive(entries);

  return {
    blob,
    count: entries.length,
    files: entries.map((entry, index) => ({
      name: entry.name,
      size: entry.blob.size,
      type: entry.blob.type,
      ownerType: selected[index].photo.ownerType,
      ownerId: selected[index].photo.ownerId,
      visitId: selected[index].visitId,
    })),
  };
}

/** Downloads every visit-gallery and bowl photo as one ZIP archive. */
export async function downloadVisitPhotoArchive() {
  const archive = await buildVisitPhotoArchive();
  if (!archive.count) return archive;

  const stamp = new Date().toISOString().slice(0, 10);
  downloadBlob(archive.blob, `pasta-pass-visit-photos-${stamp}.zip`);
  return archive;
}

function getCrcTable() {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < crcTable.length; n++) {
      let value = n;
      for (let k = 0; k < 8; k++) {
        value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
      }
      crcTable[n] = value >>> 0;
    }
  }
  return crcTable;
}

function updateCrc32(value, bytes) {
  const table = getCrcTable();
  for (const byte of bytes) {
    value = (value >>> 8) ^ table[(value ^ byte) & 0xff];
  }
  return value;
}

async function crc32Blob(blob) {
  let value = 0xffffffff;
  if (typeof blob.stream === 'function') {
    const reader = blob.stream().getReader();
    try {
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        value = updateCrc32(value, chunk);
      }
    } finally {
      reader.releaseLock();
    }
  } else {
    value = updateCrc32(value, new Uint8Array(await blob.arrayBuffer()));
  }
  return (value ^ 0xffffffff) >>> 0;
}

function zipDateTime(value) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.getUTCFullYear() < 1980) {
    return { dosDate: (1 << 5) | 1, dosTime: 0 };
  }

  const year = Math.min(parsed.getUTCFullYear(), 2107);
  return {
    dosDate: ((year - 1980) << 9) | ((parsed.getUTCMonth() + 1) << 5) | parsed.getUTCDate(),
    dosTime: (parsed.getUTCHours() << 11)
      | (parsed.getUTCMinutes() << 5)
      | Math.floor(parsed.getUTCSeconds() / 2),
  };
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
