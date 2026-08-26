/**
 * Minimal ZIP writer.
 *
 * Photos are stored as their original files — already-compressed JPEG/PNG/HEIC
 * bytes — so entries are written with the "stored" method (no deflate). That
 * keeps this to a CRC32 plus two record layouts, which is why the app can ship
 * a zip export without taking on a dependency or a build step.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Zip stores names as raw bytes; UTF-8 plus the flag keeps accents readable. */
function encodeName(name) {
  return new TextEncoder().encode(name);
}

/** DOS date/time, which is what the zip header format wants. */
function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/**
 * Ensures names are unique and safe inside an archive: no directory
 * traversal, no duplicate entries (some tools silently drop the second).
 */
export function uniqueName(name, taken) {
  const clean = String(name)
    .replace(/\.\./g, '')
    .replace(/[\\/]+/g, '-')
    .replace(/^[-.\s]+/, '')
    .trim() || 'file';
  if (!taken.has(clean)) { taken.add(clean); return clean; }
  const dot = clean.lastIndexOf('.');
  const stem = dot > 0 ? clean.slice(0, dot) : clean;
  const ext = dot > 0 ? clean.slice(dot) : '';
  let n = 2;
  let candidate = `${stem}-${n}${ext}`;
  while (taken.has(candidate)) candidate = `${stem}-${++n}${ext}`;
  taken.add(candidate);
  return candidate;
}

async function toBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (typeof data === 'string') return new TextEncoder().encode(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(await data.arrayBuffer());
}

/**
 * Builds a zip archive.
 * @param entries [{ name, data: Blob|Uint8Array|string, date }]
 * @returns {Promise<Blob>}
 */
export async function createZip(entries) {
  const parts = [];
  const central = [];
  const taken = new Set();
  let offset = 0;

  for (const entry of entries) {
    const name = uniqueName(entry.name, taken);
    const nameBytes = encodeName(name);
    const bytes = await toBytes(entry.data);
    const crc = crc32(bytes);
    const { time, date } = dosDateTime(entry.date instanceof Date && !Number.isNaN(entry.date.getTime())
      ? entry.date
      : new Date());

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);            // version needed
    local.setUint16(6, 0x0800, true);        // UTF-8 names
    local.setUint16(8, 0, true);             // stored
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, bytes.length, true);
    local.setUint32(22, bytes.length, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);            // no extra field

    parts.push(new Uint8Array(local.buffer), nameBytes, bytes);

    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, 20, true);              // version made by
    dir.setUint16(6, 20, true);              // version needed
    dir.setUint16(8, 0x0800, true);
    dir.setUint16(10, 0, true);
    dir.setUint16(12, time, true);
    dir.setUint16(14, date, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, bytes.length, true);
    dir.setUint32(24, bytes.length, true);
    dir.setUint16(28, nameBytes.length, true);
    dir.setUint32(42, offset, true);
    central.push(new Uint8Array(dir.buffer), nameBytes);

    offset += 30 + nameBytes.length + bytes.length;
  }

  const centralSize = central.reduce((sum, p) => sum + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, taken.size, true);
  end.setUint16(10, taken.size, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], {
    type: 'application/zip',
  });
}
