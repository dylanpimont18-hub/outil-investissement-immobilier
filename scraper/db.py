"""Initialisation et connexion à la base SQLite."""

import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "biens.db"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS biens (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    fingerprint        TEXT    UNIQUE NOT NULL,
    site               TEXT    NOT NULL,
    url                TEXT    UNIQUE NOT NULL,
    titre              TEXT,
    prix               INTEGER,
    surface            REAL,
    type_bien          TEXT,
    ville              TEXT,
    code_postal        TEXT,
    dpe                TEXT,
    source_scrape      TEXT,
    date_premiere_vue  TEXT    NOT NULL,
    date_derniere_vue  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS annonces (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    bien_id             INTEGER NOT NULL REFERENCES biens(id) ON DELETE CASCADE,
    nb_pieces           INTEGER,
    travaux             INTEGER,
    travaux_montant     REAL,
    immeuble_rapport    INTEGER,
    deja_loue           INTEGER,
    loyer_actuel        REAL,
    lots_total          INTEGER,
    lots_loues          INTEGER,
    charges_copro       REAL,
    taxe_fonciere       REAL,
    meuble              INTEGER,
    parking_garage      INTEGER,
    chauffage           TEXT,
    points_forts        TEXT,
    points_faibles      TEXT,
    resume_ia           TEXT,
    loyer_estime        REAL,
    mensualite          REAL,
    cf_net              REAL,
    cf_apres_impot      REAL,
    renta_brute         REAL,
    renta_nette_nette   REAL,
    dscr                REAL,
    score               INTEGER,
    date_enrichissement TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS historique_prix (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    bien_id          INTEGER NOT NULL REFERENCES biens(id) ON DELETE CASCADE,
    prix_ancien      INTEGER NOT NULL,
    prix_nouveau     INTEGER NOT NULL,
    date_changement  TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_biens_fingerprint ON biens(fingerprint);
CREATE INDEX IF NOT EXISTS idx_biens_url         ON biens(url);
CREATE INDEX IF NOT EXISTS idx_biens_cp          ON biens(code_postal);
CREATE INDEX IF NOT EXISTS idx_biens_dept        ON biens(substr(code_postal, 1, 2));
CREATE INDEX IF NOT EXISTS idx_annonces_bien     ON annonces(bien_id);
CREATE INDEX IF NOT EXISTS idx_historique_bien   ON historique_prix(bien_id);
"""


def get_connection(db_path: Path | None = None) -> sqlite3.Connection:
    conn = sqlite3.connect(str(db_path or DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db(db_path: Path | None = None) -> sqlite3.Connection:
    """Crée le schéma si nécessaire et retourne la connexion."""
    conn = get_connection(db_path)
    conn.executescript(_SCHEMA)
    conn.commit()
    return conn
