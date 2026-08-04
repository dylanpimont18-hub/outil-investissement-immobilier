# Portefeuille — Séparation totale + Simulateur matrice

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refondre complètement la section Portefeuille avec un modèle de données indépendant (`portfolioOwnedAssets`), une vue liste → vue détaillée par bien, et 3 accordéons multi-ouvrables (Acquisition / Post-achat / Simulateur matrice).

**Architecture:** Les `assetRecords` et toutes les fonctions Analyse restent inchangés. Un nouveau système parallèle (`portfolioOwnedAssets` dans localStorage) gère les biens détenus. `renderCollections()` est réécrit pour utiliser ce nouveau modèle. Toutes les anciennes fonctions `buildPortfolio*` liées à `assetRecords` sont supprimées.

**Tech Stack:** Vanilla JS ES Modules, Chart.js (déjà présent), localStorage, CSS custom properties existantes. Spec de référence : `docs/superpowers/specs/2026-06-11-portefeuille-separation-simulateur.md`

---

## Fichiers modifiés

| Fichier | Rôle |
|---|---|
| `calculs.js` | Export `buildFinancialModel` + nouvelle fonction `computeOwnedAssetCF` |
| `main.js` | CRUD helpers, state extension, toutes les fonctions `renderOwned*` |
| `index.html` | Restructuration `collection-panel` |
| `styles.css` | Styles liste, accordéons, matrice simulateur |

---

## Tâche 1 — `computeOwnedAssetCF` dans `calculs.js`

**Fichiers :**
- Modifier : `calculs.js`

### Étapes

- [ ] **1.1 — Exporter `buildFinancialModel`**

Dans `calculs.js`, ligne 79, changer `function buildFinancialModel` en :

```js
export function buildFinancialModel(prixNet, loyerMensuel, inputs, tmi) {
```

- [ ] **1.2 — Ajouter `computeOwnedAssetCF` à la fin de `calculs.js`** (avant la dernière `export function`)

```js
/**
 * Calcule le CF net-net mensuel d'un bien détenu selon un scénario donné.
 * asset : objet portfolioOwnedAssets[id]
 * scenario : { loyer, vacance, taxeFonciere, chargesCopro, regime }
 * tmi : nombre (ex: 30)
 * Retourne : { cfNetNet, mensualiteTotale, chargesMensuelles, impotsAnnee, loyerEffectif, rentaBrute, dscr }
 */
export function computeOwnedAssetCF(asset, scenario, tmi) {
    const acq = asset.acquisition || {};
    const post = asset.postAchat || {};
    const credit = acq.credit || {};

    // Mensualités des travaux empruntés
    const travauxMensualites = (post.travaux || []).reduce((sum, t) => {
        if (!t.credit) return sum;
        const tc = t.credit;
        const nM = (tc.duree || 0) * 12;
        const tM = ((tc.taux || 0) / 100) / 12;
        if (nM <= 0) return sum;
        const m = tM > 0 ? (tc.montant * tM) / (1 - Math.pow(1 + tM, -nM)) : tc.montant / nM;
        return sum + m;
    }, 0);

    // Inputs compatibles avec buildFinancialModel
    // prixNet = credit.montant → montantFinance = credit.montant (apport=0)
    const inputs = {
        'taux-input': credit.taux || 0,
        'duree': credit.duree || 0,
        'assurance': credit.assurance || 0,
        'apport': 0,
        'notaire': 0,
        'agence': 0,
        'travaux': 0,
        'meubles': 0,
        'frais-bancaires': 0,
        'vacance': scenario.vacance ?? 5,
        'copro': scenario.chargesCopro ?? post.chargesCopro ?? 0,
        'fonciere': scenario.taxeFonciere ?? post.taxeFonciere ?? 0,
        'pno': post.assurancePNO ?? 0,
        'gestion': post.gestionLocative ?? 0,
        'regime': scenario.regime || 'micro-foncier',
    };

    const loyer = scenario.loyer ?? acq.loyerInitial ?? 0;
    const montantCredit = credit.montant || 0;
    const model = buildFinancialModel(montantCredit, loyer, inputs, tmi);

    const investissementTotal = (acq.prix || 0) + (acq.fraisAgence || 0) + (acq.fraisNotaire || 0);
    const rentaBrute = investissementTotal > 0 ? ((loyer * 12) / investissementTotal) * 100 : 0;
    const dscr = model.mensualiteTotale > 0 ? model.loyerEffectif / model.mensualiteTotale : 0;

    return {
        cfNetNet: model.cfNetNet - travauxMensualites,
        mensualiteTotale: model.mensualiteTotale + travauxMensualites,
        chargesMensuelles: (model.chargesExploitationAnnuelles / 12) + travauxMensualites,
        impotsAnnee: model.impotsAnnee,
        loyerEffectif: model.loyersEncaisses / 12,
        rentaBrute,
        dscr,
    };
}
```

Note : `model.loyerEffectif` n'existe pas dans `buildFinancialModel` — utiliser `model.loyersEncaisses / 12`.

- [ ] **1.3 — Mettre à jour l'import dans `main.js`**

Ligne 1, modifier l'import pour inclure `buildFinancialModel` et `computeOwnedAssetCF` :

```js
import { calculateTMI, computeAnalysisViewModel, computePortfolioViewModel, getHouseholdTaxParts, capitalRestantDu, computeOwnedAssetCF } from './calculs.js';
```

(`buildFinancialModel` est exporté mais pas nécessaire dans `main.js`)

- [ ] **1.4 — Vérifier qu'il n'y a pas d'erreur de syntaxe**

```bash
python app.py
```

Ouvrir la console navigateur — aucune erreur JS au démarrage.

- [ ] **1.5 — Commit**

```bash
git add calculs.js main.js
git commit -m "feat(portfolio): export buildFinancialModel + computeOwnedAssetCF"
```

---

## Tâche 2 — CRUD helpers + state `portfolioOwnedAssets`

**Fichiers :**
- Modifier : `main.js`

### Étapes

- [ ] **2.1 — Ajouter la clé de stockage dans `STORAGE_KEYS`**

Dans `main.js`, ligne ~41, dans le bloc `const STORAGE_KEYS = { ... }`, ajouter en fin :

```js
ownedAssets: 'investissementWebOwnedAssets',
```

- [ ] **2.2 — Ajouter les helpers CRUD après `STORAGE_KEYS`**

Après le bloc `const STORAGE_KEYS = { ... }` (ligne ~46), ajouter :

```js
// --- Portfolio biens détenus ---

function loadOwnedAssets() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.ownedAssets)) || {}; }
    catch { return {}; }
}

function saveOwnedAssets(assets) {
    localStorage.setItem(STORAGE_KEYS.ownedAssets, JSON.stringify(assets));
}

function createOwnedAssetId() {
    return `oa-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function createOwnedAsset(nom, ville) {
    const id = createOwnedAssetId();
    const asset = {
        id,
        nom: String(nom || '').trim(),
        ville: String(ville || '').trim(),
        anneeAchat: null,
        acquisition: {
            prix: 0, fraisAgence: 0, fraisNotaire: 0, loyerInitial: 0,
            credit: { montant: 0, duree: 0, taux: 0, assurance: 0 }
        },
        postAchat: {
            taxeFonciere: 0, chargesCopro: 0, gestionLocative: 0, assurancePNO: 0,
            travaux: [], notes: []
        },
        scenarios: [
            { id: 'pessimiste', nom: 'Pessimiste', variables: { loyer: 0, taxeFonciere: 0, vacance: 8, regime: 'micro-foncier' } },
            { id: 'realiste', nom: 'Réaliste', variables: { loyer: 0, taxeFonciere: 0, vacance: 5, regime: 'micro-foncier' } },
            { id: 'optimiste', nom: 'Optimiste', variables: { loyer: 0, taxeFonciere: 0, vacance: 2, regime: 'micro-foncier' } }
        ],
        lastDiagnostic: null
    };
    const all = loadOwnedAssets();
    all[id] = asset;
    saveOwnedAssets(all);
    return asset;
}

function getOwnedAsset(id) {
    return loadOwnedAssets()[id] || null;
}

function updateOwnedAsset(id, patch) {
    const all = loadOwnedAssets();
    if (!all[id]) return;
    all[id] = { ...all[id], ...patch };
    saveOwnedAssets(all);
}

function deleteOwnedAsset(id) {
    const all = loadOwnedAssets();
    delete all[id];
    saveOwnedAssets(all);
}

function updateOwnedAcquisition(id, patch) {
    const all = loadOwnedAssets();
    if (!all[id]) return;
    all[id].acquisition = { ...all[id].acquisition, ...patch };
    saveOwnedAssets(all);
}

function updateOwnedCredit(id, patch) {
    const all = loadOwnedAssets();
    if (!all[id]) return;
    all[id].acquisition.credit = { ...all[id].acquisition.credit, ...patch };
    saveOwnedAssets(all);
}

