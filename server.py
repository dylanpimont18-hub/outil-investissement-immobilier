import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path

# Forcer UTF-8 sur stdout pour éviter les erreurs charmap sur Windows (cp1252)
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from flask import Flask, jsonify, request, send_from_directory
from werkzeug.utils import secure_filename

app = Flask(__name__)

STATIC_DIR = os.path.dirname(os.path.abspath(__file__))


ALLOWED_ORIGINS = {
    "http://127.0.0.1:8080",
    "http://localhost:8080",
}


def _add_cors(response):
    origin = request.headers.get("Origin")
    if origin in ALLOWED_ORIGINS:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Vary"] = "Origin"
    return response


@app.after_request
def after_request(response):
    if request.path.startswith("/api/"):
        _add_cors(response)
    return response


@app.route('/api/portfolio-diagnostic', methods=['POST'])
def api_portfolio_diagnostic():
    try:
        from config import MAMMOUTH_API_KEY
    except (ImportError, AttributeError):
        return jsonify({'error': 'Clé API non configurée dans config.py'}), 503

    payload = request.get_json(silent=True)
    if not payload:
        return jsonify({'error': 'Payload JSON manquant'}), 400

    prompt_user = (
        "Voici les données d'un bien immobilier locatif détenu :\n\n"
        + json.dumps(payload, ensure_ascii=False, indent=2)
        + "\n\nProduis entre 3 et 5 recommandations priorisées, actionnables, en français naturel. "
        "Chaque recommandation doit avoir : un titre court, une explication de 2 à 4 phrases qui justifie "
        "le conseil avec des chiffres précis issus des données, et une action concrète à mener. "
        "Priorise les sujets fiscaux (régime, travaux déductibles), les risques de cash-flow (CF négatif, DSCR bas), "
        "et les optimisations. "
        "Réponds uniquement avec du JSON valide, sans texte avant ou après, au format : "
        '{"recommendations": [{"title": "...", "explanation": "...", "action": "..."}]}'
    )

    try:
        import requests
        resp = requests.post(
            'https://api.mammouth.ai/v1/chat/completions',
            headers={
                'content-type': 'application/json',
                'authorization': f'Bearer {MAMMOUTH_API_KEY}',
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
            },
            json={
                'model': 'gpt-4o',
                'response_format': {'type': 'json_object'},
                'messages': [
                    {
                        'role': 'system',
                        'content': (
                            "Tu es un conseiller en investissement immobilier locatif français expert en fiscalité foncière. "
                            "Tu réponds uniquement en JSON valide, sans markdown ni texte hors JSON."
                        ),
                    },
                    {'role': 'user', 'content': prompt_user},
                ],
            },
            timeout=60,
        )
        if not resp.ok:
            return jsonify({'error': f'Erreur IA ({resp.status_code})'}), 502
        raw = resp.json()['choices'][0]['message']['content'].strip()
        result = json.loads(raw)
        return jsonify(result)
    except json.JSONDecodeError as e:
        return jsonify({'error': f'Réponse IA non parsable : {str(e)}'}), 502
    except Exception as e:
        return jsonify({'error': str(e)}), 502


ASSISTANT_SYSTEM_PROMPT = (
    "Tu es l'assistant investissement immobilier locatif de Spark Investissement, un conseiller français "
    "expert en fiscalité foncière, financement bancaire et gestion locative. "
    "Tu réponds UNIQUEMENT à des questions liées à l'investissement immobilier locatif de l'utilisateur : "
    "analyse de son portefeuille, fiscalité, financement, négociation bancaire, rédaction de courriers ou "
    "emails (ex. à un banquier, un notaire, un locataire), stratégie patrimoniale. "
    "Si une question sort de ce cadre, décline poliment et recentre sur l'investissement immobilier. "
    "Réponds en français naturel, de façon concise et actionnable, en t'appuyant sur les chiffres précis du "
    "contexte fourni ci-dessous quand c'est pertinent. Pas de markdown superflu, du texte simple adapté à un "
    "email ou une explication directe selon la demande."
)
ASSISTANT_MAX_MESSAGES = 40


