"""LeBonCoin — HTML scraping via __NEXT_DATA__ (Playwright + stealth)."""

import json
import random
import re
import time

from browser import browser_page
from .base import BaseScraper
from logger import get_logger

_logger = get_logger("spark.leboncoin")

_NEXT_DATA = re.compile(
    r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>',
    re.DOTALL,
)

_APT = ("appartement", "loft", "studio", "duplex", "triplex")
_MAI = ("maison", "villa", "château", "manoir", "pavillon")


def _attr(attrs, key):
    for a in attrs:
        if a.get("key") == key:
            return a.get("value", "")
    return ""


def _attr_label(attrs, key):
    for a in attrs:
        if a.get("key") == key:
            return (a.get("value_label") or "").lower()
    return ""


class LeBonCoinScraper(BaseScraper):
    site = "leboncoin"

    def fetch_ville(self, ville: dict) -> list[dict]:
        annonces = []
        cp = ville["code_postal"]
        rayon_km = ville.get("rayon_km")
        loc_param = f"{cp}__{int(rayon_km * 1000)}" if rayon_km else cp

        time.sleep(random.uniform(2, 5))
        ads, max_pages = self._fetch_page(loc_param, 1)
        if ads is None:
            return annonces

        annonces.extend(filter(None, (self._parse(ad, ville) for ad in ads)))

        for page in range(2, min(max_pages, 10) + 1):
            time.sleep(random.uniform(6, 10))
            ads, _ = self._fetch_page(loc_param, page)
            if not ads:
                break
            annonces.extend(filter(None, (self._parse(ad, ville) for ad in ads)))

        return annonces

    def _fetch_page(self, loc_param, page):
        url = f"https://www.leboncoin.fr/recherche?category=9&locations={loc_param}&page={page}"
        try:
            with browser_page() as p:
                resp = p.goto(url, wait_until="domcontentloaded", timeout=30000)
                if resp and resp.status == 403:
                    _logger.warning("[leboncoin] page %d : HTTP 403 — IP bloquée par DataDome.", page)
                    return None, 0
                if resp and resp.status != 200:
                    _logger.warning("[leboncoin] page %d : HTTP %d", page, resp.status)
                    return None, 0
                html = p.content()
        except Exception as e:
            _logger.warning("[leboncoin] page %d : %s", page, e)
            return None, 0

        m = _NEXT_DATA.search(html)
        if not m:
            return None, 0
        try:
            data = json.loads(m.group(1))
        except json.JSONDecodeError:
            return None, 0

        sd = data.get("props", {}).get("pageProps", {}).get("searchData", {})
        return sd.get("ads", []), sd.get("max_pages", 1)

    def _parse(self, ad, ville) -> dict | None:
        subject = ad.get("subject", "")
        if "viager" in subject.lower():
            return None

        attrs = ad.get("attributes", [])
        if _attr(attrs, "immo_sell_type") == "viager":
            return None

        price_list = ad.get("price", [])
        if not price_list:
            return None
        prix = price_list[0]
        if not self._filtre_prix(prix):
            return None

        surface_str = _attr(attrs, "square")
        surface = None
        try:
            surface = float(surface_str) if surface_str else None
            if surface and surface <= 0:
                surface = None
        except (ValueError, TypeError):
            pass

        type_label = _attr_label(attrs, "real_estate_type")
        if any(t in type_label for t in _APT):
            type_bien = "appartement"
        elif any(t in type_label for t in _MAI):
            type_bien = "maison"
        else:
            type_bien = None

        dpe = _attr(attrs, "energy_rate").lower() or None

        loc = ad.get("location", {})
        return {
            "url":               ad.get("url", ""),
            "site":              "leboncoin",
            "titre":             subject,
            "prix":              int(prix),
            "surface":           surface,
            "type_bien":         type_bien,
            "ville":             loc.get("city_label") or loc.get("city") or ville["ville"],
            "code_postal":       loc.get("zipcode") or ville["code_postal"],
            "dpe":               dpe,
            "description":       "",
            "date_publication":  (ad.get("first_publication_date") or "")[:10],
        }

    def fetch_description(self, url: str) -> str:
        try:
            with browser_page() as p:
                p.goto(url, wait_until="domcontentloaded", timeout=30000)
                html = p.content()
            m = _NEXT_DATA.search(html)
            if not m:
                return ""
            data  = json.loads(m.group(1))
            props = data.get("props", {}).get("pageProps", {})
            ad    = props.get("ad") or props.get("adView") or {}
            return ad.get("body", "")
        except Exception:
            return ""
