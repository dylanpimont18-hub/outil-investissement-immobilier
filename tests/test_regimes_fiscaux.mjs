import assert from 'node:assert/strict';
import { computeCFBreakdown } from '../calculs.js';

// Couvre la matrice régime fiscal × situation (micro-foncier / réel / SCI-IS,
// croisés avec CF positif, déficit hors intérêts, déficit lié aux intérêts
// avec report multi-année, plafond 10 700€). Complète test_frais_fiscalite.mjs
// (qui couvre l'effet des travaux) en isolant les formules de calcul d'impôt
// par régime, sans travaux.

const tmi = 30; // 30%
const tauxGlobalImpot = (tmi / 100) + 0.172; // TMI + CSG/CRDS 17.2%
// Profil sans historique de revenu : income (60000€, 1 part) résout à TMI=30% quelle que soit
// l'année visée — équivalent au tmi=30 figé d'avant le passage à computeCFBreakdown(asset,
// profileData, ...) (résolution du TMI par année, voir resolveTmiFoyer).
const profileData = { income: 60000, adults: 1, children: 0 };

function makeAsset({ prix = 100000, loyer = 800, taxeFonciere = 0, credit = null, travaux = [] } = {}) {
    return {
        id: 'test-asset',
        dateAchat: '2024-01',
        acquisition: {
            prix, fraisAgence: 0, fraisNotaire: 0, loyerInitial: loyer,
            credit: credit || { montant: 0, duree: 0, taux: 0, assurance: 0 }
        },
        postAchat: {
            taxeFonciere, chargesCopro: 0, gestionLocative: 0, assurancePNO: 0,
            vacance: 0, travaux, chargesAnnuelles: [], notes: []
        }
    };
}

// --- Test 1 : micro-foncier — abattement forfaitaire 30%, indépendant des charges réelles ---
{
    const asset = makeAsset({ loyer: 800, taxeFonciere: 500 });
    const bd = computeCFBreakdown(asset, profileData, 'micro-foncier', 1);
    const expected = Math.round((9600 * 0.7) * tauxGlobalImpot);
    assert.equal(bd.impots, expected, `micro-foncier doit taxer 70% des loyers bruts (9600€), trouvé impots=${bd.impots}, attendu ${expected}`);
    console.log('Test 1 OK — micro-foncier : impôt =', bd.impots, '€ (70% de 9600€ × TMI+CSG), ignore les 500€ de charges réelles');
}

// --- Test 2 : réel, CF positif simple — déduction des charges réelles + intérêts ---
{
    const asset = makeAsset({ loyer: 800, taxeFonciere: 500 });
    const bd = computeCFBreakdown(asset, profileData, 'reel', 1);
    const expected = Math.round((9600 - 500) * tauxGlobalImpot);
    assert.equal(bd.impots, expected, `réel doit taxer (loyers - charges réelles), trouvé impots=${bd.impots}, attendu ${expected}`);
    assert.ok(bd.impots > Math.round((9600 * 0.7) * tauxGlobalImpot), 'avec seulement 500€ de charges réelles (< abattement micro-foncier de 2880€), le réel doit être moins favorable que le micro-foncier ici');
    console.log('Test 2 OK — réel : impôt =', bd.impots, '€ (loyers − charges réelles réduites), moins favorable que micro-foncier sur ce cas');
}

// --- Test 3 : réel, déficit hors intérêts au-delà du plafond 10 700€, avec report de l'excédent ---
{
    // Pas de crédit : le déficit est entièrement "hors intérêts" (gros travaux déductibles en année 1).
    const asset = makeAsset({ loyer: 500, travaux: [{ date: '2024-06-01', montant: 20000, tag: 'deductible', description: 'Toiture' }] });

    const bdY1 = computeCFBreakdown(asset, profileData, 'reel', 1); // 2024 : déficit = 20000 - 6000 = 14000€
    // Seuls 10 700€ sont imputables sur le revenu global l'année même, au taux TMI seul (pas + CSG).
    assert.equal(bdY1.impots, Math.round(-10700 * (tmi / 100)), `l'imputation immédiate doit être plafonnée à 10 700€ au taux TMI, trouvé ${bdY1.impots}`);

    // L'excédent (14000 - 10700 = 3300€) est reporté sur les revenus fonciers des années suivantes.
    const bdY2 = computeCFBreakdown(asset, profileData, 'reel', 2); // 2025 : pas de nouveaux travaux, revenusNets = 6000€
    const naiveTaxY2 = Math.round(6000 * tauxGlobalImpot);
    assert.ok(bdY2.impots > 0 && bdY2.impots < naiveTaxY2, `année 2 : le report doit réduire l'impôt sans l'annuler (0 < ${bdY2.impots} < ${naiveTaxY2})`);

    // Une fois le report de 3300€ épuisé (absorbé en année 2), l'année 3 retombe à la taxation pleine.
    const bdY3 = computeCFBreakdown(asset, profileData, 'reel', 3);
    assert.equal(bdY3.impots, Math.round(6000 * tauxGlobalImpot), `année 3 : le report est épuisé, l'impôt doit redevenir plein (${Math.round(6000 * tauxGlobalImpot)}), trouvé ${bdY3.impots}`);

    console.log('Test 3 OK — réel, plafond 10 700€ : an 1 =', bdY1.impots, '€ (imputation plafonnée), an 2 =', bdY2.impots, '€ (report partiel), an 3 =', bdY3.impots, '€ (report épuisé, taxation pleine)');
}

