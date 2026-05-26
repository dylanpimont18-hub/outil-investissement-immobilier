"""
Analyse du marché locatif réel LeBonCoin pour un code postal.

Flux :
  1. Scrape toutes les annonces de location (catégorie 10)
  2. Filtre les valeurs aberrantes (percentiles 5-95 par €/m²)
  3. Construit un tableau par type de bien × tranche de surface
  4. Expose estimer_loyer() pour remplacer les taux fixes
"""

import json
import re
import statistics
import time

from curl_cffi import requests as crequests

BASE_URL = "https://www.leboncoin.fr/recherche"
NEXT_DATA_RE = re.compile(
    r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>',
    re.DOTALL,
)

# Tranches de surface en m² (min inclus, max exclu)
TRANCHES = [
    (0,   35,  "< 35 m²"),
    (35,  55,  "35–55 m²"),
    (55,  75,  "55–75 m²"),
    (75,  100, "75–100 m²"),
    (100, 130, "100–130 m²"),
    (130, 9999, "130 m² +"),
]

TYPE_APPARTEMENT_LABELS = ("appartement", "loft", "studio", "duplex", "triplex")
TYPE_MAISON_LABELS = ("maison", "villa", "château", "manoir", "pavillon")


# ── Helpers ──────────────────────────────────────────────────────────────────

def _get_attr_value(attributes, key):
    for a in attributes:
        if a.get("key") == key:
            return a.get("value", "")
    return ""


def _get_attr_label(attributes, key):
    for a in attributes:
        if a.get("key") == key:
            return (a.get("value_label") or "").lower()
    return ""


def _tranche(surface):
    for lo, hi, label in TRANCHES:
        if lo <= surface < hi:
            return label
    return TRANCHES[-1][2]


def _tranche_index(surface):
    for i, (lo, hi, _) in enumerate(TRANCHES):
        if lo <= surface < hi:
            return i
    return len(TRANCHES) - 1


def _percentile(data, p):
    if not data:
        return 0
    s = sorted(data)
    k = (len(s) - 1) * p / 100
    f, c = int(k), min(int(k) + 1, len(s) - 1)
    return s[f] + (s[c] - s[f]) * (k - f)


def _median(data):
    if not data:
        return None
    return statistics.median(data)


# ── Scraping ─────────────────────────────────────────────────────────────────

def _parse_location(ad):
    attrs = ad.get("attributes", [])
    subject = ad.get("subject", "")

    # Exclure locations saisonnières / viagers
    if any(w in subject.lower() for w in ("viager", "saisonnier", "vacances")):
        return None

    price_list = ad.get("price", [])
    if not price_list:
        return None
    loyer = price_list[0]
    if not isinstance(loyer, (int, float)) or loyer < 100 or loyer > 3000:
        return None  # valeur aberrante évidente

    surface_str = _get_attr_value(attrs, "square")
    if not surface_str:
        return None
    try:
        surface = float(surface_str)
    except (ValueError, TypeError):
        return None
    if surface <= 0 or surface > 500:
        return None

    type_label = _get_attr_label(attrs, "real_estate_type")
    if any(t in type_label for t in TYPE_APPARTEMENT_LABELS):
        type_bien = "appartement"
    elif any(t in type_label for t in TYPE_MAISON_LABELS):
        type_bien = "maison"
    else:
        return None

    return {
        "loyer": float(loyer),
        "surface": surface,
        "type_bien": type_bien,
        "loyer_m2": round(loyer / surface, 2),
    }


def _fetch_locations(code_postal):
    session = crequests.Session(impersonate="chrome124")
    listings = []

    for page in range(1, 20):
        url = f"{BASE_URL}?category=10&locations={code_postal}&page={page}"
        try:
            r = session.get(url, timeout=30)
            r.raise_for_status()
        except Exception as e:
            print(f"[Marché] Erreur page {page} : {e}")
            break

        m = NEXT_DATA_RE.search(r.text)
        if not m:
            break

        try:
            data = json.loads(m.group(1))
        except json.JSONDecodeError:
            break

        sd = data.get("props", {}).get("pageProps", {}).get("searchData", {})
        ads = sd.get("ads", [])
        max_pages = sd.get("max_pages", 1)

        for ad in ads:
            parsed = _parse_location(ad)
            if parsed:
                listings.append(parsed)

        if page >= max_pages:
            break
        time.sleep(0.8)

    return listings


