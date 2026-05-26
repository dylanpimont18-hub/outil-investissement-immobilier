# Spec — Améliorations ergonomiques (Approche A)

**Date :** 2026-05-11  
**Approche :** A — Enrichissement progressif dans l'architecture existante  
**Périmètre :** `main.js`, `styles.css`, `index.html`  
**Calculs :** `calculs.js` intact — aucune modification

---

## 1. Contexte & objectif

L'outil est utilisé par des profils mixtes : investisseur expert (solo) et utilisateurs moins avertis (associé, proche). Quatre axes d'amélioration identifiés :

1. Navigation & orientation dans le formulaire
2. Feedback instantané sur les champs clés
3. Hiérarchie visuelle des sections
4. Lisibilité du panel d'analyse

L'approche retenue enrichit l'existant sans restructurer l'architecture (pas de build step, vanilla JS ES modules, localStorage).

---

## 2. Fonctionnalité 1 — Barre KPIs collante

### Description

Un bandeau fixe s'affiche en haut du panneau de saisie (`#variables-panel`), sous le titre de section. Il affiche 3 métriques clés en temps réel, mises à jour à chaque frappe.

### Métriques affichées

| Métrique | Source dans le view model | Couleur |
|---|---|---|
| Rendement brut | `vm.rentaBrute` (%) | `--gold` |
| Cash-flow net/mois | `vm.cfNetMensuel` (€) | `--success` si ≥ 0, `--danger` si < 0 |
| DSCR | `vm.dscr` | `--text` |

### Comportement

- Sticky (position fixe dans le scroll du panneau gauche) via `position: sticky; top: 0`
- S'affiche dès le premier chargement (valeurs par défaut)
- Se met à jour via le cycle de rendu existant dans `main.js` (pas de listener supplémentaire — le rendu est déjà déclenché à chaque input)
- En cas de données insuffisantes (prix = 0) : affiche `—` à la place des valeurs

### Markup (injecté ou statique dans `index.html`)

```html
<div class="kpi-bar" id="kpi-bar" aria-label="Métriques en direct">
  <div class="kpi-bar__item">
    <span class="kpi-bar__value" id="kpi-rdt-brut">—</span>
    <span class="kpi-bar__label">Rendement brut</span>
  </div>
  <div class="kpi-bar__item">
    <span class="kpi-bar__value" id="kpi-cf-net">—</span>
    <span class="kpi-bar__label">Cash-flow net/mois</span>
  </div>
  <div class="kpi-bar__item">
    <span class="kpi-bar__value" id="kpi-dscr">—</span>
    <span class="kpi-bar__label">DSCR</span>
  </div>
</div>
```

Placé juste après `<div id="variables-context" class="context-strip"></div>` dans `index.html`.

### CSS

```css
.kpi-bar {
  position: sticky;
  top: 0;
  z-index: 10;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  padding: 10px 16px;
}
.kpi-bar__item { text-align: center; padding: 4px 0; }
.kpi-bar__item + .kpi-bar__item { border-left: 1px solid var(--border); }
.kpi-bar__value { display: block; font-size: 18px; font-weight: 700; line-height: 1; }
.kpi-bar__label { display: block; font-size: 10px; color: var(--muted); margin-top: 2px; letter-spacing: 0.3px; }
```

---

## 3. Fonctionnalité 2 — Badges de priorité sur les accordéons

### Description

Chaque section accordéon reçoit un badge indiquant son niveau d'importance. Le badge est statique (pas de logique JS — codé en dur dans le HTML).

### Niveaux et mapping

| Badge | Couleur | Sections |
|---|---|---|
| `ESSENTIEL` | Or (`--gold`) | Acquisition, Financement |
| `IMPORTANT` | Bleu (`--primary`) | Exploitation locative, Fiscalité |
| `AVANCÉ` | Gris (`--muted`) | Vérifications avant offre, Fiabilité des hypothèses, Seuils de décision, Journal de décision |
| `OPTIONNEL` | Gris (`--muted`) | Identité du dossier |

