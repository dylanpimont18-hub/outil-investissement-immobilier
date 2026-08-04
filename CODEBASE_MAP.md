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
- `api_documents_get` GET `/api/documents/<bien_id>/<filename>` — lecture seule, sert le PDF (`Content-Type: application/pdf`) ; ne sert plus qu'à la migration ponctuelle vers Firebase Storage (upload/suppression/aperçu PDF se font désormais côté client, voir `owned-cloud.js`) — routes `upload`/`delete`/`delete_all` retirées le 2026-07-27 (sync cloud portefeuille)
- `api_geocode_batch` POST `/api/geocode/batch` — accepte `[{ville, code_postal}]`, retourne `{"ville|cp": {lat, lng}}` ; cache en table `geocodes`. Utilisé par la carte du scanner (route supprimée par erreur en juin 2026, recréée le 2026-07-27). Route soeur `/api/geocode/address` (portefeuille) retirée le 2026-07-27 — géocodage du portefeuille désormais client-side (`owned-cloud.js` → `cloudGeocode`)
- `_nominatim_lookup(query)` — appel Nominatim sérialisé par un lock + délai 1,1 s (limite 1 req/s de l'instance publique) ; nécessite `requests` (dans requirements.txt et les hiddenimports de `spark.spec`)

---

## main.js
Orchestration UI complète : état, rendu, sync multi-fenêtres, routing des panels. Le module "portefeuille
biens détenus" a été extrait dans `owned-portfolio.js` (axe 3) — main.js ne contient plus que l'Analyse,
le Comparateur, le profil, le shell (thème, onglets, sync cross-fenêtres) et le câblage des imports.
- `sanitizeVariablesData()` — valide et normalise les inputs du formulaire (inclut `annee-achat`, `assurance-mode` : `'initial'`|`'crd'`, défaut `'initial'` — voir `computeAmortizationSchedule` dans calculs.js)
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
- `sanitizeProfileData(rawProfile)` — normalise le profil ; `income` toujours stocké en annuel, `incomeUnit` (`'mensuel'`|`'annuel'`, défaut `'mensuel'`) ne pilote que l'affichage. `revenuHistorique` (ajouté le 2026-08-04) : passe-plat préservé tel quel (pas de champ dans la modale, éditée depuis l'onglet Profil d'owned-portfolio.js) — **piège rencontré** : cette fonction reconstruit tout le profil depuis un allowlist de champs, donc un appelant qui omet `revenuHistorique` l'écraserait silencieusement à `[]` ; les deux call sites (`updateProfileFromForm`, `applyProfilePreset`) le repassent explicitement, comme `autresCredits`
- `openProfileModal()` — depuis le 2026-08-04, si `state.profileConfigured` est déjà vrai, ne rouvre plus la modale : clique sur l'onglet Portefeuille puis sur son onglet "Profil" (`renderOwnedProfilTab`, owned-portfolio.js) à sa place. La modale ne s'ouvre donc réellement que pour le tout premier remplissage (onboarding, `!state.profileConfigured`, seul autre appelant de cette fonction)
- `saveProfileData()` — persiste `state.profileData` en localStorage puis appelle `syncProfileToCloud()` (owned-portfolio.js) pour pousser le profil complet vers Firestore, afin qu'`owned.html` (iPhone) calcule le même TMI/CF net-net après impôt que le PC (portée étendue le 2026-08-04, voir `syncProfileToCloud`)
- `setProfileIncomeUnit(unit, {convert})` / `updateProfileIncomeHint()` — bascule le champ Revenus salariaux entre saisie mensuelle/annuelle (toggle `#profile-income-unit-toggle`), convertit la valeur affichée et met à jour le texte d'aide "soit X €/an|mois"
- Bootstrap (fin de fichier) : `initOwnedPortfolio({ state, nodes, STORAGE_KEYS, IS_ANALYSIS_WINDOW, IS_MOBILE_PAGE: false })` doit être appelée **avant** le premier `render()` (le module en dépend dès son premier rendu) ; `initOwnedPortfolioEvents()` (câblage des listeners persistants) reste appelée après, comme avant l'extraction. Fetch `/api/version` au démarrage → affiche `vX.Y.Z` dans `#topbar-version` (topbar).

---

## owned-portfolio.js
Module "portefeuille biens détenus" — CRUD, rendu (liste, fiche détail, onglets Acquisition/Exploitation/Travaux/Calcul, dashboard dirigeant) et tous les événements associés. Extrait de main.js (axe 3) ; reçoit `state`/`nodes`/`STORAGE_KEYS`/`IS_ANALYSIS_WINDOW`/`IS_MOBILE_PAGE` par référence via `initOwnedPortfolio(deps)` plutôt que de les dupliquer. Depuis le 2026-07-27, la donnée du portefeuille (biens, objectifs, ordre, régime, documents PDF) vit dans Firebase (Firestore + Storage, projet `spark-investissement`) au lieu de `localStorage` — un seul compte, synchronisé PC + iPhone (page dédiée `owned.html`). Toute la logique Firebase concrète est dans `owned-cloud.js` ; ce fichier ne fait que lire/écrire un cache local tenu à jour par des listeners temps réel, ce qui préserve le contrat synchrone historique de `loadOwnedAssets()`/`saveOwnedAssets()` pour tous les appelants existants. Depuis le 2026-08-04 (voir `docs/superpowers/specs/2026-08-04-onglet-calcul-portefeuille.md`), l'onglet **Calcul** (`renderOwnedCalculTab`) regroupe TOUT le détail chiffré d'un bien — indicateurs clés, défiscalisation, détail CF net-net, flux de trésorerie annuel, comparatif des régimes dans le temps — et est identique PC et mobile (plus de garde `IS_MOBILE_PAGE`) ; l'onglet Projection et ses 4 graphiques (CF cumulé, recettes/dépenses, CRD, dépenses) ont été supprimés entièrement, jugés non prioritaires face à leur coût de maintenance. `renderOwnedSynthese` ne rend plus que les 3 alertes (régime optimal, seuil micro-foncier, loyer sous-évalué), toujours visibles au-dessus des onglets, PC et mobile. `index.html` et `owned.html` partagent désormais exactement la même structure d'onglets par bien — seuls dashboard portefeuille/carte/bloc Verdict/diagnostic IA restent PC uniquement (`IS_MOBILE_PAGE`, voir `docs/superpowers/specs/2026-07-28-owned-mobile-simplification.md`). **Le garde-fou `if (IS_MOBILE_PAGE) return;` vit dans chaque fonction desktop-only elle-même** (`renderOwnedVerdictBlock`, `renderAccordionSimulateur`, `renderOwnedDashboard`, `renderOwnedMap`, `renderOwnedCfConsolidatedSection`, `renderOwnedPortfolioCharts`), pas seulement dans `renderOwnedDetail()`/`renderOwnedPortfolioList()` qui les appellent au premier rendu — ces fonctions sont aussi rappelées après quasi toute mutation (ajout/édition d'un travail, d'une charge, d'un loyer, d'une note...) depuis des dizaines d'autres endroits du fichier. Bug réel trouvé le 2026-07-29 : le premier rendu était bien simplifié, mais la moindre action sur `owned.html` faisait réapparaître ces blocs (conteneurs vides au chargement, remplis dès la première mutation puisque rien ne les `hidden` par CSS). **Toute nouvelle fonction de rendu réservée au desktop doit s'auto-garder de la même façon**, ne pas compter sur les appelants pour le faire.
- `initOwnedPortfolio(deps)` — **point d'entrée**, à appeler avant le premier `render()` de main.js (stocke `state`/`nodes`/`STORAGE_KEYS`/`IS_ANALYSIS_WINDOW`/`IS_MOBILE_PAGE`, démarre `_initCloudSync()`)
- `_initCloudSync()` — s'abonne à `watchAuth`/`watchOwnedAssets`/`watchPortfolioMeta` (owned-cloud.js) ; tient à jour `_assetsCache`/`_metaCache`/`_authUser`/`_cloudLoaded` et rappelle `renderCollections()` à chaque snapshot. Sur chaque snapshot `watchPortfolioMeta`, si `_metaCache.profile` existe il est mergé dans `state.profileData` (income/adults/children, pilotent le TMI) ; sinon, si `state.profileConfigured` est vrai (uniquement possible sur PC/`main.js`, jamais posé par `owned-entry.js`), bootstrap `syncProfileToCloud()` pour amorcer le doc cloud depuis le profil local déjà configuré
- `syncProfileToCloud()` — exportée, pousse le profil complet (`name`, `income`, `adults`, `children`, `revenuHistorique`, `objectifCF`, `revaloAnnuelle`, `autresCredits`) de `state.profileData` vers `portfolioMeta/main` (`cloudSaveMeta`, merge:true) ; appelée par `main.js` → `saveProfileData()`, par `saveOwnedProfileData()` (onglet Profil, PC et téléphone), et par le bootstrap ci-dessus. Étendu le 2026-08-04 au-delà de `{income, adults, children}` (portée initiale du 2026-07-29) quand l'onglet Profil a rendu tout le profil éditable des deux côtés
- `_metaLoaded` (variable module, même famille que `_cloudLoaded`) : passe à `true` au premier snapshot `watchPortfolioMeta`, remis à `false` à la déconnexion. `renderCollections()` attend `_cloudLoaded` **et** `_metaLoaded` avant de rendre quoi que ce soit côté connecté — sans ce second garde-fou, un rendu pouvait se produire entre l'arrivée du snapshot `ownedAssets` et celle de `portfolioMeta`, utilisant la valeur locale par défaut de `state.ownedRegime`/`profileData` (ex. "Micro-foncier") et provoquant un flash visible du CF net-net avant correction (audit UX 2026-07-29)
- `_renderAuthGate()` — formulaire de connexion (compte unique) injecté dans `#owned-auth-gate` tant que `_authUser` est absent ; affiché par `renderCollections()`
- `_renderMigrationBanner()` — bannière "Importer vers le cloud" dans `#owned-migration-banner`, visible seulement si le portefeuille cloud est vide et qu'un ancien portefeuille `localStorage` existe sur l'appareil ; migre biens + PDF (relus via l'ancienne route `GET /api/documents/...` conservée pour ça) + objectifs/ordre/régime, se masque seule une fois l'un des deux devenu faux
- `initOwnedPortfolioEvents()` — exportée séparément, câblage des listeners persistants (modal ajout, retour, IA, drawer, délégation actions détail) ; à appeler après le rendu initial, comme avant l'extraction
- `renderCollections()` — exportée, dispatcher connexion → chargement → vue liste ↔ vue détaillée, appelée à chaque cycle de `render()` par main.js et à chaque snapshot Firestore
- `loadOwnedAssets()` / `saveOwnedAssets()` / `createOwnedAsset(nom, ville)` / `getOwnedAsset(id)` / `updateOwnedAsset(id, patch)` / `deleteOwnedAsset(id)` — CRUD biens ; `loadOwnedAssets()` retourne un clone JSON jetable du cache (même contrat que l'ancien `JSON.parse(localStorage...)`), `saveOwnedAssets()` diffe contre le cache précédent et ne pousse vers Firestore que les biens réellement modifiés/supprimés ; asset inclut `codePostal` (top-level)
- `_populateQuickAssetSelect(root)` / `_refreshAfterQuickFacture(assetId)` / `_wireQuickFactureForm(root, onSubmitted)` — briques partagées "capture rapide d'une facture" (2026-08-04), consommées par `initOwnedQuickRail` (PC) **et** `initOwnedQuickFab` (mobile) : un seul flux dropzone PDF/JPG/PNG + extraction IA (réutilise `TRAVAUX_ACCEPTED_MIME`/`cloudExtraireFraisFacture`/`addOwnedTravail`, comme `renderOwnedTravauxTab`) + formulaire, tant que `root` contient `[data-quick-asset-select]`/`[data-quick-dropzone(-body)]`/`[data-quick-file-input]`/`[data-quick-status]`/`[data-quick-facture-form]` + champs `[data-quick-field]`. `_refreshAfterQuickFacture` : reste sur la vue courante après ajout (pas de navigation forcée) — rafraîchit la fiche du bien si déjà ouverte, sinon la liste
- `initOwnedQuickRail()` / `openOwnedQuickPanel(action)` / `closeOwnedQuickPanels()` — rail Actions rapides `#owned-quickrail` (2026-08-04, PC uniquement, no-op si l'élément est absent — cas de `owned.html`). Deux actions : `add-bien` (mêmes champs que l'ex-modale, crée puis `openOwnedDetail`) et `add-facture` (sélecteur "Bien concerné" + `_wireQuickFactureForm`). Une seule action ouverte à la fois (`data-quickaction`/`data-quickpanel`), le clic pousse le contenu sur place (~+260px) sans jamais masquer la page. `openOwnedAddModal()` reste le point d'entrée commun des CTA "état vide" (mobile + PC) : bascule vers `openOwnedQuickPanel('add-bien')` quand `#owned-add-modal` est absent (PC)
- `initOwnedQuickFab()` — bouton flottant `#owned-quickfab` (2026-08-04, mobile uniquement, no-op si absent — cas d'`index.html`), équivalent mobile de "Ajouter une facture" du rail PC : visible partout sur `owned.html` (liste et fiche d'un bien, `position:fixed`). Ouvre une modale plein écran (`#owned-quickfab-modal`, réutilise `.owned-add-modal`) plutôt qu'un panneau inline (écran trop étroit) ; même `_wireQuickFactureForm` que le rail PC. Pas d'action "Ajouter un bien" ici — déjà accessible via le bouton de la Vue d'ensemble. Le sélecteur de fichier n'a pas d'attribut `capture` : le picker natif mobile (iOS/Android) propose déjà "Prendre une photo / Galerie / Parcourir" avec `accept="image/*"`, choix volontairement laissé ouvert (pas de lancement direct caméra)
- `updateOwnedAcquisition(id, patch)` / `updateOwnedCredit(id, patch)` / `updateOwnedPostAchat(id, patch)` — patch sous-objets
- `addOwnedLot(assetId, lot)` / `updateOwnedLot(assetId, lotId, patch)` / `deleteOwnedLot(assetId, lotId)` — CRUD lots d'un immeuble de rapport (`asset.lots[]`, optionnel) ; consommé via `resolveLoyerVacance` (calculs.js) pour le CF consolidé
- `addOwnedTravail(assetId, travail)` / `deleteOwnedTravail(assetId, travailId)` — CRUD travaux (frais documentés : `date`, `description`, `montant`, `tag`, `commentaire`, `pdfFilename`, `financeParCredit` — suppression déclenche aussi la suppression du PDF associé sur Firebase Storage). `financeParCredit` (2026-07-29) : voir calculs.js, effet sur le CF réparti dans 4 fonctions distinctes.
- `uploadOwnedDocument(assetId, file)` — délègue à `cloudUploadDocument` (owned-cloud.js → Firebase Storage), retourne le `filename` stocké
- `openDocumentPreview(assetId, filename)` / `printSelectedDocuments(assetId, filenames)` — async, résolvent l'URL de téléchargement Firebase Storage via `cloudDocumentUrl` avant affichage (overlay `<embed type="application/pdf">` ou `<img>` selon `_isImageFilename(filename)`, corrigé le 2026-08-04 : un embed PDF forcé sur une photo échouait avec "Nous ne pouvons pas ouvrir ce fichier") / impression multi-documents (nouvel onglet, `<embed>`/`<img>` selon le type + `window.print()`)
- `renderOwnedTravauxTab(asset)` — onglet "Frais & justificatifs" : recherche (`data-travaux-search`, filtre client sur description/montant, déplie les années qui matchent) + classeur par année (`<details>`) + rangée d'ajout à deux colonnes égales (refonte 2026-08-04, voir `docs/superpowers/specs/2026-08-04-onglet-travaux-refonte.md`) : zone de dépôt facture/photo (`data-travaux-dropzone`, PDF/JPG/PNG, drag&drop + clic) qui appelle `cloudExtraireFraisFacture` (owned-cloud.js → Cloud Function `extraireFraisFacture`) pour pré-remplir date/description/montant/tag du formulaire manuel juste à côté (classe `.ai-filled` sur les champs concernés, badge "suggéré" sur le tag, bandeau `data-travaux-ai-banner`) ; en cas d'échec d'extraction le fichier reste attaché comme justificatif et le formulaire reste utilisable manuellement (toast négatif, pas de blocage). Seul endroit qui gère le CRUD travaux (voir `renderAccordionPostAchat`). Handler `[data-form="add-travail-tab"]` rejette (toast négatif) une soumission sans date/description/montant — le formulaire est `novalidate`, donc cette garde JS est la seule validation (bug trouvé + corrigé le 2026-08-04, QA Playwright)
- `_normalizeSearchText(str)` / `_fileToBase64(file)` / `_runWithConcurrencyLimit(items, limit, worker)` — helpers module-scope : recherche (accents/casse), encodage du fichier déposé avant envoi à `cloudExtraireFraisFacture`, exécution avec concurrence plafonnée (import groupé, évite de saturer l'API Anthropic)
- `openTravauxBatchModal(files)` — dépôt de 2+ fichiers sur le dropzone (au lieu d'1 seul) : modale de revue en tableau (`.owned-batch-table`, styles.css — passe en cartes empilées sous `@media (max-width: 480px)`, **pas** `.shell--owned` : les modales sont ajoutées à `document.body` par `_showOwnedModal`, hors de l'arborescence `.shell--owned`, ce scoping ne matcherait jamais), une ligne par fichier, extraction IA en concurrence limitée à 3, case à cocher par ligne pour exclure un fichier, bouton "Ajouter les N frais" (N = lignes cochées, mis à jour en direct) qui uploade + `addOwnedTravail` chaque ligne valide (date/description/montant renseignés) en séquence. Voir `docs/superpowers/specs/2026-08-04-travaux-import-groupe.md`. Le flux 1 fichier (`handleFile`, dans `renderOwnedTravauxTab`) reste inchangé.
- `addOwnedNote(assetId, text)` / `deleteOwnedNote(assetId, noteId)` — ajout/suppression note horodatée (id généré à la création)
- `addOwnedScenario(assetId)` / `updateOwnedScenarioVar(assetId, scenarioId, key, val)` / `updateOwnedScenarioNom(assetId, scenarioId, nom)` / `deleteOwnedScenario(assetId, scenarioId)` — CRUD scénarios
- Navigation par onglets de la vue liste (`.owned-list-tabs`, ajoutée le 2026-07-29) : "Vue d'ensemble" (contenu historique inchangé) / "Impôt" (`renderOwnedImpotTab`, PC uniquement) / "Profil" (`renderOwnedProfilTab`, PC **et** `owned.html`, ajouté le 2026-08-04) — même pattern `.owned-tab`/`.owned-tab-panel` que la vue détail d'un bien, wiring délégué sur `nodes.ownedListView` (une seule fois, `dataset.tabWired`, désormais câblé même si `IS_MOBILE_PAGE`) dans `renderOwnedPortfolioList()`
- `renderOwnedProfilTab()` — ajoutée le 2026-08-04, rend `#owned-profil-content` : nom, **revenus du foyer historisés** (`state.profileData.revenuHistorique = [{annee, revenu}]`, résolus par `resolveRevenuFoyer`/`resolveTmiFoyer` dans calculs.js — même logique que `loyerHistorique`, une entrée s'applique jusqu'à la suivante), adultes/enfants, objectif CF, revalorisation annuelle, autres crédits hors immo. Remplace la modale Profil de `main.js` pour toute édition courante (celle-ci ne sert plus qu'au tout premier remplissage, voir `openProfileModal` dans main.js) — disponible sur PC **et** `owned.html` (contrairement au reste du profil avant cette date, jamais éditable depuis le téléphone). Persistance via `saveOwnedProfileData()` (localStorage + `syncProfileToCloud()`, même contrat que `main.js:saveProfileData()`)
- `addOwnedRevenuHistorique(entry)` / `deleteOwnedRevenuHistorique(annee)` — CRUD `profileData.revenuHistorique`
- `addOwnedAutreCredit(entry)` / `deleteOwnedAutreCredit(id)` — CRUD `profileData.autresCredits` (version simplifiée libellé+mensualité de la modale PC, qui garde en plus mensualité hors assurance/dates/CRD optionnels via un drawer dédié dans main.js — non répliqué ici)
- `renderOwnedPortfolioList()` — liste biens + KPIs consolidés + état vide ; tri par performance (`state.ownedSort` = `{criterion:'cf'|'rendement'|'dscr', dir:'asc'|'desc'}`, persisté `STORAGE_KEYS.ownedSort`) via sélecteur `#owned-sort-select` ou clic sur en-têtes `.owned-col-sortable` ; rendement net dérivé en ligne (`loyerEffectif`/`chargesMensuelles` de `computeOwnedAssetCF`, pas de nouvel export calculs.js) ; glisser-déposer (`state.ownedOrder`) désactivé tant qu'un tri est actif. Si `IS_MOBILE_PAGE`, rend `_renderOwnedListMobile(list)` puis **saute** (`if/else`, plus un `return` précoce depuis le 2026-08-04) le bloc desktop-only (carte/graphiques/dashboard/tableau/`renderOwnedImpotTab`) — **piège rencontré** : le branchement des onglets (`.owned-list-tabs`) et `renderOwnedProfilTab()` sont placés **après** ce bloc, donc un `return` précoce sur mobile les empêchait totalement de s'exécuter (aucune erreur, le bouton "Profil" restait juste inerte — bug repéré uniquement en pilotant un vrai Chromium via Playwright, invisible à la seule lecture du diff, voir section Testing de CLAUDE.md). Toute nouvelle fonctionnalité commune aux deux plateformes doit être placée **hors** de ce bloc `if (IS_MOBILE_PAGE) {...} else {...}`, jamais après un ancien point de sortie sans vérifier qu'il n'y en a plus. Le mini-donut par ligne résout recettes/vacance via `resolveLoyerVacance(asset)` (corrigé le 2026-07-29 : lisait `acquisition.loyerInitial` en dur, donc figé après toute évolution enregistrée dans l'historique de loyer)
- `_renderOwnedListMobile(list)` — variante `owned.html` : liste verticale de cartes tap-to-open (`.owned-mobile-list__item`, nom/ville/CF net-net mensuel via `computeOwnedAssetCF`) dans `#owned-list-table`, pas de tri ni glisser-déposer, ordre = `getOrderedAssetList()`
- `openOwnedDetail(assetId)` / `closeOwnedDetail()` — navigation vue liste ↔ vue détaillée
- `renderOwnedDetail()` — header fiche + câblage accordéons/onglets. `renderOwnedSynthese` (alertes) et `renderOwnedCalculTab` (onglet Calcul) sont rendus identiquement PC et mobile ; seuls `renderOwnedVerdictBlock`/`renderAccordionSimulateur` restent gardés `IS_MOBILE_PAGE` (masque aussi le bouton Diagnostic IA sur mobile)
- `renderAccordionAcquisition(asset)` — formulaire données figées + crédit + valeurEstimee/dateEstimation + **champ Adresse complète** (`data-owned-field="adresse"`, déclenche le géocodage) ; si `typeBien === 'immeuble'`, affiche la section "Lots de l'immeuble" (CRUD `asset.lots[]`). Le champ Loyer y est **toujours en lecture seule** depuis 2026-07-27 : il affiche le loyer résolu et renvoie vers l'onglet Exploitation (ou vers les lots pour un immeuble) — plus de double source de saisie. Champ crédit `data-credit-field="assuranceMode"` (`'initial'`|`'crd'`, 2026-07-28) : base de calcul de l'assurance emprunteur, voir `computeAmortizationSchedule` (calculs.js). Champ `data-owned-field="dateAchat"` (`type="month"`, remplace l'ancien `anneeAchat` le 2026-07-28 — voir `parseDateAchat`/`formatDateAchat`) : date d'achat au mois précis, pilote tout le moteur crédit (le crédit ne démarre pas forcément en janvier)
- `renderAccordionPostAchat(asset)` — onglet Exploitation, formulaire de saisie pur depuis le 2026-08-04 (le détail CF/compte de résultat a été déplacé dans l'onglet Calcul, voir `renderOwnedCalculTab`) : Évolution charges (P0-A+P0-B), résumé travaux (lecture seule, renvoie vers l'onglet Travaux), **section Loyer** (loyer actuel + historique des prises d'effet + formulaire montant/mois + bouton `[data-action="analyse-loyer-marche"]`), **déficits fonciers reportables** (lecture seule depuis le 2026-07-28, calculés par `computeDeficitFoncierHistorique` — plus de saisie manuelle), notes. Pour un immeuble avec lots, la section Loyer affiche un renvoi vers l'onglet Acquisition au lieu du formulaire
- `renderAccordionSimulateur(asset)` — matrice scénarios avec CF net-net recalculé
- `renderOwnedCalculTab(asset)` — onglet Calcul (2026-08-04, PC et mobile identiques, plus de garde `IS_MOBILE_PAGE`) : indicateurs clés (7 cartes — mensualité crédit, investissement total/apport, CF avant/après impôt, renta brute, DSCR, patrimoine net — reprises de l'ancien `renderOwnedSynthese`), défiscalisation (comparaison des 3 régimes pour le scénario courant + bouton `[data-action="open-simu-travaux"]`), détail CF net-net avec sélecteur d'année propre (`[data-calcul-year]`, état partagé `state.ownedYearFilters` avec `renderOwnedVerdictBlock` — cliquer l'un re-rend l'autre pour rester synchronisés), `renderOwnedCfTable` (cible `#owned-cf-table-wrap`, appelée en interne), comparatif des régimes dans le temps (`renderRegimeComparisonHTML`, ex-onglet Projection) + bouton `[data-action="open-compte-resultat"]`. Cible deux conteneurs statiques `#owned-calcul-top`/`#owned-calcul-bottom` (le tableau CF annuel `#owned-cf-table-wrap` reste entre les deux dans le DOM pour respecter l'ordre du spec)
- `renderOwnedDashboard(list, profileData, regime)` — dashboard dirigeant : snapshot 4 KPIs, Centre d'actions (fusion des alertes `computePortfolioAlerts`, triées par sévérité error>warning>info), objectifs (rendu dans #owned-dashboard-wrap). Signature passée de `tmi` à `profileData` le 2026-08-04 (résout un TMI par année pour `computePortfolioAlerts`/le déficit foncier historique, un TMI figé sur l'année courante pour le CF total via `computeOwnedAssetCF`)
- `addOwnedLoyerHistorique(assetId, entry)` / `deleteOwnedLoyerHistorique(assetId, mois)` — CRUD historique de loyer (`postAchat.loyerHistorique`, `{mois:'YYYY-MM', montant}` trié croissant). Remplace l'ancien suivi mensuel encaissé/impayé (`loyersReels`, supprimé le 2026-07-27 avec `computeTresorerieReelle` et l'alerte `loyer-manquant`)
- `renderOwnedMap(list)` / `_initOwnedMap()` — carte Leaflet du portefeuille (`#owned-map-section`, sous `#owned-kpi-banner` en vue liste), appelée par `renderOwnedPortfolioList()` : un `circleMarker` par bien géocodé, vert si CF net-net ≥ 0 sinon rouge, popup nom/ville/CF + bouton vers `openOwnedDetail`, `fitBounds` sur l'ensemble. Carte instanciée une seule fois puis réutilisée ; `invalidateSize()` différé après affichage de la section (Leaflet mesure mal un conteneur qui vient d'être révélé)
- `geocodeOwnedAsset(assetId, adresse, hintEl)` — appelle `cloudGeocode` (owned-cloud.js → Nominatim direct + cache Firestore) et patch `lat`/`lng` sur le bien ; déclenché depuis le listener `change` de `#acc-acquisition-content` quand `data-owned-field="adresse"`
- `updateOwnedTravail(assetId, travailId, patch)` / `openEditTravailModal(assetId, travailId)` — édition d'un frais existant (bouton ✏️ dans l'onglet Travaux, modale via `_showOwnedModal`). Depuis le 2026-07-29, le justificatif est gérable depuis cette modale : "Voir le justificatif actuel" (`openDocumentPreview`), case "Supprimer ce justificatif" (`cloudDeleteDocument` + `pdfFilename:null`), ou champ fichier pour l'ajouter/remplacer (upload puis suppression de l'ancien). Le champ fichier accepte PDF/JPEG/PNG (`TRAVAUX_ACCEPTED_MIME`, corrigé le 2026-08-04 : restreint à `application/pdf` seul auparavant, ce qui masquait les photos dans le sélecteur natif iPhone), avec la même validation de type que le formulaire de création. `updateOwnedTravail` distingue `pdfFilename` absent du patch (ne pas toucher) de `null` (retirer) — ne pas fusionner ce champ avec `??`/`||`
- `loadPortfolioGoals()` / `savePortfolioGoals(goals)` — objectifs portefeuille, lus/écrits dans le doc Firestore `portfolioMeta/main` (`_metaCache.goals`), aux côtés de `ownedOrder` et `ownedRegime` (mêmes doc/mécanisme, voir `setOwnedRegime`)
- `openCompteResultatModal(assetId)` — modal compte de résultat annuel (sélecteur d'année) : détail ligne à ligne (recettes, charges déductibles une à une, abattement micro-foncier ou résultat foncier réel, impôts, résultat net, capital remboursé, CF réel). Déclenchée par `[data-action="open-compte-resultat"]` (délégation globale sur `#owned-detail-view`). Depuis le 2026-08-04, un seul point d'accès (bouton dans `renderOwnedCalculTab`, onglet Calcul, PC et mobile identiques) au lieu de deux boutons dupliqués (ex-`renderOwnedSynthese` PC + ex-`renderAccordionPostAchat` mobile)
- `openSimulationTravauxModal(assetId)` — modal simulation travaux (déductibles ou non)
- `openCapaciteEmpruntModal()` — modal capacité d'emprunt (mensualite résiduelle → montant empruntable)
- `openObjectifsModal()` — modal saisie objectifs CF + patrimoine + date
- `openRapportAnnuelModal()` — modal rapport texte annuel avec bouton copier
- `openDeclarationFiscaleModal()` — modal "Déclaration fiscale" (bouton dashboard) : récap 2044 case par case + copier si régime réel (`computeDeclaration2044`) ; message dédié 2065/expert-comptable si SCI-IS ; note 2042 case 4BE si micro-foncier
- `renderOwnedImpotTab()` — ajouté le 2026-07-29 : rendu de l'onglet "Impôt" (`#owned-impot-content`, vue liste portefeuille) — reprend le revenu salarial du profil pour l'**année sélectionnée** (`resolveRevenuFoyer(state.profileData, annee)`, depuis le 2026-08-04 — avant, `state.profileData.income` figé sur le revenu actuel quelle que soit l'année choisie) + le revenu foncier imposable du portefeuille (`computeRevenuFoncierPortefeuille`), calcule l'IR complet (`computeImpotFoyer`, calculs.js) et affiche le détail pédagogique : KPIs (revenu salarial/foncier/global/total à payer), détail par bien si régime réel, tableau tranche par tranche du barème, décote, prélèvements sociaux fonciers. Sélecteur d'année `#owned-impot-annee` (même pattern que `openDeclarationFiscaleModal`). Appelée à chaque rendu de `renderOwnedPortfolioList()`, non appelée si `IS_MOBILE_PAGE` (pas de markup correspondant sur `owned.html`)
- `callOwnedDiagnosticIA(assetId)` — appel `POST /api/portfolio-diagnostic` + drawer résultat
- `_showOwnedModal(html, id)` — ouvre une modale générique (Compte de résultat, Simuler travaux, Capacité d'emprunt, Objectifs, Rapport annuel) ; ferme sur clic croix/fond **et** sur Échap (`_wireOwnedModalEscape`, wiring global une seule fois)
- `renderOwnedCfTable(asset)` — tableau "Flux de trésorerie annuels" (onglet Calcul depuis le 2026-08-04, PC et mobile, plus de garde `IS_MOBILE_PAGE`) ; cible `#owned-cf-table-wrap`, appelée en interne par `renderOwnedCalculTab`. Dépenses affichées hors apport initial (apport indiqué séparément via `y.apportAnnee`, badge "+ apport") pour que Recettes − Dépenses = CF annuel sur chaque ligne
- Bannière/badge "régime optimal" (dans `renderOwnedCalculTab`, section défiscalisation) : quand le régime optimal est `sci-is`, ajoute un caveat visible "(hors frais de structure et fiscalité de sortie)" + tooltip sur le badge `.owned-badge--optimal` — ce n'est qu'une comparaison de CF net-net, pas un coût total réel de la SCI. L'alerte équivalente au niveau de la fiche (`renderOwnedSynthese`) reste séparée, toujours visible au-dessus des onglets
- `renderOwnedCfConsolidatedSection(list, tmi, regime)` — signature inchangée (taux courant, `computeOwnedAssetCF`) — rendu dans `#owned-portfolio-cf-consolidated` (vue liste portefeuille) : ne dessine **que** `renderOwnedRepartitionBarHTML` (barre "Répartition du CF par bien"). Le graphique "CF net cumulé — portefeuille" est déjà rendu juste au-dessus par `renderOwnedPortfolioCharts` (Chart.js, `#owned-portfolio-charts`) — ne pas le re-dessiner ici en SVG (doublon corrigé, audit UX 2026-07 bug #7)
- `renderOwnedVerdictBlock(asset)` — PC uniquement. Tuiles "Vue An 1/3/5/10" : seulement CF net/mois + Effort épargne (valeurs qui varient réellement par année sélectionnée). Rendement brut/DSCR retirés de ce bloc : ils sont statiques (ne varient pas avec l'année) et déjà affichés dans les cartes indicateurs de l'onglet Calcul (doublon corrigé, audit UX 2026-07 bug #6). Son sélecteur d'année (`[data-verdict-year]`) et celui de l'onglet Calcul (`[data-calcul-year]`) partagent le même état `state.ownedYearFilters` — cliquer l'un re-rend l'autre (`renderOwnedCalculTab`) pour rester synchronisés

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

## firebase-init.js
Initialisation du SDK Firebase (projet dédié `spark-investissement`, plan **Blaze** depuis le 2026-08-04 pour les Cloud Functions) — importé par `owned-cloud.js`. `apiKey` volontairement publique (norme Firebase : la sécurité vient des règles Firestore/Storage + Auth, pas du secret de la clé), contrairement à `scraper/config.py` qui lui reste privé.
- `auth` / `db` / `storage` / `functions` — instances exportées (Auth, Firestore, Storage, Functions région `europe-west1`), SDK modulaire chargé depuis le CDN gstatic (pas de bundler dans ce projet)

---

## functions/index.js
Cloud Functions Firebase (Node 20, `firebase deploy --only functions`) — backend serveur pour le portefeuille, appelé à l'identique depuis PC (`index.html`) et mobile (`owned.html`), contrairement à `server.py` (Flask) qui n'existe que sur PC. Clé `ANTHROPIC_API_KEY` stockée en secret Firebase (`firebase functions:secrets:set`), distincte de `scraper/config.py`.
- `extraireFraisFacture` (callable, `onCall`) — reçoit `{base64, mimeType}` (PDF/JPG/PNG), appelle l'API Messages Anthropic (`claude-sonnet-4-6`) avec le document en pièce jointe, renvoie `{date, description, montant, tagSuggestion, confiance}` extrait de la facture. N'écrit rien en Firestore/Storage — utilisé par `renderOwnedTravauxTab` (owned-portfolio.js) pour pré-remplir le formulaire d'ajout d'un frais. Voir `docs/superpowers/specs/2026-08-04-onglet-travaux-refonte.md`.

---

## owned-cloud.js
Wrapper fin autour de Firebase (Firestore + Storage + Auth + Functions) pour le portefeuille biens détenus — aucune logique métier (cache, diff, rendu), tout ça reste dans `owned-portfolio.js`, seul importeur de ce module.
- `watchAuth(onChange)` / `cloudSignIn(email, password)` / `cloudSignOut()` — session (compte unique PC + iPhone, persistée par défaut par le SDK)
- `watchOwnedAssets(onChange, onError)` — écoute temps réel de la collection `users/{uid}/ownedAssets` (un doc par bien)
- `cloudSetAsset(id, data)` / `cloudDeleteAssetDoc(id)` — écriture/suppression d'un bien
- `watchPortfolioMeta(onChange, onError)` / `cloudSaveMeta(patch)` — doc unique `users/{uid}/portfolioMeta/main` (`goals`, `order`, `regime`, `profile` — voir `syncProfileToCloud` dans `owned-portfolio.js`), écriture en `merge: true`
- `cloudUploadDocument(assetId, file)` — upload un justificatif (PDF, JPEG ou PNG) vers `users/{uid}/documents/{assetId}/` (Storage), nom de fichier généré en conservant la vraie extension/`contentType` du fichier (corrigé le 2026-08-04 : forçait auparavant `.pdf`/`application/pdf` sur toute photo, rendant les justificatifs image illisibles à la relecture), retourne le `filename`
- `cloudUploadDocumentAs(assetId, filename, blob)` — variante réservée à la migration : conserve le nom de fichier d'origine (déjà référencé par `pdfFilename`)
- `cloudDocumentUrl(assetId, filename)` / `cloudDeleteDocument(assetId, filename)` / `cloudDeleteAllDocuments(assetId)` — lecture/suppression Storage
- `cloudGeocode(adresse)` — remplace l'ancien proxy serveur `/api/geocode/address` (indisponible sans serveur local sur iPhone) : appel direct Nominatim (respecte la limite 1 req/s) + cache dans `users/{uid}/geocodesAdresse`
- `cloudExtraireFraisFacture(base64, mimeType)` — appelle la Cloud Function `extraireFraisFacture` (`httpsCallable`), voir `functions/index.js`

---

## owned.html
Page statique autonome pour l'iPhone — sous-ensemble de `index.html` ne contenant que le panneau `#collection-panel` (portefeuille biens détenus), sans scanner ni outil d'analyse. Ajoutable à l'écran d'accueil Safari (meta `apple-mobile-web-app-capable`) pour un rendu plein écran. Servie par Firebase Hosting (voir `firebase.json`, rewrite `/portefeuille` → `/owned.html`). `<div class="shell shell--owned">` (au lieu de `.shell` seul) : padding-top mobile réduit (topbar une seule ligne, contrairement au topbar multi-lignes d'`index.html`) et variante empilée de `.owned-travaux-row` — voir `styles.css`. Rendu minimal depuis le 2026-07-28 (`IS_MOBILE_PAGE`, voir `owned-portfolio.js`) pour le dashboard portefeuille/carte/bloc Verdict/diagnostic IA, qui restent PC uniquement. Depuis le 2026-08-04 en revanche, la fiche détail d'un bien (onglets Acquisition/Exploitation/Travaux/**Calcul**) est **identique à `index.html`** : l'onglet Calcul (indicateurs clés, détail CF, flux de trésorerie annuel, comparatif régimes) et les alertes au-dessus des onglets s'affichent désormais aussi sur mobile — voir `docs/superpowers/specs/2026-08-04-onglet-calcul-portefeuille.md`. Vue liste à onglets (`.owned-list-tabs`, "Vue d'ensemble"/"Profil" — pas "Impôt", resté PC uniquement, ajouté le 2026-08-04), pour permettre l'édition du profil du foyer (revenus historisés notamment) depuis le téléphone. Bouton flottant `#owned-quickfab` (2026-08-04, "Ajouter une facture", voir `initOwnedQuickFab` owned-portfolio.js) visible partout sur la page. `#app-reload-btn` (topbar, câblé dans `owned-entry.js`) — ajouté le 2026-07-29 : en mode standalone (ajouté à l'écran d'accueil), iOS reprend souvent la page depuis la mémoire au lieu de la recharger après un déploiement, ce bouton évite d'avoir à supprimer/réinstaller l'icône pour récupérer une mise à jour.

---

## owned-entry.js
Bootstrap minimal pour `owned.html` — équivalent, pour le seul module portefeuille, de ce que `main.js` fait pour toute l'app : construit `state`/`nodes`/`STORAGE_KEYS` (réglages d'affichage locaux à l'appareil uniquement — les données du portefeuille viennent de Firestore) puis appelle `initOwnedPortfolio({ ..., IS_MOBILE_PAGE: true })`/`initOwnedPortfolioEvents`/`renderCollections`. `IS_MOBILE_PAGE: true` déclenche le rendu simplifié côté `owned-portfolio.js` (voir son entrée). Le profil du foyer (TMI) est synchronisé depuis le PC via Firestore (`syncProfileToCloud`, `_metaCache.profile`) depuis le 2026-07-29 — et éditable directement depuis le téléphone depuis le 2026-08-04 via l'onglet Profil (`renderOwnedProfilTab`, owned-portfolio.js), plus besoin de repasser par le PC.
- Listener sur `#app-reload-btn` — force une navigation réseau réelle vers l'URL courante + un paramètre `?_r=<timestamp>` jamais vu (via `location.replace`), pour contourner la reprise d'état iOS en mode standalone (l'app rouverte depuis l'écran d'accueil restait parfois sur l'ancienne version en mémoire) plutôt qu'un simple `location.reload()` moins fiable dans ce mode. La session Firebase Auth persiste (IndexedDB), pas besoin de se reconnecter après.

---

## firebase.json / firestore.rules / storage.rules / .firebaserc
Config du projet Firebase `spark-investissement` (plan **Blaze** depuis le 2026-08-04 — Firestore + Storage + Hosting + Cloud Functions). `firebase.json` sert tout le dépôt en statique (`public: "."`) en excluant `scraper/`, `tests/`, `docs/`, `exports/`, `documents/`, `functions/`, les binaires de build et fichiers Python — sécurité en profondeur en plus du `.gitignore` pour ne jamais exposer `scraper/config.py`. Bloc `"functions": {"source": "functions"}` pointe vers `functions/index.js`. Les règles Firestore/Storage scopent tout sous `/users/{uid}/...` avec `request.auth.uid == uid` (compte unique). Déployer : `firebase deploy` (tout) ou `firebase deploy --only hosting` / `--only functions` (depuis la racine du projet, compte déjà connecté via `firebase login`). Secret `ANTHROPIC_API_KEY` géré séparément via `firebase functions:secrets:set` (jamais dans ce dépôt).

---

## calculs.js
Moteur financier pur — zéro DOM. Tous les calculs, toutes les fiscalités.
- `computeAnalysisViewModel(inputs)` — **point d'entrée principal** : retourne tout le VM analyse
- `computeCF(prixVendeur, loyer, inputs, tmi)` — cash-flow brut + net + net-net
- `computeProjectMetrics(inputs)` — KPIs par actif (rentaBrute, rentaNette, DSCR, GRM, CoC…)
- `computeResaleTimeline(...)` — projection plus-value à la revente
- `calculateTMI(revenus, foyer)` — calcul tranche marginale d'imposition, barème 2026 (revenus 2025, loi de finances 2026 promulguée le 19/02/2026 : seuils 11 600/29 579/84 577/181 917€) — mis à jour le 2026-07-29, remplace le barème 2024 (revenus 2023) resté en place par erreur. Réutilise désormais la constante `BAREME_IR` partagée avec `computeImpotFoyer`
- `computeImpotFoyer(revenuSalarial, revenuFoncierImposable, foyer)` — ajouté le 2026-07-29 : calcul de l'IR au **barème progressif tranche par tranche** (pas juste la TMI en taux plat comme partout ailleurs dans l'app), avec **plafonnement du quotient familial** (`appliquerBaremeIR` appelé deux fois — parts complètes vs `partsBase = adults` seul — l'avantage des demi-parts enfants est plafonné à `PLAFOND_PAR_DEMI_PART_ENFANT` = 1 807 €/demi-part, retourné dans `plafonnementQF: {applique, avantage, plafond, irBrutSansPlafonnement}`, `null` si aucun enfant) + décote (`DECOTE_CELIBATAIRE`/`DECOTE_COUPLE`) + prélèvements sociaux fonciers (17,2% sur le résultat foncier positif uniquement). Tous les paramètres (barème, décote, plafond demi-part) **vérifiés le 2026-07-29 contre le BOFiP officiel** (BOI-IR-LIQ-20-20-20-20260407). Retourne le détail complet (`tranches[]`, `irBrut`, `decote`, `irNet`, `psFoncier`, `total`, `quotient`, `parts`) pour affichage pédagogique. Limite assumée : ne couvre que le plafonnement standard (enfants à charge), pas les plafonds spécifiques (parent isolé case T à 4 262€, invalidité, veuvage — le profil du foyer de cette app n'a que adults/children, pas ces statuts). Consommé par l'onglet Impôt (`owned-portfolio.js` → `renderOwnedImpotTab`)
- `computeRevenuFoncierPortefeuille(assets, annee, profileData, regime)` — ajouté le 2026-07-29, signature passée de `tmi` à `profileData` le 2026-08-04 : revenu foncier imposable du portefeuille pour l'onglet Impôt, càd ce qui vient réellement s'ajouter/se retrancher au revenu global du foyer selon le régime actif — micro-foncier (70% des loyers bruts, réutilise `computeCompteResultat`), réel (résultat net via `computeDeclaration2044`, déficit plafonné à 10 700€ imputable), sci-is (toujours `0`, `isTotal: null` — **volontairement pas de montant chiffré**, `computeCompteResultat` ne déduit pas l'amortissement comptable de l'immeuble pour ce régime, un total serait faux ; même prudence que `computeDeclaration2044`/`openDeclarationFiscaleModal`)
- `getHouseholdTaxParts(adults, enfants)` — nombre de parts fiscales du foyer
- `capitalRestantDu(mensualite, dateFinStr)` — capital restant dû à une date (approximation linéaire)
- `CSG_CRDS_RATE` — constante 17.2%
- `buildFinancialModel(prixNet, loyerMensuel, inputs, tmi)` — modèle financier bas niveau (exporté ; utilisé par l'outil Analyse, pas par le portefeuille depuis le 2026-07-29, voir `computeOwnedAssetCF`). Lit `inputs['assurance-mode']` mais le calcul lui-même ne varie qu'à partir de l'année 2 (voir `computeAmortizationSchedule`) — l'année 1 est identique quel que soit le mode, donc ce modèle « année 1 seule » n'a pas besoin de branche spécifique
- **`travail.financeParCredit`** (ajouté le 2026-07-29, ex. bien réel avec ~14 000€ de travaux inclus dans l'enveloppe du crédit principal) : un frais coché ainsi reste déductible fiscalement l'année de la dépense (assiette fiscale inchangée, la déductibilité ne dépend pas du mode de financement) mais n'est plus retranché du cash-flow — la mensualité rembourse déjà cette part au fil des années, le compter aussi en dépense ponctuelle le décompterait deux fois. Géré de façon cohérente dans les 4 fonctions qui recalculent les travaux indépendamment (`computeOwnedAssetTimeline`, `computeCFBreakdown`, `computeOwnedAssetCF`, `computeCompteResultat`) — vérifié par test numérique que les trois calculs de CF (liste/dashboard, décomposition Exploitation, compte de résultat) restent identiques entre eux, financé ou non. UI : case à cocher dans le formulaire d'ajout et la modale d'édition d'un frais (`owned-portfolio.js`), badge "🏦 financé" dans la liste des travaux.
- `resolveLoyerVacance(asset, moisCible = null)` — point d'entrée unique loyer/vacance consolidés, **résolution en 3 niveaux** : (1) `asset.lots[]` si présent (immeuble de rapport, un lot = `{id, nom, loyer, vacance, locataire}`) ; (2) sinon `postAchat.loyerHistorique` = `[{mois:'YYYY-MM', montant}]`, on retient la dernière entrée dont le mois est `<= moisCible` (avant la 1re prise d'effet, on retient quand même le loyer de départ) ; (3) sinon `acquisition.loyerInitial` (biens créés avant la refonte 2026-07-27, aucune migration nécessaire). `moisCible` accepte `'YYYY-MM'` ou `'YYYY'` (résolu au 31/12 de l'année) et vaut le mois courant si omis. Utilisé par `computeOwnedAssetCF`, `computeOwnedAssetTimeline` (résout **par année dans la boucle**, donc la projection reflète les évolutions de loyer), `computeCFBreakdown`, `computeRevenusLocatifsBruts`, `computeCompteResultat` — seul point à toucher si le modèle de loyer évolue encore
- `resolveRevenuFoyer(profileData, annee)` / `resolveTmiFoyer(profileData, annee)` — ajoutées le 2026-08-04 : résolvent le revenu/TMI du foyer pour une **année civile précise** depuis `profileData.revenuHistorique = [{annee, revenu}]` (même logique que `resolveLoyerFromHistorique` : dernière entrée dont `annee` est `<=` à l'année cible ; avant la première entrée, on retient quand même la première valeur connue ; sans historique, repli sur `profileData.income` — même patron que `loyerInitial`/`loyerHistorique`). Utilisées par toutes les fonctions qui reconstruisent une année fiscale précise ou une timeline multi-année (liste ci-dessous, param `profileData` au lieu d'un `tmi` figé) — pas par `computeOwnedAssetCF` (taux courant, TMI figé résolu une fois par l'appelant sur l'année courante). Voir docs/superpowers/specs/2026-08-04-revenus-historises-profil.md
- `parseDateAchat(raw)` — `{ annee, mois }` depuis `asset.dateAchat` (`'YYYY-MM'`, ajouté le 2026-07-28 pour permettre un crédit démarré en cours d'année — remplace l'ancien `asset.anneeAchat`, qui n'était qu'une année et supposait implicitement janvier). Accepte aussi une année brute (nombre/chaîne, biens antérieurs à cette évolution) résolue en janvier — **point d'entrée unique**, tout code qui lisait `asset.anneeAchat` doit passer par cette fonction. Valeur absente → année courante, janvier
- `computeOwnedAssetCF(asset, scenario, tmi)` — CF net-net mensuel **au taux courant** d'un bien détenu selon un scénario (« si ma situation actuelle se maintient, combien je touche par mois maintenant ? » — affiché partout sous « CF net-net / mois » : bannière, liste, dashboard, carte, tri, alertes). Ne proratise jamais rien sur l'année d'achat (loyer = `loyer × 12`, comme `rentaBrute`) : `creditActif`/intérêts/assurance lus directement au **mois civil courant** dans `scheduleMonthly` (pas une ligne annuelle divisée par 12 — sous-estimait l'assurance sur une année partielle, corrigé le 2026-08-03) ; DSCR = NOI/dette ; retourne `{ cfNetNet, mensualiteTotale, chargesMensuelles, impotsAnnee, loyerEffectif, rentaBrute, dscr }`. Calcule la mensualité/les intérêts **directement depuis `credit.montant`** (jamais via `buildFinancialModel`/« apport = prix − crédit » : cassait dès que le crédit finançait plus que le seul prix d'achat) et intègre les travaux de l'année (déductibles → réduisent l'impôt, cash non financés → réduisent le CF). **Distinct par conception de `computeOwnedAssetTimeline`/Vue An X** (reconstruction comptable par année civile, elle bien proratisée) : les deux peuvent légitimement afficher des montants différents l'année d'achat, ce n'est pas une divergence à corriger — voir [[project_portfolio_audit]] section 2026-08-03 pour le raisonnement complet avant de retoucher cette fonction
- `computeOwnedAssetTimeline(asset, profileData, regimeOverride)` — signature passée de `tmi` à `profileData` le 2026-08-04 : résout un TMI par année **dans la boucle** via `resolveTmiFoyer` (pas un TMI figé pour toute la timeline) — timeline CF + recettes/dépenses par an depuis l'année de `dateAchat` ; la première (et éventuellement dernière) année du crédit est proratisée au mois près si `dateAchat` n'est pas janvier (compteur `loanMonthsElapsedTotal`, corrigé le 2026-07-28 — auparavant chaque année comptait toujours 12 mois de crédit) ; **le loyer de l'année d'achat suit la même proratisation** (`moisPossedeAnnee = 13 - moisAchat`, corrigé le 2026-07-29 — auparavant `loyersAnnuels` comptait toujours 12 mois pleins dès l'année d'achat alors que le crédit démarrait bien au mois exact, surestimant le CF/recettes de l'année d'achat pour tout bien acheté après janvier) ; les travaux `tag:'deductible'` de l'année réduisent l'assiette imposable (régimes `reel`/`sci-is`, ignoré en `micro-foncier`) et sont retranchés du CF réel, les non-déductibles n'affectent que le CF (pas l'impôt) ; chaque ligne de `years[]` expose aussi les composantes brutes `loyersAnnuels`/`chargesAnneeTax`/`interetsAnnee`/`assuranceAnnee` (réutilisées par `computeDeficitFoncierHistorique` pour ne pas dupliquer la résolution loyer/charges/travaux) et `apportAnnee` (apport initial isolé, déjà inclus dans `depensesAnnee` mais pas dans `cfAnnuel` — sert à réconcilier l'affichage tabulaire, voir `renderOwnedCfTable`)
- `computeAmortizationSchedule(montant, tauxAnnuel, dureeAns, dateDebut, tauxAssurance = 0, assuranceMode = 'initial')` — plan d'amortissement `{ schedule: [{ annee, interets, capital, crdDebut, crdFin, assurance }], scheduleMonthly: [{ annee, mois, interets, capital, crdDebut, crdFin, assurance }], mensualite }`. `scheduleMonthly` (ajouté le 2026-07-29, même boucle que `schedule`, aucun changement pour les appelants qui ne déstructurent que `schedule`) donne la ligne exacte d'un mois précis — consommé par `computeCFBreakdown` pour le camembert des dépenses en vue mensuelle. `dateDebut` accepte tout ce que `parseDateAchat` comprend — la première/dernière ligne peut être une année civile partielle (< 12 mois) si le crédit ne démarre pas en janvier ; le tableau reste indexé par année civile donc `schedule.find(r => r.annee === X)` ne change pas pour les appelants. `assuranceMode: 'initial'` (défaut, rétrocompatible) = cotisation fixe sur le capital emprunté toute la durée ; `'crd'` = cotisation recalculée chaque année sur `crdDebut` (dégressive, comme les intérêts), proratisée mois par mois comme le reste sur une année partielle. Consommé par `computeOwnedAssetCF`, `computeOwnedAssetTimeline` (boucle propre, pas cette fonction), `computeCFBreakdown`, `computeEndettementGlobal`, `computeCompteResultat`, `computeSimulationTravaux` — tous lisent `credit.assuranceMode` (`owned-portfolio.js`, formulaire Crédit). Le comparateur (`buildFinancialModel`/`computeAvgCF3Y`, `inputs['assurance-mode']`) n'a besoin de ce mode qu'à partir de l'année 2 : l'année 1, CRD = capital initial, les deux modes sont identiques
- `computePatrimoineNet(asset)` — `{ valeurEstimee, crd, patrimoineNet, dateEstimation }` ; `crd` interpolé au **mois civil courant** via `scheduleMonthly` (corrigé le 2026-08-03 — lisait avant le CRD au 1er janvier de l'année en cours, sous-estimant le capital déjà remboursé pendant onze mois sur douze)
- `computeEndettementGlobal(assets, revenusMensuels, creditsHorsImmo)` — `{ totalMensualites, tauxEndettement, capaciteResiduelle, prochainCreditTermine }` — inclut les crédits hors immo actifs ; `moisRestants`/fin de crédit calculés en mois absolus depuis `dateAchat` (pas une comparaison d'années, même correctif que `computeOwnedAssetCF` pour un crédit démarré en cours d'année) ; assurance lue au mois civil courant dans `scheduleMonthly` (corrigé le 2026-08-03, même correctif que `computePatrimoineNet`)
- `computeCFBreakdown(asset, profileData, regime, targetYear, targetMonth = null)` — signature passée de `tmi` à `profileData` le 2026-08-04 (TMI de l'année ciblée, pas figé) — décomposition CF cascade : loyerBrut→vacance→charges→travaux(période)→crédit→impôts→cfNetNet (`bd.travaux` = somme des travaux datés dans `targetYear`, déductibles ou non). `bd.creditDetail = { interets, capital, assurance }` (ajouté le 2026-07-28, lu directement dans `computeAmortizationSchedule` — `mensualiteCredit = leur somme`, exact même sur une année partielle). `loyerBrut` proratisé sur l'année d'achat comme `computeOwnedAssetTimeline` (même correctif 2026-07-29, sinon `impots` — reconstruit par différence avec `row.cfAnnuel` — absorbait l'écart et affichait un impôt faux). `targetMonth` (1-12, ajouté le 2026-07-29) restreint à un seul mois : crédit lu dans `scheduleMonthly`, loyer/gestion/travaux exacts au mois (`resolveLoyerVacance(asset, 'YYYY-MM')`, date exacte des travaux), taxe foncière/PNO en 1/12 de l'annuel (pas de date d'échéance connue dans le modèle), impôts en 1/12 de l'appel récursif annuel (`computeCFBreakdown(..., null)`, pas de notion mensuelle d'imposition)
- `computeDeficitFoncierHistorique(asset, profileData)` — `{ lignes: [{ annee, montantInitial, utilise, restant, expire, expired }], stockTotal }`, ajouté le 2026-07-28 pour remplacer la saisie manuelle du tableau "Déficits fonciers reportables" (l'utilisateur ne savait pas quoi y mettre). Signature passée de `tmi` à `profileData` le 2026-08-04. Rejoue `computeOwnedAssetTimeline(asset, profileData, 'reel')` année par année (toujours en régime réel simulé, seul régime où le déficit foncier existe, même si le bien est suivi en micro-foncier/SCI-IS — même convention que le reste de l'app) ; une année déficitaire crée une ligne (hors-intérêts au-delà de 10 700€/an + intérêts en totalité, comme `computeAnnualTaxEstimate`), une année bénéficiaire consomme les lignes existantes **par ordre d'ancienneté (FIFO)**, une ligne non consommée après 10 ans est marquée `expired` et sort de `stockTotal`. Limite assumée et affichée en UI : ne connaît que l'historique saisi dans l'app depuis `dateAchat`, un déficit réel antérieur à la saisie du bien n'est pas repris. Consommé par `computePortfolioAlerts` (alerte `deficit-expire`) et `owned-portfolio.js` (affichage lecture seule, `renderAccordionPostAchat`)
- `computeRegimeComparison(asset, profileData, targetYears)` — signature passée de `tmi` à `profileData` le 2026-08-04 — `{ byRegime, optimal }` comparatif CF par régime et par année cible
- `computeCapaciteEmprunt(mensualiteMax, dureeAns, tauxPct, apport)` — `{ montantEmpruntable, prixAchatMax }` (frais notaire 8%)
- `getOptimalRegime(asset, tmi)` — `{ optimal, optimalCF, allCFs }` régime max CF net-net
- `computeRevenusLocatifsBruts(assets)` — total revenus locatifs bruts €/an (pour plafond micro-foncier 15k)
- `computeCompteResultat(asset, annee, profileData, regime)` — signature passée de `tmi` à `profileData` le 2026-08-04 (résout `resolveTmiFoyer(profileData, annee)` en interne) — compte de résultat complet de l'année `{ recettesBrutes, chargesDeductibles, resultatFoncier, impots, resultatNet, capitalRembourse, cfReel, ... }`
- `computeDeclaration2044(assets, annee, profileData)` — signature passée de `tmi` à `profileData` le 2026-08-04 — pré-remplissage indicatif déclaration 2044 (foncier réel uniquement), remappe les champs déjà calculés par `computeCompteResultat` vers les cases officielles (211/221/222/223/224/227/229/250/263/420 + répartition déficit 10 700€/report 10 ans) ; mapping sourcé sur la notice DGFiP 2044-NOT-SD éd. 2026 — voir avertissements dans `openDeclarationFiscaleModal` (owned-portfolio.js). Pas d'équivalent pour la SCI-IS (vrai formulaire = 2065, liasse comptable avec amortissement non calculé par l'app — volontairement hors périmètre, cf. message dédié)
- `computePortfolioAlerts(assets, profileData, regime, revenusMensuels)` — signature passée de `tmi` à `profileData` le 2026-08-04 (résout un TMI de l'année en cours pour les alertes CF/DSCR/régime optimal, et passe `profileData` tel quel au déficit foncier historique) — flux d'actions/alertes dynamiques toutes propriétés confondues, base du "Centre d'actions" du dashboard : CF négatif, DSCR < 1, micro-foncier > 15k, endettement, crédit qui se termine, valeur manquante, loyer inchangé depuis ≥ 12 mois d'après la dernière prise d'effet de `loyerHistorique` (`loyer-non-revise`, à vérifier IRL), déficit foncier proche des 10 ans d'expiration avec reliquat non imputé (`deficit-expire`, fenêtre `anciennete` 8-9 ans — corrigé le 2026-07-29 : allait jusqu'à 10 et annonçait "expire dans 0 an" pour une ligne déjà marquée "Expiré" dans la table `owned-portfolio.js` ; lit `computeDeficitFoncierHistorique` depuis le 2026-07-28, plus une saisie manuelle), frais/travaux au tag `a-classifier` (`travaux-a-classer`) — `severity: error|warning|info` ; la suggestion de changement de régime (`type:'fiscal-opt'`) reste en `severity: 'info'` et porte un caveat texte quand le régime optimal est `sci-is`. L'alerte `loyer-manquant` a été retirée avec le suivi mensuel (spec 2026-07-27)
- `computeSimulationTravaux(asset, montantTravaux, annee, deductible, profileData, regime)` — signature passée de `tmi` à `profileData` le 2026-08-04 (TMI de l'année simulée `annee` pour l'économie fiscale, TMI de l'année courante pour `cfBase`/taux courant) — impact CF et économie fiscale des travaux ; `loyersAnnuels` proratisé sur l'année d'achat visée par `annee` (corrigé le 2026-08-03, même formule `moisPossedeAnnee` que `computeOwnedAssetTimeline` — simule un déficit fiscal pour une année civile précise, donc sémantique comptable et non taux courant, contrairement à `computeOwnedAssetCF`)

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
- `#assurance-mode` (fieldset Financement, à côté de `#assurance`) — base de calcul de l'assurance emprunteur : `'initial'` (fixe, défaut) ou `'crd'` (dégressive sur le capital restant dû, 2026-07-28)
- Portefeuille biens détenus (dans `#collection-panel`, structure dupliquée dans `owned.html` pour l'iPhone) :
  - `#owned-auth-gate` — grille de connexion Firebase (compte unique), affichée par `_renderAuthGate()` tant que non connecté
  - `#owned-migration-banner` — bannière "Importer vers le cloud" (migration ponctuelle localStorage → Firestore), affichée par `_renderMigrationBanner()`
  - `.owned-regime-slider-label` "Régime fiscal du portefeuille" — libellé statique au-dessus du sélecteur `#owned-regime-slider-anchor` (Micro-foncier/Réel/SCI-IS)
  - `#owned-portfolio-layout` (flex, ajouté le 2026-08-04) enveloppe `#owned-quickrail` (rail Actions rapides, PC uniquement, absent de `owned.html`) + `.owned-portfolio-main` (`#owned-list-view` + `#owned-detail-view`) — voir `initOwnedQuickRail`, owned-portfolio.js. Remplace l'ancien bouton `#owned-add-btn` + modale `#owned-add-modal` comme point d'entrée unique sur PC pour ajouter un bien ; `#owned-add-modal`/`#owned-add-form`/`#owned-add-nom`/`#owned-add-ville` n'existent plus que sur `owned.html` (mobile)
  - Vue liste : `#owned-list-view`, `#owned-kpi-banner`, `#owned-list-table` — onglets `.owned-list-tabs` (ajouté le 2026-07-29) : `#owned-list-tab-overview` (contenu historique) / `#owned-list-tab-impot` → `#owned-impot-content` (rendu par `renderOwnedImpotTab`, owned-portfolio.js)
  - Vue détaillée : `#owned-detail-view`, `#owned-back-btn`, `#owned-detail-title`, `#owned-diagnostic-btn`
  - Accordéons : `#acc-acquisition`, `#acc-acquisition-body`, `#acc-acquisition-content`, `#acc-postachat`, `#acc-simulateur`
  - Onglet Travaux : `#owned-travaux-content` (rendu par `renderOwnedTravauxTab`, formulaire `[data-form="add-travail-tab"]` avec champ PDF)
  - Onglet Calcul (PC et mobile identiques depuis le 2026-08-04, remplace l'ancien onglet Projection et ses 4 graphiques, supprimés) : `#owned-calcul-top`, `#owned-cf-table-wrap`, `#owned-calcul-bottom` — rendu par `renderOwnedCalculTab`, owned-portfolio.js
  - Drawer IA : `#owned-ai-drawer`, `#owned-ai-overlay`, `#owned-ai-drawer-content`

---

## styles.css
Design system complet : tokens CSS, composants, thèmes light/dark.
- Variables root : `--bg`, `--surface`, `--accent-gold`, `--success`, `--danger`, `--warning`, `--primary-rgb`
- Thèmes : `html[data-theme='dark']` / `html[data-theme='light']`
- Composants : `.workspace`, `.panel-head`, `.variables-form`, `.verdict-*`, `.score-*`
- Piège `position: sticky` cassé : tout ancêtre avec `overflow` ≠ `visible` (même `hidden` sans scroll réel) transforme cet ancêtre en conteneur de scroll et casse le sticky des descendants — utiliser `overflow: clip` à la place (même rendu visuel, pas l'effet de bord). Déjà rencontré sur `body` (sidebar, commit `9ce4b59`) et sur `.workspace-panel` (`.analysis-sticky-summary`, `.owned-tabs`).
- `.shell--owned` (sur `owned.html` uniquement, en plus de `.shell`) : padding-top mobile réduit — le topbar d'`owned.html` tient sur une seule ligne, contrairement à celui d'`index.html` (dossier actif + actions) qui s'empile sur plusieurs lignes en dessous de 860/560px et justifie le padding-top plus grand de `.shell` seul. Piège identique repéré et corrigé le 2026-07-28 : ne jamais scoper un padding-top mobile calibré sur le topbar d'`index.html` à `.shell` seul si un autre gabarit (`owned.html`) partage la classe.
- Bloc "Ergonomie tactile iPhone" (audit UX 2026-07-29, juste après les règles `.owned-mobile-list`) : `.shell--owned .btn { min-height:44px }` + overrides dédiés (`.owned-nav-btn`, `.owned-tab`, `.owned-regime-slider__btn`, `.owned-travaux-select`) pour respecter le minimum HIG iOS de 44×44pt sur les contrôles hérités du rendu desktop (pensés pour la souris). Les icônes crayon/croix/pdf de `.owned-travaux-row` gardent leur taille visuelle mais reçoivent une zone de clic invisible élargie (`::before; inset:-6px`) — le `row-gap` de `.owned-travaux-row` (règle scopée `.shell--owned`, déjà existante pour le `grid-template-areas` du 2026-07-28) est à **12px** pour que les zones ±6px des deux lignes se rejoignent sans se chevaucher ; ne pas le réduire sans réduire l'inset en vis-à-vis.
- Zones sûres iPhone : `.shell--owned .topbar { top: max(12px, env(safe-area-inset-top)) }` et `.shell--owned { padding-bottom: max(28px, env(safe-area-inset-bottom)) }` — `owned.html` se déclare `apple-mobile-web-app-capable` (plein écran en PWA), sans quoi le bandeau/bas de page peuvent chevaucher l'encoche/Dynamic Island/barre de geste. Non vérifiable en headless (env() non simulé par Chromium/Playwright) — comportement à confirmer sur un iPhone réel.
- `.shell--owned .topbar #app-reload-btn { grid-column: 3; justify-self: end; ... }` — `.topbar` est une grille 3 colonnes pensée pour le topbar plus riche d'`index.html` ; sur `owned.html` il n'y a que `.topbar-brand` en 1re colonne, donc ce bouton doit être placé explicitement en 3e colonne pour finir aligné à droite (sinon il atterrit juste après le nom, au milieu d'une colonne large).
- Formulaire Déficits fonciers (owned.html) : `.shell--owned .owned-deficit-form { display:grid; grid-template-columns:1fr 1fr }` (règle placée **après** le bloc `@media (max-width:640px)` de `.owned-charges-form`/`.owned-charts-row`, volontairement hors de ce `@media` — la règle de base `.owned-deficit-form{display:flex}` est déclarée plus bas dans le fichier et gagnerait sur un `@media` de même spécificité placé avant elle ; le scope `.shell--owned` donne la spécificité nécessaire pour gagner quel que soit l'ordre).
- `.owned-mobile-list` / `.owned-mobile-list__item` : liste verticale tap-to-open de `owned.html` (remplace le tableau desktop `.owned-list-table` trop large pour 390-430px).
- `.shell--owned .owned-travaux-row` : variante 2 lignes/4 colonnes (`grid-template-areas`) de `.owned-travaux-row` (8 colonnes à largeurs fixes ≥ 418px sur desktop) pour ne pas déborder sur `owned.html`.
- Piège `position: sticky` variante 2 (audit UX 2026-07) : `.variables-panel`/`.form-kpi-bar` ne doivent être `position: sticky` (rail + max-height + overflow-y:auto) que sous `.workspace-board[data-layout="2"]` (vrai mode 2 colonnes) — en `data-layout="1"` (mode par défaut, colonnes empilées), les rendre sticky les laisse épinglés au-dessus de `.analysis-panel` qui défile juste en dessous et ça entre en collision avec les sticky propres à `.analysis-panel` (`.analysis-toc`, `#analysis-sticky-summary`). Toujours scoper `[data-layout="2"] <sélecteur>` avant d'ajouter un sticky dans `.workspace-board`.
- `.app-sidebar` (rail gauche, `position: sticky; top: 80px`) : ne pas lui remettre une `height`/`min-height` fixe (ex. `calc(100vh - 96px)`) — son contenu (`nav`+`mode`+`save`, tous `flex-shrink:0`) ne remplit jamais cette hauteur et ça laisse ~40% du viewport vide en bas du rail (bug UX 2026-07). Le laisser se dimensionner à son contenu.
- Scanner workspace : `.scanner-workspace-hero`, `.scanner-command-panel`, `.scanner-command-card`, `.scanner-rayon-group`, `.scanner-options-dropdown`
- Scanner table : `.scanner-dpe-badge--a/b/c/d/e/f/g`, `.scanner-price-drop`, `.scanner-dist-badge--near/mid/far`, `.scanner-freshness`, `.scanner-score-decision`
- Scanner stats : `.workspace-hero-mini-card.scanner-stat--gold/pos/warn`, `.scanner-stat--insight`
- Portefeuille biens détenus : `.owned-list-header`, `.owned-kpi-banner`, `.owned-kpi-card`, `.owned-list-table`, `.owned-add-modal` (mobile uniquement depuis le 2026-08-04), `.owned-detail-header`, `.owned-accordion`, `.owned-accordion__header[aria-expanded]`, `.owned-form-grid`, `.owned-travaux-row` (grille 7 colonnes : checkbox/date/desc/montant/tag/pdf/suppr.), `.owned-travaux-year` (`<details>` classeur par année), `.owned-notes-add`, `.owned-simulator-table`
- `.owned-portfolio-layout`/`.owned-portfolio-main`/`.owned-quickrail`/`.owned-quickrail__*` (2026-08-04, PC uniquement) — rail Actions rapides fixe (`position:sticky`) à gauche de la section Portefeuille, ~190px au repos, un panneau (`.owned-quickrail__panel`, 260px) s'ouvre sur place à droite de l'action cliquée (`.owned-quickrail:has(.owned-quickrail__panel:not([hidden])) .owned-quickrail__action:not(.owned-quickrail__action--active)` estompe les actions inactives). Repasse en ligne horizontale sous 1100px (`@media`). Réutilise `.owned-travaux-dropzone` (styles.css, section Travaux) telle quelle
- `.owned-quickfab`/`.owned-quickfab__plus` (2026-08-04, mobile uniquement) — bouton rond flottant (`position:fixed`, bas droite, respecte `env(safe-area-inset-bottom)`), équivalent mobile de l'action "Ajouter une facture" du rail PC. `#owned-quickfab-modal` réutilise directement `.owned-add-modal`/`.owned-add-modal__box` (overlay centré) plutôt qu'une classe dédiée
- `.owned-alert--info` / `.owned-dashboard-alert--info` (ton bleu, distinct de `--error`/`--warning`) — utilisé pour les suggestions d'optimisation fiscale (non des risques réels) ; `.owned-caveat` (texte italique tertiaire) pour les mises en garde inline (ex. coûts de structure SCI-IS non comptés) ; `.owned-cf-table__note` pour la note "hors apport initial"
- `.profile-income-row` / `.mode-toggle--sm` / `.profile-field__hint` — toggle mensuel/annuel du champ Revenus salariaux (profil)
- `.owned-auth-gate` (+ `__hint`, `__error`) — grille de connexion cloud (compte unique PC + iPhone), centrée, réutilise `.variables-field`/`.variables-input`/`.btn`
- Aperçu PDF : `.document-preview-overlay`, `.document-preview-dialog`, `.document-preview-embed` (overlay plein écran, `<embed>` dont le `src` est désormais une URL de téléchargement Firebase Storage résolue via `cloudDocumentUrl`)
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
