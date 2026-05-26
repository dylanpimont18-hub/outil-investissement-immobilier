"""
Spark Investissement — application de bureau.
Lance le serveur Flask en thread, ouvre une fenêtre native via PyWebView,
et place une icône dans la barre système (pystray).
"""
import os
import sys
import threading
import time

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
sys.path.insert(0, os.path.join(BASE_DIR, 'scanner'))

import server as _srv
_srv.STATIC_DIR  = BASE_DIR
_srv.SCANNER_DIR = os.path.join(BASE_DIR, 'scanner')
_srv.RESULTS_FILE = os.path.join(BASE_DIR, 'scanner', 'results.json')
_srv.CACHE_FILE   = os.path.join(BASE_DIR, 'scanner', 'cache.json')

# Crée le dossier scanner si absent (première exécution)
os.makedirs(_srv.SCANNER_DIR, exist_ok=True)

PORT = 8080

# ── Démarrage Flask en arrière-plan ──────────────────────────────────────────
def _run_flask():
    _srv.app.run(host='127.0.0.1', port=PORT, debug=False, use_reloader=False)

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
    # icône de secours : carré doré
    return Image.new('RGBA', (64, 64), (197, 160, 89, 255))

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
    """Fermeture → réduire dans la barre système au lieu de quitter."""
    window.hide()
    return False

window.events.closing += _on_closing

webview.start()
tray.stop()
