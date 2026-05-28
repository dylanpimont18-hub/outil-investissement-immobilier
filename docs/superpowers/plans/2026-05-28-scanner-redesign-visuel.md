# Scanner — Refonte visuelle ciblée Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesigner les 3 zones problématiques du Scanner (header, barre de recherche, filtres) pour un rendu professionnel style portail immobilier avec sidebar latérale fixe.

**Architecture:** Modifications HTML/CSS/JS ciblées : `#scanner-controls` → `.scanner-header`, `#scanner-search-bar` → `.scanner-search-bar-v2`, `#scanner-filters` → `<aside>` sidebar dans un wrapper `.scanner-content-layout`. Le tableau, le drawer, la carte et les stats restent inchangés.

**Tech Stack:** HTML vanilla, CSS custom properties (design system existant `var(--accent-gold)`, `var(--surface)`, etc.), JS ES modules

---

## Fichiers modifiés

| Fichier | Ce qui change |
|---|---|
| `styles.css` | Nouvelles classes pour les 3 zones (après `.scanner-empty` ~ligne 2873) |
| `index.html` | Remplace `#scanner-controls`, restructure `#scanner-search-bar`, ajoute `.scanner-content-layout` |
| `scanner.js` | `_loadResults` affiche le content-layout + subtitle, `_bindButtons` retire toggle show/hide, `_openFilterAndScroll` simplifié |

---

### Task 1: CSS — Zone A : styles du header

**Fichiers :**
- Modifier : `styles.css` après le bloc `.scanner-empty` (~ligne 2873)

- [ ] **Ajouter** les classes suivantes dans `styles.css` après `.scanner-empty` :

```css
/* ── Scanner header (Zone A) ── */
.scanner-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 24px 18px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
}
.scanner-header-left { flex: 1; min-width: 200px; }
.scanner-header-kicker {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .1em;
  color: var(--accent-gold);
  margin-bottom: 4px;
}
.scanner-header-title {
  font-size: 22px;
  font-weight: 800;
  color: var(--text);
  letter-spacing: -.02em;
  line-height: 1.2;
  margin: 0;
}
.scanner-header-sub {
  font-size: 12px;
  color: var(--muted);
  margin-top: 4px;
}
.scanner-header-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
```

- [ ] **Committer**

```bash
git add styles.css
git commit -m "style(scanner): add scanner-header CSS classes"
```

---

### Task 2: HTML — Zone A : remplacer #scanner-controls

**Fichiers :**
- Modifier : `index.html` (`#scanner-panel`, le premier enfant)

- [ ] **Remplacer** le bloc entier `<div id="scanner-controls" class="scanner-controls">…</div>` par :

```html
<!-- Zone A : Header -->
<div class="scanner-header">
  <div class="scanner-header-left">
    <p class="scanner-header-kicker">📡 Scanner d'annonces</p>
    <h2 class="scanner-header-title">Opportunités locatives</h2>
    <p id="scanner-header-sub" class="scanner-header-sub">Centre-Val de Loire</p>
  </div>
  <div class="scanner-header-right">
    <div id="scanner-status-chip" class="scanner-status-chip scanner-status--idle">
      <span id="scanner-status-dot" class="scanner-status-dot"></span>
      <span id="scanner-status-label">En attente</span>
    </div>
    <button id="btn-clear-cache" class="scanner-btn scanner-btn--ghost">🗑 Vider le cache</button>
    <button id="btn-scan-full" class="scanner-btn scanner-btn--outline">↺ Scan complet</button>
    <button id="btn-scan" class="scanner-btn scanner-btn--primary">▶ Lancer un scan</button>
  </div>
</div>
```

- [ ] **Committer**

```bash
git add index.html
git commit -m "feat(scanner): redesign header Zone A"
```

---

### Task 3: CSS — Zone C : styles de la barre de recherche

**Fichiers :**
- Modifier : `styles.css` après les classes `.scanner-header-right` ajoutées en Task 1

- [ ] **Ajouter** :

