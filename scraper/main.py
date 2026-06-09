"""
Scraper immobilier — Centre-Val de Loire
Orchestration : scrape → filtre → stockage biens bruts (sans IA)
L'enrichissement IA se fait séparément via enrich.py.
"""

import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from pathlib import Path

# Ajout du répertoire courant au path pour les imports relatifs
sys.path.insert(0, str(Path(__file__).parent))

# Protection encodage Windows (cp1252 → utf-8) pour les print() dans les sous-modules
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from config import VILLES, SCRAPERS_ACTIFS
from db import init_db
from fingerprint import make_fingerprint
from filtrage import filtrer_nouvelles_annonces
from utils import inserer_bien, incrementer_scans_manques
from scrapers import REGISTRY
from marche_locatif import main as marche_main, est_stale as marche_stale
from logger import get_logger

_logger = get_logger("spark.scraper")
VENTES_TTL_JOURS = 3


def _log(msg: str):
    _logger.info(msg)


def _afficher_stats(stats: dict, site: str):
    _log(
        f"  {site:15s} total={stats['total']:3d}  "
        f"connues={stats['connues_url']:3d}  "
        f"doublons={stats['doublons_fp']:3d}  "
        f"nouvelles={stats['nouvelles']:3d}  "
        f"prix_changés={stats['prix_changes']:3d}"
    )


def ventes_stale(conn, villes: list[dict], ttl_jours: int = VENTES_TTL_JOURS) -> bool:
    """True si les ventes d'une ville cible n'ont jamais été vues récemment."""
    for ville in villes:
        row = conn.execute(
            "SELECT MAX(date_derniere_vue) FROM biens WHERE code_postal = ?",
            (ville["code_postal"],),
        ).fetchone()
        if not row or not row[0]:
            return True
        try:
            date = datetime.fromisoformat(row[0])
        except Exception:
            return True
        if datetime.now() - date > timedelta(days=ttl_jours):
            return True
    return False


def _hydrate_descriptions(scraper, annonces: list[dict], emit, pct_scrape: int):
    if not annonces or not hasattr(scraper, "fetch_description"):
        return

    to_fetch = [a for a in annonces if not a.get("description") and a.get("url")]
    if not to_fetch:
        return

    emit(min(pct_scrape + 1, 95), f"  >> Extraction du contenu brut ({len(to_fetch)} annonces, 3 workers)…")

    def _fetch_one(annonce):
        try:
            annonce["description"] = scraper.fetch_description(annonce["url"]) or ""
        except Exception as e:
            emit(pct_scrape, f"  [{scraper.site}] Description indisponible '{annonce['url'][:60]}' : {e}")
            annonce["description"] = ""
        time.sleep(1)

    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = {pool.submit(_fetch_one, a): a for a in to_fetch}
        for future in as_completed(futures):
            future.result()


