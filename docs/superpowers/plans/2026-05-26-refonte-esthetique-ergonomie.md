# Refonte esthétique & ergonomie — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter un dual-mode (Complet / Guidé wizard) au panneau de saisie et un bloc Cash-flow live avec waterfall dans le panneau d'analyse.

**Architecture:** Vanilla JS ES modules, pas de build step. Toutes les modifications sont dans `index.html`, `styles.css`, `main.js`. `calculs.js` n'est pas touché — les données CF sont déjà dans `monthlyBreakdown` retourné par `computeAnalysisViewModel`. Le mode actif est persisté dans `localStorage` (clé `investissementWebSparkMode`).

**Tech Stack:** HTML5, CSS custom properties, vanilla JS ES modules, `localStorage`, `BroadcastChannel`

---

## Contexte critique pour l'agent

- Le formulaire utilise `nodes.variablesForm.elements.namedItem(key)` pour lire chaque champ. Les inputs du wizard **doivent** avoir les mêmes attributs `name` que ceux du formulaire complet pour que `updateVariablesFromForm()` les lise correctement.
- `computeAnalysisViewModel` retourne `monthlyBreakdown` — un tableau de 5 éléments (Loyers, Crédit, Charges, Impôts, CF net-net). C'est la source du waterfall.
- Le mode Guidé existant (`tuto-bar`) **reste intact** — on ajoute un deuxième mécanisme de mode complet/guidé **indépendant**. Le bouton `#guided-toggle` (Tuto) reste dans la topbar, à côté du nouveau `#mode-toggle`.
- `IS_ANALYSIS_WINDOW` : dans la popup analyse (`?panel=analysis`), le `#mode-toggle` est masqué. Le waterfall CF s'affiche dans les deux fenêtres.
- Les fonctions de build existantes (`buildAnalysisAcquisitionDecision`, etc.) ne sont **pas modifiées** — on ajoute uniquement `renderCFWaterfall()` et `renderModeSwitch()`.

---

## Task 1 — CSS : tokens RGB + classes du dual-mode

**Files:**
- Modify: `styles.css` (début du fichier, thèmes + nouvelles sections)

- [ ] **Step 1 : Ajouter les variables RGB manquantes dans les deux thèmes**

Dans `styles.css`, dans `html[data-theme='light']` (après `--danger: #CF222E;`), ajouter :
```css
    --success-rgb: 45, 164, 78;
    --danger-rgb: 207, 34, 46;
    --watch-rgb: 154, 103, 0;
```
Dans `html[data-theme='dark']` (après `--danger: #F85149;`), ajouter :
```css
    --success-rgb: 63, 185, 80;
    --danger-rgb: 248, 81, 73;
    --watch-rgb: 227, 179, 65;
```

- [ ] **Step 2 : Ajouter le composant `.mode-toggle`**

À la fin de `styles.css` (avant tout commentaire de fin de fichier), ajouter :
```css
/* ── Dual-mode toggle ── */
.mode-toggle {
    display: flex;
    background: var(--surface-strong);
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
    flex-shrink: 0;
}
.mode-toggle__btn {
    font-size: 11px;
    font-weight: 600;
    padding: 4px 12px;
    border: none;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    transition: background .15s, color .15s;
    white-space: nowrap;
}
.mode-toggle__btn[aria-pressed="true"] {
    background: var(--accent-gold);
    color: #0D1117;
}
```

- [ ] **Step 3 : Ajouter les classes de zones (Mode Complet)**

```css
/* ── Form zones (Mode Complet) ── */
.form-zone {
    margin-bottom: 10px;
    border-radius: 8px;
    overflow: hidden;
    border: 1px solid var(--border);
}
.form-zone__head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 9px 12px;
    background: var(--surface-strong);
    cursor: pointer;
    user-select: none;
}
.form-zone__badge {
    font-size: 8px;
    font-weight: 700;
    letter-spacing: .4px;
    padding: 2px 6px;
    border-radius: 3px;
    flex-shrink: 0;
}
.form-zone__badge--essentiel {
    background: var(--accent-gold-dim);
    color: var(--accent-gold);
    border: 1px solid var(--accent-gold-border);
}
.form-zone__badge--important {
    background: var(--primary-soft);
    color: var(--primary);
}
.form-zone__badge--avance {
    background: var(--surface-strong);
    color: var(--muted);
    border: 1px solid var(--border);
}
.form-zone__name {
    font-size: 11px;
    font-weight: 600;
    flex: 1;
}
.form-zone__chevron {
    margin-left: auto;
    font-size: 10px;
    color: var(--muted);
    transition: transform .2s;
    flex-shrink: 0;
}
.form-zone[data-open="true"] .form-zone__chevron {
    transform: rotate(90deg);
}
.form-zone__body {
    padding: 0;
}
.form-zone__body[hidden] {
    display: none;
}
```

- [ ] **Step 4 : Ajouter les classes du Mode Guidé (wizard)**

