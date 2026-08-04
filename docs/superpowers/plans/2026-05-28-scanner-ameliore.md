# Scanner Immobilier Amélioré — Plan d'Implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Améliorer la qualité des données du scanner (loyers de marché réels, 3 régimes fiscaux) et enrichir l'interface (panneau de détail, sélecteur CP avec pré-complétion, carte géographique).

**Architecture:** Pipeline data-first — (1) scraper de locations → loyers médians mis en cache dans SQLite, (2) calculs financiers avec 3 régimes fiscaux (micro-foncier, réel, SCI-IS), (3) nouveaux endpoints Flask, (4) UI enrichie côté scanner.js.

**Tech Stack:** Python/SQLite (backend), Flask (API), curl_cffi (scraping), JavaScript ES modules (frontend), Leaflet.js + OpenStreetMap (carte), Nominatim (géocodage), pytest (tests).

---

## File Map

| Fichier | Action | Rôle |
|---|---|---|
| `scraper/db.py` | Modifier | +2 tables (`loyers_marche`, `geocodes`), +4 colonnes dans `annonces` |
| `scraper/marche_locatif.py` | Créer | Scraping locations + calcul médianes + cache TTL 30j |
| `scraper/calculs.py` | Modifier | Loyer de marché + 3 régimes fiscaux + `conn` en paramètre |
| `scraper/main.py` | Modifier | Appel marché locatif avant le scan, passer `conn` à `enrichir` |
| `server.py` | Modifier | Endpoints `/api/communes`, `/api/bien/historique`, `/api/geocode/batch`, champ `bien_id` dans résultats |
| `data/communes_centre_val.json` | Créer | CP → liste de communes (Centre-Val de Loire, statique) |
| `scripts/generate_communes.py` | Créer | Script one-shot pour générer `communes_centre_val.json` |
| `scanner.js` | Modifier | Sélecteur CP, panneau de détail (drawer), carte Leaflet |
| `index.html` | Modifier | Onglets Tableau/Carte, structure HTML drawer |
| `tests/test_calculs.py` | Créer | Tests 3 régimes fiscaux |
| `tests/test_marche_locatif.py` | Créer | Tests `calculer_medianes()` |

---

## Task 1 : Extensions du schéma SQLite

**Files:**
- Modify: `scraper/db.py`
- Create: `tests/test_db_migration.py`

- [ ] **Step 1 : Écrire le test de migration**

```python
# tests/test_db_migration.py
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "scraper"))

from db import init_db, get_connection


def test_loyers_marche_table_exists(tmp_path):
    conn = init_db(tmp_path / "test.db")
    conn.execute("INSERT INTO loyers_marche (ville, code_postal, type_bien, surface_min, surface_max, loyer_median, nb_annonces, date_collecte) VALUES ('Bourges', '18000', 'appartement', 30, 50, 550.0, 5, '2026-01-01')")
    conn.commit()
    row = conn.execute("SELECT loyer_median FROM loyers_marche WHERE ville='Bourges'").fetchone()
    assert row["loyer_median"] == 550.0
    conn.close()


def test_geocodes_table_exists(tmp_path):
    conn = init_db(tmp_path / "test.db")
    conn.execute("INSERT INTO geocodes (ville, code_postal, lat, lng) VALUES ('Bourges', '18000', 47.08, 2.39)")
    conn.commit()
    row = conn.execute("SELECT lat FROM geocodes WHERE ville='Bourges'").fetchone()
    assert abs(row["lat"] - 47.08) < 0.01
    conn.close()


def test_annonces_new_columns(tmp_path):
    conn = init_db(tmp_path / "test.db")
    cols = [r[1] for r in conn.execute("PRAGMA table_info(annonces)").fetchall()]
    assert "cf_apres_impot_reel" in cols
    assert "cf_apres_impot_sci"  in cols
    assert "regime_optimal"      in cols
    assert "loyer_source"        in cols
    conn.close()
```

- [ ] **Step 2 : Vérifier que le test échoue**

```bash
cd c:\Users\Dylan\Desktop\Creation_site\Investissement_web
python -m pytest tests/test_db_migration.py -v
```
Attendu : FAILED — tables/colonnes absentes.

- [ ] **Step 3 : Mettre à jour `scraper/db.py`**

Remplacer le contenu de `_SCHEMA` et ajouter la fonction `migrate_db` :

```python
"""Initialisation et connexion à la base SQLite."""

import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "biens.db"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS biens (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    fingerprint        TEXT    UNIQUE NOT NULL,
    site               TEXT    NOT NULL,
    url                TEXT    UNIQUE NOT NULL,
    titre              TEXT,
    prix               INTEGER,
    surface            REAL,
    type_bien          TEXT,
    ville              TEXT,
    code_postal        TEXT,
    dpe                TEXT,
    source_scrape      TEXT,
    date_premiere_vue  TEXT    NOT NULL,
    date_derniere_vue  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS annonces (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    bien_id               INTEGER NOT NULL REFERENCES biens(id) ON DELETE CASCADE,
    nb_pieces             INTEGER,
    travaux               INTEGER,
    travaux_montant       REAL,
    immeuble_rapport      INTEGER,
    deja_loue             INTEGER,
    loyer_actuel          REAL,
    lots_total            INTEGER,
    lots_loues            INTEGER,
    charges_copro         REAL,
    taxe_fonciere         REAL,
    meuble                INTEGER,
    parking_garage        INTEGER,
    chauffage             TEXT,
    points_forts          TEXT,
    points_faibles        TEXT,
    resume_ia             TEXT,
    loyer_estime          REAL,
    mensualite            REAL,
    cf_net                REAL,
    cf_apres_impot        REAL,
    cf_apres_impot_reel   REAL,
    cf_apres_impot_sci    REAL,
    regime_optimal        TEXT,
    loyer_source          TEXT,
    renta_brute           REAL,
    renta_nette_nette     REAL,
    dscr                  REAL,
    score                 INTEGER,
    date_enrichissement   TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS historique_prix (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    bien_id          INTEGER NOT NULL REFERENCES biens(id) ON DELETE CASCADE,
    prix_ancien      INTEGER NOT NULL,
    prix_nouveau     INTEGER NOT NULL,
    date_changement  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS loyers_marche (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    ville         TEXT    NOT NULL,
    code_postal   TEXT    NOT NULL,
    type_bien     TEXT    NOT NULL,
    surface_min   REAL    NOT NULL,
    surface_max   REAL    NOT NULL,
    loyer_median  REAL    NOT NULL,
    nb_annonces   INTEGER NOT NULL,
    date_collecte TEXT    NOT NULL,
    UNIQUE(ville, code_postal, type_bien, surface_min, surface_max)
);

CREATE TABLE IF NOT EXISTS geocodes (
    ville       TEXT NOT NULL,
    code_postal TEXT NOT NULL,
    lat         REAL,
    lng         REAL,
    PRIMARY KEY (ville, code_postal)
);

CREATE INDEX IF NOT EXISTS idx_biens_fingerprint ON biens(fingerprint);
CREATE INDEX IF NOT EXISTS idx_biens_url         ON biens(url);
CREATE INDEX IF NOT EXISTS idx_biens_cp          ON biens(code_postal);
CREATE INDEX IF NOT EXISTS idx_biens_dept        ON biens(substr(code_postal, 1, 2));
CREATE INDEX IF NOT EXISTS idx_annonces_bien     ON annonces(bien_id);
CREATE INDEX IF NOT EXISTS idx_historique_bien   ON historique_prix(bien_id);
CREATE INDEX IF NOT EXISTS idx_loyers_marche     ON loyers_marche(ville, type_bien, surface_min);
"""

_MIGRATIONS = [
    "ALTER TABLE annonces ADD COLUMN cf_apres_impot_reel REAL",
    "ALTER TABLE annonces ADD COLUMN cf_apres_impot_sci  REAL",
    "ALTER TABLE annonces ADD COLUMN regime_optimal      TEXT",
    "ALTER TABLE annonces ADD COLUMN loyer_source        TEXT",
]


def get_connection(db_path: Path | None = None) -> sqlite3.Connection:
    conn = sqlite3.connect(str(db_path or DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db(db_path: Path | None = None) -> sqlite3.Connection:
    """Crée le schéma si nécessaire et applique les migrations. Retourne la connexion."""
    conn = get_connection(db_path)
    conn.executescript(_SCHEMA)
    conn.commit()
    _apply_migrations(conn)
    return conn


def _apply_migrations(conn: sqlite3.Connection) -> None:
    """Applique les ALTER TABLE en ignorant les erreurs si la colonne existe déjà."""
    for sql in _MIGRATIONS:
        try:
            conn.execute(sql)
            conn.commit()
        except Exception:
            pass  # colonne déjà présente
```

- [ ] **Step 4 : Relancer le test**

```bash
python -m pytest tests/test_db_migration.py -v
```
Attendu : 3 PASSED.

- [ ] **Step 5 : Commit**

```bash
git add scraper/db.py tests/test_db_migration.py
git commit -m "feat(db): add loyers_marche, geocodes tables and 4 new annonces columns"
```

---

## Task 2 : Module `scraper/marche_locatif.py`

