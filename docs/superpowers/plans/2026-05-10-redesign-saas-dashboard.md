# Redesign SaaS Dashboard — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refonte visuelle complète vers un esthétique SaaS Dashboard (Vercel/Linear) avec micro-animations, cadran SVG animé, accordéon sur le formulaire et topbar compacte.

**Architecture:** Remplacement complet de `styles.css` (nouveaux tokens CSS), modifications structurelles dans `index.html` (topbar simplifié, accordéon sur fieldsets, onglets repositionnés), mise à jour des template literals dans `main.js` (score SVG, KPI cards avec barres), et ajout de helpers d'animation JS. `calculs.js` et `pdf.js` non touchés.

**Tech Stack:** Vanilla JS ES modules, CSS custom properties, SVG, `requestAnimationFrame` pour les compteurs

---

## Fichiers modifiés

| Fichier | Rôle des changements |
|---|---|
| `styles.css` | Nouveaux tokens CSS, composants redessinés (topbar, tabs, accordéon, KPI cards, gauge, boutons) |
| `index.html` | Topbar simplifié (52px), `<nav>` déplacée dans workspace, `<fieldset>` wrappés en accordéon |
| `main.js` | Template literal score → SVG gauge ; template literal KPI → cards avec barres ; helper `animateCounter()` ; helper `setGaugeValue()` ; accordéon JS |
| `ui.js` | `getThemeTextColor()` : corriger détection theme (`data-theme` au lieu de `classList`) |

---

## Task 1 : Nouveaux tokens CSS + base

**Files:**
- Modify: `styles.css` (lignes 1–48 — blocs `:root` et `html[data-theme]`)

- [ ] **Étape 1 : Remplacer les variables CSS**

Remplacer intégralement les blocs `:root`, `html[data-theme='light']` et `html[data-theme='dark']` par :

```css
:root {
    --font-heading: 'Cormorant Garamond', serif;
    --font-body: 'Manrope', sans-serif;
    --font-display: 'IBM Plex Mono', monospace;
    --radius-sm: 6px;
    --radius-md: 8px;
    --radius-lg: 12px;
    --radius-xl: 14px;
    --success: #4ade80;
    --danger: #f87171;
    --watch: #fbbf24;
}

html[data-theme='light'] {
    --bg: #f4f4f5;
    --surface: #ffffff;
    --surface-strong: #fafafa;
    --text: #09090b;
    --muted: #71717a;
    --muted-strong: #a1a1aa;
    --border: #e4e4e7;
    --border-subtle: #f4f4f5;
    --accent-gold: #b8860b;
    --accent-gold-dim: rgba(184,134,11,0.08);
    --accent-gold-border: rgba(184,134,11,0.25);
    --glow: rgba(184,134,11,0.12);
    --success: #16a34a;
    --danger: #dc2626;
    --watch: #d97706;
    --shadow-soft: 0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06);
    --shadow-panel: 0 4px 24px rgba(0,0,0,0.08);
}

html[data-theme='dark'] {
    --bg: #09090b;
    --surface: #111113;
    --surface-strong: #18181b;
    --text: #f4f4f5;
    --muted: #71717a;
    --muted-strong: #a1a1aa;
    --border: #27272a;
    --border-subtle: #1c1c1f;
    --accent-gold: #D4AF37;
    --accent-gold-dim: rgba(212,175,55,0.12);
    --accent-gold-border: rgba(212,175,55,0.3);
    --glow: rgba(212,175,55,0.15);
    --success: #4ade80;
    --danger: #f87171;
    --watch: #fbbf24;
    --shadow-soft: 0 1px 3px rgba(0,0,0,0.4), 0 1px 2px rgba(0,0,0,0.3);
    --shadow-panel: 0 4px 24px rgba(0,0,0,0.5);
}
```

- [ ] **Étape 2 : Mettre à jour `body` et base**

Remplacer le bloc `body` (fond gradient organique actuel) par :

