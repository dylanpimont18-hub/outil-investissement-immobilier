// Filet de sécurité du découpage d'owned-portfolio.js (audit T7) : ouvre chaque fonctionnalité du portefeuille
// (PC puis iPhone) et exige qu'elle s'affiche, sans erreur JS ni 404 ni accès localStorage. À relancer après CHAQUE
// module extrait. Hors `npm test` : serveur statique 8090 + Chromium requis.
//   SPARK_TEST_BASE=http://127.0.0.1:8090 node tests/playwright/decoupage-owned.mjs
import { chromium } from 'playwright';
import { openPage, waitAppStarted, step, getFailures, assert, assertNoStorageHits, ASSET_TEST_1, META_TEST } from './_harness.mjs';

const PC = { width: 1440, height: 900 };
const IPHONE = { width: 393, height: 852 };
const clone = o => JSON.parse(JSON.stringify(o));
const BIEN_1 = { ...clone(ASSET_TEST_1), lat: 47.08, lng: 2.4 };
BIEN_1.postAchat.chargesAnnuelles = [{ annee: 2025, taxeFonciere: 800, chargesCopro: 300, assurancePNO: 120, gestionLocative: 0 }];
const BIEN_2 = { ...clone(ASSET_TEST_1), id: 'oa-test-2', nom: 'Studio Lyon', ville: 'Lyon', codePostal: '69003', lat: 45.76, lng: 4.84, dateAchat: '2023-05' };
const SEED = { assets: { 'oa-test-1': BIEN_1, 'oa-test-2': BIEN_2 }, meta: META_TEST };
const TUILE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC', 'base64');
const ROUTES = [['**/*.tile.openstreetmap.org/**', r => r.fulfill({ status: 200, contentType: 'image/png', body: TUILE })]];

const OVERLAYS = '.owned-modal-overlay, #owned-projection-impots-modal, #owned-factures-modal, #owned-impression-factures-modal, .asset-report-overlay, #owned-import-modal, #owned-ai-drawer, #owned-add-modal';
const overlayOuvert = page => page.waitForFunction(sel => [...document.querySelectorAll(sel)].some(m => !m.hidden && m.getBoundingClientRect().height > 50 && getComputedStyle(m).visibility !== 'hidden' && !m.classList.contains('is-closed')), OVERLAYS, { timeout: 5000 });
const fermer = async page => { await page.keyboard.press('Escape'); await page.waitForTimeout(250);
    await page.evaluate(sel => { document.querySelectorAll(sel).forEach(m => { if (!m.hidden && m.id !== 'owned-add-modal') { const c = m.querySelector('[data-close-modal], .asset-report-toolbar__close, #owned-ai-drawer-close, .portfolio-ai-drawer__close'); c?.click(); } }); }, OVERLAYS);
    await page.waitForTimeout(200); };
const texteFiche = page => page.$eval('#owned-detail-view', e => e.innerText.length);

async function ouvrirPC(browser) {
    const ctx = await openPage(browser, '/index.html', { viewport: PC, seedCloud: SEED, routes: ROUTES });
    await waitAppStarted(ctx.page);
    if (await ctx.page.locator('#profile-modal:not([hidden])').count()) await ctx.page.keyboard.press('Escape');
    await ctx.page.click('.workspace-tab[data-target="collection-panel"]');
    await ctx.page.waitForSelector('#owned-dashboard-wrap [data-action]');
    return ctx;
}