```css
/* ── Mode Guidé (wizard) ── */
.guided-body {
    display: flex;
    flex-direction: column;
    flex: 1;
    overflow: hidden;
}
.guided-steps-bar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 10px 14px 8px;
    background: var(--surface-strong);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
}
.guided-step-pip {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 9px;
    font-weight: 700;
    border: 1.5px solid var(--border);
    color: var(--muted);
    flex-shrink: 0;
    transition: background .2s, border-color .2s, color .2s;
}
.guided-step-pip--done {
    background: rgba(var(--success-rgb), .15);
    border-color: var(--success);
    color: var(--success);
}
.guided-step-pip--active {
    background: var(--accent-gold);
    border-color: var(--accent-gold);
    color: #0D1117;
}
.guided-step-line {
    flex: 1;
    height: 1px;
    background: var(--border);
    transition: background .3s;
}
.guided-step-line--done {
    background: var(--success);
    opacity: .4;
}
.guided-progress {
    height: 2px;
    background: var(--border);
    margin: 0 14px 0;
    border-radius: 1px;
    overflow: hidden;
    flex-shrink: 0;
}
.guided-progress__fill {
    height: 100%;
    background: var(--accent-gold);
    border-radius: 1px;
    transition: width .3s;
}
.guided-step-content {
    flex: 1;
    overflow-y: auto;
    padding: 16px 14px;
}
.guided-step-content::-webkit-scrollbar { width: 4px; }
.guided-step-content::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
.guided-step-num {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: .5px;
    color: var(--accent-gold);
    margin-bottom: 3px;
}
.guided-step-title {
    font-family: var(--font-heading);
    font-size: 15px;
    font-weight: 700;
    margin-bottom: 4px;
}
.guided-step-desc {
    font-size: 11px;
    color: var(--muted);
    margin-bottom: 16px;
    line-height: 1.5;
}
.guided-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 12px;
}
.guided-field label {
    font-size: 10px;
    font-weight: 600;
    color: var(--muted);
    letter-spacing: .3px;
}
.guided-field input,
.guided-field select,
.guided-field textarea {
    background: var(--surface-strong);
    border: 1.5px solid var(--border);
    border-radius: 6px;
    height: 36px;
    padding: 0 12px;
    font-size: 14px;
    color: var(--text);
    font-family: var(--font-body);
    transition: border-color .12s;
    width: 100%;
}
.guided-field textarea {
    height: auto;
    padding: 8px 12px;
    resize: vertical;
}
.guided-field input:focus,
.guided-field select:focus,
.guided-field textarea:focus {
    outline: none;
    border-color: var(--accent-gold);
    background: rgba(var(--success-rgb), 0);
}
.guided-field__hint {
    font-size: 9px;
    color: var(--muted);
    line-height: 1.4;
}
.guided-step-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    margin-top: 16px;
    padding-top: 12px;
    border-top: 1px solid var(--border);
}
.guided-btn-ghost {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--muted);
    border-radius: 6px;
    padding: 6px 14px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    font-family: var(--font-body);
}
.guided-btn-gold {
    background: var(--accent-gold);
    color: #0D1117;
    border: none;
    border-radius: 6px;
    padding: 6px 16px;
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
    font-family: var(--font-body);
}
```

- [ ] **Step 5 : Ajouter les classes du waterfall CF**

```css
/* ── CF Waterfall (panneau analyse) ── */
.cf-waterfall {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 14px 16px;
}
.cf-waterfall__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
}
.cf-waterfall__title {
    font-size: 11px;
    font-weight: 700;
}
.cf-waterfall__live {
    font-size: 8px;
    font-weight: 700;
    padding: 2px 7px;
    border-radius: 3px;
    background: rgba(59, 130, 246, .15);
    color: var(--primary);
    letter-spacing: .3px;
}
.cf-waterfall__kpis {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
    margin-bottom: 14px;
}
.cf-waterfall__kpi {
    background: var(--surface-strong);
    border-radius: 7px;
    padding: 8px 10px;
    text-align: center;
}
.cf-waterfall__kpi-val {
    display: block;
    font-size: 16px;
    font-weight: 700;
    margin-bottom: 2px;
}
.cf-waterfall__kpi-lbl {
    font-size: 8px;
    color: var(--muted);
    letter-spacing: .2px;
}
.cf-waterfall__bars {
    display: flex;
    flex-direction: column;
    gap: 5px;
}
.cf-waterfall__row {
    display: flex;
    align-items: center;
    gap: 8px;
}
.cf-waterfall__row--total {
    border-top: 1px solid var(--border);
    padding-top: 6px;
    margin-top: 2px;
}
.cf-waterfall__row-label {
    font-size: 9px;
    color: var(--muted);
    width: 100px;
    text-align: right;
    flex-shrink: 0;
}
.cf-waterfall__row--total .cf-waterfall__row-label {
    font-weight: 700;
    color: var(--text);
}
.cf-waterfall__bar {
    flex: 1;
    height: 6px;
    background: var(--surface-strong);
    border-radius: 3px;
    overflow: hidden;
}
.cf-waterfall__bar-fill {
    height: 100%;
    border-radius: 3px;
    min-width: 2px;
}
.cf-waterfall__bar-fill--income  { background: var(--success); opacity: .7; }
.cf-waterfall__bar-fill--expense { background: var(--danger);  opacity: .7; }
.cf-waterfall__bar-fill--positive { background: var(--success); }
.cf-waterfall__bar-fill--negative { background: var(--danger); }
.cf-waterfall__bar-fill--watch   { background: var(--watch); opacity: .7; }
.cf-waterfall__row-val {
    font-size: 9px;
    font-weight: 600;
    width: 48px;
    flex-shrink: 0;
    text-align: right;
}
```

