"""Immobilier.notaires.fr — API de recherche JSON."""

import time

from .base import BaseScraper

_API = "https://www.immobilier.notaires.fr/api/annonces/search"
_HEADERS = {
    "Accept":       "application/json",
    "Content-Type": "application/json",
    "User-Agent":   "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer":      "https://www.immobilier.notaires.fr/",
}


class NotairesScraper(BaseScraper):
    site = "notaires"

    def fetch_ville(self, ville: dict) -> list[dict]:
        annonces = []

        for page in range(1, 6):
            payload = {
                "transaction":   "VENTE",
                "typeBiens":     ["APPARTEMENT", "MAISON", "IMMEUBLE"],
                "codePostal":    ville["code_postal"],
                "pagination":    {"page": page, "size": 20},
                "tri":           "date_desc",
            }
            try:
                r    = self._session.post(_API, headers=_HEADERS, json=payload, timeout=30)
                r.raise_for_status()
                data = r.json()
            except Exception as e:
                print(f"  [notaires] {ville['ville']} p{page} : {e}")
                break

            items = data.get("annonces") or data.get("results") or []
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
        prix = item.get("prix") or item.get("prixVente")
        if not self._filtre_prix(prix):
            return None

        type_raw  = (item.get("typeBien") or "").lower()
        type_bien = self._type_bien(type_raw)

        ref = item.get("reference") or item.get("id", "")
        url = item.get("url") or f"https://www.immobilier.notaires.fr/annonce/{ref}"
        if not url.startswith("http"):
            url = "https://www.immobilier.notaires.fr" + url

        return {
            "url":              url,
            "site":             "notaires",
            "titre":            item.get("titre") or item.get("libelle", ""),
            "prix":             int(prix),
            "surface":          item.get("surface") or item.get("surfaceHabitable"),
            "type_bien":        type_bien,
            "ville":            item.get("ville") or item.get("commune") or ville["ville"],
            "code_postal":      item.get("codePostal") or ville["code_postal"],
            "dpe":              (item.get("dpe") or "").lower() or None,
            "description":      item.get("description", ""),
            "date_publication": (item.get("datePublication") or "")[:10],
        }
