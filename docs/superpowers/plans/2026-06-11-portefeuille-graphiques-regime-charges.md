# Portefeuille — Graphiques, Régime global, Charges évolutives

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter un sélecteur de régime fiscal global, deux graphiques côte à côte (CF cumulé + Recettes vs Dépenses), une suppression sécurisée par saisie, et la gestion des charges évolutives par année dans le portefeuille de biens détenus.

**Architecture:** Le régime vit dans `state.ownedRegime` (localStorage). Une nouvelle fonction `computeOwnedAssetTimeline` dans `calculs.js` génère les données année par année pour les graphiques. Les composants graphiques sont refactorisés pour afficher deux canvas côte à côte dans la vue liste (consolidé) et la vue détail (par bien).

**Tech Stack:** Chart.js (déjà présent), localStorage, CSS custom (pas de framework)

---

## Fichiers modifiés

| Fichier | Rôle des changements |
|---|---|
| `calculs.js` | Nouveau export `computeOwnedAssetTimeline` ; param `regimeOverride` dans `computeOwnedAssetCF` |
| `main.js` | `state.ownedRegime`, helpers, renderers graphiques, CRUD chargesAnnuelles, modale suppression |
| `index.html` | Containers graphiques vue liste, double canvas vue détail, modale suppression |
| `styles.css` | Régime slider, charts row, delete modal |

---

## Task 1 : `computeOwnedAssetTimeline` dans calculs.js

