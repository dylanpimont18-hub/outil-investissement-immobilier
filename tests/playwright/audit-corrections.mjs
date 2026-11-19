// Corrections de l'audit du 18/11/2026 (docs/audits/2026-11-18-audit-defauts.md).
// Hors `npm test` : serveur statique 8090 + Chromium requis.
//   SPARK_TEST_BASE=http://127.0.0.1:8090 node tests/playwright/audit-corrections.mjs
//   AC_SCREENSHOTS=<dossier> enregistre des captures PC 1440×900 et iPhone 393×852.
import { chromium } from 'playwright';
import fs from 'node:fs';
import { openPage, waitAppStarted, step, getFailures, assert, assertNoStorageHits } from './_harness.mjs';

const SHOTS = process.env.AC_SCREENSHOTS || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const PC = { width: 1440, height: 900 };
const IPHONE = { width: 393, height: 852 };
const TOUCH = { hasTouch: true, isMobile: true };

async function shot(page, name, opts = {}) {
    if (!SHOTS) return;
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${SHOTS}/${name}.png`, ...opts });
}

const isVisible = (page, sel) => page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
}, sel);

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

// ── F2 : blocs de l'Analyse masqués hors de l'onglet Analyse ────────────────
async function scenarioF2(browser) {
    console.log('F2 — barre latérale propre à chaque onglet');
    const ctx = await openPcIndex(browser);
    const { page } = ctx;
    const ids = ['#mode-toggle', '#save-asset', '#new-asset', '#export-decision-pdf', '#asset-status-bar'];
    await step('Analyse : les 5 contrôles sont visibles', async () => {
        for (const s of ids) assert.equal(await isVisible(page, s), true, s);
    });
    await shot(page, 'f2-pc-analyse');
    for (const target of ['collection-panel', 'assistant-panel']) {
        await page.click(`.workspace-tab[data-target="${target}"]`);
        await step(`${target} : aucun contrôle de l'Analyse visible`, async () => {
            for (const s of ids) assert.equal(await isVisible(page, s), false, s);
        });
        await shot(page, `f2-pc-${target}`);
    }
    await page.click('.workspace-tab[data-target="workspace-panel"]');
    await step('retour sur Analyse : contrôles de nouveau visibles', async () => {
        for (const s of ids) assert.equal(await isVisible(page, s), true, s);
    });
    await finish(ctx, 'F2');

    const m = await openPage(browser, '/index.html', { viewport: IPHONE, contextOptions: TOUCH });
    await waitAppStarted(m.page);
    if (await m.page.locator('#profile-modal:not([hidden])').count()) await m.page.keyboard.press('Escape');
    await m.page.click('.workspace-tab[data-target="collection-panel"]');
    await step('iPhone index.html, Portefeuille : contrôles de l\'Analyse masqués', async () => {
        for (const s of ids) assert.equal(await isVisible(m.page, s), false, s);
    });
    await shot(m.page, 'f2-iphone-index-portefeuille');
    await finish(m, 'F2 iPhone');
}

// ── A1 : virgule décimale (DSCR, pourcentages) ──────────────────────────────
// Un nombre décimal à point (« 0.92 », « 17.7 % ») dans un texte visible, hors champs de saisie.
const DOT_DECIMALS = () => {
    const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
        const n = walker.currentNode;
        const el = n.parentElement;
        if (!el || el.closest('script, style, svg, input, textarea, select, .topbar-version, #topbar-version') || !vis(el)) continue;
        // « v1.0.28 » (version) exclu ; on cherche chiffre.chiffre non suivi d'un autre point.
        const m = n.textContent.match(/(?<![\w.])-?\d+\.\d+(?![.\d])/g);
        if (m) out.push(`${el.className || el.tagName}: ${n.textContent.trim().slice(0, 80)}`);
    }
    return out;
};