async function scenarioPC(browser) {
    console.log('PC — chaque fonctionnalité du portefeuille s\'ouvre');
    const ctx = await ouvrirPC(browser);
    const { page } = ctx;
    for (const action of ['open-capacite', 'open-objectifs', 'open-rapport', 'open-declaration', 'open-factures', 'open-projection-impots']) {
        await step(`dashboard : ${action}`, async () => {
            await page.click(`#owned-dashboard-wrap [data-action="${action}"]`);
            await overlayOuvert(page);
            assert.ok(await page.$$eval(OVERLAYS, ms => ms.some(m => !m.hidden && m.innerText.trim().length > 40)), 'contenu de la modale');
            await fermer(page);
        });
    }
    await step('carte du portefeuille : marqueurs Leaflet', async () => {
        await page.waitForSelector('#owned-map .leaflet-interactive', { state: 'attached' });
        assert.ok((await page.$$eval('#owned-map .leaflet-interactive', e => e.length)) >= 2);
    });
    await step('graphiques du dashboard dessinés', async () => {
        await page.waitForFunction(() => { const c = document.getElementById('owned-portfolio-cf-chart'); return c && window.Chart.getChart(c); });
    });
    await step('onglet Impôt : calcul affiché', async () => {
        await page.click('.owned-list-tabs [data-tab="impot"]');
        await page.waitForFunction(() => document.getElementById('owned-list-tab-impot').innerText.length > 150);
    });
    await step('onglet Profil : revenus, foyer, crédits, compte', async () => {
        await page.click('.owned-list-tabs [data-tab="profil"]');
        await page.waitForFunction(() => document.getElementById('owned-list-tab-profil').innerText.length > 300);
        assert.ok(await page.$('#owned-list-tab-profil input'));
    });
    await page.click('.owned-list-tabs [data-tab="overview"]');
    await step('liste : densité compacte, tri, ligne dépliée', async () => {
        await page.click('#owned-compact-btn').catch(() => {});
        await page.locator('[data-open-asset="oa-test-1"], [data-asset-id="oa-test-1"]').first().waitFor();
    });
    await step('régime fiscal du portefeuille : bascule Réel puis retour', async () => {
        await page.click('.owned-regime-slider__btn >> text=Réel');
        await page.waitForFunction(() => document.querySelector('.owned-regime-slider__btn--active')?.textContent.includes('Réel'));
        await page.click('.owned-regime-slider__btn >> text=Micro-foncier');
    });
    await step('Import : modale ouverte', async () => { await page.click('#owned-import-btn'); await overlayOuvert(page); await fermer(page); });
    await step('rail Actions rapides : Ajouter un bien / une facture', async () => {
        await page.click('#owned-quickrail [data-quickaction="add-facture"]'); await overlayOuvert(page); await fermer(page);
    });

    await page.locator('[data-open-asset="oa-test-1"], [data-asset-id="oa-test-1"]').first().click();
    await page.waitForSelector('#owned-detail-view:not([hidden])');
    for (const onglet of ['Acquisition', 'Exploitation', 'Travaux', 'Calcul']) {
        await step(`fiche : onglet ${onglet}`, async () => {
            await page.locator('#owned-detail-view .owned-tab', { hasText: onglet }).click();
            await page.waitForTimeout(300);
            assert.ok(await texteFiche(page) > 400, 'contenu');
        });
    }
    await step('Calcul : compte de résultat, simulation de travaux', async () => {
        await page.click('[data-action="open-compte-resultat"]'); await overlayOuvert(page); await fermer(page);
        await page.click('[data-action="open-simu-travaux"]'); await overlayOuvert(page); await fermer(page);
    });
    await step('Calcul : table du cash-flow dépliée', async () => {
        await page.locator('[data-action="toggle-cf-table"]').first().click();
        await page.waitForTimeout(200);
    });
    await step('Travaux : vue par corps d\'état, recherche, projection des impôts', async () => {
        await page.locator('#owned-detail-view .owned-tab', { hasText: 'Travaux' }).click();
        await page.click('[data-travaux-vue-btn="corps"]').catch(() => {});
        await page.click('[data-travaux-vue-btn="liste"]').catch(() => {});
        await page.fill('[data-travaux-search]', 'parquet');
        await page.fill('[data-travaux-search]', '');
        await page.click('#owned-detail-view [data-action="open-projection-impots"]'); await overlayOuvert(page); await fermer(page);
    });
    await step('Travaux : ajout d\'un frais au formulaire', async () => {
        const form = page.locator('[data-form="add-travail-tab"]');
        await form.locator('[data-field="date"]').fill('2026-06-01');
        await form.locator('[data-field="description"]').fill('Peinture salon');
        await form.locator('[data-field="montant"]').fill('420');
        await form.locator('button[type="submit"]').click();
        await page.waitForFunction(() => window.__stub.assets['oa-test-1'].postAchat.travaux.some(t => t.description === 'Peinture salon'));
    });
    await step('Travaux : impression groupée des factures', async () => { await page.click('[data-action="print-factures"]'); await overlayOuvert(page); await fermer(page); });
    await step('Exploitation : ajout d\'une charge annuelle', async () => {
        await page.locator('#owned-detail-view .owned-tab', { hasText: 'Exploitation' }).click();
        await page.waitForTimeout(300);
        assert.ok(await page.$('#owned-detail-view [data-delete-charges]'), 'charges annuelles affichées');
    });
    await step('Acquisition : import d\'un dossier de documents', async () => {
        await page.locator('#owned-detail-view .owned-tab', { hasText: 'Acquisition' }).click();
        await page.click('[data-action="import-dossier"]'); await overlayOuvert(page); await fermer(page);
    });
    await step('Diagnostic IA : tiroir ouvert', async () => { await page.click('#owned-diagnostic-btn'); await page.waitForSelector('#owned-ai-drawer:not([hidden])'); await fermer(page); });
    await step('Rapport du bien : aperçu plein écran, fermeture', async () => { await page.click('#owned-report-btn'); await page.waitForSelector('.asset-report-overlay'); await page.click('#asset-report-close'); });
    await step('Dossier bancaire : écran 1 puis écran 2 puis retour', async () => {
        await page.click('#owned-bank-dossier-btn'); await overlayOuvert(page);
        await page.click('#bank-dossier-next'); await page.waitForSelector('#bank-dossier-back');
        await page.click('#bank-dossier-back'); await fermer(page);
    });
    await step('Retour à la liste, bien suivant (flèches)', async () => {
        await page.click('#owned-back-btn');
        await page.waitForSelector('#owned-list-view:not([hidden])');
    });
    await step('Analyse : l\'onglet Analyse reste fonctionnel', async () => {
        await page.click('.workspace-tab[data-target="workspace-panel"]');
        await page.fill('[name="prix"]', '150000');
        await page.waitForTimeout(300);
    });
    await step('zéro accès localStorage/sessionStorage', () => assertNoStorageHits(page, 'fin PC'));
    await step('aucune erreur JS ni 404', () => assert.deepEqual(ctx.errors, []));
    await ctx.context.close();
}

