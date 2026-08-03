import assert from 'node:assert/strict';
import {
    resolveRevenuFoyer, resolveTmiFoyer, computeCompteResultat, computeOwnedAssetTimeline
} from '../calculs.js';

// Le TMI du foyer pilote tous les calculs d'impôt du portefeuille. Un revenu qui évolue d'une année
// sur l'autre ne doit pas faire recalculer une année fiscale déjà passée avec le revenu d'aujourd'hui
// (spec docs/superpowers/specs/2026-08-04-revenus-historises-profil.md).

// --- Test 1 : resolveRevenuFoyer — sans historique, fallback sur profileData.income ---
{
    assert.equal(resolveRevenuFoyer({ income: 40000 }, 2024), 40000, 'sans historique, income doit être utilisé');
    assert.equal(resolveRevenuFoyer({ income: 40000 }, 2099), 40000, 'le repli sur income ne dépend pas de l\'année');
    assert.equal(resolveRevenuFoyer({}, 2024), 0, 'profil vide doit résoudre à 0');
    console.log('Test 1 OK — sans historique, resolveRevenuFoyer retombe sur profileData.income');
}

// --- Test 2 : resolveRevenuFoyer — une entrée s'applique y compris avant sa prise d'effet ---
{
    const profileData = { income: 30000, revenuHistorique: [{ annee: 2024, revenu: 45000 }] };
    assert.equal(resolveRevenuFoyer(profileData, 2024), 45000, 'l\'année de prise d\'effet est incluse');
    assert.equal(resolveRevenuFoyer(profileData, 2026), 45000, 'après la prise d\'effet, le montant s\'applique');
    // Avant la première prise d'effet, on retient quand même la première valeur connue (comme
    // resolveLoyerFromHistorique) plutôt que income — cohérent avec le principe "je connais déjà
    // le revenu de cette période, pas la peine de retomber sur l'ancien champ".
    assert.equal(resolveRevenuFoyer(profileData, 2020), 45000, 'avant la première entrée, elle est quand même retenue');
    console.log('Test 2 OK — entrée unique appliquée sur toute la période, y compris avant sa prise d\'effet');
}

// --- Test 3 : resolveRevenuFoyer — plusieurs entrées, la bonne valeur de part et d'autre ---
{
    const profileData = {
        income: 20000,
        revenuHistorique: [
            { annee: 2022, revenu: 30000 },
            { annee: 2024, revenu: 34445 },
            { annee: 2026, revenu: 40000 },
        ]
    };
    assert.equal(resolveRevenuFoyer(profileData, 2023), 30000, 'entre 2022 et 2024, le revenu 2022 s\'applique');
    assert.equal(resolveRevenuFoyer(profileData, 2024), 34445, 'l\'année de prise d\'effet est incluse');
    assert.equal(resolveRevenuFoyer(profileData, 2025), 34445, 'juste avant la prise d\'effet suivante');
    assert.equal(resolveRevenuFoyer(profileData, 2030), 40000, 'au-delà, la dernière valeur persiste (projection)');
    console.log('Test 3 OK — évolutions multiples résolues à la bonne année');
}

// --- Test 4 : resolveTmiFoyer — le TMI varie effectivement avec le revenu historisé de l'année ---
{
    // 2 adultes + 2 enfants = 3 parts (voir getHouseholdTaxParts).
    const profileData = {
        adults: 2, children: 2,
        revenuHistorique: [
            { annee: 2023, revenu: 34445 }, // quotient 11482 < 11600 => TMI 0%
            { annee: 2026, revenu: 90000 }, // quotient 30000, tranche 30%
        ]
    };
    const tmi2023 = resolveTmiFoyer(profileData, 2023);
    const tmi2026 = resolveTmiFoyer(profileData, 2026);
    assert.equal(tmi2023, 0, `TMI 2023 attendu 0% (revenu bas), trouvé ${tmi2023}%`);
    assert.equal(tmi2026, 30, `TMI 2026 attendu 30% (revenu plus élevé), trouvé ${tmi2026}%`);
    console.log('Test 4 OK — TMI 2023 =', tmi2023, '% (revenu bas) vs TMI 2026 =', tmi2026, '% (revenu plus élevé)');
}

