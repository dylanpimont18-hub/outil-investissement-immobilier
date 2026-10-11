// Test navigateur de la migration unique localStorage/exports/documents → cloud (migration-locale.js).
// Lancer : SPARK_TEST_BASE=http://127.0.0.1:8090 node tests/playwright/migration-locale.mjs
// ML_SCREENSHOTS=<dir> enregistre des captures. Le module ne se charge que sur 127.0.0.1:8080 ou avec
// ?migration-locale=1 (ici). localStorage est pré-rempli : c'est le seul test où il est légitime.
import { chromium } from 'playwright';
import { assert, openPage, step, getFailures } from './_harness.mjs';

const SHOTS = process.env.ML_SCREENSHOTS || '';
const PC = { width: 1366, height: 900 };
const EXPORT_RAW = JSON.stringify({ 'oa-test-1': { id: 'oa-test-1', nom: 'Rue des Lilas' } }, null, 2) + '\n';
const PDF_BYTES = Buffer.from('%PDF-1.4\n%%EOF\n', 'latin1');

const LOCAL = {
    investissementWebAssetRecords: JSON.stringify([
        { id: 'asset-A', variablesData: { 'nom-bien': 'A locale (ancienne)', prix: 100000, loyer: 500 }, createdAt: 1000, updatedAt: 2000 },
        { id: 'asset-B', variablesData: { 'nom-bien': 'B locale', prix: 200000, loyer: 900 }, createdAt: 1500, updatedAt: 3000 }
    ]),
    investissementWebVariablesData: JSON.stringify({ 'nom-bien': 'En cours', prix: 123456, loyer: 650 }),
    investissementWebActiveAssetId: 'asset-B',
    investissementWebTheme: 'light', investissementWebScreens: '2', investissementWebGuidedMode: 'false',
    investissementWebOwnedCompact: '1', 'spark:factures:lastAsset': 'oa-test-1',
    investissementWebProfileData: JSON.stringify({ name: 'Local', income: 45000, adults: 2, children: 1 }),
    investissementWebProfileConfigured: '1'
};
const CLOUD_STUDY_A = { id: 'asset-A', variablesData: { 'nom-bien': 'A cloud (plus récente)', prix: 110000, loyer: 520 }, createdAt: 1000, updatedAt: 5000 };

let documentIntrouvable = false; // la route des justificatifs répond 404 tant qu'elle est vraie
let listeEnPanne = false; // bascule côté Node : la route de liste répond 500 tant qu'elle est vraie
const routes = [
    ['**/api/portfolio/import/list', r => (listeEnPanne
        ? r.fulfill({ status: 500, contentType: 'text/plain', body: 'boom' })
        : r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ files: ['portefeuille-2026-06-14.json'] }) }))],
    ['**/exports/portefeuille-2026-06-14.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: EXPORT_RAW })],
    ['**/api/documents/oa-test-1/facture-1.pdf', r => (documentIntrouvable
        ? r.fulfill({ status: 404, contentType: 'text/plain', body: 'absent' })
        : r.fulfill({ status: 200, contentType: 'application/pdf', body: PDF_BYTES }))]
];

// L'ancien stockage est pré-rempli AVANT la première navigation (initScripts du harnais) : une première
// visite à vide écrirait déjà le marqueur settings/migration et le second passage serait ignoré.
function ouvrir(browser, { seedStore, seedCloud = {} }) {
    return openPage(browser, '/index.html?migration-locale=1', {
        viewport: PC, spyStorage: false, seedStore, seedCloud, routes,
        initScripts: [[local => { for (const [k, v] of Object.entries(local)) localStorage.setItem(k, v); }, LOCAL]]
    });
}

const lireBilan = page => page.evaluate(() => ({
    texte: document.querySelector('#migration-locale-modal')?.textContent.replace(/\s+/g, ' ').trim() || '',
    visible: !!document.querySelector('#migration-locale-modal:not([hidden])'),
    retry: !!document.querySelector('#migration-locale-modal [data-migration-retry]'),
    continuer: !!document.querySelector('#migration-locale-modal [data-migration-close]')
}));

