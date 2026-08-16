/**
 * IndexedDB access layer. Thin promise wrapper plus typed CRUD helpers.
 *
 * Everything the app persists goes through here, so views never touch
 * IndexedDB directly.
 */

import {
  DB_NAME, DB_VERSION, STORES, STORE_NAMES,
  SEED_MENU, DEFAULT_SETTINGS, SETTING_KEYS,
} from './schema.js';

let dbPromise = null;

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      for (const [name, def] of Object.entries(STORES)) {
        let store;
        if (!db.objectStoreNames.contains(name)) {
          store = db.createObjectStore(name, { keyPath: def.keyPath });
        } else {
          store = req.transaction.objectStore(name);
        }
        for (const idx of def.indexes) {
          if (!store.indexNames.contains(idx.name)) {
            store.createIndex(idx.name, idx.keyPath, idx.options || {});
          }
        }
      }

      // v2 introduced the open/ended visit lifecycle. Everything logged before
      // it existed is history, so stamp those visits as ended; leaving the
      // field undefined would make every past visit look like it is still
      // in progress.
      if (event.oldVersion < 2) {
        const visits = req.transaction.objectStore('visits');
        visits.openCursor().onsuccess = (cursorEvent) => {
          const cursor = cursorEvent.target.result;
          if (!cursor) return;
          const visit = cursor.value;
          if (visit.endedAt === undefined) {
            cursor.update({
              ...visit,
              endedAt: visit.updatedAt || visit.createdAt || new Date().toISOString(),
            });
          }
          cursor.continue();
        };
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Database upgrade blocked by another open tab.'));
  });
}

export function getDb() {
  if (!dbPromise) dbPromise = openDb();
  return dbPromise;
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });
}

function reqDone(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/* ----------------------------------------------------------- primitives -- */

export async function getAll(store, query = null) {
  const db = await getDb();
  const tx = db.transaction(store, 'readonly');
  return reqDone(tx.objectStore(store).getAll(query));
}

export async function getById(store, id) {
  if (id == null) return undefined;
  const db = await getDb();
  const tx = db.transaction(store, 'readonly');
  return reqDone(tx.objectStore(store).get(id));
}

export async function getByIndex(store, indexName, query) {
  const db = await getDb();
  const tx = db.transaction(store, 'readonly');
  return reqDone(tx.objectStore(store).index(indexName).getAll(query));
}

export async function put(store, record) {
  const db = await getDb();
  const tx = db.transaction(store, 'readwrite');
  const result = reqDone(tx.objectStore(store).put(record));
  await txDone(tx);
  return result;
}

export async function putMany(store, records) {
  if (!records.length) return;
  const db = await getDb();
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  for (const r of records) os.put(r);
  await txDone(tx);
}

export async function remove(store, id) {
  const db = await getDb();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(id);
  await txDone(tx);
}

export async function clearStore(store) {
  const db = await getDb();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).clear();
  await txDone(tx);
}

export async function clearAll() {
  const db = await getDb();
  const tx = db.transaction(STORE_NAMES, 'readwrite');
  for (const name of STORE_NAMES) tx.objectStore(name).clear();
  await txDone(tx);
}

/** Creates a record with a generated id and createdAt, or updates in place. */
export async function save(store, record) {
  const rec = { ...record };
  if (!rec.id) rec.id = uid();
  if (!rec.createdAt) rec.createdAt = new Date().toISOString();
  rec.updatedAt = new Date().toISOString();
  await put(store, rec);
  return rec;
}

/* ------------------------------------------------------------- settings -- */

export async function getSetting(key, fallback = undefined) {
  const row = await getById('settings', key);
  if (row === undefined) {
    return fallback !== undefined ? fallback : DEFAULT_SETTINGS[key];
  }
  return row.value;
}

export async function setSetting(key, value) {
  await put('settings', { key, value });
  return value;
}

/** Returns every setting merged over the defaults. */
export async function getSettings() {
  const rows = await getAll('settings');
  const out = { ...DEFAULT_SETTINGS };
  for (const row of rows) out[row.key] = row.value;
  return out;
}

/* --------------------------------------------------------------- photos -- */

export async function getPhotosFor(ownerType, ownerId) {
  if (!ownerId) return [];
  const rows = await getByIndex('photos', 'owner', IDBKeyRange.only([ownerType, ownerId]));
  return rows.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
}

/** Deletes every photo attached to an owner. Used by cascade deletes. */
export async function deletePhotosFor(ownerType, ownerId) {
  const rows = await getPhotosFor(ownerType, ownerId);
  if (!rows.length) return;
  const db = await getDb();
  const tx = db.transaction('photos', 'readwrite');
  for (const r of rows) tx.objectStore('photos').delete(r.id);
  await txDone(tx);
}

/* ------------------------------------------------------ cascade deletes -- */

