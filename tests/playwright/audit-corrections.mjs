// Corrections de l'audit du 18/11/2026 (docs/audits/2026-11-18-audit-defauts.md).
// Hors `npm test` : serveur statique 8090 + Chromium requis.
//   SPARK_TEST_BASE=http://127.0.0.1:8090 node tests/playwright/audit-corrections.mjs
//   AC_SCREENSHOTS=<dossier> enregistre des captures PC 1440×900 et iPhone 393×852.
import { chromium } from 'playwright';
import fs from 'node:fs';
import zlib from 'node:zlib';
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

// ── X1 : libellés des champs ────────────────────────────────────────────────
const NO_LABEL = () => [...document.querySelectorAll('input:not([type=hidden]):not([type=file]), select, textarea')]
    .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; })
    .filter((el) => !(el.labels?.length || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title')))
    .map((el) => `${el.tagName.toLowerCase()}[name=${el.name}] ph="${el.placeholder || ''}"`);

// Nom accessible calculé par Chromium lui-même (arbre d'accessibilité CDP), pas par Playwright.
async function axName(page, selector) {
    const cdp = await page.context().newCDPSession(page);
    const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
    await cdp.detach();
    return nodes[0]?.name?.value || '';
}

const labelsVisible = (page) => page.evaluate(() => [...document.querySelectorAll('#owned-detail-view .field-inline__label, #owned-list-view .field-inline__label')]
    .filter((s) => s.closest('form, .owned-notes-add')?.getBoundingClientRect().width > 0)
    .map((s) => s.getBoundingClientRect().width > 2));

async function openAsset(page) {
    await page.locator('[data-open-asset="oa-test-1"], [data-asset-id="oa-test-1"]').first().click();
    await page.waitForTimeout(400);
}
const openAssetTab = async (page, name) => {
    await page.locator('#owned-detail-view .owned-tab', { hasText: name }).click();
    await page.waitForTimeout(350);
};

async function scenarioX1(browser) {
    console.log('X1 — libellés des champs');
    const ctx = await openPcIndex(browser);
    const { page } = ctx;
    await step('Analyse : tous les champs visibles ont un libellé (curseurs taux/durée compris)', async () => assert.deepEqual(await page.evaluate(NO_LABEL), []));
    await page.click('.workspace-tab[data-target="assistant-panel"]');
    await step('Assistant : la zone de saisie a un libellé', async () => assert.deepEqual(await page.evaluate(NO_LABEL), []));
    await page.click('.workspace-tab[data-target="collection-panel"]');
    await page.waitForTimeout(400);
    await page.locator('.owned-list-tabs button, .owned-list-tabs [role=tab]', { hasText: 'Profil' }).first().click();
    await page.waitForTimeout(300);
    await step('PC Profil : tous les champs ont un libellé', async () => assert.deepEqual(await page.evaluate(NO_LABEL), []));
    await shot(page, 'x1-pc-profil', { fullPage: true });
    await page.locator('.owned-list-tabs button, .owned-list-tabs [role=tab]', { hasText: 'Vue d' }).first().click();
    await openAsset(page);
    for (const tab of ['Exploitation', 'Travaux']) {
        await openAssetTab(page, tab);
        await step(`PC fiche ${tab} : tous les champs ont un libellé`, async () => assert.deepEqual(await page.evaluate(NO_LABEL), []));
        await step(`PC fiche ${tab} : libellés masqués visuellement (mise en page inchangée)`, async () => {
            const vis = await labelsVisible(page);
            assert.ok(vis.length > 0, 'aucun libellé trouvé');
            assert.deepEqual(vis.filter(Boolean), []);
        });
        await shot(page, `x1-pc-${tab.toLowerCase()}`, { fullPage: true });
    }
    await step('PC : nom accessible calculé par Chromium = « Montant (€) » pour le montant d\'un frais', async () => {
        assert.equal(await axName(page, '[data-form="add-travail-tab"] input[name="montant"]'), 'Montant (€)');
    });
    await finish(ctx, 'X1 PC');

    const m = await openPage(browser, '/owned.html', { viewport: IPHONE, contextOptions: TOUCH });
    await m.page.waitForSelector('#owned-list-view:not([hidden])', { timeout: 10000 });
    await m.page.locator('.owned-list-tabs button, .owned-list-tabs [role=tab]', { hasText: 'Profil' }).first().click();
    await m.page.waitForTimeout(300);
    await step('iPhone Profil : tous les champs ont un libellé, visibles', async () => {
        assert.deepEqual(await m.page.evaluate(NO_LABEL), []);
        const vis = await labelsVisible(m.page);
        assert.ok(vis.length >= 3 && vis.every(Boolean), JSON.stringify(vis));
    });
    await shot(m.page, 'x1-iphone-profil', { fullPage: true });
    await m.page.locator('.owned-list-tabs button, .owned-list-tabs [role=tab]', { hasText: 'Vue d' }).first().click();
    await openAsset(m.page);
    for (const tab of ['Exploitation', 'Travaux']) {
        await openAssetTab(m.page, tab);
        await step(`iPhone fiche ${tab} : tous les champs ont un libellé`, async () => assert.deepEqual(await m.page.evaluate(NO_LABEL), []));
        await step(`iPhone fiche ${tab} : libellés visibles au-dessus des champs`, async () => {
            const vis = await labelsVisible(m.page);
            assert.ok(vis.length > 0 && vis.every(Boolean), JSON.stringify(vis));
        });
        await step(`iPhone fiche ${tab} : pas de débordement horizontal`, async () => {
            assert.ok(await m.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
        });
        await shot(m.page, `x1-iphone-${tab.toLowerCase()}`, { fullPage: true });
    }
    await step('iPhone : un frais saisi via les champs libellés s\'ajoute bien', async () => {
        const f = m.page.locator('[data-form="add-travail-tab"]');
        await f.locator('input[name="date"]').fill('2026-10-15');
        await f.locator('input[name="description"]').fill('Peinture salon');
        await f.locator('input[name="montant"]').fill('450');
        await f.locator('button[type="submit"]').click();
        await m.page.waitForFunction(() => document.querySelector('#owned-detail-view')?.textContent.includes('Peinture salon'), null, { timeout: 5000 });
    });
    await m.page.locator('#owned-chatfab').click().catch(() => {});
    await m.page.waitForTimeout(300);
    await step('iPhone Assistant : la zone de saisie a un libellé', async () => assert.equal(await m.page.getAttribute('#assistant-chat-input', 'aria-label'), 'Votre message à l’assistant'));
    await finish(m, 'X1 iPhone');
}

// ── F3 : boutons flottants qui ne recouvrent rien en bas de page ───────────
// Fait défiler jusqu'en bas (fenêtre ET conteneurs défilants) puis liste les éléments visibles
// (texte, boutons, champs) dont le rectangle croise un bouton flottant visible.
const COVERED_AT_BOTTOM = async (page) => {
    // behavior 'instant' : la page a scroll-behavior: smooth, un scrollTo simple n'arrive pas en bas à temps.
    await page.evaluate(() => {
        document.querySelectorAll('*').forEach((el) => { if (el.scrollHeight > el.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(el).overflowY)) el.scrollTo({ top: el.scrollHeight, behavior: 'instant' }); });
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
    });
    await page.waitForTimeout(250);
    await page.waitForFunction(() => Math.abs(window.scrollY + innerHeight - document.documentElement.scrollHeight) < 2, null, { timeout: 3000 }).catch(() => {});
    return page.evaluate(() => {
        const fabs = [...document.querySelectorAll('.owned-quickfab')].filter((f) => !f.hidden && getComputedStyle(f).display !== 'none').map((f) => f.getBoundingClientRect());
        const hit = (r) => fabs.some((f) => r.left < f.right && r.right > f.left && r.top < f.bottom && r.bottom > f.top);
        const out = [];
        for (const el of document.querySelectorAll('body *')) {
            if (el.closest('.owned-quickfab, #owned-chat-sheet, .app-toast, script, style')) continue;
            const isCtl = el.matches('button, a[href], input, select, textarea, [role=button]');
            const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
            if (!isCtl && !hasText) continue;
            const s = getComputedStyle(el);
            if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0) continue;
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0 || r.bottom <= 0 || r.top >= innerHeight) continue;
            if (hit(r)) out.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')}: ${(el.textContent || el.placeholder || '').trim().slice(0, 40)}`);
        }
        return out;
    });
};

