// Test de icones.js (audit A7) : chaque icône produit un SVG valide, décoratif, sur la grille de 16 px,
// et aucune icône n'utilise une couleur en dur.
import assert from 'node:assert/strict';
import { icone, NOMS_ICONES } from '../icones.js';

assert.ok(NOMS_ICONES.length >= 25, 'au moins 25 icônes');
let n = 0;
for (const nom of NOMS_ICONES) {
    const svg = icone(nom);
    assert.match(svg, /^<svg class="icone icone--[a-z-]+" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1\.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">/, nom);
    assert.ok(svg.endsWith('</svg>'), nom);
    assert.ok(!/#[0-9a-f]{3,6}\b|rgb\(/i.test(svg), `${nom} : couleur en dur`);
    // balises équilibrées et attributs de chemin non vides
    assert.equal((svg.match(/<svg/g) || []).length, 1, nom);
    for (const d of svg.matchAll(/ d="([^"]*)"/g)) assert.match(d[1], /^[MmLlHhVvCcSsQqTtAaZz0-9 .,\-]+$/, `${nom} : chemin invalide`);
    n++;
}
console.log(`Test 1 OK — ${n} icônes valides (SVG 16 px, trait 1,5, currentColor, décoratives)`);

assert.throws(() => icone('inexistante'), /Icône inconnue/);
console.log('Test 2 OK — nom inconnu : erreur explicite (pas d\'icône vide silencieuse)');

assert.match(icone('croix', { classe: 'x' }), /class="icone icone--croix x"/);
console.log('Test 3 OK — classe supplémentaire');

// Les icônes utilisées par l'application sont toutes déclarées (l'usage est contrôlé par le scénario A7 Playwright).
for (const requise of ['croix', 'coche', 'alerte', 'etincelle', 'document', 'maison', 'fleche-gauche', 'fleche-droite', 'fleche-haut', 'fleche-bas', 'chevron-droit', 'soleil', 'lune']) {
    assert.ok(NOMS_ICONES.includes(requise), requise);
}
console.log('Test 4 OK — jeu minimal présent');
console.log('\nTous les tests des icônes passent.');
