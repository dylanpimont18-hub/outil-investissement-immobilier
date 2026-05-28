# Restructuration Desktop — Migration scanner → scraper multi-sites

**Date :** 2026-05-28  
**Statut :** Approuvé

## Contexte

Le projet Spark Investissement est une application desktop (PyWebView + Flask + PyInstaller). L'objectif initial était une web app ; l'objectif actuel est un logiciel installable Windows uniquement.

Deux modules de scraping coexistaient :
- `scanner/` — LeBonCoin mono-ville, intégré dans `server.py`
- `scraper/` — multi-sites (10 sites), multi-villes (Centre-Val de Loire), SQLite, non intégré

La décision est de migrer vers `scraper/` (plus avancé, objectif final = analyser tous les sites) et de supprimer `scanner/`.

## Fichiers supprimés

| Cible | Action |
|---|---|
| `scanner/` (dossier entier) | Supprimé — remplacé par `scraper/` |
| `build/` | Supprimé du dépôt git (artifacts PyInstaller) |
| `dist/` | Supprimé du dépôt git (binaire compilé) |

## Fichiers modifiés

### `.gitignore`
Ajouter les exclusions : `build/`, `dist/`, `__pycache__/`, `scraper/config.py`.

### `scraper/config.py` → hors git
La clé API Anthropic est actuellement commitée en clair dans `scraper/config.py`. Ce fichier est retiré du dépôt git. Un `scraper/config.example.py` (sans vraies valeurs) est créé comme modèle. **La clé API existante doit être révoquée sur console.anthropic.com.**

### `server.py`
Les routes `/api/scan`, `/api/scan/full`, `/api/status`, `/api/results` sont conservées mais rebanchées sur `scraper/main.py` au lieu de `scanner/scanner.py`. `/api/results` lit la base SQLite du scraper et renvoie du JSON. Les routes statiques restent identiques.

### `app.py`
Remplacer toutes les références à `SCANNER_DIR` / `scanner/` par `SCRAPER_DIR` / `scraper/`. La logique Flask thread + PyWebView + pystray ne change pas.

### `spark.spec`
- `pathex` : retirer `scanner`, ajouter `scraper`
- `hiddenimports` : retirer `scanner`, `leboncoin`, `marche_locatif`, `ai_enrichir`, `email_report`, `config` ; ajouter `scrapers`, `scrapers.*` (10 modules), `db`, `filtrage`, `fingerprint`, `ia`, `utils`, `bs4`, `lxml`, `lxml.etree`, `lxml.html`

### `build.bat`
Remplacer la copie de `scanner\*.py` par la copie de `scraper\*.py` et `scraper\scrapers\*.py`.

### `scanner.js` (frontend)
Ajustements mineurs si les endpoints API ou le format JSON des résultats changent lors de l'intégration du scraper.

### `CLAUDE.md`
Mettre à jour la table des fichiers et la section Architecture pour refléter `scraper/` en lieu et place de `scanner/`.

## Structure finale

```
Investissement_web/
├── app.py
├── server.py
├── spark.spec
├── build.bat
├── spark.ico
├── Logo_site.png
├── index.html
├── main.js
├── calculs.js
├── pdf.js
├── ui.js
├── scanner.js
├── styles.css
├── scraper/
│   ├── config.py          (gitignore)
│   ├── config.example.py
│   ├── main.py
│   ├── db.py
│   ├── filtrage.py
│   ├── fingerprint.py
│   ├── ia.py
│   ├── calculs.py
│   ├── utils.py
│   └── scrapers/          (10 scrapers)
├── CLAUDE.md
├── charte_graphique.txt
└── .gitignore
```

## Contraintes

- L'application reste 100 % desktop (Windows), aucun déploiement web.
- `calculs.js` doit rester une fonction pure sans DOM ni `localStorage`.
- `scraper/config.py` ne doit jamais être commité — clés API et paramètres locaux uniquement.
- La clé API Anthropic commitée dans `scraper/config.py` doit être révoquée avant tout commit.
