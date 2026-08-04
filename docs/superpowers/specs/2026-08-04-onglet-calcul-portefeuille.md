# Onglet Calcul — détail des indicateurs, mobile + PC

## Contexte

Le détail de calcul d'un bien détenu est aujourd'hui éclaté à plusieurs endroits, avec une disparité mobile/PC :

- **`owned-synthese`** (bloc persistant au-dessus des onglets, **PC uniquement**, `renderOwnedSynthese`) : cartes indicateurs (mensualité crédit, investissement total, CF avant/après impôt, renta brute, DSCR, patrimoine net), alertes (régime optimal, seuil micro-foncier, loyer sous-évalué), et mini-cartes "Défiscalisation" (comparaison des 3 régimes pour le scénario courant).
- **Onglet Exploitation** (`acc-postachat-content`) : mélange formulaire d'édition (charges, historique, loyer) et résultat de calcul (détail CF étape par étape via `renderCFBreakdownHTML`, tableau "Flux de trésorerie annuels" via `renderOwnedCfTable` — **PC uniquement**).
- **Onglet Projection** : comparatif des 3 régimes fiscaux sur 1/3/5/10 ans (`renderOwnedProjectionContent` → `renderRegimeComparisonHTML`) + 4 graphiques Chart.js (CF cumulé, recettes/dépenses, capital restant dû, dépenses) — **PC uniquement**.
- **Modale "Compte de résultat"** (`openCompteResultatModal`) : déjà détaillée et déjà disponible mobile + PC, déclenchée depuis Exploitation et depuis `owned-synthese`.
- **Modale "Simuler des travaux"** : déjà disponible mobile + PC, déclenchée depuis `owned-synthese` (PC uniquement, donc en pratique inaccessible sur mobile).

Sur mobile (`owned.html`, `IS_MOBILE_PAGE`), tous les blocs marqués PC uniquement ci-dessus sont absents : seul le détail CF d'une année (dans Exploitation) et la modale Compte de résultat sont visibles. L'utilisateur veut retrouver l'intégralité du détail de calcul sur mobile, et sur PC un onglet dédié plutôt qu'un mélange saisie/résultat dans Exploitation et un onglet Projection à part.

## Objectif

Un onglet **Calcul**, identique mobile et PC, qui regroupe tout le détail chiffré d'un bien. L'onglet Exploitation redevient un onglet de saisie pure. L'onglet Projection est supprimé, graphiques inclus (jugés non prioritaires par l'utilisateur face à la charge de maintenance).

## Structure finale des onglets (mobile + PC, identique)

`Acquisition` / `Exploitation` / `Travaux` / `Calcul` — 4 onglets (au lieu de 4 avec Projection en plus).

### Onglet Exploitation (modifié — retrait du résultat)

Reste : formulaire charges récurrentes, historique des charges (ajout/suppression), loyer actuel + historique (ajout/suppression), lien "Gérer les frais & justificatifs →" vers Travaux.

Retiré (déplacé vers Calcul) : le bloc `renderCFBreakdownHTML` et son bouton "Détail du calcul des impôts (compte de résultat)" (mobile), le tableau `owned-cf-table-wrap`.

### Onglet Calcul (nouveau), dans cet ordre

1. **Indicateurs clés** — cartes : mensualité crédit (+ dont assurance), investissement total (+ apport), CF avant impôt, CF après impôt, renta brute, DSCR, patrimoine net (ou lien "Renseigner la valeur" si absente). Reprend le contenu cartes de `renderOwnedSynthese`, sans les alertes ni les mini-cartes défiscalisation (voir ci-dessous).
2. **Défiscalisation — comparaison des régimes** (scénario courant) : les mini-cartes actuelles de `owned-synthese` (impôts/an et CF net-net par régime, badge régime actif/optimal) + bouton "🔧 Simuler des travaux" (ouvre la modale existante, inchangée).
3. **Détail du CF net-net** — `renderCFBreakdownHTML`, sélecteur d'année inchangé (`state.ownedYearFilters`).
4. **Flux de trésorerie annuels** — `renderOwnedCfTable`, tableau multi-années inchangé (scroll horizontal déjà en place pour mobile).
5. **Comparatif des régimes fiscaux dans le temps** — `renderRegimeComparisonHTML` (an 1/3/5/10, badge optimal, alerte si le régime optimal change entre an 1 et an 5), déplacé depuis Projection.
6. Bouton **"📊 Compte de résultat"** (ouvre `openCompteResultatModal`, inchangée) — un seul point d'entrée au lieu de deux (Exploitation + synthese).

