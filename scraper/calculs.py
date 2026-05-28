"""Moteur financier — adapté pour le scraper multi-sites Centre-Val de Loire."""

from config import (
    TAUX_CREDIT, ASSURANCE, DUREE_MOIS,
    LOYER_M2_APPARTEMENT, LOYER_M2_MAISON,
    LOYER_MAX_APPARTEMENT, LOYER_MAX_MAISON,
    CHARGES_COPRO_APPARTEMENT, CHARGES_COPRO_MAISON,
    TAXE_FONCIERE_RATIO, VACANCE_RATIO, TMI,
)


def _mensualite(capital, taux_annuel_pct, assurance_annuel_pct, duree_mois):
    taux = (taux_annuel_pct + assurance_annuel_pct) / 100 / 12
    if taux == 0:
        return capital / duree_mois
    return capital * taux / (1 - (1 + taux) ** (-duree_mois))


def _loyer_fallback(surface, type_bien):
    loyer_m2  = LOYER_M2_APPARTEMENT if type_bien == "appartement" else LOYER_M2_MAISON
    loyer_max = LOYER_MAX_APPARTEMENT if type_bien == "appartement" else LOYER_MAX_MAISON
    return min(surface * loyer_m2, loyer_max)


def _score(cf_apres_impot, dscr, renta_brute, dpe, prix=None, surface=None):
    # CF après impôt (30 pts) : -300 → 0, +300 → 30
    cf_score = max(0.0, min(30.0, 15.0 + cf_apres_impot / 20.0))

    # DSCR (25 pts) : 0.70 → 0, 1.30 → 25
    dscr_score = max(0.0, min(25.0, (dscr - 0.70) / 0.60 * 25.0))

    # Renta brute (25 pts) : 3 % → 0, 10 % → 25
    renta_score = max(0.0, min(25.0, (renta_brute - 3.0) / 7.0 * 25.0))

    # Prix au m² (20 pts) — Centre-Val de Loire
    pm2_score = 0.0
    if prix and surface and surface > 0:
        pm2 = prix / surface
        if   pm2 < 800:   pm2_score = 20.0
        elif pm2 < 1300:  pm2_score = 15.0
        elif pm2 < 2000:  pm2_score = 10.0
        elif pm2 < 3000:  pm2_score = 5.0

    # Pénalité DPE
    dpe_penalty = {"g": 20, "f": 15, "e": 10}.get((dpe or "").lower(), 0)

    return max(0, min(100, round(cf_score + dscr_score + renta_score + pm2_score - dpe_penalty)))


def enrichir(annonce: dict) -> dict:
    """Calcule tous les indicateurs financiers et le score. Modifie annonce en place."""
    prix      = annonce.get("prix")
    surface   = annonce.get("surface")
    type_bien = annonce.get("type_bien")

    if not prix or not surface or not type_bien or type_bien not in ("appartement", "maison", "immeuble"):
        annonce["calculable"] = False
        for k in ("cf_net", "cf_apres_impot", "renta_brute", "renta_nette_nette", "dscr", "score", "loyer_estime", "mensualite"):
            annonce.setdefault(k, None)
        return annonce

    annonce["calculable"] = True

    # Loyer : annonce (si loué) → fallback taux fixes
    if annonce.get("loyer_actuel") and annonce.get("deja_loue"):
        loyer = float(annonce["loyer_actuel"])
        annonce["loyer_source"] = "annonce"
    else:
        loyer = _loyer_fallback(surface, type_bien)
        annonce["loyer_source"] = "taux_fixe"

    # Charges copro
    if annonce.get("charges_copro_annonce") is not None:
        charges_copro = float(annonce["charges_copro_annonce"])
    elif type_bien == "appartement":
        charges_copro = CHARGES_COPRO_APPARTEMENT
    else:
        charges_copro = CHARGES_COPRO_MAISON

    # Taxe foncière mensuelle
    if annonce.get("taxe_fonciere_annonce") is not None:
        taxe_fonciere = float(annonce["taxe_fonciere_annonce"]) / 12
    else:
        taxe_fonciere = loyer * TAXE_FONCIERE_RATIO

    vacance    = loyer * VACANCE_RATIO
    mensualite = _mensualite(prix, TAUX_CREDIT, ASSURANCE, DUREE_MOIS)

    cf_net      = loyer - mensualite - charges_copro - taxe_fonciere - vacance
    renta_brute = (loyer * 12) / prix * 100

    # Micro-foncier — base = loyers effectivement encaissés (vacance exclue)
    loyer_encaisse = loyer - vacance
    impot_mensuel  = loyer_encaisse * 0.70 * (TMI / 100 + 0.172)
    cf_apres_impot = cf_net - impot_mensuel

    dscr              = loyer / mensualite if mensualite > 0 else 0
    renta_nette_nette = (cf_apres_impot * 12) / prix * 100

    score = _score(cf_apres_impot, dscr, renta_brute, annonce.get("dpe"), prix, surface)

    annonce["loyer_estime"]       = round(loyer, 0)
    annonce["mensualite"]         = round(mensualite, 2)
    annonce["charges_copro"]      = round(charges_copro, 2)
    annonce["taxe_fonciere"]      = round(taxe_fonciere, 2)
    annonce["vacance"]            = round(vacance, 2)
    annonce["cf_net"]             = round(cf_net, 2)
    annonce["cf_apres_impot"]     = round(cf_apres_impot, 2)
    annonce["dscr"]               = round(dscr, 2)
    annonce["renta_brute"]        = round(renta_brute, 2)
    annonce["renta_nette_nette"]  = round(renta_nette_nette, 2)
    annonce["score"]              = score

    return annonce
