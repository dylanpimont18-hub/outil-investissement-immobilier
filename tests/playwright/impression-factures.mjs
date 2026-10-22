// Test navigateur de l'impression groupée des factures (2026-10-22) : modale « Imprimer les factures »
// (onglet Frais d'un bien, bouton « Factures » du dashboard, page iPhone) → un PDF unique
// récapitulatif + justificatifs, téléchargé puis relu avec pdf-lib.
// Prérequis : `npm run serve` (port 8090), `npm install`, `npx playwright install chromium`.
// Lancer : SPARK_TEST_BASE=http://127.0.0.1:8090 node tests/playwright/impression-factures.mjs
// PF_SCREENSHOTS=<dir> enregistre des captures PNG. Hors `npm test` volontairement.
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { assert, openPage, waitAppStarted, step, getFailures, ASSET_TEST_1, META_TEST, OWNED_CLOUD_STUB_SOURCE } from './_harness.mjs';

const SHOTS = process.env.PF_SCREENSHOTS || '';
const shot = (page, name, opts = {}) => SHOTS ? page.screenshot({ path: `${SHOTS}/${name}.png`, ...opts }) : Promise.resolve();

const asset1 = JSON.parse(JSON.stringify(ASSET_TEST_1));
asset1.postAchat.travaux = [
    { id: 't-1', date: '2026-08-28', description: 'Parquet chambre', montant: 890, tag: 'deductible', commentaire: '', pdfFilename: 'facture-2p.pdf' },
    { id: 't-2', date: '2026-01-15', description: 'Taxe foncière 2026', montant: 812.5, tag: 'taxe-fonciere', commentaire: '', pdfFilename: 'photo.png' },
    { id: 't-3', date: '2026-04-02', description: 'Canapé', montant: 450, tag: 'non-deductible', commentaire: '', pdfFilename: null },
    { id: 't-4', date: '2025-06-10', description: 'Peinture salon', montant: 1200, tag: 'deductible', commentaire: '', pdfFilename: 'facture-1p.pdf' },
];
const asset2 = JSON.parse(JSON.stringify(ASSET_TEST_1));
Object.assign(asset2, { id: 'oa-test-2', nom: 'Avenue Foch' });
asset2.postAchat.travaux = [
    { id: 't-5', date: '2026-02-10', description: 'Frais de courtage', montant: 1250, tag: 'frais-emprunt', commentaire: '', pdfFilename: 'facture-1p.pdf' },
];
const SEED = { assets: { 'oa-test-1': asset1, 'oa-test-2': asset2 }, meta: { ...META_TEST, order: ['oa-test-1', 'oa-test-2'] } };

// Justificatifs servis par une route de test : PDF de 1 et 2 pages, PNG.
const pdfDePages = async n => { const d = await PDFDocument.create(); for (let i = 0; i < n; i++) d.addPage([300, 400]); return Buffer.from(await d.save()); };
const FICHIERS = {
    'facture-1p.pdf': { body: await pdfDePages(1), contentType: 'application/pdf' },
    'facture-2p.pdf': { body: await pdfDePages(2), contentType: 'application/pdf' },
    'photo.png': { body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC', 'base64'), contentType: 'image/png' },
};
const STUB = OWNED_CLOUD_STUB_SOURCE.replace(
    /export function cloudDocumentUrl\(\) \{[^\n]*\n/,
    `export function cloudDocumentUrl(assetId, f) { S.docUrls = (S.docUrls || 0) + 1; return Promise.resolve(location.origin + '/__docs/' + assetId + '/' + f); }\n`
);
assert.notEqual(STUB, OWNED_CLOUD_STUB_SOURCE, 'stub cloudDocumentUrl remplacé');
const ROUTES = [
    ['**/owned-cloud.js', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB })],
    ['**/__docs/**', route => { const f = FICHIERS[route.request().url().split('/').pop()]; return route.fulfill({ status: 200, ...f }); }],
];

async function telecharger(page, declencheur) {
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), declencheur()]);
    const bytes = await readFile(await download.path());
    return { nom: download.suggestedFilename(), doc: await PDFDocument.load(bytes) };
}

const lignes = page => page.$$eval('#owned-print-factures-modal .owned-pf-row', rows => rows.map(r => r.querySelector('.owned-pf-row__desc').firstChild.textContent.trim()));

async function ouvrirFrais(page) {
    await page.click('.workspace-tab[data-target="collection-panel"]').catch(() => {});
    await page.locator('[data-open-asset="oa-test-1"], [data-asset-id="oa-test-1"]').first().click();
    await page.waitForSelector('#owned-detail-view:not([hidden])');
    await page.click('#owned-detail-view .owned-tab[data-tab="travaux"]');
    await page.waitForSelector('[data-action="print-factures"]');
}

