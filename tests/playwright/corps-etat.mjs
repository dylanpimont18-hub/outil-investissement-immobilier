// Test navigateur des factures décortiquées par corps d'état (2026-10-27) : sous-vue « Par corps
// d'état » de l'onglet Travaux (PC et iPhone), filtres, reclassement, bouton « Décortiquer les
// factures » (PDF de 3 pages → 3 images envoyées), décorticage automatique d'un frais ajouté,
// plafond IA atteint.
// Prérequis : `npm run serve` (port 8090), `npm install`, `npx playwright install chromium`.
// Lancer : SPARK_TEST_BASE=http://127.0.0.1:8090 node tests/playwright/corps-etat.mjs
// CE_SCREENSHOTS=<dir> enregistre des captures PNG. Hors `npm test` volontairement.
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';
import { assert, openPage, waitAppStarted, step, getFailures, ASSET_TEST_1, META_TEST, OWNED_CLOUD_STUB_SOURCE } from './_harness.mjs';

const SHOTS = process.env.CE_SCREENSHOTS || '';
const shot = (page, name, opts = {}) => SHOTS ? page.screenshot({ path: `${SHOTS}/${name}.png`, ...opts }) : Promise.resolve();

const asset = JSON.parse(JSON.stringify(ASSET_TEST_1));
asset.postAchat.travaux = [
    { id: 't-1', date: '2026-03-12', description: 'Leroy Merlin', montant: 1344, tag: 'deductible', commentaire: '', pdfFilename: 'facture-1p.pdf',
        detail: { statut: 'ok', analyseLe: '2026-10-27', pages: 1, articles: [
            { d: 'Gaine ICTA Ø20', q: 2, pu: 38, t: 76, ce: 'electricite', mo: false, ceManuel: false },
            { d: 'Mitigeur lavabo', q: 1, pu: 138, t: 138, ce: 'plomberie', mo: false, ceManuel: false },
            { d: 'Pose des prises', q: null, pu: null, t: 906, ce: 'electricite', mo: true, ceManuel: false },
        ] } },
    { id: 't-2', date: '2026-04-02', description: 'Peintre', montant: 500, tag: 'deductible', commentaire: '', pdfFilename: 'facture-3p.pdf' },
    { id: 't-3', date: '2026-05-01', description: 'Canapé', montant: 450, tag: 'non-deductible', commentaire: '', pdfFilename: null },
    { id: 't-4', date: '2026-05-03', description: 'Ticket illisible', montant: 80, tag: 'deductible', commentaire: '', pdfFilename: 'photo.png',
        detail: { statut: 'echec', analyseLe: '2026-10-27', pages: 0, raison: 'justificatif illisible', articles: [] } },
];
const DECORTICAGE = { articles: [
    { designation: 'Peinture blanche 10 L', quantite: 2, prixUnitaire: 60, total: 120, corpsEtat: 'peinture', mainOeuvre: false },
    { designation: 'Liner', quantite: 1, prixUnitaire: 380, total: 380, corpsEtat: 'piscine', mainOeuvre: false },
] };
const SEED = { assets: { 'oa-test-1': asset }, meta: META_TEST, decorticage: DECORTICAGE };

const pdfDePages = async n => { const d = await PDFDocument.create(); for (let i = 0; i < n; i++) d.addPage([300, 400]); return Buffer.from(await d.save()); };
const PNG = { body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC', 'base64'), contentType: 'image/png' };
const FICHIERS = {
    'facture-1p.pdf': { body: await pdfDePages(1), contentType: 'application/pdf' },
    'facture-3p.pdf': { body: await pdfDePages(3), contentType: 'application/pdf' },
};
const STUB = OWNED_CLOUD_STUB_SOURCE.replace(
    /export function cloudDocumentUrl\(\) \{[^\n]*\n/,
    `export function cloudDocumentUrl(assetId, f) { return Promise.resolve(location.origin + '/__docs/' + assetId + '/' + f); }\n`
);
assert.notEqual(STUB, OWNED_CLOUD_STUB_SOURCE, 'stub cloudDocumentUrl remplacé');
const ROUTES = [
    ['**/owned-cloud.js', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB })],
    // Fichiers inconnus (téléversés pendant le test) : servis comme une image PNG.
    ['**/__docs/**', route => route.fulfill({ status: 200, ...(FICHIERS[route.request().url().split('/').pop()] || PNG) })],
];

