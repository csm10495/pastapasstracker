/**
 * Zero-dependency static file server used by the functional tests and
 * `npm run serve`. Deliberately minimal: the app is plain static files.
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, sep } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
};

/**
 * @param {object} opts
 * @param {string} opts.root directory to serve
 * @param {number} [opts.port] 0 picks a free port
 * @returns {Promise<{origin: string, port: number, close: () => Promise<void>}>}
 */
export function startServer({ root, port = 0 }) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      let pathname = decodeURIComponent(url.pathname);
      if (pathname.endsWith('/')) pathname += 'index.html';

      // Contain the resolved path inside the served root.
      const resolved = normalize(join(root, pathname));
      const rootNorm = normalize(root);
      if (!resolved.startsWith(rootNorm + sep) && resolved !== rootNorm) {
        res.writeHead(403).end('Forbidden');
        return;
      }

      const info = await stat(resolved).catch(() => null);
      if (!info || info.isDirectory()) {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
        return;
      }

      const body = await readFile(resolved);
      res.writeHead(200, {
        'content-type': TYPES[extname(resolved).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'no-cache',
        'content-length': body.length,
      }).end(body);
    } catch (err) {
      res.writeHead(500, { 'content-type': 'text/plain' }).end(String(err));
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const actual = server.address().port;
      resolve({
        origin: `http://127.0.0.1:${actual}`,
        port: actual,
        close: () => new Promise((done) => {
          server.closeAllConnections?.();
          server.close(() => done());
        }),
      });
    });
  });
}
