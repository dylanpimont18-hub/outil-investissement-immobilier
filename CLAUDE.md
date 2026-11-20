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
| `main.js` | Shell de l'app : état, câblage DOM, onglet Analyse + comparateur, démarrage cloud (`_initCloud`). Délègue le portefeuille à `owned-portfolio.js` |
| `owned-portfolio.js` | Module portefeuille biens détenus (CRUD, liste/détail, dashboard, modales). Reçoit `state`/`nodes` de `main.js` par référence via `initOwnedPortfolio(deps)`, appelée avant le premier `render()` |
| `owned-contexte.js` | `state`, `nodes`, `IS_MOBILE_PAGE` du portefeuille en liaisons vivantes (renseignés une fois par `definirContexte`) : les modules du portefeuille les importent au lieu de les recevoir en paramètre |
| `owned-rapports.js` | Portefeuille — dossier bancaire, rapport d'un bien, rapport annuel (découpage T7 d'`owned-portfolio.js`) |
| `owned-fiscal.js` | Portefeuille — modales fiscales : compte de résultat, simulation de travaux, projection des impôts, capacité d'emprunt, objectifs, déclaration 2044 |
| `owned-fichiers.js` | Portefeuille — utilitaires justificatifs : formats/tailles, base64, pdf-lib/pdf.js paresseux, PDF → image, filtrage d'un lot de fichiers |
| `owned-factures.js` | Portefeuille — impression groupée des factures, modale « Ajouter des factures » (lecture IA par lot), import d'un dossier de documents |
| `owned-travaux.js` | Portefeuille — onglet Travaux : liste des frais, vue « Par corps d'état » (décorticage IA), édition d'un frais, aperçu d'un justificatif |
| `owned-profil.js` | Portefeuille — onglets Impôt et Profil : impôt du foyer, revenus historisés, foyer, autres crédits, changement du mot de passe |
| `owned-diagnostic.js` | Portefeuille — tiroir du diagnostic IA, historique, appel de la Cloud Function |
| `owned-liste.js` | Portefeuille — vue liste : dashboard dirigeant, carte Leaflet, graphiques de synthèse, tableau/liste des biens, import d'archives |
|  | Portefeuille — onglet Acquisition d'un bien : données, prix, crédit, localisation |
|  | Portefeuille — onglet Exploitation d'un bien : loyers, lots, charges annuelles, notes, scénarios |
|  | Portefeuille — onglet Calcul d'un bien : indicateurs, décomposition du CF, régimes, flux annuels |
| `owned-cloud.js` | Wrapper Firebase du portefeuille (Auth, `ownedAssets`, `portfolioMeta`, justificatifs Storage, appels aux Cloud Functions IA) |
| `cloud-store.js` | Wrapper Firebase des données hors portefeuille : études du comparateur, réglages (`settings/analysis`, `settings/prefs`), archives JSON du portefeuille |
| `firebase-init.js` | Initialisation du SDK Firebase (auth, db, storage, functions) |
| `archives-regles.js` | Règle pure de nommage des archives d'export (`nomArchiveUnique`) |
| `icones.js` | Module pur : les 30 icônes SVG de l'interface (trait 1,5 px, `currentColor`), `icone(nom)`, `hydraterIcones()` (`<i data-icone>` du HTML), `definirTexteAvecIcone()` ; jamais d'emoji ni de glyphe comme icône |
| `utils.js` | Helpers partagés formatage/échappement/toast, sans dépendance à `state`/`nodes` |
| `calculs.js` | Moteur financier pur — tous les calculs, zéro accès DOM |
| `pdf.js` | Génère le PDF de décision comme une page HTML autonome (imprimée depuis la page) |
| `factures-pdf.js` | Module pur : impression groupée des factures (sélection, récapitulatif, PDF unique assemblé avec pdf-lib vendorisé dans `vendor/pdf-lib/`) |
| `corps-etat.js` | Module pur : factures décortiquées par corps d'état (liste des 12 corps d'état, nettoyage des articles lus par l'IA, regroupement, écarts, reclassement) pour la sous-vue « Par corps d'état » de l'onglet Travaux |
| `rapport-bien.js` | Module pur : rapport d'un bien détenu en HTML imprimable (courbes SVG) et en Markdown (export IA) |
| `rapport-annuel.js` | Module pur : rapport annuel du portefeuille (trésorerie, fiscalité, patrimoine, par bien), en données et en texte brut ; ouvert par `openRapportAnnuelModal` (`owned-portfolio.js`) |
| `assistant-chat.js` | Onglet Assistant IA (chat), via la Cloud Function `chatPortefeuille` |
| `styles.css` | Design system complet (thèmes clair/sombre, toutes les classes de composants) |
| `vendor/` | Bibliothèques et polices copiées en local : `pdf-lib/`, `pdfjs/`, `leaflet/`, `chartjs/` (Chart.js 4.4.0, licence MIT jointe), `fonts/`. Seul le SDK Firebase vient encore d'un CDN (gstatic) |
| `VERSION` / `CHANGELOG.md` | Numéro de version (lu par `main.js`) et journal des versions |
| `charte_graphique.txt` | Identité visuelle (polices, couleurs, icônes) |
| `RESUME_PROJET.txt` | Résumé fonctionnel du projet pour un lecteur extérieur (non déployé) |
| `logo-48.png` / `logo-180.png` | Logo d'en-tête et icône d'écran d'accueil iPhone (`Logo_site.png`, source lourde, n'est pas déployé) |
| `ui.js` | Helpers d'interface (graphiques, tableaux) |
| `functions/` | Cloud Functions (IA, extraction de factures, changement de mot de passe), secret `MAMMOUTH_API_KEY` |
| `scripts/` | Outillage Node de dev : `run-tests.mjs` (`npm test` / `npm run verify`), `serve-static.mjs` (`npm run serve`, port 8090), `controle-migration.mjs` (relecture post-migration, lecture seule) |
| `firebase.json` | Config Hosting (fichiers exclus du déploiement, en-têtes `Cache-Control`), Firestore, Storage, Functions |