**Files:**
- Create: `scraper/marche_locatif.py`
- Create: `tests/test_marche_locatif.py`

- [ ] **Step 1 : Écrire les tests**

```python
# tests/test_marche_locatif.py
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "scraper"))

from marche_locatif import calculer_medianes, est_stale, TRANCHES


def test_calculer_medianes_basic():
    annonces = [
        {"loyer": 500, "surface": 45, "type_bien": "appartement", "ville": "Bourges", "code_postal": "18000"},
        {"loyer": 520, "surface": 48, "type_bien": "appartement", "ville": "Bourges", "code_postal": "18000"},
        {"loyer": 510, "surface": 42, "type_bien": "appartement", "ville": "Bourges", "code_postal": "18000"},
    ]
    result = calculer_medianes(annonces)
    assert len(result) == 1
    assert result[0]["ville"] == "Bourges"
    assert result[0]["type_bien"] == "appartement"
    assert result[0]["surface_min"] == 30
    assert result[0]["surface_max"] == 50
    assert result[0]["loyer_median"] == 510.0
    assert result[0]["nb_annonces"] == 3


def test_calculer_medianes_filtre_min_annonces():
    annonces = [
        {"loyer": 500, "surface": 45, "type_bien": "appartement", "ville": "X", "code_postal": "18000"},
        {"loyer": 520, "surface": 48, "type_bien": "appartement", "ville": "X", "code_postal": "18000"},
    ]
    result = calculer_medianes(annonces)
    assert len(result) == 0  # moins de 3 annonces → pas de médiane


def test_calculer_medianes_filtre_aberrations():
    annonces = [
        {"loyer": 50,   "surface": 45, "type_bien": "appartement", "ville": "X", "code_postal": "18000"},
        {"loyer": 6000, "surface": 45, "type_bien": "appartement", "ville": "X", "code_postal": "18000"},
        {"loyer": 500,  "surface": 45, "type_bien": "appartement", "ville": "X", "code_postal": "18000"},
    ]
    result = calculer_medianes(annonces)
    assert len(result) == 0  # seulement 1 loyer valide sur 3 → < MIN_ANNONCES


def test_calculer_medianes_deux_segments():
    annonces = [
        {"loyer": 400, "surface": 25, "type_bien": "appartement", "ville": "Vierzon", "code_postal": "18100"},
        {"loyer": 410, "surface": 28, "type_bien": "appartement", "ville": "Vierzon", "code_postal": "18100"},
        {"loyer": 405, "surface": 27, "type_bien": "appartement", "ville": "Vierzon", "code_postal": "18100"},
        {"loyer": 600, "surface": 55, "type_bien": "appartement", "ville": "Vierzon", "code_postal": "18100"},
        {"loyer": 620, "surface": 58, "type_bien": "appartement", "ville": "Vierzon", "code_postal": "18100"},
        {"loyer": 610, "surface": 52, "type_bien": "appartement", "ville": "Vierzon", "code_postal": "18100"},
    ]
    result = calculer_medianes(annonces)
    assert len(result) == 2
    tranches = [(r["surface_min"], r["surface_max"]) for r in result]
    assert (0, 30) in tranches
    assert (50, 70) in tranches


def test_est_stale_sans_donnees(tmp_path):
    import sqlite3
    from db import init_db
    conn = init_db(tmp_path / "test.db")
    assert est_stale(conn) is True
    conn.close()
```

- [ ] **Step 2 : Vérifier que les tests échouent**

```bash
python -m pytest tests/test_marche_locatif.py -v
```
Attendu : FAILED — module introuvable.

- [ ] **Step 3 : Créer `scraper/marche_locatif.py`**

```python
"""
Analyse du marché locatif — scrape les annonces de LOCATION
pour calculer des loyers médians par (ville × type_bien × tranche de surface).
Cache dans la table loyers_marche (TTL 30 jours).
"""

import statistics
import time
from datetime import datetime, timedelta

from curl_cffi import requests as crequests

TRANCHES = [(0, 30), (30, 50), (50, 70), (70, 100), (100, 9999)]
TTL_JOURS = 30
MIN_ANNONCES = 3


def est_stale(conn, ttl_jours: int = TTL_JOURS) -> bool:
    """True si les données de marché sont absentes ou plus vieilles que ttl_jours."""
    row = conn.execute("SELECT MAX(date_collecte) FROM loyers_marche").fetchone()
    if not row or not row[0]:
        return True
    try:
        date = datetime.fromisoformat(row[0])
        return datetime.now() - date > timedelta(days=ttl_jours)
    except Exception:
        return True


def calculer_medianes(annonces: list[dict]) -> list[dict]:
    """
    Groupe les annonces par (ville, code_postal, type_bien, tranche_surface)
    et calcule le loyer médian pour chaque segment.
    Nécessite au moins MIN_ANNONCES annonces par segment.
    """
    from collections import defaultdict
    buckets: dict[tuple, list[float]] = defaultdict(list)

    for a in annonces:
        loyer    = a.get("loyer")
        surface  = a.get("surface")
        type_b   = a.get("type_bien")
        ville    = a.get("ville")
        cp       = a.get("code_postal")
        if not all([loyer, surface, type_b, ville, cp]):
            continue
        if loyer < 100 or loyer > 5000:
            continue
        for s_min, s_max in TRANCHES:
            if s_min <= surface < s_max:
                buckets[(ville, cp, type_b, s_min, s_max)].append(float(loyer))
                break

    result = []
    now = datetime.now().isoformat(timespec="seconds")
    for (ville, cp, type_b, s_min, s_max), loyeurs in buckets.items():
        if len(loyeurs) >= MIN_ANNONCES:
            result.append({
                "ville":         ville,
                "code_postal":   cp,
                "type_bien":     type_b,
                "surface_min":   s_min,
                "surface_max":   s_max,
                "loyer_median":  round(statistics.median(loyeurs), 0),
                "nb_annonces":   len(loyeurs),
                "date_collecte": now,
            })
    return result


def sauvegarder_medianes(medianes: list[dict], conn) -> int:
    """INSERT OR REPLACE dans loyers_marche. Retourne le nombre de lignes sauvegardées."""
    n = 0
    for m in medianes:
        conn.execute("""
            INSERT OR REPLACE INTO loyers_marche
            (ville, code_postal, type_bien, surface_min, surface_max,
             loyer_median, nb_annonces, date_collecte)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (m["ville"], m["code_postal"], m["type_bien"],
              m["surface_min"], m["surface_max"],
              m["loyer_median"], m["nb_annonces"], m["date_collecte"]))
        n += 1
    conn.commit()
    return n


# ── Scrapers location ─────────────────────────────────────────────────────────
# LeBonCoin : category=9 pour les ventes, category=10 pour les locations.
# La structure __NEXT_DATA__ est identique — seul le paramètre category change.

def _parse_leboncoin_ad(ad, ville: dict) -> dict | None:
    """Parse un ad JSON LeBonCoin (même structure que LeBonCoinScraper._parse)."""
    import re
    attrs = ad.get("attributes", [])

    def _attr(key):
        for a in attrs:
            if a.get("key") == key:
                return a.get("value", "")
        return ""

    price_list = ad.get("price", [])
    if not price_list:
        return None
    loyer = price_list[0]

    surface_str = _attr("square")
    try:
        surface = float(surface_str) if surface_str else None
    except (ValueError, TypeError):
        surface = None
    if not surface or surface <= 0:
        return None

    type_label = (_attr("real_estate_type") or "").lower()
    _APT = ("appartement", "loft", "studio", "duplex", "triplex")
    _MAI = ("maison", "villa", "château", "manoir", "pavillon")
    if any(t in type_label for t in _APT):
        type_bien = "appartement"
    elif any(t in type_label for t in _MAI):
        type_bien = "maison"
    else:
        return None

    loc = ad.get("location", {})
    return {
        "loyer":        float(loyer),
        "surface":      surface,
        "type_bien":    type_bien,
        "ville":        loc.get("city_label") or loc.get("city") or ville["ville"],
        "code_postal":  loc.get("zipcode") or ville["code_postal"],
    }


def _fetch_leboncoin_locations(villes: list[dict], session) -> list[dict]:
    """Scrape leboncoin.fr/locations (category=10) pour chaque ville."""
    import json, re
    _NEXT_DATA = re.compile(
        r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>',
        re.DOTALL,
    )
    result = []
    for ville in villes:
        cp = ville["code_postal"]
        for page in range(1, 6):  # max 5 pages
            url = f"https://www.leboncoin.fr/recherche?category=10&locations={cp}&page={page}"
            try:
                r = session.get(url, timeout=30)
                r.raise_for_status()
                m = _NEXT_DATA.search(r.text)
                if not m:
                    break
                data = json.loads(m.group(1))
                sd   = data.get("props", {}).get("pageProps", {}).get("searchData", {})
                ads  = sd.get("ads", [])
                if not ads:
                    break
                for ad in ads:
                    parsed = _parse_leboncoin_ad(ad, ville)
                    if parsed:
                        result.append(parsed)
                if page >= sd.get("max_pages", 1):
                    break
                time.sleep(1)
            except Exception as e:
                print(f"  [Marché/LBC] {ville['ville']} p{page} : {e}")
                break
        time.sleep(0.5)
    return result


def _fetch_pap_locations(villes: list[dict], session) -> list[dict]:
    """Scrape api.pap.fr/annonce/recherche pour les locations."""
    _API = "https://api.pap.fr/annonce/recherche"
    _HEADERS = {
        "Accept":     "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    }
    result = []
    for ville in villes:
        page = 1
        while page <= 5:
            params = {
                "categorie":              "location-appartement,location-maison",
                "geo_objets_ids":         ville["code_postal"],
                "recherche[geo][region]": "centre-val-de-loire",
                "page":                   page,
                "nb_by_page":             20,
            }
            try:
                r    = session.get(_API, headers=_HEADERS, params=params, timeout=30)
                data = r.json()
            except Exception as e:
                print(f"  [Marché/PAP] {ville['ville']} p{page} : {e}")
                break

            items = data.get("annonces") or []
            if not items:
                break

            for item in items:
                loyer   = item.get("prix")
                surface = item.get("surface")
                cat     = item.get("categorie", "").lower()
                if not loyer or not surface:
                    continue
                type_bien = "appartement" if "appartement" in cat else "maison" if "maison" in cat else None
                if not type_bien:
                    continue
                result.append({
                    "loyer":       float(loyer),
                    "surface":     float(surface),
                    "type_bien":   type_bien,
                    "ville":       item.get("ville") or ville["ville"],
                    "code_postal": item.get("cp")   or ville["code_postal"],
                })

            if page >= data.get("nb_pages", 1):
                break
            page += 1
            time.sleep(1)
        time.sleep(0.5)
    return result


def main(conn, progress_callback=None):
    """Scrape les locations, calcule les médianes, sauvegarde en cache."""
    def _emit(pct, msg):
        print(f"  [Marché] {msg}")
        if progress_callback:
            progress_callback(pct, msg)

    try:
        from config import VILLES
    except ImportError:
        _emit(100, "config.py introuvable — marché locatif ignoré.")
        return

    session = crequests.Session(impersonate="chrome124")
    toutes: list[dict] = []

    _emit(5, "LeBonCoin locations…")
    lbc = _fetch_leboncoin_locations(VILLES, session)
    toutes.extend(lbc)
    _emit(40, f"  LeBonCoin : {len(lbc)} annonces")

    _emit(45, "PAP locations…")
    pap = _fetch_pap_locations(VILLES, session)
    toutes.extend(pap)
    _emit(80, f"  PAP : {len(pap)} annonces — total : {len(toutes)}")

    medianes = calculer_medianes(toutes)
    _emit(90, f"  {len(medianes)} segments de marché calculés")

    n = sauvegarder_medianes(medianes, conn)
    _emit(100, f"  {n} médianes sauvegardées.")
```

