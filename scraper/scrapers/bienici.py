"""Bien'ici — API JSON de recherche."""

import json
import time

from .base import BaseScraper

_API = "https://www.bienici.com/realEstateAds.json"
_HEADERS = {
    "Accept":     "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer":    "https://www.bienici.com/",
}


class BienIciScraper(BaseScraper):
    site = "bienici"

    def fetch_ville(self, ville: dict) -> list[dict]:
        annonces = []

        for page in range(1, 6):
            filters = {
                "filters": json.dumps({
                    "size":             25,
                    "from":             (page - 1) * 25,
                    "filterType":       "buy",
                    "propertyType":     ["house", "flat", "building"],
                    "zoneIdsByTypes":   {"cityIds": [ville["code_postal"]]},
                    "sortBy":           "relevance",
                    "sortOrder":        "desc",
                    "onTheMarket":      [True],
                })
            }
            try:
                r    = self._get(_API, headers=_HEADERS, params=filters)
                data = r.json()
            except Exception as e:
                print(f"  [bienici] {ville['ville']} p{page} : {e}")
                break

            items = data.get("realEstateAds") or []
            if not items:
                break

            for item in items:
                parsed = self._parse(item, ville)
                if parsed:
                    annonces.append(parsed)

            if len(items) < 25:
                break
            time.sleep(1)

        return annonces

    def _parse(self, item, ville) -> dict | None:
        prix = item.get("price")
        if not self._filtre_prix(prix):
            return None

        type_raw  = (item.get("propertyType") or "").lower()
        type_bien = self._type_bien(type_raw)

        id_ann = item.get("id", "")
        url    = item.get("url") or f"https://www.bienici.com/annonce/{id_ann}"
        if not url.startswith("http"):
            url = "https://www.bienici.com" + url

        city = item.get("city") or ville["ville"]
        cp   = item.get("postalCode") or ville["code_postal"]

        return {
            "url":              url,
            "site":             "bienici",
            "titre":            item.get("title") or item.get("reference", ""),
            "prix":             int(prix),
            "surface":          item.get("surfaceArea") or item.get("surface"),
            "type_bien":        type_bien,
            "ville":            city,
            "code_postal":      str(cp),
            "dpe":              (item.get("energyClassification") or "").lower() or None,
            "description":      item.get("description", ""),
            "date_publication": (item.get("publicationDate") or "")[:10],
        }
