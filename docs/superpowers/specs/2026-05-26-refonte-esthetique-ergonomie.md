# Spec — Refonte esthétique & ergonomie (Dual-mode + Live CF)

**Date :** 2026-05-26  
**Statut :** Approuvé  
**Périmètre :** `index.html`, `styles.css`, `main.js`  
**Calculs :** `calculs.js` intact — aucune modification

---

## 1. Contexte & objectif

Deux problèmes principaux identifiés :

- **Panneau de saisie** : trop dense, tous les champs visibles en même temps, pas de hiérarchie claire entre essentiel et secondaire.
- **Panneau d'analyse** : le verdict est noyé parmi les blocs, trop d'information affiché d'un coup sans fil conducteur.

L'objectif est une refonte significative — pas un polish — qui restructure l'expérience des deux panneaux tout en conservant l'architecture vanilla JS existante (pas de build step, pas de framework, localStorage).

---

## 2. Vue d'ensemble — Dual-mode

Le formulaire propose deux modes basculables via un toggle dans la topbar :

| Mode | Comportement | Usage |
|---|---|---|
| `☰ Complet` | Tous les champs organisés en zones dépliables (Essentiel / Important / Avancé) | Utilisateur expérimenté, re-saisie rapide |
| `⚡ Guidé` | Wizard 4 étapes, une section à la fois, aide contextuelle | Première fois, utilisateur accompagné |

L'état du mode est persisté dans `localStorage` (clé `spark_mode`, valeurs `'full'` ou `'guided'`).

---

## 3. Fonctionnalité 1 — Toggle dual-mode (topbar)

### Markup

Remplace le bouton `#guided-toggle` existant par un toggle segmenté :

```html
<div class="mode-toggle" id="mode-toggle" role="group" aria-label="Mode de saisie">
  <button class="mode-toggle__btn" data-mode="guided" id="mode-btn-guided" aria-pressed="false">⚡ Guidé</button>
  <button class="mode-toggle__btn mode-toggle__btn--active" data-mode="full" id="mode-btn-full" aria-pressed="true">☰ Complet</button>
</div>
```

### CSS

```css
.mode-toggle {
  display: flex;
  background: var(--surface-strong);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}
.mode-toggle__btn {
  font-size: 11px; font-weight: 600;
  padding: 4px 11px;
  border: none; background: transparent;
  color: var(--muted); cursor: pointer;
  transition: background .15s, color .15s;
}
.mode-toggle__btn--active {
  background: var(--accent-gold);
  color: #0D1117;
}
```

### JS (dans `main.js`)

- Listener `click` sur `#mode-toggle` (event delegation sur `data-mode`)
- Bascule la classe `--active` entre les deux boutons
- Met à jour `aria-pressed`
- Appelle `renderModeSwitch(mode)` qui affiche/masque les deux corps de formulaire
- Sauvegarde dans `localStorage`

---

## 4. Fonctionnalité 2 — Mode Complet (zones progressives)

### Structure des zones

Le corps du formulaire est restructuré en 4 zones avec `data-zone` et `data-priority` :

| Zone | Priorité | Sections incluses |
|---|---|---|
| Acquisition | `essentiel` | Prix vendeur, loyer, surface, vacance, travaux |
| Financement | `essentiel` | Taux, durée, apport, frais notaire, assurance |
| Exploitation locative + Fiscalité | `important` | Charges, foncière, régime, TMI |
| Vérifications + Hypothèses + Seuils + Journal | `avance` | Toutes les sections avancées |

### Comportement

- Les zones `essentiel` sont ouvertes par défaut
- Les zones `important` et `avance` sont fermées par défaut
- Chaque zone-head est cliquable (toggle open/close)
- Chevron tourne à 90° quand ouvert

### CSS

```css
.zone { margin-bottom: 8px; border-radius: 8px; overflow: hidden; border: 1px solid var(--border); }
.zone-head {
  display: flex; align-items: center; gap: 8px;
  padding: 9px 12px; background: var(--surface-strong);
  cursor: pointer; user-select: none;
}
.zone-badge { font-size: 8px; font-weight: 700; letter-spacing: .4px; padding: 2px 6px; border-radius: 3px; }
.zone-badge--essentiel { background: var(--accent-gold-dim); color: var(--accent-gold); border: 1px solid var(--accent-gold-border); }
.zone-badge--important { background: var(--primary-soft); color: var(--primary); }
.zone-badge--avance { background: var(--surface-strong); color: var(--muted); border: 1px solid var(--border); }
.zone-name { font-size: 11px; font-weight: 600; }
.zone-chevron { margin-left: auto; font-size: 10px; color: var(--muted); transition: transform .2s; }
.zone[data-open="true"] .zone-chevron { transform: rotate(90deg); }
.zone-body { padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
.zone-body[hidden] { display: none; }
```

---

## 5. Fonctionnalité 3 — Mode Guidé (wizard 4 étapes)

### Structure

Un conteneur `#guided-mode-body` distinct du formulaire complet. Affiché/masqué via JS selon le mode actif.

### Étapes

| # | Nom | Champs |
|---|---|---|
| 1 | Identité du dossier | Nom, ville, type de bien |
| 2 | Acquisition | Prix vendeur, loyer, vacance, surface |
| 3 | Financement | Taux, durée, apport, frais notaire |
| 4 | Exploitation & Fiscalité | Charges, foncière, régime fiscal |

### Éléments de chaque étape

- **Indicateur d'étapes** : 4 pastilles numérotées (état `done` vert / `active` or / `pending` gris), reliées par une ligne
- **Barre de progression** : `width: (step / total) * 100%` en or
- **Corps de l'étape** : numéro + titre + description contextuelle + champs grands (height 36px) + hint sous chaque champ
- **Navigation** : boutons `← Retour` (ghost) et `Suivant →` / `Terminer` (or)