- [ ] **Step 4 : Relancer les tests**

```bash
python -m pytest tests/test_marche_locatif.py -v
```
Attendu : 5 PASSED.

- [ ] **Step 5 : Commit**

```bash
git add scraper/marche_locatif.py tests/test_marche_locatif.py
git commit -m "feat(scraper): add marche_locatif module — rental scraping + median cache"
```

---

## Task 3 : Calculs financiers — 3 régimes fiscaux + loyer de marché

**Files:**
- Modify: `scraper/calculs.py`
- Create: `tests/test_calculs.py`

- [ ] **Step 1 : Écrire les tests**

```python
# tests/test_calculs.py
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "scraper"))

from calculs import (
    _mensualite, _interets_annee1,
    _cf_micro_foncier, _cf_reel_foncier, _cf_sci_is,
)


def test_mensualite_basique():
    # 100 000 € sur 20 ans à 3.35% + 0.30% assurance
    m = _mensualite(100_000, 3.35, 0.30, 240)
    assert 560 < m < 600  # ~578 €/mois


def test_interets_annee1():
    # Sur 100 000 € à 3.35%, les intérêts année 1 ≈ 3 200 €
    i = _interets_annee1(100_000, 3.35, 240)
    assert 3000 < i < 3500


def test_cf_micro_foncier_loyer_eleve():
    # Loyer élevé → CF positif
    cf = _cf_micro_foncier(
        loyer=700, mensualite=500, charges_copro=40,
        taxe_fonciere=50, vacance=58, tmi=30
    )
    assert cf > 0


def test_cf_micro_foncier_loyer_faible():
    # Loyer faible → CF négatif
    cf = _cf_micro_foncier(
        loyer=400, mensualite=550, charges_copro=40,
        taxe_fonciere=40, vacance=33, tmi=30
    )
    assert cf < 0


def test_cf_reel_meilleur_que_micro_avec_travaux():
    # Avec travaux importants, le réel est souvent plus avantageux
    cf_micro = _cf_micro_foncier(600, 480, 30, 45, 50, 30)
    cf_reel  = _cf_reel_foncier(600, 480, 30, 45, 50, 30, 100_000, 3.35, 0.30, 240, 20_000)
    assert cf_reel >= cf_micro


def test_cf_sci_is_calcul_coherent():
    cf = _cf_sci_is(700, 520, 35, 50, 58, 110_000, 3.35, 0.30, 240)
    # SCI IS avec amortissement → IS faible les premières années
    assert isinstance(cf, float)
    assert -500 < cf < 500  # dans une plage raisonnable


def test_enrichir_sans_conn():
    from calculs import enrichir
    annonce = {
        "prix": 95_000, "surface": 70, "type_bien": "appartement",
        "ville": "Bourges", "code_postal": "18000",
    }
    result = enrichir(annonce, conn=None)
    assert result["calculable"] is True
    assert result["loyer_source"] == "taux_fixe"
    assert result["cf_apres_impot"] is not None
    assert result["cf_apres_impot_reel"] is not None
    assert result["cf_apres_impot_sci"] is not None
    assert result["regime_optimal"] in ("micro", "reel", "sci_is")
```

- [ ] **Step 2 : Vérifier que les tests échouent**

```bash
python -m pytest tests/test_calculs.py -v
```
Attendu : FAILED — fonctions absentes.

- [ ] **Step 3 : Réécrire `scraper/calculs.py`**

