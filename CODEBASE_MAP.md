# CODEBASE MAP
> Index de navigation — mis à jour à chaque session. Ne pas modifier manuellement.
> Format : rôle + fonctions/exports clés pour savoir où écrire sans lire le fichier entier.

---

## app.py
Entrée desktop : lance Flask en thread (`threaded=True`) + fenêtre PyWebView + icône barre système.
Pas de fonctions exportées — exécuté directement par `python app.py` ou PyInstaller.

---

## server.py
Serveur Flask : sert les fichiers statiques + API scraper + diagnostic IA + export PDF.
- `api_scan` POST — lance scan partiel sur une ville ; accepte `{ville, code_postal, rayon_km}`
- `api_scan_full` POST — réinitialise DB puis scan complet ; même body que `api_scan`
- `_run_scanner(full, ville, code_postal, rayon_km)` — thread worker : inject `rayon_km` dans `villes_override`
- `_query_results_data(conn, ...)` — SELECT biens + jointure annonces + sous-requêtes `baisse`/`date_baisse` (historique_prix)
- `api_enrich` POST — déclenche enrichissement IA des biens
- `api_status` GET — statut du scan en cours (progress, logs)
- `api_results` GET — liste paginée des biens avec stats
- `api_bien_detail` GET — détails complets d'un bien + analyses
- `api_pending_count` GET — nombre de biens en attente d'enrichissement
- `api_communes` GET — communes par code postal
- `api_portfolio_diagnostic` POST `/api/portfolio-diagnostic` — accepte `{ bien: {...} }` (bien unique), retourne 3-5 recommandations JSON via Claude API
- `api_generate_pdf` POST `/api/generate-pdf` — génère un PDF via Edge headless, sauvegarde dans ~/Downloads, retourne `{saved_to, filename}`
- `pdf_preview` GET `/api/pdf-preview/<token>` — sert le HTML une seule fois pour la capture Edge headless

---

## main.js
Orchestration UI complète : état, rendu, sync multi-fenêtres, routing des panels.
- `sanitizeVariablesData()` — valide et normalise les inputs du formulaire (inclut `annee-achat`)
- `render()` — rendu principal de l'interface
- `loadVariablesData()` / `loadProfileData()` — charge état depuis localStorage
- `emitStateUpdate()` — synchronise l'état cross-tabs via BroadcastChannel
- `setupCrossWindowSync()` — écoute BroadcastChannel + storage events
- `openAnalysisWindow()` — ouvre le panneau analyse en fenêtre séparée
- `openAssetDetailDrawer()` — panneau latéral détail d'un bien
- `renderGuidedStep(idx)` — rendu mode guidé étape par étape
- `renderModeSwitch(mode)` — bascule guidé / complet
- `showToast(msg)` — notification temporaire
- `createAssetId()` — génère un ID unique pour une étude
- `getPanelMode()` — détecte si on est dans la vue analysis ou workspace
- Portfolio biens détenus (`STORAGE_KEYS.ownedAssets` = `investissementWebOwnedAssets`) :
  - `loadOwnedAssets()` / `saveOwnedAssets()` / `createOwnedAsset(nom, ville)` / `getOwnedAsset(id)` / `updateOwnedAsset(id, patch)` / `deleteOwnedAsset(id)` — CRUD biens
  - `updateOwnedAcquisition(id, patch)` / `updateOwnedCredit(id, patch)` / `updateOwnedPostAchat(id, patch)` — patch sous-objets
  - `addOwnedTravail(assetId, travail)` / `deleteOwnedTravail(assetId, travailId)` — CRUD travaux
  - `addOwnedNote(assetId, text)` — ajout note horodatée
  - `addOwnedScenario(assetId)` / `updateOwnedScenarioVar(assetId, scenarioId, key, val)` / `updateOwnedScenarioNom(assetId, scenarioId, nom)` / `deleteOwnedScenario(assetId, scenarioId)` — CRUD scénarios
  - `renderCollections()` — dispatcher vue liste ↔ vue détaillée
  - `renderOwnedPortfolioList()` — liste biens + KPIs consolidés + état vide
  - `openOwnedDetail(assetId)` / `closeOwnedDetail()` — navigation vue liste ↔ vue détaillée
  - `renderOwnedDetail()` — header fiche + câblage accordéons
  - `renderAccordionAcquisition(asset)` — formulaire données figées + crédit
  - `renderAccordionPostAchat(asset)` — charges, travaux CRUD, notes
  - `renderAccordionSimulateur(asset)` — matrice scénarios avec CF net-net recalculé
  - `callOwnedDiagnosticIA(assetId)` — appel `POST /api/portfolio-diagnostic` + drawer résultat
  - `initOwnedPortfolioEvents()` — câblage des events du portefeuille (modal ajout, retour, IA, drawer)

