import assert from 'node:assert/strict';
import { computeProjectionImpotsFoyer, computeImpotFoyer } from '../calculs.js';

// Projection des impôts du foyer sur les années à venir, en fonction des travaux déductibles.
// Mécanisme (art. 156 I 3° CGI, régime foncier réel) :
//   - un déficit foncier HORS intérêts s'impute sur le revenu global (salaires) à hauteur de
//     10 700 €/an — « déduction des salaires » ;
//   - l'excédent, et la part du déficit due aux intérêts d'emprunt, se reportent sur les revenus
//     fonciers des 10 années suivantes (FIFO) — « déduction des loyers » ;
//   - l'impôt de chaque année est celui du foyer entier (IR au barème + prélèvements sociaux
//     17,2 % sur le revenu foncier imposable), calculé par computeImpotFoyer.
// Le moteur raisonne au niveau du FOYER : les résultats fonciers de tous les biens s'additionnent
// avant imputation, comme sur la déclaration 2044.

const currentYear = new Date().getFullYear();
const profileData = { income: 60000, adults: 1, children: 0 };
const foyer = { adults: 1, children: 0 };
const impot = (foncier) => computeImpotFoyer(60000, foncier, foyer).total;

function makeAsset({ id = 'bien', dateAchat, loyer = 500, travaux = [], credit = null } = {}) {
    return {
        id, nom: id, dateAchat,
        acquisition: {
            prix: 100000, fraisAgence: 0, fraisNotaire: 0, loyerInitial: loyer,
            credit: credit || { montant: 0, duree: 0, taux: 0, assurance: 0 }
        },
        postAchat: {
            taxeFonciere: 0, chargesCopro: 0, gestionLocative: 0, assurancePNO: 0,
            vacance: 0, travaux, chargesAnnuelles: [], notes: []
        }
    };
}

const row = (proj, annee) => proj.years.find(r => r.annee === annee);

// --- Test 1 : sans travaux, le scénario « avec » et « sans » sont identiques, impôt = foyer + loyers ---
{
    const asset = makeAsset({ dateAchat: `${currentYear - 3}-01`, loyer: 500 });
    const proj = computeProjectionImpotsFoyer([asset], profileData, { anneeDebut: currentYear, horizon: 10 });
    assert.equal(proj.years.length, 11, 'horizon 10 ans = 11 lignes (année de départ incluse)');
    assert.equal(proj.years[0].annee, currentYear);
    assert.equal(proj.years.at(-1).annee, currentYear + 10);
    for (const r of proj.years) {
        assert.equal(r.loyers, 6000, `loyers ${r.annee}`);
        assert.equal(r.travaux, 0);
        assert.equal(r.resultatFoncier, 6000);
        assert.equal(r.revenuFoncierImposable, 6000);
        assert.equal(r.imputeRevenuGlobal, 0);
        assert.equal(r.reportUtilise, 0);
        assert.equal(r.impotTotal, impot(6000), `impôt ${r.annee} = IR + PS sur 60 000 € de salaires + 6 000 € de foncier`);
        assert.equal(r.impotSansTravaux, r.impotTotal, 'aucun travaux futur : les deux scénarios coïncident');
        assert.equal(r.economie, 0);
        assert.equal(r.impotSalairesSeuls, impot(0), 'référence salaires seuls');
    }
    assert.equal(proj.totaux.economie, 0);
    assert.equal(proj.stockInitial, 0);
    console.log('Test 1 OK — sans travaux, projection = impôt du foyer avec ses loyers, économie nulle');
}

// --- Test 2 : 20 000 € de travaux déductibles l'année de départ (sans crédit) ---
// loyers 6 000 − travaux 20 000 = −14 000 : 10 700 imputés sur les salaires, 3 300 reportés sur les
// loyers de l'année suivante (6 000 − 3 300 = 2 700 imposables), puis plus rien.
{
    const asset = makeAsset({
        dateAchat: `${currentYear - 3}-01`, loyer: 500,
        travaux: [{ date: `${currentYear}-05-10`, montant: 20000, tag: 'deductible' }]
    });
    const proj = computeProjectionImpotsFoyer([asset], profileData, { anneeDebut: currentYear, horizon: 10 });
    const y0 = row(proj, currentYear), y1 = row(proj, currentYear + 1), y2 = row(proj, currentYear + 2);

    assert.equal(y0.travaux, 20000);
    assert.equal(y0.resultatFoncier, -14000);
    assert.equal(y0.imputeRevenuGlobal, 10700, 'déduction des salaires plafonnée à 10 700 €');
    assert.equal(y0.deficitReporte, 3300, 'excédent reporté sur les loyers futurs');
    assert.equal(y0.stockFin, 3300);
    assert.equal(y0.revenuFoncierImposable, 0);
    assert.equal(y0.impotTotal, impot(-10700), 'l\'IR de l\'année est calculé sur 60 000 − 10 700 €, sans prélèvements sociaux');
    assert.equal(y0.impotSansTravaux, impot(6000));
    assert.equal(y0.economie, impot(6000) - impot(-10700));
    assert.ok(y0.economie > 0, 'les travaux font baisser l\'impôt de l\'année');

    assert.equal(y1.travaux, 0);
    assert.equal(y1.reportUtilise, 3300, 'déduction des loyers : le report absorbe une partie des 6 000 € de loyers');
    assert.equal(y1.revenuFoncierImposable, 2700);
    assert.equal(y1.stockFin, 0);
    assert.equal(y1.impotTotal, impot(2700));
    assert.equal(y1.economie, impot(6000) - impot(2700));

    assert.equal(y2.reportUtilise, 0);
    assert.equal(y2.revenuFoncierImposable, 6000);
    assert.equal(y2.economie, 0, 'au-delà, plus aucun effet');

    assert.equal(proj.totaux.travaux, 20000);
    assert.equal(proj.totaux.economie, y0.economie + y1.economie);
    assert.equal(proj.totaux.imputeRevenuGlobal, 10700);
    assert.equal(proj.totaux.reportUtilise, 3300);
    console.log(`Test 2 OK — 20 000 € de travaux : 10 700 € déduits des salaires, 3 300 € reportés ; économie totale ${proj.totaux.economie} €`);
}

