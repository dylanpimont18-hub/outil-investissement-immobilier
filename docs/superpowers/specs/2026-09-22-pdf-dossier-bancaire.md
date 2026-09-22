# PDF dossier bancaire multi-biens — spec

Date : 2026-09-22. Statut : approuvé, prêt pour implémentation.

## Contexte et objectif

Le Portefeuille n'a aujourd'hui aucun export PDF réel (le "Rapport annuel" est un texte copiable, pas un PDF). L'objectif : depuis la fiche d'un bien détenu, générer un PDF présentable à un banquier, couvrant un ou plusieurs biens du portefeuille, avec un contrôle fin sur ce qui y figure et la possibilité de mettre certains indicateurs en surbrillance pour attirer l'attention du lecteur.

## Parcours utilisateur

1. Sur la fiche détail d'un bien (`renderOwnedDetail`), un nouveau bouton **"Dossier bancaire"** apparaît à côté du bouton Diagnostic IA existant (`#owned-diagnostic-btn`).
2. Clic → modale (réutilise `_showOwnedModal`, pattern déjà utilisé par toutes les autres modales du Portefeuille) — **Écran 1 : Biens & contenu**.
   - Liste de tous les biens du portefeuille (`loadOwnedAssets()`), case à cocher par bien, le bien de départ pré-coché.
   - Liste des blocs de contenu, case à cocher par bloc :
     - **Données du bien** (adresse, prix d'achat, surface, type de bien, date d'achat, valeur estimée)
     - **Indicateurs clés** (mensualité crédit, investissement total, CF avant/après impôt, rendement brut, DSCR, patrimoine net)
     - **Crédit & fiscalité** (comparatif des 3 régimes à l'année en cours + tableau CF annuel sur 5 ans)
   - Bouton "Suivant →" (désactivé tant qu'aucun bien n'est coché).
3. **Écran 2 : Surbrillance**.
   - Liste des indicateurs individuels appartenant aux blocs cochés à l'écran 1 (ex. si "Indicateurs clés" est coché → 6 lignes : Mensualité crédit, Investissement total, CF avant impôt, CF après impôt, Rendement brut, DSCR, Patrimoine net apparaissent chacune avec une case "Surligner"). Si "Crédit & fiscalité" est coché, une ligne "Régime optimal" s'ajoute.
   - Cette sélection de surbrillance s'applique identiquement à tous les biens du dossier (pas de sélection par bien).
   - Bouton "← Retour" (revient à l'écran 1 en conservant les cases déjà cochées) et bouton "Générer le PDF".
4. Génération : un seul PDF consolidé, une section par bien sélectionné, saut de page entre chaque bien. Téléchargé via `/api/generate-pdf` (route existante, aucun changement serveur).

## Hors périmètre (explicitement exclu)

- Pas de sauvegarde de la sélection entre deux générations — chaque ouverture repart des cases par défaut (tout coché sauf surbrillance).
- Pas de justificatifs/photos de travaux dans le PDF — chiffres uniquement.
- Pas d'édition des valeurs depuis la modale — c'est un export en lecture seule des données déjà saisies.
- Pas de sélection de surbrillance indépendante par bien.

## Contenu détaillé par bloc

Toutes les valeurs sont calculées avec les fonctions déjà existantes dans `calculs.js`, aucune nouvelle formule :

- **Données du bien** : `asset.nom`, `asset.ville`, `asset.acquisition.{adresse, prix, surface, typeBien, dateAchat, valeurEstimee}`.
- **Indicateurs clés** : `computeOwnedAssetCF(asset, scenario, tmi)` → `{ cfNetNet, mensualiteTotale, rentaBrute, dscr }` (scénario = `getOwnedDefaultScenario(asset)`, `tmi` = `getOwnedTmi()`) ; CF avant impôt = `cfNetNet + (impotsAnnee/12)` (déjà retourné par la fonction) ; investissement total = `acquisition.prix + acquisition.fraisAgence + acquisition.fraisNotaire` (même formule que celle utilisée en interne par `computeOwnedAssetCF`) ; patrimoine net = `computePatrimoineNet(asset)` → `{ patrimoineNet }` (peut être `null` si aucune `valeurEstimee` saisie — afficher "Non renseigné" dans ce cas).
- **Crédit & fiscalité** : `computeRegimeComparison(asset, profileData, [1])` → `byRegime[regime][1]` pour le CF de l'année en cours par régime, `optimal[1]` pour le régime optimal ; tableau CF annuel = 5 premières lignes de `computeOwnedAssetTimeline(asset, profileData, regime).years` (même source que `renderOwnedCfTable`, régime = `getOwnedRegime()`).

## Fichiers touchés

- **`pdf.js`** — nouvelle fonction exportée `buildBankDossierPrintDocument({ assets, sections, highlights, profileData, regime })` :
  - `assets` : tableau des biens sélectionnés (objets `asset` complets, tels que retournés par `loadOwnedAssets()`)
  - `sections` : `{ donnees: bool, indicateurs: bool, credit: bool }`
  - `highlights` : `Set<string>` de clés d'indicateurs à surligner (ex. `'cfNetNet'`, `'dscr'`, `'patrimoineNet'`, `'regimeOptimal'`)
  - `profileData`, `regime` : passés tels quels aux fonctions de calcul
  - Retourne `{ documentHTML, filename }`, même contrat que `buildDecisionPrintDocument` — réutilise `buildLocalFontFaceCss` (fonction déjà partagée, pas dupliquée) et le même gabarit `@page`/impression que le document existant.
  - Nouvelle classe CSS `.r-kpi--highlight` (et équivalent pour les lignes de tableau/valeurs isolées) : fond doré clair + bordure `--accent-gold`, cohérente avec la charte graphique existante (déjà utilisée pour `.r-kpi.gold` dans le PDF Analyse).
  - Une section par bien, chacune démarrant par `<div class="r-page-break"></div>` sauf la première.
- **`owned-portfolio.js`** :
  - Nouveau bouton `#owned-bank-dossier-btn` dans `renderOwnedDetail()`, à côté de `#owned-diagnostic-btn` (PC uniquement, comme le bouton Diagnostic IA — cohérent avec le reste des actions avancées de la fiche).
  - Nouvelle fonction `openBankDossierModal(assetId)` : construit et affiche l'écran 1 via `_showOwnedModal`.
  - Nouvelle fonction interne pour l'écran 2, déclenchée par le clic sur "Suivant".
  - Nouvelle fonction `_generateBankDossierPdf(selectedAssetIds, sections, highlights)` : résout les `asset` complets via `getOwnedAsset(id)`, appelle `buildBankDossierPrintDocument`, puis réutilise le pattern déjà présent dans `main.js` (`fetch('/api/generate-pdf', ...)`) — factoriser ce fetch dans un helper partagé si `main.js` et `owned-portfolio.js` doivent tous deux l'appeler (voir note ci-dessous).
- **`main.js`** — extraire `openPrintDocument(documentHTML, filename)` (actuellement définie localement dans `main.js`, lignes ~1759-1781) vers `utils.js` en la rendant générique (le nom du bouton dont le libellé est temporairement changé en "Génération…" est passé en paramètre plutôt que codé en dur `#export-decision-pdf`), pour que `owned-portfolio.js` puisse l'utiliser sans dupliquer le fetch + gestion d'erreur + libellé de bouton.
- **`styles.css`** — classes pour la modale 2 écrans (réutilise `.owned-modal-overlay`/`.owned-add-modal` existants autant que possible) + `.r-kpi--highlight` dans le bloc PDF déjà présent.

## Gestion d'erreurs

Identique au pattern existant de `main.js` (`openPrintDocument`) : si `/api/generate-pdf` retourne une erreur (Edge introuvable, timeout, etc.), `window.alert` avec le message serveur. Pas de nouveau cas d'erreur introduit par cette fonctionnalité — le point neuf est uniquement la construction du HTML en amont.

## Tests

- Pas de nouveau test `.mjs` unitaire : `buildBankDossierPrintDocument` compose des fonctions déjà testées (`computeOwnedAssetCF`, `computeRegimeComparison`, `computePatrimoineNet`) sans nouvelle logique financière — la valeur du test serait de vérifier que le HTML généré contient bien les bonnes valeurs, ce qui sera couvert par une vérification manuelle réelle du PDF produit (impression via `/api/generate-pdf`, inspection visuelle) après implémentation, plusieurs biens et plusieurs combinaisons de sélection.
- Vérification Playwright manuelle du flux modale (écran 1 → écran 2 → génération), pas de test automatisé pérenne ajouté (cohérent avec le fait que le reste des modales du Portefeuille n'a pas de test Playwright dédié).