---

## calculs.js
Moteur financier pur — zéro DOM. Tous les calculs, toutes les fiscalités.
- `computeAnalysisViewModel(inputs)` — **point d'entrée principal** : retourne tout le VM analyse
- `computeCF(prixVendeur, loyer, inputs, tmi)` — cash-flow brut + net + net-net
- `computeProjectMetrics(inputs)` — KPIs par actif (rentaBrute, rentaNette, DSCR, GRM, CoC…)
- `computePortfolioViewModel(assets, profile, activeId, refInputs)` — synthèse portefeuille consolidée
- `computeResaleTimeline(...)` — projection plus-value à la revente
- `calculateTMI(revenus, foyer)` — calcul tranche marginale d'imposition
- `getHouseholdTaxParts(adults, enfants)` — nombre de parts fiscales du foyer
- `capitalRestantDu(mensualite, dateFinStr)` — capital restant dû à une date
- `CSG_CRDS_RATE` — constante 17.2%
- `buildFinancialModel(prixNet, loyerMensuel, inputs, tmi)` — modèle financier bas niveau (exporté ; utilisé par `computeOwnedAssetCF`)
- `computeOwnedAssetCF(asset, scenario, tmi)` — CF net-net mensuel d'un bien détenu selon un scénario ; retourne `{ cfNetNet, mensualiteTotale, chargesMensuelles, impotsAnnee, loyerEffectif, rentaBrute, dscr }`

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
- Formulaires : `#variables-form`, `#profile-form`, `#profile-modal`
- Zones de rendu : `#analysis-sticky-summary`, `#analysis-metrics`
- Champ optionnel : `#annee-achat` (dans fieldset Identité — active les conseils temporels)
- Portefeuille biens détenus (dans `#collection-panel`) :
  - Vue liste : `#owned-list-view`, `#owned-kpi-banner`, `#owned-list-table`, `#owned-add-btn`
  - Modal ajout : `#owned-add-modal`, `#owned-add-form`, `#owned-add-nom`, `#owned-add-ville`
  - Vue détaillée : `#owned-detail-view`, `#owned-back-btn`, `#owned-detail-title`, `#owned-diagnostic-btn`
  - Accordéons : `#acc-acquisition`, `#acc-acquisition-body`, `#acc-acquisition-content`, `#acc-postachat`, `#acc-simulateur`
  - Drawer IA : `#owned-ai-drawer`, `#owned-ai-overlay`, `#owned-ai-drawer-content`

---

## styles.css
Design system complet : tokens CSS, composants, thèmes light/dark.
- Variables root : `--bg`, `--surface`, `--accent-gold`, `--success`, `--danger`, `--warning`, `--primary-rgb`
- Thèmes : `html[data-theme='dark']` / `html[data-theme='light']`
- Composants : `.workspace`, `.panel-head`, `.variables-form`, `.verdict-*`, `.score-*`
- Scanner workspace : `.scanner-workspace-hero`, `.scanner-command-panel`, `.scanner-command-card`, `.scanner-rayon-group`, `.scanner-options-dropdown`
- Scanner table : `.scanner-dpe-badge--a/b/c/d/e/f/g`, `.scanner-price-drop`, `.scanner-dist-badge--near/mid/far`, `.scanner-freshness`, `.scanner-score-decision`
- Scanner stats : `.workspace-hero-mini-card.scanner-stat--gold/pos/warn`, `.scanner-stat--insight`
- Portefeuille biens détenus : `.owned-list-header`, `.owned-kpi-banner`, `.owned-kpi-card`, `.owned-list-table`, `.owned-add-modal`, `.owned-detail-header`, `.owned-accordion`, `.owned-accordion__header[aria-expanded]`, `.owned-form-grid`, `.owned-travaux-row`, `.owned-notes-add`, `.owned-simulator-table`
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
- `main(progress_callback, villes_override)` — scrape → filtre → IA → stockage SQLite
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

## scraper/scrapers/leboncoin.py
Scraper LeBonCoin via parsing `__NEXT_DATA__` avec pagination.
- `LeBonCoinScraper` — `fetch_ville(ville)`, `_fetch_page(loc_param, page)` ; si `ville.get("rayon_km")`, construit `locations={cp}__{rayon_m}` dans l'URL
