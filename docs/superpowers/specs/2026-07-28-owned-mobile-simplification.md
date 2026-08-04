# Simplification de la version smartphone du portefeuille (owned.html)

## Contexte

`owned.html` est une page dédiée iPhone, servie séparément d'`index.html`, qui réutilise
le même moteur de rendu (`owned-portfolio.js`) que le portefeuille biens détenus du PC.
Elle vient d'être ajoutée (non encore publiée) et reprenait jusqu'ici l'intégralité du
rendu PC : dashboard dirigeant, carte, graphiques Chart.js, tableau large avec tri/glisser-
déposer, comparaison des 3 régimes fiscaux, tuiles de verdict An1/3/5/10, diagnostic IA.
Sur un écran de 390 px de large, plusieurs de ces blocs débordent (cartes coupées, colonnes
de tableau tronquées) et l'ensemble est de toute façon trop dense pour un usage mobile.

Deux bugs visuels indépendants ont déjà été identifiés et corrigés pendant l'audit initial :
- `.shell` avait un `padding-top` mobile (184–198px) calibré pour le topbar multi-lignes
  d'`index.html` ; sur `owned.html` (topbar à une seule ligne) ça laissait ~125px de vide
  sous le bandeau. Corrigé via une classe `.shell--owned` avec un padding réduit.
- Le libellé "Régime fiscal du portefeuille" restait visible sur l'écran de connexion,
  orphelin (son sélecteur ne se rend qu'une fois authentifié). Corrigé en le masquant
  tant que `_authUser` est absent.

## Objectif

`owned.html` doit être un outil de saisie/consultation minimal, pensé pour un usage
one-hand sur iPhone (iPhone 17 en particulier — ~390-395pt de large) : ajouter/éditer un
bien, consulter son cash-flow net-net après impôt et le détail de son calcul. Pas de
dashboard, pas de graphiques, pas de comparaison de régimes, pas de diagnostic IA.
`index.html` (PC) n'est pas concerné et garde le rendu actuel intégralement.

## Mécanisme

Un flag `IS_MOBILE_PAGE` (booléen), sur le même modèle que `IS_ANALYSIS_WINDOW`, est
passé à `initOwnedPortfolio(deps)` :
- `owned-entry.js` (owned.html) → `IS_MOBILE_PAGE: true`
- `main.js` (index.html) → `IS_MOBILE_PAGE: false`

Les fonctions de rendu partagées vérifient ce flag pour sauter les blocs non désirés côté
mobile, sans dupliquer de fichier ni toucher au chemin PC (`IS_MOBILE_PAGE` restant `false`
pour `index.html`, ces branches ne s'exécutent jamais côté PC).

## Vue liste (`renderOwnedPortfolioList`)

Gardé, inchangé : le sélecteur de régime fiscal (`renderOwnedRegimeSelector`) et les 3
mini-cartes déjà minimales du `owned-kpi-banner` (CF net-net/mois total, rendement brut
moyen, nombre de biens) — elles servent déjà de résumé chiffré léger.

Retiré (jamais rendu quand `IS_MOBILE_PAGE`, conteneurs restent vides comme au chargement
initial de la page) : `renderOwnedMap` (carte Leaflet), `renderOwnedPortfolioCharts`
(graphiques CF cumulé / recettes-dépenses), `renderOwnedDashboard` (centre d'actions,
objectifs), `renderOwnedCfConsolidatedSection` (répartition CF par bien).

Remplacé : le tableau large (`#owned-list-table`, tri, glisser-déposer, DSCR, donut inline,
alertes régime — qui déborde à 390px) par une nouvelle fonction `_renderOwnedListMobile(list)`
qui rend une liste verticale de cartes tap-to-open (nom du bien, ville, CF net-net/mois),
réutilisant `computeOwnedAssetCF` + `openOwnedDetail` déjà existants. Pas de tri, pas de
glisser-déposer : l'ordre est celui de `getOrderedAssetList()`.

## Fiche détail (`renderOwnedDetail`)

Retiré quand `IS_MOBILE_PAGE` (fonctions non appelées) : `renderOwnedSynthese` (bandeau
mensualité/investissement total/renta brute/DSCR/patrimoine net/comparaison régimes),
`renderOwnedVerdictBlock` (tuiles An1/3/5/10), `renderOwnedCharts` (3 graphiques),
`renderOwnedCrdChart` (capital restant dû), `renderAccordionSimulateur` (matrice de
scénarios — déjà sans emplacement visible dans `owned.html`), `renderOwnedCfTable`
(tableau flux de trésorerie annuels), `renderOwnedProjectionContent` (comparaison des
3 régimes, seul contenu de l'onglet Projection).

Le bouton Diagnostic IA (`nodes.ownedDiagnosticBtn`) est masqué inconditionnellement
(déjà inopérant sur cette page, pas de serveur local sur iPhone).

L'onglet **Projection** (bouton + panneau) est masqué : son seul contenu était la
comparaison des régimes, déjà retirée.

Gardé tel quel, sans changement de logique : onglets **Acquisition** (formulaire, lots
d'immeuble), **Exploitation** (charges récurrentes, **détail du calcul du CF net-net**
via `computeCFBreakdown`/`renderCFBreakdownHTML` — l'indicateur central demandé, historique
de loyer, résumé travaux, déficits fonciers, notes), **Travaux** (CRUD frais + justificatifs
PDF). ⁠Ce sont déjà des formulaires de saisie/édition, pas des blocs d'analyse.

## Correctif CSS additionnel

`.owned-travaux-row` utilise une grille à 8 colonnes de largeurs fixes
(`20px 110px 1fr 90px 120px 28px 26px 24px`, ≥ 418px de large avant même le `1fr` et les
gaps) — déborde sur un écran de 390px. Ajout d'une variante empilée scopée à
`.shell--owned` (la page mobile), sans toucher au rendu desktop de ce même composant.

## Hors périmètre

- Pas de changement sur `index.html` / `main.js` (mode PC).
- Pas de nouveau calcul : tout réutilise les fonctions `calculs.js` déjà exportées et déjà
  appelées ailleurs dans `owned-portfolio.js`.
- Pas de gestion d'un futur retour en arrière/toggle "afficher plus" côté mobile — décision
  volontairement définitive pour cette page.
