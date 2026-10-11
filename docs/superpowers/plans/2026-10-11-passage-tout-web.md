# Passage au tout-web — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faire de Spark une application 100 % web (Firebase Hosting + Firestore/Storage), sans aucune donnée en `localStorage`, en migrant une dernière fois les données locales de l'exe vers le cloud, puis supprimer l'exe, Flask et la chaîne de build.

**Architecture:** Un nouveau module `cloud-store.js` (wrapper fin Firestore/Storage, même style que `owned-cloud.js`) porte les études du comparateur (`users/{uid}/studies/{id}`), les réglages (`users/{uid}/settings/{analysis|prefs|migration}`) et les archives JSON (`Storage users/{uid}/archives/`). `main.js` ne démarre son premier `render()` qu'après les 4 premiers snapshots (prefs, portfolioMeta, studies, analysis), n'écrit que sur action utilisateur, débounce l'étude en cours à 1,5 s et synchronise les deux fenêtres par `BroadcastChannel` (payload complet). `openPrintDocument()` (utils.js) imprime tout document HTML dans la page elle-même via Shadow DOM (logique déjà éprouvée du rapport d'un bien, PC et iPhone). `migration-locale.js`, chargé seulement depuis l'exe (`127.0.0.1:8080`), pousse puis **relit et compare** avant d'écrire le marqueur `settings/migration`.

**Tech Stack:** modules ES natifs sans bundler, Firebase SDK 12.16.0 (CDN gstatic), Node 24 (tests `node:assert/strict`), Playwright + Chromium (tests navigateur), serveur statique Node maison (`scripts/serve-static.mjs`, port 8090).

**Spec:** `docs/superpowers/specs/2026-10-11-passage-tout-web-prompt.md`

## Global Constraints

- Aucune perte de données : en cas de doute sur une écriture qui pourrait écraser du cloud, ne pas écrire et demander.
- `calculs.js` **n'est pas modifié** ; toute la suite `tests/*.mjs` reste verte.
- Zéro `localStorage`/`sessionStorage` dans le code applicatif (seule exception : le SDK Firebase Auth, et `migration-locale.js` qui lit l'ancien stockage de l'exe).
- **Ne jamais écrire de valeurs par défaut dans le cloud au chargement** : écriture uniquement sur action de l'utilisateur. Débounce 1,5 s sur `settings/analysis` + flush sur `visibilitychange`/`pagehide`. Conflits : dernière écriture gagnante.
- Firestore reste en cache mémoire (`firebase-init.js` inchangé). Règles Firestore/Storage inchangées (`users/{uid}/…`).
- Tout texte visible en français ; tout contenu utilisateur injecté passe par `escapeHtml()` (utils.js).
- Style existant : modules ES natifs, template literals, commentaires en français (densité équivalente), pas de framework ni de dépendance runtime nouvelle.
- Périmètre : ni refonte ergonomique ni optimisation de performance. Bug hors périmètre croisé → noté dans le compte rendu, pas corrigé.
- Ne jamais tuer l'exe ni Revit. Le port 8080 n'est pas le nôtre : serveur statique de test sur **8090**.
- Outil Bash : un heredoc contenant des apostrophes françaises plante → créer/modifier les fichiers avec Write/Edit.
- Pas de `firebase deploy`, de suppression de fichiers hors du dépôt, ni de `git push` sans accord explicite de l'utilisateur au moment même. **STOP** aux points marqués dans `<deroulement>` de la spec (fin de Phase 2, 3, 4, 5, 6).
- Après chaque tâche modifiant des fichiers : mettre à jour `CODEBASE_MAP.md` (entrées des fichiers touchés uniquement).
- Commits atomiques sur la branche dédiée `feat/tout-web`, messages terminés par `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. **Snapshot `settings/analysis` reçu pendant la frappe** (écriture locale encore en attente du débounce) : la saisie ne doit pas être écrasée par une valeur plus ancienne — test dans la Tâche 6 (`_applyAnalysis` ignore tout snapshot tant que `_analysisDirty`).
2. **Document `settings/prefs` absent ou incomplet** (premier lancement web sur un nouvel appareil) : valeurs par défaut appliquées **sans aucune écriture** cloud tant que l'utilisateur n'agit pas — test dans la Tâche 5 (`__store.writes` vide après chargement).
3. **Export JSON alors que l'upload Storage échoue** (hors ligne, quota) : le téléchargement/partage doit quand même avoir lieu et un toast prévenir — test dans la Tâche 9 (`failUploadArchive`).
4. **Import d'un fichier JSON invalide** (tableau, texte, objet sans biens) : message d'erreur, aucune écriture — test dans la Tâche 9.
5. **Migration relancée après un premier passage partiel** (études déjà en cloud, archive déjà présente, document déjà uploadé) : idempotente, aucun doublon, bilan correct, marqueur écrit — test dans la Tâche 10 (second passage sur un store déjà alimenté).
6. **`window.print()` sans `afterprint`** (navigateurs mobiles qui n'émettent pas l'événement) : l'hôte d'impression précédent est nettoyé au prochain appel, jamais deux hôtes — test dans la Tâche 3 (deux impressions successives → un seul `#spark-print-root`).

## Structure des fichiers

