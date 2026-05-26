# Ergonomie UX — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter une barre KPIs live, des badges de priorité sur les accordéons, une réorganisation du panel d'analyse, et un mode guidé (checklist + spotlight) pour accompagner les utilisateurs débutants.

**Architecture:** Vanilla JS ES modules, aucun build step. Toutes les modifications se font dans `index.html` (markup), `styles.css` (classes), et `main.js` (logique). `calculs.js`, `pdf.js`, `ui.js` ne sont pas touchés. Le cycle de rendu existant (`updateVariablesFromForm → render → renderWorkspaceContent`) est réutilisé à chaque étape.

**Tech Stack:** HTML, CSS custom properties, vanilla JS ES modules, localStorage.

---

## Attention : collision de noms

La classe `.kpi-bar` est **déjà utilisée** dans `main.js` (ligne 1496) pour les barres de progression des KPI cards dans le panel analyse. Le nouveau bandeau collant du formulaire utilise donc la classe `.form-kpi-bar` pour éviter tout conflit.

---

## Task 1 : Fondation CSS — tous les nouveaux composants

**Files:**
- Modify: `styles.css` (ajouter à la fin du fichier)

- [ ] **Step 1 : Vérifier qu'il n'y a pas déjà un `.form-kpi-bar` dans styles.css**

```bash
grep -n "form-kpi-bar\|accord-badge--\|guided-checklist\|spotlight-overlay\|analysis-section-badge\|analysis-columns--2up" styles.css
```

Résultat attendu : aucune sortie (classes absentes).

- [ ] **Step 2 : Ajouter les nouvelles classes à la fin de `styles.css`**

Ouvrir `styles.css` et ajouter ce bloc à la toute fin :

