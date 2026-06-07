# tests/test_calculs.py
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "scraper"))

from calculs import (
    _mensualite_credit, _interets_annee1,
    _cf_micro_foncier, _cf_reel_foncier, _cf_sci_is,
)


def test_mensualite_basique():
    # 100 000 € sur 20 ans à 3.35% — crédit seul + assurance séparée
    credit = _mensualite_credit(100_000, 3.35, 240)
    assurance = 100_000 * 0.30 / 100 / 12
    m = credit + assurance
    assert 560 < m < 600  # ~579 €/mois


def test_interets_annee1():
    # Sur 100 000 € à 3.35%, les intérêts année 1 ≈ 3 200 €
    i = _interets_annee1(100_000, 3.35, 240)
    assert 3000 < i < 3500


def test_cf_micro_foncier_loyer_eleve():
    # Loyer élevé → CF positif (charges légères, TMI 11%)
    cf = _cf_micro_foncier(
        loyer=900, mensualite=500, charges_copro=30,
        taxe_fonciere=25, vacance=75, tmi=11
    )
    assert cf > 0


def test_cf_micro_foncier_loyer_faible():
    # Loyer faible → CF négatif
    cf = _cf_micro_foncier(
        loyer=400, mensualite=550, charges_copro=40,
        taxe_fonciere=40, vacance=33, tmi=30
    )
    assert cf < 0


def test_cf_reel_meilleur_que_micro_avec_travaux():
    # Avec travaux importants, le réel est souvent plus avantageux
    cf_micro = _cf_micro_foncier(600, 480, 30, 45, 50, 30)
    cf_reel  = _cf_reel_foncier(600, 480, 30, 45, 50, 30, 100_000, 3.35, 0.30, 240, 20_000)
    assert cf_reel >= cf_micro


def test_cf_sci_is_calcul_coherent():
    cf = _cf_sci_is(700, 520, 35, 50, 58, 110_000, 3.35, 0.30, 240)
    # SCI IS avec amortissement → IS faible les premières années
    assert isinstance(cf, float)
    assert -500 < cf < 500  # dans une plage raisonnable


def test_enrichir_sans_conn():
    from calculs import enrichir
    annonce = {
        "prix": 95_000, "surface": 70, "type_bien": "appartement",
        "ville": "Bourges", "code_postal": "18000",
    }
    result = enrichir(annonce, conn=None)
    assert result["calculable"] is True
    assert result["loyer_source"] == "taux_fixe"
    assert result["cf_apres_impot"] is not None
    assert result["cf_apres_impot_reel"] is not None
    assert result["cf_apres_impot_sci"] is not None
    assert result["regime_optimal"] in ("micro", "reel", "sci_is")
