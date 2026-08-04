import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "scraper"))

from db import init_db
from fingerprint import make_fingerprint
from filtrage import filtrer_nouvelles_annonces
from utils import incrementer_scans_manques, inserer_bien


def test_filtrage_ignore_les_doublons_fingerprint_dans_le_meme_lot(tmp_path):
    conn = init_db(tmp_path / "test.db")
    annonces = [
        {
            "site": "leboncoin",
            "url": "https://example.test/bien-1",
            "titre": "Appartement T2 Bourges centre",
            "prix": 90000,
            "surface": 42,
            "type_bien": "appartement",
            "ville": "Bourges",
            "code_postal": "18000",
            "nb_pieces": 2,
        },
        {
            "site": "seloger",
            "url": "https://example.test/bien-2",
            "titre": "Appartement T2 Bourges centre",
            "prix": 91000,
            "surface": 42,
            "type_bien": "appartement",
            "ville": "Bourges",
            "code_postal": "18000",
            "nb_pieces": 2,
        },
    ]

    nouvelles, stats = filtrer_nouvelles_annonces(annonces, conn)

    assert len(nouvelles) == 1
    assert stats["nouvelles"] == 1
    assert stats["doublons_fp"] == 1
    assert "_fingerprint" in nouvelles[0]
    conn.close()


def test_filtrage_reinitialise_scans_manques_sur_doublon_fingerprint(tmp_path):
    conn = init_db(tmp_path / "test.db")
    annonce_existante = {
        "site": "leboncoin",
        "url": "https://example.test/bien-existant",
        "titre": "Appartement T2 Bourges centre",
        "description": "",
        "prix": 90000,
        "surface": 42,
        "type_bien": "appartement",
        "ville": "Bourges",
        "code_postal": "18000",
        "dpe": "d",
        "nb_pieces": 2,
    }
    bien_id = inserer_bien(annonce_existante, make_fingerprint(annonce_existante), conn, commit=False)
    conn.execute("UPDATE biens SET missing_scan_count = 2 WHERE id = ?", (bien_id,))
    conn.commit()

    annonce_dupliquee = {
        **annonce_existante,
        "site": "pap",
        "url": "https://example.test/bien-duplique",
    }

    nouvelles, stats = filtrer_nouvelles_annonces([annonce_dupliquee], conn)
    row = conn.execute("SELECT missing_scan_count FROM biens WHERE id = ?", (bien_id,)).fetchone()

    assert nouvelles == []
    assert stats["doublons_fp"] == 1
    assert row["missing_scan_count"] == 0
    conn.close()


def test_incrementer_scans_manques_ne_touche_que_les_biens_non_vus(tmp_path):
    conn = init_db(tmp_path / "test.db")

    annonce_vue = {
        "site": "leboncoin",
        "url": "https://example.test/vue",
        "titre": "Appartement T2 Vierzon centre",
        "description": "",
        "prix": 85000,
        "surface": 45,
        "type_bien": "appartement",
        "ville": "Vierzon",
        "code_postal": "18100",
        "dpe": "d",
        "nb_pieces": 2,
    }
    annonce_absente = {
        **annonce_vue,
        "url": "https://example.test/absente",
        "titre": "Appartement T2 Vierzon gare",
    }
    annonce_autre_source = {
        **annonce_vue,
        "site": "pap",
        "url": "https://example.test/pap",
        "titre": "Appartement T2 Vierzon pap",
    }
    annonce_autre_cp = {
        **annonce_vue,
        "url": "https://example.test/bourges",
        "ville": "Bourges",
        "code_postal": "18000",
    }

    bien_vu = inserer_bien(annonce_vue, make_fingerprint(annonce_vue), conn, commit=False)
    bien_absent = inserer_bien(annonce_absente, make_fingerprint(annonce_absente), conn, commit=False)
    bien_autre_source = inserer_bien(annonce_autre_source, make_fingerprint(annonce_autre_source), conn, commit=False)
    bien_autre_cp = inserer_bien(annonce_autre_cp, make_fingerprint(annonce_autre_cp), conn, commit=False)
    conn.commit()

    incrementer_scans_manques(
        "18100",
        {annonce_vue["url"]},
        {make_fingerprint(annonce_vue)},
        {"leboncoin"},
        conn,
    )

    rows = {
        row["id"]: row["missing_scan_count"]
        for row in conn.execute(
            "SELECT id, missing_scan_count FROM biens WHERE id IN (?, ?, ?, ?)",
            (bien_vu, bien_absent, bien_autre_source, bien_autre_cp),
        ).fetchall()
    }

    assert rows[bien_vu] == 0
    assert rows[bien_absent] == 1
    assert rows[bien_autre_source] == 0
    assert rows[bien_autre_cp] == 0
    conn.close()