- [ ] **Step 6 : Commit**

```bash
git add styles.css
git commit -m "style: add dual-mode, zones, guided wizard, CF waterfall CSS"
```

---

## Task 2 — HTML : Topbar toggle + conteneur guidé

**Files:**
- Modify: `index.html`

- [ ] **Step 1 : Remplacer le bouton `#guided-toggle` par le toggle segmenté**

Dans `index.html`, trouver :
```html
<button type="button" id="guided-toggle" class="topbar-btn topbar-btn--guided" aria-label="Mode tutoriel" aria-pressed="false">Tuto</button>
```
Remplacer par :
```html
<button type="button" id="guided-toggle" class="topbar-btn topbar-btn--guided" aria-label="Mode tutoriel" aria-pressed="false">Tuto</button>
<div class="mode-toggle" id="mode-toggle" role="group" aria-label="Mode de saisie">
    <button type="button" class="mode-toggle__btn" id="mode-btn-guided" data-mode="guided" aria-pressed="false">⚡ Guidé</button>
    <button type="button" class="mode-toggle__btn" id="mode-btn-full" data-mode="full" aria-pressed="true">☰ Complet</button>
</div>
```

- [ ] **Step 2 : Ajouter le conteneur du mode guidé dans le panneau de saisie**

Dans `index.html`, trouver `<form id="variables-form"` et ajouter juste **avant** cette ligne :
```html
<div id="guided-mode-body" class="guided-body" hidden>
    <div class="guided-steps-bar" id="guided-steps-bar">
        <!-- injecté par renderGuidedSteps() -->
    </div>
    <div class="guided-progress" id="guided-progress-outer">
        <div class="guided-progress__fill" id="guided-progress-fill" style="width:0%"></div>
    </div>
    <div class="guided-step-content" id="guided-step-content">
        <!-- injecté par renderGuidedStep() -->
    </div>
</div>
```

- [ ] **Step 3 : Ajouter le conteneur CF waterfall dans le panneau d'analyse**

Dans `index.html`, trouver :
```html
<div class="analysis-section-badge">② MÉTRIQUES CLÉS</div>
```
Ajouter juste **avant** cette ligne :
```html
<div id="analysis-cf-waterfall" class="cf-waterfall"></div>
```

- [ ] **Step 4 : Commit**

```bash
git add index.html
git commit -m "feat: add mode-toggle HTML, guided-mode-body, CF waterfall container"
```

---

## Task 3 — JS : Nodes + STORAGE_KEYS + renderCFWaterfall

**Files:**
- Modify: `main.js`

- [ ] **Step 1 : Ajouter la clé de storage pour le mode**

Dans `main.js`, dans `const STORAGE_KEYS = {`, après `guidedMode: 'investissementWebGuidedMode'`, ajouter :
```js
    sparkMode: 'investissementWebSparkMode'
```

- [ ] **Step 2 : Ajouter les nodes du mode toggle et du waterfall**

Dans `main.js`, dans `const nodes = {`, après `guidedToggle: document.getElementById('guided-toggle'),`, ajouter :
```js
    modeToggle: document.getElementById('mode-toggle'),
    modeBtnGuided: document.getElementById('mode-btn-guided'),
    modeBtnFull: document.getElementById('mode-btn-full'),
    guidedModeBody: document.getElementById('guided-mode-body'),
    guidedStepsBar: document.getElementById('guided-steps-bar'),
    guidedProgressFill: document.getElementById('guided-progress-fill'),
    guidedStepContent: document.getElementById('guided-step-content'),
    analysisCFWaterfall: document.getElementById('analysis-cf-waterfall'),
```

- [ ] **Step 3 : Écrire `renderCFWaterfall(analysisModel)`**

Ajouter cette fonction dans `main.js`, juste après `renderFormKpiBar` (ligne ~1531) :

