// A development server that never lets the browser cache anything.
//
//   node tools/serve.mjs            # http://localhost:8765
//   node tools/serve.mjs 3000       # another port
//
// Why this exists rather than `python -m http.server`: python's server sends no
// Cache-Control header at all, only Last-Modified. With no Cache-Control a
// browser falls back to heuristic caching and may serve a stale file without
// revalidating — so you edit css/styles.css, reload, and see the old design.
// That cost an afternoon once: the dark palette had been deleted, the server
// was serving the new stylesheet, and Brave was still painting the old one.
// Adding ?v=N to the page URL does not help, because the stylesheet is a
// separate request with its own cache entry.
//
// Everything here goes out as `Cache-Control: no-store`, so what you see is
// always what is on disk. Never use it as a real web server — no-store on
// every response is exactly wrong in production, and GitHub Pages sets sensible
// headers of its own.
//
// It listens on 127.0.0.1 only and refuses dot-paths (.git/, .claude/, .env…).
// The first version listened on every network interface and served the whole
// folder, so anyone on the same school or café Wi-Fi could download .git/ —
// the full history, including anything ever committed by mistake (audit X02).
//
// No dependencies, like everything else in tools/.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative, extname, sep } from 'node:path';

const root = resolve(join(dirname(fileURLToPath(import.meta.url)), '..'));
const port = Number(process.argv[2]) || 8765;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

createServer(async (req, res) => {
  const send = (code, body, type = 'text/plain; charset=utf-8') => {
    res.writeHead(code, {
      'Content-Type': type,
      // The whole point of this file.
      'Cache-Control': 'no-store, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    });
    res.end(body);
  };

  try {
    // Strip the query — ?v=40 and friends are cache-busters, not paths.
    let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';

    // Resolve, then confirm the result is still inside the project. Without
    // this, "/../../.ssh/id_rsa" would be served happily.
    const file = resolve(join(root, pathname));
    if (file !== root && !file.startsWith(root + sep)) return send(403, 'Forbidden');
    // Hidden files and folders are never part of the site. Checked on the
    // resolved path, so "/%2egit/HEAD" and "/js/../.git/HEAD" are caught too.
    if (relative(root, file).split(sep).some((part) => part.startsWith('.'))) {
      return send(404, `Not found: ${pathname}`);
    }

    const info = await stat(file).catch(() => null);
    if (!info || !info.isFile()) return send(404, `Not found: ${pathname}`);

    send(200, await readFile(file), TYPES[extname(file).toLowerCase()] || 'application/octet-stream');
  } catch (err) {
    send(500, `Server error: ${err.message}`);
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`Serving ${root}`);
  console.log(`  http://localhost:${port}`);
  console.log('  Cache-Control: no-store — every reload gets what is on disk.');
});
