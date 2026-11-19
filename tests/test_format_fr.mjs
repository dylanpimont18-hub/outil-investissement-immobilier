// Format décimal français partagé (audit 2026-11-18, A1) : virgule décimale partout.
import assert from 'node:assert/strict';
import { formatDecimalFr, formatRatioFr, computePortfolioAlerts } from '../calculs.js';

assert.equal(formatRatioFr(0.5), '0,50');
assert.equal(formatRatioFr(0.916), '0,92');
assert.equal(formatRatioFr(-1.234), '-1,23');
assert.equal(formatRatioFr(NaN), '--');
assert.equal(formatRatioFr(Infinity), '--');
assert.equal(formatDecimalFr(17.66, 1), '17,7');
assert.equal(formatDecimalFr(6, 1), '6,0');
console.log('Test 1 OK — formatRatioFr / formatDecimalFr à la française');

const asset = {
    id: 'a1', nom: 'Bien test', dateAchat: '2024-01',
    acquisition: { prix: 120000, fraisNotaire: 9000, loyerInitial: 400, credit: { montant: 129000, duree: 20, taux: 4, assurance: 0.3 } },
    postAchat: { taxeFonciere: 800, chargesCopro: 0, gestionLocative: 0, assurancePNO: 120, travaux: [] },
    scenarios: [{ id: 'realiste', nom: 'Réaliste', variables: { vacance: 5, regime: 'micro-foncier' } }]
};
const alerts = computePortfolioAlerts([asset], { income: 40000, adults: 1, children: 0 }, 'micro-foncier');
const dscr = alerts.find(a => a.type === 'dscr');
assert.ok(dscr, 'alerte DSCR attendue (loyer 400 € pour ~780 €/mois de crédit)');
assert.match(dscr.msg, /DSCR \d+,\d{2} :/);
assert.doesNotMatch(dscr.msg, /DSCR \d+\.\d/);
console.log(`Test 2 OK — alerte du Centre d'actions : « ${dscr.msg} »`);

console.log('\nTous les tests de format français passent.');