```python
"""Moteur financier — 3 régimes fiscaux + loyer de marché."""

from config import (
    TAUX_CREDIT, ASSURANCE, DUREE_MOIS,
    LOYER_M2_APPARTEMENT, LOYER_M2_MAISON,
    LOYER_MAX_APPARTEMENT, LOYER_MAX_MAISON,
    CHARGES_COPRO_APPARTEMENT, CHARGES_COPRO_MAISON,
    TAXE_FONCIERE_RATIO, VACANCE_RATIO, TMI,
)


def _mensualite(capital, taux_annuel_pct, assurance_annuel_pct, duree_mois):
    taux = (taux_annuel_pct + assurance_annuel_pct) / 100 / 12
    if taux == 0:
        return capital / duree_mois
    return capital * taux / (1 - (1 + taux) ** (-duree_mois))


def _interets_annee1(capital, taux_annuel_pct, duree_mois) -> float:
    """Somme exacte des intérêts sur les 12 premiers mois du crédit."""
    taux_m = taux_annuel_pct / 100 / 12
    if taux_m == 0:
        return 0.0
    mensualite = capital * taux_m / (1 - (1 + taux_m) ** (-duree_mois))
    solde = float(capital)
    total = 0.0
    for _ in range(12):
        interet = solde * taux_m
        total  += interet
        solde  -= mensualite - interet
    return total


def _loyer_fallback(surface, type_bien) -> float:
    loyer_m2  = LOYER_M2_APPARTEMENT if type_bien == "appartement" else LOYER_M2_MAISON
    loyer_max = LOYER_MAX_APPARTEMENT if type_bien == "appartement" else LOYER_MAX_MAISON
    return min(surface * loyer_m2, loyer_max)


def get_loyer_marche(ville, type_bien, surface, conn):
    """Retourne (loyer_median, nb_annonces) depuis loyers_marche, ou None."""
    if not conn:
        return None
    try:
        row = conn.execute("""
            SELECT loyer_median, nb_annonces FROM loyers_marche
            WHERE ville = ? AND type_bien = ?
              AND surface_min <= ? AND surface_max > ?
            ORDER BY nb_annonces DESC
            LIMIT 1
        """, (ville, type_bien, float(surface), float(surface))).fetchone()
        return (float(row["loyer_median"]), int(row["nb_annonces"])) if row else None
    except Exception:
        return None


def _cf_micro_foncier(loyer, mensualite, charges_copro, taxe_fonciere, vacance, tmi) -> float:
    loyer_encaisse = loyer - vacance
    impot_mensuel  = loyer_encaisse * 0.70 * (tmi / 100 + 0.172)
    return round(loyer - mensualite - charges_copro - taxe_fonciere - vacance - impot_mensuel, 2)


def _cf_reel_foncier(loyer, mensualite, charges_copro, taxe_fonciere, vacance,
                     tmi, prix, taux_credit, assurance, duree_mois, travaux_montant=0) -> float:
    interets_annuels   = _interets_annee1(prix, taux_credit, duree_mois)
    assurance_annuelle = prix * assurance / 100
    loyer_encaisse_an  = (loyer - vacance) * 12
    deductible         = (interets_annuels + assurance_annuelle +
                          charges_copro * 12 + taxe_fonciere * 12 +
                          (travaux_montant or 0))
    revenu_imposable   = loyer_encaisse_an - deductible
    impot_annuel       = max(0.0, revenu_imposable) * (tmi / 100 + 0.172)
    impot_mensuel      = impot_annuel / 12
    return round(loyer - mensualite - charges_copro - taxe_fonciere - vacance - impot_mensuel, 2)


def _cf_sci_is(loyer, mensualite, charges_copro, taxe_fonciere, vacance,
               prix, taux_credit, assurance, duree_mois) -> float:
    interets_annuels   = _interets_annee1(prix, taux_credit, duree_mois)
    assurance_annuelle = prix * assurance / 100
    amortissement_an   = prix * 0.85 / 30  # 85 % amortissable, 30 ans
    loyer_encaisse_an  = (loyer - vacance) * 12
    deductible         = (interets_annuels + assurance_annuelle + amortissement_an +
                          charges_copro * 12 + taxe_fonciere * 12)
    resultat           = loyer_encaisse_an - deductible
    if resultat <= 0:
        is_annuel = 0.0
    elif resultat <= 42_500:
        is_annuel = resultat * 0.15
    else:
        is_annuel = 42_500 * 0.15 + (resultat - 42_500) * 0.25
    is_mensuel = is_annuel / 12
    return round(loyer - mensualite - charges_copro - taxe_fonciere - vacance - is_mensuel, 2)


def _score(cf_apres_impot, dscr, renta_brute, dpe, prix=None, surface=None) -> int:
    cf_score    = max(0.0, min(30.0, 15.0 + cf_apres_impot / 20.0))
    dscr_score  = max(0.0, min(25.0, (dscr - 0.70) / 0.60 * 25.0))
    renta_score = max(0.0, min(25.0, (renta_brute - 3.0) / 7.0 * 25.0))
    pm2_score   = 0.0
    if prix and surface and surface > 0:
        pm2 = prix / surface
        if   pm2 < 800:   pm2_score = 20.0
        elif pm2 < 1300:  pm2_score = 15.0
        elif pm2 < 2000:  pm2_score = 10.0
        elif pm2 < 3000:  pm2_score = 5.0
    dpe_penalty = {"g": 20, "f": 15, "e": 10}.get((dpe or "").lower(), 0)
    return max(0, min(100, round(cf_score + dscr_score + renta_score + pm2_score - dpe_penalty)))


def enrichir(annonce: dict, conn=None) -> dict:
    """Calcule CF pour 3 régimes fiscaux et le score. Modifie annonce en place."""
    prix      = annonce.get("prix")
    surface   = annonce.get("surface")
    type_bien = annonce.get("type_bien")
    ville     = annonce.get("ville", "")

    if not prix or not surface or not type_bien or type_bien not in ("appartement", "maison", "immeuble"):
        annonce["calculable"] = False
        for k in ("cf_net", "cf_apres_impot", "cf_apres_impot_reel", "cf_apres_impot_sci",
                  "renta_brute", "renta_nette_nette", "dscr", "score",
                  "loyer_estime", "mensualite", "regime_optimal", "loyer_source",
                  "loyer_marche_ref"):
            annonce.setdefault(k, None)
        return annonce

    annonce["calculable"] = True

    # Priorité loyer : annonce > marché > taux fixe
    loyer_marche = get_loyer_marche(ville, type_bien, surface, conn) if conn else None
    if annonce.get("loyer_actuel") and annonce.get("deja_loue"):
        loyer = float(annonce["loyer_actuel"])
        annonce["loyer_source"]     = "annonce"
        annonce["loyer_marche_ref"] = None
    elif loyer_marche:
        loyer = loyer_marche[0]
        annonce["loyer_source"]     = "marche"
        annonce["loyer_marche_ref"] = loyer_marche[1]
    else:
        loyer = _loyer_fallback(surface, type_bien)
        annonce["loyer_source"]     = "taux_fixe"
        annonce["loyer_marche_ref"] = None

    # Charges
    if annonce.get("charges_copro_annonce") is not None:
        charges_copro = float(annonce["charges_copro_annonce"])
    elif type_bien == "appartement":
        charges_copro = CHARGES_COPRO_APPARTEMENT
    else:
        charges_copro = CHARGES_COPRO_MAISON

    if annonce.get("taxe_fonciere_annonce") is not None:
        taxe_fonciere = float(annonce["taxe_fonciere_annonce"]) / 12
    else:
        taxe_fonciere = loyer * TAXE_FONCIERE_RATIO

    vacance    = loyer * VACANCE_RATIO
    mensualite = _mensualite(prix, TAUX_CREDIT, ASSURANCE, DUREE_MOIS)

    cf_net      = loyer - mensualite - charges_copro - taxe_fonciere - vacance
    renta_brute = (loyer * 12) / prix * 100
    dscr        = loyer / mensualite if mensualite > 0 else 0.0

    # 3 régimes
    travaux   = annonce.get("travaux_montant") or 0
    cf_micro  = _cf_micro_foncier(loyer, mensualite, charges_copro, taxe_fonciere, vacance, TMI)
    cf_reel   = _cf_reel_foncier(loyer, mensualite, charges_copro, taxe_fonciere, vacance,
                                  TMI, prix, TAUX_CREDIT, ASSURANCE, DUREE_MOIS, travaux)
    cf_sci    = _cf_sci_is(loyer, mensualite, charges_copro, taxe_fonciere, vacance,
                           prix, TAUX_CREDIT, ASSURANCE, DUREE_MOIS)

    regimes        = {"micro": cf_micro, "reel": cf_reel, "sci_is": cf_sci}
    regime_optimal = max(regimes, key=regimes.get)
    cf_apres_impot = regimes[regime_optimal]

    renta_nette_nette = (cf_apres_impot * 12) / prix * 100
    score = _score(cf_apres_impot, dscr, renta_brute, annonce.get("dpe"), prix, surface)

    annonce["loyer_estime"]         = round(loyer, 0)
    annonce["mensualite"]           = round(mensualite, 2)
    annonce["charges_copro"]        = round(charges_copro, 2)
    annonce["taxe_fonciere"]        = round(taxe_fonciere, 2)
    annonce["vacance"]              = round(vacance, 2)
    annonce["cf_net"]               = round(cf_net, 2)
    annonce["cf_apres_impot"]       = round(cf_apres_impot, 2)
    annonce["cf_apres_impot_reel"]  = cf_reel
    annonce["cf_apres_impot_sci"]   = cf_sci
    annonce["regime_optimal"]       = regime_optimal
    annonce["dscr"]                 = round(dscr, 2)
    annonce["renta_brute"]          = round(renta_brute, 2)
    annonce["renta_nette_nette"]    = round(renta_nette_nette, 2)
    annonce["score"]                = score

    return annonce
```

- [ ] **Step 4 : Mettre à jour `scraper/main.py` — passer `conn` à `enrichir` et appeler le marché**

Dans `main.py`, modifier :

```python
# Ajouter l'import en haut
from marche_locatif import main as marche_main, est_stale as marche_stale

# Dans la fonction main(), après init_db et avant le scraping (ligne ~78) :
    # ── 1.5 Marché locatif (si stale) ────────────────────────────────────────
    if marche_stale(conn):
        _emit(3, "Analyse du marché locatif (premières données ou expirées)…")
        try:
            marche_main(conn, progress_callback=lambda p, m: _emit(int(3 + p * 0.02), m))
        except Exception as e:
            _emit(5, f"  [Marché] ERREUR : {e} — on continue sans loyers de marché.")
    else:
        _emit(3, "Données marché locatif à jour — réutilisation du cache.")

# Dans la boucle des calculs (étape 5), remplacer :
#   enrichir_calculs(annonce)
# par :
    for annonce in toutes_nouvelles:
        enrichir_calculs(annonce, conn)
```

- [ ] **Step 5 : Relancer les tests**

```bash
python -m pytest tests/test_calculs.py tests/test_marche_locatif.py tests/test_db_migration.py -v
```
Attendu : tous PASSED.

- [ ] **Step 6 : Commit**

```bash
git add scraper/calculs.py scraper/main.py tests/test_calculs.py
git commit -m "feat(calculs): 3 fiscal regimes (micro/reel/sci-is) + market rent lookup"
```

---

## Task 4 : Nouveaux endpoints Flask + `bien_id` dans les résultats

**Files:**
- Modify: `server.py`
- Create: `scripts/generate_communes.py`
- Create: `data/communes_centre_val.json`

- [ ] **Step 1 : Générer `data/communes_centre_val.json`**

Créer et exécuter le script suivant **une seule fois** pour générer le fichier statique :

