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
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    bien_id               INTEGER NOT NULL REFERENCES biens(id) ON DELETE CASCADE,
    nb_pieces             INTEGER,
    travaux               INTEGER,
    travaux_montant       REAL,
    immeuble_rapport      INTEGER,
    deja_loue             INTEGER,
    loyer_actuel          REAL,
    lots_total            INTEGER,
    lots_loues            INTEGER,
    charges_copro         REAL,
    taxe_fonciere         REAL,
    meuble                INTEGER,
    parking_garage        INTEGER,
    chauffage             TEXT,
    points_forts          TEXT,
    points_faibles        TEXT,
    resume_ia             TEXT,
    loyer_estime          REAL,
    mensualite            REAL,
    cf_net                REAL,
    cf_apres_impot        REAL,
    cf_apres_impot_micro  REAL,
    cf_apres_impot_reel   REAL,
    cf_apres_impot_sci    REAL,
    regime_optimal        TEXT,
    loyer_source          TEXT,
    renta_brute           REAL,
    renta_nette_nette     REAL,
    dscr                  REAL,
    score                 INTEGER,
    date_enrichissement   TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS historique_prix (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    bien_id          INTEGER NOT NULL REFERENCES biens(id) ON DELETE CASCADE,
    prix_ancien      INTEGER NOT NULL,
    prix_nouveau     INTEGER NOT NULL,
    date_changement  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS loyers_marche (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    ville         TEXT    NOT NULL,
    code_postal   TEXT    NOT NULL,
    type_bien     TEXT    NOT NULL,
    surface_min   REAL    NOT NULL,
    surface_max   REAL    NOT NULL,
    loyer_median  REAL    NOT NULL,
    nb_annonces   INTEGER NOT NULL,
    date_collecte TEXT    NOT NULL,
    UNIQUE(ville, code_postal, type_bien, surface_min, surface_max)
);

CREATE TABLE IF NOT EXISTS geocodes (
    ville       TEXT NOT NULL,
    code_postal TEXT NOT NULL,
    lat         REAL,
    lng         REAL,
    PRIMARY KEY (ville, code_postal)
);

CREATE INDEX IF NOT EXISTS idx_biens_fingerprint ON biens(fingerprint);
CREATE INDEX IF NOT EXISTS idx_biens_url         ON biens(url);
CREATE INDEX IF NOT EXISTS idx_biens_cp          ON biens(code_postal);
CREATE INDEX IF NOT EXISTS idx_biens_dept        ON biens(substr(code_postal, 1, 2));
CREATE INDEX IF NOT EXISTS idx_annonces_bien     ON annonces(bien_id);
CREATE INDEX IF NOT EXISTS idx_historique_bien   ON historique_prix(bien_id);
CREATE INDEX IF NOT EXISTS idx_loyers_marche     ON loyers_marche(ville, type_bien, surface_min);
"""

_MIGRATIONS = [
    "ALTER TABLE annonces ADD COLUMN cf_apres_impot_reel  REAL",
    "ALTER TABLE annonces ADD COLUMN cf_apres_impot_sci   REAL",
    "ALTER TABLE annonces ADD COLUMN regime_optimal       TEXT",
    "ALTER TABLE annonces ADD COLUMN loyer_source         TEXT",
    "ALTER TABLE annonces ADD COLUMN cf_apres_impot_micro REAL",
]


def get_connection(db_path: Path | None = None) -> sqlite3.Connection:
    conn = sqlite3.connect(str(db_path or DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db(db_path: Path | None = None) -> sqlite3.Connection:
    """Crée le schéma si nécessaire et applique les migrations. Retourne la connexion."""
    conn = get_connection(db_path)
    conn.executescript(_SCHEMA)
    conn.commit()
    _apply_migrations(conn)
    return conn


def _apply_migrations(conn: sqlite3.Connection) -> None:
    """Applique les ALTER TABLE en ignorant les erreurs si la colonne existe déjà."""
    for sql in _MIGRATIONS:
        try:
            conn.execute(sql)
            conn.commit()
        except sqlite3.OperationalError as e:
            if "duplicate column" not in str(e):
                raise
