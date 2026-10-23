import assert from 'node:assert/strict';
import * as calculs from '../calculs.js';

// Chantier « CF unique » (docs/chantier-cf-unique.md), étape 0 : test de cohérence écrit AVANT
// le moteur, donc rouge au départ. Écrit hors de tests/ tant qu'il était rouge (scripts/run-tests.mjs
// s'arrête au premier échec), déplacé ici quand il est passé (étape 2).
//
// Définition retenue : le CF de référence d'un bien = somme des flux des 12 prochains mois (du mois
// suivant le mois courant au 12e), hors frais ponctuels (onglet Travaux), impôt compris (impôt
// annuel réel de chaque année civile, ramené au mois). C'est ce chiffre qu'affichent la liste, le
// dashboard, la carte, le tri, les alertes et le rapport du bien (computeOwnedAssetCF en devient
// une façade).

const {
    computeOwnedAssetCF, computeOwnedAssetTimeline, computeCFBreakdown, resolveScenarioCourant, resolveTmiFoyer,
} = calculs;

const now = new Date();
const currentYear = now.getFullYear();
const currentMonth = now.getMonth() + 1;
const nextYear = currentYear + 1;
const profileData = { income: 45000, adults: 2, children: 0 };
const aujourdHui = { annee: currentYear, mois: currentMonth };