```js
function renderCFWaterfall(analysisModel) {
    if (!nodes.analysisCFWaterfall) return;
    const { monthlyBreakdown, metrics } = analysisModel;

    const loyerRow  = monthlyBreakdown.find(r => r.label === 'Loyers encaissés');
    const creditRow = monthlyBreakdown.find(r => r.label === 'Crédit + assurance');
    const chargesRow = monthlyBreakdown.find(r => r.label === "Charges d'exploitation");
    const impotsRow = monthlyBreakdown.find(r => r.label === 'Impôts');
    const cfRow     = monthlyBreakdown.find(r => r.label === 'Cash-flow net-net');

    const loyerBrut = loyerRow ? loyerRow.value : 1;
    const cfVal = cfRow ? cfRow.signedValue : 0;
    const cfColor = cfVal >= 0 ? 'var(--success)' : 'var(--danger)';

    function barPct(val) {
        return Math.min(100, Math.max(2, (Math.abs(val) / loyerBrut) * 100)).toFixed(1);
    }

    function fmtEur(v) {
        const sign = v >= 0 ? '+' : '−';
        return `${sign}${Math.abs(Math.round(v)).toLocaleString('fr-FR')} €`;
    }

    const rows = [
        { label: loyerRow?.label || 'Loyers', val: loyerRow?.signedValue || 0, kind: 'income' },
        { label: creditRow?.label || 'Crédit', val: creditRow?.signedValue || 0, kind: 'expense' },
        { label: chargesRow?.label || 'Charges', val: chargesRow?.signedValue || 0, kind: 'watch' },
        { label: impotsRow?.label || 'Impôts', val: impotsRow?.signedValue || 0, kind: impotsRow?.kind || 'expense' },
    ];

    const rdtBrut = metrics.rentaBrute != null ? metrics.rentaBrute.toFixed(1) + ' %' : '—';
    const rdtNette = metrics.rentaNette != null ? metrics.rentaNette.toFixed(1) + ' %' : '—';
    const dscrVal = metrics.dscr != null ? metrics.dscr.toFixed(2) : '—';
    const cfColor3 = cfVal >= 0 ? 'var(--success)' : 'var(--danger)';

    nodes.analysisCFWaterfall.innerHTML = `
        <div class="cf-waterfall__head">
            <span class="cf-waterfall__title">Cash-flow — calcul en direct</span>
            <span class="cf-waterfall__live">● LIVE</span>
        </div>
        <div class="cf-waterfall__kpis">
            <div class="cf-waterfall__kpi">
                <span class="cf-waterfall__kpi-val" style="color:var(--accent-gold)">${escapeHtml(rdtBrut)}</span>
                <span class="cf-waterfall__kpi-lbl">Rendement brut</span>
            </div>
            <div class="cf-waterfall__kpi">
                <span class="cf-waterfall__kpi-val" style="color:${cfColor3}">${escapeHtml(fmtEur(cfVal))}</span>
                <span class="cf-waterfall__kpi-lbl">CF net/mois</span>
            </div>
            <div class="cf-waterfall__kpi">
                <span class="cf-waterfall__kpi-val">${escapeHtml(dscrVal)}</span>
                <span class="cf-waterfall__kpi-lbl">DSCR</span>
            </div>
        </div>
        <div class="cf-waterfall__bars">
            ${rows.map(r => `
            <div class="cf-waterfall__row">
                <span class="cf-waterfall__row-label">${escapeHtml(r.label)}</span>
                <div class="cf-waterfall__bar"><div class="cf-waterfall__bar-fill cf-waterfall__bar-fill--${escapeHtml(r.kind)}" style="width:${barPct(r.val)}%"></div></div>
                <span class="cf-waterfall__row-val" style="color:${r.val >= 0 ? 'var(--success)' : 'var(--danger)'}">${escapeHtml(fmtEur(r.val))}</span>
            </div>`).join('')}
            <div class="cf-waterfall__row cf-waterfall__row--total">
                <span class="cf-waterfall__row-label">Net net</span>
                <div class="cf-waterfall__bar"><div class="cf-waterfall__bar-fill cf-waterfall__bar-fill--${cfVal >= 0 ? 'positive' : 'negative'}" style="width:${barPct(cfVal)}%"></div></div>
                <span class="cf-waterfall__row-val" style="color:${cfColor};font-weight:700">${escapeHtml(fmtEur(cfVal))}</span>
            </div>
        </div>
    `;
}
```

- [ ] **Step 4 : Appeler `renderCFWaterfall` dans le cycle de rendu**

Dans `main.js`, dans `renderWorkspaceContent()`, après la ligne `buildAnalysisStickySummary(analysisModel);`, ajouter :
```js
    renderCFWaterfall(analysisModel);
```

- [ ] **Step 5 : Commit**

```bash
git add main.js
git commit -m "feat: add renderCFWaterfall, wire into render cycle"
```

---

## Task 4 — JS : Mode switch (Complet / Guidé)

**Files:**
- Modify: `main.js`

- [ ] **Step 1 : Écrire `loadSparkMode()` et `saveSparkMode()`**

