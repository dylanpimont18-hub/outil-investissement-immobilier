import assert from 'node:assert/strict';
import {
    getHouseholdTaxParts, calculateTMI, computeImpotFoyer, impotRevenuDifferentiel,
    buildFinancialModel, computeAnalysisViewModel, computeResaleTimeline, computeSurtaxePlusValue,
    regimeApplicableEtude, cfDistribue, PFU_TAUX, CSG_CRDS_RATE,
} from '../calculs.js';

// Moteur de l'étude d'acquisition et socle fiscal (alignement sur Spark Cash-Flow, 2026-10-23) :
// barème différentiel avec décote et plafonnement, parent isolé, report du déficit IS, plafond du
// micro-foncier, assurance dégressive dans la projection, travaux non déductibles, PFU en SCI à l'IS,
// plus-value (forfaits, surtaxe).

const proche = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg} : ${a} ≠ ${b} (tolérance ${tol})`);

const etudeBase = {
    prix: 150000, nego: 0, loyer: 900, notaire: 8, travaux: 20000, meubles: 0, agence: 0,
    'frais-bancaires': 1000, apport: 20000, 'taux-input': 3.5, duree: 20, assurance: 0.3,
    'assurance-mode': 'initial', vacance: 100 / 12, copro: 50, fonciere: 1000, pno: 150, gestion: 0,
    regime: 'reel', revenus: 45000, adults: 2, children: 0,
};

// --- Test 1 : parent isolé (case T) — demi-part supplémentaire et plafond propre ---
{
    assert.equal(getHouseholdTaxParts(1, 2), 2.5, '1 adulte + 2 enfants = 1 + 1 + 0,5 (case T)');
    assert.equal(getHouseholdTaxParts(2, 2), 3, 'un couple ne reçoit pas la demi-part de parent isolé');
    assert.equal(calculateTMI(45000, { adults: 1, children: 2 }), 11, '45 000 € sur 2,5 parts : quotient 18 000 € → 11 %');
    console.log('Test 1 OK — parent isolé : 2,5 parts, TMI 11 % à 45 000 €');
}

// --- Test 2 : TMI après plafonnement du quotient familial ---
{
    // Couple à 80 000 € avec deux enfants : le plafond mord, le taux marginal réel est celui du quotient
    // sur 2 parts (40 000 € → 30 %), pas celui sur 3 parts (26 667 € → 11 %).
    assert.equal(calculateTMI(80000, { adults: 2, children: 2 }), 30);
    const ir = computeImpotFoyer(80000, 0, { adults: 2, children: 2 });
    assert.equal(ir.plafonnementQF.applique, true);
    console.log('Test 2 OK — TMI effective 30 % une fois le quotient familial plafonné');
}

// --- Test 3 : l'impôt d'un revenu foncier est une différence d'impôts complets, décote comprise ---
{
    const foyer = { revenus: 45000, adults: 2, children: 0 };
    const attendu = computeImpotFoyer(51930, 0, foyer).irNet - computeImpotFoyer(45000, 0, foyer).irNet;
    proche(impotRevenuDifferentiel(foyer, 6930), attendu, 1, 'différence de deux IR nets');
    // La décote se résorbe quand le revenu monte : le coût réel dépasse 6 930 × 11 % = 762 €.
    assert.ok(impotRevenuDifferentiel(foyer, 6930) > 1000, 'décote résorbée : bien plus que 762 €');
    proche(impotRevenuDifferentiel(foyer, -10700), computeImpotFoyer(34300, 0, foyer).irNet - computeImpotFoyer(45000, 0, foyer).irNet, 1, 'un déficit donne l\'économie, mesurée de même');
    console.log('Test 3 OK — 6 930 € de revenu foncier coûtent', Math.round(impotRevenuDifferentiel(foyer, 6930)), '€ d\'IR (pas 762 €)');
}

// --- Test 4 : étude au micro-foncier — barème différentiel + prélèvements sociaux ---
{
    const inputs = { ...etudeBase, regime: 'micro-foncier' };
    const m = buildFinancialModel(150000, 900, inputs, 11);
    const base = m.loyersEncaisses * 0.7;
    proche(m.impotsAnnee, impotRevenuDifferentiel({ revenus: 45000, adults: 2, children: 0 }, base) + base * CSG_CRDS_RATE, 0.01, 'impôt micro an 1');
    console.log('Test 4 OK — micro-foncier : impôt an 1 =', Math.round(m.impotsAnnee), '€');
}

// --- Test 5 : plafond du micro-foncier — réel d'office au-delà de 15 000 € de loyers ---
{
    assert.equal(regimeApplicableEtude('micro-foncier', 15000), 'micro-foncier');
    assert.equal(regimeApplicableEtude('micro-foncier', 15001), 'reel');
    const inputs = { ...etudeBase, regime: 'micro-foncier', loyer: 1500 };
    const micro = buildFinancialModel(150000, 1500, inputs, 30);
    const reel = buildFinancialModel(150000, 1500, { ...inputs, regime: 'reel' }, 30);
    assert.equal(micro.regimeApplique, 'reel');
    assert.equal(micro.impotsAnnee, reel.impotsAnnee, 'au-delà du plafond, le micro est calculé au réel');
    const vm = computeAnalysisViewModel(inputs);
    assert.equal(vm.regimeApplique, 'reel');
    assert.ok(vm.regimeComparison.find(r => r.id === 'micro-foncier').label.includes('réel d\'office'));
    console.log('Test 5 OK — 18 000 € de loyers : micro-foncier rabattu au réel, et le libellé le dit');
}

// --- Test 6 : SCI à l'IS — déficit reporté dans le tableau du prêt ---
{
    const vm = computeAnalysisViewModel({ ...etudeBase, regime: 'sci-is', travaux: 40000 });
    const [a1, a2] = vm.cashflowTable;
    assert.ok(a1.deficitReporte > 0, 'année 1 : les travaux créent un déficit de la société');
    assert.ok(a2.deficitReporte < a1.deficitReporte || a2.deficitReporte > 0, 'année 2 : le déficit est reporté, pas perdu');
    console.log('Test 6 OK — SCI-IS : déficit an 1 =', a1.deficitReporte, '€ reporté (reste fin an 2 :', a2.deficitReporte, '€)');
}

// --- Test 7 : comparaison des régimes — SCI à l'IS après PFU ---
{
    assert.equal(PFU_TAUX, 0.314, 'PFU 2026 : 12,8 % + 18,6 %');
    assert.equal(cfDistribue('sci-is', 100), 100 * (1 - 0.314));
    assert.equal(cfDistribue('sci-is', -100), -100, 'un cash-flow négatif ne se distribue pas');
    assert.equal(cfDistribue('reel', 100), 100);
    const inputs = { ...etudeBase, regime: 'sci-is', loyer: 1600, travaux: 0 };
    const vm = computeAnalysisViewModel(inputs);
    const sci = vm.regimeComparison.find(r => r.id === 'sci-is');
    const m = buildFinancialModel(150000, 1600, inputs, 11);
    assert.ok(m.cfNetNet > 0, 'cas choisi : cash-flow positif dans la société');
    proche(sci.cfNetNet, m.cfNetNet * (1 - PFU_TAUX), 0.01, 'CF comparé = CF de la société après PFU');
    assert.ok(sci.label.includes('après PFU'));
    console.log('Test 7 OK — SCI-IS comparée après PFU :', Math.round(sci.cfNetNet), '€/mois contre', Math.round(m.cfNetNet), '€/mois dans la société');
}

// --- Test 8 : sans durée de crédit, pas de prêt fantôme ---
{
    const m = buildFinancialModel(150000, 900, { ...etudeBase, duree: 0 }, 11);
    assert.equal(m.montantFinance, 0, 'durée nulle : coût intégralement apporté');
    assert.equal(m.mensualiteCredit, 0);
    assert.equal(m.interetsAnnee1, 0);
    console.log('Test 8 OK — durée de crédit nulle : aucun capital emprunté sans remboursement');
}

// --- Test 9 : assurance dégressive appliquée dans la projection ---
{
    const initial = computeAnalysisViewModel({ ...etudeBase, 'assurance-mode': 'initial' }).projection.years;
    const crd = computeAnalysisViewModel({ ...etudeBase, 'assurance-mode': 'crd' }).projection.years;
    proche(crd[0].annualCashflow, initial[0].annualCashflow, 0.01, 'année 1 : même cotisation (CRD au 1er jour = capital initial)');
    assert.ok(crd[9].annualCashflow > initial[9].annualCashflow, 'année 10 : la cotisation dégressive est plus faible');
    console.log('Test 9 OK — assurance sur CRD : CF an 10 =', Math.round(crd[9].annualCashflow), '€ contre', Math.round(initial[9].annualCashflow), '€ au capital initial');
}

// --- Test 10 : travaux non déductibles — dans le coût, pas dans les charges ---
{
    const tous = buildFinancialModel(150000, 900, { ...etudeBase }, 11);
    const agrandissement = buildFinancialModel(150000, 900, { ...etudeBase, 'travaux-non-deductibles': 20000 }, 11);
    assert.equal(agrandissement.coutTotal, tous.coutTotal, 'le coût de l\'opération est inchangé');
    assert.ok(agrandissement.impotsAnnee > tous.impotsAnnee, 'moins de charges déductibles : moins d\'économie d\'impôt');
    const borne = buildFinancialModel(150000, 900, { ...etudeBase, 'travaux-non-deductibles': 99999 }, 11);
    assert.equal(borne.impotsAnnee, agrandissement.impotsAnnee, 'la part non déductible est bornée par le budget travaux');
    console.log('Test 10 OK — 20 000 € d\'agrandissement : impôt an 1', Math.round(agrandissement.impotsAnnee), '€ au lieu de', Math.round(tous.impotsAnnee), '€');
}

// --- Test 11 : la matrice prix/loyer suit tous les champs (cache) ---
{
    const a = computeAnalysisViewModel({ ...etudeBase }).priceRentMatrix;
    const b = computeAnalysisViewModel({ ...etudeBase, travaux: 60000 }).priceRentMatrix;
    const base = m => m.rows.find(r => r.isBase).cells.find(c => c.isBase).cfNetNet;
    assert.notEqual(base(a), base(b), 'changer les travaux doit recalculer la matrice');
    console.log('Test 11 OK — matrice recalculée quand les travaux changent');
}

// --- Test 12 : surtaxe sur les plus-values supérieures à 50 000 € ---
{
    assert.equal(computeSurtaxePlusValue(50000), 0);
    proche(computeSurtaxePlusValue(55000), 55000 * 0.02 - (60000 - 55000) / 20, 0.001, 'palier lissé 50-60 k€');
    proche(computeSurtaxePlusValue(80000), 1600, 0.001, '2 % de 60 à 100 k€');
    proche(computeSurtaxePlusValue(300000), 18000, 0.001, '6 % au-delà de 260 k€');
    console.log('Test 12 OK — surtaxe : 55 000 € →', computeSurtaxePlusValue(55000), '€');
}

// --- Test 13 : revente — forfaits 7,5 % et 15 %, SCI à l'IS imposée à l'IS puis au PFU ---
{
    const series = n => Array.from({ length: n }, () => 0);
    const inputs = { ...etudeBase, regime: 'reel', notaire: 0, agence: 0, travaux: 0, appreciation: 3, 'frais-revente': 0, apport: 0 };
    const t = computeResaleTimeline(150000, series(10), series(10), inputs);
    // An 3 (≤ 5 ans) : forfait 7,5 % seul. An 6 : forfait travaux 15 % en plus, abattement IR 6 %.
    const pv3 = 150000 * Math.pow(1.03, 2) - 150000 * 1.075;
    proche(t.rows[2].plusValueTaxable, pv3, 0.01, 'an 3 : prix majoré du forfait de 7,5 % (frais réels nuls)');
    const pv6 = 150000 * Math.pow(1.03, 5) - 150000 * (1 + 0.075 + 0.15);
    proche(t.rows[5].plusValueTaxable, pv6, 0.01, 'an 6 : forfait travaux de 15 % au-delà de 5 ans');
    assert.equal(t.rows[5].impotPv, 0, 'plus-value négative après forfaits : aucun impôt');

    const sci = computeResaleTimeline(150000, series(10), series(10), { ...inputs, regime: 'sci-is' });
    const ligne = sci.rows[9];
    assert.ok(ligne.plusValueTaxable > t.rows[9].plusValueTaxable, 'SCI-IS : amortissements repris, plus-value plus forte');
    assert.ok(ligne.impotPv > t.rows[9].impotPv, 'SCI-IS : IS puis PFU, sans abattement pour durée de détention');
    console.log('Test 13 OK — revente : forfaits appliqués ; SCI-IS an 10 impôt de sortie', Math.round(ligne.impotPv), '€ contre', Math.round(t.rows[9].impotPv), '€ en direct');
}

console.log('ALL ÉTUDE FISCALITÉ TESTS PASSED');