**Files:**
- Modify: `calculs.js` (après l'export `computeOwnedAssetCF`, ligne ~1867)

- [ ] **Step 1 : Ajouter `regimeOverride` à `computeOwnedAssetCF`**

Dans `calculs.js`, ligne 1847 : `'regime': scenario.regime || 'micro-foncier'`  
→ remplacer par :

```js
'regime': regimeOverride || scenario.regime || 'micro-foncier',
```

Et modifier la signature ligne 1814 :
```js
export function computeOwnedAssetCF(asset, scenario, tmi, regimeOverride = null) {
```

- [ ] **Step 2 : Ajouter la fonction `computeOwnedAssetTimeline` à la fin de calculs.js (avant la dernière accolade de fermeture de module)**

```js
export function computeOwnedAssetTimeline(asset, tmi, regimeOverride = null) {
    const acq = asset.acquisition || {};
    const post = asset.postAchat || {};
    const credit = acq.credit || {};

    const prixAcquisition = acq.prix || 0;
    const montantCredit = credit.montant || 0;
    const dureeCredit = credit.duree || 0;
    const nMois = dureeCredit * 12;
    const tauxM = ((credit.taux || 0) / 100) / 12;
    let mensCredit = 0;
    if (tauxM > 0 && nMois > 0) mensCredit = (montantCredit * tauxM) / (1 - Math.pow(1 + tauxM, -nMois));
    else if (nMois > 0) mensCredit = montantCredit / nMois;
    const assurMens = (montantCredit * ((credit.assurance || 0) / 100)) / 12;
    const mensualiteTotale = mensCredit + assurMens;

    const currentYear = new Date().getFullYear();
    const anneeAchat = asset.anneeAchat || currentYear;
    const anneeFinCredit = anneeAchat + dureeCredit;
    const endYear = Math.max(currentYear + 2, anneeFinCredit);

    const loyer = acq.loyerInitial || 0;
    const vacance = (post.vacance ?? 5) / 100;
    const loyersAnnuels = loyer * 12 * (1 - vacance);

    // Apport initial = prix + frais - crédit
    const investBrut = prixAcquisition + (acq.fraisAgence || 0) + (acq.fraisNotaire || 0);
    const apportInitial = Math.max(0, investBrut - montantCredit);

    // Travaux indexés par année
    const travauxParAnnee = {};
    for (const t of (post.travaux || [])) {
        if (!t.date || !t.montant) continue;
        const y = new Date(t.date).getFullYear();
        travauxParAnnee[y] = (travauxParAnnee[y] || 0) + t.montant;
    }

    // Capital restant pour calcul intérêts annuels
    let capitalRestant = montantCredit;
    let carryForwardDeficit = 0;

    const years = [];
    let cumulCF = 0;
    let recettesCum = 0;
    let depensesCum = 0;

    for (let y = anneeAchat; y <= endYear; y++) {
        const yearsElapsed = y - anneeAchat;
        const creditActif = dureeCredit > 0 && y < anneeFinCredit;

        // Résolution charges pour cette année
        const annualEntries = (post.chargesAnnuelles || []).filter(e => e.annee <= y).sort((a, b) => b.annee - a.annee);
        const chargesEntry = annualEntries[0] || null;
        const taxeFonciere = chargesEntry ? (chargesEntry.taxeFonciere ?? post.taxeFonciere ?? 0) : (post.taxeFonciere ?? 0);
        const gestionPct = chargesEntry ? (chargesEntry.gestionLocative ?? post.gestionLocative ?? 0) : (post.gestionLocative ?? 0);
        const assurancePNO = chargesEntry ? (chargesEntry.assurancePNO ?? post.assurancePNO ?? 0) : (post.assurancePNO ?? 0);
        const chargesCopro = post.chargesCopro ?? 0;
        const chargesAnnee = taxeFonciere + (chargesCopro * 12) + assurancePNO + (loyersAnnuels * (gestionPct / 100));

        // Intérêts annuels pour déduction réel
        let interetsAnnee = 0;
        let debtService = 0;
        if (creditActif) {
            let cap = capitalRestant;
            for (let m = 0; m < 12; m++) {
                const monthIdx = yearsElapsed * 12 + m;
                if (monthIdx >= nMois || cap <= 0) break;
                const intM = tauxM > 0 ? cap * tauxM : 0;
                const capM = Math.max(0, Math.min(cap, mensCredit - intM));
                interetsAnnee += intM;
                cap -= capM;
            }
            // Avance le capital restant
            let capTmp = capitalRestant;
            for (let m = 0; m < 12; m++) {
                const monthIdx = yearsElapsed * 12 + m;
                if (monthIdx >= nMois || capTmp <= 0) break;
                const intM = tauxM > 0 ? capTmp * tauxM : 0;
                const capM = Math.max(0, Math.min(capTmp, mensCredit - intM));
                capTmp -= capM;
            }
            capitalRestant = capTmp;
            debtService = mensualiteTotale * 12;
        }

        // Impôts
        const inputs = {
            'taux-input': credit.taux || 0,
            'duree': credit.duree || 0,
            'assurance': credit.assurance || 0,
            'apport': Math.max(0, prixAcquisition - montantCredit),
            'notaire': 0, 'agence': 0, 'travaux': 0, 'meubles': 0, 'frais-bancaires': 0,
            'vacance': post.vacance ?? 5,
            'copro': chargesCopro,
            'fonciere': taxeFonciere,
            'pno': assurancePNO,
            'gestion': gestionPct,
            'regime': regimeOverride || 'micro-foncier',
        };
        const taxResult = computeAnnualTaxEstimate(
            prixAcquisition, loyersAnnuels, chargesAnnee, inputs, tmi,
            interetsAnnee, assurMens * 12, yearsElapsed + 1, carryForwardDeficit
        );
        carryForwardDeficit = taxResult.newCarryForward;
        const impotsAnnee = taxResult.tax;

        const travauxAnnee = travauxParAnnee[y] || 0;
        const cfAnnuel = loyersAnnuels - debtService - chargesAnnee - impotsAnnee;

        // Recettes = loyers perçus
        const recettesAnnee = loyersAnnuels;
        // Dépenses = crédit + charges + travaux + impôts + apport initial (an d'achat)
        const depensesAnnee = debtService + chargesAnnee + impotsAnnee + travauxAnnee + (y === anneeAchat ? apportInitial : 0);

        cumulCF += cfAnnuel;
        recettesCum += recettesAnnee;
        depensesCum += depensesAnnee;

        years.push({ year: y, cfAnnuel, cumulCF, recettesAnnee, recettesCum, depensesAnnee, depensesCum });
    }

    return { years, anneeAchat, endYear };
}
```

- [ ] **Step 3 : Commit**

```bash
git add calculs.js
git commit -m "feat(calculs): computeOwnedAssetTimeline + regimeOverride dans computeOwnedAssetCF"
```

---

## Task 2 : État `ownedRegime` + helpers dans main.js

**Files:**
- Modify: `main.js`

- [ ] **Step 1 : Ajouter `ownedRegime` à l'objet `state`**

Chercher `const state = {` dans main.js. Ajouter dans l'objet :
```js
ownedRegime: localStorage.getItem('investissementWebOwnedRegime') || 'micro-foncier',
```

- [ ] **Step 2 : Ajouter `getOwnedRegime()` et `setOwnedRegime()` après `getOwnedTmi()`**

Chercher la fonction `getOwnedTmi()` et ajouter juste après :
```js
function getOwnedRegime() {
    return state.ownedRegime || 'micro-foncier';
}

function setOwnedRegime(regime) {
    state.ownedRegime = regime;
    localStorage.setItem('investissementWebOwnedRegime', regime);
}
```

- [ ] **Step 3 : Ajouter helpers `chargesAnnuelles` CRUD après `addOwnedNote`**

Chercher `function addOwnedNote(` et ajouter après la fonction :
```js
function addOwnedChargesAnnuelles(assetId, entry) {
    const all = loadOwnedAssets();
    if (!all[assetId]) return;
    const post = all[assetId].postAchat || {};
    const list = [...(post.chargesAnnuelles || [])].filter(e => e.annee !== entry.annee);
    list.push(entry);
    list.sort((a, b) => a.annee - b.annee);
    updateOwnedPostAchat(assetId, { chargesAnnuelles: list });
}

function deleteOwnedChargesAnnuelles(assetId, annee) {
    const all = loadOwnedAssets();
    if (!all[assetId]) return;
    const post = all[assetId].postAchat || {};
    const list = (post.chargesAnnuelles || []).filter(e => e.annee !== annee);
    updateOwnedPostAchat(assetId, { chargesAnnuelles: list });
}
```

- [ ] **Step 4 : Commit**

```bash
git add main.js
git commit -m "feat(portfolio): state.ownedRegime, getOwnedRegime, setOwnedRegime, chargesAnnuelles CRUD"
```

---

## Task 3 : HTML — containers graphiques + modale suppression

**Files:**
- Modify: `index.html`

- [ ] **Step 1 : Remplacer le graphique unique vue détail par deux canvas côte à côte**

Chercher dans index.html :
```html
        <!-- Graphique dépenses cumulées -->
        <div id="owned-cashflow-chart-wrap" class="owned-cashflow-chart-wrap" hidden>
            <div class="owned-cashflow-chart-title">Dépenses cumulées au fil du temps</div>
            <canvas id="owned-cashflow-chart" height="200"></canvas>
        </div>
```

Remplacer par :
```html
        <!-- Graphiques côte à côte — vue détail -->
        <div id="owned-charts-detail" class="owned-charts-row" hidden>
            <div class="owned-chart-block">
                <div class="owned-chart-title">CF net après impôt cumulé</div>
                <canvas id="owned-cfcum-chart" height="200"></canvas>
            </div>
            <div class="owned-chart-block">
                <div class="owned-chart-title">Recettes vs Dépenses</div>
                <canvas id="owned-ecart-chart" height="200"></canvas>
                <div class="owned-chart-legend">
                    <span class="owned-chart-legend__item owned-chart-legend__item--recettes">Recettes</span>
                    <span class="owned-chart-legend__item owned-chart-legend__item--depenses">Dépenses</span>
                    <span class="owned-chart-legend__hint">Recettes = loyers après vacance · Dépenses = apport + crédit + charges + impôts + travaux</span>
                </div>
            </div>
        </div>
```

- [ ] **Step 2 : Ajouter le conteneur graphiques vue liste après `#owned-kpi-banner`**

Chercher :
```html
        <div id="owned-kpi-banner" class="owned-kpi-banner"></div>
        <div id="owned-list-table" class="owned-list-table"></div>
```

Remplacer par :
```html
        <div id="owned-kpi-banner" class="owned-kpi-banner"></div>
        <div id="owned-portfolio-charts" class="owned-charts-row owned-portfolio-charts" hidden></div>
        <div id="owned-list-table" class="owned-list-table"></div>
```

- [ ] **Step 3 : Ajouter la modale de suppression après `#owned-add-modal`**

Après la fermeture `</div>` de `#owned-add-modal`, ajouter :
```html
    <!-- Modale suppression sécurisée -->
    <div id="owned-delete-modal" class="owned-delete-modal" hidden aria-modal="true" role="dialog">
        <div class="owned-delete-modal__box">
            <h3>Supprimer un bien</h3>
            <p id="owned-delete-modal-text">Vous êtes sur le point de supprimer <strong id="owned-delete-modal-name"></strong>. Cette action est irréversible.</p>
            <p>Pour confirmer, saisissez <strong>Supprimer</strong> ci-dessous.</p>
            <input id="owned-delete-modal-input" class="variables-input" type="text" placeholder="Supprimer" autocomplete="off">
            <div class="owned-delete-modal__actions">
                <button id="owned-delete-modal-cancel" class="btn btn--ghost" type="button">Annuler</button>
                <button id="owned-delete-modal-confirm" class="btn btn--negative" type="button" disabled>Supprimer</button>
            </div>
        </div>
    </div>
```

- [ ] **Step 4 : Commit**

```bash
git add index.html
git commit -m "feat(html): double canvas detail, portfolio-charts list, modale suppression"
```

---

## Task 4 : CSS — régime slider, charts row, delete modal

**Files:**
- Modify: `styles.css` (ajouter à la fin)

- [ ] **Step 1 : Ajouter les nouveaux styles à la fin de styles.css**

```css
/* ── Régime slider ─────────────────────────────────────────── */
.owned-regime-slider {
    display: flex;
    align-items: center;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 3px;
    gap: 2px;
    width: fit-content;
    margin: 0 auto 16px;
}
.owned-regime-slider__btn {
    background: transparent;
    border: none;
    border-radius: 6px;
    padding: 6px 14px;
    font-size: .75rem;
    font-family: 'Manrope', sans-serif;
    font-weight: 600;
    color: var(--text-secondary);
    cursor: pointer;
    transition: background 150ms, color 150ms;
    white-space: nowrap;
}
.owned-regime-slider__btn--active {
    background: var(--accent);
    color: #fff;
}
[data-theme="dark"] .owned-regime-slider__btn--active {
    color: #1a1a1a;
}

/* ── Charts row ────────────────────────────────────────────── */
.owned-charts-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin-bottom: 20px;
}
.owned-chart-block {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 16px;
    min-width: 0;
}
.owned-chart-title {
    font-size: .72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .06em;
    color: var(--text-tertiary);
    margin-bottom: 12px;
}
.owned-chart-legend {
    margin-top: 10px;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
}
.owned-chart-legend__item {
    font-size: .71rem;
    font-family: 'IBM Plex Mono', monospace;
    display: flex;
    align-items: center;
    gap: 4px;
}
.owned-chart-legend__item::before {
    content: '';
    display: inline-block;
    width: 10px;
    height: 3px;
    border-radius: 2px;
}
.owned-chart-legend__item--recettes::before { background: #22c55e; }
.owned-chart-legend__item--depenses::before { background: #ef4444; }
.owned-chart-legend__hint {
    font-size: .68rem;
    color: var(--text-tertiary);
    font-style: italic;
    width: 100%;
}
.owned-portfolio-charts {
    margin-top: 0;
    margin-bottom: 24px;
}

/* ── Modale suppression ────────────────────────────────────── */
.owned-delete-modal {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,.55);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 2000;
}
.owned-delete-modal[hidden] { display: none; }
.owned-delete-modal__box {
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 28px 32px;
    max-width: 420px;
    width: 90%;
    display: flex;
    flex-direction: column;
    gap: 12px;
}
.owned-delete-modal__box h3 { margin: 0; font-size: 1rem; }
.owned-delete-modal__box p { margin: 0; font-size: .85rem; color: var(--text-secondary); }
.owned-delete-modal__actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 8px;
}
.btn--negative {
    background: #ef4444;
    color: #fff;
    border: none;
}
.btn--negative:disabled {
    background: var(--surface-3);
    color: var(--text-tertiary);
    cursor: not-allowed;
}

/* ── Charges évolutives ────────────────────────────────────── */
.owned-charges-annuelles-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 8px;
}
.owned-charges-annuelles-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: .8rem;
    color: var(--text-secondary);
    background: var(--surface-2);
    border-radius: 6px;
    padding: 6px 10px;
}
.owned-charges-annuelles-row__year {
    font-weight: 700;
    font-family: 'IBM Plex Mono', monospace;
    color: var(--accent);
    min-width: 40px;
}
.owned-charges-annuelles-row__vals {
    flex: 1;
}
.owned-charges-form {
    display: grid;
    grid-template-columns: 80px 1fr 1fr 1fr auto;
    gap: 6px;
    align-items: end;
    margin-top: 6px;
}
@media (max-width: 640px) {
    .owned-charts-row { grid-template-columns: 1fr; }
    .owned-charges-form { grid-template-columns: 1fr 1fr; }
}
```

- [ ] **Step 2 : Commit**

```bash
git add styles.css
git commit -m "feat(css): regime slider, charts row, delete modal, charges annuelles"
```

---

## Task 5 : Régime slider — rendu et événements

**Files:**
- Modify: `main.js`

- [ ] **Step 1 : Ajouter `renderOwnedRegimeSelector()` avant `renderOwnedPortfolioList`**

Chercher `function renderOwnedPortfolioList()` et insérer avant :

```js
function renderOwnedRegimeSelector() {
    const banner = nodes.ownedKpiBanner;
    if (!banner) return;
    const current = getOwnedRegime();
    const options = [
        { value: 'micro-foncier', label: 'Micro-foncier' },
        { value: 'reel', label: 'Réel' },
        { value: 'sci-is', label: 'SCI-IS' },
    ];
    const sliderHtml = `
        <div class="owned-regime-slider" id="owned-regime-slider">
            ${options.map(o => `
                <button class="owned-regime-slider__btn${o.value === current ? ' owned-regime-slider__btn--active' : ''}"
                    data-regime="${o.value}" type="button">${o.label}</button>
            `).join('')}
        </div>
    `;
    // Injecter avant le contenu KPI existant (ou seul si vide)
    let sliderEl = document.getElementById('owned-regime-slider');
    if (!sliderEl) {
        banner.insertAdjacentHTML('beforebegin', sliderHtml);
    } else {
        sliderEl.outerHTML = sliderHtml;
    }
    document.getElementById('owned-regime-slider')?.querySelectorAll('[data-regime]').forEach(btn => {
        btn.addEventListener('click', () => {
            setOwnedRegime(btn.dataset.regime);
            renderOwnedPortfolioList();
            // Si vue détail ouverte, re-rendre
            if (state.activeOwnedAssetId) {
                const fresh = getOwnedAsset(state.activeOwnedAssetId);
                if (fresh) {
                    renderOwnedSynthese(fresh);
                    renderOwnedCharts(fresh);
                }
            }
        });
    });
}
```

- [ ] **Step 2 : Appeler `renderOwnedRegimeSelector()` au début de `renderOwnedPortfolioList`**

Dans `renderOwnedPortfolioList`, après `const tmi = getOwnedTmi();` :
```js
    renderOwnedRegimeSelector();
```

- [ ] **Step 3 : Mettre à jour le calcul du KPI banner pour utiliser `getOwnedRegime()`**

Dans `renderOwnedPortfolioList`, trouver :
```js
            const results = list.map(a => {
                const sc = getOwnedDefaultScenario(a);
                return computeOwnedAssetCF(a, sc.variables, tmi);
            });
```
Remplacer par :
```js
            const regime = getOwnedRegime();
            const results = list.map(a => {
                const sc = getOwnedDefaultScenario(a);
                return computeOwnedAssetCF(a, sc.variables, tmi, regime);
            });
```

- [ ] **Step 4 : Mettre à jour le calcul dans le tableau des biens**

Dans `renderOwnedPortfolioList`, trouver :
```js
                            const sc = getOwnedDefaultScenario(asset);
                            const r = computeOwnedAssetCF(asset, sc.variables, tmi);
```
Remplacer par :
```js
                            const sc = getOwnedDefaultScenario(asset);
                            const r = computeOwnedAssetCF(asset, sc.variables, tmi, getOwnedRegime());
```

- [ ] **Step 5 : Commit**

```bash
git add main.js
git commit -m "feat(portfolio): regime slider render + KPI banner + tableau biens utilisent getOwnedRegime"
```

---

## Task 6 : `renderOwnedCharts(asset)` — deux graphiques vue détail

**Files:**
- Modify: `main.js`

- [ ] **Step 1 : Ajouter les variables de référence Chart.js**

Chercher `let _ownedCashflowChart = null;` et remplacer par :
```js
let _ownedCfCumChart = null;
let _ownedEcartChart = null;
```

- [ ] **Step 2 : Remplacer `renderOwnedCashflowChart` par `renderOwnedCharts`**

Supprimer la fonction `renderOwnedCashflowChart` entière (de `function renderOwnedCashflowChart(asset) {` jusqu'à sa fermeture `}`).

Ajouter à la place :

```js
function renderOwnedCharts(asset) {
    const wrap = document.getElementById('owned-charts-detail');
    if (!wrap) return;

    const acq = asset.acquisition || {};
    if (!(acq.prix > 0)) {
        wrap.hidden = true;
        if (_ownedCfCumChart) { _ownedCfCumChart.destroy(); _ownedCfCumChart = null; }
        if (_ownedEcartChart) { _ownedEcartChart.destroy(); _ownedEcartChart = null; }
        return;
    }

    wrap.hidden = false;
    const tmi = getOwnedTmi();
    const regime = getOwnedRegime();
    const { years } = computeOwnedAssetTimeline(asset, tmi, regime);

    const labels = years.map(y => String(y.year));
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const gold = '#C5A059';
    const green = '#22c55e';
    const red = '#ef4444';
    const textClr = isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.4)';
    const gridClr = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

    const sharedScaleOpts = (color) => ({
        x: { ticks: { color, maxRotation: 45, minRotation: 45, font: { family: "'IBM Plex Mono', monospace", size: 10 } }, grid: { color: gridClr } },
        y: { ticks: { color, callback: v => (v / 1000).toFixed(0) + 'k€', font: { family: "'IBM Plex Mono', monospace", size: 10 } }, grid: { color: gridClr } }
    });

    // ── Graphique gauche : CF cumulé ──────────────────────────────
    if (_ownedCfCumChart) { _ownedCfCumChart.destroy(); _ownedCfCumChart = null; }
    const canvasCF = document.getElementById('owned-cfcum-chart');
    if (canvasCF) {
        _ownedCfCumChart = new Chart(canvasCF, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    data: years.map(y => Math.round(y.cumulCF)),
                    borderColor: gold,
                    backgroundColor: isDark ? 'rgba(197,160,89,0.08)' : 'rgba(197,160,89,0.13)',
                    borderWidth: 2,
                    pointRadius: 3,
                    pointBackgroundColor: gold,
                    tension: 0.25,
                    fill: true,
                }]
            },
            options: {
                responsive: true,
                plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ctx.parsed.y.toLocaleString('fr-FR') + ' €' } } },
                scales: sharedScaleOpts(textClr)
            }
        });
    }

    // ── Graphique droite : Recettes vs Dépenses ───────────────────
    if (_ownedEcartChart) { _ownedEcartChart.destroy(); _ownedEcartChart = null; }
    const canvasEcart = document.getElementById('owned-ecart-chart');
    if (canvasEcart) {
        _ownedEcartChart = new Chart(canvasEcart, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Recettes',
                        data: years.map(y => Math.round(y.recettesCum)),
                        borderColor: green,
                        backgroundColor: 'rgba(34,197,94,0.08)',
                        borderWidth: 2,
                        pointRadius: 2,
                        tension: 0.25,
                        fill: false,
                    },
                    {
                        label: 'Dépenses',
                        data: years.map(y => Math.round(y.depensesCum)),
                        borderColor: red,
                        backgroundColor: 'rgba(239,68,68,0.08)',
                        borderWidth: 2,
                        pointRadius: 2,
                        tension: 0.25,
                        fill: false,
                    }
                ]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label: ctx => ctx.dataset.label + ' : ' + ctx.parsed.y.toLocaleString('fr-FR') + ' €' } }
                },
                scales: sharedScaleOpts(textClr)
            }
        });
    }
}
```

- [ ] **Step 3 : Remplacer tous les appels à `renderOwnedCashflowChart` par `renderOwnedCharts`**

Chercher/remplacer dans main.js (toutes les occurrences) :
- `renderOwnedCashflowChart(` → `renderOwnedCharts(`

Vérifier que les appels dans `renderOwnedDetail`, `renderAccordionPostAchat`, et le watcher acquisition utilisent bien `renderOwnedCharts`.

- [ ] **Step 4 : Mettre à jour `nodes` — remplacer `ownedCashflowChartWrap`**

Chercher :
```js
    ownedCashflowChartWrap: document.getElementById('owned-cashflow-chart-wrap'),
```
Remplacer par :
```js
    ownedChartsDetail: document.getElementById('owned-charts-detail'),
```

- [ ] **Step 5 : Mettre à jour `renderOwnedSynthese` pour utiliser le régime global**

Dans `renderOwnedSynthese`, chercher :
```js
    const r = computeOwnedAssetCF(asset, sc.variables, tmi);
```
Remplacer par :
```js
    const r = computeOwnedAssetCF(asset, sc.variables, tmi, getOwnedRegime());
```

Et chercher :
```js
    const currentRegime = sc.variables.regime || 'micro-foncier';
```
Remplacer par :
```js
    const currentRegime = getOwnedRegime();
```

- [ ] **Step 6 : Commit**

```bash
git add main.js
git commit -m "feat(portfolio): renderOwnedCharts double canvas (CF cumulé + recettes/dépenses)"
```

---

## Task 7 : `renderOwnedPortfolioCharts()` — graphiques consolidés vue liste

**Files:**
- Modify: `main.js`

- [ ] **Step 1 : Ajouter les variables Chart.js pour la vue liste**

Après `let _ownedEcartChart = null;` ajouter :
```js
let _ownedPortfolioCfChart = null;
let _ownedPortfolioEcartChart = null;
```

- [ ] **Step 2 : Ajouter `renderOwnedPortfolioCharts(list, tmi, regime)` avant `renderOwnedPortfolioList`**

```js
function renderOwnedPortfolioCharts(list, tmi, regime) {
    const container = document.getElementById('owned-portfolio-charts');
    if (!container) return;

    if (!list.length) {
        container.hidden = true;
        if (_ownedPortfolioCfChart) { _ownedPortfolioCfChart.destroy(); _ownedPortfolioCfChart = null; }
        if (_ownedPortfolioEcartChart) { _ownedPortfolioEcartChart.destroy(); _ownedPortfolioEcartChart = null; }
        return;
    }

    // Déterminer la plage d'années globale
    const currentYear = new Date().getFullYear();
    const allYearSets = list.map(a => {
        const anneeAchat = a.anneeAchat || currentYear;
        const duree = a.acquisition?.credit?.duree || 0;
        return { start: anneeAchat, end: Math.max(currentYear + 2, anneeAchat + duree) };
    });
    const globalStart = Math.min(...allYearSets.map(r => r.start));
    const globalEnd = Math.max(...allYearSets.map(r => r.end));

    // Agréger les timelines
    const aggCumulCF = {};
    const aggRecettes = {};
    const aggDepenses = {};
    for (let y = globalStart; y <= globalEnd; y++) {
        aggCumulCF[y] = 0; aggRecettes[y] = 0; aggDepenses[y] = 0;
    }

    for (const asset of list) {
        const { years } = computeOwnedAssetTimeline(asset, tmi, regime);
        for (const row of years) {
            if (row.year >= globalStart && row.year <= globalEnd) {
                aggCumulCF[row.year] = (aggCumulCF[row.year] || 0) + row.cfAnnuel;
                aggRecettes[row.year] = (aggRecettes[row.year] || 0) + row.recettesAnnee;
                aggDepenses[row.year] = (aggDepenses[row.year] || 0) + row.depensesAnnee;
            }
        }
    }

    // Recumuler
    const labels = [];
    const dataCF = []; const dataRec = []; const dataDep = [];
    let cumCF = 0, cumRec = 0, cumDep = 0;
    for (let y = globalStart; y <= globalEnd; y++) {
        labels.push(String(y));
        cumCF += aggCumulCF[y] || 0;
        cumRec += aggRecettes[y] || 0;
        cumDep += aggDepenses[y] || 0;
        dataCF.push(Math.round(cumCF));
        dataRec.push(Math.round(cumRec));
        dataDep.push(Math.round(cumDep));
    }

    container.hidden = false;
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const gold = '#C5A059'; const green = '#22c55e'; const red = '#ef4444';
    const textClr = isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.4)';
    const gridClr = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

    const scaleOpts = {
        x: { ticks: { color: textClr, maxRotation: 45, minRotation: 45, font: { family: "'IBM Plex Mono', monospace", size: 10 } }, grid: { color: gridClr } },
        y: { ticks: { color: textClr, callback: v => (v / 1000).toFixed(0) + 'k€', font: { family: "'IBM Plex Mono', monospace", size: 10 } }, grid: { color: gridClr } }
    };

    // Injection HTML des canvas si pas encore présents
    if (!document.getElementById('owned-portfolio-cf-chart')) {
        container.innerHTML = `
            <div class="owned-chart-block">
                <div class="owned-chart-title">CF net cumulé — portefeuille</div>
                <canvas id="owned-portfolio-cf-chart" height="200"></canvas>
            </div>
            <div class="owned-chart-block">
                <div class="owned-chart-title">Recettes vs Dépenses — portefeuille</div>
                <canvas id="owned-portfolio-ecart-chart" height="200"></canvas>
                <div class="owned-chart-legend">
                    <span class="owned-chart-legend__item owned-chart-legend__item--recettes">Recettes</span>
                    <span class="owned-chart-legend__item owned-chart-legend__item--depenses">Dépenses</span>
                    <span class="owned-chart-legend__hint">Consolidé sur tous les biens détenus</span>
                </div>
            </div>
        `;
    }

    if (_ownedPortfolioCfChart) { _ownedPortfolioCfChart.destroy(); _ownedPortfolioCfChart = null; }
    const cvCF = document.getElementById('owned-portfolio-cf-chart');
    if (cvCF) {
        _ownedPortfolioCfChart = new Chart(cvCF, {
            type: 'line',
            data: { labels, datasets: [{ data: dataCF, borderColor: gold, backgroundColor: isDark ? 'rgba(197,160,89,0.08)' : 'rgba(197,160,89,0.13)', borderWidth: 2, pointRadius: 2, tension: 0.25, fill: true }] },
            options: { responsive: true, plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ctx.parsed.y.toLocaleString('fr-FR') + ' €' } } }, scales: scaleOpts }
        });
    }

    if (_ownedPortfolioEcartChart) { _ownedPortfolioEcartChart.destroy(); _ownedPortfolioEcartChart = null; }
    const cvEcart = document.getElementById('owned-portfolio-ecart-chart');
    if (cvEcart) {
        _ownedPortfolioEcartChart = new Chart(cvEcart, {
            type: 'line',
            data: { labels, datasets: [
                { label: 'Recettes', data: dataRec, borderColor: green, borderWidth: 2, pointRadius: 2, tension: 0.25, fill: false },
                { label: 'Dépenses', data: dataDep, borderColor: red, borderWidth: 2, pointRadius: 2, tension: 0.25, fill: false }
            ]},
            options: { responsive: true, plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ctx.dataset.label + ' : ' + ctx.parsed.y.toLocaleString('fr-FR') + ' €' } } }, scales: scaleOpts }
        });
    }
}
```

- [ ] **Step 3 : Appeler `renderOwnedPortfolioCharts` dans `renderOwnedPortfolioList`**

Dans `renderOwnedPortfolioList`, à la fin de la section `if (nodes.ownedListTable)`, avant la fermeture de la condition `if (!list.length)` de la section KPI banner, ajouter à la fin de la fonction (après toute la logique `ownedListTable`) :

```js
    renderOwnedPortfolioCharts(list, tmi, getOwnedRegime());
```

- [ ] **Step 4 : Commit**

```bash
git add main.js
git commit -m "feat(portfolio): renderOwnedPortfolioCharts consolidé vue liste"
```

---

## Task 8 : Modale de suppression sécurisée

**Files:**
- Modify: `main.js`

- [ ] **Step 1 : Ajouter les nodes de la modale dans l'objet `nodes`**

Dans la déclaration `const nodes = { ... }`, ajouter :
```js
    ownedDeleteModal: document.getElementById('owned-delete-modal'),
    ownedDeleteModalName: document.getElementById('owned-delete-modal-name'),
    ownedDeleteModalInput: document.getElementById('owned-delete-modal-input'),
    ownedDeleteModalCancel: document.getElementById('owned-delete-modal-cancel'),
    ownedDeleteModalConfirm: document.getElementById('owned-delete-modal-confirm'),
```

- [ ] **Step 2 : Ajouter `openOwnedDeleteModal(id)` et `closeOwnedDeleteModal()` après `closeOwnedAddModal`**

```js
function openOwnedDeleteModal(assetId) {
    const asset = getOwnedAsset(assetId);
    if (!asset || !nodes.ownedDeleteModal) return;
    nodes.ownedDeleteModal._pendingId = assetId;
    nodes.ownedDeleteModalName.textContent = asset.nom || assetId;
    if (nodes.ownedDeleteModalInput) nodes.ownedDeleteModalInput.value = '';
    if (nodes.ownedDeleteModalConfirm) nodes.ownedDeleteModalConfirm.disabled = true;
    nodes.ownedDeleteModal.hidden = false;
    nodes.ownedDeleteModalInput?.focus();
}

function closeOwnedDeleteModal() {
    if (!nodes.ownedDeleteModal) return;
    nodes.ownedDeleteModal.hidden = true;
    nodes.ownedDeleteModal._pendingId = null;
    if (nodes.ownedDeleteModalInput) nodes.ownedDeleteModalInput.value = '';
}
```

- [ ] **Step 3 : Câbler la modale dans `initOwnedPortfolioEvents`**

Chercher `initOwnedPortfolioEvents` et ajouter dans cette fonction :
```js
    // Modale suppression
    if (nodes.ownedDeleteModalInput) {
        nodes.ownedDeleteModalInput.addEventListener('input', () => {
            const val = nodes.ownedDeleteModalInput.value.trim().toLowerCase();
            if (nodes.ownedDeleteModalConfirm) nodes.ownedDeleteModalConfirm.disabled = val !== 'supprimer';
        });
    }
    if (nodes.ownedDeleteModalCancel) {
        nodes.ownedDeleteModalCancel.addEventListener('click', closeOwnedDeleteModal);
    }
    if (nodes.ownedDeleteModalConfirm) {
        nodes.ownedDeleteModalConfirm.addEventListener('click', () => {
            const id = nodes.ownedDeleteModal._pendingId;
            if (!id) return;
            deleteOwnedAsset(id);
            closeOwnedDeleteModal();
            renderOwnedPortfolioList();
        });
    }
    // Fermer sur clic overlay
    nodes.ownedDeleteModal?.addEventListener('click', e => {
        if (e.target === nodes.ownedDeleteModal) closeOwnedDeleteModal();
    });
```

- [ ] **Step 4 : Remplacer l'appel `confirm()` natif par `openOwnedDeleteModal`**

Dans `renderOwnedPortfolioList`, chercher :
```js
                    if (!confirm(`Supprimer "${getOwnedAsset(btn.dataset.id)?.nom || btn.dataset.id}" ?`)) return;
                    deleteOwnedAsset(btn.dataset.id);
                    renderOwnedPortfolioList();
```
Remplacer par :
```js
                    openOwnedDeleteModal(btn.dataset.id);
```

- [ ] **Step 5 : Commit**

```bash
git add main.js
git commit -m "feat(portfolio): modale suppression sécurisée — saisie 'Supprimer' requise"
```

---

## Task 9 : Charges évolutives par année dans Post-achat

**Files:**
- Modify: `main.js`

- [ ] **Step 1 : Initialisation automatique de `chargesAnnuelles` dans `openOwnedDetail`**

Dans `openOwnedDetail(assetId)`, après `state.activeOwnedAssetId = assetId;` :
```js
    // Initialiser chargesAnnuelles si vide avec les valeurs initiales
    const _initAsset = getOwnedAsset(assetId);
    if (_initAsset) {
        const post = _initAsset.postAchat || {};
        if (!post.chargesAnnuelles || post.chargesAnnuelles.length === 0) {
            const annee = _initAsset.anneeAchat || new Date().getFullYear();
            if ((post.taxeFonciere ?? 0) > 0 || (post.gestionLocative ?? 0) > 0 || (post.assurancePNO ?? 0) > 0) {
                addOwnedChargesAnnuelles(assetId, {
                    annee,
                    taxeFonciere: post.taxeFonciere ?? 0,
                    gestionLocative: post.gestionLocative ?? 0,
                    assurancePNO: post.assurancePNO ?? 0,
                });
            }
        }
    }
```

- [ ] **Step 2 : Ajouter la section "Évolution des charges" dans `renderAccordionPostAchat`**

Dans `renderAccordionPostAchat`, chercher la ligne :
```js
        <div class="owned-section-title" style="margin-top:20px">Notes</div>
```
Et insérer **avant** cette ligne dans le template HTML :

```js
        <div class="owned-section-title" style="margin-top:20px">Évolution des charges</div>
        <div class="owned-charges-annuelles-list">
            ${(post.chargesAnnuelles || []).length ? (post.chargesAnnuelles || []).map(e => `
                <div class="owned-charges-annuelles-row">
                    <span class="owned-charges-annuelles-row__year">${e.annee}</span>
                    <span class="owned-charges-annuelles-row__vals">
                        TF : ${(e.taxeFonciere ?? 0).toLocaleString('fr-FR')} €/an · Gest. : ${(e.gestionLocative ?? 0)} % · PNO : ${(e.assurancePNO ?? 0).toLocaleString('fr-FR')} €/an
                    </span>
                    <button class="owned-travaux-delete" data-delete-charges="${e.annee}" title="Supprimer">✕</button>
                </div>
            `).join('') : '<p style="font-size:.82rem;color:var(--text-tertiary);font-style:italic">Aucun historique. Ajoutez une année pour suivre l\'évolution des charges.</p>'}
        </div>
        <form class="owned-charges-form" data-form="add-charges" novalidate>
            <input type="number" name="annee" class="variables-input" placeholder="Année" min="${asset.anneeAchat || 2020}" step="1" required style="min-width:0">
            <input type="number" name="taxeFonciere" class="variables-input" placeholder="TF (€/an)" min="0" step="10" style="min-width:0">
            <input type="number" name="gestionLocative" class="variables-input" placeholder="Gestion (%)" min="0" max="20" step="0.5" style="min-width:0">
            <input type="number" name="assurancePNO" class="variables-input" placeholder="PNO (€/an)" min="0" step="10" style="min-width:0">
            <button type="submit" class="btn btn--primary btn--sm">+ Ajouter</button>
        </form>
```

- [ ] **Step 3 : Câbler les événements des charges annuelles dans `renderAccordionPostAchat`**

Dans `renderAccordionPostAchat`, après le bloc des listeners `[data-post-field]`, ajouter :

```js
    nodes.accPostAchatContent.querySelectorAll('[data-delete-charges]').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = state.activeOwnedAssetId;
            if (!id) return;
            deleteOwnedChargesAnnuelles(id, Number(btn.dataset.deleteCharges));
            const fresh = getOwnedAsset(id);
            renderAccordionPostAchat(fresh);
            renderOwnedSynthese(fresh);
            renderOwnedCharts(fresh);
            renderAccordionSimulateur(fresh);
        });
    });

    nodes.accPostAchatContent.querySelector('[data-form="add-charges"]')?.addEventListener('submit', e => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const id = state.activeOwnedAssetId;
        if (!id) return;
        const annee = Number(fd.get('annee'));
        if (!annee) return;
        addOwnedChargesAnnuelles(id, {
            annee,
            taxeFonciere: Number(fd.get('taxeFonciere')) || 0,
            gestionLocative: Number(fd.get('gestionLocative')) || 0,
            assurancePNO: Number(fd.get('assurancePNO')) || 0,
        });
        e.target.reset();
        const fresh = getOwnedAsset(id);
        renderAccordionPostAchat(fresh);
        renderOwnedSynthese(fresh);
        renderOwnedCharts(fresh);
        renderAccordionSimulateur(fresh);
    });
```

- [ ] **Step 4 : Commit**

```bash
git add main.js
git commit -m "feat(portfolio): charges évolutives par année dans Post-achat"
```

---

## Task 10 : Import `computeOwnedAssetTimeline` dans main.js

**Files:**
- Modify: `main.js`

- [ ] **Step 1 : Ajouter `computeOwnedAssetTimeline` à l'import depuis calculs.js**

Chercher la ligne d'import qui contient `computeOwnedAssetCF` et ajouter `computeOwnedAssetTimeline` :
```js
import { ..., computeOwnedAssetCF, computeOwnedAssetTimeline } from './calculs.js';
```
(Ajouter à la liste existante, ne pas remplacer les autres imports)

- [ ] **Step 2 : Vérifier que `computeAnnualTaxEstimate` est bien accessible dans `calculs.js`**

`computeAnnualTaxEstimate` est une fonction privée (non exportée). `computeOwnedAssetTimeline` l'appelle directement dans `calculs.js` — c'est correct car les deux sont dans le même fichier.

- [ ] **Step 3 : Commit final**

```bash
git add calculs.js main.js index.html styles.css
git commit -m "feat(portfolio): import computeOwnedAssetTimeline — feature complète"
```

---

## Self-Review

**Spec coverage :**
- ✓ Sélecteur régime global (Task 5)
- ✓ CF net cumulé vue détail (Task 6)
- ✓ Recettes vs Dépenses vue détail (Task 6)
- ✓ Graphiques consolidés vue liste (Task 7)
- ✓ Suppression sécurisée (Task 8)
- ✓ Charges évolutives par année (Task 9)
- ✓ Graphiques dynamiques sur modif Acquisition/Post-achat — les appels `renderOwnedCharts` existent déjà dans les listeners, Tasks 6 et 9 les couvrent

**Types/signatures :**
- `computeOwnedAssetCF(asset, scenario, tmi, regimeOverride)` — 4e param optionnel, null par défaut ✓
- `computeOwnedAssetTimeline(asset, tmi, regimeOverride)` — retourne `{ years: [...], anneeAchat, endYear }` ✓
- `addOwnedChargesAnnuelles(assetId, { annee, taxeFonciere, gestionLocative, assurancePNO })` ✓
- `deleteOwnedChargesAnnuelles(assetId, annee)` ✓

**Placeholders :** aucun TBD/TODO dans le plan.
