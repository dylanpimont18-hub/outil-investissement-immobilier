# Spec : Onglet Scanner intégré à l'app web

**Date :** 2026-05-25
**Statut :** Approuvé

---

## Contexte

L'app Spark Investissement est une SPA statique (index.html + main.js + calculs.js + styles.css) servie localement. Un scanner Python (`scanner/scanner.py`) scrape LeBonCoin, enrichit les annonces via Claude Haiku et envoie un rapport par email.

L'objectif est d'intégrer le scanner directement dans l'app via un troisième onglet, sans service externe ni compte supplémentaire.

---

## Ce qu'on construit

Un onglet **Scanner** dans la navigation existante, permettant de :
- Lancer un scan delta (nouvelles annonces seulement)
- Lancer un scan complet (vide le cache puis scanne tout)
- Visualiser la progression en temps réel (logs + barre)
- Consulter les résultats du dernier scan dans un tableau interactif

---

## Architecture

### Serveur Flask (`server.py`)

Remplace `python -m http.server 8080`. Installé via `pip install flask`, gratuit, aucun compte requis.

Deux responsabilités :
1. **Servir les fichiers statiques** — index.html, main.js, styles.css, calculs.js, pdf.js, ui.js, Logo_site.png — comportement identique à l'ancien serveur HTTP.
2. **Exposer l'API scanner** — 4 routes REST.

### Routes API

| Méthode | Route | Description |
|---|---|---|
| `POST` | `/api/scan` | Lance un scan delta (cache préservé) |
| `POST` | `/api/scan/full` | Vide le cache puis lance un scan complet |
| `GET` | `/api/status` | Retourne l'état courant du scanner |
| `GET` | `/api/results` | Retourne les résultats du dernier scan |

### État partagé en mémoire

```python
scan_state = {
    "running": False,
    "logs": [],          # liste de strings horodatées
    "progress": 0,       # 0–100
    "last_run": None,    # timestamp ISO
    "error": None,
}
```

Le thread scanner écrit dans cet objet. `/api/status` le sérialise en JSON. Le frontend poll toutes les 2 secondes pendant un scan actif.

### Réponse `/api/status`

```json
{
  "running": true,
  "progress": 63,
  "logs": ["[22:17:39] IA : 110/174 annonces traitées…"],
  "last_run": "2026-05-25T22:24:55"
}
```

### Réponse `/api/results`

```json
{
  "stats": { "nouvelles": 159, "positifs": 62, "pct_positifs": 39.0, "meilleur_cf": 422, "meilleur_renta": 16.2, "score_moyen": 67, "dpe_risque": 4 },
  "marche": { ... },
  "resultats": [ { "titre": "...", "prix": 89000, "cf_net": 422, ... } ]
}
```

Résultats persistés dans `scanner/results.json` à la fin de chaque scan.

---

## Modifications fichiers existants

### `scanner/scanner.py`

- Accepte deux paramètres optionnels : `full: bool` et `progress_callback: callable`.
- Quand `progress_callback` est fourni : appelle `callback(pct, log_line)` à chaque étape clé (au lieu de `print`).
- Quand lancé via l'API : ne pas envoyer d'email (paramètre `send_email=False`).
- Écrit `scanner/results.json` à la fin du scan (toujours).

### `index.html`

- Ajout d'un troisième onglet `<button class="workspace-tab" data-target="scanner-panel">Scanner</button>` dans `.workspace-tabs`.
- Ajout du panneau `<section id="scanner-panel" …>` avec le markup statique (barre de contrôle, zone de progression, zone de résultats).

### `main.js`

- Câblage du troisième onglet dans la logique de navigation existante.
- Import et initialisation du module `scanner.js`.

---

## Nouveau fichier : `scanner.js`

Module ES autonome. Responsabilités :

1. **Boutons** — écoute les clics sur "Lancer un scan", "Scan complet", "Vider le cache". Envoie `POST /api/scan` ou `POST /api/scan/full`.
2. **Polling** — quand un scan est actif, poll `/api/status` toutes les 2s. Met à jour la barre de progression et le log.
3. **Résultats** — au chargement de l'onglet et à la fin d'un scan, fetch `/api/results` et rend le tableau + les stat cards.
4. **Rendu** — fonctions pures `renderStats(stats)`, `renderTable(resultats)`, `renderProgress(state)` qui écrivent dans les conteneurs pré-déclarés du HTML.

Aucune dépendance externe. Vanilla JS ES module, cohérent avec le reste de la codebase.

---

## Démarrage

```bash
pip install flask
python server.py
# Ouvre http://localhost:8080 — identique à avant
```

---

## Ce qui ne change pas

- `calculs.js`, `pdf.js`, `ui.js`, `styles.css` — non touchés.
- Le scanner continue de fonctionner en ligne de commande (`python scanner/scanner.py`).
- L'email est toujours envoyé si le scanner est lancé en CLI directement.
- La clé API Anthropic reste dans `scanner/config.py`.
