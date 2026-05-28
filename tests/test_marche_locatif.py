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
