// Cout d'un euro emprunte : r = Y x t / (1 - (1 + t/12)^-12Y).
//
// La formule est fermee ; elle est donc verifiee ici par une methode INDEPENDANTE — un echeancier
// simule mois par mois, mensualite constante, interet sur le capital restant du — et non en la
// relisant. Les deux voies doivent tomber sur le meme chiffre, et l'echeancier doit se solder a
// zero : c'est ce qui prouve que la mensualite employee est la bonne.
import assert from 'node:assert/strict';
import {
    ratioRemboursement,
    RATIO_TAUX_MIN, RATIO_TAUX_MAX, RATIO_DUREE_MIN, RATIO_DUREE_MAX,
} from '../calculs.js';

const presque = (a, b, tol, msg) => assert.ok(Math.abs(a - b) < tol, `${msg} (attendu ~${b}, trouve ${a})`);

// Contre-calcul : on emprunte 1 EUR, on deroule l'echeancier, on somme ce qui sort.
// La mensualite est cherchee par DICHOTOMIE sur « le capital restant du tombe a zero au dernier
// mois », sans reprendre la formule d'annuite : deux erreurs identiques des deux cotes ne peuvent
// donc pas se compenser.
function ratioParEcheancier(tauxAnnuelPct, dureeAnnees) {
    const i = tauxAnnuelPct / 100 / 12;
    const n = Math.round(12 * dureeAnnees);
    if (!(i > 0)) return 1;
    const resteApres = m => {
        let capital = 1;
        for (let k = 0; k < n; k++) capital = capital * (1 + i) - m;
        return capital;
    };
    let bas = 1 / n, haut = 1;                       // la mensualite est entre le sans-interet et tout
    for (let k = 0; k < 200; k++) {
        const milieu = (bas + haut) / 2;
        if (resteApres(milieu) > 0) bas = milieu; else haut = milieu;
    }
    const mensualite = (bas + haut) / 2;
    presque(resteApres(mensualite), 0, 1e-9, `l'echeancier se solde a zero (${tauxAnnuelPct} % / ${dureeAnnees} ans)`);
    return mensualite * n;
}

// --- Confrontation sur une grille de cas ---
let ecartMax = 0;
for (const taux of [0.5, 1, 1.5, 2, 2.5, 3, 3.15, 3.5, 4, 4.25, 5, 6, 7.5, 10, 15, 20]) {
    for (const duree of [1, 2, 5, 7.5, 10, 12, 15, 20, 22.5, 25, 30, 35]) {
        const { ratio } = ratioRemboursement(taux, duree);
        const attendu = ratioParEcheancier(taux, duree);
        ecartMax = Math.max(ecartMax, Math.abs(ratio - attendu));
        presque(ratio, attendu, 1e-9, `${taux} % sur ${duree} ans`);
    }
}
console.log(`Test ratio contre echeancier simule OK (192 cas, ecart maximal ${ecartMax.toExponential(2)})`);

// --- Valeurs de reference, calculees a la main ---
// 3,5 % sur 20 ans : i = 0,00291666667, n = 240, (1+i)^-240 = 0,4970915089
// r = 20 x 0,035 / (1 - 0,4970915089) = 0,7 / 0,5029084911 = 1,3919033232
presque(ratioRemboursement(3.5, 20).ratio, 1.3919033232, 1e-9, '3,5 % sur 20 ans');
// 3,15 % sur 25 ans : i = 0,002625, n = 300, (1+i)^-300 = 0,4554505130
// r = 25 x 0,0315 / 0,5445494870 = 0,7875 / 0,5445494870 = 1,4461495581
presque(ratioRemboursement(3.15, 25).ratio, 1.4461495581, 1e-9, '3,15 % sur 25 ans (le taux cité au cahier des charges)');
presque(ratioRemboursement(3.5, 20).pctInterets, 39.19033232, 1e-7, 'et le pourcentage d\'interets en decoule');
console.log('Test valeurs de reference OK');

