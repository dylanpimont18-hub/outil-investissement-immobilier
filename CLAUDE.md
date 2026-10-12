# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Navigation

`CODEBASE_MAP.md` à la racine liste le rôle et les fonctions clés de chaque fichier source. Consulte-le pour savoir où écrire avant d'ouvrir un fichier.

**Règle de mise à jour :** à la fin de chaque tâche où tu as modifié des fichiers, mets à jour les entrées correspondantes dans `CODEBASE_MAP.md` (uniquement les fichiers modifiés). Si tu as ajouté une nouvelle fonction ou supprimé une existante, reflète-le dans la liste de ce fichier.

## Project Overview

Application web d'analyse d'investissement immobilier (en français), hébergée sur Firebase Hosting (https://spark-investissement.web.app, PC et iPhone). Toutes les données vivent dans Firestore/Storage sous `users/{uid}/`, connexion obligatoire (Firebase Auth). Il n'y a plus d'exe de bureau, de serveur Flask ni de chaîne de build (supprimés le 2026-10-12, passage au tout-web) : les fichiers de la racine sont servis tels quels.

Pour lancer en développement : `npm run serve` puis ouvrir http://127.0.0.1:8090/index.html (ou `/owned.html` pour la page iPhone).
Pour publier : `firebase deploy --only hosting` (et `--only functions` pour les Cloud Functions de `functions/`).

## Architecture

| Fichier | Rôle |
|---|---|
| `index.html` | Structure HTML complète, tous les panneaux et formulaires pré-déclarés |
| `owned.html` / `owned-entry.js` | Page iPhone : sous-ensemble portefeuille, bootstrap dédié (`IS_MOBILE_PAGE`) |
| `main.js` | Shell de l'app : état, câblage DOM, synchro entre fenêtres, onglet Analyse + comparateur, démarrage cloud (`_initCloud`). Délègue le portefeuille à `owned-portfolio.js` |
| `owned-portfolio.js` | Module portefeuille biens détenus (CRUD, liste/détail, dashboard, modales). Reçoit `state`/`nodes` de `main.js` par référence via `initOwnedPortfolio(deps)`, appelée avant le premier `render()` |
| `owned-cloud.js` | Wrapper Firebase du portefeuille (Auth, `ownedAssets`, `portfolioMeta`, justificatifs Storage, appels aux Cloud Functions IA) |
| `cloud-store.js` | Wrapper Firebase des données hors portefeuille : études du comparateur, réglages (`settings/analysis`, `settings/prefs`), archives JSON du portefeuille |
| `firebase-init.js` | Initialisation du SDK Firebase (auth, db, storage, functions) |
| `archives-regles.js` | Règle pure de nommage des archives d'export (`nomArchiveUnique`) |
| `utils.js` | Helpers partagés formatage/échappement/toast, sans dépendance à `state`/`nodes` |
| `calculs.js` | Moteur financier pur — tous les calculs, zéro accès DOM |
| `pdf.js` | Génère le PDF de décision comme une page HTML autonome (imprimée depuis la page) |
| `rapport-bien.js` | Module pur : rapport d'un bien détenu en HTML imprimable (courbes SVG) et en Markdown (export IA) |
| `assistant-chat.js` | Onglet Assistant IA (chat), via la Cloud Function `chatPortefeuille` |
| `styles.css` | Design system complet (thèmes clair/sombre, toutes les classes de composants) |
| `ui.js` | Helpers d'interface (graphiques, tableaux) |
| `functions/` | Cloud Functions (IA, extraction de factures, changement de mot de passe), secret `MAMMOUTH_API_KEY` |
| `scripts/` | Outillage Node de dev : `run-tests.mjs` (`npm test` / `npm run verify`), `serve-static.mjs` (`npm run serve`, port 8090), `controle-migration.mjs` (relecture post-migration, lecture seule) |
| `firebase.json` | Config Hosting (fichiers exclus du déploiement, en-têtes `Cache-Control`), Firestore, Storage, Functions |

### Data flow — analysis tool

1. User edits the form in `index.html`
2. `main.js` reads form values → calls `sanitizeVariablesData()` → writes to `state.variablesData`, then saves to Firestore (`settings/analysis`) with a 1.5 s debounce
3. On any change, `main.js` calls `computeAnalysisViewModel()` from `calculs.js`, which returns a fully computed view model
4. `main.js` renders that view model into the pre-declared DOM containers via `innerHTML` injection

### Two-window mode

The app supports a split-screen mode where the analysis panel opens in a second popup window (`?panel=analysis`). State synchronizes between windows via `BroadcastChannel`. The `IS_ANALYSIS_WINDOW` flag in `main.js` controls which panels are shown.

### Key state shape (`state` object in `main.js`, passed by reference into `owned-portfolio.js`)

- `variablesData` — current study inputs (all form fields, sanitized)
- `assetRecords[]` — saved comparator studies only (draft/candidate deals under analysis, unrelated to the owned portfolio)
- `activeAssetId` — which saved comparator record is currently loaded
- `ownedAssets`, `activeOwnedAssetId`, `ownedOrder`, `ownedCompact`, `ownedYearFilters`, `ownedLoyerPage` — owned-portfolio state, read/written by `owned-portfolio.js`
- `profileData` — household profile (income, adults, children) used for tax calculations
- `theme`, `screens` — UI preferences

### Financial engine (`calculs.js`)

- `computeAnalysisViewModel(inputs)` — main entry point for single-asset analysis; returns all metrics, decisions, scenarios, charts data
- `computeCF(prixVendeur, loyer, inputs, tmi)` — core net-net cash-flow function used throughout
- `computeProjectMetrics(inputs)` — per-asset KPIs (rentaBrute, rentaNette, dscr, grm, coc…)
- `computeResaleTimeline(...)` — resale gain projection (used in `pdf.js`)
- `computeOwnedAssetCF`, `computeOwnedAssetTimeline`, `computeCFBreakdown`, `computeRegimeComparison`, `computePortfolioAlerts`, etc. — owned-portfolio-specific, imported by `owned-portfolio.js`
- Tax logic handles three regimes: `micro-foncier`, `reel` (foncier réel), `sci-is`

### Decision model (analysis tool)

The acquisition decision is a composite score (0–100) built from: cash-flow, DSCR, net-net yield, price vs. offer ceiling, hypothesis confidence score, and stress-test results. Thresholds are user-configurable (`seuil-*` form fields). Decision tones: `excellent` → `positive` → `neutral` → `watch` → `negative`.

## Design system

The visual identity is documented in `charte_graphique.txt`. Key points:
- Fonts: Cormorant Garamond (display), IBM Plex Mono (data/numbers), Manrope (body)
- Accent color: `#C5A059` (light) / `#D4AF37` (dark) — gold
- Status tones map to CSS class suffixes: `--positive`, `--excellent`, `--watch`, `--negative`, `--neutral`
- Spacing is a 4px grid; corner radii: 8px (components), 12px (cards)
- Both themes are applied via `data-theme="light|dark"` on `<html>`

## Testing

- **Tests unitaires** (`tests/*.mjs`) — fonctions pures (`calculs.js`, `rapport-bien.js`, `archives-regles.js`), sans framework : `node:assert/strict` + `console.log`. Un fichier : `node tests/xxx.mjs` ; tous : `npm test` ; syntaxe des modules racine + tous les tests : `npm run verify`. Les deux passent par `scripts/run-tests.mjs` et fonctionnent sous Windows (cmd.exe, PowerShell, Git Bash). Toujours lancer la suite complète avant d'affirmer qu'une modification de `calculs.js` est correcte.
- **Tests navigateur (Playwright)** — installé le 2026-08-04 (`npm install`, navigateur via `npx playwright install chromium`) pour vérifier qu'un changement d'interface marche *réellement* dans un vrai navigateur : la relecture statique a déjà laissé passer un vrai bug (un `if (IS_MOBILE_PAGE) { ...; return; }` préexistant sautait silencieusement le code ajouté après lui, invisible dans le diff, révélé seulement en cliquant dans la page rendue).
  - Serveur : `npm run serve` (serveur statique `scripts/serve-static.mjs`, http://127.0.0.1:8090, mêmes réécritures que Hosting). **Jamais sur le port 8080.** Vérifier qu'il sert bien le code courant (`curl -s http://127.0.0.1:8090/VERSION`).
  - L'app exige Firebase Auth + un vrai compte Firestore, qu'un test n'a pas. **Ne jamais se connecter pour de vrai** : `tests/playwright/_harness.mjs` intercepte les DEUX modules cloud, `owned-cloud.js` (`OWNED_CLOUD_STUB_SOURCE`) et `cloud-store.js` (`CLOUD_STORE_STUB_SOURCE`), et sert des stubs alimentés par `seedCloud`/`seedStore`. Un stub doit exporter exactement les fonctions du module réel (un export manquant casse l'import sans erreur claire). Le code réel de l'app (`main.js`, `owned-portfolio.js`, `calculs.js`…) tourne ainsi dans un vrai Chromium sans toucher au vrai projet Firebase ni aux vraies données.
  - Le harnais fournit `openPage(browser, path, { viewport, seedCloud, seedStore, spyStorage, routes, initScripts })`, `waitAppStarted`, `step`, `getFailures` ; l'espion `localStorage`/`sessionStorage` vérifie qu'aucun accès n'a lieu ; `page.on('pageerror'/'console')` collecte les erreurs JS.
  - Tests de référence (hors `npm test`, ils demandent le serveur + Chromium) : `tests/playwright/tout-web.mjs`, `factures-modal.mjs`, `change-password.mjs`, `projection-impots.mjs`. Lancer avec `SPARK_TEST_BASE=http://127.0.0.1:8090 node tests/playwright/<fichier>.mjs` ; `FM_SCREENSHOTS=<dir>` / `PI_SCREENSHOTS=<dir>` enregistrent des captures PNG pour contrôler le rendu.
  - Viewport `{ width: 393, height: 852 }` pour approcher un iPhone (`owned.html`, comportement `IS_MOBILE_PAGE`).
  - Outillage de dev local uniquement — `node_modules/`, `tests/` et `scripts/` sont gitignorés ou exclus du déploiement (`firebase.json`) ; ne jamais compter dessus en production.

## Important conventions

- All user-facing text is in French.
- HTML is built via template literals in `main.js`/`owned-portfolio.js` — always run user content through `escapeHtml()` (from `utils.js`) before injecting.
- New form fields require entries in: `VARIABLE_DEFAULTS`, `VARIABLE_KEYS` (derived), `sanitizeVariablesData()`, and the corresponding `<fieldset>` in `index.html`.
- `calculs.js` exports are pure functions — keep them free of DOM, `localStorage`, and `window` references.
- `computeAnalysisViewModel` is called on every keystroke; keep it synchronous and fast.
- Aucun `localStorage`/`sessionStorage` : tout passe par `cloud-store.js`/`owned-cloud.js`, écriture uniquement sur action utilisateur (rien n'est écrit dans le cloud au chargement).
- Les fonctions IA (diagnostic du portefeuille, Assistant chat, extraction de factures et de dossiers) tournent en Cloud Functions Firebase (`functions/index.js`) qui lisent le secret `MAMMOUTH_API_KEY` ; aucune configuration locale n'est nécessaire (l'ancien `config.py` n'est plus lu par aucun code et ne doit jamais être versionné).