// --- Test 5 : computeCompteResultat — une année passée n'est pas retaxée avec le revenu actuel ---
{
    const asset = {
        id: 'test-revenu', dateAchat: '2022-01',
        acquisition: { prix: 100000, fraisAgence: 0, fraisNotaire: 0, loyerInitial: 800, credit: { montant: 0, duree: 0, taux: 0, assurance: 0 } },
        postAchat: { taxeFonciere: 0, chargesCopro: 0, gestionLocative: 0, assurancePNO: 0, vacance: 0, travaux: [], chargesAnnuelles: [], notes: [] }
    };
    const profileData = {
        adults: 2, children: 2,
        revenuHistorique: [
            { annee: 2022, revenu: 34445 }, // TMI 0% cette année-là
            { annee: 2025, revenu: 90000 }, // TMI 30% depuis
        ]
    };
    const cr2022 = computeCompteResultat(asset, 2022, profileData, 'reel');
    const cr2026 = computeCompteResultat(asset, 2026, profileData, 'reel');
    // Même loyer/charges chaque année pleine (9600€ de résultat foncier positif) : seul le TMI change.
    // 2022 : TMI 0% => impôt = CSG seule (17.2%). 2026 : TMI 30% => impôt bien plus élevé.
    assert.ok(cr2026.impots > cr2022.impots * 2, `l'impôt 2026 (TMI 30%, ${cr2026.impots}€) doit être nettement supérieur à 2022 (TMI 0%, ${cr2022.impots}€) — le revenu de l'année doit peser, pas le revenu actuel appliqué à toutes les années`);
    console.log('Test 5 OK — impôt 2022 (TMI 0%) =', cr2022.impots, '€ vs impôt 2026 (TMI 30%) =', cr2026.impots, '€ — chaque année utilise son propre TMI');
}

// --- Test 6 : computeOwnedAssetTimeline — le TMI varie dans la même boucle multi-année ---
{
    const asset = {
        id: 'test-revenu-timeline', dateAchat: '2022-01',
        acquisition: { prix: 100000, fraisAgence: 0, fraisNotaire: 0, loyerInitial: 800, credit: { montant: 0, duree: 0, taux: 0, assurance: 0 } },
        postAchat: { taxeFonciere: 0, chargesCopro: 0, gestionLocative: 0, assurancePNO: 0, vacance: 0, travaux: [], chargesAnnuelles: [], notes: [] }
    };
    const profileData = {
        adults: 2, children: 2,
        revenuHistorique: [
            { annee: 2022, revenu: 34445 },
            { annee: 2025, revenu: 90000 },
        ]
    };
    const { years } = computeOwnedAssetTimeline(asset, profileData, 'reel');
    const cf2022 = years.find(y => y.year === 2022).cfAnnuel;
    const cf2026 = years.find(y => y.year === 2026).cfAnnuel;
    // Même loyer 9600€/an chaque année (pas de charges, pas de crédit) : le CF 2026 doit être plus
    // bas que 2022 uniquement à cause du TMI plus élevé, pas d'une autre variable.
    assert.ok(cf2026 < cf2022, `CF 2026 (TMI 30%, ${Math.round(cf2026)}€) doit être inférieur à 2022 (TMI 0%, ${Math.round(cf2022)}€) — la timeline doit résoudre un TMI différent par année`);
    console.log('Test 6 OK — timeline : CF 2022 (TMI 0%) =', Math.round(cf2022), '€ > CF 2026 (TMI 30%) =', Math.round(cf2026), '€');
}

console.log('\nTous les tests revenu historisé passent.');
