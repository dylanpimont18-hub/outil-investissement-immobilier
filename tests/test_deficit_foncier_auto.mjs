import assert from 'node:assert/strict';
import { computeDeficitFoncierHistorique } from '../calculs.js';

// Le tableau "Déficits fonciers reportables" était une saisie manuelle que l'utilisateur ne savait
// pas remplir. computeDeficitFoncierHistorique le calcule désormais automatiquement en rejouant
// l'historique du bien (régime réel simulé, quel que soit le régime actuellement sélectionné) avec
// une consommation FIFO des déficits par ordre d'ancienneté (règle des 10 ans, art. 156 I 3° CGI).

// TMI n'entre pas dans le calcul du déficit foncier lui-même ; profil sans historique de revenu.
const profileData = { income: 60000, adults: 1, children: 0 };

function makeAsset({ dateAchat, loyer = 500, travaux = [] } = {}) {
    return {
        id: 'test-deficit',
        dateAchat,
        acquisition: {
            prix: 100000, fraisAgence: 0, fraisNotaire: 0, loyerInitial: loyer,
            credit: { montant: 0, duree: 0, taux: 0, assurance: 0 }
        },
        postAchat: {
            taxeFonciere: 0, chargesCopro: 0, gestionLocative: 0, assurancePNO: 0,
            vacance: 0, travaux, chargesAnnuelles: [], notes: []
        }
    };
}

// --- Test 1 : gros travaux l'année d'achat créent un déficit reportable, absorbé l'année suivante ---
{
    // loyer 500×12=6000€, travaux déductibles 20000€ → déficit hors intérêts 14000€, dont 10700€
    // imputables immédiatement sur le revenu global (pas dans ce tableau) et 3300€ reportables.
    const asset = makeAsset({
        dateAchat: '2020-01',
        loyer: 500,
        travaux: [{ date: '2020-06-01', montant: 20000, tag: 'deductible' }]
    });
    const { lignes, stockTotal } = computeDeficitFoncierHistorique(asset, profileData);
    const ligne2020 = lignes.find(l => l.annee === 2020);
    assert.ok(ligne2020, 'une ligne 2020 doit exister');
    assert.equal(ligne2020.montantInitial, 3300, `déficit reportable créé doit être 3300€ (14000-10700), trouvé ${ligne2020.montantInitial}`);
    // Les années suivantes (6000€/an, pas de nouvelle charge) absorbent rapidement ce reliquat.
    assert.equal(ligne2020.utilise, 3300, `le déficit doit être entièrement absorbé par les années bénéficiaires suivantes, utilisé=${ligne2020.utilise}`);
    assert.equal(ligne2020.restant, 0, 'plus rien ne doit rester à imputer');
    assert.equal(stockTotal, 0, 'le stock total reportable doit être nul, tout est déjà absorbé');
    console.log('Test 1 OK — déficit créé en 2020 (3300€), entièrement absorbé, stock restant =', stockTotal, '€');
}

// --- Test 2 : deux déficits d'années différentes, consommation FIFO (le plus ancien en premier) ---
{
    // Deux années de travaux consécutives créent chacune 3300€ reportable, suivies d'une seule
    // année bénéficiaire (relatif à aujourd'hui, pour rester déterministe quelle que soit la date
    // d'exécution du test) : 6000€ de loyer ne suffisent à éponger que le plus ancien déficit en
    // entier (3300€) + une partie du second (2700€ sur 3300€, il doit rester 600€).
    const currentYear = new Date().getFullYear();
    const anneeA = currentYear - 2;
    const anneeB = currentYear - 1;
    const asset = makeAsset({
        dateAchat: `${anneeA}-01`,
        loyer: 500,
        travaux: [
            { date: `${anneeA}-06-01`, montant: 20000, tag: 'deductible' },
            { date: `${anneeB}-06-01`, montant: 20000, tag: 'deductible' }
        ]
    });
    const { lignes } = computeDeficitFoncierHistorique(asset, profileData);
    const lA = lignes.find(l => l.annee === anneeA);
    const lB = lignes.find(l => l.annee === anneeB);
    assert.ok(lA && lB, `les deux lignes ${anneeA} et ${anneeB} doivent exister`);
    assert.equal(lA.restant, 0, `le déficit ${anneeA} (le plus ancien) doit être intégralement consommé en premier`);
    assert.equal(lB.restant, 600, `le déficit ${anneeB} (le plus récent) ne doit recevoir que le reliquat après ${anneeA}, trouvé ${lB.restant}`);
    console.log(`Test 2 OK — FIFO respecté : ${anneeA} (le plus ancien) épuisé avant ${anneeB}, restant ${anneeB} =`, lB.restant, '€');
}

// --- Test 3 : expiration à 10 ans — un déficit ancien non consommé est marqué expiré ---
{
    const currentYear = new Date().getFullYear();
    const anneeAncienne = currentYear - 11; // largement au-delà des 10 ans
    const asset = makeAsset({
        dateAchat: `${anneeAncienne}-01`,
        loyer: 0, // aucun loyer encaissé sur toute la période => jamais de quoi absorber le déficit
        travaux: [{ date: `${anneeAncienne}-06-01`, montant: 20000, tag: 'deductible' }]
    });
    const { lignes, stockTotal } = computeDeficitFoncierHistorique(asset, profileData);
    const ligne = lignes.find(l => l.annee === anneeAncienne);
    assert.ok(ligne, 'la ligne doit exister même expirée (traçabilité)');
    assert.equal(ligne.expired, true, `un déficit de ${currentYear - anneeAncienne} ans doit être marqué expiré`);
    assert.equal(stockTotal, 0, 'un déficit expiré ne doit plus compter dans le stock reportable total');
    console.log('Test 3 OK — déficit de', anneeAncienne, `(${currentYear - anneeAncienne} ans) marqué expiré, exclu du stock total`);
}

// --- Test 4 : aucun déficit si le bien a toujours été bénéficiaire ---
{
    const asset = makeAsset({ dateAchat: '2022-01', loyer: 800, travaux: [] });
    const { lignes, stockTotal } = computeDeficitFoncierHistorique(asset, profileData);
    assert.equal(lignes.length, 0, 'aucune ligne ne doit être créée pour un bien toujours bénéficiaire');
    assert.equal(stockTotal, 0);
    console.log('Test 4 OK — bien toujours bénéficiaire : aucun déficit, tableau vide');
}

console.log('\nTous les tests déficit foncier automatique passent.');
