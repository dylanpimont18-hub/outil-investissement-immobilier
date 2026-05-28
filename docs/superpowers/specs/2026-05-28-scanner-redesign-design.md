# Scanner — Refonte visuelle ciblée (3 zones)

**Date :** 2026-05-28  
**Scope :** Approche A — refonte des zones A (header), C (barre de recherche), D (filtres)  
**Fichiers touchés :** `index.html`, `scanner.js`, `styles.css`

---

## Contexte

Le mode Scanner de l'application Spark Investissement souffre d'un manque de professionnalisme visuel sur trois zones précises. Le tableau de résultats, le drawer de détail et la carte Leaflet sont fonctionnels et ne sont pas modifiés.

**Zones à retravailler :**
- **A — En-tête & contrôles** : aucun titre, pas de hiérarchie entre les boutons, statut peu lisible
- **C — Barre de recherche** : visuellement collée, sans identité, pills de filtres rapides sans cohérence
- **D — Panneau filtres avancés** : volet pleine largeur dense et peu aéré

**Direction retenue :** Style portail immobilier (SeLoger/Leboncoin) — barre de recherche intégrée, sidebar latérale fixe pour les filtres.

---

## Architecture du nouveau layout

```
┌─────────────────────────────────────────────────────┐
│  ZONE A — Header (titre, statut, 3 boutons CTA)     │
├─────────────────────────────────────────────────────┤
│  ZONE C — Barre de recherche (CP + pills + filtres) │
├─────────────────────────────────────────────────────┤
│  Stats row (inchangée)                              │
├──────────────┬──────────────────────────────────────┤
│ ZONE D       │                                      │
│ Sidebar      │  Tableau résultats (inchangé)        │
│ 260px fixe   │  + onglets Tableau/Carte (inchangés) │
│              │                                      │
└──────────────┴──────────────────────────────────────┘
```

Quand aucun résultat n'est affiché (état vide ou scan non lancé), le layout reste pleine largeur — la sidebar n'apparaît que lorsque des résultats sont présents.

---

## Zone A — Header redessiné

### HTML (`index.html`)

Remplacer le `<div id="scanner-controls" class="scanner-controls">` actuel par un block `.scanner-header` à deux colonnes :

```
[kicker "📡 Scanner d'annonces"]
[h2 "Opportunités locatives"]            [status-chip] [btn-ghost] [btn-outline] [btn-primary]
[sub "Centre-Val de Loire · Dernier scan : …"]
```

- **Kicker** : `<p class="scanner-header-kicker">` — petit texte doré uppercase
- **Titre** : `<h2 class="scanner-header-title">Opportunités locatives</h2>`
- **Sous-titre** : `<p class="scanner-header-sub">` — date du dernier scan, mise à jour dynamiquement par `scanner.js`
- **Boutons** : hiérarchie `btn--ghost` (Vider cache) → `btn--outline` (Scan complet) → `btn--primary` (Lancer un scan)
- **Status chip** : déplacé dans le header à gauche des boutons

### CSS

Nouvelle classe `.scanner-header` : `display:flex; justify-content:space-between; align-items:flex-start; padding:20px 24px 18px; border-bottom:1px solid var(--border)`.

Nouvelle classe `.scanner-header-kicker` : reprend le style `.brand-kicker` existant, couleur `var(--accent-gold)`.

---

## Zone C — Barre de recherche intégrée

### HTML (`index.html`)

Remplacer `<div id="scanner-search-bar" class="scanner-search-bar">` par une barre unifiée `.scanner-search-bar-v2` :

```
[📍 input CP] | [Budget ▾] | [Pièces ▾] | [Surface ▾] | [Type ▾] | [☰ Tous les filtres (badge)]
```

- Le champ CP (`#cp-search`) est intégré comme premier segment, avec bordure droite séparatrice
- Les 4 pills rapides (`#qf-budget-btn`, etc.) gardent leurs IDs existants mais prennent le style `.scanner-search-pill`
- Le bouton "Tous les filtres" (`#btn-toggle-filters`) remplace l'ancien `.scanner-qf-btn--toggle`, avec le badge compteur `#scanner-filter-count-badge` inclus
- Toute la barre est encapsulée dans un `border-radius:10px` avec `border:1px solid var(--border-strong)`

