import json
import os
import sys
import threading
import time
from datetime import datetime
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory

app = Flask(__name__)

SCRAPER_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "scraper")
STATIC_DIR = os.path.dirname(os.path.abspath(__file__))

_lock = threading.Lock()
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


def _update_state(running=None, progress=None, log=None, error=None, finished=False):
    with _lock:
        if running is not None:
            scan_state["running"] = running
        if progress is not None:
            scan_state["progress"] = progress
        if log is not None:
            scan_state["logs"].append(f"[{datetime.now().strftime('%H:%M:%S')}] {log}")
            scan_state["logs"] = scan_state["logs"][-50:]
        if error is not None:
            scan_state["error"] = error
        if finished:
            scan_state["running"] = False
            scan_state["last_run"] = datetime.now().isoformat(timespec="seconds")


def _run_scanner(full: bool):
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
            _update_state(log="Base de données réinitialisée.")

        def progress_callback(pct: int, msg: str):
            _update_state(progress=pct, log=msg)

        _update_state(running=True, progress=0, log="Scan lancé…", error=None)
        scraper_main.main(progress_callback=progress_callback)
        _update_state(finished=True)
    except Exception as e:
        _update_state(log=f"ERREUR : {e}", error=str(e), finished=True)


def _read_results():
    """Lit la base SQLite du scraper et retourne le JSON attendu par le frontend."""
    if SCRAPER_DIR not in sys.path:
        sys.path.insert(0, SCRAPER_DIR)

    import db as scraper_db
    db_path = Path(SCRAPER_DIR) / "biens.db"
    if not db_path.exists():
        return None

    conn = scraper_db.get_connection(db_path)
    try:
        rows = conn.execute("""
            SELECT
                b.id AS bien_id,
                b.prix, b.surface, b.type_bien, b.ville, b.code_postal,
                b.dpe, b.titre, b.url, b.site, b.date_derniere_vue,
                a.cf_net, a.cf_apres_impot,
                a.cf_apres_impot_reel, a.cf_apres_impot_sci,
                a.regime_optimal, a.loyer_source,
                a.renta_brute, a.renta_nette_nette,
                a.dscr, a.score, a.loyer_estime, a.mensualite,
                a.resume_ia, a.points_forts, a.points_faibles,
                a.nb_pieces, a.travaux, a.travaux_montant,
                a.immeuble_rapport, a.deja_loue, a.loyer_actuel,
                a.meuble, a.parking_garage, a.chauffage,
                a.date_enrichissement
            FROM biens b
            JOIN annonces a ON a.bien_id = b.id
            ORDER BY a.score DESC NULLS LAST
        """).fetchall()
    finally:
        conn.close()

    if not rows:
        return None

    resultats = [dict(r) for r in rows]

    cfs     = [r["cf_net"] for r in resultats if r.get("cf_net") is not None]
    cfs_ai  = [r["cf_apres_impot"] for r in resultats if r.get("cf_apres_impot") is not None]
    rentas  = [r["renta_brute"] for r in resultats if r.get("renta_brute") is not None]
    scores  = [r["score"] for r in resultats if r.get("score") is not None]
    dpes_risque = sum(1 for r in resultats if (r.get("dpe") or "").lower() in ("f", "g"))

    positifs = [r for r in resultats if (r.get("cf_net") or 0) > 0]
    n = len(resultats)

    stats = {
        "nouvelles":             n,
        "positifs":              len(positifs),
        "pct_positifs":          round(len(positifs) / n * 100, 1) if n else 0,
        "meilleur_cf":           max(cfs) if cfs else None,
        "meilleur_cf_apres_impot": max(cfs_ai) if cfs_ai else None,
        "meilleur_renta":        max(rentas) if rentas else None,
        "score_moyen":           round(sum(scores) / len(scores)) if scores else None,
        "dpe_risque":            dpes_risque if dpes_risque else None,
    }

    return {
        "resultats":    resultats,
        "stats":        stats,
        "generated_at": datetime.now().isoformat(timespec="seconds"),
    }


@app.after_request
def after_request(response):
    if request.path.startswith("/api/"):
        _add_cors(response)
    return response


@app.route("/api/scan", methods=["POST"])
def api_scan():
    with _lock:
        if scan_state["running"]:
            return jsonify({"error": "scan_running"}), 409
        scan_state["logs"] = []

    t = threading.Thread(target=_run_scanner, args=(False,), daemon=True)
    t.start()
    return jsonify({"started": True})


@app.route("/api/scan/full", methods=["POST"])
def api_scan_full():
    with _lock:
        if scan_state["running"]:
            return jsonify({"error": "scan_running"}), 409
        scan_state["logs"] = []

    t = threading.Thread(target=_run_scanner, args=(True,), daemon=True)
    t.start()
    return jsonify({"started": True, "db_cleared": True})


@app.route("/api/status", methods=["GET"])
def api_status():
    with _lock:
        state = dict(scan_state)
        state["logs"] = list(scan_state["logs"])
    return jsonify(state)


@app.route("/api/results", methods=["GET"])
def api_results():
    data = _read_results()
    if data is None:
        return jsonify({"results": None})
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
    conn = scraper_db.get_connection(db_path)
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


@app.route("/api/geocode/batch", methods=["POST"])
def api_geocode_batch():
    """
    Géocode une liste de {ville, code_postal} via Nominatim.
    Utilise le cache SQLite (table geocodes). Rate-limit : 1 req/s.
    """
    items = request.json or []
    db_path = Path(SCRAPER_DIR) / "biens.db"
    if not db_path.exists():
        return jsonify({})

    if SCRAPER_DIR not in sys.path:
        sys.path.insert(0, SCRAPER_DIR)
    import db as scraper_db
    import requests as req_lib
    conn = scraper_db.get_connection(db_path)

    result = {}
    try:
        for item in items:
            ville = item.get("ville", "")
            cp    = item.get("code_postal", "")
            key   = f"{ville}|{cp}"

            cached = conn.execute(
                "SELECT lat, lng FROM geocodes WHERE ville = ? AND code_postal = ?",
                (ville, cp)
            ).fetchone()
            if cached:
                result[key] = {"lat": cached["lat"], "lng": cached["lng"]} if cached["lat"] else None
                continue

            try:
                resp = req_lib.get(
                    "https://nominatim.openstreetmap.org/search",
                    params={"q": f"{ville}, {cp}, France", "format": "json", "limit": 1},
                    headers={"User-Agent": "SparkInvestissement/1.0 (contact@spark.local)"},
                    timeout=5,
                )
                data = resp.json()
                if data:
                    lat = float(data[0]["lat"])
                    lng = float(data[0]["lon"])
                    conn.execute(
                        "INSERT OR REPLACE INTO geocodes (ville, code_postal, lat, lng) VALUES (?, ?, ?, ?)",
                        (ville, cp, lat, lng)
                    )
                    result[key] = {"lat": lat, "lng": lng}
                else:
                    conn.execute(
                        "INSERT OR REPLACE INTO geocodes (ville, code_postal, lat, lng) VALUES (?, ?, NULL, NULL)",
                        (ville, cp)
                    )
                    result[key] = None
                conn.commit()
                time.sleep(1)
            except Exception:
                result[key] = None
    finally:
        conn.close()

    return jsonify(result)


if __name__ == "__main__":
    print("Spark Investissement — http://localhost:8080")
    app.run(host="0.0.0.0", port=8080, debug=False, use_reloader=False)
