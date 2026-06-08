# Portefeuille — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refondre la section Portefeuille en outil de décision actionnable : fiches biens avec donuts cash-flow, conseils intelligents par règles métier, travaux et notes par bien, diagnostic IA à la demande.

**Architecture:** Les nouvelles fonctions de rendu restent dans `main.js` en suivant le pattern existant (`buildPortfolio*`). Le moteur de règles est une fonction pure `computePortfolioAdvice()`. Les donuts par bien sont rendus via une nouvelle fonction `renderDonutChart()` dans `ui.js`. Le diagnostic IA passe par un nouvel endpoint Flask `/api/portfolio-diagnostic`.

**Tech Stack:** Chart.js (déjà présent), Flask + Anthropic SDK (déjà présent dans scraper), localStorage, Vanilla JS ES Modules.

**Spec de référence :** `docs/superpowers/specs/2026-06-08-portefeuille-refonte.md`

---

## Découpage en phases

- **Phase A (tâches 1–4)** : Fondations — données, nettoyage, HTML skeleton
- **Phase B (tâches 5–9)** : Rendu des zones 1 à 4 + CSS
- **Phase C (tâches 10–11)** : Travaux et Notes (CRUD localStorage)
- **Phase D (tâches 12–13)** : Diagnostic IA (Flask + UI)

---

## Fichiers modifiés

| Fichier | Rôle des modifications |
|---|---|
| `main.js` | Helpers localStorage, moteur de règles, fonctions render zones 1-4, CRUD travaux/notes, appel diagnostic |
| `index.html` | Champ `annee-achat`, suppression projection patrimoniale, restructuration `collection-panel` |
| `ui.js` | Nouvelle fonction `renderDonutChart(canvasEl, credit, charges, impots, cf)` |
| `styles.css` | Composants fiche, donut, conseil, travaux, notes, drawer IA |
| `server.py` | Endpoint `POST /api/portfolio-diagnostic` |
| `tests/test_server_api.py` | Tests endpoint diagnostic |

`calculs.js` — aucune modification.

---

## Tâche 1 : Helpers localStorage assetMeta + champ annee-achat

**Fichiers :**
- Modifier : `main.js` (VARIABLE_DEFAULTS, sanitizeVariablesData, nouveaux helpers)
- Modifier : `index.html` (nouveau champ dans fieldset Identité)

### Étapes

- [ ] **1.1 — Ajouter `annee-achat` dans VARIABLE_DEFAULTS**

Dans `main.js`, ligne ~113, après `'decision-next-step': ''` :

```js
const VARIABLE_DEFAULTS = {
    // … existant …
    'decision-next-step': '',
    'annee-achat': null
};
```

- [ ] **1.2 — Ajouter `annee-achat` dans `sanitizeVariablesData()`**

Dans `main.js`, ligne ~684, après `'decision-next-step': String(…)` :

```js
'decision-next-step': String(rawVariables['decision-next-step'] || '').trim(),
'annee-achat': rawVariables['annee-achat']
    ? Math.max(1900, Math.min(new Date().getFullYear(), Math.round(Number(rawVariables['annee-achat']))))
    : null
```

- [ ] **1.3 — Ajouter le champ dans `index.html`**

Trouver le fieldset "Identité du dossier" (chercher `<legend>Identité du dossier</legend>`). Ajouter après le champ `statut-bien` :

```html
<label class="variables-field" for="annee-achat">
    <span class="variables-label">Année d'achat</span>
    <input id="annee-achat" name="annee-achat" type="number" class="variables-input"
        placeholder="ex : 2022" min="1900" max="2099" step="1">
    <span class="field-assist">Optionnel. Permet les conseils temporels (intérêts restants, durée de détention).</span>
</label>
```

- [ ] **1.4 — Ajouter les helpers assetMeta dans `main.js`**

Après `const STORAGE_KEYS = { … }` (ligne ~45), ajouter :

```js
const ASSET_META_KEY = 'investissementWebAssetMeta';

function loadAssetMeta() {
    try { return JSON.parse(localStorage.getItem(ASSET_META_KEY)) || {}; }
    catch { return {}; }
}

function saveAssetMeta(meta) {
    localStorage.setItem(ASSET_META_KEY, JSON.stringify(meta));
}

function getAssetMeta(assetId) {
    const all = loadAssetMeta();
    return all[assetId] || { travaux: [], notes: [], lastDiagnostic: null };
}

function setAssetMeta(assetId, patch) {
    const all = loadAssetMeta();
    all[assetId] = { ...getAssetMeta(assetId), ...patch };
    saveAssetMeta(all);
}

function addTravail(assetId, travail) {
    const meta = getAssetMeta(assetId);
    const entry = {
        id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        date: travail.date || '',
        description: travail.description || '',
        montant: Math.max(0, Number(travail.montant) || 0),
        tag: ['deductible', 'non-deductible', 'a-classifier'].includes(travail.tag) ? travail.tag : 'a-classifier'
    };
    setAssetMeta(assetId, { travaux: [...meta.travaux, entry] });
}

function deleteTravail(assetId, travailId) {
    const meta = getAssetMeta(assetId);
    setAssetMeta(assetId, { travaux: meta.travaux.filter(t => t.id !== travailId) });
}

function addNote(assetId, text) {
    if (!text.trim()) return;
    const meta = getAssetMeta(assetId);
    const entry = {
        id: `n-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        createdAt: new Date().toISOString(),
        text: text.trim()
    };
    setAssetMeta(assetId, { notes: [...meta.notes, entry] });
}
```

- [ ] **1.5 — Vérifier dans le navigateur**

Lancer `python app.py`. Ouvrir DevTools > Application > LocalStorage. Créer un bien, entrer une année d'achat, vérifier que le champ est sauvegardé dans `investissementWebVariablesData`.

- [ ] **1.6 — Commit**

```bash
git add main.js index.html
git commit -m "feat(portfolio): ajout champ annee-achat + helpers localStorage assetMeta"
```

---

## Tâche 2 : Suppression de la projection patrimoniale et nettoyage

**Fichiers :**
- Modifier : `index.html` (supprimer les sections remplacées)
- Modifier : `main.js` (supprimer fonctions et nœuds DOM obsolètes)

### Étapes

- [ ] **2.1 — Supprimer dans `index.html`**

Supprimer les 4 blocs `<section class="analysis-block">` suivants dans `collection-panel` :
- `<h4>Priorités de portefeuille</h4><div id="portfolio-priorities"></div>`
- `<h4>Vue fiscale consolidée</h4><div id="portfolio-fiscal"></div>`
- `<h4>Taux d'endettement bancaire</h4><div id="portfolio-debt-ratios"></div>`
- `<h4>Progression vers l'objectif</h4><div id="portfolio-objectif"></div>`
- `<h4>Projection patrimoniale</h4><div id="portfolio-projection"></div>`
- `<h4>Répartition par bien</h4>` et son contenu `id="portfolio-repartition"`

Conserver : `id="portfolio-kpi-banner"`, `id="portfolio-simulator"`, `id="portfolio-hero"`, `id="portfolio-summary"`, `id="portfolio-asset-grid-owned"`, `id="portfolio-asset-grid-pipeline"`.

- [ ] **2.2 — Supprimer les nœuds DOM orphelins dans `main.js`**

Dans le bloc `const nodes = { … }`, supprimer les lignes :
```js
portfolioPriorities: document.getElementById('portfolio-priorities'),
portfolioFiscal: document.getElementById('portfolio-fiscal'),
portfolioDebtRatios: document.getElementById('portfolio-debt-ratios'),
portfolioObjectif: document.getElementById('portfolio-objectif'),
portfolioProjection: document.getElementById('portfolio-projection'),
portfolioRepartition: document.getElementById('portfolio-repartition'),
```

- [ ] **2.3 — Supprimer les fonctions de rendu obsolètes dans `main.js`**

Supprimer les fonctions : `buildPortfolioProjection`, `buildPortfolioPriorities` (rendu HTML, pas le calcul dans calculs.js), `buildPortfolioFiscal`, `buildPortfolioDebtRatios`, `buildPortfolioObjectif`, `buildPortfolioRepartition`.

Chercher leurs appels dans la fonction principale de rendu du portefeuille et les retirer.

- [ ] **2.4 — Vérifier qu'il n'y a pas d'erreur console**

Lancer `python app.py`, ouvrir l'onglet Portefeuille, vérifier la console : aucune erreur `Cannot set properties of null`.

- [ ] **2.5 — Commit**

```bash
git add main.js index.html
git commit -m "feat(portfolio): suppression projection patrimoniale et sections remplacées"
```

---

## Tâche 3 : Restructuration HTML du collection-panel (4 zones)

**Fichiers :**
- Modifier : `index.html` (restructuration des conteneurs)

### Étapes

- [ ] **3.1 — Remplacer le contenu de `collection-panel` dans `index.html`**

Remplacer tout ce qui se trouve entre `<section id="collection-panel" …>` et `</section>` par :