```css
body {
    font-family: var(--font-body);
    background: var(--bg);
    color: var(--text);
    min-height: 100vh;
    overflow-x: hidden;
}

body::before, body::after { display: none; }
```

- [ ] **Étape 3 : Vérifier dans le navigateur**

Ouvrir `index.html` via `python -m http.server 8080`. Vérifier que le fond est `#09090b` en dark et `#f4f4f5` en light, sans gradient ni grille. Console JS : aucune erreur.

---

## Task 2 : Topbar compacte

**Files:**
- Modify: `index.html` (lignes 14–55 — `<header class="topbar">`)
- Modify: `styles.css` — section topbar

- [ ] **Étape 1 : Remplacer le `<header>` dans `index.html`**

Remplacer tout le bloc `<header class="topbar">…</header>` (lignes 14–55) par :

```html
<header class="topbar">
    <div class="topbar-brand">
        <figure class="topbar-logo">
            <img src="Logo_site.png" alt="Logo" width="24" height="24">
        </figure>
        <span class="topbar-name">Investissement Web</span>
    </div>
    <div class="topbar-study">
        <span id="topbar-study-name" class="topbar-study-chip">—</span>
    </div>
    <div class="topbar-actions">
        <button type="button" id="theme-toggle" class="topbar-btn" aria-label="Basculer thème"></button>
        <button type="button" id="screen-toggle" class="topbar-btn" aria-label="Mode 2 écrans"></button>
        <button type="button" id="profile-trigger" class="topbar-btn" aria-label="Profil du foyer"></button>
    </div>
</header>
```

- [ ] **Étape 2 : Ajouter CSS topbar dans `styles.css`**

```css
/* ── Topbar ── */
.topbar {
    position: fixed;
    top: 0; left: 0; right: 0;
    height: 52px;
    display: flex;
    align-items: center;
    padding: 0 16px;
    gap: 12px;
    background: color-mix(in srgb, var(--bg) 85%, transparent);
    backdrop-filter: blur(12px);
    border-bottom: 1px solid var(--border);
    z-index: 100;
}

.topbar-brand {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
}

.topbar-logo img {
    width: 24px;
    height: 24px;
    border-radius: 4px;
    display: block;
}

.topbar-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
    white-space: nowrap;
}

.topbar-study {
    flex: 1;
    display: flex;
    justify-content: center;
}

.topbar-study-chip {
    font-size: 12px;
    color: var(--muted-strong);
    background: var(--surface-strong);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 3px 10px;
    max-width: 240px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.topbar-actions {
    display: flex;
    gap: 6px;
    flex-shrink: 0;
}

.topbar-btn {
    width: 32px;
    height: 32px;
    background: var(--surface-strong);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--muted-strong);
    cursor: pointer;
    font-size: 11px;
    transition: border-color 150ms, color 150ms;
}

.topbar-btn:hover {
    border-color: var(--accent-gold-border);
    color: var(--accent-gold);
}

/* Pousser le contenu sous la topbar */
.shell {
    padding-top: 52px;
}
```

- [ ] **Étape 3 : Mettre à jour `main.js` — mise à jour du chip nom**

Dans `main.js`, dans la fonction `applyTheme()` (ligne ~1238), ajouter après la ligne `document.documentElement.dataset.theme = state.theme;` :

```js
const studyChip = document.getElementById('topbar-study-name');
if (studyChip) {
    studyChip.textContent = state.variablesData?.['nom-bien'] || '—';
}
```

Et dans la fonction `renderVariables()` ou équivalent (chercher `nodes.variablesKicker`), ajouter pareil. Chercher avec grep : `nodes.variablesKicker.textContent` et ajouter après :

```js
const studyChip = document.getElementById('topbar-study-name');
if (studyChip) studyChip.textContent = state.variablesData['nom-bien'] || '—';
```

- [ ] **Étape 4 : Vérifier dans le navigateur**

