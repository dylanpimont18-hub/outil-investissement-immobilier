# Portfolio Refonte Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refonte complète de l'onglet Portefeuille — suppression de 5 sections désuètes, ajout de 7 nouvelles (vue fiscale, taux d'endettement bancaire ×2, progression objectif CF, projection patrimoniale, graphique répartition, tableau crédits, timeline) et d'un drawer d'échéancier crédit par bien détenu.

**Architecture:** On supprime d'abord les sections dépréciées (calculs.js + main.js + index.html), on étend les modèles de données (assetRecord.creditSchedule, profileData.objectifCF/revaloAnnuelle), on ajoute les nouvelles fonctions pures dans calculs.js puis les renderers dans main.js, et enfin on stylise dans styles.css.

**Tech Stack:** Vanilla JS ES modules, Flask (serveur local), PyWebView (desktop), localStorage pour la persistance, CSS custom properties, pas de lib externe.

---

## Fichiers touchés

| Fichier | Rôle dans ce plan |
|---|---|
| `calculs.js` | Supprimer 6 fonctions privées, simplifier `computePortfolioViewModel`, ajouter 5 nouvelles fonctions pures |
| `main.js` | Supprimer 5 render functions, simplifier hero/metric cards/renderCollections, étendre modèle données, ajouter 7 nouveaux renderers, drawer crédit |
| `index.html` | Restructurer section portefeuille, ajouter containers nouveaux blocs, ajouter drawer crédit HTML, champs profil |
| `styles.css` | Styles pour tous les nouveaux composants |

---

## Task 1 — calculs.js : supprimer fonctions dépréciées

**Files:**
- Modify: `calculs.js:1224-1711`

- [ ] **Step 1 : Supprimer les 6 fonctions privées dépréciées**