Dans `main.js`, après `function loadVariablesData()` (~ligne 341), ajouter :

```js
function loadSparkMode() {
    const saved = localStorage.getItem(STORAGE_KEYS.sparkMode);
    return saved === 'guided' ? 'guided' : 'full';
}

function saveSparkMode(mode) {
    localStorage.setItem(STORAGE_KEYS.sparkMode, mode);
}
```

- [ ] **Step 2 : Écrire `renderModeSwitch(mode)`**

Ajouter après `saveSparkMode` :

```js
function renderModeSwitch(mode) {
    if (!nodes.modeBtnGuided || !nodes.modeBtnFull) return;
    const isGuided = mode === 'guided';

    nodes.modeBtnGuided.setAttribute('aria-pressed', String(isGuided));
    nodes.modeBtnFull.setAttribute('aria-pressed', String(!isGuided));

    if (nodes.variablesForm) nodes.variablesForm.hidden = isGuided;
    if (nodes.guidedModeBody) nodes.guidedModeBody.hidden = !isGuided;

    if (isGuided) {
        renderGuidedSteps(state.guidedStepIndex ?? 0);
        renderGuidedStep(state.guidedStepIndex ?? 0);
    }
}
```

- [ ] **Step 3 : Ajouter `guidedStepIndex` à l'état et le charger**

Dans `const state = {`, après `activeAssetId: loadActiveAssetId(),`, ajouter :
```js
    sparkMode: loadSparkMode(),
    guidedStepIndex: 0,
    analysisPopupBlocked: false
```
(Retirer `analysisPopupBlocked: false` de sa position actuelle pour éviter le doublon.)

- [ ] **Step 4 : Wirer l'event listener du mode toggle**

Dans `main.js`, repérer la section où sont branchés les listeners (chercher `nodes.themeToggle.addEventListener`). Ajouter après les listeners existants :

```js
if (nodes.modeToggle && !IS_ANALYSIS_WINDOW) {
    nodes.modeToggle.addEventListener('click', e => {
        const btn = e.target.closest('[data-mode]');
        if (!btn) return;
        const newMode = btn.dataset.mode;
        state.sparkMode = newMode;
        saveSparkMode(newMode);
        renderModeSwitch(newMode);
    });
}
```

- [ ] **Step 5 : Appeler `renderModeSwitch` dans `render()`**

Dans `main.js`, dans `function render(options = {})`, après `applyTheme();`, ajouter :
```js
    renderModeSwitch(state.sparkMode);
```

- [ ] **Step 6 : Commit**

```bash
git add main.js
git commit -m "feat: add sparkMode state, renderModeSwitch, wire mode-toggle listener"
```

---

## Task 5 — JS : Wizard (renderGuidedSteps + renderGuidedStep)

**Files:**
- Modify: `main.js`

Les données de chaque étape proviennent du tableau `TUTO_STEPS` déjà défini dans `main.js`. Il faut en extraire un sous-ensemble de 4 étapes pertinentes pour le wizard (elles sont légèrement différentes des 7 étapes du mode Tuto complet).

- [ ] **Step 1 : Définir `WIZARD_STEPS` (données des 4 étapes)**

Dans `main.js`, juste après la définition de `TUTO_STEPS` (~ligne 113), ajouter :

```js
const WIZARD_STEPS = [
    {
        num: 1,
        title: 'Identité du dossier',
        desc: 'Donnez un nom à votre étude et indiquez la ville du bien.',
        fields: [
            { id: 'nom-bien', label: 'Nom du dossier', type: 'text', hint: 'ex : Appart T2 Lyon 7e — un nom pour retrouver ce dossier.' },
            { id: 'ville', label: 'Ville du bien', type: 'text', hint: 'ex : Lyon' }
        ]
    },
    {
        num: 2,
        title: 'Prix & loyer',
        desc: 'Les deux chiffres qui définissent la rentabilité du bien.',
        fields: [
            { id: 'prix', label: 'Prix affiché par le vendeur (€)', type: 'number', hint: 'Prix demandé, avant négociation.' },
            { id: 'loyer', label: 'Loyer cible mensuel (€)', type: 'number', hint: 'Loyer mensuel hors charges que vous estimez pouvoir obtenir.' },
            { id: 'nego', label: 'Négociation visée (%)', type: 'number', hint: 'Décote visée sur le prix. 0 si vous gardez le prix affiché.' },
            { id: 'travaux', label: 'Budget travaux (€)', type: 'number', hint: 'Travaux à intégrer au coût d\'acquisition. 0 si aucun.' }
        ]
    },
    {
        num: 3,
        title: 'Financement',
        desc: 'Les conditions de votre crédit définissent votre mensualité.',
        fields: [
            { id: 'apport', label: 'Apport personnel (€)', type: 'number', hint: 'Somme apportée sans emprunt.' },
            { id: 'taux-input', label: 'Taux d\'intérêt (%)', type: 'number', hint: 'Taux annuel du crédit, hors assurance.' },
            { id: 'duree', label: 'Durée du prêt (ans)', type: 'number', hint: 'ex : 20' },
            { id: 'notaire', label: 'Frais de notaire (%)', type: 'number', hint: 'Environ 7–8 % dans l\'ancien.' }
        ]
    },
    {
        num: 4,
        title: 'Exploitation & fiscalité',
        desc: 'Charges et régime fiscal pour un calcul précis.',
        fields: [
            { id: 'vacance', label: 'Vacance locative (%)', type: 'number', hint: '5 % = environ 18 jours sans locataire/an.' },
            { id: 'copro', label: 'Charges copro / mois (€)', type: 'number', hint: 'Part non récupérable sur le locataire.' },
            { id: 'fonciere', label: 'Taxe foncière / an (€)', type: 'number', hint: 'Demandez l\'avis de taxe au vendeur.' },
            { id: 'regime', label: 'Régime fiscal', type: 'select', hint: 'Micro-foncier, Foncier réel ou SCI IS.' }
        ]
    }
];
```

