// Tests navigateur des corrections d'interface du bilan d'ergonomie du 2026-10-12 (tâche 1) :
// Échap sur toutes les modales (B4), fond des modales Import/Suppression (B1), police des chiffres
// (B6), bandeau mobile d'index.html (B10), bouton flottant (B11), cibles tactiles iPhone (B12),
// chevrons de l'Analyse, sélecteur d'année.
// Prérequis : `node scripts/serve-static.mjs 8090` lancé, `npm install`, `npx playwright install chromium`.
// Lancer : SPARK_TEST_BASE=http://127.0.0.1:8090 node tests/playwright/modales.mjs
// MO_SCREENSHOTS=<dir> enregistre des captures PNG. Hors `npm test` volontairement (serveur + navigateur).
import { chromium } from 'playwright';
import { assert, openPage, waitAppStarted, step, getFailures, ASSET_TEST_1, META_TEST } from './_harness.mjs';

const SHOTS = process.env.MO_SCREENSHOTS || '';
const shot = (page, name, opts = {}) => SHOTS ? page.screenshot({ path: `${SHOTS}/${name}.png`, ...opts }) : Promise.resolve();
const PC = { width: 1366, height: 900 };
const IPHONE = { width: 393, height: 852 };
const TOUCH = { hasTouch: true, isMobile: true };

// Un second frais (sans justificatif) et des lignes de profil supprimables : toutes les cibles mesurées existent.
const ASSET = JSON.parse(JSON.stringify(ASSET_TEST_1));
ASSET.postAchat.travaux.push({ id: 't-2', date: '2026-05-10', description: 'Peinture', montant: 1200, tag: 'deductible', commentaire: '', pdfFilename: '', credit: null, financeParCredit: false });
const META = JSON.parse(JSON.stringify(META_TEST));
META.profile.revenuHistorique = [{ annee: 2025, revenu: 38000 }, { annee: 2023, revenu: 35000 }];
META.profile.autresCredits = [{ id: 'c1', libelle: 'Auto', mensualite: 200 }];
const SEED = { assets: { 'oa-test-1': ASSET }, meta: META };