async function scenarioF3(browser) {
    console.log('F3 — boutons flottants');
    const ctx = await openPcIndex(browser);
    const { page } = ctx;
    await page.click('.workspace-tab[data-target="collection-panel"]');
    await page.waitForTimeout(400);
    const pcScreens = [];
    await page.locator('.owned-list-tabs button, .owned-list-tabs [role=tab]', { hasText: 'Profil' }).first().click();
    pcScreens.push(['Profil', await COVERED_AT_BOTTOM(page)]);
    await shot(page, 'f3-pc-profil-bas');
    await page.locator('.owned-list-tabs button, .owned-list-tabs [role=tab]', { hasText: 'Vue d' }).first().click();
    pcScreens.push(['Vue d\'ensemble', await COVERED_AT_BOTTOM(page)]);
    await page.evaluate(() => window.scrollTo(0, 0));
    await openAsset(page);
    for (const tab of ['Acquisition', 'Exploitation', 'Travaux', 'Calcul']) {
        await openAssetTab(page, tab);
        pcScreens.push([`fiche ${tab}`, await COVERED_AT_BOTTOM(page)]);
        if (tab === 'Travaux') await shot(page, 'f3-pc-travaux-bas');
        await page.evaluate(() => window.scrollTo(0, 0));
    }
    await page.click('.workspace-tab[data-target="workspace-panel"]');
    pcScreens.push(['Analyse', await COVERED_AT_BOTTOM(page)]);
    await page.click('.workspace-tab[data-target="assistant-panel"]');
    pcScreens.push(['Assistant', await COVERED_AT_BOTTOM(page)]);
    for (const [name, covered] of pcScreens) {
        await step(`PC ${name} : en bas de page, le bouton flottant ne recouvre rien`, () => assert.deepEqual(covered, []));
    }
    await finish(ctx, 'F3 PC');

    const m = await openPage(browser, '/owned.html', { viewport: IPHONE, contextOptions: TOUCH });
    await m.page.waitForSelector('#owned-list-view:not([hidden])', { timeout: 10000 });
    await m.page.waitForTimeout(300);
    const mScreens = [['liste', await COVERED_AT_BOTTOM(m.page)]];
    await m.page.locator('.owned-list-tabs button, .owned-list-tabs [role=tab]', { hasText: 'Profil' }).first().click();
    mScreens.push(['Profil', await COVERED_AT_BOTTOM(m.page)]);
    await shot(m.page, 'f3-iphone-profil-bas');
    await m.page.locator('.owned-list-tabs button, .owned-list-tabs [role=tab]', { hasText: 'Vue d' }).first().click();
    await m.page.evaluate(() => window.scrollTo(0, 0));
    await openAsset(m.page);
    for (const tab of ['Acquisition', 'Exploitation', 'Travaux', 'Calcul']) {
        await openAssetTab(m.page, tab);
        mScreens.push([`fiche ${tab}`, await COVERED_AT_BOTTOM(m.page)]);
        if (tab === 'Travaux') await shot(m.page, 'f3-iphone-travaux-bas');
        await m.page.evaluate(() => window.scrollTo(0, 0));
    }
    for (const [name, covered] of mScreens) {
        await step(`iPhone ${name} : en bas de page, ✦ et 📄 ne recouvrent rien`, () => assert.deepEqual(covered, []));
    }
    await finish(m, 'F3 iPhone');
}