def main(progress_callback=None, villes_override=None):
    def _emit(pct: int, msg: str):
        _log(msg)
        if progress_callback:
            progress_callback(pct, msg)

    villes = villes_override if villes_override else VILLES

    _emit(0, "=" * 60)
    _emit(0, "SCRAPER IMMOBILIER — Centre-Val de Loire")
    _emit(0, f"Scrapers actifs : {', '.join(SCRAPERS_ACTIFS)}")
    villes_str = ", ".join(f"{v['ville']} ({v['code_postal']})" for v in villes)
    _emit(0, f"Villes cibles   : {len(villes)} — {villes_str}")
    _emit(0, "=" * 60)

    # ── 1. Base de données ────────────────────────────────────────────────────
    conn = init_db()
    _emit(5, "Base SQLite initialisée.")

    # ── 1.5 Marché locatif (si stale) ────────────────────────────────────────
    if marche_stale(conn, villes=villes):
        _emit(3, "Analyse du marché locatif (premières données ou expirées)…")
        try:
            marche_main(conn, villes=villes, progress_callback=lambda p, m: _emit(int(3 + p * 0.02), m))
        except Exception as e:
            _emit(5, f"  [Marché] ERREUR : {e} — on continue sans loyers de marché.")
    else:
        _emit(3, "Données marché locatif à jour — réutilisation du cache.")

    if not ventes_stale(conn, villes):
        conn.close()
        _emit(100, "Données ventes à jour — réutilisation du cache. Lancez l'analyse IA si besoin.")
        return

    # ── 2. Scraping multi-sites ───────────────────────────────────────────────
    total_par_site: dict[str, int] = {}
    n_scrapers = len(SCRAPERS_ACTIFS)
    total_inseres = 0
    seen_urls_by_cp: dict[str, set[str]] = {
        ville["code_postal"]: set() for ville in villes if ville.get("code_postal")
    }
    seen_fingerprints_by_cp: dict[str, set[str]] = {
        ville["code_postal"]: set() for ville in villes if ville.get("code_postal")
    }
    sources_reconciliees_by_cp: dict[str, set[str]] = {
        ville["code_postal"]: set() for ville in villes if ville.get("code_postal")
    }

    for i, nom_scraper in enumerate(SCRAPERS_ACTIFS):
        pct_scrape = 5 + int((i / n_scrapers) * 90)
        ScraperClass = REGISTRY.get(nom_scraper)
        if not ScraperClass:
            _emit(pct_scrape, f"  [WARN] Scraper inconnu : {nom_scraper}")
            continue

        _emit(pct_scrape, f"Scraping {nom_scraper}…")
        scraper = None
        fetch_ok = True
        try:
            scraper  = ScraperClass()
            annonces = scraper.fetch_all(villes)
        except Exception as e:
            fetch_ok = False
            _emit(pct_scrape, f"  [{nom_scraper}] ERREUR : {e}")
            annonces = []

        if fetch_ok:
            for ville in villes:
                cp = ville.get("code_postal")
                if not cp:
                    continue
                sources_reconciliees_by_cp.setdefault(cp, set()).add(nom_scraper)

            for annonce in annonces:
                cp = (annonce.get("code_postal") or "").strip()
                url = (annonce.get("url") or "").strip()
                if not cp:
                    continue
                if url:
                    seen_urls_by_cp.setdefault(cp, set()).add(url)
                seen_fingerprints_by_cp.setdefault(cp, set()).add(make_fingerprint(annonce))

        _emit(pct_scrape, f"  >> {len(annonces)} annonces récupérées")

        # ── 3. Filtrage 3 cas ─────────────────────────────────────────────────
        nouvelles, stats = filtrer_nouvelles_annonces(annonces, conn)
        _afficher_stats(stats, nom_scraper)
        total_par_site[nom_scraper] = stats["nouvelles"]

        # ── 3.5 Hydratation du contenu brut pour les nouvelles annonces ─────
        _hydrate_descriptions(scraper, nouvelles, _emit, pct_scrape)

        # ── 4. Stockage biens bruts ───────────────────────────────────────────
        with conn:
            for annonce in nouvelles:
                try:
                    fp = annonce.pop("_fingerprint", None)
                    if not fp:
                        continue
                    inserer_bien(annonce, fp, conn, commit=False)
                    total_inseres += 1
                except Exception as e:
                    _emit(pct_scrape, f"  [DB] Erreur insertion '{annonce.get('url','')[:60]}' : {e}")

    with conn:
        for ville in villes:
            cp = ville.get("code_postal")
            if not cp:
                continue
            incrementer_scans_manques(
                cp,
                seen_urls_by_cp.get(cp, set()),
                seen_fingerprints_by_cp.get(cp, set()),
                sources_reconciliees_by_cp.get(cp, set()),
                conn,
                commit=False,
            )

    conn.close()
    _emit(100, f"Terminé. {total_inseres} nouveaux biens stockés. Lancez l'analyse IA pour les enrichir.")


if __name__ == "__main__":
    main()
