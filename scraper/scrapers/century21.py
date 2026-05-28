"""Century 21 — scraping HTML (BeautifulSoup)."""

import time

from bs4 import BeautifulSoup

from .base import BaseScraper

_BASE    = "https://www.century21.fr"
_SEARCH  = f"{_BASE}/annonces/achat/"
_HEADERS = {
    "Accept":     "text/html,application/xhtml+xml",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
}


class Century21Scraper(BaseScraper):
    site = "century21"

    def fetch_ville(self, ville: dict) -> list[dict]:
        annonces = []

        for page in range(1, 6):
            params = {
                "localisation_ids": ville["code_postal"],
                "type_transactions": "1",   # vente
                "page": page,
            }
            try:
                r    = self._get(_SEARCH, headers=_HEADERS, params=params)
                soup = BeautifulSoup(r.text, "html.parser")
            except Exception as e:
                print(f"  [century21] {ville['ville']} p{page} : {e}")
                break

            cards = soup.select("article.ann-list-item, article[data-ref]")
            if not cards:
                break

            for card in cards:
                parsed = self._parse(card, ville)
                if parsed:
                    annonces.append(parsed)

            if len(cards) < 10:
                break
            time.sleep(1)

        return annonces

    def _parse(self, card, ville) -> dict | None:
        # Prix
        prix_el = card.select_one(".ann-list-item-price, .price")
        if not prix_el:
            return None
        prix_txt = prix_el.get_text(strip=True).replace(" ", "").replace(" ", "").replace("€", "")
        try:
            prix = int("".join(c for c in prix_txt if c.isdigit()))
        except ValueError:
            return None
        if not self._filtre_prix(prix):
            return None

        # Lien
        link = card.select_one("a[href]")
        href = (link["href"] if link else "") or ""
        url  = href if href.startswith("http") else _BASE + href
        if not url or url == _BASE:
            return None

        # Titre / type
        titre_el  = card.select_one(".ann-list-item-title, h2, h3")
        titre     = titre_el.get_text(strip=True) if titre_el else ""
        type_bien = self._type_bien(titre)

        # Surface
        surf_el  = card.select_one(".ann-list-item-area, .surface")
        surface  = None
        if surf_el:
            surf_txt = surf_el.get_text(strip=True)
            try:
                surface = float("".join(c for c in surf_txt if c.isdigit() or c == "."))
            except ValueError:
                pass

        return {
            "url":              url,
            "site":             "century21",
            "titre":            titre,
            "prix":             prix,
            "surface":          surface,
            "type_bien":        type_bien,
            "ville":            ville["ville"],
            "code_postal":      ville["code_postal"],
            "dpe":              None,
            "description":      "",
            "date_publication": "",
        }
