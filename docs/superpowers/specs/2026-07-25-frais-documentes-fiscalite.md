# Frais documentés (PDF) + fiscalité auto-projetée — portefeuille (2026-07-25)

## Contexte

Aujourd'hui, l'onglet "Travaux" d'un bien détenu gère deux listes séparées et sans lien avec la fiscalité projetée :
- `postAchat.travaux[]` : `{ date, montant, tag }` (tag = déductible / non-déductible / à-classifier) — sert uniquement au suivi de trésorerie (`depensesAnnee` dans `computeOwnedAssetTimeline`), **jamais utilisé dans le calcul fiscal**.
- `postAchat.chargesAnnuelles[]` : une ligne par année groupant taxe foncière + charges copro + % gestion + assurance PNO — c'est la seule chose qui alimente réellement `computeAnnualTaxEstimate` (via `chargesExploitationAnnuelles`).

Aucune des deux ne permet d'attacher un justificatif (PDF), ni un commentaire libre.

## Objectif

Une seule liste de frais documentés par bien, avec import de facture PDF, montant, année, commentaire — qui alimente **réellement** le calcul fiscal des années futures (ce qui n'est pas le cas aujourd'hui pour les travaux déductibles), avec comparaison micro-foncier / réel / SCI-IS déjà existante (`computeRegimeComparison`) qui en bénéficie automatiquement.

## 1. Modèle de données

Remplace `postAchat.travaux` et `postAchat.chargesAnnuelles` par `postAchat.frais[]` :

```js
{
  id: string,
  montant: number,
  annee: number,
  categorie: 'travaux' | 'taxe-fonciere' | 'assurance-pno' | 'copro' | 'gestion' | 'autre',
  deductible: boolean | 'a-classifier',   // uniquement significatif pour categorie === 'travaux'
                                            // les autres catégories sont déductibles par nature (comme aujourd'hui)
  commentaire: string,
  pdfFilename: string | null,              // nom de fichier stocké côté serveur, ou null si pas de justificatif
}
```

**Migration** : au premier chargement d'un bien avec l'ancien format, une fonction convertit `travaux[]` → entrées `categorie:'travaux'` et `chargesAnnuelles[]` → 4 entrées par ligne (`taxe-fonciere`, `copro`, `gestion` — montant calculé `loyer×12×pct/100` de l'année, `assurance-pno`), tag `deductible:true` pour toutes sauf le tag existant des travaux. Migration en lecture, écrite une fois dans le nouveau format puis sauvegardée.

## 2. Stockage et service des PDF

- `POST /api/documents/<bien_id>/upload` (multipart) → sauvegarde dans `documents/<bien_id>/<uuid>.pdf` (dossier créé à côté de `exports/`), retourne `{ filename }`.
- `GET /api/documents/<bien_id>/<filename>` → sert le PDF (`Content-Type: application/pdf`, sans `Content-Disposition: attachment` pour permettre l'aperçu inline).
- Suppression d'un bien (`deleteOwnedAsset`) supprime aussi `documents/<bien_id>/` s'il existe (nouvel appel à un endpoint `DELETE /api/documents/<bien_id>`).
- Validation serveur : extension `.pdf` uniquement, taille max 20 Mo.

## 3. UI — liste "classeur par année"

Dans l'onglet Travaux (renommé "Frais" ou gardé tel quel — détail d'implémentation), la liste `frais` est groupée par année décroissante. Chaque année est un `<details>` (fermé par défaut sauf l'année en cours), avec un total dans le `<summary>`. Chaque ligne affiche : catégorie, montant, commentaire, icône PDF si présent, case à cocher, bouton supprimer.

- Clic sur l'icône PDF ou la ligne → aperçu inline (`<embed type="application/pdf">` dans un panneau/modal existant, réutilisant le pattern de drawer déjà présent dans l'app) pointant vers `GET /api/documents/...`.
- Case à cocher par ligne + bouton "Imprimer la sélection" (actif dès qu'au moins 1 ligne cochée avec PDF) → ouvre un nouvel onglet listant les PDF sélectionnés à la suite (un `<embed>` par PDF avec `break-after: page` en CSS print), puis appelle `window.print()`. Pas de fusion serveur, pas de génération d'un fichier — le dialogue d'impression Windows standard s'occupe du reste (comme demandé).

## 4. Formulaire d'ajout

Remplace les deux formulaires actuels ("+ Ajouter" travaux, "+ Ajouter" charges annuelles) par un seul : montant, année, catégorie (select), déductible (visible seulement si catégorie = travaux), commentaire (texte libre), champ fichier PDF (optionnel, `<input type="file" accept="application/pdf">` → upload immédiat au submit).

## 5. Moteur fiscal (calculs.js — reste pur, pas de DOM/fetch)

`calculs.js` ne fait pas l'upload ; il reçoit `asset.postAchat.frais` déjà résolu (migration faite en amont côté `main.js`/state) et calcule dessus.

Dans `computeOwnedAssetTimeline` (ligne ~1912) et `computeCFBreakdown` (ligne ~2107), remplacer la lecture de `chargesAnnuelles` par :
- `chargesRecurrentes(y)` = somme des `frais` de catégorie `taxe-fonciere/assurance-pno/copro/gestion` datés `annee === y` (remplace l'ancien mécanisme d'entrée-la-plus-récente-répétée : chaque année a maintenant ses propres lignes, donc plus besoin de report d'une année sur l'autre — **changement de comportement** : si aucune ligne n'existe pour une année charnière, ces charges sont à 0 cette année-là, plutôt que de réutiliser la dernière valeur connue. Documenté comme comportement voulu — l'utilisateur doit désormais saisir une ligne par catégorie par an, ce qui est cohérent avec "toutes les charges dans une seule liste".)
- `travauxDeductibles(y)` = somme des `frais` de catégorie `travaux` avec `deductible === true` datés `annee === y`.
- Le total `chargesRecurrentes(y) + travauxDeductibles(y)` remplace `chargesAnnee` dans l'appel à `computeAnnualTaxEstimate` pour les régimes `reel` et `sci-is`. `micro-foncier` continue d'ignorer ces charges (abattement forfaitaire 30 % inchangé, code déjà correct).
- `depensesAnnee` (suivi de trésorerie) prend la somme de **tous** les `frais` de l'année (déductibles ou non), comme le faisait `travauxAnnee` aujourd'hui.

`computeRegimeComparison` n'a pas besoin de modification : il appelle déjà `computeOwnedAssetTimeline` par régime, donc la correction se propage automatiquement.

## Risque identifié à documenter à l'utilisateur

Le changement de "charges avec report d'année sur année" vers "charges par ligne annuelle explicite" (point 5) signifie que les biens déjà saisis avec seulement 1-2 lignes de `chargesAnnuelles` (comptant sur le report automatique pour les années suivantes) verront leurs charges tomber à 0 pour les années sans ligne explicite après migration, sauf si la migration duplique la dernière ligne connue vers toutes les années futures jusqu'à l'année courante lors de la conversion. **Décision retenue** : la migration duplique la dernière entrée `chargesAnnuelles` connue vers chaque année de `anneeAchat` jusqu'à l'année en cours (comportement identique à l'ancien système au moment de la bascule), mais à partir de la migration, l'utilisateur doit ajouter une ligne par an pour que les projections futures restent correctes (fini le report automatique implicite).
