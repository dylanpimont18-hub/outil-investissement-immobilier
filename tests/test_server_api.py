import json
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent / "scraper"))

import db as real_db
import server
from utils import inserer_annonce, inserer_bien


def _build_client_with_temp_db(tmp_path, monkeypatch):
    db_path = tmp_path / "biens.db"
    conn = real_db.init_db(db_path)

    ordered_ids = []
    rows = [
        ("Bien A", 90000, 40, 820, 90),
        ("Bien B", 110000, 52, 790, 70),
        ("Bien C", 130000, 61, 760, 50),
    ]
    for idx, (title, price, surface, rent, score) in enumerate(rows, start=1):
        bien_id = inserer_bien({
            "site": "leboncoin",
            "url": f"https://example.test/bien-{idx}",
            "titre": title,
            "description": "",
            "prix": price,
            "surface": surface,
            "type_bien": "appartement",
            "ville": "Vierzon",
            "code_postal": "18100",
            "dpe": "d",
        }, f"fp-{idx}", conn, commit=False)
        inserer_annonce(bien_id, {
            "nb_pieces": 2,
            "travaux": False,
            "travaux_montant": 0,
            "immeuble_rapport": False,
            "deja_loue": True,
            "loyer_actuel": rent,
            "meuble": False,
            "parking_garage": False,
            "chauffage": "gaz",
            "points_forts": [],
            "points_faibles": [],
            "resume_ia": f"Resume {idx}",
            "loyer_estime": rent,
            "mensualite": 500,
            "cf_net": 100 - idx,
            "cf_apres_impot": 80 - idx,
            "renta_brute": 7.5 - idx * 0.2,
            "renta_nette_nette": 5.1 - idx * 0.1,
            "dscr": 1.2,
            "score": score,
            "regime_optimal": "reel",
            "loyer_source": "annonce",
        }, conn, commit=False)
        ordered_ids.append(bien_id)
    conn.commit()
    conn.close()

    monkeypatch.setattr(server, "SCRAPER_DIR", str(tmp_path))
    monkeypatch.setitem(
        sys.modules,
        "db",
        types.SimpleNamespace(init_db=lambda _db_path: real_db.init_db(db_path)),
    )
    server._invalidate_results_cache()
    return server.app.test_client(), ordered_ids


def test_api_results_supports_optional_pagination(tmp_path, monkeypatch):
    client, ordered_ids = _build_client_with_temp_db(tmp_path, monkeypatch)

    resp = client.get("/api/results?limit=2&offset=1")
    data = resp.get_json()

    assert resp.status_code == 200
    assert [row["bien_id"] for row in data["resultats"]] == ordered_ids[1:]
    assert data["pagination"] == {
        "total": 3,
        "limit": 2,
        "offset": 1,
        "has_more": False,
    }


def test_api_results_supports_custom_missing_scan_threshold(tmp_path, monkeypatch):
    client, ordered_ids = _build_client_with_temp_db(tmp_path, monkeypatch)

    db_path = tmp_path / "biens.db"
    conn = real_db.init_db(db_path)
    conn.execute(
        "UPDATE biens SET missing_scan_count = ? WHERE id = ?",
        (server.HIDE_AFTER_MISSING_SCANS, ordered_ids[-1]),
    )
    conn.commit()
    conn.close()
    server._invalidate_results_cache()

    default_resp = client.get("/api/results")
    relaxed_resp = client.get("/api/results?missing_scan_threshold=0")

    assert [row["bien_id"] for row in default_resp.get_json()["resultats"]] == ordered_ids[:-1]
    assert [row["bien_id"] for row in relaxed_resp.get_json()["resultats"]] == ordered_ids


def test_api_results_rejects_invalid_missing_scan_threshold(tmp_path, monkeypatch):
    client, _ = _build_client_with_temp_db(tmp_path, monkeypatch)

    resp = client.get("/api/results?missing_scan_threshold=-1")

    assert resp.status_code == 400
    assert resp.get_json()["error"] == "invalid_missing_scan_threshold"


def test_api_results_rejects_offset_without_limit():
    client = server.app.test_client()

    resp = client.get("/api/results?offset=1")

    assert resp.status_code == 400
    assert resp.get_json()["error"] == "invalid_offset_without_limit"