```python
# scripts/generate_communes.py
"""
Génère data/communes_centre_val.json depuis l'API geo.gouv.fr.
Nécessite une connexion internet — à exécuter une seule fois.
Couvre les 6 départements Centre-Val de Loire : 18, 28, 36, 37, 41, 45.
"""
import json
import time
from pathlib import Path

import requests

DEPTS = ["18", "28", "36", "37", "41", "45"]
OUT   = Path(__file__).parent.parent / "data" / "communes_centre_val.json"
OUT.parent.mkdir(parents=True, exist_ok=True)

result: dict[str, list[str]] = {}

for dept in DEPTS:
    print(f"Département {dept}…")
    resp = requests.get(
        f"https://geo.api.gouv.fr/departements/{dept}/communes",
        params={"fields": "nom,codesPostaux", "format": "json"},
        timeout=15,
    )
    resp.raise_for_status()
    for commune in resp.json():
        nom = commune["nom"]
        for cp in commune.get("codesPostaux", []):
            result.setdefault(cp, [])
            if nom not in result[cp]:
                result[cp].append(nom)
    time.sleep(0.3)

# Tri pour lisibilité
for cp in result:
    result[cp].sort()

OUT.write_text(json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2), encoding="utf-8")
print(f"✓ {sum(len(v) for v in result.values())} communes → {OUT}")
```

```bash
python scripts/generate_communes.py
```
Attendu : fichier `data/communes_centre_val.json` créé (~200 KB, ~1 500 communes).

- [ ] **Step 2 : Mettre à jour `server.py`**

Ajouter les imports manquants en haut du fichier :

```python
import time
```

Ajouter après les routes existantes (avant `if __name__ == "__main__"`) :

```python
@app.route("/api/communes")
def api_communes():
    """Retourne les communes pour un préfixe CP (ex: ?cp=181)."""
    cp_prefix = request.args.get("cp", "").strip()
    if len(cp_prefix) < 2:
        return jsonify([])

    communes_path = Path(STATIC_DIR) / "data" / "communes_centre_val.json"
    if not communes_path.exists():
        return jsonify([])

    with open(communes_path, encoding="utf-8") as f:
        data = json.load(f)

    result = []
    for cp, communes in data.items():
        if cp.startswith(cp_prefix):
            for commune in communes:
                result.append({"cp": cp, "commune": commune})

    result.sort(key=lambda x: (x["cp"], x["commune"]))
    return jsonify(result)


@app.route("/api/bien/historique")
def api_bien_historique():
    """Retourne l'historique des prix d'un bien par son URL."""
    url_bien = request.args.get("url", "")
    if not url_bien:
        return jsonify([])

    db_path = Path(SCRAPER_DIR) / "biens.db"
    if not db_path.exists():
        return jsonify([])

    if SCRAPER_DIR not in sys.path:
        sys.path.insert(0, SCRAPER_DIR)
    import db as scraper_db
    conn = scraper_db.get_connection(db_path)
    try:
        row = conn.execute("SELECT id FROM biens WHERE url = ?", (url_bien,)).fetchone()
        if not row:
            return jsonify([])
        rows = conn.execute("""
            SELECT prix_ancien, prix_nouveau, date_changement
            FROM historique_prix WHERE bien_id = ?
            ORDER BY date_changement ASC
        """, (row["id"],)).fetchall()
        return jsonify([dict(r) for r in rows])
    finally:
        conn.close()


@app.route("/api/geocode/batch", methods=["POST"])
def api_geocode_batch():
    """
    Géocode une liste de {ville, code_postal} via Nominatim.
    Utilise le cache SQLite (table geocodes). Rate-limit : 1 req/s.
    """
    items = request.json or []
    db_path = Path(SCRAPER_DIR) / "biens.db"
    if not db_path.exists():
        return jsonify({})

    if SCRAPER_DIR not in sys.path:
        sys.path.insert(0, SCRAPER_DIR)
    import db as scraper_db
    import requests as req
    conn = scraper_db.get_connection(db_path)

    result = {}
    try:
        for item in items:
            ville = item.get("ville", "")
            cp    = item.get("code_postal", "")
            key   = f"{ville}|{cp}"

            cached = conn.execute(
                "SELECT lat, lng FROM geocodes WHERE ville = ? AND code_postal = ?",
                (ville, cp)
            ).fetchone()
            if cached:
                result[key] = {"lat": cached["lat"], "lng": cached["lng"]} if cached["lat"] else None
                continue

            try:
                resp = req.get(
                    "https://nominatim.openstreetmap.org/search",
                    params={"q": f"{ville}, {cp}, France", "format": "json", "limit": 1},
                    headers={"User-Agent": "SparkInvestissement/1.0 (contact@spark.local)"},
                    timeout=5,
                )
                data = resp.json()
                if data:
                    lat = float(data[0]["lat"])
                    lng = float(data[0]["lon"])
                    conn.execute(
                        "INSERT OR REPLACE INTO geocodes (ville, code_postal, lat, lng) VALUES (?, ?, ?, ?)",
                        (ville, cp, lat, lng)
                    )
                    result[key] = {"lat": lat, "lng": lng}
                else:
                    conn.execute(
                        "INSERT OR REPLACE INTO geocodes (ville, code_postal, lat, lng) VALUES (?, ?, NULL, NULL)",
                        (ville, cp)
                    )
                    result[key] = None
                conn.commit()
                time.sleep(1)  # Nominatim : max 1 req/s
            except Exception:
                result[key] = None
    finally:
        conn.close()

    return jsonify(result)
```

- [ ] **Step 3 : Mettre à jour `_read_results()` pour inclure `bien_id` et les nouveaux champs**

Dans `server.py`, remplacer la requête SQL dans `_read_results()` :

```python
        rows = conn.execute("""
            SELECT
                b.id AS bien_id,
                b.prix, b.surface, b.type_bien, b.ville, b.code_postal,
                b.dpe, b.titre, b.url, b.site, b.date_derniere_vue,
                a.cf_net, a.cf_apres_impot,
                a.cf_apres_impot_reel, a.cf_apres_impot_sci,
                a.regime_optimal, a.loyer_source,
                a.renta_brute, a.renta_nette_nette,
                a.dscr, a.score, a.loyer_estime, a.mensualite,
                a.resume_ia, a.points_forts, a.points_faibles,
                a.nb_pieces, a.travaux, a.travaux_montant,
                a.immeuble_rapport, a.deja_loue, a.loyer_actuel,
                a.meuble, a.parking_garage, a.chauffage,
                a.date_enrichissement
            FROM biens b
            JOIN annonces a ON a.bien_id = b.id
            ORDER BY a.score DESC NULLS LAST
        """).fetchall()
```

- [ ] **Step 4 : Test manuel des nouveaux endpoints**

```bash
python server.py
# Dans un second terminal :
curl "http://localhost:8080/api/communes?cp=180"
# Attendu : JSON avec communes du 180xx
curl "http://localhost:8080/api/bien/historique?url=https://example.com"
# Attendu : []
```

- [ ] **Step 5 : Commit**

```bash
git add server.py scripts/generate_communes.py data/communes_centre_val.json
git commit -m "feat(server): add communes, historique, geocode endpoints + bien_id in results"
```

---

## Task 5 : Frontend — Sélecteur CP avec pré-complétion

**Files:**
- Modify: `scanner.js`
- Modify: `index.html`

- [ ] **Step 1 : Ajouter la structure HTML du sélecteur dans `index.html`**

Localiser le div `id="scanner-filters"` dans `index.html`. Ajouter juste **avant** ce div :

```html
<!-- Sélecteur code postal -->
<div id="scanner-cp-wrapper" style="display:none;margin-bottom:12px">
  <div style="position:relative;display:inline-flex;align-items:center;gap:8px;flex-wrap:wrap">
    <div style="position:relative">
      <input id="cp-search" type="text" placeholder="🔍 Code postal…" autocomplete="off"
        style="padding:7px 12px;border-radius:8px;border:1px solid var(--border);background:var(--surface-strong);color:var(--text);font-size:13px;width:200px">
      <div id="cp-dropdown" style="display:none;position:absolute;top:calc(100% + 4px);left:0;min-width:280px;z-index:200;background:var(--surface);border:1px solid var(--border);border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,0.3);max-height:220px;overflow-y:auto"></div>
    </div>
    <span id="cp-active-badge" style="display:none;padding:3px 10px;background:var(--accent-gold,#C5A059)22;color:var(--accent-gold,#C5A059);border:1px solid var(--accent-gold,#C5A059)44;border-radius:6px;font-size:12px;font-weight:600"></span>
    <button id="cp-reset" style="display:none;padding:4px 10px;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--muted);font-size:11px;cursor:pointer">× Réinitialiser</button>
  </div>
</div>
```

- [ ] **Step 2 : Ajouter le module sélecteur CP dans `scanner.js`**

Ajouter après la déclaration des constantes `API` en début de fichier :