**Créés**
- `cloud-store.js` — wrapper Firestore/Storage : études, réglages (analysis/prefs/migration), archives. Zéro DOM, zéro logique métier.
- `migration-regles.js` — règles pures de la migration (choix de l'étude la plus récente, comparaison profonde, normalisation Firestore, nom d'archive unique, lecture typée des clés `localStorage`). Testable sous Node.
- `migration-locale.js` — orchestration de la migration unique (modale de progression + bilan). Chargé dynamiquement par `main.js` depuis l'exe seulement. Supprimé en Phase 6.
- `scripts/run-tests.mjs` — lance `tests/*.mjs` en séquence (remplace la boucle bash de `npm test`, cassée sous cmd.exe) ; `--check` ajoute `node --check` sur les modules racine.
- `scripts/serve-static.mjs` — serveur statique Node sans dépendance (port 8090, MIME explicites, rewrite `/portefeuille`).
- `scripts/controle-migration.mjs` — Phase 4 : lit `settings/migration` et compte `studies/` dans un vrai navigateur (l'utilisateur se connecte lui-même ; lecture seule).
- `tests/test_migration_regles.mjs` — tests Node de `migration-regles.js`.
- `tests/playwright/_harness.mjs` — stubs partagés (`owned-cloud.js`, `cloud-store.js`), espion `localStorage`, helpers `openPage`/`step`.
- `tests/playwright/tout-web.mjs` — scénarios PC + iPhone de la version web.
- `tests/playwright/migration-locale.mjs` — scénarios de la migration.

**Modifiés**
- `main.js` — bootstrap cloud (gate, chargement, prefs, études, étude en cours, profil), sync `BroadcastChannel` par payload, version depuis `VERSION`, plus aucun `localStorage`.
- `owned-portfolio.js` — prefs via `cloud-store.js`, export/import via Storage + fichier, PDF via `openPrintDocument`, suppression de `IS_LOCAL_APP`/bannière de migration/`/api/*`, export `renderAuthGateInto`.
- `owned-entry.js` — état initial sans `localStorage`.
- `owned-cloud.js` — ajouts lecture seule pour la migration (`cloudGetMeta`, `cloudGetAllAssets`, `cloudDocumentExists`).
- `utils.js` — `openPrintDocument` réécrite (Shadow DOM), `cssPourShadow`.
- `index.html`, `owned.html`, `styles.css` — gate global, indicateur de chargement, modale d'import, classes d'impression, retrait de la bannière de migration.
- `firebase.json` — en-tête `Cache-Control` sur `/VERSION` (Phase 2) ; nettoyage des `ignore` (Phase 6).
- `package.json` — scripts `test`/`verify`/`serve`.
- `tests/playwright/{factures-modal,change-password,projection-impots}.mjs` — stub `cloud-store.js` + profil seedé via `meta.profile`.
- `CODEBASE_MAP.md`, `CHANGELOG.md`, `CLAUDE.md` (Phase 6).

**Supprimés (Phase 6 uniquement)** : `app.py`, `server.py`, `build.bat`, `spark.spec`, `requirements.txt`, `config.example.py`, `Lancer.bat`, `update-and-run.bat`, `spark.ico`, `verify.bat`, `tests/test_server_api.py`, `migration-locale.js`, dossiers `Spark/`, `build/`, `__pycache__/`, `tests/__pycache__/`, `Spark-*.zip`, `geocache.json`.

## Contrats partagés (référence pour toutes les tâches)

**Firestore, sous `users/{uid}/`** :
- `studies/{id}` : `{ id, variablesData, createdAt, updatedAt }` — exactement la forme produite par `sanitizeAssetRecord` (main.js). `updatedAt` en millisecondes (`Date.now()`).
- `settings/analysis` : `{ variablesData, activeAssetId: string|null, updatedAt }`.
- `settings/prefs` : `{ theme: 'light'|'dark', screens: 1|2, profilePreset, sparkMode: 'guided'|'full', guidedMode: bool, tutoStep: int, analysisView: 'quick'|'full', ownedCompact: bool, ownedSort: {criterion, dir}|null, ownedYearFilters: {assetId: int}, ownedPieYear, ownedPieMonth, facturesLastAsset: string|null }` — toutes les clés optionnelles ; une clé absente = valeur par défaut, jamais écrite.
- `settings/migration` : `{ doneAt: ISO string, counts: { etudes, archives, documents }, appVersion }`.
- `portfolioMeta/main` (existant) : `profile`, `goals`, `order`, `regime`. **`state.profileConfigured` = `!!meta.profile`** (plus de clé dédiée).

**Storage** : `users/{uid}/archives/<nom>.json` (archives du portefeuille), `users/{uid}/documents/{assetId}/<fichier>` (existant).

**`cloud-store.js` (exports)** :
```js
watchStudies(onChange: (map) => void, onError?) → unsubscribe
cloudSetStudy(id, record) → Promise          // setDoc sans merge (remplace)
cloudDeleteStudy(id) → Promise
cloudGetAllStudies() → Promise<map>           // getDocs (migration)
watchAnalysis(onChange: (data|null) => void, onError?) → unsubscribe
cloudSaveAnalysis(patch) → Promise            // setDoc merge
watchPrefs(onChange: (prefs) => void, onError?) → unsubscribe   // {} si le doc n'existe pas
savePref(patch) → Promise                     // setDoc merge sur settings/prefs
cloudGetSetting(name) → Promise<data|null>
cloudSetSetting(name, data, { merge = true } = {}) → Promise
cloudUploadArchive(filename, blobOrText) → Promise
cloudListArchives() → Promise<[{ name, size, updated }]>   // tri nom décroissant
cloudReadArchive(filename) → Promise<any>     // JSON.parse du contenu
cloudArchiveMeta(filename) → Promise<{ size, updated }|null>
```

**`owned-cloud.js` (ajouts)** : `cloudGetMeta() → Promise<object>`, `cloudGetAllAssets() → Promise<map>`, `cloudDocumentExists(assetId, filename) → Promise<boolean>`.

**`owned-portfolio.js` (ajouts/changements d'interface)** : `export function renderAuthGateInto(gateEl, { title = 'Connexion' } = {})` ; `initOwnedPortfolio({ state, nodes, IS_ANALYSIS_WINDOW, IS_MOBILE_PAGE })` (plus de `STORAGE_KEYS`) ; `state.facturesLastAsset` remplace la clé `spark:factures:lastAsset`.

**`utils.js`** : `openPrintDocument(documentHTML, filename, triggerBtnId = null) → Promise<void>` (signature inchangée), `cssPourShadow(css) → string`.

**`migration-regles.js`** :
```js
choisirEtude(locale, cloud) → l'objet à garder (cloud si cloud.updatedAt > locale.updatedAt, sinon locale)
comparerProfond(a, b) → boolean
normaliserPourFirestore(obj) → clone JSON (undefined/fonctions retirés)
nomArchiveUnique(base, existants: string[]) → 'base.json' | 'base-1.json' | …
lireEtudesLocales(getItem) → array d'objets bruts
lireAnalyseLocale(getItem) → { variablesData, activeAssetId } | null
lirePrefsLocales(getItem) → objet prefs typé (clés absentes omises)
lireProfilLocal(getItem) → { profil: object|null, configure: boolean }
lireMetaLocale(getItem) → { regime?, order?, goals? }
```

**Tests navigateur** : serveur statique `node scripts/serve-static.mjs 8090` ; `SPARK_TEST_BASE=http://127.0.0.1:8090` ; captures via `TW_SCREENSHOTS=<dir>` (tout-web) / `ML_SCREENSHOTS=<dir>` (migration). Les stubs remplacent `owned-cloud.js` **et** `cloud-store.js` (`page.route`), exportent **toutes** leurs fonctions, et exposent `window.__stub` (owned-cloud) / `window.__store` (cloud-store).

---

# Phase 2 — Version web + module de migration

### Tâche 0 : Branche, VERSION en attente, outillage de test Node

**Files:**
- Create: `scripts/run-tests.mjs`, `scripts/serve-static.mjs`
- Modify: `package.json`, `CODEBASE_MAP.md`

**Interfaces:**
- Produces: `npm test` (tous les `tests/*.mjs`), `npm run verify` (idem + `node --check` des `.js` racine), `npm run serve` (statique sur 8090). Toutes les tâches suivantes les utilisent.

- [ ] **Étape 1 : Créer la branche et commiter le `VERSION` déjà construit**

`VERSION` vaut `1.0.23` dans l'arbre de travail (non commité) et `Spark/Spark-1.0.23.exe` existe : c'est le build fait par l'utilisateur ce jour. On le commite tel quel pour partir d'un arbre propre (`build.bat` incrémentera lui-même vers 1.0.24 en Phase 3).

```bash
cd "C:/Users/Dylan/Desktop/Creation_site/Investissement_web"
git checkout -b feat/tout-web
git add VERSION
git commit -m "chore(build): version 1.0.23 (exe deja construit)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Étape 2 : Écrire `scripts/run-tests.mjs`** (Write)

```js
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
```

- [ ] **Étape 3 : Écrire `scripts/serve-static.mjs`** (Write)

```js
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
```

- [ ] **Étape 4 : Mettre à jour `package.json`** (Edit)

Remplacer le bloc `"scripts"` et la description :

```json
  "description": "Spark Investissement — application web (Firebase Hosting) d'analyse d'investissement immobilier + tests calculs.js + verification navigateur (Playwright)",
  "scripts": {
    "test": "node scripts/run-tests.mjs",
    "verify": "node scripts/run-tests.mjs --check",
    "serve": "node scripts/serve-static.mjs 8090"
  },
```

- [ ] **Étape 5 : Vérifier**

Run: `npm test` (depuis l'outil Bash, cwd racine)
Expected: chaque `tests/*.mjs` listé avec `▶`, puis `OK — 12 fichiers de tests passent` (exit 0).

Run: `npm run verify`
Expected: `Syntaxe OK (node --check) sur les modules racine` puis la même suite verte.

Run en arrière-plan : `node scripts/serve-static.mjs 8090` puis `curl -sI http://127.0.0.1:8090/main.js | grep -i content-type`
Expected: `Content-Type: text/javascript; charset=utf-8`. `curl -s http://127.0.0.1:8090/VERSION` → `1.0.23`. Laisser ce serveur tourner pour toute la Phase 2 (ou le relancer au besoin ; ne jamais toucher au 8080).

- [ ] **Étape 6 : CODEBASE_MAP + commit**

Ajouter deux sections `## scripts/run-tests.mjs` et `## scripts/serve-static.mjs` (rôle une ligne + options `--check`/port) dans `CODEBASE_MAP.md`, et noter dans `## verify.bat` qu'il est remplacé par `npm run verify` (suppression prévue en Phase 6).

```bash
git add scripts/run-tests.mjs scripts/serve-static.mjs package.json CODEBASE_MAP.md
git commit -m "chore(tests): npm test en Node (fin de la boucle bash) + serveur statique 8090

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Tâche 1 : `migration-regles.js` (règles pures) + tests Node

**Files:**
- Create: `migration-regles.js`, `tests/test_migration_regles.mjs`
- Modify: `CODEBASE_MAP.md`

**Interfaces:**
- Produces: les fonctions listées dans « Contrats partagés » (`choisirEtude`, `comparerProfond`, `normaliserPourFirestore`, `nomArchiveUnique`, `lireEtudesLocales`, `lireAnalyseLocale`, `lirePrefsLocales`, `lireProfilLocal`, `lireMetaLocale`). Consommées par `migration-locale.js` (Tâche 10) et `owned-portfolio.js` (`nomArchiveUnique`, Tâche 9).

- [ ] **Étape 1 : Écrire le test qui échoue** (Write `tests/test_migration_regles.mjs`)

```js
// Tests des règles pures de la migration locale → cloud (migration-regles.js).
import assert from 'node:assert/strict';
import {
    choisirEtude, comparerProfond, normaliserPourFirestore, nomArchiveUnique,
    lireEtudesLocales, lireAnalyseLocale, lirePrefsLocales, lireProfilLocal, lireMetaLocale
} from '../migration-regles.js';

const fauxStockage = entries => {
    const m = new Map(Object.entries(entries));
    return key => (m.has(key) ? m.get(key) : null);
};

// choisirEtude : le plus récent gagne, à défaut l'étude locale
assert.equal(choisirEtude({ id: 'a', updatedAt: 10 }, null).updatedAt, 10, 'pas de cloud → locale');
assert.equal(choisirEtude(null, { id: 'a', updatedAt: 5 }).updatedAt, 5, 'pas de locale → cloud');
assert.equal(choisirEtude({ id: 'a', updatedAt: 10 }, { id: 'a', updatedAt: 20 }).updatedAt, 20, 'cloud plus récent');
assert.equal(choisirEtude({ id: 'a', updatedAt: 30 }, { id: 'a', updatedAt: 20 }).updatedAt, 30, 'locale plus récente');
assert.equal(choisirEtude({ id: 'a', updatedAt: 20 }, { id: 'a', updatedAt: 20, cloud: true }).cloud, undefined, 'égalité → locale');
assert.equal(choisirEtude({ id: 'a' }, { id: 'a', updatedAt: 1 }).updatedAt, 1, 'locale sans updatedAt → cloud daté gagne');

// comparerProfond : indépendant de l'ordre des clés, strict sur les valeurs
assert.equal(comparerProfond({ a: 1, b: [1, { c: null }] }, { b: [1, { c: null }], a: 1 }), true);
assert.equal(comparerProfond({ a: 1 }, { a: '1' }), false);
assert.equal(comparerProfond({ a: 1 }, { a: 1, b: 2 }), false);
assert.equal(comparerProfond([1, 2], [2, 1]), false);
assert.equal(comparerProfond({ a: undefined }, {}), true, 'undefined = absent (Firestore ne stocke pas undefined)');
assert.equal(comparerProfond(NaN, NaN), true);

// normaliserPourFirestore : clone JSON, retire undefined/fonctions
const n = normaliserPourFirestore({ a: 1, b: undefined, c: () => 1, d: { e: [1, undefined] } });
assert.deepEqual(n, { a: 1, d: { e: [1, null] } });

// nomArchiveUnique : même règle que l'ancien server.py (suffixe -1, -2…)
assert.equal(nomArchiveUnique('portefeuille-2026-10-11', []), 'portefeuille-2026-10-11.json');
assert.equal(nomArchiveUnique('portefeuille-2026-10-11', ['portefeuille-2026-10-11.json']), 'portefeuille-2026-10-11-1.json');
assert.equal(nomArchiveUnique('portefeuille-2026-10-11', ['portefeuille-2026-10-11.json', 'portefeuille-2026-10-11-1.json']), 'portefeuille-2026-10-11-2.json');

// Lecture typée de l'ancien localStorage
const getItem = fauxStockage({
    investissementWebAssetRecords: JSON.stringify([{ id: 'asset-1', variablesData: { prix: 100000 }, createdAt: 1, updatedAt: 2 }, 'pas un objet']),
    investissementWebVariablesData: JSON.stringify({ prix: 150000, loyer: 700 }),
    investissementWebActiveAssetId: 'asset-1',
    investissementWebTheme: 'light',
    investissementWebScreens: '2',
    investissementWebProfile: 'couple',
    investissementWebGuidedMode: 'true',
    investissementWebSparkMode: 'guided',
    sparkTutoStep: '3',
    investissementWebAnalysisView: 'full',
    investissementWebOwnedCompact: '1',
    investissementWebOwnedSort: JSON.stringify({ criterion: 'cf', dir: 'desc' }),
    investissementWebOwnedYearFilters: JSON.stringify({ 'oa-1': 3 }),
    investissementWebOwnedPieYear: JSON.stringify({ 'oa-1': 2026 }),
    'spark:factures:lastAsset': 'oa-1',
    investissementWebProfileData: JSON.stringify({ name: 'Nous', income: 50000, adults: 2, children: 1 }),
    investissementWebProfileConfigured: '1',
    investissementWebOwnedRegime: 'reel',
    investissementWebOwnedOrder: JSON.stringify(['oa-1']),
    investissementWebPortfolioGoals: JSON.stringify({ cfMensuel: 500 })
});
assert.deepEqual(lireEtudesLocales(getItem), [{ id: 'asset-1', variablesData: { prix: 100000 }, createdAt: 1, updatedAt: 2 }], 'entrées non-objet ignorées');
assert.deepEqual(lireAnalyseLocale(getItem), { variablesData: { prix: 150000, loyer: 700 }, activeAssetId: 'asset-1' });
assert.deepEqual(lirePrefsLocales(getItem), {
    theme: 'light', screens: 2, profilePreset: 'couple', guidedMode: true, sparkMode: 'guided', tutoStep: 3,
    analysisView: 'full', ownedCompact: true, ownedSort: { criterion: 'cf', dir: 'desc' }, ownedYearFilters: { 'oa-1': 3 },
    ownedPieYear: { 'oa-1': 2026 }, facturesLastAsset: 'oa-1'
}, 'ownedPieMonth absent → clé omise');
assert.deepEqual(lireProfilLocal(getItem), { profil: { name: 'Nous', income: 50000, adults: 2, children: 1 }, configure: true });
assert.deepEqual(lireMetaLocale(getItem), { regime: 'reel', order: ['oa-1'], goals: { cfMensuel: 500 } });

// Stockage vide ou corrompu : rien ne casse, rien n'est inventé
const vide = fauxStockage({ investissementWebVariablesData: '{pas du json', investissementWebAssetRecords: '42' });
assert.deepEqual(lireEtudesLocales(vide), []);
assert.equal(lireAnalyseLocale(vide), null);
assert.deepEqual(lirePrefsLocales(vide), {});
assert.deepEqual(lireProfilLocal(vide), { profil: null, configure: false });
assert.deepEqual(lireMetaLocale(vide), {});

console.log('test_migration_regles: OK');
```

- [ ] **Étape 2 : Lancer, vérifier l'échec**

Run: `node tests/test_migration_regles.mjs`
Expected: `ERR_MODULE_NOT_FOUND` (`migration-regles.js` absent).

- [ ] **Étape 3 : Écrire `migration-regles.js`** (Write)

```js
// Règles pures de la migration unique « stockage local de l'exe → cloud » (voir migration-locale.js
// et docs/superpowers/specs/2026-10-11-passage-tout-web-prompt.md, point 5). Aucun accès DOM,
// window ou localStorage : les lecteurs reçoivent une fonction getItem(key) pour rester testables
// sous Node (tests/test_migration_regles.mjs). nomArchiveUnique est aussi utilisée par l'export du
// portefeuille (owned-portfolio.js).

// Une étude du comparateur existe des deux côtés : la plus récente (updatedAt) gagne, à défaut la
// locale — elle vient de l'appareil que l'utilisateur utilisait réellement jusqu'ici.
export function choisirEtude(locale, cloud) {
    if (!cloud) return locale;
    if (!locale) return cloud;
    const dateCloud = Number(cloud.updatedAt) || 0;
    const dateLocale = Number(locale.updatedAt) || 0;
    return dateCloud > dateLocale ? cloud : locale;
}

// Égalité profonde indépendante de l'ordre des clés (Firestore ne garantit pas l'ordre à la
// relecture). `undefined` vaut « absent » : Firestore ne stocke jamais cette valeur.
export function comparerProfond(a, b) {
    if (Object.is(a, b)) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) {
        return a.length === b.length && a.every((v, i) => comparerProfond(v, b[i]));
    }
    const clesA = Object.keys(a).filter(k => a[k] !== undefined);
    const clesB = Object.keys(b).filter(k => b[k] !== undefined);
    if (clesA.length !== clesB.length) return false;
    return clesA.every(k => Object.prototype.hasOwnProperty.call(b, k) && comparerProfond(a[k], b[k]));
}

// Firestore rejette undefined et les fonctions : un aller-retour JSON les retire (les Dates
// deviendraient des chaînes, mais aucune donnée Spark n'en contient).
export function normaliserPourFirestore(obj) {
    return JSON.parse(JSON.stringify(obj));
}

// Même convention que l'ancien server.py : portefeuille-AAAA-MM-JJ.json, puis -1, -2…
export function nomArchiveUnique(base, existants) {
    const pris = new Set(existants || []);
    let nom = `${base}.json`;
    for (let i = 1; pris.has(nom); i++) nom = `${base}-${i}.json`;
    return nom;
}

function _json(getItem, key) {
    try {
        const raw = getItem(key);
        return raw === null || raw === undefined ? null : JSON.parse(raw);
    } catch {
        return null;
    }
}
const _estObjet = v => v !== null && typeof v === 'object' && !Array.isArray(v);

export function lireEtudesLocales(getItem) {
    const brut = _json(getItem, 'investissementWebAssetRecords');
    return Array.isArray(brut) ? brut.filter(_estObjet) : [];
}

export function lireAnalyseLocale(getItem) {
    const variablesData = _json(getItem, 'investissementWebVariablesData');
    if (!_estObjet(variablesData)) return null;
    const active = getItem('investissementWebActiveAssetId');
    return { variablesData, activeAssetId: typeof active === 'string' && active ? active : null };
}

// Clés d'interface de l'ancien localStorage → document settings/prefs. Clé absente → omise (la valeur
// par défaut s'applique côté app sans jamais être écrite).
export function lirePrefsLocales(getItem) {
    const prefs = {};
    const theme = getItem('investissementWebTheme');
    if (theme === 'light' || theme === 'dark') prefs.theme = theme;
    const screens = getItem('investissementWebScreens');
    if (screens === '1' || screens === '2') prefs.screens = Number(screens);
    const preset = getItem('investissementWebProfile');
    if (typeof preset === 'string' && preset) prefs.profilePreset = preset;
    const guided = getItem('investissementWebGuidedMode');
    if (guided === 'true' || guided === 'false') prefs.guidedMode = guided === 'true';
    const sparkMode = getItem('investissementWebSparkMode');
    if (sparkMode === 'guided' || sparkMode === 'full') prefs.sparkMode = sparkMode;
    const tuto = getItem('sparkTutoStep');
    if (tuto !== null && Number.isInteger(Number(tuto))) prefs.tutoStep = Number(tuto);
    const view = getItem('investissementWebAnalysisView');
    if (view === 'quick' || view === 'full') prefs.analysisView = view;
    const compact = getItem('investissementWebOwnedCompact');
    if (compact === '1' || compact === '0') prefs.ownedCompact = compact === '1';
    const sort = _json(getItem, 'investissementWebOwnedSort');
    if (_estObjet(sort)) prefs.ownedSort = sort;
    for (const [cle, locale] of [['ownedYearFilters', 'investissementWebOwnedYearFilters'], ['ownedPieYear', 'investissementWebOwnedPieYear'], ['ownedPieMonth', 'investissementWebOwnedPieMonth']]) {
        const v = _json(getItem, locale);
        if (_estObjet(v)) prefs[cle] = v;
    }
    const lastAsset = getItem('spark:factures:lastAsset');
    if (typeof lastAsset === 'string' && lastAsset) prefs.facturesLastAsset = lastAsset;
    return prefs;
}

export function lireProfilLocal(getItem) {
    const profil = _json(getItem, 'investissementWebProfileData');
    return { profil: _estObjet(profil) ? profil : null, configure: getItem('investissementWebProfileConfigured') === '1' };
}

// Ancien portefeuille local (régime, ordre, objectifs) : à ne pousser que si portfolioMeta ne les a pas.
export function lireMetaLocale(getItem) {
    const meta = {};
    const regime = getItem('investissementWebOwnedRegime');
    if (typeof regime === 'string' && regime) meta.regime = regime;
    const order = _json(getItem, 'investissementWebOwnedOrder');
    if (Array.isArray(order)) meta.order = order;
    const goals = _json(getItem, 'investissementWebPortfolioGoals');
    if (_estObjet(goals)) meta.goals = goals;
    return meta;
}
```

- [ ] **Étape 4 : Lancer, vérifier le succès**

Run: `node tests/test_migration_regles.mjs`
Expected: `test_migration_regles: OK`. Puis `npm test` → 13 fichiers verts.

- [ ] **Étape 5 : CODEBASE_MAP + commit**

Ajouter `## migration-regles.js` dans `CODEBASE_MAP.md` (rôle + une puce par export, 5 mots chacune).

```bash
git add migration-regles.js tests/test_migration_regles.mjs CODEBASE_MAP.md
git commit -m "feat(migration): regles pures (etude la plus recente, comparaison, lecture du stockage local)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Tâche 2 : `cloud-store.js` + ajouts `owned-cloud.js`

**Files:**
- Create: `cloud-store.js`
- Modify: `owned-cloud.js` (imports Firestore/Storage + 3 fonctions), `CODEBASE_MAP.md`

**Interfaces:**
- Consumes: `auth`, `db`, `storage` de `firebase-init.js` (inchangé).
- Produces: tous les exports de `cloud-store.js` et `cloudGetMeta`/`cloudGetAllAssets`/`cloudDocumentExists` (voir « Contrats partagés »). Ces modules importent le SDK depuis le CDN : pas de test Node possible, ils sont exercés par les stubs Playwright (même interface) et vérifiés ici par `node --check`.

- [ ] **Étape 1 : Écrire `cloud-store.js`** (Write)

```js
// Couche cloud des données hors portefeuille (Firebase Firestore + Storage) : études du comparateur,
// réglages (étude en cours, préférences d'interface, marqueur de migration) et archives JSON du
// portefeuille. Wrapper fin, même esprit qu'owned-cloud.js : aucune logique métier ici. Importé par
// main.js, owned-portfolio.js et migration-locale.js. Tout vit sous users/{uid}/ (règles
// firestore.rules / storage.rules inchangées). Voir docs/superpowers/specs/2026-10-11-passage-tout-web-prompt.md.
import { auth, db, storage } from './firebase-init.js';
import {
    collection, doc, onSnapshot, setDoc, deleteDoc, getDoc, getDocs
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import {
    ref, uploadBytes, listAll, getBlob, getMetadata
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-storage.js';

function requireUid() {
    const user = auth.currentUser;
    if (!user) throw new Error('not_authenticated');
    return user.uid;
}

// ─── studies : une étude du comparateur par document ─────────────────────────
// Forme : { id, variablesData, createdAt, updatedAt } (sanitizeAssetRecord, main.js).

export function watchStudies(onChange, onError) {
    const uid = requireUid();
    return onSnapshot(collection(db, 'users', uid, 'studies'), snap => {
        const map = {};
        snap.forEach(d => { map[d.id] = d.data(); });
        onChange(map);
    }, onError);
}

export function cloudSetStudy(id, record) {
    return setDoc(doc(db, 'users', requireUid(), 'studies', id), record);
}

export function cloudDeleteStudy(id) {
    return deleteDoc(doc(db, 'users', requireUid(), 'studies', id));
}

// Lecture ponctuelle (migration : fusion puis relecture de contrôle), pas un abonnement.
export async function cloudGetAllStudies() {
    const snap = await getDocs(collection(db, 'users', requireUid(), 'studies'));
    const map = {};
    snap.forEach(d => { map[d.id] = d.data(); });
    return map;
}

// ─── settings/{analysis|prefs|migration} ─────────────────────────────────────

export function watchAnalysis(onChange, onError) {
    const uid = requireUid();
    return onSnapshot(doc(db, 'users', uid, 'settings', 'analysis'), snap => {
        onChange(snap.exists() ? snap.data() : null);
    }, onError);
}

export function cloudSaveAnalysis(patch) {
    return setDoc(doc(db, 'users', requireUid(), 'settings', 'analysis'), patch, { merge: true });
}

// {} tant que le document n'existe pas : chaque clé absente garde sa valeur par défaut côté app,
// sans jamais être écrite (voir main.js / owned-portfolio.js).
export function watchPrefs(onChange, onError) {
    const uid = requireUid();
    return onSnapshot(doc(db, 'users', uid, 'settings', 'prefs'), snap => {
        onChange(snap.exists() ? snap.data() : {});
    }, onError);
}

export function savePref(patch) {
    return setDoc(doc(db, 'users', requireUid(), 'settings', 'prefs'), patch, { merge: true });
}

export async function cloudGetSetting(name) {
    const snap = await getDoc(doc(db, 'users', requireUid(), 'settings', name));
    return snap.exists() ? snap.data() : null;
}

export function cloudSetSetting(name, data, { merge = true } = {}) {
    return setDoc(doc(db, 'users', requireUid(), 'settings', name), data, { merge });
}

// ─── Archives JSON du portefeuille : Storage users/{uid}/archives/ ───────────
// Remplace le dossier exports/ de l'ancien server.py (export → copie cloud, import → liste).

function _archiveRef(filename) {
    return ref(storage, `users/${requireUid()}/archives/${filename}`);
}

export async function cloudUploadArchive(filename, blobOrText) {
    const blob = blobOrText instanceof Blob ? blobOrText : new Blob([String(blobOrText)], { type: 'application/json' });
    await uploadBytes(_archiveRef(filename), blob, { contentType: 'application/json' });
}

export async function cloudListArchives() {
    const { items } = await listAll(ref(storage, `users/${requireUid()}/archives`)).catch(() => ({ items: [] }));
    const metas = await Promise.all(items.map(item => getMetadata(item).catch(() => null)));
    return items
        .map((item, i) => ({ name: item.name, size: metas[i]?.size ?? null, updated: metas[i]?.updated ?? null }))
        .sort((a, b) => b.name.localeCompare(a.name));
}

export async function cloudReadArchive(filename) {
    const blob = await getBlob(_archiveRef(filename));
    return JSON.parse(await blob.text());
}

export async function cloudArchiveMeta(filename) {
    try {
        const meta = await getMetadata(_archiveRef(filename));
        return { size: meta.size, updated: meta.updated };
    } catch (err) {
        if (err?.code === 'storage/object-not-found') return null;
        throw err;
    }
}
```

- [ ] **Étape 2 : Compléter `owned-cloud.js`** (Edit)

Import Firestore : ajouter `getDocs` ; import Storage : ajouter `getMetadata`. Puis, juste après `cloudSaveMeta` :

```js
// Lectures ponctuelles réservées à la migration locale → cloud (migration-locale.js) : état cloud
// avant fusion, et liste des biens pour retrouver les justificatifs à téléverser.
export async function cloudGetMeta() {
    const snap = await getDoc(doc(db, 'users', requireUid(), 'portfolioMeta', 'main'));
    return snap.exists() ? snap.data() : {};
}

export async function cloudGetAllAssets() {
    const snap = await getDocs(collection(db, 'users', requireUid(), 'ownedAssets'));
    const map = {};
    snap.forEach(d => { map[d.id] = d.data(); });
    return map;
}
```

et après `cloudDocumentUrl` :

```js
export async function cloudDocumentExists(assetId, filename) {
    try {
        await getMetadata(ref(storage, `users/${requireUid()}/documents/${assetId}/${filename}`));
        return true;
    } catch (err) {
        if (err?.code === 'storage/object-not-found') return false;
        throw err;
    }
}
```

- [ ] **Étape 3 : Vérifier la syntaxe**

Run: `node --check cloud-store.js && node --check owned-cloud.js && echo OK`
Expected: `OK`.

- [ ] **Étape 4 : CODEBASE_MAP + commit**

Ajouter `## cloud-store.js` (rôle + une puce par export) ; dans `## owned-cloud.js`, ajouter les 3 nouvelles fonctions et remplacer « seul importeur » par « importé par owned-portfolio.js, main.js (watchAuth, watchPortfolioMeta) et migration-locale.js ».

```bash
git add cloud-store.js owned-cloud.js CODEBASE_MAP.md
git commit -m "feat(cloud): cloud-store.js (etudes, reglages, archives) + lectures ponctuelles owned-cloud

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Tâche 3 : Impression sans serveur — `openPrintDocument` (Shadow DOM) + harnais Playwright

**Files:**
- Modify: `utils.js:151-177`, `styles.css:6232-6237`, `owned-portfolio.js` (bloc 1432-1554 : `IS_LOCAL_APP`, `printAssetReportInPage`, `_cleanupAssetReportPrint`, `exportAssetReportMarkdown`), `CODEBASE_MAP.md`
- Create: `tests/playwright/_harness.mjs`, `tests/playwright/tout-web.mjs` (premier scénario : impression)

**Interfaces:**
- Consumes: `buildDecisionPrintDocument`/`buildBankDossierPrintDocument` (pdf.js) et `buildAssetReportHTML` (rapport-bien.js) renvoient `{ documentHTML, filename }` — documents HTML autonomes (`<style>` inline, `<body class="…">`, éventuel `<script>` d'auto-impression hérité, à ignorer).
- Produces: `openPrintDocument(documentHTML, filename, triggerBtnId)` (même signature), `cssPourShadow(css)`, `_downloadOrShareFile(file, title)` (owned-portfolio.js, réutilisé par l'export JSON en Tâche 9), le harnais de test partagé.

- [ ] **Étape 1 : Écrire le harnais partagé** (Write `tests/playwright/_harness.mjs`)

```js
// Harnais commun des tests navigateur : stubs des deux modules cloud (owned-cloud.js, cloud-store.js),
// espion localStorage/sessionStorage, ouverture de page avec collecte des erreurs. Les stubs exportent
// TOUTES les fonctions du module réel (un export manquant casse l'import du module sans erreur claire).
import assert from 'node:assert/strict';

export const BASE = process.env.SPARK_TEST_BASE || 'http://127.0.0.1:8090';

export const ASSET_TEST_1 = {
    id: 'oa-test-1', nom: 'Rue des Lilas', ville: 'Bourges', codePostal: '18000', adresse: '',
    lat: null, lng: null, dateAchat: '2024-03',
    acquisition: { prix: 120000, fraisAgence: 0, fraisNotaire: 9000, loyerInitial: 650, surface: 45, typeBien: 'appartement',
        credit: { montant: 100000, duree: 20, taux: 3.2, assurance: 0.3, assuranceMode: 'initial' } },
    postAchat: { taxeFonciere: 800, chargesCopro: 0, gestionLocative: 0, assurancePNO: 120,
        travaux: [{ id: 't-1', date: '2026-08-28', description: 'Parquet chambre', montant: 890, tag: 'deductible', commentaire: '', pdfFilename: 'facture-1.pdf', credit: null, financeParCredit: false }],
        notes: [] },
    scenarios: [
        { id: 'pessimiste', nom: 'Pessimiste', variables: { vacance: 8, regime: 'micro-foncier' } },
        { id: 'realiste', nom: 'Réaliste', variables: { vacance: 5, regime: 'micro-foncier' } },
        { id: 'optimiste', nom: 'Optimiste', variables: { vacance: 2, regime: 'micro-foncier' } }
    ],
    diagnosticHistory: []
};
export const META_TEST = {
    order: ['oa-test-1'], regime: 'micro-foncier',
    profile: { name: 'Test', income: 40000, adults: 1, children: 0, revenuHistorique: [], objectifCF: 1000, revaloAnnuelle: 2, autresCredits: [] }
};

// Stub d'owned-cloud.js. Seed via window.__seedCloud = { assets, meta, user } (addInitScript) :
// user: null → déconnecté (cloudSignIn connecte). window.__stub expose l'état pour les assertions.
export const OWNED_CLOUD_STUB_SOURCE = `
const seed = window.__seedCloud || {};
const S = window.__stub = {
    assets: seed.assets || {}, meta: seed.meta || {},
    user: seed.user === undefined ? { uid: 'u-test', email: 'test@example.com' } : seed.user,
    documents: seed.documents || {},            // { 'assetId/filename': true }
    authListeners: [], assetListeners: [], metaListeners: [],
    uploads: [], uploadsAs: [], signIns: [], metaWrites: []
};
const clone = v => JSON.parse(JSON.stringify(v));
const later = fn => setTimeout(fn, 0);
export function watchAuth(cb) { S.authListeners.push(cb); later(() => cb(S.user)); return () => {}; }
export async function cloudSignIn(email, password) {
    S.signIns.push({ email, password });
    if (password === 'mauvais') { const e = new Error('auth/wrong-password'); e.code = 'auth/wrong-password'; throw e; }
    S.user = { uid: 'u-test', email };
    S.authListeners.forEach(cb => cb(S.user));
}
export async function cloudSignOut() { S.user = null; S.authListeners.forEach(cb => cb(null)); }
export async function cloudChangePassword() { return { relogged: true }; }
export function watchOwnedAssets(cb) { S.assetListeners.push(cb); later(() => cb(clone(S.assets))); return () => {}; }
export function cloudSetAsset(id, data) { S.assets[id] = clone(data); later(() => S.assetListeners.forEach(cb => cb(clone(S.assets)))); return Promise.resolve(); }
export function cloudDeleteAssetDoc(id) { delete S.assets[id]; later(() => S.assetListeners.forEach(cb => cb(clone(S.assets)))); return Promise.resolve(); }
export function watchPortfolioMeta(cb) { S.metaListeners.push(cb); later(() => cb(clone(S.meta))); return () => {}; }
export function cloudSaveMeta(patch) { S.metaWrites.push(clone(patch)); Object.assign(S.meta, clone(patch)); later(() => S.metaListeners.forEach(cb => cb(clone(S.meta)))); return Promise.resolve(); }
export async function cloudGetMeta() { return clone(S.meta); }
export async function cloudGetAllAssets() { return clone(S.assets); }
export async function cloudUploadDocument(assetId, file) { const name = 'up-' + (S.uploads.length + 1) + '-' + file.name; S.uploads.push({ assetId, name, type: file.type, size: file.size }); S.documents[assetId + '/' + name] = true; return name; }
export async function cloudUploadDocumentAs(assetId, filename, blob) { S.uploadsAs.push({ assetId, filename, size: blob.size }); S.documents[assetId + '/' + filename] = true; }
export async function cloudDocumentExists(assetId, filename) { return !!S.documents[assetId + '/' + filename]; }
export function cloudDocumentUrl() { return Promise.resolve('data:application/pdf;base64,JVBERi0xLjQK'); }
export async function cloudDeleteDocument() {}
export async function cloudDeleteAllDocuments() {}
export async function cloudExtraireFraisFacture() { return { fournisseur: '', description: '', montant: 0, date: '', tagSuggestion: 'a-classifier', confiance: 'basse' }; }
export async function cloudExtraireDossierBien() { throw new Error('not stubbed'); }
export async function cloudDiagnosticPortefeuille() { return { recommendations: [] }; }
export async function cloudChatPortefeuille() { return { reply: '' }; }
export async function cloudGeocode() { return { lat: null, lng: null }; }
`;

// Stub de cloud-store.js. Seed via window.__seedStore = { studies, settings, archives, failUploadArchive,
// corruptStudiesRead }. window.__store.writes journalise chaque écriture (règle « rien n'est écrit au chargement »).
export const CLOUD_STORE_STUB_SOURCE = `
const seed = window.__seedStore || {};
const S = window.__store = {
    studies: seed.studies || {}, settings: seed.settings || {}, archives: seed.archives || {},
    failUploadArchive: !!seed.failUploadArchive, corruptStudiesRead: !!seed.corruptStudiesRead,
    listeners: { studies: [], analysis: [], prefs: [] }, writes: [],
    dump() { return JSON.parse(JSON.stringify({ studies: this.studies, settings: this.settings, archives: this.archives })); }
};
const clone = v => JSON.parse(JSON.stringify(v));
const notify = (k, v) => setTimeout(() => S.listeners[k].forEach(cb => cb(clone(v))), 0);
export function watchStudies(cb) { S.listeners.studies.push(cb); setTimeout(() => cb(clone(S.studies)), 0); return () => {}; }
export function cloudSetStudy(id, data) { S.writes.push(['study', id]); S.studies[id] = clone(data); notify('studies', S.studies); return Promise.resolve(); }
export function cloudDeleteStudy(id) { S.writes.push(['deleteStudy', id]); delete S.studies[id]; notify('studies', S.studies); return Promise.resolve(); }
export async function cloudGetAllStudies() { const m = clone(S.studies); if (S.corruptStudiesRead) for (const id in m) m[id].updatedAt = 1; return m; }
export function watchAnalysis(cb) { S.listeners.analysis.push(cb); setTimeout(() => cb(S.settings.analysis ? clone(S.settings.analysis) : null), 0); return () => {}; }
export function cloudSaveAnalysis(patch) { S.writes.push(['analysis']); S.settings.analysis = { ...(S.settings.analysis || {}), ...clone(patch) }; notify('analysis', S.settings.analysis); return Promise.resolve(); }
export function watchPrefs(cb) { S.listeners.prefs.push(cb); setTimeout(() => cb(clone(S.settings.prefs || {})), 0); return () => {}; }
export function savePref(patch) { S.writes.push(['prefs', Object.keys(patch).join(',')]); S.settings.prefs = { ...(S.settings.prefs || {}), ...clone(patch) }; notify('prefs', S.settings.prefs); return Promise.resolve(); }
export async function cloudGetSetting(name) { return S.settings[name] ? clone(S.settings[name]) : null; }
export async function cloudSetSetting(name, data, { merge = true } = {}) { S.writes.push(['setting', name]); S.settings[name] = merge ? { ...(S.settings[name] || {}), ...clone(data) } : clone(data); if (S.listeners[name]) notify(name, S.settings[name]); }
export async function cloudUploadArchive(name, blobOrText) { if (S.failUploadArchive) { const e = new Error('storage/retry-limit-exceeded'); e.code = 'storage/retry-limit-exceeded'; throw e; } S.writes.push(['archive', name]); S.archives[name] = typeof blobOrText === 'string' ? blobOrText : await blobOrText.text(); }
export async function cloudListArchives() { return Object.keys(S.archives).sort().reverse().map(name => ({ name, size: S.archives[name].length, updated: '2026-10-11T10:00:00.000Z' })); }
export async function cloudReadArchive(name) { if (!(name in S.archives)) { const e = new Error('storage/object-not-found'); e.code = 'storage/object-not-found'; throw e; } return JSON.parse(S.archives[name]); }
export async function cloudArchiveMeta(name) { return name in S.archives ? { size: S.archives[name].length, updated: '2026-10-11T10:00:00.000Z' } : null; }
`;

// Espion : tout accès à localStorage/sessionStorage est journalisé avec sa pile. Le SDK Firebase
// n'est jamais chargé dans ces tests (modules cloud stubbés), donc la liste doit rester vide.
export const STORAGE_SPY_SCRIPT = `
window.__storageHits = [];
for (const name of ['localStorage', 'sessionStorage']) {
    let real; try { real = window[name]; } catch { real = undefined; }
    Object.defineProperty(window, name, { configurable: true, get() {
        window.__storageHits.push(name + ' ← ' + (new Error().stack || '').split('\\n').slice(2, 5).join(' | '));
        return real;
    } });
}`;

// Espion d'impression : window.print() ne peut pas s'exécuter en headless ; on capture le titre du
// document et le contenu du Shadow DOM d'impression au moment de l'appel, puis on émet afterprint.
export const PRINT_SPY_SCRIPT = `
window.__prints = [];
window.print = () => {
    const host = document.getElementById('spark-print-root');
    window.__prints.push({
        title: document.title,
        hostCount: document.querySelectorAll('#spark-print-root').length,
        printing: document.body.classList.contains('spark-printing'),
        text: (host?.shadowRoot?.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 400),
        hasPageRule: !!document.getElementById('spark-print-page')
    });
    setTimeout(() => window.dispatchEvent(new Event('afterprint')), 0);
};`;

// initScripts : [[fn, arg], …] posés AVANT la première navigation (ex. ancien localStorage du test de migration).
export async function openPage(browser, path, { viewport, seedCloud = {}, seedStore = {}, spyStorage = true, routes = [], initScripts = [] } = {}) {
    const context = await browser.newContext({ viewport, acceptDownloads: true });
    await context.addInitScript(`window.__seedCloud = ${JSON.stringify({ assets: { 'oa-test-1': ASSET_TEST_1 }, meta: META_TEST, ...seedCloud })};`);
    await context.addInitScript(`window.__seedStore = ${JSON.stringify(seedStore)};`);
    if (spyStorage) await context.addInitScript(STORAGE_SPY_SCRIPT);
    await context.addInitScript(PRINT_SPY_SCRIPT);
    for (const [fn, arg] of initScripts) await context.addInitScript(fn, arg);
    await context.route('**/owned-cloud.js', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: OWNED_CLOUD_STUB_SOURCE }));
    await context.route('**/cloud-store.js', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: CLOUD_STORE_STUB_SOURCE }));
    for (const [pattern, handler] of routes) await context.route(pattern, handler);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', err => errors.push(`pageerror: ${err.message}`));
    page.on('console', msg => { if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`); });
    await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
    return { page, context, errors };
}

// Rechargement « persistant » : le stub vit en mémoire de page, on réinjecte son état comme seed.
export async function reloadWithStore(page, context) {
    const dump = await page.evaluate(() => window.__store.dump());
    await context.addInitScript(`window.__seedStore = ${JSON.stringify(dump)};`);
    await page.reload({ waitUntil: 'load' });
}

export const waitAppStarted = page => page.waitForSelector('#app-cloud-loading[hidden]', { timeout: 10000 });

let failures = 0;
export async function step(name, fn) {
    try { await fn(); console.log(`  ✓ ${name}`); }
    catch (err) { failures++; console.log(`  ✗ ${name}\n      ${String(err.message).split('\n').slice(0, 14).join('\n      ')}`); }
}
export const getFailures = () => failures;
export { assert };
```

- [ ] **Étape 2 : Écrire le premier scénario (impression) qui échoue** (Write `tests/playwright/tout-web.mjs`)

```js
// Tests navigateur (Playwright) de la version 100 % web — voir
// docs/superpowers/specs/2026-10-11-passage-tout-web-prompt.md, <verification>.
// Prérequis : `node scripts/serve-static.mjs 8090` lancé, `npm install`, `npx playwright install chromium`.
// Lancer : SPARK_TEST_BASE=http://127.0.0.1:8090 node tests/playwright/tout-web.mjs
// TW_SCREENSHOTS=<dir> enregistre des captures PNG. Hors `npm test` volontairement (serveur + navigateur).
import { chromium } from 'playwright';
import { assert, openPage, reloadWithStore, waitAppStarted, step, getFailures } from './_harness.mjs';

const SHOTS = process.env.TW_SCREENSHOTS || '';
const shot = (page, name) => SHOTS ? page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false }) : Promise.resolve();
const PC = { width: 1366, height: 900 };
const IPHONE = { width: 393, height: 852 };

async function scenarioImpression(browser, viewport, label) {
    console.log(`\nImpression — ${label}`);
    const { page, context, errors } = await openPage(browser, '/index.html', { viewport, spyStorage: false });
    await waitAppStarted(page);

    await step('PDF décision : window.print sur un Shadow DOM titré d après le fichier', async () => {
        await page.fill('#variables-form [name="prix"]', '150000');
        await page.fill('#variables-form [name="loyer"]', '750');
        await page.click('#export-decision-pdf');
        await page.waitForFunction(() => window.__prints.length === 1, null, { timeout: 8000 });
        const p = await page.evaluate(() => window.__prints[0]);
        assert.equal(p.hostCount, 1);
        assert.equal(p.printing, true);
        assert.doesNotMatch(p.title, /\.pdf$/i);
        assert.ok(p.title.length > 3, `titre vide : ${p.title}`);
        assert.match(p.text, /Spark|décision|Décision/i);
        assert.equal(p.hasPageRule, true, '@page hissé dans le document');
        await page.waitForFunction(() => !document.getElementById('spark-print-root'));
        assert.equal(await page.title(), 'Spark Investissement | Analyse locative', 'titre restauré après afterprint');
    });

    await step('deux impressions successives → jamais deux hôtes', async () => {
        // Impressions sans afterprint (navigateur mobile capricieux) : on neutralise l'événement
        await page.evaluate(() => { const orig = window.print; window.print = () => { const h = document.getElementById('spark-print-root'); window.__prints.push({ hostCount: document.querySelectorAll('#spark-print-root').length, title: document.title, text: (h?.shadowRoot?.textContent || '').slice(0, 50) }); }; window.__restorePrint = orig; });
        await page.click('#export-decision-pdf');
        await page.waitForFunction(() => window.__prints.length === 2);
        await page.click('#export-decision-pdf');
        await page.waitForFunction(() => window.__prints.length === 3);
        const last = await page.evaluate(() => window.__prints[2]);
        assert.equal(last.hostCount, 1, 'l hôte précédent est nettoyé au nouvel appel');
        await page.evaluate(() => { window.print = window.__restorePrint; window.dispatchEvent(new Event('afterprint')); });
    });

    await step('dossier bancaire (PC) et rapport d un bien → print avec le bon titre', async () => {
        await page.click('.workspace-tab[data-target="collection-panel"]');
        await page.locator('[data-open-asset="oa-test-1"], [data-asset-id="oa-test-1"]').first().click();
        await page.waitForSelector('#owned-detail-view:not([hidden])');
        const before = await page.evaluate(() => window.__prints.length);
        if (viewport.width > 600) {
            await page.click('#owned-bank-dossier-btn');
            await page.waitForSelector('#owned-bank-dossier-modal:not([hidden])');
            await page.click('#bank-dossier-next');
            await page.click('#bank-dossier-generate');
            await page.waitForFunction(n => window.__prints.length === n + 1, before, { timeout: 8000 });
            const p = await page.evaluate(() => window.__prints.at(-1));
            assert.match(p.text, /Dossier bancaire/);
            assert.match(p.title, /ossier/);
        }
        const before2 = await page.evaluate(() => window.__prints.length);
        await page.click('#owned-report-btn');
        await page.waitForSelector('#asset-report-overlay');
        await page.click('#asset-report-pdf');
        await page.waitForFunction(n => window.__prints.length === n + 1, before2, { timeout: 8000 });
        const r = await page.evaluate(() => window.__prints.at(-1));
        assert.match(r.text, /Rue des Lilas/);
        assert.match(r.title, /lilas/i);
        await shot(page, `print-${label}`);
        await page.click('#asset-report-close');
    });

    await step('aucune erreur JS', () => assert.deepEqual(errors, []));
    await context.close();
}

const browser = await chromium.launch();
try {
    await scenarioImpression(browser, PC, 'PC');
    await scenarioImpression(browser, IPHONE, 'iPhone');
} finally {
    await browser.close();
}
console.log(getFailures() === 0 ? '\nOK — tous les scénarios passent' : `\nÉCHEC — ${getFailures()} étape(s) en erreur`);
process.exit(getFailures() === 0 ? 0 : 1);
```

Note : tant que `main.js` n'est pas migré (Tâches 5-6), `#app-cloud-loading` n'existe pas et `waitAppStarted` échoue : pour cette tâche, remplacer temporairement `await waitAppStarted(page);` par `await page.waitForSelector('#owned-quickfab:not([hidden])');` — on le rétablira en Tâche 5. Idem, `spyStorage: false` ici parce que `main.js` lit encore `localStorage` ; la Tâche 11 passera tout le fichier sous espion.

- [ ] **Étape 3 : Lancer, vérifier l'échec**

Run: `SPARK_TEST_BASE=http://127.0.0.1:8090 node tests/playwright/tout-web.mjs`
Expected: `✗ PDF décision` (timeout : `openPrintDocument` fait un `fetch('/api/generate-pdf')` → 404 → `window.alert`, aucun `window.print`). Si l'alerte bloque la page, c'est le symptôme attendu.

- [ ] **Étape 4 : Réécrire `openPrintDocument` dans `utils.js`** (Edit, remplacer tout le bloc lignes 151-177)

```js
// Impression d'un document HTML autonome (PDF décision, dossier bancaire, rapport d'un bien) sans
// serveur : le document est injecté dans la page elle-même, dans un Shadow DOM (son CSS reste isolé
// de styles.css), puis window.print() avec document.title = nom de fichier — c'est le nom proposé
// par « Enregistrer en PDF » sur PC et par la feuille de partage sur iPhone. Une iframe cachée
// aurait été plus directe, mais sur Safari iOS imprimer une iframe imprime la page parente
// (constaté sur le rapport d'un bien, dont on généralise ici la logique). Les <script> du document
// (auto-impression héritée de l'ancienne version popup) sont retirés : c'est nous qui imprimons.
// `triggerBtnId` (optionnel) : bouton dont le libellé bascule pendant la préparation.
const PRINT_ROOT_ID = 'spark-print-root';
let _printCleanup = null;

// Dans un Shadow DOM, les sélecteurs html/body ne matchent rien : rabattus sur le conteneur .print-root.
export function cssPourShadow(css) {
    return String(css)
        .replace(/(^|[^\w.#-])html\s*,\s*body(?![\w-])/g, '$1.print-root')
        .replace(/(^|[^\w.#-])(?:html|body)(?![\w-])/g, '$1.print-root');
}

export async function openPrintDocument(documentHTML, filename, triggerBtnId = null) {
    const btn = triggerBtnId ? document.getElementById(triggerBtnId) : null;
    const originalLabel = btn ? btn.textContent : null;
    if (btn) { btn.textContent = 'Préparation…'; btn.disabled = true; }
    try {
        _printCleanup?.(); // un hôte précédent sans afterprint (navigateurs mobiles) ne doit pas s'accumuler
        const parsed = new DOMParser().parseFromString(documentHTML, 'text/html');
        parsed.querySelectorAll('script').forEach(s => s.remove());
        const css = Array.from(parsed.querySelectorAll('style')).map(s => s.textContent).join('\n');
        // @page ne s'applique pas depuis un Shadow DOM : hissé dans le document le temps de l'impression.
        const pageStyle = document.createElement('style');
        pageStyle.id = 'spark-print-page';
        pageStyle.textContent = (css.match(/@page[^{]*\{[^}]*\}/g) || []).join('\n');
        const host = document.createElement('div');
        host.id = PRINT_ROOT_ID;
        host.attachShadow({ mode: 'open' }).innerHTML =
            `<style>${cssPourShadow(css)}</style><div class="print-root ${parsed.body.className}">${parsed.body.innerHTML}</div>`;
        document.head.appendChild(pageStyle);
        document.body.appendChild(host);
        document.body.classList.add('spark-printing');
        const previousTitle = document.title;
        document.title = String(filename || 'document').replace(/\.pdf$/i, '');
        _printCleanup = () => {
            document.body.classList.remove('spark-printing');
            host.remove();
            pageStyle.remove();
            document.title = previousTitle;
            window.removeEventListener('afterprint', _printCleanup);
            _printCleanup = null;
        };
        // Pas de nettoyage sur minuteur : certains navigateurs mobiles rendent la main avant que la
        // feuille d'impression ait lu la page — retirer l'hôte trop tôt donnerait un PDF vide.
        window.addEventListener('afterprint', _printCleanup);
        await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 50)));
        window.print();
    } catch (err) {
        showToast(`Impression impossible : ${err.message}`, 'negative');
    } finally {
        if (btn) { btn.textContent = originalLabel; btn.disabled = false; }
    }
}
```

- [ ] **Étape 5 : Renommer les classes d'impression dans `styles.css`** (Edit, lignes 6232-6237)

```css
#spark-print-root { display: none; }
@media print {
    body.spark-printing { background: #fff !important; padding: 0 !important; margin: 0 !important; }
    body.spark-printing > *:not(#spark-print-root) { display: none !important; }
    body.spark-printing #spark-print-root { display: block; }
}
```

- [ ] **Étape 6 : Simplifier `owned-portfolio.js`** (Edit)

1. Supprimer la constante `IS_LOCAL_APP` (ligne 1440) et réécrire le commentaire 1432-1439 :
```js
// ─── RAPPORT D'UN BIEN (aperçu → PDF / .md) ──────────────────────────────────
// Contenu construit par rapport-bien.js (module pur). Aperçu plein écran dans une iframe, puis :
//  - PDF : openPrintDocument (utils.js) — impression de la page avec le seul rapport visible
//          (PC : « Enregistrer en PDF » ; iPhone : Partager → Enregistrer dans Fichiers) ;
//  - .md : téléchargement (PC) ou feuille de partage iOS (écran tactile — un lien blob ne marche
//          pas en mode « écran d'accueil ») via _downloadOrShareFile ;
//  - Copier : presse-papiers, pour coller directement dans une IA.
```
2. Dans `openAssetReportPreview` : `close` ne contient plus `_cleanupAssetReportPrint?.();` ; le handler `#asset-report-pdf` devient `openPrintDocument(report.documentHTML, report.filename, 'asset-report-pdf');`.
3. Supprimer entièrement `printAssetReportInPage` et `let _cleanupAssetReportPrint = null;` (lignes 1493-1519).
4. Remplacer `exportAssetReportMarkdown` par :
```js
async function exportAssetReportMarkdown(markdown, filename, nomBien) {
    await _downloadOrShareFile(new File([markdown], filename, { type: 'text/markdown' }), `Rapport — ${nomBien}`);
}

// Remet un fichier à l'utilisateur : feuille de partage sur écran tactile (iOS, où un lien blob ne
// télécharge rien en mode écran d'accueil), téléchargement classique sinon. Partagé avec l'export
// JSON du portefeuille. À appeler dans le geste utilisateur (navigator.share l'exige).
async function _downloadOrShareFile(file, title) {
    if (window.matchMedia?.('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
        try {
            await navigator.share({ files: [file], title });
        } catch (err) {
            if (err?.name !== 'AbortError') showToast('Partage impossible, utilisez Copier', 'negative');
        }
        return;
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
```
5. `grep -n "IS_LOCAL_APP\|asset-report-printing\|_cleanupAssetReportPrint\|save-markdown" owned-portfolio.js styles.css` doit ne rien renvoyer.

- [ ] **Étape 7 : Lancer, vérifier le succès**

Run: `SPARK_TEST_BASE=http://127.0.0.1:8090 TW_SCREENSHOTS=<scratchpad>/shots node tests/playwright/tout-web.mjs`
Expected: `OK — tous les scénarios passent` (PC et iPhone). Ouvrir `print-PC.png` et `print-iPhone.png` (Read) : l'aperçu du rapport est visible, pas d'hôte d'impression visible à l'écran.

- [ ] **Étape 8 : CODEBASE_MAP + commit**

`## utils.js` : réécrire la puce `openPrintDocument` (Shadow DOM, plus de `/api/generate-pdf`) + ajouter `cssPourShadow`. `## owned-portfolio.js` : retirer la mention `IS_LOCAL_APP`/`printAssetReportInPage`, ajouter `_downloadOrShareFile`. `## styles.css` : `#spark-print-root`/`body.spark-printing`. Ajouter `## tests/playwright/_harness.mjs` et `## tests/playwright/tout-web.mjs`.

```bash
git add utils.js styles.css owned-portfolio.js tests/playwright/_harness.mjs tests/playwright/tout-web.mjs CODEBASE_MAP.md
git commit -m "feat(pdf): impression sans serveur (Shadow DOM) pour les 3 documents, PC et iPhone

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Tâche 4 : Gate de connexion global, indicateur de chargement, modale d'import, retrait de la bannière de migration

**Files:**
- Modify: `index.html:16-17` (début de body), `index.html:699` (`#owned-migration-banner`), `index.html:687-688` (titres des boutons), `index.html:833-844` (modale import), `owned.html:61`, `styles.css` (après `.owned-auth-gate__error`, ligne ~7509), `owned-portfolio.js:6307-6398` (`_renderAuthGate`, `_renderMigrationBanner`), `owned-portfolio.js:6436`, `CODEBASE_MAP.md`

**Interfaces:**
- Produces: `#app-auth-gate` et `#app-cloud-loading` (index.html, hors `.shell`), `renderAuthGateInto(gateEl, { title })` exporté par owned-portfolio.js, `#owned-import-file-input` dans la modale d'import. Consommés par main.js (Tâche 5) et l'import (Tâche 9).

- [ ] **Étape 1 : Test navigateur qui échoue** — ajouter dans `tests/playwright/tout-web.mjs`, avant `const browser = …` :

```js
async function scenarioConnexion(browser, viewport, label) {
    console.log(`\nConnexion — ${label}`);
    const { page, context, errors } = await openPage(browser, '/index.html', { viewport, seedCloud: { user: null }, spyStorage: false });

    await step('non connecté : gate plein écran sur index.html, rien d autre cliquable', async () => {
        await page.waitForSelector('#app-auth-gate:not([hidden]) form#owned-auth-form', { timeout: 8000 });
        assert.equal(await page.isVisible('#app-cloud-loading'), false, 'indicateur de chargement masqué tant que non connecté');
        const gateTitle = await page.$eval('#app-auth-gate h2', h => h.textContent);
        assert.match(gateTitle, /Connexion/);
        await shot(page, `gate-${label}`);
    });

    await step('mot de passe refusé → message, toujours sur le gate', async () => {
        await page.fill('#app-auth-gate [name="email"]', 'test@example.com');
        await page.fill('#app-auth-gate [name="password"]', 'mauvais');
        await page.click('#app-auth-gate button[type="submit"]');
        await page.waitForSelector('#app-auth-gate #owned-auth-error:not([hidden])');
        assert.equal(await page.isVisible('#app-auth-gate'), true);
    });

    await step('connexion → gate masqué, chargement puis application', async () => {
        await page.fill('#app-auth-gate [name="password"]', 'secret');
        await page.click('#app-auth-gate button[type="submit"]');
        await page.waitForSelector('#app-auth-gate[hidden]', { timeout: 8000 });
        await waitAppStarted(page);
        assert.deepEqual(await page.evaluate(() => window.__stub.signIns.map(s => s.email)), ['test@example.com', 'test@example.com']);
    });

    await step('aucune erreur JS', () => assert.deepEqual(errors, []));
    await context.close();

    console.log(`\nConnexion owned.html — ${label}`);
    const o = await openPage(browser, '/owned.html', { viewport, seedCloud: { user: null }, spyStorage: false });
    await step('owned.html non connecté → #owned-auth-gate visible', async () => {
        await o.page.waitForSelector('#owned-auth-gate:not([hidden]) form#owned-auth-form', { timeout: 8000 });
        assert.equal(await o.page.isVisible('#owned-list-view'), false);
    });
    await step('aucune erreur JS', () => assert.deepEqual(o.errors, []));
    await o.context.close();
}
```
et l'appeler dans le bloc principal : `await scenarioConnexion(browser, PC, 'PC'); await scenarioConnexion(browser, IPHONE, 'iPhone');` (avant les scénarios d'impression). Pour cette tâche, `waitAppStarted` doit encore être remplacé par `page.waitForSelector('#owned-quickfab:not([hidden])')` — main.js vient en Tâche 5.

Run: `SPARK_TEST_BASE=http://127.0.0.1:8090 node tests/playwright/tout-web.mjs`
Expected: `✗ non connecté : gate plein écran` (`#app-auth-gate` absent).

- [ ] **Étape 2 : `index.html`** (Edit)

a) Juste après `<body>` (ligne 16), avant `<div class="shell">` :
```html
    <!-- Connexion obligatoire pour toute l'app (main.js) : recouvre tout tant que Firebase Auth n'a pas de session -->
    <div id="app-auth-gate" class="app-auth-gate" hidden></div>
    <!-- Premier chargement des données cloud (≈ 0,5 s) : visible dès le HTML pour ne jamais montrer de valeurs par défaut -->
    <div id="app-cloud-loading" class="app-cloud-loading" role="status" aria-live="polite">
        <div class="app-cloud-loading__box">Chargement de vos données…</div>
    </div>
```
b) Supprimer la ligne `<div id="owned-migration-banner" hidden></div>` (ligne 699).
c) Boutons (lignes 687-688) : `title="Importer une archive (cloud ou fichier .json)"` et `title="Exporter le portefeuille en JSON (téléchargement + archive cloud)"`.
d) Modale d'import (lignes 833-844) :
```html
    <!-- Modal import portefeuille : archives Storage (bouton Export) ou fichier local -->
    <div id="owned-import-modal" class="owned-delete-modal" hidden aria-modal="true" role="dialog">
        <div class="owned-delete-modal__box">
            <h3>Importer un portefeuille</h3>
            <p>Archives enregistrées dans le cloud par le bouton « Export » :</p>
            <div id="owned-import-file-list" class="owned-import-file-list"></div>
            <label class="btn btn--ghost btn--sm owned-import-file-btn">Choisir un fichier…
                <input id="owned-import-file-input" type="file" accept=".json,application/json" hidden>
            </label>
            <p class="owned-import-note">Les biens importés seront ajoutés à votre portefeuille. Les biens existants avec le même identifiant ne seront pas écrasés.</p>
            <div class="owned-delete-modal__actions">
                <button id="owned-import-modal-cancel" class="btn btn--ghost" type="button">Annuler</button>
                <button id="owned-import-modal-confirm" class="btn btn--primary" type="button" disabled>Importer</button>
            </div>
        </div>
    </div>
```

