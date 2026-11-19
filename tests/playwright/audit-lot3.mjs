// Corrections du lot 3 de l'audit du 18/11/2026 (docs/audits/2026-11-18-audit-defauts.md).
// Hors `npm test` : serveur statique 8090 + Chromium requis.
//   SPARK_TEST_BASE=http://127.0.0.1:8090 node tests/playwright/audit-lot3.mjs
//   L3_ONLY=T5,T2…  limite aux scénarios nommés ; L3_SCREENSHOTS=<dossier> enregistre des captures
//   PC 1440×900 et iPhone 393×852.
import { chromium } from 'playwright';
import fs from 'node:fs';
import { openPage, waitAppStarted, step, getFailures, assert, assertNoStorageHits, BASE, ASSET_TEST_1, META_TEST } from './_harness.mjs';

const SHOTS = process.env.L3_SCREENSHOTS || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const PC = { width: 1440, height: 900 };
const IPHONE = { width: 393, height: 852 };
const TOUCH = { hasTouch: true, isMobile: true };

async function shot(page, name, opts = {}) {
    if (!SHOTS) return;
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${SHOTS}/${name}.png`, ...opts });
}

// Capture dans les DEUX thèmes (l'app s'ouvre en sombre par défaut) : <nom>-clair.png puis <nom>-sombre.png.
async function shotThemes(page, name, opts = {}) {
    if (!SHOTS) return;
    for (const [theme, suffixe] of [['light', 'clair'], ['dark', 'sombre']]) {
        await page.evaluate(t => { document.documentElement.dataset.theme = t; }, theme);
        await shot(page, `${name}-${suffixe}`, opts);
    }
}

async function openPcIndex(browser, opts = {}) {
    const ctx = await openPage(browser, '/index.html', { viewport: PC, ...opts });
    await waitAppStarted(ctx.page);
    if (await ctx.page.locator('#profile-modal:not([hidden])').count()) await ctx.page.keyboard.press('Escape');
    return ctx;
}

async function finish(ctx, label) {
    await step(`${label} : zéro accès localStorage/sessionStorage`, () => assertNoStorageHits(ctx.page, 'fin du scénario'));
    await step(`${label} : aucune erreur JS ni 404`, () => assert.deepEqual(ctx.errors, []));
    await ctx.context.close();
}

// ── T5 : un justificatif de plus de 15 Mo est refusé avec un message clair ──────────────────
async function scenarioT5(browser) {
    console.log('T5 — plafond de taille des justificatifs (storage.rules)');
    const ctx = await openPcIndex(browser);
    const { page } = ctx;
    await page.click('.workspace-tab[data-target="collection-panel"]');
    await page.locator('[data-open-asset="oa-test-1"], [data-asset-id="oa-test-1"]').first().click();
    await page.waitForSelector('#owned-detail-view:not([hidden])');
    await page.click('#owned-detail-view .owned-tab[data-tab="travaux"]');
    await page.waitForSelector('[data-travaux-file-input]', { state: 'attached' });
    const Mo = 1024 * 1024;
    await step('16 Mo : refusé, message « 15 Mo maximum », rien d\'enregistré', async () => {
        await page.setInputFiles('[data-travaux-file-input]', { name: 'scan-enorme.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(16 * Mo, 65) });
        await page.waitForSelector('#app-toast');
        assert.match(await page.textContent('#app-toast'), /15 Mo maximum/);
        assert.equal(await page.$('.owned-travaux-dropzone--filled'), null);
        assert.equal(await page.evaluate(() => window.__stub.uploads.length), 0);
        await shotThemes(page, 't5-pc-toast');
    });
    await step('10 Mo : accepté (pas de lecture IA au-delà de 8 Mo, saisie à la main)', async () => {
        await page.setInputFiles('[data-travaux-file-input]', { name: 'scan.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(10 * Mo, 65) });
        await page.waitForSelector('.owned-travaux-dropzone--filled');
        assert.match(await page.textContent('.owned-travaux-dropzone__status'), /trop volumineux pour l'extraction/);
    });
    await finish(ctx, 'T5');
}

// Même contrôle sur la page iPhone (owned.html), qui a son propre bootstrap.
async function scenarioT5Iphone(browser) {
    console.log('T5 — plafond de taille, iPhone');
    const ctx = await openPage(browser, '/owned.html', { viewport: IPHONE, contextOptions: TOUCH });
    const { page } = ctx;
    await page.waitForSelector('#owned-list-view:not([hidden])', { timeout: 10000 });
    await page.locator('[data-open-asset="oa-test-1"], [data-asset-id="oa-test-1"]').first().click();
    await page.waitForSelector('#owned-detail-view:not([hidden])');
    await page.click('#owned-detail-view .owned-tab[data-tab="travaux"]');
    await page.waitForSelector('[data-travaux-file-input]', { state: 'attached' });
    await step('16 Mo refusé avec message clair', async () => {
        await page.setInputFiles('[data-travaux-file-input]', { name: 'scan-enorme.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(16 * 1024 * 1024, 65) });
        await page.waitForSelector('#app-toast');
        assert.match(await page.textContent('#app-toast'), /15 Mo maximum/);
        await shotThemes(page, 't5-iphone-toast');
    });
    await finish(ctx, 'T5 iPhone');
}

// ── T2 : Chart.js et Leaflet servis par le site, chargés sans bloquer l'affichage ───────────
// Espion posé avant tout script : si la page lit `Chart` avant que la bibliothèque l'ait défini,
// window.__chartLuTropTot passe à true.
const ESPION_CHART = () => {
    let valeur;
    window.__chartLuTropTot = false;
    Object.defineProperty(window, 'Chart', {
        configurable: true,
        get() { if (valeur === undefined) window.__chartLuTropTot = true; return valeur; },
        set(v) { valeur = v; },
    });
};
// Un bien géolocalisé et un second bien : le dashboard dessine ses graphiques et la carte ses marqueurs.
const clone = o => JSON.parse(JSON.stringify(o));
const BIEN_1 = { ...clone(ASSET_TEST_1), lat: 47.08, lng: 2.4 };
const BIEN_2 = { ...clone(ASSET_TEST_1), id: 'oa-test-2', nom: 'Studio Lyon', ville: 'Lyon', codePostal: '69003', lat: 45.76, lng: 4.84, dateAchat: '2023-05' };
const SEED_T2 = { assets: { 'oa-test-1': BIEN_1, 'oa-test-2': BIEN_2 }, meta: META_TEST };
const PIXEL_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC', 'base64');
const ROUTES_T2 = [['**/*.tile.openstreetmap.org/**', r => r.fulfill({ status: 200, contentType: 'image/png', body: PIXEL_PNG })]];
// Graphique réellement dessiné : instance Chart.js attachée ET au moins un pixel non transparent.
const dessine = (page, sel) => page.$eval(sel, c => c.width > 100 && c.height > 100 && !!window.Chart?.getChart(c)
    && c.getContext('2d').getImageData(0, 0, c.width, c.height).data.some((v, i) => i % 4 === 3 && v > 0));

async function scenarioT2(browser) {
    console.log('T2 — Chart.js et Leaflet locaux, chargés en defer');
    for (const [label, path, viewport, opts] of [['PC', '/index.html', PC, {}], ['iPhone', '/owned.html', IPHONE, { contextOptions: TOUCH }]]) {
        const scripts = [];
        const ctx = await openPage(browser, path, { viewport, seedCloud: SEED_T2, routes: ROUTES_T2, initScripts: [[ESPION_CHART, null]], ...opts });
        const { page } = ctx;
        page.on('request', r => { if (r.resourceType() === 'script') scripts.push(r.url()); });
        await page.reload({ waitUntil: 'load' });
        if (path === '/index.html') {
            await waitAppStarted(page);
            if (await page.locator('#profile-modal:not([hidden])').count()) await page.keyboard.press('Escape');
        } else {
            await page.waitForSelector('#owned-list-view:not([hidden])', { timeout: 10000 });
        }

        await step(`${label} : aucun script ne vient d'un autre site`, () => {
            const base = new URL(BASE).origin;
            assert.ok(scripts.length >= 3, JSON.stringify(scripts));
            assert.deepEqual(scripts.filter(u => new URL(u).origin !== base), []);
            assert.ok(scripts.some(u => u.endsWith('/vendor/chartjs/chart.umd.min.js')), 'Chart.js local demandé');
            assert.ok(scripts.some(u => u.endsWith('/vendor/leaflet/leaflet.js')), 'Leaflet local demandé');
        });
        await step(`${label} : balises de bibliothèque en defer, avant le module de l'application`, async () => {
            const r = await page.evaluate(() => {
                const s = [...document.querySelectorAll('script')];
                const idx = re => s.findIndex(x => re.test(x.getAttribute('src') || ''));
                const module = s.findIndex(x => x.type === 'module');
                return { chartDefer: s[idx(/chart\.umd/)]?.defer, leafletDefer: s[idx(/leaflet\.js/)]?.defer,
                    avant: idx(/chart\.umd/) < module && idx(/leaflet\.js/) < module };
            });
            assert.deepEqual(r, { chartDefer: true, leafletDefer: true, avant: true });
        });
        await step(`${label} : aucun appel à Chart avant son chargement ; Chart 4.4.0 et L définis`, async () => {
            assert.equal(await page.evaluate(() => window.__chartLuTropTot), false);
            assert.deepEqual(await page.evaluate(() => [typeof window.Chart, typeof window.L, window.Chart.version]), ['function', 'object', '4.4.0']);
        });

        if (path === '/index.html') {
            await page.click('.workspace-tab[data-target="collection-panel"]');
            await page.waitForSelector('#owned-portfolio-cf-chart', { state: 'attached' });
            await step('PC dashboard : graphique du cash-flow cumulé dessiné', async () => {
                await page.waitForFunction(() => { const c = document.getElementById('owned-portfolio-cf-chart'); return c && window.Chart.getChart(c); });
                assert.equal(await dessine(page, '#owned-portfolio-cf-chart'), true);
            });
            await step('PC dashboard : carte Leaflet affichée avec ses marqueurs', async () => {
                await page.waitForSelector('#owned-map.leaflet-container');
                assert.ok((await page.$$eval('#owned-map .leaflet-interactive', e => e.length)) >= 2);
            });
            await shotThemes(page, 't2-pc-dashboard', { fullPage: true });
            await page.click('#owned-dashboard-wrap [data-action="open-projection-impots"]');
            await page.waitForSelector('#owned-projection-impots-modal:not([hidden])');
            await step('PC projection des impôts : graphique de l\'impôt dessiné (et celui du report s\'il y a un déficit)', async () => {
                assert.equal(await dessine(page, '#owned-projection-impots-modal #proj-chart-impot'), true);
                if (await page.$('#owned-projection-impots-modal #proj-chart-report')) assert.equal(await dessine(page, '#owned-projection-impots-modal #proj-chart-report'), true);
            });
            await shotThemes(page, 't2-pc-projection');
            await page.click('#owned-projection-impots-modal [data-proj-tab="regimes"]');
            await step('PC projection, onglet régimes : graphique dessiné', async () => {
                await page.waitForSelector('#owned-projection-impots-modal #proj-chart-regimes');
                assert.equal(await dessine(page, '#owned-projection-impots-modal #proj-chart-regimes'), true);
                await shotThemes(page, 't2-pc-regimes');
            });
            await page.keyboard.press('Escape');
            await page.locator('[data-open-asset="oa-test-1"], [data-asset-id="oa-test-1"]').first().click();
            await page.waitForSelector('#owned-detail-view:not([hidden])');
            for (const onglet of ['Exploitation', 'Calcul']) {
                await page.locator('#owned-detail-view .owned-tab', { hasText: onglet }).click();
                await page.waitForTimeout(400);
                await shotThemes(page, `t2-pc-fiche-${onglet.toLowerCase()}`, { fullPage: true });
            }
            await page.click('.workspace-tab[data-target="workspace-panel"]');
            await shotThemes(page, 't2-pc-analyse', { fullPage: true });
        } else {
            await shotThemes(page, 't2-iphone-liste', { fullPage: true });
            await page.locator('[data-open-asset="oa-test-1"], [data-asset-id="oa-test-1"]').first().click();
            await page.waitForSelector('#owned-detail-view:not([hidden])');
            await shotThemes(page, 't2-iphone-fiche', { fullPage: true });
        }
        await finish(ctx, `T2 ${label}`);
    }
}

const SCENARIOS = { T5: scenarioT5, T5IPHONE: scenarioT5Iphone, T2: scenarioT2 };
const only = (process.env.L3_ONLY || '').split(',').filter(Boolean);

const browser = await chromium.launch();
try {
    for (const [name, fn] of Object.entries(SCENARIOS)) {
        if (only.length && !only.includes(name)) continue;
        await fn(browser);
    }
} finally {
    await browser.close();
}
const failures = getFailures();
console.log(failures ? `\n${failures} échec(s)` : '\nOK — toutes les étapes passent');
process.exit(failures ? 1 : 0);