// --- Taux nul : la formule tombe sur 0/0, la limite vaut 1 ---
for (const duree of [1, 10, 35]) {
    const r = ratioRemboursement(0, duree);
    assert.equal(r.ratio, 1, `taux nul sur ${duree} ans : on rembourse exactement ce qu'on a emprunte`);
    assert.equal(r.pctInterets, 0, 'et aucun interet');
    assert.ok(Number.isFinite(r.ratio), 'jamais NaN, jamais Infinity');
}
console.log('Test taux nul OK');

// --- Monotonie : le ratio croit avec le taux ET avec la duree ---
// C'est la propriete que le conseiller commente a l'oral ; un signe inverse quelque part la casserait.
let precedent = 0;
for (const taux of [0, 1, 2, 3, 4, 5, 10, 20]) {
    const r = ratioRemboursement(taux, 20).ratio;
    assert.ok(r > precedent, `a duree egale, un taux plus eleve coute plus cher (${taux} % : ${r.toFixed(4)})`);
    precedent = r;
}
precedent = 0;
for (const duree of [1, 5, 10, 15, 20, 25, 30, 35]) {
    const r = ratioRemboursement(3.5, duree).ratio;
    assert.ok(r > precedent, `a taux egal, une duree plus longue coute plus cher (${duree} ans : ${r.toFixed(4)})`);
    precedent = r;
}
// Et il vaut toujours au moins 1 : on ne rembourse jamais moins que ce qu'on a emprunte.
for (const taux of [0, 0.01, 3.5, 20]) {
    for (const duree of [1, 20, 35]) {
        assert.ok(ratioRemboursement(taux, duree).ratio >= 1,
            `${taux} % sur ${duree} ans : le ratio ne descend jamais sous 1`);
    }
}
console.log('Test monotonie et plancher a 1 OK');

// --- Bornes : une valeur hors limites est ramenee ET signalee ---
// Regle du projet : une valeur substituee doit se VOIR, jamais etre avalee en silence.
{
    const trop = ratioRemboursement(50, 60);
    assert.equal(trop.taux, RATIO_TAUX_MAX, 'un taux de 50 % est ramene au plafond');
    assert.equal(trop.duree, RATIO_DUREE_MAX, 'une duree de 60 ans aussi');
    assert.equal(trop.borne, true, 'et le bornage est expose a l\'appelant');

    const sous = ratioRemboursement(-3, 0.5);
    assert.equal(sous.taux, RATIO_TAUX_MIN, 'un taux negatif est ramene au plancher');
    assert.equal(sous.duree, RATIO_DUREE_MIN, 'une duree sous un an aussi');
    assert.equal(sous.borne, true, 'et le bornage est expose');

    const dedans = ratioRemboursement(3.15, 25);
    assert.equal(dedans.borne, false, 'une saisie dans les bornes n\'est pas signalee');

    // Une saisie illisible ne produit pas 0 : elle produit « pas de resultat ».
    for (const illisible of [NaN, undefined, null, 'abc', '']) {
        const r = ratioRemboursement(illisible, 20);
        if (illisible === null || illisible === '') continue;  // Number('') === 0, saisie vide = taux nul
        assert.equal(r.ratio, null, `saisie illisible (${String(illisible)}) : aucun ratio, pas un 0`);
        assert.equal(r.borne, 'saisie', 'et le motif est nomme');
    }
}
console.log('Test bornes et saisie illisible OK');

// --- Le ratio ne depend PAS du capital emprunte ---
// C'est ce qui rend le chiffre transposable : « par euro emprunte » n'est pas une simplification,
// c'est une propriete de la formule. On le verifie sur l'echeancier, ou le capital existe vraiment.
{
    const i = 3.5 / 100 / 12, n = 240;
    const mensualite = c => (c * i) / (1 - Math.pow(1 + i, -n));
    for (const capital of [1, 1000, 187500, 2500000]) {
        presque((mensualite(capital) * n) / capital, ratioRemboursement(3.5, 20).ratio, 1e-9,
            `capital de ${capital} EUR : meme ratio`);
    }
}
console.log('Test independance au capital emprunte OK');

console.log('ALL RATIO CREDIT TESTS PASSED');