La topbar doit être fixe à 52px, logo + nom à gauche, nom du dossier centré, 3 boutons à droite. Le contenu de la page ne doit pas être masqué derrière la topbar.

---

## Task 3 : Navigation par onglets

**Files:**
- Modify: `index.html` (ligne 57–61 — `<nav class="workspace-nav">`)
- Modify: `styles.css` — section nav/tabs

- [ ] **Étape 1 : Déplacer et restructurer la `<nav>` dans `index.html`**

Supprimer le bloc `<nav class="workspace-nav">` (lignes 57–61).

Dans le `<main class="workspace">`, juste avant `<section class="workspace-panel">`, ajouter :

```html
<nav class="workspace-tabs" aria-label="Navigation">
    <button class="workspace-tab is-active" data-target="workspace-panel">Saisie &amp; Analyse</button>
    <button class="workspace-tab" data-target="collection-panel">Portefeuille</button>
</nav>
```

- [ ] **Étape 2 : CSS des onglets**

```css
/* ── Workspace tabs ── */
.workspace {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.workspace-tabs {
    display: flex;
    gap: 4px;
    padding: 3px;
    background: var(--surface-strong);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    width: fit-content;
}

.workspace-tab {
    font-size: 12px;
    font-weight: 500;
    padding: 5px 14px;
    border-radius: calc(var(--radius-md) - 2px);
    border: none;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    transition: background 150ms, color 150ms;
}

.workspace-tab.is-active {
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text);
}

.workspace-tab:hover:not(.is-active) {
    color: var(--muted-strong);
}
```

- [ ] **Étape 3 : JS pour switcher les onglets**

Dans `main.js`, ajouter cette fonction et l'appeler au `DOMContentLoaded` :

```js
function initWorkspaceTabs() {
    const tabs = document.querySelectorAll('.workspace-tab');
    const workspacePanel = document.querySelector('.workspace-panel');
    const collectionPanel = document.getElementById('collection-panel');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('is-active'));
            tab.classList.add('is-active');
            const target = tab.dataset.target;
            if (target === 'collection-panel') {
                workspacePanel.style.display = 'none';
                collectionPanel.style.display = '';
                collectionPanel.style.animation = 'tabFadeIn 200ms ease-out';
            } else {
                collectionPanel.style.display = 'none';
                workspacePanel.style.display = '';
                workspacePanel.style.animation = 'tabFadeIn 200ms ease-out';
            }
        });
    });
}
```

Ajouter dans `styles.css` :

```css
@keyframes tabFadeIn {
    from { opacity: 0; transform: translateY(4px); }
    to   { opacity: 1; transform: translateY(0); }
}
```

- [ ] **Étape 4 : Vérifier**

Cliquer entre les 2 onglets. L'animation fade+slide doit s'exécuter. Le panel collection doit s'afficher quand "Portefeuille" est actif.

---

## Task 4 : Accordéon sur le panneau de saisie

**Files:**
- Modify: `index.html` — chaque `<fieldset class="variables-group">` wrappé
- Modify: `styles.css` — composant accordéon
- Modify: `main.js` — JS accordéon

- [ ] **Étape 1 : Wrapper chaque `<fieldset>` dans `index.html`**

Pour chaque `<fieldset class="variables-group">`, remplacer par ce pattern. Exemple pour "Identité du dossier" :

Avant :
```html
<fieldset class="variables-group">
    <legend>Identité du dossier</legend>
    <div class="variables-grid">…</div>
</fieldset>
```

Après :
```html
<div class="accord-section" data-open="false">
    <button type="button" class="accord-head" aria-expanded="false">
        <span class="accord-title">Identité du dossier</span>
        <svg class="accord-chevron" width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 5l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
    </button>
    <div class="accord-body">
        <fieldset class="variables-group">
            <div class="variables-grid">…</div>
        </fieldset>
    </div>
</div>
```

Faire la même chose pour les 8 groupes. Le groupe "Acquisition" aura `data-open="true"` et le bouton `aria-expanded="true"` par défaut.

