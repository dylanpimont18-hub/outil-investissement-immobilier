# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_all, collect_submodules

webview_datas, webview_binaries, webview_hiddenimports = collect_all('webview')

a = Analysis(
    ['app.py'],
    pathex=['.', 'scanner'],
    binaries=webview_binaries,
    datas=webview_datas,
    hiddenimports=[
        # Flask / Werkzeug
        'flask', 'jinja2', 'jinja2.ext', 'markupsafe', 'werkzeug',
        'werkzeug.routing', 'werkzeug.serving', 'werkzeug.middleware',
        'werkzeug.middleware.proxy_fix',
        # Scanner Python
        'scanner', 'leboncoin', 'marche_locatif', 'ai_enrichir',
        'calculs', 'email_report', 'config',
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
        # WebView
        *webview_hiddenimports,
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
    console=False,          # pas de fenêtre terminal
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
