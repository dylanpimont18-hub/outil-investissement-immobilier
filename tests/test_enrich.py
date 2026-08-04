import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "scraper"))

import enrich as enrich_module
from db import init_db
from utils import inserer_bien


def _annonce_brute(description=""):
    return {
        "site": "leboncoin",
        "url": "https://example.test/bien-1",
        "titre": "Immeuble Vierzon centre",
        "description": description,
        "prix": 120000,
        "surface": 140,
        "type_bien": "immeuble",
        "ville": "Vierzon",
        "code_postal": "18100",
        "dpe": "d",
    }


def test_enrich_pending_transmet_la_description_stockee(tmp_path, monkeypatch):
    conn = init_db(tmp_path / "test.db")
    bien_id = inserer_bien(_annonce_brute("Taxe fonciere 1200 euros."), "fp-1", conn)

    captured = {}

    def fake_batch(annonces):
        captured["description"] = annonces[0]["description"]
        return annonces

    monkeypatch.setattr(enrich_module, "enrichir_batch", fake_batch)
    monkeypatch.setattr(enrich_module, "enrichir_calculs", lambda annonce, conn: None)
    monkeypatch.setattr(enrich_module, "inserer_annonce", lambda bien_id, annonce, conn, commit=True: 1)

    count = enrich_module.enrich_pending(conn=conn)

    assert count == 1
    assert captured["description"] == "Taxe fonciere 1200 euros."
    conn.close()


def test_enrich_pending_recupere_la_description_manquante(tmp_path, monkeypatch):
    conn = init_db(tmp_path / "test.db")
    bien_id = inserer_bien(_annonce_brute(""), "fp-2", conn)

    class FakeScraper:
        def fetch_description(self, url):
            return "Annonce complete avec taxe fonciere et chauffage gaz."

    monkeypatch.setitem(enrich_module.REGISTRY, "leboncoin", FakeScraper)
    monkeypatch.setattr(enrich_module, "enrichir_batch", lambda annonces: annonces)
    monkeypatch.setattr(enrich_module, "enrichir_calculs", lambda annonce, conn: None)
    monkeypatch.setattr(enrich_module, "inserer_annonce", lambda bien_id, annonce, conn, commit=True: 1)

    count = enrich_module.enrich_pending(conn=conn)
    row = conn.execute("SELECT description FROM biens WHERE id = ?", (bien_id,)).fetchone()

    assert count == 1
    assert row["description"] == "Annonce complete avec taxe fonciere et chauffage gaz."
    conn.close()