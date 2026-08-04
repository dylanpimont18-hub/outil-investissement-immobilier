# Spec — Refonte Portefeuille + Liaison Saisie ↔ Portefeuille

**Date** : 2026-06-03  
**Périmètre** : `index.html`, `main.js`, `calculs.js`, `styles.css`  
**Approche validée** : Tout en une passe — Portefeuille + Liaison + ajustements mineurs Saisie

---

## 1. Contexte et motivations

Trois frictions identifiées par l'utilisateur :

- **A — Perte de fil** : aucun indicateur visuel sur l'état de l'étude courante (sauvée ? modifiée ? dans quel scope ?)
- **B — Portefeuille sans visuels** : la section collection-panel affiche des tableaux et du texte, sans vue d'ensemble visuelle par actif
- **C — Transitions lourdes** : passer d'une fiche portefeuille au simulateur demande trop de clics

Priorité déclarée : **B** en premier, A et C résolus dans le même chantier.

---

## 2. Section Portefeuille — restructuration complète

### 2.1 Bandeau 6 KPIs (nouveau, remplace le hero actuel)

Positionné en haut de `#collection-panel`, avant les cartes. Affiche les métriques agrégées sur l'ensemble du parc détenu.

| Métrique | Source | Couleur accent |
|---|---|---|
| CF net-net consolidé (€/mois) | Somme des `metrics.cfNetNet` des biens `inPortfolio` | Vert si ≥ 0, rouge sinon |
| Rendement brut moyen (%) | Moyenne pondérée des `metrics.rentaBrute` | Or `#D4AF37` |
| Patrimoine estimé (k€) | Somme des `prix - nego` des biens détenus | Bleu `#60a5fa` |
| DSCR moyen | Moyenne des `metrics.dscr` | Neutre, rouge si < 1 |
| Loyers / mois (€) | Somme des `loyer` bruts mensuels | Neutre |
| Capacité d'endettement restante (k€) | Valeur issue de `buildPortfolioCapacity` | Violet `#a78bfa` |

En dessous des 6 cartes : **score santé** (cercle coloré 0–100 + verdict en une ligne + compteurs "X biens détenus · Y suivis"). Le score existe déjà dans `buildPortfolioHealthDecision` — réutiliser.

### 2.2 Grille de cartes riches (remplace les tables actuelles)

La section se découpe en deux blocs visuellement distincts :

**Bloc "Parc détenu"** — biens avec `status === 'owned'` ou `inPortfolio === true`  
**Bloc "Pipeline d'acquisition"** — biens avec `inComparison === true` et `inPortfolio === false`

Chaque bloc a un titre avec badge compteur coloré (vert pour parc, orange pour pipeline).

**Anatomie d'une carte riche** (composant `buildPortfolioAssetCard(item)`) :

```
┌─ [bordure gauche couleur tone] ──────────────────────────────┐
│ Nom du bien                              CF net-net (gros)   │
│ Type · Ville · Régime fiscal             +127€ /mois         │
│ ─────────────────────────────────────────────────────────── │
│ [mini-waterfall 6px : loyers/crédit/charges/net]             │
│ ─────────────────────────────────────────────────────────── │
│ [Rdt brut] [DSCR] [Prix] [Décision]  ← 4 micro-KPIs         │
│ Loyers 650€ · Crédit 432€ · Charges 91€ · TMI 30%           │
│ ─────────────────────────────────────────────────────────── │
│ [Ouvrir]  [Fiche]  [PDF]                                     │
└──────────────────────────────────────────────────────────────┘
```

**Couleur de bordure gauche** : suit le `decision.tone` de l'`analysisModel` du bien
- `excellent` / `positive` → `var(--success)` (vert)
- `neutral` / `watch` → `var(--warning)` (orange)
- `negative` → `var(--danger)` (rouge)

**Mini-waterfall** : barre horizontale de 6px en 4 segments proportionnels aux flux :
- Loyers (vert) → Crédit (rouge) → Charges (orange) → Net (or si ≥0, rouge si <0)
- Proportions basées sur la valeur absolue de chaque flux / loyer brut

**4 micro-KPIs** : `rentaBrute`, `dscr`, `prix - nego`, `decision.label`

**Bouton "Ouvrir"** :
- Sur cartes pipeline (biens suivis) : style doré, libellé "↩ Ouvrir dans le simulateur", action prioritaire
- Sur cartes parc détenu : style neutre, même action
- Action : appelle `loadAssetIntoWorkspace(id)` + navigation vers l'onglet Saisie & Analyse