```css
/* ── Scanner search bar v2 (Zone C) ── */
.scanner-search-bar-v2 {
  display: flex;
  align-items: stretch;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--surface-strong);
  margin: 12px 24px;
  overflow: visible;
  position: relative;
}
.scanner-search-cp-segment {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-right: 1px solid var(--border);
  min-width: 0;
}
.scanner-search-cp-icon { font-size: 14px; flex-shrink: 0; color: var(--muted); }
.scanner-search-cp-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  font-size: 13px;
  color: var(--text);
  font-family: inherit;
  min-width: 0;
}
.scanner-search-cp-input::placeholder { color: var(--muted); }
.scanner-search-pill {
  padding: 10px 16px;
  font-size: 12px;
  font-weight: 500;
  color: var(--muted);
  background: transparent;
  border: none;
  border-right: 1px solid var(--border);
  cursor: pointer;
  white-space: nowrap;
  font-family: inherit;
  transition: color .15s;
}
.scanner-search-pill:hover { color: var(--text); }
.scanner-search-filters-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 18px;
  background: rgba(197, 160, 89, 0.1);
  border: none;
  border-left: 1px solid rgba(197, 160, 89, 0.25);
  border-radius: 0 10px 10px 0;
  color: var(--accent-gold);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
  font-family: inherit;
  transition: background .15s;
}
.scanner-search-filters-btn:hover { background: rgba(197, 160, 89, 0.18); }
```

- [ ] **Committer**

```bash
git add styles.css
git commit -m "style(scanner): add search bar v2 CSS classes"
```

---

### Task 4: HTML — Zone C : remplacer #scanner-search-bar

**Fichiers :**
- Modifier : `index.html`

- [ ] **Remplacer** le bloc entier `<div id="scanner-search-bar" class="scanner-search-bar" style="display:none">…</div>` par :

```html
<!-- Zone C : Barre de recherche -->
<div id="scanner-search-bar" class="scanner-search-bar-v2" style="display:none">
  <div class="scanner-search-cp-segment">
    <span class="scanner-search-cp-icon">📍</span>
    <div style="position:relative;flex:1;min-width:0">
      <input id="cp-search" type="text" placeholder="Code postal ou ville…" autocomplete="off" class="scanner-search-cp-input">
      <div id="cp-dropdown" style="display:none;position:absolute;top:calc(100% + 4px);left:0;min-width:280px;z-index:200;background:var(--surface);border:1px solid var(--border);border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,0.3);max-height:220px;overflow-y:auto"></div>
    </div>
    <span id="cp-active-badge" style="display:none;padding:3px 10px;background:rgba(197,160,89,0.15);color:var(--accent-gold);border:1px solid rgba(197,160,89,0.3);border-radius:6px;font-size:12px;font-weight:600;white-space:nowrap"></span>
    <button id="cp-reset" style="display:none;padding:4px 10px;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--muted);font-size:11px;cursor:pointer;font-family:inherit">× Réinit.</button>
  </div>
  <button class="scanner-search-pill" id="qf-budget-btn">Budget <span class="scanner-qf-arrow">▾</span></button>
  <button class="scanner-search-pill" id="qf-pieces-btn">Pièces <span class="scanner-qf-arrow">▾</span></button>
  <button class="scanner-search-pill" id="qf-surface-btn">Surface <span class="scanner-qf-arrow">▾</span></button>
  <button class="scanner-search-pill" id="qf-type-btn">Type <span class="scanner-qf-arrow">▾</span></button>
  <button id="btn-toggle-filters" class="scanner-search-filters-btn">
    ☰ Tous les filtres
    <span id="scanner-filter-count-badge" class="scanner-filter-badge" style="display:none"></span>
  </button>
</div>
```

- [ ] **Committer**

```bash
git add index.html
git commit -m "feat(scanner): redesign search bar Zone C"
```

---

### Task 5: CSS — Zone D : sidebar + content layout

**Fichiers :**
- Modifier : `styles.css` après les classes `.scanner-search-filters-btn`

