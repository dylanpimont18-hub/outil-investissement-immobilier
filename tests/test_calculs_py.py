"""Tests for scraper/calculs.py — P0a alignment with calculs.js."""
import sys
import os
import types
import unittest

# ── Mock config before importing calculs ──────────────────────────────────────
_config = types.ModuleType('config')
_config.TAUX_CREDIT               = 3.0
_config.ASSURANCE                 = 0.30
_config.DUREE_MOIS                = 240
_config.LOYER_M2_APPARTEMENT      = 8.5
_config.LOYER_M2_MAISON           = 7.0
_config.LOYER_MAX_APPARTEMENT     = 700.0
_config.LOYER_MAX_MAISON          = 900.0
_config.CHARGES_COPRO_APPARTEMENT = 80.0
_config.CHARGES_COPRO_MAISON      = 20.0
_config.TAXE_FONCIERE_RATIO       = 0.083
_config.VACANCE_RATIO             = 0.05
_config.TMI                       = 30
sys.modules['config'] = _config

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scraper'))
import calculs as C  # noqa: E402


class TestMensualiteCredit(unittest.TestCase):
    def test_credit_only_matches_js_formula(self):
        """_mensualite_credit must match JS: capital * taux_m / (1 - (1+taux_m)^-n)."""
        capital, taux_pct, duree = 100_000, 3.0, 240
        taux_m = taux_pct / 100 / 12
        expected = capital * taux_m / (1 - (1 + taux_m) ** -duree)
        result = C._mensualite_credit(capital, taux_pct, duree)
        self.assertAlmostEqual(result, expected, places=2)

    def test_total_mensualite_matches_js(self):
        """Credit + insurance separately must give same total as JS."""
        capital, taux_pct, assurance_pct, duree = 100_000, 3.0, 0.30, 240
        taux_m = taux_pct / 100 / 12
        credit_js = capital * taux_m / (1 - (1 + taux_m) ** -duree)
        assurance_js = capital * assurance_pct / 100 / 12
        total_js = round(credit_js + assurance_js, 2)

        credit_py = C._mensualite_credit(capital, taux_pct, duree)
        assurance_py = capital * assurance_pct / 100 / 12
        total_py = round(credit_py + assurance_py, 2)

        self.assertAlmostEqual(total_py, total_js, places=1)

    def test_zero_rate(self):
        """Zero interest rate: capital / duree."""
        result = C._mensualite_credit(120_000, 0, 240)
        self.assertAlmostEqual(result, 500.0, places=2)

    def test_old_combined_formula_is_different(self):
        """Prove the old combined-rate formula gives a different (lower) total."""
        capital, taux_pct, assurance_pct, duree = 100_000, 3.0, 0.30, 240
        # Old formula
        taux_old = (taux_pct + assurance_pct) / 100 / 12
        old_total = capital * taux_old / (1 - (1 + taux_old) ** -duree)
        # New formula (separate)
        taux_m = taux_pct / 100 / 12
        new_total = (capital * taux_m / (1 - (1 + taux_m) ** -duree)) + capital * assurance_pct / 100 / 12
        # They must differ
        self.assertNotAlmostEqual(old_total, new_total, places=1)


class TestSciIsAmortissement(unittest.TestCase):
    def test_amortissement_uses_80_pct(self):
        """SCI-IS: amortissement must be prix * 0.80 / 30, matching calculs.js:55."""
        # _cf_sci_is with a known simple case — we check the IS isn't calculated with 0.85
        prix = 120_000
        # amort 0.80: 120000 * 0.80 / 30 = 3200 / year
        # amort 0.85: 120000 * 0.85 / 30 = 3400 / year
        # Higher amortissement → lower IS → higher CF
        loyer = 800.0
        mensualite = C._mensualite_credit(prix, 3.0, 240) + prix * 0.30 / 100 / 12
        # Call with zero charges to isolate the amortissement effect
        cf_with_08 = C._cf_sci_is(loyer, mensualite, 0, 0, 0, prix, 3.0, 0.30, 240)
        # Manual check: if 0.80 is used, amort_an = 3200
        # Compute expected CF manually with 0.80
        taux_m = 3.0 / 100 / 12
        n = 240
        credit = prix * taux_m / (1 - (1 + taux_m) ** -n)
        assurance_m = prix * 0.30 / 100 / 12
        mens_total = credit + assurance_m
        # interests year1
        solde = float(prix)
        interets_an = 0.0
        for _ in range(12):
            i = solde * taux_m
            interets_an += i
            solde -= (credit - i)
        assurance_an = prix * 0.30 / 100
        amort_08 = prix * 0.80 / 30
        loyer_an = loyer * 12  # vacance = 0
        deductible = interets_an + assurance_an + amort_08
        benefice = loyer_an - deductible
        if benefice > 0:
            if benefice <= 42_500:
                is_an = benefice * 0.15
            else:
                is_an = 42_500 * 0.15 + (benefice - 42_500) * 0.25
        else:
            is_an = 0.0
        expected_cf = round(loyer - mens_total - 0 - 0 - 0 - is_an / 12, 2)
        self.assertAlmostEqual(cf_with_08, expected_cf, places=1)


if __name__ == '__main__':
    unittest.main()