**Bouton "PDF"** : appelle `handleDecisionSummaryExport` avec le bien pré-chargé (ou ouvre la fiche et propose l'export).

**Carte placeholder "+"** : affichée en fin de grille pipeline quand < 6 biens, guide vers le simulateur.

**Layout grille** : `grid-template-columns: repeat(auto-fill, minmax(280px, 1fr))` — s'adapte à 1, 2 ou 3 colonnes selon la largeur du panneau.

### 2.3 Sections conservées (repositionnées)

- Alertes + Capacité d'achat → 2 colonnes, après les grilles de cartes
- Priorités de portefeuille + Arbitrage des acquisitions → après alertes
- Tables "Pipeline" et "Parc détenu" → **supprimées** (remplacées par les cartes)  
  *Exception* : si 0 bien dans un scope, afficher un message vide à la place de la grille

---

## 3. Liaison Saisie ↔ Portefeuille

### 3.1 Barre de statut sous les boutons d'action

Élément HTML ajouté sous `#save-portfolio` dans `index.html`. Rendu par `syncAssetActionLabels()` dans `main.js`.

**Quatre états** :

| État | Indicateur | Badges scope |
|---|---|---|
| Nouvelle étude non sauvée | `○` gris · "Nouvelle étude · pas encore enregistrée" | — |
| Sauvée, non modifiée | `✓` vert · "À jour · sauvegardé il y a X min" | Comparateur et/ou Portefeuille |
| Sauvée, modifiée | `●` orange · "Modifié · non sauvegardé" | Comparateur et/ou Portefeuille |

**Détection "modifié"** : comparer `JSON.stringify(state.variablesData)` avec `JSON.stringify(savedRecord.variablesData)` à chaque rendu. Si différent → état "Modifié".

**Horodatage** : stocker `updatedAt` (déjà présent dans les records) — afficher "il y a X min" calculé depuis `Date.now()`.

**Badges scope** : lire `state.assetRecords.find(r => r.id === state.activeAssetId)` → `.inComparison` et `.inPortfolio`.

### 3.2 Flash de confirmation après sauvegarde

Dans `createOrUpdateCurrentAsset()` (appelé par les boutons save), après la mise à jour :
1. Ajouter class `is-saved-flash` au bouton cliqué
2. Changer son texte → "✓ [scope] mis à jour"
3. Retirer la class après 2000ms (`setTimeout`)

Style CSS `.is-saved-flash` : `background: var(--success-subtle)`, `border-color: var(--success)`, `color: var(--success)`.

### 3.3 Navigation après "Ouvrir"

`loadAssetIntoWorkspace` navigue vers l'onglet Saisie & Analyse après chargement. Implémenter en simulant un clic sur le nav item correspondant ou en appelant directement la logique de navigation existante.

---

## 4. Saisie & Analyse — ajustements mineurs

Aucun changement structurel. Un seul ajout :

- La barre de statut (§3.1) est positionnée dans la section des boutons d'action du panneau Saisie, juste sous `#save-portfolio`.

---

## 5. Fichiers modifiés

| Fichier | Nature des changements |
|---|---|
| `index.html` | Ajout `#asset-status-bar` sous `#save-portfolio` ; remplacement des `#comparison-table` et `#portfolio-table` par `#portfolio-asset-grid-pipeline` et `#portfolio-asset-grid-owned` ; ajout `#portfolio-kpi-banner` |
| `main.js` | `renderCollections()` : ajout `buildPortfolioKpiBanner()`, `buildPortfolioAssetGrid()`; suppression `buildComparisonTable()` / `buildPortfolioTable()`; `syncAssetActionLabels()` : ajout rendu barre de statut; `createOrUpdateCurrentAsset()` : ajout flash; `loadAssetIntoWorkspace()` : ajout navigation |
| `calculs.js` | Aucun changement — toutes les données nécessaires sont déjà dans `computePortfolioViewModel` |
| `styles.css` | Classes `.portfolio-kpi-banner`, `.asset-card`, `.asset-card__waterfall`, `.asset-card__kpis`, `.asset-card__actions`, `.is-saved-flash`, `.asset-status-bar`, `.asset-status-badge` |

### Notes d'implémentation

**Navigation après "Ouvrir"** : après `loadAssetIntoWorkspace(id)`, simuler un clic sur `.workspace-tab[data-target="workspace-panel"]` pour revenir à l'onglet Saisie & Analyse.

**Remplacement des tables** : `nodes.comparisonTable` et `nodes.portfolioTable` sont référencés dans `nodes`, dans `renderCollections()`, et comme cibles d'événements `click` (via `handleAssetTableAction`). Les supprimer et les remplacer par `nodes.portfolioAssetGridPipeline` et `nodes.portfolioAssetGridOwned` — déplacer les event listeners vers ces nouveaux conteneurs.

**Bouton PDF dans les cartes** : charge le bien dans le workspace via `loadAssetIntoWorkspace(id)` puis appelle immédiatement `handleDecisionSummaryExport()`. L'effet de bord (changement d'étude courante) est intentionnel et cohérent avec le bouton "Ouvrir".

---

## 6. Non-périmètre

- Pas de modification de `calculs.js` — le moteur financier n'est pas touché
- Pas de nouvelle route API
- Pas de modification du scanner
- Pas de refonte de la section Saisie au-delà de la barre de statut
- Les sections Alertes, Capacité, Concentration, Priorités, Arbitrage gardent leur logique — seul leur positionnement change

---

## 7. Critères de succès

- [ ] Le bandeau 6 KPIs affiche des valeurs cohérentes avec les données saisies dans le simulateur
- [ ] Les cartes riches reflètent le tone de décision correct pour chaque bien
- [ ] Le mini-waterfall est proportionnel aux flux réels du bien
- [ ] La barre de statut passe à "Modifié" dès qu'un champ du formulaire change
- [ ] Le flash de confirmation apparaît 2s après chaque sauvegarde puis disparaît
- [ ] "Ouvrir dans le simulateur" charge les hypothèses et navigue vers Saisie & Analyse
- [ ] Avec 0 bien dans un scope, un état vide clair est affiché à la place de la grille
- [ ] Le layout en grille s'adapte à 1, 2 ou 3 colonnes
