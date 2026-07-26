# Changelog

Toutes les modifications notables de ce projet sont documentées dans ce fichier.

Le format est basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/),
et ce projet suit le [Semantic Versioning](https://semver.org/lang/fr/).

## [Unreleased]

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
