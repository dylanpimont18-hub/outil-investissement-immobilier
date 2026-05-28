"""Logic-Immo — API JSON de recherche."""

import time

from .base import BaseScraper

_API = "https://www.logic-immo.com/immobilier/api/search"
_HEADERS = {
    "Accept":     "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer":    "https://www.logic-immo.com/",
}


class LogicImmoScraper(BaseScraper):
    site = "logicimmo"

    def fetch_ville(self, ville: dict) -> list[dict]:
        annonces = []

        for page in range(1, 6):
            params = {
                "types":       "buy",
                "locations":   ville["code_postal"],
                "subtypes":    "house,flat,building",
                "page":        page,
                "size":        20,
                "excludeNewBuilding": "true",
            }
            try:
                r    = self._get(_API, headers=_HEADERS, params=params)
                data = r.json()
            except Exception as e:
                print(f"  [logicimmo] {ville['ville']} p{page} : {e}")
                break

            items = data.get("result") or data.get("items") or []
            if not items:
                break

            for item in items:
                parsed = self._parse(item, ville)
                if parsed:
                    annonces.append(parsed)

            if page >= data.get("nbPages", 1):
                break
            time.sleep(1)

        return annonces

    def _parse(self, item, ville) -> dict | None:
        prix = item.get("price") or item.get("prix")
        if not self._filtre_prix(prix):
            return None

        type_raw  = (item.get("propertyType") or item.get("type") or "").lower()
        type_bien = self._type_bien(type_raw)

        ref = item.get("reference") or item.get("id", "")
        url = item.get("url") or f"https://www.logic-immo.com/detail-vente-{ref}.htm"
        if not url.startswith("http"):
            url = "https://www.logic-immo.com" + url

        loc = item.get("location") or item.get("localisation") or {}
        return {
            "url":              url,
            "site":             "logicimmo",
            "titre":            item.get("title") or item.get("titre", ""),
            "prix":             int(prix),
            "surface":          item.get("surface") or item.get("area"),
            "type_bien":        type_bien,
            "ville":            loc.get("city") or loc.get("ville") or ville["ville"],
            "code_postal":      loc.get("postalCode") or loc.get("codePostal") or ville["code_postal"],
            "dpe":              (item.get("dpe") or item.get("energyClass") or "").lower() or None,
            "description":      item.get("description", ""),
            "date_publication": (item.get("publicationDate") or "")[:10],
        }