@app.route('/api/portfolio-chat', methods=['POST'])
def api_portfolio_chat():
    try:
        from config import MAMMOUTH_API_KEY
    except (ImportError, AttributeError):
        return jsonify({'error': 'Clé API non configurée dans config.py'}), 503

    payload = request.get_json(silent=True)
    if not payload:
        return jsonify({'error': 'Payload JSON manquant'}), 400

    messages = payload.get('messages')
    if not isinstance(messages, list) or not messages:
        return jsonify({'error': 'Historique de conversation manquant'}), 400
    if len(messages) > ASSISTANT_MAX_MESSAGES:
        return jsonify({'error': 'Conversation trop longue'}), 400
    for m in messages:
        if not isinstance(m, dict) or m.get('role') not in ('user', 'assistant') or not isinstance(m.get('content'), str):
            return jsonify({'error': 'Message invalide'}), 400

    contexte = payload.get('contextePortefeuille')
    system_content = ASSISTANT_SYSTEM_PROMPT
    if contexte:
        system_content += (
            "\n\nContexte actuel du portefeuille de l'utilisateur (données à jour, utilise-les pour "
            "personnaliser tes réponses) :\n" + json.dumps(contexte, ensure_ascii=False, indent=2)
        )

    try:
        import requests
        resp = requests.post(
            'https://api.mammouth.ai/v1/chat/completions',
            headers={
                'content-type': 'application/json',
                'authorization': f'Bearer {MAMMOUTH_API_KEY}',
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
            },
            json={
                'model': 'gpt-4o',
                'messages': [{'role': 'system', 'content': system_content}] + messages,
            },
            timeout=60,
        )
        if not resp.ok:
            return jsonify({'error': f'Erreur IA ({resp.status_code})'}), 502
        reply = resp.json()['choices'][0]['message']['content'].strip()
        return jsonify({'reply': reply})
    except Exception as e:
        return jsonify({'error': str(e)}), 502


EXPORTS_DIR = Path(os.path.dirname(os.path.abspath(__file__))) / "exports"


def _ensure_exports_dir():
    EXPORTS_DIR.mkdir(exist_ok=True)


DOCUMENTS_DIR = Path(os.path.dirname(os.path.abspath(__file__))) / "documents"
_SAFE_ID_RE = re.compile(r"^[A-Za-z0-9_-]+$")


def _safe_bien_id(bien_id: str) -> bool:
    return bool(bien_id) and bool(_SAFE_ID_RE.match(bien_id))


@app.route("/api/documents/<bien_id>/<filename>", methods=["GET"])
def api_documents_get(bien_id, filename):
    """Lecture seule : ne sert plus qu'à relire les anciens PDF locaux pendant la migration
    ponctuelle vers Firebase Storage (owned-portfolio.js, bouton "Importer vers le cloud").
    L'upload/la suppression se font désormais directement depuis le client vers Storage."""
    if not _safe_bien_id(bien_id):
        return jsonify({"error": "invalid_bien_id"}), 400
    safe_filename = secure_filename(filename)
    if safe_filename != filename or not filename.lower().endswith(".pdf"):
        return jsonify({"error": "invalid_filename"}), 400

    bien_dir = DOCUMENTS_DIR / bien_id
    if not (bien_dir / filename).exists():
        return jsonify({"error": "not_found"}), 404
    return send_from_directory(bien_dir, filename, mimetype="application/pdf")


@app.route("/api/portfolio/export", methods=["POST"])
def api_portfolio_export():
    data = request.get_json(force=True, silent=True) or {}
    portfolio = data.get("portfolio")
    if portfolio is None:
        return jsonify({"error": "portfolio_missing"}), 400
    _ensure_exports_dir()
    date_str = datetime.now().strftime("%Y-%m-%d")
    filename = f"portefeuille-{date_str}.json"
    dest = EXPORTS_DIR / filename
    counter = 1
    while dest.exists():
        dest = EXPORTS_DIR / f"portefeuille-{date_str}-{counter}.json"
        counter += 1
    dest.write_text(json.dumps(portfolio, ensure_ascii=False, indent=2), encoding="utf-8")
    return jsonify({"filename": dest.name, "path": str(dest)})


@app.route("/api/portfolio/import/list", methods=["GET"])
def api_portfolio_import_list():
    _ensure_exports_dir()
    files = sorted(
        [f.name for f in EXPORTS_DIR.glob("*.json")],
        reverse=True
    )
    return jsonify({"files": files})


