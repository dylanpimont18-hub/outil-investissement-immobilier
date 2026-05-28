"""
Analyse du marché locatif — scrape les annonces de LOCATION
pour calculer des loyers médians par (ville × type_bien × tranche de surface).
Cache dans la table loyers_marche (TTL 30 jours).
"""

import statistics
import time
from datetime import datetime, timedelta

from curl_cffi import requests as crequests

TRANCHES = [(0, 30), (30, 50), (50, 70), (70, 100), (100, 9999)]
TTL_JOURS = 30
MIN_ANNONCES = 3


def est_stale(conn, ttl_jours: int = TTL_JOURS) -> bool:
    """True si les données de marché sont absentes ou plus vieilles que ttl_jours."""
    row = conn.execute("SELECT MAX(date_collecte) FROM loyers_marche").fetchone()
    if not row or not row[0]:
        return True
    try:
        date = datetime.fromisoformat(row[0])
        return datetime.now() - date > timedelta(days=ttl_jours)
    except Exception:
        return True


def calculer_medianes(annonces: list[dict]) -> list[dict]:
    """
    Groupe les annonces par (ville, code_postal, type_bien, tranche_surface)
    et calcule le loyer médian pour chaque segment.
    Nécessite au moins MIN_ANNONCES annonces par segment.
    """
    from collections import defaultdict
    buckets: dict[tuple, list[float]] = defaultdict(list)

    for a in annonces:
        loyer    = a.get("loyer")
        surface  = a.get("surface")
        type_b   = a.get("type_bien")
        ville    = a.get("ville")
        cp       = a.get("code_postal")
        if not all([loyer, surface, type_b, ville, cp]):
            continue
        if loyer < 100 or loyer > 5000:
            continue
        for s_min, s_max in TRANCHES:
            if s_min <= surface < s_max:
                buckets[(ville, cp, type_b, s_min, s_max)].append(float(loyer))
                break

    result = []
    now = datetime.now().isoformat(timespec="seconds")
    for (ville, cp, type_b, s_min, s_max), loyeurs in buckets.items():
        if len(loyeurs) >= MIN_ANNONCES:
            result.append({
                "ville":         ville,
                "code_postal":   cp,
                "type_bien":     type_b,
                "surface_min":   s_min,
                "surface_max":   s_max,
                "loyer_median":  round(statistics.median(loyeurs), 0),
                "nb_annonces":   len(loyeurs),
                "date_collecte": now,
            })
    return result