async function ouvrirTravaux(page) {
    await page.click('.workspace-tab[data-target="collection-panel"]').catch(() => {});
    await page.locator('[data-open-asset="oa-test-1"], [data-asset-id="oa-test-1"]').first().click();
    await page.waitForSelector('#owned-detail-view:not([hidden])');
    await page.click('#owned-detail-view .owned-tab[data-tab="travaux"]');
    await page.waitForSelector('[data-travaux-vue-btn="corps"]');
}

const groupes = page => page.$$eval('[data-ce-root] .owned-ce__group:not([hidden])', gs => gs.map(g => [
    g.querySelector('.owned-ce__head-nom').textContent.trim(),
    g.querySelector('.owned-ce__head strong').textContent.trim(),
]));
const detailStub = (page, id) => page.evaluate(id => window.__stub.assets['oa-test-1'].postAchat.travaux.find(t => t.id === id)?.detail || null, id);

async function scenarioPC(browser) {
    console.log('\nPC — vue par corps d\'état');
    const { page, errors } = await openPage(browser, '/index.html', { viewport: { width: 1366, height: 900 }, seedCloud: SEED, routes: ROUTES });
    await waitAppStarted(page);
    await ouvrirTravaux(page);

    await step('rien n\'est analysé au chargement ; liste des frais affichée par défaut', async () => {
        assert.deepEqual(await page.evaluate(() => window.__stub.decorticages), []);
        assert.equal(await page.isVisible('[data-travaux-liste]'), true);
        assert.equal(await page.isVisible('[data-ce-root]'), false);
    });

    await step('bascule « Par corps d\'état » : groupes triés, écart, non détaillé, total', async () => {
        await page.click('[data-travaux-vue-btn="corps"]');
        await page.waitForSelector('[data-ce-root] .owned-ce');
        assert.equal(await page.isVisible('[data-travaux-liste]'), false);
        assert.deepEqual(await groupes(page), [
            ['Électricité', '982 €'], ['Plomberie / sanitaires', '138 €'],
            ['Écart (TVA / remise)', '224 €'], ['Non détaillé', '1 030 €'],
        ]);
        assert.match(await page.textContent('.owned-ce__total'), /2 374 €/);
        const nonDetaille = await page.$$eval('[data-ce-group="__non-detaille"] .owned-ce__row .owned-ce__d', r => r.map(x => x.textContent.trim()));
        assert.deepEqual(nonDetaille, ['Pas encore décortiquée', 'Pas de justificatif', "Échec de l'analyse (justificatif illisible)"]);
        assert.equal(await page.textContent('[data-ce-group="electricite"] .owned-ce__mo'), 'MO');
        assert.equal(await page.textContent('[data-action="decortiquer-factures"]'), 'Décortiquer les factures (2)');
        await shot(page, 'ce-pc');
    });

    await step('pastille de filtre : un seul corps d\'état, puis « Tous »', async () => {
        await page.click('[data-ce-filtre="plomberie"]');
        assert.deepEqual(await groupes(page), [['Plomberie / sanitaires', '138 €']]);
        await page.click('[data-ce-filtre="tous"]');
        assert.equal((await groupes(page)).length, 4);
    });

    await step('reclassement manuel enregistré, totaux recalculés', async () => {
        await page.selectOption('[data-ce-reclasser][data-travail-id="t-1"][data-index="1"]', 'electricite');
        await page.waitForFunction(() => window.__stub.assets['oa-test-1'].postAchat.travaux[0].detail.articles[1].ce === 'electricite');
        const d = await detailStub(page, 't-1');
        assert.equal(d.articles[1].ceManuel, true);
        assert.deepEqual((await groupes(page)).slice(0, 2), [['Électricité', '1 120 €'], ['Écart (TVA / remise)', '224 €']]);
    });

    await step('bouton « Décortiquer les factures » : PDF de 3 pages → 3 images, détail enregistré', async () => {
        await page.click('[data-action="decortiquer-factures"]');
        await page.waitForFunction(() => window.__stub.decorticages.length === 2);
        await page.waitForFunction(() => window.__stub.assets['oa-test-1'].postAchat.travaux[1].detail?.statut === 'ok');
        const appels = await page.evaluate(() => window.__stub.decorticages);
        assert.ok(appels.some(a => a.length === 3 && a.every(m => m === 'image/jpeg')), JSON.stringify(appels));
        const d = await detailStub(page, 't-2');
        assert.deepEqual(d.articles.map(a => [a.d, a.t, a.ce]), [['Peinture blanche 10 L', 120, 'peinture'], ['Liner', 380, 'Piscine']]);
        assert.equal(d.pages, 3);
        await page.waitForSelector('[data-ce-group="Piscine"]');
        assert.equal(await page.$('[data-action="decortiquer-factures"]'), null, 'plus rien à décortiquer');
        const options = await page.$$eval('[data-ce-reclasser]:first-of-type option', o => o.map(x => x.value));
        assert.ok(options.includes('Piscine'), 'corps d\'état libre proposé dans le menu');
        await shot(page, 'ce-pc-apres');
    });

    await step('frais ajouté avec justificatif : décortiqué automatiquement', async () => {
        const avant = await page.evaluate(() => window.__stub.decorticages.length);
        await page.setInputFiles('[data-travaux-file-input]', { name: 'ticket.png', mimeType: 'image/png', buffer: PNG.body });
        await page.click('[data-travaux-vue-btn="liste"]');
        await page.fill('[data-form="add-travail-tab"] [data-field="date"]', '2026-06-01');
        await page.fill('[data-form="add-travail-tab"] [data-field="description"]', 'Brico ticket');
        await page.fill('[data-form="add-travail-tab"] [data-field="montant"]', '500');
        await page.click('[data-form="add-travail-tab"] button[type="submit"]');
        await page.waitForFunction(n => window.__stub.decorticages.length === n + 1, avant);
        await page.waitForFunction(() => window.__stub.assets['oa-test-1'].postAchat.travaux.at(-1).detail?.statut === 'ok');
    });

    await step('aucun accès localStorage/sessionStorage, aucune erreur JS', async () => {
        assert.deepEqual(await page.evaluate(() => window.__storageHits), []);
        assert.deepEqual(errors, []);
    });
    await page.context().close();
}

