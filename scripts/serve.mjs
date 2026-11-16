/**
 * scripts/serve.mjs
 * ---------------------------------------------------------------------------
 * Server statico minimale per testare la build di produzione (dist/).
 *
 * Il service worker richiede un server HTTP: aprire index.html da file:// non
 * funziona. Questo script evita di dover installare `serve` o usare Python.
 *
 * Uso:  npm run build && npm run serve   ->  http://localhost:4173
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..', 'dist');
const PORT = Number(process.env.PORT ?? 4173);
const HOST = process.env.HOST ?? '127.0.0.1';

const MIME = {
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
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    // Normalizza il percorso per impedire il path traversal.
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';
    const filePath = join(ROOT, normalize(pathname).replace(/^(\.\.[/\\])+/, ''));

    let target = filePath;
    try {
      const info = await stat(target);
      if (info.isDirectory()) target = join(target, 'index.html');
    } catch {
      // Fallback SPA -> index.html
      target = join(ROOT, 'index.html');
    }

    const data = await readFile(target);
    const type = MIME[extname(target).toLowerCase()] ?? 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      // Il service worker non deve essere messo in cache dal browser.
      'Cache-Control': target.endsWith('sw.js')
        ? 'public, max-age=0, must-revalidate'
        : 'no-cache',
    });
    res.end(data);
  } catch (error) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 - risorsa non trovata');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Mini-Foglio di Calcolo servito su http://${HOST}:${PORT}`);
  console.log('Premi Ctrl+C per arrestare.');
});