### Data flow — analysis tool

1. User edits the form in `index.html`
2. `main.js` reads form values → calls `sanitizeVariablesData()` → writes to `state.variablesData`, then saves to Firestore (`settings/analysis`) with a 1.5 s debounce
3. On any change, `main.js` calls `computeAnalysisViewModel()` from `calculs.js`, which returns a fully computed view model
4. `main.js` renders that view model into the pre-declared DOM containers via `innerHTML` injection

### Key state shape (`state` object in `main.js`, passed by reference into `owned-portfolio.js`)

- `variablesData` — current study inputs (all form fields, sanitized)
- `assetRecords[]` — saved comparator studies only (draft/candidate deals under analysis, unrelated to the owned portfolio)
- `activeAssetId` — which saved comparator record is currently loaded
- `ownedAssets`, `activeOwnedAssetId`, `ownedOrder`, `ownedCompact`, `ownedYearFilters`, `ownedLoyerPage` — owned-portfolio state, read/written by `owned-portfolio.js`
- `profileData` — household profile (income, adults, children) used for tax calculations
- `theme` — UI preference

### Financial engine (`calculs.js`)

- `computeAnalysisViewModel(inputs)` — main entry point for single-asset analysis; returns all metrics, decisions, scenarios, charts data
- `computeCF(prixVendeur, loyer, inputs, tmi)` — core net-net cash-flow function used throughout
- `computeProjectMetrics(inputs)` — per-asset KPIs (rentaBrute, rentaNette, dscr, grm, coc…)
- `computeResaleTimeline(...)` — resale gain projection (exported, currently not called anywhere)
- `computeOwnedAssetCF`, `computeOwnedAssetTimeline`, `computeCFBreakdown`, `computeRegimeComparison`, `computePortfolioAlerts`, etc. — owned-portfolio-specific, imported by `owned-portfolio.js`
- Tax logic handles three regimes: `micro-foncier`, `reel` (foncier réel), `sci-is`
- One yearly tax engine (`impotLocatifAnnee`) serves both the study and owned assets: IR is always the difference of two full household taxes (`impotRevenuDifferentiel`, décote and quotient-familial cap included), never base × TMI; foncier deficits carry forward by vintage for 10 years (usable until A+10), SCI-IS deficits indefinitely, deductible CSG (6.8 %) offsets next year's income

### Decision model (analysis tool)

The acquisition decision is a composite score (0–100) built from: cash-flow, DSCR, net-net yield, price vs. offer ceiling, hypothesis confidence score, and stress-test results. Thresholds are user-configurable (`seuil-*` form fields). Decision tones: `excellent` → `positive` → `neutral` → `watch` → `negative`.

## Design system

