"""
Enrichissement IA des biens bruts déjà stockés en base.
Traite uniquement les biens sans ligne dans la table annonces.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

# Protection encodage Windows (cp1252) pour stdout/stderr
if sys.stdout is not None and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if sys.stderr is not None and hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from db import init_db
from ia import enrichir_batch
from calculs import enrichir as enrichir_calculs
from utils import inserer_annonce, maj_description_bien
from scrapers import REGISTRY
from logger import get_logger

_logger = get_logger("spark.enrich")


def _recuperer_description_si_absente(row, conn, scrapers_cache, emit) -> str:
    description = row["description"] or ""
    if description:
        return description

    site = row["site"] or ""
    ScraperClass = REGISTRY.get(site)
    if not ScraperClass:
        return ""

    scraper = scrapers_cache.get(site)
    if scraper is None:
        scraper = ScraperClass()
        scrapers_cache[site] = scraper

    fetch_description = getattr(scraper, "fetch_description", None)
    if not callable(fetch_description):
        return ""

    try:
        description = fetch_description(row["url"]) or ""
    except Exception as e:
        emit(8, f"  [IA] Description indisponible pour {row['url'][:60]} : {e}")
        return ""

    if description:
        maj_description_bien(row["id"], description, conn, commit=False)
    return description


def enrich_pending(conn=None, progress_callback=None):
    """
    Enrichit avec l'IA tous les biens sans ligne dans annonces.
    Retourne le nombre de biens enrichis.
    """
    def _emit(pct: int, msg: str):
        _logger.info(msg)
        if progress_callback:
            progress_callback(pct, msg)

    close_conn = conn is None
    if conn is None:
        conn = init_db()

    # ── 1. Récupérer les biens non enrichis ───────────────────────────────────
    rows = conn.execute("""
        SELECT b.id, b.titre, b.description, b.prix, b.surface, b.type_bien,
               b.dpe, b.url, b.site, b.ville, b.code_postal
        FROM biens b
        LEFT JOIN annonces a ON a.bien_id = b.id
        WHERE a.id IS NULL
    """).fetchall()

    if not rows:
        _emit(100, "Aucun bien en attente d'enrichissement IA.")
        if close_conn:
            conn.close()
        return 0

    _emit(5, f"{len(rows)} biens à enrichir…")

    # Convertir en dicts en réinjectant le contenu brut de l'annonce si disponible.
    scrapers_cache = {}
    descriptions_recuperees = 0
    annonces = []
    with conn:
        for r in rows:
            description = _recuperer_description_si_absente(r, conn, scrapers_cache, _emit)
            if description and not r["description"]:
                descriptions_recuperees += 1
            annonces.append({
                "bien_id":    r["id"],
                "titre":      r["titre"] or "",
                "prix":       r["prix"] or 0,
                "surface":    r["surface"],
                "type_bien":  r["type_bien"],
                "dpe":        r["dpe"],
                "url":        r["url"],
                "site":       r["site"],
                "ville":      r["ville"],
                "code_postal": r["code_postal"],
                "description": description,
            })

    if descriptions_recuperees:
        _emit(8, f"{descriptions_recuperees} descriptions brutes récupérées avant enrichissement IA.")

    # ── 1.5 Préfiltrage pré-IA ─────────────────────────────────────────────
    avant_filtre = len(annonces)
    annonces = [
        a for a in annonces
        if a.get("description") or a.get("surface") or a.get("type_bien")
    ]
    filtres = avant_filtre - len(annonces)
    if filtres:
        _emit(9, f"  {filtres} biens sans données exploitables exclus du batch IA (description, surface et type_bien tous absents).")

    # ── 2. Enrichissement IA (batch Anthropic) ────────────────────────────────
    _emit(10, f"Envoi du batch IA ({len(annonces)} annonces)…")
    try:
        annonces = enrichir_batch(annonces)
        _emit(80, "Enrichissement IA terminé.")
    except Exception as e:
        _emit(80, f"  [IA] ERREUR : {e} — enrichissement interrompu.")
        if close_conn:
            conn.close()
        raise

    # ── 3. Calculs financiers ─────────────────────────────────────────────────
    _emit(85, "Calculs financiers…")
    for annonce in annonces:
        enrichir_calculs(annonce, conn)

    # ── 4. Stockage dans annonces ─────────────────────────────────────────────
    _emit(90, "Enregistrement en base…")
    inseres = 0
    with conn:
        for annonce in annonces:
            try:
                bien_id = annonce.pop("bien_id")
                inserer_annonce(bien_id, annonce, conn, commit=False)
                inseres += 1
            except Exception as e:
                _emit(90, f"  [DB] Erreur insertion bien#{annonce.get('bien_id', '?')} : {e}")

    if close_conn:
        conn.close()

    _emit(100, f"Terminé. {inseres}/{len(rows)} biens enrichis.")
    return inseres


if __name__ == "__main__":
    enrich_pending()
