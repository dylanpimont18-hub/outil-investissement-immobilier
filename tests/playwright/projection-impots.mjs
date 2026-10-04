// Test navigateur (Playwright) — coût d'un euro emprunté (calculette + lectures directes) et
// projection « Impôts des prochaines années » (effet des travaux déductibles).
//
// Prérequis : server.py lancé (port au choix via SPARK_TEST_BASE), `npm install`, `npx playwright
// install chromium`. Lancer : `SPARK_TEST_BASE=http://127.0.0.1:8090 node tests/playwright/projection-impots.mjs`.
// `PI_SCREENSHOTS=<dir>` enregistre des captures PNG. Hors `npm test` volontairement (serveur + navigateur).
//
// owned-cloud.js est remplacé par un stub (page.route) : aucun appel Firebase, aucune donnée réelle.

import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE = process.env.SPARK_TEST_BASE || 'http://127.0.0.1:8080';
const SHOTS = process.env.PI_SCREENSHOTS || '';
const Y = new Date().getFullYear();

const STUB_SOURCE = `
const S = window.__stub = {
    assets: {
        'oa-test-1': {
            id: 'oa-test-1', nom: 'Rue des Lilas', ville: 'Bourges', codePostal: '18000', adresse: '',
            lat: null, lng: null, dateAchat: '${Y - 2}-03',
            acquisition: { prix: 120000, fraisAgence: 0, fraisNotaire: 9000, loyerInitial: 650, surface: 45, typeBien: 'appartement',
                credit: { montant: 100000, duree: 20, taux: 3.2, assurance: 0.3, assuranceMode: 'initial' } },
            postAchat: { taxeFonciere: 800, chargesCopro: 0, gestionLocative: 0, assurancePNO: 120, vacance: 5,
                travaux: [
                    { id: 't-1', date: '${Y}-04-10', description: 'Réfection toiture', montant: 18000, tag: 'deductible', commentaire: '', pdfFilename: null, credit: null, financeParCredit: false },
                    { id: 't-2', date: '${Y}-06-02', description: 'Taxe foncière', montant: 800, tag: 'non-deductible', commentaire: '', pdfFilename: null, credit: null, financeParCredit: false }
                ], notes: [] },
            scenarios: [
                { id: 'pessimiste', nom: 'Pessimiste', variables: { vacance: 8, regime: 'micro-foncier' } },
                { id: 'realiste', nom: 'Réaliste', variables: { vacance: 5, regime: 'micro-foncier' } },
                { id: 'optimiste', nom: 'Optimiste', variables: { vacance: 2, regime: 'micro-foncier' } }
            ],
            diagnosticHistory: []
        },
        'oa-test-2': {
            id: 'oa-test-2', nom: 'Studio Lyon', ville: 'Lyon', codePostal: '69003', adresse: '',
            lat: null, lng: null, dateAchat: '${Y - 1}-01',
            acquisition: { prix: 90000, fraisAgence: 0, fraisNotaire: 7000, loyerInitial: 520, surface: 22, typeBien: 'appartement',
                credit: { montant: 0, duree: 0, taux: 0, assurance: 0, assuranceMode: 'initial' } },
            postAchat: { taxeFonciere: 500, chargesCopro: 0, gestionLocative: 0, assurancePNO: 100, vacance: 5, travaux: [], notes: [] },
            scenarios: [
                { id: 'pessimiste', nom: 'Pessimiste', variables: { vacance: 8, regime: 'micro-foncier' } },
                { id: 'realiste', nom: 'Réaliste', variables: { vacance: 5, regime: 'micro-foncier' } },
                { id: 'optimiste', nom: 'Optimiste', variables: { vacance: 2, regime: 'micro-foncier' } }
            ],
            diagnosticHistory: []
        }
    },
    meta: { order: ['oa-test-1', 'oa-test-2'], regime: 'micro-foncier' },
    assetListeners: []
};
const clone = v => JSON.parse(JSON.stringify(v));
const notify = () => setTimeout(() => S.assetListeners.forEach(cb => cb(clone(S.assets))), 0);
export function watchAuth(cb) { setTimeout(() => cb({ uid: 'u-test', email: 'test@example.com' }), 0); return () => {}; }
export function cloudSignIn() { return Promise.resolve(); }
export function cloudSignOut() { return Promise.resolve(); }
export function watchOwnedAssets(cb) { S.assetListeners.push(cb); setTimeout(() => cb(clone(S.assets)), 0); return () => {}; }
export function cloudSetAsset(id, data) { S.assets[id] = clone(data); notify(); return Promise.resolve(); }
export function cloudDeleteAssetDoc(id) { delete S.assets[id]; notify(); return Promise.resolve(); }
export function watchPortfolioMeta(cb) { setTimeout(() => cb(clone(S.meta)), 0); return () => {}; }
export function cloudSaveMeta(patch) { Object.assign(S.meta, patch); return Promise.resolve(); }
export async function cloudUploadDocument() { return 'x'; }
export function cloudDocumentUrl() { return Promise.resolve(''); }
export async function cloudUploadDocumentAs() {}
export async function cloudDeleteDocument() {}
export async function cloudDeleteAllDocuments() {}
export async function cloudExtraireFraisFacture() { throw new Error('not stubbed'); }
export async function cloudExtraireDossierBien() { throw new Error('not stubbed'); }
export async function cloudDiagnosticPortefeuille() { return { diagnostic: '' }; }
export async function cloudChatPortefeuille() { return { reply: '' }; }
export async function cloudGeocode() { return null; }
`;