- [ ] **Étape 3 : `owned.html`** (Edit) — supprimer la ligne 61 `<div id="owned-migration-banner" hidden></div>`.

- [ ] **Étape 4 : `styles.css`** (Edit, après `.owned-auth-gate__error`)

```css
/* Connexion obligatoire (index.html) et premier chargement cloud : recouvrent toute l'app. Au-dessus
   des modales (.owned-modal-overlay 1200, .document-preview-overlay 1300). */
.app-auth-gate, .app-cloud-loading {
    position: fixed; inset: 0; z-index: 1500;
    background: var(--bg);
    display: flex; justify-content: center; align-items: flex-start;
    overflow: auto; padding: 24px 16px;
}
.app-auth-gate[hidden], .app-cloud-loading[hidden] { display: none; }
.app-cloud-loading { align-items: center; }
.app-cloud-loading__box { font-size: .9rem; color: var(--text-secondary); letter-spacing: .02em; }
.owned-import-file-btn { align-self: flex-start; cursor: pointer; }
```

- [ ] **Étape 5 : `owned-portfolio.js`** (Edit)

a) Remplacer `_renderAuthGate` (lignes 6309-6349) par une version paramétrée, exportée :
```js
// Formulaire de connexion (compte unique PC + iPhone). Sert deux conteneurs : #owned-auth-gate dans
// le panneau Portefeuille (owned.html, et index.html hors onglet actif) et #app-auth-gate, le gate
// plein écran d'index.html géré par main.js — connexion obligatoire pour toute l'app depuis le
// passage au tout-web. Câblé une seule fois par conteneur (data-wired).
export function renderAuthGateInto(gate, { title = 'Connexion' } = {}) {
    if (!gate) return;
    if (!gate.innerHTML.trim()) {
        gate.innerHTML = `
            <div class="owned-auth-gate">
                <h2>${escapeHtml(title)}</h2>
                <p class="owned-auth-gate__hint">Un seul compte, partagé entre le PC et l'iPhone.</p>
                <form id="owned-auth-form" novalidate>
                    <label class="variables-field">
                        <span class="variables-label">Email</span>
                        <input class="variables-input" type="email" name="email" required autocomplete="username">
                    </label>
                    <label class="variables-field">
                        <span class="variables-label">Mot de passe</span>
                        <input class="variables-input" type="password" name="password" required autocomplete="current-password">
                    </label>
                    <div id="owned-auth-error" class="owned-auth-gate__error" hidden></div>
                    <button type="submit" class="btn btn--primary">Se connecter</button>
                </form>
            </div>`;
    }
    if (gate.dataset.wired) return;
    gate.dataset.wired = '1';
    gate.querySelector('#owned-auth-form')?.addEventListener('submit', async e => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const errEl = gate.querySelector('#owned-auth-error');
        const btn = e.target.querySelector('button[type="submit"]');
        if (errEl) errEl.hidden = true;
        if (btn) { btn.disabled = true; btn.textContent = 'Connexion…'; }
        try {
            await cloudSignIn(String(fd.get('email') || '').trim(), String(fd.get('password') || ''));
        } catch {
            if (errEl) { errEl.textContent = 'Email ou mot de passe incorrect.'; errEl.hidden = false; }
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = 'Se connecter'; }
        }
    });
}

function _renderAuthGate() {
    renderAuthGateInto(document.getElementById('owned-auth-gate'), { title: 'Portefeuille — Connexion' });
}
```
(supprimer `let _authGateWired = false;`).