### CSS

Nouvelle classe `.scanner-search-bar-v2` : `display:flex; align-items:stretch; border-radius:10px; overflow:hidden; border:1px solid var(--border-strong); background:var(--surface-strong)`.

Nouvelle classe `.scanner-search-pill` : `padding:10px 16px; font-size:12px; color:var(--muted); border-left:1px solid var(--border); background:transparent; cursor:pointer; white-space:nowrap`.

Nouvelle classe `.scanner-search-filters-btn` : dernier segment, `background:rgba(var(--accent-gold-rgb),0.12); color:var(--accent-gold); font-weight:700; border-left:1px solid rgba(var(--accent-gold-rgb),0.3)`.

---

## Zone D — Sidebar filtres latérale fixe

### Comportement

- La sidebar est **toujours visible** quand des résultats sont affichés (`#scanner-results` visible)
- Elle remplace le volet `#scanner-filters` actuel (même ID conservé pour ne pas casser les bindings JS)
- Quand aucun résultat n'est affiché, la sidebar est masquée (état identique à aujourd'hui)

### Layout

Un nouveau wrapper `.scanner-content-layout` englobe sidebar + résultats :

```html
<div id="scanner-content-layout" class="scanner-content-layout">
  <aside id="scanner-filters" class="scanner-filter-sidebar">…</aside>
  <div id="scanner-results" class="scanner-results-wrap">…</div>
</div>
```

CSS `.scanner-content-layout` : `display:flex; gap:0; align-items:flex-start`.  
CSS `.scanner-filter-sidebar` : `width:260px; flex-shrink:0; position:sticky; top:0; max-height:calc(100vh - 120px); overflow-y:auto; border-right:1px solid var(--border); background:var(--surface)`.

### Contenu sidebar

Les sections existantes du filtre panel (`scanner-filter-section`) sont conservées telles quelles dans le HTML, seul le container change. On ajoute :
- Un `.scanner-sidebar-header` avec le titre "Filtres" et le span `#scanner-filter-count`
- Le footer `.scanner-filter-footer` existant reste, positionné en `sticky bottom:0` dans la sidebar

### JS (`scanner.js`)

Le toggle `#btn-toggle-filters` / `panel.style.display` n'a plus lieu d'être pour masquer/afficher le volet. À la place :
- Le bouton "Tous les filtres" dans la barre de recherche n'a **pas d'effet fonctionnel** sur desktop (app PyWebView) — la sidebar est toujours visible dès que des résultats existent. Il reste présent pour l'affordance visuelle (indique qu'il y a des filtres) et affiche le badge compteur
- Supprimer les appels `panel.style.display = 'none' | ''` dans `_bindButtons()`
- Conserver tous les listeners de filtres (`change`, `reset`, sliders) — ils ne changent pas

Le bouton `#btn-hide-filters` et `#btn-voir-resultats` (footer sidebar) restent fonctionnels mais leur comportement d'affichage/masquage est simplifié.

---

## Ce qui ne change pas

- Logique de scan, polling, `_startScan`, `_pollStatus`
- Rendu du tableau `_renderTable`, `_renderRow`, `_applyTable`
- Drawer de détail (`_openDrawer`, `_renderDetailContent`)
- Carte Leaflet (`_renderMap`, `_initMap`)
- Stats row (`_renderStats`, `_statCard`)
- Tous les IDs de filtres existants et leurs listeners

---

## Fichiers modifiés

| Fichier | Modifications |
|---|---|
| `index.html` | Remplacement du `#scanner-controls`, restructuration du `#scanner-search-bar`, ajout du wrapper `.scanner-content-layout` autour de `#scanner-filters` + `#scanner-results` |
| `styles.css` | Nouvelles classes `.scanner-header`, `.scanner-header-*`, `.scanner-search-bar-v2`, `.scanner-search-pill`, `.scanner-search-filters-btn`, `.scanner-filter-sidebar`, `.scanner-content-layout` |
| `scanner.js` | Simplification du toggle sidebar, mise à jour du sous-titre header avec la date du dernier scan |