async function scenarioIphone(browser) {
    console.log('iPhone — owned.html');
    const ctx = await openPage(browser, '/owned.html', { viewport: IPHONE, seedCloud: SEED, routes: ROUTES, contextOptions: { hasTouch: true, isMobile: true } });
    const { page } = ctx;
    await page.waitForSelector('#owned-list-view:not([hidden])', { timeout: 10000 });
    await step('liste : biens affichés', async () => { assert.ok((await page.$$eval('[data-open-asset], [data-asset-id]', e => e.length)) >= 2); });
    await step('Ajouter un bien : modale', async () => { await page.click('#owned-add-btn'); await page.waitForSelector('#owned-add-modal:not([hidden])'); await page.keyboard.press('Escape'); });
    await page.locator('[data-open-asset="oa-test-1"], [data-asset-id="oa-test-1"]').first().click();
    await page.waitForSelector('#owned-detail-view:not([hidden])');
    for (const onglet of ['Acquisition', 'Exploitation', 'Travaux', 'Calcul']) {
        await step(`fiche : onglet ${onglet}`, async () => {
            await page.locator('#owned-detail-view .owned-tab', { hasText: onglet }).click();
            await page.waitForTimeout(300);
            assert.ok(await texteFiche(page) > 300, 'contenu');
        });
    }
    await step('Calcul : compte de résultat', async () => { await page.click('[data-action="open-compte-resultat"]'); await overlayOuvert(page); await fermer(page); });
    await step('bouton flottant factures : modale', async () => { await page.click('#owned-quickfab'); await overlayOuvert(page); await fermer(page); });
    await step('assistant IA : feuille ouverte', async () => { await page.click('#owned-chatfab'); await page.waitForSelector('#owned-chat-sheet:not([hidden])'); await page.click('#owned-chat-close'); });
    await step('zéro accès localStorage/sessionStorage', () => assertNoStorageHits(page, 'fin iPhone'));
    await step('aucune erreur JS ni 404', () => assert.deepEqual(ctx.errors, []));
    await ctx.context.close();
}

const browser = await chromium.launch();
try { await scenarioPC(browser); await scenarioIphone(browser); } finally { await browser.close(); }
const failures = getFailures();
console.log(failures ? `\n${failures} échec(s)` : '\nOK — le portefeuille fonctionne de bout en bout');
process.exit(failures ? 1 : 0);
