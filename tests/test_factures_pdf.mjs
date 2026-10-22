// Tests du module factures-pdf.js (impression groupée des factures, 2026-10-22).
import assert from 'node:assert/strict';
import * as PDFLib from 'pdf-lib';
import {
    anneesDisponibles, selectionnerFrais, buildRecapFactures, formatEuros, formatDateFr,
    nomFichierFactures, detecterTypeFichier, genererPdfFactures
} from '../factures-pdf.js';

const { PDFDocument } = PDFLib;
let ok = 0;
const test = async (nom, fn) => { await fn(); ok++; console.log(`  ✓ ${nom}`); };

const ASSETS = [
    { id: 'a1', nom: 'Rue des Lilas', postAchat: { travaux: [
        { id: 't1', date: '2026-03-10', description: 'Parquet', montant: 890, tag: 'deductible', pdfFilename: 'f1.pdf' },
        { id: 't2', date: '2026-01-05', description: 'Taxe foncière', montant: 812.5, tag: 'taxe-fonciere', pdfFilename: 'f2.png' },
        { id: 't3', date: '2025-11-02', description: 'Canapé', montant: 450, tag: 'non-deductible', pdfFilename: null },
        { id: 't4', date: '', description: 'Sans date', montant: 10, tag: 'a-classifier' },
    ] } },
    { id: 'a2', nom: 'Avenue Foch', postAchat: { travaux: [
        { id: 't5', date: '2026-02-01', description: 'Courtage', montant: 1250, tag: 'frais-emprunt', pdfFilename: 'f5.jpg' },
    ] } },
    { id: 'a3', nom: 'Vide', postAchat: {} },
];

console.log('factures-pdf.js');

await test('années disponibles, par bien et pour tous', () => {
    assert.deepEqual(anneesDisponibles(ASSETS), [2026, 2025]);
    assert.deepEqual(anneesDisponibles(ASSETS, 'a2'), [2026]);
    assert.deepEqual(anneesDisponibles(ASSETS, 'a3'), []);
});

await test('sélection : année, bien, nature, tri chronologique', () => {
    const tout2026 = selectionnerFrais(ASSETS, { annee: 2026 });
    assert.deepEqual(tout2026.map(i => i.travail.id), ['t2', 't5', 't1']);
    assert.deepEqual(selectionnerFrais(ASSETS, { assetId: 'a1', annee: '2026' }).map(i => i.travail.id), ['t2', 't1']);
    assert.deepEqual(selectionnerFrais(ASSETS, { nature: 'deductibles' }).map(i => i.travail.id), ['t2', 't5', 't1']);
    assert.deepEqual(selectionnerFrais(ASSETS, { nature: 'non-deductible' }).map(i => i.travail.id), ['t3']);
    const toutes = selectionnerFrais(ASSETS);
    assert.equal(toutes.at(-1).travail.id, 't4', 'frais sans date en dernier');
    assert.equal(toutes[0].assetNom, 'Rue des Lilas');
});

await test('récapitulatif : totaux, déductible, justificatifs, par nature et par bien', () => {
    const r = buildRecapFactures(selectionnerFrais(ASSETS, { annee: 2026 }));
    assert.equal(r.nombre, 3);
    assert.equal(r.total, 2952.5);
    assert.equal(r.totalDeductible, 2952.5);
    assert.equal(r.avecJustificatif, 3);
    assert.deepEqual(r.parBien.map(b => [b.libelle, b.total]), [['Avenue Foch', 1250], ['Rue des Lilas', 1702.5]].sort((a, b) => b[1] - a[1]));
    assert.equal(r.parNature.length, 3);
});

await test('formats : euros, dates, nom de fichier', () => {
    assert.equal(formatEuros(1234567), '1 234 567 €');
    assert.equal(formatEuros(812.5), '812,50 €');
    assert.equal(formatEuros(-12.5), '-12,50 €');
    assert.equal(formatDateFr('2026-03-10'), '10/03/2026');
    assert.equal(formatDateFr(''), 'Sans date');
    assert.equal(nomFichierFactures({ annee: 2026, bienNom: 'Rue des Lilas — T2' }), 'Factures_2026_Rue-des-Lilas-T2.pdf');
    assert.equal(nomFichierFactures({}), 'Factures_toutes-annees_tous-les-biens.pdf');
});

// Fichiers de test : PDF de 2 pages, PNG et JPEG valides.
const pdf2 = await PDFDocument.create();
pdf2.addPage([300, 400]); pdf2.addPage([300, 400]);
const PDF_BYTES = await pdf2.save();
const PNG_BYTES = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC', 'base64');
const JPG_BYTES = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDWooorxzvP/9k=', 'base64');

await test('détection du type par les octets', () => {
    assert.equal(detecterTypeFichier(PDF_BYTES), 'pdf');
    assert.equal(detecterTypeFichier(new Uint8Array(PNG_BYTES)), 'png');
    assert.equal(detecterTypeFichier(new Uint8Array(JPG_BYTES)), 'jpg');
    assert.equal(detecterTypeFichier(new Uint8Array([1, 2, 3])), null);
});

await test('PDF assemblé : récap + pages des justificatifs, frais sans justificatif ignorés', async () => {
    const items = selectionnerFrais(ASSETS); // t3 (sans justificatif), t2 png, t5 jpg, t1 pdf 2 p., t4 sans
    const fichiers = { 'f1.pdf': PDF_BYTES, 'f2.png': PNG_BYTES, 'f5.jpg': JPG_BYTES };
    const progres = [];
    const res = await genererPdfFactures({
        PDFLib, items, entete: ['Biens : tous', 'Période : toutes les années'],
        chargerJustificatif: async item => fichiers[item.travail.pdfFilename],
        onProgress: (n, N) => progres.push(`${n}/${N}`),
    });
    assert.equal(res.pagesRecap, 1);
    assert.equal(res.pages, 1 + 1 + 1 + 2, 'récap + png + jpg + pdf de 2 pages');
    assert.deepEqual(res.echecs, []);
    assert.deepEqual(progres.at(-1), '3/3');
    const relu = await PDFDocument.load(res.bytes);
    assert.equal(relu.getPageCount(), 5);
    assert.equal(relu.getTitle(), 'Factures et justificatifs');
});

await test('justificatif introuvable : page d\'avertissement, nombre de pages cohérent', async () => {
    const items = selectionnerFrais(ASSETS, { annee: 2026 });
    const res = await genererPdfFactures({
        PDFLib, items,
        chargerJustificatif: async item => { if (item.travail.id === 't5') throw new Error('404'); return item.travail.id === 't1' ? PDF_BYTES : PNG_BYTES; },
    });
    assert.equal(res.pages, 1 + 1 + 1 + 2);
    assert.equal(res.echecs.length, 1);
    assert.equal(res.echecs[0].numero, 2);
});

await test('récapitulatif sur plusieurs pages (beaucoup de frais, caractères hors Helvetica)', async () => {
    const travaux = Array.from({ length: 120 }, (_, i) => ({ id: 'x' + i, date: '2026-05-01', description: `Frais n°${i} ✓ 🔧 avec une description très longue qui doit être tronquée proprement dans la colonne`, montant: 10 + i, tag: 'deductible', pdfFilename: null }));
    const items = selectionnerFrais([{ id: 'b', nom: 'Bien spécial', postAchat: { travaux } }]);
    const res = await genererPdfFactures({ PDFLib, items, chargerJustificatif: async () => null });
    assert.ok(res.pagesRecap >= 3, `récap paginé (${res.pagesRecap} pages)`);
    assert.equal(res.pages, res.pagesRecap);
});

console.log(`\n${ok} tests OK`);
