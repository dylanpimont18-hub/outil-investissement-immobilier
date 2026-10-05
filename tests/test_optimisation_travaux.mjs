import assert from 'node:assert/strict';
import { computeOptimisationTravaux, computeProjectionImpotsFoyer } from '../calculs.js';

// « Quand faire les travaux ? » — pour un montant de travaux déductibles donné, compare l'économie
// d'impôt du foyer selon l'année de départ et l'étalement (1, 2 ou 3 ans en parts égales), sur une
// fenêtre de calcul commune à toutes les options.
//
// Rappel du mécanisme qui départage les options (régime réel) :
//   - la part du déficit DÉDUITE DES SALAIRES n'économise que l'IR (TMI) ;
//   - la part REPORTÉE sur les loyers économise l'IR + les prélèvements sociaux (17,2 %)… à condition
//     d'être absorbée par des loyers avant d'expirer (10 ans).
// Donc : loyers confortables → un seul gros chantier est souvent meilleur ; loyers faibles → étaler
// pour rester sous le plafond de 10 700 € évite de perdre du report.

const currentYear = new Date().getFullYear();

function makeAsset({ id = 'bien', loyer = 500, travaux = [] } = {}) {
    return {
        id, nom: id, dateAchat: `${currentYear - 3}-01`,
        acquisition: { prix: 100000, fraisAgence: 0, fraisNotaire: 0, loyerInitial: loyer, credit: { montant: 0, duree: 0, taux: 0, assurance: 0 } },
        postAchat: { taxeFonciere: 0, chargesCopro: 0, gestionLocative: 0, assurancePNO: 0, vacance: 0, travaux, chargesAnnuelles: [], notes: [] }
    };
}
const find = (res, annee, etalement) => res.options.find(o => o.annee === annee && o.etalement === etalement);

// --- Test 1 : liste des options et fenêtre commune ---
{
    const res = computeOptimisationTravaux([makeAsset()], { income: 60000, adults: 1 }, { montant: 30000, assetId: 'bien', anneeDebut: currentYear, fenetre: 5, horizon: 10 });
    assert.equal(res.options.length, 5 + 4 + 3, '5 départs en une fois, 4 sur 2 ans, 3 sur 3 ans (dans la fenêtre)');
    assert.equal(res.anneeFinCalcul, currentYear + 4 + 10, 'chaque option a au moins 10 ans pour consommer son report');
    const o = find(res, currentYear + 1, 3);
    assert.deepEqual(o.annees, [currentYear + 1, currentYear + 2, currentYear + 3]);
    assert.equal(o.montantParAn, 10000);
    console.log('Test 1 OK — 12 options, fenêtre de calcul commune');
}

// --- Test 2 : l'économie est mesurée contre « aucun travaux simulé » par le même moteur ---
{
    const assets = [makeAsset()];
    const profile = { income: 60000, adults: 1 };
    const res = computeOptimisationTravaux(assets, profile, { montant: 30000, assetId: 'bien', anneeDebut: currentYear, fenetre: 5, horizon: 10 });
    const base = computeProjectionImpotsFoyer(assets, profile, { anneeDebut: currentYear, horizon: res.anneeFinCalcul - currentYear });
    const avec = computeProjectionImpotsFoyer(assets, profile, { anneeDebut: currentYear, horizon: res.anneeFinCalcul - currentYear, travauxSimules: { assetId: 'bien', montant: 30000, annee: currentYear } });
    const o = find(res, currentYear, 1);
    assert.equal(o.economie, base.totaux.impotAvec - avec.totaux.impotAvec);
    assert.equal(o.parEuro, Math.round((o.economie / 30000) * 100) / 100);
    console.log(`Test 2 OK — économie de l'option ${currentYear} en une fois : ${o.economie} €`);
}

// --- Test 3 : loyers confortables → un seul chantier bat l'étalement ---
// 6 000 €/an de loyers, 30 000 € de travaux : en une fois, 13 300 € reportés sont absorbés par les
// loyers (économie IR + PS) ; étalé, davantage passe en déduction des salaires (IR seul).
{
    const res = computeOptimisationTravaux([makeAsset({ loyer: 500 })], { income: 60000, adults: 1 }, { montant: 30000, assetId: 'bien', anneeDebut: currentYear, fenetre: 5, horizon: 10 });
    const une = find(res, currentYear, 1), deux = find(res, currentYear, 2);
    assert.ok(une.economie > deux.economie, `une fois (${une.economie}) > sur 2 ans (${deux.economie})`);
    assert.equal(res.meilleure.etalement, 1);
    assert.equal(res.meilleure.annee, currentYear, 'les départs plus tardifs en une fois rapportent autant : à équivalence, le plus tôt');
    assert.equal(find(res, currentYear + 2, 1).equivalente, true, 'même économie à 1 % près → équivalente');
    assert.equal(deux.equivalente, false, 'écart de plus de 1 % → pas équivalente');
    console.log('Test 3 OK — loyers suffisants : un seul chantier est meilleur');
}

// --- Test 4 : loyers faibles → étaler évite que le report expire ---
// 1 200 €/an de loyers, 40 000 € de travaux : en une fois, l'essentiel du report expire sans servir.
{
    const res = computeOptimisationTravaux([makeAsset({ loyer: 100 })], { income: 60000, adults: 1 }, { montant: 40000, assetId: 'bien', anneeDebut: currentYear, fenetre: 5, horizon: 10 });
    const une = find(res, currentYear, 1), trois = find(res, currentYear, 3);
    assert.ok(une.deficitPerdu > 0, 'en une fois, du report expire');
    assert.ok(trois.economie > une.economie, `sur 3 ans (${trois.economie}) > une fois (${une.economie})`);
    assert.equal(res.meilleure.etalement, 3);
    assert.ok(trois.imputeRevenuGlobal > une.imputeRevenuGlobal, 'étaler multiplie les déductions des salaires');
    console.log('Test 4 OK — loyers faibles : étaler sur 3 ans évite de perdre du report');
}

// --- Test 5 : départage à égalité et montant nul ---
{
    // Aucun salaire ni loyer : aucune option ne change l'impôt (nul) → la plus tôt, la moins étalée.
    const res = computeOptimisationTravaux([makeAsset({ loyer: 0 })], { income: 0, adults: 1 }, { montant: 20000, assetId: 'bien', anneeDebut: currentYear, fenetre: 5, horizon: 10 });
    for (const o of res.options) assert.equal(o.economie, 0);
    assert.equal(res.meilleure.annee, currentYear);
    assert.equal(res.meilleure.etalement, 1);

    const zero = computeOptimisationTravaux([makeAsset()], { income: 60000, adults: 1 }, { montant: 0, anneeDebut: currentYear });
    assert.deepEqual(zero.options, []);
    assert.equal(zero.meilleure, null);
    console.log('Test 5 OK — départage (plus tôt, moins étalé) et montant nul');
}

console.log('ALL OPTIMISATION TRAVAUX TESTS PASSED');
