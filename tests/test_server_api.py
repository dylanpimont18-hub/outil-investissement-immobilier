import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import server


def test_api_version_reads_version_file():
    client = server.app.test_client()

    resp = client.get("/api/version")

    assert resp.status_code == 200
    expected = (Path(server.STATIC_DIR) / "VERSION").read_text(encoding="utf-8").strip()
    assert resp.get_json() == {"version": expected}


# Diagnostic IA et Assistant chat : déplacés en Cloud Functions (functions/index.js,
# diagnosticPortefeuille / chatPortefeuille) le 2026-10-01 — les routes Flask n'existent plus.
def test_ai_routes_removed_from_flask():
    client = server.app.test_client()
    for path in ("/api/portfolio-diagnostic", "/api/portfolio-chat"):
        resp = client.post(path, json={})
        assert resp.status_code in (404, 405)