b) Supprimer tout le bloc `// ─── MIGRATION PONCTUELLE …` + `_renderMigrationBanner` (lignes 6351-6398) et l'appel `_renderMigrationBanner();` dans `renderCollections` (ligne 6436). Retirer `cloudUploadDocumentAs` de l'import `owned-cloud.js` (ligne 28) s'il n'a plus d'usage (`grep -n cloudUploadDocumentAs owned-portfolio.js`).

- [ ] **Étape 6 : Vérifier**

Run: `node --check owned-portfolio.js && grep -c "owned-migration-banner" index.html owned.html owned-portfolio.js`
Expected: syntaxe OK, `0` partout. Le test Playwright échoue encore sur « connexion → gate masqué » (main.js pas encore branché) mais « owned.html non connecté → #owned-auth-gate visible » passe. Vérifier aussi que `index.html` affiche l'indicateur de chargement au premier rendu (`curl -s http://127.0.0.1:8090/index.html | grep -c app-cloud-loading` → `2`).

- [ ] **Étape 7 : CODEBASE_MAP + commit**

`## index.html` : ajouter `#app-auth-gate`/`#app-cloud-loading`, retirer `#owned-migration-banner`, décrire la nouvelle modale d'import. `## owned.html` : retirer la bannière. `## owned-portfolio.js` : `renderAuthGateInto` exportée, `_renderMigrationBanner` supprimée. `## styles.css` : `.app-auth-gate`/`.app-cloud-loading`/`.owned-import-file-btn`.

```bash
git add index.html owned.html styles.css owned-portfolio.js tests/playwright/tout-web.mjs CODEBASE_MAP.md
git commit -m "feat(auth): gate de connexion global + indicateur de chargement, fin de la banniere de migration locale

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Tâche 5 : `main.js` — démarrage cloud (auth, chargement, préférences, profil, version)

**Files:**
- Modify: `main.js` (imports l.1-6, `STORAGE_KEYS` l.36-52, `STORAGE_SYNC_KEYS` l.242, `state` l.247-270, loaders l.431-497, `saveProfileData` l.744, `applyTheme` l.1463-1478, `setProfileConfigured` l.1648-1651, `confirmProfileModal` l.1707-1711, `applyProfilePreset` l.1725-1732, mode guidé l.2345-2362, `handleScreenToggle` l.2533-2547, `bindEvents` thème l.2555-2560, vue analyse l.2675-2697, bootstrap l.2935-2996), `CODEBASE_MAP.md`

**Interfaces:**
- Consumes: `watchAuth`, `watchPortfolioMeta` (owned-cloud.js) ; `watchPrefs`, `savePref` (cloud-store.js) ; `renderAuthGateInto` (owned-portfolio.js) ; `#app-auth-gate`, `#app-cloud-loading` (index.html).
- Produces: `state.guidedMode`, `state.tutoStep`, `state.analysisView`, `state.facturesLastAsset` ; `_applyPrefs`, `_applyMeta`, `_startCloud`/`_stopCloud`/`_startApp`, `_cloudReady` (étendu par la Tâche 6 avec `studies`/`analysis`), `_authUser`. `initOwnedPortfolio` reçoit `{ state, nodes, IS_ANALYSIS_WINDOW, IS_MOBILE_PAGE: false }`.

- [ ] **Étape 1 : Test qui échoue** — ajouter dans `tout-web.mjs` :

```js
async function scenarioPreferences(browser, viewport, label) {
    console.log(`\nPréférences — ${label}`);
    const { page, context, errors } = await openPage(browser, '/index.html', { viewport, spyStorage: false });
    await waitAppStarted(page);

    await step('chargement : thème sombre par défaut, AUCUNE écriture cloud', async () => {
        assert.equal(await page.getAttribute('html', 'data-theme'), 'dark');
        await page.waitForTimeout(800);
        assert.deepEqual(await page.evaluate(() => window.__store.writes), [], 'rien ne doit être écrit au simple chargement');
        assert.deepEqual(await page.evaluate(() => window.__stub.metaWrites), [], 'ni dans portfolioMeta');
    });

    await step('version lue depuis le fichier VERSION', async () => {
        await page.waitForFunction(() => /^v\d+\.\d+\.\d+$/.test(document.getElementById('topbar-version').textContent), null, { timeout: 5000 });
    });

    await step('thème → settings/prefs.theme, conservé après rechargement', async () => {
        await page.click('#theme-toggle');
        await page.waitForFunction(() => window.__store.settings.prefs?.theme === 'light');
        await reloadWithStore(page, context);
        await waitAppStarted(page);
        assert.equal(await page.getAttribute('html', 'data-theme'), 'light');
    });

    await step('prefs seedées appliquées sans flash : vue analyse complète, saisie guidée', async () => {
        // guidedMode (tuto) n'a pas de DOM dédié dans index.html (#guided-toggle absent) : on vérifie sparkMode.
        await context.addInitScript(`window.__seedStore = ${JSON.stringify({ settings: { prefs: { theme: 'light', analysisView: 'full', sparkMode: 'guided', screens: 1 } } })};`);
        await page.reload({ waitUntil: 'load' });
        await waitAppStarted(page);
        assert.equal(await page.getAttribute('#analysis-panel', 'data-analysis-view'), 'full');
        assert.equal(await page.getAttribute('#mode-btn-guided', 'aria-pressed'), 'true');
        await page.waitForTimeout(500);
        assert.deepEqual(await page.evaluate(() => window.__store.writes), [], 'appliquer des prefs ne réécrit rien');
        await shot(page, `prefs-${label}`);
    });

    await step('profil cloud → TMI/profil affichés, pas de modale d onboarding', async () => {
        assert.equal(await page.isVisible('#profile-modal.open'), false);
        assert.match(await page.textContent('#topbar-profile-label'), /Test/);
    });

    await step('aucune erreur JS', () => assert.deepEqual(errors, []));
    await context.close();
}

async function scenarioOnboarding(browser) {
    console.log('\nOnboarding profil — PC');
    const { page, context, errors } = await openPage(browser, '/index.html', { viewport: PC, spyStorage: false, seedCloud: { meta: { order: ['oa-test-1'], regime: 'micro-foncier' } } });
    await waitAppStarted(page);
    await step('sans profil cloud → modale profil ouverte, Valider pousse portfolioMeta.profile', async () => {
        await page.waitForSelector('#profile-modal.open', { timeout: 5000 });
        await page.fill('#profile-income', '3000');
        await page.click('#profile-save');
        await page.waitForFunction(() => window.__stub.meta.profile && window.__stub.meta.profile.income === 36000);
        await page.waitForSelector('#profile-modal:not(.open)');
    });
    await step('aucune erreur JS', () => assert.deepEqual(errors, []));
    await context.close();
}
```
Appels dans le bloc principal : `await scenarioPreferences(browser, PC, 'PC'); await scenarioPreferences(browser, IPHONE, 'iPhone'); await scenarioOnboarding(browser);`. Rétablir `await waitAppStarted(page)` partout dans le fichier (fin du contournement `#owned-quickfab`).

Run: `SPARK_TEST_BASE=http://127.0.0.1:8090 node tests/playwright/tout-web.mjs`
Expected: échecs sur `waitAppStarted` (l'indicateur n'est jamais masqué par l'ancien main.js).

- [ ] **Étape 2 : Imports et constantes** (Edit `main.js`)

Ligne 5-6, ajouter :
```js
import { initOwnedPortfolio, initOwnedPortfolioEvents, renderCollections, syncProfileToCloud, invalidateOwnedMap, renderAuthGateInto } from './owned-portfolio.js';
import { watchAuth, watchPortfolioMeta } from './owned-cloud.js';
import { watchPrefs, savePref, watchStudies, cloudSetStudy, cloudDeleteStudy, watchAnalysis, cloudSaveAnalysis } from './cloud-store.js';
```
Supprimer le bloc `const STORAGE_KEYS = {…}` (l.36-52) et `const STORAGE_SYNC_KEYS = …` (l.242). Ajouter à leur place :
```js
// Migration unique depuis l'exe (origine http://127.0.0.1:8080, seule à pouvoir lire son localStorage) :
// le module n'est chargé que là, ou avec ?migration-locale=1 (tests). Supprimé en fin de chantier.
const MIGRATION_LOCALE_ACTIVE = (['127.0.0.1', 'localhost'].includes(location.hostname) && location.port === '8080')
    || new URLSearchParams(location.search).has('migration-locale');
```

- [ ] **Étape 3 : État initial sans `localStorage`** (Edit, remplacer `const initialProfilePreset …` et tout le bloc `const state = {…}` l.245-270)

```js
// Valeurs par défaut uniquement : les vraies valeurs arrivent par les snapshots Firestore (prefs,
// portfolioMeta, studies, settings/analysis) avant le premier render(), voir _startCloud/_startApp.
// Rien ici n'est jamais réécrit dans le cloud : seules les actions de l'utilisateur écrivent.
const state = {
    theme: 'dark',
    screens: 1,
    profilePreset: 'famille',
    profileData: createProfileData('famille'),
    profileConfigured: false,
    isProfileModalOpen: false,
    variablesData: sanitizeVariablesData(VARIABLE_DEFAULTS),
    assetRecords: [],
    activeAssetId: null,
    sparkMode: 'full',
    guidedMode: false,
    tutoStep: 0,
    analysisView: 'quick',
    guidedStepIndex: 0,
    analysisPopupBlocked: false,
    activeOwnedAssetId: null,
    ownedRegime: 'micro-foncier',
    ownedYearFilter: 1,
    ownedYearFilters: {},
    ownedOrder: [],
    ownedCompact: false,
    ownedSort: null,
    facturesLastAsset: null,
    ownedExpandedIds: new Set(),
};
```
Supprimer `loadTheme`, `loadScreens`, `loadProfilePreset`, `loadProfileConfigured`, `loadProfileData`, `loadVariablesData`, `loadSparkMode` (l.431-493) ; garder `getProfileOption`/`createProfileData`. `saveSparkMode(mode)` devient :
```js
function saveSparkMode(mode) {
    state.sparkMode = mode;
    savePref({ sparkMode: mode }).catch(() => {});
}
```
Supprimer `loadAssetRecords`/`loadActiveAssetId` (l.620-638) — la Tâche 6 branche les études.

- [ ] **Étape 4 : Préférences, profil, écritures** (Edit)

`saveProfileData()` (l.744-749) : le profil n'a plus de copie locale, `portfolioMeta.profile` est la source unique :
```js
function saveProfileData() {
    syncProfileToCloud();
}
```
`applyTheme()` : supprimer la ligne `localStorage.setItem(STORAGE_KEYS.theme, state.theme);`. Toggle thème dans `bindEvents` :
```js
    nodes.themeToggle.addEventListener('click', () => {
        state.theme = state.theme === 'dark' ? 'light' : 'dark';
        savePref({ theme: state.theme }).catch(() => {});
        emitStateUpdate();
        render({ syncVariables: false, syncProfile: false });
    });
```
`setProfileConfigured()` : `state.profileConfigured = true;` seul. `confirmProfileModal()` : ajouter `saveProfileData();` entre `setProfileConfigured();` et `emitStateUpdate();` (sans ça, valider le profil sans toucher aux champs ne créerait jamais `portfolioMeta.profile` et la modale reviendrait au prochain chargement). `applyProfilePreset` : remplacer la ligne `localStorage.setItem(...)` par `savePref({ profilePreset: profileKey }).catch(() => {});`.

Mode guidé / tuto (l.2345-2362) :
```js
function isGuidedModeActive() { return state.guidedMode; }
function getTutoStep() { return state.tutoStep; }
function setTutoStep(n) {
    state.tutoStep = n;
    savePref({ tutoStep: n }).catch(() => {});
}
function setGuidedMode(active) {
    state.guidedMode = Boolean(active);
    savePref({ guidedMode: state.guidedMode }).catch(() => {});
    if (active) setTutoStep(0);
    applyGuidedModeUI(active);
    render({ syncVariables: false, syncProfile: false });
}
```
`handleScreenToggle` : remplacer `localStorage.setItem(STORAGE_KEYS.screens, …)` par `savePref({ screens: state.screens }).catch(() => {});`.

Vue analyse (l.2675-2697) :
```js
// Vue rapide/complète de l'Analyse : appliquée depuis les prefs cloud au démarrage (_startApp), écrite
// uniquement au clic (persist) — jamais au chargement.
function _applyAnalysisView(view, { persist = false } = {}) {
    if (!nodes.analysisPanel) return;
    state.analysisView = view;
    nodes.analysisPanel.dataset.analysisView = view;
    if (nodes.btnViewQuick) {
        nodes.btnViewQuick.classList.toggle('view-toggle-btn--active', view === 'quick');
        nodes.btnViewQuick.setAttribute('aria-pressed', String(view === 'quick'));
    }
    if (nodes.btnViewFull) {
        nodes.btnViewFull.classList.toggle('view-toggle-btn--active', view === 'full');
        nodes.btnViewFull.setAttribute('aria-pressed', String(view === 'full'));
    }
    if (persist) savePref({ analysisView: view }).catch(() => {});
}

function _initAnalysisViewToggle() {
    nodes.btnViewQuick?.addEventListener('click', () => _applyAnalysisView('quick', { persist: true }));
    nodes.btnViewFull?.addEventListener('click', () => _applyAnalysisView('full', { persist: true }));
}
```

- [ ] **Étape 5 : Démarrage cloud** (Edit — ajouter avant `console.log('[Spark] Init start');`)

```js
// ─── Démarrage cloud ───────────────────────────────────────────────────────────
// Firestore est la seule source de vérité. Le premier render() attend les 4 premiers snapshots pour
// ne jamais afficher de valeurs par défaut qui sauteraient ensuite ; d'ici là #app-cloud-loading
// (visible dès le HTML) recouvre la page. Déconnecté : #app-auth-gate recouvre tout (connexion
// obligatoire pour toute l'app, pas seulement le portefeuille).
const _cloudReady = { prefs: false, meta: false, studies: false, analysis: false };
let _appStarted = false;
let _authUser = null;
let _unsubs = [];

function _applyPrefs(prefs) {
    state.theme = prefs.theme === 'light' ? 'light' : 'dark';
    state.screens = Number(prefs.screens) === 2 ? 2 : 1;
    state.profilePreset = PROFILE_OPTIONS.some(p => p.key === prefs.profilePreset) ? prefs.profilePreset : 'famille';
    state.sparkMode = prefs.sparkMode === 'guided' ? 'guided' : 'full';
    state.guidedMode = prefs.guidedMode === true;
    state.tutoStep = Number.isInteger(prefs.tutoStep) ? prefs.tutoStep : 0;
    state.analysisView = prefs.analysisView === 'full' ? 'full' : 'quick';
    state.facturesLastAsset = typeof prefs.facturesLastAsset === 'string' ? prefs.facturesLastAsset : null;
}

// portfolioMeta.profile = le profil du foyer (déjà synchronisé PC/iPhone). Un profil présent vaut
// « profil configuré » : plus de clé dédiée, l'onboarding ne se rouvre que tant qu'il n'existe pas.
function _applyMeta(meta) {
    const profile = meta?.profile;
    state.profileConfigured = Boolean(profile);
    state.profileData = sanitizeProfileData({ ...getProfileOption(state.profilePreset).defaults, ...(profile || {}) });
}

function _onCloudError() {
    showToast('Connexion au cloud impossible — vérifiez votre connexion internet', 'negative');
}

function _afterFirstSnapshots() {
    if (!_appStarted && Object.values(_cloudReady).every(Boolean)) _startApp();
}

function _startCloud() {
    _stopCloud();
    _unsubs.push(watchPrefs(prefs => {
        _applyPrefs(prefs);
        _cloudReady.prefs = true;
        if (_appStarted) { _applyAnalysisView(state.analysisView); applyGuidedModeUI(state.guidedMode); render({ syncVariables: false, syncProfile: true }); }
        _afterFirstSnapshots();
    }, _onCloudError));
    _unsubs.push(watchPortfolioMeta(meta => {
        _applyMeta(meta);
        _cloudReady.meta = true;
        if (_appStarted) render({ syncVariables: false, syncProfile: true });
        _afterFirstSnapshots();
    }, _onCloudError));
    _startStudiesAndAnalysis(); // Tâche 6 : watchStudies + watchAnalysis
}

function _stopCloud() {
    _unsubs.forEach(unsub => { try { unsub(); } catch { /* déjà coupé */ } });
    _unsubs = [];
    Object.keys(_cloudReady).forEach(k => { _cloudReady[k] = false; });
    _appStarted = false;
}

function _startApp() {
    _appStarted = true;
    _reconcileActiveAsset(); // Tâche 6
    const loading = document.getElementById('app-cloud-loading');
    if (loading) loading.hidden = true;
    render();
    _applyAnalysisView(state.analysisView);
    applyGuidedModeUI(state.guidedMode);
    if (!IS_ANALYSIS_WINDOW && !state.profileConfigured) {
        setTimeout(() => openProfileModal(), 400);
    }
    if (!IS_ANALYSIS_WINDOW && state.screens === 2) {
        openAnalysisWindow({ focus: false });
        if (state.analysisPopupBlocked) render({ syncVariables: false, syncProfile: false });
    }
}

function _showAuthGate(show) {
    const gate = document.getElementById('app-auth-gate');
    if (!gate) return;
    gate.hidden = !show;
    if (show) renderAuthGateInto(gate, { title: 'Spark Investissement — Connexion' });
}

function _initCloud() {
    watchAuth(async user => {
        _authUser = user;
        const loading = document.getElementById('app-cloud-loading');
        if (!user) {
            _stopCloud();
            if (loading) loading.hidden = true;
            _showAuthGate(true);
            return;
        }
        _showAuthGate(false);
        if (loading) loading.hidden = false;
        if (MIGRATION_LOCALE_ACTIVE && !IS_ANALYSIS_WINDOW) {
            // Doit tourner avant tout abonnement : l'app n'écrit dans settings/* que sur action, mais
            // on ne veut même pas lire des documents que la migration est en train de remplir.
            try {
                const { runLocalMigration } = await import('./migration-locale.js');
                await runLocalMigration({
                    sanitizeAssetRecord,
                    normaliserVariables: raw => sanitizeVariablesData({ ...VARIABLE_DEFAULTS, ...(raw || {}) })
                });
            } catch (err) {
                console.error('[Spark] migration locale :', err);
                showToast('Migration locale impossible — voir la console', 'negative');
            }
            if (_authUser !== user) return; // déconnecté pendant la migration
        }
        _startCloud();
    });
}
```
Tant que la Tâche 6 n'est pas faite, ajouter temporairement : `function _startStudiesAndAnalysis() { _cloudReady.studies = true; _cloudReady.analysis = true; }` et `function _reconcileActiveAsset() {}` (remplacés en Tâche 6).

- [ ] **Étape 6 : Bootstrap** (Edit, bloc final l.2935-2996)

```js
console.log('[Spark] Init start');
initOwnedPortfolio({ state, nodes, IS_ANALYSIS_WINDOW, IS_MOBILE_PAGE: false });
populateProfiles();
setupCrossWindowSync();
bindEvents();
initWorkspaceTabs();
_initAnalysisViewToggle();
initOwnedPortfolioEvents();
if (!IS_ANALYSIS_WINDOW) initAssistantChat({ state, nodes });
initAccordion();
initTutoBar();
initGlossaire();
initCalculette();
initSliders();
// Câblage DOM terminé (aucune écriture) : le premier render() viendra des snapshots cloud (_startApp).
_initCloud();

// Numéro de version : fichier statique VERSION servi par Hosting (plus de route /api/version).
fetch('VERSION', { cache: 'no-store' })
    .then(res => (res.ok ? res.text() : ''))
    .then(text => {
        const version = String(text || '').trim();
        if (nodes.topbarVersion && /^\d+\.\d+\.\d+$/.test(version)) nodes.topbarVersion.textContent = `v${version}`;
    })
    .catch(() => {});
```
Garder le bloc « Modal régimes fiscaux » tel quel ; supprimer les anciens `try { render() … }`, `applyGuidedModeUI(isGuidedModeActive())`, l'ouverture de la modale profil et du 2e écran (déplacés dans `_startApp`).

- [ ] **Étape 7 : Vérifier qu'aucun `localStorage` ne subsiste côté main.js**

Run: `grep -n "localStorage\|sessionStorage\|STORAGE_KEYS\|refreshStateFromStorage" main.js`
Expected: seules restent les lignes de `emitStateUpdate`/`setupCrossWindowSync` (l.767-812, traitées en Tâche 7) et les sites `saveVariablesData`/`saveAssetRecords`/`saveActiveAssetId` (Tâche 6). Pour que le module charge, remplacer dès maintenant le corps de ces trois fonctions et d'`emitStateUpdate`/`refreshStateFromStorage` par des versions sans `localStorage` (`saveVariablesData(){}` provisoire est acceptable **uniquement** jusqu'à la Tâche 6 ; `emitStateUpdate` garde seulement `syncChannel.postMessage` ; `refreshStateFromStorage(){ render(); }` ; retirer le `window.addEventListener('storage', …)`). `node --check main.js` → OK.