async function scenarioPC(browser) {
    console.log('\nPC — impression groupée des factures');
    const { page, errors } = await openPage(browser, '/index.html', { viewport: { width: 1366, height: 900 }, seedCloud: SEED, routes: ROUTES });
    await waitAppStarted(page);
    await ouvrirFrais(page);

    await step('onglet Frais : plus de cases à cocher par ligne, bouton « Imprimer les factures » actif', async () => {
        assert.equal(await page.$$eval('#owned-travaux-content .owned-travaux-select', c => c.length), 0);
        assert.equal(await page.isEnabled('[data-action="print-factures"]'), true);
    });

    await step('modale : bien courant + année en cours présélectionnés, tout coché, tri chronologique', async () => {
        await page.click('[data-action="print-factures"]');
        await page.waitForSelector('#owned-print-factures-modal:not([hidden])');
        assert.equal(await page.inputValue('[data-pf="asset"]'), 'oa-test-1');
        assert.equal(await page.inputValue('[data-pf="annee"]'), String(new Date().getFullYear()));
        assert.deepEqual(await lignes(page), ['Taxe foncière 2026', 'Canapé', 'Parquet chambre']);
        assert.equal(await page.isChecked('[data-pf-all]'), true);
        assert.equal(await page.textContent('[data-pf-summary]'), '3 frais · 2 152,50 € · 2 justificatifs');
        await shot(page, 'pf-modale-pc');
    });

    await step('filtres : toutes les années puis déductibles uniquement ; décocher une ligne', async () => {
        await page.selectOption('[data-pf="annee"]', 'toutes');
        assert.equal((await lignes(page)).length, 4);
        await page.selectOption('[data-pf="nature"]', 'deductibles');
        assert.deepEqual(await lignes(page), ['Peinture salon', 'Taxe foncière 2026', 'Parquet chambre']);
        await page.uncheck('[data-pf-item="t-4"]');
        assert.equal(await page.textContent('[data-pf-summary]'), '2 frais · 1 702,50 € · 2 justificatifs');
        assert.equal(await page.$eval('[data-pf-all]', c => c.indeterminate), true);
        await page.selectOption('[data-pf="nature"]', 'toutes');
        assert.equal(await page.isChecked('[data-pf-item="t-4"]'), false, 'décochage conservé au changement de filtre');
        await page.selectOption('[data-pf="annee"]', '2026');
    });

    await step('« Générer le PDF » : récap 1 page + PNG 1 page + PDF 2 pages, nom de fichier', async () => {
        const { nom, doc } = await telecharger(page, () => page.click('[data-pf-generate]'));
        assert.equal(nom, 'Factures_2026_Rue-des-Lilas.pdf');
        assert.equal(doc.getPageCount(), 1 + 1 + 2);
        assert.equal(doc.getTitle(), 'Factures et justificatifs');
        await page.waitForSelector('#owned-print-factures-modal', { state: 'hidden' });
    });

    await step('dashboard : bouton « Factures » → tous les biens', async () => {
        await page.click('.workspace-tab[data-target="collection-panel"]').catch(() => {});
        await page.click('#owned-back-btn, [data-action="owned-back"]').catch(() => {});
        await page.waitForSelector('[data-action="open-factures"]', { timeout: 5000 });
        await page.click('[data-action="open-factures"]');
        await page.waitForSelector('#owned-print-factures-modal:not([hidden])');
        assert.equal(await page.inputValue('[data-pf="asset"]'), 'tous');
        assert.deepEqual(await lignes(page), ['Taxe foncière 2026', 'Frais de courtage', 'Canapé', 'Parquet chambre']);
        assert.ok((await page.textContent('#owned-print-factures-modal .owned-pf-row:nth-child(2)')).includes('Avenue Foch'), 'nom du bien affiché');
        const { nom, doc } = await telecharger(page, () => page.click('[data-pf-generate]'));
        assert.equal(nom, 'Factures_2026_tous-les-biens.pdf');
        assert.equal(doc.getPageCount(), 1 + 1 + 1 + 2);
    });

    await step('aucune erreur JS, aucun accès storage', async () => {
        assert.deepEqual(errors, []);
        assert.deepEqual(await page.evaluate(() => window.__storageHits), []);
    });
    await page.context().close();
}

async function scenarioIphone(browser) {
    console.log('\niPhone (owned.html) — impression groupée des factures');
    const { page, errors } = await openPage(browser, '/owned.html', {
        viewport: { width: 393, height: 852 }, seedCloud: SEED, routes: ROUTES, contextOptions: { hasTouch: true, isMobile: true },
    });
    await page.waitForSelector('#owned-quickfab:not([hidden])'); // owned.html n'a pas #app-cloud-loading
    await ouvrirFrais(page);

    await step('modale lisible à 393 px (pas de défilement horizontal) et PDF généré', async () => {
        await page.click('[data-action="print-factures"]');
        await page.waitForSelector('#owned-print-factures-modal:not([hidden])');
        await shot(page, 'pf-modale-iphone');
        const deborde = await page.$eval('#owned-print-factures-modal .owned-modal', m => m.scrollWidth > m.clientWidth + 1);
        assert.equal(deborde, false);
        const { doc } = await telecharger(page, () => page.click('[data-pf-generate]'));
        assert.equal(doc.getPageCount(), 4);
    });

    await step('ligne de frais sans case à cocher : grille mobile intacte', async () => {
        await shot(page, 'pf-travaux-iphone', { fullPage: true });
        const largeurs = await page.$$eval('#owned-travaux-content .owned-travaux-row', rows => rows.map(r => r.scrollWidth <= r.clientWidth + 1));
        assert.ok(largeurs.length > 0 && largeurs.every(Boolean));
        assert.deepEqual(errors, []);
    });
    await page.context().close();
}

const browser = await chromium.launch();
try {
    await scenarioPC(browser);
    await scenarioIphone(browser);
} finally {
    await browser.close();
}
const failures = getFailures();
console.log(failures ? `\n${failures} échec(s)` : '\nTous les scénarios passent');
process.exit(failures ? 1 : 0);