Titres des groupes dans l'ordre : "Identité du dossier", "Acquisition", "Financement", "Exploitation locative", "Vérifications avant offre", "Fiabilité des hypothèses", "Seuils de décision", "Fiscalité", "Journal de décision".

- [ ] **Étape 2 : CSS accordéon**

```css
/* ── Accordéon formulaire ── */
.accord-section {
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    overflow: hidden;
    margin-bottom: 6px;
}

.accord-head {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    background: var(--surface-strong);
    border: none;
    cursor: pointer;
    text-align: left;
    color: var(--text);
    transition: background 150ms;
}

.accord-head:hover {
    background: color-mix(in srgb, var(--surface-strong) 80%, var(--accent-gold-dim) 20%);
}

.accord-title {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: var(--muted-strong);
}

.accord-chevron {
    color: var(--muted);
    flex-shrink: 0;
    transition: transform 250ms ease-out;
}

.accord-section[data-open="true"] .accord-chevron {
    transform: rotate(180deg);
}

.accord-body {
    display: grid;
    grid-template-rows: 0fr;
    transition: grid-template-rows 250ms ease-out;
}

.accord-section[data-open="true"] .accord-body {
    grid-template-rows: 1fr;
}

.accord-body > fieldset {
    overflow: hidden;
    padding: 12px 14px;
    border: none;
    background: var(--surface);
}

/* Retirer la bordure native du fieldset */
.variables-group {
    border: none;
    padding: 0;
    margin: 0;
}
```

- [ ] **Étape 3 : JS accordéon dans `main.js`**

Ajouter cette fonction et l'appeler dans l'initialisation :

```js
function initAccordion() {
    const sections = document.querySelectorAll('.accord-section');
    sections.forEach(section => {
        const btn = section.querySelector('.accord-head');
        btn.addEventListener('click', () => {
            const isOpen = section.dataset.open === 'true';
            // Fermer tous les autres
            sections.forEach(s => {
                s.dataset.open = 'false';
                s.querySelector('.accord-head').setAttribute('aria-expanded', 'false');
            });
            // Ouvrir celui-ci si il était fermé
            if (!isOpen) {
                section.dataset.open = 'true';
                btn.setAttribute('aria-expanded', 'true');
            }
        });
    });
}
```

- [ ] **Étape 4 : Vérifier**

Ouvrir le formulaire. "Acquisition" doit être ouvert par défaut. Cliquer sur les autres groupes : animation fluide d'ouverture/fermeture. Un seul groupe ouvert à la fois.

---

## Task 5 : Style des champs de formulaire

**Files:**
- Modify: `styles.css` — `.variables-input`, `.variables-field`, `.variables-grid`

- [ ] **Étape 1 : Remplacer les styles des champs**

```css
/* ── Champs formulaire ── */
.variables-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
}

.variables-grid--single {
    grid-template-columns: 1fr;
}

.variables-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.variables-field--wide {
    grid-column: 1 / -1;
}

.status-label {
    font-size: 10px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.7px;
    color: var(--muted);
}

.variables-input {
    height: 32px;
    padding: 0 10px;
    background: var(--surface-strong);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text);
    font-family: var(--font-body);
    font-size: 13px;
    outline: none;
    transition: border-color 200ms, box-shadow 200ms, background 200ms;
    width: 100%;
    -webkit-appearance: none;
    appearance: none;
}

.variables-input:focus {
    border-color: var(--accent-gold-border);
    background: var(--accent-gold-dim);
    color: var(--accent-gold);
    box-shadow: 0 0 0 3px var(--accent-gold-dim);
}

.variables-textarea {
    height: auto;
    min-height: 72px;
    padding: 8px 10px;
    resize: vertical;
}

.field-assist {
    font-size: 10px;
    color: var(--muted);
    line-height: 1.4;
}

.field-error {
    font-size: 10px;
    color: var(--danger);
}

.field-required {
    color: var(--danger);
}
```