/** Deletes a visit together with its bowls and all their photos. */
export async function deleteVisitDeep(visitId) {
  const bowls = await getByIndex('bowls', 'visitId', visitId);
  for (const b of bowls) await deletePhotosFor('bowl', b.id);
  await deletePhotosFor('visit', visitId);
  const db = await getDb();
  const tx = db.transaction(['bowls', 'visits'], 'readwrite');
  for (const b of bowls) tx.objectStore('bowls').delete(b.id);
  tx.objectStore('visits').delete(visitId);
  await txDone(tx);
}

/** Deletes a bowl and its photo. */
export async function deleteBowlDeep(bowlId) {
  await deletePhotosFor('bowl', bowlId);
  await remove('bowls', bowlId);
}

/**
 * Deletes a person. Their bowls are removed too, since a bowl without an
 * eater has no meaning in the cost model.
 */
export async function deletePersonDeep(personId) {
  const bowls = await getByIndex('bowls', 'personId', personId);
  for (const b of bowls) await deletePhotosFor('bowl', b.id);
  await deletePhotosFor('person', personId);
  const db = await getDb();
  const tx = db.transaction(['bowls', 'people'], 'readwrite');
  for (const b of bowls) tx.objectStore('bowls').delete(b.id);
  tx.objectStore('people').delete(personId);
  await txDone(tx);
}

/**
 * Deletes a location. Visits keep their history and simply lose the link,
 * because location is optional on a visit.
 */
export async function deleteLocationDetach(locationId) {
  const visits = await getByIndex('visits', 'locationId', locationId);
  const db = await getDb();
  const tx = db.transaction(['visits', 'locations'], 'readwrite');
  for (const v of visits) {
    tx.objectStore('visits').put({ ...v, locationId: null });
  }
  tx.objectStore('locations').delete(locationId);
  await txDone(tx);
}

/* ------------------------------------------------- visit lifecycle ------ */

/** True when a visit is still in progress at the table. */
export function isVisitOpen(visit) {
  return !!visit && !visit.endedAt;
}

/**
 * The visit currently in progress, or null. You can only be at one table, so
 * if several are somehow open the most recent one wins.
 */
export async function getOpenVisit() {
  const visits = await getAll('visits');
  const open = visits.filter(isVisitOpen);
  if (!open.length) return null;
  return open.sort((a, b) => String(b.createdAt || b.date).localeCompare(String(a.createdAt || a.date)))[0];
}

/** Ends every open visit except `exceptId`. Keeps "one table at a time" true. */
export async function endOtherOpenVisits(exceptId = null) {
  const visits = await getAll('visits');
  const stale = visits.filter((v) => isVisitOpen(v) && v.id !== exceptId);
  if (!stale.length) return 0;
  const endedAt = new Date().toISOString();
  await putMany('visits', stale.map((v) => ({ ...v, endedAt })));
  return stale.length;
}

/** Marks a visit finished. */
export async function endVisit(id) {
  const visit = await getById('visits', id);
  if (!visit || visit.endedAt) return visit || null;
  const updated = { ...visit, endedAt: new Date().toISOString() };
  await put('visits', updated);
  return updated;
}

/** Reopens a finished visit, ending any other that was open. */
export async function reopenVisit(id) {
  const visit = await getById('visits', id);
  if (!visit) return null;
  await endOtherOpenVisits(id);
  const updated = { ...visit, endedAt: null };
  await put('visits', updated);
  return updated;
}

/**
 * Starts a visit that is open at the table, ending any previous one.
 * Prices are resolved from the location, then the global fallback, and are
 * frozen onto the record exactly as the visit form does.
 */
export async function startVisit({ date, locationId = null, notes = '' } = {}) {
  await endOtherOpenVisits();
  const settings = await getSettings();
  const location = locationId ? await getById('locations', locationId) : null;
  return save('visits', {
    date,
    locationId: locationId || null,
    notes,
    mealPrice: location?.defaultMealPrice ?? settings.mealPrice,
    toppingPrice: location?.defaultToppingPrice ?? settings.toppingPrice,
    endedAt: null,
  });
}

/* ----------------------------------------------------------------- seed -- */

/** Seeds the 2026 menu on first run. Safe to call repeatedly. */
export async function ensureSeeded() {
  const seeded = await getById('settings', SETTING_KEYS.seeded);
  if (seeded?.value) return false;

  const existing = await getAll('menuItems');
  if (existing.length === 0) {
    const now = new Date().toISOString();
    const items = SEED_MENU.map((item, i) => ({
      id: uid(),
      kind: item.kind,
      name: item.name,
      isNew: !!item.isNew,
      sortOrder: i,
      deletedAt: null,
      createdAt: now,
    }));
    await putMany('menuItems', items);
  }
  await setSetting(SETTING_KEYS.seeded, true);
  return true;
}

/** Rough byte estimate for the Settings screen. */
export async function estimateUsage() {
  if (!navigator.storage?.estimate) return null;
  try {
    return await navigator.storage.estimate();
  } catch {
    return null;
  }
}