function updateOwnedPostAchat(id, patch) {
    const all = loadOwnedAssets();
    if (!all[id]) return;
    all[id].postAchat = { ...all[id].postAchat, ...patch };
    saveOwnedAssets(all);
}

function addOwnedTravail(assetId, travail) {
    const all = loadOwnedAssets();
    if (!all[assetId]) return;
    const entry = {
        id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        date: travail.date || '',
        description: travail.description || '',
        montant: Math.max(0, Number(travail.montant) || 0),
        tag: ['deductible', 'non-deductible', 'a-classifier'].includes(travail.tag) ? travail.tag : 'a-classifier',
        credit: travail.credit || null
    };
    all[assetId].postAchat.travaux.push(entry);
    saveOwnedAssets(all);
}

function deleteOwnedTravail(assetId, travailId) {
    const all = loadOwnedAssets();
    if (!all[assetId]) return;
    all[assetId].postAchat.travaux = all[assetId].postAchat.travaux.filter(t => t.id !== travailId);
    saveOwnedAssets(all);
}

function addOwnedNote(assetId, text) {
    if (!String(text || '').trim()) return;
    const all = loadOwnedAssets();
    if (!all[assetId]) return;
    all[assetId].postAchat.notes.push({
        id: `n-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        createdAt: new Date().toISOString(),
        text: String(text).trim()
    });
    saveOwnedAssets(all);
}

function addOwnedScenario(assetId) {
    const all = loadOwnedAssets();
    if (!all[assetId]) return;
    const id = `sc-${Date.now()}`;
    all[assetId].scenarios.push({
        id, nom: 'Nouveau', variables: { loyer: 0, taxeFonciere: 0, vacance: 5, regime: 'micro-foncier' }
    });
    saveOwnedAssets(all);
    return id;
}

function updateOwnedScenarioVar(assetId, scenarioId, key, value) {
    const all = loadOwnedAssets();
    if (!all[assetId]) return;
    const sc = all[assetId].scenarios.find(s => s.id === scenarioId);
    if (!sc) return;
    sc.variables[key] = value;
    saveOwnedAssets(all);
}

function updateOwnedScenarioNom(assetId, scenarioId, nom) {
    const all = loadOwnedAssets();
    if (!all[assetId]) return;
    const sc = all[assetId].scenarios.find(s => s.id === scenarioId);
    if (!sc) return;
    sc.nom = nom;
    saveOwnedAssets(all);
}

function deleteOwnedScenario(assetId, scenarioId) {
    const all = loadOwnedAssets();
    if (!all[assetId]) return;
    all[assetId].scenarios = all[assetId].scenarios.filter(s => s.id !== scenarioId);
    saveOwnedAssets(all);
}
```

- [ ] **2.3 — Ajouter `ownedAssets` et `activeOwnedAssetId` dans `state`**

Dans le bloc `const state = { ... }` (ligne ~290), ajouter en fin :

```js
    ownedAssets: loadOwnedAssets(),
    activeOwnedAssetId: null
```

- [ ] **2.4 — Vérifier console**

```bash
python app.py
```

Console : aucune erreur.

- [ ] **2.5 — Commit**

```bash
git add main.js
git commit -m "feat(portfolio): CRUD helpers portfolioOwnedAssets + state"
```

---

## Tâche 3 — HTML : restructuration `collection-panel`

**Fichiers :**
- Modifier : `index.html`

### Étapes

- [ ] **3.1 — Remplacer le contenu de `collection-panel`**

Dans `index.html`, trouver `<section id="collection-panel"` (ligne ~637). Remplacer tout ce qui se trouve entre `<section id="collection-panel" ...>` et `</section>` par :

```html
    <!-- Vue liste (défaut) -->
    <div id="owned-list-view">
        <div class="owned-list-header">
            <div>
                <p class="brand-kicker">Portefeuille</p>
                <h2>Mes biens détenus</h2>
            </div>
            <button id="owned-add-btn" class="btn btn--primary" type="button">+ Ajouter un bien</button>
        </div>
        <div id="owned-kpi-banner" class="owned-kpi-banner"></div>
        <div id="owned-list-table" class="owned-list-table"></div>
    </div>

    <!-- Modal ajout bien -->
    <div id="owned-add-modal" class="owned-add-modal" hidden aria-modal="true" role="dialog">
        <div class="owned-add-modal__box">
            <h3>Ajouter un bien</h3>
            <form id="owned-add-form" novalidate>
                <label class="variables-field">
                    <span class="variables-label">Nom du bien</span>
                    <input id="owned-add-nom" name="nom" type="text" class="variables-input" placeholder="ex : Appartement Lyon 3e" required>
                </label>
                <label class="variables-field">
                    <span class="variables-label">Ville</span>
                    <input id="owned-add-ville" name="ville" type="text" class="variables-input" placeholder="ex : Lyon">
                </label>
                <div class="owned-add-modal__actions">
                    <button type="button" id="owned-add-cancel" class="btn btn--ghost">Annuler</button>
                    <button type="submit" class="btn btn--primary">Créer</button>
                </div>
            </form>
        </div>
    </div>

    <!-- Vue détaillée -->
    <div id="owned-detail-view" hidden>
        <div class="owned-detail-header">
            <button id="owned-back-btn" class="btn btn--ghost btn--sm" type="button">← Retour</button>
            <div id="owned-detail-title" class="owned-detail-title"></div>
            <button id="owned-diagnostic-btn" class="btn btn--ghost portfolio-ai-trigger" type="button" disabled>✦ Diagnostic IA</button>
        </div>

        <!-- Accordéon 1 : Acquisition -->
        <div class="owned-accordion" id="acc-acquisition">
            <button class="owned-accordion__header" type="button" aria-expanded="true" data-acc="acquisition">
                <span class="owned-accordion__label">Acquisition</span>
                <span class="owned-accordion__summary" id="acc-acquisition-summary"></span>
                <span class="owned-accordion__chevron" aria-hidden="true">▼</span>
            </button>
            <div class="owned-accordion__body" id="acc-acquisition-body">
                <div id="acc-acquisition-content"></div>
            </div>
        </div>

        <!-- Accordéon 2 : Post-achat -->
        <div class="owned-accordion" id="acc-postachat">
            <button class="owned-accordion__header" type="button" aria-expanded="false" data-acc="postachat">
                <span class="owned-accordion__label">Post-achat</span>
                <span class="owned-accordion__summary" id="acc-postachat-summary"></span>
                <span class="owned-accordion__chevron" aria-hidden="true">▶</span>
            </button>
            <div class="owned-accordion__body" id="acc-postachat-body" hidden>
                <div id="acc-postachat-content"></div>
            </div>
        </div>

        <!-- Accordéon 3 : Simulateur -->
        <div class="owned-accordion" id="acc-simulateur">
            <button class="owned-accordion__header" type="button" aria-expanded="false" data-acc="simulateur">
                <span class="owned-accordion__label">Simulateur</span>
                <span class="owned-accordion__summary" id="acc-simulateur-summary"></span>
                <span class="owned-accordion__chevron" aria-hidden="true">▶</span>
            </button>
            <div class="owned-accordion__body" id="acc-simulateur-body" hidden>
                <div id="acc-simulateur-content"></div>
            </div>
        </div>

        <!-- Drawer Diagnostic IA -->
        <div id="owned-ai-drawer" class="portfolio-ai-drawer" hidden role="dialog" aria-modal="true" aria-label="Diagnostic IA">
            <div class="portfolio-ai-drawer__header">
                <span class="portfolio-ai-drawer__title">Diagnostic IA</span>
                <button id="owned-ai-drawer-close" class="portfolio-ai-drawer__close" type="button" aria-label="Fermer">✕</button>
            </div>
            <div id="owned-ai-drawer-content" class="portfolio-ai-drawer__content"></div>
        </div>
        <div id="owned-ai-overlay" class="portfolio-ai-overlay" hidden></div>
    </div>
```

- [ ] **3.2 — Ajouter les nouveaux nœuds dans `nodes` (main.js)**

Dans le bloc `const nodes = { ... }` (ligne ~311), ajouter après `collectionPanel: ...` :

```js
    ownedListView: document.getElementById('owned-list-view'),
    ownedDetailView: document.getElementById('owned-detail-view'),
    ownedAddBtn: document.getElementById('owned-add-btn'),
    ownedAddModal: document.getElementById('owned-add-modal'),
    ownedAddForm: document.getElementById('owned-add-form'),
    ownedAddNom: document.getElementById('owned-add-nom'),
    ownedAddVille: document.getElementById('owned-add-ville'),
    ownedAddCancel: document.getElementById('owned-add-cancel'),
    ownedKpiBanner: document.getElementById('owned-kpi-banner'),
    ownedListTable: document.getElementById('owned-list-table'),
    ownedBackBtn: document.getElementById('owned-back-btn'),
    ownedDetailTitle: document.getElementById('owned-detail-title'),
    ownedDiagnosticBtn: document.getElementById('owned-diagnostic-btn'),
    accAcquisitionBody: document.getElementById('acc-acquisition-body'),
    accAcquisitionContent: document.getElementById('acc-acquisition-content'),
    accAcquisitionSummary: document.getElementById('acc-acquisition-summary'),
    accPostAchatBody: document.getElementById('acc-postachat-body'),
    accPostAchatContent: document.getElementById('acc-postachat-content'),
    accPostAchatSummary: document.getElementById('acc-postachat-summary'),
    accSimulateurBody: document.getElementById('acc-simulateur-body'),
    accSimulateurContent: document.getElementById('acc-simulateur-content'),
    accSimulateurSummary: document.getElementById('acc-simulateur-summary'),
    ownedAiDrawer: document.getElementById('owned-ai-drawer'),
    ownedAiOverlay: document.getElementById('owned-ai-overlay'),
    ownedAiDrawerContent: document.getElementById('owned-ai-drawer-content'),
    ownedAiDrawerClose: document.getElementById('owned-ai-drawer-close'),
```

- [ ] **3.3 — Vérifier rendu**

```bash
python app.py
```

Onglet Portefeuille : la section s'affiche sans erreur console. La liste est vide (normal, pas encore de données ni de rendu).

- [ ] **3.4 — Commit**

```bash
git add index.html main.js
git commit -m "feat(portfolio): HTML collection-panel vue liste + vue détaillée"
```

---

## Tâche 4 — CSS

**Fichiers :**
- Modifier : `styles.css`

### Étapes

- [ ] **4.1 — Ajouter les styles portefeuille dans `styles.css`**

Ajouter en fin de fichier :

```css
/* ===== PORTEFEUILLE BIENS DÉTENUS ===== */

/* --- Liste --- */
.owned-list-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    margin-bottom: 20px;
    flex-wrap: wrap;
    gap: 12px;
}

.owned-kpi-banner {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 20px;
}

.owned-kpi-card {
    background: var(--surface-low);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    padding: 12px 16px;
    min-width: 140px;
}

.owned-kpi-card__label {
    font-size: 0.72rem;
    color: var(--text-secondary);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: .06em;
    display: block;
    margin-bottom: 4px;
}

.owned-kpi-card__value {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 1.1rem;
    font-weight: 700;
    color: var(--text-primary);
}

.owned-kpi-card__value--positive { color: #3FB950; }
.owned-kpi-card__value--negative { color: #F85149; }

.owned-list-table { width: 100%; }

.owned-list-table table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85rem;
}

.owned-list-table th {
    text-align: left;
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .06em;
    color: var(--text-secondary);
    padding: 6px 12px;
    border-bottom: 1px solid var(--border-subtle);
}

.owned-list-table td {
    padding: 10px 12px;
    border-bottom: 1px solid var(--border-subtle);
    vertical-align: middle;
}

.owned-list-table tr:last-child td { border-bottom: none; }

.owned-list-table tr[data-asset-id] { cursor: pointer; transition: background .12s; }
.owned-list-table tr[data-asset-id]:hover { background: var(--surface-low); }

.owned-table-name { font-weight: 600; color: var(--text-primary); }
.owned-table-meta { font-size: 0.75rem; color: var(--text-secondary); }
.owned-table-num { font-family: 'IBM Plex Mono', monospace; font-size: 0.82rem; text-align: right; }
.owned-table-num--positive { color: #3FB950; }
.owned-table-num--negative { color: #F85149; }

.owned-status-badge {
    font-size: 0.68rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .04em;
    padding: 2px 8px;
    border-radius: 20px;
    white-space: nowrap;
}
.owned-status-badge--ras    { background: color-mix(in srgb, #3FB950 15%, transparent); color: #3FB950; }
.owned-status-badge--watch  { background: color-mix(in srgb, #ff9500 15%, transparent); color: #ff9500; }

.owned-empty-state {
    text-align: center;
    padding: 48px 24px;
    color: var(--text-secondary);
}
.owned-empty-state p { margin-bottom: 16px; font-size: 0.9rem; }

/* Modal ajout */
.owned-add-modal {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
}

.owned-add-modal[hidden] { display: none; }

.owned-add-modal__box {
    background: var(--surface-low);
    border: 1px solid var(--border-subtle);
    border-radius: 12px;
    padding: 24px;
    width: 380px;
    max-width: 90vw;
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.owned-add-modal__box h3 {
    font-size: 1rem;
    font-weight: 700;
    color: var(--text-primary);
    margin: 0;
}

.owned-add-modal__actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    margin-top: 4px;
}

/* --- Vue détaillée --- */
.owned-detail-header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 20px;
    flex-wrap: wrap;
}

.owned-detail-title {
    flex: 1;
}

.owned-detail-title__name {
    font-size: 1.2rem;
    font-weight: 700;
    color: var(--text-primary);
}

.owned-detail-title__meta {
    font-size: 0.78rem;
    color: var(--text-secondary);
    margin-top: 2px;
}

/* --- Accordéons --- */
.owned-accordion {
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    margin-bottom: 8px;
    overflow: hidden;
}

.owned-accordion__header {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 12px 16px;
    background: var(--surface-low);
    border: none;
    cursor: pointer;
    text-align: left;
    font-family: inherit;
    transition: background .12s;
}

.owned-accordion__header:hover { background: var(--surface-mid); }

.owned-accordion__label {
    font-size: 0.8rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .07em;
    color: var(--text-primary);
}

.owned-accordion__summary {
    flex: 1;
    font-size: 0.78rem;
    color: var(--text-secondary);
    font-family: 'IBM Plex Mono', monospace;
}

.owned-accordion__chevron {
    color: var(--text-tertiary);
    font-size: 0.7rem;
    transition: transform .2s;
}

.owned-accordion__header[aria-expanded="true"] .owned-accordion__chevron {
    transform: rotate(0deg);
}

.owned-accordion__header[aria-expanded="false"] .owned-accordion__chevron {
    transform: rotate(-90deg);
}

.owned-accordion__body {
    padding: 16px;
    background: var(--bg);
    border-top: 1px solid var(--border-subtle);
}

/* --- Formulaires dans les accordéons --- */
.owned-form-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 10px;
    margin-bottom: 16px;
}

.owned-form-grid .variables-field { margin: 0; }

.owned-section-title {
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .07em;
    color: var(--text-secondary);
    margin: 16px 0 8px;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--border-subtle);
}

/* --- Travaux --- */
.owned-travaux-list { margin-bottom: 10px; }

.owned-travaux-row {
    display: grid;
    grid-template-columns: 110px 1fr 90px 120px 24px;
    gap: 8px;
    align-items: center;
    padding: 5px 0;
    border-bottom: 1px solid var(--border-subtle);
    font-size: 0.82rem;
}

.owned-travaux-row:last-child { border-bottom: none; }

.owned-travaux-date { font-family: 'IBM Plex Mono', monospace; font-size: 0.75rem; color: var(--text-secondary); }
.owned-travaux-desc { color: var(--text-primary); }
.owned-travaux-montant { font-family: 'IBM Plex Mono', monospace; font-weight: 600; text-align: right; }
.owned-travaux-delete { color: var(--text-tertiary); font-size: 0.75rem; cursor: pointer; background: none; border: none; padding: 0 4px; }
.owned-travaux-delete:hover { color: #F85149; }

.owned-travaux-totals {
    font-size: 0.78rem;
    color: var(--text-secondary);
    display: flex;
    gap: 16px;
    margin: 8px 0;
    flex-wrap: wrap;
}

.owned-travaux-form { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-end; margin-top: 8px; }
.owned-travaux-form input, .owned-travaux-form select { flex: 1; min-width: 100px; }

/* --- Notes --- */
.owned-notes-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }

.owned-note-entry {
    background: var(--surface-low);
    border-radius: 6px;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.owned-note-text { font-size: 0.85rem; color: var(--text-primary); line-height: 1.5; margin: 0; white-space: pre-wrap; }
.owned-note-date { font-size: 0.72rem; color: var(--text-tertiary); font-family: 'IBM Plex Mono', monospace; }

.owned-notes-add { display: flex; flex-direction: column; gap: 8px; }
.owned-notes-add textarea { resize: vertical; min-height: 60px; }
.owned-notes-add button { align-self: flex-end; }

/* --- Simulateur matrice --- */
.owned-simulator-table-wrap { overflow-x: auto; margin-bottom: 12px; }

.owned-simulator-table {
    border-collapse: collapse;
    font-size: 0.83rem;
    min-width: 500px;
}

.owned-simulator-table th {
    padding: 8px 12px;
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .06em;
    color: var(--text-secondary);
    border-bottom: 1px solid var(--border-subtle);
    text-align: center;
    white-space: nowrap;
}

.owned-simulator-table th.col-var {
    text-align: left;
    color: var(--text-secondary);
}

.owned-simulator-table th.col-realiste {
    color: var(--accent-gold, #C5A059);
    border-bottom: 2px solid var(--accent-gold, #C5A059);
}

.owned-simulator-table td {
    padding: 7px 12px;
    border-bottom: 1px solid var(--border-subtle);
    vertical-align: middle;
}

.owned-simulator-table td.col-var {
    font-size: 0.8rem;
    color: var(--text-secondary);
    white-space: nowrap;
}

.owned-simulator-table td.col-realiste {
    background: var(--surface-low);
}

.owned-simulator-table tr.row-result td {
    background: var(--surface-mid);
    font-family: 'IBM Plex Mono', monospace;
    font-weight: 700;
    font-size: 0.95rem;
    text-align: center;
    border-top: 2px solid var(--border-subtle);
}

.owned-simulator-table tr.row-result td.col-realiste {
    background: color-mix(in srgb, var(--accent-gold, #C5A059) 10%, var(--surface-mid));
}

.owned-simulator-table tr.row-result td.col-var {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: .07em;
    color: var(--text-secondary);
}

.owned-simulator-table input[type="number"],
.owned-simulator-table select {
    background: transparent;
    border: 1px solid var(--border-subtle);
    border-radius: 4px;
    color: var(--text-primary);
    padding: 3px 6px;
    width: 80px;
    font-size: 0.82rem;
    font-family: 'IBM Plex Mono', monospace;
    text-align: center;
}

.owned-simulator-table select { width: 120px; text-align: left; }

.owned-simulator-table td.col-realiste input,
.owned-simulator-table td.col-realiste select {
    border-color: var(--accent-gold, #C5A059);
}

.owned-sim-add-btn {
    font-size: 0.78rem;
    color: var(--text-tertiary);
    background: none;
    border: 1px dashed var(--border-subtle);
    border-radius: 4px;
    padding: 2px 8px;
    cursor: pointer;
}

.owned-sim-add-btn:hover { color: var(--text-primary); border-color: var(--text-secondary); }

/* Hint héritage */
.owned-sim-hint {
    font-size: 0.75rem;
    color: var(--text-tertiary);
    text-align: right;
    margin-top: 4px;
}
```

- [ ] **4.2 — Vérifier visuellement**

```bash
python app.py
```

Onglet Portefeuille : la section s'affiche. Les styles sont présents même si les éléments sont vides.

- [ ] **4.3 — Commit**

```bash
git add styles.css
git commit -m "feat(portfolio): CSS liste, accordéons, simulateur matrice"
```

---

## Tâche 5 — Vue liste : rendu + KPIs + formulaire ajout

**Fichiers :**
- Modifier : `main.js`

### Étapes

- [ ] **5.1 — Ajouter `renderOwnedPortfolioList()` dans `main.js`**

Ajouter avant `renderCollections()` (ligne ~4179) :

```js
function getOwnedTmi() {
    return calculateTMI(state.profileData.income || 0, {
        adults: state.profileData.adults || 2,
        children: state.profileData.children || 0
    });
}

function getOwnedDefaultScenario(asset) {
    return asset.scenarios.find(s => s.id === 'realiste') || asset.scenarios[0] || { variables: {} };
}

function renderOwnedPortfolioList() {
    if (!nodes.ownedListView || !nodes.ownedDetailView) return;

    const assets = loadOwnedAssets();
    const list = Object.values(assets);
    const tmi = getOwnedTmi();

    // KPI banner
    if (nodes.ownedKpiBanner) {
        if (!list.length) {
            nodes.ownedKpiBanner.innerHTML = '';
        } else {
            const results = list.map(a => {
                const sc = getOwnedDefaultScenario(a);
                return computeOwnedAssetCF(a, sc.variables, tmi);
            });
            const totalCF = results.reduce((s, r) => s + r.cfNetNet, 0);
            const avgRdt = results.reduce((s, r) => s + r.rentaBrute, 0) / results.length;
            const cfTone = totalCF >= 0 ? 'positive' : 'negative';
            nodes.ownedKpiBanner.innerHTML = `
                <div class="owned-kpi-card">
                    <span class="owned-kpi-card__label">CF net-net / mois</span>
                    <span class="owned-kpi-card__value owned-kpi-card__value--${cfTone}">
                        ${totalCF >= 0 ? '+' : ''}${Math.round(totalCF).toLocaleString('fr-FR')} €
                    </span>
                </div>
                <div class="owned-kpi-card">
                    <span class="owned-kpi-card__label">Rendement brut moy.</span>
                    <span class="owned-kpi-card__value">${avgRdt.toFixed(1).replace('.', ',')} %</span>
                </div>
                <div class="owned-kpi-card">
                    <span class="owned-kpi-card__label">Biens détenus</span>
                    <span class="owned-kpi-card__value">${list.length}</span>
                </div>
            `;
        }
    }

    // Table
    if (nodes.ownedListTable) {
        if (!list.length) {
            nodes.ownedListTable.innerHTML = `
                <div class="owned-empty-state">
                    <p>Aucun bien enregistré dans le portefeuille.</p>
                    <button class="btn btn--primary" id="owned-empty-add-btn" type="button">+ Ajouter mon premier bien</button>
                </div>
            `;
            nodes.ownedListTable.querySelector('#owned-empty-add-btn')?.addEventListener('click', () => {
                openOwnedAddModal();
            });
        } else {
            nodes.ownedListTable.innerHTML = `
                <table>
                    <thead>
                        <tr>
                            <th>Bien</th>
                            <th style="text-align:right">CF net-net</th>
                            <th style="text-align:right">Rdt brut</th>
                            <th style="text-align:right">DSCR</th>
                            <th>Statut</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        ${list.map(asset => {
                            const sc = getOwnedDefaultScenario(asset);
                            const r = computeOwnedAssetCF(asset, sc.variables, tmi);
                            const cfTone = r.cfNetNet >= 0 ? 'positive' : 'negative';
                            const hasUnclassified = (asset.postAchat?.travaux || []).some(t => t.tag === 'a-classifier');
                            return `
                            <tr data-asset-id="${escapeHtml(asset.id)}">
                                <td>
                                    <div class="owned-table-name">${escapeHtml(asset.nom)}</div>
                                    <div class="owned-table-meta">${escapeHtml(asset.ville)}${asset.anneeAchat ? ` · ${asset.anneeAchat}` : ''}</div>
                                </td>
                                <td class="owned-table-num owned-table-num--${cfTone}">
                                    ${r.cfNetNet >= 0 ? '+' : ''}${Math.round(r.cfNetNet).toLocaleString('fr-FR')} €
                                </td>
                                <td class="owned-table-num">${r.rentaBrute.toFixed(1).replace('.', ',')} %</td>
                                <td class="owned-table-num">${r.dscr.toFixed(2).replace('.', ',')}</td>
                                <td>
                                    <span class="owned-status-badge owned-status-badge--${hasUnclassified ? 'watch' : 'ras'}">
                                        ${hasUnclassified ? '⚠ Travaux' : 'RAS'}
                                    </span>
                                </td>
                                <td>
                                    <button class="btn btn--ghost btn--sm" data-action="delete-owned" data-id="${escapeHtml(asset.id)}" title="Supprimer">✕</button>
                                </td>
                            </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            `;

            // Clic sur une ligne → ouvre la fiche détaillée
            nodes.ownedListTable.querySelectorAll('tr[data-asset-id]').forEach(row => {
                row.addEventListener('click', e => {
                    if (e.target.closest('[data-action]')) return;
                    openOwnedDetail(row.dataset.assetId);
                });
            });

            // Suppression
            nodes.ownedListTable.querySelectorAll('[data-action="delete-owned"]').forEach(btn => {
                btn.addEventListener('click', e => {
                    e.stopPropagation();
                    if (!confirm(`Supprimer "${escapeHtml(getOwnedAsset(btn.dataset.id)?.nom || btn.dataset.id)}" ?`)) return;
                    deleteOwnedAsset(btn.dataset.id);
                    renderOwnedPortfolioList();
                });
            });
        }
    }
}

function openOwnedAddModal() {
    if (!nodes.ownedAddModal) return;
    nodes.ownedAddModal.hidden = false;
    nodes.ownedAddNom?.focus();
}

function closeOwnedAddModal() {
    if (!nodes.ownedAddModal) return;
    nodes.ownedAddModal.hidden = true;
    nodes.ownedAddForm?.reset();
}

function openOwnedDetail(assetId) {
    state.activeOwnedAssetId = assetId;
    nodes.ownedListView.hidden = true;
    nodes.ownedDetailView.hidden = false;
    renderOwnedDetail();
}

function closeOwnedDetail() {
    state.activeOwnedAssetId = null;
    nodes.ownedDetailView.hidden = true;
    nodes.ownedListView.hidden = false;
    renderOwnedPortfolioList();
}
```

- [ ] **5.2 — Câbler les events du formulaire ajout + bouton retour**

Ajouter dans la fonction d'initialisation des events (chercher `function initEventListeners` ou la zone d'init en fin de fichier) :

```js
// Portefeuille — ajout bien
if (nodes.ownedAddBtn) {
    nodes.ownedAddBtn.addEventListener('click', openOwnedAddModal);
}
if (nodes.ownedAddCancel) {
    nodes.ownedAddCancel.addEventListener('click', closeOwnedAddModal);
}
if (nodes.ownedAddForm) {
    nodes.ownedAddForm.addEventListener('submit', e => {
        e.preventDefault();
        const nom = nodes.ownedAddNom?.value.trim();
        if (!nom) { nodes.ownedAddNom?.focus(); return; }
        const ville = nodes.ownedAddVille?.value.trim() || '';
        const asset = createOwnedAsset(nom, ville);
        closeOwnedAddModal();
        openOwnedDetail(asset.id);
    });
}
// Bouton retour
if (nodes.ownedBackBtn) {
    nodes.ownedBackBtn.addEventListener('click', closeOwnedDetail);
}
```

- [ ] **5.3 — Vérifier visuellement**

```bash
python app.py
```

Ouvrir Portefeuille. État vide → message + bouton. Cliquer "+ Ajouter un bien" → modal s'ouvre. Saisir un nom → créer → fiche s'ouvre (vide pour l'instant). Retour → liste avec le bien ajouté.

- [ ] **5.4 — Commit**

```bash
git add main.js
git commit -m "feat(portfolio): vue liste avec KPIs, formulaire ajout, navigation"
```

---

## Tâche 6 — Vue détaillée : header + accordéon Acquisition

**Fichiers :**
- Modifier : `main.js`

### Étapes

- [ ] **6.1 — Ajouter `renderOwnedDetail()` et `renderAccordionAcquisition()` dans `main.js`**

```js
function renderOwnedDetail() {
    const assetId = state.activeOwnedAssetId;
    if (!assetId) return;
    const asset = getOwnedAsset(assetId);
    if (!asset) { closeOwnedDetail(); return; }

    // Header
    if (nodes.ownedDetailTitle) {
        nodes.ownedDetailTitle.innerHTML = `
            <div class="owned-detail-title__name">${escapeHtml(asset.nom)}</div>
            <div class="owned-detail-title__meta">${escapeHtml(asset.ville)}${asset.anneeAchat ? ` · Acquis ${asset.anneeAchat}` : ''}</div>
        `;
    }

    // Bouton IA : activer si bien a données
    if (nodes.ownedDiagnosticBtn) {
        const hasData = (asset.acquisition?.prix || 0) > 0;
        nodes.ownedDiagnosticBtn.disabled = !hasData;
    }

    // Accordéons
    renderAccordionAcquisition(asset);
    renderAccordionPostAchat(asset);
    renderAccordionSimulateur(asset);

    // Câbler les headers d'accordéon (une seule fois grâce à la délégation)
    const detail = nodes.ownedDetailView;
    if (detail && !detail.dataset.accWired) {
        detail.dataset.accWired = '1';
        detail.addEventListener('click', e => {
            const btn = e.target.closest('.owned-accordion__header');
            if (!btn) return;
            const key = btn.dataset.acc;
            const bodyId = `acc-${key}-body`;
            const body = document.getElementById(bodyId);
            if (!body) return;
            const isOpen = btn.getAttribute('aria-expanded') === 'true';
            btn.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
            body.hidden = isOpen;
        });
    }
}

function renderAccordionAcquisition(asset) {
    if (!nodes.accAcquisitionContent) return;
    const acq = asset.acquisition || {};
    const credit = acq.credit || {};

    const investTotal = (acq.prix || 0) + (acq.fraisAgence || 0) + (acq.fraisNotaire || 0);
    if (nodes.accAcquisitionSummary) {
        nodes.accAcquisitionSummary.textContent = investTotal > 0
            ? `${Math.round(investTotal).toLocaleString('fr-FR')} € investis`
            : '';
    }

    nodes.accAcquisitionContent.innerHTML = `
        <div class="owned-form-grid">
            <label class="variables-field">
                <span class="variables-label">Prix d'achat (€)</span>
                <input class="variables-input" type="number" min="0" step="1000" data-acq-field="prix" value="${acq.prix || 0}">
            </label>
            <label class="variables-field">
                <span class="variables-label">Frais d'agence (€)</span>
                <input class="variables-input" type="number" min="0" step="100" data-acq-field="fraisAgence" value="${acq.fraisAgence || 0}">
            </label>
            <label class="variables-field">
                <span class="variables-label">Frais de notaire (€)</span>
                <input class="variables-input" type="number" min="0" step="100" data-acq-field="fraisNotaire" value="${acq.fraisNotaire || 0}">
            </label>
            <label class="variables-field">
                <span class="variables-label">Loyer initial (€/mois)</span>
                <input class="variables-input" type="number" min="0" step="10" data-acq-field="loyerInitial" value="${acq.loyerInitial || 0}">
            </label>
            <label class="variables-field">
                <span class="variables-label">Année d'achat</span>
                <input class="variables-input" type="number" min="1900" max="2099" step="1" data-owned-field="anneeAchat" value="${asset.anneeAchat || ''}">
            </label>
            <label class="variables-field">
                <span class="variables-label">Ville</span>
                <input class="variables-input" type="text" data-owned-field="ville" value="${escapeHtml(asset.ville || '')}">
            </label>
        </div>
        <div class="owned-section-title">Crédit immobilier</div>
        <div class="owned-form-grid">
            <label class="variables-field">
                <span class="variables-label">Montant emprunté (€)</span>
                <input class="variables-input" type="number" min="0" step="1000" data-credit-field="montant" value="${credit.montant || 0}">
            </label>
            <label class="variables-field">
                <span class="variables-label">Durée (ans)</span>
                <input class="variables-input" type="number" min="0" max="30" step="1" data-credit-field="duree" value="${credit.duree || 0}">
            </label>
            <label class="variables-field">
                <span class="variables-label">Taux (%)</span>
                <input class="variables-input" type="number" min="0" max="20" step="0.01" data-credit-field="taux" value="${credit.taux || 0}">
            </label>
            <label class="variables-field">
                <span class="variables-label">Assurance (%/an)</span>
                <input class="variables-input" type="number" min="0" max="5" step="0.01" data-credit-field="assurance" value="${credit.assurance || 0}">
            </label>
        </div>
    `;

    // Save on change (délégation sur le conteneur)
    nodes.accAcquisitionContent.addEventListener('change', e => {
        const input = e.target.closest('input');
        if (!input) return;
        const id = state.activeOwnedAssetId;
        if (!id) return;
        const val = input.type === 'number' ? Number(input.value) : input.value;
        if (input.dataset.acqField) {
            updateOwnedAcquisition(id, { [input.dataset.acqField]: val });
        } else if (input.dataset.creditField) {
            updateOwnedCredit(id, { [input.dataset.creditField]: val });
        } else if (input.dataset.ownedField) {
            updateOwnedAsset(id, { [input.dataset.ownedField]: val });
        }
        // Refresh summary and simulateur
        const asset = getOwnedAsset(id);
        if (!asset) return;
        const acq2 = asset.acquisition || {};
        const total2 = (acq2.prix || 0) + (acq2.fraisAgence || 0) + (acq2.fraisNotaire || 0);
        if (nodes.accAcquisitionSummary) {
            nodes.accAcquisitionSummary.textContent = total2 > 0 ? `${Math.round(total2).toLocaleString('fr-FR')} € investis` : '';
        }
        if (nodes.ownedDetailTitle) {
            nodes.ownedDetailTitle.querySelector('.owned-detail-title__meta').textContent =
                `${escapeHtml(asset.ville)}${asset.anneeAchat ? ` · Acquis ${asset.anneeAchat}` : ''}`;
        }
        renderAccordionSimulateur(getOwnedAsset(id));
    });
}
```

- [ ] **6.2 — Vérifier visuellement**

```bash
python app.py
```

Créer un bien, ouvrir la fiche. Accordéon Acquisition ouvert par défaut → champs visibles. Saisir prix + crédit → valeur persistée après rechargement.

- [ ] **6.3 — Commit**

```bash
git add main.js
git commit -m "feat(portfolio): vue détaillée header + accordéon Acquisition"
```

---

## Tâche 7 — Accordéon Post-achat

**Fichiers :**
- Modifier : `main.js`

### Étapes

- [ ] **7.1 — Ajouter `renderAccordionPostAchat()` dans `main.js`**

```js
function renderAccordionPostAchat(asset) {
    if (!nodes.accPostAchatContent) return;
    const post = asset.postAchat || {};

    const hasUnclassified = (post.travaux || []).some(t => t.tag === 'a-classifier');
    if (nodes.accPostAchatSummary) {
        nodes.accPostAchatSummary.textContent = hasUnclassified
            ? `⚠ ${(post.travaux || []).filter(t => t.tag === 'a-classifier').length} travail(x) à classifier`
            : post.travaux?.length ? `${post.travaux.length} travail(x)` : '';
    }

    const TAG_LABELS = { 'deductible': 'Déductible', 'non-deductible': 'Non déductible', 'a-classifier': 'À classifier' };
    const TAG_CSS = { 'deductible': 'tag--green', 'non-deductible': 'tag--grey', 'a-classifier': 'tag--orange' };

    const currentYear = new Date().getFullYear();
    const totalDed = (post.travaux || [])
        .filter(t => t.tag === 'deductible' && t.date && new Date(t.date).getFullYear() === currentYear)
        .reduce((s, t) => s + t.montant, 0);

    const sorted = [...(post.travaux || [])].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    nodes.accPostAchatContent.innerHTML = `
        <div class="owned-section-title">Charges récurrentes</div>
        <div class="owned-form-grid">
            <label class="variables-field">
                <span class="variables-label">Taxe foncière (€/an)</span>
                <input class="variables-input" type="number" min="0" step="10" data-post-field="taxeFonciere" value="${post.taxeFonciere || 0}">
            </label>
            <label class="variables-field">
                <span class="variables-label">Charges copro (€/mois)</span>
                <input class="variables-input" type="number" min="0" step="5" data-post-field="chargesCopro" value="${post.chargesCopro || 0}">
            </label>
            <label class="variables-field">
                <span class="variables-label">Gestion locative (% loyer)</span>
                <input class="variables-input" type="number" min="0" max="20" step="0.5" data-post-field="gestionLocative" value="${post.gestionLocative || 0}">
            </label>
            <label class="variables-field">
                <span class="variables-label">Assurance PNO (€/an)</span>
                <input class="variables-input" type="number" min="0" step="10" data-post-field="assurancePNO" value="${post.assurancePNO || 0}">
            </label>
        </div>

        <div class="owned-section-title">Travaux</div>
        <div class="owned-travaux-list">
            ${sorted.length ? sorted.map(t => `
                <div class="owned-travaux-row">
                    <span class="owned-travaux-date">${escapeHtml(t.date || '—')}</span>
                    <span class="owned-travaux-desc">${escapeHtml(t.description || '—')}</span>
                    <span class="owned-travaux-montant">${Math.round(t.montant).toLocaleString('fr-FR')} €</span>
                    <span class="tag ${TAG_CSS[t.tag] || 'tag--grey'}">${escapeHtml(TAG_LABELS[t.tag] || t.tag)}</span>
                    <button class="owned-travaux-delete" data-delete-travail="${escapeHtml(t.id)}" title="Supprimer" aria-label="Supprimer">✕</button>
                </div>
            `).join('') : '<p style="font-size:.82rem;color:var(--text-tertiary);font-style:italic">Aucun travail enregistré.</p>'}
        </div>
        ${totalDed > 0 ? `<div class="owned-travaux-totals"><span>Déductible ${currentYear} : <strong>${Math.round(totalDed).toLocaleString('fr-FR')} €</strong></span></div>` : ''}

        <form class="owned-travaux-form" data-form="add-travail" novalidate>
            <input type="date" name="date" class="variables-input" required placeholder="Date" style="flex:0 0 140px">
            <input type="text" name="description" class="variables-input" required placeholder="Description" style="flex:1;min-width:120px">
            <input type="number" name="montant" class="variables-input" required placeholder="Montant €" min="0" style="flex:0 0 100px">
            <select name="tag" class="variables-input" style="flex:0 0 130px">
                <option value="a-classifier">À classifier</option>
                <option value="deductible">Déductible</option>
                <option value="non-deductible">Non déductible</option>
            </select>
            <button type="submit" class="btn btn--primary btn--sm">Ajouter</button>
        </form>

        <div class="owned-section-title" style="margin-top:20px">Notes</div>
        <div class="owned-notes-list">
            ${[...(post.notes || [])].reverse().map(n => `
                <div class="owned-note-entry">
                    <p class="owned-note-text">${escapeHtml(n.text)}</p>
                    <span class="owned-note-date">${new Date(n.createdAt).toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })}</span>
                </div>
            `).join('') || '<p style="font-size:.82rem;color:var(--text-tertiary);font-style:italic">Aucune note.</p>'}
        </div>
        <div class="owned-notes-add">
            <textarea class="variables-input owned-notes-textarea" placeholder="Ajouter une note…" rows="3"></textarea>
            <button class="btn btn--primary btn--sm" data-action="save-note" type="button">Enregistrer</button>
        </div>
    `;

    // Charges récurrentes — save on change
    nodes.accPostAchatContent.querySelectorAll('[data-post-field]').forEach(input => {
        input.addEventListener('change', () => {
            const id = state.activeOwnedAssetId;
            if (!id) return;
            const val = Number(input.value);
            updateOwnedPostAchat(id, { [input.dataset.postField]: val });
            renderAccordionSimulateur(getOwnedAsset(id));
        });
    });

    // Supprimer travail
    nodes.accPostAchatContent.querySelectorAll('[data-delete-travail]').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = state.activeOwnedAssetId;
            if (!id) return;
            deleteOwnedTravail(id, btn.dataset.deleteTravail);
            renderAccordionPostAchat(getOwnedAsset(id));
            renderAccordionSimulateur(getOwnedAsset(id));
        });
    });

    // Ajouter travail
    nodes.accPostAchatContent.querySelector('[data-form="add-travail"]')?.addEventListener('submit', e => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const id = state.activeOwnedAssetId;
        if (!id) return;
        addOwnedTravail(id, {
            date: fd.get('date'),
            description: fd.get('description')?.trim(),
            montant: Number(fd.get('montant')),
            tag: fd.get('tag')
        });
        e.target.reset();
        renderAccordionPostAchat(getOwnedAsset(id));
        renderAccordionSimulateur(getOwnedAsset(id));
    });

    // Ajouter note
    nodes.accPostAchatContent.querySelector('[data-action="save-note"]')?.addEventListener('click', () => {
        const id = state.activeOwnedAssetId;
        if (!id) return;
        const textarea = nodes.accPostAchatContent.querySelector('.owned-notes-textarea');
        const text = textarea?.value.trim();
        if (!text) return;
        addOwnedNote(id, text);
        if (textarea) textarea.value = '';
        renderAccordionPostAchat(getOwnedAsset(id));
    });
}
```

- [ ] **7.2 — Vérifier visuellement**

```bash
python app.py
```

Ouvrir la fiche d'un bien. Ouvrir l'accordéon "Post-achat". Saisir une taxe foncière → sauvegardée. Ajouter un travail → apparaît dans la liste. Supprimer un travail. Ajouter une note → apparaît avec date.

- [ ] **7.3 — Commit**

```bash
git add main.js
git commit -m "feat(portfolio): accordéon Post-achat (charges, travaux, notes)"
```

---

## Tâche 8 — Accordéon Simulateur (matrice)

**Fichiers :**
- Modifier : `main.js`

### Étapes

- [ ] **8.1 — Ajouter `renderAccordionSimulateur()` dans `main.js`**

```js
function renderAccordionSimulateur(asset) {
    if (!nodes.accSimulateurContent) return;
    const tmi = getOwnedTmi();
    const scenarios = asset.scenarios || [];

    if (nodes.accSimulateurSummary) {
        nodes.accSimulateurSummary.textContent = `${scenarios.length} scénario${scenarios.length > 1 ? 's' : ''}`;
    }

    const VARS = [
        { key: 'loyer', label: 'Loyer (€/mois)', type: 'number', step: 10, min: 0 },
        { key: 'taxeFonciere', label: 'Taxe foncière (€/an)', type: 'number', step: 10, min: 0 },
        { key: 'vacance', label: 'Vacance (%)', type: 'number', step: 1, min: 0, max: 100 },
        { key: 'chargesCopro', label: 'Charges copro (€/mois)', type: 'number', step: 5, min: 0 },
        { key: 'regime', label: 'Régime fiscal', type: 'select', options: [
            { value: 'micro-foncier', label: 'Micro-foncier' },
            { value: 'reel', label: 'Réel' },
            { value: 'sci-is', label: 'SCI-IS' }
        ]},
    ];

    const results = scenarios.map(sc => computeOwnedAssetCF(asset, sc.variables, tmi));

    function cellInput(sc, varDef) {
        const val = sc.variables[varDef.key] ?? '';
        const isRealiste = sc.id === 'realiste';
        const cls = isRealiste ? 'col-realiste' : '';
        if (varDef.type === 'select') {
            return `<td class="${cls}">
                <select data-sc-id="${escapeHtml(sc.id)}" data-var-key="${escapeHtml(varDef.key)}">
                    ${varDef.options.map(o => `<option value="${o.value}" ${val === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
                </select>
            </td>`;
        }
        return `<td class="${cls}">
            <input type="number" min="${varDef.min ?? ''}" max="${varDef.max ?? ''}" step="${varDef.step}"
                value="${val}" data-sc-id="${escapeHtml(sc.id)}" data-var-key="${escapeHtml(varDef.key)}">
        </td>`;
    }

    nodes.accSimulateurContent.innerHTML = `
        <div class="owned-simulator-table-wrap">
            <table class="owned-simulator-table">
                <thead>
                    <tr>
                        <th class="col-var">Variable</th>
                        ${scenarios.map(sc => `
                            <th class="${sc.id === 'realiste' ? 'col-realiste' : ''}">
                                <input type="text" value="${escapeHtml(sc.nom)}"
                                    data-sc-nom="${escapeHtml(sc.id)}"
                                    style="background:transparent;border:none;color:inherit;font-weight:700;font-size:.7rem;text-transform:uppercase;letter-spacing:.06em;width:90px;text-align:center;cursor:text"
                                    title="Renommer le scénario">
                                ${scenarios.length > 1 ? `<button class="owned-sim-delete-sc" data-sc-id="${escapeHtml(sc.id)}" title="Supprimer" style="background:none;border:none;color:var(--text-tertiary);cursor:pointer;font-size:.7rem;padding:0 2px">✕</button>` : ''}
                            </th>
                        `).join('')}
                        <th><button class="owned-sim-add-btn" type="button">+ Scénario</button></th>
                    </tr>
                </thead>
                <tbody>
                    ${VARS.map(v => `
                    <tr>
                        <td class="col-var">${escapeHtml(v.label)}</td>
                        ${scenarios.map(sc => cellInput(sc, v)).join('')}
                        <td></td>
                    </tr>
                    `).join('')}
                    <tr class="row-result">
                        <td class="col-var">CF net-net / mois</td>
                        ${scenarios.map((sc, i) => {
                            const r = results[i];
                            const cf = r.cfNetNet;
                            const color = cf >= 0 ? '#3FB950' : '#F85149';
                            return `<td class="${sc.id === 'realiste' ? 'col-realiste' : ''}" style="color:${color}">
                                ${cf >= 0 ? '+' : ''}${Math.round(cf).toLocaleString('fr-FR')} €
                            </td>`;
                        }).join('')}
                        <td></td>
                    </tr>
                </tbody>
            </table>
        </div>
        <p class="owned-sim-hint">Variables non renseignées → valeurs héritées de Acquisition et Post-achat</p>
    `;

    // Modifier variable d'un scénario
    nodes.accSimulateurContent.querySelectorAll('[data-sc-id][data-var-key]').forEach(input => {
        input.addEventListener('change', () => {
            const id = state.activeOwnedAssetId;
            if (!id) return;
            const val = input.tagName === 'SELECT' ? input.value : Number(input.value);
            updateOwnedScenarioVar(id, input.dataset.scId, input.dataset.varKey, val);
            renderAccordionSimulateur(getOwnedAsset(id));
        });
    });

    // Renommer scénario
    nodes.accSimulateurContent.querySelectorAll('[data-sc-nom]').forEach(input => {
        input.addEventListener('change', () => {
            const id = state.activeOwnedAssetId;
            if (!id) return;
            updateOwnedScenarioNom(id, input.dataset.scNom, input.value.trim() || 'Sans nom');
        });
    });

    // Ajouter scénario
    nodes.accSimulateurContent.querySelector('.owned-sim-add-btn')?.addEventListener('click', () => {
        const id = state.activeOwnedAssetId;
        if (!id) return;
        addOwnedScenario(id);
        renderAccordionSimulateur(getOwnedAsset(id));
    });

    // Supprimer scénario
    nodes.accSimulateurContent.querySelectorAll('.owned-sim-delete-sc').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = state.activeOwnedAssetId;
            if (!id) return;
            deleteOwnedScenario(id, btn.dataset.scId);
            renderAccordionSimulateur(getOwnedAsset(id));
        });
    });
}
```

- [ ] **8.2 — Vérifier visuellement**

```bash
python app.py
```

Ouvrir la fiche d'un bien avec données d'acquisition saisies. Ouvrir l'accordéon "Simulateur". La matrice apparaît avec 3 colonnes (Pessimiste / Réaliste / Optimiste). Modifier le loyer dans le scénario Réaliste → CF recalcule. Ajouter un scénario → 4e colonne. Supprimer un scénario. Renommer un scénario.

- [ ] **8.3 — Commit**

```bash
git add main.js
git commit -m "feat(portfolio): accordéon Simulateur matrice scénarios"
```

---

## Tâche 9 — Diagnostic IA par bien

**Fichiers :**
- Modifier : `main.js`
- Modifier : `server.py`

### Étapes

- [ ] **9.1 — Adapter l'endpoint dans `server.py`**

Dans `server.py`, trouver l'endpoint `POST /api/portfolio-diagnostic`. Remplacer le prompt et la structure pour accepter un payload de type `{ "bien": {...} }` :

```python
@app.route('/api/portfolio-diagnostic', methods=['POST'])
def api_portfolio_diagnostic():
    try:
        from scraper.config import ANTHROPIC_API_KEY
    except ImportError:
        return jsonify({'error': 'Clé API non configurée dans config.py'}), 503

    payload = request.get_json(silent=True)
    if not payload:
        return jsonify({'error': 'Payload JSON manquant'}), 400

    prompt_user = f"""Voici les données d'un bien immobilier locatif détenu :

{json.dumps(payload, ensure_ascii=False, indent=2)}

Produis entre 3 et 5 recommandations priorisées, actionnables, en français naturel. Chaque recommandation doit avoir : un titre court, une explication de 2 à 4 phrases qui justifie le conseil avec des chiffres précis issus des données, et une action concrète à mener. Priorise les sujets fiscaux (régime, travaux déductibles), les risques de cash-flow (CF négatif, DSCR bas), et les optimisations. Réponds uniquement avec du JSON valide au format : {{"recommendations": [{{"title": "...", "explanation": "...", "action": "..."}}]}}"""

    try:
        client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
        message = client.messages.create(
            model='claude-sonnet-4-6',
            max_tokens=1024,
            system="Tu es un conseiller en investissement immobilier locatif français expert en fiscalité foncière. Tu réponds uniquement en JSON valide, sans markdown ni texte hors JSON.",
            messages=[{'role': 'user', 'content': prompt_user}]
        )
        raw = message.content[0].text.strip()
        result = json.loads(raw)
        return jsonify(result)
    except json.JSONDecodeError as e:
        return jsonify({'error': f'Réponse IA non parsable : {str(e)}'}), 502
    except Exception as e:
        return jsonify({'error': str(e)}), 500
```

- [ ] **9.2 — Ajouter `callOwnedDiagnosticIA()` dans `main.js`**

```js
async function callOwnedDiagnosticIA(assetId) {
    const asset = getOwnedAsset(assetId);
    if (!asset) return;
    const tmi = getOwnedTmi();

    const scenarios = asset.scenarios.map(sc => {
        const r = computeOwnedAssetCF(asset, sc.variables, tmi);
        return { nom: sc.nom, cfNetNet: Math.round(r.cfNetNet) };
    });

    const payload = {
        bien: {
            nom: asset.nom,
            ville: asset.ville,
            anneeAchat: asset.anneeAchat,
            acquisition: asset.acquisition,
            postAchat: {
                taxeFonciere: asset.postAchat?.taxeFonciere,
                chargesCopro: asset.postAchat?.chargesCopro,
                travaux: (asset.postAchat?.travaux || []).map(t => ({
                    date: t.date, description: t.description, montant: t.montant, tag: t.tag
                })),
                notes: (asset.postAchat?.notes || []).map(n => ({ text: n.text }))
            },
            scenarios,
            profilFiscal: { tmi }
        }
    };

    if (!nodes.ownedAiDrawer || !nodes.ownedAiOverlay || !nodes.ownedAiDrawerContent) return;

    // Afficher le drawer avec état de chargement
    nodes.ownedAiDrawerContent.innerHTML = `<p style="color:var(--text-secondary);text-align:center;padding:24px">Analyse en cours…</p>`;
    nodes.ownedAiDrawer.hidden = false;
    nodes.ownedAiOverlay.hidden = false;

    try {
        const resp = await fetch('/api/portfolio-diagnostic', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await resp.json();

        if (!resp.ok || data.error) {
            nodes.ownedAiDrawerContent.innerHTML = `<p style="color:#F85149;padding:16px">${escapeHtml(data.error || 'Erreur inconnue')}</p>`;
            return;
        }

        const recs = data.recommendations || [];
        const now = new Date().toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });

        nodes.ownedAiDrawerContent.innerHTML = `
            <p style="font-size:.75rem;color:var(--text-tertiary);margin-bottom:16px">Analyse du ${now}</p>
            ${recs.map((r, i) => `
                <div style="border:1px solid var(--border-subtle);border-radius:8px;padding:14px;margin-bottom:10px">
                    <div style="font-weight:700;font-size:.9rem;color:var(--text-primary);margin-bottom:6px">${i + 1}. ${escapeHtml(r.title)}</div>
                    <p style="font-size:.83rem;color:var(--text-secondary);line-height:1.5;margin:0 0 8px">${escapeHtml(r.explanation)}</p>
                    <div style="font-size:.78rem;color:var(--accent-gold,#C5A059)">→ ${escapeHtml(r.action)}</div>
                </div>
            `).join('')}
        `;

        // Sauvegarder le dernier diagnostic
        updateOwnedAsset(assetId, { lastDiagnostic: { date: new Date().toISOString(), recommendations: recs } });

    } catch (err) {
        nodes.ownedAiDrawerContent.innerHTML = `<p style="color:#F85149;padding:16px">Erreur réseau : ${escapeHtml(err.message)}</p>`;
    }
}
```

- [ ] **9.3 — Câbler le bouton Diagnostic IA et la fermeture du drawer**

Dans la section d'initialisation des events (chercher `nodes.ownedDiagnosticBtn` ou ajouter après l'init des events de l'accordéon) :

```js
if (nodes.ownedDiagnosticBtn) {
    nodes.ownedDiagnosticBtn.addEventListener('click', () => {
        const id = state.activeOwnedAssetId;
        if (id) callOwnedDiagnosticIA(id);
    });
}
if (nodes.ownedAiDrawerClose) {
    nodes.ownedAiDrawerClose.addEventListener('click', () => {
        if (nodes.ownedAiDrawer) nodes.ownedAiDrawer.hidden = true;
        if (nodes.ownedAiOverlay) nodes.ownedAiOverlay.hidden = true;
    });
}
if (nodes.ownedAiOverlay) {
    nodes.ownedAiOverlay.addEventListener('click', () => {
        if (nodes.ownedAiDrawer) nodes.ownedAiDrawer.hidden = true;
        nodes.ownedAiOverlay.hidden = true;
    });
}
```

- [ ] **9.4 — Vérifier**

```bash
python app.py
```

Ouvrir la fiche d'un bien avec données saisies. Cliquer "✦ Diagnostic IA" → drawer s'ouvre avec "Analyse en cours…". Si la clé API est configurée dans `scraper/config.py`, les recommandations apparaissent. Sinon : message d'erreur non bloquant.

- [ ] **9.5 — Commit**

```bash
git add main.js server.py
git commit -m "feat(portfolio): diagnostic IA par bien avec drawer"
```

---

## Tâche 10 — Wiring `renderCollections()` + cleanup

**Fichiers :**
- Modifier : `main.js`

### Étapes

- [ ] **10.1 — Remplacer `renderCollections()` dans `main.js`**

Trouver `function renderCollections()` (ligne ~4179). Remplacer entièrement par :

```js
function renderCollections() {
    if (IS_ANALYSIS_WINDOW) {
        nodes.collectionPanel.hidden = true;
        return;
    }
    nodes.collectionPanel.hidden = false;

    // Si on est en vue détaillée, re-render la fiche active
    if (state.activeOwnedAssetId) {
        if (nodes.ownedListView) nodes.ownedListView.hidden = true;
        if (nodes.ownedDetailView) nodes.ownedDetailView.hidden = false;
        renderOwnedDetail();
    } else {
        if (nodes.ownedListView) nodes.ownedListView.hidden = false;
        if (nodes.ownedDetailView) nodes.ownedDetailView.hidden = true;
        renderOwnedPortfolioList();
    }
}
```

- [ ] **10.2 — Supprimer les fonctions obsolètes**

Supprimer les fonctions suivantes (elles référencent `assetRecords` et `collectionsView`) :
- `buildPortfolioSimulator`
- `buildPortfolioKpiBanner`
- `computePortfolioAdvice`
- `buildPortfolioDashboardZone`
- `buildPortfolioAdviceZone`
- `buildPortfolioFiches`
- `buildFicheTravaux`
- `buildFicheNotes`
- `buildPortfolioPipelineZone`
- `buildPortfolioAssetCard`
- `buildPortfolioAssetGrid`
- `buildPortfolioHero`
- `buildComparisonTable` (si elle ne sert plus qu'au portefeuille — vérifier si utilisée ailleurs)
- `buildPortfolioTable`

**Important :** Ne pas supprimer `buildCollectionsView()` — elle est toujours utilisée pour le comparateur dans l'Analyse.

Supprimer aussi dans le bloc `nodes = { ... }` les références devenues orphelines :
```
portfolioAlerts, portfolioAdvice, portfolioAdviceCards, portfolioOwnedZone,
portfolioFiches, portfolioPipelineZone, portfolioDonutConsolidatedWrap,
portfolioAiDrawer, portfolioAiOverlay, portfolioAiDrawerContent,
portfolioAiTrigger, portfolioAiLastDate, portfolioHero, portfolioSummary,
portfolioAssetGridOwned, portfolioAssetGridPipeline, portfolioSimulator
```

- [ ] **10.3 — Supprimer les anciens nœuds dans `index.html` si présents**

Dans `index.html`, s'assurer qu'il ne reste plus de références aux anciens IDs supprimés (ex. `portfolio-kpi-banner`, `portfolio-fiches`, etc.) — ils ont été remplacés à la tâche 3, donc cette étape est une vérification.

```bash
grep -n "portfolio-kpi-banner\|portfolio-fiches\|portfolio-advice\|portfolio-donut\|portfolio-alerts\|portfolio-ai-trigger" index.html
```

Expected output : aucune ligne (ou seulement des commentaires).

- [ ] **10.4 — Vérifier console**

```bash
python app.py
```

Console : aucune erreur `Cannot read properties of null` ni `is not a function`. Onglet Analyse : inchangé, fonctionne normalement. Onglet Portefeuille : liste ou fiche selon l'état.

- [ ] **10.5 — Commit**

```bash
git add main.js index.html
git commit -m "feat(portfolio): wiring renderCollections + cleanup fonctions obsolètes"
```

---

## Self-review du plan

**Couverture spec :**
- ✅ Nouveau modèle `portfolioOwnedAssets` — Tâche 2
- ✅ Vue globale liste avec KPIs — Tâche 5
- ✅ Vue détaillée par bien, 3 accordéons — Tâches 6, 7, 8
- ✅ Accordéon Acquisition — Tâche 6
- ✅ Accordéon Post-achat (travaux, notes, charges) — Tâche 7
- ✅ Simulateur matrice scénarios — Tâche 8
- ✅ `computeOwnedAssetCF` dans `calculs.js` — Tâche 1
- ✅ Diagnostic IA par bien — Tâche 9
- ✅ Séparation totale / suppression "Charger dans le simulateur" — Tâche 10
- ✅ Comportement limite 0 bien — `renderOwnedPortfolioList` empty state
- ✅ Comportement limite bien sans crédit — `computeOwnedAssetCF` avec `montant=0`
- ✅ Héritage variables non saisies dans scénario — hint + valeur `??` dans `computeOwnedAssetCF`

**Noms cohérents entre tâches :**
- `computeOwnedAssetCF(asset, scenario.variables, tmi)` — Tâche 1 → utilisé en Tâche 5, 8, 9 ✅
- `loadOwnedAssets()`, `createOwnedAsset()`, `getOwnedAsset()`, `updateOwnedAsset()`, `deleteOwnedAsset()` — Tâche 2 → utilisés en Tâche 5 ✅
- `addOwnedTravail()`, `deleteOwnedTravail()`, `addOwnedNote()` — Tâche 2 → utilisés en Tâche 7 ✅
- `addOwnedScenario()`, `updateOwnedScenarioVar()`, `updateOwnedScenarioNom()`, `deleteOwnedScenario()` — Tâche 2 → utilisés en Tâche 8 ✅
- `state.activeOwnedAssetId` — Tâche 2 → utilisé en Tâches 5, 6, 7, 8, 10 ✅
- `nodes.ownedListView`, `nodes.ownedDetailView`, etc. — Tâche 3 → utilisés en Tâches 5, 6, 10 ✅