// Cibles cliquables visibles de moins de 44 px (largeur ou hauteur).
const measureSmallTargets = () => {
    const out = [];
    for (const el of document.querySelectorAll('button, a, [role=button], input[type=checkbox], input[type=radio], select')) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none') continue;
        if (r.width < 44 || r.height < 44) out.push(`${el.tagName.toLowerCase()}.${String(el.className || '').split(' ')[0]} « ${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 20)} » ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
    return out;
};
const isOpaque = color => color && color !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(color);

async function scenarioPC(browser) {
    console.log('\nPC — modales, police, chevrons');
    const { page, errors } = await openPage(browser, '/index.html', { viewport: PC, seedCloud: SEED });
    await waitAppStarted(page);

    await step('pas de bandeau mobile à 1366 px', async () => {
        assert.equal(await page.locator('#mobile-redirect-banner').count(), 0);
    });

    await step('Analyse vue complète : chevron ▸/▾ sur les blocs repliables + état vide du journal', async () => {
        await page.click('#btn-view-full');
        const res = await page.evaluate(() => {
            const sums = [...document.querySelectorAll('.analysis-block > summary')].filter(s => s.getBoundingClientRect().width);
            const journal = document.querySelector('.analysis-section--journal');
            return {
                count: sums.length,
                chevrons: sums.filter(s => { const a = getComputedStyle(s, '::after'); return a.content !== 'none' && parseFloat(a.width) >= 8 && a.borderRightStyle === 'solid'; }).length,
                closed: getComputedStyle(journal.querySelector('summary'), '::after').transform,
                empty: document.querySelector('#analysis-journal .journal-empty')?.textContent || ''
            };
        });
        assert.ok(res.count >= 5, `blocs repliables visibles : ${res.count}`);
        assert.equal(res.chevrons, res.count, 'chaque summary a son chevron');
        assert.equal(res.closed, 'matrix(0.707107, -0.707107, 0.707107, 0.707107, 0, 0)', 'chevron vers la droite (-45°) quand le bloc est replié');
        assert.match(res.empty, /Aucune note/);
        await page.locator('.analysis-section--journal > summary').scrollIntoViewIfNeeded();
        await shot(page, 'pc-analyse-chevrons');
        await page.click('.analysis-section--journal > summary');
        // transition de 150 ms sur la rotation ; ouvert = chevron vers le bas (45°)
        await page.waitForFunction(() => getComputedStyle(document.querySelector('.analysis-section--journal > summary'), '::after').transform === 'matrix(0.707107, 0.707107, -0.707107, 0.707107, 0, 0)', null, { timeout: 2000 });
        await page.locator('.analysis-section--journal').scrollIntoViewIfNeeded();
        await shot(page, 'pc-analyse-journal-ouvert');
    });

    await step('police des chiffres : IBM Plex Mono chargée depuis vendor/fonts (KPI du portefeuille)', async () => {
        await page.click('.workspace-tab[data-target="collection-panel"]');
        await page.waitForSelector('.owned-dashboard-kpi__value');
        const r = await page.evaluate(async () => {
            await document.fonts.ready;
            await document.fonts.load("12px 'IBM Plex Mono'");
            const kpi = document.querySelector('.owned-dashboard-kpi__value');
            return { check: document.fonts.check("12px 'IBM Plex Mono'"), family: getComputedStyle(kpi).fontFamily };
        });
        assert.equal(r.check, true);
        assert.match(r.family, /^"?IBM Plex Mono/);
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
        const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
        const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '.owned-dashboard-kpi__value' });
        const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
        assert.ok(fonts.some(f => /IBM Plex Mono/i.test(f.familyName)), 'police réellement utilisée : ' + JSON.stringify(fonts));
        await page.locator('.owned-dashboard-kpi__value').first().scrollIntoViewIfNeeded();
        await shot(page, 'pc-portefeuille-kpi');
    });

    await step('Import : fond opaque, Échap ferme, un onglet reste cliquable ensuite', async () => {
        await page.click('#owned-import-btn');
        await page.waitForSelector('#owned-import-modal:not([hidden])');
        const bg = await page.evaluate(() => getComputedStyle(document.querySelector('#owned-import-modal .owned-delete-modal__box')).backgroundColor);
        assert.ok(isOpaque(bg), `fond de la modale Import : ${bg}`);
        await shot(page, 'pc-import-modale');
        await page.keyboard.press('Escape');
        await page.waitForSelector('#owned-import-modal', { state: 'hidden' });
        await page.click('.owned-tab[data-tab="impot"]', { timeout: 3000 });
        await page.waitForSelector('#owned-impot-annee');
    });

    await step('sélecteur d année : la flèche ne recouvre plus le dernier chiffre (padding-right ≥ 28 px)', async () => {
        const pr = await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById('owned-impot-annee')).paddingRight));
        assert.ok(pr >= 28, `padding-right ${pr}`);
        await page.locator('#owned-impot-annee').scrollIntoViewIfNeeded();
        await shot(page, 'pc-impot-annee', { clip: await page.locator('.owned-impot-head').boundingBox() });
        await page.click('.owned-tab[data-tab="overview"]');
    });

    await step('Suppression : fond opaque, Échap ferme et oublie le bien en attente', async () => {
        await page.locator('[data-action="delete-owned"]').first().click();
        await page.waitForSelector('#owned-delete-modal:not([hidden])');
        const bg = await page.evaluate(() => getComputedStyle(document.querySelector('#owned-delete-modal .owned-delete-modal__box')).backgroundColor);
        assert.ok(isOpaque(bg), `fond de la modale Suppression : ${bg}`);
        await shot(page, 'pc-suppression-modale');
        await page.keyboard.press('Escape');
        await page.waitForSelector('#owned-delete-modal', { state: 'hidden' });
        assert.equal(await page.evaluate(() => document.getElementById('owned-delete-modal')._pendingId), null);
    });

    await step('Rapport : Échap ferme l aperçu même après un clic dans l iframe, les clics passent ensuite', async () => {
        await page.locator('[data-open-asset="oa-test-1"], [data-asset-id="oa-test-1"]').first().click();
        await page.waitForSelector('#owned-detail-view:not([hidden])');
        await page.click('#owned-report-btn');
        await page.waitForSelector('#asset-report-overlay');
        await page.waitForFunction(() => document.querySelector('#asset-report-overlay iframe')?.contentDocument?.readyState === 'complete');
        await page.frameLocator('#asset-report-overlay iframe').locator('body').click({ position: { x: 20, y: 20 } });
        await page.keyboard.press('Escape');
        await page.waitForSelector('#asset-report-overlay', { state: 'detached', timeout: 3000 });
        assert.equal(await page.evaluate(() => document.body.classList.contains('asset-report-open')), false);
        await page.click('.owned-tab[data-tab="travaux"]', { timeout: 3000 });
        await page.waitForSelector('#owned-tab-travaux:not([hidden])');
    });

    await step('zéro erreur JS, zéro accès storage', async () => {
        assert.deepEqual(errors, []);
        assert.deepEqual(await page.evaluate(() => window.__storageHits), []);
    });
    await page.context().close();
}

async function scenarioIPhone(browser) {
    console.log('\niPhone — owned.html');
    const { page, errors } = await openPage(browser, '/owned.html', { viewport: IPHONE, seedCloud: SEED, contextOptions: TOUCH });
    await page.waitForSelector('#owned-list-table [data-asset-id]');

    await step('« Ajouter un bien » : Échap ferme, la croix aussi, puis un onglet reste cliquable', async () => {
        await page.click('#owned-add-btn');
        await page.waitForSelector('#owned-add-modal:not([hidden])');
        const close = await page.locator('#owned-add-modal [data-close-add-modal]').boundingBox();
        assert.ok(close && close.width >= 44 && close.height >= 44, 'croix 44 × 44');
        assert.equal(await page.getAttribute('#owned-add-modal [data-close-add-modal]', 'aria-label'), 'Fermer');
        await page.fill('#owned-add-nom', 'Brouillon');
        await shot(page, 'm-ajout-bien');
        await page.keyboard.press('Escape');
        await page.waitForSelector('#owned-add-modal', { state: 'hidden' });
        assert.equal(await page.inputValue('#owned-add-nom'), '', 'formulaire remis à zéro');
        await page.click('#owned-add-btn');
        await page.click('#owned-add-modal [data-close-add-modal]');
        await page.waitForSelector('#owned-add-modal', { state: 'hidden' });
        await page.click('.owned-tab[data-tab="profil"]', { timeout: 3000 });
        await page.waitForSelector('#owned-list-tab-profil:not([hidden])');
    });

    await step('Profil : aucune cible tactile < 44 px', async () => {
        await page.waitForTimeout(200);
        const small = await page.evaluate(measureSmallTargets);
        await shot(page, 'm-profil', { fullPage: true });
        assert.deepEqual(small, []);
        await page.click('.owned-tab[data-tab="overview"]');
    });

    await page.click('#owned-list-table [data-asset-id]');
    await page.waitForSelector('#owned-detail-view:not([hidden])');
    for (const tab of ['exploitation', 'travaux', 'calcul']) {
        await step(`${tab} : aucune cible tactile < 44 px`, async () => {
            await page.click(`.owned-tab[data-tab="${tab}"]`);
            await page.waitForTimeout(250);
            const small = await page.evaluate(measureSmallTargets);
            await shot(page, `m-${tab}`, { fullPage: true });
            assert.deepEqual(small, []);
        });
    }

    await step('Travaux : les boutons flottants ne recouvrent ni « Montant » ni « Ajouter » en bas de page', async () => {
        await page.click('.owned-tab[data-tab="travaux"]');
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await page.waitForTimeout(250);
        const r = await page.evaluate(() => {
            const box = el => { const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
            const fabs = ['#owned-quickfab', '#owned-chatfab'].map(s => document.querySelector(s)).filter(e => e && e.getBoundingClientRect().width).map(box);
            const form = document.querySelector('#owned-tab-travaux [data-field="montant"], #owned-tab-travaux [name="montant"]');
            const submit = form?.closest('form')?.querySelector('[type="submit"]');
            return { fabs, montant: form && box(form), submit: submit && box(submit) };
        });
        const overlap = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
        assert.ok(r.montant && r.submit && r.fabs.length, JSON.stringify(r));
        for (const f of r.fabs) {
            assert.ok(!overlap(f, r.montant), 'FAB sur Montant ' + JSON.stringify(r));
            assert.ok(!overlap(f, r.submit), 'FAB sur Ajouter ' + JSON.stringify(r));
        }
        await shot(page, 'm-travaux-bas');
    });

    await step('zéro erreur JS, zéro accès storage', async () => {
        assert.deepEqual(errors, []);
        assert.deepEqual(await page.evaluate(() => window.__storageHits), []);
    });
    await page.context().close();
}

async function scenarioBandeau(browser) {
    console.log('\niPhone — index.html (bandeau)');
    const { page, errors } = await openPage(browser, '/index.html', { viewport: IPHONE, contextOptions: TOUCH });
    await waitAppStarted(page);

    await step('bandeau « Version iPhone » visible, lien /portefeuille, pas de redirection', async () => {
        await page.waitForSelector('#mobile-redirect-banner');
        assert.match(await page.textContent('#mobile-redirect-banner'), /Version iPhone : ouvrir le portefeuille/);
        assert.equal(await page.getAttribute('#mobile-redirect-banner a', 'href'), '/portefeuille');
        assert.match(page.url(), /index\.html$/);
        const r = await page.evaluate(() => ({
            banner: document.getElementById('mobile-redirect-banner').getBoundingClientRect().bottom,
            topbar: document.querySelector('.topbar').getBoundingClientRect().top
        }));
        assert.ok(r.topbar >= r.banner, `topbar sous le bandeau ${JSON.stringify(r)}`);
        await shot(page, 'm-index-bandeau');
    });

    await step('✕ retire le bandeau sans rien mémoriser', async () => {
        await page.click('#mobile-redirect-banner .mobile-redirect-banner__close');
        assert.equal(await page.locator('#mobile-redirect-banner').count(), 0);
        assert.equal(await page.evaluate(() => document.body.classList.contains('has-mobile-banner')), false);
        assert.deepEqual(await page.evaluate(() => window.__storageHits), []);
        assert.deepEqual(errors, []);
    });

    await step('absent dans la fenêtre d analyse détachée', async () => {
        await page.goto(page.url().replace(/index\.html.*$/, 'index.html?panel=analysis'), { waitUntil: 'load' });
        await page.waitForTimeout(500);
        assert.equal(await page.locator('#mobile-redirect-banner').count(), 0);
    });
    await page.context().close();
}

const browser = await chromium.launch();
try {
    await scenarioPC(browser);
    await scenarioIPhone(browser);
    await scenarioBandeau(browser);
} finally {
    await browser.close();
}
const failures = getFailures();
console.log(failures ? `\n${failures} échec(s)` : '\nTous les scénarios passent.');
process.exit(failures ? 1 : 0);