// --- Test 3 : la part du déficit due aux intérêts d'emprunt n'est jamais déduite des salaires ---
// Crédit à taux non nul : intérêts > 0. loyers 6 000 − travaux 20 000 = −14 000 hors intérêts →
// 10 700 imputés ; le reste (3 300) ET la totalité des intérêts partent en report.
{
    const asset = makeAsset({
        dateAchat: `${currentYear - 3}-01`, loyer: 500,
        credit: { montant: 100000, duree: 20, taux: 3, assurance: 0 },
        travaux: [{ date: `${currentYear}-05-10`, montant: 20000, tag: 'deductible' }]
    });
    const proj = computeProjectionImpotsFoyer([asset], profileData, { anneeDebut: currentYear, horizon: 3 });
    const y0 = row(proj, currentYear);
    assert.ok(y0.interets > 2000 && y0.interets < 3000, `intérêts de l'année plausibles pour 100 k€ à 3 % en 4e année (${y0.interets})`);
    assert.equal(y0.imputeRevenuGlobal, 10700);
    assert.equal(y0.resultatFoncier, 6000 - 20000 - y0.interets);
    assert.equal(y0.deficitReporte, 3300 + y0.interets, 'report = excédent hors intérêts + intérêts');
    console.log(`Test 3 OK — intérêts (${y0.interets} €) reportés sur les loyers, jamais déduits des salaires`);
}

// --- Test 4 : travaux simulés (pas encore saisis) une année future ---
{
    const asset = makeAsset({ dateAchat: `${currentYear - 3}-01`, loyer: 500 });
    const proj = computeProjectionImpotsFoyer([asset], profileData, {
        anneeDebut: currentYear, horizon: 10,
        travauxSimules: { assetId: 'bien', montant: 20000, annee: currentYear + 1 }
    });
    const y0 = row(proj, currentYear), y1 = row(proj, currentYear + 1), y2 = row(proj, currentYear + 2);
    assert.equal(y0.economie, 0, 'rien avant l\'année des travaux simulés');
    assert.equal(y1.travaux, 20000, 'les travaux simulés comptent dans l\'assiette');
    assert.equal(y1.travauxSimules, 20000, 'et sont distingués des travaux saisis');
    assert.equal(y1.imputeRevenuGlobal, 10700);
    assert.equal(y1.impotSansTravaux, impot(6000), 'le scénario « sans » ignore les travaux simulés');
    assert.equal(y2.reportUtilise, 3300);
    assert.equal(proj.travauxSimules.montant, 20000);

    // Un montant nul ou une année hors horizon ne change rien.
    const sans = computeProjectionImpotsFoyer([asset], profileData, { anneeDebut: currentYear, horizon: 10, travauxSimules: { montant: 0, annee: currentYear } });
    assert.equal(sans.totaux.economie, 0);
    const horsHorizon = computeProjectionImpotsFoyer([asset], profileData, { anneeDebut: currentYear, horizon: 2, travauxSimules: { montant: 20000, annee: currentYear + 5 } });
    assert.equal(horsHorizon.totaux.economie, 0);
    console.log('Test 4 OK — travaux simulés pris en compte l\'année choisie, ignorés dans le scénario « sans »');
}

