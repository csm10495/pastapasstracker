/** `npm run serve` — serves the app for local development. */

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { startServer } from './server.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const port = Number(process.env.PORT || 8000);

const server = await startServer({ root: ROOT, port });
console.log(`Pasta Pass Tracker running at ${server.origin}`);
console.log('Press Ctrl+C to stop.');

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await server.close();
    process.exit(0);
  });
}