def sauvegarder_medianes(medianes: list[dict], conn) -> int:
    """INSERT OR REPLACE dans loyers_marche. Retourne le nombre de lignes sauvegardées."""
    n = 0
    for m in medianes:
        conn.execute("""
            INSERT OR REPLACE INTO loyers_marche
            (ville, code_postal, type_bien, surface_min, surface_max,
             loyer_median, nb_annonces, date_collecte)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (m["ville"], m["code_postal"], m["type_bien"],
              m["surface_min"], m["surface_max"],
              m["loyer_median"], m["nb_annonces"], m["date_collecte"]))
        n += 1
    conn.commit()
    return n


# ── Scrapers location ─────────────────────────────────────────────────────────
# LeBonCoin : category=9 pour les ventes, category=10 pour les locations.
# La structure __NEXT_DATA__ est identique — seul le paramètre category change.

def _parse_leboncoin_ad(ad, ville: dict) -> dict | None:
    """Parse un ad JSON LeBonCoin (même structure que LeBonCoinScraper._parse)."""
    attrs = ad.get("attributes", [])

    def _attr(key):
        for a in attrs:
            if a.get("key") == key:
                return a.get("value", "")
        return ""

    price_list = ad.get("price", [])
    if not price_list:
        return None
    loyer = price_list[0]

    surface_str = _attr("square")
    try:
        surface = float(surface_str) if surface_str else None
    except (ValueError, TypeError):
        surface = None
    if not surface or surface <= 0:
        return None

    type_label = (_attr("real_estate_type") or "").lower()
    _APT = ("appartement", "loft", "studio", "duplex", "triplex")
    _MAI = ("maison", "villa", "château", "manoir", "pavillon")
    if any(t in type_label for t in _APT):
        type_bien = "appartement"
    elif any(t in type_label for t in _MAI):
        type_bien = "maison"
    else:
        return None

    loc = ad.get("location", {})
    return {
        "loyer":        float(loyer),
        "surface":      surface,
        "type_bien":    type_bien,
        "ville":        loc.get("city_label") or loc.get("city") or ville["ville"],
        "code_postal":  loc.get("zipcode") or ville["code_postal"],
    }


def _fetch_leboncoin_locations(villes: list[dict], session) -> list[dict]:
    """Scrape leboncoin.fr/locations (category=10) pour chaque ville."""
    import json
    import re
    _NEXT_DATA = re.compile(
        r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>',
        re.DOTALL,
    )
    result = []
    for ville in villes:
        cp = ville["code_postal"]
        for page in range(1, 6):  # max 5 pages
            url = f"https://www.leboncoin.fr/recherche?category=10&locations={cp}&page={page}"
            try:
                r = session.get(url, timeout=30)
                r.raise_for_status()
                m = _NEXT_DATA.search(r.text)
                if not m:
                    break
                data = json.loads(m.group(1))
                sd   = data.get("props", {}).get("pageProps", {}).get("searchData", {})
                ads  = sd.get("ads", [])
                if not ads:
                    break
                for ad in ads:
                    parsed = _parse_leboncoin_ad(ad, ville)
                    if parsed:
                        result.append(parsed)
                if page >= sd.get("max_pages", 1):
                    break
                time.sleep(1)
            except Exception as e:
                print(f"  [Marché/LBC] {ville['ville']} p{page} : {e}")
                break
        time.sleep(0.5)
    return result


def _fetch_pap_locations(villes: list[dict], session) -> list[dict]:
    """Scrape api.pap.fr/annonce/recherche pour les locations."""
    _API = "https://api.pap.fr/annonce/recherche"
    _HEADERS = {
        "Accept":     "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    }
    result = []
    for ville in villes:
        page = 1
        while page <= 5:
            params = {
                "categorie":              "location-appartement,location-maison",
                "geo_objets_ids":         ville["code_postal"],
                "recherche[geo][region]": "centre-val-de-loire",
                "page":                   page,
                "nb_by_page":             20,
            }
            try:
                r    = session.get(_API, headers=_HEADERS, params=params, timeout=30)
                data = r.json()
            except Exception as e:
                print(f"  [Marché/PAP] {ville['ville']} p{page} : {e}")
                break

            items = data.get("annonces") or []
            if not items:
                break

            for item in items:
                loyer   = item.get("prix")
                surface = item.get("surface")
                cat     = item.get("categorie", "").lower()
                if not loyer or not surface:
                    continue
                type_bien = "appartement" if "appartement" in cat else "maison" if "maison" in cat else None
                if not type_bien:
                    continue
                result.append({
                    "loyer":       float(loyer),
                    "surface":     float(surface),
                    "type_bien":   type_bien,
                    "ville":       item.get("ville") or ville["ville"],
                    "code_postal": item.get("cp")   or ville["code_postal"],
                })

            if page >= data.get("nb_pages", 1):
                break
            page += 1
            time.sleep(1)
        time.sleep(0.5)
    return result


def main(conn, progress_callback=None):
    """Scrape les locations, calcule les médianes, sauvegarde en cache."""
    def _emit(pct, msg):
        print(f"  [Marché] {msg}")
        if progress_callback:
            progress_callback(pct, msg)

    try:
        from config import VILLES
    except ImportError:
        _emit(100, "config.py introuvable — marché locatif ignoré.")
        return

    session = crequests.Session(impersonate="chrome124")
    toutes: list[dict] = []

    _emit(5, "LeBonCoin locations…")
    lbc = _fetch_leboncoin_locations(VILLES, session)
    toutes.extend(lbc)
    _emit(40, f"  LeBonCoin : {len(lbc)} annonces")

    _emit(45, "PAP locations…")
    pap = _fetch_pap_locations(VILLES, session)
    toutes.extend(pap)
    _emit(80, f"  PAP : {len(pap)} annonces — total : {len(toutes)}")

    medianes = calculer_medianes(toutes)
    _emit(90, f"  {len(medianes)} segments de marché calculés")

    n = sauvegarder_medianes(medianes, conn)
    _emit(100, f"  {n} médianes sauvegardées.")
