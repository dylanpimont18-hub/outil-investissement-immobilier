# Portfolio Ergonomie UX — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Améliorer la fluidité de navigation du panneau portefeuille via 7 améliorations ergonomiques indépendantes.

**Architecture:** Tout dans `main.js` (logique) et `styles.css` (animations/layout). Une ligne ajoutée dans `index.html` pour le bouton densité. Les tâches sont ordonnées par dépendance : Task 3 (drag-order) introduit `getOrderedAssetList()` utilisé par Task 4 (prev/next).

**Tech Stack:** Vanilla JS, CSS transitions, HTML5 Drag and Drop API, contenteditable.

---

## Task 1 : Restauration du scroll au retour liste

**Files:**
- Modify: `main.js` — fonctions `openOwnedDetail` (~l.4537) et `closeOwnedDetail` (~l.4563)

La liste est dans `#owned-list-view`. La page entière scrolle (window). On sauvegarde `window.scrollY` avant de cacher la liste, on le restaure après réaffichage.

- [ ] **Step 1 : Sauvegarder le scroll à l'ouverture du détail**

Dans `openOwnedDetail(assetId)`, ajouter en première ligne du corps de la fonction (avant `state.activeOwnedAssetId = assetId`) :

```js
state._listScrollY = window.scrollY;
```

- [ ] **Step 2 : Restaurer le scroll à la fermeture**

Dans `closeOwnedDetail()`, après `renderOwnedPortfolioList()`, ajouter :

```js
requestAnimationFrame(() => {
    window.scrollTo({ top: state._listScrollY || 0, behavior: 'instant' });
});
```

- [ ] **Step 3 : Vérifier**

Ajouter 4+ biens, scroller bas, cliquer le dernier bien, revenir — la liste doit reprendre la même position.

- [ ] **Step 4 : Commit**

```bash
git add main.js
git commit -m "feat(portfolio): restaurer position scroll au retour liste"
```

---

## Task 2 : Renommage inline depuis l'en-tête détail

**Files:**
- Modify: `main.js` — `renderOwnedDetail()` (~l.4586)

Le titre du bien dans l'en-tête (`nodes.ownedDetailTitle`) est actuellement un div statique. On le remplace par un `contenteditable` qui sauvegarde via `updateOwnedAsset` au blur/Enter.

- [ ] **Step 1 : Remplacer le rendu du titre**

Dans `renderOwnedDetail()`, remplacer le bloc :

```js
if (nodes.ownedDetailTitle) {
    nodes.ownedDetailTitle.innerHTML = `
        <div class="owned-detail-title__name">${escapeHtml(asset.nom)}</div>
        <div class="owned-detail-title__meta">${escapeHtml(asset.ville)}${asset.anneeAchat ? ` · Acquis ${asset.anneeAchat}` : ''}</div>
    `;
}
```

Par :

```js
if (nodes.ownedDetailTitle) {
    nodes.ownedDetailTitle.innerHTML = `
        <div class="owned-detail-title__name"
             contenteditable="true"
             data-rename-asset="${escapeHtml(asset.id)}"
             spellcheck="false"
             title="Cliquer pour renommer">${escapeHtml(asset.nom)}</div>
        <div class="owned-detail-title__meta">${escapeHtml(asset.ville)}${asset.anneeAchat ? ` · Acquis ${asset.anneeAchat}` : ''}</div>
    `;
    const nameEl = nodes.ownedDetailTitle.querySelector('[data-rename-asset]');
    if (nameEl) {
        const originalName = asset.nom;
        nameEl.addEventListener('blur', () => {
            const newName = nameEl.textContent.trim();
            if (!newName) { nameEl.textContent = originalName; return; }
            if (newName === originalName) return;
            updateOwnedAsset(asset.id, { nom: newName });
            renderOwnedPortfolioList();
        });
        nameEl.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); }
            if (e.key === 'Escape') { nameEl.textContent = originalName; nameEl.blur(); }
        });
    }
}
```

- [ ] **Step 2 : Styler le contenteditable pour ressembler au titre**

Dans `styles.css`, trouver le sélecteur `.owned-detail-title__name` existant et ajouter :

```css
.owned-detail-title__name[contenteditable] {
    cursor: text;
    border-radius: 4px;
    padding: 2px 6px;
    margin: -2px -6px;
    outline: none;
    transition: background .15s;
}
.owned-detail-title__name[contenteditable]:hover {
    background: var(--surface-2, rgba(0,0,0,.06));
}
.owned-detail-title__name[contenteditable]:focus {
    background: var(--surface-2, rgba(0,0,0,.06));
    box-shadow: 0 0 0 2px var(--accent);
}
```

