"""Configuration centrale du logger pour le scraper Spark.

Usage dans chaque module :
    from logger import get_logger
    _logger = get_logger(__name__)
    _logger.info("message")
"""
import logging
import sys
from pathlib import Path

_LOG_FILE = Path(__file__).parent / "spark_scraper.log"
_initialized: set[str] = set()


def get_logger(name: str) -> logging.Logger:
    """Retourne un logger configure avec StreamHandler + FileHandler."""
    logger = logging.getLogger(name)
    if name in _initialized:
        return logger
    _initialized.add(name)

    logger.setLevel(logging.DEBUG)
    # Empeche la propagation vers le root logger (encodage cp1252 par defaut sur Windows)
    logger.propagate = False

    fmt = logging.Formatter(
        "[%(asctime)s] %(levelname)-8s %(name)s | %(message)s",
        datefmt="%H:%M:%S",
    )

    # Console — utilise sys.stdout directement (reconfigure en utf-8 dans server.py/main.py)
    # Evite le double-wrapping du buffer qui cause des conflits en contexte multi-thread
    if sys.stdout is not None:
        ch = logging.StreamHandler(sys.stdout)
        ch.setLevel(logging.DEBUG)
        ch.setFormatter(fmt)
        logger.addHandler(ch)

    # Fichier — INFO+ uniquement, UTF-8, mode append
    try:
        fh = logging.FileHandler(_LOG_FILE, encoding="utf-8", mode="a")
        fh.setLevel(logging.INFO)
        fh.setFormatter(fmt)
        logger.addHandler(fh)
    except OSError:
        pass  # repertoire non accessible (ex. premier lancement avant creation du dossier)

    return logger
