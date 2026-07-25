import assert from 'node:assert/strict';
import { computeOwnedAssetTimeline, computeCFBreakdown } from '../calculs.js';

// Bien simple, sans crédit, pour isoler l'effet fiscal des travaux.
function makeAsset({ travaux = [] } = {}) {
    return {
        id: 'test-asset',
        anneeAchat: 2024,
        acquisition: {
            prix: 100000, fraisAgence: 0, fraisNotaire: 0, loyerInitial: 1000,
            credit: { montant: 0, duree: 0, taux: 0, assurance: 0 }
        },
        postAchat: {
            taxeFonciere: 0, chargesCopro: 0, gestionLocative: 0, assurancePNO: 0,
            vacance: 0, travaux, chargesAnnuelles: [], notes: []
        }
    };
}

const tmi = 30; // 30%

// --- Test 1 : travaux déductibles réduisent l'impôt en régime réel l'année du frais ---
{
    const assetSansTravaux = makeAsset();
    const assetAvecTravaux = makeAsset({ travaux: [{ date: '2026-06-01', montant: 8000, tag: 'deductible', description: 'Toiture' }] });

    const { years: yearsSans } = computeOwnedAssetTimeline(assetSansTravaux, tmi, 'reel');
    const { years: yearsAvec } = computeOwnedAssetTimeline(assetAvecTravaux, tmi, 'reel');

    const row2026Sans = yearsSans.find(y => y.year === 2026);
    const row2026Avec = yearsAvec.find(y => y.year === 2026);

    assert.ok(row2026Sans && row2026Avec, 'les deux timelines doivent avoir une entrée 2026');
    assert.ok(
        row2026Avec.cfAnnuel < row2026Sans.cfAnnuel,
        `le CF 2026 avec travaux (${row2026Avec.cfAnnuel}) doit être inférieur à sans travaux (${row2026Sans.cfAnnuel}) — dépense réelle de 8000€`
    );
    // Le CF ne doit pas juste chuter de 8000€ brut : la déduction fiscale doit compenser une partie
    // (sinon les travaux déductibles n'ont aucun avantage fiscal, ce qui serait le bug d'origine).
    const ecartBrut = row2026Sans.cfAnnuel - row2026Avec.cfAnnuel;
    assert.ok(
        ecartBrut < 8000,
        `l'écart de CF (${ecartBrut}) doit être < 8000€ bruts si la déduction fiscale joue effectivement (sinon le bug persiste)`
    );

    // Les années suivantes (2027+, pas de nouveaux travaux) doivent redevenir identiques
    const row2027Sans = yearsSans.find(y => y.year === 2027);
    const row2027Avec = yearsAvec.find(y => y.year === 2027);
    assert.equal(row2027Avec.cfAnnuel, row2027Sans.cfAnnuel, "l'année suivante (sans nouveau frais) ne doit plus être affectée");

    console.log('Test 1 OK — travaux déductibles réduisent le CF 2026 de', ecartBrut, '€ (< 8000€ brut, déduction fiscale active)');
}

// --- Test 2 : en micro-foncier, les travaux n'ont aucun effet fiscal (juste une dépense cash) ---
{
    const assetSansTravaux = makeAsset();
    const assetAvecTravaux = makeAsset({ travaux: [{ date: '2026-06-01', montant: 8000, tag: 'deductible', description: 'Toiture' }] });

    const { years: yearsSans } = computeOwnedAssetTimeline(assetSansTravaux, tmi, 'micro-foncier');
    const { years: yearsAvec } = computeOwnedAssetTimeline(assetAvecTravaux, tmi, 'micro-foncier');

    const row2026Sans = yearsSans.find(y => y.year === 2026);
    const row2026Avec = yearsAvec.find(y => y.year === 2026);
    const ecart = row2026Sans.cfAnnuel - row2026Avec.cfAnnuel;

    assert.ok(Math.abs(ecart - 8000) < 0.01, `en micro-foncier, l'écart doit être exactement 8000€ (aucune déduction), trouvé ${ecart}`);
    console.log('Test 2 OK — micro-foncier : travaux = dépense cash pure, écart exact de', ecart, '€');
}

// --- Test 3 : travaux non-déductibles réduisent le cash mais pas l'impôt, même en réel ---
{
    const assetDed = makeAsset({ travaux: [{ date: '2026-06-01', montant: 8000, tag: 'deductible' }] });
    const assetNonDed = makeAsset({ travaux: [{ date: '2026-06-01', montant: 8000, tag: 'non-deductible' }] });

    const { years: yearsDed } = computeOwnedAssetTimeline(assetDed, tmi, 'reel');
    const { years: yearsNonDed } = computeOwnedAssetTimeline(assetNonDed, tmi, 'reel');

    const cfDed = yearsDed.find(y => y.year === 2026).cfAnnuel;
    const cfNonDed = yearsNonDed.find(y => y.year === 2026).cfAnnuel;

    assert.ok(cfDed > cfNonDed, `le CF avec travaux déductibles (${cfDed}) doit être supérieur à non-déductibles (${cfNonDed}) — l'avantage fiscal ne joue que pour les déductibles`);
    console.log('Test 3 OK — déductible (CF', cfDed, ') > non-déductible (CF', cfNonDed, ') — avantage fiscal correctement réservé au tag déductible');
}

// --- Test 4 : computeCFBreakdown reste cohérent (résidu impôt calculé correctement avec travaux) ---
{
    const asset = makeAsset({ travaux: [{ date: '2026-06-01', montant: 8000, tag: 'deductible' }] });
    const bd = computeCFBreakdown(asset, tmi, 'reel', 3); // targetYear=3 => anneeAchat(2024)+3-1=2026
    assert.ok(bd, 'breakdown doit exister');
    assert.equal(bd.travaux, 8000, `bd.travaux doit valoir 8000, trouvé ${bd.travaux}`);
    // Le résidu doit rester interne cohérent : loyers - mensualité - charges - travaux - impots == cfNetNet
    const reconstructed = bd.loyersEncaisses - bd.mensualiteCredit - bd.charges - bd.travaux - bd.impots;
    assert.ok(Math.abs(reconstructed - bd.cfNetNet) < 1, `reconstruction incohérente : ${reconstructed} vs cfNetNet ${bd.cfNetNet}`);
    console.log('Test 4 OK — computeCFBreakdown cohérent, bd.travaux =', bd.travaux, ', cfNetNet =', bd.cfNetNet);
}

console.log('ALL CALCULS.JS TESTS PASSED');