// ── F1 : « Mes études » (études enregistrées) ──────────────────────────────
const XSS_NAME = '<img src=x onerror="window.__xss=1">Studio';
const STUDY = (id, nom, ville, prix, loyer, day) => ({
    id, createdAt: Date.UTC(2026, 10, day - 1, 9), updatedAt: Date.UTC(2026, 10, day, 10),
    variablesData: { 'nom-bien': nom, ville, prix, loyer, apport: 20000, 'taux-input': 3.5, duree: 20 }
});
const STUDIES_SEED = {
    'st-lyon': STUDY('st-lyon', 'T2 Croix-Rousse', 'Lyon', 150000, 750, 17),
    'st-xss': STUDY('st-xss', XSS_NAME, 'Bourges', 80000, 600, 18)
};

async function scenarioF1(browser) {
    console.log('F1 — Mes études');
    const ctx = await openPcIndex(browser, { seedStore: { studies: STUDIES_SEED } });
    const { page } = ctx;
    const items = page.locator('#sidebar-studies-list .study-item');
    const writes = () => page.evaluate(() => window.__store.writes.map(w => w.join(':')));
    await step('chargement : aucune écriture cloud', async () => assert.deepEqual(await writes(), []));
    await step('liste : 2 études, la plus récente en premier', async () => {
        assert.equal(await items.count(), 2);
        assert.equal(await page.locator('#sidebar-studies-count').textContent(), '(2)');
        assert.match(await items.nth(0).textContent(), /Studio/);
    });
    await step('ligne : nom, ville, prix, CF, score, date', async () => {
        const t = (await items.nth(1).innerText()).replace(/\s+/g, ' ');
        for (const re of [/T2 Croix-Rousse/, /Lyon · 150\s000\s€/, /CF [+-]\d[\d\s]*\s€\/mois/, /Score \d+\/100/, /Modifiée le 17\/11\/2026/]) assert.match(t, re);
    });
    await step('nom saisi par l\'utilisateur échappé (aucun HTML injecté)', async () => {
        assert.equal(await page.evaluate(() => window.__xss), undefined);
        assert.equal(await page.locator('#sidebar-studies-list img').count(), 0);
        assert.match(await items.nth(0).locator('.study-item__name').textContent(), /<img src=x/);
    });
    await shot(page, 'f1-pc-liste');

    await step('clic sur une étude (brouillon vide) : chargée sans question, marquée active', async () => {
        await items.nth(1).locator('.study-item__open').click();
        await page.waitForTimeout(300);
        assert.equal(await page.locator('#study-confirm[open]').count(), 0);
        assert.equal(await page.inputValue('[name="nom-bien"]'), 'T2 Croix-Rousse');
        assert.equal(await page.inputValue('[name="prix"]'), '150000');
        assert.match(await page.locator('#sidebar-studies-list .study-item.is-active').textContent(), /Croix-Rousse/);
        assert.match(await page.locator('#asset-status-bar').textContent(), /À jour/);
    });
    await page.fill('[name="prix"]', '149000');
    await page.locator('[name="prix"]').dispatchEvent('input');
    await page.waitForTimeout(400);
    await step('modifications non enregistrées + clic sur une autre étude : confirmation, Annuler garde la saisie', async () => {
        await page.locator('#sidebar-studies-list .study-item', { hasText: 'Studio' }).locator('.study-item__open').click();
        await page.waitForSelector('#study-confirm[open]');
        assert.match(await page.locator('#study-confirm').textContent(), /modifications non enregistrées/);
        await shot(page, 'f1-pc-confirmation-chargement');
        await page.locator('#study-confirm button[value="cancel"]').click();
        assert.equal(await page.inputValue('[name="prix"]'), '149000');
    });
    await step('… puis « Ouvrir sans enregistrer » charge l\'autre étude', async () => {
        await page.locator('#sidebar-studies-list .study-item', { hasText: 'Studio' }).locator('.study-item__open').click();
        await page.waitForSelector('#study-confirm[open]');
        await page.locator('#study-confirm-ok').click();
        await page.waitForTimeout(300);
        assert.equal(await page.inputValue('[name="nom-bien"]'), XSS_NAME);
    });
    await step('suppression : Échap annule, rien n\'est écrit', async () => {
        await page.locator('#sidebar-studies-list .study-item', { hasText: 'Croix-Rousse' }).locator('.study-item__delete').click();
        await page.waitForSelector('#study-confirm[open]');
        await shot(page, 'f1-pc-confirmation-suppression');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
        assert.equal(await items.count(), 2);
        assert.ok(!(await writes()).some(w => w.startsWith('deleteStudy')));
    });
    await step('suppression confirmée : retirée de la liste et du cloud', async () => {
        await page.locator('#sidebar-studies-list .study-item', { hasText: 'Croix-Rousse' }).locator('.study-item__delete').click();
        await page.waitForSelector('#study-confirm[open]');
        await page.locator('#study-confirm-ok').click();
        await page.waitForTimeout(300);
        assert.equal(await items.count(), 1);
        assert.ok((await writes()).includes('deleteStudy:st-lyon'));
        assert.equal(await page.evaluate(() => 'st-lyon' in window.__store.studies), false);
    });
    await step('supprimer l\'étude ouverte : le formulaire garde ses valeurs, redevient « Nouvelle étude »', async () => {
        await items.nth(0).locator('.study-item__delete').click();
        await page.locator('#study-confirm-ok').click();
        await page.waitForTimeout(300);
        assert.equal(await page.inputValue('[name="nom-bien"]'), XSS_NAME);
        assert.match(await page.locator('#asset-status-bar').textContent(), /Nouvelle étude/);
        assert.match(await page.locator('#sidebar-studies-list').textContent(), /Aucune étude enregistrée/);
    });
    await step('« Enregistrer » ajoute l\'étude en cours à la liste', async () => {
        await page.fill('[name="nom-bien"]', 'Maison Tours');
        await page.locator('[name="nom-bien"]').dispatchEvent('input');
        await page.waitForTimeout(400);
        await page.click('#save-asset');
        await page.waitForTimeout(400);
        assert.equal(await items.count(), 1);
        assert.match(await items.nth(0).textContent(), /Maison Tours/);
        assert.match(await items.nth(0).getAttribute('class'), /is-active/);
    });
    await shot(page, 'f1-pc-apres-enregistrement');
    await page.click('.workspace-tab[data-target="collection-panel"]');
    await step('Portefeuille : la liste « Mes études » est masquée', async () => assert.equal(await isVisible(page, '.sidebar-studies'), false));
    await finish(ctx, 'F1 PC');

    const m = await openPage(browser, '/index.html', { viewport: IPHONE, contextOptions: TOUCH, seedStore: { studies: STUDIES_SEED } });
    await waitAppStarted(m.page);
    if (await m.page.locator('#profile-modal:not([hidden])').count()) await m.page.keyboard.press('Escape');
    await step('iPhone index.html : la liste s\'affiche et charge une étude', async () => {
        assert.equal(await m.page.locator('#sidebar-studies-list .study-item').count(), 2);
        await m.page.locator('#sidebar-studies-list .study-item', { hasText: 'Croix-Rousse' }).locator('.study-item__open').click();
        await m.page.waitForTimeout(300);
        assert.equal(await m.page.inputValue('[name="nom-bien"]'), 'T2 Croix-Rousse');
    });
    await m.page.locator('.sidebar-studies').scrollIntoViewIfNeeded();
    await shot(m.page, 'f1-iphone-index-liste');
    await finish(m, 'F1 iPhone');
}

