"""Orpi — API de recherche JSON."""

import time

from .base import BaseScraper

_API = "https://www.orpi.com/api/search"
_HEADERS = {
    "Accept":       "application/json",
    "Content-Type": "application/json",
    "User-Agent":   "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer":      "https://www.orpi.com/",
}


class OrpiScraper(BaseScraper):
    site = "orpi"

    def fetch_ville(self, ville: dict) -> list[dict]:
        annonces = []

        for page in range(1, 6):
            payload = {
                "transaction": "sale",
                "propertyTypes": ["house", "flat", "building"],
                "location": {"postalCode": ville["code_postal"]},
                "pagination": {"page": page, "size": 20},
            }
            try:
                r    = self._session.post(_API, headers=_HEADERS, json=payload, timeout=30)
                r.raise_for_status()
                data = r.json()
            except Exception as e:
                print(f"  [orpi] {ville['ville']} p{page} : {e}")
                break

            items = data.get("results") or data.get("properties") or []
            if not items:
                break

            for item in items:
                parsed = self._parse(item, ville)
                if parsed:
                    annonces.append(parsed)

            if page >= data.get("totalPages", 1):
                break
            time.sleep(1)

        return annonces

    def _parse(self, item, ville) -> dict | None:
        prix = item.get("price") or item.get("sellingPrice")
        if not self._filtre_prix(prix):
            return None

        type_raw  = (item.get("propertyType") or item.get("type") or "").lower()
        type_bien = self._type_bien(type_raw)

        ref = item.get("reference") or item.get("id", "")
        url = item.get("url") or f"https://www.orpi.com/annonce/{ref}"
        if not url.startswith("http"):
            url = "https://www.orpi.com" + url

        return {
            "url":              url,
            "site":             "orpi",
            "titre":            item.get("title") or f"{type_raw.capitalize()} {item.get('surface','')}m²",
            "prix":             int(prix),
            "surface":          item.get("surface") or item.get("area"),
            "type_bien":        type_bien,
            "ville":            item.get("city") or ville["ville"],
            "code_postal":      item.get("postalCode") or ville["code_postal"],
            "dpe":              (item.get("dpe") or item.get("energyClass") or "").lower() or None,
            "description":      item.get("description", ""),
            "date_publication": (item.get("publicationDate") or "")[:10],
        }
