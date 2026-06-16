# -*- mode: python ; coding: utf-8 -*-
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(SPEC), 'scraper'))

from PyInstaller.utils.hooks import collect_all, collect_submodules

webview_datas, webview_binaries, webview_hiddenimports = collect_all('webview')
scraper_site_hiddenimports = collect_submodules('scrapers')

a = Analysis(
    ['app.py'],
    pathex=['.', 'scraper'],
    binaries=webview_binaries,
    datas=webview_datas,
    hiddenimports=[
        # Flask / Werkzeug
        'flask', 'jinja2', 'jinja2.ext', 'markupsafe', 'werkzeug',
        'werkzeug.routing', 'werkzeug.serving', 'werkzeug.middleware',
        'werkzeug.middleware.proxy_fix',
        # Scraper multi-sites
        'main', 'db', 'filtrage', 'fingerprint', 'ia', 'calculs', 'utils',
        'enrich', 'logger', 'marche_locatif',
        'scrapers',
        # Anthropic SDK
        'anthropic', 'httpx', 'httpcore', 'anyio', 'sniffio',
        'certifi', 'charset_normalizer', 'distro',
        # Pystray
        'pystray', 'pystray._win32',
        # PIL
        'PIL', 'PIL.Image', 'PIL.PngImagePlugin', 'PIL.JpegImagePlugin',
        # Curl / réseau
        'curl_cffi', 'curl_cffi.requests',
        # Email
        'smtplib', 'email.mime.multipart', 'email.mime.text',
        # SQLite
        'sqlite3',
        # WebView
        *webview_hiddenimports,
        *scraper_site_hiddenimports,
        *collect_submodules('webview'),
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['tkinter', 'matplotlib', 'numpy', 'pandas', 'scipy'],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='Spark',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    icon='spark.ico',
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    name='Spark',
)
