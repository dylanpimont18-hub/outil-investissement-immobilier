"""Moteur financier — 3 régimes fiscaux + loyer de marché."""

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


def _interets_annee1(capital, taux_annuel_pct, duree_mois) -> float:
    """Somme exacte des intérêts sur les 12 premiers mois du crédit."""
    taux_m = taux_annuel_pct / 100 / 12
    if taux_m == 0:
        return 0.0
    mensualite = capital * taux_m / (1 - (1 + taux_m) ** (-duree_mois))
    solde = float(capital)
    total = 0.0
    for _ in range(12):
        interet = solde * taux_m
        total  += interet
        solde  -= mensualite - interet
    return total


def _loyer_fallback(surface, type_bien) -> float:
    loyer_m2  = LOYER_M2_APPARTEMENT if type_bien == "appartement" else LOYER_M2_MAISON
    loyer_max = LOYER_MAX_APPARTEMENT if type_bien == "appartement" else LOYER_MAX_MAISON
    return min(surface * loyer_m2, loyer_max)


def get_loyer_marche(ville, type_bien, surface, conn):
    """Retourne (loyer_median, nb_annonces) depuis loyers_marche, ou None."""
    if not conn:
        return None
    try:
        row = conn.execute("""
            SELECT loyer_median, nb_annonces FROM loyers_marche
            WHERE ville = ? AND type_bien = ?
              AND surface_min <= ? AND surface_max > ?
            ORDER BY nb_annonces DESC
            LIMIT 1
        """, (ville, type_bien, float(surface), float(surface))).fetchone()
        return (float(row["loyer_median"]), int(row["nb_annonces"])) if row else None
    except Exception:
        return None


def _cf_micro_foncier(loyer, mensualite, charges_copro, taxe_fonciere, vacance, tmi) -> float:
    loyer_encaisse = loyer - vacance
    impot_mensuel  = loyer_encaisse * 0.70 * (tmi / 100 + 0.172)
    return round(loyer - mensualite - charges_copro - taxe_fonciere - vacance - impot_mensuel, 2)


def _cf_reel_foncier(loyer, mensualite, charges_copro, taxe_fonciere, vacance,
                     tmi, prix, taux_credit, assurance, duree_mois, travaux_montant=0) -> float:
    interets_annuels   = _interets_annee1(prix, taux_credit, duree_mois)
    assurance_annuelle = prix * assurance / 100
    loyer_encaisse_an  = (loyer - vacance) * 12
    deductible         = (interets_annuels + assurance_annuelle +
                          charges_copro * 12 + taxe_fonciere * 12 +
                          (travaux_montant or 0))
    revenu_imposable   = loyer_encaisse_an - deductible
    impot_annuel       = max(0.0, revenu_imposable) * (tmi / 100 + 0.172)
    impot_mensuel      = impot_annuel / 12
    return round(loyer - mensualite - charges_copro - taxe_fonciere - vacance - impot_mensuel, 2)


def _cf_sci_is(loyer, mensualite, charges_copro, taxe_fonciere, vacance,
               prix, taux_credit, assurance, duree_mois) -> float:
    interets_annuels   = _interets_annee1(prix, taux_credit, duree_mois)
    assurance_annuelle = prix * assurance / 100
    amortissement_an   = prix * 0.85 / 30  # 85 % amortissable, 30 ans
    loyer_encaisse_an  = (loyer - vacance) * 12
    deductible         = (interets_annuels + assurance_annuelle + amortissement_an +
                          charges_copro * 12 + taxe_fonciere * 12)
    resultat           = loyer_encaisse_an - deductible
    if resultat <= 0:
        is_annuel = 0.0
    elif resultat <= 42_500:
        is_annuel = resultat * 0.15
    else:
        is_annuel = 42_500 * 0.15 + (resultat - 42_500) * 0.25
    is_mensuel = is_annuel / 12
    return round(loyer - mensualite - charges_copro - taxe_fonciere - vacance - is_mensuel, 2)


def _score(cf_apres_impot, dscr, renta_brute, dpe, prix=None, surface=None) -> int:
    cf_score    = max(0.0, min(30.0, 15.0 + cf_apres_impot / 20.0))
    dscr_score  = max(0.0, min(25.0, (dscr - 0.70) / 0.60 * 25.0))
    renta_score = max(0.0, min(25.0, (renta_brute - 3.0) / 7.0 * 25.0))
    pm2_score   = 0.0
    if prix and surface and surface > 0:
        pm2 = prix / surface
        if   pm2 < 800:   pm2_score = 20.0
        elif pm2 < 1300:  pm2_score = 15.0
        elif pm2 < 2000:  pm2_score = 10.0
        elif pm2 < 3000:  pm2_score = 5.0
    dpe_penalty = {"g": 20, "f": 15, "e": 10}.get((dpe or "").lower(), 0)
    return max(0, min(100, round(cf_score + dscr_score + renta_score + pm2_score - dpe_penalty)))