- [ ] **Étape 8 : Lancer les tests**

Run: `SPARK_TEST_BASE=http://127.0.0.1:8090 TW_SCREENSHOTS=<scratchpad>/shots node tests/playwright/tout-web.mjs`
Expected: scénarios Connexion, Préférences, Onboarding et Impression verts (PC + iPhone). Regarder `gate-PC.png`, `gate-iPhone.png`, `prefs-PC.png` : gate centré, lisible à 393 px ; vue analyse complète sans indicateur de chargement résiduel.

- [ ] **Étape 9 : CODEBASE_MAP + commit**

`## main.js` : remplacer les puces `loadVariablesData()/loadProfileData()` et « Bootstrap (fin de fichier) » par la description de `_initCloud`/`_startCloud`/`_startApp`/`_applyPrefs`/`_applyMeta`, la règle « aucune écriture au chargement », `profileConfigured = !!meta.profile`, `MIGRATION_LOCALE_ACTIVE`, version lue depuis `VERSION`.

```bash
git add main.js tests/playwright/tout-web.mjs CODEBASE_MAP.md
git commit -m "feat(web): main.js demarre depuis Firestore (gate, prefs, profil, version), plus de localStorage

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Tâche 6 : `main.js` — études du comparateur et étude en cours (débounce 1,5 s)

**Files:**
- Modify: `main.js` (`saveVariablesData`/`saveAssetRecords`/`saveActiveAssetId` l.751-765, `_startStudiesAndAnalysis`/`_reconcileActiveAsset` provisoires de la Tâche 5), `CODEBASE_MAP.md`

**Interfaces:**
- Consumes: `watchStudies`, `cloudSetStudy`, `cloudDeleteStudy`, `watchAnalysis`, `cloudSaveAnalysis` (cloud-store.js), `sanitizeAssetRecord`.
- Produces: `_studiesCache`, `_analysisDirty`, `_scheduleAnalysisSave()`, `_flushAnalysisSave()`, `_applyStudies(map)`, `_applyAnalysis(data)`, `_reconcileActiveAsset()`. Les sites d'appel existants (`createOrUpdateCurrentAsset`, `loadAssetIntoWorkspace`, `detachCurrentAsset`, `updateVariablesFromForm`…) ne changent pas.

- [ ] **Étape 1 : Test qui échoue** — ajouter dans `tout-web.mjs` :

```js
async function scenarioEtudes(browser, viewport, label) {
    console.log(`\nÉtudes — ${label}`);
    const { page, context, errors } = await openPage(browser, '/index.html', { viewport, spyStorage: false });
    await waitAppStarted(page);

    await step('saisie → une seule écriture settings/analysis après 1,5 s d inactivité', async () => {
        await page.fill('#variables-form [name="nom-bien"]', 'Studio test');
        await page.fill('#variables-form [name="prix"]', '150000');
        await page.fill('#variables-form [name="loyer"]', '750');
        await page.waitForTimeout(700);
        assert.equal(await page.evaluate(() => window.__store.writes.filter(w => w[0] === 'analysis').length), 0, 'pas encore écrit (débounce)');
        await page.waitForFunction(() => window.__store.settings.analysis?.variablesData?.prix === 150000, null, { timeout: 4000 });
        const writes = await page.evaluate(() => window.__store.writes.filter(w => w[0] === 'analysis').length);
        assert.equal(writes, 1, `écritures analysis : ${writes}`);
        assert.ok(await page.evaluate(() => Number.isFinite(window.__store.settings.analysis.updatedAt)));
    });

    await step('Sauvegarder → studies/{id} avec id, variablesData, createdAt, updatedAt', async () => {
        await page.click('#save-asset');
        await page.waitForFunction(() => Object.keys(window.__store.studies).length === 1);
        const study = await page.evaluate(() => Object.values(window.__store.studies)[0]);
        assert.match(study.id, /^asset-/);
        assert.equal(study.variablesData['nom-bien'], 'Studio test');
        assert.ok(study.createdAt > 0 && study.updatedAt >= study.createdAt);
        await page.waitForFunction(id => window.__store.settings.analysis?.activeAssetId === id, study.id, { timeout: 4000 });
    });

    await step('rechargement → étude et saisie reviennent du cloud, aucune écriture', async () => {
        await reloadWithStore(page, context);
        await waitAppStarted(page);
        assert.equal(await page.inputValue('#variables-form [name="nom-bien"]'), 'Studio test');
        assert.equal(await page.inputValue('#variables-form [name="prix"]'), '150000');
        assert.match(await page.textContent('#asset-status-bar'), /À jour/);
        await page.waitForTimeout(800);
        assert.deepEqual(await page.evaluate(() => window.__store.writes), []);
        await shot(page, `etudes-${label}`);
    });

    await step('snapshot distant plus ancien pendant la frappe → la saisie locale reste', async () => {
        await page.fill('#variables-form [name="prix"]', '160000');
        // Un autre appareil pousse une vieille valeur avant la fin du débounce local
        await page.evaluate(() => window.__store.listeners.analysis.forEach(cb => cb({ variablesData: { prix: 99999 }, activeAssetId: null, updatedAt: 1 })));
        await page.waitForTimeout(100);
        assert.equal(await page.inputValue('#variables-form [name="prix"]'), '160000');
        await page.waitForFunction(() => window.__store.settings.analysis?.variablesData?.prix === 160000, null, { timeout: 4000 });
    });

    await step('snapshot distant au repos → appliqué', async () => {
        await page.evaluate(() => window.__store.listeners.analysis.forEach(cb => cb({ ...window.__store.settings.analysis, variablesData: { ...window.__store.settings.analysis.variablesData, loyer: 800 }, updatedAt: Date.now() })));
        await page.waitForFunction(() => document.querySelector('#variables-form [name="loyer"]').value === '800', null, { timeout: 2000 });
    });

    await step('masquage de l onglet → flush immédiat', async () => {
        await page.fill('#variables-form [name="loyer"]', '820');
        await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
        await page.waitForFunction(() => window.__store.settings.analysis?.variablesData?.loyer === 820, null, { timeout: 500 });
        await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); });
    });

    await step('aucune erreur JS', () => assert.deepEqual(errors, []));
    await context.close();
}
```
Appeler `scenarioEtudes(browser, PC, 'PC')` et `scenarioEtudes(browser, IPHONE, 'iPhone')` dans le bloc principal.

Run: `SPARK_TEST_BASE=http://127.0.0.1:8090 node tests/playwright/tout-web.mjs`
Expected: `✗ saisie → une seule écriture settings/analysis` (rien n'est écrit : `saveVariablesData` provisoire).

- [ ] **Étape 2 : Écritures** (Edit, remplacer `saveVariablesData`/`saveAssetRecords`/`saveActiveAssetId`)

```js
// ─── Études du comparateur : users/{uid}/studies/{id} ─────────────────────────
// Même mécanique que saveOwnedAssets (owned-portfolio.js) : diff contre le dernier état connu, une
// écriture par étude réellement modifiée/supprimée. _studiesCache contient des enregistrements déjà
// passés par sanitizeAssetRecord (ordre de clés stable → comparaison JSON fiable).
let _studiesCache = {};

function saveAssetRecords() {
    if (!_authUser) return;
    const next = {};
    state.assetRecords.forEach(record => { next[record.id] = record; });
    const ids = new Set([...Object.keys(_studiesCache), ...Object.keys(next)]);
    for (const id of ids) {
        const had = id in _studiesCache, has = id in next;
        if (has && (!had || JSON.stringify(_studiesCache[id]) !== JSON.stringify(next[id]))) {
            cloudSetStudy(id, next[id]).catch(() => showToast('Échec de synchronisation de l’étude', 'negative'));
        } else if (had && !has) {
            cloudDeleteStudy(id).catch(() => showToast('Échec de suppression de l’étude dans le cloud', 'negative'));
        }
    }
    _studiesCache = next;
}

// ─── Étude en cours : users/{uid}/settings/analysis ───────────────────────────
// computeAnalysisViewModel reste appelé à chaque frappe ; seule l'écriture Firestore est débouncée
// (1,5 s d'inactivité, quota gratuit), avec flush quand l'onglet se cache ou se ferme. Tant qu'une
// écriture est en attente (_analysisDirty), les snapshots entrants sont ignorés : la frappe locale
// gagne — dernière écriture gagnante, comme pour le portefeuille.
const ANALYSIS_SAVE_DELAY = 1500;
let _analysisSaveTimer = null;
let _analysisDirty = false;

function _scheduleAnalysisSave() {
    _analysisDirty = true;
    window.clearTimeout(_analysisSaveTimer);
    _analysisSaveTimer = window.setTimeout(_flushAnalysisSave, ANALYSIS_SAVE_DELAY);
}

function _flushAnalysisSave() {
    window.clearTimeout(_analysisSaveTimer);
    if (!_analysisDirty || !_authUser) return;
    _analysisDirty = false;
    cloudSaveAnalysis({ variablesData: state.variablesData, activeAssetId: state.activeAssetId, updatedAt: Date.now() })
        .catch(() => showToast('Échec de synchronisation de l’étude en cours', 'negative'));
}

function saveVariablesData() { _scheduleAnalysisSave(); }
function saveActiveAssetId() { _scheduleAnalysisSave(); }

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') _flushAnalysisSave(); });
window.addEventListener('pagehide', _flushAnalysisSave);
```

- [ ] **Étape 3 : Lecture** (Edit, remplacer les provisoires `_startStudiesAndAnalysis`/`_reconcileActiveAsset`)

```js
function _applyStudies(map) {
    const records = Object.values(map || {}).map(sanitizeAssetRecord).filter(Boolean).sort((a, b) => a.createdAt - b.createdAt);
    _studiesCache = {};
    records.forEach(r => { _studiesCache[r.id] = r; });
    state.assetRecords = records;
}

// Document absent → valeurs par défaut, sans rien écrire. Snapshot identique à l'état (écho de notre
// propre écriture) → rien à faire ; différent et aucune saisie en attente → appliqué (autre appareil).
function _applyAnalysis(data) {
    if (!data || _analysisDirty) return;
    const incomingVars = sanitizeVariablesData({ ...VARIABLE_DEFAULTS, ...(data.variablesData || {}) });
    const incomingActive = typeof data.activeAssetId === 'string' && data.activeAssetId ? data.activeAssetId : null;
    if (incomingActive === state.activeAssetId && JSON.stringify(incomingVars) === JSON.stringify(state.variablesData)) return;
    state.variablesData = incomingVars;
    state.activeAssetId = incomingActive;
    if (_appStarted) { _reconcileActiveAsset(); render({ syncVariables: true, syncProfile: false }); }
}

// Une étude active supprimée sur un autre appareil : on revient à « nouvelle étude » sans écrire
// (l'écriture suivra la prochaine action de l'utilisateur).
function _reconcileActiveAsset() {
    if (state.activeAssetId && !state.assetRecords.some(a => a.id === state.activeAssetId)) state.activeAssetId = null;
}

function _startStudiesAndAnalysis() {
    _unsubs.push(watchStudies(map => {
        _applyStudies(map);
        _cloudReady.studies = true;
        if (_appStarted) { _reconcileActiveAsset(); render({ syncVariables: false, syncProfile: false }); }
        _afterFirstSnapshots();
    }, _onCloudError));
    _unsubs.push(watchAnalysis(data => {
        _applyAnalysis(data);
        _cloudReady.analysis = true;
        _afterFirstSnapshots();
    }, _onCloudError));
}
```
Dans `_stopCloud()`, ajouter `_studiesCache = {}; _analysisDirty = false; window.clearTimeout(_analysisSaveTimer);`.

- [ ] **Étape 4 : Vérifier**

Run: `node --check main.js && grep -n "localStorage\|sessionStorage" main.js`
Expected: syntaxe OK ; `grep` ne renvoie que `emitStateUpdate` (Tâche 7) ou rien.

Run: `SPARK_TEST_BASE=http://127.0.0.1:8090 TW_SCREENSHOTS=<scratchpad>/shots node tests/playwright/tout-web.mjs`
Expected: scénario Études vert (PC + iPhone), les autres toujours verts. Regarder `etudes-PC.png` : barre de statut « À jour », nom de l'étude dans le topbar.

- [ ] **Étape 5 : CODEBASE_MAP + commit**

`## main.js` : puce « Comparateur d'études » → `studies/{id}` Firestore via `saveAssetRecords` (diff) ; nouvelle puce étude en cours (`settings/analysis`, débounce 1,5 s, flush, `_applyAnalysis` ignore les snapshots pendant `_analysisDirty`).

```bash
git add main.js tests/playwright/tout-web.mjs CODEBASE_MAP.md
git commit -m "feat(web): etudes du comparateur et etude en cours dans Firestore (debounce 1,5 s, flush)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Tâche 7 : Mode deux fenêtres par `BroadcastChannel` (payload complet)

**Files:**
- Modify: `main.js` (`emitStateUpdate`, `refreshStateFromStorage`, `setupCrossWindowSync` l.767-812), `CODEBASE_MAP.md`

**Interfaces:**
- Produces: message `{ type: 'state-update', payload }` sur le canal `investissement-web-sync` ; `applyRemoteState(payload)`. Les snapshots Firestore restent la source de vérité au rechargement de la fenêtre détachée.

- [ ] **Étape 1 : Test qui échoue** — ajouter dans `tout-web.mjs` :

```js
async function scenarioDeuxFenetres(browser) {
    console.log('\nDeux fenêtres — PC');
    const { page, context, errors } = await openPage(browser, '/index.html', { viewport: PC, spyStorage: false });
    await waitAppStarted(page);
    const popup = await context.newPage();
    const popupErrors = [];
    popup.on('pageerror', err => popupErrors.push(err.message));
    await popup.goto(`${BASE}/index.html?panel=analysis`, { waitUntil: 'load' });
    await waitAppStarted(popup);

    await step('la fenêtre d analyse suit la frappe sans attendre le débounce', async () => {
        await page.fill('#variables-form [name="nom-bien"]', 'Maison sync');
        await popup.waitForFunction(() => /Maison sync/.test(document.getElementById('topbar-study-name')?.textContent || ''), null, { timeout: 1000 });
        assert.equal(await popup.isVisible('#collection-panel'), false, 'fenêtre détachée : pas de portefeuille');
    });

    await step('thème basculé dans la fenêtre principale → appliqué dans la fenêtre d analyse', async () => {
        await page.click('#theme-toggle');
        await popup.waitForFunction(() => document.documentElement.dataset.theme === 'light', null, { timeout: 1000 });
    });

    await step('aucune erreur JS dans les deux fenêtres', () => { assert.deepEqual(errors, []); assert.deepEqual(popupErrors, []); });
    await context.close();
}
```
Appeler `await scenarioDeuxFenetres(browser);`. Ajouter `BASE` à l'import depuis `./_harness.mjs`.

Run: `SPARK_TEST_BASE=http://127.0.0.1:8090 node tests/playwright/tout-web.mjs`
Expected: `✗ la fenêtre d analyse suit la frappe` (le message ne porte plus de données depuis la Tâche 5).

- [ ] **Étape 2 : Réécrire la synchro** (Edit, remplacer `emitStateUpdate`, `refreshStateFromStorage`, `setupCrossWindowSync`)

```js
// ─── Mode deux fenêtres (?panel=analysis) ─────────────────────────────────────
// Le message BroadcastChannel porte l'état lui-même (plus de relais par localStorage) : la fenêtre
// détachée suit la frappe immédiatement, sans attendre le débounce Firestore. Au rechargement, elle
// repart des snapshots cloud comme la fenêtre principale.
function emitStateUpdate() {
    if (!syncChannel) return;
    syncChannel.postMessage({
        type: 'state-update',
        payload: {
            theme: state.theme, screens: state.screens, sparkMode: state.sparkMode, profilePreset: state.profilePreset,
            profileData: state.profileData, profileConfigured: state.profileConfigured,
            variablesData: state.variablesData, activeAssetId: state.activeAssetId, assetRecords: state.assetRecords
        }
    });
}

function applyRemoteState(payload) {
    if (!payload || !_appStarted) return; // avant le premier render, les snapshots cloud suffisent
    state.theme = payload.theme === 'light' ? 'light' : 'dark';
    state.screens = Number(payload.screens) === 2 ? 2 : 1;
    state.sparkMode = payload.sparkMode === 'guided' ? 'guided' : 'full';
    state.profilePreset = PROFILE_OPTIONS.some(p => p.key === payload.profilePreset) ? payload.profilePreset : state.profilePreset;
    if (payload.profileData) state.profileData = sanitizeProfileData(payload.profileData);
    state.profileConfigured = Boolean(payload.profileConfigured);
    if (payload.variablesData) state.variablesData = sanitizeVariablesData({ ...VARIABLE_DEFAULTS, ...payload.variablesData });
    state.activeAssetId = typeof payload.activeAssetId === 'string' && payload.activeAssetId ? payload.activeAssetId : null;
    if (Array.isArray(payload.assetRecords)) state.assetRecords = payload.assetRecords.map(sanitizeAssetRecord).filter(Boolean);
    _reconcileActiveAsset();
    if (!IS_ANALYSIS_WINDOW && state.screens === 1) closeAnalysisWindow();
    render();
}

function setupCrossWindowSync() {
    if (!('BroadcastChannel' in window)) return;
    syncChannel = new BroadcastChannel('investissement-web-sync');
    syncChannel.addEventListener('message', event => {
        if (event.data && event.data.type === 'state-update') applyRemoteState(event.data.payload);
    });
}
```
Supprimer `refreshStateFromStorage` et toute référence restante (`grep -n refreshStateFromStorage main.js` → vide).

- [ ] **Étape 3 : Vérifier**

Run: `node --check main.js && grep -c "localStorage\|sessionStorage" main.js`
Expected: syntaxe OK, `0`.

Run: `SPARK_TEST_BASE=http://127.0.0.1:8090 node tests/playwright/tout-web.mjs`
Expected: tous les scénarios verts, dont Deux fenêtres.

- [ ] **Étape 4 : CODEBASE_MAP + commit**

`## main.js` : puces `emitStateUpdate()`/`setupCrossWindowSync()` → payload complet, `applyRemoteState`, plus d'événement `storage`.

```bash
git add main.js tests/playwright/tout-web.mjs CODEBASE_MAP.md
git commit -m "feat(web): mode deux fenetres par BroadcastChannel seul (payload complet)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Tâche 8 : `owned-portfolio.js` / `owned-entry.js` — préférences du portefeuille via le cloud

**Files:**
- Modify: `owned-portfolio.js` (en-tête l.1-12, imports l.23-33, `_initCloudSync` l.66-105, `saveOwnedProfileData` l.1914-1917, densité l.2345-2352, tri l.3030-3053, filtres d'année l.3623-3630 et l.5304-5311, `FM_LAST_ASSET_KEY` l.4350/4445/4741/4767, `renderCollections` l.6427), `owned-entry.js:8-25,66`, `CODEBASE_MAP.md`

**Interfaces:**
- Consumes: `watchPrefs`, `savePref` (cloud-store.js) ; `state.facturesLastAsset` (posé aussi par main.js `_applyPrefs`).
- Produces: `_prefsLoaded` (même famille que `_cloudLoaded`/`_metaLoaded`) ; `initOwnedPortfolio(deps)` sans `STORAGE_KEYS`.

- [ ] **Étape 1 : Test qui échoue** — ajouter dans `tout-web.mjs` :

```js
async function scenarioPrefsPortefeuille(browser) {
    console.log('\nPréférences portefeuille — owned.html iPhone');
    const { page, context, errors } = await openPage(browser, '/owned.html', { viewport: IPHONE, spyStorage: false });
    await page.waitForSelector('#owned-list-view:not([hidden])', { timeout: 8000 });

    await step('chargement : aucune écriture', async () => {
        await page.waitForTimeout(800);
        assert.deepEqual(await page.evaluate(() => window.__store.writes), []);
    });

    await step('densité compacte → prefs.ownedCompact, conservée après rechargement', async () => {
        await page.click('#owned-density-btn');
        await page.waitForFunction(() => window.__store.settings.prefs?.ownedCompact === true);
        await reloadWithStore(page, context);
        await page.waitForSelector('#owned-list-view:not([hidden])', { timeout: 8000 });
        assert.equal(await page.evaluate(() => window.__store.settings.prefs.ownedCompact), true);
        await page.click('#owned-density-btn');
        await page.waitForFunction(() => window.__store.settings.prefs?.ownedCompact === false, null, { timeout: 2000 });
    });

    await step('filtre d année d un bien → prefs.ownedYearFilters[id]', async () => {
        await page.locator('[data-open-asset="oa-test-1"], [data-asset-id="oa-test-1"]').first().click();
        await page.waitForSelector('#owned-detail-view:not([hidden])');
        await page.click('.owned-tab[data-tab="calcul"]');
        const btn = page.locator('[data-calcul-year]').nth(2);
        const year = await btn.getAttribute('data-calcul-year');
        await btn.click();
        await page.waitForFunction(y => window.__store.settings.prefs?.ownedYearFilters?.['oa-test-1'] === Number(y), year);
    });

    await step('modale factures : dernier bien mémorisé dans prefs.facturesLastAsset', async () => {
        await page.click('#owned-quickfab');
        await page.waitForSelector('#owned-factures-modal:not([hidden])');
        await page.selectOption('[data-fm-asset]', 'oa-test-1');
        await page.waitForFunction(() => window.__store.settings.prefs?.facturesLastAsset === 'oa-test-1');
        await page.click('#owned-factures-modal [data-close-modal]');
    });

    await step('aucune erreur JS', () => assert.deepEqual(errors, []));
    await context.close();
}
```
Appeler `await scenarioPrefsPortefeuille(browser);`. (Si `.owned-tab[data-tab="calcul"]` n'est pas le sélecteur exact de l'onglet Calcul, lire `renderOwnedDetail` pour le bon `data-tab` et ajuster le test — ne pas ajuster le code.)

Run: `SPARK_TEST_BASE=http://127.0.0.1:8090 node tests/playwright/tout-web.mjs`
Expected: `✗ densité compacte` (écrit encore dans `localStorage`).

- [ ] **Étape 2 : Module** (Edit `owned-portfolio.js`)

a) En-tête ligne 1 : `// Module Portefeuille biens detenus — CRUD (ownedAssets, Firestore via owned-cloud.js), rendu (liste, fiche detail,` et dans le paragraphe d'interface remplacer `{ state, nodes, STORAGE_KEYS, IS_ANALYSIS_WINDOW, IS_MOBILE_PAGE }` par `{ state, nodes, IS_ANALYSIS_WINDOW, IS_MOBILE_PAGE }`.