```javascript
// ─── Sélecteur CP ─────────────────────────────────────────────────────────────

let _communesData = null;   // {cp: [commune, ...]}
let _cpFilter = null;       // {cp: string, commune: string|null} ou null

async function _loadCommunesData() {
  if (_communesData) return;
  try {
    const resp = await fetch('/data/communes_centre_val.json');
    _communesData = await resp.json();
  } catch (e) {
    _communesData = {};
  }
}

function _initCPSelector() {
  const input = document.getElementById('cp-search');
  const dropdown = document.getElementById('cp-dropdown');
  const resetBtn = document.getElementById('cp-reset');
  if (!input) return;

  input.addEventListener('focus', () => _loadCommunesData());

  input.addEventListener('input', () => {
    const val = input.value.trim();
    if (val.length < 2 || !_communesData) { dropdown.style.display = 'none'; return; }

    // Trouver les communes correspondantes
    const matches = [];
    for (const [cp, communes] of Object.entries(_communesData)) {
      if (cp.startsWith(val)) {
        for (const commune of communes) {
          matches.push({ cp, commune });
        }
      }
    }

    if (!matches.length) { dropdown.style.display = 'none'; return; }

    // Compter les biens par CP
    const biensCounts = {};
    for (const r of _allResultats) {
      if (r.code_postal) biensCounts[r.code_postal] = (biensCounts[r.code_postal] || 0) + 1;
    }

    // Grouper par préfixe pour l'option "Toutes"
    const totalMatching = matches.reduce((sum, m) => sum + (biensCounts[m.cp] || 0), 0);
    const uniqueCPs = [...new Set(matches.map(m => m.cp))];

    let html = '';
    if (uniqueCPs.length > 1) {
      html += `<div class="cp-option cp-option-all" data-cp="${val}" data-commune="__all__"
        style="padding:9px 14px;cursor:pointer;border-bottom:1px solid var(--border);font-weight:600;color:var(--accent-gold,#C5A059)">
        Toutes les communes "${val}…" <span style="color:var(--muted);font-weight:400">(${totalMatching} biens)</span>
      </div>`;
    }
    for (const { cp, commune } of matches.slice(0, 30)) {
      const n = biensCounts[cp] || 0;
      html += `<div class="cp-option" data-cp="${cp}" data-commune="${_esc(commune)}"
        style="padding:8px 14px;cursor:pointer;font-size:13px">
        <span style="color:var(--muted);font-size:11px;margin-right:6px">${cp}</span>${_esc(commune)}
        <span style="color:var(--muted);font-size:11px;float:right">${n} bien${n !== 1 ? 's' : ''}</span>
      </div>`;
    }

    dropdown.innerHTML = html;
    dropdown.style.display = 'block';

    dropdown.querySelectorAll('.cp-option').forEach(el => {
      el.addEventListener('mouseenter', () => el.style.background = 'var(--surface-strong)');
      el.addEventListener('mouseleave', () => el.style.background = '');
      el.addEventListener('click', () => {
        const cp = el.dataset.cp;
        const commune = el.dataset.commune;
        _setCPFilter(cp, commune === '__all__' ? null : commune, commune === '__all__' ? `${cp}… (toutes)` : `${cp} — ${commune}`);
        dropdown.style.display = 'none';
      });
    });
  });

  document.addEventListener('click', e => {
    if (!input.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.style.display = 'none';
    }
  });

  resetBtn?.addEventListener('click', () => {
    _cpFilter = null;
    input.value = '';
    document.getElementById('cp-active-badge').style.display = 'none';
    resetBtn.style.display = 'none';
    _applyTable();
  });
}

function _setCPFilter(cp, commune, label) {
  _cpFilter = { cp, commune };
  const badge = document.getElementById('cp-active-badge');
  const reset = document.getElementById('cp-reset');
  if (badge) { badge.textContent = label; badge.style.display = ''; }
  if (reset)   reset.style.display = '';
  document.getElementById('cp-search').value = label;
  _applyTable();
}

function _matchCP(r) {
  if (!_cpFilter) return true;
  const cp = (r.code_postal || '');
  if (_cpFilter.commune) {
    return cp === _cpFilter.cp && (r.ville || '').toLowerCase() === _cpFilter.commune.toLowerCase();
  }
  return cp.startsWith(_cpFilter.cp);
}
```

- [ ] **Step 3 : Intégrer le filtre CP dans `_matchFilters` et `_bindButtons`**

Dans `_matchFilters(r)`, ajouter en première ligne :

```javascript
  if (!_matchCP(r)) return false;
```

Dans `_bindButtons()`, ajouter à la fin :

```javascript
  _initCPSelector();
```

Dans `_loadResults()`, ajouter après que les données sont chargées (après `_showEmpty(false)`) :

```javascript
    document.getElementById('scanner-cp-wrapper')?.style.setProperty('display', '');
```

- [ ] **Step 4 : Tester manuellement**

```bash
python app.py
```
Ouvrir le scanner → taper "18" dans le champ → vérifier la liste déroulante → sélectionner une commune → vérifier que la table se filtre.

- [ ] **Step 5 : Commit**

```bash
git add scanner.js index.html
git commit -m "feat(ui): add postal code pre-selector with commune dropdown"
```

---

## Task 6 : Frontend — Panneau de détail (drawer)

**Files:**
- Modify: `scanner.js`
- Modify: `index.html`

- [ ] **Step 1 : Ajouter la structure HTML du drawer dans `index.html`**

Ajouter juste avant `</body>` :

```html
<!-- Drawer détail bien -->
<div id="detail-overlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:500" aria-hidden="true"></div>
<aside id="detail-drawer" role="complementary" aria-label="Détail du bien"
  style="display:none;position:fixed;top:0;right:0;bottom:0;width:min(520px,100vw);background:var(--surface);border-left:1px solid var(--border);z-index:501;overflow-y:auto;box-shadow:-8px 0 32px rgba(0,0,0,0.3);transition:transform .25s ease">
  <div id="detail-content" style="padding:24px"></div>
</aside>
```

- [ ] **Step 2 : Ajouter les fonctions drawer dans `scanner.js`**

Ajouter à la fin de `scanner.js` :