- [ ] **Step 2 : Écrire `renderGuidedSteps(currentIndex)`**

Ajouter dans `main.js`, après la fonction `renderModeSwitch` :

```js
function renderGuidedSteps(currentIndex) {
    if (!nodes.guidedStepsBar || !nodes.guidedProgressFill) return;

    const total = WIZARD_STEPS.length;
    let html = '';
    for (let i = 0; i < total; i++) {
        const state_ = i < currentIndex ? 'done' : (i === currentIndex ? 'active' : '');
        const label = i < currentIndex ? '✓' : String(i + 1);
        html += `<div class="guided-step-pip ${state_ ? 'guided-step-pip--' + state_ : ''}" aria-label="Étape ${i + 1}">${escapeHtml(label)}</div>`;
        if (i < total - 1) {
            html += `<div class="guided-step-line ${i < currentIndex ? 'guided-step-line--done' : ''}"></div>`;
        }
    }
    nodes.guidedStepsBar.innerHTML = html;
    nodes.guidedProgressFill.style.width = `${((currentIndex) / total) * 100}%`;
}
```

- [ ] **Step 3 : Écrire `renderGuidedStep(index)`**

Ajouter après `renderGuidedSteps` :

```js
function renderGuidedStep(index) {
    if (!nodes.guidedStepContent) return;

    const step = WIZARD_STEPS[index];
    if (!step) return;

    const total = WIZARD_STEPS.length;
    const isFirst = index === 0;
    const isLast = index === total - 1;

    const REGIME_OPTIONS = [
        { value: 'micro-foncier', label: 'Micro-foncier' },
        { value: 'reel', label: 'Foncier réel' },
        { value: 'sci-is', label: 'SCI à l\'IS' }
    ];

    const fieldsHtml = step.fields.map(f => {
        const currentVal = state.variablesData[f.id] ?? VARIABLE_DEFAULTS[f.id] ?? '';
        let inputHtml;
        if (f.type === 'select' && f.id === 'regime') {
            const opts = REGIME_OPTIONS.map(o =>
                `<option value="${escapeHtml(o.value)}" ${currentVal === o.value ? 'selected' : ''}>${escapeHtml(o.label)}</option>`
            ).join('');
            inputHtml = `<select id="guided-field-${escapeHtml(f.id)}" name="${escapeHtml(f.id)}" class="variables-input">${opts}</select>`;
        } else {
            inputHtml = `<input id="guided-field-${escapeHtml(f.id)}" name="${escapeHtml(f.id)}" type="${escapeHtml(f.type)}" class="variables-input" value="${escapeHtml(String(currentVal))}">`;
        }
        return `
        <div class="guided-field">
            <label for="guided-field-${escapeHtml(f.id)}">${escapeHtml(f.label)}</label>
            ${inputHtml}
            <span class="guided-field__hint">${escapeHtml(f.hint)}</span>
        </div>`;
    }).join('');

    nodes.guidedStepContent.innerHTML = `
        <div class="guided-step-num">ÉTAPE ${step.num} / ${total}</div>
        <h3 class="guided-step-title">${escapeHtml(step.title)}</h3>
        <p class="guided-step-desc">${escapeHtml(step.desc)}</p>
        ${fieldsHtml}
        <div class="guided-step-actions">
            ${!isFirst ? `<button type="button" class="guided-btn-ghost" id="guided-prev">← Retour</button>` : ''}
            <button type="button" class="guided-btn-gold" id="guided-next">${isLast ? 'Terminer ✓' : 'Suivant →'}</button>
        </div>
    `;

    // Wire step navigation
    const prevBtn = nodes.guidedStepContent.querySelector('#guided-prev');
    const nextBtn = nodes.guidedStepContent.querySelector('#guided-next');

    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            syncGuidedFieldsToForm();
            state.guidedStepIndex = Math.max(0, index - 1);
            renderGuidedSteps(state.guidedStepIndex);
            renderGuidedStep(state.guidedStepIndex);
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            syncGuidedFieldsToForm();
            if (isLast) {
                state.sparkMode = 'full';
                saveSparkMode('full');
                renderModeSwitch('full');
            } else {
                state.guidedStepIndex = Math.min(total - 1, index + 1);
                renderGuidedSteps(state.guidedStepIndex);
                renderGuidedStep(state.guidedStepIndex);
            }
        });
    }
}
```

