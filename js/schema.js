/**
 * Store definitions, seed data, and the 2026 Never-Ending Pasta Bowl menu.
 *
 * Combination math, for reference:
 *   4 pastas x 6 sauces x (4 toppings + "none") = 120
 * which matches Olive Garden's officially advertised figure.
 */

export const DB_NAME = 'pasta-pass-tracker';
export const DB_VERSION = 2;

/** Schema version stamped into JSON backups. */
export const BACKUP_VERSION = 1;

export const STORES = {
  people: { keyPath: 'id', indexes: [] },
  locations: { keyPath: 'id', indexes: [] },
  visits: {
    keyPath: 'id',
    indexes: [
      { name: 'date', keyPath: 'date' },
      { name: 'locationId', keyPath: 'locationId' },
    ],
  },
  bowls: {
    keyPath: 'id',
    indexes: [
      { name: 'visitId', keyPath: 'visitId' },
      { name: 'personId', keyPath: 'personId' },
    ],
  },
  menuItems: {
    keyPath: 'id',
    indexes: [{ name: 'kind', keyPath: 'kind' }],
  },
  photos: {
    keyPath: 'id',
    indexes: [{ name: 'owner', keyPath: ['ownerType', 'ownerId'] }],
  },
  settings: { keyPath: 'key', indexes: [] },
};

export const STORE_NAMES = Object.keys(STORES);

/* -------------------------------------------------------------- menu ----- */

/**
 * Seeded 2026 lineup.
 *
 * Confirmed by Olive Garden's July 2026 press release: Spicy Alfredo and
 * Crispy Shrimp Fritta are this year's additions. The remaining items carry
 * forward from 2025. The full lineup was not published before the Aug 24
 * launch, so everything here is editable in Settings.
 */
export const SEED_MENU = [
  { kind: 'pasta', name: 'Fettuccine' },
  { kind: 'pasta', name: 'Spaghetti' },
  { kind: 'pasta', name: 'Angel Hair' },
  { kind: 'pasta', name: 'Rigatoni' },

  { kind: 'sauce', name: 'Spicy Alfredo', isNew: true },
  { kind: 'sauce', name: 'Alfredo' },
  { kind: 'sauce', name: 'Meat Sauce' },
  { kind: 'sauce', name: 'Five Cheese Marinara' },
  { kind: 'sauce', name: 'Traditional Marinara' },
  { kind: 'sauce', name: 'Creamy Mushroom' },

  { kind: 'topping', name: 'Crispy Chicken Fritta' },
  { kind: 'topping', name: 'Meatballs' },
  { kind: 'topping', name: 'Italian Sausage' },
  { kind: 'topping', name: 'Crispy Shrimp Fritta', isNew: true },
];

/* ---------------------------------------------------------- settings ----- */

export const SETTING_KEYS = {
  mealPrice: 'mealPrice',
  toppingPrice: 'toppingPrice',
  toppingChargeMode: 'toppingChargeMode',
  passCost: 'passCost',
  seasonStart: 'seasonStart',
  seasonEnd: 'seasonEnd',
  theme: 'theme',
  seeded: 'seeded',
};

export const DEFAULT_SETTINGS = {
  /** Fallback used only when a visit's location has no default price. */
  [SETTING_KEYS.mealPrice]: 14.99,
  [SETTING_KEYS.toppingPrice]: 4.99,
  /** 'perBowl' charges the surcharge on every topped bowl; 'perVisit' once. */
  [SETTING_KEYS.toppingChargeMode]: 'perVisit',
  [SETTING_KEYS.passCost]: 100,
  /** Pass-holder early access through the end of the promotion. */
  [SETTING_KEYS.seasonStart]: '2026-08-24',
  [SETTING_KEYS.seasonEnd]: '2026-11-22',
};

export const OWNER_TYPES = ['visit', 'bowl', 'person', 'menuItem'];

/**
 * A visit is open while you are still at the table ordering refills, and
 * ended once you leave. `Visit.endedAt` holds the timestamp it was ended;
 * `null` means still open. At most one visit should be open at a time.
 */
export const VISIT_OPEN = null;

export const PALETTES = [
  { id: 'marinara', label: 'Marinara' },
  { id: 'alfredo', label: 'Alfredo' },
  { id: 'basil', label: 'Basil' },
  { id: 'breadstick', label: 'Breadstick' },
  { id: 'chianti', label: 'Chianti' },
  { id: 'slate', label: 'Slate' },
  { id: 'custom', label: 'Custom' },
];
