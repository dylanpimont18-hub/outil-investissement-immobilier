// scripts/controle-hosting.mjs — contrôle de firebase.json SANS déployer (lecture seule).
// Le serveur de dev (serve-static.mjs) n'applique ni `ignore` ni `headers` : ce script rejoue la
// logique de firebase-tools (installé globalement) pour vérifier ce qui serait publié.
//   node scripts/controle-hosting.mjs
// Échoue si un fichier interne (package*.json, *.rules, *.md racine, Logo_site.png) serait publié
// ou si une page HTML n'a pas X-Frame-Options / Referrer-Policy (audit 2026-11-18, T3/T4).
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const FT = path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'firebase-tools');
const { listFiles } = require(path.join(FT, 'lib/listFiles.js'));
const { configMatcher } = require(path.join(FT, 'node_modules/superstatic/lib/utils/patterns.js'));

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const cfg = JSON.parse(readFileSync(path.join(ROOT, 'firebase.json'), 'utf8')).hosting;
const files = listFiles(path.resolve(ROOT, cfg.public), cfg.ignore);
let echecs = 0;

const internes = files.filter(f => /^(package(-lock)?\.json|[^/]+\.rules|[^/]+\.md|Logo_site\.png)$/.test(f));
console.log(`${files.length} fichiers publiés ; à la racine : ${files.filter(f => !f.includes('/')).join(', ')}`);
if (internes.length) { echecs++; console.log('✗ fichiers internes publiés :', internes.join(', ')); }
else console.log('✓ aucun fichier interne publié (package*.json, *.rules, *.md, Logo_site.png)');

const headersOf = p => Object.fromEntries(cfg.headers.filter(h => configMatcher(p, h)).flatMap(h => h.headers.map(x => [x.key, x.value])));
for (const p of ['/', '/index.html', '/owned.html', '/portefeuille']) {
    const h = headersOf(p);
    const ok = h['X-Frame-Options'] === 'DENY' && h['Referrer-Policy'] === 'strict-origin-when-cross-origin';
    if (!ok) echecs++;
    console.log(`${ok ? '✓' : '✗'} ${p.padEnd(14)} ${Object.keys(h).join(', ') || '(aucun en-tête)'}`);
}
process.exit(echecs ? 1 : 0);