### Markup (exemple étape 2)

```html
<div id="guided-mode-body" class="guided-body" hidden>
  <div class="guided-steps" id="guided-steps">
    <!-- injecté dynamiquement par renderGuidedSteps(currentStep) -->
  </div>
  <div class="guided-progress"><div class="guided-progress__fill" id="guided-progress-fill"></div></div>
  <div class="guided-step-content" id="guided-step-content">
    <!-- injecté dynamiquement par renderGuidedStep(stepIndex) -->
  </div>
</div>
```

### JS

- `state.guidedStep` (0–3) — étape courante
- `renderGuidedStep(i)` — injecte le titre, desc, champs de l'étape `i` dans `#guided-step-content`
- `renderGuidedSteps(i)` — met à jour les pastilles
- Bouton "Suivant" → `state.guidedStep++`, re-render ; si étape 4 → passe en mode complet et sauvegarde
- Chaque `<input>` dans le wizard porte le même `name` que son équivalent dans le formulaire complet → `sanitizeVariablesData()` s'applique identiquement

---

## 6. Fonctionnalité 4 — Panneau d'analyse restructuré

### Ordre des blocs (de haut en bas)

| # | Bloc | Contenu |
|---|---|---|
| ① | **Verdict héros** | Score circulaire + ton coloré + label + tags synthétiques |
| ② | **Cash-flow live** | Grille 3 KPIs + waterfall horizontal (loyer → mensualité → charges → net net) |
| ③ | **Métriques clés** | Grille 2×2 : prix plafond, rentabilité nette, effort d'épargne, revente 10 ans |
| ④ | **Solidité** | Section dépliable (fermée par défaut) |
| ⑤ | **Stress-test** | Section dépliable (fermée par défaut) |
| ⑥ | **Projections & Fiscalité** | Section dépliable (fermée par défaut) |

### Verdict héros

```css
.verdict-hero {
  background: linear-gradient(135deg, rgba(var(--success-rgb), .10), rgba(var(--success-rgb), .03));
  border: 1px solid rgba(var(--success-rgb), .30);
  border-radius: 10px; padding: 14px 16px;
  display: flex; align-items: center; gap: 14px;
}
/* Teintes par tone : --positive → success, --excellent → gold, --watch → watch, --negative → danger, --neutral → muted */
.verdict-hero[data-tone="negative"] { background: linear-gradient(135deg,rgba(248,81,73,.10),rgba(248,81,73,.03)); border-color: rgba(248,81,73,.3); }
```

Le score (0–100) est affiché dans un anneau SVG dont la couleur suit le tone.

### Waterfall CF

Mini graphique horizontal en barres superposées (CSS pur, pas de lib chart) :
- Loyer brut (vert)
- Mensualité (rouge)
- Charges + impôts (orange)
- Séparateur + **Net net** (vert si ≥ 0, rouge si < 0)

Les largeurs sont calculées en JS : `width = Math.abs(valeur) / loyerBrut * 100 + '%'`

### Sections dépliables analyse

```html
<div class="analysis-block" data-open="false">
  <div class="analysis-block__head">
    <span class="analysis-block__num">④</span>
    <span class="analysis-block__title">Solidité des hypothèses</span>
    <span class="analysis-block__badge analysis-block__badge--solide">Solide</span>
    <svg class="analysis-block__chevron">…</svg>
  </div>
  <div class="analysis-block__body" hidden>…</div>
</div>
```

---

## 7. Fichiers modifiés

| Fichier | Changements |
|---|---|
| `index.html` | Remplacement du `#guided-toggle` par `#mode-toggle` ; ajout de `#guided-mode-body` ; restructuration du formulaire en zones ; réordonnancement des blocs d'analyse |
| `styles.css` | Classes `.mode-toggle`, `.zone`, `.zone-badge--*`, `.guided-body`, `.guided-steps`, `.verdict-hero[data-tone]`, `.cf-waterfall`, `.analysis-block` |
| `main.js` | `renderModeSwitch()`, `renderGuidedStep()`, `renderGuidedSteps()`, `renderVerdictHero()`, `renderCFWaterfall()`, mise à jour du cycle de rendu existant |
| `calculs.js` | Aucun |
| `pdf.js` | Aucun |
| `ui.js` | Aucun |

---

## 8. Risques & points d'attention

- **Champs du wizard et formulaire complet** : les deux partagent les mêmes `name` d'input. Quand on bascule de Guidé → Complet, les valeurs saisies doivent être copiées dans les champs du formulaire complet (et inversement) avant de masquer l'ancien mode.
- **`success-rgb` / `danger-rgb`** : le CSS du verdict héros utilise `rgba(var(--success-rgb), .10)`. Ces variables RGB doivent être ajoutées aux deux thèmes dans `:root`.
- **Waterfall CF** : les valeurs viennent de `vm.cfDetail` (décomposition loyer / mensualité / charges / impôts). Vérifier que `computeAnalysisViewModel` expose bien ces sous-composantes ou les calculer depuis les valeurs déjà disponibles.
- **Scroll de la KPI-bar existante** : la `#form-kpi-bar` actuelle reste en place dans le mode Complet ; dans le mode Guidé elle est masquée (les métriques live sont dans le panneau droit uniquement).
- **`IS_ANALYSIS_WINDOW`** : dans la popup analyse secondaire (`?panel=analysis`), le toggle dual-mode n'est pas affiché ; le panneau d'analyse restructuré s'applique des deux côtés.
