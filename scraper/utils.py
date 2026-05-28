"""Opérations CRUD sur la base SQLite."""

import json
import sqlite3
from datetime import datetime


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


# ── Lecture ──────────────────────────────────────────────────────────────────

def url_existe(url: str, conn: sqlite3.Connection) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM biens WHERE url = ?", (url,)).fetchone()


def fingerprint_existe(fp: str, conn: sqlite3.Connection) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM biens WHERE fingerprint = ?", (fp,)).fetchone()


# ── Insertion ────────────────────────────────────────────────────────────────

def inserer_bien(annonce: dict, fingerprint: str, conn: sqlite3.Connection) -> int:
    """Insère un bien dans la table biens et retourne son id."""
    maintenant = _now()
    cur = conn.execute(
        """INSERT INTO biens
           (fingerprint, site, url, titre, prix, surface, type_bien,
            ville, code_postal, dpe, source_scrape,
            date_premiere_vue, date_derniere_vue)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            fingerprint,
            annonce.get("site", ""),
            annonce.get("url", ""),
            annonce.get("titre"),
            annonce.get("prix"),
            annonce.get("surface"),
            annonce.get("type_bien"),
            annonce.get("ville"),
            annonce.get("code_postal"),
            annonce.get("dpe"),
            annonce.get("site", ""),
            maintenant,
            maintenant,
        ),
    )
    conn.commit()
    return cur.lastrowid


def inserer_annonce(bien_id: int, enrichie: dict, conn: sqlite3.Connection) -> int:
    """Insère les données enrichies (IA + calculs) dans la table annonces."""
    cur = conn.execute(
        """INSERT INTO annonces
           (bien_id, nb_pieces, travaux, travaux_montant, immeuble_rapport,
            deja_loue, loyer_actuel, lots_total, lots_loues,
            charges_copro, taxe_fonciere, meuble, parking_garage, chauffage,
            points_forts, points_faibles, resume_ia,
            loyer_estime, mensualite, cf_net, cf_apres_impot,
            cf_apres_impot_reel, cf_apres_impot_sci, regime_optimal, loyer_source,
            renta_brute, renta_nette_nette, dscr, score,
            date_enrichissement)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                   ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            bien_id,
            enrichie.get("nb_pieces"),
            int(bool(enrichie.get("travaux"))),
            enrichie.get("travaux_montant"),
            int(bool(enrichie.get("immeuble_rapport"))),
            _tri(enrichie.get("deja_loue")),
            enrichie.get("loyer_actuel"),
            enrichie.get("lots_total"),
            enrichie.get("lots_loues"),
            enrichie.get("charges_copro_annonce"),
            enrichie.get("taxe_fonciere_annonce"),
            _tri(enrichie.get("meuble")),
            int(bool(enrichie.get("parking_garage"))),
            enrichie.get("chauffage"),
            json.dumps(enrichie.get("points_forts") or [], ensure_ascii=False),
            json.dumps(enrichie.get("points_faibles") or [], ensure_ascii=False),
            enrichie.get("resume_ia"),
            enrichie.get("loyer_estime"),
            enrichie.get("mensualite"),
            enrichie.get("cf_net"),
            enrichie.get("cf_apres_impot"),
            enrichie.get("cf_apres_impot_reel"),
            enrichie.get("cf_apres_impot_sci"),
            enrichie.get("regime_optimal"),
            enrichie.get("loyer_source"),
            enrichie.get("renta_brute"),
            enrichie.get("renta_nette_nette"),
            enrichie.get("dscr"),
            enrichie.get("score"),
            _now(),
        ),
    )
    conn.commit()
    return cur.lastrowid


# ── Mise à jour ───────────────────────────────────────────────────────────────

def maj_prix_si_change(bien_row: sqlite3.Row, nouveau_prix: int, conn: sqlite3.Connection) -> bool:
    """Met à jour le prix et logue l'historique si le prix a changé. Retourne True si changement."""
    if bien_row["prix"] == nouveau_prix:
        conn.execute(
            "UPDATE biens SET date_derniere_vue = ? WHERE id = ?",
            (_now(), bien_row["id"]),
        )
        conn.commit()
        return False

    conn.execute(
        "UPDATE biens SET prix = ?, date_derniere_vue = ? WHERE id = ?",
        (nouveau_prix, _now(), bien_row["id"]),
    )
    log_historique_prix(bien_row["id"], bien_row["prix"], nouveau_prix, conn)
    return True


def log_historique_prix(
    bien_id: int, prix_ancien: int, prix_nouveau: int, conn: sqlite3.Connection
):
    conn.execute(
        """INSERT INTO historique_prix (bien_id, prix_ancien, prix_nouveau, date_changement)
           VALUES (?, ?, ?, ?)""",
        (bien_id, prix_ancien, prix_nouveau, _now()),
    )
    conn.commit()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _tri(val) -> int | None:
    """Convertit un booléen nullable en 0/1/None pour SQLite."""
    return None if val is None else int(bool(val))