// --- Test 5 : expiration à 10 ans d'un déficit jamais absorbé ---
// Bien sans loyer acheté il y a 10 ans avec 20 000 € de travaux : déficit 20 000 € hors intérêts,
// 10 700 € imputés sur les salaires cette année-là, 9 300 € reportables jamais consommés (aucun
// loyer). L'année de départ (10 ans plus tard) ils expirent : stock 0, perte signalée.
{
    const anneeTravaux = currentYear - 10;
    const asset = makeAsset({
        dateAchat: `${anneeTravaux}-01`, loyer: 0,
        travaux: [{ date: `${anneeTravaux}-06-01`, montant: 20000, tag: 'deductible' }]
    });
    const proj = computeProjectionImpotsFoyer([asset], profileData, { anneeDebut: currentYear, horizon: 2 });
    assert.equal(proj.stockInitial, 9300, 'au 1er janvier de l\'année de départ, le report existe encore');
    const y0 = row(proj, currentYear);
    assert.equal(y0.deficitPerdu, 9300, 'il expire cette année-là sans avoir servi');
    assert.equal(y0.stockFin, 0);
    assert.equal(y0.reportUtilise, 0);
    console.log('Test 5 OK — un report non consommé expire au bout de 10 ans et la perte est exposée');
}

// --- Test 6 : agrégation au niveau du foyer — le déficit d'un bien efface le bénéfice d'un autre ---
// A : 6 000 € de loyers, rien d'autre. B : 6 000 € de loyers et 20 000 € de travaux.
// Total : 12 000 − 20 000 = −8 000 < 10 700 → tout s'impute sur les salaires, rien à reporter.
{
    const a = makeAsset({ id: 'A', dateAchat: `${currentYear - 3}-01`, loyer: 500 });
    const b = makeAsset({ id: 'B', dateAchat: `${currentYear - 3}-01`, loyer: 500,
        travaux: [{ date: `${currentYear}-03-01`, montant: 20000, tag: 'deductible' }] });
    const proj = computeProjectionImpotsFoyer([a, b], profileData, { anneeDebut: currentYear, horizon: 2 });
    const y0 = row(proj, currentYear), y1 = row(proj, currentYear + 1);
    assert.equal(proj.nbBiens, 2);
    assert.equal(y0.loyers, 12000);
    assert.equal(y0.resultatFoncier, -8000);
    assert.equal(y0.imputeRevenuGlobal, 8000);
    assert.equal(y0.deficitReporte, 0);
    assert.equal(y0.impotTotal, impot(-8000));
    assert.equal(y1.revenuFoncierImposable, 12000);
    assert.equal(y1.economie, 0);
    console.log('Test 6 OK — résultats fonciers additionnés au niveau du foyer avant imputation');
}

// --- Test 7 : des travaux déjà réalisés (année passée) pèsent sur les deux scénarios ---
// Le report qu'ils ont créé est un acquis : le scénario « sans travaux futurs » le garde aussi.
{
    const asset = makeAsset({
        dateAchat: `${currentYear - 3}-01`, loyer: 500,
        travaux: [{ date: `${currentYear - 1}-05-10`, montant: 20000, tag: 'deductible' }]
    });
    const proj = computeProjectionImpotsFoyer([asset], profileData, { anneeDebut: currentYear, horizon: 2 });
    assert.equal(proj.stockInitial, 3300);
    const y0 = row(proj, currentYear);
    assert.equal(y0.reportUtilise, 3300);
    assert.equal(y0.revenuFoncierImposable, 2700);
    assert.equal(y0.impotSansTravaux, y0.impotTotal, 'le passé n\'est pas un « travaux futur » : économie nulle');
    assert.equal(y0.economie, 0);
    console.log('Test 7 OK — les travaux passés sont acquis dans les deux scénarios');
}

// --- Test 8 : robustesse — portefeuille vide, travaux non déductibles ignorés, entiers finis ---
{
    const vide = computeProjectionImpotsFoyer([], profileData, { anneeDebut: currentYear, horizon: 3 });
    assert.equal(vide.years.length, 4);
    assert.equal(vide.nbBiens, 0);
    for (const r of vide.years) {
        assert.equal(r.impotTotal, impot(0), 'sans bien, impôt = salaires seuls');
        assert.equal(r.economie, 0);
    }

    const nonDed = makeAsset({ dateAchat: `${currentYear - 3}-01`, loyer: 500,
        travaux: [{ date: `${currentYear}-03-01`, montant: 20000, tag: 'non-deductible' },
                  { date: `${currentYear}-03-01`, montant: 5000, tag: 'a-classifier' }] });
    const projND = computeProjectionImpotsFoyer([nonDed], profileData, { anneeDebut: currentYear, horizon: 2 });
    assert.equal(row(projND, currentYear).travaux, 0, 'seuls les frais « déductible » entrent dans l\'assiette');

    const defaults = computeProjectionImpotsFoyer([nonDed], profileData);
    assert.equal(defaults.anneeDebut, currentYear, 'année de départ par défaut : l\'année en cours');
    assert.equal(defaults.horizon, 10, 'horizon par défaut : 10 ans (durée de report du déficit)');
    for (const r of defaults.years) {
        for (const [k, v] of Object.entries(r)) {
            if (typeof v === 'number') assert.ok(Number.isInteger(v) && Number.isFinite(v), `${k} (${r.annee}) doit être un entier fini, trouvé ${v}`);
        }
    }
    console.log('Test 8 OK — portefeuille vide, frais non déductibles ignorés, valeurs entières finies');
}

console.log('ALL PROJECTION IMPOTS TESTS PASSED');
