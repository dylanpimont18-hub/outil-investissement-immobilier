"""Empreinte MD5 d'un bien immobilier pour la déduplication cross-site."""

import hashlib

# Champs stables : indépendants du site source et du prix
_CHAMPS = ["titre", "surface", "type_bien", "ville", "code_postal", "nb_pieces"]


def _normaliser(val) -> str:
    if val is None:
        return ""
    if isinstance(val, float):
        return str(round(val, 1))
    return str(val).strip().lower()


def make_fingerprint(annonce: dict) -> str:
    """
    Retourne un hash MD5 des champs stables du bien.
    Deux annonces avec le même fingerprint représentent le même bien physique.
    """
    contenu = "|".join(_normaliser(annonce.get(c)) for c in _CHAMPS)
    return hashlib.md5(contenu.encode("utf-8")).hexdigest()