b) Imports : ajouter `import { watchPrefs, savePref } from './cloud-store.js';` après l'import `owned-cloud.js`.

c) `let state, nodes, IS_ANALYSIS_WINDOW, IS_MOBILE_PAGE;` et dans `initOwnedPortfolio` retirer `STORAGE_KEYS = deps.STORAGE_KEYS;`.

d) `let _prefsLoaded = false; // premier snapshot settings/prefs (densite, tri, filtres d'annee, dernier bien factures)` à côté de `_metaLoaded`. Dans `_initCloudSync` : `let _unsubAssets = null, _unsubMeta = null, _unsubPrefs = null;` ; à la déconnexion couper `_unsubPrefs` et remettre `_prefsLoaded = false` ; après `_unsubMeta = watchPortfolioMeta(…)` ajouter :
```js
        // Préférences d'affichage du portefeuille : settings/prefs (cloud-store.js), partagées avec
        // main.js qui y lit les siennes (thème, écrans…). Clé absente → défaut local, jamais écrit.
        _unsubPrefs = watchPrefs(prefs => {
            state.ownedCompact = prefs.ownedCompact === true;
            state.ownedSort = prefs.ownedSort && typeof prefs.ownedSort === 'object' ? prefs.ownedSort : null;
            state.ownedYearFilters = prefs.ownedYearFilters && typeof prefs.ownedYearFilters === 'object' ? prefs.ownedYearFilters : {};
            state.facturesLastAsset = typeof prefs.facturesLastAsset === 'string' ? prefs.facturesLastAsset : null;
            _prefsLoaded = true;
            renderCollections();
        }, () => {});
```
Supprimer la branche `else if (state.profileConfigured) { … syncProfileToCloud(); }` du handler meta (le profil local n'existe plus ; la migration s'en charge) — garder `if (_metaCache.profile) { state.profileData = {...} }`.

e) `renderCollections` : `if (!_cloudLoaded || !_metaLoaded || !_prefsLoaded) return;` et mettre à jour le commentaire au-dessus.

f) `saveOwnedProfileData()` → `syncProfileToCloud();` seul (commentaire : « Persistance identique à main.js:saveProfileData() : portfolioMeta.profile, source unique »).

g) Densité : `localStorage.setItem(STORAGE_KEYS.ownedCompact, …)` → `savePref({ ownedCompact: state.ownedCompact }).catch(() => {});`. Tri (2 sites) : → `savePref({ ownedSort: state.ownedSort }).catch(() => {});`. Filtres d'année (2 sites) : → `savePref({ ownedYearFilters: state.ownedYearFilters }).catch(() => {});`.

h) Modale factures : supprimer `const FM_LAST_ASSET_KEY = …` ; ligne 4445 → `const lastUsed = state.facturesLastAsset;` ; lignes 4741 et 4767 → `state.facturesLastAsset = currentAssetId; savePref({ facturesLastAsset: currentAssetId }).catch(() => {});`.

i) `grep -n "localStorage\|STORAGE_KEYS" owned-portfolio.js` → ne doit rester que des commentaires historiques (l.46, l.127) à reformuler (« comme avant, quand la source etait localStorage » est factuel, peut rester).

- [ ] **Étape 3 : `owned-entry.js`** (Edit)

```js
// Bootstrap minimal pour owned.html (page iPhone) — equivalent, pour le seul module portefeuille,
// de ce que main.js fait pour toute l'app. Aucune donnee locale : biens, profil, ordre, regime
// viennent de Firestore (owned-cloud.js) et les reglages d'affichage de settings/prefs
// (cloud-store.js), via initOwnedPortfolio (owned-portfolio.js).
import { initOwnedPortfolio, initOwnedPortfolioEvents, renderCollections } from './owned-portfolio.js';
import { initAssistantChat } from './assistant-chat.js';

const state = {
    activeOwnedAssetId: null,
    ownedExpandedIds: new Set(),
    ownedYearFilters: {},
    ownedOrder: [],
    ownedCompact: false,
    ownedSort: null,
    ownedRegime: 'micro-foncier',
    facturesLastAsset: null,
    // Profil du foyer (TMI) : rempli par le snapshot portfolioMeta.profile avant le premier rendu.
    profileData: { income: 0, adults: 1, children: 0, autresCredits: [] }
};
```
et `initOwnedPortfolio({ state, nodes, IS_ANALYSIS_WINDOW: false, IS_MOBILE_PAGE: true });`. Supprimer `STORAGE_KEYS`.

- [ ] **Étape 4 : Vérifier**

Run: `node --check owned-portfolio.js && node --check owned-entry.js && grep -n "localStorage\|sessionStorage" owned-entry.js owned-portfolio.js | grep -v "^owned-portfolio.js:\(46\|127\):"`
Expected: syntaxe OK, aucun résultat.

Run: `SPARK_TEST_BASE=http://127.0.0.1:8090 node tests/playwright/tout-web.mjs`
Expected: tous les scénarios verts.

- [ ] **Étape 5 : CODEBASE_MAP + commit**

`## owned-portfolio.js` : `initOwnedPortfolio(deps)` sans `STORAGE_KEYS`, `_prefsLoaded`, `settings/prefs` pour densité/tri/filtres/dernier bien, `saveOwnedProfileData` → cloud seul, retrait du bootstrap profil. `## owned-entry.js` : état sans localStorage.

```bash
git add owned-portfolio.js owned-entry.js tests/playwright/tout-web.mjs CODEBASE_MAP.md
git commit -m "feat(portefeuille): preferences d affichage dans settings/prefs, fin du localStorage

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Tâche 9 : Export / import du portefeuille sans serveur (Storage + fichier)

**Files:**
- Modify: `owned-portfolio.js` (imports, `initOwnedPortfolioEvents` l.2317-2394, `openOwnedImportModal` l.2502-2531), `styles.css` (si besoin `.owned-import-file-item__meta`), `CODEBASE_MAP.md`

**Interfaces:**
- Consumes: `cloudListArchives`, `cloudUploadArchive`, `cloudReadArchive` (cloud-store.js), `nomArchiveUnique` (migration-regles.js), `_downloadOrShareFile` (Tâche 3), `#owned-import-file-input` (Tâche 4).
- Produces: export = téléchargement `portefeuille-AAAA-MM-JJ.json` **puis** archive Storage ; import = archive sélectionnée ou fichier local ; `_importPortfolioObject(portfolio)` (fusion sans écrasement).

- [ ] **Étape 1 : Test qui échoue** — ajouter dans `tout-web.mjs` :

```js
async function scenarioExportImport(browser) {
    console.log('\nExport / import — PC');
    const { page, context, errors } = await openPage(browser, '/index.html', { viewport: PC, spyStorage: false });
    await waitAppStarted(page);
    await page.click('.workspace-tab[data-target="collection-panel"]');
    await page.waitForSelector('#owned-list-view:not([hidden])');

    let archiveName;
    await step('Export → téléchargement portefeuille-AAAA-MM-JJ.json + archive Storage identique', async () => {
        const [download] = await Promise.all([page.waitForEvent('download'), page.click('#owned-export-btn')]);
        assert.match(download.suggestedFilename(), /^portefeuille-\d{4}-\d{2}-\d{2}\.json$/);
        await page.waitForFunction(() => Object.keys(window.__store.archives).length === 1, null, { timeout: 4000 });
        archiveName = await page.evaluate(() => Object.keys(window.__store.archives)[0]);
        assert.equal(archiveName, download.suggestedFilename());
        const content = await page.evaluate(n => JSON.parse(window.__store.archives[n]), archiveName);
        assert.deepEqual(Object.keys(content), ['oa-test-1']);
        await page.waitForFunction(() => /✓/.test(document.getElementById('owned-export-btn').textContent));
    });

    await step('second export le même jour → suffixe -1', async () => {
        await Promise.all([page.waitForEvent('download'), page.click('#owned-export-btn')]);
        await page.waitForFunction(() => Object.keys(window.__store.archives).length === 2, null, { timeout: 4000 });
        assert.ok(await page.evaluate(() => Object.keys(window.__store.archives).some(n => /-1\.json$/.test(n))));
    });

    await step('Import : la liste montre les archives ; une archive sans nouveau bien → rien écrit', async () => {
        await page.click('#owned-import-btn');
        await page.waitForSelector('#owned-import-modal:not([hidden])');
        await page.waitForSelector('.owned-import-file-item');
        assert.equal(await page.$$eval('.owned-import-file-item', l => l.length), 2);
        await page.click(`.owned-import-file-item[data-filename="${archiveName}"]`);
        const before = await page.evaluate(() => Object.keys(window.__stub.assets).length);
        await page.click('#owned-import-modal-confirm');
        await page.waitForFunction(() => /déjà présents/.test(document.getElementById('owned-import-modal-confirm').textContent));
        assert.equal(await page.evaluate(() => Object.keys(window.__stub.assets).length), before);
    });

    await step('Import depuis un fichier : nouveau bien ajouté, bien existant non écrasé', async () => {
        await page.click('#owned-import-btn');
        await page.waitForSelector('#owned-import-modal:not([hidden])');
        const asset2 = { 'oa-test-1': { id: 'oa-test-1', nom: 'ÉCRASÉ ?' }, 'oa-import-9': { id: 'oa-import-9', nom: 'Importé', ville: 'Tours', acquisition: { prix: 50000, credit: {} }, postAchat: { travaux: [], notes: [] }, scenarios: [] } };
        await page.setInputFiles('#owned-import-file-input', { name: 'sauvegarde.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(asset2)) });
        await page.waitForFunction(() => !document.getElementById('owned-import-modal-confirm').disabled);
        await page.click('#owned-import-modal-confirm');
        await page.waitForFunction(() => Object.keys(window.__stub.assets).length === 2, null, { timeout: 4000 });
        assert.equal(await page.evaluate(() => window.__stub.assets['oa-test-1'].nom), 'Rue des Lilas');
        assert.equal(await page.evaluate(() => window.__stub.assets['oa-import-9'].nom), 'Importé');
        await shot(page, 'import-PC');
    });

    await step('fichier invalide (tableau) → message, rien écrit', async () => {
        await page.click('#owned-import-btn');
        await page.waitForSelector('#owned-import-modal:not([hidden])');
        await page.setInputFiles('#owned-import-file-input', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('[1,2,3]') });
        await page.waitForFunction(() => !document.getElementById('owned-import-modal-confirm').disabled);
        await page.click('#owned-import-modal-confirm');
        await page.waitForSelector('#app-toast.app-toast--negative');
        assert.equal(await page.evaluate(() => Object.keys(window.__stub.assets).length), 2);
        await page.click('#owned-import-modal-cancel');
    });

    await step('aucune erreur JS', () => assert.deepEqual(errors, []));
    await context.close();

    console.log('\nExport avec Storage en panne — PC');
    const k = await openPage(browser, '/index.html', { viewport: PC, spyStorage: false, seedStore: { failUploadArchive: true } });
    await waitAppStarted(k.page);
    await k.page.click('.workspace-tab[data-target="collection-panel"]');
    await step('le téléchargement a lieu quand même + toast négatif', async () => {
        const [download] = await Promise.all([k.page.waitForEvent('download'), k.page.click('#owned-export-btn')]);
        assert.match(download.suggestedFilename(), /\.json$/);
        await k.page.waitForSelector('#app-toast.app-toast--negative', { timeout: 4000 });
    });
    await step('aucune erreur JS', () => assert.deepEqual(k.errors, []));
    await k.context.close();
}
```
Appeler `await scenarioExportImport(browser);`.

Run: `SPARK_TEST_BASE=http://127.0.0.1:8090 node tests/playwright/tout-web.mjs`
Expected: `✗ Export → téléchargement` (le `fetch('/api/portfolio/export')` échoue → repli blob sans archive).

- [ ] **Étape 2 : Export** (Edit, remplacer le handler `exportBtn` l.2318-2343)

```js
    // Export JSON : téléchargement (feuille de partage sur écran tactile) PUIS copie dans Storage
    // users/{uid}/archives/ — remplace le dossier exports/ de l'ancien serveur local. Le fichier part
    // d'abord : navigator.share doit rester dans le geste utilisateur, l'upload peut attendre.
    const exportBtn = document.getElementById('owned-export-btn');
    if (exportBtn) {
        exportBtn.addEventListener('click', async () => {
            const json = JSON.stringify(loadOwnedAssets(), null, 2);
            const base = `portefeuille-${new Date().toISOString().slice(0, 10)}`;
            await _downloadOrShareFile(new File([json], `${base}.json`, { type: 'application/json' }), 'Portefeuille Spark');
            try {
                const existants = (await cloudListArchives()).map(a => a.name);
                const archiveName = nomArchiveUnique(base, existants);
                await cloudUploadArchive(archiveName, json);
                exportBtn.textContent = `✓ ${archiveName}`;
                setTimeout(() => { exportBtn.textContent = '↓ Export'; }, 3000);
            } catch {
                showToast('Archive cloud non enregistrée — le fichier a tout de même été téléchargé', 'negative');
            }
        });
    }
```
Imports : ajouter `cloudListArchives, cloudUploadArchive, cloudReadArchive` à l'import `cloud-store.js` et `import { nomArchiveUnique } from './migration-regles.js';`.

- [ ] **Étape 3 : Import** (Edit)

Remplacer le handler `importConfirm` (l.2364-2394) par :
```js
    const importFileInput = document.getElementById('owned-import-file-input');
    if (importFileInput) {
        // Un fichier choisi devient la sélection courante (désélectionne l'archive cloud éventuelle).
        importFileInput.addEventListener('change', () => {
            const file = importFileInput.files?.[0];
            if (!file || !importModal) return;
            importModal.querySelectorAll('.owned-import-file-item--selected').forEach(i => i.classList.remove('owned-import-file-item--selected'));
            importModal._pendingFile = file;
            const list = document.getElementById('owned-import-file-list');
            const row = document.createElement('div');
            row.className = 'owned-import-file-item owned-import-file-item--selected';
            row.innerHTML = `<span class="owned-import-file-item__name">${escapeHtml(file.name)}</span><span class="owned-import-note">fichier local</span>`;
            list?.prepend(row);
            if (importConfirm) importConfirm.disabled = false;
        });
    }
    if (importConfirm) {
        importConfirm.addEventListener('click', async () => {
            const selected = importModal?.querySelector('.owned-import-file-item--selected');
            if (!selected) return;
            try {
                const portfolio = importModal._pendingFile && !selected.dataset.filename
                    ? JSON.parse(await importModal._pendingFile.text())
                    : await cloudReadArchive(selected.dataset.filename);
                const added = _importPortfolioObject(portfolio);
                importModal.hidden = true;
                renderOwnedPortfolioList();
                importConfirm.textContent = added > 0 ? `✓ ${added} bien(s) importé(s)` : '⚠ Tous les biens sont déjà présents';
                if (added > 0) setTimeout(() => { importConfirm.textContent = 'Importer'; }, 3000);
            } catch (err) {
                showToast(`Import impossible : ${err?.message || 'fichier illisible'}`, 'negative');
            }
        });
    }
```
Ajouter après `openOwnedImportModal` :
```js
// Fusionne un export { id: bien } dans le portefeuille sans écraser les biens existants (même règle
// qu'avant). Un contenu qui n'est pas un objet de biens est refusé avant toute écriture.
function _importPortfolioObject(portfolio) {
    if (!portfolio || typeof portfolio !== 'object' || Array.isArray(portfolio)) {
        throw new Error('ce fichier ne contient pas un portefeuille Spark');
    }
    const entries = Object.entries(portfolio).filter(([, asset]) => asset && typeof asset === 'object' && !Array.isArray(asset));
    if (!entries.length) throw new Error('aucun bien dans ce fichier');
    const existing = loadOwnedAssets();
    let added = 0;
    for (const [id, asset] of entries) {
        if (!existing[id]) { existing[id] = { ...asset, id }; added++; }
    }
    if (added) saveOwnedAssets(existing);
    return added;
}
```
Réécrire `openOwnedImportModal` :
```js
async function openOwnedImportModal() {
    const modal = document.getElementById('owned-import-modal');
    const list = document.getElementById('owned-import-file-list');
    const confirm = document.getElementById('owned-import-modal-confirm');
    const fileInput = document.getElementById('owned-import-file-input');
    if (!modal || !list) return;
    list.innerHTML = '<div class="owned-import-empty">Chargement…</div>';
    if (confirm) { confirm.disabled = true; confirm.textContent = 'Importer'; }
    if (fileInput) fileInput.value = '';
    modal._pendingFile = null;
    modal.hidden = false;
    try {
        const archives = await cloudListArchives();
        if (!archives.length) {
            list.innerHTML = '<div class="owned-import-empty">Aucune archive dans le cloud — utilisez « Export », ou choisissez un fichier.</div>';
            return;
        }
        list.innerHTML = archives.map(a => `
            <div class="owned-import-file-item" data-filename="${escapeHtml(a.name)}">
                <span class="owned-import-file-item__name">${escapeHtml(a.name)}</span>
                <span class="owned-import-note">${a.size != null ? escapeHtml(`${Math.round(a.size / 1024)} Ko`) : ''}</span>
            </div>`).join('');
        list.querySelectorAll('.owned-import-file-item').forEach(item => {
            item.addEventListener('click', () => {
                list.querySelectorAll('.owned-import-file-item').forEach(i => i.classList.remove('owned-import-file-item--selected'));
                item.classList.add('owned-import-file-item--selected');
                modal._pendingFile = null;
                if (confirm) confirm.disabled = false;
            });
        });
    } catch {
        list.innerHTML = '<div class="owned-import-empty">Erreur lors du chargement des archives.</div>';
    }
}
```

- [ ] **Étape 4 : Vérifier**

Run: `node --check owned-portfolio.js && grep -n "/api/" owned-portfolio.js main.js utils.js`
Expected: syntaxe OK, aucun `/api/` restant.

Run: `SPARK_TEST_BASE=http://127.0.0.1:8090 TW_SCREENSHOTS=<scratchpad>/shots node tests/playwright/tout-web.mjs`
Expected: tous verts. Regarder `import-PC.png` : la liste des biens montre « Importé ».

- [ ] **Étape 5 : CODEBASE_MAP + commit**

`## owned-portfolio.js` : `initOwnedPortfolioEvents` (export → téléchargement + archive Storage), `openOwnedImportModal` (archives + fichier), `_importPortfolioObject`.

```bash
git add owned-portfolio.js styles.css tests/playwright/tout-web.mjs CODEBASE_MAP.md
git commit -m "feat(portefeuille): export/import sans serveur (archives Storage + fichier .json)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Tâche 10 : `migration-locale.js` — migration unique depuis l'exe, relue et vérifiée

**Files:**
- Create: `migration-locale.js`, `tests/playwright/migration-locale.mjs`
- Modify: `CODEBASE_MAP.md`

**Interfaces:**
- Consumes: `runLocalMigration({ sanitizeAssetRecord, normaliserVariables })` est appelée par `main.js` (Tâche 5) ; `cloudGetMeta`, `cloudSaveMeta`, `cloudGetAllAssets`, `cloudDocumentExists`, `cloudUploadDocumentAs` (owned-cloud.js) ; `cloudGetAllStudies`, `cloudSetStudy`, `cloudGetSetting`, `cloudSetSetting`, `cloudArchiveMeta`, `cloudUploadArchive` (cloud-store.js) ; règles de `migration-regles.js` ; routes de l'exe `GET /api/portfolio/import/list` (`{files}`), `GET /exports/<nom>` (fichier brut, servi par la route statique Flask), `GET /api/documents/<bien>/<fichier>`.
- Produces: retourne `{ skipped: true }` ou `{ ok, counts, ecarts }` ; écrit `settings/migration` seulement si la relecture est conforme. Ne supprime rien en local.

- [ ] **Étape 1 : Test qui échoue** (Write `tests/playwright/migration-locale.mjs`)

```js
// Test navigateur de la migration unique localStorage/exports/documents → cloud (migration-locale.js).
// Lancer : SPARK_TEST_BASE=http://127.0.0.1:8090 node tests/playwright/migration-locale.mjs
// ML_SCREENSHOTS=<dir> enregistre des captures. Le module ne se charge que sur 127.0.0.1:8080 ou avec
// ?migration-locale=1 (ici). localStorage est pré-rempli : c'est le seul test où il est légitime.
import { chromium } from 'playwright';
import { assert, openPage, step, getFailures } from './_harness.mjs';

