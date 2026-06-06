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


def _run_scanner(full: bool, ville: str = None, code_postal: str = None):
    if SCRAPER_DIR not in sys.path:
        sys.path.insert(0, SCRAPER_DIR)

    try:
        import importlib
        import main as scraper_main
        importlib.reload(scraper_main)

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

        villes_override = [{"ville": ville, "code_postal": code_postal, "dept": code_postal[:2]}]
        _invalidate_results_cache()
        _update_state(running=True, progress=0, log="Scan lancé…", error=None)
        scraper_main.main(villes_override=villes_override, progress_callback=progress_callback)
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
                CASE WHEN a.id IS NULL THEN 0 ELSE 1 END AS ia_enrichi
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
    if not ville or not code_postal:
        return jsonify({"error": "ville_required"}), 400

    with _lock:
        if scan_state["running"]:
            return jsonify({"error": "scan_running"}), 409
        scan_state["logs"] = []

    t = threading.Thread(target=_run_scanner, args=(False, ville, code_postal), daemon=True)
    t.start()
    return jsonify({"started": True})


@app.route("/api/scan/full", methods=["POST"])
def api_scan_full():
    data = request.get_json(force=True, silent=True) or {}
    ville = (data.get("ville") or "").strip()
    code_postal = (data.get("code_postal") or "").strip()
    if not ville or not code_postal:
        return jsonify({"error": "ville_required"}), 400

    with _lock:
        if scan_state["running"]:
            return jsonify({"error": "scan_running"}), 409
        scan_state["logs"] = []

    t = threading.Thread(target=_run_scanner, args=(True, ville, code_postal), daemon=True)
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


if __name__ == "__main__":
    print("Spark Investissement — http://localhost:8080")
    app.run(host="0.0.0.0", port=8080, debug=False, use_reloader=False, threaded=True)