def enrichir(annonce: dict, conn=None) -> dict:
    """Calcule CF pour 3 régimes fiscaux et le score. Modifie annonce en place."""
    prix      = annonce.get("prix")
    surface   = annonce.get("surface")
    type_bien = annonce.get("type_bien")
    ville     = annonce.get("ville", "")

    if not prix or not surface or not type_bien or type_bien not in ("appartement", "maison", "immeuble"):
        annonce["calculable"] = False
        for k in ("cf_net", "cf_apres_impot", "cf_apres_impot_reel", "cf_apres_impot_sci",
                  "renta_brute", "renta_nette_nette", "dscr", "score",
                  "loyer_estime", "mensualite", "regime_optimal", "loyer_source",
                  "loyer_marche_ref"):
            annonce.setdefault(k, None)
        return annonce

    annonce["calculable"] = True

    # Priorité loyer : annonce > marché > taux fixe
    loyer_marche = get_loyer_marche(ville, type_bien, surface, conn) if conn else None
    if annonce.get("loyer_actuel") and annonce.get("deja_loue"):
        loyer = float(annonce["loyer_actuel"])
        annonce["loyer_source"]     = "annonce"
        annonce["loyer_marche_ref"] = None
    elif loyer_marche:
        loyer = loyer_marche[0]
        annonce["loyer_source"]     = "marche"
        annonce["loyer_marche_ref"] = loyer_marche[1]
    else:
        loyer = _loyer_fallback(surface, type_bien)
        annonce["loyer_source"]     = "taux_fixe"
        annonce["loyer_marche_ref"] = None

    # Charges
    if annonce.get("charges_copro_annonce") is not None:
        charges_copro = float(annonce["charges_copro_annonce"])
    elif type_bien == "appartement":
        charges_copro = CHARGES_COPRO_APPARTEMENT
    else:
        charges_copro = CHARGES_COPRO_MAISON

    if annonce.get("taxe_fonciere_annonce") is not None:
        taxe_fonciere = float(annonce["taxe_fonciere_annonce"]) / 12
    else:
        taxe_fonciere = loyer * TAXE_FONCIERE_RATIO

    vacance    = loyer * VACANCE_RATIO
    mensualite = _mensualite(prix, TAUX_CREDIT, ASSURANCE, DUREE_MOIS)

    cf_net      = loyer - mensualite - charges_copro - taxe_fonciere - vacance
    renta_brute = (loyer * 12) / prix * 100
    dscr        = loyer / mensualite if mensualite > 0 else 0.0

    # 3 régimes
    travaux  = annonce.get("travaux_montant") or 0
    cf_micro = _cf_micro_foncier(loyer, mensualite, charges_copro, taxe_fonciere, vacance, TMI)
    cf_reel  = _cf_reel_foncier(loyer, mensualite, charges_copro, taxe_fonciere, vacance,
                                 TMI, prix, TAUX_CREDIT, ASSURANCE, DUREE_MOIS, travaux)
    cf_sci   = _cf_sci_is(loyer, mensualite, charges_copro, taxe_fonciere, vacance,
                          prix, TAUX_CREDIT, ASSURANCE, DUREE_MOIS)

    regimes        = {"micro": cf_micro, "reel": cf_reel, "sci_is": cf_sci}
    regime_optimal = max(regimes, key=regimes.get)
    cf_apres_impot = regimes[regime_optimal]

    renta_nette_nette = (cf_apres_impot * 12) / prix * 100
    score = _score(cf_apres_impot, dscr, renta_brute, annonce.get("dpe"), prix, surface)

    annonce["loyer_estime"]         = round(loyer, 0)
    annonce["mensualite"]           = round(mensualite, 2)
    annonce["charges_copro"]        = round(charges_copro, 2)
    annonce["taxe_fonciere"]        = round(taxe_fonciere, 2)
    annonce["vacance"]              = round(vacance, 2)
    annonce["cf_net"]               = round(cf_net, 2)
    annonce["cf_apres_impot"]       = round(cf_apres_impot, 2)
    annonce["cf_apres_impot_reel"]  = cf_reel
    annonce["cf_apres_impot_sci"]   = cf_sci
    annonce["regime_optimal"]       = regime_optimal
    annonce["dscr"]                 = round(dscr, 2)
    annonce["renta_brute"]          = round(renta_brute, 2)
    annonce["renta_nette_nette"]    = round(renta_nette_nette, 2)
    annonce["score"]                = score

    return annonce