- [ ] **Étape 2 : Boutons d'actions du formulaire**

```css
/* ── Actions formulaire ── */
.asset-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    padding: 14px 0 0;
    border-top: 1px solid var(--border);
    margin-top: 12px;
}

.toolbar-button {
    padding: 7px 14px;
    font-size: 12px;
    font-weight: 500;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: border-color 150ms, color 150ms, background 150ms;
    white-space: nowrap;
}

/* Bouton primaire : Enregistrer au comparateur */
#save-comparison {
    background: var(--accent-gold);
    border: 1px solid var(--accent-gold);
    color: #09090b;
    font-weight: 600;
}

#save-comparison:hover {
    opacity: 0.88;
}

/* Boutons secondaires */
#new-asset,
#save-portfolio,
#export-decision-pdf {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--muted-strong);
}

#new-asset:hover,
#save-portfolio:hover,
#export-decision-pdf:hover {
    border-color: var(--accent-gold-border);
    color: var(--accent-gold);
}
```

- [ ] **Étape 3 : Vérifier**

Les champs doivent être `height: 32px`, fond sombre, bordure `#27272a`. Au focus : bordure gold + fond gold-dim + glow. Les boutons du bas doivent montrer le bouton "Enregistrer" en or.

---

## Task 6 : Score gauge SVG dans le panneau d'analyse

**Files:**
- Modify: `main.js` — fonction `buildAnalysisAcquisitionDecision` (ligne ~1485)
- Modify: `styles.css` — `.score-hero`, `.score-gauge`

- [ ] **Étape 1 : Remplacer le HTML du score dans `main.js`**

Dans `buildAnalysisAcquisitionDecision` (ligne ~1488), le template literal injecte `nodes.analysisAcquisitionDecision.innerHTML`. Remplacer la partie score (div `.buybox-score`) :

Trouver ce bloc dans le template :
```js
<div class="buybox-score buybox-score--${acquisitionDecision.tone}">
    <span>Score dossier</span>
    <strong>${acquisitionDecision.score}<small>/100</small></strong>
</div>
```

Remplacer par (la formule dashoffset : `289 * (1 - score/100)`) :
```js
<div class="score-hero">
    <svg class="score-gauge" viewBox="0 0 120 120" width="96" height="96" role="img" aria-label="Score ${acquisitionDecision.score}/100">
        <circle class="gauge-track" cx="60" cy="60" r="46"/>
        <circle class="gauge-fill gauge-fill--${acquisitionDecision.tone}" cx="60" cy="60" r="46"
            style="stroke-dashoffset: ${(289 * (1 - acquisitionDecision.score / 100)).toFixed(1)}"/>
        <text class="gauge-number" x="60" y="68">${acquisitionDecision.score}</text>
    </svg>
    <div class="score-meta">
        <span class="score-verdict score-verdict--${acquisitionDecision.tone}">${acquisitionDecision.label}</span>
        <span class="score-label">Score de décision</span>
    </div>
</div>
```

- [ ] **Étape 2 : CSS gauge SVG**

```css
/* ── Score gauge SVG ── */
.score-hero {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 16px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    margin-bottom: 12px;
}

.score-gauge {
    flex-shrink: 0;
}

.gauge-track {
    fill: none;
    stroke: var(--border);
    stroke-width: 8;
}

.gauge-fill {
    fill: none;
    stroke: var(--accent-gold);
    stroke-width: 8;
    stroke-linecap: round;
    stroke-dasharray: 289;
    transform: rotate(-90deg);
    transform-origin: 60px 60px;
    transition: stroke-dashoffset 600ms ease-out, stroke 300ms;
}

.gauge-fill--excellent { stroke: var(--success); }
.gauge-fill--positive  { stroke: var(--accent-gold); }
.gauge-fill--neutral   { stroke: var(--muted-strong); }
.gauge-fill--watch     { stroke: var(--watch); }
.gauge-fill--negative  { stroke: var(--danger); }

.gauge-number {
    font-family: var(--font-display);
    font-size: 26px;
    font-weight: 900;
    fill: var(--accent-gold);
    text-anchor: middle;
    dominant-baseline: middle;
}

.score-meta {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.score-verdict {
    font-size: 18px;
    font-weight: 700;
    color: var(--accent-gold);
}

.score-verdict--excellent { color: var(--success); }
.score-verdict--positive  { color: var(--accent-gold); }
.score-verdict--neutral   { color: var(--muted-strong); }
.score-verdict--watch     { color: var(--watch); }
.score-verdict--negative  { color: var(--danger); }

.score-label {
    font-size: 11px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.8px;
}
```

