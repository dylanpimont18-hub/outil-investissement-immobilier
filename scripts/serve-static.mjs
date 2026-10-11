// scripts/serve-static.mjs — serveur statique de développement sans dépendance : ouvre l'app en
// local (http://127.0.0.1:8090/index.html) et sert les tests Playwright. Jamais sur 8080, port
// tenu par un autre logiciel sur ce poste. MIME explicites : `python -m http.server` peut servir
// les .js en text/plain sous Windows (registre), ce que refuse <script type="module">.
import http from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.argv[2] || process.env.PORT || 8090);
const MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png',
    '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
    '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8', '': 'text/plain; charset=utf-8'
};
// Mêmes réécritures que firebase.json (hosting.rewrites) pour tester les mêmes URL qu'en ligne.
const REWRITES = { '/': '/index.html', '/portefeuille': '/owned.html' };

http.createServer((req, res) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400); res.end(); return; }
    pathname = REWRITES[pathname] || pathname;
    const file = normalize(join(ROOT, pathname));
    if (!file.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
    let st;
    try { st = statSync(file); } catch { res.writeHead(404); res.end('Not found'); return; }
    if (!st.isFile()) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, {
        'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
        'Content-Length': st.size,
        'Cache-Control': 'no-store'
    });
    createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log(`Spark (statique) — http://127.0.0.1:${PORT}/index.html`));
