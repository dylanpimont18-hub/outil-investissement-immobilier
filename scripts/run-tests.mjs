// scripts/run-tests.mjs — lance tous les tests Node (tests/*.mjs) en séquence et s'arrête au
// premier échec (exit 1). Remplace la boucle bash de package.json, qui échouait sous cmd.exe
// (npm lance ses scripts via cmd sur Windows). `--check` passe d'abord `node --check` sur chaque
// module .js de la racine (syntaxe seulement : les imports CDN ne sont pas résolus).
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

if (process.argv.includes('--check')) {
    for (const f of readdirSync(ROOT).filter(n => n.endsWith('.js')).sort()) {
        const r = spawnSync(process.execPath, ['--check', join(ROOT, f)], { stdio: 'inherit' });
        if (r.status !== 0) { console.error(`\nSyntaxe invalide : ${f}`); process.exit(1); }
    }
    console.log('Syntaxe OK (node --check) sur les modules racine');
}

const tests = readdirSync(join(ROOT, 'tests')).filter(n => n.endsWith('.mjs')).sort();
for (const t of tests) {
    console.log(`\n▶ tests/${t}`);
    const r = spawnSync(process.execPath, [join(ROOT, 'tests', t)], { stdio: 'inherit' });
    if (r.status !== 0) { console.error(`\nÉCHEC : tests/${t}`); process.exit(1); }
}
console.log(`\nOK — ${tests.length} fichiers de tests passent`);
