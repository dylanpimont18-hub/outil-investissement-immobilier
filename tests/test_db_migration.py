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


def test_biens_description_column_exists(tmp_path):
    conn = init_db(tmp_path / "test.db")
    cols = [r[1] for r in conn.execute("PRAGMA table_info(biens)").fetchall()]
    assert "description" in cols
    assert "missing_scan_count" in cols
    conn.close()


def test_scanner_indexes_exist(tmp_path):
    conn = init_db(tmp_path / "test.db")
    biens_indexes = {r[1] for r in conn.execute("PRAGMA index_list('biens')").fetchall()}
    annonces_indexes = {r[1] for r in conn.execute("PRAGMA index_list('annonces')").fetchall()}

    assert "idx_biens_prix" in biens_indexes
    assert "idx_biens_surface" in biens_indexes
    assert "idx_annonces_score" in annonces_indexes
    conn.close()
