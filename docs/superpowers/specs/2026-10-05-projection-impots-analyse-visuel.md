# Projection des impôts — analyse et visuel (2026-10-05)

Point de départ : la modale « Impôts des prochaines années » (`openProjectionImpotsModal`,
owned-portfolio.js) livrée le 2026-10-04 — 4 KPI + un tableau de 11 colonnes, aucun graphique,
régime réel simulé uniquement.

Demande utilisateur : « améliorer l'analyse et le visuel projetés ». Les 4 usages ont été jugés
pertinents ; l'utilisateur a demandé d'enchaîner les 3 lots sans pause de validation intermédiaire.

| Usage | Lot |
|---|---|
| Prévoir mon budget impôts année par année | A |
| Comprendre d'où vient l'impôt, comment le déficit est utilisé | A |
| Décider si / quand faire des travaux (année, étalement) | B |
| Choisir le bon régime dans le temps | C |

## Structure de la modale

Formulaire de simulation **partagé** en tête (bien, montant, année, **répartition 1/2/3 ans** —
nouveau), puis 3 onglets internes (pattern `.owned-tab` / `.owned-tab-panel`) :

1. **Projection** (lot A)
2. **Quand faire les travaux ?** (lot B)
3. **Quel régime ?** (lot C)

L'onglet actif et l'année détaillée survivent au recalcul à chaque frappe. Desktop uniquement
(inchangé : bouton non rendu si `IS_MOBILE_PAGE`).

## Lot A — Projection

- **Phrase de synthèse** en tête : impôt moyen par an, année la plus chère, année d'épuisement du
  report de déficit si elle tombe dans l'horizon.
- KPI existants conservés.
- **Graphique 1 — Impôt du foyer par année** (Chart.js, un seul axe en €) : barres = impôt du foyer
  (avec les travaux), ligne = « sans les travaux à venir », ligne grise = « salaires seuls »
  (l'impôt sans aucun bien locatif). L'écart barre ↔ ligne grise = coût fiscal de l'immobilier.
  Clic sur une barre → sélectionne l'année du détail.
- **Graphique 2 — Réserve de déficit reportable** : barres empilées par année = report restant en
  fin d'année / report utilisé dans l'année / report expiré dans l'année.
- **Détail d'une année** (sélecteur d'année) : deux colonnes « livre de compte » —
  revenu foncier (loyers − charges − intérêts − travaux = résultat ; puis report utilisé / déduit
  des salaires / reporté → revenu foncier imposable) et impôt (IR sur salaires seuls ± effet du
  foncier = IR ; + prélèvements sociaux = impôt du foyer).
- Le tableau de 11 colonnes passe dans un `<details>` « Détail année par année » (replié).

Moteur : `computeProjectionImpotsFoyer` gagne `effetFoncier` par année (= impôt total − impôt
salaires seuls) et un objet `synthese` { impotMoyen, anneeMax, impotMax, anneeFinReport }.
`travauxSimules` accepte désormais un objet **ou un tableau** (étalement) ; la valeur renvoyée
garde la forme reçue (rétro-compatible avec les tests existants).

## Lot B — Quand faire les travaux ?

Nouvelle fonction pure `computeOptimisationTravaux(assets, profileData, { montant, assetId,
anneeDebut, fenetre = 5, horizon = 10 })` :

- options = { année de départ Y ∈ [anneeDebut, anneeDebut + fenetre − 1] } × { étalement 1, 2, 3
  ans en parts égales }, en restant dans la fenêtre ;
- chaque option est rejouée par le moteur réel, sur une **fenêtre de calcul commune**
  [anneeDebut, anneeDebut + fenetre − 1 + horizon] (chaque option a au moins `horizon` années pour
  consommer son report — comparaison équitable) ;
- économie = impôt cumulé sans travaux simulés − impôt cumulé avec l'option (les travaux déjà
  saisis restent dans les deux) ; `parEuro` = économie / montant ; on expose aussi le montant
  déduit des salaires et le déficit expiré ;
- options « équivalentes » = à moins de max(50 €, 1 %) de l'économie maximale (en deçà, c'est du bruit de
  modélisation) ; `meilleure` = parmi elles, la plus tôt puis la moins étalée.
- Non actualisé (un euro d'économie en année 5 vaut un euro d'aujourd'hui) — dit en note.

UI : tableau des options trié par économie, barre horizontale proportionnelle dans la cellule
« Économie », badge « Meilleure option », bouton « Appliquer » qui remplit année + répartition du
formulaire partagé. Montant à 0 → invitation à saisir un montant.

## Lot C — Quel régime ?

Nouvelle fonction pure `computeProjectionRegimesFoyer(assets, profileData, { anneeDebut, horizon,
travauxSimules })` — impôt total du foyer par année pour chaque régime, **chaque régime appliqué
depuis le premier achat** (même convention que le réel existant) :

- **Réel** : le moteur existant (travaux saisis + simulés).
- **Micro-foncier** : revenu foncier imposable = 70 % des loyers ; `eligible` = loyers bruts du
  foyer ≤ 15 000 € cette année-là. Pas de déficit ni de travaux.
- **SCI à l'IS** (une seule SCI détenant tous les biens, aucun dividende distribué) : résultat =
  loyers − charges − intérêts − travaux déductibles − amortissement (80 % du prix / 30 ans,
  proratisé l'année d'achat — même convention que `computeAnnualTaxEstimate`) ; déficit reporté
  sans limite de durée ; IS 15 % jusqu'à 42 500 € puis 25 %. Impôt du foyer = impôt sur les
  salaires seuls + IS.
- `meilleur` = total le plus bas parmi les régimes éligibles sur toute la période.

UI : graphique en lignes (3 régimes, un axe €, segment pointillé quand le micro n'est pas éligible),
tableau des totaux (total sur la période, écart vs régime suivi, remarque), badge « le plus bas »,
avertissements : SCI = hors frais de structure (~1 500–2 500 €/an), hors coût de transfert des
biens, hors fiscalité des dividendes et de sortie ; option réel irrévocable 3 ans ; impôt seul, pas
le cash-flow.

## Tests

- `tests/test_projection_impots.mjs` : `effetFoncier`, `synthese`, `travauxSimules` en tableau.
- `tests/test_optimisation_travaux.mjs` : étalement préféré quand le plafond de 10 700 € est
  saturé, option unique quand il ne l'est pas, montant nul, départage.
- `tests/test_projection_regimes.mjs` : micro = 70 %, éligibilité 15 000 €, IS avec amortissement
  et report de déficit, réel identique à `computeProjectionImpotsFoyer`, `meilleur`.
- Vérification navigateur Playwright (stub `owned-cloud.js`) : ouverture de la modale, 3 onglets,
  graphiques rendus, aucune erreur JS, captures.
