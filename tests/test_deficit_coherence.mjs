import assert from 'node:assert/strict';
import {
    computeDeclaration2044, computeDeficitFoncierHistorique, computeProjectionImpotsFoyer,
    computeProjectionRegimesFoyer, computeOwnedAssetTimeline, resolveTmiFoyer,
} from '../calculs.js';

// B8 (bilan 2026-10-12) : pour un même bien et une même année, la déclaration 2044, le tableau
// « Déficits fonciers reportables » de la fiche et la projection « Impôts à venir » doivent donner
// le MÊME déficit imputable sur le revenu global et le MÊME déficit reportable.
//
// Constat sur le bien réel (achat 08/2026) : 2044 → reportable 1 421 € (case 439) / imputable
// 8 577 € (case 436) ; fiche et Impôts à venir → 1 231 € / 8 747 €. Écarts entre écrans :
//   - l'assurance emprunteur (≈ 190 € sur 5 mois) : la 2044 la met en case 250 avec les intérêts,
//     les deux autres écrans la rangeaient dans les autres charges ;
//   - le forfait de 20 €/local (case 222) : absent de la fiche et de la projection.
// 190 − 20 = 170 € de répartition décalée, 20 € d'écart de total.
//
// Revue (fix round 1) : les TROIS écrans appliquaient en plus la priorité à l'envers. Règle (art.
// 156 I 3° CGI, BOI-RFPI-BASE-30-20-10, notice 2044 lignes 420-440) : la case 250 (intérêts,
// assurance emprunteur, frais d'emprunt) s'impute EN PREMIER sur les loyers ; seule sa part non
// couverte, max(0, case 250 − loyers), est un déficit « d'origine intérêts », reportable 10 ans.
// Le reste du déficit s'impute sur le revenu global jusqu'à 10 700 €, l'excédent est reporté.

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

// Bien sans crédit, une année pleine (année − 1, acheté en janvier de l'année − 2) : loyers annuels
// `loyers`, autres charges = forfait 20 € + travaux (autres − 20), case 250 = frais d'emprunt.
function bienSimple({ loyers, autres, interets }) {
    const annee = currentYear - 1;
    return {
        annee,
        asset: {
            id: 'simple', nom: 'Simple', dateAchat: `${currentYear - 2}-01`,
            acquisition: { prix: 100000, fraisAgence: 0, fraisNotaire: 0, loyerInitial: loyers / 12, credit: { montant: 0, duree: 0, taux: 0, assurance: 0 } },
            postAchat: {
                taxeFonciere: 0, chargesCopro: 0, gestionLocative: 0, assurancePNO: 0, vacance: 0,
                travaux: [
                    { id: 'w', date: `${annee}-04-01`, montant: autres - 20, tag: 'deductible', description: 'Travaux' },
                    { id: 'e', date: `${annee}-04-01`, montant: interets, tag: 'frais-emprunt', description: 'Frais de garantie' },
                ],
                chargesAnnuelles: [], notes: [],
            },
        },
    };
}

// Les trois écrans pour un bien et une année : { total, imputable, reportable } de chacun.
function troisEcrans(asset, annee) {
    const decl = computeDeclaration2044([asset], annee, profileData);
    const fiche = computeDeficitFoncierHistorique(asset, profileData);
    const ligneFiche = fiche.lignes.find(l => l.annee === annee);
    const y = computeProjectionImpotsFoyer([asset], profileData, { anneeDebut: annee, horizon: 1 }).years.find(r => r.annee === annee);
    return {
        decl, ligne: decl.lignes[0], y,
        declaration: { total: decl.deficit?.totalDeficit ?? 0, imputable: decl.deficit?.imputableRevenuGlobal ?? 0, reportable: decl.deficit?.reportFoncier10ans ?? 0 },
        ficheReportable: ligneFiche ? ligneFiche.montantInitial : 0,
        projection: { total: -Math.min(0, y.resultatFoncier), imputable: y.imputeRevenuGlobal, reportable: y.deficitReporte },
    };
}
function attendre(r, { total, imputable, reportable }, nom) {
    assert.deepEqual(r.declaration, { total, imputable, reportable }, `${nom} : déclaration 2044`);
    assert.deepEqual(r.projection, { total, imputable, reportable }, `${nom} : Impôts à venir`);
    assert.equal(r.ficheReportable, reportable, `${nom} : fiche « Déficits fonciers reportables »`);
}

