// Tests du module corps-etat.js (factures décortiquées par corps d'état, 2026-10-27).
import assert from 'node:assert/strict';
import {
    CORPS_ETAT, libelleCorpsEtat, normaliserCorpsEtat, nettoyerArticles, fusionnerReclassements,
    corpsEtatLibres, travauxADecortiquer, regrouperParCorpsEtat, reclasserArticle, MAX_ARTICLES
} from '../corps-etat.js';

let ok = 0;
const test = (nom, fn) => { fn(); ok++; console.log(`  ✓ ${nom}`); };

console.log('corps-etat.js');

test('liste fixe : 12 corps d\'état, clés uniques, libellés', () => {
    assert.equal(CORPS_ETAT.length, 12);
    assert.equal(new Set(CORPS_ETAT.map(c => c.cle)).size, 12);
    assert.equal(libelleCorpsEtat('electricite'), 'Électricité');
    assert.equal(libelleCorpsEtat('Piscine'), 'Piscine');
    assert.equal(libelleCorpsEtat(''), 'Divers');
});

test('normalisation : clé, libellé, premier terme, accents et casse', () => {
    assert.equal(normaliserCorpsEtat('electricite'), 'electricite');
    assert.equal(normaliserCorpsEtat('ÉLECTRICITÉ'), 'electricite');
    assert.equal(normaliserCorpsEtat('Plomberie'), 'plomberie');
    assert.equal(normaliserCorpsEtat('plomberie / sanitaires'), 'plomberie');
    assert.equal(normaliserCorpsEtat('Sols'), 'sols');
    assert.equal(normaliserCorpsEtat('maconnerie'), 'maconnerie');
    assert.equal(normaliserCorpsEtat(''), 'divers');
    assert.equal(normaliserCorpsEtat(null), 'divers');
});

test('normalisation : libellé libre propre, rabattu sur un libre existant', () => {
    assert.equal(normaliserCorpsEtat('  piscine  '), 'Piscine');
    assert.equal(normaliserCorpsEtat('PISCINE', ['Piscine']), 'Piscine');
    assert.equal(normaliserCorpsEtat('x'.repeat(80)).length, 40);
});

test('nettoyage des articles bruts de l\'IA', () => {
    const out = nettoyerArticles([
        { designation: ' Gaine  ICTA Ø20 ', quantite: 2, prixUnitaire: 38, total: 76, corpsEtat: 'electricite', mainOeuvre: false },
        { designation: 'Fil 2,5', quantite: '3', prixUnitaire: '64,5', corpsEtat: 'Électricité' },  // total déduit
        { designation: 'Pose des prises', total: 240, corpsEtat: 'electricite', mainOeuvre: true },
        { designation: 'Remise', total: -50, corpsEtat: 'divers' },
        { designation: '', total: 10 },                       // sans désignation
        { designation: 'Sans total' },                        // sans total exploitable
        { designation: 'Liner', total: 900, corpsEtat: 'piscine' },
        { designation: 'Skimmer', total: 120, corpsEtat: 'Piscine' },
        null,
    ]);
    assert.equal(out.length, 6);
    assert.deepEqual(out[0], { d: 'Gaine ICTA Ø20', q: 2, pu: 38, t: 76, ce: 'electricite', mo: false, ceManuel: false });
    assert.equal(out[1].t, 193.5);
    assert.equal(out[1].ce, 'electricite');
    assert.equal(out[2].mo, true);
    assert.equal(out[2].q, null);
    assert.equal(out[3].t, -50);
    assert.equal(out[4].ce, 'Piscine');
    assert.equal(out[5].ce, 'Piscine', 'deux propositions libres identiques → un seul groupe');
    assert.deepEqual(nettoyerArticles('pas un tableau'), []);
});

test('nettoyage : plafond du nombre d\'articles', () => {
    const brut = Array.from({ length: MAX_ARTICLES + 20 }, (_, i) => ({ designation: `A${i}`, total: 1 }));
    assert.equal(nettoyerArticles(brut).length, MAX_ARTICLES);
});