- [ ] **Étape 3 : Vérifier**

Le cadran SVG doit apparaître dans le panneau analyse. L'arc doit refléter le score. Modifier le prix dans le formulaire : le `stroke-dashoffset` doit s'animer en 600ms vers la nouvelle valeur.

---

## Task 7 : KPI cards avec compteurs animés

**Files:**
- Modify: `main.js` — `buildAnalysisMetrics` (ligne ~1443) + helper `animateCounter`
- Modify: `styles.css` — `.kpi-card`

- [ ] **Étape 1 : Helper `animateCounter` dans `main.js`**

Ajouter cette fonction en haut de `main.js` (après les imports) :

```js
const _counterState = new WeakMap();

function animateCounter(el, targetText) {
    // Extraire les chiffres de la valeur cible
    const match = targetText.match(/^([^0-9\-]*)(-?[\d.,]+)(.*)$/);
    if (!match) { el.textContent = targetText; return; }
    const [, prefix, rawNum, suffix] = match;
    const target = parseFloat(rawNum.replace(',', '.'));
    if (isNaN(target)) { el.textContent = targetText; return; }

    const prev = _counterState.get(el) ?? target;
    _counterState.set(el, target);
    if (prev === target) return;

    const start = performance.now();
    const duration = 300;
    const decimals = (rawNum.includes(',') || rawNum.includes('.'))
        ? rawNum.split(/[,.]/).pop().length : 0;

    function tick(now) {
        const t = Math.min((now - start) / duration, 1);
        const current = prev + (target - prev) * t;
        el.textContent = prefix + current.toFixed(decimals).replace('.', ',') + suffix;
        if (t < 1) requestAnimationFrame(tick);
        else _counterState.set(el, target);
    }
    requestAnimationFrame(tick);
}
```

- [ ] **Étape 2 : Remplacer `buildAnalysisMetrics` dans `main.js` (ligne ~1380–1448)**

Lire la fonction actuelle pour comprendre le tableau `cards` qu'elle construit. Le template literal qui produit `nodes.analysisMetrics.innerHTML` (ligne 1443) doit être remplacé par :

```js
nodes.analysisMetrics.innerHTML = cards.map((card, i) => `
    <article class="kpi-card" data-kpi-index="${i}">
        <div class="kpi-value ${card.cssClass}" data-kpi-value="${escapeHtml(card.value)}">${escapeHtml(card.value)}</div>
        <div class="kpi-label">${escapeHtml(card.label)}</div>
        <div class="kpi-bar"><div class="kpi-bar-fill" style="--pct: ${card.barPct ?? 50}%"></div></div>
    </article>
`).join('');

// Lancer les compteurs sur les valeurs numériques
nodes.analysisMetrics.querySelectorAll('[data-kpi-value]').forEach(el => {
    animateCounter(el, el.dataset.kpiValue);
});
```

Pour `card.barPct`, ajouter dans chaque objet `card` du tableau un champ calculé. Exemple :
- Rentabilité brute : `barPct: Math.min(100, (card.rawValue / 10) * 100)` (10% = 100%)
- Cash-flow : `barPct: Math.min(100, Math.max(0, (card.rawValue + 200) / 400 * 100))` (−200€→0%, +200€→100%)
- DSCR : `barPct: Math.min(100, (card.rawValue / 1.5) * 100)` (1.5 = 100%)
- GRM : `barPct: Math.min(100, Math.max(0, 100 - (card.rawValue / 25) * 100))` (inversé : GRM bas = bon)