// --- Test 1 : bien réel — intérêts couverts par les loyers, tout le déficit est imputable ---
// loyers 3 375 ; autres charges 11 713 (forfait 20 + TF 143 + PNO 29 + travaux 11 521) ; case 250
// 1 421 < 3 375 → aucune part « intérêts » ; déficit 11 713 + 1 421 − 3 375 = 9 759 < 10 700 →
// 9 759 imputables sur le revenu global, 0 reportable.
{
    const r = troisEcrans(bienReel(), currentYear);
    assert.equal(r.ligne.case211, 3375);
    assert.equal(r.ligne.case222, 20, 'forfait frais de gestion 20 €/local');
    assert.equal(r.ligne.chargesHorsInterets, 11713);
    assert.equal(r.ligne.case250, 1421, 'intérêts + assurance emprunteur (case 250)');
    attendre(r, { total: 9759, imputable: 9759, reportable: 0 }, 'bien réel');
    assert.equal(r.y.resultatFoncier, r.decl.case420, 'même résultat foncier total (forfait 20 € compris)');
    assert.equal(r.y.interets, r.ligne.case250, 'intérêts de la projection = case 250 (assurance emprunteur comprise)');
    assert.equal(computeDeficitFoncierHistorique(bienReel(), profileData).stockTotal, 0);
    console.log('Test 1 OK — bien réel : 9 759 € imputables, 0 € reportable, identique sur les trois écrans');
}

// --- Test 2 : déficit au-delà du plafond — l'excédent est reporté (mêmes chiffres sous les deux lectures) ---
// autres charges 11 713 − 11 521 + 25 000 = 25 192 ; déficit 25 192 + 1 421 − 3 375 = 23 238 →
// 10 700 imputables, 12 538 reportables.
{
    const asset = bienReel();
    asset.postAchat.travaux[0].montant = 25000;
    attendre(troisEcrans(asset, currentYear), { total: 23238, imputable: 10700, reportable: 12538 }, 'au-delà du plafond');
    console.log('Test 2 OK — au-delà du plafond : 10 700 € imputables, 12 538 € reportables sur les trois écrans');
}

// --- Test 3 : intérêts supérieurs aux loyers, sous le plafond ---
// loyers 1 000, case 250 2 000, autres charges 5 000 → déficit 6 000 ; part intérêts 2 000 − 1 000
// = 1 000 reportable ; 5 000 imputables.
{
    const { asset, annee } = bienSimple({ loyers: 1000, autres: 5000, interets: 2000 });
    attendre(troisEcrans(asset, annee), { total: 6000, imputable: 5000, reportable: 1000 }, 'intérêts > loyers');
    console.log('Test 3 OK — intérêts > loyers : 5 000 € imputables, 1 000 € reportables');
}

// --- Test 4 : autres charges sous les loyers, les intérêts font basculer en déficit ---
// loyers 6 000, autres charges 5 000, case 250 2 000 → déficit 1 000 ; intérêts couverts par les
// loyers → 1 000 imputables, 0 reportable.
{
    const { asset, annee } = bienSimple({ loyers: 6000, autres: 5000, interets: 2000 });
    attendre(troisEcrans(asset, annee), { total: 1000, imputable: 1000, reportable: 0 }, 'bascule par les intérêts');
    console.log('Test 4 OK — bascule par les intérêts : 1 000 € imputables, 0 € reportable');
}

// --- Test 5 : la SCI à l'IS ne reçoit pas le forfait 20 € (propre aux revenus fonciers) ---
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
    console.log('Test 5 OK — SCI-IS : charges réelles + intérêts, sans le forfait 20 € des revenus fonciers');
}