async function scenarioNominal(browser) {
    console.log('\nMigration — passage nominal');
    const { page, context, errors } = await ouvrir(browser, {
        seedStore: { studies: { 'asset-A': CLOUD_STUDY_A } },
        seedCloud: { meta: { order: ['oa-test-1'], regime: 'micro-foncier' } } // pas de profil cloud
    });

    await step('bilan affiché : 2 études, 1 archive, 1 document, URL web', async () => {
        await page.waitForSelector('#migration-locale-modal [data-migration-close]', { timeout: 15000 });
        const b = await lireBilan(page);
        assert.match(b.texte, /2 études/);
        assert.match(b.texte, /1 archive/);
        assert.match(b.texte, /1 document/);
        assert.match(b.texte, /spark-investissement\.web\.app/);
        assert.equal(b.retry, false);
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/migration-bilan.png` });
    });

    await step('le plus récent gagne : A = cloud, B = locale', async () => {
        const s = await page.evaluate(() => window.__store.studies);
        assert.equal(s['asset-A'].variablesData['nom-bien'], 'A cloud (plus récente)');
        assert.equal(s['asset-B'].variablesData['nom-bien'], 'B locale');
        assert.equal(s['asset-B'].variablesData.notaire, 8, 'étude locale normalisée par sanitizeAssetRecord');
    });

    await step('settings/analysis, prefs, profil, archive, document, marqueur', async () => {
        const st = await page.evaluate(() => window.__store.settings);
        assert.equal(st.analysis.variablesData.prix, 123456);
        assert.equal(st.analysis.activeAssetId, 'asset-B');
        assert.deepEqual({ theme: st.prefs.theme, screens: st.prefs.screens, ownedCompact: st.prefs.ownedCompact, facturesLastAsset: st.prefs.facturesLastAsset }, { theme: 'light', screens: 2, ownedCompact: true, facturesLastAsset: 'oa-test-1' });
        assert.equal(await page.evaluate(() => window.__stub.meta.profile?.income), 45000, 'profil poussé car portfolioMeta.profile vide');
        assert.equal(await page.evaluate(() => window.__store.archives['portefeuille-2026-06-14.json']), EXPORT_RAW, 'archive déposée telle quelle');
        assert.deepEqual(await page.evaluate(() => window.__stub.uploadsAs.map(u => u.filename)), ['facture-1.pdf']);
        assert.deepEqual(st.migration.counts, { etudes: 2, archives: 1, documents: 1 });
        assert.ok(st.migration.doneAt && st.migration.appVersion);
    });

    await step('Continuer → l application démarre avec les données migrées', async () => {
        await page.click('#migration-locale-modal [data-migration-close]');
        await page.waitForSelector('#app-cloud-loading[hidden]', { state: 'attached', timeout: 10000 });
        assert.equal(await page.inputValue('#variables-form [name="prix"]'), '123456');
    });

    await step('aucune erreur JS', () => assert.deepEqual(errors, []));
    await context.close();
}

async function scenarioDejaFaite(browser) {
    console.log('\nMigration — marqueur présent → rien ne se passe');
    const { page, context, errors } = await ouvrir(browser, { seedStore: { settings: { migration: { doneAt: 'x', counts: {}, appVersion: '1.0.24' } } } });
    await step('pas de modale, aucune écriture', async () => {
        await page.waitForSelector('#app-cloud-loading[hidden]', { state: 'attached', timeout: 10000 });
        assert.equal(await page.$('#migration-locale-modal'), null);
        assert.deepEqual(await page.evaluate(() => window.__store.writes), []);
    });
    await step('aucune erreur JS', () => assert.deepEqual(errors, []));
    await context.close();
}

async function scenarioEcart(browser) {
    console.log('\nMigration — relecture non conforme → pas de marqueur, Réessayer');
    const { page, context, errors } = await ouvrir(browser, { seedStore: { corruptStudiesRead: true }, seedCloud: { meta: { profile: { income: 1 } } } });
    await step('écarts listés, marqueur absent, bouton Réessayer', async () => {
        await page.waitForSelector('#migration-locale-modal [data-migration-retry]', { timeout: 15000 });
        const b = await lireBilan(page);
        assert.match(b.texte, /asset-A|asset-B/);
        assert.match(b.texte, /écart|diff/i);
        assert.equal(await page.evaluate(() => window.__store.settings.migration), undefined);
        assert.equal(await page.evaluate(() => window.__stub.meta.profile.income), 1, 'profil cloud non écrasé');
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/migration-ecarts.png` });
    });
    await step('Réessayer après correction → marqueur écrit', async () => {
        await page.evaluate(() => { window.__store.corruptStudiesRead = false; });
        await page.click('#migration-locale-modal [data-migration-retry]');
        await page.waitForSelector('#migration-locale-modal [data-migration-close]', { timeout: 15000 });
        assert.ok(await page.evaluate(() => window.__store.settings.migration));
    });
    await step('aucune erreur JS', () => assert.deepEqual(errors, []));
    await context.close();
}

