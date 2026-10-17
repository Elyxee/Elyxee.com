// Local preview with the deployment's single-page fallback, so /portfolio and
// /about open the site just as they do on Cloudflare.
//
//   node scripts/serve.mjs                 http://127.0.0.1:4173
//   PORT=8080 HOST=0.0.0.0 node scripts/serve.mjs   reachable from a phone on the same Wi-Fi

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.svg': 'image/svg+xml',
};

createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://local').pathname);
  let file = normalize(join(ROOT, pathname));
  if (!file.startsWith(ROOT)) { response.writeHead(403).end(); return; }
  try { if ((await stat(file)).isDirectory()) file = join(file, 'index.html'); }
  catch { file = join(ROOT, 'index.html'); }
  try {
    const body = await readFile(file);
    response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
  } catch { response.writeHead(404).end(); }
}).listen(PORT, HOST, () => console.log(`Elyxee at http://${HOST}:${PORT}/`));