test('ré-analyse : les reclassements manuels sont conservés', () => {
    const anciens = [
        { d: 'Gaine ICTA', t: 76, ce: 'plomberie', ceManuel: true },
        { d: 'Fil', t: 190, ce: 'electricite', ceManuel: false },
    ];
    const nouveaux = [
        { d: 'GAINE ICTA', t: 76, ce: 'electricite', ceManuel: false },
        { d: 'Fil', t: 190, ce: 'divers', ceManuel: false },
        { d: 'Autre', t: 10, ce: 'divers', ceManuel: false },
    ];
    const f = fusionnerReclassements(anciens, nouveaux);
    assert.equal(f[0].ce, 'plomberie');
    assert.equal(f[0].ceManuel, true);
    assert.equal(f[1].ce, 'divers', 'pas de correction manuelle → résultat de l\'IA');
    assert.equal(f[2].ce, 'divers');
    assert.equal(fusionnerReclassements(null, nouveaux), nouveaux);
});

test('libellés libres présents sur le bien', () => {
    const travaux = [
        { detail: { articles: [{ ce: 'Piscine' }, { ce: 'electricite' }] } },
        { detail: { articles: [{ ce: 'Domotique' }, { ce: 'Piscine' }] } },
        {},
    ];
    assert.deepEqual(corpsEtatLibres(travaux), ['Domotique', 'Piscine']);
});

const ok1 = (articles, statut = 'ok') => ({ statut, analyseLe: '2026-10-27', pages: 1, articles });

test('frais à décortiquer : un par justificatif, jamais ceux déjà analysés', () => {
    const travaux = [
        { id: 'a', pdfFilename: 'f1.pdf' },
        { id: 'b', pdfFilename: 'f1.pdf' },                           // même justificatif que a
        { id: 'c', pdfFilename: 'f2.pdf', detail: ok1([]) },          // déjà analysé
        { id: 'd', pdfFilename: 'f3.pdf', detail: { statut: 'echec', articles: [] } },
        { id: 'e', pdfFilename: null },
        { id: 'f', pdfFilename: 'f4.pdf', detail: ok1([], 'partiel') },
    ];
    assert.deepEqual(travauxADecortiquer(travaux).map(t => t.id), ['a', 'd']);
});

test('regroupement : groupes triés, écart, non détaillé, total = total des frais', () => {
    const travaux = [
        { id: 't1', date: '2026-03-12', description: 'Leroy Merlin', montant: 1344, pdfFilename: 'f1.pdf', detail: ok1([
            { d: 'Gaine', q: 2, pu: 38, t: 76, ce: 'electricite', mo: false },
            { d: 'Mitigeur', q: 1, pu: 138, t: 138, ce: 'plomberie', mo: false },
            { d: 'Pose', q: null, pu: null, t: 906, ce: 'electricite', mo: true },
        ]) },                                                          // 1120 d'articles → écart 224
        { id: 't2', date: '2026-04-02', description: 'Brico', montant: 54, pdfFilename: 'f2.png', detail: ok1([
            { d: 'Tube PER', q: 1, pu: 54, t: 54, ce: 'plomberie', mo: false },
        ]) },
        { id: 't3', date: '2026-05-01', description: 'Canapé', montant: 450, pdfFilename: null },
        { id: 't4', date: '2026-05-02', description: 'Peintre', montant: 300, pdfFilename: 'f4.pdf' },
        { id: 't5', date: '2026-05-03', description: 'Illisible', montant: 80, pdfFilename: 'f5.pdf', detail: { statut: 'echec', raison: 'Facture illisible', articles: [] } },
    ];
    const v = regrouperParCorpsEtat(travaux);
    assert.deepEqual(v.groupes.map(g => [g.ce, g.total, g.nbArticles]), [['electricite', 982, 2], ['plomberie', 192, 2]]);
    assert.equal(v.groupes[0].libelle, 'Électricité');
    assert.equal(v.groupes[1].lignes[0].facture.travailId, 't1', 'lignes triées par date de facture');
    assert.equal(v.groupes[1].lignes[1].index, 0);
    assert.deepEqual(v.ecarts.lignes.map(e => [e.facture.travailId, e.montant]), [['t1', 224]]);
    assert.equal(v.ecarts.total, 224);
    assert.deepEqual(v.nonDetaille.lignes.map(l => [l.travailId, l.raison]), [['t3', 'sans-justificatif'], ['t4', 'a-decortiquer'], ['t5', 'echec']]);
    assert.equal(v.nonDetaille.lignes[2].detailRaison, 'Facture illisible');
    assert.equal(v.total, 2228);
    const somme = v.groupes.reduce((s, g) => s + g.total, 0) + v.ecarts.total + v.nonDetaille.total;
    assert.equal(Math.round(somme * 100) / 100, v.total);
});

