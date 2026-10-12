import assert from 'node:assert/strict';
import {
    computeDeclaration2044, computeCompteResultat, computeOwnedAssetTimeline, computeOwnedAssetCF,
    estFraisDeductible, NATURES_FRAIS_DEDUCTIBLES,
} from '../calculs.js';

// B9 (bilan 2026-10-12) : deux natures de frais en plus de « déductible » (travaux, case 224) —
// « taxe foncière » (case 227) et « frais d'emprunt » : garantie, courtage, dossier (case 250).
// Constat sur le bien réel : une « Taxe foncière 334 € » classée déductible partait en case 224
// (travaux) en plus des 342 € de TF des charges en case 227 ; « Frais de garantie 750 € » en case
// 224 et « Frais de courtage 1 250 € » non déductible, alors que ce sont des frais d'emprunt.

const currentYear = new Date().getFullYear();
const annee = currentYear - 1; // année pleine (bien acheté avant) : pas de prorata
const profileData = { income: 60000, adults: 2, children: 0 };

function makeAsset(travaux) {
    return {
        id: 'b9', nom: 'Bien B9', dateAchat: `${currentYear - 3}-01`,
        acquisition: {
            prix: 100000, fraisAgence: 0, fraisNotaire: 0, loyerInitial: 700,
            credit: { montant: 90000, duree: 20, taux: 3, assurance: 0.3 },
        },
        postAchat: {
            taxeFonciere: 342, chargesCopro: 0, gestionLocative: 0, assurancePNO: 69, vacance: 0,
            travaux, chargesAnnuelles: [], notes: [],
        },
    };
}
const frais = (tag, montant, mois = '03', an = annee) => ({ id: `${tag}-${montant}`, date: `${an}-${mois}-10`, montant, tag, description: tag });

// --- Test 1 : les natures déductibles ---
{
    assert.deepEqual(NATURES_FRAIS_DEDUCTIBLES, ['deductible', 'taxe-fonciere', 'frais-emprunt']);
    assert.equal(estFraisDeductible('taxe-fonciere'), true);
    assert.equal(estFraisDeductible('frais-emprunt'), true);
    assert.equal(estFraisDeductible('non-deductible'), false);
    assert.equal(estFraisDeductible('a-classifier'), false);
    assert.equal(estFraisDeductible(undefined), false);
    console.log('Test 1 OK — natures déductibles : travaux, taxe foncière, frais d\'emprunt');
}

// --- Test 2 : « taxe foncière » → case 227 (avec la TF des charges), jamais en case 224 ---
{
    const base = computeDeclaration2044([makeAsset([frais('deductible', 1000)])], annee, profileData).lignes[0];
    const l = computeDeclaration2044([makeAsset([frais('deductible', 1000), frais('taxe-fonciere', 334)])], annee, profileData).lignes[0];
    assert.equal(base.case227, 342);
    assert.equal(l.case224, 1000, 'la taxe foncière n\'entre pas dans les travaux (case 224)');
    assert.equal(l.case227, 342 + 334, 'case 227 = TF des charges + frais classé « taxe foncière » (676 €, les deux saisis)');
    assert.equal(l.case250, base.case250);
    assert.equal(l.case263, base.case263 - 334);
    console.log(`Test 2 OK — frais « taxe foncière » 334 € : case 224 = ${l.case224} €, case 227 = ${l.case227} €`);
}

// --- Test 3 : « frais d'emprunt » → case 250 (avec intérêts et assurance), jamais en case 224 ---
{
    const base = computeDeclaration2044([makeAsset([])], annee, profileData).lignes[0];
    const l = computeDeclaration2044([makeAsset([frais('frais-emprunt', 750), frais('frais-emprunt', 1250)])], annee, profileData).lignes[0];
    assert.equal(l.case224, 0, 'garantie et courtage ne sont pas des travaux');
    assert.equal(l.case250, base.case250 + 2000, 'case 250 = intérêts + assurance + frais d\'emprunt');
    assert.equal(l.chargesHorsInterets, base.chargesHorsInterets);
    console.log(`Test 3 OK — frais d'emprunt 2 000 € : case 250 = ${l.case250} € (dont ${base.case250} € intérêts + assurance)`);
}

