# Spec — Loyer historisé + édition des frais (portefeuille)

Date : 2026-07-27
Statut : validé par l'utilisateur

## Problème 1 — saisie du loyer

L'onglet Exploitation impose aujourd'hui une saisie **mois par mois** du loyer réellement encaissé
(section "Suivi des loyers réels" : mois, montant, statut encaissé/impayé/vacant/partiel).
L'utilisateur ne veut pas de ce suivi mensuel. Il veut :

- saisir **un loyer de base** et **la date de début de location** ;
- saisir plus tard une **nouvelle valeur de loyer** avec le **mois et l'année de prise d'effet**,
  quand il augmente ou diminue le loyer.

Constat important trouvé dans le code : `computeOwnedAssetTimeline` (calculs.js) traite déjà le
loyer comme **constant** sur toute la durée de projection — il n'exploitait pas le suivi mensuel.
Le changement demandé n'est donc pas cosmétique : il rend le moteur de calcul capable de refléter
les évolutions de loyer dans le temps, ce qu'il ne faisait pas.

## Problème 2 — édition des frais

Dans l'onglet Travaux ("Frais & justificatifs"), un frais ajouté ne peut être que supprimé.
Il n'existe pas de `updateOwnedTravail` — seulement `addOwnedTravail` / `deleteOwnedTravail`.
L'utilisateur veut pouvoir modifier un frais existant.

## Solution 1 — modèle "loyer de base + évolutions"

### Données

Nouveau champ : `asset.postAchat.loyerHistorique = [{ mois: 'YYYY-MM', montant: number }]`,
trié par `mois` croissant.

- La **première entrée** porte à la fois le loyer de départ et la date de début de location.
- Chaque augmentation/baisse ultérieure = une nouvelle entrée.
- Le **loyer applicable à une date donnée** = la dernière entrée dont `mois <= date`.
  Même principe que `postAchat.chargesAnnuelles` (déjà en place), à la granularité du mois.

Rétrocompatibilité : un bien sans `loyerHistorique` retombe sur `acquisition.loyerInitial`
(comportement actuel). Aucune migration de données n'est requise.

### Résolution du loyer (calculs.js)

`resolveLoyerVacance(asset)` reste le point d'entrée unique, mais gagne un paramètre optionnel de
date cible et une résolution en trois niveaux, dans cet ordre :

1. `asset.lots[]` si présent (immeuble de rapport — comportement actuel inchangé) ;
2. sinon `postAchat.loyerHistorique` : dernière entrée avec `mois <= date cible` ;
3. sinon `acquisition.loyerInitial` (biens existants).

`computeOwnedAssetTimeline` passe l'année de chaque itération pour que la projection reflète les
évolutions de loyer année par année. Les autres consommateurs (`computeOwnedAssetCF`,
`computeCFBreakdown`, `computeRevenusLocatifsBruts`, `computeCompteResultat`) passent la date
pertinente à leur contexte ; sans argument, la fonction résout au mois courant.

### UI (onglet Exploitation)

La section "Suivi des loyers réels" est **remplacée** par une section "Loyer" :

- loyer actuel affiché en tête (résolu au mois courant) ;
- liste de l'historique (même présentation que "Évolution des charges") avec suppression par ligne ;
- formulaire d'ajout : `Loyer (€/mois)` + `À partir de (mois/année)` + bouton Ajouter.

Le champ "Loyer initial" de l'onglet Acquisition devient **lecture seule** (affiche le loyer
résolu) avec un renvoi vers l'onglet Exploitation, pour supprimer la double source de saisie.
Exception : les immeubles de rapport gardent le comportement actuel (loyer piloté par les lots).

### Suppressions assumées (validées avec l'utilisateur)

- Tableau mensuel encaissé/impayé/vacant/partiel + son formulaire (`add-loyer`).
- `addOwnedLoyerReel` / `deleteOwnedLoyerReel` et le champ `postAchat.loyersReels`.
- `computeTresorerieReelle` (calculs.js) et la carte "Trésorerie réelle" de la synthèse du bien :
  cette carte ne se calculait qu'à partir du suivi mensuel, elle deviendrait morte.
- Alerte dashboard `loyer-manquant` ("Loyer de YYYY-MM non saisi") : sans saisie mensuelle, elle
  n'a plus d'objet.
- Dans `computeCompteResultat`, la branche qui privilégiait la somme des loyers réels de l'année :
  remplacée par le loyer résolu depuis l'historique (plus fidèle qu'avant, puisqu'il suit les
  évolutions).

### Adaptations (pas des suppressions)

- Alerte `loyer-non-revise` : conservée, mais recalculée depuis la date de la dernière entrée de
  `loyerHistorique` (> 12 mois sans changement) au lieu de 12 entrées mensuelles identiques.

### Hors périmètre

- "Déficits fonciers reportables" : inchangé. L'utilisateur ne s'en sert pas mais n'a pas demandé
  sa suppression, et il alimente la déclaration 2044 et une alerte du dashboard.

## Solution 2 — édition d'un frais

- Nouvelle fonction `updateOwnedTravail(assetId, travailId, patch)` dans owned-portfolio.js,
  symétrique de `addOwnedTravail` (mêmes validations : montant ≥ 0, tag dans la liste autorisée).
- Bouton ✏️ ajouté sur chaque ligne de `renderOwnedTravauxTab`, ouvrant une modale via
  `_showOwnedModal` (système générique déjà utilisé par Compte de résultat / Simuler travaux,
  fermeture croix/fond/Échap incluse).
- La modale pré-remplit date, description, montant, tag, commentaire. "Enregistrer" applique le
  patch puis rafraîchit l'onglet Travaux, la synthèse, les graphiques, le simulateur et
  l'accordéon Exploitation (mêmes rafraîchissements que la suppression existante).
- Le PDF joint n'est pas remplaçable depuis cette modale (supprimer/recréer le frais pour cela) —
  décision assumée pour garder la modale simple.

## Tests

- Tests JS sur la résolution du loyer : historique vide → `loyerInitial` ; une entrée → ce montant
  à partir de sa date ; plusieurs entrées → bonne valeur avant/après chaque date de prise d'effet ;
  lots présents → priorité aux lots.
- Vérification dans l'app (Playwright + captures) : saisie du loyer de base, ajout d'une évolution,
  contrôle que le CF et la projection changent à la bonne année ; édition d'un frais existant.