test('regroupement : écart négatif, écart d\'arrondi ignoré, analyse partielle signalée', () => {
    const v = regrouperParCorpsEtat([
        { id: 'a', date: '2026-01-01', montant: 100, pdfFilename: 'a.pdf', detail: ok1([{ d: 'X', t: 120, ce: 'divers' }]) },
        { id: 'b', date: '2026-01-02', montant: 50, pdfFilename: 'b.pdf', detail: ok1([{ d: 'Y', t: 49.6, ce: 'divers' }]) },
        { id: 'c', date: '2026-01-03', montant: 500, pdfFilename: 'c.pdf', detail: ok1([{ d: 'Z', t: 200, ce: 'divers' }], 'partiel') },
    ]);
    assert.deepEqual(v.ecarts.lignes.map(e => [e.facture.travailId, e.montant, e.partiel]), [['a', -20, false], ['c', 300, true]]);
});

test('regroupement : justificatif partagé décortiqué une fois, écart sur la somme des frais', () => {
    const v = regrouperParCorpsEtat([
        { id: 'acompte', date: '2026-02-01', montant: 300, pdfFilename: 'f.pdf', detail: ok1([{ d: 'Cuisine', t: 1000, ce: 'cuisine' }]) },
        { id: 'solde', date: '2026-03-01', montant: 700, pdfFilename: 'f.pdf' },
    ]);
    assert.equal(v.groupes.length, 1);
    assert.equal(v.groupes[0].total, 1000, 'articles comptés une seule fois');
    assert.equal(v.ecarts.lignes.length, 0);
    assert.equal(v.nonDetaille.lignes.length, 0);
});

test('regroupement : analyse en cours et analyse sans article', () => {
    const v = regrouperParCorpsEtat([
        { id: 'a', montant: 10, pdfFilename: 'a.pdf' },
        { id: 'b', montant: 20, pdfFilename: 'b.pdf', detail: ok1([]) },
    ], { enCours: new Set(['a']) });
    assert.deepEqual(v.nonDetaille.lignes.map(l => l.raison), ['en-cours', 'aucun-article']);
    assert.deepEqual(regrouperParCorpsEtat(undefined).groupes, []);
});

test('reclassement manuel d\'un article', () => {
    const d = ok1([{ d: 'Gaine', t: 76, ce: 'electricite', ceManuel: false }, { d: 'Tube', t: 10, ce: 'plomberie', ceManuel: false }]);
    const r = reclasserArticle(d, 0, 'Plomberie');
    assert.equal(r.articles[0].ce, 'plomberie');
    assert.equal(r.articles[0].ceManuel, true);
    assert.equal(d.articles[0].ce, 'electricite', 'pas de mutation de l\'original');
    assert.equal(reclasserArticle(d, 9, 'divers'), d);
    assert.equal(reclasserArticle(d, 1, 'piscine', ['Piscine']).articles[1].ce, 'Piscine');
});

console.log(`OK — ${ok} tests`);
