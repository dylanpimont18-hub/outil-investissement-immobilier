"""Classe de base commune à tous les scrapers."""

import time
from abc import ABC, abstractmethod

from curl_cffi import requests as crequests

from config import PRIX_MIN, PRIX_MAX


class BaseScraper(ABC):
    site: str = ""

    def __init__(self):
        self._session = crequests.Session(impersonate="chrome124")

    # ── Interface publique ────────────────────────────────────────────────────

    def fetch_all(self, villes: list[dict]) -> list[dict]:
        """
        Scrape toutes les villes et retourne la liste dédupliquée (par URL).
        """
        seen_urls: set[str] = set()
        resultats: list[dict] = []

        for ville in villes:
            try:
                annonces = self.fetch_ville(ville)
            except Exception as e:
                print(f"  [{self.site}] Erreur {ville['ville']} : {e}")
                annonces = []

            for a in annonces:
                url = a.get("url", "")
                if url and url not in seen_urls:
                    seen_urls.add(url)
                    a.setdefault("site", self.site)
                    resultats.append(a)

            if annonces:
                time.sleep(1)  # politesse

        return resultats

    @abstractmethod
    def fetch_ville(self, ville: dict) -> list[dict]:
        """Scrape une ville. Retourne une liste d'annonces normalisées."""
        ...

    # ── Utilitaires ───────────────────────────────────────────────────────────

    def _get(self, url: str, **kwargs):
        resp = self._session.get(url, timeout=30, **kwargs)
        resp.raise_for_status()
        return resp

    def _filtre_prix(self, prix) -> bool:
        if not isinstance(prix, (int, float)):
            return False
        return PRIX_MIN <= int(prix) <= PRIX_MAX

    def _type_bien(self, label: str) -> str | None:
        label = label.lower()
        if any(t in label for t in ("appartement", "studio", "loft", "duplex", "triplex")):
            return "appartement"
        if any(t in label for t in ("maison", "villa", "pavillon", "château", "manoir")):
            return "maison"
        if "immeuble" in label:
            return "immeuble"
        return None
