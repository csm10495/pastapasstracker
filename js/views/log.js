/**
 * The tab bar's "Log" action.
 *
 * This route holds no UI of its own. It decides what logging means right now:
 * add a bowl to the visit in progress, or start a new one. Routing through a
 * real route keeps the decision in one place and keeps the tab bar honest.
 */

import { getOpenVisit, startVisit } from '../db.js';
import { quickAddBowl } from '../quick-bowl.js';
import { el, todayISO, toast } from '../ui.js';

export async function render(container) {
  const open = await getOpenVisit();

  container.append(el('div', { class: 'loading' },
    open ? 'Adding a bowl…' : 'Starting a visit…'));

  const visit = open || await startVisit({ date: todayISO() });
  if (!open) toast('Visit started');

  await quickAddBowl(visit.id);
  location.hash = `#/visits/${encodeURIComponent(visit.id)}`;
}
