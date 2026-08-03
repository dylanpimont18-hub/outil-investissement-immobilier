import assert from 'node:assert/strict';
import { computeAmortizationSchedule, computeCFBreakdown } from '../calculs.js';

// Bug signalé : l'app supposait une assurance emprunteur constante pour toute la durée du crédit
// (basée sur le capital initial), alors que certains contrats la recalculent chaque année sur le
// capital restant dû (elle diminue, comme les intérêts, ce qu'on voit sur l'échéancier bancaire).
// Ces tests couvrent le nouveau mode `assuranceMode: 'crd'` ajouté à côté du mode `'initial'`
// (comportement historique, conservé par défaut).

const tmi = 30;

function makeAsset({ prix = 100000, loyer = 800, credit } = {}) {
    return {
        id: 'test-asset',
        dateAchat: '2024-01',
        acquisition: {
            prix, fraisAgence: 0, fraisNotaire: 0, loyerInitial: loyer,
            credit
        },
        postAchat: {
            taxeFonciere: 0, chargesCopro: 0, gestionLocative: 0, assurancePNO: 0,
            vacance: 0, travaux: [], chargesAnnuelles: [], notes: []
        }
    };
}

// --- Test 1 : computeAmortizationSchedule, mode 'initial' — assurance constante chaque année ---
{
    const { schedule } = computeAmortizationSchedule(120000, 3, 15, 2024, 0.3, 'initial');
    const attendu = Math.round(120000 * 0.003);
    assert.ok(schedule.every(r => r.assurance === attendu), `mode initial : assurance doit rester à ${attendu}€ toute la durée, trouvé ${schedule.map(r => r.assurance)}`);
    console.log('Test 1 OK — mode initial : assurance constante à', attendu, '€/an sur', schedule.length, 'ans');
}

// --- Test 2 : computeAmortizationSchedule, mode 'crd' — assurance dégressive, année 1 = mode initial ---
{
    const { schedule } = computeAmortizationSchedule(120000, 3, 15, 2024, 0.3, 'crd');
    const anneeUnAttendu = Math.round(120000 * 0.003);
    assert.equal(schedule[0].assurance, anneeUnAttendu, `année 1 : CRD = capital initial, doit valoir ${anneeUnAttendu}€, trouvé ${schedule[0].assurance}`);
    for (let i = 1; i < schedule.length; i++) {
        assert.ok(schedule[i].assurance < schedule[i - 1].assurance, `mode crd : l'assurance doit diminuer chaque année (an ${schedule[i].annee}: ${schedule[i].assurance} doit être < an ${schedule[i - 1].annee}: ${schedule[i - 1].assurance})`);
    }
    console.log('Test 2 OK — mode crd : assurance dégressive de', schedule[0].assurance, '€ à', schedule.at(-1).assurance, '€');
}

// --- Test 3 : computeCFBreakdown — mode initial garde une mensualité crédit+assurance stable dans le temps ---
{
    const credit = { montant: 100000, duree: 10, taux: 3, assurance: 1, assuranceMode: 'initial' };
    const asset = makeAsset({ credit });
    const bdY1 = computeCFBreakdown(asset, tmi, 'micro-foncier', 1);
    const bdY3 = computeCFBreakdown(asset, tmi, 'micro-foncier', 3);
    assert.equal(bdY1.mensualiteCredit, bdY3.mensualiteCredit, `mode initial : mensualité crédit+assurance doit être identique an 1 (${bdY1.mensualiteCredit}) et an 3 (${bdY3.mensualiteCredit})`);
    console.log('Test 3 OK — mode initial : mensualité crédit+assurance stable à', bdY1.mensualiteCredit, '€/an');
}

// --- Test 4 : computeCFBreakdown — mode crd fait baisser la mensualité totale au fil des ans ---
{
    const credit = { montant: 100000, duree: 10, taux: 3, assurance: 1, assuranceMode: 'crd' };
    const asset = makeAsset({ credit });
    const bdY1 = computeCFBreakdown(asset, tmi, 'micro-foncier', 1);
    const bdY3 = computeCFBreakdown(asset, tmi, 'micro-foncier', 3);
    assert.ok(bdY3.mensualiteCredit < bdY1.mensualiteCredit, `mode crd : mensualité doit baisser (an 1 = ${bdY1.mensualiteCredit}, an 3 = ${bdY3.mensualiteCredit})`);
    console.log('Test 4 OK — mode crd : mensualité crédit+assurance baisse de', bdY1.mensualiteCredit, '€ (an 1) à', bdY3.mensualiteCredit, '€ (an 3)');
}

// --- Test 5 : assuranceMode absent (biens existants créés avant cette fonctionnalité) — retombe sur 'initial' ---
{
    const credit = { montant: 100000, duree: 10, taux: 3, assurance: 1 }; // pas de assuranceMode
    const asset = makeAsset({ credit });
    const bdY1 = computeCFBreakdown(asset, tmi, 'micro-foncier', 1);
    const bdY3 = computeCFBreakdown(asset, tmi, 'micro-foncier', 3);
    assert.equal(bdY1.mensualiteCredit, bdY3.mensualiteCredit, `sans assuranceMode : doit se comporter comme 'initial' (stable), trouvé an1=${bdY1.mensualiteCredit} an3=${bdY3.mensualiteCredit}`);
    console.log('Test 5 OK — assuranceMode absent : comportement rétrocompatible (mode initial)');
}

console.log('\nTous les tests assurance dégressive passent.');
