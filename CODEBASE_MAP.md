# CODEBASE MAP
> Index de navigation — mis à jour à chaque session. Ne pas modifier manuellement.
> Format : rôle + fonctions/exports clés pour savoir où écrire sans lire le fichier entier.

---

## app.py
Entrée desktop : lance Flask en thread (`threaded=True`) + fenêtre PyWebView + icône barre système.
- `__version__` — lu depuis le fichier `VERSION` à la racine (source de vérité unique, aussi lue par `server.py`/`spark.spec`/`build.bat`), `'dev'` si absent.
Pas de fonctions exportées — exécuté directement par `python app.py` ou PyInstaller.

---

## server.py
Serveur Flask : sert les fichiers statiques + API scraper + diagnostic IA + export PDF + import/export portefeuille.
- `api_scan` POST — lance scan partiel sur une ville ; accepte `{ville, code_postal, rayon_km}`
- `api_scan_full` POST — réinitialise DB puis scan complet ; même body que `api_scan`
- `_run_scanner(full, ville, code_postal, rayon_km)` — thread worker : purge sys.modules scrapers avant reload, inject `rayon_km` dans `villes_override`
- `api_portfolio_export` POST — sauvegarde `{portfolio}` dans `exports/portefeuille-YYYY-MM-DD.json`
- `api_portfolio_import_list` GET — liste les `.json` dans `exports/`
- `api_portfolio_import` POST — lit `{filename}` dans `exports/` et retourne le JSON
- `_query_results_data(conn, ...)` — SELECT biens + jointure annonces + sous-requêtes `baisse`/`date_baisse` (historique_prix)
- `api_enrich` POST — déclenche enrichissement IA des biens
- `api_status` GET — statut du scan en cours (progress, logs)
- `api_results` GET — liste paginée des biens avec stats
- `api_bien_detail` GET — détails complets d'un bien + analyses
- `api_pending_count` GET — nombre de biens en attente d'enrichissement
- `api_communes` GET — communes par code postal
- `api_version` GET `/api/version` — lit le fichier `VERSION` à la racine, retourne `{version}` (`'dev'` si absent)
- `api_portfolio_diagnostic` POST `/api/portfolio-diagnostic` — accepte `{ bien: {...} }` (bien unique), retourne 3-5 recommandations JSON via Claude API
- `api_generate_pdf` POST `/api/generate-pdf` — génère un PDF via Edge headless, sauvegarde dans ~/Downloads, retourne `{saved_to, filename}`
- `pdf_preview` GET `/api/pdf-preview/<token>` — sert le HTML une seule fois pour la capture Edge headless
- `api_loyer_marche` POST `/api/loyer-marche` — accepte `{ville, type_bien, surface}`, retourne `{loyerMedian, nbSamples}` depuis `loyers_marche` table
- `api_loyer_marche_refresh` POST `/api/loyer-marche/refresh` — accepte `{ville, code_postal, type_bien}`, lance `marche_locatif.main()` pour cette ville (~15-30 s), retourne `{ok: true}`
- `api_documents_upload` POST `/api/documents/<bien_id>/upload` — sauvegarde un PDF (multipart `file`, max 20 Mo) dans `documents/<bien_id>/<uuid>.pdf`, retourne `{filename}`
- `api_documents_get` GET `/api/documents/<bien_id>/<filename>` — sert le PDF inline (`Content-Type: application/pdf`) pour aperçu/impression
- `api_documents_delete` DELETE `/api/documents/<bien_id>/<filename>` — supprime un PDF précis
- `api_documents_delete_all` DELETE `/api/documents/<bien_id>` — supprime tout le dossier documents d'un bien (appelé à la suppression du bien)
- `api_geocode_address` POST `/api/geocode/address` — accepte `{adresse}`, retourne `{lat, lng, cached}` ; cache en table `geocodes_adresse` (les échecs sont cachés en `lat: null` pour ne pas re-solliciter Nominatim à chaque frappe). Utilisé par la carte du portefeuille
- `api_geocode_batch` POST `/api/geocode/batch` — accepte `[{ville, code_postal}]`, retourne `{"ville|cp": {lat, lng}}` ; cache en table `geocodes`. Utilisé par la carte du scanner (route supprimée par erreur en juin 2026, recréée le 2026-07-27)
- `_nominatim_lookup(query)` — appel Nominatim sérialisé par un lock + délai 1,1 s (limite 1 req/s de l'instance publique) ; nécessite `requests` (dans requirements.txt et les hiddenimports de `spark.spec`)

---

## main.js
Orchestration UI complète : état, rendu, sync multi-fenêtres, routing des panels. Le module "portefeuille
biens détenus" a été extrait dans `owned-portfolio.js` (axe 3) — main.js ne contient plus que l'Analyse,
le Comparateur, le profil, le shell (thème, onglets, sync cross-fenêtres) et le câblage des imports.
- `sanitizeVariablesData()` — valide et normalise les inputs du formulaire (inclut `annee-achat`)
- `render()` — rendu principal de l'interface (appelle `renderCollections()` importée de `owned-portfolio.js`)
- `loadVariablesData()` / `loadProfileData()` — charge état depuis localStorage
- `emitStateUpdate()` — synchronise l'état cross-tabs via BroadcastChannel
- `setupCrossWindowSync()` — écoute BroadcastChannel + storage events
- `openAnalysisWindow()` — ouvre le panneau analyse en fenêtre séparée
- `renderGuidedStep(idx)` — rendu mode guidé étape par étape
- `renderModeSwitch(mode)` — bascule guidé / complet
- `createAssetId()` — génère un ID unique pour une étude
- Comparateur d'études (`STORAGE_KEYS.assetRecords` = `investissementWebAssetRecords`, séparé et sans lien avec `ownedAssets`/Portefeuille) :
  - `createOrUpdateCurrentAsset()` — enregistre/actualise l'étude active dans le comparateur (bouton "Enregistrer"/"Mettre à jour")
  - `loadAssetIntoWorkspace(assetId)` — recharge une étude sauvegardée dans le formulaire Analyse
  - `syncAssetActionLabels()` — barre de statut Analyse (nouveau/modifié/à jour)
  - `saveCurrentStudy()` — exportée, utilisée par `scanner.js` pour importer un dossier scrapé comme étude
- `getPanelMode()` — détecte si on est dans la vue analysis ou workspace
- `isEssentialDataMissing()` / `buildNeutralAnalysisPlaceholder()` — état neutre ("Renseignez le prix et le loyer") tant que `prix`/`loyer` ne sont pas saisis, utilisé par `buildWorkspaceHero`/`buildAnalysisStickySummary`/`buildAnalysisAcquisitionDecision`
- `renderCFWaterfall(analysisModel)` — bloc "② Économie du deal" (`#analysis-cf-waterfall`) : header + barres de décomposition uniquement (Loyers/Crédit/Charges/Impôts/Net net). N'affiche plus de mini-cartes Rendement brut/CF/DSCR en tête — doublon exact avec `buildAnalysisMetrics` juste en dessous (corrigé, audit UX 2026-07 bug #3), classes CSS `.cf-waterfall__kpi*` supprimées
- `buildAnalysisSummary(analysisModel, parts)` — bloc "Décision d'exploitation" (`#analysis-summary`) : la liste `analysis-list--compact` ne montre plus que "Parts fiscales" — Profil actif/Composition du foyer/TMI retirés car déjà affichés dans `buildWorkspaceHero` (doublon corrigé, audit UX 2026-07 bug #3)
- `skipProfileModal()` — ferme le modal Profil (bouton "Plus tard" / Échap) sans marquer `profileConfigured` — le badge topbar reste en attente
- `sanitizeProfileData(rawProfile)` — normalise le profil ; `income` toujours stocké en annuel, `incomeUnit` (`'mensuel'`|`'annuel'`, défaut `'mensuel'`) ne pilote que l'affichage
- `setProfileIncomeUnit(unit, {convert})` / `updateProfileIncomeHint()` — bascule le champ Revenus salariaux entre saisie mensuelle/annuelle (toggle `#profile-income-unit-toggle`), convertit la valeur affichée et met à jour le texte d'aide "soit X €/an|mois"
- Bootstrap (fin de fichier) : `initOwnedPortfolio({ state, nodes, STORAGE_KEYS, IS_ANALYSIS_WINDOW })` doit être appelée **avant** le premier `render()` (le module en dépend dès son premier rendu) ; `initOwnedPortfolioEvents()` (câblage des listeners persistants) reste appelée après, comme avant l'extraction. Fetch `/api/version` au démarrage → affiche `vX.Y.Z` dans `#topbar-version` (topbar).

---

## owned-portfolio.js
Module "portefeuille biens détenus" — CRUD (`ownedAssets`, `STORAGE_KEYS.ownedAssets` = `investissementWebOwnedAssets`), rendu (liste, fiche détail, onglets Acquisition/Exploitation/Travaux/Projection, dashboard dirigeant) et tous les événements associés. Extrait de main.js (axe 3) ; reçoit `state`/`nodes`/`STORAGE_KEYS`/`IS_ANALYSIS_WINDOW` par référence via `initOwnedPortfolio(deps)` plutôt que de les dupliquer.
- `initOwnedPortfolio(deps)` — **point d'entrée**, à appeler avant le premier `render()` de main.js (stocke `state`/`nodes`/`STORAGE_KEYS`/`IS_ANALYSIS_WINDOW`)
- `initOwnedPortfolioEvents()` — exportée séparément, câblage des listeners persistants (modal ajout, retour, IA, drawer, délégation actions détail) ; à appeler après le rendu initial, comme avant l'extraction
- `renderCollections()` — exportée, dispatcher vue liste ↔ vue détaillée, appelée à chaque cycle de `render()` par main.js
- `loadOwnedAssets()` / `saveOwnedAssets()` / `createOwnedAsset(nom, ville)` / `getOwnedAsset(id)` / `updateOwnedAsset(id, patch)` / `deleteOwnedAsset(id)` — CRUD biens ; asset inclut `codePostal` (top-level)
- `updateOwnedAcquisition(id, patch)` / `updateOwnedCredit(id, patch)` / `updateOwnedPostAchat(id, patch)` — patch sous-objets
- `addOwnedLot(assetId, lot)` / `updateOwnedLot(assetId, lotId, patch)` / `deleteOwnedLot(assetId, lotId)` — CRUD lots d'un immeuble de rapport (`asset.lots[]`, optionnel) ; consommé via `resolveLoyerVacance` (calculs.js) pour le CF consolidé
- `addOwnedTravail(assetId, travail)` / `deleteOwnedTravail(assetId, travailId)` — CRUD travaux (frais documentés : `date`, `description`, `montant`, `tag`, `commentaire`, `pdfFilename` — suppression déclenche aussi la suppression du PDF associé côté serveur)
- `uploadOwnedDocument(assetId, file)` — upload un PDF vers `/api/documents/<assetId>/upload`, retourne le `filename` stocké
- `openDocumentPreview(assetId, filename)` / `printSelectedDocuments(assetId, filenames)` — aperçu inline (overlay `<embed>`) et impression multi-PDF (nouvel onglet + `window.print()`)
- `renderOwnedTravauxTab(asset)` — onglet "Frais & justificatifs" : classeur par année (`<details>`), upload/aperçu/sélection PDF, câblé sur `#owned-travaux-content` ; seul endroit qui gère le CRUD travaux (voir `renderAccordionPostAchat`)
- `addOwnedNote(assetId, text)` / `deleteOwnedNote(assetId, noteId)` — ajout/suppression note horodatée (id généré à la création)
- `addOwnedScenario(assetId)` / `updateOwnedScenarioVar(assetId, scenarioId, key, val)` / `updateOwnedScenarioNom(assetId, scenarioId, nom)` / `deleteOwnedScenario(assetId, scenarioId)` — CRUD scénarios
- `renderOwnedPortfolioList()` — liste biens + KPIs consolidés + état vide ; tri par performance (`state.ownedSort` = `{criterion:'cf'|'rendement'|'dscr', dir:'asc'|'desc'}`, persisté `STORAGE_KEYS.ownedSort`) via sélecteur `#owned-sort-select` ou clic sur en-têtes `.owned-col-sortable` ; rendement net dérivé en ligne (`loyerEffectif`/`chargesMensuelles` de `computeOwnedAssetCF`, pas de nouvel export calculs.js) ; glisser-déposer (`state.ownedOrder`) désactivé tant qu'un tri est actif
- `openOwnedDetail(assetId)` / `closeOwnedDetail()` — navigation vue liste ↔ vue détaillée
- `renderOwnedDetail()` — header fiche + câblage accordéons/onglets
- `renderAccordionAcquisition(asset)` — formulaire données figées + crédit + valeurEstimee/dateEstimation + **champ Adresse complète** (`data-owned-field="adresse"`, déclenche le géocodage) ; si `typeBien === 'immeuble'`, affiche la section "Lots de l'immeuble" (CRUD `asset.lots[]`). Le champ Loyer y est **toujours en lecture seule** depuis 2026-07-27 : il affiche le loyer résolu et renvoie vers l'onglet Exploitation (ou vers les lots pour un immeuble) — plus de double source de saisie
- `renderAccordionPostAchat(asset)` — Évolution charges (P0-A+P0-B), CF breakdown, résumé travaux (lecture seule, renvoie vers l'onglet Travaux), **section Loyer** (loyer actuel + historique des prises d'effet + formulaire montant/mois), déficits, notes ; utilise `state.ownedYearFilters[asset.id]` (filtre par bien). Pour un immeuble avec lots, la section Loyer affiche un renvoi vers l'onglet Acquisition au lieu du formulaire
- `renderAccordionSimulateur(asset)` — matrice scénarios avec CF net-net recalculé
- `renderOwnedCrdChart(asset)` — graphique "Capital restant dû" (#owned-crd-chart, canvas pleine largeur)
- `renderOwnedDashboard(list, tmi, regime)` — dashboard dirigeant : snapshot 4 KPIs, Centre d'actions (fusion des alertes `computePortfolioAlerts`, triées par sévérité error>warning>info), objectifs (rendu dans #owned-dashboard-wrap)
- `addOwnedLoyerHistorique(assetId, entry)` / `deleteOwnedLoyerHistorique(assetId, mois)` — CRUD historique de loyer (`postAchat.loyerHistorique`, `{mois:'YYYY-MM', montant}` trié croissant). Remplace l'ancien suivi mensuel encaissé/impayé (`loyersReels`, supprimé le 2026-07-27 avec `computeTresorerieReelle` et l'alerte `loyer-manquant`)
- `renderOwnedMap(list)` / `_initOwnedMap()` — carte Leaflet du portefeuille (`#owned-map-section`, sous `#owned-kpi-banner` en vue liste), appelée par `renderOwnedPortfolioList()` : un `circleMarker` par bien géocodé, vert si CF net-net ≥ 0 sinon rouge, popup nom/ville/CF + bouton vers `openOwnedDetail`, `fitBounds` sur l'ensemble. Carte instanciée une seule fois puis réutilisée ; `invalidateSize()` différé après affichage de la section (Leaflet mesure mal un conteneur qui vient d'être révélé)
- `geocodeOwnedAsset(assetId, adresse, hintEl)` — appelle `POST /api/geocode/address` à la saisie de l'adresse et patch `lat`/`lng` sur le bien ; déclenché depuis le listener `change` de `#acc-acquisition-content` quand `data-owned-field="adresse"`
- `updateOwnedTravail(assetId, travailId, patch)` / `openEditTravailModal(assetId, travailId)` — édition d'un frais existant (bouton ✏️ dans l'onglet Travaux, modale via `_showOwnedModal`). Le PDF joint n'est pas modifiable ici : supprimer/recréer le frais pour le remplacer
- `addOwnedDeficitFoncier(assetId, entry)` / `deleteOwnedDeficitFoncier(assetId, annee)` — CRUD déficits fonciers
- `loadPortfolioGoals()` / `savePortfolioGoals(goals)` — objectifs portefeuille (`investissementWebPortfolioGoals`)
- `openCompteResultatModal(assetId)` — modal compte de résultat annuel (sélecteur d'année)
- `openSimulationTravauxModal(assetId)` — modal simulation travaux (déductibles ou non)
- `openCapaciteEmpruntModal()` — modal capacité d'emprunt (mensualite résiduelle → montant empruntable)
- `openObjectifsModal()` — modal saisie objectifs CF + patrimoine + date
- `openRapportAnnuelModal()` — modal rapport texte annuel avec bouton copier
- `openDeclarationFiscaleModal()` — modal "Déclaration fiscale" (bouton dashboard) : récap 2044 case par case + copier si régime réel (`computeDeclaration2044`) ; message dédié 2065/expert-comptable si SCI-IS ; note 2042 case 4BE si micro-foncier
- `callOwnedDiagnosticIA(assetId)` — appel `POST /api/portfolio-diagnostic` + drawer résultat
- `_showOwnedModal(html, id)` — ouvre une modale générique (Compte de résultat, Simuler travaux, Capacité d'emprunt, Objectifs, Rapport annuel) ; ferme sur clic croix/fond **et** sur Échap (`_wireOwnedModalEscape`, wiring global une seule fois)
- `renderOwnedCfTable(asset)` — tableau "Flux de trésorerie annuels" ; Dépenses affichées hors apport initial (apport indiqué séparément via `y.apportAnnee`, badge "+ apport") pour que Recettes − Dépenses = CF annuel sur chaque ligne
- Bannière/badge "régime optimal" (dans `renderOwnedSynthese`) : quand le régime optimal est `sci-is`, ajoute un caveat visible "(hors frais de structure et fiscalité de sortie)" + tooltip sur le badge `.owned-badge--optimal` — ce n'est qu'une comparaison de CF net-net, pas un coût total réel de la SCI
- `renderOwnedCfConsolidatedSection(list, tmi, regime)` — rendu dans `#owned-portfolio-cf-consolidated` (vue liste portefeuille) : ne dessine **que** `renderOwnedRepartitionBarHTML` (barre "Répartition du CF par bien"). Le graphique "CF net cumulé — portefeuille" est déjà rendu juste au-dessus par `renderOwnedPortfolioCharts` (Chart.js, `#owned-portfolio-charts`) — ne pas le re-dessiner ici en SVG (doublon corrigé, audit UX 2026-07 bug #7)
- `renderOwnedVerdictBlock(asset)` — tuiles "Vue An 1/3/5/10" : seulement CF net/mois + Effort épargne (valeurs qui varient réellement par année sélectionnée). Rendement brut/DSCR retirés de ce bloc : ils sont statiques (ne varient pas avec l'année) et déjà affichés dans le bandeau `renderOwnedSynthese` juste au-dessus (doublon corrigé, audit UX 2026-07 bug #6)

---

## utils.js
Helpers partagés — formatage, échappement HTML, toast. Zéro dépendance sur `state`/`nodes` ; importé par `main.js` et `owned-portfolio.js`.
- `escapeHtml(value)` / `formatMultilineText(value)` — échappement HTML
- `showToast(message, tone)` — notification temporaire (crée/anime `#app-toast`)
- `formatCurrency` / `formatPercent` / `formatRatio` / `formatSignedCurrency` / `formatCompactCurrency` / `formatPlainCurrency` / `formatShortDateTime` — formatage nombres/dates fr-FR
- `getMetricClass(value)` / `getDecisionClass(tone)` — classes CSS selon signe/tonalité
- `getRegimeLabel(regime)` / `getTypeBienLabel(type)` — libellés régime fiscal / type de bien
- `getChecklistTone(status)` / `getChecklistLabel(status)` — tonalité/libellé checklist

---

## calculs.js
Moteur financier pur — zéro DOM. Tous les calculs, toutes les fiscalités.
- `computeAnalysisViewModel(inputs)` — **point d'entrée principal** : retourne tout le VM analyse
- `computeCF(prixVendeur, loyer, inputs, tmi)` — cash-flow brut + net + net-net
- `computeProjectMetrics(inputs)` — KPIs par actif (rentaBrute, rentaNette, DSCR, GRM, CoC…)
- `computeResaleTimeline(...)` — projection plus-value à la revente
- `calculateTMI(revenus, foyer)` — calcul tranche marginale d'imposition
- `getHouseholdTaxParts(adults, enfants)` — nombre de parts fiscales du foyer
- `capitalRestantDu(mensualite, dateFinStr)` — capital restant dû à une date (approximation linéaire)
- `CSG_CRDS_RATE` — constante 17.2%
- `buildFinancialModel(prixNet, loyerMensuel, inputs, tmi)` — modèle financier bas niveau (exporté ; utilisé par `computeOwnedAssetCF`)
- `resolveLoyerVacance(asset, moisCible = null)` — point d'entrée unique loyer/vacance consolidés, **résolution en 3 niveaux** : (1) `asset.lots[]` si présent (immeuble de rapport, un lot = `{id, nom, loyer, vacance, locataire}`) ; (2) sinon `postAchat.loyerHistorique` = `[{mois:'YYYY-MM', montant}]`, on retient la dernière entrée dont le mois est `<= moisCible` (avant la 1re prise d'effet, on retient quand même le loyer de départ) ; (3) sinon `acquisition.loyerInitial` (biens créés avant la refonte 2026-07-27, aucune migration nécessaire). `moisCible` accepte `'YYYY-MM'` ou `'YYYY'` (résolu au 31/12 de l'année) et vaut le mois courant si omis. Utilisé par `computeOwnedAssetCF`, `computeOwnedAssetTimeline` (résout **par année dans la boucle**, donc la projection reflète les évolutions de loyer), `computeCFBreakdown`, `computeRevenusLocatifsBruts`, `computeCompteResultat` — seul point à toucher si le modèle de loyer évolue encore
- `computeOwnedAssetCF(asset, scenario, tmi)` — CF net-net mensuel d'un bien détenu selon un scénario ; lit `scenario.loyer` si renseigné (sinon `acq.loyerInitial`) ; détecte si le crédit est encore actif ; DSCR = NOI/dette ; retourne `{ cfNetNet, mensualiteTotale, chargesMensuelles, impotsAnnee, loyerEffectif, rentaBrute, dscr }`
- `computeOwnedAssetTimeline(asset, tmi, regimeOverride)` — timeline CF + recettes/dépenses par an depuis anneeAchat ; les travaux `tag:'deductible'` de l'année réduisent l'assiette imposable (régimes `reel`/`sci-is`, ignoré en `micro-foncier`) et sont retranchés du CF réel, les non-déductibles n'affectent que le CF (pas l'impôt) ; chaque année retourne aussi `apportAnnee` (apport initial isolé, déjà inclus dans `depensesAnnee` mais pas dans `cfAnnuel` — sert à réconcilier l'affichage tabulaire, voir `renderOwnedCfTable`)
- `computeAmortizationSchedule(montant, tauxAnnuel, dureeAns, anneeDebut)` — plan d'amortissement annuel `{ schedule: [{ annee, interets, capital, crdDebut, crdFin }], mensualite }`
- `computePatrimoineNet(asset)` — `{ valeurEstimee, crd, patrimoineNet, dateEstimation }` en utilisant schedule réel
- `computeEndettementGlobal(assets, revenusMensuels, creditsHorsImmo)` — `{ totalMensualites, tauxEndettement, capaciteResiduelle, prochainCreditTermine }` — inclut les crédits hors immo actifs
- `computeCFBreakdown(asset, tmi, regime, targetYear)` — décomposition CF cascade : loyerBrut→vacance→charges→travaux(année)→crédit→impôts→cfNetNet (`bd.travaux` = somme des travaux datés dans `targetYear`, déductibles ou non)
- `computeRegimeComparison(asset, tmi, targetYears)` — `{ byRegime, optimal }` comparatif CF par régime et par année cible
- `computeCapaciteEmprunt(mensualiteMax, dureeAns, tauxPct, apport)` — `{ montantEmpruntable, prixAchatMax }` (frais notaire 8%)
- `getOptimalRegime(asset, tmi)` — `{ optimal, optimalCF, allCFs }` régime max CF net-net
- `computeRevenusLocatifsBruts(assets)` — total revenus locatifs bruts €/an (pour plafond micro-foncier 15k)
- `computeCompteResultat(asset, annee, tmi, regime)` — compte de résultat complet de l'année `{ recettesBrutes, chargesDeductibles, resultatFoncier, impots, resultatNet, capitalRembourse, cfReel, ... }`
- `computeDeclaration2044(assets, annee, tmi)` — pré-remplissage indicatif déclaration 2044 (foncier réel uniquement), remappe les champs déjà calculés par `computeCompteResultat` vers les cases officielles (211/221/222/223/224/227/229/250/263/420 + répartition déficit 10 700€/report 10 ans) ; mapping sourcé sur la notice DGFiP 2044-NOT-SD éd. 2026 — voir avertissements dans `openDeclarationFiscaleModal` (owned-portfolio.js). Pas d'équivalent pour la SCI-IS (vrai formulaire = 2065, liasse comptable avec amortissement non calculé par l'app — volontairement hors périmètre, cf. message dédié)
- `computePortfolioAlerts(assets, tmi, regime, revenusMensuels)` — flux d'actions/alertes dynamiques toutes propriétés confondues, base du "Centre d'actions" du dashboard : CF négatif, DSCR < 1, micro-foncier > 15k, endettement, crédit qui se termine, valeur manquante, loyer inchangé depuis ≥ 12 mois d'après la dernière prise d'effet de `loyerHistorique` (`loyer-non-revise`, à vérifier IRL), déficit foncier proche des 10 ans d'expiration avec reliquat non imputé (`deficit-expire`), frais/travaux au tag `a-classifier` (`travaux-a-classer`) — `severity: error|warning|info` ; la suggestion de changement de régime (`type:'fiscal-opt'`) reste en `severity: 'info'` et porte un caveat texte quand le régime optimal est `sci-is`. L'alerte `loyer-manquant` a été retirée avec le suivi mensuel (spec 2026-07-27)
- `computeSimulationTravaux(asset, montantTravaux, annee, deductible, tmi, regime)` — impact CF et économie fiscale des travaux

---

## scanner.js
Interface scanner immobilier : déclenchement scrape, polling statut, rendu résultats, filtrage, carte, détails.
- `initScanner(opts)` — initialise l'interface scanner complète
- `onScannerTabActivated()` — refresh des résultats quand l'onglet devient actif
- `_getScannerRayonKm()` / `_setRayonKm(km)` — rayon actif (5/10/20/30 km), persisté en localStorage `scannerRayonKm`
- `_setScanTarget(cp, commune, label)` — cible du scan ; persiste en localStorage `investissementWebScannerTarget`
- `_updateScannerHeaderSub()` — met à jour `#scanner-header-sub` et `#scanner-zone-chip` avec zone + rayon + nb biens
- `_renderFreshnessLabel(date)` — badge "Vu il y a X j" (classe `--stale` si > 10 j)
- `_buildScannerSummaryRow(r)` — construit la ligne résumé (inclut `baisseLabel`, `distLabel`, `distTone`)
- `_renderGlobalOverviewTable(rows)` — tableau 8 colonnes (Rang/Bien/Prix/Loyer/CF/Renta/DPE/Score)
- `_renderScannerRankingStrip(rows)` — top 5 curation cards avec résumé IA 120 chars
- `_statCard(val, label, cls, note, extraClass)` — carte stat mini (`.workspace-hero-mini-card`)
- `_haversineKm(lat1,lng1,lat2,lng2)` — distance géodésique en km
- `_getDistanceKmFromVierzon(cp)` — distance depuis Vierzon via `_COMMUNE_COORDS` fallback statique
- `_matchDistance(r)` — filtre JS par distance max (slider `#scanner-dist-filter`)
- `_initMap()` — initialise carte Leaflet centrée sur Vierzon (47.222, 2.069) zoom 10
- `_updateMapRadiusCircle()` — dessine/met à jour le cercle de rayon sur la carte

---

## pdf.js
Génération du PDF de décision investissement sous forme de HTML standalone.
- `buildDecisionPrintDocument(opts)` — PDF complet avec analyse + décision + scénarios
- `buildPrintDocument(photos)` — snapshot rapide (photos + métriques)

---

## ui.js
Composants UI réutilisables : graphes, tableaux comparatifs, validation, toasts.
- `updateChart(credit, charges, impots, cf)` — met à jour le graphe cash-flow
- `updateScoreBanner(cfNetNet, renta, tips)` — verdict + étoiles de notation
- `updateRegimeComparison(...)` — tableau micro-foncier / réel / SCI-IS
- `generateOptimizationTips(inputs, tmi)` — suggestions d'optimisation fiscale
- `updateNegoTable(prixNet, ...)` — tableau impact de la négociation
- `validateInputs(inputs)` — validation des saisies utilisateur
- `showToast(msg, type, duration)` — notification toast (alias aussi dans main.js)
- `renderDonutChart(canvasId, credit, charges, impots, cf)` — crée/met à jour un donut Chart.js (portfolio)
- `destroyDonut(canvasId)` — libère l'instance Chart.js associée au canvas

---

## index.html
Structure DOM statique — tous les panels et formulaires pré-déclarés.
- Panels principaux : `#workspace-panel`, `#analysis-panel`, `#collection-panel`, `#feasibility-panel`, `#scanner-panel`
- Formulaires : `#variables-form`, `#profile-form`, `#profile-modal` (bouton `#profile-skip` = "Plus tard", visible tant que profil non configuré ; champ `#profile-income` = revenus salariaux, toggle `#profile-income-unit-toggle` mensuel/annuel + `#profile-income-hint` "soit X €/an|mois")
- Zones de rendu : `#analysis-sticky-summary`, `#analysis-metrics`
- Analyse — sections avancées (Robustesse, Scénarios de stress, Régimes fiscaux, Journal, Projection/matrice, Cash-flow annuel, Comparatif des leviers) en `<details>` repliées par défaut, masquées en Vue rapide via `.analysis-section--{robustesse,scenarios,regime,journal,visuals}` + `.analysis-forward`/`.analysis-section--sensitivity`/`.analysis-section--cashflow` (CSS `[data-analysis-view="quick"]`)
- Champ optionnel : `#annee-achat` (dans fieldset Identité — active les conseils temporels)
- Portefeuille biens détenus (dans `#collection-panel`) :
  - `.owned-regime-slider-label` "Régime fiscal du portefeuille" — libellé statique au-dessus du sélecteur `#owned-regime-slider-anchor` (Micro-foncier/Réel/SCI-IS)
  - Vue liste : `#owned-list-view`, `#owned-kpi-banner`, `#owned-list-table`, `#owned-add-btn`
  - Modal ajout : `#owned-add-modal`, `#owned-add-form`, `#owned-add-nom`, `#owned-add-ville`
  - Vue détaillée : `#owned-detail-view`, `#owned-back-btn`, `#owned-detail-title`, `#owned-diagnostic-btn`
  - Accordéons : `#acc-acquisition`, `#acc-acquisition-body`, `#acc-acquisition-content`, `#acc-postachat`, `#acc-simulateur`
  - Onglet Travaux : `#owned-travaux-content` (rendu par `renderOwnedTravauxTab`, formulaire `[data-form="add-travail-tab"]` avec champ PDF)
  - Drawer IA : `#owned-ai-drawer`, `#owned-ai-overlay`, `#owned-ai-drawer-content`

---

## styles.css
Design system complet : tokens CSS, composants, thèmes light/dark.
- Variables root : `--bg`, `--surface`, `--accent-gold`, `--success`, `--danger`, `--warning`, `--primary-rgb`
- Thèmes : `html[data-theme='dark']` / `html[data-theme='light']`
- Composants : `.workspace`, `.panel-head`, `.variables-form`, `.verdict-*`, `.score-*`
- Piège `position: sticky` cassé : tout ancêtre avec `overflow` ≠ `visible` (même `hidden` sans scroll réel) transforme cet ancêtre en conteneur de scroll et casse le sticky des descendants — utiliser `overflow: clip` à la place (même rendu visuel, pas l'effet de bord). Déjà rencontré sur `body` (sidebar, commit `9ce4b59`) et sur `.workspace-panel` (`.analysis-sticky-summary`, `.owned-tabs`).
- Piège `position: sticky` variante 2 (audit UX 2026-07) : `.variables-panel`/`.form-kpi-bar` ne doivent être `position: sticky` (rail + max-height + overflow-y:auto) que sous `.workspace-board[data-layout="2"]` (vrai mode 2 colonnes) — en `data-layout="1"` (mode par défaut, colonnes empilées), les rendre sticky les laisse épinglés au-dessus de `.analysis-panel` qui défile juste en dessous et ça entre en collision avec les sticky propres à `.analysis-panel` (`.analysis-toc`, `#analysis-sticky-summary`). Toujours scoper `[data-layout="2"] <sélecteur>` avant d'ajouter un sticky dans `.workspace-board`.
- `.app-sidebar` (rail gauche, `position: sticky; top: 80px`) : ne pas lui remettre une `height`/`min-height` fixe (ex. `calc(100vh - 96px)`) — son contenu (`nav`+`mode`+`save`, tous `flex-shrink:0`) ne remplit jamais cette hauteur et ça laisse ~40% du viewport vide en bas du rail (bug UX 2026-07). Le laisser se dimensionner à son contenu.
- Scanner workspace : `.scanner-workspace-hero`, `.scanner-command-panel`, `.scanner-command-card`, `.scanner-rayon-group`, `.scanner-options-dropdown`
- Scanner table : `.scanner-dpe-badge--a/b/c/d/e/f/g`, `.scanner-price-drop`, `.scanner-dist-badge--near/mid/far`, `.scanner-freshness`, `.scanner-score-decision`
- Scanner stats : `.workspace-hero-mini-card.scanner-stat--gold/pos/warn`, `.scanner-stat--insight`
- Portefeuille biens détenus : `.owned-list-header`, `.owned-kpi-banner`, `.owned-kpi-card`, `.owned-list-table`, `.owned-add-modal`, `.owned-detail-header`, `.owned-accordion`, `.owned-accordion__header[aria-expanded]`, `.owned-form-grid`, `.owned-travaux-row` (grille 7 colonnes : checkbox/date/desc/montant/tag/pdf/suppr.), `.owned-travaux-year` (`<details>` classeur par année), `.owned-notes-add`, `.owned-simulator-table`
- `.owned-alert--info` / `.owned-dashboard-alert--info` (ton bleu, distinct de `--error`/`--warning`) — utilisé pour les suggestions d'optimisation fiscale (non des risques réels) ; `.owned-caveat` (texte italique tertiaire) pour les mises en garde inline (ex. coûts de structure SCI-IS non comptés) ; `.owned-cf-table__note` pour la note "hors apport initial"
- `.profile-income-row` / `.mode-toggle--sm` / `.profile-field__hint` — toggle mensuel/annuel du champ Revenus salariaux (profil)
- Aperçu PDF : `.document-preview-overlay`, `.document-preview-dialog`, `.document-preview-embed` (overlay plein écran, `<embed>` vers `/api/documents/...`)
- Analyse : `.analysis-neutral-card` (état neutre avant saisie prix/loyer), `.analysis-block > summary` (habillage des sections `<details>`)
- Portfolio zones : `.portfolio-zone`, `.portfolio-donut-wrap`, `.portfolio-alerts`, `.portfolio-alert--red/orange`
- Portfolio conseils : `.advice-card`, `.advice-card--red/orange/info`, `.advice-group`
- Portfolio fiches : `.portfolio-fiche`, `.portfolio-fiche__verdict--green/orange/red`, `.portfolio-fiche__kpi`
- Portfolio travaux : `.travaux-row`, `.tag`, `.tag--green/orange/grey`, `.travaux-form`
- Portfolio notes : `.notes-entry`, `.notes-text`, `.notes-date`
- Portfolio pipeline : `.pipeline-table`, `.pipeline-score--excellent/positive/neutral/watch/negative`
- Zone 5 : `.portfolio-ai-trigger-row`, `.portfolio-ai-drawer`, `.portfolio-ai-overlay`, `.ai-rec`, `.ai-rec__num/body/title/text/action`
- Layout : `.workspace-board`, `.sidebar`, `.topbar`
- Appliquer un thème ou modifier une couleur → chercher dans les blocs `[data-theme=...]`

---

## scraper/main.py
Orchestrateur du scrape multi-sites Centre-Val de Loire.
- `main(progress_callback, villes_override, force_marche)` — scrape → filtre → IA → stockage SQLite ; détecte blocage 403 en < 5s et émet warning dans logs UI
- `_hydrate_descriptions(scraper, annonces, emit, pct)` — récupère descriptions manquantes en parallèle (ThreadPoolExecutor 3 workers, 1s/req)

---

## scraper/db.py
Schéma SQLite et connexion à `biens.db`.
- `init_db(path)` — crée/ouvre la DB, retourne la connexion
- Tables : `biens`, `annonces`, `historique_prix`, `loyers_marche`, `geocodes`

---

## scraper/filtrage.py
Tri des annonces avant enrichissement IA : URL connue / doublon fingerprint / nouvelle.
- `filtrer_nouvelles_annonces(annonces, conn)` — retourne `(nouvelles, stats)`

---

## scraper/ia.py
Enrichissement IA via API Anthropic (batch) : nb_pièces, travaux, DPE, résumé.
- `enrichir_batch(annonces, poll_interval)` — soumet batch Anthropic + poll + parse JSON

---

## scraper/utils.py
CRUD SQLite pour les tables biens/annonces/historique.
- `inserer_bien(annonce, fp, conn)` — INSERT dans `biens`
- `inserer_annonce(bien_id, enrichie, conn)` — INSERT dans `annonces`
- `url_existe(url, conn)` — SELECT bien par URL
- `fingerprint_existe(fp, conn)` — SELECT bien par fingerprint

---

## scraper/calculs.py
Calculs financiers côté scraper : loyer marché, CF, score investisseur.
- `get_loyer_marche(ville, type_bien, surface, conn)` — loyer médian de référence
- `enrichir(bien_id, annonce, conn)` — calcule CF + DSCR + score + régimes fiscaux

---

## scraper/enrich.py
Pipeline d'enrichissement : récupère les descriptions manquantes + IA + calculs financiers.
- `enrich_pending(conn, progress_callback)` — traite tous les biens en attente ; exclut pré-IA les biens sans description+surface+type_bien

---

## scraper/logger.py
Logger unifié pour tous les modules scraper (console + fichier `spark_scraper.log`).
- `get_logger(name)` — retourne un logger configuré pour le module

---

## scraper/scrapers/base.py
Classe abstraite commune à tous les scrapers (retry, filtrage prix, interface).
- `BaseScraper` — `fetch_all(villes)`, `fetch_ville(ville)` (abstract) ; filtre CP désactivé si `ville.get("rayon_km")` défini

---

## scraper/scrapers/__init__.py
Registre des scrapers disponibles.
- `REGISTRY` — dict `{site: ScraperClass}` — ajouter un nouveau scraper ici

---

## scraper/browser.py
Singleton Playwright + stealth partagé par tous les scrapers. Lance Chromium headless une seule fois par run, ferme via atexit.
- `browser_page()` — context manager : yield une page Playwright avec stealth appliqué (navigator.webdriver=false, locale fr-FR, UA Chrome 131)

## scraper/scrapers/leboncoin.py
Scraper LeBonCoin via parsing `__NEXT_DATA__` avec Playwright+stealth (remplace curl_cffi). Délais aléatoires 2–5s initial + 6–10s entre pages.
- `LeBonCoinScraper` — `fetch_ville(ville)`, `_fetch_page(loc_param, page)`, `fetch_description(url)`

---

## VERSION
Fichier texte à la racine, source de vérité unique du numéro de version (`X.Y.Z`). Lu indépendamment par `app.py` (`__version__`), `server.py` (`/api/version`), `spark.spec` (nom de l'exe) et `build.bat` (raccourci + résumé) — pas d'import possible entre eux vu l'ordre de chargement des modules.

---

## CHANGELOG.md
Journal des versions (format Keep a Changelog) — à mettre à jour à chaque release.

---

## Lancer.bat
Lancement rapide en développement (hors build) : ferme l'instance existante sur le port 8080 (taskkill par PID via `netstat`), affiche la version lue depuis `VERSION`, relance `pythonw app.py` avec le code source à jour.

---

## verify.bat
Vérification locale : `pytest tests/` puis `tests/test_frais_fiscalite.mjs` et `tests/test_regimes_fiscaux.mjs`, s'arrête net (exit non-zero) au premier échec. Appelé par `build.bat` en première étape (variable `CALLED_FROM_BUILD` pour ne pas `pause` en mode non-interactif).

---

## build.bat
Build de production : appelle `verify.bat` (abandonne si échec), compile via `spark.spec` (exe nommé `Spark-<version>.exe` d'après `VERSION`), copie les fichiers statiques dans `Spark\`, crée le raccourci bureau et une archive `Spark-<version>.zip`.

---

## spark.spec
Config PyInstaller. Lit `VERSION` à la racine pour nommer l'exe `Spark-<version>.exe` ; le dossier `COLLECT` reste nommé `Spark` (stable d'une version à l'autre).