```html
<section id="collection-panel" class="workspace-panel" aria-label="Pilotage multi-biens">

    <!-- Zone 1 : Tableau de bord global -->
    <div class="portfolio-zone portfolio-zone--dashboard">
        <div id="portfolio-kpi-banner"></div>
        <div class="portfolio-dashboard-visuals">
            <div id="portfolio-donut-consolidated-wrap" class="portfolio-donut-wrap" hidden>
                <h4 class="portfolio-donut-title">Répartition cash-flow globale</h4>
                <canvas id="portfolio-donut-consolidated" width="200" height="200"></canvas>
            </div>
            <div id="portfolio-alerts" class="portfolio-alerts"></div>
        </div>
    </div>

    <!-- Zone 2 : Conseils intelligents -->
    <div id="portfolio-advice" class="portfolio-zone portfolio-zone--advice" hidden>
        <h3 class="portfolio-zone-title">Ce que tu devrais regarder</h3>
        <div id="portfolio-advice-cards" class="portfolio-advice-cards"></div>
    </div>

    <!-- Zone 3 : Fiches de biens détenus -->
    <div id="portfolio-owned-zone" class="portfolio-zone portfolio-zone--owned" hidden>
        <h3 class="portfolio-zone-title">Biens détenus</h3>
        <div id="portfolio-fiches" class="portfolio-fiches-grid"></div>
    </div>

    <!-- Zone 4 : Pipeline -->
    <div id="portfolio-pipeline-zone" class="portfolio-zone portfolio-zone--pipeline" hidden>
        <h3 class="portfolio-zone-title">Biens à l'étude</h3>
        <div id="portfolio-asset-grid-pipeline" class="portfolio-asset-section"></div>
    </div>

    <!-- Zone 5 : Diagnostic IA -->
    <div id="portfolio-ai-drawer" class="portfolio-ai-drawer" hidden aria-modal="true" role="dialog" aria-label="Diagnostic IA">
        <div class="portfolio-ai-drawer__header">
            <span class="portfolio-ai-drawer__title">Diagnostic IA</span>
            <button id="portfolio-ai-drawer-close" class="portfolio-ai-drawer__close" type="button" aria-label="Fermer">✕</button>
        </div>
        <div id="portfolio-ai-drawer-content" class="portfolio-ai-drawer__content"></div>
    </div>
    <div id="portfolio-ai-overlay" class="portfolio-ai-overlay" hidden></div>

    <!-- Conservé : simulator -->
    <div id="portfolio-simulator"></div>
    <div id="portfolio-hero" class="workspace-hero" aria-label="Synthèse portefeuille" hidden></div>
    <div id="portfolio-summary" class="analysis-grid" hidden></div>
    <div id="portfolio-asset-grid-owned" hidden></div>
</section>
```

- [ ] **3.2 — Ajouter les nouveaux nœuds DOM dans `nodes` (main.js)**

Dans le bloc `const nodes = { … }`, ajouter :

```js
portfolioAlerts: document.getElementById('portfolio-alerts'),
portfolioAdvice: document.getElementById('portfolio-advice'),
portfolioAdviceCards: document.getElementById('portfolio-advice-cards'),
portfolioOwnedZone: document.getElementById('portfolio-owned-zone'),
portfolioFiches: document.getElementById('portfolio-fiches'),
portfolioPipelineZone: document.getElementById('portfolio-pipeline-zone'),
portfolioDonutConsolidatedWrap: document.getElementById('portfolio-donut-consolidated-wrap'),
portfolioAiDrawer: document.getElementById('portfolio-ai-drawer'),
portfolioAiOverlay: document.getElementById('portfolio-ai-overlay'),
portfolioAiDrawerContent: document.getElementById('portfolio-ai-drawer-content'),
```

- [ ] **3.3 — Vérifier le rendu (aucun contenu requis à ce stade)**

Lancer `python app.py`, ouvrir Portefeuille, vérifier que la page s'affiche sans erreur console. Les zones sont vides ou masquées — c'est normal.

- [ ] **3.4 — Commit**

```bash
git add index.html main.js
git commit -m "feat(portfolio): restructuration HTML collection-panel en 4 zones"
```

---

## Tâche 4 : Moteur de règles `computePortfolioAdvice()`

**Fichiers :**
- Modifier : `main.js` (nouvelle fonction pure)

### Étapes

- [ ] **4.1 — Ajouter la fonction `computePortfolioAdvice()` dans `main.js`**

Placer avant la première fonction `buildPortfolio*` :

```js
/**
 * Évalue le portefeuille et retourne une liste de conseils actionnables.
 * Retourne : Array<{ id, severity, title, text, action, actionLabel, assetId }>
 *   severity : 'orange' | 'red' | 'info'
 *   action   : 'load-simulator' | 'see-fiche' | null
 */
function computePortfolioAdvice(portfolioItems, profileData, capacity, assetMetaAll) {
    const advice = [];
    const currentYear = new Date().getFullYear();
    const income = profileData.income || 0;
    const tmi = calculateTMI(income, { adults: profileData.adults || 2, children: profileData.children || 0 });

    // Revenus fonciers annuels estimés = sum(loyer * 12 * (1 - vacance/100)) sur owned
    const revenusFonciersEstimes = portfolioItems.reduce((sum, item) => {
        const loyer = item.variablesData['loyer'] || 0;
        const vacance = item.variablesData['vacance'] || 0;
        return sum + loyer * 12 * (1 - vacance / 100);
    }, 0);

    // Taux d'endettement
    const mensualitesCredit = portfolioItems.reduce((sum, item) => sum + (item.model.mensualiteTotale || 0), 0);
    const revenusMensuels = income / 12;
    const tauxEndettement = revenusMensuels > 0 ? (mensualitesCredit / revenusMensuels) * 100 : 0;

    // --- RÈGLES FISCALES ---

    const microFoncierItems = portfolioItems.filter(i => (i.variablesData['regime'] || '') === 'micro-foncier');

    if (revenusFonciersEstimes > 15000 && microFoncierItems.length > 0) {
        advice.push({
            id: 'fiscal-reel-threshold',
            severity: 'orange',
            title: 'Régime réel potentiellement avantageux',
            text: `Vos revenus fonciers estimés (${Math.round(revenusFonciersEstimes).toLocaleString('fr-FR')} €/an) dépassent 15 000 €. Le régime réel permet de déduire les charges réelles et peut réduire significativement votre imposition par rapport au micro-foncier.`,
            action: null, actionLabel: null, assetId: null
        });
    }

    if (tmi >= 30 && portfolioItems.length >= 2) {
        const cfConsolide = portfolioItems.reduce((s, i) => s + (i.metrics.cfNetNet || 0), 0);
        if (cfConsolide > 0) {
            advice.push({
                id: 'fiscal-sci-is',
                severity: 'info',
                title: 'SCI à l\'IS à étudier',
                text: `Votre TMI est à ${tmi} % avec un CF consolidé positif sur ${portfolioItems.length} biens. La SCI à l'IS peut plafonner l'imposition à 15–25 % sur les bénéfices et optimiser la transmission patrimoniale.`,
                action: null, actionLabel: null, assetId: null
            });
        }
    }

    portfolioItems.forEach(item => {
        const regime = item.variablesData['regime'] || '';
        const meta = assetMetaAll[item.id] || { travaux: [] };
        const anneeAchat = item.variablesData['annee-achat'];
        const anneesDetention = anneeAchat ? currentYear - anneeAchat : null;

        // Intérêts encore significatifs + régime micro-foncier
        if (regime === 'micro-foncier' && anneeAchat && anneesDetention !== null && anneesDetention < 10) {
            const interetsAnnuels = item.model.interetsAnnee1 || 0;
            if (interetsAnnuels > 2000) {
                advice.push({
                    id: `fiscal-interets-${item.id}`,
                    severity: 'orange',
                    title: `${escapeHtml(item.name)} — intérêts déductibles`,
                    text: `Les intérêts d'emprunt représentent encore ${Math.round(interetsAnnuels).toLocaleString('fr-FR')} €/an. En régime réel, ils sont entièrement déductibles — ce qui peut être plus avantageux que l'abattement micro-foncier de 30 %.`,
                    action: 'load-simulator', actionLabel: 'Simuler en régime réel', assetId: item.id
                });
            }
        }

        // Travaux déductibles non classifiés
        const travauxAClassifier = meta.travaux.filter(t => t.tag === 'a-classifier');
        if (travauxAClassifier.length > 0) {
            const totalAClassifier = travauxAClassifier.reduce((s, t) => s + t.montant, 0);
            advice.push({
                id: `travaux-classifier-${item.id}`,
                severity: 'red',
                title: `${escapeHtml(item.name)} — travaux à classifier`,
                text: `${travauxAClassifier.length} travaux (${Math.round(totalAClassifier).toLocaleString('fr-FR')} €) n'ont pas encore de classification fiscale. Tant qu'ils ne sont pas classifiés, leur impact sur votre imposition n'est pas calculé.`,
                action: 'see-fiche', actionLabel: 'Voir la fiche', assetId: item.id
            });
        }

        // Travaux déductibles significatifs + régime micro-foncier
        if (regime === 'micro-foncier') {
            const anneeEnCours = currentYear;
            const travauxDeductiblesAnnee = meta.travaux
                .filter(t => t.tag === 'deductible' && t.date && new Date(t.date).getFullYear() === anneeEnCours)
                .reduce((s, t) => s + t.montant, 0);
            if (travauxDeductiblesAnnee > 1500) {
                advice.push({
                    id: `fiscal-travaux-reel-${item.id}`,
                    severity: 'orange',
                    title: `${escapeHtml(item.name)} — travaux justifient le régime réel`,
                    text: `Vous avez ${Math.round(travauxDeductiblesAnnee).toLocaleString('fr-FR')} € de travaux déductibles en ${anneeEnCours}. En régime réel, ces charges s'imputent sur vos revenus fonciers, ce qui peut effacer l'impôt foncier de l'année.`,
                    action: 'load-simulator', actionLabel: 'Simuler en régime réel', assetId: item.id
                });
            }
        }
    });

    // --- RÈGLES DETTE ---

    if (tauxEndettement > 30 && tauxEndettement <= 35) {
        advice.push({
            id: 'debt-approaching-limit',
            severity: 'orange',
            title: 'Taux d\'endettement élevé',
            text: `Votre taux d'endettement est à ${tauxEndettement.toFixed(1).replace('.', ',')} % — proche du plafond bancaire de 35 %. Une nouvelle acquisition devra être soigneusement cadrée pour rester finançable.`,
            action: null, actionLabel: null, assetId: null
        });
    }

    if (tauxEndettement <= 25 && (capacity.acquisitionBudget || 0) > 50000) {
        advice.push({
            id: 'debt-capacity-available',
            severity: 'info',
            title: 'Capacité d\'acquisition disponible',
            text: `Taux d'endettement à ${tauxEndettement.toFixed(1).replace('.', ',')} %. Votre capacité d'emprunt restante est estimée à ${Math.round((capacity.acquisitionBudget || 0) / 1000)} k€ — suffisant pour une nouvelle acquisition.`,
            action: null, actionLabel: null, assetId: null
        });
    }

    // --- RÈGLES RISQUE ---

    portfolioItems.forEach(item => {
        if ((item.metrics.dscr || 0) < 1.1 && (item.metrics.dscr || 0) > 0) {
            advice.push({
                id: `risk-dscr-${item.id}`,
                severity: 'orange',
                title: `${escapeHtml(item.name)} — DSCR serré`,
                text: `Le DSCR de ce bien est à ${(item.metrics.dscr || 0).toFixed(2).replace('.', ',')} — en dessous de 1.1. Une vacance locative ou une hausse de charges peut faire passer le bien en CF négatif.`,
                action: 'load-simulator', actionLabel: 'Simuler une vacance', assetId: item.id
            });
        }

        if ((item.metrics.cfNetNet || 0) < -100) {
            advice.push({
                id: `risk-cf-neg-${item.id}`,
                severity: 'red',
                title: `${escapeHtml(item.name)} — CF négatif`,
                text: `Ce bien génère ${Math.round(item.metrics.cfNetNet || 0).toLocaleString('fr-FR')} €/mois net-net. Il pèse sur votre cash-flow consolidé. Étudiez une renégociation de crédit, un changement de régime fiscal ou une hausse de loyer.`,
                action: 'load-simulator', actionLabel: 'Simuler des leviers', assetId: item.id
            });
        }
    });

    // Concentration géographique
    if (portfolioItems.length >= 2) {
        const villes = new Set(portfolioItems.map(i => (i.city || '').toLowerCase().trim()));
        if (villes.size === 1) {
            advice.push({
                id: 'risk-concentration',
                severity: 'info',
                title: 'Concentration géographique',
                text: `Tous vos biens sont localisés dans la même ville. Un retournement du marché local ou une hausse de la vacance dans cette zone affecterait l'ensemble de votre portefeuille.`,
                action: null, actionLabel: null, assetId: null
            });
        }
    }

    return advice;
}
```

- [ ] **4.2 — Vérifier que la fonction est sans erreur de syntaxe**

Lancer `python app.py` et ouvrir la console. Aucune erreur de parsing JavaScript.

- [ ] **4.3 — Commit**

```bash
git add main.js
git commit -m "feat(portfolio): moteur de règles computePortfolioAdvice()"
```

---

## Tâche 5 : Zone 1 — Donut consolidé + alertes

**Fichiers :**
- Modifier : `ui.js` (nouvelle fonction `renderDonutChart`)
- Modifier : `main.js` (rendu Zone 1)
- Modifier : `styles.css` (styles donut + alertes)

### Étapes

- [ ] **5.1 — Ajouter `renderDonutChart()` dans `ui.js`**

Ajouter après `updateEvolutionChart` :

```js
const _donutInstances = new Map();