def test_api_version_reads_version_file():
    client = server.app.test_client()

    resp = client.get("/api/version")

    assert resp.status_code == 200
    expected = (Path(server.STATIC_DIR) / "VERSION").read_text(encoding="utf-8").strip()
    assert resp.get_json() == {"version": expected}


def test_read_results_uses_short_cache(monkeypatch):
    calls = []
    server._invalidate_results_cache()

    monkeypatch.setattr(server, "SCRAPER_DIR", "C:/ignored")
    monkeypatch.setattr(server, "_get_results_db_signature", lambda _db_path: {"db": (1, 1), "wal": None})

    def fake_query(_db_path, limit=None, offset=0, missing_scan_threshold=server.HIDE_AFTER_MISSING_SCANS):
        calls.append((limit, offset, missing_scan_threshold))
        return {
            "resultats": [{"bien_id": 1}],
            "stats": {"nouvelles": 1},
            "generated_at": "2026-01-01T00:00:00",
            "pagination": {"total": 1, "limit": limit, "offset": offset, "has_more": False},
        }

    monkeypatch.setattr(server, "_query_results_data", fake_query)

    first = server._read_results(limit=50, offset=0, missing_scan_threshold=3)
    second = server._read_results(limit=50, offset=0, missing_scan_threshold=3)
    third = server._read_results(limit=50, offset=0, missing_scan_threshold=0)

    assert first == second
    assert third == first
    assert calls == [(50, 0, 3), (50, 0, 0)]


def test_api_ignore_les_biens_masques_apres_plusieurs_scans_manques(tmp_path, monkeypatch):
    db_path = tmp_path / "biens.db"
    conn = real_db.init_db(db_path)

    visible_id = inserer_bien({
        "site": "leboncoin",
        "url": "https://example.test/visible",
        "titre": "Bien visible",
        "description": "",
        "prix": 95000,
        "surface": 44,
        "type_bien": "appartement",
        "ville": "Vierzon",
        "code_postal": "18100",
        "dpe": "d",
    }, "fp-visible", conn, commit=False)
    inserer_annonce(visible_id, {
        "nb_pieces": 2,
        "travaux": False,
        "travaux_montant": 0,
        "immeuble_rapport": False,
        "deja_loue": True,
        "loyer_actuel": 720,
        "meuble": False,
        "parking_garage": False,
        "chauffage": "gaz",
        "points_forts": [],
        "points_faibles": [],
        "resume_ia": "Visible",
        "loyer_estime": 720,
        "mensualite": 500,
        "cf_net": 120,
        "cf_apres_impot": 90,
        "renta_brute": 7.1,
        "renta_nette_nette": 5.0,
        "dscr": 1.2,
        "score": 88,
        "regime_optimal": "reel",
        "loyer_source": "annonce",
    }, conn, commit=False)

    hidden_id = inserer_bien({
        "site": "leboncoin",
        "url": "https://example.test/hidden",
        "titre": "Bien masqué",
        "description": "",
        "prix": 99000,
        "surface": 48,
        "type_bien": "appartement",
        "ville": "Vierzon",
        "code_postal": "18100",
        "dpe": "e",
    }, "fp-hidden", conn, commit=False)
    inserer_annonce(hidden_id, {
        "nb_pieces": 2,
        "travaux": False,
        "travaux_montant": 0,
        "immeuble_rapport": False,
        "deja_loue": True,
        "loyer_actuel": 730,
        "meuble": False,
        "parking_garage": False,
        "chauffage": "gaz",
        "points_forts": [],
        "points_faibles": [],
        "resume_ia": "Masqué",
        "loyer_estime": 730,
        "mensualite": 500,
        "cf_net": 110,
        "cf_apres_impot": 85,
        "renta_brute": 6.9,
        "renta_nette_nette": 4.8,
        "dscr": 1.1,
        "score": 75,
        "regime_optimal": "reel",
        "loyer_source": "annonce",
    }, conn, commit=False)

    pending_visible_id = inserer_bien({
        "site": "leboncoin",
        "url": "https://example.test/pending-visible",
        "titre": "Bien IA visible",
        "description": "",
        "prix": 80000,
        "surface": 40,
        "type_bien": "appartement",
        "ville": "Vierzon",
        "code_postal": "18100",
        "dpe": "d",
    }, "fp-pending-visible", conn, commit=False)
    pending_hidden_id = inserer_bien({
        "site": "leboncoin",
        "url": "https://example.test/pending-hidden",
        "titre": "Bien IA masqué",
        "description": "",
        "prix": 78000,
        "surface": 39,
        "type_bien": "appartement",
        "ville": "Vierzon",
        "code_postal": "18100",
        "dpe": "d",
    }, "fp-pending-hidden", conn, commit=False)

    conn.execute(
        "UPDATE biens SET missing_scan_count = ? WHERE id IN (?, ?)",
        (server.HIDE_AFTER_MISSING_SCANS, hidden_id, pending_hidden_id),
    )
    conn.commit()
    conn.close()

    monkeypatch.setattr(server, "SCRAPER_DIR", str(tmp_path))
    monkeypatch.setitem(
        sys.modules,
        "db",
        types.SimpleNamespace(init_db=lambda _db_path: real_db.init_db(db_path)),
    )
    server._invalidate_results_cache()

    client = server.app.test_client()

    results_resp = client.get("/api/results")
    pending_resp = client.get("/api/pending_count")
    hidden_detail_resp = client.get(f"/api/bien/{hidden_id}")
    visible_detail_resp = client.get(f"/api/bien/{visible_id}")

    assert results_resp.status_code == 200
    assert [row["bien_id"] for row in results_resp.get_json()["resultats"]] == [visible_id, pending_visible_id]
    assert results_resp.get_json()["pagination"]["total"] == 2
    assert pending_resp.get_json()["count"] == 1
    assert hidden_detail_resp.status_code == 404
    assert visible_detail_resp.status_code == 200
    assert pending_visible_id != pending_hidden_id


