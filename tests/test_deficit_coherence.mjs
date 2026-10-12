import assert from 'node:assert/strict';
import {
    computeDeclaration2044, computeDeficitFoncierHistorique, computeProjectionImpotsFoyer,
    computeProjectionRegimesFoyer,
} from '../calculs.js';

// B8 (bilan 2026-10-12) : pour un même bien et une même année, la déclaration 2044, le tableau
// « Déficits fonciers reportables » de la fiche et la projection « Impôts à venir » doivent donner
// le MÊME déficit imputable sur le revenu global et le MÊME déficit reportable.
//
// Constat sur le bien réel (achat 08/2026) : 2044 → reportable 1 421 € (case 439) / imputable
// 8 577 € (case 436) ; fiche et Impôts à venir → 1 231 € / 8 747 €. Deux causes :
//   - l'assurance emprunteur (≈ 190 € sur 5 mois) : la 2044 la met en case 250 avec les intérêts
//     (seulement reportable, art. 156 I 3° CGI), les deux autres écrans la rangeaient dans les
//     charges « hors intérêts » (donc imputable sur les salaires) ;
//   - le forfait de 20 €/local (case 222) : absent de la fiche et de la projection.
// 190 − 20 = 170 € de répartition décalée, 20 € d'écart de total.

const currentYear = new Date().getFullYear();
const profileData = { income: 60000, adults: 2, children: 0 };

// Bien proche du cas réel : achat en août de l'année courante (5 mois de détention), loyer 675 €,
// TF 342 €/an et PNO 69 €/an proratisées, crédit ~94 k€ (intérêts + assurance ≈ 1 400 € sur 5 mois),
// 11 521 € de travaux déductibles dans l'année.
function bienReel() {
    return {
        id: 'mouton', nom: '70 rue du mouton', dateAchat: `${currentYear}-08`,
        acquisition: {
            prix: 70000, fraisAgence: 0, fraisNotaire: 7000, loyerInitial: 675, valeurEstimee: 0,
            credit: { montant: 94182, duree: 25, taux: 3.15, assurance: 0.485, assuranceMode: 'initial' },
        },
        postAchat: {
            taxeFonciere: 342, chargesCopro: 0, gestionLocative: 0, assurancePNO: 69, vacance: 0,
            travaux: [{ id: 't1', date: `${currentYear}-09-15`, montant: 11521, tag: 'deductible', description: 'Travaux' }],
            chargesAnnuelles: [], notes: [],
        },
    };
}

// --- Test 1 : les trois écrans donnent la même répartition pour l'année d'achat ---
{
    const asset = bienReel();
    const decl = computeDeclaration2044([asset], currentYear, profileData);
    const ligne = decl.lignes[0];
    assert.ok(decl.deficit, 'la 2044 doit constater un déficit');
    assert.equal(ligne.case222, 20, 'forfait frais de gestion 20 €/local');
    assert.ok(ligne.case250 > 1300 && ligne.case250 < 1500, `intérêts + assurance plausibles (${ligne.case250})`);

    // Règle (art. 156 I 3° CGI) : la part due aux intérêts (case 250) n'est que reportable ; le
    // reste (déficit hors intérêts, ici < 10 700 €) s'impute sur le revenu global.
    const horsInterets = -(ligne.case211 - ligne.chargesHorsInterets);
    assert.equal(decl.deficit.imputableRevenuGlobal, Math.round(horsInterets));
    assert.equal(decl.deficit.reportFoncier10ans, ligne.case250);
    assert.equal(decl.deficit.totalDeficit, decl.deficit.imputableRevenuGlobal + decl.deficit.reportFoncier10ans);

    const fiche = computeDeficitFoncierHistorique(asset, profileData);
    const ligneFiche = fiche.lignes.find(l => l.annee === currentYear);
    assert.ok(ligneFiche, 'la fiche doit créer une ligne de déficit pour l\'année d\'achat');
    assert.equal(ligneFiche.montantInitial, decl.deficit.reportFoncier10ans,
        `fiche « Stock reportable » ${ligneFiche.montantInitial} € ≠ 2044 case 439 ${decl.deficit.reportFoncier10ans} €`);
    assert.equal(fiche.stockTotal, decl.deficit.reportFoncier10ans);

    const proj = computeProjectionImpotsFoyer([asset], profileData, { anneeDebut: currentYear, horizon: 3 });
    const y0 = proj.years.find(r => r.annee === currentYear);
    assert.equal(y0.imputeRevenuGlobal, decl.deficit.imputableRevenuGlobal,
        `Impôts à venir « Déduits des salaires » ${y0.imputeRevenuGlobal} € ≠ 2044 case 436 ${decl.deficit.imputableRevenuGlobal} €`);
    assert.equal(y0.deficitReporte, decl.deficit.reportFoncier10ans,
        `Impôts à venir « reporté » ${y0.deficitReporte} € ≠ 2044 case 439 ${decl.deficit.reportFoncier10ans} €`);
    assert.equal(y0.resultatFoncier, decl.case420, 'même résultat foncier total (forfait 20 € compris)');
    assert.equal(y0.loyers, ligne.case211);
    assert.equal(y0.interets, ligne.case250, 'intérêts de la projection = case 250 (assurance emprunteur comprise)');
    assert.equal(y0.stockFin, decl.deficit.reportFoncier10ans);
    console.log(`Test 1 OK — 2044, fiche et Impôts à venir : imputable ${decl.deficit.imputableRevenuGlobal} €, reportable ${decl.deficit.reportFoncier10ans} €, total ${decl.deficit.totalDeficit} €`);
}

// --- Test 2 : déficit hors intérêts au-delà du plafond — l'excédent rejoint le report partout ---
{
    const asset = bienReel();
    asset.postAchat.travaux[0].montant = 25000;
    const decl = computeDeclaration2044([asset], currentYear, profileData);
    assert.equal(decl.deficit.imputableRevenuGlobal, 10700);
    const fiche = computeDeficitFoncierHistorique(asset, profileData);
    const proj = computeProjectionImpotsFoyer([asset], profileData, { anneeDebut: currentYear, horizon: 2 });
    const y0 = proj.years.find(r => r.annee === currentYear);
    assert.equal(fiche.lignes.find(l => l.annee === currentYear).montantInitial, decl.deficit.reportFoncier10ans);
    assert.equal(y0.imputeRevenuGlobal, 10700);
    assert.equal(y0.deficitReporte, decl.deficit.reportFoncier10ans);
    console.log(`Test 2 OK — au-delà du plafond : reportable ${decl.deficit.reportFoncier10ans} € identique sur les trois écrans`);
}

// --- Test 3 : la SCI à l'IS ne reçoit pas le forfait 20 € (propre aux revenus fonciers) ---
// L'assurance emprunteur passe des charges aux intérêts : le total charges + intérêts de la SCI
// est inchangé, le forfait ne s'y ajoute pas.
{
    const asset = bienReel();
    const decl = computeDeclaration2044([asset], currentYear, profileData);
    const l = decl.lignes[0];
    const regimes = computeProjectionRegimesFoyer([asset], profileData, { anneeDebut: currentYear, horizon: 2 });
    const y0 = regimes.years.find(r => r.annee === currentYear);
    const chargesReelles = l.chargesHorsInterets - l.case222 + l.case250;
    assert.equal(y0.sciIs.resultat, Math.round(l.case211 - chargesReelles - y0.sciIs.amortissement));
    console.log('Test 3 OK — SCI-IS : charges réelles + intérêts, sans le forfait 20 € des revenus fonciers');
}

console.log('\nTous les tests de cohérence du déficit foncier passent.');