export function renderDonutChart(canvasId, credit, charges, impots, cf) {
    const textColor = getThemeTextColor();
    const cfDisplay = Math.max(0, cf);
    const cfNeg = cf < 0 ? Math.abs(cf) : 0;
    const data = [credit, charges, impots, cfDisplay, cfNeg];
    const colors = ['#F85149', '#ff9500', '#af52de', '#3FB950', '#6e6e6e'];
    const labels = ['Banque', 'Charges', 'Impôts', 'CF net-net', 'CF négatif'];

    if (_donutInstances.has(canvasId)) {
        const chart = _donutInstances.get(canvasId);
        chart.data.datasets[0].data = data;
        chart.options.plugins.legend.labels.color = textColor;
        chart.update();
        return;
    }

    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const chart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{ data, backgroundColor: colors, borderWidth: 0 }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'right', labels: { color: textColor, font: { size: 11 } } },
                tooltip: {
                    callbacks: {
                        label: ctx => {
                            const v = ctx.raw;
                            return v > 0 ? ` ${Math.round(v).toLocaleString('fr-FR')} €/mois` : null;
                        }
                    }
                }
            }
        }
    });
    _donutInstances.set(canvasId, chart);
}

export function destroyDonut(canvasId) {
    if (_donutInstances.has(canvasId)) {
        _donutInstances.get(canvasId).destroy();
        _donutInstances.delete(canvasId);
    }
}
```

- [ ] **5.2 — Importer `renderDonutChart` et `destroyDonut` dans `main.js`**

En haut de `main.js`, ligne 1, modifier l'import `ui.js` existant :

```js
import { updateChart, updateEvolutionChart, updateScoreBanner, updateRegimeComparison, updateNegoTable, validateInputs, showToast, setNegoTableMode, generateOptimizationTips, renderDonutChart, destroyDonut } from './ui.js';
```

- [ ] **5.3 — Créer `buildPortfolioDashboardZone()` dans `main.js`**

Ajouter après `buildPortfolioKpiBanner` :

```js
function buildPortfolioDashboardZone(collectionsView, advice) {
    const { portfolioItems } = collectionsView;
    if (!nodes.portfolioDonutConsolidatedWrap) return;

    if (!portfolioItems.length) {
        nodes.portfolioDonutConsolidatedWrap.hidden = true;
        nodes.portfolioAlerts.innerHTML = '';
        return;
    }

    // Donut consolidé
    const totalCredit  = portfolioItems.reduce((s, i) => s + (i.model.mensualiteTotale || 0), 0);
    const totalCharges = portfolioItems.reduce((s, i) => s + (i.model.chargesExploitationAnnuelles || 0) / 12, 0);
    const totalImpots  = portfolioItems.reduce((s, i) => s + (i.model.impotsAnnee || 0) / 12, 0);
    const totalCf      = portfolioItems.reduce((s, i) => s + (i.metrics.cfNetNet || 0), 0);

    nodes.portfolioDonutConsolidatedWrap.hidden = false;
    renderDonutChart('portfolio-donut-consolidated', totalCredit, totalCharges, totalImpots, totalCf);

    // Alertes actives (max 3, les plus sévères en premier)
    const redFirst = [...advice].sort((a, b) => {
        const rank = { red: 0, orange: 1, info: 2 };
        return (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3);
    });
    const topAlerts = redFirst.filter(a => a.severity !== 'info').slice(0, 3);

    nodes.portfolioAlerts.innerHTML = topAlerts.length
        ? topAlerts.map(a => `
            <div class="portfolio-alert portfolio-alert--${a.severity}" data-advice-id="${escapeHtml(a.id)}">
                <span class="portfolio-alert__dot"></span>
                <span class="portfolio-alert__text">${escapeHtml(a.title)}</span>
            </div>`).join('')
        : '';
}
```

- [ ] **5.4 — Appeler `buildPortfolioDashboardZone` depuis la fonction principale de rendu portefeuille**

Trouver la fonction qui appelle `buildPortfolioKpiBanner(collectionsView)` (chercher ce nom dans main.js). Ajouter après :

```js
const advice = computePortfolioAdvice(
    collectionsView.portfolioItems,
    state.profileData,
    collectionsView.capacity,
    loadAssetMeta()
);
buildPortfolioDashboardZone(collectionsView, advice);
```

Passer `advice` aux prochaines fonctions buildPortfolio* au fur et à mesure des tâches suivantes.

- [ ] **5.5 — Ajouter les styles dans `styles.css`**

```css
/* Donut consolidé */
.portfolio-dashboard-visuals {
    display: flex;
    gap: 24px;
    align-items: flex-start;
    flex-wrap: wrap;
    margin-top: 16px;
}

.portfolio-donut-wrap {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.portfolio-donut-title {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-secondary);
    margin: 0;
}

.portfolio-donut-wrap canvas {
    width: 220px !important;
    height: 220px !important;
}

/* Alertes */
.portfolio-alerts {
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex: 1;
    min-width: 220px;
}

.portfolio-alert {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-radius: 8px;
    cursor: pointer;
    transition: opacity 0.15s;
    font-size: 0.85rem;
}

.portfolio-alert:hover { opacity: 0.8; }