- [ ] **Step 4 : Écrire `syncGuidedFieldsToForm()`**

Cette fonction copie les valeurs des inputs du wizard vers le formulaire principal pour que `updateVariablesFromForm()` les lise. Ajouter après `renderGuidedStep` :

```js
function syncGuidedFieldsToForm() {
    if (!nodes.variablesForm) return;
    const guidedInputs = nodes.guidedStepContent
        ? nodes.guidedStepContent.querySelectorAll('[name]')
        : [];
    guidedInputs.forEach(guidedInput => {
        const formField = nodes.variablesForm.elements.namedItem(guidedInput.name);
        if (formField) {
            formField.value = guidedInput.value;
            formField.dispatchEvent(new Event('input', { bubbles: true }));
        }
    });
}
```

- [ ] **Step 5 : Commit**

```bash
git add main.js
git commit -m "feat: add WIZARD_STEPS, renderGuidedSteps, renderGuidedStep, syncGuidedFieldsToForm"
```

---

## Task 6 — HTML : Zones visuelles dans le formulaire (Mode Complet)

**Files:**
- Modify: `index.html`

Le formulaire contient 9 `accord-section` avec `data-priority`. On les regroupe en 4 zones visuelles collapsibles en ajoutant des wrappers `div.form-zone` autour de chaque groupe dans `index.html`.

Groupes de zones :
| Zone | Priorité | Sections incluses |
|---|---|---|
| Essentiels | `essentiel` | Acquisition, Financement |
| Importants | `important` | Exploitation locative, Fiscalité |
| Avancé | `avance` | Vérifications avant offre, Fiabilité des hypothèses, Seuils de décision, Journal de décision |
| Optionnel | `optionnel` | Identité du dossier |

- [ ] **Step 1 : Trouver les limites de chaque groupe dans `index.html`**

Le formulaire `<form id="variables-form">` contient les sections dans cet ordre :
1. `accord-section[data-priority="optionnel"]` — Identité du dossier
2. `accord-section[data-priority="essentiel"]` — Acquisition
3. `accord-section[data-priority="essentiel"]` — Financement
4. `accord-section[data-priority="important"]` — Exploitation locative
5. `accord-section[data-priority="important"]` — Fiscalité
6. `accord-section[data-priority="avance"]` — Vérifications avant offre
7. `accord-section[data-priority="avance"]` — Fiabilité des hypothèses
8. `accord-section[data-priority="avance"]` — Seuils de décision
9. `accord-section[data-priority="avance"]` — Journal de décision

- [ ] **Step 2 : Entourer les sections `essentiel` d'un wrapper zone**

Dans `index.html`, ajouter avant la section Acquisition :
```html
<div class="form-zone" data-zone="essentiel" data-open="true">
  <div class="form-zone__head" role="button" tabindex="0" aria-expanded="true">
    <span class="form-zone__badge form-zone__badge--essentiel">ESSENTIEL</span>
    <span class="form-zone__name">Acquisition & financement</span>
    <span class="form-zone__chevron">▶</span>
  </div>
  <div class="form-zone__body">
```
Puis ajouter `</div></div>` après la fermeture de la section Financement (juste avant la section `data-priority="important"`).

- [ ] **Step 3 : Entourer les sections `important` d'un wrapper zone**

Ajouter avant la section Exploitation locative :
```html
<div class="form-zone" data-zone="important" data-open="false">
  <div class="form-zone__head" role="button" tabindex="0" aria-expanded="false">
    <span class="form-zone__badge form-zone__badge--important">IMPORTANT</span>
    <span class="form-zone__name">Exploitation & fiscalité</span>
    <span class="form-zone__chevron">▶</span>
  </div>
  <div class="form-zone__body" hidden>
```
Puis ajouter `</div></div>` après la fermeture de la section Fiscalité.

- [ ] **Step 4 : Entourer les sections `avance` d'un wrapper zone**

Ajouter avant la section Vérifications avant offre :
```html
<div class="form-zone" data-zone="avance" data-open="false">
  <div class="form-zone__head" role="button" tabindex="0" aria-expanded="false">
    <span class="form-zone__badge form-zone__badge--avance">AVANCÉ</span>
    <span class="form-zone__name">Vérifications, seuils & journal</span>
    <span class="form-zone__chevron">▶</span>
  </div>
  <div class="form-zone__body" hidden>
```
Puis ajouter `</div></div>` juste avant `</form>` (après la section Journal de décision).

