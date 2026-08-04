# Spec — Portefeuille : graphiques, régime global, charges évolutives

Date : 2026-06-11

## Périmètre

1. **Sélecteur de régime fiscal global** — puce coulissante 3 positions appliquée à tout le portefeuille
2. **Deux graphiques côte à côte** — CF net cumulé + Recettes vs Dépenses — dans la vue liste (consolidé) et la vue détail (par bien)
3. **Suppression sécurisée** — modale exigeant la saisie du mot "Supprimer"
4. **Charges évolutives par année** — taxe foncière, gestion locative, assurance PNO modifiables année par année
5. **Graphiques dynamiques** — re-render immédiat à chaque modification des accordéons Acquisition et Post-achat

---

## 1. Sélecteur de régime global

### Emplacement
Dans le KPI banner de la vue liste "Biens détenus", au-dessus ou en dessous des 3 cartes KPI.

### Composant
Puce coulissante (`owned-regime-slider`) à 3 positions :
```
[ Micro-foncier ]  [ Réel ]  [ SCI-IS ]
```
Le fond doré (var `--accent`) glisse avec une transition CSS vers la position active.

### État
- `state.ownedRegime` (string, défaut `'micro-foncier'`)
- Persisté dans `localStorage` sous la clé `investissementWebOwnedRegime`
- Lu via `getOwnedRegime()` dans `main.js`

### Périmètre d'effet
| Composant | Utilise le régime global |
|---|---|
| KPI banner (CF total) | ✓ |
| Tableau biens (colonne CF) | ✓ |
| Graphiques vue liste | ✓ |
| Synthèse financière (vue détail) | ✓ |
| Graphiques vue détail | ✓ |
| Simulateur par scénario | ✗ (conserve son propre régime par scénario) |

### Déclenchement
À chaque changement de puce : `renderOwnedPortfolioList()` complet.

---

## 2. Graphiques côte à côte

### Structure HTML
Un conteneur `owned-charts-row` avec deux blocs `owned-chart-block` :
- `#owned-cfcum-chart` — canvas CF cumulé
- `#owned-ecart-chart` — canvas Recettes vs Dépenses

Présents à deux endroits :
- **Vue liste** : nouveau conteneur `#owned-portfolio-charts` après le KPI banner
- **Vue détail** : remplace le conteneur `#owned-cashflow-chart-wrap` existant

### Graphique gauche — CF net après impôt cumulé

**Calcul par année :**
```
cfAnnée = loyers × (1 − vacance/100) × 12
        − mensualitéTotale × 12  (si année < annéeFinCrédit)
        − chargesAnnée (taxe foncière + copro×12 + PNO + gestion)
        − impôtsAnnée (via buildFinancialModel, régime global)
```
`cumulCF` = somme des `cfAnnée` depuis `annéeAchat`.

**Rendu :** ligne unique, couleur dorée, fill sous la courbe.

### Graphique droite — Recettes vs Dépenses

**Recettes cumulées :**
```
recettesAnnée = loyers × (1 − vacance/100) × 12
recettesCum = somme depuis annéeAchat
```

**Dépenses cumulées :**
```
dépensesAnnée = mensualitéTotale × 12 (si crédit actif)
              + taxeFoncière + chargesCopro×12 + PNO + gestion
              + montantTravaux (avec leur année réelle)
dépenses[annéeAchat] += apport initial
dépensesCum = somme depuis annéeAchat
```

**Rendu :** deux lignes (recettes = vert, dépenses = rouge/doré). Zone entre les deux lignes colorée (vert si recettes > dépenses, rouge sinon). Légende sous le graphique.

### Légende (sous graphique droit)
> Recettes = loyers perçus après vacance locative.  
> Dépenses = apport initial + mensualités crédit + charges courantes (taxe foncière, copro, PNO, gestion) + travaux réalisés.

### Vue liste — consolidation
Pour N biens, l'axe X va de `min(annéeAchat)` à `max(annéeFinCrédit) + 2`.
Pour chaque année, on additionne les valeurs de tous les biens (un bien non encore acquis contribue 0).