- [ ] **Ajouter** :

```css
/* ── Scanner content layout + sidebar filtres (Zone D) ── */
.scanner-content-layout {
  display: flex;
  align-items: flex-start;
}
.scanner-filter-sidebar {
  width: 260px;
  flex-shrink: 0;
  position: sticky;
  top: 0;
  max-height: calc(100vh - 180px);
  overflow-y: auto;
  border-right: 1px solid var(--border);
  background: var(--surface);
  display: flex;
  flex-direction: column;
}
.scanner-sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 10px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.scanner-sidebar-title {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .08em;
  color: var(--text);
}
.scanner-main-area {
  flex: 1;
  min-width: 0;
}
.scanner-filter-sidebar .scanner-filter-section {
  border-bottom: 1px solid var(--border);
  padding: 14px 16px;
}
.scanner-filter-sidebar .scanner-filter-section:last-of-type { border-bottom: none; }
.scanner-filter-sidebar .scanner-filter-footer {
  position: sticky;
  bottom: 0;
  background: var(--surface);
  border-top: 1px solid var(--border);
  padding: 10px 16px;
  margin-top: auto;
  flex-shrink: 0;
}
.scanner-filter-sidebar .scanner-filter-panel-header { display: none; }
```

- [ ] **Committer**

```bash
git add styles.css
git commit -m "style(scanner): add sidebar + content layout CSS"
```

---

### Task 6: HTML — Zone D : wrapper content layout + sidebar

**Fichiers :**
- Modifier : `index.html`

L'ordre actuel dans `#scanner-panel` après la search bar est : `#scanner-progress`, `#scanner-view-tabs`, `#scanner-map-container`, `#scanner-stats`, `#scanner-filters`, `#scanner-results`, `#scanner-empty`.

- [ ] **Déplacer** `#scanner-view-tabs` et `#scanner-map-container` pour qu'ils soient dans la zone principale (`.scanner-main-area`). Ils étaient avant `#scanner-stats` ; ils doivent être après, dans le content-layout.

- [ ] **Remplacer** la balise ouvrante `<div id="scanner-filters" class="scanner-filter-panel" style="display:none">` par `<aside id="scanner-filters" class="scanner-filter-sidebar">` (sans `style="display:none"` — la sidebar est visible quand le content-layout est visible).

- [ ] **Remplacer** le bloc `<div class="scanner-filter-panel-header">…</div>` (contient `#btn-hide-filters` et `#scanner-filter-count`) par :

```html
<div class="scanner-sidebar-header">
  <span class="scanner-sidebar-title">Filtres</span>
  <span id="scanner-filter-count" class="scanner-filter-count"></span>
</div>
```

- [ ] **Fermer** le `<aside>` avec `</aside>` à la place du `</div>` de fermeture de l'ancien `#scanner-filters`.

- [ ] La structure finale dans `#scanner-panel` doit être :

```html
<!-- Progression -->
<div id="scanner-progress" class="scanner-progress" style="display:none">…</div>

<!-- Stats pleine largeur -->
<div id="scanner-stats" class="scanner-stats-row" style="display:none"></div>

<!-- Content layout -->
<div id="scanner-content-layout" class="scanner-content-layout" style="display:none">

  <aside id="scanner-filters" class="scanner-filter-sidebar">
    <div class="scanner-sidebar-header">
      <span class="scanner-sidebar-title">Filtres</span>
      <span id="scanner-filter-count" class="scanner-filter-count"></span>
    </div>
    <!-- toutes les scanner-filter-section existantes, inchangées -->
    <div class="scanner-filter-footer">
      <button id="scanner-filter-reset" class="scanner-btn scanner-btn--ghost" style="font-size:12px;padding:5px 16px">↺ Réinitialiser</button>
      <div style="flex:1"></div>
      <button id="btn-voir-resultats" class="scanner-voir-resultats-btn">
        VOIR LES ANNONCES (<span id="filter-result-count">—</span>)
      </button>
    </div>
  </aside>

  <div class="scanner-main-area">
    <div id="scanner-view-tabs" style="display:none;margin:12px 16px;gap:8px">
      <!-- boutons Tableau / Carte inchangés -->
    </div>
    <div id="scanner-map-container" style="display:none;margin:0 16px;border-radius:12px;overflow:hidden;border:1px solid var(--border)">
      <!-- contenu carte inchangé -->
    </div>
    <div id="scanner-results" class="scanner-results-wrap" style="display:none"></div>
  </div>

</div>

<!-- État vide -->
<div id="scanner-empty" class="scanner-empty">…</div>
```