async function scenarioPlafond(browser) {
    console.log('\nPC — plafond IA atteint');
    const { page, errors } = await openPage(browser, '/index.html', {
        viewport: { width: 1366, height: 900 }, routes: ROUTES,
        seedCloud: { ...SEED, decorticage: { error: 'resource-exhausted' } },
    });
    await waitAppStarted(page);
    await ouvrirTravaux(page);
    await page.click('[data-travaux-vue-btn="corps"]');

    await step('message clair, rien n\'est écrit, factures toujours à décortiquer', async () => {
        await page.click('[data-action="decortiquer-factures"]');
        await page.waitForFunction(() => /limite d'analyses IA/.test(document.body.textContent));
        assert.equal(await detailStub(page, 't-2'), null);
        assert.equal((await detailStub(page, 't-4')).statut, 'echec');
        await page.waitForSelector('[data-action="decortiquer-factures"]');
        assert.deepEqual(errors, []);
    });
    await page.context().close();
}

async function scenarioIphone(browser) {
    console.log('\niPhone (owned.html) — vue par corps d\'état');
    const { page, errors } = await openPage(browser, '/owned.html', {
        viewport: { width: 393, height: 852 }, seedCloud: SEED, routes: ROUTES, contextOptions: { hasTouch: true, isMobile: true },
    });
    await page.waitForSelector('#owned-quickfab:not([hidden])');
    await ouvrirTravaux(page);

    await step('vue lisible à 393 px, reclassement possible, décorticage réservé au PC', async () => {
        await page.click('[data-travaux-vue-btn="corps"]');
        await page.waitForSelector('[data-ce-root] .owned-ce');
        await shot(page, 'ce-iphone', { fullPage: true });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'pas de défilement horizontal');
        const debordes = await page.$$eval('.owned-ce__row', rows => rows.filter(r => r.scrollWidth > r.clientWidth + 1).length);
        assert.equal(debordes, 0);
        assert.equal(await page.$('[data-action="decortiquer-factures"]'), null);
        assert.equal(await page.$('[data-ce-relancer]'), null);
        assert.ok(await page.isVisible('[data-ce-reclasser]'));
        assert.match(await page.textContent('[data-ce-group="__non-detaille"]'), /À décortiquer depuis le PC/);
        assert.deepEqual(errors, []);
    });
    await page.context().close();
}

const browser = await chromium.launch();
try {
    await scenarioPC(browser);
    await scenarioPlafond(browser);
    await scenarioIphone(browser);
} finally {
    await browser.close();
}
const n = getFailures();
console.log(n ? `\n${n} échec(s)` : '\nOK');
process.exit(n ? 1 : 0);
