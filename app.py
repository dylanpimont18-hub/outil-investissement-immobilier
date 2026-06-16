"""
Spark Investissement — application de bureau.
Lance le serveur Flask en thread, ouvre une fenêtre native via PyWebView,
et place une icône dans la barre système (pystray).
"""
import os
import sys
import threading
import time

# ── Instance unique (Windows) ─────────────────────────────────────────────────
# Si l'app tourne déjà (icône dans la barre système), on quitte immédiatement
# pour éviter l'accumulation d'icônes fantômes.
import ctypes
_MUTEX_NAME = "Global\\SparkInvestissement_SingleInstance"
_mutex = ctypes.windll.kernel32.CreateMutexW(None, False, _MUTEX_NAME)
if ctypes.windll.kernel32.GetLastError() == 183:  # ERROR_ALREADY_EXISTS
    ctypes.windll.kernel32.CloseHandle(_mutex)
    sys.exit(0)

# ── Répertoire de base ────────────────────────────────────────────────────────
# sys.executable quand frozen = le .exe ; __file__ en développement
if getattr(sys, 'frozen', False):
    BASE_DIR = os.path.dirname(sys.executable)
else:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))

os.chdir(BASE_DIR)

# ── Import server et patch des chemins ───────────────────────────────────────
# On patche les variables de module AVANT que Flask utilise les routes,
# car Python résout les noms globaux à l'appel des fonctions, pas à leur définition.
sys.path.insert(0, BASE_DIR)
sys.path.insert(0, os.path.join(BASE_DIR, 'scraper'))

import server as _srv
_srv.STATIC_DIR  = BASE_DIR
_srv.SCRAPER_DIR = os.path.join(BASE_DIR, 'scraper')

# Crée le dossier scraper si absent (première exécution)
os.makedirs(_srv.SCRAPER_DIR, exist_ok=True)

PORT = 8080

# ── Démarrage Flask en arrière-plan ──────────────────────────────────────────
def _run_flask():
    _srv.app.run(host='127.0.0.1', port=PORT, debug=False, use_reloader=False, threaded=True)

threading.Thread(target=_run_flask, daemon=True).start()

# Attend que le serveur soit prêt (max 5 s)
import urllib.request
for _ in range(25):
    try:
        urllib.request.urlopen(f'http://127.0.0.1:{PORT}', timeout=1)
        break
    except Exception:
        time.sleep(0.2)

# ── Icône barre système (pystray) ─────────────────────────────────────────────
import pystray
from PIL import Image

_win = [None]   # référence à la fenêtre PyWebView

def _load_icon():
    path = os.path.join(BASE_DIR, 'Logo_site.png')
    if os.path.exists(path):
        return Image.open(path).convert('RGBA').resize((64, 64), Image.LANCZOS)
    # icône de secours : carré indigo
    return Image.new('RGBA', (64, 64), (99, 102, 241, 255))

def _tray_open(icon, item):
    if _win[0]:
        _win[0].show()

def _tray_quit(icon, item):
    icon.stop()
    os._exit(0)

tray = pystray.Icon(
    'spark',
    _load_icon(),
    'Spark Investissement',
    pystray.Menu(
        pystray.MenuItem('Ouvrir Spark Investissement', _tray_open, default=True),
        pystray.MenuItem('Quitter', _tray_quit),
    ),
)
threading.Thread(target=tray.run, daemon=True).start()

# ── Fenêtre PyWebView ────────────────────────────────────────────────────────
import webview

window = webview.create_window(
    'Spark Investissement',
    f'http://127.0.0.1:{PORT}',
    width=1400,
    height=900,
    min_size=(900, 600),
)
_win[0] = window

def _on_closing():
    """Fermeture de la fenêtre → quitter proprement."""
    tray.stop()
    os._exit(0)

window.events.closing += _on_closing

webview.start(private_mode=False)
tray.stop()
