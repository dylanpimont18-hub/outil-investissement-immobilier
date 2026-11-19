// Corrections du lot 3 de l'audit du 18/11/2026 (docs/audits/2026-11-18-audit-defauts.md).
// Hors `npm test` : serveur statique 8090 + Chromium requis.
//   SPARK_TEST_BASE=http://127.0.0.1:8090 node tests/playwright/audit-lot3.mjs
//   L3_ONLY=T5,T2…  limite aux scénarios nommés ; L3_SCREENSHOTS=<dossier> enregistre des captures
//   PC 1440×900 et iPhone 393×852.
import { chromium } from 'playwright';
import fs from 'node:fs';
import { openPage, waitAppStarted, step, getFailures, assert, assertNoStorageHits } from './_harness.mjs';

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

const SCENARIOS = { T5: scenarioT5, T5IPHONE: scenarioT5Iphone };
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
