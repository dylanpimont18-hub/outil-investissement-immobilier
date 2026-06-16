import json
import os
import sys
import threading
import time
from datetime import datetime
from pathlib import Path

# Forcer UTF-8 sur stdout pour éviter les erreurs charmap sur Windows (cp1252)
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from flask import Flask, jsonify, request, send_from_directory

app = Flask(__name__)

SCRAPER_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "scraper")
STATIC_DIR = os.path.dirname(os.path.abspath(__file__))
RESULTS_MAX_LIMIT = 1000
RESULTS_CACHE_TTL_SECONDS = 5.0
RESULTS_CACHE_MAX_ENTRIES = 32
HIDE_AFTER_MISSING_SCANS = 3
MAX_HIDE_AFTER_MISSING_SCANS = 100

_lock = threading.Lock()
_results_cache_lock = threading.Lock()
_results_cache = {}
scan_state = {
    "running": False,
    "progress": 0,
    "logs": [],
    "last_run": None,
    "error": None,
}


def _add_cors(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    return response


def _invalidate_results_cache():
    with _results_cache_lock:
        _results_cache.clear()


def _prune_results_cache_locked(now_monotonic: float):
    expired_keys = [
        key for key, entry in _results_cache.items()
        if entry["expires_at"] <= now_monotonic
    ]
    for key in expired_keys:
        _results_cache.pop(key, None)

    overflow = len(_results_cache) - RESULTS_CACHE_MAX_ENTRIES
    if overflow <= 0:
        return

    oldest_keys = [
        key for key, _ in sorted(
            _results_cache.items(),
            key=lambda item: item[1]["expires_at"],
        )[:overflow]
    ]
    for key in oldest_keys:
        _results_cache.pop(key, None)


def _get_path_signature(path: Path):
    if not path.exists():
        return None
    stat = path.stat()
    return (stat.st_mtime_ns, stat.st_size)


def _get_results_db_signature(db_path: Path):
    wal_path = Path(f"{db_path}-wal")
    return {
        "db": _get_path_signature(db_path),
        "wal": _get_path_signature(wal_path),
    }


def _parse_results_window():
    limit_raw = (request.args.get("limit") or "").strip()
    offset_raw = (request.args.get("offset") or "").strip()

    limit = None
    offset = 0

    if limit_raw:
        try:
            limit = int(limit_raw)
        except ValueError as exc:
            raise ValueError("invalid_limit") from exc
        if limit < 1 or limit > RESULTS_MAX_LIMIT:
            raise ValueError("invalid_limit")

    if offset_raw:
        try:
            offset = int(offset_raw)
        except ValueError as exc:
            raise ValueError("invalid_offset") from exc
        if offset < 0:
            raise ValueError("invalid_offset")
        if limit is None and offset != 0:
            raise ValueError("invalid_offset_without_limit")

    return limit, offset


def _parse_missing_scan_threshold():
    threshold_raw = (request.args.get("missing_scan_threshold") or "").strip()
    if not threshold_raw:
        return HIDE_AFTER_MISSING_SCANS

    try:
        threshold = int(threshold_raw)
    except ValueError as exc:
        raise ValueError("invalid_missing_scan_threshold") from exc

    if threshold < 0 or threshold > MAX_HIDE_AFTER_MISSING_SCANS:
        raise ValueError("invalid_missing_scan_threshold")

    return threshold


def _build_missing_scan_visibility_clause(alias: str, threshold: int):
    if threshold <= 0:
        return "", []
    return f"COALESCE({alias}.missing_scan_count, 0) < ?", [threshold]


_UNSET = object()


def _update_state(running=None, progress=None, log=None, error=_UNSET, finished=False):
    with _lock:
        if running is not None:
            scan_state["running"] = running
        if progress is not None:
            scan_state["progress"] = progress
        if log is not None:
            scan_state["logs"].append(f"[{datetime.now().strftime('%H:%M:%S')}] {log}")
            scan_state["logs"] = scan_state["logs"][-50:]
        if error is not _UNSET:
            scan_state["error"] = error
        if finished:
            scan_state["running"] = False
            scan_state["last_run"] = datetime.now().isoformat(timespec="seconds")


def _run_enrich():
    if SCRAPER_DIR not in sys.path:
        sys.path.insert(0, SCRAPER_DIR)

    try:
        import importlib
        import enrich as scraper_enrich
        importlib.reload(scraper_enrich)

        import db as scraper_db
        scraper_db.DB_PATH = Path(SCRAPER_DIR) / "biens.db"

        db_path = Path(SCRAPER_DIR) / "biens.db"
        if not db_path.exists():
            _update_state(log="Aucune base de données — lancez d'abord un scan.", finished=True)
            return

        def progress_callback(pct: int, msg: str):
            _update_state(progress=pct, log=msg)

        _invalidate_results_cache()
        _update_state(running=True, progress=0, log="Analyse IA lancée…", error=None)
        conn = scraper_db.init_db(db_path)
        scraper_enrich.enrich_pending(conn=conn, progress_callback=progress_callback)
        _invalidate_results_cache()
        _update_state(finished=True)
    except Exception as e:
        _invalidate_results_cache()
        _update_state(log=f"ERREUR : {e}", error=str(e), finished=True)


def _run_scanner(full: bool, ville: str = None, code_postal: str = None, rayon_km: float = None):
    if SCRAPER_DIR not in sys.path:
        sys.path.insert(0, SCRAPER_DIR)

    try:
        import importlib

        # Purge all cached scraper sub-modules so file edits take effect without restart
        for mod_name in list(sys.modules.keys()):
            if mod_name in ("main", "db", "filtrage", "ia", "calculs", "utils",
                            "marche_locatif", "fingerprint", "enrich",
                            "scrapers", "logger") or mod_name.startswith("scrapers."):
                del sys.modules[mod_name]

        import main as scraper_main

        # Patch DB path to scraper dir
        import db as scraper_db
        scraper_db.DB_PATH = Path(SCRAPER_DIR) / "biens.db"

        if full:
            db_path = Path(SCRAPER_DIR) / "biens.db"
            if db_path.exists():
                db_path.unlink()
            _invalidate_results_cache()
            _update_state(log="Base de données réinitialisée.")

        def progress_callback(pct: int, msg: str):
            _update_state(progress=pct, log=msg)

        villes_override = [{"ville": ville, "code_postal": code_postal, "dept": (code_postal or "")[:2]}]
        if rayon_km:
            villes_override[0]["rayon_km"] = rayon_km
        _invalidate_results_cache()
        _update_state(running=True, progress=0, log="Scan lancé…", error=None)
        scraper_main.main(
            villes_override=villes_override,
            progress_callback=progress_callback,
            force_marche=True,
        )
        _invalidate_results_cache()
        _update_state(finished=True)
    except Exception as e:
        _invalidate_results_cache()
        _update_state(log=f"ERREUR : {e}", error=str(e), finished=True)


def _query_results_data(
    db_path: Path,
    limit: int | None = None,
    offset: int = 0,
    missing_scan_threshold: int = HIDE_AFTER_MISSING_SCANS,
):
    """Lit la base SQLite du scraper et retourne le JSON attendu par le frontend."""
    if SCRAPER_DIR not in sys.path:
        sys.path.insert(0, SCRAPER_DIR)

    import db as scraper_db
    if not db_path.exists():
        return None

    conn = scraper_db.init_db(db_path)
    try:
        visible_clause, visible_params = _build_missing_scan_visibility_clause("biens", missing_scan_threshold)

        total_query = "SELECT COUNT(*) AS n FROM biens"
        if visible_clause:
            total_query += f" WHERE {visible_clause}"

        total_row = conn.execute(total_query, visible_params).fetchone()
        total = total_row["n"] if total_row else 0
        if total == 0:
            return None

        stats_query = """
            SELECT
                COUNT(*) AS nouvelles,
                COALESCE(SUM(CASE WHEN COALESCE(a.cf_net, 0) > 0 THEN 1 ELSE 0 END), 0) AS positifs,
                MAX(a.cf_net) AS meilleur_cf,
                MAX(a.cf_apres_impot) AS meilleur_cf_apres_impot,
                MAX(a.renta_brute) AS meilleur_renta,
                CASE WHEN COUNT(a.score) = 0 THEN NULL ELSE ROUND(AVG(a.score)) END AS score_moyen,
                COALESCE(SUM(CASE WHEN LOWER(COALESCE(b.dpe, '')) IN ('f', 'g') THEN 1 ELSE 0 END), 0) AS dpe_risque
            FROM biens b
            LEFT JOIN annonces a ON a.bien_id = b.id
        """
        visible_clause, visible_params = _build_missing_scan_visibility_clause("b", missing_scan_threshold)
        if visible_clause:
            stats_query += f"\n            WHERE {visible_clause}"
        stats_row = conn.execute(stats_query, visible_params).fetchone()

        query = """
            SELECT
                b.id AS bien_id,
                b.prix, b.surface, b.type_bien, b.ville, b.code_postal,
                b.dpe, b.titre, b.url, b.site, b.date_derniere_vue,
                a.cf_net, a.cf_apres_impot,
                a.regime_optimal, a.loyer_source,
                a.renta_brute, a.renta_nette_nette,
                a.dscr, a.score, a.loyer_estime, a.mensualite,
                a.resume_ia, a.points_faibles,
                a.nb_pieces, a.travaux, a.travaux_montant,
                a.immeuble_rapport, a.deja_loue, a.loyer_actuel,
                a.meuble, a.parking_garage, a.chauffage,
                a.date_enrichissement,
                CASE WHEN a.id IS NULL THEN 0 ELSE 1 END AS ia_enrichi,
                (SELECT hp.prix_ancien - b.prix
                   FROM historique_prix hp WHERE hp.bien_id = b.id AND hp.prix_ancien > b.prix
                   ORDER BY hp.prix_ancien - b.prix DESC LIMIT 1) AS baisse,
                (SELECT hp.date_changement
                   FROM historique_prix hp WHERE hp.bien_id = b.id AND hp.prix_ancien > b.prix
                   ORDER BY hp.prix_ancien - b.prix DESC LIMIT 1) AS date_baisse
            FROM biens b
            LEFT JOIN annonces a ON a.bien_id = b.id
        """
        params = []
        if visible_clause:
            query += f"\n            WHERE {visible_clause}"
            params.extend(visible_params)

        query += "\n            ORDER BY a.score DESC NULLS LAST, b.prix ASC"
        if limit is not None:
            query += " LIMIT ? OFFSET ?"
            params.extend([limit, offset])

        rows = conn.execute(query, params).fetchall()
    finally:
        conn.close()

    resultats = [dict(r) for r in rows]

    stats = {
        "nouvelles":               stats_row["nouvelles"],
        "positifs":                stats_row["positifs"],
        "pct_positifs":            round(stats_row["positifs"] / total * 100, 1) if total else 0,
        "meilleur_cf":             stats_row["meilleur_cf"],
        "meilleur_cf_apres_impot": stats_row["meilleur_cf_apres_impot"],
        "meilleur_renta":          stats_row["meilleur_renta"],
        "score_moyen":             stats_row["score_moyen"],
        "dpe_risque":              stats_row["dpe_risque"] or None,
    }

    return {
        "resultats":    resultats,
        "stats":        stats,
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "pagination":   {
            "total": total,
            "limit": limit,
            "offset": offset,
            "has_more": limit is not None and (offset + len(resultats)) < total,
        },
    }


def _read_results(
    limit: int | None = None,
    offset: int = 0,
    missing_scan_threshold: int = HIDE_AFTER_MISSING_SCANS,
):
    db_path = Path(SCRAPER_DIR) / "biens.db"
    cache_key = (limit, offset, missing_scan_threshold)
    signature_before = _get_results_db_signature(db_path)
    now_monotonic = time.monotonic()

    with _results_cache_lock:
        _prune_results_cache_locked(now_monotonic)
        entry = _results_cache.get(cache_key)
        if entry and entry["signature"] == signature_before and entry["expires_at"] > now_monotonic:
            return entry["data"]

    data = _query_results_data(
        db_path,
        limit=limit,
        offset=offset,
        missing_scan_threshold=missing_scan_threshold,
    )
    signature_after = _get_results_db_signature(db_path)
    if signature_before != signature_after:
        return data

    with _results_cache_lock:
        _prune_results_cache_locked(time.monotonic())
        _results_cache[cache_key] = {
            "signature": signature_after,
            "expires_at": time.monotonic() + RESULTS_CACHE_TTL_SECONDS,
            "data": data,
        }
    return data


def _read_bien_detail(
    bien_id: int,
    missing_scan_threshold: int = HIDE_AFTER_MISSING_SCANS,
):
    if SCRAPER_DIR not in sys.path:
        sys.path.insert(0, SCRAPER_DIR)

    import db as scraper_db
    db_path = Path(SCRAPER_DIR) / "biens.db"
    if not db_path.exists():
        return None

    conn = scraper_db.init_db(db_path)
    try:
        visible_clause, visible_params = _build_missing_scan_visibility_clause("b", missing_scan_threshold)

        query = """
            SELECT
                b.id AS bien_id,
                b.description,
                a.cf_apres_impot_micro,
                a.cf_apres_impot_reel,
                a.cf_apres_impot_sci,
                a.points_forts
            FROM biens b
            LEFT JOIN annonces a ON a.bien_id = b.id
            WHERE b.id = ?
        """
        params = [bien_id]
        if visible_clause:
            query += f"\n              AND {visible_clause}"
            params.extend(visible_params)
        query += "\n            LIMIT 1"
        row = conn.execute(query, params).fetchone()
    finally:
        conn.close()

    return dict(row) if row else None


def _read_marche(ville: str = None, code_postal: str = None):
    """Retourne les loyers médians depuis loyers_marche pour une ville donnée."""
    if SCRAPER_DIR not in sys.path:
        sys.path.insert(0, SCRAPER_DIR)

    import db as scraper_db
    db_path = Path(SCRAPER_DIR) / "biens.db"
    if not db_path.exists():
        return []

    conn = scraper_db.init_db(db_path)
    try:
        if code_postal:
            rows = conn.execute("""
                SELECT ville, code_postal, type_bien, nb_pieces,
                       surface_min, surface_max, loyer_median, nb_annonces, date_collecte
                FROM loyers_marche
                WHERE code_postal = ?
                ORDER BY type_bien, nb_pieces, surface_min
            """, (code_postal,)).fetchall()
        else:
            rows = conn.execute("""
                SELECT ville, code_postal, type_bien, nb_pieces,
                       surface_min, surface_max, loyer_median, nb_annonces, date_collecte
                FROM loyers_marche
                ORDER BY ville, type_bien, nb_pieces, surface_min
            """).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


@app.after_request
def after_request(response):
    if request.path.startswith("/api/"):
        _add_cors(response)
    return response


@app.route("/api/scan", methods=["POST"])
def api_scan():
    data = request.get_json(force=True, silent=True) or {}
    ville = (data.get("ville") or "").strip()
    code_postal = (data.get("code_postal") or "").strip()
    rayon_km = data.get("rayon_km")
    if isinstance(rayon_km, (int, float)) and 0 < rayon_km <= 100:
        rayon_km = float(rayon_km)
    else:
        rayon_km = None
    if not ville or not code_postal:
        return jsonify({"error": "ville_required"}), 400

    with _lock:
        if scan_state["running"]:
            return jsonify({"error": "scan_running"}), 409
        scan_state["logs"] = []

    t = threading.Thread(target=_run_scanner, args=(False, ville, code_postal, rayon_km), daemon=True)
    t.start()
    return jsonify({"started": True})


@app.route("/api/scan/full", methods=["POST"])
def api_scan_full():
    data = request.get_json(force=True, silent=True) or {}
    ville = (data.get("ville") or "").strip()
    code_postal = (data.get("code_postal") or "").strip()
    rayon_km = data.get("rayon_km")
    if isinstance(rayon_km, (int, float)) and 0 < rayon_km <= 100:
        rayon_km = float(rayon_km)
    else:
        rayon_km = None
    if not ville or not code_postal:
        return jsonify({"error": "ville_required"}), 400

    with _lock:
        if scan_state["running"]:
            return jsonify({"error": "scan_running"}), 409
        scan_state["logs"] = []

    t = threading.Thread(target=_run_scanner, args=(True, ville, code_postal, rayon_km), daemon=True)
    t.start()
    return jsonify({"started": True, "db_cleared": True})


@app.route("/api/enrich", methods=["POST"])
def api_enrich():
    with _lock:
        if scan_state["running"]:
            return jsonify({"error": "scan_running"}), 409
        scan_state["logs"] = []

    t = threading.Thread(target=_run_enrich, daemon=True)
    t.start()
    return jsonify({"started": True})


@app.route("/api/pending_count", methods=["GET"])
def api_pending_count():
    db_path = Path(SCRAPER_DIR) / "biens.db"
    if not db_path.exists():
        return jsonify({"count": 0})

    if SCRAPER_DIR not in sys.path:
        sys.path.insert(0, SCRAPER_DIR)
    import db as scraper_db
    conn = scraper_db.init_db(db_path)
    try:
        missing_scan_threshold = _parse_missing_scan_threshold()
        visible_clause, visible_params = _build_missing_scan_visibility_clause("b", missing_scan_threshold)

        query = """
            SELECT COUNT(*) AS n FROM biens b
            LEFT JOIN annonces a ON a.bien_id = b.id
            WHERE a.id IS NULL
        """
        if visible_clause:
            query += f"\n              AND {visible_clause}"
        row = conn.execute(query, visible_params).fetchone()
        return jsonify({"count": row["n"] if row else 0})
    finally:
        conn.close()


@app.route("/api/status", methods=["GET"])
def api_status():
    with _lock:
        state = dict(scan_state)
        state["logs"] = list(scan_state["logs"])
    return jsonify(state)


@app.route("/api/results", methods=["GET"])
def api_results():
    try:
        limit, offset = _parse_results_window()
        missing_scan_threshold = _parse_missing_scan_threshold()
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    data = _read_results(
        limit=limit,
        offset=offset,
        missing_scan_threshold=missing_scan_threshold,
    )
    if data is None:
        return jsonify({"results": None})
    return jsonify(data)


@app.route("/api/bien/<int:bien_id>", methods=["GET"])
def api_bien_detail(bien_id: int):
    try:
        missing_scan_threshold = _parse_missing_scan_threshold()
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    data = _read_bien_detail(bien_id, missing_scan_threshold=missing_scan_threshold)
    if data is None:
        return jsonify({"error": "not_found"}), 404
    return jsonify(data)


@app.route("/api/marche", methods=["GET"])
def api_marche():
    ville = (request.args.get("ville") or "").strip() or None
    code_postal = (request.args.get("code_postal") or "").strip() or None
    rows = _read_marche(ville=ville, code_postal=code_postal)
    return jsonify({"rows": rows})


@app.route("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")


@app.route("/<path:filename>")
def static_files(filename):
    return send_from_directory(STATIC_DIR, filename)


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
    conn = scraper_db.init_db(db_path)
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


@app.route('/api/portfolio-diagnostic', methods=['POST'])
def api_portfolio_diagnostic():
    try:
        from scraper.config import ANTHROPIC_API_KEY
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
        import anthropic
        client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
        message = client.messages.create(
            model='claude-sonnet-4-6',
            max_tokens=1024,
            system=(
                "Tu es un conseiller en investissement immobilier locatif français expert en fiscalité foncière. "
                "Tu réponds uniquement en JSON valide, sans markdown ni texte hors JSON."
            ),
            messages=[{'role': 'user', 'content': prompt_user}]
        )
        raw = message.content[0].text.strip()
        result = json.loads(raw)
        return jsonify(result)
    except json.JSONDecodeError as e:
        return jsonify({'error': f'Réponse IA non parsable : {str(e)}'}), 502
    except Exception as e:
        return jsonify({'error': str(e)}), 502


EXPORTS_DIR = Path(os.path.dirname(os.path.abspath(__file__))) / "exports"


def _ensure_exports_dir():
    EXPORTS_DIR.mkdir(exist_ok=True)


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
    from flask import Response as FlaskResponse

    data = request.get_json(force=True, silent=True) or {}
    html_content = data.get("html", "")
    filename = data.get("filename", "export.pdf")
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


@app.route('/api/loyer-marche', methods=['POST'])
def api_loyer_marche():
    if SCRAPER_DIR not in sys.path:
        sys.path.insert(0, SCRAPER_DIR)
    import db as scraper_db
    from calculs import get_loyer_marche

    body = request.get_json(silent=True) or {}
    ville = body.get('ville', '')
    type_bien = body.get('type_bien', 'appartement')
    surface = body.get('surface')

    if not ville or surface is None:
        return jsonify({'error': 'ville et surface requis'}), 400

    db_path = Path(SCRAPER_DIR) / 'biens.db'
    if not db_path.exists():
        return jsonify({'error': 'Base de données scraper introuvable'}), 404

    conn = scraper_db.init_db(db_path)
    try:
        result = get_loyer_marche(ville, type_bien, float(surface), conn)
        if result is None:
            return jsonify({'error': 'Aucune donnée de marché disponible pour ces critères'}), 404
        loyer_median, nb_samples = result
        return jsonify({'loyerMedian': loyer_median, 'nbSamples': nb_samples})
    finally:
        conn.close()


@app.route('/api/loyer-marche/refresh', methods=['POST'])
def api_loyer_marche_refresh():
    if SCRAPER_DIR not in sys.path:
        sys.path.insert(0, SCRAPER_DIR)
    import db as scraper_db
    from marche_locatif import main as marche_main

    body = request.get_json(silent=True) or {}
    ville = body.get('ville', '').strip()
    code_postal = body.get('code_postal', '').strip()
    type_bien = body.get('type_bien', 'appartement')

    if not ville or not code_postal:
        return jsonify({'error': 'ville et code_postal requis'}), 400

    db_path = Path(SCRAPER_DIR) / 'biens.db'
    conn = scraper_db.init_db(db_path)
    try:
        marche_main(conn, villes=[{'ville': ville, 'code_postal': code_postal}])
        conn.commit()
        return jsonify({'ok': True})
    except Exception as exc:
        return jsonify({'error': str(exc)}), 500
    finally:
        conn.close()


if __name__ == "__main__":
    print("Spark Investissement — http://localhost:8080")
    app.run(host="0.0.0.0", port=8080, debug=False, use_reloader=False, threaded=True)
