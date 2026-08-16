/**
 * Minimal Chrome DevTools Protocol client.
 *
 * Node 22 ships a global WebSocket, so driving a real browser needs no
 * dependencies at all — no Playwright, no Puppeteer.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME_CANDIDATES = [
  process.env.PPT_CHROME,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  `${process.env.LOCALAPPDATA || ''}\\Google\\Chrome\\Application\\chrome.exe`,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

export function findBrowser() {
  for (const candidate of CHROME_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Launches a headless browser with a throwaway profile. */
export async function launchBrowser({ width = 430, height = 932 } = {}) {
  const binary = findBrowser();
  if (!binary) throw new Error('No Chrome or Edge installation found. Set PPT_CHROME.');

  const userDataDir = mkdtempSync(join(tmpdir(), 'ppt-test-'));
  // Port 0 lets the browser choose; it reports the real port on stderr, but
  // reading the DevTools port file is more reliable across versions.
  const port = 9200 + Math.floor(Math.random() * 700);

  const proc = spawn(binary, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-background-networking',
    `--window-size=${width},${height}`,
    'about:blank',
  ], { stdio: 'ignore' });

  let targets = null;
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      targets = await res.json();
      if (targets.length) break;
    } catch { /* browser still starting */ }
    await sleep(200);
  }
  if (!targets?.length) {
    proc.kill();
    throw new Error('Browser DevTools endpoint never became available');
  }

  const close = async () => {
    proc.kill();
    // Chrome can hold locks on its profile briefly after exit, so retry
    // rather than leaving a temp directory behind on every single test.
    for (let attempt = 0; attempt < 5; attempt++) {
      await sleep(150 * (attempt + 1));
      try {
        rmSync(userDataDir, { recursive: true, force: true });
        return;
      } catch { /* still locked; try again */ }
    }
  };

  return { port, targets, proc, close };
}

export class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    /** Console errors and uncaught exceptions seen since the last reset. */
    this.errors = [];
    this.logs = [];
    ws.addEventListener('message', (ev) => this.#handle(JSON.parse(ev.data)));
  }

  static async attach(webSocketDebuggerUrl) {
    const ws = new WebSocket(webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });
    const cdp = new Cdp(ws);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('DOM.enable');
    await cdp.send('Network.enable');
    return cdp;
  }

  #handle(msg) {
    if (msg.id && this.pending.has(msg.id)) {
      const { resolve, reject, timer } = this.pending.get(msg.id);
      clearTimeout(timer);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message} (${JSON.stringify(msg.error)})`));
      else resolve(msg.result);
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      this.errors.push('exception: ' + (d.exception?.description || d.text));
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = msg.params.args
        .map((a) => a.value ?? a.description ?? a.unserializableValue ?? '')
        .join(' ');
      if (msg.params.type === 'error') this.errors.push('console.error: ' + text);
      else this.logs.push(`[${msg.params.type}] ${text}`);
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      this.errors.push('log: ' + msg.params.entry.text);
    }
  }

  send(method, params = {}, timeout = 30000) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** Evaluates an expression in the page, awaiting promises, returning JSON. */
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    }
    return r.result.value;
  }

  close() {
    try { this.ws.close(); } catch { /* already gone */ }
  }
}