### Comportement visuel

- Les sections `ESSENTIEL` ouvertes ont un fond légèrement teinté or (`rgba(var(--gold-rgb), 0.04)`) et leur chevron prend la couleur `--gold`
- Les autres sections : style existant inchangé

### CSS

```css
.accord-badge--essentiel {
  background: var(--gold-soft);
  color: var(--gold);
  border: 1px solid var(--gold-border);
  font-size: 10px; font-weight: 700;
  padding: 2px 7px; border-radius: 4px; letter-spacing: 0.3px;
}
.accord-badge--important {
  background: var(--primary-soft);
  color: var(--primary);
  border: 1px solid rgba(59,130,246,0.25);
  font-size: 10px; font-weight: 600;
  padding: 2px 7px; border-radius: 4px; letter-spacing: 0.3px;
}
/* .accord-badge (existant) pour AVANCÉ / OPTIONNEL — inchangé */

.accord-section[data-priority="essentiel"][data-open="true"] .accord-body {
  background: rgba(201, 168, 76, 0.03);
}
.accord-section[data-priority="essentiel"] .accord-chevron {
  color: var(--gold);
}
```

Ajouter `data-priority="essentiel|important|avance|optionnel"` sur chaque `<div class="accord-section">` dans `index.html`.

---

## 4. Fonctionnalité 3 — Mode guidé (Checklist + Spotlight)

### Activation

Bouton toggle `« Mode guidé »` ajouté dans `.topbar-actions` (après le bouton profil). Stocke l'état dans `localStorage` clé `guided_mode`. Classe `is-guided` ajoutée sur `<body>` quand actif.

### 4a. Checklist latérale

Panneau rétractable qui apparaît en dessous de la barre KPIs dans `#variables-panel` quand le mode guidé est actif.

**Champs listés (ordre fixe) :**

| Priorité | Champ | ID formulaire |
|---|---|---|
| Essentiel | Prix affiché | `#prix` |
| Essentiel | Loyer cible | `#loyer` |
| Essentiel | Taux d'intérêt | `#taux-input` |
| Essentiel | Durée du prêt | `#duree` |
| Essentiel | Apport | `#apport` |
| Important | Vacance | `#vacance` |
| Important | Taxe foncière | `#fonciere` |
| Important | Régime fiscal | `#regime` |

**Comportement :**
- Un champ est coché (✓) si sa valeur diffère de sa valeur par défaut
- Le champ suivant non coché est surligné comme "en cours"
- Barre de progression : `champs cochés / total`
- Clic sur un item → ouvre l'accordéon parent + déclenche le spotlight sur le champ

**Markup :**

```html
<div class="guided-checklist" id="guided-checklist" hidden>
  <div class="guided-checklist__head">
    <span>Guide de saisie</span>
    <span class="guided-checklist__progress" id="guided-progress">0 / 8</span>
  </div>
  <div class="guided-checklist__bar"><div id="guided-bar" style="width:0%"></div></div>
  <div class="guided-checklist__section-label">Essentiels</div>
  <ul class="guided-checklist__list" id="guided-list-essentiel"></ul>
  <div class="guided-checklist__section-label">Importants</div>
  <ul class="guided-checklist__list" id="guided-list-important"></ul>
</div>
```

### 4b. Spotlight

Overlay semi-transparent sur le formulaire qui met en lumière un seul champ à la fois.

**Comportement :**
- Déclenché par un clic sur un item de la checklist
- Affiche : numéro de l'étape, nom du champ, input focusé, description contextuelle (texte du `data-tip` existant), boutons Précédent / Suivant
- Entrée ou clic Suivant → ferme le spotlight, passe au prochain champ non rempli
- Échap → ferme le spotlight sans avancer
- Le spotlight se ferme automatiquement si le mode guidé est désactivé

**Markup (injecté dynamiquement) :**