const SHOTS = process.env.ML_SCREENSHOTS || '';
const PC = { width: 1366, height: 900 };
const EXPORT_RAW = JSON.stringify({ 'oa-test-1': { id: 'oa-test-1', nom: 'Rue des Lilas' } }, null, 2) + '\n';
const PDF_BYTES = Buffer.from('%PDF-1.4\n%%EOF\n', 'latin1');

const LOCAL = {
    investissementWebAssetRecords: JSON.stringify([
        { id: 'asset-A', variablesData: { 'nom-bien': 'A locale (ancienne)', prix: 100000, loyer: 500 }, createdAt: 1000, updatedAt: 2000 },
        { id: 'asset-B', variablesData: { 'nom-bien': 'B locale', prix: 200000, loyer: 900 }, createdAt: 1500, updatedAt: 3000 }
    ]),
    investissementWebVariablesData: JSON.stringify({ 'nom-bien': 'En cours', prix: 123456, loyer: 650 }),
    investissementWebActiveAssetId: 'asset-B',
    investissementWebTheme: 'light', investissementWebScreens: '2', investissementWebGuidedMode: 'false',
    investissementWebOwnedCompact: '1', 'spark:factures:lastAsset': 'oa-test-1',
    investissementWebProfileData: JSON.stringify({ name: 'Local', income: 45000, adults: 2, children: 1 }),
    investissementWebProfileConfigured: '1'
};
const CLOUD_STUDY_A = { id: 'asset-A', variablesData: { 'nom-bien': 'A cloud (plus récente)', prix: 110000, loyer: 520 }, createdAt: 1000, updatedAt: 5000 };

const routes = [
    ['**/api/portfolio/import/list', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ files: ['portefeuille-2026-06-14.json'] }) })],
    ['**/exports/portefeuille-2026-06-14.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: EXPORT_RAW })],
    ['**/api/documents/oa-test-1/facture-1.pdf', r => r.fulfill({ status: 200, contentType: 'application/pdf', body: PDF_BYTES })]
];

// L'ancien stockage est pré-rempli AVANT la première navigation (initScripts du harnais) : une première
// visite à vide écrirait déjà le marqueur settings/migration et le second passage serait ignoré.
function ouvrir(browser, { seedStore, seedCloud = {} }) {
    return openPage(browser, '/index.html?migration-locale=1', {
        viewport: PC, spyStorage: false, seedStore, seedCloud, routes,
        initScripts: [[local => { for (const [k, v] of Object.entries(local)) localStorage.setItem(k, v); }, LOCAL]]
    });
}

const lireBilan = page => page.evaluate(() => ({
    texte: document.querySelector('#migration-locale-modal')?.textContent.replace(/\s+/g, ' ').trim() || '',
    visible: !!document.querySelector('#migration-locale-modal:not([hidden])'),
    retry: !!document.querySelector('#migration-locale-modal [data-migration-retry]'),
    continuer: !!document.querySelector('#migration-locale-modal [data-migration-close]')
}));

async function scenarioNominal(browser) {
    console.log('\nMigration — passage nominal');
    const { page, context, errors } = await ouvrir(browser, {
        seedStore: { studies: { 'asset-A': CLOUD_STUDY_A } },
        seedCloud: { meta: { order: ['oa-test-1'], regime: 'micro-foncier' } } // pas de profil cloud
    });

    await step('bilan affiché : 2 études, 1 archive, 1 document, URL web', async () => {
        await page.waitForSelector('#migration-locale-modal [data-migration-close]', { timeout: 15000 });
        const b = await lireBilan(page);
        assert.match(b.texte, /2 études/);
        assert.match(b.texte, /1 archive/);
        assert.match(b.texte, /1 document/);
        assert.match(b.texte, /spark-investissement\.web\.app/);
        assert.equal(b.retry, false);
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/migration-bilan.png` });
    });

    await step('le plus récent gagne : A = cloud, B = locale', async () => {
        const s = await page.evaluate(() => window.__store.studies);
        assert.equal(s['asset-A'].variablesData['nom-bien'], 'A cloud (plus récente)');
        assert.equal(s['asset-B'].variablesData['nom-bien'], 'B locale');
        assert.equal(s['asset-B'].variablesData.notaire, 8, 'étude locale normalisée par sanitizeAssetRecord');
    });

    await step('settings/analysis, prefs, profil, archive, document, marqueur', async () => {
        const st = await page.evaluate(() => window.__store.settings);
        assert.equal(st.analysis.variablesData.prix, 123456);
        assert.equal(st.analysis.activeAssetId, 'asset-B');
        assert.deepEqual({ theme: st.prefs.theme, screens: st.prefs.screens, ownedCompact: st.prefs.ownedCompact, facturesLastAsset: st.prefs.facturesLastAsset }, { theme: 'light', screens: 2, ownedCompact: true, facturesLastAsset: 'oa-test-1' });
        assert.equal(await page.evaluate(() => window.__stub.meta.profile?.income), 45000, 'profil poussé car portfolioMeta.profile vide');
        assert.equal(await page.evaluate(() => window.__store.archives['portefeuille-2026-06-14.json']), EXPORT_RAW, 'archive déposée telle quelle');
        assert.deepEqual(await page.evaluate(() => window.__stub.uploadsAs.map(u => u.filename)), ['facture-1.pdf']);
        assert.deepEqual(st.migration.counts, { etudes: 2, archives: 1, documents: 1 });
        assert.ok(st.migration.doneAt && st.migration.appVersion);
    });

    await step('Continuer → l application démarre avec les données migrées', async () => {
        await page.click('#migration-locale-modal [data-migration-close]');
        await page.waitForSelector('#app-cloud-loading[hidden]', { timeout: 10000 });
        assert.equal(await page.inputValue('#variables-form [name="prix"]'), '123456');
    });

    await step('aucune erreur JS', () => assert.deepEqual(errors, []));
    await context.close();
}

async function scenarioDejaFaite(browser) {
    console.log('\nMigration — marqueur présent → rien ne se passe');
    const { page, context, errors } = await ouvrir(browser, { seedStore: { settings: { migration: { doneAt: 'x', counts: {}, appVersion: '1.0.24' } } } });
    await step('pas de modale, aucune écriture', async () => {
        await page.waitForSelector('#app-cloud-loading[hidden]', { timeout: 10000 });
        assert.equal(await page.$('#migration-locale-modal'), null);
        assert.deepEqual(await page.evaluate(() => window.__store.writes), []);
    });
    await step('aucune erreur JS', () => assert.deepEqual(errors, []));
    await context.close();
}

async function scenarioEcart(browser) {
    console.log('\nMigration — relecture non conforme → pas de marqueur, Réessayer');
    const { page, context, errors } = await ouvrir(browser, { seedStore: { corruptStudiesRead: true }, seedCloud: { meta: { profile: { income: 1 } } } });
    await step('écarts listés, marqueur absent, bouton Réessayer', async () => {
        await page.waitForSelector('#migration-locale-modal [data-migration-retry]', { timeout: 15000 });
        const b = await lireBilan(page);
        assert.match(b.texte, /asset-A|asset-B/);
        assert.match(b.texte, /écart|diff/i);
        assert.equal(await page.evaluate(() => window.__store.settings.migration), undefined);
        assert.equal(await page.evaluate(() => window.__stub.meta.profile.income), 1, 'profil cloud non écrasé');
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/migration-ecarts.png` });
    });
    await step('Réessayer après correction → marqueur écrit', async () => {
        await page.evaluate(() => { window.__store.corruptStudiesRead = false; });
        await page.click('#migration-locale-modal [data-migration-retry]');
        await page.waitForSelector('#migration-locale-modal [data-migration-close]', { timeout: 15000 });
        assert.ok(await page.evaluate(() => window.__store.settings.migration));
    });
    await step('aucune erreur JS', () => assert.deepEqual(errors, []));
    await context.close();
}

async function scenarioRelance(browser) {
    console.log('\nMigration — second passage sur un cloud déjà alimenté (idempotence)');
    const dejaMigre = {
        studies: { 'asset-A': CLOUD_STUDY_A, 'asset-B': { id: 'asset-B', variablesData: { 'nom-bien': 'B locale', prix: 200000, loyer: 900 }, createdAt: 1500, updatedAt: 3000 } },
        archives: { 'portefeuille-2026-06-14.json': EXPORT_RAW }
    };
    const { page, context, errors } = await ouvrir(browser, { seedStore: dejaMigre, seedCloud: { documents: { 'oa-test-1/facture-1.pdf': true } } });
    await step('aucun doublon, archive et document non re-téléversés, marqueur écrit', async () => {
        await page.waitForSelector('#migration-locale-modal [data-migration-close]', { timeout: 15000 });
        assert.equal(await page.evaluate(() => Object.keys(window.__store.archives).length), 1);
        assert.deepEqual(await page.evaluate(() => window.__stub.uploadsAs), []);
        assert.deepEqual(await page.evaluate(() => window.__store.settings.migration.counts), { etudes: 2, archives: 1, documents: 1 });
    });
    await step('aucune erreur JS', () => assert.deepEqual(errors, []));
    await context.close();
}

const browser = await chromium.launch();
try {
    await scenarioNominal(browser);
    await scenarioDejaFaite(browser);
    await scenarioEcart(browser);
    await scenarioRelance(browser);
} finally {
    await browser.close();
}
console.log(getFailures() === 0 ? '\nOK — migration vérifiée' : `\nÉCHEC — ${getFailures()} étape(s) en erreur`);
process.exit(getFailures() === 0 ? 0 : 1);
```

Run: `SPARK_TEST_BASE=http://127.0.0.1:8090 node tests/playwright/migration-locale.mjs`
Expected: `✗ bilan affiché` (module absent → `import()` échoue, toast, l'app démarre sans modale).

- [ ] **Étape 2 : Écrire `migration-locale.js`** (Write)

```js
// Migration unique « stockage local de l'exe → cloud ». Seul l'exe (origine http://127.0.0.1:8080)
// peut lire son propre localStorage et les dossiers exports/ et documents/ servis par server.py :
// main.js ne charge ce module que là (ou avec ?migration-locale=1 pour les tests), après connexion,
// et il ne fait rien si users/{uid}/settings/migration existe déjà. Il pousse, puis RELIT TOUT et
// compare : le marqueur n'est écrit que si tout correspond. Il ne supprime rien en local. À
// supprimer avec son chargement en fin de chantier (spec, point 6).
// Voir docs/superpowers/specs/2026-10-11-passage-tout-web-prompt.md, point 5.
import { escapeHtml } from './utils.js';
import { cloudGetMeta, cloudSaveMeta, cloudGetAllAssets, cloudDocumentExists, cloudUploadDocumentAs } from './owned-cloud.js';
import { cloudGetAllStudies, cloudSetStudy, cloudGetSetting, cloudSetSetting, cloudArchiveMeta, cloudUploadArchive } from './cloud-store.js';
import {
    choisirEtude, comparerProfond, normaliserPourFirestore,
    lireEtudesLocales, lireAnalyseLocale, lirePrefsLocales, lireProfilLocal, lireMetaLocale
} from './migration-regles.js';

const URL_WEB = 'https://spark-investissement.web.app';
const MODAL_ID = 'migration-locale-modal';
const getItem = key => { try { return localStorage.getItem(key); } catch { return null; } };

export async function runLocalMigration({ sanitizeAssetRecord, normaliserVariables }) {
    if (await cloudGetSetting('migration')) return { skipped: true };
    const modale = _ouvrirModale();
    let bilan;
    for (;;) {
        modale.reset();
        bilan = await _migrer({ sanitizeAssetRecord, normaliserVariables }, modale);
        _afficherBilan(modale, bilan);
        const choix = await modale.attendreChoix(); // 'close' | 'retry' | 'skip'
        if (choix !== 'retry') break;
    }
    modale.fermer();
    return bilan;
}

async function _migrer({ sanitizeAssetRecord, normaliserVariables }, modale) {
    const ecarts = [];
    const avertissements = [];
    const attendu = { etudes: {}, analysis: null, prefs: {}, archives: [], documents: [] };

    // 1. Études : fusion avec le cloud, la plus récente gagne (à défaut la locale).
    modale.etape('etudes', 'en cours', 'Lecture des études…');
    const cloudEtudes = await cloudGetAllStudies();
    const locales = lireEtudesLocales(getItem).map(sanitizeAssetRecord).filter(Boolean);
    for (const locale of locales) {
        const gardee = choisirEtude(locale, cloudEtudes[locale.id] || null);
        if (gardee === locale) await cloudSetStudy(locale.id, normaliserPourFirestore(locale));
        attendu.etudes[locale.id] = normaliserPourFirestore(gardee);
    }
    for (const [id, etude] of Object.entries(cloudEtudes)) if (!attendu.etudes[id]) attendu.etudes[id] = etude;
    modale.etape('etudes', 'ok', `${locales.length} étude(s) locale(s) fusionnée(s)`);

    // 2. Réglages : étude en cours + préférences (le cloud, s'il a déjà quelque chose, est plus récent).
    modale.etape('reglages', 'en cours', 'Étude en cours et préférences…');
    const analyseLocale = lireAnalyseLocale(getItem);
    const analyseCloud = await cloudGetSetting('analysis');
    if (analyseLocale && !analyseCloud) {
        attendu.analysis = normaliserPourFirestore({ variablesData: normaliserVariables(analyseLocale.variablesData), activeAssetId: analyseLocale.activeAssetId, updatedAt: Date.now() });
        await cloudSetSetting('analysis', attendu.analysis);
    }
    const prefsLocales = lirePrefsLocales(getItem);
    const prefsCloud = (await cloudGetSetting('prefs')) || {};
    const prefsManquantes = Object.fromEntries(Object.entries(prefsLocales).filter(([k]) => !(k in prefsCloud)));
    if (Object.keys(prefsManquantes).length) await cloudSetSetting('prefs', prefsManquantes);
    attendu.prefs = prefsManquantes;
    // Profil et anciens réglages du portefeuille : seulement si le cloud n'en a pas.
    const meta = await cloudGetMeta();
    const { profil } = lireProfilLocal(getItem);
    const metaLocale = lireMetaLocale(getItem);
    const patchMeta = {};
    if (profil && !meta.profile) patchMeta.profile = normaliserPourFirestore(profil);
    for (const k of ['regime', 'order', 'goals']) if (metaLocale[k] !== undefined && meta[k] === undefined) patchMeta[k] = metaLocale[k];
    if (Object.keys(patchMeta).length) await cloudSaveMeta(patchMeta);
    modale.etape('reglages', 'ok', `${Object.keys(prefsManquantes).length} préférence(s)${patchMeta.profile ? ', profil' : ''} poussé(e)s`);

    // 3. Archives JSON (dossier exports/) → Storage, octets bruts tels quels.
    modale.etape('archives', 'en cours', 'Archives du portefeuille…');
    const fichiers = await _lireListeExports();
    for (const nom of fichiers) {
        const existante = await cloudArchiveMeta(nom);
        const blob = await _lireFichierLocal(`/exports/${encodeURIComponent(nom)}`);
        if (!blob) { avertissements.push(`archive ${nom} illisible localement`); continue; }
        if (!existante) await cloudUploadArchive(nom, blob);
        attendu.archives.push({ nom, taille: blob.size });
    }
    modale.etape('archives', 'ok', `${attendu.archives.length} archive(s)`);

    // 4. Justificatifs PDF manquants dans Storage, relus via l'ancienne route /api/documents.
    modale.etape('documents', 'en cours', 'Justificatifs…');
    const biens = await cloudGetAllAssets();
    for (const [assetId, bien] of Object.entries(biens)) {
        for (const t of (bien.postAchat?.travaux || [])) {
            if (!t.pdfFilename) continue;
            if (!(await cloudDocumentExists(assetId, t.pdfFilename))) {
                const blob = await _lireFichierLocal(`/api/documents/${encodeURIComponent(assetId)}/${encodeURIComponent(t.pdfFilename)}`);
                if (!blob) { avertissements.push(`${bien.nom || assetId} : ${t.pdfFilename} introuvable localement et absent du cloud`); continue; }
                await cloudUploadDocumentAs(assetId, t.pdfFilename, blob);
            }
            attendu.documents.push({ assetId, filename: t.pdfFilename });
        }
    }
    modale.etape('documents', 'ok', `${attendu.documents.length} document(s)`);

    // 5. Relecture complète et comparaison : le marqueur n'est écrit que si tout correspond.
    modale.etape('controle', 'en cours', 'Relecture et comparaison…');
    const relu = await cloudGetAllStudies();
    if (Object.keys(relu).length !== Object.keys(attendu.etudes).length) ecarts.push(`nombre d'études : ${Object.keys(relu).length} relues pour ${Object.keys(attendu.etudes).length} attendues`);
    for (const [id, etude] of Object.entries(attendu.etudes)) {
        if (!comparerProfond(etude, relu[id])) ecarts.push(`étude ${id} : contenu relu différent`);
    }
    if (attendu.analysis && !comparerProfond(attendu.analysis, await cloudGetSetting('analysis'))) ecarts.push('settings/analysis : contenu relu différent');
    const prefsRelues = (await cloudGetSetting('prefs')) || {};
    for (const [k, v] of Object.entries(attendu.prefs)) if (!comparerProfond(v, prefsRelues[k])) ecarts.push(`préférence ${k} : valeur relue différente`);
    for (const a of attendu.archives) {
        const m = await cloudArchiveMeta(a.nom);
        if (!m) ecarts.push(`archive ${a.nom} absente du cloud`);
        else if (m.size !== a.taille) ecarts.push(`archive ${a.nom} : ${m.size} octets relus pour ${a.taille}`);
    }
    for (const d of attendu.documents) {
        if (!(await cloudDocumentExists(d.assetId, d.filename))) ecarts.push(`document ${d.filename} (${d.assetId}) absent du cloud`);
    }
    const counts = { etudes: Object.keys(attendu.etudes).length, archives: attendu.archives.length, documents: attendu.documents.length };
    if (!ecarts.length) {
        const appVersion = await fetch('VERSION', { cache: 'no-store' }).then(r => (r.ok ? r.text() : 'dev')).then(t => t.trim()).catch(() => 'dev');
        await cloudSetSetting('migration', { doneAt: new Date().toISOString(), counts, appVersion }, { merge: false });
        modale.etape('controle', 'ok', 'Tout correspond');
    } else {
        modale.etape('controle', 'erreur', `${ecarts.length} écart(s)`);
    }
    return { ok: !ecarts.length, counts, ecarts, avertissements };
}

async function _lireListeExports() {
    try {
        const res = await fetch('/api/portfolio/import/list');
        if (!res.ok) return [];
        const { files } = await res.json();
        return Array.isArray(files) ? files.filter(f => typeof f === 'string' && f.endsWith('.json')) : [];
    } catch {
        return [];
    }
}

async function _lireFichierLocal(url) {
    try {
        const res = await fetch(url);
        return res.ok ? await res.blob() : null;
    } catch {
        return null;
    }
}

// ─── Modale de progression / bilan (classes .owned-modal-overlay / .owned-modal de styles.css) ──

const ETAPES = [['etudes', 'Études du comparateur'], ['reglages', 'Étude en cours, préférences, profil'], ['archives', 'Archives du portefeuille'], ['documents', 'Justificatifs PDF'], ['controle', 'Relecture et contrôle']];
const SYMBOLE = { attente: '○', 'en cours': '…', ok: '✓', erreur: '✗' };

function _ouvrirModale() {
    document.getElementById(MODAL_ID)?.remove();
    const el = document.createElement('div');
    el.id = MODAL_ID;
    el.className = 'owned-modal-overlay';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Migration vers le cloud');
    document.body.appendChild(el);
    let resoudreChoix = null;
    const modale = {
        reset() {
            el.innerHTML = `
                <div class="owned-modal" style="max-width:560px">
                    <h3>Migration de vos données vers le cloud</h3>
                    <p class="owned-caveat">Dernière étape avant le passage au tout-web. Rien n'est supprimé sur cet ordinateur.</p>
                    <ul data-migration-etapes style="list-style:none;padding:0;margin:12px 0;display:grid;gap:6px">
                        ${ETAPES.map(([id, libelle]) => `<li data-etape="${id}"><span data-symbole>${SYMBOLE.attente}</span> ${libelle} <small data-detail class="owned-caveat"></small></li>`).join('')}
                    </ul>
                    <div data-migration-bilan></div>
                    <div class="owned-modal-actions" data-migration-actions hidden></div>
                </div>`;
        },
        etape(id, statut, detail = '') {
            const li = el.querySelector(`[data-etape="${id}"]`);
            if (!li) return;
            li.querySelector('[data-symbole]').textContent = SYMBOLE[statut] || SYMBOLE.attente;
            li.querySelector('[data-detail]').textContent = detail;
        },
        attendreChoix() {
            return new Promise(resolve => { resoudreChoix = resolve; });
        },
        choisir(valeur) { resoudreChoix?.(valeur); resoudreChoix = null; },
        fermer() { el.remove(); },
        el
    };
    el.addEventListener('click', e => {
        const btn = e.target.closest('[data-migration-close],[data-migration-retry],[data-migration-skip]');
        if (!btn) return;
        modale.choisir(btn.hasAttribute('data-migration-retry') ? 'retry' : btn.hasAttribute('data-migration-skip') ? 'skip' : 'close');
    });
    return modale;
}