Dans `calculs.js`, supprimer les blocs suivants **en entier** (bloc = de la ligne `function X(` jusqu'à la `}` fermante incluse) :

1. `buildPortfolioHealthDecision` (lignes 1224–1316)
2. `buildPortfolioAlerts` (lignes 1318–1361)
3. `estimateFinancedAmount` (lignes 1432–1448)
4. `buildPortfolioCapacity` (lignes 1450–1484)
5. `buildPortfolioConcentration` (lignes 1485–1545)
6. `buildAcquisitionArbitrage` (lignes 1546–1712)

- [ ] **Step 2 : Simplifier `computePortfolioViewModel`**

Remplacer le corps de `computePortfolioViewModel` à partir de `const dashboard = ...` (ligne 1668) jusqu'à la fin de la fonction par :

```js
    const dashboard = buildPortfolioDashboard(portfolioItems, tmi, income);
    const priorities = buildPortfolioPriorities(portfolioItems);

    return {
        comparisonItems,
        portfolioItems,
        dashboard,
        priorities
    };
```

- [ ] **Step 3 : Vérifier que le fichier compile**

```bash
node --input-type=module < calculs.js
```
Aucune erreur `ReferenceError` ou `SyntaxError` attendue.

- [ ] **Step 4 : Commit**

```bash
git add calculs.js
git commit -m "refactor(calculs): retire capacité/concentration/alertes/arbitrage du portefeuille"
```

---

## Task 2 — main.js : supprimer renderers dépréciés + simplifier hero

**Files:**
- Modify: `main.js`

- [ ] **Step 1 : Supprimer les 5 render functions**

Dans `main.js`, supprimer en entier les fonctions suivantes :

1. `buildPortfolioDecision(decision)` (fonction entière)
2. `buildPortfolioAlerts(alerts)` (fonction entière — attention : c'est la version DOM, pas celle de calculs.js)
3. `buildPortfolioCapacity(capacity)` (fonction entière)
4. `buildPortfolioConcentration(concentration)` (fonction entière)
5. `buildAcquisitionArbitrage(acquisitions)` (fonction entière)

- [ ] **Step 2 : Supprimer les nodes dépréciés**

Dans le bloc `const nodes = { ... }`, supprimer ces 5 lignes :

```js
    portfolioDecision: document.getElementById('portfolio-decision'),
    portfolioAlerts: document.getElementById('portfolio-alerts'),
    portfolioCapacity: document.getElementById('portfolio-capacity'),
    portfolioConcentration: document.getElementById('portfolio-concentration'),
    acquisitionArbitrage: document.getElementById('acquisition-arbitrage'),
```

- [ ] **Step 3 : Simplifier `buildCollectionMetricCards`**

Remplacer la fonction entière par :

```js
function buildCollectionMetricCards(dashboard) {
    const cards = [
        { label: 'Biens suivis', value: String(dashboard.assetCount), cssClass: '' },
        { label: 'Biens détenus', value: String(dashboard.ownedCount), cssClass: '' },
        { label: 'CF consolidé', value: formatSignedCurrency(dashboard.totalCashflow), cssClass: getMetricClass(dashboard.totalCashflow) },
        { label: 'Fiscalité locative', value: formatPlainCurrency(dashboard.consolidatedTaxAnnual), cssClass: dashboard.consolidatedTaxAnnual > 0 ? 'is-watch' : 'is-positive' },
        { label: 'Dette mensuelle', value: formatPlainCurrency(dashboard.totalDebtMonthly), cssClass: '' },
        { label: 'Valeur créée à 10 ans', value: formatSignedCurrency(dashboard.totalTraction), cssClass: getMetricClass(dashboard.totalTraction) },
    ];

    nodes.portfolioSummary.innerHTML = cards.map(card => `
        <article class="metric-card">
            <span class="metric-label">${card.label}</span>
            <strong class="metric-value ${card.cssClass}">${card.value}</strong>
        </article>
    `).join('');
}
```

- [ ] **Step 4 : Simplifier `buildPortfolioHero`**

Remplacer la fonction entière par :

```js
function buildPortfolioHero(collectionsView) {
    if (!nodes.portfolioHero) return;

    const { dashboard } = collectionsView;
    const assetCount = dashboard.assetCount || 0;

    let tone = 'neutral', label = 'À initialiser', summary = 'Ajoutez un premier actif pour obtenir une synthèse consolidée.', action = 'Enregistrer un dossier dans le comparateur ou le portefeuille.';
    if (assetCount > 0) {
        if (dashboard.totalCashflow < 0 || dashboard.dscr < 1) {
            tone = 'negative'; label = 'Sous tension';
            summary = 'Le portefeuille consomme de la trésorerie ou ne couvre plus sa dette.';
            action = 'Traiter les biens les plus faibles avant toute nouvelle acquisition.';
        } else if (dashboard.totalCashflow < 150 || dashboard.dscr < 1.1) {
            tone = 'watch'; label = 'À consolider';
            summary = 'Le portefeuille tient globalement, mais certains équilibres doivent encore être stabilisés.';
            action = 'Sécuriser les actifs les moins réguliers avant extension.';
        } else {
            tone = 'positive'; label = 'Conforme';
            summary = 'Le portefeuille couvre sa dette et conserve une marge consolidée exploitable.';
            action = 'Examiner uniquement les acquisitions qui améliorent l équilibre global.';
        }
    }

    nodes.portfolioHero.innerHTML = `
        <div class="workspace-hero-card workspace-hero-card--${tone}">
            <div class="workspace-hero-copy">
                <div class="workspace-hero-eyebrow">
                    <span class="workspace-hero-kicker">Synthèse portefeuille</span>
                    <span class="status-pill status-pill--${tone}">${escapeHtml(label)}</span>
                </div>
                <h2>${assetCount > 0 ? `${assetCount} actif${assetCount > 1 ? 's' : ''} suivi${assetCount > 1 ? 's' : ''}` : 'Portefeuille à initialiser'}</h2>
                <p class="workspace-hero-summary">${escapeHtml(summary)}</p>
                <div class="workspace-hero-action">
                    <span>Point de contrôle</span>
                    <strong>${escapeHtml(action)}</strong>
                </div>
                <div class="workspace-hero-meta">
                    <span class="workspace-hero-chip">${dashboard.ownedCount} détenu${dashboard.ownedCount > 1 ? 's' : ''}</span>
                    <span class="workspace-hero-chip">${escapeHtml(getProfileDisplayName())}</span>
                </div>
            </div>
            <aside class="workspace-hero-score">
                <span class="workspace-hero-score-label">Actifs suivis</span>
                <strong class="workspace-hero-score-value workspace-hero-score-value--${tone}">${assetCount}<small>${assetCount > 1 ? ' biens' : ' bien'}</small></strong>
                <span class="decision-badge decision-badge--${tone}">${escapeHtml(label)}</span>
                <div class="workspace-hero-mini-grid">
                    <article class="workspace-hero-mini-card">
                        <span>CF consolidé</span>
                        <strong class="value-${dashboard.totalCashflow >= 0 ? 'positive' : 'negative'}">${formatSignedCurrency(dashboard.totalCashflow)}</strong>
                    </article>
                    <article class="workspace-hero-mini-card">
                        <span>Dette mensuelle</span>
                        <strong>${formatPlainCurrency(dashboard.totalDebtMonthly)}</strong>
                    </article>
                    <article class="workspace-hero-mini-card">
                        <span>DSCR consolidé</span>
                        <strong class="value-${dashboard.dscr >= 1.1 ? 'positive' : dashboard.dscr >= 1 ? '' : 'negative'}">${dashboard.dscr.toFixed(2).replace('.', ',')}</strong>
                    </article>
                    <article class="workspace-hero-mini-card">
                        <span>Fiscalité / an</span>
                        <strong>${formatPlainCurrency(dashboard.consolidatedTaxAnnual)}</strong>
                    </article>
                </div>
            </aside>
        </div>
    `;
}
```

- [ ] **Step 5 : Simplifier `renderCollections`**

Remplacer la fonction entière par :

```js
function renderCollections() {
    if (IS_ANALYSIS_WINDOW) {
        nodes.collectionPanel.hidden = true;
        return;
    }

    nodes.collectionPanel.hidden = false;
    const collectionsView = buildCollectionsView();
    buildPortfolioKpiBanner(collectionsView);
    buildPortfolioHero(collectionsView);
    buildCollectionMetricCards(collectionsView.dashboard);
    buildPortfolioPriorities(collectionsView.priorities);
    buildPortfolioAssetGrid(collectionsView);
}
```

- [ ] **Step 6 : Vérifier que l'app démarre sans erreur JS**

Lancer `python app.py` et vérifier dans la console qu'il n'y a aucune `ReferenceError` ou `TypeError`.

- [ ] **Step 7 : Commit**

```bash
git add main.js
git commit -m "refactor(main): retire renderers dépréciés du portefeuille, simplifie hero et metric cards"
```

---

## Task 3 — index.html : restructurer la section portefeuille

**Files:**
- Modify: `index.html:636-679`

- [ ] **Step 1 : Remplacer la zone portefeuille**

Dans `index.html`, repérer le bloc compris entre `<div id="portfolio-kpi-banner">` et `</section>` (fin du panneau `collection-panel`, avant `<section id="feasibility-panel"`). Remplacer tout le contenu interne de ce panneau (après le `panel-head`) par :

```html
                <div id="portfolio-kpi-banner"></div>
                <section id="portfolio-hero" class="workspace-hero" aria-label="Synthèse portefeuille"></section>

                <div id="portfolio-summary" class="analysis-grid"></div>

                <div id="portfolio-asset-grid-owned" class="portfolio-asset-section"></div>
                <div id="portfolio-asset-grid-pipeline" class="portfolio-asset-section"></div>

                <div class="analysis-tables">
                    <section class="analysis-block">
                        <h4>Priorités de portefeuille</h4>
                        <div id="portfolio-priorities"></div>
                    </section>
                </div>

                <div class="analysis-columns">
                    <section class="analysis-block">
                        <h4>Vue fiscale consolidée</h4>
                        <div id="portfolio-fiscal"></div>
                    </section>
                    <section class="analysis-block">
                        <h4>Taux d'endettement bancaire</h4>
                        <div id="portfolio-debt-ratios"></div>
                    </section>
                </div>

                <div class="analysis-columns">
                    <section class="analysis-block">
                        <h4>Progression vers l'objectif</h4>
                        <div id="portfolio-objectif"></div>
                    </section>
                    <section class="analysis-block">
                        <h4>Projection patrimoniale</h4>
                        <div id="portfolio-projection"></div>
                    </section>
                </div>

                <div class="analysis-tables">
                    <section class="analysis-block">
                        <h4>Répartition par bien</h4>
                        <div id="portfolio-repartition"></div>
                    </section>
                </div>

                <div class="analysis-tables">
                    <section class="analysis-block">
                        <h4>Crédits en cours</h4>
                        <div id="portfolio-credits"></div>
                    </section>
                </div>

                <div class="analysis-tables">
                    <section class="analysis-block">
                        <h4>Chronologie des biens</h4>
                        <div id="portfolio-timeline"></div>
                    </section>
                </div>
```

- [ ] **Step 2 : Ajouter le drawer crédit juste avant `</body>`**

Ajouter avant la balise `</body>` :

```html
    <!-- Drawer échéancier crédit -->
    <div id="credit-drawer-overlay" class="drawer-overlay" style="display:none" aria-hidden="true"></div>
    <aside id="credit-drawer" class="drawer" style="display:none" role="dialog" aria-modal="true" aria-labelledby="credit-drawer-title">
        <div class="drawer-inner">
            <div class="drawer-head">
                <h3 id="credit-drawer-title" class="drawer-title">Échéancier crédit</h3>
                <button type="button" id="credit-drawer-close" class="drawer-close" aria-label="Fermer">✕</button>
            </div>
            <div class="drawer-body">
                <p id="credit-drawer-asset-name" class="credit-drawer-asset-name"></p>
                <form id="credit-drawer-form" class="credit-drawer-form" novalidate>
                    <input type="hidden" id="credit-drawer-asset-id">
                    <div class="form-field">
                        <label class="form-label" for="credit-date-debut">Date de début du crédit</label>
                        <input type="month" id="credit-date-debut" class="variables-input">
                    </div>
                    <div class="form-field">
                        <label class="form-label" for="credit-date-fin">Date de fin du crédit</label>
                        <input type="month" id="credit-date-fin" class="variables-input">
                    </div>
                    <div class="form-field">
                        <label class="form-label" for="credit-mensualite">Mensualité réelle (€ / mois)</label>
                        <input type="number" id="credit-mensualite" class="variables-input" min="0" step="10" placeholder="0">
                    </div>
                    <div class="form-field">
                        <label class="form-label" for="credit-date-revente">Revente envisagée <span class="form-label-optional">(optionnel)</span></label>
                        <input type="month" id="credit-date-revente" class="variables-input">
                    </div>
                    <div class="drawer-actions">
                        <button type="button" id="credit-drawer-cancel" class="btn-secondary">Annuler</button>
                        <button type="submit" id="credit-drawer-save" class="btn-primary">Enregistrer</button>
                    </div>
                </form>
            </div>
        </div>
    </aside>
```

- [ ] **Step 3 : Vérifier que l'app s'affiche**

Lancer `python app.py`. L'onglet Portefeuille doit s'afficher avec les sections visibles (vides mais présentes).

- [ ] **Step 4 : Commit**

```bash
git add index.html
git commit -m "feat(html): restructure section portefeuille, ajoute containers nouveaux blocs et drawer crédit"
```

---

## Task 4 — Modèles de données : creditSchedule + profileData

**Files:**
- Modify: `main.js`

- [ ] **Step 1 : Étendre `sanitizeAssetRecord`**

Remplacer la fonction `sanitizeAssetRecord` par :

```js
function sanitizeAssetRecord(rawAsset) {
    if (!rawAsset || typeof rawAsset !== 'object') {
        return null;
    }

    const raw = rawAsset.creditSchedule;
    const creditSchedule = (raw && typeof raw === 'object') ? {
        dateDebut: typeof raw.dateDebut === 'string' ? raw.dateDebut : '',
        dateFin: typeof raw.dateFin === 'string' ? raw.dateFin : '',
        mensualite: Math.max(0, Number(raw.mensualite) || 0)
    } : null;

    return {
        id: typeof rawAsset.id === 'string' && rawAsset.id ? rawAsset.id : createAssetId(),
        variablesData: sanitizeVariablesData({ ...VARIABLE_DEFAULTS, ...(rawAsset.variablesData || {}) }),
        inComparison: Boolean(rawAsset.inComparison),
        inPortfolio: Boolean(rawAsset.inPortfolio),
        creditSchedule: creditSchedule,
        dateRevente: typeof rawAsset.dateRevente === 'string' ? rawAsset.dateRevente : '',
        createdAt: Number(rawAsset.createdAt) || Date.now(),
        updatedAt: Number(rawAsset.updatedAt) || Date.now()
    };
}
```

- [ ] **Step 2 : Préserver creditSchedule + dateRevente dans `createOrUpdateCurrentAsset`**

Dans la fonction `createOrUpdateCurrentAsset`, remplacer le bloc `const nextRecord = { ... }` par :

```js
    const nextRecord = {
        id: assetId,
        variablesData: sanitizeVariablesData(state.variablesData),
        inComparison: Boolean(baseRecord?.inComparison) || Boolean(flags.inComparison),
        inPortfolio: Boolean(baseRecord?.inPortfolio) || Boolean(flags.inPortfolio),
        creditSchedule: baseRecord?.creditSchedule ?? null,
        dateRevente: baseRecord?.dateRevente ?? '',
        createdAt: baseRecord?.createdAt || now,
        updatedAt: now
    };
```

- [ ] **Step 3 : Étendre `sanitizeProfileData`**

Remplacer la fonction `sanitizeProfileData` par :

```js
function sanitizeProfileData(rawProfile) {
    return {
        name: normalizeLegacyCopy(rawProfile.name || 'Profil') || 'Profil',
        income: Math.max(0, Number(rawProfile.income) || 0),
        adults: Math.min(2, Math.max(1, Number(rawProfile.adults) || 1)),
        children: Math.max(0, Math.round(Number(rawProfile.children) || 0)),
        objectifCF: Math.max(0, Number(rawProfile.objectifCF) || 1000),
        revaloAnnuelle: Math.max(0, Math.min(20, Number(rawProfile.revaloAnnuelle) || 2))
    };
}
```

- [ ] **Step 4 : Étendre `buildCollectionsView`**

Remplacer la fonction `buildCollectionsView` par :

```js
function buildCollectionsView() {
    return computePortfolioViewModel(state.assetRecords, {
        income: state.profileData.income,
        adults: state.profileData.adults,
        children: state.profileData.children,
        objectifCF: state.profileData.objectifCF,
        revaloAnnuelle: state.profileData.revaloAnnuelle
    }, state.activeAssetId, state.variablesData);
}
```

- [ ] **Step 5 : Commit**

```bash
git add main.js
git commit -m "feat(data): étend assetRecord (creditSchedule/dateRevente) et profileData (objectifCF/revaloAnnuelle)"
```

---

## Task 5 — calculs.js : nouvelles fonctions pures + étendre computePortfolioViewModel

**Files:**
- Modify: `calculs.js`

- [ ] **Step 1 : Ajouter 5 fonctions pures après `buildPortfolioPriorities`**

Insérer le bloc suivant juste après la fonction `buildPortfolioPriorities` (autour de la ligne 1384, avant `buildPortfolioDashboard`) :

```js
function capitalRestantDu(mensualite, dateFinStr) {
    if (!dateFinStr) return null;
    const [finYear, finMonth] = dateFinStr.split('-').map(Number);
    if (!finYear || !finMonth) return null;
    const now = new Date();
    const monthsRemaining = Math.max(0,
        (finYear - now.getFullYear()) * 12 + (finMonth - 1 - now.getMonth())
    );
    return Math.round(mensualite * monthsRemaining);
}

function computeDebtRatios(mensualitesTotales, totalRentMonthly, income) {
    const revenuMensuel = Math.max(1, income / 12);

    const hcsfDenum = revenuMensuel + 0.7 * totalRentMonthly;
    const hcsfRatio = hcsfDenum > 0 ? (mensualitesTotales / hcsfDenum) * 100 : 0;
    const hcsfTone = hcsfRatio <= 28 ? 'positive' : hcsfRatio <= 35 ? 'watch' : 'negative';

    const effortNet = Math.max(0, mensualitesTotales - totalRentMonthly);
    const diffRatio = (effortNet / revenuMensuel) * 100;
    const diffTone = diffRatio <= 20 ? 'positive' : diffRatio <= 33 ? 'watch' : 'negative';

    return {
        hcsf: { ratio: hcsfRatio, seuil: 35, tone: hcsfTone },
        differentielle: { ratio: diffRatio, seuil: 33, tone: diffTone }
    };
}

function computePortfolioFiscal(portfolioItems, tmi) {
    const tauxGlobal = (tmi / 100) + CSG_CRDS_RATE;
    const regimes = {
        'micro-foncier': { label: 'Micro-foncier', count: 0, loyersAnnuels: 0, impots: 0 },
        'reel': { label: 'Foncier Réel', count: 0, loyersAnnuels: 0, impots: 0 },
        'sci-is': { label: 'SCI à l\'IS', count: 0, loyersAnnuels: 0, impots: 0 }
    };
    let totalImpots = 0;

    portfolioItems.forEach(item => {
        const snap = item.taxSnapshot;
        const regime = snap.regime || 'micro-foncier';
        const r = regimes[regime] || regimes['micro-foncier'];
        r.count++;
        r.loyersAnnuels += item.model.loyersEncaisses;

        let itemTax = 0;
        if (snap.regime === 'micro-foncier') {
            itemTax = Math.max(0, snap.taxableBase * tauxGlobal);
        } else if (snap.regime === 'reel') {
            if (snap.taxableBase > 0) {
                itemTax = snap.taxableBase * tauxGlobal;
            } else if (snap.deficitHorsInterets < 0) {
                itemTax = -(Math.min(10700, Math.abs(snap.deficitHorsInterets)) * (tmi / 100));
            }
        } else {
            itemTax = snap.taxableBase > 0
                ? Math.min(snap.taxableBase, 42500) * 0.15 + Math.max(0, snap.taxableBase - 42500) * 0.25
                : 0;
        }
        r.impots += itemTax;
        totalImpots += itemTax;
    });

    return { totalImpots, tmi, regimes };
}

function computeProjectionPatrimoniale(portfolioItems, revaloAnnuelle) {
    const r = Math.max(0, (revaloAnnuelle || 2)) / 100;
    const currentValue = portfolioItems.reduce((sum, item) => {
        const prix = Math.max(0, (item.variablesData?.['prix'] || 0) - (item.variablesData?.['nego'] || 0));
        return sum + prix;
    }, 0);
    return {
        currentValue,
        at5: Math.round(currentValue * Math.pow(1 + r, 5)),
        at10: Math.round(currentValue * Math.pow(1 + r, 10)),
        at15: Math.round(currentValue * Math.pow(1 + r, 15)),
        revaloAnnuelle: revaloAnnuelle || 2
    };
}

function computeProgressionObjectif(dashboard, objectifCF) {
    const current = dashboard.totalCashflow;
    const target = Math.max(1, objectifCF || 1000);
    const pct = Math.min(100, Math.max(0, (current / target) * 100));
    const delta = target - current;
    const avgCF = dashboard.assetCount > 0 ? current / dashboard.assetCount : 0;
    const estimatedAssetsNeeded = delta > 0 && avgCF > 50 ? Math.ceil(delta / avgCF) : null;
    const tone = pct >= 100 ? 'excellent' : pct >= 75 ? 'positive' : pct >= 40 ? 'watch' : 'neutral';
    return { current, target, pct, delta, estimatedAssetsNeeded, tone };
}
```

- [ ] **Step 2 : Étendre assetViews dans `computePortfolioViewModel`**

Dans `computePortfolioViewModel`, dans le `.map(asset => { ... })`, ajouter `creditSchedule` et `dateRevente` dans l'objet retourné (après `inPortfolio`) :

```js
            creditSchedule: asset.creditSchedule || null,
            dateRevente: asset.dateRevente || '',
            variablesData: asset.variablesData,
```

- [ ] **Step 3 : Étendre la valeur de retour de `computePortfolioViewModel`**

Remplacer le return de `computePortfolioViewModel` par :

```js
    const dashboard = buildPortfolioDashboard(portfolioItems, tmi, income);
    const priorities = buildPortfolioPriorities(portfolioItems);

    const mensualitesTotales = portfolioItems.reduce((sum, item) => {
        const m = item.creditSchedule ? item.creditSchedule.mensualite : (item.model.mensualiteTotale || 0);
        return sum + m;
    }, 0);

    return {
        comparisonItems,
        portfolioItems,
        dashboard,
        priorities,
        fiscal: computePortfolioFiscal(portfolioItems, tmi),
        debtRatios: computeDebtRatios(mensualitesTotales, dashboard.totalRentMonthly, income),
        projection: computeProjectionPatrimoniale(portfolioItems, householdProfile.revaloAnnuelle || 2),
        objectif: computeProgressionObjectif(dashboard, householdProfile.objectifCF || 1000)
    };
```

- [ ] **Step 4 : Commit**

```bash
git add calculs.js
git commit -m "feat(calculs): ajoute 5 fonctions portefeuille (fiscal, dette, projection, objectif, capitalRestantDu)"
```

---

## Task 6 — Drawer crédit : JS complet

**Files:**
- Modify: `main.js`

- [ ] **Step 1 : Ajouter les nodes du drawer crédit**

Dans le bloc `const nodes = { ... }`, ajouter après les nodes existants du portefeuille :

```js
    creditDrawerOverlay: document.getElementById('credit-drawer-overlay'),
    creditDrawer: document.getElementById('credit-drawer'),
    creditDrawerForm: document.getElementById('credit-drawer-form'),
    creditDrawerAssetId: document.getElementById('credit-drawer-asset-id'),
    creditDrawerAssetName: document.getElementById('credit-drawer-asset-name'),
    creditDateDebut: document.getElementById('credit-date-debut'),
    creditDateFin: document.getElementById('credit-date-fin'),
    creditMensualite: document.getElementById('credit-mensualite'),
    creditDateRevente: document.getElementById('credit-date-revente'),
```

- [ ] **Step 2 : Ajouter le bouton "Crédit" dans `buildPortfolioAssetCard`**

Dans la fonction `buildPortfolioAssetCard`, dans la section `<div class="asset-card__actions">`, ajouter un bouton "Crédit" uniquement pour les biens détenus (`!isPipeline`) :

Remplacer le bloc `<div class="asset-card__actions">` par :

```js
                <div class="asset-card__actions">
                    <button type="button" class="asset-card__action${isPipeline ? ' asset-card__action--primary' : ''}" data-action="open-asset" data-id="${escapeHtml(item.id)}">↩ Ouvrir</button>
                    <button type="button" class="asset-card__action" data-action="preview-asset" data-scope="${isPipeline ? 'comparison' : 'portfolio'}" data-id="${escapeHtml(item.id)}">Fiche</button>
                    <button type="button" class="asset-card__action" data-action="pdf-asset" data-id="${escapeHtml(item.id)}">PDF</button>
                    ${!isPipeline ? `<button type="button" class="asset-card__action${item.creditSchedule ? ' asset-card__action--has-credit' : ''}" data-action="edit-credit" data-id="${escapeHtml(item.id)}">Crédit${item.creditSchedule ? ' ✓' : ''}</button>` : ''}
                </div>
```

- [ ] **Step 3 : Ajouter les 3 fonctions du drawer crédit**

Ajouter ces fonctions après `closeAssetDetailDrawer` :

```js
function openCreditDrawer(assetId) {
    const asset = getAssetRecordById(assetId);
    if (!asset || !nodes.creditDrawer) return;

    const cs = asset.creditSchedule;
    nodes.creditDrawerAssetId.value = assetId;
    nodes.creditDrawerAssetName.textContent = asset.variablesData['nom-bien'] || 'Bien';
    nodes.creditDateDebut.value = cs?.dateDebut || '';
    nodes.creditDateFin.value = cs?.dateFin || '';
    nodes.creditMensualite.value = cs?.mensualite != null ? String(cs.mensualite) : '';
    nodes.creditDateRevente.value = asset.dateRevente || '';

    nodes.creditDrawerOverlay.style.display = 'block';
    nodes.creditDrawer.style.display = 'block';
    nodes.creditDrawerOverlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('drawer-open');
    void nodes.creditDrawer.offsetWidth;
    nodes.creditDrawerOverlay.classList.add('is-open');
    nodes.creditDrawer.classList.add('is-open');
    nodes.creditDrawerOverlay.onclick = closeCreditDrawer;
    window.requestAnimationFrame(() => nodes.creditDateDebut?.focus());
}

function closeCreditDrawer() {
    nodes.creditDrawerOverlay?.classList.remove('is-open');
    nodes.creditDrawer?.classList.remove('is-open');
    nodes.creditDrawerOverlay?.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('drawer-open');
    setTimeout(() => {
        if (nodes.creditDrawerOverlay) nodes.creditDrawerOverlay.style.display = 'none';
        if (nodes.creditDrawer) nodes.creditDrawer.style.display = 'none';
    }, 220);
}

function handleCreditDrawerSave(event) {
    event.preventDefault();
    const assetId = nodes.creditDrawerAssetId.value;
    const assetIndex = state.assetRecords.findIndex(a => a.id === assetId);
    if (assetIndex < 0) { closeCreditDrawer(); return; }

    const mensualite = Math.max(0, Number(nodes.creditMensualite.value) || 0);
    const dateDebut = nodes.creditDateDebut.value || '';
    const dateFin = nodes.creditDateFin.value || '';
    const dateRevente = nodes.creditDateRevente.value || '';

    const creditSchedule = (mensualite > 0 || dateDebut || dateFin)
        ? { dateDebut, dateFin, mensualite }
        : null;

    const existing = state.assetRecords[assetIndex];
    state.assetRecords.splice(assetIndex, 1, { ...existing, creditSchedule, dateRevente, updatedAt: Date.now() });
    saveAssetRecords();
    closeCreditDrawer();
    emitStateUpdate();
    render({ syncVariables: false, syncProfile: false });
    showToast('Échéancier crédit enregistré.');
}
```

- [ ] **Step 4 : Câbler le handler `edit-credit` dans `handlePortfolioCardAction`**

Dans `handlePortfolioCardAction`, ajouter avant le `if (action === 'remove-asset')` :

```js
    if (action === 'edit-credit') {
        openCreditDrawer(assetId);
        return;
    }
```

- [ ] **Step 5 : Câbler form + boutons dans l'init**

Dans la fonction d'init (chercher `initWorkspaceTabs` ou la zone d'event listeners), ajouter :

```js
    document.getElementById('credit-drawer-close')?.addEventListener('click', closeCreditDrawer);
    document.getElementById('credit-drawer-cancel')?.addEventListener('click', closeCreditDrawer);
    document.getElementById('credit-drawer-form')?.addEventListener('submit', handleCreditDrawerSave);
```

- [ ] **Step 6 : Commit**

```bash
git add main.js
git commit -m "feat(ui): ajoute drawer échéancier crédit sur les cartes du parc détenu"
```

---

## Task 7 — Champs profil + 7 nouveaux renderers + wire renderCollections

**Files:**
- Modify: `main.js`, `index.html`

- [ ] **Step 1 : Ajouter les champs objectifCF + revaloAnnuelle dans le formulaire profil**

Dans `index.html`, dans le formulaire/modal de profil (chercher `id="profile-income"` ou similaire), ajouter après les champs existants du profil :

```html
                    <div class="form-field">
                        <label class="form-label" for="profile-objectif-cf">
                            Objectif CF mensuel net-net
                            <button class="field-hint" type="button" tabindex="-1" data-tip="Le cash-flow net-net mensuel cible pour l ensemble du portefeuille.">?</button>
                        </label>
                        <div class="feasibility-input-row">
                            <input type="number" id="profile-objectif-cf" class="variables-input" min="0" max="50000" step="100" placeholder="1000">
                            <span class="feasibility-unit">€ / mois</span>
                        </div>
                    </div>
                    <div class="form-field">
                        <label class="form-label" for="profile-revalo-annuelle">
                            Revalorisation annuelle estimée
                            <button class="field-hint" type="button" tabindex="-1" data-tip="Taux de revalorisation annuelle du prix des biens pour la projection patrimoniale.">?</button>
                        </label>
                        <div class="feasibility-input-row">
                            <input type="number" id="profile-revalo-annuelle" class="variables-input" min="0" max="20" step="0.5" placeholder="2">
                            <span class="feasibility-unit">% / an</span>
                        </div>
                    </div>
```

- [ ] **Step 2 : Ajouter les nodes pour les 2 champs profil + 7 sections**

Dans le bloc `const nodes = { ... }`, ajouter :

```js
    profileObjectifCF: document.getElementById('profile-objectif-cf'),
    profileRevaloAnnuelle: document.getElementById('profile-revalo-annuelle'),
    portfolioFiscal: document.getElementById('portfolio-fiscal'),
    portfolioDebtRatios: document.getElementById('portfolio-debt-ratios'),
    portfolioObjectif: document.getElementById('portfolio-objectif'),
    portfolioProjection: document.getElementById('portfolio-projection'),
    portfolioRepartition: document.getElementById('portfolio-repartition'),
    portfolioCredits: document.getElementById('portfolio-credits'),
    portfolioTimeline: document.getElementById('portfolio-timeline'),
```

- [ ] **Step 3 : Câbler objectifCF + revaloAnnuelle dans `updateProfileFromForm`**

Dans `updateProfileFromForm`, remplacer l'appel à `sanitizeProfileData` par :

```js
    state.profileData = sanitizeProfileData({
        name: nodes.profileName.value,
        income: nodes.profileIncome.value,
        adults: nodes.profileAdults.value,
        children: nodes.profileChildren.value,
        objectifCF: nodes.profileObjectifCF?.value,
        revaloAnnuelle: nodes.profileRevaloAnnuelle?.value
    });
```

- [ ] **Step 4 : Câbler dans `syncProfileForm` (fonction qui rehydrate le formulaire depuis state)**

Chercher la fonction qui assigne `nodes.profileName.value = ...`. Ajouter après les assignations existantes :

```js
    if (nodes.profileObjectifCF) nodes.profileObjectifCF.value = String(state.profileData.objectifCF || 1000);
    if (nodes.profileRevaloAnnuelle) nodes.profileRevaloAnnuelle.value = String(state.profileData.revaloAnnuelle || 2);
```

- [ ] **Step 5 : Ajouter les 7 fonctions renderer**

Ajouter ces fonctions dans `main.js` juste avant `renderCollections` :

```js
function buildPortfolioFiscal(fiscal) {
    if (!nodes.portfolioFiscal) return;
    if (!fiscal || Object.values(fiscal.regimes).every(r => r.count === 0)) {
        nodes.portfolioFiscal.innerHTML = '<p class="collection-empty">Aucun bien détenu pour calculer la fiscalité consolidée.</p>';
        return;
    }
    const regimesActifs = Object.entries(fiscal.regimes).filter(([, r]) => r.count > 0);
    nodes.portfolioFiscal.innerHTML = `
        <div class="fiscal-shell">
            <div class="decision-head">
                <span class="status-label">TMI du foyer</span>
                <strong class="status-pill status-pill--neutral">${fiscal.tmi} %</strong>
            </div>
            <div class="timeline-summary">
                <div class="timeline-pill">
                    <span>Total impôts / an</span>
                    <strong>${formatPlainCurrency(fiscal.totalImpots)}</strong>
                </div>
                <div class="timeline-pill">
                    <span>Total impôts / mois</span>
                    <strong>${formatPlainCurrency(fiscal.totalImpots / 12)}</strong>
                </div>
            </div>
            <div class="fiscal-regimes">
                ${regimesActifs.map(([, r]) => `
                    <article class="scenario-card scenario-card--neutral">
                        <div class="lever-head">
                            <strong>${escapeHtml(r.label)}</strong>
                            <span class="status-pill status-pill--neutral">${r.count} bien${r.count > 1 ? 's' : ''}</span>
                        </div>
                        <p>Loyers : ${formatPlainCurrency(r.loyersAnnuels)} / an · Impôts : ${formatPlainCurrency(r.impots)} / an</p>
                    </article>
                `).join('')}
            </div>
        </div>
    `;
}

function buildPortfolioDebtRatios(debtRatios) {
    if (!nodes.portfolioDebtRatios) return;
    if (!debtRatios) {
        nodes.portfolioDebtRatios.innerHTML = '<p class="collection-empty">Aucun bien détenu pour calculer le taux d\'endettement.</p>';
        return;
    }
    function gauge(ratio, seuil, tone, label, method) {
        const pct = Math.min(100, (ratio / seuil) * 100);
        return `
            <div class="debt-gauge">
                <div class="debt-gauge-head">
                    <span class="debt-gauge-method">${escapeHtml(method)}</span>
                    <strong class="status-pill status-pill--${tone}">${ratio.toFixed(1).replace('.', ',')} %</strong>
                </div>
                <div class="debt-gauge-bar">
                    <div class="debt-gauge-fill debt-gauge-fill--${tone}" style="width:${pct.toFixed(1)}%"></div>
                    <div class="debt-gauge-seuil" style="left:100%"></div>
                </div>
                <div class="debt-gauge-footer">
                    <span>${escapeHtml(label)}</span>
                    <span>Seuil : ${seuil} %</span>
                </div>
            </div>
        `;
    }
    nodes.portfolioDebtRatios.innerHTML = `
        <div class="debt-ratios-shell">
            ${gauge(debtRatios.hcsf.ratio, debtRatios.hcsf.seuil, debtRatios.hcsf.tone,
                'Mensualités / (Revenus nets + 70 % loyers bruts)', 'Méthode HCSF 2021')}
            ${gauge(debtRatios.differentielle.ratio, debtRatios.differentielle.seuil, debtRatios.differentielle.tone,
                'Effort net immo / Revenus nets', 'Méthode différentielle')}
        </div>
    `;
}

function buildPortfolioObjectif(objectif, objectifCF) {
    if (!nodes.portfolioObjectif) return;
    const pctStr = objectif.pct.toFixed(0);
    nodes.portfolioObjectif.innerHTML = `
        <div class="objectif-shell">
            <div class="decision-head">
                <span class="status-label">Objectif mensuel</span>
                <strong class="status-pill status-pill--${objectif.tone}">${formatSignedCurrency(objectif.target)}</strong>
            </div>
            <div class="objectif-progress">
                <div class="objectif-bar">
                    <div class="objectif-fill objectif-fill--${objectif.tone}" style="width:${pctStr}%"></div>
                </div>
                <div class="objectif-labels">
                    <span class="objectif-current">${formatSignedCurrency(objectif.current)} actuellement</span>
                    <span class="objectif-pct">${pctStr} %</span>
                </div>
            </div>
            ${objectif.delta > 0 ? `
                <p class="decision-hint">Écart : <strong>${formatSignedCurrency(objectif.delta)}</strong> / mois manquants${objectif.estimatedAssetsNeeded ? ` · ~${objectif.estimatedAssetsNeeded} bien${objectif.estimatedAssetsNeeded > 1 ? 's' : ''} supplémentaire${objectif.estimatedAssetsNeeded > 1 ? 's' : ''}` : ''}</p>
            ` : `<p class="decision-hint">Objectif atteint.</p>`}
        </div>
    `;
}

function buildPortfolioProjection(projection) {
    if (!nodes.portfolioProjection) return;
    nodes.portfolioProjection.innerHTML = `
        <div class="projection-shell">
            <div class="decision-head">
                <span class="status-label">Revalorisation estimée</span>
                <strong class="status-pill status-pill--neutral">${projection.revaloAnnuelle} % / an</strong>
            </div>
            <p class="decision-hint">Valeur actuelle du parc : <strong>${formatPlainCurrency(projection.currentValue)}</strong></p>
            <div class="timeline-summary">
                <div class="timeline-pill">
                    <span>Dans 5 ans</span>
                    <strong>${formatPlainCurrency(projection.at5)}</strong>
                </div>
                <div class="timeline-pill">
                    <span>Dans 10 ans</span>
                    <strong>${formatPlainCurrency(projection.at10)}</strong>
                </div>
                <div class="timeline-pill">
                    <span>Dans 15 ans</span>
                    <strong>${formatPlainCurrency(projection.at15)}</strong>
                </div>
            </div>
        </div>
    `;
}

function buildPortfolioRepartition(portfolioItems) {
    if (!nodes.portfolioRepartition) return;
    if (!portfolioItems.length) {
        nodes.portfolioRepartition.innerHTML = '<p class="collection-empty">Aucun bien détenu pour afficher la répartition.</p>';
        return;
    }
    const maxLoyer = Math.max(...portfolioItems.map(item => (item.model.loyersEncaisses || 0) / 12), 1);
    nodes.portfolioRepartition.innerHTML = `
        <div class="repartition-list">
            ${portfolioItems.map(item => {
                const loyer = (item.model.loyersEncaisses || 0) / 12;
                const cf = item.metrics.cfNetNet || 0;
                const loyerPct = Math.max(4, (loyer / maxLoyer) * 100);
                const cfTone = cf >= 0 ? 'positive' : 'negative';
                const cfPct = Math.max(4, (Math.abs(cf) / maxLoyer) * 100);
                return `
                    <div class="repartition-row">
                        <div class="repartition-label">
                            <strong>${escapeHtml(item.name)}</strong>
                            <span class="repartition-city">${escapeHtml(item.city)}</span>
                        </div>
                        <div class="repartition-bars">
                            <div class="repartition-bar-wrap" title="Loyer brut ${formatCurrency(loyer)}/mois">
                                <div class="repartition-bar repartition-bar--loyer" style="width:${loyerPct.toFixed(1)}%"></div>
                                <span class="repartition-val">${formatCurrency(loyer)}</span>
                            </div>
                            <div class="repartition-bar-wrap" title="CF net-net ${formatSignedCurrency(cf)}/mois">
                                <div class="repartition-bar repartition-bar--cf repartition-bar--${cfTone}" style="width:${cfPct.toFixed(1)}%"></div>
                                <span class="repartition-val ${cf >= 0 ? 'value-positive' : 'value-negative'}">${formatSignedCurrency(cf)}</span>
                            </div>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
        <div class="repartition-legend">
            <span class="repartition-legend-item repartition-legend-item--loyer">Loyer brut</span>
            <span class="repartition-legend-item repartition-legend-item--cf">CF net-net</span>
        </div>
    `;
}

function buildPortfolioCredits(portfolioItems) {
    if (!nodes.portfolioCredits) return;
    const itemsWithCredit = portfolioItems.filter(item => item.creditSchedule || item.model.mensualiteTotale > 0);
    if (!itemsWithCredit.length) {
        nodes.portfolioCredits.innerHTML = '<p class="collection-empty">Aucun bien détenu avec un crédit configuré.</p>';
        return;
    }
    nodes.portfolioCredits.innerHTML = `
        <table class="analysis-table">
            <thead>
                <tr>
                    <th>Bien</th>
                    <th>Mensualité</th>
                    <th>Capital restant dû</th>
                    <th>Date de fin</th>
                    <th>Source</th>
                </tr>
            </thead>
            <tbody>
                ${itemsWithCredit.map(item => {
                    const cs = item.creditSchedule;
                    const mensualite = cs ? cs.mensualite : (item.model.mensualiteTotale || 0);
                    const capitalRestant = cs ? capitalRestantDu(cs.mensualite, cs.dateFin) : null;
                    const dateFin = cs?.dateFin ? cs.dateFin.replace('-', '/') : '--';
                    const source = cs ? 'Échéancier réel' : 'Simulé';
                    return `
                        <tr>
                            <td><strong>${escapeHtml(item.name)}</strong><div class="table-subline">${escapeHtml(item.city)}</div></td>
                            <td><strong>${formatPlainCurrency(mensualite)}</strong></td>
                            <td>${capitalRestant != null ? `<strong>${formatPlainCurrency(capitalRestant)}</strong>` : '--'}</td>
                            <td>${escapeHtml(dateFin)}</td>
                            <td><span class="status-pill status-pill--${cs ? 'positive' : 'neutral'}">${escapeHtml(source)}</span></td>
                        </tr>
                    `;
                }).join('')}
            </tbody>
        </table>
    `;
}

function buildPortfolioTimeline(portfolioItems) {
    if (!nodes.portfolioTimeline) return;
    const itemsWithDates = portfolioItems.filter(item => item.creditSchedule?.dateDebut || item.creditSchedule?.dateFin);
    if (!itemsWithDates.length) {
        nodes.portfolioTimeline.innerHTML = '<p class="collection-empty">Configurez l\'échéancier crédit d\'au moins un bien pour afficher la chronologie.</p>';
        return;
    }

    const now = new Date();
    const parseYM = str => { if (!str) return null; const [y, m] = str.split('-').map(Number); return new Date(y, m - 1, 1); };

    const allDates = itemsWithDates.flatMap(item => [
        parseYM(item.creditSchedule?.dateDebut),
        parseYM(item.creditSchedule?.dateFin),
        parseYM(item.dateRevente)
    ]).filter(Boolean);

    const minDate = new Date(Math.min(...allDates.map(d => d.getTime()), now.getTime()));
    const maxDate = new Date(Math.max(...allDates.map(d => d.getTime()), now.getTime()));
    const totalMs = Math.max(1, maxDate - minDate);

    function pct(date) { return ((date - minDate) / totalMs * 100).toFixed(2); }

    const minYear = minDate.getFullYear();
    const maxYear = maxDate.getFullYear();
    const yearMarkers = [];
    for (let y = minYear; y <= maxYear; y++) {
        const d = new Date(y, 0, 1);
        if (d >= minDate && d <= maxDate) yearMarkers.push({ year: y, pct: pct(d) });
    }

    nodes.portfolioTimeline.innerHTML = `
        <div class="timeline-chart">
            <div class="timeline-axis">
                ${yearMarkers.map(m => `<span class="timeline-year" style="left:${m.pct}%">${m.year}</span>`).join('')}
                <div class="timeline-now" style="left:${pct(now)}%" title="Aujourd'hui"></div>
            </div>
            ${itemsWithDates.map(item => {
                const debut = parseYM(item.creditSchedule?.dateDebut);
                const fin = parseYM(item.creditSchedule?.dateFin);
                const revente = parseYM(item.dateRevente);
                const left = debut ? parseFloat(pct(debut)) : 0;
                const right = fin ? parseFloat(pct(fin)) : 100;
                const width = Math.max(1, right - left);
                return `
                    <div class="timeline-row">
                        <div class="timeline-row-label">${escapeHtml(item.name)}</div>
                        <div class="timeline-row-track">
                            <div class="timeline-bar" style="left:${left}%;width:${width}%" title="${escapeHtml(item.name)} · ${item.creditSchedule?.dateDebut || '?'} → ${item.creditSchedule?.dateFin || '?'}"></div>
                            ${revente ? `<div class="timeline-marker-revente" style="left:${pct(revente)}%" title="Revente envisagée ${item.dateRevente}"></div>` : ''}
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}
```

Note : la fonction `capitalRestantDu` est importée de `calculs.js`. Il faut l'**exporter** depuis calculs.js en ajoutant le mot-clé `export` devant sa définition, puis l'importer en haut de main.js :

```js
import { calculateTMI, computeAnalysisViewModel, computePortfolioViewModel, getHouseholdTaxParts, capitalRestantDu } from './calculs.js';
```

- [ ] **Step 6 : Mettre à jour `renderCollections` pour appeler les 7 nouveaux renderers**

Remplacer la fonction `renderCollections` par :

```js
function renderCollections() {
    if (IS_ANALYSIS_WINDOW) {
        nodes.collectionPanel.hidden = true;
        return;
    }

    nodes.collectionPanel.hidden = false;
    const collectionsView = buildCollectionsView();
    buildPortfolioKpiBanner(collectionsView);
    buildPortfolioHero(collectionsView);
    buildCollectionMetricCards(collectionsView.dashboard);
    buildPortfolioAssetGrid(collectionsView);
    buildPortfolioPriorities(collectionsView.priorities);
    buildPortfolioFiscal(collectionsView.fiscal);
    buildPortfolioDebtRatios(collectionsView.debtRatios);
    buildPortfolioObjectif(collectionsView.objectif, collectionsView.dashboard.objectifCF);
    buildPortfolioProjection(collectionsView.projection);
    buildPortfolioRepartition(collectionsView.portfolioItems);
    buildPortfolioCredits(collectionsView.portfolioItems);
    buildPortfolioTimeline(collectionsView.portfolioItems);
}
```

- [ ] **Step 7 : Commit**

```bash
git add main.js index.html
git commit -m "feat(portfolio): ajoute 7 nouveaux renderers (fiscal, dette, objectif, projection, répartition, crédits, timeline)"
```

---

## Task 8 — CSS : styles des nouveaux composants

**Files:**
- Modify: `styles.css`

- [ ] **Step 1 : Ajouter les styles**

Ajouter à la fin de `styles.css` :

```css
/* ─── Drawer crédit ─────────────────────────────────── */
.credit-drawer-asset-name {
    font-size: 14px;
    font-weight: 600;
    color: var(--accent);
    margin-bottom: 16px;
    font-family: var(--font-mono);
}
.credit-drawer-form .form-field { margin-bottom: 16px; }
.form-label-optional { font-size: 11px; color: var(--muted); font-weight: 400; }
.drawer-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 24px; }
.btn-primary {
    background: var(--accent);
    color: #fff;
    border: none;
    border-radius: 8px;
    padding: 8px 20px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
}
.btn-primary:hover { opacity: 0.88; }
.btn-secondary {
    background: var(--surface-raised);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 8px 16px;
    font-size: 13px;
    cursor: pointer;
}
.btn-secondary:hover { background: var(--surface-hover); }
.asset-card__action--has-credit { color: var(--accent); }

/* ─── Vue fiscale ───────────────────────────────────── */
.fiscal-shell, .capacity-shell, .concentration-shell, .objectif-shell,
.projection-shell, .debt-ratios-shell { display: flex; flex-direction: column; gap: 12px; }
.fiscal-regimes { display: flex; flex-direction: column; gap: 8px; }

/* ─── Taux d'endettement ───────────────────────────── */
.debt-gauge { display: flex; flex-direction: column; gap: 6px; padding: 12px; background: var(--surface-raised); border-radius: 8px; }
.debt-gauge-head { display: flex; align-items: center; justify-content: space-between; }
.debt-gauge-method { font-size: 12px; color: var(--muted); font-family: var(--font-mono); }
.debt-gauge-bar {
    position: relative;
    height: 8px;
    background: var(--border);
    border-radius: 4px;
    overflow: hidden;
}
.debt-gauge-fill {
    height: 100%;
    border-radius: 4px;
    transition: width 0.3s ease;
}
.debt-gauge-fill--positive { background: var(--color-positive); }
.debt-gauge-fill--watch { background: var(--color-watch); }
.debt-gauge-fill--negative { background: var(--color-negative); }
.debt-gauge-footer { display: flex; justify-content: space-between; font-size: 11px; color: var(--muted); }

/* ─── Progression objectif ─────────────────────────── */
.objectif-progress { display: flex; flex-direction: column; gap: 6px; }
.objectif-bar {
    height: 10px;
    background: var(--border);
    border-radius: 5px;
    overflow: hidden;
}
.objectif-fill {
    height: 100%;
    border-radius: 5px;
    transition: width 0.4s ease;
}
.objectif-fill--excellent, .objectif-fill--positive { background: var(--color-positive); }
.objectif-fill--watch { background: var(--color-watch); }
.objectif-fill--neutral { background: var(--border-strong, #888); }
.objectif-labels { display: flex; justify-content: space-between; font-size: 12px; color: var(--muted); }
.objectif-current { font-family: var(--font-mono); }
.objectif-pct { font-weight: 600; font-family: var(--font-mono); }

/* ─── Répartition ───────────────────────────────────── */
.repartition-list { display: flex; flex-direction: column; gap: 12px; }
.repartition-row { display: grid; grid-template-columns: 180px 1fr; gap: 12px; align-items: center; }
.repartition-label strong { display: block; font-size: 13px; }
.repartition-city { font-size: 11px; color: var(--muted); font-family: var(--font-mono); }
.repartition-bars { display: flex; flex-direction: column; gap: 4px; }
.repartition-bar-wrap { display: flex; align-items: center; gap: 8px; }
.repartition-bar {
    height: 8px;
    border-radius: 4px;
    min-width: 4px;
    transition: width 0.3s ease;
}
.repartition-bar--loyer { background: var(--accent); opacity: 0.6; }
.repartition-bar--cf.repartition-bar--positive { background: var(--color-positive); }
.repartition-bar--cf.repartition-bar--negative { background: var(--color-negative); }
.repartition-val { font-size: 11px; font-family: var(--font-mono); white-space: nowrap; color: var(--muted); }
.repartition-legend { display: flex; gap: 16px; margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border); }
.repartition-legend-item { font-size: 11px; color: var(--muted); display: flex; align-items: center; gap: 6px; }
.repartition-legend-item::before { content: ''; display: inline-block; width: 12px; height: 8px; border-radius: 2px; }
.repartition-legend-item--loyer::before { background: var(--accent); opacity: 0.6; }
.repartition-legend-item--cf::before { background: var(--color-positive); }

/* ─── Timeline ──────────────────────────────────────── */
.timeline-chart { display: flex; flex-direction: column; gap: 10px; overflow-x: auto; }
.timeline-axis {
    position: relative;
    height: 24px;
    border-bottom: 1px solid var(--border);
    margin-left: 160px;
}
.timeline-year {
    position: absolute;
    transform: translateX(-50%);
    font-size: 10px;
    color: var(--muted);
    font-family: var(--font-mono);
    bottom: 2px;
}
.timeline-now {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--accent);
    opacity: 0.7;
}
.timeline-row { display: flex; align-items: center; gap: 0; min-height: 28px; }
.timeline-row-label {
    width: 160px;
    flex-shrink: 0;
    font-size: 12px;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding-right: 8px;
    color: var(--text);
}
.timeline-row-track { position: relative; flex: 1; height: 20px; background: var(--surface-raised); border-radius: 4px; }
.timeline-bar {
    position: absolute;
    top: 4px;
    height: 12px;
    background: var(--accent);
    opacity: 0.55;
    border-radius: 4px;
    transition: width 0.3s, left 0.3s;
}
.timeline-marker-revente {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 3px;
    background: var(--color-watch);
    border-radius: 2px;
}
```

- [ ] **Step 2 : Vérifier l'apparence dans l'app**

Lancer `python app.py`, naviguer dans l'onglet Portefeuille. Vérifier :
- Les jauges de taux d'endettement s'affichent avec les bonnes couleurs
- La barre de progression de l'objectif est visible
- La timeline s'affiche si un bien a un échéancier configuré
- Le drawer crédit s'ouvre en cliquant "Crédit" sur une carte du parc détenu
- Aucune erreur dans la console

- [ ] **Step 3 : Commit final**

```bash
git add styles.css
git commit -m "feat(css): styles pour les 7 nouveaux blocs du portefeuille (fiscal, dette, objectif, projection, répartition, crédits, timeline)"
```
