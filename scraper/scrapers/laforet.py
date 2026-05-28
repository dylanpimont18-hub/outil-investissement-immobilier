"""Laforêt — API JSON de recherche."""

import time

from .base import BaseScraper

_API = "https://www.laforet.com/api/annonces"
_HEADERS = {
    "Accept":     "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer":    "https://www.laforet.com/",
}


class LaforetScraper(BaseScraper):
    site = "laforet"

    def fetch_ville(self, ville: dict) -> list[dict]:
        annonces = []

        for page in range(1, 6):
            params = {
                "transaction":  "vente",
                "type":         "appartement,maison,immeuble",
                "localisation": ville["code_postal"],
                "page":         page,
                "nbPerPage":    20,
            }
            try:
                r    = self._get(_API, headers=_HEADERS, params=params)
                data = r.json()
            except Exception as e:
                print(f"  [laforet] {ville['ville']} p{page} : {e}")
                break

            items = data.get("annonces") or data.get("items") or []
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
        prix = item.get("prix") or item.get("price")
        if not self._filtre_prix(prix):
            return None

        type_raw  = (item.get("typeBien") or item.get("type") or "").lower()
        type_bien = self._type_bien(type_raw)

        ref = item.get("reference") or item.get("id", "")
        url = item.get("url") or f"https://www.laforet.com/annonce/{ref}"
        if not url.startswith("http"):
            url = "https://www.laforet.com" + url

        return {
            "url":              url,
            "site":             "laforet",
            "titre":            item.get("titre") or item.get("title", ""),
            "prix":             int(prix),
            "surface":          item.get("surface") or item.get("area"),
            "type_bien":        type_bien,
            "ville":            item.get("ville") or item.get("city") or ville["ville"],
            "code_postal":      item.get("codePostal") or item.get("postalCode") or ville["code_postal"],
            "dpe":              (item.get("dpe") or "").lower() or None,
            "description":      item.get("description", ""),
            "date_publication": (item.get("datePublication") or "")[:10],
        }