function _afficherBilan(modale, bilan) {
    const { el } = modale;
    const zone = el.querySelector('[data-migration-bilan]');
    const actions = el.querySelector('[data-migration-actions]');
    const c = bilan.counts;
    const avert = bilan.avertissements.length
        ? `<p class="owned-caveat">Avertissements (données déjà absentes avant la migration) :</p><ul>${bilan.avertissements.map(a => `<li>${escapeHtml(a)}</li>`).join('')}</ul>`
        : '';
    if (bilan.ok) {
        zone.innerHTML = `
            <p><strong>${c.etudes} étude${c.etudes > 1 ? 's' : ''}, ${c.archives} archive${c.archives > 1 ? 's' : ''}, ${c.documents} document${c.documents > 1 ? 's' : ''}</strong> migrés et vérifiés.</p>
            <p>Ouvrez désormais l'application depuis un favori du navigateur, sur PC comme sur iPhone :<br>
            <a href="${URL_WEB}" target="_blank" rel="noopener">${URL_WEB}</a> (portefeuille seul : <a href="${URL_WEB}/portefeuille" target="_blank" rel="noopener">${URL_WEB}/portefeuille</a>)</p>
            ${avert}`;
        actions.innerHTML = `<button type="button" class="btn btn--primary" data-migration-close>Continuer</button>`;
    } else {
        zone.innerHTML = `
            <p><strong>La relecture ne correspond pas : rien n'a été marqué comme migré.</strong></p>
            <p>Écarts constatés :</p>
            <ul>${bilan.ecarts.map(e => `<li>${escapeHtml(e)}</li>`).join('')}</ul>
            ${avert}`;
        actions.innerHTML = `
            <button type="button" class="btn btn--ghost" data-migration-skip>Ignorer pour cette fois</button>
            <button type="button" class="btn btn--primary" data-migration-retry>Réessayer</button>`;
    }
    actions.hidden = false;
}
```

- [ ] **Étape 3 : Vérifier**

Run: `node --check migration-locale.js && SPARK_TEST_BASE=http://127.0.0.1:8090 ML_SCREENSHOTS=<scratchpad>/shots node tests/playwright/migration-locale.mjs`
Expected: `OK — migration vérifiée` (4 scénarios). Regarder `migration-bilan.png` (liste des 5 étapes cochées, bilan, lien web) et `migration-ecarts.png` (écarts listés, « Réessayer »).

Run: `SPARK_TEST_BASE=http://127.0.0.1:8090 node tests/playwright/tout-web.mjs`
Expected: toujours vert (le module n'est pas chargé sans `?migration-locale=1` ni port 8080).

- [ ] **Étape 4 : CODEBASE_MAP + commit**

Ajouter `## migration-locale.js` (rôle, condition de chargement, 5 étapes, règle « marqueur seulement si relecture conforme », suppression prévue Phase 6) et `## tests/playwright/migration-locale.mjs`.

```bash
git add migration-locale.js tests/playwright/migration-locale.mjs CODEBASE_MAP.md
git commit -m "feat(migration): module unique exe -> cloud, relu et verifie avant marqueur

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Tâche 11 : Zéro `localStorage` vérifié, tests existants adaptés, `firebase.json`, CHANGELOG — fin de Phase 2 (STOP)

**Files:**
- Modify: `tests/playwright/tout-web.mjs` (espion partout + assertion), `tests/playwright/factures-modal.mjs`, `tests/playwright/change-password.mjs`, `tests/playwright/projection-impots.mjs`, `firebase.json`, `CHANGELOG.md`, `CODEBASE_MAP.md`

**Interfaces:**
- Consumes: `STORAGE_SPY_SCRIPT`, `CLOUD_STORE_STUB_SOURCE`, `META_TEST` (harnais).

- [ ] **Étape 1 : Espion activé dans tout `tout-web.mjs`**

Dans chaque scénario de `tout-web.mjs`, retirer `spyStorage: false` (l'espion est actif par défaut) et ajouter avant l'étape « aucune erreur JS » :
```js
    await step('zéro accès localStorage/sessionStorage', async () => {
        assert.deepEqual(await page.evaluate(() => window.__storageHits), []);
    });
```
(pour `scenarioDeuxFenetres`, vérifier aussi `popup`). Run : `SPARK_TEST_BASE=http://127.0.0.1:8090 node tests/playwright/tout-web.mjs` → Expected : tout vert ; si une étape « zéro accès » échoue, la pile affichée dans l'assertion indique la ligne fautive — corriger le **code applicatif**, jamais le test.

Puis `grep -rn "localStorage\|sessionStorage" --include=*.js --exclude-dir=node_modules --exclude-dir=functions --exclude-dir=vendor --exclude-dir=Spark --exclude-dir=graphify-out .` → Expected : uniquement `migration-locale.js` (par conception) et les commentaires historiques d'`owned-portfolio.js`/`rapport-bien.js`.

- [ ] **Étape 2 : Adapter les 3 tests Playwright existants**

Pour chacun de `factures-modal.mjs`, `change-password.mjs`, `projection-impots.mjs` :
1. Ajouter `import { CLOUD_STORE_STUB_SOURCE, META_TEST } from './_harness.mjs';`.
2. Dans leur `openPage`/ouverture de page : supprimer le `context.addInitScript(() => { localStorage.setItem('investissementWebProfileConfigured', '1'); … })` et ajouter `await page.route('**/cloud-store.js', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: CLOUD_STORE_STUB_SOURCE }));`.
3. Dans leur `STUB_SOURCE` local, compléter `meta` avec le profil (`profile: { name: 'Test', income: 40000, adults: 1, children: 0, revenuHistorique: [], objectifCF: 1000, revaloAnnuelle: 2, autresCredits: [] }`) et ajouter les exports manquants : `export async function cloudGetMeta() { return clone(S.meta); }`, `export async function cloudGetAllAssets() { return clone(S.assets); }`, `export async function cloudDocumentExists() { return false; }` ; faire notifier `cloudSaveMeta` (`S.metaListeners`) comme dans le harnais.
4. Les attentes `page.waitForFunction(() => window.__stub && …)` restent valables ; ajouter, après le `goto`, `await page.waitForSelector('#app-cloud-loading[hidden]')` pour `index.html`.
5. Mettre à jour l'en-tête de chaque fichier : prérequis `node scripts/serve-static.mjs 8090` au lieu de `python server.py`.

Run : les trois fichiers avec `SPARK_TEST_BASE=http://127.0.0.1:8090` → Expected : `OK` pour chacun (si `change-password.mjs` ou `projection-impots.mjs` échoue sur un sélecteur, lire l'échec : c'est soit un oubli d'export dans le stub, soit un vrai bug de régression à corriger côté code).

- [ ] **Étape 3 : `firebase.json`** (Edit) — dans `hosting.headers`, ajouter :
```json
      {
        "source": "/VERSION",
        "headers": [
          { "key": "Cache-Control", "value": "no-cache, max-age=0, must-revalidate" },
          { "key": "Content-Type", "value": "text/plain; charset=utf-8" }
        ]
      }
```

- [ ] **Étape 4 : `CHANGELOG.md`** (Edit, sous `## [Unreleased]`)

`### Changed` : « Passage au tout-web : l'application s'ouvre depuis un favori du navigateur (https://spark-investissement.web.app, PC et iPhone) ; toutes les données (études du comparateur, étude en cours, préférences, portefeuille) vivent dans Firestore/Storage sous `users/{uid}/`, plus rien en `localStorage` ; connexion obligatoire pour toute l'app ; PDF (décision, dossier bancaire, rapport d'un bien) imprimés depuis la page elle-même ; export du portefeuille = téléchargement + archive cloud, import depuis une archive ou un fichier. » `### Added` : « Migration unique des données locales de l'exe vers le cloud (`migration-locale.js`, version 1.0.24 de l'exe), relue et vérifiée avant d'être marquée faite. » `### Removed` (annoncé pour la Phase 6) : exe/serveur Flask/chaîne de build.

- [ ] **Étape 5 : Suite complète + commit**

Run: `npm run verify` → Expected : syntaxe OK + 13 fichiers de tests verts. Run les 5 fichiers Playwright → tous `OK`. Regarder une dernière fois toutes les captures `<scratchpad>/shots/*.png` (Read) : gate, prefs, études, import, impression, migration (bilan + écarts) — à 1366 px et 393 px.

```bash
git add tests/playwright firebase.json CHANGELOG.md CODEBASE_MAP.md
git commit -m "test(web): espion localStorage sur toute la session, tests existants sur les deux stubs, VERSION sans cache

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Étape 6 : STOP — compte rendu à l'utilisateur (en français, bref)**

Ce qui est fait (Tâches 0-11), ce qui a été vérifié et comment (`npm run verify`, 5 fichiers Playwright PC + iPhone, captures regardées), ce qui reste (Phases 3 à 6), anomalies (tests qui ont échoué, étapes sautées, bugs hors périmètre notés). Mentionner : `ownedPieYear`/`ownedPieMonth` sont migrés mais plus lus par aucun code (clés mortes) ; `build.bat` incrémente lui-même `VERSION` → la Phase 3 ne la touche pas à la main. **Attendre l'utilisateur.**

---

# Phase 3 — Exe de migration (après accord)

### Tâche 12 : Construire `Spark-1.0.24.exe` et vérifier son contenu

**Files:**
- Lecture seule : `build.bat`, `VERSION` (incrémentée par le build : 1.0.23 → 1.0.24), `Spark/`

- [ ] **Étape 1 : Pré-vérifications**

Run: `cat VERSION` → `1.0.23`. Run: `git status --short` → arbre propre sur `feat/tout-web`. Run: `python -c "import PyInstaller, PIL, flask, webview, pystray; print('deps OK')"` → `deps OK` (sinon s'arrêter et le dire : les dépendances de build sont celles de l'utilisateur, ne pas installer sans accord).

- [ ] **Étape 2 : Build** (le script `pause` en fin de route sans cette variable ; `verify.bat` est appelé en interne avec `CALLED_FROM_BUILD`)

Run (PowerShell, timeout 600000) : `$env:CALLED_FROM_UPDATE_RUN = '1'; cmd /c build.bat`
Expected: `Verification OK`, `Nouvelle version : 1.0.24`, `Build termine !`, `Executable : Spark\Spark-1.0.24.exe`.

- [ ] **Étape 3 : Contrôle du contenu — piège déjà rencontré (build vert mais `.js` manquants)**

Run: `ls Spark/*.js | sort` et comparer à `ls *.js | sort` (racine) → mêmes 12 fichiers, dont `cloud-store.js`, `migration-regles.js`, `migration-locale.js`. Run: `cat Spark/VERSION` → `1.0.24`. Run: `ls Spark/vendor/pdfjs Spark/vendor/leaflet` → fichiers présents. Run: `grep -c "migration-locale" Spark/main.js` → `≥ 1`.

- [ ] **Étape 4 : Commit de version**

```bash
git add VERSION CHANGELOG.md
git commit -m "chore(build): version 1.0.24 (exe de migration vers le cloud)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
(déplacer au besoin l'entrée `[Unreleased]` du CHANGELOG sous `## [1.0.24] - 2026-10-11`.)

- [ ] **Étape 5 : STOP — consignes à l'utilisateur**

Lui demander de : (1) fermer Revit ou son plugin MCP (qui tient le port 8080 — vérifier avec `netstat -ano | findstr ":8080 "` que plus rien n'écoute) ; (2) lancer `Spark\Spark-1.0.24.exe` **une fois**, se connecter, laisser la modale « Migration de vos données vers le cloud » aller au bout ; (3) rapporter le bilan affiché (nombre d'études/archives/documents, ou la liste des écarts). Ne jamais lancer l'exe soi-même. **Attendre l'utilisateur.**

---

# Phase 4 — Contrôle (après bilan annoncé réussi)

### Tâche 13 : Relire `settings/migration` et compter `studies/` dans un vrai navigateur

**Files:**
- Create: `scripts/controle-migration.mjs`
- Modify: `CODEBASE_MAP.md`

- [ ] **Étape 1 : Écrire le script** (Write) — lecture seule, l'utilisateur tape lui-même son mot de passe dans la fenêtre (jamais dans le script).

```js
// scripts/controle-migration.mjs — Phase 4 du passage au tout-web : relit settings/migration, compte les
// études et liste les archives, dans un vrai Chromium (SDK Firebase réel, aucune dépendance npm
// supplémentaire). L'utilisateur se connecte lui-même dans la fenêtre ouverte. Lecture seule.
// Prérequis : `node scripts/serve-static.mjs 8090`. Lancer : node scripts/controle-migration.mjs
import { chromium } from 'playwright';

const BASE = process.env.SPARK_TEST_BASE || 'http://127.0.0.1:8090';
const browser = await chromium.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
await page.goto(`${BASE}/index.html`, { waitUntil: 'load' });
console.log('Connectez-vous dans la fenêtre ouverte (5 minutes max)…');
await page.waitForFunction(async () => (await import('./firebase-init.js')).auth.currentUser !== null, null, { timeout: 300000, polling: 1000 });
const resultat = await page.evaluate(async () => {
    const store = await import('./cloud-store.js');
    const [migration, studies, analysis, prefs, archives] = await Promise.all([
        store.cloudGetSetting('migration'), store.cloudGetAllStudies(), store.cloudGetSetting('analysis'), store.cloudGetSetting('prefs'), store.cloudListArchives()
    ]);
    return {
        migration,
        nbEtudes: Object.keys(studies).length,
        etudes: Object.values(studies).map(s => ({ id: s.id, nom: s.variablesData?.['nom-bien'], updatedAt: new Date(s.updatedAt).toISOString() })),
        analysis: analysis ? { nom: analysis.variablesData?.['nom-bien'], activeAssetId: analysis.activeAssetId } : null,
        prefsKeys: Object.keys(prefs || {}),
        archives: archives.map(a => `${a.name} (${a.size} o)`)
    };
});
console.log(JSON.stringify(resultat, null, 2));
await browser.close();
```

- [ ] **Étape 2 : Exécuter et comparer au bilan rapporté**

Run: `node scripts/controle-migration.mjs` (l'utilisateur se connecte) → Expected : `migration.counts` identique au bilan de l'exe, `nbEtudes === counts.etudes`, archives = `portefeuille-2026-06-14.json` + `portefeuille-2026-07-29.json`. Commit du script (`chore(controle): script de relecture post-migration`).

- [ ] **Étape 3 : STOP** — demander à l'utilisateur de vérifier la version web servie en local (`http://127.0.0.1:8090/index.html` et `/owned.html`) : ses études dans le comparateur, l'étude en cours, le thème, le portefeuille, un export PDF. **Attendre son retour.**

---

# Phase 5 — Déploiement (sur accord explicite)

### Tâche 14 : `firebase deploy --only hosting`

- [ ] **Étape 1 :** Confirmer l'accord explicite de l'utilisateur **dans ce tour**. Run: `firebase deploy --only hosting --project spark-investissement` (functions et règles inchangées, ne pas les déployer).
- [ ] **Étape 2 :** `curl -s https://spark-investissement.web.app/VERSION` → `1.0.24` ; `curl -sI https://spark-investissement.web.app/VERSION | grep -i cache-control` → `no-cache`.
- [ ] **Étape 3 : STOP** — l'utilisateur vérifie sur l'URL Firebase, PC et iPhone (sur iPhone : bouton ⟳ de `owned.html` pour forcer la nouvelle version). **Attendre son retour.**

---

# Phase 6 — Nettoyage (après migration vérifiée et déploiement validé)

### Tâche 15 : Supprimer l'exe, Flask et la chaîne de build

**Files:**
- Delete (git) : `app.py`, `server.py`, `build.bat`, `spark.spec`, `requirements.txt`, `config.example.py`, `Lancer.bat`, `update-and-run.bat`, `spark.ico`, `verify.bat`, `tests/test_server_api.py`, `migration-locale.js`
- Delete (disque, non versionnés) : `Spark/`, `build/`, `__pycache__/`, `tests/__pycache__/`, `Spark-*.zip`, `geocache.json`, `.pytest_cache/`
- Modify: `main.js` (chargement de la migration), `tests/playwright/migration-locale.mjs` → supprimer, `tests/playwright/_harness.mjs` (exports devenus inutiles : `cloudGetMeta`/`cloudGetAllAssets`/`cloudDocumentExists` restent dans owned-cloud.js, donc dans le stub), `firebase.json`, `.gitignore`, `.claudeignore`, `package.json`, `CLAUDE.md`, `CODEBASE_MAP.md`, `CHANGELOG.md`

- [ ] **Étape 1 : Code** — dans `main.js`, supprimer `MIGRATION_LOCALE_ACTIVE` et le bloc `if (MIGRATION_LOCALE_ACTIVE && !IS_ANALYSIS_WINDOW) { … }` de `_initCloud`. `git rm migration-locale.js tests/playwright/migration-locale.mjs`. Garder `migration-regles.js` (`nomArchiveUnique` sert à l'export) mais y retirer les lecteurs `lire*Locales`/`choisirEtude`/`comparerProfond`/`normaliserPourFirestore` **et** leurs tests, puis le renommer `archives-regles.js` (`git mv`) avec `tests/test_archives_regles.mjs` ; mettre à jour l'import dans `owned-portfolio.js`. Dans `owned-cloud.js`, retirer `cloudGetMeta`/`cloudGetAllAssets`/`cloudDocumentExists`/`cloudUploadDocumentAs` (plus d'appelant — vérifier par grep) et les retirer des stubs.

- [ ] **Étape 2 : Fichiers** —
```bash
git rm app.py server.py build.bat spark.spec requirements.txt config.example.py Lancer.bat update-and-run.bat spark.ico verify.bat tests/test_server_api.py
rm -rf Spark build __pycache__ tests/__pycache__ .pytest_cache geocache.json Spark-*.zip
```
`config.py` reste (gitignoré, l'utilisateur le supprimera). `exports/`, `documents/`, `%APPDATA%\pywebview` : **ne pas toucher** — proposer leur suppression à l'utilisateur dans le compte rendu, agir seulement sur feu vert explicite.

- [ ] **Étape 3 : Config** — `firebase.json` : retirer de `ignore` `.pytest_cache/**`, `**/__pycache__/**`, `dist/**`, `build/**`, `Spark/**`, `Spark-*/**`, `*.spec`, `*.bat`, `*.zip`, `*.ico`, `geocache.json` ; **garder** `*.py`, `exports/**`, `documents/**`, `*.txt` (défense en profondeur : `config.py`, données réelles). `.gitignore` : retirer le bloc Python/build, garder `config.py`, `exports/`, `documents/`, `node_modules/`, `.firebase/`, `graphify-out/`, `.superpowers/`, `.worktrees/`. `.claudeignore` : retirer `Spark/`, `build/`, Python. `package.json` : description sans « app desktop ».

- [ ] **Étape 4 : Documentation** — `CLAUDE.md` : Project Overview (application web Firebase Hosting, plus d'exe ; « To run in development: `npm run serve` puis http://127.0.0.1:8090/index.html ») ; tableau Architecture sans `app.py`/`server.py`/`spark.spec`/`build.bat`, avec `cloud-store.js`, `archives-regles.js`, `scripts/` ; section Testing réécrite (serveur statique 8090, stubs `owned-cloud.js` **et** `cloud-store.js` via `tests/playwright/_harness.mjs`, `npm test` fonctionne sous Windows, retirer le « port trap » de l'exe en gardant l'avertissement « jamais sur 8080 ») ; Important conventions : « aucun `localStorage`/`sessionStorage` : tout passe par `cloud-store.js`/`owned-cloud.js`, écriture uniquement sur action utilisateur ». `CODEBASE_MAP.md` : supprimer les sections des fichiers retirés, mettre à jour `VERSION` (lu par `main.js` via `fetch`), `firebase.json`, `package.json`. `CHANGELOG.md` : `### Removed` effectif.

- [ ] **Étape 5 : Vérification finale**

Run: `npm run verify` → vert. Run: `SPARK_TEST_BASE=http://127.0.0.1:8090 node tests/playwright/tout-web.mjs` + les 3 autres fichiers → `OK`. Run: `grep -rn "server.py\|app.py\|build.bat\|/api/\|IS_LOCAL_APP\|localStorage" --include=*.js --include=*.html --include=*.md --exclude-dir=node_modules --exclude-dir=functions --exclude-dir=vendor --exclude-dir=graphify-out --exclude-dir=docs .` → seules des mentions historiques dans `CHANGELOG.md`/`CODEBASE_MAP.md` (notes datées) ou des commentaires « avant le passage au tout-web » doivent rester ; aucune dans le code. `firebase deploy --only hosting --dry-run` n'existe pas : vérifier plutôt `firebase hosting:channel:deploy test --expires 1h --project spark-investissement` **seulement si l'utilisateur l'accepte**, sinon s'en passer.

- [ ] **Étape 6 : Commit final + STOP**

```bash
git add -A
git commit -m "chore(web): suppression de l exe, du serveur Flask et de la chaine de build (tout-web)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
Compte rendu final : ce qui a été supprimé, ce qui reste à la main de l'utilisateur (`config.py`, `exports/`, `documents/`, `%APPDATA%\pywebview`, raccourci bureau « Spark Investissement.lnk »), proposition de fusion dans `master` (skill `superpowers:finishing-a-development-branch`) et de `git push` **uniquement s'il le demande**. Mettre à jour la mémoire (`project_launcher_et_portage_scf.md` : plus de launcher ; `feedback_verify_in_app.md` : serveur statique 8090 + deux stubs).

---

## Auto-revue du plan (faite à la rédaction)

- **Couverture spec** : point 1 (modèle) → T2 ; point 2 (synchro, débounce, aucune écriture au chargement, deux fenêtres) → T5-T7 ; point 3 (connexion obligatoire) → T4-T5 ; point 4 (PDF T3, `.md` T3, export/import T9, version T5, ancienne migration T4) ; point 5 (migration) → T10, exe T12, contrôle T13 ; point 6 (nettoyage) → T15 ; `<verification>` (tests Playwright PC + iPhone, espion, migration, captures) → T3-T11.
- **Placeholders** : aucun `TBD`/`à compléter` ; chaque étape de code a son code. Les deux provisoires explicites (`_startStudiesAndAnalysis`/`_reconcileActiveAsset` vides en T5, `saveVariablesData(){}` en T5) sont remplacés en T6 et signalés comme tels.
- **Cohérence des noms** : `renderAuthGateInto` (T4 → T5), `_downloadOrShareFile` (T3 → T9), `nomArchiveUnique` (T1 → T9/T10), `cloudArchiveMeta` (T2 → T10, stub T3), `state.facturesLastAsset` (T5/T8), `waitAppStarted` sur `#app-cloud-loading[hidden]` (T4 → tous), `__store.writes` / `__stub.metaWrites` (stub T3 → T5/T8/T10), `data-migration-close/retry/skip` (T10 code ↔ test).
- **Review Focus** : 1 → T6 étape « snapshot distant plus ancien pendant la frappe » ; 2 → T5 « AUCUNE écriture cloud » et T8 ; 3 → T9 « Storage en panne » ; 4 → T9 « fichier invalide » ; 5 → T10 `scenarioRelance` ; 6 → T3 « deux impressions successives ».
