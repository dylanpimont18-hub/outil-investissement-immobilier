# Redesign SaaS Dashboard — Spécification

**Date :** 2026-05-10  
**Périmètre :** Refonte visuelle et interactive complète de l'application  
**Approche retenue :** B — Refonte visuelle complète (CSS + HTML components + JS animation helpers)  
**Dépendances externes :** Aucune (CSS + JS natif uniquement)

---

## 1. Contexte

L'application est un outil d'aide à la décision immobilière en vanilla JS, zéro framework, zéro serveur. La base technique (moteur `calculs.js`, architecture `main.js`) est saine et conservée intégralement. Seule la couche présentation est remplacée.

**Direction artistique choisie :** SaaS Dashboard — inspiré de Vercel/Linear. Dark mode dominant, interface technique et premium, dorée et structurée.

---

## 2. Layout & Navigation

### Structure générale

```
┌─────────────────────────────────────────────────┐
│  TOPBAR  [Logo · Nom dossier actif]   [⚙ ☀ 👤]  │  ← 52px, fixe
├─────────────────────────────────────────────────┤
│  [Saisie]  [Analyse]  [Portefeuille]             │  ← Onglets dans workspace
├──────────────────────┬──────────────────────────┤
│                      │                          │
│   PANNEAU SAISIE     │   PANNEAU ANALYSE        │
│   (42% largeur)      │   (58% largeur)          │
│                      │                          │
└──────────────────────┴──────────────────────────┘
```

### Topbar (remplacement du `<header class="topbar">`)

- Hauteur fixe : 52px
- Fond : `rgba(9,9,11,0.92)` + `backdrop-filter: blur(12px)`
- Bordure basse : `1px solid #27272a`
- Contenu gauche : logo (20×20px) + nom de l'application
- Contenu centre : chip affichant le nom du dossier actif (depuis `state.variablesData.nomBien`)
- Contenu droite : les 3 boutons toolbar existants (`theme-toggle`, `screen-toggle`, `profile-trigger`) redessinés en icônes 32×32px avec fond `#18181b` et bordure `#27272a`

### Navigation par onglets

- Remplace `<nav class="workspace-nav">`
- Positionnée en haut du `workspace-panel`, pas en dehors
- 3 onglets : Saisie / Analyse / Portefeuille
- Onglet actif : fond `#18181b`, bordure `1px solid #27272a`, texte `#f4f4f5`
- Onglet inactif : texte `#71717a`
- Transition de contenu au changement : `opacity` 0→1 + `translateY(4px→0)`, 200ms ease-out

### Variables CSS à ajouter/remplacer

```css
--bg: #09090b;
--surface: #111113;
--surface-strong: #18181b;
--border: #27272a;
--border-subtle: #1c1c1f;
--text: #f4f4f5;
--muted: #71717a;
--muted-strong: #a1a1aa;
--accent-gold: #D4AF37;
--accent-gold-dim: rgba(212,175,55,0.12);
--accent-gold-border: rgba(212,175,55,0.3);
--success: #4ade80;
--danger: #f87171;
--radius-sm: 6px;
--radius-md: 8px;
--radius-lg: 12px;
--radius-xl: 14px;
```

---

## 3. Panneau de saisie — Accordéon

### Structure

Chaque `<fieldset class="variables-group">` devient une section accordéon :

```html
<div class="accord-section" data-open="true">
  <button class="accord-head" aria-expanded="true">
    <span class="accord-title">Acquisition</span>
    <span class="accord-count">7 champs</span>
    <svg class="accord-chevron">…</svg>
  </button>
  <div class="accord-body">
    <!-- champs existants inchangés -->
  </div>
</div>
```

- Un seul groupe ouvert à la fois (comportement radio)
- Le groupe "Acquisition" est ouvert par défaut
- Animation : `max-height` + `opacity`, 250ms ease-out

### Style des champs

- Label : `font-size: 9px`, `text-transform: uppercase`, `letter-spacing: 0.8px`, couleur `--muted`
- Input : `height: 32px`, `background: --surface-strong`, `border: 1px solid --border`, `border-radius: --radius-sm`
- Focus : `border-color: --accent-gold-border`, `background: --accent-gold-dim`, `color: --accent-gold`
- Transition focus : `border-color 200ms`, `box-shadow 200ms`
- Grid : `grid-template-columns: 1fr 1fr` par défaut, `1fr` pour les champs larges

### Boutons d'actions (bas du panneau)

Redessin des 4 boutons (Nouvelle étude, Enregistrer, Basculer, Exporter) :
- Bouton primaire (Enregistrer) : fond `--accent-gold`, texte noir, `border-radius: --radius-md`
- Boutons secondaires : fond transparent, `border: 1px solid --border`, texte `--muted-strong`
- Hover : `border-color: --accent-gold-border`, texte `--accent-gold`

---

## 4. Panneau d'analyse — Hero & KPIs

### Composant score (cadran SVG)

Injecté via `main.js` dans `#analysis-acquisition-decision` :