// ── F4 : verdict unique sur le premier écran, nuancé ───────────────────────
// Nombre d'occurrences visibles d'un libellé dans la fenêtre (premier écran, sans défilement).
const countInViewport = (page, text) => page.evaluate((t) => {
    let n = 0;
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) {
        const node = w.currentNode;
        if (!node.textContent.includes(t)) continue;
        const el = node.parentElement; const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
        if (r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && s.visibility !== 'hidden' && s.display !== 'none') n++;
    }
    return n;
}, text);

async function fillStudy(page, values) {
    // Valeur posée dans le DOM puis input/change : marche aussi pour les champs d'un accordéon replié.
    await page.evaluate((vals) => {
        for (const [name, value] of Object.entries(vals)) {
            const el = document.querySelector(`#variables-form [name="${name}"]`);
            el.value = String(value);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }, values);
    await page.waitForTimeout(600);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.waitForTimeout(200);
}

async function scenarioF4(browser) {
    console.log('F4 — verdict unique et nuancé');
    const ctx = await openPcIndex(browser);
    const { page } = ctx;
    await fillStudy(page, { prix: 150000, loyer: 750 });
    await step('150 000 € / 750 € : « Économie défavorable », une seule fois sur le premier écran', async () => {
        assert.equal(await countInViewport(page, 'Économie défavorable'), 1);
        assert.equal(await countInViewport(page, 'Offre non recevable'), 0);
    });
    await step('… avec la baisse de prix nécessaire juste en dessous', async () => {
        assert.match(await page.locator('#workspace-hero .workspace-hero-decision__reason').textContent(), /de baisse \(prix autour de/);
    });
    await shot(page, 'f4-pc-economie-defavorable');
    await fillStudy(page, { prix: 60000, loyer: 750, 'loyer-marche': 750, fonciere: 500, apport: 10000 });
    await step('bien rentable mais hypothèses estimées : « Dossier à documenter », une seule fois', async () => {
        assert.equal(await countInViewport(page, 'Dossier à documenter'), 1);
        assert.match(await page.locator('#workspace-hero .workspace-hero-decision__reason').textContent(), /à confirmer/);
    });
    await shot(page, 'f4-pc-dossier-a-documenter');
    await step('carte Verdict (plus bas) : le libellé n\'est plus répété sous l\'anneau du score', async () => {
        assert.equal(await page.locator('#analysis-acquisition-decision .score-verdict').count(), 0);
    });
    await finish(ctx, 'F4 PC');

    const m = await openPage(browser, '/index.html', { viewport: IPHONE, contextOptions: TOUCH });
    await waitAppStarted(m.page);
    if (await m.page.locator('#profile-modal:not([hidden])').count()) await m.page.keyboard.press('Escape');
    await m.page.locator('#mobile-redirect-banner button, .mobile-redirect-banner__close').first().click().catch(() => {});
    await fillStudy(m.page, { prix: 150000, loyer: 750 });
    await m.page.locator('#workspace-hero').scrollIntoViewIfNeeded();
    await step('iPhone index.html : verdict une seule fois dans la bande de synthèse', async () => {
        assert.equal(await m.page.locator('#workspace-hero').getByText('Économie défavorable', { exact: true }).count(), 1);
    });
    await shot(m.page, 'f4-iphone-index-verdict');
    await finish(m, 'F4 iPhone');
}

// ── Bug signalé le 2026-11-19 : « impossible de fermer la fenêtre » d'ajout de factures ──
function pngBuffer(w, h) {
    const crc32 = (buf) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return (~c) >>> 0; };
    const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const tb = Buffer.from(t, 'ascii'); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(Buffer.concat([tb, d]))); return Buffer.concat([l, tb, d, c]); };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
    const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0x80)]);
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))), chunk('IEND', Buffer.alloc(0))]);
}
const closeButtonState = (page) => page.evaluate(() => {
    const x = document.querySelector('#owned-factures-modal [data-close-modal]');
    const r = x.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { inView: r.top >= 0 && r.bottom <= innerHeight, clickable: hit === x || x.contains(hit) };
});