async function scenarioRelance(browser) {
    console.log('\nMigration — second passage sur un cloud déjà alimenté (idempotence)');
    const dejaMigre = {
        studies: { 'asset-A': CLOUD_STUDY_A, 'asset-B': { id: 'asset-B', variablesData: { 'nom-bien': 'B locale', prix: 200000, loyer: 900 }, createdAt: 1500, updatedAt: 3000 } },
        archives: { 'portefeuille-2026-06-14.json': EXPORT_RAW }
    };
    const { page, context, errors } = await ouvrir(browser, { seedStore: dejaMigre, seedCloud: { documents: { 'oa-test-1/facture-1.pdf': true } } });
    await step('aucun doublon, archive et document non re-téléversés, marqueur écrit', async () => {
        await page.waitForSelector('#migration-locale-modal [data-migration-close]', { timeout: 15000 });
        assert.equal(await page.evaluate(() => Object.keys(window.__store.archives).length), 1);
        assert.deepEqual(await page.evaluate(() => window.__stub.uploadsAs), []);
        assert.deepEqual(await page.evaluate(() => window.__store.writes.filter(w => w[0] === 'archive')), [], 'archive non re-téléversée');
        assert.deepEqual(await page.evaluate(() => window.__store.settings.migration.counts), { etudes: 2, archives: 1, documents: 1 });
    });
    await step('aucune erreur JS', () => assert.deepEqual(errors, []));
    await context.close();
}

async function scenarioListePanne(browser) {
    console.log('\nMigration — liste des archives en panne (500) → écart, pas de marqueur, Réessayer');
    listeEnPanne = true;
    const { page, context, errors } = await ouvrir(browser, { seedStore: {}, seedCloud: { meta: { profile: { income: 1 } } } });
    try {
        await step('écart « liste illisible », marqueur absent, Réessayer visible', async () => {
            await page.waitForSelector('#migration-locale-modal [data-migration-retry]', { timeout: 15000 });
            const b = await lireBilan(page);
            assert.match(b.texte, /liste des archives locales illisible/);
            assert.doesNotMatch(b.texte, /0 archive/);
            assert.equal(await page.evaluate(() => window.__store.settings.migration), undefined);
            assert.deepEqual(await page.evaluate(() => window.__store.writes.filter(w => w[0] === 'archive')), []);
        });
        await step('route rétablie + Réessayer → marqueur écrit, 1 archive', async () => {
            listeEnPanne = false;
            await page.click('#migration-locale-modal [data-migration-retry]');
            await page.waitForSelector('#migration-locale-modal [data-migration-close]', { timeout: 15000 });
            const st = await page.evaluate(() => window.__store.settings);
            assert.deepEqual(st.migration.counts.archives, 1);
        });
        // Le 500 volontaire de la route apparaît comme erreur de chargement de ressource : seul bruit toléré.
        await step('aucune erreur JS', () => assert.deepEqual(errors.filter(e => !/status of 500/.test(e)), []));
    } finally {
        listeEnPanne = false;
        await context.close();
    }
}