.portfolio-alert--red {
    background: color-mix(in srgb, #F85149 12%, transparent);
    border: 1px solid color-mix(in srgb, #F85149 30%, transparent);
}

.portfolio-alert--orange {
    background: color-mix(in srgb, #ff9500 12%, transparent);
    border: 1px solid color-mix(in srgb, #ff9500 30%, transparent);
}

.portfolio-alert__dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
}

.portfolio-alert--red .portfolio-alert__dot    { background: #F85149; }
.portfolio-alert--orange .portfolio-alert__dot { background: #ff9500; }

/* Zones */
.portfolio-zone { margin-bottom: 32px; }
.portfolio-zone-title {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-secondary);
    margin: 0 0 16px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--border-subtle);
}
```

- [ ] **5.6 — Vérifier visuellement**

Lancer `python app.py`. Avec au moins un bien en portefeuille, vérifier que le donut consolidé apparaît et que les alertes s'affichent si des règles se déclenchent.

- [ ] **5.7 — Commit**

```bash
git add ui.js main.js styles.css
git commit -m "feat(portfolio): donut cash-flow consolidé + alertes actives zone 1"
```

---

## Tâche 6 : Zone 2 — Cards conseils intelligents

**Fichiers :**
- Modifier : `main.js` (render Zone 2)
- Modifier : `styles.css`

### Étapes

- [ ] **6.1 — Créer `buildPortfolioAdviceZone()` dans `main.js`**

```js
function buildPortfolioAdviceZone(advice, collectionsView) {
    if (!nodes.portfolioAdvice || !nodes.portfolioAdviceCards) return;

    if (!advice.length) {
        nodes.portfolioAdvice.hidden = true;
        return;
    }

    nodes.portfolioAdvice.hidden = false;

    const SEVERITY_LABEL = { red: 'Action recommandée', orange: 'À surveiller', info: 'Information' };
    const THEME_GROUPS = [
        { ids: ['fiscal-', 'travaux-classifier-'], label: 'Fiscalité' },
        { ids: ['debt-'], label: 'Dette & financement' },
        { ids: ['risk-'], label: 'Risque' }
    ];

    // Grouper par thème
    function getTheme(id) {
        for (const g of THEME_GROUPS) {
            if (g.ids.some(prefix => id.startsWith(prefix))) return g.label;
        }
        return 'Opportunité';
    }

    const grouped = {};
    advice.forEach(a => {
        const theme = getTheme(a.id);
        if (!grouped[theme]) grouped[theme] = [];
        grouped[theme].push(a);
    });

    nodes.portfolioAdviceCards.innerHTML = Object.entries(grouped).map(([theme, items]) => `
        <div class="advice-group">
            <div class="advice-group__label">${escapeHtml(theme)}</div>
            ${items.map(a => `
                <div class="advice-card advice-card--${a.severity}" data-advice-id="${escapeHtml(a.id)}">
                    <div class="advice-card__header">
                        <span class="advice-card__title">${escapeHtml(a.title)}</span>
                        <span class="advice-card__badge advice-card__badge--${a.severity}">${escapeHtml(SEVERITY_LABEL[a.severity] || '')}</span>
                    </div>
                    <p class="advice-card__text">${escapeHtml(a.text)}</p>
                    ${a.action && a.assetId ? `
                        <button class="advice-card__action btn btn--ghost btn--sm"
                            data-action="${escapeHtml(a.action)}"
                            data-asset-id="${escapeHtml(a.assetId)}">
                            ${escapeHtml(a.actionLabel || 'Voir')}
                        </button>` : ''}
                </div>`).join('')}
        </div>`).join('');

    // Gérer les clics sur actions
    nodes.portfolioAdviceCards.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.dataset.action;
            const assetId = btn.dataset.assetId;
            if (action === 'load-simulator' && assetId) {
                loadAsset(assetId);
                document.querySelector('[data-target="workspace-panel"]')?.click();
            }
            if (action === 'see-fiche' && assetId) {
                const fiche = document.querySelector(`[data-fiche-id="${CSS.escape(assetId)}"]`);
                fiche?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    });
}
```

- [ ] **6.2 — Appeler `buildPortfolioAdviceZone` depuis la fonction principale de rendu**

Ajouter après l'appel à `buildPortfolioDashboardZone` :

```js
buildPortfolioAdviceZone(advice, collectionsView);
```

- [ ] **6.3 — Ajouter les styles dans `styles.css`**

```css
.portfolio-advice-cards {
    display: flex;
    flex-direction: column;
    gap: 24px;
}

.advice-group { display: flex; flex-direction: column; gap: 8px; }

.advice-group__label {
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-tertiary);
    margin-bottom: 4px;
}

.advice-card {
    padding: 16px;
    border-radius: 8px;
    border: 1px solid var(--border-subtle);
    background: var(--surface-low);
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.advice-card--red    { border-color: color-mix(in srgb, #F85149 35%, transparent); }
.advice-card--orange { border-color: color-mix(in srgb, #ff9500 35%, transparent); }
.advice-card--info   { border-color: var(--border-subtle); }

.advice-card__header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 8px;
}

.advice-card__title {
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--text-primary);
    line-height: 1.3;
}

.advice-card__badge {
    font-size: 0.65rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 2px 7px;
    border-radius: 20px;
    white-space: nowrap;
    flex-shrink: 0;
}

.advice-card__badge--red    { background: color-mix(in srgb, #F85149 15%, transparent); color: #F85149; }
.advice-card__badge--orange { background: color-mix(in srgb, #ff9500 15%, transparent); color: #ff9500; }
.advice-card__badge--info   { background: var(--surface-mid); color: var(--text-secondary); }

.advice-card__text {
    font-size: 0.85rem;
    color: var(--text-secondary);
    line-height: 1.5;
    margin: 0;
}

.advice-card__action { align-self: flex-start; margin-top: 4px; }
```

- [ ] **6.4 — Vérifier visuellement**

Lancer `python app.py`. Ajouter un bien en micro-foncier avec des loyers > 1 250 €/mois (= 15 000 €/an). Vérifier que la carte conseil "Régime réel potentiellement avantageux" apparaît dans la Zone 2.

- [ ] **6.5 — Commit**

```bash
git add main.js styles.css
git commit -m "feat(portfolio): zone 2 cards conseils intelligents"
```

---

## Tâche 7 : Zone 3 — Fiches de biens (structure + donut + KPIs)

**Fichiers :**
- Modifier : `main.js`
- Modifier : `styles.css`

### Étapes

- [ ] **7.1 — Créer `buildPortfolioFiches()` dans `main.js`**

```js
function buildPortfolioFiches(collectionsView, advice, assetMetaAll) {
    if (!nodes.portfolioOwnedZone || !nodes.portfolioFiches) return;

    const { portfolioItems } = collectionsView;

    if (!portfolioItems.length) {
        nodes.portfolioOwnedZone.hidden = true;
        return;
    }

    nodes.portfolioOwnedZone.hidden = false;

    // Déterminer le verdict de chaque fiche selon les conseils
    function getVerdict(assetId) {
        const related = advice.filter(a => a.assetId === assetId || a.assetId === null);
        if (related.some(a => a.severity === 'red' && a.assetId === assetId)) return 'red';
        if (related.some(a => a.severity === 'orange' && a.assetId === assetId)) return 'orange';
        return 'green';
    }

    const VERDICT_LABELS = { green: 'RAS', orange: 'À surveiller', red: 'Action recommandée' };
    const REGIME_LABELS_SHORT = { 'micro-foncier': 'Micro-foncier', 'reel': 'Réel', 'sci-is': 'SCI-IS' };

    nodes.portfolioFiches.innerHTML = portfolioItems.map(item => {
        const verdict = getVerdict(item.id);
        const regime = item.variablesData['regime'] || '';
        const meta = assetMetaAll[item.id] || { travaux: [], notes: [] };
        const travauxCount = meta.travaux.length;
        const notesCount = meta.notes.length;
        const hasUnclassified = meta.travaux.some(t => t.tag === 'a-classifier');

        return `
        <article class="portfolio-fiche" data-fiche-id="${escapeHtml(item.id)}">
            <div class="portfolio-fiche__header">
                <div class="portfolio-fiche__identity">
                    <span class="portfolio-fiche__name">${escapeHtml(item.name)}</span>
                    <span class="portfolio-fiche__meta">${escapeHtml(item.city)} · <span class="portfolio-fiche__regime">${escapeHtml(REGIME_LABELS_SHORT[regime] || regime)}</span></span>
                </div>
                <span class="portfolio-fiche__verdict portfolio-fiche__verdict--${verdict}">${escapeHtml(VERDICT_LABELS[verdict])}</span>
            </div>

            <div class="portfolio-fiche__body">
                <div class="portfolio-fiche__donut-wrap">
                    <canvas id="donut-${escapeHtml(item.id)}" width="160" height="160"></canvas>
                </div>
                <div class="portfolio-fiche__kpis">
                    <div class="portfolio-fiche__kpi">
                        <span class="portfolio-fiche__kpi-label">Rendement brut</span>
                        <span class="portfolio-fiche__kpi-value">${(item.metrics.rentaBrute || 0).toFixed(1).replace('.', ',')} %</span>
                    </div>
                    <div class="portfolio-fiche__kpi">
                        <span class="portfolio-fiche__kpi-label">CF net-net</span>
                        <span class="portfolio-fiche__kpi-value ${(item.metrics.cfNetNet || 0) >= 0 ? 'text--positive' : 'text--negative'}">
                            ${(item.metrics.cfNetNet || 0) >= 0 ? '+' : ''}${Math.round(item.metrics.cfNetNet || 0).toLocaleString('fr-FR')} €/mois
                        </span>
                    </div>
                    <div class="portfolio-fiche__kpi">
                        <span class="portfolio-fiche__kpi-label">DSCR</span>
                        <span class="portfolio-fiche__kpi-value ${(item.metrics.dscr || 0) >= 1.1 ? 'text--positive' : (item.metrics.dscr || 0) >= 1 ? 'text--watch' : 'text--negative'}">
                            ${(item.metrics.dscr || 0).toFixed(2).replace('.', ',')}
                        </span>
                    </div>
                </div>
            </div>

            <div class="portfolio-fiche__actions-row">
                <button class="btn btn--ghost btn--sm" data-action="portfolio-load" data-asset-id="${escapeHtml(item.id)}">
                    Charger dans le simulateur
                </button>
                <button class="portfolio-fiche__toggle btn btn--ghost btn--sm" data-target="travaux-${escapeHtml(item.id)}">
                    Travaux${travauxCount > 0 ? ` (${travauxCount}${hasUnclassified ? ' ⚠' : ''})` : ''}
                </button>
                <button class="portfolio-fiche__toggle btn btn--ghost btn--sm" data-target="notes-${escapeHtml(item.id)}">
                    Notes${notesCount > 0 ? ` (${notesCount})` : ''}
                </button>
            </div>

            <div id="travaux-${escapeHtml(item.id)}" class="portfolio-fiche__section portfolio-fiche__section--travaux" hidden>
                <!-- Rempli par buildFicheTravaux (tâche 8) -->
            </div>

            <div id="notes-${escapeHtml(item.id)}" class="portfolio-fiche__section portfolio-fiche__section--notes" hidden>
                <!-- Rempli par buildFicheNotes (tâche 9) -->
            </div>
        </article>`;
    }).join('');

    // Rendre les donuts après injection dans le DOM
    portfolioItems.forEach(item => {
        const credit  = item.model.mensualiteTotale || 0;
        const charges = (item.model.chargesExploitationAnnuelles || 0) / 12;
        const impots  = (item.model.impotsAnnee || 0) / 12;
        const cf      = item.metrics.cfNetNet || 0;
        renderDonutChart(`donut-${item.id}`, credit, charges, impots, cf);
    });

    // Boutons toggle sections
    nodes.portfolioFiches.querySelectorAll('.portfolio-fiche__toggle').forEach(btn => {
        btn.addEventListener('click', () => {
            const target = document.getElementById(btn.dataset.target);
            if (target) target.hidden = !target.hidden;
        });
    });

    // Boutons charger dans simulateur
    nodes.portfolioFiches.querySelectorAll('[data-action="portfolio-load"]').forEach(btn => {
        btn.addEventListener('click', () => {
            loadAsset(btn.dataset.assetId);
            document.querySelector('[data-target="workspace-panel"]')?.click();
        });
    });
}
```

- [ ] **7.2 — Appeler `buildPortfolioFiches` depuis la fonction principale de rendu**

Après l'appel à `buildPortfolioAdviceZone` :

```js
buildPortfolioFiches(collectionsView, advice, loadAssetMeta());
```

- [ ] **7.3 — Ajouter les styles dans `styles.css`**

```css
.portfolio-fiches-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
    gap: 20px;
}

.portfolio-fiche {
    border: 1px solid var(--border-subtle);
    border-radius: 12px;
    background: var(--surface-low);
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.portfolio-fiche__header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
}

.portfolio-fiche__identity { display: flex; flex-direction: column; gap: 4px; }
.portfolio-fiche__name { font-weight: 700; font-size: 0.95rem; color: var(--text-primary); }
.portfolio-fiche__meta { font-size: 0.78rem; color: var(--text-secondary); }
.portfolio-fiche__regime {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.72rem;
    background: var(--surface-mid);
    padding: 1px 5px;
    border-radius: 4px;
}

.portfolio-fiche__verdict {
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 3px 9px;
    border-radius: 20px;
    white-space: nowrap;
    flex-shrink: 0;
}
.portfolio-fiche__verdict--green  { background: color-mix(in srgb, #3FB950 15%, transparent); color: #3FB950; }
.portfolio-fiche__verdict--orange { background: color-mix(in srgb, #ff9500 15%, transparent); color: #ff9500; }
.portfolio-fiche__verdict--red    { background: color-mix(in srgb, #F85149 15%, transparent); color: #F85149; }

.portfolio-fiche__body {
    display: flex;
    gap: 20px;
    align-items: flex-start;
}

.portfolio-fiche__donut-wrap canvas {
    width: 160px !important;
    height: 160px !important;
}

.portfolio-fiche__kpis {
    display: flex;
    flex-direction: column;
    gap: 12px;
    flex: 1;
    justify-content: center;
}

.portfolio-fiche__kpi { display: flex; flex-direction: column; gap: 2px; }
.portfolio-fiche__kpi-label { font-size: 0.72rem; color: var(--text-secondary); font-weight: 500; }
.portfolio-fiche__kpi-value { font-family: 'IBM Plex Mono', monospace; font-size: 1rem; font-weight: 700; color: var(--text-primary); }

.portfolio-fiche__actions-row {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
}

.portfolio-fiche__section {
    padding-top: 16px;
    border-top: 1px solid var(--border-subtle);
}

.text--positive { color: #3FB950; }
.text--negative { color: #F85149; }
.text--watch    { color: #ff9500; }
```

- [ ] **7.4 — Vérifier visuellement**

Lancer `python app.py`. Avec des biens détenus, vérifier : fiches affichées en grille, donuts rendus, KPIs corrects, boutons toggle fonctionnent.

- [ ] **7.5 — Commit**

```bash
git add main.js styles.css
git commit -m "feat(portfolio): zone 3 fiches biens avec donuts individuels et KPIs"
```

---

## Tâche 8 : Zone 3 — Section Travaux (CRUD)

**Fichiers :**
- Modifier : `main.js`
- Modifier : `styles.css`

### Étapes

- [ ] **8.1 — Créer `buildFicheTravaux()` dans `main.js`**

```js
function buildFicheTravaux(assetId, meta) {
    const container = document.getElementById(`travaux-${assetId}`);
    if (!container) return;

    const currentYear = new Date().getFullYear();
    const travaux = meta.travaux || [];
    const totalDeductible = travaux
        .filter(t => t.tag === 'deductible' && t.date && new Date(t.date).getFullYear() === currentYear)
        .reduce((s, t) => s + t.montant, 0);
    const totalNonDed = travaux
        .filter(t => t.tag === 'non-deductible' && t.date && new Date(t.date).getFullYear() === currentYear)
        .reduce((s, t) => s + t.montant, 0);

    const TAG_LABELS = {
        'deductible': 'Déductible réel',
        'non-deductible': 'Non déductible',
        'a-classifier': 'À classifier'
    };
    const TAG_CSS = {
        'deductible': 'tag--green',
        'non-deductible': 'tag--grey',
        'a-classifier': 'tag--orange'
    };

    const sorted = [...travaux].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    container.innerHTML = `
        <div class="travaux-list">
            ${sorted.length ? sorted.map(t => `
                <div class="travaux-row" data-travail-id="${escapeHtml(t.id)}">
                    <span class="travaux-date">${escapeHtml(t.date || '—')}</span>
                    <span class="travaux-desc">${escapeHtml(t.description || '—')}</span>
                    <span class="travaux-montant">${Math.round(t.montant).toLocaleString('fr-FR')} €</span>
                    <span class="travaux-tag tag ${TAG_CSS[t.tag] || 'tag--grey'}">${escapeHtml(TAG_LABELS[t.tag] || t.tag)}</span>
                    <button class="travaux-delete btn btn--icon" data-delete-travail="${escapeHtml(t.id)}" title="Supprimer" aria-label="Supprimer ce travail">✕</button>
                </div>`).join('') : '<p class="travaux-empty">Aucun travail enregistré.</p>'}
        </div>

        ${travaux.length ? `
        <div class="travaux-totals">
            <span>Déductible ${currentYear} : <strong>${Math.round(totalDeductible).toLocaleString('fr-FR')} €</strong></span>
            <span>Non déductible : <strong>${Math.round(totalNonDed).toLocaleString('fr-FR')} €</strong></span>
        </div>` : ''}

        <form class="travaux-form" data-asset-id="${escapeHtml(assetId)}" novalidate>
            <div class="travaux-form__row">
                <input type="date" name="date" class="variables-input travaux-form__date" required>
                <input type="text" name="description" class="variables-input travaux-form__desc" placeholder="Description (ex : chaudière)" required>
            </div>
            <div class="travaux-form__row">
                <input type="number" name="montant" class="variables-input travaux-form__montant" placeholder="Montant (€)" min="0" required>
                <select name="tag" class="variables-input travaux-form__tag">
                    <option value="a-classifier">À classifier</option>
                    <option value="deductible">Déductible réel</option>
                    <option value="non-deductible">Non déductible</option>
                </select>
                <button type="submit" class="btn btn--primary btn--sm">Ajouter</button>
            </div>
            <span class="travaux-form__error" hidden></span>
        </form>`;

    // Submit form
    container.querySelector('.travaux-form').addEventListener('submit', e => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const date = fd.get('date');
        const description = fd.get('description')?.trim();
        const montant = Number(fd.get('montant'));
        const tag = fd.get('tag');
        const errEl = container.querySelector('.travaux-form__error');

        if (!date || !description || !(montant > 0)) {
            errEl.textContent = 'Date, description et montant sont obligatoires.';
            errEl.hidden = false;
            return;
        }
        errEl.hidden = true;
        addTravail(assetId, { date, description, montant, tag });
        e.target.reset();
        render();
        // Réouvrir la section après re-render
        setTimeout(() => {
            const sec = document.getElementById(`travaux-${assetId}`);
            if (sec) sec.hidden = false;
        }, 0);
    });

    // Supprimer une entrée
    container.querySelectorAll('[data-delete-travail]').forEach(btn => {
        btn.addEventListener('click', () => {
            deleteTravail(assetId, btn.dataset.deleteTravail);
            render();
            setTimeout(() => {
                const sec = document.getElementById(`travaux-${assetId}`);
                if (sec) sec.hidden = false;
            }, 0);
        });
    });
}
```

- [ ] **8.2 — Appeler `buildFicheTravaux` depuis `buildPortfolioFiches`**

Dans `buildPortfolioFiches`, après le rendu des fiches et des donuts, ajouter :

```js
portfolioItems.forEach(item => {
    const meta = assetMetaAll[item.id] || { travaux: [], notes: [] };
    buildFicheTravaux(item.id, meta);
    buildFicheNotes(item.id, meta); // tâche 9
});
```

- [ ] **8.3 — Ajouter les styles dans `styles.css`**

```css
.travaux-list { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
.travaux-empty { font-size: 0.82rem; color: var(--text-tertiary); font-style: italic; margin: 0; }

.travaux-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.82rem;
    flex-wrap: wrap;
}
.travaux-date { color: var(--text-secondary); flex-shrink: 0; font-family: 'IBM Plex Mono', monospace; font-size: 0.78rem; }
.travaux-desc { flex: 1; min-width: 80px; color: var(--text-primary); }
.travaux-montant { font-family: 'IBM Plex Mono', monospace; font-weight: 600; color: var(--text-primary); white-space: nowrap; }
.travaux-delete { color: var(--text-tertiary); padding: 0 4px; font-size: 0.75rem; line-height: 1; }
.travaux-delete:hover { color: #F85149; }

.tag { font-size: 0.68rem; font-weight: 700; padding: 2px 7px; border-radius: 20px; white-space: nowrap; text-transform: uppercase; letter-spacing: 0.04em; }
.tag--green  { background: color-mix(in srgb, #3FB950 15%, transparent); color: #3FB950; }
.tag--orange { background: color-mix(in srgb, #ff9500 15%, transparent); color: #ff9500; }
.tag--grey   { background: var(--surface-mid); color: var(--text-tertiary); }

.travaux-totals {
    display: flex;
    gap: 16px;
    font-size: 0.8rem;
    color: var(--text-secondary);
    margin-bottom: 12px;
    flex-wrap: wrap;
}

.travaux-form { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
.travaux-form__row { display: flex; gap: 8px; flex-wrap: wrap; }
.travaux-form__date  { width: 140px; }
.travaux-form__desc  { flex: 1; min-width: 140px; }
.travaux-form__montant { width: 110px; }
.travaux-form__tag   { flex: 1; min-width: 140px; }
.travaux-form__error { font-size: 0.78rem; color: #F85149; }
```

- [ ] **8.4 — Vérifier visuellement**

Lancer `python app.py`. Sur une fiche bien, cliquer "Travaux". Ajouter un travail (date + description + montant + tag). Vérifier qu'il apparaît dans la liste après re-render. Vérifier que la suppression fonctionne. Vérifier que les totaux sont corrects.

- [ ] **8.5 — Commit**

```bash
git add main.js styles.css
git commit -m "feat(portfolio): section Travaux par bien avec CRUD et tags fiscaux"
```

---

## Tâche 9 : Zone 3 — Section Notes

**Fichiers :**
- Modifier : `main.js`
- Modifier : `styles.css`

### Étapes

- [ ] **9.1 — Créer `buildFicheNotes()` dans `main.js`**

```js
function buildFicheNotes(assetId, meta) {
    const container = document.getElementById(`notes-${assetId}`);
    if (!container) return;

    const notes = [...(meta.notes || [])].reverse(); // plus récent en haut

    container.innerHTML = `
        <div class="notes-list">
            ${notes.length ? notes.map(n => `
                <div class="notes-entry" data-note-id="${escapeHtml(n.id)}">
                    <p class="notes-text">${escapeHtml(n.text)}</p>
                    <span class="notes-date">${new Date(n.createdAt).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                </div>`).join('') : '<p class="notes-empty">Aucune note.</p>'}
        </div>
        <div class="notes-add">
            <textarea class="variables-input notes-textarea" placeholder="Ajouter une note…" rows="3" data-asset-id="${escapeHtml(assetId)}"></textarea>
            <button class="btn btn--primary btn--sm notes-submit" data-asset-id="${escapeHtml(assetId)}">Enregistrer</button>
        </div>`;

    container.querySelector('.notes-submit').addEventListener('click', () => {
        const textarea = container.querySelector('.notes-textarea');
        const text = textarea.value.trim();
        if (!text) return;
        addNote(assetId, text);
        textarea.value = '';
        render();
        setTimeout(() => {
            const sec = document.getElementById(`notes-${assetId}`);
            if (sec) sec.hidden = false;
        }, 0);
    });
}
```

- [ ] **9.2 — Ajouter les styles dans `styles.css`**

```css
.notes-list { display: flex; flex-direction: column; gap: 10px; margin-bottom: 12px; }
.notes-empty { font-size: 0.82rem; color: var(--text-tertiary); font-style: italic; margin: 0; }

.notes-entry {
    background: var(--surface-mid);
    border-radius: 6px;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.notes-text {
    font-size: 0.85rem;
    color: var(--text-primary);
    line-height: 1.5;
    margin: 0;
    white-space: pre-wrap;
}

.notes-date {
    font-size: 0.72rem;
    color: var(--text-tertiary);
    font-family: 'IBM Plex Mono', monospace;
}

.notes-add { display: flex; flex-direction: column; gap: 8px; }
.notes-textarea { resize: vertical; min-height: 64px; }
.notes-submit { align-self: flex-end; }
```

- [ ] **9.3 — Vérifier visuellement**

Ouvrir une fiche, cliquer "Notes", saisir une note, cliquer Enregistrer. Vérifier que la note apparaît avec date. Vérifier persistence après rechargement de page.

- [ ] **9.4 — Commit**

```bash
git add main.js styles.css
git commit -m "feat(portfolio): section Notes par bien (carnet horodaté)"
```

---

## Tâche 10 : Zone 4 — Pipeline comparatif

**Fichiers :**
- Modifier : `main.js`
- Modifier : `styles.css`

### Étapes

- [ ] **10.1 — Créer `buildPortfolioPipelineZone()` dans `main.js`**

```js
function buildPortfolioPipelineZone(collectionsView) {
    if (!nodes.portfolioPipelineZone) return;
    const items = collectionsView.comparisonItems || [];

    if (!items.length) {
        nodes.portfolioPipelineZone.hidden = true;
        return;
    }

    nodes.portfolioPipelineZone.hidden = false;

    const container = document.getElementById('portfolio-asset-grid-pipeline');
    if (!container) return;

    container.innerHTML = `
        <table class="pipeline-table">
            <thead>
                <tr>
                    <th>Nom</th>
                    <th>Ville</th>
                    <th>Prix net</th>
                    <th>Rdt brut</th>
                    <th>CF estimé</th>
                    <th>DSCR</th>
                    <th>Score</th>
                    <th></th>
                </tr>
            </thead>
            <tbody>
                ${items.map(item => {
                    const prixNet = (item.variablesData['prix'] || 0) - (item.variablesData['nego'] || 0);
                    const cf = item.metrics.cfNetNet || 0;
                    const cfTone = cf > 0 ? 'text--positive' : cf < 0 ? 'text--negative' : '';
                    const dscrTone = (item.metrics.dscr || 0) >= 1.1 ? 'text--positive' : (item.metrics.dscr || 0) >= 1 ? 'text--watch' : 'text--negative';
                    return `
                    <tr>
                        <td class="pipeline-name">${escapeHtml(item.name)}</td>
                        <td>${escapeHtml(item.city)}</td>
                        <td class="pipeline-number">${Math.round(prixNet).toLocaleString('fr-FR')} €</td>
                        <td class="pipeline-number">${(item.metrics.rentaBrute || 0).toFixed(1).replace('.', ',')} %</td>
                        <td class="pipeline-number ${cfTone}">${cf >= 0 ? '+' : ''}${Math.round(cf).toLocaleString('fr-FR')} €</td>
                        <td class="pipeline-number ${dscrTone}">${(item.metrics.dscr || 0).toFixed(2).replace('.', ',')}</td>
                        <td><span class="pipeline-score pipeline-score--${item.analysisModel.decision?.tone || 'neutral'}">${escapeHtml(item.analysisModel.decision?.label || '—')}</span></td>
                        <td><button class="btn btn--ghost btn--sm" data-action="portfolio-load" data-asset-id="${escapeHtml(item.id)}">Charger</button></td>
                    </tr>`;
                }).join('')}
            </tbody>
        </table>`;

    container.querySelectorAll('[data-action="portfolio-load"]').forEach(btn => {
        btn.addEventListener('click', () => {
            loadAsset(btn.dataset.assetId);
            document.querySelector('[data-target="workspace-panel"]')?.click();
        });
    });
}
```

- [ ] **10.2 — Appeler `buildPortfolioPipelineZone` depuis le rendu principal**

Après `buildPortfolioFiches` :

```js
buildPortfolioPipelineZone(collectionsView);
```

- [ ] **10.3 — Ajouter les styles dans `styles.css`**

```css
.pipeline-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.84rem;
}

.pipeline-table th {
    text-align: left;
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-secondary);
    padding: 6px 10px;
    border-bottom: 1px solid var(--border-subtle);
}

.pipeline-table td {
    padding: 10px 10px;
    border-bottom: 1px solid var(--border-subtle);
    vertical-align: middle;
}

.pipeline-table tr:last-child td { border-bottom: none; }

.pipeline-number {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.82rem;
    text-align: right;
}

.pipeline-name { font-weight: 600; color: var(--text-primary); }

.pipeline-score {
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 2px 8px;
    border-radius: 20px;
}

.pipeline-score--excellent, .pipeline-score--positive { background: color-mix(in srgb, #3FB950 15%, transparent); color: #3FB950; }
.pipeline-score--neutral { background: var(--surface-mid); color: var(--text-secondary); }
.pipeline-score--watch { background: color-mix(in srgb, #ff9500 15%, transparent); color: #ff9500; }
.pipeline-score--negative { background: color-mix(in srgb, #F85149 15%, transparent); color: #F85149; }
```

- [ ] **10.4 — Vérifier visuellement**

Avec des biens en statut "À étudier", ouvrir Portefeuille et vérifier le tableau comparatif. Tester "Charger".

- [ ] **10.5 — Commit**

```bash
git add main.js styles.css
git commit -m "feat(portfolio): zone 4 pipeline comparatif biens à l'étude"
```

---

## Tâche 11 : Endpoint Flask `/api/portfolio-diagnostic`

**Fichiers :**
- Modifier : `server.py`
- Modifier : `tests/test_server_api.py`

### Étapes

- [ ] **11.1 — Ajouter l'import Anthropic dans `server.py`**

En haut de `server.py`, s'assurer que l'import Anthropic est présent. S'il n'est pas déjà importé au niveau de `server.py` (il l'est peut-être via scraper), ajouter :

```python
import anthropic
```

Vérifier que `scraper/config.py` expose une variable `ANTHROPIC_API_KEY`. Si elle s'appelle autrement, adapter l'import.

- [ ] **11.2 — Ajouter l'endpoint dans `server.py`**

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

    prompt_user = f"""Voici les données du portefeuille immobilier de l'investisseur :

{json.dumps(payload, ensure_ascii=False, indent=2)}

Produis entre 3 et 5 recommandations priorisées, actionnables, en français naturel. Chaque recommandation doit avoir : un titre court, une explication de 2 à 4 phrases qui justifie le conseil avec des chiffres précis issus des données, et une action concrète à mener. Priorise les sujets fiscaux, les risques de cash-flow, et les opportunités d'optimisation. Réponds uniquement avec du JSON valide, sans texte avant ou après, au format : {{"recommendations": [{{"title": "...", "explanation": "...", "action": "..."}}]}}"""

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
    except anthropic.APIError as e:
        return jsonify({'error': f'Erreur API Anthropic : {str(e)}'}), 502
    except Exception as e:
        return jsonify({'error': str(e)}), 500
```

S'assurer que `import json` est présent en haut du fichier.

- [ ] **11.3 — Écrire le test dans `tests/test_server_api.py`**

```python
import json
import pytest
from unittest.mock import patch, MagicMock


def test_portfolio_diagnostic_no_api_key(client):
    """Sans config.py, retourne 503."""
    with patch.dict('sys.modules', {'scraper.config': None}):
        resp = client.post('/api/portfolio-diagnostic',
                           data=json.dumps({'biens': []}),
                           content_type='application/json')
    assert resp.status_code == 503


def test_portfolio_diagnostic_empty_payload(client):
    """Payload manquant retourne 400."""
    with patch('scraper.config.ANTHROPIC_API_KEY', 'test-key', create=True):
        resp = client.post('/api/portfolio-diagnostic',
                           data='',
                           content_type='application/json')
    assert resp.status_code == 400


def test_portfolio_diagnostic_success(client):
    """Appel réussi retourne les recommandations."""
    fake_response = MagicMock()
    fake_response.content = [MagicMock(text='{"recommendations": [{"title": "Test", "explanation": "Explication.", "action": "Action."}]}')]

    with patch('server.anthropic') as mock_anthropic, \
         patch('server.api_portfolio_diagnostic.__globals__', {}):
        pass  # structure du mock selon comment anthropic est importé dans server.py

    # Test d'intégration simplifié : vérifier le format de sortie avec mock complet
    mock_client = MagicMock()
    mock_client.messages.create.return_value = fake_response

    with patch('anthropic.Anthropic', return_value=mock_client), \
         patch.dict('sys.modules', {}):
        import importlib
        try:
            import scraper.config as cfg
            original_key = getattr(cfg, 'ANTHROPIC_API_KEY', None)
            cfg.ANTHROPIC_API_KEY = 'test-key'
            resp = client.post('/api/portfolio-diagnostic',
                               data=json.dumps({'biens': [], 'profile': {'income': 50000, 'tmi': 30}}),
                               content_type='application/json')
            assert resp.status_code == 200
            data = resp.get_json()
            assert 'recommendations' in data
            assert isinstance(data['recommendations'], list)
        finally:
            if original_key is not None:
                cfg.ANTHROPIC_API_KEY = original_key
```

- [ ] **11.4 — Lancer les tests**

```bash
cd c:\Users\Dylan\Desktop\Creation_site\Investissement_web
python -m pytest tests/test_server_api.py -v
```

Expected : les tests existants passent, les nouveaux tests `test_portfolio_diagnostic_*` passent ou échouent proprement (le test d'intégration peut nécessiter un ajustement selon la structure réelle d'import dans `server.py`).

- [ ] **11.5 — Commit**

```bash
git add server.py tests/test_server_api.py
git commit -m "feat(portfolio): endpoint Flask /api/portfolio-diagnostic + tests"
```

---

## Tâche 12 : Zone 5 — Bouton diagnostic IA + drawer

**Fichiers :**
- Modifier : `main.js`
- Modifier : `index.html` (bouton dans l'en-tête du panel)
- Modifier : `styles.css`

### Étapes

- [ ] **12.1 — Ajouter le bouton "Diagnostic IA" dans `index.html`**

Dans `collection-panel`, dans le bloc `.panel-head` (chercher `<p class="brand-kicker">Multi-biens</p>`), ajouter le bouton après la description :

```html
<div class="portfolio-ai-trigger-row">
    <button id="portfolio-ai-trigger" class="btn btn--ghost portfolio-ai-trigger" type="button" disabled>
        ✦ Diagnostic IA
    </button>
    <span id="portfolio-ai-last-date" class="portfolio-ai-last-date"></span>
</div>
```

- [ ] **12.2 — Ajouter les nœuds dans `nodes` (main.js)**

```js
portfolioAiTrigger: document.getElementById('portfolio-ai-trigger'),
portfolioAiLastDate: document.getElementById('portfolio-ai-last-date'),
```

- [ ] **12.3 — Créer `initPortfolioAiDiagnostic()` dans `main.js`**

```js
function initPortfolioAiDiagnostic() {
    if (!nodes.portfolioAiTrigger) return;

    // Afficher dernier diagnostic si disponible
    function refreshLastDiagnosticLabel() {
        if (!nodes.portfolioAiLastDate) return;
        const meta = loadAssetMeta();
        const lastDiag = Object.values(meta).map(m => m.lastDiagnostic).filter(Boolean).sort((a, b) => b.date?.localeCompare(a.date || '')).shift();
        if (lastDiag?.date) {
            const d = new Date(lastDiag.date);
            nodes.portfolioAiLastDate.textContent = `Dernier : ${d.toLocaleDateString('fr-FR')}`;
            nodes.portfolioAiLastDate.hidden = false;
        } else {
            nodes.portfolioAiLastDate.hidden = true;
        }
    }

    refreshLastDiagnosticLabel();

    nodes.portfolioAiTrigger.addEventListener('click', async () => {
        if (nodes.portfolioAiTrigger.disabled) return;

        // Construire le payload
        const collectionsView = computePortfolioViewModel(
            state.assetRecords,
            state.profileData,
            state.activeAssetId,
            state.variablesData
        );
        const { portfolioItems, dashboard, capacity } = collectionsView;

        if (!portfolioItems.length) {
            showToast('Aucun bien détenu à analyser.', 'info');
            return;
        }

        const assetMetaAll = loadAssetMeta();
        const currentYear = new Date().getFullYear();

        const payloadBiens = portfolioItems.map(item => {
            const meta = assetMetaAll[item.id] || { travaux: [], notes: [] };
            const anneeAchat = item.variablesData['annee-achat'];
            const entry = {
                nom: item.name,
                ville: item.city,
                statut: 'owned',
                regime: item.variablesData['regime'] || '',
                prix: item.variablesData['prix'] || 0,
                loyer: item.variablesData['loyer'] || 0,
                charges_mensuelles: (item.model.chargesExploitationAnnuelles || 0) / 12,
                cf_net_net: item.metrics.cfNetNet || 0,
                dscr: item.metrics.dscr || 0,
                rendement_brut: item.metrics.rentaBrute || 0,
                travaux: meta.travaux,
                notes: meta.notes.map(n => n.text)
            };
            if (anneeAchat) {
                entry.duree_detention_mois = (currentYear - anneeAchat) * 12;
                entry.interets_annuels = Math.round(item.model.interetsAnnee1 || 0);
            }
            return entry;
        });

        const payload = {
            profile: {
                income: state.profileData.income || 0,
                tmi: calculateTMI(state.profileData.income || 0, { adults: state.profileData.adults || 2, children: state.profileData.children || 0 }),
                adults: state.profileData.adults || 2,
                children: state.profileData.children || 0
            },
            biens: payloadBiens,
            dashboard: {
                total_cf: dashboard.totalCashflow || 0,
                taux_endettement: (dashboard.totalDebtMonthly / Math.max(1, (state.profileData.income || 1) / 12)) * 100,
                capacite_emprunt: capacity.acquisitionBudget || 0,
                dscr_moyen: dashboard.dscr || 0
            }
        };

        // UI loading
        nodes.portfolioAiTrigger.disabled = true;
        nodes.portfolioAiTrigger.textContent = '✦ Analyse en cours…';
        nodes.portfolioAiDrawerContent.innerHTML = '<div class="ai-drawer-loading">Analyse en cours…</div>';

        try {
            const resp = await fetch('/api/portfolio-diagnostic', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await resp.json();

            if (!resp.ok || data.error) {
                throw new Error(data.error || 'Erreur serveur');
            }

            const recs = data.recommendations || [];
            const now = new Date().toISOString();

            // Stocker le résultat
            const metaAll = loadAssetMeta();
            metaAll['__portfolio__'] = { lastDiagnostic: { date: now, recommendations: recs } };
            saveAssetMeta(metaAll);

            // Afficher le drawer
            nodes.portfolioAiDrawerContent.innerHTML = `
                <div class="ai-drawer-date">Analyse du ${new Date(now).toLocaleDateString('fr-FR')} à ${new Date(now).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</div>
                ${recs.map((r, i) => `
                    <div class="ai-rec">
                        <div class="ai-rec__num">${i + 1}</div>
                        <div class="ai-rec__body">
                            <div class="ai-rec__title">${escapeHtml(r.title || '')}</div>
                            <p class="ai-rec__text">${escapeHtml(r.explanation || '')}</p>
                            ${r.action ? `<div class="ai-rec__action">→ ${escapeHtml(r.action)}</div>` : ''}
                        </div>
                    </div>`).join('')}`;

            nodes.portfolioAiDrawer.hidden = false;
            nodes.portfolioAiOverlay.hidden = false;
            refreshLastDiagnosticLabel();

        } catch (err) {
            showToast(`Diagnostic non généré : ${err.message}`, 'error', 6000);
        } finally {
            nodes.portfolioAiTrigger.disabled = false;
            nodes.portfolioAiTrigger.textContent = '✦ Diagnostic IA';
        }
    });

    // Fermeture drawer
    document.getElementById('portfolio-ai-drawer-close')?.addEventListener('click', () => {
        nodes.portfolioAiDrawer.hidden = true;
        nodes.portfolioAiOverlay.hidden = true;
    });
    nodes.portfolioAiOverlay?.addEventListener('click', () => {
        nodes.portfolioAiDrawer.hidden = true;
        nodes.portfolioAiOverlay.hidden = true;
    });
}
```

- [ ] **12.4 — Activer le bouton quand des biens sont détenus**

Dans la fonction principale de rendu portefeuille, après que `portfolioItems` est calculé :

```js
if (nodes.portfolioAiTrigger) {
    nodes.portfolioAiTrigger.disabled = collectionsView.portfolioItems.length === 0;
}
```

- [ ] **12.5 — Appeler `initPortfolioAiDiagnostic()` une seule fois à l'initialisation**

Dans la fonction d'initialisation principale de l'app (chercher le bloc qui appelle `initScanner`, `setupCrossWindowSync`, etc.), ajouter :

```js
initPortfolioAiDiagnostic();
```

- [ ] **12.6 — Ajouter les styles dans `styles.css`**

```css
.portfolio-ai-trigger-row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 12px;
}

.portfolio-ai-trigger {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
}

.portfolio-ai-trigger:disabled { opacity: 0.45; cursor: not-allowed; }

.portfolio-ai-last-date {
    font-size: 0.75rem;
    color: var(--text-tertiary);
}

/* Drawer */
.portfolio-ai-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    z-index: 200;
}

.portfolio-ai-drawer {
    position: fixed;
    top: 0;
    right: 0;
    width: min(480px, 100vw);
    height: 100vh;
    background: var(--surface-base);
    border-left: 1px solid var(--border-subtle);
    z-index: 201;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}

.portfolio-ai-drawer__header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 20px 24px;
    border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
}

.portfolio-ai-drawer__title {
    font-weight: 700;
    font-size: 1rem;
}

.portfolio-ai-drawer__close {
    font-size: 1rem;
    color: var(--text-secondary);
    padding: 4px 8px;
}

.portfolio-ai-drawer__close:hover { color: var(--text-primary); }

.portfolio-ai-drawer__content {
    flex: 1;
    overflow-y: auto;
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 20px;
}

.ai-drawer-loading {
    color: var(--text-secondary);
    font-size: 0.9rem;
    font-style: italic;
}

.ai-drawer-date {
    font-size: 0.75rem;
    color: var(--text-tertiary);
    font-family: 'IBM Plex Mono', monospace;
    margin-bottom: 8px;
}

.ai-rec {
    display: flex;
    gap: 16px;
    align-items: flex-start;
}

.ai-rec__num {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--accent);
    color: #000;
    font-weight: 700;
    font-size: 0.8rem;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
}

.ai-rec__body { display: flex; flex-direction: column; gap: 6px; flex: 1; }

.ai-rec__title {
    font-weight: 700;
    font-size: 0.92rem;
    color: var(--text-primary);
    line-height: 1.3;
}

.ai-rec__text {
    font-size: 0.85rem;
    color: var(--text-secondary);
    line-height: 1.55;
    margin: 0;
}

.ai-rec__action {
    font-size: 0.82rem;
    color: var(--accent);
    font-weight: 600;
}
```

- [ ] **12.7 — Vérifier visuellement**

Lancer `python app.py`. Onglet Portefeuille avec des biens détenus. Cliquer "Diagnostic IA". Vérifier :
- Le bouton passe en "Analyse en cours…"
- Le drawer s'ouvre depuis la droite
- Les recommandations s'affichent
- La fermeture (bouton ✕ ou overlay) fonctionne
- La date du dernier diagnostic apparaît sous le bouton

- [ ] **12.8 — Commit**

```bash
git add main.js index.html styles.css
git commit -m "feat(portfolio): diagnostic IA à la demande (bouton + drawer)"
```

---

## Tâche 13 : Mise à jour CODEBASE_MAP.md

**Fichiers :**
- Modifier : `CODEBASE_MAP.md`

### Étapes

- [ ] **13.1 — Mettre à jour les entrées modifiées dans CODEBASE_MAP.md**

Mettre à jour les entrées `main.js`, `ui.js`, `styles.css`, `server.py`, `index.html` pour refléter les nouvelles fonctions ajoutées :

```
## main.js
- `computePortfolioAdvice(portfolioItems, profileData, capacity, assetMetaAll)` — moteur de règles conseils intelligents
- `buildPortfolioDashboardZone(collectionsView, advice)` — zone 1 : donut consolidé + alertes
- `buildPortfolioAdviceZone(advice, collectionsView)` — zone 2 : cards conseils
- `buildPortfolioFiches(collectionsView, advice, assetMetaAll)` — zone 3 : fiches biens + donuts individuels
- `buildFicheTravaux(assetId, meta)` — section travaux d'une fiche (CRUD)
- `buildFicheNotes(assetId, meta)` — section notes d'une fiche
- `buildPortfolioPipelineZone(collectionsView)` — zone 4 : pipeline comparatif
- `initPortfolioAiDiagnostic()` — zone 5 : bouton + drawer diagnostic IA
- `loadAssetMeta()` / `saveAssetMeta()` / `getAssetMeta()` / `setAssetMeta()` — CRUD localStorage assetMeta
- `addTravail(assetId, travail)` / `deleteTravail(assetId, travailId)` — CRUD travaux
- `addNote(assetId, text)` — ajout note

## ui.js
- `renderDonutChart(canvasId, credit, charges, impots, cf)` — crée/met à jour un donut Chart.js par ID canvas
- `destroyDonut(canvasId)` — libère l'instance Chart.js

## server.py
- `api_portfolio_diagnostic` POST `/api/portfolio-diagnostic` — appel Claude API, retourne 3-5 recommandations JSON
```

- [ ] **13.2 — Commit final**

```bash
git add CODEBASE_MAP.md
git commit -m "docs: mise à jour CODEBASE_MAP après refonte portefeuille"
```

---

## Auto-review

**Couverture spec :**
- ✅ Tâche 1 — champ `annee-achat` + helpers localStorage
- ✅ Tâche 2 — suppression projection patrimoniale + tables obsolètes
- ✅ Tâches 3-7 — zones 1-4 restructurées
- ✅ Tâche 4 — moteur de règles (toutes les règles de la spec implémentées)
- ✅ Tâche 5 — donut consolidé + donut par bien
- ✅ Tâches 8-9 — Travaux CRUD avec tags fiscaux + Notes horodatées
- ✅ Tâches 11-12 — endpoint Flask + drawer IA
- ✅ Comportements limites couverts (0 bien, bien sans crédit, clé API absente)

**Points d'attention à l'exécution :**
- Tâche 2 : chercher TOUTES les occurrences des fonctions supprimées dans le rendu principal avant de les retirer
- Tâche 7 : `buildFicheNotes` est appelé depuis `buildPortfolioFiches` mais défini en tâche 9 — s'assurer que les deux tâches sont complètes avant de tester
- Tâche 11 : le mock du test dépend de comment `anthropic` est importé dans `server.py` — adapter si nécessaire
- `loadAsset(id)` est une fonction existante dans main.js — vérifier son nom exact avant de l'appeler dans les boutons
