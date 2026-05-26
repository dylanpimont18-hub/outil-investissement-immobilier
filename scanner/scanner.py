import json
import os
import sys
from datetime import datetime

from leboncoin import fetch_annonces, fetch_descriptions
from marche_locatif import analyser_marche
from ai_enrichir import enrichir as enrichir_ia
from calculs import enrichir as enrichir_calculs
from email_report import envoyer
from config import CODE_POSTAL, ANTHROPIC_API_KEY

SCANNER_DIR = os.path.dirname(os.path.abspath(__file__))
CACHE_FILE = os.path.join(SCANNER_DIR, "cache.json")
RESULTS_FILE = os.path.join(SCANNER_DIR, "results.json")


def _log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")


def _load_cache():
    if os.path.exists(CACHE_FILE):
        with open(CACHE_FILE, "r", encoding="utf-8") as f:
            return set(json.load(f))
    return set()


def _save_cache(ids):
    with open(CACHE_FILE, "w", encoding="utf-8") as f:
        json.dump(sorted(ids), f)


def _save_results(resultats, stats, marche):
    data = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "stats": stats,
        "marche": marche,
        "resultats": resultats,
    }
    with open(RESULTS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def main(full: bool = False, send_email: bool = True, progress_callback=None):
    def cb(pct: int, msg: str):
        _log(msg)
        if progress_callback:
            progress_callback(pct, msg)

    if full and os.path.exists(CACHE_FILE):
        os.remove(CACHE_FILE)

    ia_active = bool(ANTHROPIC_API_KEY and not ANTHROPIC_API_KEY.startswith("COLLER"))
    cb(0, f"Démarrage — CP {CODE_POSTAL} {'[IA Claude Haiku activée]' if ia_active else '[IA désactivée]'}")

    # 1. Analyse du marché locatif réel
    _log("Analyse du marché locatif (locations LeBonCoin)…")
    marche = analyser_marche(CODE_POSTAL)
    for type_bien in ("appartement", "maison"):
        if type_bien in marche:
            g = marche[type_bien]["global"]
            _log(f"  {type_bien.capitalize()} : {g['n']} annonces · loyer médian {g['loyer_median']}€ · {g['loyer_m2_median']}€/m²")
    cb(10, "Marché analysé…")

    # 2. Cache
    cache = _load_cache()
    is_first_run = len(cache) == 0
    _log(f"Cache : {len(cache)} annonces déjà traitées {'(première exécution)' if is_first_run else ''}")

    # 3. Scrape annonces en vente
    annonces_brutes = fetch_annonces(CODE_POSTAL)
    n = len(annonces_brutes)
    _log(f"Annonces en vente récupérées : {n}")
    cb(20, f"{n} annonces récupérées")

    # 4. Filtre delta
    nouvelles = annonces_brutes if is_first_run else [a for a in annonces_brutes if a["id"] not in cache]
    _log(f"Nouvelles annonces à analyser : {len(nouvelles)}")

    if not nouvelles:
        _log("Aucune nouvelle annonce. Fin du script.")
        cb(100, "Scan terminé")
        return

    # 5. Enrichissement IA (descriptions + Claude Haiku)
    if ia_active:
        _log(f"Récupération des descriptions ({len(nouvelles)} pages)…")
        annonces_avec_desc = fetch_descriptions(nouvelles)
        total = len(annonces_avec_desc)
        _log("Analyse IA en cours…")
        enrichies = []
        for i, (annonce, desc) in enumerate(annonces_avec_desc):
            enrichies.append(enrichir_ia(annonce, desc))
            pct = 20 + int(70 * (i + 1) / total)
            if (i + 1) % 10 == 0:
                _log(f"  IA : {i + 1}/{total} traitées")
            if progress_callback:
                progress_callback(pct, f"IA : {i + 1}/{total}…")
    else:
        _log("Clé API Anthropic non configurée — enrichissement IA ignoré.")
        enrichies = nouvelles

    # 6. Calculs financiers (avec données marché réel)
    resultats_bruts = [enrichir_calculs(a, marche) for a in enrichies]
    cb(95, "Calculs terminés")

    # 7. Tri et stats
    resultats = sorted(
        [r for r in resultats_bruts if r.get("calculable")],
        key=lambda x: x["cf_net"],
        reverse=True,
    )
    non_calculables = len(resultats_bruts) - len(resultats)
    if non_calculables:
        _log(f"Ignorées (surface/type manquants) : {non_calculables}")

    _log(f"Annonces analysées : {len(resultats)}")

    if not resultats:
        _log("Aucun résultat calculable. Fin.")
        cb(100, "Scan terminé")
        return

    positifs = [r for r in resultats if r["cf_net"] > 0]
    dpe_risque = [r for r in resultats if r.get("dpe_alerte")]
    stats = {
        "nouvelles": len(resultats),
        "positifs": len(positifs),
        "pct_positifs": len(positifs) / len(resultats) * 100,
        "meilleur_cf": resultats[0]["cf_net"],
        "meilleur_renta": max(r["renta_brute"] for r in resultats),
        "dpe_risque": len(dpe_risque),
        "is_first_run": is_first_run,
        "ia_active": ia_active,
    }

    _log(f"Top CF net : {resultats[0]['cf_net']:+.0f}€/mois — {resultats[0]['titre'][:50]}")
    _log(f"CF positifs : {stats['positifs']}/{stats['nouvelles']} ({stats['pct_positifs']:.0f}%)")

    # 8. Sauvegarde résultats JSON
    _save_results(resultats, stats, marche)
    _log(f"Résultats sauvegardés : {RESULTS_FILE}")

    # 9. Envoi email
    if send_email:
        try:
            envoyer(resultats, stats, marche)
            _log(f"Email envoyé à {__import__('config').EMAIL_DESTINATAIRE}")
        except Exception as e:
            _log(f"ERREUR envoi email : {e}")
            sys.exit(1)

    # 10. Mise à jour cache
    new_ids = {a["id"] for a in nouvelles}
    cache.update(new_ids)
    _save_cache(cache)
    _log(f"Cache mis à jour : {len(cache)} annonces au total")
    cb(100, "Scan terminé")


if __name__ == "__main__":
    main()
