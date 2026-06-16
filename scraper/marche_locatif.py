"""
Analyse du marché locatif — scrape les annonces de LOCATION sur LeBonCoin
pour calculer des loyers médians par (ville × type_bien × tranche de surface).
Cache dans la table loyers_marche (TTL 30 jours).
"""

import json
import random
import re
import statistics
import time
from datetime import datetime, timedelta

from curl_cffi import requests as crequests
from logger import get_logger

_logger = get_logger("spark.marche")

TRANCHES = [(0, 30), (30, 50), (50, 70), (70, 100), (100, 9999)]
TTL_JOURS = 30
MIN_ANNONCES = 3

_NEXT_DATA = re.compile(
    r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>',
    re.DOTALL,
)
# Même bypass DataDome que le scraper d'achat
_HEADERS = {
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "accept-language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
    "accept-encoding": "gzip, deflate, br",
    "cache-control": "no-cache",
    "pragma": "no-cache",
    "sec-ch-ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "same-origin",
    "sec-fetch-user": "?1",
    "upgrade-insecure-requests": "1",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
}


def est_stale(conn, villes: list[dict] | None = None, ttl_jours: int = TTL_JOURS) -> bool:
    """True si les données de marché sont absentes ou trop anciennes.

    Quand `villes` est fourni, chaque ville ciblée doit avoir un cache récent.
    """
    if not villes:
        row = conn.execute("SELECT MAX(date_collecte) FROM loyers_marche").fetchone()
        if not row or not row[0]:
            return True
        try:
            date = datetime.fromisoformat(row[0])
            return datetime.now() - date > timedelta(days=ttl_jours)
        except Exception:
            return True

    for ville in villes:
        row = conn.execute(
            "SELECT MAX(date_collecte) FROM loyers_marche WHERE code_postal = ? AND ville = ?",
            (ville["code_postal"], ville["ville"]),
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


def calculer_medianes(annonces: list[dict]) -> list[dict]:
    from collections import defaultdict
    buckets: dict[tuple, list[float]] = defaultdict(list)

    for a in annonces:
        loyer     = a.get("loyer")
        surface   = a.get("surface")
        type_b    = a.get("type_bien")
        ville     = a.get("ville")
        cp        = a.get("code_postal")
        nb_pieces = a.get("nb_pieces")  # peut être None
        if not all([loyer, surface, type_b, ville, cp]):
            continue
        if loyer < 100 or loyer > 5000:
            continue
        for s_min, s_max in TRANCHES:
            if s_min <= surface < s_max:
                buckets[(ville, cp, type_b, nb_pieces, s_min, s_max)].append(float(loyer))
                break

    result = []
    now = datetime.now().isoformat(timespec="seconds")
    for (ville, cp, type_b, nb_pieces, s_min, s_max), loyeurs in buckets.items():
        if len(loyeurs) >= MIN_ANNONCES:
            result.append({
                "ville":         ville,
                "code_postal":   cp,
                "type_bien":     type_b,
                "nb_pieces":     nb_pieces,
                "surface_min":   s_min,
                "surface_max":   s_max,
                "loyer_median":  round(statistics.median(loyeurs), 0),
                "nb_annonces":   len(loyeurs),
                "date_collecte": now,
            })
    return result


def sauvegarder_medianes(medianes: list[dict], conn) -> int:
    n = 0
    for m in medianes:
        conn.execute("""
            INSERT OR REPLACE INTO loyers_marche
            (ville, code_postal, type_bien, nb_pieces, surface_min, surface_max,
             loyer_median, nb_annonces, date_collecte)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (m["ville"], m["code_postal"], m["type_bien"], m.get("nb_pieces"),
              m["surface_min"], m["surface_max"],
              m["loyer_median"], m["nb_annonces"], m["date_collecte"]))
        n += 1
    conn.commit()
    return n


def _parse_location_ad(ad, ville: dict) -> dict | None:
    attrs = ad.get("attributes", [])

    def _attr(key):
        for a in attrs:
            if a.get("key") == key:
                return a.get("value", "")
        return ""

    def _attr_label(key):
        for a in attrs:
            if a.get("key") == key:
                return (a.get("value_label") or "").lower()
        return ""

    # Loyer : préférer rent_excluding_charges (hors charges) sinon price
    loyer_hc = _attr("rent_excluding_charges")
    try:
        loyer = float(loyer_hc) if loyer_hc else None
    except (ValueError, TypeError):
        loyer = None
    if loyer is None:
        price_list = ad.get("price", [])
        if not price_list:
            return None
        try:
            loyer = float(price_list[0])
        except (ValueError, TypeError):
            return None

    surface_str = _attr("square")
    try:
        surface = float(surface_str) if surface_str else None
    except (ValueError, TypeError):
        surface = None
    if not surface or surface <= 0:
        return None

    # Nombre de pièces (T1=1, T2=2, T3=3…)
    rooms_str = _attr("rooms")
    try:
        nb_pieces = int(rooms_str) if rooms_str else None
    except (ValueError, TypeError):
        nb_pieces = None

    # Type : utiliser value_label (ex: "Appartement") et non value (ID numérique)
    type_label = _attr_label("real_estate_type")
    _APT = ("appartement", "loft", "studio", "duplex", "triplex")
    _MAI = ("maison", "villa", "château", "manoir", "pavillon")
    if any(t in type_label for t in _APT):
        type_bien = "appartement"
    elif any(t in type_label for t in _MAI):
        type_bien = "maison"
    else:
        return None

    # Ville normalisée sur le nom cible pour éviter la fragmentation par quartier
    return {
        "loyer":       loyer,
        "surface":     surface,
        "nb_pieces":   nb_pieces,
        "type_bien":   type_bien,
        "ville":       ville["ville"],
        "code_postal": ville["code_postal"],
    }


def _fetch_leboncoin_locations(villes: list[dict]) -> tuple[list[dict], bool]:
    """Scrape LeBonCoin category=10 (locations). Nouvelle session par page (bypass DataDome).
    Retourne (annonces, blocked) — blocked=True si HTTP 403 détecté."""
    result = []
    blocked = False
    for ville in villes:
        cp = ville["code_postal"]
        time.sleep(random.uniform(2, 5))
        for page in range(1, 6):
            session = crequests.Session(impersonate="chrome131")
            url = f"https://www.leboncoin.fr/recherche?category=10&locations={cp}&page={page}"
            try:
                r = session.get(url, headers=_HEADERS, timeout=20)
                if r.status_code == 403:
                    _logger.warning("[Marché/LBC] %s p%d : HTTP 403 — IP bloquée", ville["ville"], page)
                    blocked = True
                    break
                if r.status_code != 200:
                    _logger.warning("[Marché/LBC] %s p%d : HTTP %d", ville["ville"], page, r.status_code)
                    break
                m = _NEXT_DATA.search(r.text)
                if not m:
                    break
                data = json.loads(m.group(1))
                sd   = data.get("props", {}).get("pageProps", {}).get("searchData", {})
                ads  = sd.get("ads", [])
                if not ads:
                    break
                for ad in ads:
                    parsed = _parse_location_ad(ad, ville)
                    if parsed:
                        result.append(parsed)
                if page >= sd.get("max_pages", 1):
                    break
                time.sleep(random.uniform(6, 10))
            except Exception as e:
                _logger.warning("[Marché/LBC] %s p%d : %s", ville["ville"], page, e)
                break
    return result, blocked


def main(conn, villes: list[dict] = None, progress_callback=None):
    """Scrape les locations LeBonCoin, calcule les médianes, sauvegarde en cache."""
    def _emit(pct, msg):
        _logger.info("[Marché] %s", msg)
        if progress_callback:
            progress_callback(pct, msg)

    if villes is None:
        try:
            from config import VILLES
            villes = VILLES
        except ImportError:
            _emit(100, "config.py introuvable — marché locatif ignoré.")
            return

    _emit(10, "LeBonCoin locations…")
    lbc, blocked = _fetch_leboncoin_locations(villes)
    if blocked:
        _emit(70, "  ⚠ IP bloquée (HTTP 403) — marché locatif indisponible. Réessayez dans quelques minutes.")
    else:
        _emit(70, f"  LeBonCoin : {len(lbc)} annonces de location")

    medianes = calculer_medianes(lbc)
    _emit(90, f"  {len(medianes)} segments de marché calculés")

    n = sauvegarder_medianes(medianes, conn)
    _emit(100, f"  {n} médianes sauvegardées.")
