from config import (
    TAUX_CREDIT, ASSURANCE, DUREE_MOIS,
    LOYER_M2_APPARTEMENT, LOYER_M2_MAISON,
    LOYER_MAX_APPARTEMENT, LOYER_MAX_MAISON,
    CHARGES_COPRO_APPARTEMENT, CHARGES_COPRO_MAISON,
    TAXE_FONCIERE_RATIO, VACANCE_RATIO,
    TMI,
)
from marche_locatif import estimer_loyer


def _mensualite(capital, taux_annuel_pct, assurance_annuel_pct, duree_mois):
    taux_mensuel = (taux_annuel_pct + assurance_annuel_pct) / 100 / 12
    if taux_mensuel == 0:
        return capital / duree_mois
    return capital * taux_mensuel / (1 - (1 + taux_mensuel) ** (-duree_mois))


def _loyer_fallback(surface, type_bien):
    """Taux fixes plafonnés — utilisés si les données marché sont absentes."""
    loyer_m2 = LOYER_M2_APPARTEMENT if type_bien == "appartement" else LOYER_M2_MAISON
    loyer_max = LOYER_MAX_APPARTEMENT if type_bien == "appartement" else LOYER_MAX_MAISON
    return min(surface * loyer_m2, loyer_max)


def _score(cf_apres_impot, dscr, renta_brute, dpe):
    """Score d'opportunité 0–100."""
    # CF après impôt (30 pts) : 0 à -300€ → 30 à +300€
    cf_score = max(0.0, min(30.0, 15.0 + cf_apres_impot / 20.0))

    # DSCR (25 pts) : 0 à 0.70 → 25 à 1.30
    dscr_score = max(0.0, min(25.0, (dscr - 0.70) / 0.60 * 25.0))

    # Renta brute (25 pts) : 0 à 3 % → 25 à 10 %
    renta_score = max(0.0, min(25.0, (renta_brute - 3.0) / 7.0 * 25.0))

    # Pénalité DPE
    dpe_penalty = {"g": 20, "f": 15, "e": 10}.get((dpe or "").lower(), 0)

    return max(0, min(100, round(cf_score + dscr_score + renta_score - dpe_penalty)))


def enrichir(annonce, marche=None):
    prix = annonce["prix"]
    surface = annonce.get("surface")
    type_bien = annonce.get("type_bien")

    if not surface or not type_bien or type_bien not in ("appartement", "maison", "immeuble"):
        annonce["calculable"] = False
        annonce["cf_net"] = None
        annonce["cf_apres_impot"] = None
        annonce["renta_brute"] = None
        annonce["renta_nette_nette"] = None
        annonce["dscr"] = None
        annonce["score"] = None
        annonce["loyer_estime"] = None
        annonce["mensualite"] = None
        return annonce

    annonce["calculable"] = True

    # Loyer : données marché réel → fallback taux fixes
    loyer_marche = estimer_loyer(surface, type_bien, marche) if marche else None
    if loyer_marche:
        loyer = float(loyer_marche)
        annonce["loyer_source"] = "marche"
    else:
        loyer = _loyer_fallback(surface, type_bien)
        annonce["loyer_source"] = "taux_fixe"

    # Charges copro : données IA si disponibles, sinon défauts
    if annonce.get("charges_copro_annonce") is not None:
        charges_copro = float(annonce["charges_copro_annonce"])
    elif type_bien == "appartement":
        charges_copro = CHARGES_COPRO_APPARTEMENT
    else:
        charges_copro = CHARGES_COPRO_MAISON

    # Taxe foncière : données IA si disponibles, sinon ratio loyer
    if annonce.get("taxe_fonciere_annonce") is not None:
        taxe_fonciere = float(annonce["taxe_fonciere_annonce"]) / 12
    else:
        taxe_fonciere = loyer * TAXE_FONCIERE_RATIO

    vacance = loyer * VACANCE_RATIO
    mensualite = _mensualite(prix, TAUX_CREDIT, ASSURANCE, DUREE_MOIS)

    cf_net = loyer - mensualite - charges_copro - taxe_fonciere - vacance
    renta_brute = (loyer * 12) / prix * 100 if prix > 0 else 0

    # Micro-foncier : abattement 30 %, imposition sur 70 % des loyers
    impot_mensuel = loyer * 0.70 * (TMI / 100)
    cf_apres_impot = cf_net - impot_mensuel

    # DSCR (Debt Service Coverage Ratio)
    dscr = loyer / mensualite if mensualite > 0 else 0

    # Rentabilité nette-nette
    renta_nette_nette = (cf_apres_impot * 12) / prix * 100 if prix > 0 else 0

    # Score d'opportunité
    score = _score(cf_apres_impot, dscr, renta_brute, annonce.get("dpe"))

    annonce["loyer_estime"] = round(loyer, 0)
    annonce["mensualite"] = round(mensualite, 2)
    annonce["charges_copro"] = round(charges_copro, 2)
    annonce["taxe_fonciere"] = round(taxe_fonciere, 2)
    annonce["vacance"] = round(vacance, 2)
    annonce["cf_net"] = round(cf_net, 2)
    annonce["cf_apres_impot"] = round(cf_apres_impot, 2)
    annonce["dscr"] = round(dscr, 2)
    annonce["renta_brute"] = round(renta_brute, 2)
    annonce["renta_nette_nette"] = round(renta_nette_nette, 2)
    annonce["score"] = score

    return annonce