def test_portfolio_diagnostic_missing_config(monkeypatch, tmp_path):
    """Sans config.py (ANTHROPIC_API_KEY manquant), retourne 503."""
    app_client, conn = _build_client_with_temp_db(tmp_path, monkeypatch)
    import builtins
    real_import = builtins.__import__

    def mock_import(name, *args, **kwargs):
        if name == 'scraper.config':
            raise ImportError('no module')
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, '__import__', mock_import)
    resp = app_client.post(
        '/api/portfolio-diagnostic',
        data=json.dumps({'biens': []}),
        content_type='application/json'
    )
    assert resp.status_code == 503


def test_portfolio_diagnostic_empty_payload(monkeypatch, tmp_path):
    """Payload vide retourne 400."""
    app_client, conn = _build_client_with_temp_db(tmp_path, monkeypatch)

    import sys
    import types
    fake_config = types.ModuleType('scraper.config')
    fake_config.ANTHROPIC_API_KEY = 'test-key'
    monkeypatch.setitem(sys.modules, 'scraper.config', fake_config)

    resp = app_client.post(
        '/api/portfolio-diagnostic',
        data='',
        content_type='application/json'
    )
    assert resp.status_code == 400


def test_portfolio_diagnostic_success(monkeypatch, tmp_path):
    """Appel réussi retourne les recommandations."""
    app_client, conn = _build_client_with_temp_db(tmp_path, monkeypatch)

    import sys
    import types
    from unittest.mock import MagicMock

    fake_config = types.ModuleType('scraper.config')
    fake_config.ANTHROPIC_API_KEY = 'test-key'
    monkeypatch.setitem(sys.modules, 'scraper.config', fake_config)

    fake_content = MagicMock()
    fake_content.text = '{"recommendations": [{"title": "Test", "explanation": "Explication.", "action": "Action."}]}'
    fake_message = MagicMock()
    fake_message.content = [fake_content]
    fake_client_instance = MagicMock()
    fake_client_instance.messages.create.return_value = fake_message

    fake_anthropic = types.ModuleType('anthropic')
    fake_anthropic.Anthropic = MagicMock(return_value=fake_client_instance)
    monkeypatch.setitem(sys.modules, 'anthropic', fake_anthropic)

    resp = app_client.post(
        '/api/portfolio-diagnostic',
        data=json.dumps({'biens': [], 'profile': {'income': 50000, 'tmi': 30}}),
        content_type='application/json'
    )
    assert resp.status_code == 200
    data = resp.get_json()
    assert 'recommendations' in data
    assert isinstance(data['recommendations'], list)
    assert data['recommendations'][0]['title'] == 'Test'