async function scenarioDocumentManquant(browser) {
    console.log('\nMigration — justificatif absent en local ET dans le cloud → écart bloquant, Réessayer');
    documentIntrouvable = true;
    const { page, context, errors } = await ouvrir(browser, { seedStore: {}, seedCloud: { documents: {}, meta: { profile: { income: 1 } } } });
    try {
        await step('écart « document … introuvable localement … absent du cloud », marqueur absent, Réessayer visible', async () => {
            await page.waitForSelector('#migration-locale-modal [data-migration-retry]', { timeout: 15000 });
            const b = await lireBilan(page);
            assert.match(b.texte, /document facture-1\.pdf du bien Rue des Lilas introuvable localement \(\/api\/documents\/oa-test-1\/facture-1\.pdf\) et absent du cloud/);
            assert.equal(b.retry, true);
            assert.equal(await page.evaluate(() => window.__store.settings.migration), undefined);
            assert.deepEqual(await page.evaluate(() => window.__stub.uploadsAs), []);
        });
        await step('route rétablie (PDF servi) + Réessayer → document téléversé, marqueur écrit', async () => {
            documentIntrouvable = false;
            await page.click('#migration-locale-modal [data-migration-retry]');
            await page.waitForSelector('#migration-locale-modal [data-migration-close]', { timeout: 15000 });
            assert.deepEqual(await page.evaluate(() => window.__stub.uploadsAs.map(u => u.filename)), ['facture-1.pdf']);
            assert.ok(await page.evaluate(() => window.__store.settings.migration));
        });
        // Le 404 volontaire de la route apparaît comme erreur de chargement de ressource : seul bruit toléré.
        await step('aucune erreur JS', () => assert.deepEqual(errors.filter(e => !/status of 404|^404: .*api\/documents/.test(e)), []));
    } finally {
        documentIntrouvable = false;
        await context.close();
    }
}

async function scenarioExceptionPendantRun(browser) {
    console.log('\nMigration — exception pendant le run (Storage en panne) → bilan avec Réessayer, modale jamais bloquée');
    const pageErrors = [];
    const { page, context } = await ouvrir(browser, { seedStore: { failUploadArchive: true }, seedCloud: { meta: { profile: { income: 1 } } } });
    page.on('pageerror', e => pageErrors.push(String(e)));
    await step('bilan « erreur pendant la migration » avec boutons, marqueur absent', async () => {
        await page.waitForSelector('#migration-locale-modal [data-migration-retry]', { timeout: 15000 });
        const b = await lireBilan(page);
        assert.match(b.texte, /erreur pendant la migration/);
        assert.equal(b.retry, true);
        assert.ok(await page.$('#migration-locale-modal [data-migration-skip]'), 'bouton Ignorer présent');
        assert.equal(await page.evaluate(() => window.__store.settings.migration), undefined);
    });
    await step('stockage rétabli + Réessayer → marqueur écrit', async () => {
        await page.evaluate(() => { window.__store.failUploadArchive = false; });
        await page.click('#migration-locale-modal [data-migration-retry]');
        await page.waitForSelector('#migration-locale-modal [data-migration-close]', { timeout: 15000 });
        assert.ok(await page.evaluate(() => window.__store.settings.migration));
    });
    await step('aucune erreur de page non gérée', () => assert.deepEqual(pageErrors, []));
    await context.close();
}

const browser = await chromium.launch();
try {
    await scenarioNominal(browser);
    await scenarioDejaFaite(browser);
    await scenarioEcart(browser);
    await scenarioRelance(browser);
    await scenarioListePanne(browser);
    await scenarioDocumentManquant(browser);
    await scenarioExceptionPendantRun(browser);
} finally {
    await browser.close();
}
console.log(getFailures() === 0 ? '\nOK — migration vérifiée' : `\nÉCHEC — ${getFailures()} étape(s) en erreur`);
process.exit(getFailures() === 0 ? 0 : 1);
