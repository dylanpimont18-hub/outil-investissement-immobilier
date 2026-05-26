"""
Enrichissement IA des annonces via Claude Haiku (Anthropic).
"""

import json
import re

import anthropic

from config import ANTHROPIC_API_KEY

_client = None

DPE_ALERTE = {
    "g": ("ILLÉGAL", "Location interdite depuis jan. 2025"),
    "f": ("RISQUE 2028", "Location interdite à partir de jan. 2028"),
    "e": ("ATTENTION", "Location interdite à partir de jan. 2034"),
}
DPE_OK = {"a", "b", "c", "d"}

PROMPT = """\
Tu es expert en investissement immobilier locatif en France. Analyse cette annonce et retourne UNIQUEMENT un JSON valide, sans markdown ni explication.

Titre : {titre}
Prix : {prix} €
Surface structurée : {surface} m² (0 = non renseignée dans les attributs)
Type structuré : {type_bien}
DPE structuré : {dpe}
Description : {description}

JSON attendu (toutes les clés sont obligatoires, utilise null si l'info est absente) :
{{
  "surface_m2": <nombre ou null>,
  "type_bien": "<appartement|maison|immeuble|autre>",
  "travaux": <true|false>,
  "travaux_montant_estime": <montant en euros ou null>,
  "dpe": "<a|b|c|d|e|f|g|null>",
  "immeuble_rapport": <true|false>,
  "deja_loue": <true|false|null>,
  "lots_total": <nombre total de lots si immeuble, sinon null>,
  "lots_loues": <nombre de lots actuellement loués si immeuble, sinon null>,
  "charges_copro_mensuelle": <nombre euros ou null>,
  "taxe_fonciere_annuelle": <nombre euros ou null>,
  "points_forts": ["<point court>"],
  "points_faibles": ["<point court>"],
  "resume": "<phrase 12 mots max>"
}}"""


def _get_client():
    global _client
    if _client is None:
        _client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    return _client


def _clean_json(text):
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    return text.strip()


def enrichir(annonce, description=""):
    prompt = PROMPT.format(
        titre=annonce.get("titre", ""),
        prix=annonce.get("prix", 0),
        surface=annonce.get("surface") or 0,
        type_bien=annonce.get("type_bien", "inconnu"),
        dpe=annonce.get("dpe") or "non renseigné",
        description=(description or "Non disponible")[:2000],
    )

    try:
        resp = _get_client().messages.create(
            model="claude-haiku-4-5",
            max_tokens=500,
            messages=[{"role": "user", "content": prompt}],
        )
        data = json.loads(_clean_json(resp.content[0].text))
    except Exception as e:
        print(f"[Claude] Erreur '{annonce.get('titre', '')[:40]}' : {e}")
        data = {}

    result = dict(annonce)

    if not result.get("surface") and data.get("surface_m2"):
        result["surface"] = float(data["surface_m2"])
        result["surface_source"] = "ia"
    else:
        result["surface_source"] = "structuree"

    if not result.get("type_bien") and data.get("type_bien") in ("appartement", "maison", "immeuble"):
        result["type_bien"] = data["type_bien"]

    dpe = (result.get("dpe") or data.get("dpe") or "").lower().strip()
    result["dpe"] = dpe if dpe in (*DPE_OK, "e", "f", "g") else None
    result["dpe_alerte"] = DPE_ALERTE.get(result["dpe"])

    result["travaux"] = bool(data.get("travaux"))
    result["travaux_montant"] = data.get("travaux_montant_estime")
    result["immeuble_rapport"] = bool(data.get("immeuble_rapport"))

    deja_loue = data.get("deja_loue")
    result["deja_loue"] = bool(deja_loue) if deja_loue is not None else None
    result["lots_total"] = data.get("lots_total")
    result["lots_loues"] = data.get("lots_loues")

    result["charges_copro_annonce"] = data.get("charges_copro_mensuelle")
    result["taxe_fonciere_annonce"] = data.get("taxe_fonciere_annuelle")

    result["points_forts"] = data.get("points_forts") or []
    result["points_faibles"] = data.get("points_faibles") or []
    result["resume_ia"] = data.get("resume") or ""

    return result