// --- Test 4 : réel, déficit lié aux intérêts (non imputable sur le revenu global), report multi-année ---
{
    // Crédit dont les intérêts dépassent seuls les loyers les premières années (charges hors intérêts nulles :
    // le déficit est donc entièrement dû aux intérêts, non imputable immédiatement sur le revenu global,
    // seulement reportable sur les revenus fonciers futurs — art. 156 I CGI).
    const asset = makeAsset({ loyer: 500, credit: { montant: 180000, duree: 20, taux: 4, assurance: 0 } });

    // Années 1 à 9 (2024-2032) : impôt nul — soit déficit (intérêts > loyers), soit petit bénéfice
    // entièrement absorbé par le déficit reporté des années précédentes.
    for (let ty = 1; ty <= 9; ty++) {
        const bd = computeCFBreakdown(asset, profileData, 'reel', ty);
        assert.equal(bd.impots, 0, `année ${2024 + ty - 1} (targetYear ${ty}) : impôt attendu nul (déficit ou absorption par le report), trouvé ${bd.impots}`);
    }

    // Année 10 (2033) : le report accumulé est enfin épuisé, l'impôt redevient positif mais reste
    // inférieur à ce qu'il serait sans aucun mécanisme de report (preuve que le report a bien joué).
    const bdY10 = computeCFBreakdown(asset, profileData, 'reel', 10);
    assert.ok(bdY10.impots > 0, `année 2033 : le report doit être épuisé et l'impôt redevenir positif, trouvé ${bdY10.impots}`);
    assert.equal(bdY10.impots, 648, `année 2033 : impôt attendu 648€ (déficit d'intérêts cumulé enfin absorbé), trouvé ${bdY10.impots}`);

    console.log('Test 4 OK — réel, déficit lié aux intérêts : 9 années à impôt nul (2024-2032), report épuisé en 2033 (impôt =', bdY10.impots, '€)');
}

// --- Test 5 : SCI-IS, bénéfice positif — amortissement du bâti (80% / 30 ans) + barème 15%/25% ---
{
    // Bénéfice sous le seuil de 42 500€ : taux plein à 15%.
    const assetLow = makeAsset({ prix: 200000, loyer: 1666.67 });
    const bdLow = computeCFBreakdown(assetLow, profileData, 'sci-is', 1);
    const amortissementLow = 200000 * 0.80 / 30;
    const beneficeLow = (1666.67 * 12) - amortissementLow;
    assert.equal(bdLow.impots, Math.round(beneficeLow * 0.15), `SCI-IS sous 42 500€ doit taxer à 15% après amortissement du bâti, trouvé ${bdLow.impots}`);

    // Bénéfice au-dessus de 42 500€ : split 15% jusqu'au seuil, 25% au-delà.
    const assetHigh = makeAsset({ prix: 2000000, loyer: 12500 });
    const bdHigh = computeCFBreakdown(assetHigh, profileData, 'sci-is', 1);
    const amortissementHigh = 2000000 * 0.80 / 30;
    const beneficeHigh = (12500 * 12) - amortissementHigh;
    const expectedHigh = Math.round(Math.min(beneficeHigh, 42500) * 0.15 + Math.max(0, beneficeHigh - 42500) * 0.25);
    assert.equal(bdHigh.impots, expectedHigh, `SCI-IS au-dessus de 42 500€ doit répartir 15%/25%, trouvé ${bdHigh.impots}, attendu ${expectedHigh}`);

    console.log('Test 5 OK — SCI-IS bénéfice : sous seuil =', bdLow.impots, '€ (15%), au-dessus =', bdHigh.impots, '€ (15%/25% mixte)');
}

// --- Test 6 : SCI-IS, bénéfice négatif — pas de déficit reportable (contrairement au réel) ---
{
    // Simplification connue du moteur : à l'IS, un déficit n'est ni imputable sur le revenu global
    // (logique, l'IS est un impôt de société) ni reporté sur les bénéfices futurs de la SCI — il est
    // simplement perdu dans ce modèle. Ce test documente ce comportement pour éviter une régression
    // silencieuse si un report était introduit sans le vouloir.
    const asset = makeAsset({ prix: 200000, loyer: 1666.67, travaux: [{ date: '2024-06-01', montant: 30000, tag: 'deductible' }] });

    const bdY1 = computeCFBreakdown(asset, profileData, 'sci-is', 1);
    assert.equal(bdY1.impots, 0, `SCI-IS en déficit ne doit générer aucun impôt (ni négatif ni positif), trouvé ${bdY1.impots}`);

    const bdY2 = computeCFBreakdown(asset, profileData, 'sci-is', 2);
    const baselineNoDeficit = makeAsset({ prix: 200000, loyer: 1666.67 });
    const bdBaselineY2 = computeCFBreakdown(baselineNoDeficit, profileData, 'sci-is', 2);
    assert.equal(bdY2.impots, bdBaselineY2.impots, `SCI-IS : aucun report attendu, l'impôt de l'année suivante doit être identique à un actif sans déficit préalable (${bdBaselineY2.impots}), trouvé ${bdY2.impots}`);

    console.log('Test 6 OK — SCI-IS déficit : an 1 impôt =', bdY1.impots, '€, an 2 =', bdY2.impots, '€ (identique au cas sans déficit, aucun report)');
}

console.log('ALL RÉGIMES FISCAUX TESTS PASSED');