```html
<div class="score-hero">
  <svg class="score-gauge" viewBox="0 0 120 120" width="96" height="96">
    <circle class="gauge-track" cx="60" cy="60" r="46"/>
    <circle class="gauge-fill" cx="60" cy="60" r="46"
      stroke-dasharray="289" stroke-dashoffset="[calculé]"/>
    <text class="gauge-number" x="60" y="66">[score]</text>
  </svg>
  <div class="score-meta">
    <div class="score-verdict [tone-class]">[verdict]</div>
    <div class="score-label">Score de décision</div>
  </div>
</div>
```

- `gauge-track` : `stroke: #27272a`, `stroke-width: 8`, `fill: none`
- `gauge-fill` : `stroke: --accent-gold`, `stroke-width: 8`, `stroke-linecap: round`, `fill: none`
- Animation : `stroke-dashoffset` de 289 (0%) vers valeur calculée (`289 * (1 - score/100)`), 600ms ease-out, via CSS `transition`
- `gauge-number` : `font-family: --font-display`, `font-size: 28px`, `fill: --accent-gold`, `font-weight: 900`

### Cartes KPI

4 cartes `#analysis-metrics` en grid `1fr 1fr 1fr 1fr` :

```html
<div class="kpi-card">
  <div class="kpi-value" data-target="[valeur]">[valeur]</div>
  <div class="kpi-label">[libellé]</div>
  <div class="kpi-bar"><div class="kpi-bar-fill" style="--pct: [0-100]%"></div></div>
</div>
```

- KPI value : `font-family: --font-display`, `font-size: 20px`, `font-weight: 700`
- Couleur value : gold pour les métriques neutres, `--success` pour cash-flow positif, `--danger` pour négatif
- Barre : `height: 3px`, `background: --border`, overflow hidden. Fill : `width: var(--pct)`, transition 400ms
- Animation counter : JS `requestAnimationFrame`, interpolation linéaire sur 300ms, déclenché à chaque appel de render

### Sections d'analyse (confidence, scénarios, tableaux…)

- Fond : `--surface` avec `border: 1px solid --border`, `border-radius: --radius-lg`
- Header section : `font-size: 11px`, `text-transform: uppercase`, `letter-spacing: 1px`, `color: --muted`
- Espacement interne : `padding: 16px`

### Code couleur des tons de verdict

| Tone | Fond badge | Texte | Bordure |
|---|---|---|---|
| `excellent` | `rgba(74,222,128,0.12)` | `#4ade80` | `rgba(74,222,128,0.3)` |
| `positive` | `rgba(212,175,55,0.12)` | `#D4AF37` | `rgba(212,175,55,0.3)` |
| `neutral` | `rgba(161,161,170,0.1)` | `#a1a1aa` | `rgba(161,161,170,0.2)` |
| `watch` | `rgba(251,191,36,0.12)` | `#fbbf24` | `rgba(251,191,36,0.3)` |
| `negative` | `rgba(248,113,113,0.12)` | `#f87171` | `rgba(248,113,113,0.3)` |

Transition entre tons : `background 300ms`, `color 300ms`, `border-color 300ms`.

---

## 5. Système d'animations

| Élément | Mécanisme | Durée | Déclencheur |
|---|---|---|---|
| Cadran SVG score | CSS `transition: stroke-dashoffset` | 600ms ease-out | Chaque render |
| Compteurs KPIs | JS `requestAnimationFrame` linéaire | 300ms | Chaque render |
| Barres de progression KPI | CSS `transition: width` via `--pct` | 400ms ease-out | Chaque render |
| Ouverture accordéon | CSS `max-height` + `opacity` | 250ms ease-out | Clic header |
| Fermeture accordéon | CSS `max-height` + `opacity` | 200ms ease-in | Clic header |
| Focus champ input | CSS `box-shadow` gold pulse | 200ms | `:focus` |
| Changement verdict | CSS `background` + `color` + `border-color` | 300ms | Chaque render |
| Changement d'onglet | CSS `opacity` + `translateY(4px→0)` | 200ms ease-out | Clic onglet |

Toutes les transitions sont définies dans `styles.css`. Le JS ne fait qu'ajouter/retirer des classes ou mettre à jour des CSS custom properties (`--pct`, `--dash-offset`).

---

## 6. Fichiers modifiés

| Fichier | Nature des changements |
|---|---|
| `styles.css` | Remplacement complet des variables CSS et des composants visuels |
| `index.html` | Remplacement du `<header>`, ajout des classes accordéon sur les fieldsets, restructuration de la nav |
| `main.js` | Mise à jour des template literals pour les nouveaux composants (score SVG, KPI cards) ; ajout des helpers d'animation (counter, gauge) |
| `ui.js` | Mise à jour des classes CSS de verdict pour correspondre aux nouveaux tokens |

`calculs.js` et `pdf.js` ne sont **pas** modifiés.

---

## 7. Hors périmètre

- Modification de la logique de calcul
- Ajout de nouvelles fonctionnalités
- Mode 2 fenêtres (`?panel=analysis`) — conservé tel quel, adapté au nouveau CSS
- Export PDF — conservé tel quel
