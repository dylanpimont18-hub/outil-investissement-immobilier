# Copier ce fichier en config.py et remplir la vraie clé. config.py est dans .gitignore —
# ne jamais commiter la vraie clé.

# Clé API Mammouth AI (proxy OpenAI-compatible, mammouth.ai). Depuis le 2026-10-01, le
# diagnostic IA et l'Assistant chat passent par les Cloud Functions (functions/index.js), qui
# lisent le secret Firebase MAMMOUTH_API_KEY : server.py ne lit plus ce fichier pour l'IA.
MAMMOUTH_API_KEY = "REMPLACE_PAR_TA_CLE"
