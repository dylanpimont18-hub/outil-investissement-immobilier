"""PAP (Particulier à Particulier) — API publique JSON."""

import time

from .base import BaseScraper

_API = "https://api.pap.fr/annonce/recherche"
_HEADERS = {
    "Accept":     "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
}


class PapScraper(BaseScraper):
    site = "pap"

    def fetch_ville(self, ville: dict) -> list[dict]:
        annonces = []
        page = 1

        while True:
            params = {
                "categorie":    "vente-appartement,vente-maison,vente-immeuble",
                "geo_objets_ids": ville["code_postal"],
                "recherche[geo][region]": "centre-val-de-loire",
                "page":         page,
                "nb_by_page":   20,
            }
            try:
                r    = self._get(_API, headers=_HEADERS, params=params)
                data = r.json()
            except Exception as e:
                print(f"  [pap] {ville['ville']} p{page} : {e}")
                break

            items = data.get("annonces") or []
            if not items:
                break

            for item in items:
                parsed = self._parse(item, ville)
                if parsed:
                    annonces.append(parsed)

            if page >= data.get("nb_pages", 1):
                break
            page += 1
            time.sleep(1)

        return annonces

    def _parse(self, item, ville) -> dict | None:
        prix = item.get("prix") or item.get("prix_hni")
        if not self._filtre_prix(prix):
            return None

        categorie = item.get("categorie", "").lower()
        if "immeuble" in categorie:
            type_bien = "immeuble"
        elif "maison" in categorie:
            type_bien = "maison"
        elif "appartement" in categorie:
            type_bien = "appartement"
        else:
            type_bien = None

        id_annonce = item.get("id", "")
        url = f"https://www.pap.fr/annonce/{id_annonce}"

        return {
            "url":              url,
            "site":             "pap",
            "titre":            item.get("titre", ""),
            "prix":             int(prix),
            "surface":          item.get("surface"),
            "type_bien":        type_bien,
            "ville":            item.get("ville") or ville["ville"],
            "code_postal":      item.get("cp") or ville["code_postal"],
            "dpe":              (item.get("dpe") or "").lower() or None,
            "description":      item.get("description", ""),
            "date_publication": (item.get("date_disponibilite") or "")[:10],
        }
