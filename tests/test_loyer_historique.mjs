import assert from 'node:assert/strict';
import { resolveLoyerVacance, computeCFBreakdown, computeOwnedAssetTimeline } from '../calculs.js';

// Couvre la résolution du loyer introduite par la spec 2026-07-27 :
// postAchat.loyerHistorique remplace le suivi mensuel des loyers encaissés.
// Le loyer applicable à une date est la dernière entrée dont le mois est <= à cette date.

// Profil sans historique de revenu (income fallback) : TMI stable, ces tests portent sur le loyer.
const profileData = { income: 60000, adults: 1, children: 0 };

function makeAsset({ loyerInitial = 0, loyerHistorique = null, lots = null, dateAchat = '2024-01' } = {}) {
    const asset = {
        id: 'test-loyer',
        dateAchat,
        acquisition: {
            prix: 100000, fraisAgence: 0, fraisNotaire: 0, loyerInitial,
            credit: { montant: 0, duree: 0, taux: 0, assurance: 0 }
        },
        postAchat: {
            taxeFonciere: 0, chargesCopro: 0, gestionLocative: 0, assurancePNO: 0,
            vacance: 0, travaux: [], chargesAnnuelles: [], notes: []
        }
    };
    if (loyerHistorique) asset.postAchat.loyerHistorique = loyerHistorique;
    if (lots) asset.lots = lots;
    return asset;
}

// --- Test 1 : sans historique, on retombe sur acquisition.loyerInitial (biens créés avant la refonte) ---
{
    const asset = makeAsset({ loyerInitial: 750 });
    assert.equal(resolveLoyerVacance(asset).loyer, 750, 'sans historique, le loyer initial doit être utilisé');
    assert.equal(resolveLoyerVacance(asset, '2030-01').loyer, 750, 'le repli sur loyerInitial ne dépend pas de la date');
    console.log('Test 1 OK — rétrocompatibilité : loyerInitial utilisé quand loyerHistorique est absent');
}

// --- Test 2 : une seule entrée — ce montant s'applique, y compris avant sa prise d'effet ---
{
    const asset = makeAsset({ loyerInitial: 750, loyerHistorique: [{ mois: '2024-03', montant: 800 }] });
    assert.equal(resolveLoyerVacance(asset, '2024-03').loyer, 800, 'le mois de prise d\'effet est inclus');
    assert.equal(resolveLoyerVacance(asset, '2024-09').loyer, 800, 'après la prise d\'effet, le montant s\'applique');
    // Avant la première prise d'effet, on retient le loyer de départ plutôt que 0 :
    // un bien acquis en cours d'année ne doit pas afficher un loyer nul sur les mois antérieurs.
    assert.equal(resolveLoyerVacance(asset, '2024-01').loyer, 800, 'avant la première entrée, le loyer de départ est retenu');
    console.log('Test 2 OK — entrée unique : 800 €/mois appliqué sur toute la période');
}

// --- Test 3 : plusieurs entrées — la bonne valeur de part et d'autre de chaque date ---
{
    const asset = makeAsset({
        loyerInitial: 700,
        loyerHistorique: [
            { mois: '2024-01', montant: 800 },
            { mois: '2025-07', montant: 850 },
            { mois: '2026-04', montant: 900 },
        ]
    });
    assert.equal(resolveLoyerVacance(asset, '2024-06').loyer, 800, 'avant la 1re augmentation');
    assert.equal(resolveLoyerVacance(asset, '2025-06').loyer, 800, 'juste avant la 2e prise d\'effet');
    assert.equal(resolveLoyerVacance(asset, '2025-07').loyer, 850, 'le mois de prise d\'effet est inclus');
    assert.equal(resolveLoyerVacance(asset, '2026-03').loyer, 850, 'juste avant la 3e prise d\'effet');
    assert.equal(resolveLoyerVacance(asset, '2026-04').loyer, 900, 'après la 3e prise d\'effet');
    assert.equal(resolveLoyerVacance(asset, '2099-12').loyer, 900, 'au-delà, la dernière valeur persiste');
    console.log('Test 3 OK — évolutions multiples résolues à la bonne date');
}

// --- Test 4 : une année seule ('YYYY') est résolue au 31/12 de cette année ---
{
    const asset = makeAsset({
        loyerHistorique: [
            { mois: '2024-01', montant: 800 },
            { mois: '2025-07', montant: 850 },
        ]
    });
    assert.equal(resolveLoyerVacance(asset, '2024').loyer, 800, '2024 se résout au 2024-12');
    assert.equal(resolveLoyerVacance(asset, '2025').loyer, 850, '2025 se résout au 2025-12, après la hausse de juillet');
    console.log('Test 4 OK — une année seule est résolue à sa fin d\'année');
}

// --- Test 5 : les lots d'un immeuble restent prioritaires sur l'historique ---
{
    const asset = makeAsset({
        loyerInitial: 700,
        loyerHistorique: [{ mois: '2024-01', montant: 800 }],
        lots: [
            { id: 'l1', nom: 'Appt 1', loyer: 500, vacance: 0 },
            { id: 'l2', nom: 'Appt 2', loyer: 450, vacance: 0 },
        ]
    });
    assert.equal(resolveLoyerVacance(asset).loyer, 950, 'la somme des lots prime sur l\'historique et le loyer initial');
    console.log('Test 5 OK — priorité aux lots pour un immeuble de rapport');
}

// --- Test 6 : la projection annuelle reflète bien les évolutions de loyer ---
{
    const asset = makeAsset({
        dateAchat: '2024-01',
        loyerHistorique: [
            { mois: '2024-01', montant: 800 },
            { mois: '2026-01', montant: 1000 },
        ]
    });
    const { years } = computeOwnedAssetTimeline(asset, profileData, 'micro-foncier');
    const y2024 = years.find(y => y.year === 2024);
    const y2026 = years.find(y => y.year === 2026);
    assert.equal(y2024.recettesAnnee, 800 * 12, `2024 doit encaisser 12 × 800 €, trouvé ${y2024.recettesAnnee}`);
    assert.equal(y2026.recettesAnnee, 1000 * 12, `2026 doit encaisser 12 × 1000 €, trouvé ${y2026.recettesAnnee}`);
    console.log('Test 6 OK — timeline : recettes 2024 =', y2024.recettesAnnee, '€, 2026 =', y2026.recettesAnnee, '€');
}

// --- Test 7 : computeCFBreakdown résout le loyer sur l'année cible demandée ---
{
    const asset = makeAsset({
        dateAchat: '2024-01',
        loyerHistorique: [
            { mois: '2024-01', montant: 800 },
            { mois: '2026-01', montant: 1000 },
        ]
    });
    const bdY1 = computeCFBreakdown(asset, profileData, 'micro-foncier', 1); // 2024
    const bdY3 = computeCFBreakdown(asset, profileData, 'micro-foncier', 3); // 2026
    assert.equal(bdY1.loyerBrut, 800 * 12, `an 1 (2024) : loyer brut attendu ${800 * 12}, trouvé ${bdY1.loyerBrut}`);
    assert.equal(bdY3.loyerBrut, 1000 * 12, `an 3 (2026) : loyer brut attendu ${1000 * 12}, trouvé ${bdY3.loyerBrut}`);
    console.log('Test 7 OK — breakdown : an 1 =', bdY1.loyerBrut, '€/an, an 3 =', bdY3.loyerBrut, '€/an');
}

console.log('ALL LOYER HISTORIQUE TESTS PASSED');