// --- Test 6 : la timeline (rapport annuel, projections de CF, dossier bancaire) suit la même règle ---
// Cas du reviewer : loyers 6 000, taxe foncière 10 000, case 250 = 2 720, TMI 30 %. 2044 : intérêts
// couverts par les loyers → déficit 10 000 + 20 + 2 720 − 6 000 = 6 740 entièrement imputable.
// L'ancien computeAnnualTaxEstimate n'imputait que 10 000 − 6 000 = 4 000 et reportait 2 720 en silence.
// La timeline ne déduit pas le forfait de 20 € de la 2044 (comme le compte de résultat) : 6 720.
{
    const annee = currentYear - 1;
    const profil = { income: 60000, adults: 1, children: 0 };
    const tmi = resolveTmiFoyer(profil, annee);
    assert.equal(tmi, 30, 'précondition : TMI 30 %');
    const avecFrais = {
        id: 'tf', nom: 'TF', dateAchat: `${currentYear - 2}-01`,
        acquisition: { prix: 100000, fraisAgence: 0, fraisNotaire: 0, loyerInitial: 500, credit: { montant: 0, duree: 0, taux: 0, assurance: 0 } },
        postAchat: {
            taxeFonciere: 10000, chargesCopro: 0, gestionLocative: 0, assurancePNO: 0, vacance: 0,
            travaux: [{ id: 'e', date: `${annee}-03-01`, montant: 2720, tag: 'frais-emprunt', description: 'Frais de garantie' }],
            chargesAnnuelles: [], notes: [],
        },
    };
    const decl = computeDeclaration2044([avecFrais], annee, profil);
    assert.deepEqual([decl.deficit.imputableRevenuGlobal, decl.deficit.reportFoncier10ans], [6740, 0]);
    const row = computeOwnedAssetTimeline(avecFrais, profil, 'reel').years.find(r => r.year === annee);
    const imputeTimeline = -row.impotsAnnee / (tmi / 100);
    assert.ok(Math.abs(imputeTimeline - (decl.deficit.imputableRevenuGlobal - 20)) < 0.01,
        `timeline : ${imputeTimeline} € imputés, 2044 : ${decl.deficit.imputableRevenuGlobal} € (forfait 20 € compris)`);

    // Même chose avec de vrais intérêts d'emprunt (crédit) : intérêts + assurance < loyers.
    const avecCredit = JSON.parse(JSON.stringify(avecFrais));
    avecCredit.postAchat.travaux = [];
    avecCredit.acquisition.credit = { montant: 90000, duree: 20, taux: 3, assurance: 0.3, assuranceMode: 'initial' };
    const d2 = computeDeclaration2044([avecCredit], annee, profil);
    const r2 = computeOwnedAssetTimeline(avecCredit, profil, 'reel').years.find(r => r.year === annee);
    assert.equal(d2.deficit.reportFoncier10ans, 0, 'case 250 couverte par les loyers : rien de reporté');
    assert.ok(Math.abs(-r2.impotsAnnee / (tmi / 100) - (d2.deficit.imputableRevenuGlobal - 20)) <= 2,
        `timeline ${-r2.impotsAnnee / (tmi / 100)} vs 2044 ${d2.deficit.imputableRevenuGlobal} − 20 (arrondis par case)`);
    console.log(`Test 6 OK — timeline : ${Math.round(imputeTimeline)} € imputés = 2044 ${decl.deficit.imputableRevenuGlobal} € − forfait 20 €`);
}

// --- Test 7 : pas de forfait de 20 € sans loyer (pas de déficit fictif) ---
{
    const annee = currentYear - 1;
    const vide = {
        id: 'vide', nom: 'Vide', dateAchat: `${currentYear - 2}-01`,
        acquisition: { prix: 100000, fraisAgence: 0, fraisNotaire: 0, loyerInitial: 0, credit: { montant: 0, duree: 0, taux: 0, assurance: 0 } },
        postAchat: { taxeFonciere: 0, chargesCopro: 0, gestionLocative: 0, assurancePNO: 0, vacance: 0, travaux: [], chargesAnnuelles: [], notes: [] },
    };
    const decl = computeDeclaration2044([vide], annee, profileData);
    assert.equal(decl.lignes[0].case211, 0);
    assert.equal(decl.lignes[0].case222, 0, 'aucun loyer : pas de forfait de frais de gestion');
    assert.equal(decl.case420, 0);
    assert.equal(decl.deficit, null);
    assert.equal(computeDeficitFoncierHistorique(vide, profileData).lignes.length, 0, 'aucun report fictif de 20 €');
    console.log('Test 7 OK — pas de forfait de 20 € pour un bien sans loyer');
}

console.log('\nTous les tests de cohérence du déficit foncier passent.');