Toutes les fonctions ci-dessus perdent leur garde `if (IS_MOBILE_PAGE) return;` puisqu'elles s'affichent désormais aussi sur mobile.

### Alertes (inchangées dans leur logique, déplacées visuellement)

Les 3 alertes (régime optimal plus avantageux, seuil micro-foncier 15k dépassé, loyer sous-évalué vs marché) restent **au-dessus des onglets, toujours visibles** quel que soit l'onglet actif — et deviennent visibles sur mobile (actuellement absentes). Elles sortent du template `renderOwnedSynthese` pour vivre dans un petit bloc dédié (`owned-detail-alerts` ou équivalent), rendu par une fonction séparée appelée sans garde `IS_MOBILE_PAGE`.

### Supprimé

- Onglet Projection et son panneau (`owned-tab-projection` dans `index.html`/`owned.html`).
- Les 4 graphiques Chart.js associés : CF cumulé (`owned-cfcum-chart`), recettes/dépenses (`owned-ecart-chart`), capital restant dû (`owned-crd-chart`), dépenses (`owned-depenses-chart`) — et leurs conteneurs DOM.
- Fonctions JS : `renderOwnedProjectionContent`, `renderOwnedCharts`, `renderOwnedCrdChart`, `renderOwnedDepensesChart`, et toutes leurs invocations dans `renderOwnedDetail()` / les handlers de mutation (ajout travail, édition charges, etc.).
- Variables de chart persistantes associées (`_ownedCfCumChart`, `_ownedEcartChart`, équivalents CRD/dépenses) si elles ne sont pas réutilisées ailleurs.

Ne pas toucher : `renderOwnedPortfolioCharts` (`#owned-portfolio-charts`, dashboard niveau portefeuille) — fonction et conteneur distincts, hors périmètre. Le bloc "Verdict" (`renderOwnedVerdictBlock`, score de décision) reste inchangé, PC uniquement.

## Data flow

Aucun nouveau calcul : toutes les fonctions `calculs.js` utilisées (`computeOwnedAssetCF`, `computeCFBreakdown`, `computeOwnedAssetTimeline`, `computeRegimeComparison`, `computePatrimoineNet`, `getOptimalRegime`, `computeAmortizationSchedule`) sont déjà celles employées aujourd'hui — uniquement leur point d'affichage change. Le nouvel onglet Calcul est rendu par une fonction `renderOwnedCalculTab(asset)` qui orchestre les rendus existants (`renderCFBreakdownHTML`, `renderOwnedCfTable`, `renderRegimeComparisonHTML`, cartes indicateurs) dans un seul conteneur DOM, appelée depuis `renderOwnedDetail()` sans garde `IS_MOBILE_PAGE`.

## Hors périmètre (assumé, pas à réintroduire sans redemander)

- Pas de nouveau graphique ni de reprise des graphiques supprimés sous une autre forme.
- Pas de changement du contenu ou de la logique des modales "Compte de résultat" et "Simuler des travaux" — seul leur point d'accès est consolidé.
- Pas de changement du bloc "Verdict".
- Pas de refonte du tableau "Flux de trésorerie annuels" (20 lignes non repliables, signalé en 2026-08-04) — déplacé tel quel, ce problème connu n'est pas traité ici.

## Tests

- Pas de nouvelle logique dans `calculs.js` — aucun test `node:assert` supplémentaire nécessaire.
- Playwright (stub `owned-cloud.js`, technique déjà en place) : vérifier sur `index.html` **et** `owned.html`, avec un bien complet (prix + crédit renseignés) — présence des 6 sections de l'onglet Calcul, absence de l'onglet Projection, onglet Exploitation limité aux formulaires (plus de détail CF ni tableau), alertes visibles au-dessus des onglets sur les deux pages, ouverture des modales Compte de résultat / Simuler des travaux depuis Calcul, aucune erreur console.
- Vérification visuelle manuelle sur mobile réel (iPhone) avant validation finale, comme d'habitude pour les changements `owned.html`.