async function openPage(browser, path, viewport) {
    const context = await browser.newContext({ viewport });
    await context.addInitScript(() => {
        try {
            localStorage.setItem('investissementWebProfileConfigured', '1');
            localStorage.setItem('investissementWebProfileData', JSON.stringify({ name: 'Test', income: 48000, adults: 1, children: 0 }));
        } catch { /* stockage indisponible */ }
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', err => errors.push(`pageerror: ${err.message}`));
    page.on('console', msg => { if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`); });
    await page.route('**/owned-cloud.js', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_SOURCE }));
    await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__stub && Object.keys(window.__stub.assets).length === 2);
    return { page, context, errors };
}

let failures = 0;
async function step(name, fn) {
    try { await fn(); console.log(`  ✓ ${name}`); }
    catch (err) { failures++; console.log(`  ✗ ${name}\n      ${err.message.split('\n').slice(0, 12).join('\n      ')}`); }
}
const shot = (page, name) => SHOTS ? page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false }) : Promise.resolve();

async function scenarioPC(browser) {
    console.log('\nPC — index.html');
    const { page, context, errors } = await openPage(browser, '/index.html', { width: 1440, height: 900 });

    await step('fichiers servis = code courant (pas un exe figé)', async () => {
        const html = await (await fetch(`${BASE}/index.html`)).text();
        assert.ok(html.includes('calculette-btn'), `le serveur ${BASE} ne sert pas le code courant`);
    });

    await step('Analyse : lecture directe « pour 1 € emprunté » sous Taux/Durée', async () => {
        await page.waitForSelector('#ratio-credit-readout:not([hidden])', { timeout: 5000 });
        const txt = await page.$eval('#ratio-credit-readout', e => e.textContent);
        assert.match(txt, /Pour 1 € emprunté/);
        assert.match(txt, /\d,\d{3} € remboursés/);
        assert.match(txt, /% d'intérêts/);
    });

    await step('Analyse : la lecture suit la saisie (taux 0 → 1,000 €)', async () => {
        await page.fill('#taux-input', '0');
        await page.waitForFunction(() => /1,000 €/.test(document.querySelector('#ratio-credit-readout')?.textContent || ''));
        await page.fill('#taux-input', '3.5');
        await page.waitForFunction(() => /1,392 €/.test(document.querySelector('#ratio-credit-readout')?.textContent || ''), null, { timeout: 3000 });
    });

    await step('calculette : bouton « € » → <dialog> ouvert, pré-rempli avec l\'étude (3,5 %), 1,392 €', async () => {
        await page.click('#calculette-btn');
        await page.waitForFunction(() => document.querySelector('#calculette')?.open === true);
        assert.equal(await page.$eval('#calc-taux', i => i.value), '3.5');
        assert.match(await page.$eval('#calc-ratio', e => e.textContent), /^1,392 €$/);
        assert.match(await page.$eval('#calc-interets', e => e.textContent), /39,2 % d'intérêts/);
        assert.equal(await page.$eval('#calc-alerte', e => e.hidden), true);
        await shot(page, 'calculette');
    });

    await step('calculette : hors bornes signalé, taux nul = 1,000 €, Fermer referme', async () => {
        await page.fill('#calc-taux', '50');
        await page.waitForFunction(() => !document.querySelector('#calc-alerte').hidden);
        assert.match(await page.$eval('#calc-alerte', e => e.textContent), /Hors bornes.*20 %/);
        await page.fill('#calc-taux', '0');
        await page.waitForFunction(() => /^1,000 €$/.test(document.querySelector('#calc-ratio').textContent));
        assert.equal(await page.$eval('#calc-alerte', e => e.hidden), true);
        await page.click('#calculette-fermer');
        await page.waitForFunction(() => document.querySelector('#calculette')?.open === false);
    });

    await step('Portefeuille : dashboard rendu avec le bouton « Impôts à venir »', async () => {
        await page.click('.workspace-tab[data-target="collection-panel"]');
        await page.waitForSelector('#owned-dashboard-wrap [data-action="open-projection-impots"]', { timeout: 8000 });
    });

    await step('dashboard → modale projection : 11 années, bandeau régime (micro-foncier), KPI', async () => {
        await page.click('#owned-dashboard-wrap [data-action="open-projection-impots"]');
        await page.waitForSelector('#owned-projection-impots-modal:not([hidden])');
        const rows = await page.$$eval('#owned-projection-impots-modal tbody tr', r => r.length);
        assert.equal(rows, 11);
        const first = await page.$eval('#owned-projection-impots-modal tbody tr:first-child td:first-child', e => e.textContent.trim());
        assert.equal(first, String(Y));
        const banner = await page.$eval('#owned-projection-impots-modal .owned-alert--info', e => e.textContent);
        assert.match(banner, /micro-foncier/);
        assert.match(banner, /régime foncier réel/);
        // 18 000 € de travaux déductibles saisis cette année sur Rue des Lilas → économie > 0.
        const eco = await page.$eval('#owned-projection-impots-modal .projection-impots__kpi-value', e => e.textContent);
        assert.match(eco, /^\+[\d\s ]+ €$/, `économie attendue positive, trouvé « ${eco} »`);
        const travaux = await page.$$eval('#owned-projection-impots-modal .projection-impots__kpi-value', els => els[1].textContent);
        assert.match(travaux, /18[\s ]000 €/);
        // Colonne « Déduit des salaires » de l'année en cours : déficit hors intérêts du FOYER
        // (les loyers du Studio Lyon compensent une partie des 18 000 €), donc < plafond 10 700 €.
        const salaires = await page.$eval('#owned-projection-impots-modal tbody tr:first-child td:nth-child(6)', e => e.textContent);
        assert.match(salaires, /^−[\d\s ]+ €$/, `déduction des salaires attendue, trouvé « ${salaires} »`);
        const montantSalaires = parseInt(salaires.replace(/[^\d]/g, ''), 10);
        assert.ok(montantSalaires > 0 && montantSalaires <= 10700, `déduction ${montantSalaires} hors plage`);
        await shot(page, 'projection-dashboard');
    });

    await step('simulation : 20 000 € en ' + (Y + 1) + ' → ligne marquée « simulés », économie en hausse', async () => {
        const ecoAvant = await page.$eval('#owned-projection-impots-modal .projection-impots__kpi-value', e => parseInt(e.textContent.replace(/[^\d-]/g, ''), 10));
        await page.fill('#owned-projection-impots-modal #proj-annee', String(Y + 1));
        await page.fill('#owned-projection-impots-modal #proj-montant', '20000');
        await page.waitForFunction(() => /simulés/.test(document.querySelector('#owned-projection-impots-modal tbody')?.textContent || ''));
        const row2 = await page.$eval('#owned-projection-impots-modal tbody tr:nth-child(2)', r => r.textContent);
        assert.match(row2, /20[\s ]000 € simulés/);
        const ecoApres = await page.$eval('#owned-projection-impots-modal .projection-impots__kpi-value', e => parseInt(e.textContent.replace(/[^\d-]/g, ''), 10));
        assert.ok(ecoApres > ecoAvant, `économie ${ecoApres} doit dépasser ${ecoAvant}`);
        await shot(page, 'projection-simulation');
        await page.click('#owned-projection-impots-modal [data-close-modal]');
        await page.waitForFunction(() => document.querySelector('#owned-projection-impots-modal').hidden === true);
    });

    await step('fiche d\'un bien → onglet Travaux : bouton « Impôts des prochaines années », bien présélectionné', async () => {
        const opened = await page.evaluate(() => {
            const el = document.querySelector('[data-open-asset="oa-test-2"]') || document.querySelector('[data-asset-id="oa-test-2"]');
            if (!el) return false;
            el.click();
            return true;
        });
        assert.ok(opened, 'aucun déclencheur d\'ouverture de fiche trouvé');
        await page.waitForSelector('#owned-detail-view:not([hidden])');
        await page.click('#owned-detail-view .owned-tab[data-tab="travaux"]');
        await page.waitForSelector('#owned-travaux-content [data-action="open-projection-impots"]', { timeout: 5000 });
        await page.click('#owned-travaux-content [data-action="open-projection-impots"]');
        await page.waitForSelector('#owned-projection-impots-modal:not([hidden])');
        assert.equal(await page.$eval('#owned-projection-impots-modal #proj-bien', s => s.value), 'oa-test-2');
        await page.click('#owned-projection-impots-modal [data-close-modal]');
    });

    await step('fiche d\'un bien → onglet Acquisition : lecture « pour 1 € emprunté » sous le crédit (20 ans à 3,2 %)', async () => {
        await page.evaluate(() => {
            const el = document.querySelector('[data-open-asset="oa-test-1"]') || document.querySelector('[data-asset-id="oa-test-1"]');
            el?.click();
        });
        await page.waitForSelector('#owned-detail-view:not([hidden])');
        // L'onglet Travaux est resté actif depuis l'étape précédente : revenir sur Acquisition.
        await page.click('#owned-detail-view .owned-tab[data-tab="acquisition"]');
        await page.waitForSelector('.ratio-credit-readout--owned', { timeout: 5000 });
        const txt = await page.$eval('.ratio-credit-readout--owned', e => e.textContent);
        assert.match(txt, /1,35\d € remboursés sur 20 ans/);
        assert.match(txt, /hors assurance/);
        await shot(page, 'ratio-credit-owned');
    });

    await step('aucune erreur JS sur toute la session PC', async () => {
        assert.deepEqual(errors, []);
    });
    await context.close();
}

async function scenarioMobile(browser) {
    console.log('\niPhone — owned.html');
    const { page, context, errors } = await openPage(browser, '/owned.html', { width: 393, height: 852 });

    await step('onglet Travaux d\'un bien : pas de bouton projection (simplification mobile volontaire)', async () => {
        const opened = await page.evaluate(() => {
            const el = document.querySelector('[data-open-asset="oa-test-1"]') || document.querySelector('[data-asset-id="oa-test-1"]');
            if (!el) return false;
            el.click();
            return true;
        });
        assert.ok(opened, 'aucun déclencheur d\'ouverture de fiche trouvé');
        await page.waitForSelector('#owned-detail-view:not([hidden])');
        await page.click('#owned-detail-view .owned-tab[data-tab="travaux"]');
        await page.waitForSelector('#owned-travaux-content [data-action="print-selection"]', { timeout: 5000 });
        assert.equal(await page.$('#owned-travaux-content [data-action="open-projection-impots"]'), null);
    });

    await step('aucune erreur JS sur la session mobile', async () => {
        assert.deepEqual(errors, []);
    });
    await context.close();
}

const browser = await chromium.launch();
try {
    await scenarioPC(browser);
    await scenarioMobile(browser);
} finally {
    await browser.close();
}
console.log(failures ? `\n${failures} échec(s)` : '\nALL PROJECTION/RATIO BROWSER TESTS PASSED');
process.exit(failures ? 1 : 0);