```javascript
// ─── Panneau de détail (drawer) ───────────────────────────────────────────────

function _openDrawer(r) {
  const overlay = document.getElementById('detail-overlay');
  const drawer  = document.getElementById('detail-drawer');
  const content = document.getElementById('detail-content');
  if (!drawer || !content) return;

  content.innerHTML = _renderDetailContent(r);
  overlay.style.display = 'block';
  drawer.style.display  = 'block';
  requestAnimationFrame(() => drawer.style.transform = 'translateX(0)');

  overlay.onclick = _closeDrawer;
  content.querySelector('#detail-close')?.addEventListener('click', _closeDrawer);
  content.querySelector('#detail-analyser-btn')?.addEventListener('click', () => {
    _closeDrawer();
    _analyserBien(r);
  });

  // Charger l'historique des prix
  _loadPriceHistory(r.url, content.querySelector('#detail-historique'));
}

function _closeDrawer() {
  const overlay = document.getElementById('detail-overlay');
  const drawer  = document.getElementById('detail-drawer');
  if (overlay) overlay.style.display = 'none';
  if (drawer)  drawer.style.display  = 'none';
}

function _renderDetailContent(r) {
  const dpe = (r.dpe || '').toLowerCase();
  const dpeColors = { a:'#00a550',b:'#51b845',c:'#c8d200',d:'#ffcc00',e:'#f4a623',f:'#e3720c',g:'#cc0000' };
  const dpeColor  = dpeColors[dpe] || 'var(--muted)';
  const dpeAlerte = r.dpe_alerte ? `<span style="background:${dpeColor}22;color:${dpeColor};border:1px solid ${dpeColor}44;padding:3px 8px;border-radius:6px;font-size:12px;font-weight:600">${_esc(r.dpe_alerte[0])}</span>` : '';

  const loyerSourceLabel = r.loyer_source === 'annonce' ? 'loyer de l\'annonce'
    : r.loyer_source === 'marche' ? `loyer médian marché${r.loyer_marche_ref ? ` (${r.loyer_marche_ref} annonces ref.)` : ''}`
    : 'loyer estimé (taux fixe)';
  const loyerSourceColor = r.loyer_source === 'annonce' ? '#22d3ee' : r.loyer_source === 'marche' ? '#4ade80' : '#f59e0b';

  const prixM2 = r.surface ? Math.round(r.prix / r.surface) : null;

  // Comparaison des 3 régimes
  const cfMicro = r.cf_apres_impot; // le cf stocké est celui du régime optimal, on affiche les 3
  // NOTE : cf_apres_impot = meilleur régime, les 3 valeurs individuelles sont dans cf_apres_impot_reel, cf_apres_impot_sci
  // et on recalcule micro = cf_apres_impot si regime_optimal === 'micro', sinon on ne l'a pas séparément
  // → Afficher cf_apres_impot_reel et cf_apres_impot_sci directement depuis l'API
  // Pour micro : cf_apres_impot si regime_optimal === 'micro', sinon on l'affiche comme "non optimal"
  const regimes = [
    { id: 'micro',  label: 'Micro-foncier', cf: r.regime_optimal === 'micro' ? r.cf_apres_impot : null, note: 'Abattement 30 %' },
    { id: 'reel',   label: 'Réel foncier',  cf: r.cf_apres_impot_reel,  note: 'Déduction charges réelles' },
    { id: 'sci_is', label: 'SCI à l\'IS',   cf: r.cf_apres_impot_sci,   note: 'IS 15 % + amortissement' },
  ];
  // Pour micro quand pas optimal, on ne l'a pas en base → afficher "—"
  const regimeHtml = regimes.map(reg => {
    const isOptimal = r.regime_optimal === reg.id;
    const cf = reg.cf;
    const cfStr = cf != null ? `${cf >= 0 ? '+' : ''}${_fmtEur(cf)}` : '—';
    const cfColor = cf != null && cf >= 0 ? '#4ade80' : '#f87171';
    return `
      <div style="flex:1;padding:12px;border-radius:8px;border:${isOptimal ? '2px solid var(--accent-gold,#C5A059)' : '1px solid var(--border)'};background:${isOptimal ? 'var(--accent-gold,#C5A059)11' : 'var(--surface-strong)'}">
        <div style="font-size:11px;color:var(--muted);margin-bottom:4px">${_esc(reg.label)}</div>
        <div style="font-size:16px;font-weight:700;color:${cfColor}">${cfStr}<span style="font-size:11px;font-weight:400;color:var(--muted)">/mois</span></div>
        <div style="font-size:10px;color:var(--muted);margin-top:4px">${_esc(reg.note)}</div>
        ${isOptimal ? '<div style="margin-top:6px;font-size:10px;font-weight:700;color:var(--accent-gold,#C5A059)">★ MEILLEUR RÉGIME</div>' : ''}
      </div>`;
  }).join('');

  // Points forts / faibles
  const ptsForts   = (r.points_forts  || []);
  const ptsFaibles = (r.points_faibles || []);
  const ptsFortHtml  = ptsForts.length  ? ptsForts.map(p  => `<li style="color:#4ade80">+ ${_esc(p)}</li>`).join('')  : '<li style="color:var(--muted)">—</li>';
  const ptsFaibleHtml= ptsFaibles.length? ptsFaibles.map(p => `<li style="color:#f87171">- ${_esc(p)}</li>`).join(''): '<li style="color:var(--muted)">—</li>';

  return `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:16px">
      <div style="flex:1">
        <h2 style="font-size:15px;font-weight:700;margin:0 0 4px">${_esc(r.titre)}</h2>
        <div style="font-size:12px;color:var(--muted)">${_esc(r.ville)} · ${r.surface ? r.surface.toFixed(0) + ' m²' : '—'}${r.nb_pieces ? ' · T' + r.nb_pieces : ''} · ${_esc((r.type_bien || '').charAt(0).toUpperCase() + (r.type_bien || '').slice(1))} · <span style="color:var(--muted)">${_esc(r.site)}</span></div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        ${dpeAlerte}
        <button id="detail-close" style="background:none;border:none;color:var(--muted);font-size:20px;cursor:pointer;padding:0 4px">×</button>
      </div>
    </div>

    <!-- Métriques clés -->
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px">
      ${_detailCard(_fmtEur(r.prix), 'Prix')}
      ${_detailCard(_fmtEur(r.loyer_estime) + '/mois', 'Loyer', loyerSourceLabel, loyerSourceColor)}
      ${_detailCard(_fmtEur(r.mensualite) + '/mois', 'Mensualité crédit')}
      ${_detailCard(r.renta_brute != null ? r.renta_brute.toFixed(1) + ' %' : '—', 'Renta brute')}
      ${_detailCard(r.dscr != null ? r.dscr.toFixed(2) : '—', 'DSCR')}
      ${_detailCard(prixM2 != null ? prixM2.toLocaleString('fr-FR') + ' €/m²' : '—', 'Prix/m²')}
    </div>

    <!-- 3 régimes -->
    <div style="margin-bottom:16px">
      <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Comparaison régimes fiscaux</div>
      <div style="display:flex;gap:8px">${regimeHtml}</div>
    </div>

    <!-- Infos IA -->
    <div style="margin-bottom:16px">
      <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Informations IA</div>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px;font-size:12px">
        ${_detailInfo('Travaux', r.travaux ? (r.travaux_montant ? '~' + _fmtEur(r.travaux_montant) : 'Oui') : 'Non')}
        ${_detailInfo('Chauffage', r.chauffage || '—')}
        ${_detailInfo('Meublé', r.meuble === true ? 'Oui' : r.meuble === false ? 'Non' : '—')}
        ${_detailInfo('Parking', r.parking_garage ? 'Oui' : 'Non')}
        ${r.immeuble_rapport && r.lots_total ? _detailInfo('Lots', `${r.lots_loues ?? '?'}/${r.lots_total} loués`) : ''}
        ${_detailInfo('Déjà loué', r.deja_loue === true ? 'Oui' : r.deja_loue === false ? 'Non' : '—')}
      </div>
      ${r.resume_ia ? `<div style="margin-top:8px;font-size:12px;color:var(--muted);font-style:italic;padding:8px;background:var(--surface-strong);border-radius:6px">"${_esc(r.resume_ia)}"</div>` : ''}
    </div>

    <!-- Points forts / faibles -->
    ${ptsForts.length || ptsFaibles.length ? `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
      <div>
        <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;margin-bottom:6px">Points forts</div>
        <ul style="margin:0;padding:0 0 0 14px;font-size:12px;line-height:1.7">${ptsFortHtml}</ul>
      </div>
      <div>
        <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;margin-bottom:6px">Points faibles</div>
        <ul style="margin:0;padding:0 0 0 14px;font-size:12px;line-height:1.7">${ptsFaibleHtml}</ul>
      </div>
    </div>` : ''}

    <!-- Historique des prix (chargé async) -->
    <div style="margin-bottom:16px">
      <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Historique des prix</div>
      <div id="detail-historique" style="font-size:12px;color:var(--muted)">Chargement…</div>
    </div>

    <!-- Actions -->
    <div style="display:flex;gap:10px;margin-top:8px">
      <button id="detail-analyser-btn" style="flex:1;padding:10px 16px;border-radius:8px;border:none;background:var(--accent-gold,#C5A059);color:#111;font-weight:600;cursor:pointer;font-size:13px">→ Analyser</button>
      <a href="${_esc(r.url)}" target="_blank" style="flex:1;padding:10px 16px;border-radius:8px;border:1px solid var(--border);color:var(--text);text-decoration:none;font-size:13px;text-align:center">Voir l'annonce ↗</a>
    </div>`;
}

function _detailCard(val, label, note = '', noteColor = 'var(--muted)') {
  return `<div style="background:var(--surface-strong);border-radius:8px;padding:10px;text-align:center">
    <div style="font-size:14px;font-weight:700">${val}</div>
    <div style="font-size:10px;color:var(--muted);margin-top:2px">${_esc(label)}</div>
    ${note ? `<div style="font-size:10px;color:${noteColor};margin-top:2px">${_esc(note)}</div>` : ''}
  </div>`;
}

function _detailInfo(label, val) {
  return `<div style="display:flex;justify-content:space-between;padding:4px 8px;background:var(--surface-strong);border-radius:6px">
    <span style="color:var(--muted)">${_esc(label)}</span>
    <span style="font-weight:600">${_esc(String(val))}</span>
  </div>`;
}

async function _loadPriceHistory(url, container) {
  if (!container) return;
  try {
    const resp = await fetch('/api/bien/historique?url=' + encodeURIComponent(url));
    const data = await resp.json();
    if (!data.length) {
      container.textContent = 'Aucune variation de prix enregistrée.';
      return;
    }
    container.innerHTML = data.map((h, i) => {
      const diff = h.prix_nouveau - h.prix_ancien;
      const diffStr = diff < 0 ? `<span style="color:#4ade80">${diff.toLocaleString('fr-FR')} €</span>` : `<span style="color:#f87171">+${diff.toLocaleString('fr-FR')} €</span>`;
      const isLast = i === data.length - 1;
      return `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:${isLast ? 'none' : '1px solid var(--border)'}">
        <span style="color:var(--muted)">${new Date(h.date_changement).toLocaleDateString('fr-FR')}</span>
        <span>${h.prix_nouveau.toLocaleString('fr-FR')} € ${diffStr}</span>
      </div>`;
    }).join('');
  } catch (e) {
    container.textContent = 'Erreur chargement historique.';
  }
}
```

- [ ] **Step 3 : Lier le drawer au clic sur une ligne de tableau**

Dans `_renderRow()`, modifier le `<tr>` pour ajouter un handler de clic sur la ligne (hors boutons) :

```javascript
// Remplacer la première ligne de _renderRow :
// return `<tr>`
// par :
return `<tr style="cursor:pointer" data-rank="${idx}">`;
```

Dans `_applyTable()`, après la ligne `container.querySelectorAll('th[data-sort]').forEach(...)`, ajouter :

```javascript
  // Clic ligne → drawer détail
  container.querySelectorAll('tbody tr').forEach(tr => {
    tr.addEventListener('click', e => {
      if (e.target.closest('button, a')) return;
      const idx = parseInt(tr.dataset.rank, 10);
      if (!isNaN(idx)) _openDrawer(_displayedResultats[idx]);
    });
  });
```

- [ ] **Step 4 : Tester manuellement**

```bash
python app.py
```
Scanner → cliquer sur une ligne → drawer s'ouvre → vérifier les 3 régimes fiscaux, les points forts/faibles, l'historique des prix.

- [ ] **Step 5 : Commit**

```bash
git add scanner.js index.html
git commit -m "feat(ui): add detail drawer with 3 fiscal regimes, IA fields, price history"
```

---