Note : `rawValue` doit être ajouté à chaque objet card (valeur numérique avant formatage).

- [ ] **Étape 3 : CSS KPI cards**

```css
/* ── KPI cards ── */
.analysis-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
    margin-bottom: 12px;
}

.kpi-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 12px 14px;
    transition: border-color 150ms;
}

.kpi-card:hover {
    border-color: var(--accent-gold-border);
}

.kpi-value {
    font-family: var(--font-display);
    font-size: 20px;
    font-weight: 700;
    color: var(--accent-gold);
    line-height: 1;
    margin-bottom: 4px;
}

.kpi-value.is-positive { color: var(--success); }
.kpi-value.is-negative { color: var(--danger); }
.kpi-value.is-watch    { color: var(--watch); }
.kpi-value.is-neutral  { color: var(--muted-strong); }

.kpi-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.7px;
    color: var(--muted);
    margin-bottom: 8px;
}

.kpi-bar {
    height: 3px;
    background: var(--border);
    border-radius: 2px;
    overflow: hidden;
}

.kpi-bar-fill {
    height: 100%;
    width: var(--pct, 0%);
    background: var(--accent-gold);
    border-radius: 2px;
    transition: width 400ms ease-out;
}
```

- [ ] **Étape 4 : Vérifier**

Les 4 KPI cards doivent s'afficher. Modifier le loyer : les chiffres doivent compter animés sur 300ms. Les barres de progression doivent s'animer sur 400ms.

---

## Task 8 : Sections d'analyse et tons de verdict

**Files:**
- Modify: `styles.css` — `.analysis-block`, `.decision-badge`, `.status-pill`, `.buybox`
- Modify: `ui.js` — correction `getThemeTextColor()`

- [ ] **Étape 1 : CSS sections d'analyse**

```css
/* ── Sections analyse ── */
.analysis-block {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 16px;
}

.analysis-block h4 {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: var(--muted);
    margin-bottom: 12px;
}

.analysis-columns {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 8px;
    margin-bottom: 8px;
}

.analysis-block--wide {
    grid-column: 1 / -1;
}

/* ── Tons de verdict ── */
.decision-badge {
    display: inline-flex;
    align-items: center;
    font-size: 12px;
    font-weight: 600;
    padding: 3px 10px;
    border-radius: 20px;
    border: 1px solid;
    transition: background 300ms, color 300ms, border-color 300ms;
}

.decision-badge--excellent {
    background: rgba(74,222,128,0.12);
    color: var(--success);
    border-color: rgba(74,222,128,0.3);
}

.decision-badge--positive {
    background: var(--accent-gold-dim);
    color: var(--accent-gold);
    border-color: var(--accent-gold-border);
}

.decision-badge--neutral {
    background: rgba(161,161,170,0.1);
    color: var(--muted-strong);
    border-color: rgba(161,161,170,0.2);
}

.decision-badge--watch {
    background: rgba(251,191,36,0.12);
    color: var(--watch);
    border-color: rgba(251,191,36,0.3);
}

.decision-badge--negative {
    background: rgba(248,113,113,0.12);
    color: var(--danger);
    border-color: rgba(248,113,113,0.3);
}

.status-pill { /* même pattern que decision-badge */ }
.status-pill--excellent { background: rgba(74,222,128,0.12);   color: var(--success);      border: 1px solid rgba(74,222,128,0.3); }
.status-pill--positive  { background: var(--accent-gold-dim);  color: var(--accent-gold);  border: 1px solid var(--accent-gold-border); }
.status-pill--neutral   { background: rgba(161,161,170,0.1);   color: var(--muted-strong); border: 1px solid rgba(161,161,170,0.2); }
.status-pill--watch     { background: rgba(251,191,36,0.12);   color: var(--watch);        border: 1px solid rgba(251,191,36,0.3); }
.status-pill--negative  { background: rgba(248,113,113,0.12);  color: var(--danger);       border: 1px solid rgba(248,113,113,0.3); }
```