@app.route("/api/portfolio/import", methods=["POST"])
def api_portfolio_import():
    data = request.get_json(force=True, silent=True) or {}
    filename = (data.get("filename") or "").strip()
    if not filename or "/" in filename or "\\" in filename or not filename.endswith(".json"):
        return jsonify({"error": "invalid_filename"}), 400
    _ensure_exports_dir()
    path = EXPORTS_DIR / filename
    if not path.exists():
        return jsonify({"error": "not_found"}), 404
    try:
        content = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return jsonify({"error": "parse_error"}), 422
    return jsonify({"portfolio": content})


_pdf_html_store: dict = {}


def _find_edge() -> str | None:
    """Retourne le chemin de msedge.exe s'il est disponible."""
    candidates = [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    ]
    for c in candidates:
        if Path(c).exists():
            return c
    try:
        import subprocess as _sp
        res = _sp.run(["where", "msedge"], capture_output=True, text=True, timeout=5)
        if res.returncode == 0:
            line = res.stdout.strip().splitlines()[0].strip()
            if line and Path(line).exists():
                return line
    except Exception:
        pass
    return None


@app.route("/api/pdf-preview/<token>")
def pdf_preview(token: str):
    """Sert le HTML brut une seule fois pour la capture Edge headless."""
    html = _pdf_html_store.pop(token, None)
    if html is None:
        return "Not found", 404
    return html, 200, {"Content-Type": "text/html; charset=utf-8"}


@app.route("/api/generate-pdf", methods=["POST"])
def api_generate_pdf():
    import subprocess
    import tempfile
    import uuid

    data = request.get_json(force=True, silent=True) or {}
    html_content = data.get("html", "")
    filename = secure_filename(data.get("filename") or "export.pdf") or "export.pdf"
    if not filename.lower().endswith(".pdf"):
        filename += ".pdf"
    if not html_content:
        return jsonify({"error": "html manquant"}), 400

    edge_exe = _find_edge()
    if not edge_exe:
        return jsonify({"error": "Microsoft Edge introuvable sur ce système"}), 500

    token = str(uuid.uuid4())
    _pdf_html_store[token] = html_content
    preview_url = f"http://127.0.0.1:8080/api/pdf-preview/{token}"

    # Destination : dossier Téléchargements de l'utilisateur
    import os as _os
    downloads_dir = Path(_os.path.expanduser("~")) / "Downloads"
    downloads_dir.mkdir(exist_ok=True)
    # Éviter d'écraser un fichier existant
    dest = downloads_dir / filename
    stem = dest.stem
    suffix = dest.suffix
    counter = 1
    while dest.exists():
        dest = downloads_dir / f"{stem} ({counter}){suffix}"
        counter += 1

    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            pdf_path = Path(tmpdir) / filename
            subprocess.run(
                [
                    edge_exe,
                    "--headless=new",
                    "--disable-gpu",
                    "--no-sandbox",
                    f"--print-to-pdf={pdf_path}",
                    "--no-pdf-header-footer",
                    preview_url,
                ],
                capture_output=True,
                timeout=30,
            )
            # Edge spawne des processus enfants qui finissent après le processus principal.
            # On attend jusqu'à 5 s que le fichier soit effectivement écrit.
            import time as _time
            for _ in range(50):
                if pdf_path.exists() and pdf_path.stat().st_size > 0:
                    break
                _time.sleep(0.1)
            if not pdf_path.exists() or pdf_path.stat().st_size == 0:
                return jsonify({"error": "Edge n'a pas généré le PDF (fichier vide ou absent)"}), 500
            dest.write_bytes(pdf_path.read_bytes())
    except subprocess.TimeoutExpired:
        _pdf_html_store.pop(token, None)
        return jsonify({"error": "Délai dépassé lors de la génération du PDF"}), 500
    except Exception as exc:
        _pdf_html_store.pop(token, None)
        return jsonify({"error": str(exc)}), 500

    return jsonify({"saved_to": str(dest), "filename": dest.name})


@app.route("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")


@app.route("/api/version")
def api_version():
    try:
        version = (Path(STATIC_DIR) / "VERSION").read_text(encoding="utf-8").strip()
    except OSError:
        version = "dev"
    return jsonify({"version": version})


@app.route("/<path:filename>")
def static_files(filename):
    return send_from_directory(STATIC_DIR, filename)


if __name__ == "__main__":
    print("Spark Investissement — http://localhost:8080")
    app.run(host="127.0.0.1", port=8080, debug=False, use_reloader=False, threaded=True)
