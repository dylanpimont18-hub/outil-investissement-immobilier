import json
import re
import time

from curl_cffi import requests as crequests

BASE_URL = "https://www.leboncoin.fr/recherche"
NEXT_DATA_RE = re.compile(
    r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>',
    re.DOTALL,
)

TYPE_APPARTEMENT_LABELS = ("appartement", "loft", "studio", "duplex", "triplex")
TYPE_MAISON_LABELS = ("maison", "villa", "château", "manoir", "pavillon")


def _make_session():
    return crequests.Session(impersonate="chrome124")


def _get_attr(attributes, key):
    for a in attributes:
        if a.get("key") == key:
            return a.get("value", "")
    return ""


def _get_attr_label(attributes, key):
    for a in attributes:
        if a.get("key") == key:
            return (a.get("value_label") or "").lower()
    return ""


def _parse_ad(ad):
    subject = ad.get("subject", "")
    attributes = ad.get("attributes", [])
    location = ad.get("location", {})

    # Exclure viagers
    if "viager" in subject.lower():
        return None
    if _get_attr(attributes, "immo_sell_type") == "viager":
        return None

    # Prix
    price_list = ad.get("price", [])
    if not price_list:
        return None
    prix = price_list[0]
    if not isinstance(prix, (int, float)) or prix < 5000:
        return None

    # Surface (peut être absente — l'IA la complétera)
    surface = None
    surface_str = _get_attr(attributes, "square")
    if surface_str:
        try:
            surface = float(surface_str)
            if surface <= 0:
                surface = None
        except (ValueError, TypeError):
            surface = None

    # Type de bien via value_label
    type_label = _get_attr_label(attributes, "real_estate_type")
    if any(t in type_label for t in TYPE_APPARTEMENT_LABELS):
        type_bien = "appartement"
    elif any(t in type_label for t in TYPE_MAISON_LABELS):
        type_bien = "maison"
    else:
        type_bien = None  # l'IA déterminera

    # DPE depuis attributs structurés
    dpe = _get_attr(attributes, "energy_rate").lower() or None

    return {
        "id": str(ad.get("list_id", "")),
        "titre": subject,
        "prix": int(prix),
        "surface": surface,
        "type_bien": type_bien,
        "dpe": dpe,
        "ville": location.get("city_label") or location.get("city", ""),
        "url": ad.get("url", ""),
        "date_publication": (ad.get("first_publication_date") or "")[:10],
    }


def _fetch_page(session, code_postal, page):
    url = f"{BASE_URL}?category=9&locations={code_postal}&page={page}"
    try:
        r = session.get(url, timeout=30)
        r.raise_for_status()
    except Exception as e:
        print(f"[LeBonCoin] Erreur page {page} : {e}")
        return None, 0

    m = NEXT_DATA_RE.search(r.text)
    if not m:
        return None, 0

    try:
        data = json.loads(m.group(1))
    except json.JSONDecodeError:
        return None, 0

    search_data = data.get("props", {}).get("pageProps", {}).get("searchData", {})
    return search_data.get("ads", []), search_data.get("max_pages", 1)


def fetch_annonces(code_postal):
    session = _make_session()
    annonces = []

    ads_p1, max_pages = _fetch_page(session, code_postal, 1)
    if ads_p1 is None:
        return annonces

    for ad in ads_p1:
        parsed = _parse_ad(ad)
        if parsed:
            annonces.append(parsed)

    for page in range(2, min(max_pages, 15) + 1):
        time.sleep(1)
        ads, _ = _fetch_page(session, code_postal, page)
        if not ads:
            break
        for ad in ads:
            parsed = _parse_ad(ad)
            if parsed:
                annonces.append(parsed)

    return annonces


def fetch_description(url):
    """Récupère la description complète d'une annonce individuelle."""
    session = _make_session()
    try:
        r = session.get(url, timeout=20)
        r.raise_for_status()
        m = NEXT_DATA_RE.search(r.text)
        if not m:
            return ""
        data = json.loads(m.group(1))
        props = data.get("props", {}).get("pageProps", {})
        # La structure varie selon le type de page
        ad = props.get("ad") or props.get("adView") or {}
        return ad.get("body", "")
    except Exception:
        return ""


def fetch_descriptions(annonces):
    """Récupère les descriptions pour une liste d'annonces. Retourne list de (annonce, description)."""
    session = _make_session()
    results = []
    for i, annonce in enumerate(annonces):
        desc = ""
        try:
            r = session.get(annonce["url"], timeout=20)
            if r.status_code == 200:
                m = NEXT_DATA_RE.search(r.text)
                if m:
                    data = json.loads(m.group(1))
                    props = data.get("props", {}).get("pageProps", {})
                    ad = props.get("ad") or props.get("adView") or {}
                    desc = ad.get("body", "")
        except Exception:
            pass
        results.append((annonce, desc))
        if i < len(annonces) - 1:
            time.sleep(0.5)
    return results