## Task 7 : Frontend — Carte Leaflet

**Files:**
- Modify: `scanner.js`
- Modify: `index.html`

- [ ] **Step 1 : Télécharger Leaflet localement**

```bash
# Créer le dossier
mkdir -p c:\Users\Dylan\Desktop\Creation_site\Investissement_web\vendor\leaflet

# Télécharger Leaflet 1.9.4
curl -L "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"  -o vendor/leaflet/leaflet.js
curl -L "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" -o vendor/leaflet/leaflet.css
```

- [ ] **Step 2 : Ajouter Leaflet dans `index.html`**

Dans `<head>`, ajouter :

```html
<link rel="stylesheet" href="/vendor/leaflet/leaflet.css">
<script src="/vendor/leaflet/leaflet.js"></script>
```

Ajouter la structure des onglets du scanner dans `index.html`. Localiser le div contenant le scanner (chercher `id="scanner-stats"` ou le panel scanner), et ajouter les onglets juste avant `id="scanner-stats"` :

```html
<!-- Onglets Tableau / Carte -->
<div id="scanner-view-tabs" style="display:none;margin-bottom:12px;display:flex;gap:8px">
  <button id="tab-tableau" class="scanner-tab-btn scanner-tab-active" style="padding:6px 18px;border-radius:6px;border:1px solid var(--accent-gold,#C5A059);background:var(--accent-gold,#C5A059)22;color:var(--accent-gold,#C5A059);font-size:13px;cursor:pointer;font-weight:600">Tableau</button>
  <button id="tab-carte"   class="scanner-tab-btn" style="padding:6px 18px;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--muted);font-size:13px;cursor:pointer">Carte</button>
</div>

<!-- Conteneur carte -->
<div id="scanner-map-container" style="display:none;border-radius:12px;overflow:hidden;border:1px solid var(--border)">
  <div id="scanner-map" style="height:500px;width:100%"></div>
  <div id="scanner-map-offline" style="display:none;padding:12px;text-align:center;font-size:12px;color:var(--muted)">
    Tuiles de carte indisponibles (connexion internet requise pour la carte).
  </div>
  <div id="scanner-map-unloc" style="padding:8px 14px;font-size:12px;color:var(--muted);background:var(--surface-strong)"></div>
</div>
```

- [ ] **Step 3 : Ajouter le module carte dans `scanner.js`**

Ajouter à la fin de `scanner.js` :

```javascript
// ─── Carte Leaflet ────────────────────────────────────────────────────────────

let _leafletMap = null;
let _leafletMarkers = null;

function _initMap() {
  if (_leafletMap) return;
  if (typeof L === 'undefined') return;

  _leafletMap = L.map('scanner-map', {
    center: [47.5, 1.5],  // Centre-Val de Loire
    zoom: 8,
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 18,
  }).addTo(_leafletMap);

  _leafletMarkers = L.layerGroup().addTo(_leafletMap);

  // Détection offline
  _leafletMap.once('tileerror', () => {
    document.getElementById('scanner-map-offline').style.display = '';
  });
}

async function _renderMap(resultats) {
  if (typeof L === 'undefined') return;
  _initMap();
  _leafletMarkers.clearLayers();

  // Collecter les villes/CP uniques à géocoder
  const toGeocode = [];
  const seen = new Set();
  for (const r of resultats) {
    const key = `${r.ville}|${r.code_postal}`;
    if (!seen.has(key) && r.ville) {
      seen.add(key);
      toGeocode.push({ ville: r.ville, code_postal: r.code_postal });
    }
  }

  let geoData = {};
  try {
    const resp = await fetch('/api/geocode/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toGeocode),
    });
    geoData = await resp.json();
  } catch (e) {
    console.warn('Géocodage échoué', e);
  }

  let nonLocalises = 0;
  const bounds = [];

  for (const r of resultats) {
    const key   = `${r.ville}|${r.code_postal}`;
    const coord = geoData[key];
    if (!coord || !coord.lat) { nonLocalises++; continue; }

    const color = r.score >= 80 ? '#16a34a'
                : r.score >= 60 ? '#22c55e'
                : r.score >= 40 ? '#f59e0b'
                : r.score >= 20 ? '#e3720c'
                : '#dc2626';

    const marker = L.circleMarker([coord.lat, coord.lng], {
      radius: 9,
      fillColor: color,
      fillOpacity: 0.85,
      color: '#fff',
      weight: 1.5,
    });

    const cfStr = r.cf_apres_impot != null
      ? `${r.cf_apres_impot >= 0 ? '+' : ''}${Math.round(r.cf_apres_impot)} €/mois`
      : '—';

    marker.bindPopup(`
      <div style="min-width:180px;font-family:sans-serif">
        <div style="font-weight:700;font-size:13px;margin-bottom:4px">${_esc(r.titre)}</div>
        <div style="font-size:11px;color:#666">${_esc(r.ville)} · ${r.surface ? r.surface.toFixed(0) + ' m²' : '—'}</div>
        <div style="margin:6px 0;font-size:13px"><strong>${r.prix ? r.prix.toLocaleString('fr-FR') + ' €' : '—'}</strong></div>
        <div style="font-size:12px">CF : <strong style="color:${r.cf_apres_impot >= 0 ? 'green' : 'red'}">${cfStr}</strong></div>
        <div style="font-size:12px">Score : <strong>${r.score ?? '—'}/100</strong></div>
        <button onclick="window._openDrawerFromMap(${resultats.indexOf(r)})"
          style="margin-top:8px;width:100%;padding:5px;border-radius:5px;border:1px solid #C5A059;background:transparent;color:#C5A059;cursor:pointer;font-size:12px">
          Voir le détail →
        </button>
      </div>
    `);

    marker.addTo(_leafletMarkers);
    bounds.push([coord.lat, coord.lng]);
  }

  if (bounds.length > 1) _leafletMap.fitBounds(bounds, { padding: [30, 30] });

  const unloc = document.getElementById('scanner-map-unloc');
  if (unloc) unloc.textContent = nonLocalises > 0 ? `${nonLocalises} bien${nonLocalises > 1 ? 's' : ''} non localisé${nonLocalises > 1 ? 's' : ''} (ville inconnue).` : '';
}

// Accessible depuis le popup Leaflet (contexte global)
window._openDrawerFromMap = function(idx) {
  if (_displayedResultats[idx]) _openDrawer(_displayedResultats[idx]);
};
```

- [ ] **Step 4 : Câbler les onglets dans `_bindButtons()`**

Ajouter à la fin de `_bindButtons()` :

```javascript
  document.getElementById('tab-tableau')?.addEventListener('click', () => {
    document.getElementById('scanner-map-container').style.display = 'none';
    document.getElementById('scanner-results').style.display = '';
    document.getElementById('tab-tableau').style.cssText += ';border-color:var(--accent-gold,#C5A059);background:var(--accent-gold,#C5A059)22;color:var(--accent-gold,#C5A059);font-weight:600';
    document.getElementById('tab-carte').style.cssText += ';border-color:var(--border);background:transparent;color:var(--muted);font-weight:400';
  });

  document.getElementById('tab-carte')?.addEventListener('click', () => {
    document.getElementById('scanner-results').style.display = 'none';
    document.getElementById('scanner-map-container').style.display = '';
    document.getElementById('tab-carte').style.cssText += ';border-color:var(--accent-gold,#C5A059);background:var(--accent-gold,#C5A059)22;color:var(--accent-gold,#C5A059);font-weight:600';
    document.getElementById('tab-tableau').style.cssText += ';border-color:var(--border);background:transparent;color:var(--muted);font-weight:400';
    _renderMap(_displayedResultats);
    setTimeout(() => _leafletMap?.invalidateSize(), 100);
  });
```

Dans `_loadResults()`, après `document.getElementById('scanner-results').style.display = ''`, ajouter :

```javascript
    document.getElementById('scanner-view-tabs')?.style.setProperty('display', 'flex');
```

- [ ] **Step 5 : Tester manuellement**

```bash
python app.py
```
Scanner → après un scan → onglet "Carte" → vérifier les pins colorés → cliquer un pin → popup → "Voir le détail" → drawer s'ouvre.

- [ ] **Step 6 : Commit final**

```bash
git add scanner.js index.html vendor/leaflet/
git commit -m "feat(ui): add Leaflet map with score-colored pins and geocoding cache"
```

---

## Récapitulatif des fichiers modifiés

| Fichier | Tâche |
|---|---|
| `scraper/db.py` | T1 — nouvelles tables + colonnes |
| `scraper/marche_locatif.py` | T2 — créé |
| `scraper/calculs.py` | T3 — 3 régimes fiscaux |
| `scraper/main.py` | T3 — appel marché + conn |
| `server.py` | T4 — 3 nouveaux endpoints |
| `scripts/generate_communes.py` | T4 — créé (one-shot) |
| `data/communes_centre_val.json` | T4 — généré |
| `scanner.js` | T5+T6+T7 — CP selector + drawer + carte |
| `index.html` | T5+T6+T7 — HTML drawer + map + tabs |
| `vendor/leaflet/` | T7 — Leaflet bundlé localement |
| `tests/` | T1+T2+T3 — suite de tests |
