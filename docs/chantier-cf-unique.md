# Chantier « CF unique »

Objectif : un seul cash-flow de référence par bien, le même sur tous les écrans ; les autres chiffres (année civile, An N) restent mais affichent leur période.
Lancé le 2026-10-23, enchaîné par une `/loop` toutes les 3 h (une étape par passage). Pas de déploiement ni de push sans accord de l'utilisateur.

Test de cohérence : `tests/test_cf_unique.mjs` (dans `npm test` depuis l'étape 2 ; écrit rouge à l'étape 0 hors de `tests/`). Lancer seul : `node tests/test_cf_unique.mjs`.

## Définition retenue (étape 1)

**CF de référence = somme des flux des 12 prochains mois** (du mois suivant le mois courant au 12e), divisée par 12 pour l'affichage mensuel :
- loyers encaissés (loyer en vigueur à chaque mois, vacance de l'onglet Exploitation) ;
- moins charges récurrentes (TF, PNO, copro, gestion), mensualités du crédit principal (échéancier réel, assurance comprise) et des crédits travaux ;
- moins l'impôt : impôt annuel réel de chaque année civile touchée par la fenêtre (même calcul que la timeline, déficit reporté compris), ramené au mois ;
- **hors frais ponctuels** (onglet Travaux, payés comptant) : ils restent visibles dans l'année civile, pas dans le chiffre de référence.

Choix fait par défaut (recommandation du plan) pendant la loop, l'utilisateur n'a pas tranché entre « 12 prochains mois » et « année pleine N+1 » : réversible, il suffit de changer la fenêtre de `computeCFReference`.

## Écarts mesurés au départ (étape 0, 2026-10-23, bien à 750 €/mois, crédit 110 k€)

| Cas | Façade `computeOwnedAssetCF` (liste, dashboard, rapport) | Timeline année N ÷ 12 (fiche, verdict) | Timeline N+1 ÷ 12 |
|---|---|---|---|
| Stable, micro | −189 | −189 | −189 |
| Frais ponctuel 2 400 € ce mois | **−389** (tout le reste de l'année) | −389 | −189 |
| Crédit travaux 12 k€ | −310 | **−189** (mensualité oubliée) | **−189** |
| Déficit reporté (réel) | **−131** (report ignoré) | −40 | −40 |
| Acheté il y a 2 mois (réel) | −119 | **−50** (dilué sur 12 mois) | −121 |

Constats :
1. La façade compte les frais ponctuels de l'année ÷ 12 : −200 €/mois jusqu'au 31 décembre pour une chaudière.
2. **Bug** : `computeOwnedAssetTimeline` ignore la mensualité des crédits travaux (`travaux[].credit`), alors que `computeOwnedAssetCF` la retire. Touche la fiche, les graphiques, le rapport annuel, le rapport du bien, le PDF bancaire.
3. La façade ignore le déficit foncier reporté (impôt estimé sans report) : +91 €/mois d'écart en réel.
4. Le verdict de la fiche (année 1 par défaut) divise une année partielle par 12.

## Étapes

- [x] **0. Test de cohérence rouge** — `tests/cf-unique/coherence.mjs` : façade = référence, frais ponctuel sans effet sur la référence, Σ flux mensuels d'une année = `cfAnnuel`, crédit travaux dans la timeline, détail = timeline. Rouge (fonctions absentes + écarts ci-dessus).
- [x] **1. Définition** — voir ci-dessus.
- [x] **2. Moteur de flux mensuel unique** (`calculs.js`, 2026-10-23) — fait :
  - `computeOwnedAssetTimeline` produit `years[].mois` (flux de chaque mois détenu : loyers, charges, intérêts/capital/assurance, `mensualitesTravaux`, `fraisPonctuels`, impôt annuel ÷ mois détenus, `cf`) ; Σ mois = totaux de l'année. Les mensualités des crédits travaux (`echeancierCreditsTravaux`, 1re échéance le mois suivant la date du frais) sont désormais dans `debtService` et `cfAnnuel` (nouveau champ `mensualitesTravauxAnnee`) → **corrige le bug n° 2** sur la fiche, les graphiques, le rapport annuel, le PDF bancaire.
  - `computeFluxMensuelsBien(asset, profileData, regime, { debut, nbMois })` : fenêtre de mois lue dans la timeline (seule source).
  - `computeCFReference(asset, profileData, regime, { aujourdHui })` : 12 mois après le mois courant, hors frais ponctuels → `{ cfMensuel, cfAnnuel, loyers, charges, mensualites, impots, periode, mois }`.
  - `computeOwnedAssetCF(asset, scenario, tmi, regime, profileData)` : avec `profileData` (5e paramètre, nouveau) = façade sur la référence (scénario appliqué à une copie du bien via `appliquerScenario`), même forme de retour + `periode`. **Sans `profileData` = ancien calcul, inchangé** : les écrans qui l'appellent (liste, dashboard, rapport…) n'ont pas encore changé de chiffre (branchement = étape 4). Seuls changent dès maintenant les écrans lus dans la timeline, et uniquement pour un bien avec un crédit travaux (correction du bug n° 2).
  - `computeCFBreakdown` compte les mensualités des crédits travaux dans `mensualiteCredit` (sinon l'impôt reconstruit par différence les absorbait).
  - Choix : le loyer reste celui en vigueur au 31/12 pour toute l'année (convention partagée avec le compte de résultat / la 2044) ; passer au loyer mois par mois relève de l'étape 3, en même temps que la 2044.
- [x] **3. Impôt unique** (2026-10-23) — fait :
  - `computeImpotAnnuelBien(asset, annee, profileData, regime, deficitReporte)` : **seule source de l'impôt d'un bien**, calculée sur les cases de la 2044 de l'année (`lignes2044Bien`) ; micro (70 % des loyers × TMI+PS), réel (report de déficit, répartition `repartirDeficitFoncier`), SCI-IS (hors forfait 20 €, amortissement 80 % du prix / 30 ans). La timeline l'appelle chaque année (elle n'utilise plus `computeAnnualTaxEstimate`, qui reste pour l'outil Analyse).
  - `computeCompteResultat(..., options)` : `impots` et `baseImposable` = ceux de la timeline (même régime, déficit reporté compris) ; `options.base` = sans (utilisé par `lignes2044Bien`, évite la récursion). Intérêts et capital des crédits travaux comptés (case 250, `cfReel`). Année avant l'achat = tout à zéro (`compteResultatVide`).
  - `computeCFBreakdown` lit l'impôt dans la timeline (année : `impotsAnnee` ; mois : `mois[].impots`), plus de reconstruction par différence.
  - Loyer **mois par mois** (`loyersTheoriquesAnnee`) dans la timeline, le compte de résultat (donc la 2044) et le détail : une revalorisation en juin compte à partir de juin, plus pour toute l'année.
  - **Effets sur les chiffres** (attendus, documentés dans les tests mis à jour) : au réel, le forfait de 20 € (case 222) est maintenant déduit dans la timeline et le CF (−9 € d'impôt/an à TMI 30 %) ; les intérêts des crédits travaux sont déduits au réel ; quand les intérêts dépassent les loyers, le forfait crée un petit déficit imputable (−6 €). Tests ajustés : `test_credit_mi_annee` (test 12), `test_declaration_2044` (test 4 : 1 431 au lieu de 1 411), `test_deficit_coherence` (test 6 : timeline = 2044, plus « − 20 »), `test_regimes_fiscaux` (tests 2, 3, 4).
  - `test_cf_unique.mjs` : +4 cas (compte de résultat = timeline = détail en micro/réel/SCI-IS ; loyer revalorisé en juin).
  - Hors périmètre, restent avec leur propre calcul : `computeSimulationTravaux` (simulateur), `computeProjectionImpotsFoyer` (impôt du **foyer**, déficit imputé tous biens confondus — différence légitime avec l'impôt par bien), l'ancien chemin de `computeOwnedAssetCF` sans `profileData` (supprimé à l'étape 4).
  - Performance : timeline ≈ 6 ms (25 ans, 40 frais), façade ≈ 3 ms. À l'étape 4, si le rendu du portefeuille ralentit, mettre en cache la timeline par rendu (clé bien + profil + régime).
- [x] **4. Brancher les écrans** (2026-10-23) — fait :
  - `computeOwnedAssetCF` n'a plus qu'un chemin (CF de référence) ; l'ancien calcul « mois courant × 12 » est supprimé. Tous les appels passent `profileData` : `owned-portfolio.js` (dashboard, bandeau KPI, liste, liste mobile, carte, barre de répartition, onglet Calcul et comparaison des régimes, simulateur de scénarios, diagnostic IA, contexte Assistant), `rapport-bien.js`, `rapport-annuel.js`, `pdf.js` (×2), et dans `calculs.js` `getOptimalRegime(asset, tmi, profileData)` (nouveau 3e paramètre), `computePortfolioAlerts`, `computeSimulationTravaux` — sans ça ils auraient calculé avec un TMI nul.
  - Liste, verdict de la fiche et « Détail du CF » de l'onglet Calcul : nouvelle vue **« 12 mois » par défaut** (`'actuel'`, `state.ownedYearFilter` / `ownedYearFilters`), les vues An 1/3/5/10 restent pour la projection. Avant, le verdict et le détail ouvraient sur l'année civile en cours ÷ 12 (diluée l'année d'achat). Détail 12 mois : `computeCFBreakdownReference` (calculs.js).
  - Rapport du bien : cascade loyer → charges → mensualités (moyennes des 12 prochains mois) ; plus de ligne « frais ponctuels (÷ 12) ».
  - Tests : `test_cf_unique.mjs` +3 cas (liste/dashboard = détail 12 mois = rapport du bien = rapport annuel ; libellé de période) ; ajustés : `test_rapport_bien` (test 8 : 3 lignes, période), `test_credit_mi_annee` (test 11 : moyenne des 12 prochains mois), appels avec `profileData` dans `test_credit_mi_annee` et `test_declaration_2044`.
- [x] **5. Libellés de période** (2026-10-23) — fait : `libellePeriodeCF(periode)` et `periodeCFReference()` (calculs.js) donnent « 12 prochains mois (11/2026 – 10/2027) » partout. Dashboard et bandeau KPI « CF net-net / mois · 12 prochains mois » (dates en infobulle) ; colonne de la liste « CF net-net/mois (12 mois) » ou « (An N) » ; verdict « CF net-net / mois · 12 prochains mois (…) » ou « An 1 · 2026, 3 mois détenus » (`libelleAnneeCF`) ; onglet Calcul : sous-titres des cartes CF et mensualité, comparaison des régimes « (12 prochains mois) », « Impôts sur 12 mois », titre du détail ; carte (popup) ; rapport du bien (titre, hypothèses, « Impôts sur 12 mois ») ; rapport annuel « CF des 12 prochains mois » ; PDF bancaire (indicateurs et synthèse) ; contexte Assistant (`cfPeriode`) ; glossaire : entrée « CF des 12 prochains mois (portefeuille) ». (« CF brut » du glossaire était déjà corrigé : loyer − mensualité.)
- [x] **6. Vérification** (2026-10-23) — fait : `npm run verify` vert (18 fichiers, `test_cf_unique.mjs` 21 cas). Playwright `tests/playwright/cf-unique.mjs` vert (9 contrôles) : PC 1440 px (liste, dashboard, bandeau, alertes, verdict et onglet Calcul de 2 biens, bascule An 1 ↔ 12 mois) et iPhone 393 × 852 (liste, onglet Calcul), 0 erreur JS ; captures relues (rendu propre ; sur iPhone les boutons flottants masquent encore la carte DSCR, problème B11 du bilan, antérieur et hors chantier).

## Avant / après (biens types, 750 €/mois, crédit 110 k€, foyer 45 000 €, 23/10/2026)

CF net-net €/mois. « Avant » = chiffre de la liste/du dashboard (ancienne façade) et du verdict de la fiche (année civile ÷ 12) ; « Après » = CF de référence, désormais le même sur tous les écrans.

| Bien type | Régime | Liste avant | Fiche avant | **Après (partout)** | Explication |
|---|---|---|---|---|---|
| Stable | micro | −189 | −189 | **−189** | Rien ne change. |
| Stable | réel | −131 | −130 | **−132** | Forfait 20 € déduit (2044), impôt sur les 12 prochains mois au lieu du mois courant × 12. |
| Frais ponctuel 2 400 € ce mois | micro | −389 | −389 | **−189** | La chaudière n'est plus étalée sur le CF jusqu'au 31/12 ; elle reste dans la vue An N (−389 en 2026). |
| Frais ponctuel | réel | −331 | −330 | **−132** | Idem. |
| Crédit travaux 12 k€ | micro | −310 | −189 | **−310** | La fiche oubliait la mensualité du crédit travaux (bug corrigé). |
| Crédit travaux | réel | −253 | −130 | **−245** | Idem + intérêts du crédit travaux déduits (case 250) : −8 €/mois d'impôt. |
| Déficit reporté (travaux 25 k€ l'an dernier) | réel | −131 | −40 | **−40** | La liste ignorait le déficit reporté ; il réduit réellement l'impôt des années suivantes. |
| Acheté il y a 2 mois | micro | −189 | −79 | **−189** | La fiche divisait l'année d'achat (3 mois détenus) par 12. |
| Acheté il y a 2 mois | réel | −119 | −50 | **−120** | Idem. |

Les vues An N gardent les chiffres par année civile, avec leur base écrite (ex. « An 1 · 2026, 3 mois détenus »).

## Journal

- 2026-10-23 — étapes 0 et 1.
- 2026-10-23 (2e passage) — étape 2 ; `npm run verify` vert (18 fichiers, dont `test_cf_unique.mjs` 11 cas).
- 2026-10-23 (3e passage) — étape 3 ; `npm run verify` vert (18 fichiers, `test_cf_unique.mjs` 15 cas).
- 2026-10-23 (à la demande, hors loop) — étapes 4, 5 et 6 ; `npm run verify` vert (18 fichiers, 21 cas CF unique), Playwright `cf-unique.mjs` vert. **Chantier terminé.** Rien n'est commité, déployé ni poussé.
