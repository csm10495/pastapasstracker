/**
 * Menu item access.
 *
 * Items are soft-deleted (`deletedAt`) rather than removed, so a bowl logged
 * against a sauce that later leaves the menu still renders correctly. This
 * matters because the official 2026 lineup was not published before launch
 * and is expected to be corrected by hand.
 */

import { getAll, save, put, getById, deletePhotosFor } from './db.js';

export const KINDS = ['pasta', 'sauce', 'topping'];

export const KIND_LABEL = {
  pasta: 'Pasta',
  sauce: 'Sauce',
  topping: 'Topping',
};

let cache = null;

export function invalidateMenuCache() {
  cache = null;
}

async function all() {
  if (!cache) cache = await getAll('menuItems');
  return cache;
}

/** Active (non-deleted) items of a kind, in sort order. */
export async function listMenu(kind) {
  const items = await all();
  return items
    .filter((i) => i.kind === kind && !i.deletedAt)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name));
}

/** Every item of a kind including soft-deleted ones, for the menu editor. */
export async function listMenuAll(kind) {
  const items = await all();
  return items
    .filter((i) => i.kind === kind)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name));
}

/** A lookup of every item by id, including deleted ones. */
export async function menuMap() {
  const items = await all();
  const map = new Map();
  for (const i of items) map.set(i.id, i);
  return map;
}

export async function getMenuItem(id) {
  if (!id) return null;
  return (await menuMap()).get(id) || null;
}

/** Name for an id, with a graceful fallback for missing records. */
export async function menuName(id, fallback = '—') {
  const item = await getMenuItem(id);
  return item ? item.name : fallback;
}

export async function saveMenuItem(item) {
  const items = await all();
  const rec = { ...item };
  if (rec.sortOrder == null) {
    const siblings = items.filter((i) => i.kind === rec.kind);
    rec.sortOrder = siblings.length
      ? Math.max(...siblings.map((i) => i.sortOrder ?? 0)) + 1
      : 0;
  }
  if (rec.deletedAt === undefined) rec.deletedAt = null;
  const saved = await save('menuItems', rec);
  invalidateMenuCache();
  return saved;
}

/** Soft-deletes, preserving history. */
export async function retireMenuItem(id) {
  const item = await getById('menuItems', id);
  if (!item) return;
  await put('menuItems', { ...item, deletedAt: new Date().toISOString() });
  invalidateMenuCache();
}

export async function restoreMenuItem(id) {
  const item = await getById('menuItems', id);
  if (!item) return;
  await put('menuItems', { ...item, deletedAt: null });
  invalidateMenuCache();
}

/** Hard-deletes an item and its photo. Only offered for unused items. */
export async function destroyMenuItem(id) {
  await deletePhotosFor('menuItem', id);
  const { remove } = await import('./db.js');
  await remove('menuItems', id);
  invalidateMenuCache();
}

/**
 * Total possible combinations: pastas x sauces x (toppings + "none").
 * With the seeded 2026 lineup this is 4 x 6 x 5 = 120, matching Olive
 * Garden's advertised figure.
 */
export async function comboCount() {
  const [pastas, sauces, toppings] = await Promise.all([
    listMenu('pasta'), listMenu('sauce'), listMenu('topping'),
  ]);
  return pastas.length * sauces.length * (toppings.length + 1);
}

/** A stable key identifying one pasta/sauce/topping combination. */
export function comboKey(pastaId, sauceId, toppingId) {
  return `${pastaId || ''}|${sauceId || ''}|${toppingId || ''}`;
}
