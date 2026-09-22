import json
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import server


def test_api_version_reads_version_file():
    client = server.app.test_client()

    resp = client.get("/api/version")

    assert resp.status_code == 200
    expected = (Path(server.STATIC_DIR) / "VERSION").read_text(encoding="utf-8").strip()
    assert resp.get_json() == {"version": expected}


def test_portfolio_diagnostic_missing_config(monkeypatch):
    """Sans config.py (ANTHROPIC_API_KEY manquant), retourne 503."""
    import builtins
    real_import = builtins.__import__

    def mock_import(name, *args, **kwargs):
        if name == 'config':
            raise ImportError('no module')
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, '__import__', mock_import)
    client = server.app.test_client()
    resp = client.post(
        '/api/portfolio-diagnostic',
        data=json.dumps({'biens': []}),
        content_type='application/json'
    )
    assert resp.status_code == 503


def test_portfolio_diagnostic_empty_payload(monkeypatch):
    """Payload vide retourne 400."""
    fake_config = types.ModuleType('config')
    fake_config.ANTHROPIC_API_KEY = 'test-key'
    monkeypatch.setitem(sys.modules, 'config', fake_config)

    client = server.app.test_client()
    resp = client.post(
        '/api/portfolio-diagnostic',
        data='',
        content_type='application/json'
    )
    assert resp.status_code == 400


def test_portfolio_diagnostic_success(monkeypatch):
    """Appel réussi retourne les recommandations."""
    from unittest.mock import MagicMock

    fake_config = types.ModuleType('config')
    fake_config.ANTHROPIC_API_KEY = 'test-key'
    monkeypatch.setitem(sys.modules, 'config', fake_config)

    fake_content = MagicMock()
    fake_content.text = '{"recommendations": [{"title": "Test", "explanation": "Explication.", "action": "Action."}]}'
    fake_message = MagicMock()
    fake_message.content = [fake_content]
    fake_client_instance = MagicMock()
    fake_client_instance.messages.create.return_value = fake_message

    fake_anthropic = types.ModuleType('anthropic')
    fake_anthropic.Anthropic = MagicMock(return_value=fake_client_instance)
    monkeypatch.setitem(sys.modules, 'anthropic', fake_anthropic)

    client = server.app.test_client()
    resp = client.post(
        '/api/portfolio-diagnostic',
        data=json.dumps({'biens': [], 'profile': {'income': 50000, 'tmi': 30}}),
        content_type='application/json'
    )
    assert resp.status_code == 200
    data = resp.get_json()
    assert 'recommendations' in data
    assert isinstance(data['recommendations'], list)
    assert data['recommendations'][0]['title'] == 'Test'
