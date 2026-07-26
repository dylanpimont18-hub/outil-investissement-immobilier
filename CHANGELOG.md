# Changelog

Toutes les modifications notables de ce projet sont documentées dans ce fichier.

Le format est basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/),
et ce projet suit le [Semantic Versioning](https://semver.org/lang/fr/).

## [Unreleased]

### Added
- Carte du portefeuille : nouvelle section dans la vue liste des biens détenus, affichant chaque bien géocodé (marqueur vert si CF net-net positif, rouge sinon ; popup nom/ville/CF + lien vers la fiche). Nouveau champ "Adresse complète" dans l'onglet Acquisition, géocodé automatiquement à la saisie via Nominatim (`POST /api/geocode/address`, cache en table `geocodes_adresse`).
- Historique de loyer (`postAchat.loyerHistorique`) : saisie du loyer de départ avec sa date de début de location, puis une ligne par évolution (montant + mois de prise d'effet). Les projections, le CF et le compte de résultat résolvent désormais le loyer applicable à chaque année, là où le loyer était traité comme constant sur toute la durée.
- Édition d'un frais existant dans l'onglet Travaux (bouton ✏️ → modale date/description/montant/nature/commentaire). Le justificatif PDF joint reste inchangé : le remplacer demande de supprimer puis recréer le frais.
- Immeubles de rapport : gestion multi-lots (`asset.lots[]` — loyer/vacance/locataire par lot), agrégés via `resolveLoyerVacance` pour le CF consolidé et le calcul du loyer total.
- Tri du portefeuille par performance (CF net-net, rendement net, DSCR), en plus de l'ordre manuel par glisser-déposer.
- Déclaration fiscale 2044 pré-remplie (foncier réel) accessible depuis le dashboard portefeuille (`computeDeclaration2044`), avec avertissement dédié pour la SCI-IS (formulaire 2065 hors périmètre) et note pour le micro-foncier (case 4BE).
- "Centre d'actions" du dashboard portefeuille : fusion des alertes existantes avec de nouvelles alertes (loyer inchangé depuis 12 mois, déficit foncier proche de son expiration, travaux non classés), triées par sévérité.
- Toggle mensuel/annuel pour le champ "Revenus salariaux" du profil, avec conversion automatique et texte d'aide contextuel.
- `Lancer.bat` : script de lancement rapide en développement (ferme l'instance existante sur le port 8080, relance `pythonw app.py` avec le code à jour, affiche la version depuis `VERSION`).

### Changed
- Le loyer ne se saisit plus qu'à un seul endroit : l'onglet Exploitation (section Loyer). Le champ de l'onglet Acquisition devient un affichage en lecture seule du loyer résolu.
- Scraper LeBonCoin (annonces + marché locatif) : remplacement du bypass DataDome par impersonation TLS (`curl_cffi`) par un navigateur Playwright headless + `playwright-stealth` (`scraper/browser.py`, singleton partagé). Nouvelles dépendances dans `requirements.txt` (`playwright`, `playwright-stealth` — nécessite `playwright install chromium` après `pip install`).
- Refactorisation : le module "portefeuille biens détenus" est extrait de `main.js` vers `owned-portfolio.js` (CRUD, rendu liste/détail, dashboard, modals), et les helpers de formatage/échappement/toast vers `utils.js`. `main.js` ne conserve que l'Analyse, le comparateur d'études et le shell applicatif (thème, onglets, sync cross-fenêtres).
- Tableau des flux de trésorerie annuels (`renderOwnedCfTable`) : l'apport initial est isolé de la colonne Dépenses (badge "+ apport" séparé) pour que Recettes − Dépenses corresponde toujours au CF annuel affiché sur chaque ligne.

### Removed
- Suivi mensuel des loyers encaissés (tableau mois/statut encaissé-impayé-vacant-partiel, `postAchat.loyersReels`), remplacé par l'historique de loyer. Sont retirés avec lui la carte "Trésorerie réelle" de la synthèse d'un bien (`computeTresorerieReelle`, qui n'en dérivait) et l'alerte "Loyer du mois non saisi", devenue sans objet.

### Fixed
- Carte du scanner : elle appelait `POST /api/geocode/batch`, route supprimée par erreur en juin 2026 au motif qu'elle n'était « jamais appelée depuis le frontend ». Tous les biens y ressortaient donc « non localisés ». La route est recréée (cache en table `geocodes`, débit Nominatim respecté).
- Doublons UI relevés lors de l'audit UX de juillet 2026 : mini-cartes Rendement/CF/DSCR répétées dans le bloc "Économie du deal", récapitulatif profil répété dans "Décision d'exploitation", graphique CF portefeuille dessiné deux fois, tuiles Rendement/DSCR redondantes dans les vues "An 1/3/5/10".
- Sticky cassé (variante 2) : `.variables-panel`/`.form-kpi-bar` ne sont plus rendus `position: sticky` en dehors du vrai mode 2 colonnes (`data-layout="2"`), ce qui entrait en collision avec les sticky propres à l'Analyse en mode colonnes empilées.
- `.app-sidebar` : la hauteur minimale fixe forcée laissait jusqu'à ~40% du rail vide en bas ; elle se dimensionne désormais à son contenu.

## [1.0.0] - 2026-07-26

### Added
- Fichier `VERSION` (source de vérité unique), exposé via `/api/version` et affiché dans la topbar.
- `spark.spec` / `build.bat` nomment désormais l'exécutable de sortie `Spark-<version>.exe` d'après `VERSION`.
- `build.bat` génère en fin de build une archive versionnée `Spark-<version>.zip` du dossier `Spark/` (voir note ci-dessous sur le choix zip vs. installeur).
- `verify.bat` : lance `pytest tests/` puis les tests JS (`test_frais_fiscalite.mjs`, `test_regimes_fiscaux.mjs`), s'arrête net au premier échec. `build.bat` l'appelle en première étape et abandonne le build si un test échoue.

### Fixed
- Isolation des tests Python : `tests/test_calculs_py.py` laissait un stub `sys.modules['config']` incomplet après son import, ce qui faisait échouer `tests/test_enrich.py` uniquement quand la suite complète tournait (jamais en exécution isolée).
- `server.py` : la requête de listing des biens (`_query_results_data`) référençait l'alias externe `b.prix` dans le `ORDER BY` d'une sous-requête corrélée, ce que SQLite rejette (`no such column: b.prix`) même si la même référence est valide dans le `WHERE`/`SELECT` de cette sous-requête. Découvert en fiabilisant `pytest tests/` pour `verify.bat`.

### Note — zip versionné plutôt qu'un installeur
Un vrai installeur (Inno Setup) demanderait d'installer et maintenir un outil supplémentaire, un script `.iss` séparé à tenir à jour à chaque release, et n'apporte rien pour une app 100% locale sans auto-update et sans besoin d'un assistant d'installation Windows (pas de clé de registre, pas de désinstalleur à fournir). Un zip versionné du dossier `Spark/` est suffisant : décompresser et lancer `Spark-<version>.exe` fait le travail, avec un seul point de maintenance (`build.bat`).