function ym(annee, mois) {
    const d = new Date(annee, mois - 1, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// A : bien stable, acheté il y a 3 ans en janvier, crédit en cours, aucun frais ponctuel.
function bienStable(extraTravaux = []) {
    return {
        id: 'stable', nom: extraTravaux.length ? `Stable + ${extraTravaux.map(t => t.id).join(', ')}` : 'Stable', dateAchat: `${currentYear - 3}-01`,
        acquisition: {
            prix: 120000, fraisAgence: 0, fraisNotaire: 9000, loyerInitial: 750, valeurEstimee: 0,
            credit: { montant: 110000, duree: 20, taux: 3.5, assurance: 0.3, assuranceMode: 'initial' },
        },
        postAchat: {
            taxeFonciere: 900, chargesCopro: 40, gestionLocative: 0, assurancePNO: 120, vacance: 0,
            travaux: extraTravaux, chargesAnnuelles: [], notes: [],
        },
    };
}
// B : A + un frais ponctuel payé comptant ce mois-ci (non déductible).
const fraisPonctuel = { id: 'f1', date: `${ym(currentYear, currentMonth)}-05`, montant: 2400, tag: 'non-deductible', description: 'Chaudière' };
// C : A + des travaux financés par un crédit dédié (mensualité propre).
const travauxCredit = { id: 'c1', date: `${currentYear - 1}-03-01`, montant: 12000, tag: 'non-deductible', description: 'Cuisine', financeParCredit: false, credit: { montant: 12000, duree: 10, taux: 4 } };
// D : acheté il y a 2 mois (année d'achat partielle).
function bienRecent() {
    const a = bienStable();
    return { ...a, id: 'recent', nom: 'Récent', dateAchat: ym(currentYear, currentMonth - 2) };
}
// E : régime réel, gros travaux déductibles l'an dernier (déficit reporté sur les années suivantes).
function bienDeficit() {
    return bienStable([{ id: 'd1', date: `${currentYear - 1}-06-01`, montant: 25000, tag: 'deductible', description: 'Rénovation' }]);
}

function facade(asset, regime) {
    const sc = resolveScenarioCourant(asset);
    return computeOwnedAssetCF(asset, { ...sc.variables, regime }, resolveTmiFoyer(profileData, currentYear), regime, profileData).cfNetNet;
}
function proche(a, b, tol, msg) {
    assert.ok(Math.abs(a - b) <= tol, `${msg} : ${a.toFixed(2)} ≠ ${b.toFixed(2)} (tolérance ${tol})`);
}

let ok = 0;
function cas(nom, fn) { fn(); ok++; console.log(`  ✓ ${nom}`); }

cas('le moteur de flux mensuels et le CF de référence existent', () => {
    assert.equal(typeof calculs.computeFluxMensuelsBien, 'function', 'computeFluxMensuelsBien manquant');
    assert.equal(typeof calculs.computeCFReference, 'function', 'computeCFReference manquant');
    const ref = calculs.computeCFReference(bienStable(), profileData, 'micro-foncier', { aujourdHui });
    proche(ref.cfMensuel, ref.cfAnnuel / 12, 0.01, 'cfMensuel = cfAnnuel / 12');
    assert.deepEqual(ref.periode.debut, { annee: ym(currentYear, currentMonth + 1).slice(0, 4) * 1, mois: ym(currentYear, currentMonth + 1).slice(5) * 1 }, 'la fenêtre commence le mois suivant');
});

for (const regime of ['micro-foncier', 'reel']) {
    cas(`[${regime}] la façade computeOwnedAssetCF affiche le CF de référence`, () => {
        for (const asset of [bienStable(), bienStable([travauxCredit]), bienRecent(), bienDeficit()]) {
            const ref = calculs.computeCFReference(asset, profileData, regime, { aujourdHui });
            proche(facade(asset, regime), ref.cfMensuel, 0.5, `${asset.nom}`);
        }
    });

    cas(`[${regime}] un frais ponctuel ne change pas le CF de référence`, () => {
        const sans = calculs.computeCFReference(bienStable(), profileData, regime, { aujourdHui }).cfMensuel;
        const avec = calculs.computeCFReference(bienStable([fraisPonctuel]), profileData, regime, { aujourdHui }).cfMensuel;
        proche(avec, sans, 0.01, 'référence');
        proche(facade(bienStable([fraisPonctuel]), regime), facade(bienStable(), regime), 0.5, 'façade');
    });

    cas(`[${regime}] la somme des flux mensuels d'une année civile = cfAnnuel de la timeline`, () => {
        for (const asset of [bienStable(), bienStable([travauxCredit]), bienStable([fraisPonctuel]), bienRecent(), bienDeficit()]) {
            for (const annee of [currentYear, nextYear]) {
                const { mois } = calculs.computeFluxMensuelsBien(asset, profileData, regime, { debut: { annee, mois: 1 }, nbMois: 12 });
                const somme = mois.reduce((s, m) => s + m.cf, 0);
                const row = computeOwnedAssetTimeline(asset, profileData, regime).years.find(y => y.year === annee);
                proche(somme, row.cfAnnuel, 1, `${asset.nom} ${annee}`);
            }
        }
    });

    cas(`[${regime}] la timeline compte la mensualité d'un crédit travaux`, () => {
        const tc = travauxCredit.credit;
        const tM = tc.taux / 100 / 12;
        const mens = (tc.montant * tM) / (1 - Math.pow(1 + tM, -tc.duree * 12));
        const sans = computeOwnedAssetTimeline(bienStable(), profileData, regime).years.find(y => y.year === nextYear);
        const avec = computeOwnedAssetTimeline(bienStable([travauxCredit]), profileData, regime).years.find(y => y.year === nextYear);
        // Les intérêts du crédit travaux sont déductibles en réel : l'impôt baisse un peu, d'où la tolérance.
        proche(sans.cfAnnuel - avec.cfAnnuel + (sans.impotsAnnee - avec.impotsAnnee), 12 * mens, 1, 'mensualités travaux');
        if (regime === 'reel') assert.ok(avec.impotsAnnee < sans.impotsAnnee, 'intérêts du crédit travaux déduits au réel (case 250)');
    });

    cas(`[${regime}] le détail du CF d'une année = cfAnnuel de la timeline`, () => {
        for (const asset of [bienStable(), bienStable([travauxCredit]), bienDeficit()]) {
            const anneeRel = nextYear - Number(asset.dateAchat.slice(0, 4)) + 1;
            const bd = computeCFBreakdown(asset, profileData, regime, anneeRel);
            const row = computeOwnedAssetTimeline(asset, profileData, regime).years.find(y => y.year === nextYear);
            proche(bd.cfNetNet, row.cfAnnuel, 0.5, asset.nom);
            proche(bd.impots, row.impotsAnnee, 1, `${asset.nom} : impôt du détail = impôt de la timeline`);
            proche(bd.mensualiteCredit, row.debtService, 1, `${asset.nom} : mensualités (crédits travaux compris)`);
            proche(bd.loyersEncaisses - bd.charges - bd.mensualiteCredit - bd.travaux - bd.impots, bd.cfNetNet, 2, `${asset.nom} : somme des lignes`);
        }
    });
}

// Étape 3 : un seul impôt (computeImpotAnnuelBien), lu par la timeline, le compte de résultat et le détail.
for (const regime of ['micro-foncier', 'reel', 'sci-is']) {
    cas(`[${regime}] compte de résultat, timeline et détail donnent le même impôt et le même CF`, () => {
        for (const asset of [bienStable(), bienStable([travauxCredit]), bienStable([fraisPonctuel]), bienRecent(), bienDeficit()]) {
            const tl = computeOwnedAssetTimeline(asset, profileData, regime).years;
            for (const annee of [currentYear, nextYear]) {
                const row = tl.find(y => y.year === annee);
                const cr = calculs.computeCompteResultat(asset, annee, profileData, regime);
                const seul = calculs.computeImpotAnnuelBien(asset, annee, profileData, regime, 0);
                proche(cr.impots, row.impotsAnnee, 0.5, `${asset.nom} ${annee} : impôt compte de résultat`);
                proche(cr.cfReel, row.cfAnnuel, 3, `${asset.nom} ${annee} : cfReel du compte de résultat`);
                if (regime !== 'reel') proche(seul.impots, row.impotsAnnee, 0.01, `${asset.nom} ${annee} : computeImpotAnnuelBien`);
            }
        }
    });
}

cas('un loyer revalorisé en juin compte à partir de juin (timeline, compte de résultat, détail)', () => {
    const asset = bienStable();
    // L'historique commence par le loyer de départ (avant la 1re entrée, resolveLoyerVacance retient la 1re).
    asset.postAchat.loyerHistorique = [{ mois: asset.dateAchat, montant: 750 }, { mois: `${nextYear}-06`, montant: 850 }];
    const attendu = 5 * 750 + 7 * 850;
    const row = computeOwnedAssetTimeline(asset, profileData, 'reel').years.find(y => y.year === nextYear);
    proche(row.loyersAnnuels, attendu, 0.01, 'timeline');
    proche(row.mois.find(m => m.mois === 5).loyers, 750, 0.01, 'timeline : mai');
    proche(row.mois.find(m => m.mois === 6).loyers, 850, 0.01, 'timeline : juin');
    proche(calculs.computeCompteResultat(asset, nextYear, profileData, 'reel').recettesBrutes, attendu, 0.5, 'compte de résultat');
    proche(computeCFBreakdown(asset, profileData, 'reel', nextYear - (currentYear - 3) + 1).loyersEncaisses, attendu, 0.5, 'détail');
});

// Étape 4 : chaque écran lit le même CF de référence.
const { buildAssetReportData } = await import('../rapport-bien.js');
const { buildRapportAnnuelData } = await import('../rapport-annuel.js');
for (const regime of ['micro-foncier', 'reel']) {
    cas(`[${regime}] liste/dashboard, onglet Calcul (12 mois), rapport du bien et rapport annuel affichent le même CF`, () => {
        for (const asset of [bienStable(), bienStable([travauxCredit]), bienStable([fraisPonctuel]), bienRecent(), bienDeficit()]) {
            const ref = facade(asset, regime);
            const bd = calculs.computeCFBreakdownReference(asset, profileData, regime);
            proche(bd.cfNetNet / 12, ref, 0.1, `${asset.nom} : détail 12 mois`);
            proche(bd.loyersEncaisses - bd.charges - bd.mensualiteCredit - bd.impots, bd.cfNetNet, 2, `${asset.nom} : somme des lignes du détail 12 mois`);
            proche(buildAssetReportData(asset, { profileData, regime }).actuel.cfNetNet, ref, 0.01, `${asset.nom} : rapport du bien`);
            const ra = buildRapportAnnuelData([asset], currentYear, { profileData, regime, tmi: 30 });
            proche(ra.biens[0].cfRythmeActuel, ref, 0.01, `${asset.nom} : rapport annuel`);
        }
    });
}
cas('libellé de période du CF de référence', () => {
    const ref = calculs.computeCFReference(bienStable(), profileData, 'reel', { aujourdHui: { annee: 2026, mois: 10 } });
    assert.equal(calculs.libellePeriodeCF(ref.periode), '12 prochains mois (11/2026 – 10/2027)');
    const dec = calculs.computeCFReference(bienStable(), profileData, 'reel', { aujourdHui: { annee: 2026, mois: 12 } });
    assert.equal(calculs.libellePeriodeCF(dec.periode), '12 prochains mois (01/2027 – 12/2027)');
});

console.log(`OK — ${ok} cas de cohérence du CF unique`);