```html
<div class="spotlight-overlay" id="spotlight-overlay" hidden>
  <div class="spotlight-card">
    <div class="spotlight-card__header">
      <span class="spotlight-card__step" id="spotlight-step">1 / 8</span>
      <span class="spotlight-card__title" id="spotlight-title"></span>
    </div>
    <input class="spotlight-card__input" id="spotlight-input" readonly>
    <p class="spotlight-card__desc" id="spotlight-desc"></p>
    <div class="spotlight-card__actions">
      <button id="spotlight-prev">← Précédent</button>
      <button id="spotlight-next">Suivant →</button>
    </div>
  </div>
</div>
```

Le spotlight synchronise la valeur de `spotlight-input` avec le champ réel via event delegation — les frappes dans l'input spotlight sont relayées au champ original, déclenchant le rendu live normal.

---

## 5. Fonctionnalité 4 — Réorganisation du panel d'analyse

### Principe

Les blocs existants sont réordonnés dans `#analysis-panel` par importance décroissante. Les conteneurs `id` restent identiques — seul l'ordre DOM change dans `index.html`.

### Ordre des blocs (de haut en bas)

| N° | Bloc | Conteneur existant | Changement |
|---|---|---|---|
| ① | Verdict + score d'acquisition | `#analysis-acquisition-decision` | Badge numéroté ajouté, bordure colorée selon tone |
| ② | Métriques clés (grille KPIs) | `#analysis-metrics` | Badge numéroté — inchangé sinon |
| ③④ | Solidité + Stress (côte à côte) | `#analysis-confidence` + `#analysis-scenarios` | Wrappés dans un `div.analysis-columns--2up` pour les afficher en 2 colonnes |
| ⑤ | Projections & fiscalité | graphiques + tableaux existants | Inchangés, restent en bas |

### Badge de section

```html
<div class="analysis-section-badge">① VERDICT</div>
```

```css
.analysis-section-badge {
  font-size: 10px; font-weight: 700; letter-spacing: 0.5px;
  color: var(--muted); background: var(--surface-2);
  padding: 2px 8px; border-radius: 4px;
  display: inline-block; margin-bottom: 8px;
}
```

### Solidité + Stress côte à côte

```css
.analysis-columns--2up {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
@media (max-width: 640px) {
  .analysis-columns--2up { grid-template-columns: 1fr; }
}
```

---

## 6. Fichiers modifiés

| Fichier | Changements |
|---|---|
| `index.html` | Ajout du markup `kpi-bar`, badges `data-priority` sur accordéons, markup `guided-checklist`, réordonnancement des blocs d'analyse, bouton topbar mode guidé |
| `styles.css` | Classes `.kpi-bar`, `.accord-badge--essentiel/important`, `.guided-checklist`, `.spotlight-overlay`, `.analysis-section-badge`, `.analysis-columns--2up` |
| `main.js` | Rendu de la `kpi-bar` dans le cycle existant, logique mode guidé (toggle, checklist, spotlight), badges analyse |
| `calculs.js` | Aucun |
| `pdf.js` | Aucun |
| `ui.js` | Aucun |

---

## 7. Risques & points d'attention

- **Spotlight + input synchronisé :** relayer les frappes du spotlight vers le champ réel doit déclencher un événement `input` natif pour que `main.js` capte le changement — utiliser `dispatchEvent(new Event('input', { bubbles: true }))`.
- **`position: sticky` sur la kpi-bar :** ne fonctionne que si le conteneur parent a `overflow: auto` (pas `overflow: hidden`) — vérifier les styles du panneau gauche.
- **Fenêtre analyse secondaire (`?panel=analysis`) :** le mode guidé n'est actif que dans la fenêtre principale ; la checklist et le spotlight ne s'affichent pas dans la popup analyse. Pas de changement nécessaire côté `IS_ANALYSIS_WINDOW`.
- **Valeurs par défaut pour la checklist :** utiliser `VARIABLE_DEFAULTS` de `main.js` comme référence pour détecter si un champ a été modifié.