```css
/* ── Barre KPIs collante (formulaire) ── */
.form-kpi-bar {
    position: sticky;
    top: 0;
    z-index: 10;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    padding: 10px 16px;
    margin-bottom: 8px;
}
.form-kpi-bar__item {
    text-align: center;
    padding: 4px 0;
}
.form-kpi-bar__item + .form-kpi-bar__item {
    border-left: 1px solid var(--border);
}
.form-kpi-bar__value {
    display: block;
    font-size: 18px;
    font-weight: 700;
    font-family: var(--font-heading);
    line-height: 1;
    color: var(--text);
}
.form-kpi-bar__value--gold  { color: var(--accent-gold); }
.form-kpi-bar__value--green { color: var(--success); }
.form-kpi-bar__value--red   { color: var(--danger); }
.form-kpi-bar__label {
    display: block;
    font-size: 10px;
    color: var(--muted);
    margin-top: 2px;
    letter-spacing: 0.3px;
}

/* ── Badges de priorité sur accordéons ── */
.accord-badge--essentiel {
    background: var(--accent-gold-dim);
    color: var(--accent-gold);
    border: 1px solid var(--accent-gold-border);
    font-size: 10px;
    font-weight: 700;
    padding: 2px 7px;
    border-radius: 4px;
    letter-spacing: 0.3px;
    white-space: nowrap;
}
.accord-badge--important {
    background: var(--primary-soft);
    color: var(--primary);
    border: 1px solid rgba(59, 130, 246, 0.25);
    font-size: 10px;
    font-weight: 600;
    padding: 2px 7px;
    border-radius: 4px;
    letter-spacing: 0.3px;
    white-space: nowrap;
}
.accord-section[data-priority="essentiel"][data-open="true"] .accord-body {
    background: rgba(168, 131, 42, 0.03);
}
html[data-theme='dark'] .accord-section[data-priority="essentiel"][data-open="true"] .accord-body {
    background: rgba(201, 168, 76, 0.03);
}
.accord-section[data-priority="essentiel"] .accord-chevron {
    color: var(--accent-gold);
}

/* ── Panel analyse : badges de section ── */
.analysis-section-badge {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.5px;
    color: var(--muted);
    background: var(--surface-strong);
    padding: 2px 8px;
    border-radius: 4px;
    display: inline-block;
    margin-bottom: 8px;
}

/* ── Panel analyse : solidité + stress côte à côte ── */
.analysis-columns--2up {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-bottom: 12px;
}
@media (max-width: 640px) {
    .analysis-columns--2up { grid-template-columns: 1fr; }
}

/* ── Mode guidé : checklist ── */
.guided-checklist {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 14px;
    margin-bottom: 12px;
}
.guided-checklist__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text);
}
.guided-checklist__progress {
    font-size: 11px;
    font-weight: 700;
    color: var(--primary);
}
.guided-checklist__bar-track {
    background: var(--surface-strong);
    border-radius: 4px;
    height: 5px;
    margin-bottom: 12px;
}
.guided-checklist__bar-fill {
    background: var(--primary);
    border-radius: 4px;
    height: 5px;
    transition: width 0.3s ease;
}
.guided-checklist__section-label {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.5px;
    color: var(--muted);
    margin-bottom: 6px;
    margin-top: 10px;
}
.guided-checklist__section-label:first-of-type { margin-top: 0; }
.guided-checklist__list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
}
.guided-checklist__item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 7px;
    border-radius: 5px;
    font-size: 12px;
    cursor: pointer;
    transition: background 0.15s;
    border: 1px solid transparent;
    background: var(--surface-strong);
    color: var(--muted);
    user-select: none;
}
.guided-checklist__item:hover {
    border-color: var(--border);
    color: var(--text);
}
.guided-checklist__item.is-done {
    color: var(--muted);
    text-decoration: line-through;
}
.guided-checklist__item.is-done .guided-checklist__check {
    color: var(--success);
    font-size: 14px;
}
.guided-checklist__item.is-current {
    background: var(--primary-soft);
    border-color: rgba(59, 130, 246, 0.3);
    color: var(--text);
    font-weight: 500;
}
.guided-checklist__item.is-current .guided-checklist__check {
    background: var(--primary);
    color: #fff;
    border-radius: 50%;
    width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 9px;
    flex-shrink: 0;
}
.guided-checklist__item:not(.is-done):not(.is-current) .guided-checklist__check {
    border: 1px solid var(--border);
    border-radius: 50%;
    width: 14px;
    height: 14px;
    display: inline-block;
    flex-shrink: 0;
}
.guided-checklist__name { flex: 1; }

/* ── Mode guidé : bouton topbar ── */
.topbar-btn--guided.is-active {
    background: var(--primary-soft);
    color: var(--primary);
    border-color: rgba(59, 130, 246, 0.3);
}

/* ── Mode guidé : spotlight ── */
.spotlight-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
}
.spotlight-card {
    background: var(--surface);
    border: 2px solid var(--primary);
    border-radius: var(--radius-lg);
    padding: 20px;
    width: 320px;
    box-shadow: var(--shadow-panel);
}
.spotlight-card__header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 12px;
}
.spotlight-card__step {
    background: var(--primary);
    color: #fff;
    border-radius: 4px;
    padding: 2px 8px;
    font-size: 10px;
    font-weight: 700;
    white-space: nowrap;
}
.spotlight-card__title {
    font-size: 14px;
    font-weight: 600;
    color: var(--text);
}
.spotlight-card__input {
    width: 100%;
    background: var(--surface-strong);
    border: 1px solid var(--primary);
    border-radius: var(--radius-md);
    padding: 10px 12px;
    color: var(--text);
    font-size: 15px;
    font-family: var(--font-body);
    box-sizing: border-box;
    margin-bottom: 10px;
}
.spotlight-card__input:focus {
    outline: none;
    box-shadow: 0 0 0 3px var(--primary-soft);
}
.spotlight-card__desc {
    font-size: 12px;
    color: var(--muted);
    line-height: 1.6;
    margin: 0 0 14px;
}
.spotlight-card__actions {
    display: flex;
    gap: 8px;
}
.spotlight-card__actions button {
    flex: 1;
    padding: 8px;
    border-radius: var(--radius-md);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    border: 1px solid var(--border);
    background: var(--surface-strong);
    color: var(--muted);
    font-family: var(--font-body);
}
.spotlight-card__actions button.is-primary {
    background: var(--primary);
    color: #fff;
    border-color: var(--primary);
}
```

- [ ] **Step 3 : Vérifier dans le navigateur**

Ouvrir `http://localhost:8080` (ou `python -m http.server 8080`). Ouvrir la console — aucune erreur CSS. Les classes ne sont pas encore utilisées, ça ne change rien visuellement. C'est normal.

- [ ] **Step 4 : Commit**

```bash
git add styles.css
git commit -m "style: add CSS foundation for ergonomics improvements"
```

---

## Task 2 : Barre KPIs collante (HTML + JS)

