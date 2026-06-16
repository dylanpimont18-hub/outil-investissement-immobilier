"""
Tri des annonces selon 3 cas mutuellement exclusifs :
  1. URL connue    → mise à jour prix si nécessaire, annonce ignorée
  2. Fingerprint   → même bien sur un autre site, doublon ignoré
  3. Nouvelle      → ajout à la file d'enrichissement IA
"""

import sqlite3

from fingerprint import make_fingerprint
from utils import url_existe, fingerprint_existe, maj_prix_si_change, marquer_bien_vu


def filtrer_nouvelles_annonces(
    annonces: list[dict], conn: sqlite3.Connection
) -> tuple[list[dict], dict]:
    """
    Retourne (nouvelles_annonces, stats).

    nouvelles_annonces : annonces qui n'existent pas encore dans la DB,
                         avec la clé '_fingerprint' ajoutée, prêtes pour l'IA.
    stats : dict de compteurs pour le rapport.
    """
    nouvelles: list[dict] = []
    stats = {
        "total":        len(annonces),
        "connues_url":  0,
        "doublons_fp":  0,
        "nouvelles":    0,
        "prix_changes": 0,
    }
    seen_fingerprints: set[str] = set()

    with conn:
        for annonce in annonces:
            url   = annonce.get("url", "")
            prix  = int(annonce.get("prix") or 0)
            fp    = make_fingerprint(annonce)

            # Cas 1 — URL déjà en base
            bien = url_existe(url, conn)
            if bien:
                if maj_prix_si_change(bien, prix, conn, commit=False):
                    stats["prix_changes"] += 1
                stats["connues_url"] += 1
                continue

            # Cas 2 — Même bien, URL différente (doublon cross-site)
            doublon = fingerprint_existe(fp, conn)
            if doublon:
                marquer_bien_vu(doublon["id"], conn, commit=False)
                stats["doublons_fp"] += 1
                continue

            # Même lot de scan : éviter une seconde insertion avant que la DB ne voie le premier insert.
            if fp in seen_fingerprints:
                stats["doublons_fp"] += 1
                continue

            # Cas 3 — Nouveau bien
            annonce = dict(annonce)
            annonce["_fingerprint"] = fp
            nouvelles.append(annonce)
            seen_fingerprints.add(fp)
            stats["nouvelles"] += 1

    return nouvelles, stats
