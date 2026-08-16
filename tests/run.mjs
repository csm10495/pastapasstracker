/**
 * Test runner.
 *
 * Starts one static server for the whole run, exposes it as PPT_ORIGIN, then
 * hands off to Node's built-in test runner. No dependencies.
 *
 *   node tests/run.mjs              unit + functional
 *   node tests/run.mjs --unit       unit only
 *   node tests/run.mjs --functional functional only
 */

import { spawn } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { startServer } from './helpers/server.mjs';
import { findBrowser } from './helpers/cdp.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

/** Node's --test does not reliably accept a bare directory, so enumerate. */
function testFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.test.mjs'))
    .sort()
    .map((f) => join(dir, f));
}

const args = process.argv.slice(2);
const onlyUnit = args.includes('--unit');
const onlyFunctional = args.includes('--functional');

const targets = [];
if (!onlyFunctional) targets.push(...testFiles(resolve(HERE, 'unit')));
if (!onlyUnit) targets.push(...testFiles(resolve(HERE, 'functional')));

if (!targets.length) {
  console.error('No test files found.');
  process.exit(1);
}

const needsBrowser = !onlyUnit && testFiles(resolve(HERE, 'functional')).length > 0;
if (needsBrowser && !findBrowser()) {
  console.error(
    'No Chrome or Edge found — functional tests cannot run.\n'
    + 'Set PPT_CHROME to a browser binary, or run unit tests only:\n'
    + '  node tests/run.mjs --unit',
  );
  process.exit(1);
}

const server = needsBrowser ? await startServer({ root: ROOT }) : null;
if (server) console.log(`test server: ${server.origin}\n`);

const child = spawn(
  process.execPath,
  ['--test', '--test-concurrency=1', ...targets],
  {
    stdio: 'inherit',
    env: { ...process.env, ...(server ? { PPT_ORIGIN: server.origin } : {}) },
  },
);

const code = await new Promise((done) => child.on('close', done));
await server?.close();
process.exit(code ?? 0);
