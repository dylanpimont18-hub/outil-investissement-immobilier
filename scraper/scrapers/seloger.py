"""SeLoger — API de recherche interne (JSON)."""

import time

from .base import BaseScraper

_API = "https://api.seloger.com/api/salesmen/v2/listings"
_HEADERS = {
    "Accept":          "application/json",
    "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Authorization":   "Basic Y2xpZW50X2lkOmNsaWVudF9zZWNyZXQ=",
    "Referer":         "https://www.seloger.com/",
}

# IDs de département SeLoger
_DEPT_IDS = {
    "18": "18", "28": "28", "36": "36",
    "37": "37", "41": "41", "45": "45",
}


class SeLogerScraper(BaseScraper):
    site = "seloger"

    def fetch_ville(self, ville: dict) -> list[dict]:
        annonces = []
        dept = ville["dept"]

        for page in range(1, 6):
            params = {
                "types":           "1,2",    # 1=appartement, 2=maison
                "transactionType": "1",       # vente
                "departments":     dept,
                "zipCodes":        ville["code_postal"],
                "page":            page,
                "resultsPerPage":  25,
                "includeNewBuildings": "false",
            }
            try:
                r    = self._get(_API, headers=_HEADERS, params=params)
                data = r.json()
            except Exception as e:
                print(f"  [seloger] {ville['ville']} p{page} : {e}")
                break

            listings = data.get("listings") or data.get("ads") or []
            if not listings:
                break

            for item in listings:
                parsed = self._parse(item, ville)
                if parsed:
                    annonces.append(parsed)

            if page >= data.get("pagination", {}).get("totalPageCount", 1):
                break
            time.sleep(1)

        return annonces

    def _parse(self, item, ville) -> dict | None:
        prix = item.get("price") or item.get("priceValue")
        if not self._filtre_prix(prix):
            return None

        type_raw  = (item.get("estateType") or item.get("propertyType") or "").lower()
        type_bien = self._type_bien(type_raw)

        id_ann = item.get("id") or item.get("listingId", "")
        url    = item.get("url") or f"https://www.seloger.com/annonces/achat/{id_ann}.htm"

        loc = item.get("location") or {}
        return {
            "url":              url,
            "site":             "seloger",
            "titre":            item.get("title") or item.get("subject", ""),
            "prix":             int(prix),
            "surface":          item.get("surface") or item.get("area"),
            "type_bien":        type_bien,
            "ville":            loc.get("city") or ville["ville"],
            "code_postal":      loc.get("zipCode") or ville["code_postal"],
            "dpe":              (item.get("energyClassification") or "").lower() or None,
            "description":      item.get("description", ""),
            "date_publication": (item.get("publicationDate") or "")[:10],
        }