- [ ] **Step 3 : Vérifier**

Ouvrir un bien → cliquer le titre → saisir un nouveau nom → Enter ou clic ailleurs → le nom change dans le titre ET dans le tableau liste.

- [ ] **Step 4 : Commit**

```bash
git add main.js styles.css
git commit -m "feat(portfolio): renommage inline depuis l'en-tête détail"
```

---

## Task 3 : Drag-to-reorder + helper `getOrderedAssetList()`

**Files:**
- Modify: `main.js` — `renderOwnedPortfolioList()` (~l.4244), état initial, constantes STORAGE_KEYS

Ajouter `state.ownedOrder` (tableau d'IDs) persisté en localStorage. Ajouter une poignée de drag sur chaque ligne. Introduire `getOrderedAssetList()` réutilisé par Task 4.

- [ ] **Step 1 : Ajouter la clé de stockage**

Trouver `const STORAGE_KEYS = {` (début de main.js) et ajouter :

```js
ownedOrder: 'investissementWebOwnedOrder',
```

- [ ] **Step 2 : Ajouter `getOrderedAssetList()`**

Ajouter cette fonction juste avant `renderOwnedPortfolioList` :

```js
function getOrderedAssetList() {
    const assets = loadOwnedAssets();
    const list = Object.values(assets);
    const order = state.ownedOrder || [];
    if (!order.length) return list;
    const orderMap = Object.fromEntries(order.map((id, i) => [id, i]));
    return [...list].sort((a, b) => {
        const ia = orderMap[a.id] ?? Infinity;
        const ib = orderMap[b.id] ?? Infinity;
        return ia - ib;
    });
}
```

- [ ] **Step 3 : Charger l'ordre depuis localStorage à l'initialisation**

Trouver le bloc d'initialisation de `state` (objet `state = { ... }`) et ajouter :

```js
ownedOrder: JSON.parse(localStorage.getItem(STORAGE_KEYS.ownedOrder) || '[]'),
```

- [ ] **Step 4 : Remplacer `Object.values(assets)` par `getOrderedAssetList()` dans `renderOwnedPortfolioList`**

Dans `renderOwnedPortfolioList`, remplacer les deux lignes :

```js
const assets = loadOwnedAssets();
const list = Object.values(assets);
```

Par :

```js
const list = getOrderedAssetList();
```

- [ ] **Step 5 : Ajouter la colonne poignée dans le `<thead>`**

Dans le template du tableau (dans `renderOwnedPortfolioList`), ajouter `<th class="owned-col-drag"></th>` comme premier `<th>` :

```js
nodes.ownedListTable.innerHTML = yearSelectorHtml + `
    <table>
        <thead>
            <tr>
                <th class="owned-col-drag"></th>
                <th></th>
                <th>Bien</th>
                ...
```

- [ ] **Step 6 : Ajouter la cellule poignée dans chaque `<tr>` de données**

Dans le template de chaque ligne, ajouter en première `<td>` :

```js
return `
<tr data-asset-id="${escapeHtml(asset.id)}" draggable="true">
    <td class="owned-col-drag owned-drag-handle" title="Glisser pour réordonner">⠿</td>
    <td style="padding:6px 4px 6px 0;width:52px">${donutHtml}</td>
    ...
```

- [ ] **Step 7 : Câbler les événements drag dans `renderOwnedPortfolioList` (après innerHTML)**

Après la boucle qui attache les listeners (`rows.forEach`), ajouter :

```js
// Drag-to-reorder
let _dragSrcId = null;
nodes.ownedListTable.querySelectorAll('tr[data-asset-id]').forEach(tr => {
    tr.addEventListener('dragstart', e => {
        _dragSrcId = tr.dataset.assetId;
        tr.classList.add('owned-row--dragging');
        e.dataTransfer.effectAllowed = 'move';
    });
    tr.addEventListener('dragend', () => {
        tr.classList.remove('owned-row--dragging');
        nodes.ownedListTable.querySelectorAll('.owned-row--dragover').forEach(r => r.classList.remove('owned-row--dragover'));
    });
    tr.addEventListener('dragover', e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        nodes.ownedListTable.querySelectorAll('.owned-row--dragover').forEach(r => r.classList.remove('owned-row--dragover'));
        if (tr.dataset.assetId !== _dragSrcId) tr.classList.add('owned-row--dragover');
    });
    tr.addEventListener('drop', e => {
        e.preventDefault();
        const targetId = tr.dataset.assetId;
        if (!_dragSrcId || _dragSrcId === targetId) return;
        const currentList = getOrderedAssetList();
        const ids = currentList.map(a => a.id);
        const fromIdx = ids.indexOf(_dragSrcId);
        const toIdx = ids.indexOf(targetId);
        if (fromIdx < 0 || toIdx < 0) return;
        ids.splice(fromIdx, 1);
        ids.splice(toIdx, 0, _dragSrcId);
        state.ownedOrder = ids;
        localStorage.setItem(STORAGE_KEYS.ownedOrder, JSON.stringify(ids));
        renderOwnedPortfolioList();
    });
});
```

- [ ] **Step 8 : Styler la poignée et les états drag**

Ajouter dans `styles.css` :

```css
.owned-col-drag { width: 24px; }
.owned-drag-handle {
    cursor: grab;
    color: var(--text-muted);
    font-size: 14px;
    user-select: none;
    text-align: center;
}
.owned-drag-handle:active { cursor: grabbing; }
.owned-row--dragging { opacity: .4; }
.owned-row--dragover > td { background: var(--accent-subtle, rgba(197,160,89,.12)); }
```

- [ ] **Step 9 : Vérifier**

Glisser une ligne vers une autre position → ordre change et se persiste au rechargement.

- [ ] **Step 10 : Commit**

```bash
git add main.js styles.css
git commit -m "feat(portfolio): drag-to-reorder + helper getOrderedAssetList"
```

---

## Task 4 : Navigation prev/next entre biens

**Files:**
- Modify: `main.js` — `renderOwnedDetail()` (~l.4580), en-tête HTML inline

Utilise `getOrderedAssetList()` de Task 3 pour connaître l'index courant et calculer prev/next.

- [ ] **Step 1 : Ajouter les boutons dans le rendu de l'en-tête**

Dans `renderOwnedDetail()`, après le bloc qui rend `nodes.ownedDetailTitle`, ajouter :

```js
// Navigation prev/next
const orderedList = getOrderedAssetList();
const currentIdx = orderedList.findIndex(a => a.id === assetId);
const prevAsset = currentIdx > 0 ? orderedList[currentIdx - 1] : null;
const nextAsset = currentIdx < orderedList.length - 1 ? orderedList[currentIdx + 1] : null;

let navEl = document.getElementById('owned-detail-nav');
if (!navEl) {
    navEl = document.createElement('div');
    navEl.id = 'owned-detail-nav';
    navEl.className = 'owned-detail-nav';
    // Insérer avant le titre dans l'en-tête
    const header = document.querySelector('.owned-detail-header');
    if (header) header.insertBefore(navEl, header.querySelector('#owned-detail-title'));
}
navEl.innerHTML = `
    <button class="btn btn--ghost btn--sm owned-nav-btn" 
            data-nav-asset="${prevAsset ? escapeHtml(prevAsset.id) : ''}"
            ${!prevAsset ? 'disabled' : ''}
            title="${prevAsset ? escapeHtml(prevAsset.nom) : ''}">‹</button>
    <span class="owned-nav-pos">${currentIdx + 1} / ${orderedList.length}</span>
    <button class="btn btn--ghost btn--sm owned-nav-btn"
            data-nav-asset="${nextAsset ? escapeHtml(nextAsset.id) : ''}"
            ${!nextAsset ? 'disabled' : ''}
            title="${nextAsset ? escapeHtml(nextAsset.nom) : ''}">›</button>
`;
navEl.querySelectorAll('[data-nav-asset]').forEach(btn => {
    if (!btn.dataset.navAsset) return;
    btn.addEventListener('click', () => openOwnedDetail(btn.dataset.navAsset));
});
```

- [ ] **Step 2 : Nettoyer le navEl au retour liste**

Dans `closeOwnedDetail()`, avant `renderOwnedPortfolioList()`, ajouter :

```js
const navEl = document.getElementById('owned-detail-nav');
if (navEl) navEl.remove();
```

- [ ] **Step 3 : Styler la navigation**

Ajouter dans `styles.css` :

```css
.owned-detail-nav {
    display: flex;
    align-items: center;
    gap: 4px;
}
.owned-nav-pos {
    font-size: .75rem;
    color: var(--text-muted);
    min-width: 40px;
    text-align: center;
}
.owned-nav-btn { min-width: 28px; }
```

- [ ] **Step 4 : Vérifier**

En vue détail : les boutons ‹ et › naviguent entre biens, le compteur "2 / 5" s'affiche, les boutons disabled aux extrémités.

- [ ] **Step 5 : Commit**

```bash
git add main.js styles.css
git commit -m "feat(portfolio): navigation prev/next entre biens en vue détail"
```

---

## Task 5 : Expand row — aperçu inline sans quitter la liste

**Files:**
- Modify: `main.js` — `renderOwnedPortfolioList()`, initialisation state

Ajouter un bouton toggle (▶ / ▼) sur chaque ligne. Clic → une ligne `<tr class="owned-expanded-row">` apparaît dessous avec 4 métriques clés. Le clic sur le nom reste l'ouverture du détail complet.

- [ ] **Step 1 : Ajouter `state.ownedExpandedIds`**

Dans l'objet `state = { ... }`, ajouter :

```js
ownedExpandedIds: new Set(),
```

- [ ] **Step 2 : Ajouter le bouton expand dans chaque ligne**

Dans le template `<tr>` de chaque bien, modifier la première colonne (donut) pour y inclure le toggle expand. Remplacer :

```js
<td style="padding:6px 4px 6px 0;width:52px">${donutHtml}</td>
```

Par :

```js
<td style="padding:6px 4px 6px 0;width:52px">
    <button class="owned-expand-btn" data-expand-id="${escapeHtml(asset.id)}" title="Aperçu rapide">
        ${state.ownedExpandedIds.has(asset.id) ? '▾' : '▸'}
    </button>
    ${donutHtml}
</td>
```

- [ ] **Step 3 : Rendre la ligne expanded après chaque `<tr>` principal**

Après le `return \`<tr ...>...</tr>\`` de chaque asset, ajouter la ligne expanded conditionnelle. La map doit renvoyer les deux lignes ensemble :

```js
const mainRow = `
<tr data-asset-id="${escapeHtml(asset.id)}" draggable="true">
    ...
</tr>`;

const isExpanded = state.ownedExpandedIds.has(asset.id);
const expandedRow = isExpanded ? `
<tr class="owned-expanded-row" data-expanded-for="${escapeHtml(asset.id)}">
    <td colspan="8">
        <div class="owned-expanded-content">
            <div class="owned-expanded-metric">
                <span class="owned-expanded-label">CF net/mois</span>
                <span class="owned-expanded-value owned-expanded-value--${cfTone}">${cfMens >= 0 ? '+' : ''}${Math.round(cfMens).toLocaleString('fr-FR')} €</span>
            </div>
            <div class="owned-expanded-metric">
                <span class="owned-expanded-label">Rendement brut</span>
                <span class="owned-expanded-value">${r.rentaBrute.toFixed(1)} %</span>
            </div>
            <div class="owned-expanded-metric">
                <span class="owned-expanded-label">DSCR</span>
                <span class="owned-expanded-value owned-expanded-value--${r.dscr >= 1.2 ? 'positive' : r.dscr >= 1 ? 'watch' : 'negative'}">${r.dscr.toFixed(2)}</span>
            </div>
            <div class="owned-expanded-metric">
                <span class="owned-expanded-label">Prix d'achat</span>
                <span class="owned-expanded-value">${(asset.acquisition?.prix || 0).toLocaleString('fr-FR')} €</span>
            </div>
            <div class="owned-expanded-metric">
                <span class="owned-expanded-label">Loyer initial</span>
                <span class="owned-expanded-value">${(asset.acquisition?.loyerInitial || 0).toLocaleString('fr-FR')} €/mois</span>
            </div>
            <button class="btn btn--ghost btn--sm" style="margin-left:auto" data-open-asset="${escapeHtml(asset.id)}">Ouvrir →</button>
        </div>
    </td>
</tr>` : '';

return mainRow + expandedRow;
```

- [ ] **Step 4 : Câbler le bouton expand après innerHTML**

Après les event listeners existants sur les lignes, ajouter :

```js
nodes.ownedListTable.querySelectorAll('.owned-expand-btn').forEach(btn => {
    btn.addEventListener('click', e => {
        e.stopPropagation();
        const id = btn.dataset.expandId;
        if (state.ownedExpandedIds.has(id)) {
            state.ownedExpandedIds.delete(id);
        } else {
            state.ownedExpandedIds.add(id);
        }
        renderOwnedPortfolioList();
    });
});
nodes.ownedListTable.querySelectorAll('[data-open-asset]').forEach(btn => {
    btn.addEventListener('click', () => openOwnedDetail(btn.dataset.openAsset));
});
```

- [ ] **Step 5 : Empêcher le clic sur le row d'ouvrir le détail si le clic vient du expand-btn**

Le listener de clic sur `tr[data-asset-id]` a déjà `if (e.target.closest('[data-action]') || ...) return;`. Ajouter `.owned-expand-btn` à cette condition :

```js
if (e.target.closest('[data-action]') || e.target.closest('.owned-year-btn') || e.target.closest('.owned-expand-btn')) return;
```

- [ ] **Step 6 : Styler la ligne expanded**

```css
.owned-expand-btn {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-muted);
    padding: 2px 4px;
    font-size: 10px;
    line-height: 1;
    border-radius: 3px;
    transition: color .12s;
}
.owned-expand-btn:hover { color: var(--text); }
.owned-expanded-row > td { padding: 0; border-top: none; }
.owned-expanded-content {
    display: flex;
    align-items: center;
    gap: 24px;
    padding: 10px 12px 12px 40px;
    background: var(--surface-2, rgba(0,0,0,.03));
    border-bottom: 1px solid var(--border);
}
.owned-expanded-metric { display: flex; flex-direction: column; gap: 2px; }
.owned-expanded-label { font-size: .7rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: .04em; }
.owned-expanded-value { font-size: .9rem; font-weight: 600; font-family: var(--font-mono); }
.owned-expanded-value--positive { color: var(--positive); }
.owned-expanded-value--watch { color: var(--watch); }
.owned-expanded-value--negative { color: var(--negative); }
```

- [ ] **Step 7 : Vérifier**

Cliquer ▸ → ligne expanded avec 5 métriques apparaît. Cliquer ▾ → disparaît. Cliquer "Ouvrir →" → ouvre la vue détail. L'état d'expand persiste pendant la session.

- [ ] **Step 8 : Commit**

```bash
git add main.js styles.css
git commit -m "feat(portfolio): expand row inline — aperçu rapide sans navigation"
```

---

## Task 6 : Densité liste — toggle compact/complet

**Files:**
- Modify: `main.js` — `renderOwnedPortfolioList()`, init state
- Modify: `index.html` — bouton densité dans `.owned-list-header`
- Modify: `styles.css` — classes `.owned-list-table--compact`

En mode compact, masquer les colonnes : rendement brut, DSCR, donut. Garder : drag, expand, nom, CF, statut, supprimer.

- [ ] **Step 1 : Ajouter le bouton dans index.html**

Dans la div `.owned-list-header`, dans le groupe de boutons (`display:flex;gap:8px`), ajouter avant le bouton Import :

```html
<button id="owned-density-btn" class="btn btn--ghost btn--sm" type="button" title="Densité"></button>
```

- [ ] **Step 2 : Ajouter `state.ownedCompact` et le charger**

Dans l'objet `state` :

```js
ownedCompact: localStorage.getItem('investissementWebOwnedCompact') === '1',
```

- [ ] **Step 3 : Câbler le bouton densité à l'initialisation des listeners**

Trouver où `owned-export-btn`, `owned-import-btn` etc. sont câblés (probablement dans une fonction `initPortfolioListeners` ou dans `init()`). Ajouter :

```js
document.getElementById('owned-density-btn')?.addEventListener('click', () => {
    state.ownedCompact = !state.ownedCompact;
    localStorage.setItem('investissementWebOwnedCompact', state.ownedCompact ? '1' : '0');
    renderOwnedPortfolioList();
});
```

- [ ] **Step 4 : Mettre à jour le label du bouton et la classe du tableau dans `renderOwnedPortfolioList`**

Au début de la section `if (nodes.ownedListTable)`, ajouter :

```js
const densityBtn = document.getElementById('owned-density-btn');
if (densityBtn) densityBtn.textContent = state.ownedCompact ? '⊞ Complet' : '≡ Compact';

nodes.ownedListTable.classList.toggle('owned-list-table--compact', !!state.ownedCompact);
```

- [ ] **Step 5 : Ajouter les classes aux colonnes masquables dans le template**

Dans le `<thead>`, ajouter `class="owned-col-hideable"` sur les th Rendement brut et DSCR :

```js
<th style="text-align:right" class="owned-col-hideable">Rdt brut</th>
<th style="text-align:right" class="owned-col-hideable">DSCR</th>
```

Dans chaque `<tr>`, même chose sur les td correspondants :

```js
<td class="owned-table-num owned-col-hideable">${r.rentaBrute.toFixed(1).replace('.', ',')} %</td>
<td class="owned-table-num owned-col-hideable">${r.dscr.toFixed(2).replace('.', ',')}</td>
```

- [ ] **Step 6 : CSS pour masquer les colonnes en mode compact**

```css
.owned-list-table--compact .owned-col-hideable { display: none; }
```

- [ ] **Step 7 : Vérifier**

Cliquer "≡ Compact" → colonnes Rdt brut et DSCR disparaissent, bouton devient "⊞ Complet". Rechargement → préférence conservée.

- [ ] **Step 8 : Commit**

```bash
git add main.js styles.css index.html
git commit -m "feat(portfolio): toggle densité liste compact/complet"
```

---

## Task 7 : Transition slide animation liste ↔ détail

**Files:**
- Modify: `main.js` — `openOwnedDetail()`, `closeOwnedDetail()`
- Modify: `styles.css` — keyframes + classes animation

Remplacer le basculement `hidden` brutal par un slide : la liste sort vers la gauche pendant que le détail entre par la droite (et inversement au retour).

- [ ] **Step 1 : Ajouter les keyframes dans styles.css**

```css
@keyframes slideInRight {
    from { transform: translateX(32px); opacity: 0; }
    to   { transform: translateX(0);    opacity: 1; }
}
@keyframes slideOutLeft {
    from { transform: translateX(0);    opacity: 1; }
    to   { transform: translateX(-32px); opacity: 0; }
}
@keyframes slideInLeft {
    from { transform: translateX(-32px); opacity: 0; }
    to   { transform: translateX(0);    opacity: 1; }
}
@keyframes slideOutRight {
    from { transform: translateX(0);    opacity: 1; }
    to   { transform: translateX(32px); opacity: 0; }
}
.owned-slide-in-right  { animation: slideInRight  .18s ease both; }
.owned-slide-out-left  { animation: slideOutLeft  .15s ease both; }
.owned-slide-in-left   { animation: slideInLeft   .18s ease both; }
.owned-slide-out-right { animation: slideOutRight .15s ease both; }
```

- [ ] **Step 2 : Animer `openOwnedDetail`**

Remplacer :

```js
nodes.ownedListView.hidden = true;
nodes.ownedDetailView.hidden = false;
renderOwnedDetail();
```

Par :

```js
nodes.ownedListView.classList.add('owned-slide-out-left');
setTimeout(() => {
    nodes.ownedListView.hidden = true;
    nodes.ownedListView.classList.remove('owned-slide-out-left');
    nodes.ownedDetailView.hidden = false;
    nodes.ownedDetailView.classList.add('owned-slide-in-right');
    renderOwnedDetail();
    setTimeout(() => nodes.ownedDetailView.classList.remove('owned-slide-in-right'), 200);
}, 140);
```

- [ ] **Step 3 : Animer `closeOwnedDetail`**

Remplacer :

```js
nodes.ownedDetailView.hidden = true;
nodes.ownedListView.hidden = false;
renderOwnedPortfolioList();
requestAnimationFrame(() => {
    window.scrollTo({ top: state._listScrollY || 0, behavior: 'instant' });
});
```

Par :

```js
nodes.ownedDetailView.classList.add('owned-slide-out-right');
setTimeout(() => {
    nodes.ownedDetailView.hidden = true;
    nodes.ownedDetailView.classList.remove('owned-slide-out-right');
    nodes.ownedListView.hidden = false;
    nodes.ownedListView.classList.add('owned-slide-in-left');
    renderOwnedPortfolioList();
    setTimeout(() => nodes.ownedListView.classList.remove('owned-slide-in-left'), 200);
    requestAnimationFrame(() => {
        window.scrollTo({ top: state._listScrollY || 0, behavior: 'instant' });
    });
}, 120);
```

- [ ] **Step 4 : Vérifier**

Ouvrir un bien → slide depuis la droite. Retour → slide vers la droite. L'animation doit être rapide (< 200ms) et non-perturbante.

- [ ] **Step 5 : Commit**

```bash
git add main.js styles.css
git commit -m "feat(portfolio): transition slide animation liste ↔ détail"
```