- [ ] **Étape 2 : Corriger `getThemeTextColor()` dans `ui.js`**

Ligne 15–20 de `ui.js`, remplacer :

```js
function getThemeTextColor() {
    const isDark = document.documentElement.classList.contains('theme-dark') ||
        (!document.documentElement.classList.contains('theme-light') &&
         window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    return isDark ? '#E6EDF3' : '#1C2128';
}
```

Par :

```js
function getThemeTextColor() {
    const isDark = document.documentElement.dataset.theme === 'dark' ||
        (!document.documentElement.dataset.theme &&
         window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    return isDark ? '#f4f4f5' : '#09090b';
}
```

- [ ] **Étape 3 : Vérifier**

Les badges de décision (Excellent/Positif/Neutre/Attention/Négatif) doivent afficher les bonnes couleurs. Basculer le thème : les couleurs des graphiques `ui.js` doivent s'adapter correctement.

---

## Task 9 : Layout des panneaux + espace de travail

**Files:**
- Modify: `styles.css` — `.workspace-board`, `.variables-panel`, `.analysis-panel`

- [ ] **Étape 1 : CSS workspace board 2 panneaux**

```css
/* ── Workspace ── */
.workspace-panel {
    background: transparent;
}

.workspace-board {
    display: grid;
    grid-template-columns: 42% 1fr;
    gap: 12px;
    align-items: start;
}

.workspace-board[data-layout="1"] {
    grid-template-columns: 1fr;
}

.workspace-board[data-layout="1"] .analysis-panel {
    display: none;
}

.variables-panel {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-xl);
    padding: 16px;
    position: sticky;
    top: 68px; /* 52px topbar + 16px */
    max-height: calc(100vh - 80px);
    overflow-y: auto;
}

.analysis-panel {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

/* Scrollbar discrète */
.variables-panel::-webkit-scrollbar { width: 4px; }
.variables-panel::-webkit-scrollbar-track { background: transparent; }
.variables-panel::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
```

- [ ] **Étape 2 : Vérifier le layout 2 panneaux**

En mode 2 écrans (layout=2), le formulaire (gauche) et l'analyse (droite) doivent être côte à côte. Le formulaire doit être sticky et scrollable indépendamment.

---

## Task 10 : Vérification finale et nettoyage

**Files:**
- Modify: `styles.css` — supprimer les anciennes classes inutilisées et harmoniser
- Modify: `index.html` — supprimer `panel-head` du topbar si résiduel

- [ ] **Étape 1 : Supprimer les résidus HTML de l'ancien header**

Vérifier qu'il ne reste aucun `.brand`, `.brand-kicker`, `.brand-note`, `.brand-pill`, `.toolbar-dock`, `.toolbar-copy` dans `index.html`. Ces classes faisaient partie du grand header marketing supprimé.

- [ ] **Étape 2 : Test complet dans le navigateur**

Parcourir ces scénarios manuellement :
1. Thème dark → Thème light → retour dark : couleurs correctes partout
2. Modifier le prix : score SVG s'anime, compteurs KPIs s'animent, barres progressent
3. Ouvrir/fermer chaque groupe accordéon : animation fluide, un seul ouvert à la fois
4. Naviguer Saisie↔Portefeuille : transition fade-in
5. Ouvrir le profil du foyer : modal correctement positionnée sous la topbar
6. Mode 2 écrans via le bouton screen-toggle : layout bascule correctement
7. Console JS : aucune erreur

- [ ] **Étape 3 : Vérifier le mode `?panel=analysis`**

Ouvrir `http://localhost:8080?panel=analysis`. Le panneau analyse seul doit s'afficher correctement avec le nouveau design.
