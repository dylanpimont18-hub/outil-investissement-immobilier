"""
Scraper immobilier — Centre-Val de Loire
Orchestration complète : scrape → filtre → IA batch → calculs → DB
"""

import sys
from datetime import datetime
from pathlib import Path

# Ajout du répertoire courant au path pour les imports relatifs
sys.path.insert(0, str(Path(__file__).parent))

from config import VILLES, SCRAPERS_ACTIFS, ANTHROPIC_API_KEY
from db import init_db
from filtrage import filtrer_nouvelles_annonces
from ia import enrichir_batch
from calculs import enrichir as enrichir_calculs
from utils import inserer_bien, inserer_annonce
from scrapers import REGISTRY
from marche_locatif import main as marche_main, est_stale as marche_stale


def _log(msg: str):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")


def _afficher_stats(stats: dict, site: str):
    _log(
        f"  {site:15s} total={stats['total']:3d}  "
        f"connues={stats['connues_url']:3d}  "
        f"doublons={stats['doublons_fp']:3d}  "
        f"nouvelles={stats['nouvelles']:3d}  "
        f"prix_changés={stats['prix_changes']:3d}"
    )


def _afficher_resume(toutes_nouvelles: list[dict]):
    calculables = [a for a in toutes_nouvelles if a.get("calculable")]
    if not calculables:
        _log("Aucun bien calculable.")
        return

    positifs = [a for a in calculables if (a.get("cf_net") or 0) > 0]
    scores   = [a["score"] for a in calculables if a.get("score") is not None]

    _log("─" * 60)
    _log(f"RÉSUMÉ FINAL")
    _log(f"  Biens enrichis et calculables : {len(calculables)}")
    _log(f"  CF net positif                : {len(positifs)} ({len(positifs)/len(calculables)*100:.0f}%)")
    if scores:
        _log(f"  Score moyen                   : {sum(scores)//len(scores)}/100")

    top5 = sorted(calculables, key=lambda x: x.get("score") or 0, reverse=True)[:5]
    _log("TOP 5 par score :")
    for r in top5:
        _log(
            f"  [{r.get('score',0):3d}/100] {r.get('titre','')[:45]:45s} "
            f"CF={r.get('cf_apres_impot',0):+6.0f}€  "
            f"Renta={r.get('renta_brute',0):.1f}%  "
            f"({r.get('site','')}/{r.get('ville','')})"
        )
    _log("─" * 60)


def main(progress_callback=None):
    def _emit(pct: int, msg: str):
        _log(msg)
        if progress_callback:
            progress_callback(pct, msg)

    _emit(0, "=" * 60)
    _emit(0, "SCRAPER IMMOBILIER — Centre-Val de Loire")
    _emit(0, f"Scrapers actifs : {', '.join(SCRAPERS_ACTIFS)}")
    _emit(0, f"Villes cibles   : {len(VILLES)}")
    _emit(0, "=" * 60)

    # ── 1. Base de données ────────────────────────────────────────────────────
    conn = init_db()
    _emit(5, "Base SQLite initialisée.")

    # ── 1.5 Marché locatif (si stale) ────────────────────────────────────────
    if marche_stale(conn):
        _emit(3, "Analyse du marché locatif (premières données ou expirées)…")
        try:
            marche_main(conn, progress_callback=lambda p, m: _emit(int(3 + p * 0.02), m))
        except Exception as e:
            _emit(5, f"  [Marché] ERREUR : {e} — on continue sans loyers de marché.")
    else:
        _emit(3, "Données marché locatif à jour — réutilisation du cache.")

    # ── 2. Scraping multi-sites ───────────────────────────────────────────────
    toutes_nouvelles: list[dict] = []
    total_par_site:   dict[str, int] = {}
    n_scrapers = len(SCRAPERS_ACTIFS)

    for i, nom_scraper in enumerate(SCRAPERS_ACTIFS):
        pct_scrape = 5 + int((i / n_scrapers) * 50)
        ScraperClass = REGISTRY.get(nom_scraper)
        if not ScraperClass:
            _emit(pct_scrape, f"  [WARN] Scraper inconnu : {nom_scraper}")
            continue

        _emit(pct_scrape, f"Scraping {nom_scraper}…")
        try:
            scraper  = ScraperClass()
            annonces = scraper.fetch_all(VILLES)
        except Exception as e:
            _emit(pct_scrape, f"  [{nom_scraper}] ERREUR : {e}")
            annonces = []

        _emit(pct_scrape, f"  → {len(annonces)} annonces récupérées")

        # ── 3. Filtrage 3 cas ─────────────────────────────────────────────────
        nouvelles, stats = filtrer_nouvelles_annonces(annonces, conn)
        _afficher_stats(stats, nom_scraper)

        toutes_nouvelles.extend(nouvelles)
        total_par_site[nom_scraper] = stats["nouvelles"]

    total_nouvelles = len(toutes_nouvelles)
    _emit(55, f"Total nouvelles annonces à enrichir : {total_nouvelles}")

    if not toutes_nouvelles:
        _emit(100, "Aucune nouvelle annonce. Fin.")
        conn.close()
        return

    # ── 4. Enrichissement IA (batch Anthropic) ────────────────────────────────
    ia_active = bool(ANTHROPIC_API_KEY and not ANTHROPIC_API_KEY.startswith("sk-ant-REMPLACE"))
    if ia_active:
        _emit(60, f"Enrichissement IA — {total_nouvelles} annonces en batch…")
        try:
            toutes_nouvelles = enrichir_batch(toutes_nouvelles)
            _emit(80, "Enrichissement IA terminé.")
        except Exception as e:
            _emit(80, f"  [IA] ERREUR : {e} — on continue sans enrichissement IA.")
    else:
        _emit(60, "[WARN] Clé API Anthropic non configurée — enrichissement IA ignoré.")

    # ── 5. Calculs financiers ─────────────────────────────────────────────────
    _emit(82, "Calculs financiers…")
    for annonce in toutes_nouvelles:
        enrichir_calculs(annonce, conn)

    # ── 6. Stockage en base ───────────────────────────────────────────────────
    _emit(90, "Enregistrement en base…")
    inseres = 0
    for annonce in toutes_nouvelles:
        try:
            fp      = annonce.pop("_fingerprint", None)
            if not fp:
                continue
            bien_id = inserer_bien(annonce, fp, conn)
            inserer_annonce(bien_id, annonce, conn)
            inseres += 1
        except Exception as e:
            _emit(90, f"  [DB] Erreur insertion '{annonce.get('url','')[:60]}' : {e}")

    _emit(95, f"  {inseres}/{total_nouvelles} biens enregistrés.")

    # ── 7. Résumé ─────────────────────────────────────────────────────────────
    _afficher_resume(toutes_nouvelles)
    conn.close()
    _emit(100, "Terminé.")


if __name__ == "__main__":
    main()
