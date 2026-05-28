"""
Enrichissement IA via l'API Batch Anthropic (50 % de remise vs appels unitaires).
Seules les nouvelles annonces passent par l'IA.
"""

import json
import re
import time

import anthropic

from config import ANTHROPIC_API_KEY

_SYSTEM = """\
Tu es expert en investissement immobilier locatif en France. \
Analyse cette annonce et retourne UNIQUEMENT un JSON valide, sans markdown ni explication."""

_USER_TPL = """\
Titre : {titre}
Prix : {prix} €
Surface structurée : {surface} m² (0 = non renseignée)
Type structuré : {type_bien}
DPE structuré : {dpe}
Description : {description}

JSON attendu (toutes les clés obligatoires, null si absent) :
{{
  "surface_m2":              <nombre ou null>,
  "type_bien":               "<appartement|maison|immeuble|autre>",
  "nb_pieces":               <entier T1=1 T2=2… ou null>,
  "travaux":                 <true|false>,
  "travaux_montant_estime":  <euros ou null>,
  "dpe":                     "<a|b|c|d|e|f|g|null>",
  "immeuble_rapport":        <true|false>,
  "deja_loue":               <true|false|null>,
  "loyer_actuel":            <€/mois si loué et mentionné, sinon null>,
  "lots_total":              <entier ou null>,
  "lots_loues":              <entier ou null>,
  "charges_copro_mensuelle": <euros ou null>,
  "taxe_fonciere_annuelle":  <euros ou null>,
  "meuble":                  <true|false|null>,
  "parking_garage":          <true|false>,
  "chauffage":               "<electrique|gaz|fioul|pompe_chaleur|poele|autre|null>",
  "points_forts":            ["<point court>"],
  "points_faibles":          ["<point court>"],
  "resume":                  "<phrase 12 mots max>"
}}"""

_DPE_VALIDES = {"a", "b", "c", "d", "e", "f", "g"}
_DPE_ALERTE  = {
    "g": ("ILLÉGAL",    "Location interdite depuis jan. 2025"),
    "f": ("RISQUE 2028","Location interdite à partir de jan. 2028"),
    "e": ("ATTENTION",  "Location interdite à partir de jan. 2034"),
}

_client: anthropic.Anthropic | None = None


def _get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        _client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    return _client


def _build_request(annonce: dict, idx: int) -> dict:
    user_msg = _USER_TPL.format(
        titre       = annonce.get("titre", ""),
        prix        = annonce.get("prix", 0),
        surface     = annonce.get("surface") or 0,
        type_bien   = annonce.get("type_bien") or "inconnu",
        dpe         = annonce.get("dpe") or "non renseigné",
        description = (annonce.get("description") or "Non disponible")[:2000],
    )
    return {
        "custom_id": f"a{idx}",
        "params": {
            "model":      "claude-haiku-4-5-20251001",
            "max_tokens": 600,
            "system": [
                {
                    "type":          "text",
                    "text":          _SYSTEM,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            "messages": [{"role": "user", "content": user_msg}],
        },
    }


def enrichir_batch(
    annonces: list[dict],
    poll_interval: int = 30,
) -> list[dict]:
    """
    Envoie toutes les annonces en un seul batch Anthropic.
    Retourne les annonces enrichies dans le même ordre.
    """
    if not annonces:
        return []

    client   = _get_client()
    requests = [_build_request(a, i) for i, a in enumerate(annonces)]

    print(f"  [Batch IA] Envoi {len(requests)} requêtes…")
    batch    = client.messages.batches.create(requests=requests)
    batch_id = batch.id
    print(f"  [Batch IA] ID : {batch_id}")

    # Polling jusqu'à la fin du traitement
    while True:
        batch  = client.messages.batches.retrieve(batch_id)
        counts = batch.request_counts
        done   = counts.succeeded + counts.errored + counts.canceled + counts.expired
        total  = done + counts.processing
        print(f"  [Batch IA] {batch.processing_status} — {done}/{total}")
        if batch.processing_status == "ended":
            break
        time.sleep(poll_interval)

    # Lecture des résultats
    ia_results: dict[str, dict] = {}
    for result in client.messages.batches.results(batch_id):
        if result.result.type == "succeeded":
            try:
                text = result.result.message.content[0].text
                text = re.sub(r"^```(?:json)?\s*", "", text.strip())
                text = re.sub(r"\s*```$", "", text).strip()
                ia_results[result.custom_id] = json.loads(text)
            except Exception as e:
                print(f"  [Batch IA] Parse erreur {result.custom_id}: {e}")
                ia_results[result.custom_id] = {}
        else:
            print(f"  [Batch IA] Échec {result.custom_id}: {result.result.type}")
            ia_results[result.custom_id] = {}

    return [_appliquer(dict(a), ia_results.get(f"a{i}", {})) for i, a in enumerate(annonces)]


def _appliquer(annonce: dict, data: dict) -> dict:
    """Fusionne les données IA dans l'annonce."""
    # Surface — priorité aux données structurées du scraper
    if not annonce.get("surface") and data.get("surface_m2"):
        annonce["surface"]        = float(data["surface_m2"])
        annonce["surface_source"] = "ia"
    else:
        annonce["surface_source"] = "structuree"

    # Type de bien
    if not annonce.get("type_bien") and data.get("type_bien") in ("appartement", "maison", "immeuble"):
        annonce["type_bien"] = data["type_bien"]

    # DPE
    dpe = (annonce.get("dpe") or data.get("dpe") or "").lower().strip()
    annonce["dpe"]       = dpe if dpe in _DPE_VALIDES else None
    annonce["dpe_alerte"] = _DPE_ALERTE.get(annonce["dpe"])

    # Champs IA
    annonce["nb_pieces"]       = data.get("nb_pieces")
    annonce["travaux"]         = bool(data.get("travaux"))
    annonce["travaux_montant"] = data.get("travaux_montant_estime")
    annonce["immeuble_rapport"] = bool(data.get("immeuble_rapport"))

    deja_loue = data.get("deja_loue")
    annonce["deja_loue"]   = bool(deja_loue) if deja_loue is not None else None
    annonce["loyer_actuel"] = data.get("loyer_actuel")
    annonce["lots_total"]   = data.get("lots_total")
    annonce["lots_loues"]   = data.get("lots_loues")

    annonce["charges_copro_annonce"]  = data.get("charges_copro_mensuelle")
    annonce["taxe_fonciere_annonce"]  = data.get("taxe_fonciere_annuelle")

    meuble = data.get("meuble")
    annonce["meuble"]         = bool(meuble) if meuble is not None else None
    annonce["parking_garage"]  = bool(data.get("parking_garage"))
    annonce["chauffage"]       = data.get("chauffage")
    annonce["points_forts"]    = data.get("points_forts") or []
    annonce["points_faibles"]  = data.get("points_faibles") or []
    annonce["resume_ia"]       = data.get("resume") or ""

    return annonce