// --- Test 4 : les frais d'emprunt suivent la règle des intérêts pour le déficit (reportables) ---
{
    const asset = makeAsset([frais('deductible', 15000), frais('frais-emprunt', 2000)]);
    const d = computeDeclaration2044([asset], annee, profileData);
    const l = d.lignes[0];
    assert.ok(d.deficit);
    assert.equal(d.deficit.imputableRevenuGlobal, Math.min(10700, l.chargesHorsInterets - l.case211));
    assert.ok(d.deficit.reportFoncier10ans >= l.case250, 'toute la case 250 (frais d\'emprunt compris) est reportable');
    console.log(`Test 4 OK — déficit : imputable ${d.deficit.imputableRevenuGlobal} €, reportable ${d.deficit.reportFoncier10ans} € (case 250 ${l.case250} €)`);
}

// --- Test 5 : compte de résultat — charges déductibles, impôt, trésorerie ---
{
    const avecDed = computeCompteResultat(makeAsset([frais('deductible', 334), frais('deductible', 750)]), annee, profileData, 'reel');
    const natures = computeCompteResultat(makeAsset([frais('taxe-fonciere', 334), frais('frais-emprunt', 750)]), annee, profileData, 'reel');
    const nonDed = computeCompteResultat(makeAsset([frais('non-deductible', 334), frais('non-deductible', 750)]), annee, profileData, 'reel');
    assert.equal(natures.chargesDeductibles, avecDed.chargesDeductibles, 'mêmes charges déductibles au total');
    assert.equal(natures.travauxDed, 0);
    assert.equal(natures.taxeFonciereFrais, 334);
    assert.equal(natures.fraisEmprunt, 750);
    assert.equal(natures.chargesDeductibles, nonDed.chargesDeductibles + 1084);
    // Payés cash : une seule sortie de trésorerie (pas comptés aussi comme frais non déductibles).
    assert.equal(natures.resultatFoncier, avecDed.resultatFoncier);
    assert.equal(natures.cfReel, natures.resultatNet - natures.capitalRembourse, 'aucun décaissement compté deux fois');
    // Micro-foncier : abattement forfaitaire, les natures n'y changent rien.
    const microNat = computeCompteResultat(makeAsset([frais('taxe-fonciere', 334), frais('frais-emprunt', 750)]), annee, profileData, 'micro-foncier');
    const microNd = computeCompteResultat(makeAsset([]), annee, profileData, 'micro-foncier');
    assert.equal(microNat.impots, microNd.impots, 'ignorées en micro-foncier');
    console.log('Test 5 OK — compte de résultat : déductibles hors travaux, trésorerie non doublée, micro inchangé');
}

// --- Test 6 : timeline et CF courant — traitées comme des frais déductibles payés ---
{
    const tl = t => computeOwnedAssetTimeline(makeAsset(t), profileData, 'reel').years.find(r => r.year === annee);
    const a = tl([frais('deductible', 1084)]);
    const b = tl([frais('taxe-fonciere', 334), frais('frais-emprunt', 750)]);
    assert.equal(b.chargesAnneeTax, a.chargesAnneeTax, 'assiette fiscale de la timeline identique');
    assert.equal(b.travauxCashAnnee, a.travauxCashAnnee, 'même décaissement');
    assert.equal(b.cfAnnuel, a.cfAnnuel);

    const cf = t => computeOwnedAssetCF(makeAsset(t), { regime: 'reel' }, 30);
    const c = cf([frais('deductible', 1084, '01', currentYear)]);
    const d = cf([frais('taxe-fonciere', 334, '01', currentYear), frais('frais-emprunt', 750, '01', currentYear)]);
    const e = cf([frais('non-deductible', 1084, '01', currentYear)]);
    assert.equal(d.impotsAnnee, c.impotsAnnee, 'CF courant : réduisent l\'impôt comme un frais déductible');
    assert.ok(d.impotsAnnee < e.impotsAnnee, 'et pas comme un frais non déductible');
    assert.equal(d.fraisPonctuelsMensuels, c.fraisPonctuelsMensuels);
    console.log('Test 6 OK — timeline et CF courant : taxe foncière et frais d\'emprunt traités en frais déductibles payés');
}

console.log('\nTous les tests déclaration 2044 / natures de frais passent.');