**Files:**
- Modify: `index.html` (ajouter après `#variables-context`)
- Modify: `main.js` (ajouter `renderFormKpiBar()` et l'appeler dans `renderWorkspaceContent`)

- [ ] **Step 1 : Ajouter le markup dans `index.html`**

Trouver la ligne :
```html
<div id="variables-context" class="context-strip"></div>
```

La remplacer par :
```html
<div id="variables-context" class="context-strip"></div>

<div class="form-kpi-bar" id="form-kpi-bar" aria-label="Métriques en direct">
    <div class="form-kpi-bar__item">
        <span class="form-kpi-bar__value form-kpi-bar__value--gold" id="fkpi-rdt-brut">—</span>
        <span class="form-kpi-bar__label">Rendement brut</span>
    </div>
    <div class="form-kpi-bar__item">
        <span class="form-kpi-bar__value" id="fkpi-cf-net">—</span>
        <span class="form-kpi-bar__label">Cash-flow net/mois</span>
    </div>
    <div class="form-kpi-bar__item">
        <span class="form-kpi-bar__value" id="fkpi-dscr">—</span>
        <span class="form-kpi-bar__label">DSCR</span>
    </div>
</div>
```

- [ ] **Step 2 : Ajouter les références dans `nodes` dans `main.js`**

Trouver la ligne :
```js
    themeMeta: document.querySelector('meta[name="theme-color"]')
```

La remplacer par :
```js
    themeMeta: document.querySelector('meta[name="theme-color"]'),
    fkpiRdtBrut: document.getElementById('fkpi-rdt-brut'),
    fkpiCfNet: document.getElementById('fkpi-cf-net'),
    fkpiDscr: document.getElementById('fkpi-dscr')
```

- [ ] **Step 3 : Ajouter la fonction `renderFormKpiBar` dans `main.js`**

Trouver la ligne :
```js
function buildAnalysisMetrics(analysisModel) {
```

Juste **avant** cette ligne, insérer :

```js
function renderFormKpiBar(analysisModel) {
    if (!nodes.fkpiRdtBrut) return;
    const { metrics } = analysisModel;
    const prix = state.variablesData.prix ?? 0;

    if (!prix) {
        nodes.fkpiRdtBrut.textContent = '—';
        nodes.fkpiRdtBrut.className = 'form-kpi-bar__value form-kpi-bar__value--gold';
        nodes.fkpiCfNet.textContent = '—';
        nodes.fkpiCfNet.className = 'form-kpi-bar__value';
        nodes.fkpiDscr.textContent = '—';
        nodes.fkpiDscr.className = 'form-kpi-bar__value';
        return;
    }

    const rdt = metrics.rentaBrute ?? 0;
    nodes.fkpiRdtBrut.textContent = `${rdt.toFixed(2).replace('.', ',')} %`;
    nodes.fkpiRdtBrut.className = 'form-kpi-bar__value form-kpi-bar__value--gold';

    const cf = metrics.cfNetNet ?? 0;
    const cfText = (cf >= 0 ? '+' : '') + cf.toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' €';
    nodes.fkpiCfNet.textContent = cfText;
    nodes.fkpiCfNet.className = `form-kpi-bar__value ${cf >= 0 ? 'form-kpi-bar__value--green' : 'form-kpi-bar__value--red'}`;

    const dscr = metrics.dscr ?? 0;
    nodes.fkpiDscr.textContent = dscr.toFixed(2).replace('.', ',');
    nodes.fkpiDscr.className = 'form-kpi-bar__value';
}

```

- [ ] **Step 4 : Appeler `renderFormKpiBar` dans `renderWorkspaceContent`**

Trouver la ligne dans `renderWorkspaceContent` :
```js
    buildAnalysisStickySummary(analysisModel);
```

Juste **avant**, insérer :
```js
    if (showVariables) renderFormKpiBar(analysisModel);
```

- [ ] **Step 5 : Vérifier dans le navigateur**

- Ouvrir `http://localhost:8080`
- La barre doit apparaître en haut du panneau de saisie avec 3 métriques
- Modifier le prix → les valeurs doivent se mettre à jour immédiatement
- Modifier le loyer → le rendement brut et le CF changent
- Mettre prix à 0 → la barre doit afficher `—` partout

- [ ] **Step 6 : Commit**

```bash
git add index.html main.js
git commit -m "feat: add live KPI bar to form panel (rendement, CF, DSCR)"
```

---

## Task 3 : Badges de priorité sur les accordéons (HTML)

**Files:**
- Modify: `index.html` (changer les badges existants, ajouter les manquants, ajouter `data-priority`)

- [ ] **Step 1 : Ajouter `data-priority` et les bons badges sur chaque accordéon**

Les sections actuelles et leurs transformations :

**Identité du dossier** → OPTIONNEL (badge gris existant `.accord-badge` suffit)

Trouver :
```html
<div class="accord-section" data-open="false">
    <button type="button" class="accord-head" aria-expanded="false">
        <span class="accord-title">Identité du dossier</span>
```
Remplacer par :
```html
<div class="accord-section" data-priority="optionnel" data-open="false">
    <button type="button" class="accord-head" aria-expanded="false">
        <span class="accord-title">Identité du dossier</span>
        <span class="accord-badge">Optionnel</span>
```

**Acquisition** → ESSENTIEL

Trouver :
```html
<div class="accord-section" data-open="true">
    <button type="button" class="accord-head" aria-expanded="true">
        <span class="accord-title">Acquisition</span>
```
Remplacer par :
```html
<div class="accord-section" data-priority="essentiel" data-open="true">
    <button type="button" class="accord-head" aria-expanded="true">
        <span class="accord-title">Acquisition</span>
        <span class="accord-badge accord-badge--essentiel">Essentiel</span>
```

**Financement** → ESSENTIEL

Trouver :
```html
<div class="accord-section" data-open="false">
    <button type="button" class="accord-head" aria-expanded="false">
        <span class="accord-title">Financement</span>
```
Remplacer par :
```html
<div class="accord-section" data-priority="essentiel" data-open="false">
    <button type="button" class="accord-head" aria-expanded="false">
        <span class="accord-title">Financement</span>
        <span class="accord-badge accord-badge--essentiel">Essentiel</span>
```

**Exploitation locative** → IMPORTANT

Trouver :
```html
<div class="accord-section" data-open="false">
    <button type="button" class="accord-head" aria-expanded="false">
        <span class="accord-title">Exploitation locative</span>
```
Remplacer par :
```html
<div class="accord-section" data-priority="important" data-open="false">
    <button type="button" class="accord-head" aria-expanded="false">
        <span class="accord-title">Exploitation locative</span>
        <span class="accord-badge accord-badge--important">Important</span>
```

**Fiscalité** → IMPORTANT

Trouver :
```html
<div class="accord-section" data-open="false">
    <button type="button" class="accord-head" aria-expanded="false">
        <span class="accord-title">Fiscalité</span>
```
Remplacer par :
```html
<div class="accord-section" data-priority="important" data-open="false">
    <button type="button" class="accord-head" aria-expanded="false">
        <span class="accord-title">Fiscalité</span>
        <span class="accord-badge accord-badge--important">Important</span>
```

**Vérifications avant offre**, **Fiabilité des hypothèses**, **Seuils de décision**, **Journal de décision** → Ils ont déjà `<span class="accord-badge">Avancé</span>`. Ajouter seulement `data-priority="avance"` sur leur `<div class="accord-section">`.

Exemple pour Vérifications avant offre :
```html
<div class="accord-section" data-priority="avance" data-open="false">
```
(Faire de même pour les 3 autres sections avancées.)

- [ ] **Step 2 : Vérifier dans le navigateur**

- Les sections Acquisition et Financement doivent avoir un badge doré `Essentiel`
- Les sections Exploitation et Fiscalité doivent avoir un badge bleu `Important`
- Ouvrir la section Acquisition → le fond doit être légèrement teinté or, le chevron doré
- Les autres sections avancées conservent leur badge gris

- [ ] **Step 3 : Commit**

```bash
git add index.html
git commit -m "feat: add priority badges to form sections (Essentiel/Important/Avancé)"
```

---

## Task 4 : Réorganisation du panel d'analyse (HTML)

**Files:**
- Modify: `index.html` (réordonner les blocs, ajouter badges, wrapper 2up)

- [ ] **Step 1 : Ajouter les badges de section dans le panel d'analyse**

Dans `#analysis-panel`, trouver le bloc verdict :
```html
<section class="analysis-buybox analysis-block">
    <div id="analysis-acquisition-decision"></div>
</section>
```
Remplacer par :
```html
<section class="analysis-buybox analysis-block">
    <div class="analysis-section-badge">① VERDICT</div>
    <div id="analysis-acquisition-decision"></div>
</section>
```

Trouver :
```html
<div id="analysis-metrics" class="analysis-grid"></div>
```
Remplacer par :
```html
<div class="analysis-section-badge">② MÉTRIQUES CLÉS</div>
<div id="analysis-metrics" class="analysis-grid"></div>
```

- [ ] **Step 2 : Mettre Solidité et Stress côte à côte**

Trouver dans `#analysis-panel` le bloc `analysis-columns` qui contient les 3 sections (Solidité, Stress, Journal) :

```html
<div class="analysis-columns">
    <section class="analysis-block">
        <h4>Solidité des hypothèses</h4>
        <div id="analysis-confidence"></div>
    </section>

    <section class="analysis-block">
        <h4>Scénarios de stress</h4>
        <div id="analysis-scenarios"></div>
    </section>

    <section class="analysis-block">
        <h4>Journal de décision</h4>
        <div id="analysis-journal"></div>
    </section>
</div>
```

Remplacer par :

```html
<div class="analysis-section-badge">③ SOLIDITÉ &amp; ④ STRESS</div>
<div class="analysis-columns--2up">
    <section class="analysis-block">
        <h4>Solidité des hypothèses</h4>
        <div id="analysis-confidence"></div>
    </section>

    <section class="analysis-block">
        <h4>Scénarios de stress</h4>
        <div id="analysis-scenarios"></div>
    </section>
</div>

<section class="analysis-block">
    <h4>Journal de décision</h4>
    <div id="analysis-journal"></div>
</section>
```

- [ ] **Step 3 : Ajouter le badge ⑤ avant les projections**

Trouver la div `.analysis-forward` (qui contient Projection 10 ans et Matrice prix/loyer) :
```html
<div class="analysis-forward">
```
Remplacer par :
```html
<div class="analysis-section-badge">⑤ PROJECTIONS &amp; FISCALITÉ</div>
<div class="analysis-forward">
```

- [ ] **Step 4 : Vérifier dans le navigateur**

- Les badges numérotés ①②③④⑤ apparaissent devant chaque section
- Solidité et Stress sont côte à côte (vérifier sur une largeur > 640px)
- Le journal apparaît en dessous des deux
- Les graphiques et tableaux restent en bas, inchangés

- [ ] **Step 5 : Commit**

```bash
git add index.html
git commit -m "feat: restructure analysis panel with numbered sections and 2-up confidence/stress"
```

---

## Task 5 : Mode guidé — Toggle + Checklist

**Files:**
- Modify: `index.html` (bouton topbar + markup checklist)
- Modify: `main.js` (logique toggle + rendu checklist)

### 5a — HTML

- [ ] **Step 1 : Ajouter le bouton Mode guidé dans la topbar**

Dans `index.html`, trouver :
```html
<div class="topbar-actions">
    <button type="button" id="theme-toggle" class="topbar-btn" aria-label="Basculer thème"></button>
    <button type="button" id="screen-toggle" class="topbar-btn" aria-label="Mode 2 écrans"></button>
    <button type="button" id="profile-trigger" class="topbar-btn" aria-label="Profil du foyer"></button>
</div>
```
Remplacer par :
```html
<div class="topbar-actions">
    <button type="button" id="theme-toggle" class="topbar-btn" aria-label="Basculer thème"></button>
    <button type="button" id="screen-toggle" class="topbar-btn" aria-label="Mode 2 écrans"></button>
    <button type="button" id="guided-toggle" class="topbar-btn topbar-btn--guided" aria-label="Mode guidé" aria-pressed="false">Guide</button>
    <button type="button" id="profile-trigger" class="topbar-btn" aria-label="Profil du foyer"></button>
</div>
```

- [ ] **Step 2 : Ajouter le markup de la checklist dans `index.html`**

Dans `#variables-panel`, trouver la div `.form-kpi-bar` ajoutée en Task 2 :
```html
</div>
```
*(fermeture de `.form-kpi-bar`)*

Juste **après** cette fermeture, ajouter :
```html
<div class="guided-checklist" id="guided-checklist" hidden>
    <div class="guided-checklist__head">
        <span>Guide de saisie</span>
        <span class="guided-checklist__progress" id="guided-progress">0 / 8</span>
    </div>
    <div class="guided-checklist__bar-track">
        <div class="guided-checklist__bar-fill" id="guided-bar" style="width:0%"></div>
    </div>
    <div class="guided-checklist__section-label">Essentiels</div>
    <ul class="guided-checklist__list" id="guided-list-essentiel"></ul>
    <div class="guided-checklist__section-label">Importants</div>
    <ul class="guided-checklist__list" id="guided-list-important"></ul>
</div>
```

### 5b — JavaScript

- [ ] **Step 3 : Ajouter la clé localStorage et les nœuds DOM dans `main.js`**

Dans `STORAGE_KEYS`, ajouter :
```js
    guidedMode: 'investissementWebGuidedMode',
```

Dans `nodes`, ajouter (après `fkpiDscr`) :
```js
    guidedToggle: document.getElementById('guided-toggle'),
    guidedChecklist: document.getElementById('guided-checklist'),
    guidedProgress: document.getElementById('guided-progress'),
    guidedBar: document.getElementById('guided-bar'),
    guidedListEssentiel: document.getElementById('guided-list-essentiel'),
    guidedListImportant: document.getElementById('guided-list-important'),
```

- [ ] **Step 4 : Définir la configuration des champs guidés dans `main.js`**

Juste après la ligne `const VARIABLE_KEYS = Object.keys(VARIABLE_DEFAULTS);`, ajouter :

```js
const GUIDED_FIELDS = [
    { id: 'prix',       label: 'Prix affiché',    priority: 'essentiel', accordTitle: 'Acquisition' },
    { id: 'loyer',      label: 'Loyer cible',     priority: 'essentiel', accordTitle: 'Acquisition' },
    { id: 'taux-input', label: 'Taux d\'intérêt', priority: 'essentiel', accordTitle: 'Financement' },
    { id: 'duree',      label: 'Durée du prêt',   priority: 'essentiel', accordTitle: 'Financement' },
    { id: 'apport',     label: 'Apport',           priority: 'essentiel', accordTitle: 'Financement' },
    { id: 'vacance',    label: 'Vacance',           priority: 'important', accordTitle: 'Exploitation locative' },
    { id: 'fonciere',   label: 'Taxe foncière',    priority: 'important', accordTitle: 'Exploitation locative' },
    { id: 'regime',     label: 'Régime fiscal',    priority: 'important', accordTitle: 'Fiscalité' },
];
```

- [ ] **Step 5 : Ajouter les fonctions de gestion du mode guidé dans `main.js`**

Juste avant `function render(options = {}) {`, ajouter :

```js
function isGuidedModeActive() {
    return localStorage.getItem(STORAGE_KEYS.guidedMode) === 'true';
}

function setGuidedMode(active) {
    localStorage.setItem(STORAGE_KEYS.guidedMode, String(active));
    applyGuidedModeUI(active);
}

function applyGuidedModeUI(active) {
    if (!nodes.guidedToggle) return;
    nodes.guidedToggle.setAttribute('aria-pressed', String(active));
    nodes.guidedToggle.classList.toggle('is-active', active);
    if (nodes.guidedChecklist) nodes.guidedChecklist.hidden = !active;
    if (active) renderGuidedChecklist();
}

function isFieldFilled(fieldId) {
    const current = state.variablesData[fieldId];
    const def = VARIABLE_DEFAULTS[fieldId];
    if (current === undefined || current === null) return false;
    return String(current) !== String(def);
}

function renderGuidedChecklist() {
    if (!nodes.guidedListEssentiel || !nodes.guidedListImportant) return;

    const done = GUIDED_FIELDS.filter(f => isFieldFilled(f.id)).length;
    const total = GUIDED_FIELDS.length;
    const firstPending = GUIDED_FIELDS.find(f => !isFieldFilled(f.id));

    nodes.guidedProgress.textContent = `${done} / ${total}`;
    nodes.guidedBar.style.width = `${Math.round((done / total) * 100)}%`;

    function buildItem(field) {
        const filled = isFieldFilled(field.id);
        const isCurrent = firstPending && field.id === firstPending.id;
        const li = document.createElement('li');
        li.className = 'guided-checklist__item' +
            (filled ? ' is-done' : '') +
            (isCurrent ? ' is-current' : '');
        li.dataset.fieldId = field.id;

        const check = document.createElement('span');
        check.className = 'guided-checklist__check';
        check.textContent = filled ? '✓' : isCurrent ? '→' : '';

        const name = document.createElement('span');
        name.className = 'guided-checklist__name';
        name.textContent = field.label;

        li.appendChild(check);
        li.appendChild(name);
        li.addEventListener('click', () => openSpotlight(field.id));
        return li;
    }

    nodes.guidedListEssentiel.innerHTML = '';
    nodes.guidedListImportant.innerHTML = '';
    GUIDED_FIELDS.forEach(f => {
        const target = f.priority === 'essentiel' ? nodes.guidedListEssentiel : nodes.guidedListImportant;
        target.appendChild(buildItem(f));
    });
}
```

- [ ] **Step 6 : Appeler `renderGuidedChecklist` dans `renderWorkspaceContent`**

Dans `renderWorkspaceContent`, trouver la ligne ajoutée en Task 2 :
```js
    if (showVariables) renderFormKpiBar(analysisModel);
```
Juste **après**, ajouter :
```js
    if (showVariables && isGuidedModeActive()) renderGuidedChecklist();
```

- [ ] **Step 7 : Câbler le bouton dans `bindEvents`**

Dans `bindEvents`, trouver :
```js
    nodes.themeToggle.addEventListener('click', () => {
```
Juste **avant**, ajouter :
```js
    if (nodes.guidedToggle) {
        nodes.guidedToggle.addEventListener('click', () => {
            setGuidedMode(!isGuidedModeActive());
        });
    }
```

- [ ] **Step 8 : Initialiser le mode guidé au chargement**

À la fin de `main.js`, trouver la dernière ligne `render();` (appel initial) :
```js
render();
```
Remplacer par :
```js
render();
applyGuidedModeUI(isGuidedModeActive());
```

- [ ] **Step 9 : Vérifier dans le navigateur**

- Cliquer le bouton `Guide` dans la topbar → la checklist apparaît sous la barre KPIs
- Les champs dont la valeur diffère des défauts sont cochés (✓)
- Le premier champ non rempli est surligné en bleu
- La barre de progression et le compteur `x / 8` sont corrects
- Recharger la page → le mode guidé persiste (localStorage)
- Cliquer à nouveau → la checklist disparaît

- [ ] **Step 10 : Commit**

```bash
git add index.html main.js
git commit -m "feat: add guided mode toggle and progress checklist"
```

---

## Task 6 : Mode guidé — Spotlight

**Files:**
- Modify: `index.html` (markup spotlight)
- Modify: `main.js` (logique openSpotlight, navigateSpotlight, closeSpotlight)

### 6a — HTML

- [ ] **Step 1 : Ajouter le markup du spotlight dans `index.html`**

Juste avant la balise fermante `</body>`, ajouter :

```html
<div class="spotlight-overlay" id="spotlight-overlay" hidden role="dialog" aria-modal="true" aria-labelledby="spotlight-title">
    <div class="spotlight-card">
        <div class="spotlight-card__header">
            <span class="spotlight-card__step" id="spotlight-step">1 / 8</span>
            <span class="spotlight-card__title" id="spotlight-title"></span>
        </div>
        <input class="spotlight-card__input" id="spotlight-input" type="text" autocomplete="off">
        <p class="spotlight-card__desc" id="spotlight-desc"></p>
        <div class="spotlight-card__actions">
            <button type="button" id="spotlight-prev">← Précédent</button>
            <button type="button" id="spotlight-next" class="is-primary">Suivant →</button>
        </div>
    </div>
</div>
```

### 6b — JavaScript

- [ ] **Step 2 : Ajouter les nœuds du spotlight dans `nodes`**

Dans `nodes`, ajouter (après les nœuds guidedList) :
```js
    spotlightOverlay: document.getElementById('spotlight-overlay'),
    spotlightStep: document.getElementById('spotlight-step'),
    spotlightTitle: document.getElementById('spotlight-title'),
    spotlightInput: document.getElementById('spotlight-input'),
    spotlightDesc: document.getElementById('spotlight-desc'),
    spotlightPrev: document.getElementById('spotlight-prev'),
    spotlightNext: document.getElementById('spotlight-next'),
```

- [ ] **Step 3 : Ajouter les fonctions spotlight dans `main.js`**

Juste avant `function render(options = {}) {`, ajouter :

```js
let _spotlightFieldId = null;

function openSpotlight(fieldId) {
    const idx = GUIDED_FIELDS.findIndex(f => f.id === fieldId);
    if (idx === -1) return;
    _spotlightFieldId = fieldId;

    const field = GUIDED_FIELDS[idx];
    const realInput = document.getElementById(field.id);
    if (!realInput) return;

    // Ouvrir l'accordéon parent si fermé
    const accordHead = [...document.querySelectorAll('.accord-head')]
        .find(btn => btn.querySelector('.accord-title')?.textContent === field.accordTitle);
    if (accordHead) {
        const section = accordHead.closest('.accord-section');
        if (section && section.dataset.open !== 'true') accordHead.click();
    }

    const tip = realInput.closest('label')?.querySelector('[data-tip]')?.dataset.tip ?? '';

    nodes.spotlightStep.textContent = `${idx + 1} / ${GUIDED_FIELDS.length}`;
    nodes.spotlightTitle.textContent = field.label;
    nodes.spotlightInput.value = realInput.value;
    nodes.spotlightInput.type = realInput.type === 'number' ? 'number' : 'text';
    nodes.spotlightDesc.textContent = tip;
    nodes.spotlightOverlay.hidden = false;
    nodes.spotlightInput.focus();
    nodes.spotlightInput.select();
}

function closeSpotlight() {
    nodes.spotlightOverlay.hidden = true;
    _spotlightFieldId = null;
}

function navigateSpotlight(direction) {
    const idx = GUIDED_FIELDS.findIndex(f => f.id === _spotlightFieldId);
    const next = idx + direction;
    if (next >= 0 && next < GUIDED_FIELDS.length) {
        openSpotlight(GUIDED_FIELDS[next].id);
    } else {
        closeSpotlight();
    }
}

function syncSpotlightInputToField(value) {
    if (!_spotlightFieldId) return;
    const realInput = document.getElementById(_spotlightFieldId);
    if (!realInput) return;
    realInput.value = value;
    realInput.dispatchEvent(new Event('input', { bubbles: true }));
}
```

- [ ] **Step 4 : Câbler les événements du spotlight dans `bindEvents`**

Dans `bindEvents`, juste avant la dernière accolade fermante `}`, ajouter :

```js
    // Spotlight
    if (nodes.spotlightInput) {
        nodes.spotlightInput.addEventListener('input', e => {
            syncSpotlightInputToField(e.target.value);
        });
        nodes.spotlightInput.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); navigateSpotlight(1); }
            if (e.key === 'Escape') closeSpotlight();
        });
    }
    if (nodes.spotlightNext) nodes.spotlightNext.addEventListener('click', () => navigateSpotlight(1));
    if (nodes.spotlightPrev) nodes.spotlightPrev.addEventListener('click', () => navigateSpotlight(-1));
    if (nodes.spotlightOverlay) {
        nodes.spotlightOverlay.addEventListener('click', e => {
            if (e.target === nodes.spotlightOverlay) closeSpotlight();
        });
    }
```

- [ ] **Step 5 : Fermer le spotlight si le mode guidé est désactivé**

Dans `setGuidedMode`, ajouter :
```js
function setGuidedMode(active) {
    localStorage.setItem(STORAGE_KEYS.guidedMode, String(active));
    if (!active) closeSpotlight();
    applyGuidedModeUI(active);
}
```

*(Remplacer la version précédente de `setGuidedMode` par celle-ci.)*

- [ ] **Step 6 : Vérifier dans le navigateur**

- Mode guidé actif → cliquer un item de la checklist → le spotlight apparaît
- L'accordéon parent s'ouvre automatiquement si fermé
- Taper dans l'input du spotlight → la valeur du vrai champ change + la barre KPIs se met à jour
- Cliquer Suivant → passe au champ suivant dans la liste
- Cliquer Précédent → revient au champ précédent
- Appuyer Entrée → avance au suivant
- Appuyer Échap → ferme le spotlight
- Cliquer en dehors de la carte → ferme le spotlight
- Désactiver le mode guidé → le spotlight se ferme si ouvert
- Tester sur une largeur < 640px → les 2 colonnes Solidité/Stress passent en 1 colonne

- [ ] **Step 7 : Commit final**

```bash
git add index.html main.js
git commit -m "feat: add guided mode spotlight for field-by-field assistance"
```

---

## Self-Review

**Couverture de la spec :**

| Fonctionnalité spec | Tâche plan |
|---|---|
| Barre KPIs collante (rendement brut, CF, DSCR) | Task 2 |
| Badges ESSENTIEL / IMPORTANT / AVANCÉ sur accordéons | Task 3 |
| Fond teinté + chevron doré sur sections Essentiel ouvertes | Task 1 (CSS) + Task 3 (data-priority) |
| Réorganisation panel analyse (①–⑤) | Task 4 |
| Solidité + Stress en 2 colonnes | Task 4 |
| Bouton mode guidé topbar | Task 5 |
| Checklist latérale avec progression | Task 5 |
| Spotlight champ par champ | Task 6 |
| Sync spotlight → champ réel via dispatchEvent | Task 6, Step 3 |
| Mode guidé non visible dans fenêtre analyse (`IS_ANALYSIS_WINDOW`) | Task 5 Step 6 : `if (showVariables && ...)` couvre déjà ce cas |

**Placeholder scan :** aucun TBD, aucun "implement later". Chaque step contient le code complet.

**Cohérence des types :**
- `_spotlightFieldId` est initialisé à `null` et utilisé de manière cohérente dans toutes les fonctions spotlight.
- `GUIDED_FIELDS[idx].id` correspond exactement aux IDs HTML dans `index.html` et aux clés de `VARIABLE_DEFAULTS`.
- `nodes.fkpiRdtBrut` etc. sont déclarés dans `nodes` avant utilisation dans `renderFormKpiBar`.
- `.form-kpi-bar__value--gold` / `--green` / `--red` sont définis en Task 1 et utilisés en Task 2.
- `renderGuidedChecklist` appelle `openSpotlight` qui est définie en Task 6 — attention à l'ordre des tasks lors de l'exécution : Task 5 puis Task 6.