async function scenarioA1(browser) {
    console.log('A1 — séparateur décimal français');
    const ctx = await openPcIndex(browser);
    const { page } = ctx;
    await page.fill('[name="prix"]', '150000');
    await page.fill('[name="loyer"]', '750');
    await page.locator('[name="loyer"]').dispatchEvent('input');
    await page.waitForTimeout(600);
    await step('Analyse remplie : aucun décimal à point', async () => assert.deepEqual(await page.evaluate(DOT_DECIMALS), []));
    await step('Analyse : le DSCR s\'affiche avec une virgule', async () => {
        const txt = await page.locator('#fkpi-dscr').textContent();
        assert.match(txt.trim(), /^\d+,\d{2}$/);
    });
    await shot(page, 'a1-pc-analyse');
    await page.click('.workspace-tab[data-target="collection-panel"]');
    await page.waitForTimeout(500);
    await step('Portefeuille (dashboard + Centre d\'actions) : aucun décimal à point', async () => assert.deepEqual(await page.evaluate(DOT_DECIMALS), []));
    await step('Centre d\'actions : « DSCR 0,xx »', async () => {
        const txt = await page.locator('#collection-panel').innerText();
        assert.match(txt, /DSCR \d+,\d{2}/);
    });
    await shot(page, 'a1-pc-portefeuille');
    await finish(ctx, 'A1');

    const m = await openPage(browser, '/owned.html', { viewport: IPHONE, contextOptions: TOUCH });
    await m.page.waitForSelector('#owned-list-view:not([hidden])', { timeout: 10000 });
    await m.page.waitForTimeout(400);
    await step('iPhone liste : aucun décimal à point', async () => assert.deepEqual(await m.page.evaluate(DOT_DECIMALS), []));
    await shot(m.page, 'a1-iphone-liste');
    await m.page.locator('[data-open-asset="oa-test-1"], [data-asset-id="oa-test-1"]').first().click();
    await m.page.waitForTimeout(500);
    const tabs = m.page.locator('#owned-detail-view .owned-tab');
    for (let i = 0; i < await tabs.count(); i++) {
        await tabs.nth(i).click();
        await m.page.waitForTimeout(300);
        const name = (await tabs.nth(i).textContent()).trim();
        await step(`iPhone fiche, onglet ${name} : aucun décimal à point`, async () => assert.deepEqual(await m.page.evaluate(DOT_DECIMALS), []));
    }
    await shot(m.page, 'a1-iphone-fiche');
    await finish(m, 'A1 iPhone');
}

// ── T1 : logo léger (48 px en-tête, 180 px apple-touch-icon) ───────────────
async function scenarioT1(browser) {
    console.log('T1 — logo allégé');
    for (const [label, path, viewport, opts] of [['PC', '/index.html', PC, {}], ['iPhone', '/owned.html', IPHONE, { contextOptions: TOUCH }]]) {
        const ctx = await openPage(browser, path, { viewport, ...opts });
        const pngs = [];
        ctx.page.on('response', async (r) => {
            if (/\.png(\?|$)/.test(r.url())) pngs.push({ url: r.url(), size: Number(r.headers()['content-length'] || (await r.body().catch(() => Buffer.alloc(0))).length) });
        });
        await ctx.page.reload({ waitUntil: 'load' });
        if (path === '/index.html') await waitAppStarted(ctx.page);
        else await ctx.page.waitForSelector('#owned-list-view:not([hidden])', { timeout: 10000 });
        await step(`${label} : Logo_site.png n'est plus téléchargé`, () => assert.equal(pngs.filter(p => /Logo_site\.png/.test(p.url)).length, 0));
        await step(`${label} : logo de l'en-tête = logo-48.png chargé (48×48)`, async () => {
            const img = await ctx.page.evaluate(() => { const i = document.querySelector('.topbar-logo img'); return { src: i.getAttribute('src'), w: i.naturalWidth, h: i.naturalHeight, ok: i.complete }; });
            assert.deepEqual(img, { src: 'logo-48.png', w: 48, h: 48, ok: true });
        });
        await step(`${label} : aucun PNG de plus de 50 Ko au chargement`, () => assert.deepEqual(pngs.filter(p => p.size > 50 * 1024), []));
        if (label === 'iPhone') {
            await step('iPhone : apple-touch-icon = logo-180.png (180×180)', async () => {
                const href = await ctx.page.getAttribute('link[rel="apple-touch-icon"]', 'href');
                assert.equal(href, 'logo-180.png');
                const dim = await ctx.page.evaluate(async (h) => { const i = new Image(); i.src = h; await i.decode(); return [i.naturalWidth, i.naturalHeight]; }, href);
                assert.deepEqual(dim, [180, 180]);
            });
        }
        await shot(ctx.page, `t1-${label.toLowerCase()}-entete`, { clip: { x: 0, y: 0, width: viewport.width, height: 140 } });
        await finish(ctx, `T1 ${label}`);
    }
}

const SCENARIOS = { F2: scenarioF2, A1: scenarioA1, T1: scenarioT1 };
const only = (process.env.AC_ONLY || '').split(',').filter(Boolean);

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
