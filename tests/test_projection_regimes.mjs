import assert from 'node:assert/strict';
import { computeProjectionRegimesFoyer, computeProjectionImpotsFoyer, computeImpotFoyer } from '../calculs.js';

// « Quel régime dans le temps ? » — impôt total du FOYER année par année pour chacun des trois
// régimes, chaque régime étant supposé appliqué depuis le premier achat :
//   - micro-foncier : 70 % des loyers imposables (abattement 30 %), éligible si loyers ≤ 15 000 € ;
//   - réel : le moteur de computeProjectionImpotsFoyer (déficit, report, travaux) ;
//   - SCI à l'IS : une SCI unique, aucun dividende — impôt du foyer = IR sur salaires seuls + IS de
//     la société (amortissement 80 % du prix / 30 ans, déficit reporté sans limite, 15 % puis 25 %).

const currentYear = new Date().getFullYear();
const profileData = { income: 60000, adults: 1, children: 0 };
const impot = (foncier) => computeImpotFoyer(60000, foncier, { adults: 1, children: 0 }).total;

function makeAsset({ id = 'bien', dateAchat = `${currentYear - 3}-01`, loyer = 500, travaux = [] } = {}) {
    return {
        id, nom: id, dateAchat,
        acquisition: { prix: 100000, fraisAgence: 0, fraisNotaire: 0, loyerInitial: loyer, credit: { montant: 0, duree: 0, taux: 0, assurance: 0 } },
        postAchat: { taxeFonciere: 0, chargesCopro: 0, gestionLocative: 0, assurancePNO: 0, vacance: 0, travaux, chargesAnnuelles: [], notes: [] }
    };
}
const row = (res, annee) => res.years.find(r => r.annee === annee);

// --- Test 1 : un bien simple, les trois régimes ---
{
    const res = computeProjectionRegimesFoyer([makeAsset()], profileData, { anneeDebut: currentYear, horizon: 10 });
    assert.equal(res.years.length, 11);
    const y = row(res, currentYear);
    assert.equal(y.micro.impot, impot(4200), 'micro : 70 % de 6 000 €');
    assert.equal(y.micro.eligible, true);
    assert.equal(y.reel.impot, impot(6000));
    // SCI-IS : 6 000 − 100 000 × 80 % / 30 = 3 333 € de bénéfice → IS 15 % = 500 €.
    assert.equal(y.sciIs.is, 500);
    assert.equal(y.sciIs.impot, impot(0) + 500, 'foyer : IR sur salaires seuls + IS de la SCI');
    assert.equal(res.meilleur, 'sci-is');
    assert.equal(res.totaux['sci-is'], res.years.reduce((s, r) => s + r.sciIs.impot, 0));
    console.log('Test 1 OK — micro 70 %, réel, SCI-IS avec amortissement ; meilleur = SCI-IS');
}

// --- Test 2 : le réel est exactement le moteur de projection existant (travaux simulés compris) ---
{
    const asset = makeAsset({ travaux: [{ date: `${currentYear}-04-01`, montant: 15000, tag: 'deductible' }] });
    const opts = { anneeDebut: currentYear, horizon: 10, travauxSimules: { assetId: 'bien', montant: 8000, annee: currentYear + 2 } };
    const res = computeProjectionRegimesFoyer([asset], profileData, opts);
    const proj = computeProjectionImpotsFoyer([asset], profileData, opts);
    for (const p of proj.years) assert.equal(row(res, p.annee).reel.impot, p.impotTotal, `réel ${p.annee}`);
    assert.equal(res.totaux.reel, proj.totaux.impotAvec);
    console.log('Test 2 OK — le réel reprend computeProjectionImpotsFoyer');
}

// --- Test 3 : micro-foncier inéligible au-delà de 15 000 € de loyers du foyer ---
{
    const assets = ['A', 'B', 'C'].map(id => makeAsset({ id })); // 3 × 6 000 = 18 000 €
    const res = computeProjectionRegimesFoyer(assets, profileData, { anneeDebut: currentYear, horizon: 3 });
    assert.equal(row(res, currentYear).micro.eligible, false);
    assert.equal(res.microEligible, false);
    assert.notEqual(res.meilleur, 'micro-foncier', 'un régime inéligible ne peut pas être désigné meilleur');
    console.log('Test 3 OK — micro inéligible au-delà de 15 000 €, exclu du meilleur régime');
}

// --- Test 4 : SCI-IS — déficit reporté sans limite de durée, puis absorbé ---
// Travaux 20 000 € cette année : 6 000 − 20 000 − 2 667 = −16 667 € reportés ; 3 333 €/an absorbés
// les 5 années suivantes (IS nul), IS de 500 € à nouveau la 6ᵉ.
{
    const asset = makeAsset({ travaux: [{ date: `${currentYear}-04-01`, montant: 20000, tag: 'deductible' }] });
    const res = computeProjectionRegimesFoyer([asset], profileData, { anneeDebut: currentYear, horizon: 8 });
    assert.equal(row(res, currentYear).sciIs.is, 0);
    assert.equal(row(res, currentYear).sciIs.deficitReporte, 16667);
    for (let k = 1; k <= 5; k++) assert.equal(row(res, currentYear + k).sciIs.is, 0, `année +${k} : report absorbé`);
    assert.equal(row(res, currentYear + 6).sciIs.is, 500);
    console.log('Test 4 OK — déficit SCI-IS reporté puis absorbé');
}

// --- Test 5 : amortissement proratisé l'année d'achat ---
// Acheté en juillet : 6 mois de loyers (3 000 €) − 6 mois d'amortissement (1 333 €) = 1 667 € → IS 250 €.
{
    const res = computeProjectionRegimesFoyer([makeAsset({ dateAchat: `${currentYear}-07` })], profileData, { anneeDebut: currentYear, horizon: 1 });
    assert.equal(row(res, currentYear).sciIs.is, 250);
    console.log('Test 5 OK — amortissement proratisé l\'année d\'achat');
}

// --- Test 6 : portefeuille vide — tous les régimes = salaires seuls, valeurs entières ---
{
    const res = computeProjectionRegimesFoyer([], profileData, { anneeDebut: currentYear, horizon: 2 });
    for (const r of res.years) {
        assert.equal(r.micro.impot, impot(0));
        assert.equal(r.reel.impot, impot(0));
        assert.equal(r.sciIs.impot, impot(0));
    }
    assert.equal(res.meilleur, 'micro-foncier', 'à égalité : micro (le plus simple) d\'abord');
    console.log('Test 6 OK — portefeuille vide');
}

console.log('ALL PROJECTION REGIMES TESTS PASSED');