async function scenarioFermerFactures(browser) {
    console.log('Bug 19/11 — fenêtre « Ajouter des factures » refermable');
    const files = [1, 2, 3].map((n) => ({ name: `facture-${n}.png`, mimeType: 'image/png', buffer: pngBuffer(4 + n, 4) }));
    for (const [label, path, viewport, opts] of [['iPhone', '/owned.html', IPHONE, { contextOptions: TOUCH }], ['PC', '/index.html', { width: 1440, height: 700 }, {}]]) {
        const ctx = await openPage(browser, path, { viewport, ...opts });
        const { page } = ctx;
        if (label === 'PC') { await waitAppStarted(page); if (await page.locator('#profile-modal:not([hidden])').count()) await page.keyboard.press('Escape'); }
        else await page.waitForSelector('#owned-list-view:not([hidden])', { timeout: 10000 });
        await page.waitForSelector('#owned-quickfab:not([hidden])');
        await page.click('#owned-quickfab');
        await page.waitForSelector('#owned-factures-modal:not([hidden])');
        await page.setInputFiles('#owned-factures-modal [data-fm-file-input]', files);
        await page.waitForTimeout(1200);
        await page.evaluate(() => { const box = document.querySelector('#owned-factures-modal .owned-modal'); box.scrollTo({ top: box.scrollHeight, behavior: 'instant' }); });
        await page.waitForTimeout(250);
        await step(`${label} : 3 factures déposées, défilé jusqu'en bas → la croix reste visible et cliquable`, async () => {
            assert.deepEqual(await closeButtonState(page), { inView: true, clickable: true });
        });
        await shot(page, `bug-fermer-factures-${label.toLowerCase()}`);
        await step(`${label} : la croix ferme la fenêtre`, async () => {
            await page.locator('#owned-factures-modal [data-close-modal]').click();
            await page.waitForSelector('#owned-factures-modal', { state: 'hidden', timeout: 3000 });
        });
        if (label === 'iPhone') {
            await step('iPhone : le titre de la fenêtre réserve la zone de l\'encoche (safe-area-inset-top)', async () => {
                const found = await page.evaluate(() => [...document.styleSheets].some((sh) => { try { return [...sh.cssRules].some(function walk(r) { return (r.cssRules && [...r.cssRules].some(walk)) || (r.selectorText === '.owned-fm > .owned-modal-head' && /safe-area-inset-top/.test(r.cssText)); }); } catch { return false; } }));
                assert.equal(found, true);
            });
        }
        await finish(ctx, `Fermer factures ${label}`);
    }
}

const SCENARIOS = { F2: scenarioF2, A1: scenarioA1, T1: scenarioT1, X1: scenarioX1, F3: scenarioF3, F1: scenarioF1, F4: scenarioF4, FERMER_FACTURES: scenarioFermerFactures };
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
