"""BellesDemeures.fr — scraping HTML (propriétés haut de gamme)."""

import time

from bs4 import BeautifulSoup

from .base import BaseScraper

_BASE    = "https://www.bellesdemeures.com"
_SEARCH  = f"{_BASE}/annonces/vente/"
_HEADERS = {
    "Accept":     "text/html,application/xhtml+xml",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
}

# BellesDemeures est orienté prestige — pas de filtre prix min strict
_REGIONS = {
    "18": "cher",
    "28": "eure-et-loir",
    "36": "indre",
    "37": "indre-et-loire",
    "41": "loir-et-cher",
    "45": "loiret",
}


class BellesDemeuresScraper(BaseScraper):
    site = "bellesdemeures"

    def fetch_ville(self, ville: dict) -> list[dict]:
        # BellesDemeures indexe par département, pas par CP — on déduplique via fetch_all
        dept    = ville["dept"]
        region  = _REGIONS.get(dept)
        if not region:
            return []

        # Éviter de scraper le même département plusieurs fois
        if getattr(self, "_depts_scraped", None) is None:
            self._depts_scraped: set[str] = set()
        if dept in self._depts_scraped:
            return []
        self._depts_scraped.add(dept)

        annonces = []
        for page in range(1, 4):
            url = f"{_SEARCH}{region}/?page={page}"
            try:
                r    = self._get(url, headers=_HEADERS)
                soup = BeautifulSoup(r.text, "html.parser")
            except Exception as e:
                print(f"  [bellesdemeures] dept {dept} p{page} : {e}")
                break

            cards = soup.select("article.property-card, div.property-item, li.result-item")
            if not cards:
                break

            for card in cards:
                parsed = self._parse(card, ville)
                if parsed:
                    annonces.append(parsed)

            if len(cards) < 5:
                break
            time.sleep(1.5)

        return annonces

    def _parse(self, card, ville) -> dict | None:
        # Prix
        prix_el = card.select_one(".price, .prix, [class*='price']")
        if not prix_el:
            return None
        prix_txt = prix_el.get_text(strip=True)
        try:
            prix = int("".join(c for c in prix_txt if c.isdigit()))
        except ValueError:
            return None
        if not self._filtre_prix(prix):
            return None

        # URL
        link = card.select_one("a[href]")
        href = (link["href"] if link else "") or ""
        url  = href if href.startswith("http") else _BASE + href
        if not url or url == _BASE:
            return None

        # Titre
        titre_el  = card.select_one("h2, h3, .title, .titre")
        titre     = titre_el.get_text(strip=True) if titre_el else ""
        type_bien = self._type_bien(titre)

        # Surface
        surface = None
        surf_el = card.select_one(".surface, [class*='area'], [class*='surface']")
        if surf_el:
            surf_txt = surf_el.get_text(strip=True)
            try:
                surface = float("".join(c for c in surf_txt if c.isdigit() or c == "."))
            except ValueError:
                pass

        # Localisation
        loc_el = card.select_one(".location, .localisation, [class*='location']")
        ville_str = loc_el.get_text(strip=True) if loc_el else ville["ville"]

        return {
            "url":              url,
            "site":             "bellesdemeures",
            "titre":            titre,
            "prix":             prix,
            "surface":          surface,
            "type_bien":        type_bien or "maison",
            "ville":            ville_str or ville["ville"],
            "code_postal":      ville["code_postal"],
            "dpe":              None,
            "description":      "",
            "date_publication": "",
        }