### Nouvelle fonction `calculs.js`
```js
export function computeOwnedAssetTimeline(asset, tmi, regimeOverride)
// Retourne : { years: [{ year, cfAnnuel, cumulCF, recettesAnnuel, recettesCum, depensesAnnuel, depensesCum }] }
```
Utilise `buildFinancialModel` pour les impôts, intègre `chargesAnnuelles` (step function).

---

## 3. Suppression sécurisée

### Déclencheur
Bouton ✕ dans le tableau des biens (colonne action).

### Comportement
1. Ouvre une modale `#owned-delete-modal` (non-native, CSS)
2. Affiche : *"Vous êtes sur le point de supprimer **[nom du bien]**. Cette action est irréversible. Pour confirmer, saisissez **Supprimer** ci-dessous."*
3. Champ `<input>` texte
4. Bouton "Supprimer" grisé (`disabled`) jusqu'à ce que `input.value.trim().toLowerCase() === 'supprimer'`
5. Bouton "Annuler" ferme la modale sans action
6. Confirmation → `deleteOwnedAsset(id)` + `renderOwnedPortfolioList()`

### HTML
Modale déclarée dans `index.html`, gérée par `initOwnedPortfolioEvents()`.

---

## 4. Charges évolutives par année

### Modèle de données
```js
postAchat: {
    // Champs plats existants (conservés pour rétrocompatibilité)
    taxeFonciere: 1200,
    gestionLocative: 7,
    assurancePNO: 150,
    chargesCopro: 80,

    // Nouveau — historique annuel des charges variables
    chargesAnnuelles: [
        { annee: 2021, taxeFonciere: 1200, gestionLocative: 7, assurancePNO: 150 }
        // Entrées ajoutées par l'utilisateur pour les années suivantes
    ],

    travaux: [...],
    notes: [...]
}
```

**Règle de résolution :** pour une année Y, prendre l'entrée de `chargesAnnuelles` avec `annee <= Y` la plus récente. Si `chargesAnnuelles` est vide ou absent, fallback sur les champs plats.

### Section dans l'accordéon Post-achat
Titre : **"Évolution des charges"**

Liste des entrées existantes :
```
2021 — TF : 1 200 € · Gestion : 7 % · PNO : 150 €   [✕]
2027 — TF : 1 450 € · Gestion : 7 % · PNO : 180 €   [✕]
```

Bouton `+ Ajouter une année` → formulaire inline :
- Année (number, min = annéeAchat)
- Taxe foncière (€/an)
- Gestion locative (%)
- Assurance PNO (€/an)
- Bouton "Ajouter"

### Initialisation automatique
Quand un asset existant est ouvert et que `chargesAnnuelles` est vide, on crée automatiquement une entrée initiale depuis les champs plats + `anneeAchat`.

### Fonctions `main.js`
- `addOwnedChargesAnnuelles(assetId, entry)` — ajoute et trie par année
- `deleteOwnedChargesAnnuelles(assetId, annee)` — supprime l'entrée
- `resolveChargesForYear(postAchat, year)` — retourne `{ taxeFonciere, gestionLocative, assurancePNO }` pour l'année donnée

---

## 5. Graphiques dynamiques

Chaque modification dans les accordéons Acquisition et Post-achat déclenche :
- `renderOwnedSynthese(asset)` — KPIs synthèse
- `renderOwnedCharts(asset)` — les deux graphiques du détail
- `renderAccordionSimulateur(asset)` — résultats scénarios

Les graphiques de la vue liste ne se re-rendent que si l'on revient à la vue liste (pas de re-render en temps réel sur la liste pendant qu'on est dans le détail).

---

## Fichiers modifiés

| Fichier | Modifications |
|---|---|
| `calculs.js` | Nouveau export `computeOwnedAssetTimeline` ; param `regimeOverride` dans `computeOwnedAssetCF` |
| `main.js` | `state.ownedRegime`, `getOwnedRegime()`, `renderOwnedRegimeSelector()`, `renderOwnedCharts()`, `renderOwnedPortfolioCharts()`, CRUD `chargesAnnuelles`, modale suppression, refonte `renderOwnedCashflowChart` → `renderOwnedCharts` |
| `index.html` | Conteneur `#owned-portfolio-charts`, canvas charts, modale suppression |
| `styles.css` | Classes `.owned-regime-slider`, `.owned-charts-row`, `.owned-chart-block`, `.owned-chart-legend`, `.owned-delete-modal` |
