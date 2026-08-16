/**
 * Generic photo attachment subsystem.
 *
 * Photos are stored once, keyed by (ownerType, ownerId), so a person avatar,
 * a menu-item reference shot, a bowl photo, and a visit gallery all share one
 * code path. Owners never hold a photo id; the photo points at its owner.
 *
 * Originals are downscaled on capture and a small thumbnail is stored
 * alongside, so lists never decode full-size images.
 */

import { getPhotosFor, deletePhotosFor, save, remove, getDb } from './db.js';
import { el, lightbox, toast } from './ui.js';

const MAX_EDGE = 1400;
const THUMB_EDGE = 320;
const QUALITY = 0.82;

/**
 * Media capture hint for file inputs.
 *
 * `capture` written inside `accept` is the legacy form and is what makes
 * mobile browsers offer a choice — "Take Photo" or "Photo Library". Setting
 * `capture` as a standalone attribute instead would jump straight to the
 * camera and remove the option to pick an existing photo, so don't.
 */
export const PHOTO_ACCEPT = 'image/*;capture=camera';

/** Tracks object URLs so they can be revoked when a view is torn down. */
const liveUrls = new Set();

export function objectUrl(blob) {
  const url = URL.createObjectURL(blob);
  liveUrls.add(url);
  return url;
}

export function revokeUrl(url) {
  if (!url) return;
  URL.revokeObjectURL(url);
  liveUrls.delete(url);
}

/** Revokes every outstanding URL. Called by the router between views. */
export function revokeAllUrls() {
  for (const url of liveUrls) URL.revokeObjectURL(url);
  liveUrls.clear();
}

/* --------------------------------------------------------------- resize -- */

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read image')); };
    img.src = url;
  });
}

function drawScaled(img, maxEdge) {
  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  return canvas;
}

function toBlob(canvas) {
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), 'image/jpeg', QUALITY);
  });
}

/**
 * Stores a file against an owner, downscaling and generating a thumbnail.
 * Returns the saved photo record.
 */
export async function addPhoto(file, ownerType, ownerId, { caption = '', seq = 0 } = {}) {
  if (!file || !ownerId) return null;
  const img = await loadImage(file);
  const [blob, thumbBlob] = await Promise.all([
    toBlob(drawScaled(img, MAX_EDGE)),
    toBlob(drawScaled(img, THUMB_EDGE)),
  ]);
  return save('photos', {
    ownerType,
    ownerId,
    blob,
    thumbBlob,
    width: img.width,
    height: img.height,
    caption,
    seq,
  });
}

export async function listPhotos(ownerType, ownerId) {
  return getPhotosFor(ownerType, ownerId);
}

export async function firstPhoto(ownerType, ownerId) {
  const rows = await getPhotosFor(ownerType, ownerId);
  return rows[0] || null;
}

export async function deletePhoto(id) {
  await remove('photos', id);
}

export async function deleteAllPhotos(ownerType, ownerId) {
  await deletePhotosFor(ownerType, ownerId);
}

/**
 * Moves photos captured against a temporary owner id onto the real one.
 * Used by forms that let you attach photos before the record is saved.
 */
export async function reassignPhotos(ownerType, fromId, toId) {
  if (!fromId || !toId || fromId === toId) return;
  const rows = await getPhotosFor(ownerType, fromId);
  if (!rows.length) return;
  const db = await getDb();
  const tx = db.transaction('photos', 'readwrite');
  for (const r of rows) tx.objectStore('photos').put({ ...r, ownerId: toId });
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

/* ------------------------------------------------------------ components - */

/** A clickable thumbnail that opens the full image. */
export function thumbEl(photo, { alt = 'Photo', className = 'thumb' } = {}) {
  const url = objectUrl(photo.thumbBlob || photo.blob);
  return el('img', {
    class: className,
    src: url,
    alt,
    loading: 'lazy',
    onClick: () => {
      const full = objectUrl(photo.blob);
      lightbox(full, photo.caption).then(() => revokeUrl(full));
    },
  });
}

/**
 * Photo picker.
 *
 * @param ownerType one of visit | bowl | person | menuItem
 * @param getOwnerId () => string, read lazily so forms can attach before save
 * @param opts.multiple  gallery (visits) vs single slot (avatar, bowl, menu)
 * @param opts.label     button text
 * @param opts.ensureOwnerId optional async () => string, called only when the
 *   user actually picks a file. Lets a form create its record on demand rather
 *   than needing a second "create then attach" button.
 */
export function photoPicker(ownerType, getOwnerId, opts = {}) {
  const { multiple = false, label = 'Add photo', onChange = null, ensureOwnerId = null } = opts;

  const grid = el('div', { class: 'photo-grid' });
  const input = el('input', {
    type: 'file',
    accept: PHOTO_ACCEPT,
    multiple: multiple ? 'multiple' : null,
    class: 'visually-hidden',
    onChange: async (e) => {
      const files = Array.from(e.target.files || []);
      e.target.value = '';
      if (!files.length) return;
      let ownerId;
      try {
        ownerId = ensureOwnerId ? await ensureOwnerId() : getOwnerId();
      } catch (err) {
        toast(err.message || 'Could not attach the photo', 'bad');
        return;
      }
      if (!ownerId) { toast('Save this first, then add photos.', 'bad'); return; }
      try {
        const existing = await listPhotos(ownerType, ownerId);
        let seq = existing.length;
        for (const file of files) {
          if (!multiple) await deleteAllPhotos(ownerType, ownerId);
          await addPhoto(file, ownerType, ownerId, { seq: multiple ? seq++ : 0 });
          if (!multiple) break;
        }
        await refresh();
        onChange?.();
      } catch (err) {
        toast(err.message || 'Could not add photo', 'bad');
      }
    },
  });

  const button = el('button', {
    type: 'button',
    class: 'btn btn--sm',
    onClick: () => input.click(),
  }, '📷 ', label);

  async function refresh() {
    const ownerId = getOwnerId();
    const photos = ownerId ? await listPhotos(ownerType, ownerId) : [];
    const nodes = photos.map((p) => el('div', { class: 'photo-slot' },
      thumbEl(p),
      el('button', {
        type: 'button',
        class: 'photo-slot__remove',
        title: 'Remove photo',
        'aria-label': 'Remove photo',
        onClick: async () => {
          await deletePhoto(p.id);
          await refresh();
          onChange?.();
        },
      }, '✕'),
    ));
    grid.replaceChildren(...nodes);
    button.textContent = photos.length && !multiple ? '📷 Replace photo' : `📷 ${label}`;
  }

  const wrap = el('div', { class: 'stack' }, grid, button, input);
  wrap.refresh = refresh;
  refresh();
  return wrap;
}

/** Avatar for a person, falling back to coloured initials. */
export async function avatarEl(person, { size = '' } = {}) {
  const cls = 'avatar' + (size ? ` avatar--${size}` : '');
  const photo = person?.id ? await firstPhoto('person', person.id) : null;
  if (photo) {
    return el('span', { class: cls }, el('img', {
      src: objectUrl(photo.thumbBlob || photo.blob),
      alt: person.name || 'Diner',
    }));
  }
  const node = el('span', { class: cls }, initialsOf(person?.name));
  if (person?.color) {
    node.style.background = person.color;
    node.style.color = '#fff';
  }
  return node;
}

function initialsOf(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
