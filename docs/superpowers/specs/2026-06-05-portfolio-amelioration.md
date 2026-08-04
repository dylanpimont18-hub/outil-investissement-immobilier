# Spec — Amélioration portefeuille : projection patrimoniale et simulateur d'impact

**Date :** 2026-06-05
**Statut :** Approuvée

---

## Contexte

Le panel portefeuille dispose déjà d'une infrastructure solide (hero, KPI banner, grilles d'actifs, priorités, fiscal, dette, objectif, projection, répartition, crédits, timeline). Deux faiblesses identifiées :

1. **Projection patrimoniale** — 3 chiffres statiques (5 / 10 / 15 ans) sans graphique, sans intégration de la dette qui décroit. Ne montre pas la création d'equity réelle.
2. **Simulation d'impact** — aucun moyen de tester l'effet d'ajouter un bien du pipeline sur les ratios consolidés sans le basculer manuellement en statut "détenu".

---

## Fonctionnalité 1 — Projection patrimoniale : double courbe SVG

### Objectif

Remplacer les 3 pills statiques par un graphique SVG natif (pas de lib externe) montrant deux séries sur 15 ans.

### Courbes

| Série | Couleur | Description |
|---|---|---|
| Valeur brute | Or `#C5A059`, pointillée | `prix_net × (1 + revaloAnnuelle)^t` par bien, sommé |
| Valeur nette (equity) | Vert `#4ade80`, pleine | Valeur brute − capital restant dû total à l'instant t |

### Calcul du capital restant dû dans le temps

Pour chaque bien du portefeuille, si `creditSchedule` est défini (`mensualite` + `dateFin`), on calcule le CRD à l'année `t` en comptant les mois restants depuis la date `t` jusqu'à `dateFin`. La fonction `capitalRestantDu(mensualite, dateFin)` existante est étendue pour accepter une date de référence arbitraire (au lieu de `new Date()` en dur).

Si aucun `creditSchedule` n'est défini pour un bien, le CRD est supposé nul (hypothèse conservative : bien payé comptant ou crédit non renseigné).

### Génération des points

`computeProjectionPatrimoniale()` dans `calculs.js` génère 16 points (années 0 à 15) pour chaque série. Les jalons 5 / 10 / 15 restent affichés en chiffres sous le graphique pour garder la lisibilité.

### Axe et mise en page

- Axe X : année courante à année+15, marqueurs tous les 5 ans
- Axe Y : valeurs en k€ (pas de graduation — juste les valeurs aux marqueurs)
- Dimensionnement : `viewBox="0 0 400 120"`, `width:100%`
- Le graphique remplace le contenu du `<div id="portfolio-projection">` existant

---

## Fonctionnalité 2 — Simulateur d'impact (calcul bancaire complet)

### Objectif

Un nouveau bloc "Simulateur de croissance" permet de cocher un ou plusieurs biens du pipeline et d'observer en temps réel l'impact sur les KPIs consolidés, avec un calcul bancaire exact.

### Position dans la page

Entre `#portfolio-kpi-banner` et `#portfolio-hero`. Nouveau `<div id="portfolio-simulator">` ajouté dans `index.html`.

### Structure du bloc

```
┌─────────────────────────────────────────────────────────┐
│  Simulateur de croissance                               │
│                                                         │
│  [Checkboxes pipeline]     │  [État actuel] [Simulé]   │
│  ☑ Appt T3 Blois  +142€   │  CF : +328€   CF : +470€  │
│  ☐ Maison Vendôme  -18€   │  HCSF : 28% ✓ HCSF : 31%✓│
│  ☐ Studio Tours   +89€    │  Capa : 180k  Capa : 152k  │
└─────────────────────────────────────────────────────────┘
```

### KPIs affichés dans la comparaison

| KPI | Source |
|---|---|
| CF net-net / mois | `dashboard.totalCashflow` |
| DSCR consolidé | `dashboard.dscr` |
| Taux HCSF | `debtRatios.hcsf.ratio` + indicateur ≤35% |
| Taux différentiel | `debtRatios.differentielle.ratio` |
| Capacité d'emprunt restante | Calculée avec formule paramétrée (voir ci-dessous) |
| Rendement net-net moyen | Pondéré par coût total |

### Indicateur HCSF

- ≤ 35 % → pill verte "Conforme HCSF"
- > 35 % → pill rouge "Dépassement HCSF · +X pts"

### Calcul de la capacité d'emprunt (remplacement du facteur 172)

```js
function amortizationFactor(tauxAnnuel, dureeAns) {
    const r = (tauxAnnuel / 100) / 12;
    const n = dureeAns * 12;
    if (r === 0) return n;
    return (1 - Math.pow(1 + r, -n)) / r;
}
```

Les paramètres `taux` et `duree` sont lus depuis `referenceInputs` (les inputs du simulateur actif). Si absents, fallback : 3,5 % / 20 ans.

### Mécanique de simulation (côté `main.js`)

1. Un `Set simulatedIds` local dans le scope du panel portefeuille stocke les IDs cochés.
2. À chaque coche/décoche, on construit `simulatedRecords = [...assetRecords, ...pipelineItems filtrés]` en injectant temporairement `inPortfolio: true` sur les biens sélectionnés.
3. On appelle `computePortfolioViewModel(simulatedRecords, profileData, activeAssetId, variablesData)`.
4. Le résultat alimente la colonne "Simulé". TMI et debtRatios sont recalculés automatiquement.
5. Aucune modification de `calculs.js` nécessaire sauf : (a) extension de `capitalRestantDu` avec date de référence, (b) remplacement du facteur 172 par `amortizationFactor`.

### Cas vide

Si aucun bien du pipeline n'est disponible (tous déjà au portefeuille ou pipeline vide), le bloc affiche un message : "Ajoutez des dossiers dans le comparateur pour simuler leur impact."

---

## Modifications de fichiers

| Fichier | Changements |
|---|---|
| `calculs.js` | `capitalRestantDu(mensualite, dateFin, refDate?)` — paramètre optionnel ; `computeProjectionPatrimoniale()` — génère 16 points avec CRD par bien ; `amortizationFactor(taux, duree)` nouvelle fonction ; `computePortfolioViewModel` — utilise `amortizationFactor` à la place de 172 |
| `main.js` | `buildPortfolioProjection()` — remplace pills par SVG double courbe ; `buildPortfolioSimulator()` — nouveau renderer ; `renderCollectionsView()` — appelle `buildPortfolioSimulator` |
| `index.html` | `<div id="portfolio-simulator">` avant `#portfolio-hero` |
| `styles.css` | Classes `.simulator-shell`, `.simulator-cols`, `.simulator-check-list`, `.simulator-compare`, `.simulator-kpi`, `.hcsf-pill--ok`, `.hcsf-pill--over` |

---

## Ce qui n'est pas dans ce scope

- Optimisation fiscale automatique (suggérer un changement de régime)
- Alertes push / notifications
- Graphiques pour les autres blocs (fiscal, répartition)
- Export PDF du simulateur