# ── Analyse statistique ───────────────────────────────────────────────────────

def _filtrer_outliers(listings):
    """Retire les valeurs aberrantes par type (percentile 5–95 sur loyer/m²)."""
    result = []
    for type_bien in ("appartement", "maison"):
        sous = [l for l in listings if l["type_bien"] == type_bien]
        if len(sous) < 5:
            result.extend(sous)
            continue
        vals = [l["loyer_m2"] for l in sous]
        lo = _percentile(vals, 5)
        hi = _percentile(vals, 95)
        result.extend(l for l in sous if lo <= l["loyer_m2"] <= hi)
    return result


def _construire_tableau(listings):
    """
    Retourne un dict :
      {
        "appartement": {
          "global": {"n", "loyer_median", "loyer_m2_median"},
          "tranches": [ {"label", "n", "loyer_median", "loyer_m2_median", "loyer_min", "loyer_max"}, ... ]
        },
        "maison": { ... }
      }
    """
    tableau = {}
    for type_bien in ("appartement", "maison"):
        sous = [l for l in listings if l["type_bien"] == type_bien]

        # Global
        global_stat = {
            "n": len(sous),
            "loyer_median": round(_median([l["loyer"] for l in sous]) or 0, 0),
            "loyer_m2_median": round(_median([l["loyer_m2"] for l in sous]) or 0, 2),
        }

        # Par tranche
        tranches_data = []
        for lo, hi, label in TRANCHES:
            groupe = [l for l in sous if lo <= l["surface"] < hi]
            if not groupe:
                tranches_data.append({
                    "label": label, "n": 0,
                    "loyer_median": None, "loyer_m2_median": None,
                    "loyer_min": None, "loyer_max": None,
                })
                continue
            loyeurs = [l["loyer"] for l in groupe]
            tranches_data.append({
                "label": label,
                "n": len(groupe),
                "loyer_median": round(_median(loyeurs), 0),
                "loyer_m2_median": round(_median([l["loyer_m2"] for l in groupe]), 2),
                "loyer_min": round(min(loyeurs), 0),
                "loyer_max": round(max(loyeurs), 0),
            })

        tableau[type_bien] = {"global": global_stat, "tranches": tranches_data}

    return tableau


# ── API publique ──────────────────────────────────────────────────────────────

def analyser_marche(code_postal):
    """Scrape les locations et retourne l'analyse de marché."""
    raw = _fetch_locations(code_postal)
    filtres = _filtrer_outliers(raw)
    tableau = _construire_tableau(filtres)
    tableau["_total_annonces"] = len(raw)
    tableau["_total_apres_filtre"] = len(filtres)
    return tableau


def estimer_loyer(surface, type_bien, marche):
    """
    Estime le loyer mensuel depuis les données marché réelles.
    Cherche dans la tranche correspondante, remonte aux tranches voisines si vide,
    se rabat sur la médiane globale en dernier recours.
    """
    if not marche or type_bien not in marche:
        return None

    data = marche[type_bien]
    idx = _tranche_index(surface)
    tranches = data["tranches"]

    # Cherche dans la tranche exacte, puis élargit de ±1, ±2...
    for delta in range(len(tranches)):
        for i in [idx - delta, idx + delta]:
            if 0 <= i < len(tranches) and tranches[i]["n"] > 0:
                loyer_m2 = tranches[i]["loyer_m2_median"]
                # On multiplie par la surface réelle mais plafonné à la médiane de la tranche
                loyer_estime = surface * loyer_m2
                loyer_median_tranche = tranches[i]["loyer_median"]
                # Si on est très au-dessus du médian de la tranche, on prend le médian
                return round(min(loyer_estime, loyer_median_tranche * 1.3), 0)

    # Fallback : médiane globale
    return data["global"].get("loyer_median")