- [ ] **Step 5 : Entourer la section `optionnel` d'un wrapper zone**

Ajouter avant la section Identité du dossier :
```html
<div class="form-zone" data-zone="optionnel" data-open="false">
  <div class="form-zone__head" role="button" tabindex="0" aria-expanded="false">
    <span class="form-zone__badge form-zone__badge--avance">OPTIONNEL</span>
    <span class="form-zone__name">Identité du dossier</span>
    <span class="form-zone__chevron">▶</span>
  </div>
  <div class="form-zone__body" hidden>
```
Puis ajouter `</div></div>` après la fermeture de cette section (juste avant la zone essentiel).

L'ordre final dans le formulaire sera : zone `essentiel` (ouverte) → zone `important` (fermée) → zone `avance` (fermée) → zone `optionnel` (fermée).

Pour réordonner, déplacer le bloc `<div class="form-zone" data-zone="optionnel">...</div>` **après** les 3 autres zones.

- [ ] **Step 6 : Wirer le toggle des zones dans `main.js`**

Ajouter dans `main.js`, dans la section des event listeners (là où les accordéons sont wirés), **une seule fois** lors du `DOMContentLoaded` ou dans la fonction d'init existante :

```js
document.addEventListener('click', e => {
    const zoneHead = e.target.closest('.form-zone__head');
    if (!zoneHead) return;
    const zone = zoneHead.closest('.form-zone');
    if (!zone) return;
    const isOpen = zone.dataset.open === 'true';
    zone.dataset.open = String(!isOpen);
    zoneHead.setAttribute('aria-expanded', String(!isOpen));
    const body = zone.querySelector('.form-zone__body');
    if (body) body.hidden = isOpen;
});
```

- [ ] **Step 7 : Commit**

```bash
git add index.html main.js
git commit -m "feat: add form zone wrappers (Essentiel/Important/Avancé/Optionnel) with toggle"
```

---

## Task 7 — Vérification manuelle en navigateur

**Files:** aucun

- [ ] **Step 1 : Lancer le serveur**

```bash
python -m http.server 8080
```
Ouvrir `http://localhost:8080` dans le navigateur.

- [ ] **Step 2 : Vérifier le toggle Complet / Guidé**

- Cliquer sur `⚡ Guidé` dans la topbar → le formulaire se masque, le wizard apparaît avec l'étape 1.
- Vérifier que les pastilles de progression s'affichent (4 étapes).
- Naviguer avec Suivant → les étapes 2, 3, 4 s'affichent correctement.
- À l'étape 4 : cliquer `Terminer ✓` → le mode revient en `☰ Complet`.
- Recharger la page → le mode actif est bien persisté.

- [ ] **Step 3 : Vérifier la synchronisation des valeurs**

- En mode Guidé, saisir un prix (ex : `200000`), cliquer Suivant.
- Revenir en mode Complet → le champ `prix` du formulaire principal doit refléter la valeur saisie.
- Le panneau d'analyse doit se mettre à jour avec les nouvelles valeurs.

- [ ] **Step 4 : Vérifier le waterfall CF**

- Dans le panneau d'analyse, vérifier que le bloc "Cash-flow — calcul en direct" s'affiche avec 3 KPIs (Rendement brut, CF net/mois, DSCR) et 5 lignes de waterfall.
- Modifier le loyer dans le formulaire → les valeurs du waterfall se mettent à jour.

- [ ] **Step 5 : Vérifier la fenêtre analyse secondaire**

- Activer le mode 2 écrans (bouton `Affichage : 2 écrans`).
- Dans la fenêtre analyse secondaire : le `#mode-toggle` n'est pas visible, le waterfall CF s'affiche.

- [ ] **Step 6 : Vérifier les deux thèmes**

- Basculer dark/light avec le bouton thème → le toggle segmenté et le waterfall sont correctement stylés dans les deux thèmes.

- [ ] **Step 7 : Commit de validation**

```bash
git add -A
git commit -m "feat: dual-mode complet/guidé + CF waterfall opérationnels"
```

---

## Résumé des fichiers modifiés

| Fichier | Tâche(s) |
|---|---|
| `styles.css` | Task 1 — variables RGB, `.mode-toggle`, `.form-zone`, `.guided-*`, `.cf-waterfall` |
| `index.html` | Task 2 — `#mode-toggle` dans topbar, `#guided-mode-body`, `#analysis-cf-waterfall` ; Task 6 — wrappers zones |
| `main.js` | Task 3, 4, 5, 6 — `renderCFWaterfall`, `renderModeSwitch`, `renderGuidedStep`, `renderGuidedSteps`, `syncGuidedFieldsToForm`, `WIZARD_STEPS`, `STORAGE_KEYS.sparkMode`, event delegation zones |
| `calculs.js` | Aucun |
| `pdf.js` | Aucun |
