"""
Génère data/communes_centre_val.json depuis l'API geo.gouv.fr.
Nécessite une connexion internet — à exécuter une seule fois.
Couvre les 6 départements Centre-Val de Loire : 18, 28, 36, 37, 41, 45.
"""
import json
import time
from pathlib import Path

import requests

DEPTS = ["18", "28", "36", "37", "41", "45"]
OUT   = Path(__file__).parent.parent / "data" / "communes_centre_val.json"
OUT.parent.mkdir(parents=True, exist_ok=True)

result: dict[str, list[str]] = {}

for dept in DEPTS:
    print(f"Département {dept}…")
    resp = requests.get(
        f"https://geo.api.gouv.fr/departements/{dept}/communes",
        params={"fields": "nom,codesPostaux", "format": "json"},
        timeout=15,
    )
    resp.raise_for_status()
    for commune in resp.json():
        nom = commune["nom"]
        for cp in commune.get("codesPostaux", []):
            result.setdefault(cp, [])
            if nom not in result[cp]:
                result[cp].append(nom)
    time.sleep(0.3)

# Tri pour lisibilité
for cp in result:
    result[cp].sort()

OUT.write_text(json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2), encoding="utf-8")
print(f"✓ {sum(len(v) for v in result.values())} communes → {OUT}")