The visual identity is documented in `charte_graphique.txt`. Key points:
- Fonts (charte unique, 2026-11-20) : Inter (texte et titres, variable) + IBM Plex Mono (chiffres), woff2 locales dans `vendor/fonts/`, préchargées ; jamais de nom de police en dur, passer par `--font-body` / `--font-heading` / `--font-mono`
- Accent unique (2026-11-20) : l'indigo, jamais d'or hors logo — `--accent` (fonds/bordures, `#4F46E5` clair / `#8B8EF0` sombre), `--accent-text` (texte), `--on-accent` (texte sur fond accent) ; ne jamais écrire une teinte d'accent en dur (`rgba(var(--primary-rgb), x)`) ; contrastes AA contrôlés par `tests/playwright/audit-lot3.mjs` (scénario A5). Les couleurs d'état ne sont pas l'accent
- Status tones map to CSS class suffixes: `--positive`, `--excellent`, `--watch`, `--negative`, `--neutral`
- Icônes (charte unique, 2026-11-20) : `icones.js` uniquement (SVG en ligne, décoratives, `aria-label` obligatoire sur un bouton qui n'a que l'icône) ; aucun emoji ni glyphe d'interface
- Spacing is a 4px grid; corner radii: 8px (components), 12px (cards)
- Both themes are applied via `data-theme="light|dark"` on `<html>`

## Testing

- **Tests unitaires** (`tests/*.mjs`) — fonctions pures (`calculs.js`, `rapport-bien.js`, `archives-regles.js`, `corps-etat.js`), sans framework : `node:assert/strict` + `console.log`. Un fichier : `node tests/xxx.mjs` ; tous : `npm test` ; syntaxe des modules racine + tous les tests : `npm run verify`. Les deux passent par `scripts/run-tests.mjs` et fonctionnent sous Windows (cmd.exe, PowerShell, Git Bash). Toujours lancer la suite complète avant d'affirmer qu'une modification de `calculs.js` est correcte.
- **Tests navigateur (Playwright)** — installé le 2026-08-04 (`npm install`, navigateur via `npx playwright install chromium`) pour vérifier qu'un changement d'interface marche *réellement* dans un vrai navigateur : la relecture statique a déjà laissé passer un vrai bug (un `if (IS_MOBILE_PAGE) { ...; return; }` préexistant sautait silencieusement le code ajouté après lui, invisible dans le diff, révélé seulement en cliquant dans la page rendue).
  - Serveur : `npm run serve` (serveur statique `scripts/serve-static.mjs`, http://127.0.0.1:8090, mêmes réécritures que Hosting). **Jamais sur le port 8080.** Vérifier qu'il sert bien le code courant (`curl -s http://127.0.0.1:8090/VERSION`).
  - L'app exige Firebase Auth + un vrai compte Firestore, qu'un test n'a pas. **Ne jamais se connecter pour de vrai** : `tests/playwright/_harness.mjs` intercepte les DEUX modules cloud, `owned-cloud.js` (`OWNED_CLOUD_STUB_SOURCE`) et `cloud-store.js` (`CLOUD_STORE_STUB_SOURCE`), et sert des stubs alimentés par `seedCloud`/`seedStore`. Un stub doit exporter exactement les fonctions du module réel (un export manquant casse l'import sans erreur claire). Le code réel de l'app (`main.js`, `owned-portfolio.js`, `calculs.js`…) tourne ainsi dans un vrai Chromium sans toucher au vrai projet Firebase ni aux vraies données.
  - Le harnais fournit `openPage(browser, path, { viewport, seedCloud, seedStore, spyStorage, routes, initScripts })`, `waitAppStarted`, `step`, `getFailures` ; l'espion `localStorage`/`sessionStorage` vérifie qu'aucun accès n'a lieu ; `page.on('pageerror'/'console')` collecte les erreurs JS.
  - Tests de référence (hors `npm test`, ils demandent le serveur + Chromium) : `tests/playwright/tout-web.mjs`, `factures-modal.mjs`, `impression-factures.mjs`, `change-password.mjs`, `projection-impots.mjs`, `corps-etat.mjs`. Lancer avec `SPARK_TEST_BASE=http://127.0.0.1:8090 node tests/playwright/<fichier>.mjs` ; `FM_SCREENSHOTS=<dir>` / `PI_SCREENSHOTS=<dir>` enregistrent des captures PNG pour contrôler le rendu.
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