- [ ] **Committer**

```bash
git add index.html
git commit -m "feat(scanner): add content layout + sidebar structure Zone D"
```

---

### Task 7: JS — Adapter scanner.js

**Fichiers :**
- Modifier : `scanner.js`

**7a — Afficher `#scanner-content-layout` dans `_loadResults`**

- [ ] Dans `_loadResults` (~ligne 416), après la ligne `document.getElementById('scanner-search-bar')?.style.setProperty('display', '');`, ajouter :

```js
document.getElementById('scanner-content-layout')?.style.setProperty('display', 'flex');
```

**7b — Mettre à jour le sous-titre du header**

- [ ] Dans `_loadResults`, juste après l'appel `_setStatus('done', …)` (~ligne 419), ajouter :

```js
const headerSub = document.getElementById('scanner-header-sub');
if (headerSub && data.generated_at) {
  headerSub.textContent = 'Centre-Val de Loire · Dernier scan : ' + _fmtDatetime(data.generated_at);
}
```

**7c — Retirer le toggle show/hide de `#btn-toggle-filters`**

- [ ] Dans `_bindButtons`, **supprimer** le bloc listener `document.getElementById('btn-toggle-filters')?.addEventListener('click', () => { … })` en entier (le bouton affiche juste le badge, la sidebar est toujours visible).

- [ ] Dans `_bindButtons`, **supprimer** le listener `document.getElementById('btn-hide-filters')` en entier (bouton retiré du HTML).

**7d — Simplifier `_openFilterAndScroll`**

- [ ] **Remplacer** la fonction `_openFilterAndScroll` (~ligne 287) par :

```js
function _openFilterAndScroll(sectionIndex) {
  const sidebar = document.getElementById('scanner-filters');
  if (!sidebar) return;
  const sections = sidebar.querySelectorAll('.scanner-filter-section');
  if (sections[sectionIndex]) {
    setTimeout(() => sections[sectionIndex].scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
  }
}
```

**7e — Simplifier `#btn-voir-resultats`**

- [ ] Dans `_bindButtons`, **remplacer** le listener `#btn-voir-resultats` par :

```js
document.getElementById('btn-voir-resultats')?.addEventListener('click', () => {
  document.getElementById('scanner-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
```

- [ ] **Committer**

```bash
git add scanner.js
git commit -m "feat(scanner): adapt JS for sidebar layout and header subtitle"
```

---

### Task 8: Vérification visuelle

**Fichiers :** aucun

- [ ] Lancer : `python app.py`

- [ ] **Zone A** — onglet Scanner : header affiche "Opportunités locatives", kicker gold, sous-titre, boutons ghost→outline→CTA gold, status chip à gauche des boutons.

- [ ] **Zone C** — barre de recherche unifiée : champ CP, 4 pills, bouton "☰ Tous les filtres" doré à droite.

- [ ] **Zone D** — après chargement de résultats (`/api/results`) : sidebar 260px à gauche avec sections filtres, tableau dans la zone principale à droite.

- [ ] Sous-titre du header mis à jour avec la date du dernier scan.

- [ ] Les filtres (checkboxes, sliders) filtrent toujours le tableau correctement.

- [ ] Vérifier thème clair et thème sombre.

- [ ] Si ajustements mineurs nécessaires, committer :

```bash
git add index.html styles.css scanner.js
git commit -m "fix(scanner): visual tweaks after review"
```
