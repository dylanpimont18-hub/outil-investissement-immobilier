import json
import os
import sys
import threading
from datetime import datetime

from flask import Flask, jsonify, request, send_from_directory

app = Flask(__name__)

SCANNER_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "scanner")
STATIC_DIR = os.path.dirname(os.path.abspath(__file__))
RESULTS_FILE = os.path.join(SCANNER_DIR, "results.json")
CACHE_FILE = os.path.join(SCANNER_DIR, "cache.json")

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
    if SCANNER_DIR not in sys.path:
        sys.path.insert(0, SCANNER_DIR)

    try:
        import importlib
        import scanner as scanner_mod
        importlib.reload(scanner_mod)

        def progress_callback(pct: int, msg: str):
            _update_state(progress=pct, log=msg)

        _update_state(running=True, progress=0, log="Scan lancé…", error=None)
        scanner_mod.main(full=full, send_email=True, progress_callback=progress_callback)
        _update_state(finished=True)
    except Exception as e:
        _update_state(log=f"ERREUR : {e}", error=str(e), finished=True)


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

    if os.path.exists(CACHE_FILE):
        os.remove(CACHE_FILE)

    t = threading.Thread(target=_run_scanner, args=(True,), daemon=True)
    t.start()
    return jsonify({"started": True, "cache_cleared": True})


@app.route("/api/status", methods=["GET"])
def api_status():
    with _lock:
        state = dict(scan_state)
        state["logs"] = list(scan_state["logs"])
    return jsonify(state)


@app.route("/api/results", methods=["GET"])
def api_results():
    if not os.path.exists(RESULTS_FILE):
        return jsonify({"results": None})
    with open(RESULTS_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)
    return jsonify(data)


@app.route("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")


@app.route("/<path:filename>")
def static_files(filename):
    return send_from_directory(STATIC_DIR, filename)


if __name__ == "__main__":
    print("Spark Investissement — http://localhost:8080")
    app.run(host="0.0.0.0", port=8080, debug=False, use_reloader=False)
