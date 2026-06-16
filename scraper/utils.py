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

def inserer_bien(
    annonce: dict,
    fingerprint: str,
    conn: sqlite3.Connection,
    *,
    commit: bool = True,
) -> int:
    """Insère un bien dans la table biens et retourne son id."""
    maintenant = _now()
    cur = conn.execute(
        """INSERT INTO biens
           (fingerprint, site, url, titre, description, prix, surface, type_bien,
            ville, code_postal, dpe, source_scrape,
            date_premiere_vue, date_derniere_vue)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            fingerprint,
            annonce.get("site", ""),
            annonce.get("url", ""),
            annonce.get("titre"),
            annonce.get("description") or "",
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
    if commit:
        conn.commit()
    return cur.lastrowid


def inserer_annonce(
    bien_id: int,
    enrichie: dict,
    conn: sqlite3.Connection,
    *,
    commit: bool = True,
) -> int:
    """Insère les données enrichies (IA + calculs) dans la table annonces."""
    cur = conn.execute(
        """INSERT INTO annonces
           (bien_id, nb_pieces, travaux, travaux_montant, immeuble_rapport,
            deja_loue, loyer_actuel, lots_total, lots_loues,
            charges_copro, taxe_fonciere, meuble, parking_garage, chauffage,
            points_forts, points_faibles, resume_ia,
            loyer_estime, mensualite, cf_net, cf_apres_impot, cf_apres_impot_micro,
            cf_apres_impot_reel, cf_apres_impot_sci, regime_optimal, loyer_source,
            renta_brute, renta_nette_nette, dscr, score,
            date_enrichissement)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                   ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
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
            enrichie.get("cf_apres_impot_micro"),
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
    if commit:
        conn.commit()
    return cur.lastrowid


def maj_description_bien(
    bien_id: int,
    description: str,
    conn: sqlite3.Connection,
    *,
    commit: bool = True,
) -> None:
    """Met à jour le contenu brut d'un bien déjà stocké."""
    conn.execute(
        "UPDATE biens SET description = ? WHERE id = ?",
        (description, bien_id),
    )
    if commit:
        conn.commit()


# ── Mise à jour ───────────────────────────────────────────────────────────────

def marquer_bien_vu(
    bien_id: int,
    conn: sqlite3.Connection,
    *,
    commit: bool = True,
) -> None:
    conn.execute(
        "UPDATE biens SET date_derniere_vue = ?, missing_scan_count = 0 WHERE id = ?",
        (_now(), bien_id),
    )
    if commit:
        conn.commit()


def maj_prix_si_change(
    bien_row: sqlite3.Row,
    nouveau_prix: int,
    conn: sqlite3.Connection,
    *,
    commit: bool = True,
) -> bool:
    """Met à jour le prix et logue l'historique si le prix a changé. Retourne True si changement."""
    if bien_row["prix"] == nouveau_prix:
        marquer_bien_vu(bien_row["id"], conn, commit=commit)
        return False

    conn.execute(
        "UPDATE biens SET prix = ?, date_derniere_vue = ?, missing_scan_count = 0 WHERE id = ?",
        (nouveau_prix, _now(), bien_row["id"]),
    )
    log_historique_prix(bien_row["id"], bien_row["prix"], nouveau_prix, conn, commit=False)
    if commit:
        conn.commit()
    return True


def incrementer_scans_manques(
    code_postal: str,
    seen_urls: set[str],
    seen_fingerprints: set[str],
    active_sources: set[str],
    conn: sqlite3.Connection,
    *,
    commit: bool = True,
) -> int:
    if not code_postal or not active_sources:
        return 0

    query_parts = [
        "UPDATE biens",
        "SET missing_scan_count = COALESCE(missing_scan_count, 0) + 1",
        "WHERE code_postal = ?",
    ]
    params: list[object] = [code_postal]

    source_placeholders = ", ".join("?" for _ in active_sources)
    query_parts.append(f"AND COALESCE(source_scrape, site) IN ({source_placeholders})")
    params.extend(sorted(active_sources))

    if seen_urls:
        url_placeholders = ", ".join("?" for _ in seen_urls)
        query_parts.append(f"AND url NOT IN ({url_placeholders})")
        params.extend(sorted(seen_urls))

    if seen_fingerprints:
        fingerprint_placeholders = ", ".join("?" for _ in seen_fingerprints)
        query_parts.append(f"AND fingerprint NOT IN ({fingerprint_placeholders})")
        params.extend(sorted(seen_fingerprints))

    cur = conn.execute(" ".join(query_parts), params)
    if commit:
        conn.commit()
    return cur.rowcount


def log_historique_prix(
    bien_id: int,
    prix_ancien: int,
    prix_nouveau: int,
    conn: sqlite3.Connection,
    *,
    commit: bool = True,
):
    conn.execute(
        """INSERT INTO historique_prix (bien_id, prix_ancien, prix_nouveau, date_changement)
           VALUES (?, ?, ?, ?)""",
        (bien_id, prix_ancien, prix_nouveau, _now()),
    )
    if commit:
        conn.commit()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _tri(val) -> int | None:
    """Convertit un booléen nullable en 0/1/None pour SQLite."""
    return None if val is None else int(bool(val))
