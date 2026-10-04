// Test navigateur du changement de mot de passe (onglet Profil du portefeuille, PC + iPhone).
//
// Prérequis : `python server.py` lancé (http://127.0.0.1:8080, ou autre port via SPARK_TEST_BASE),
// `npm install` fait, Chromium installé (`npx playwright install chromium`).
// Lancer : SPARK_TEST_BASE=http://127.0.0.1:8090 node tests/playwright/change-password.mjs
//
// owned-cloud.js est remplacé par un stub (page.route) : aucun appel Firebase réel, le vrai mot
// de passe du compte n'est jamais touché. Le stub enregistre les appels à cloudChangePassword et
// simule les réponses de la Cloud Function (succès, reconnexion ratée, erreurs serveur).
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE = process.env.SPARK_TEST_BASE || 'http://127.0.0.1:8080';

const STUB_SOURCE = `
const S = window.__stub = {
    assets: {
        'oa-test-1': {
            id: 'oa-test-1', nom: 'Rue des Lilas', ville: 'Bourges', codePostal: '18000', adresse: '',
            lat: null, lng: null, dateAchat: '2024-03',
            acquisition: { prix: 120000, fraisAgence: 0, fraisNotaire: 9000, loyerInitial: 650, surface: 45, typeBien: 'appartement',
                credit: { montant: 100000, duree: 20, taux: 3.2, assurance: 0.3, assuranceMode: 'initial' } },
            postAchat: { taxeFonciere: 800, chargesCopro: 0, gestionLocative: 0, assurancePNO: 120, travaux: [], notes: [] },
            scenarios: [
                { id: 'pessimiste', nom: 'Pessimiste', variables: { vacance: 8, regime: 'micro-foncier' } },
                { id: 'realiste', nom: 'Réaliste', variables: { vacance: 5, regime: 'micro-foncier' } },
                { id: 'optimiste', nom: 'Optimiste', variables: { vacance: 2, regime: 'micro-foncier' } }
            ],
            diagnosticHistory: []
        }
    },
    meta: { order: ['oa-test-1'], regime: 'micro-foncier' },
    authListeners: [],
    passwordCalls: [],
    passwordMode: 'ok'
};
const USER = { uid: 'u-test', email: 'test@example.com' };
const clone = v => JSON.parse(JSON.stringify(v));
export function watchAuth(cb) { S.authListeners.push(cb); setTimeout(() => cb(USER), 0); return () => {}; }
export function cloudSignIn() { return Promise.resolve(); }
export function cloudSignOut() { return Promise.resolve(); }
export async function cloudChangePassword(pwd) {
    S.passwordCalls.push(pwd);
    await new Promise(r => setTimeout(r, 50));
    if (S.passwordMode === 'invalid') { const e = new Error('Le mot de passe doit contenir entre 8 et 128 caractères'); e.code = 'functions/invalid-argument'; throw e; }
    if (S.passwordMode === 'notfound') { const e = new Error('NOT_FOUND'); e.code = 'functions/not-found'; throw e; }
    if (S.passwordMode === 'relogFail') return { relogged: false };
    // Reconnexion réussie : le vrai SDK redéclenche onAuthStateChanged, on le simule.
    S.authListeners.forEach(cb => setTimeout(() => cb({ ...USER }), 0));
    return { relogged: true };
}
export function watchOwnedAssets(cb) { setTimeout(() => cb(clone(S.assets)), 0); return () => {}; }
export function cloudSetAsset(id, data) { S.assets[id] = clone(data); return Promise.resolve(); }
export function cloudDeleteAssetDoc(id) { delete S.assets[id]; return Promise.resolve(); }
export function watchPortfolioMeta(cb) { setTimeout(() => cb(clone(S.meta)), 0); return () => {}; }
export function cloudSaveMeta(patch) { Object.assign(S.meta, patch); return Promise.resolve(); }
export async function cloudUploadDocument() { return 'x.png'; }
export function cloudDocumentUrl() { return Promise.resolve(''); }
export async function cloudUploadDocumentAs() {}
export async function cloudDeleteDocument() {}
export async function cloudDeleteAllDocuments() {}
export async function cloudExtraireFraisFacture() { throw new Error('not stubbed'); }
export async function cloudExtraireDossierBien() { throw new Error('not stubbed'); }
export async function cloudDiagnosticPortefeuille() { return { recommendations: [] }; }
export async function cloudChatPortefeuille() { return { reply: '' }; }
export async function cloudGeocode() { return null; }
`;

async function openPage(browser, path, viewport) {
    const context = await browser.newContext({ viewport });
    await context.addInitScript(() => {
        try {
            localStorage.setItem('investissementWebProfileConfigured', '1');
            localStorage.setItem('investissementWebProfileData', JSON.stringify({ name: 'Test', income: 40000, adults: 1, children: 0 }));
        } catch { /* stockage indisponible */ }
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', err => errors.push(`pageerror: ${err.message}`));
    page.on('console', msg => { if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`); });
    await page.route('**/owned-cloud.js', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_SOURCE }));
    await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__stub && window.__stub.authListeners.length > 0);
    return { page, context, errors };
}

const form = '[data-form="change-password"]';
const errorText = page => page.$eval(`${form} [data-password-error]`, el => el.hidden ? '' : el.textContent.trim());

async function fill(page, pwd, confirm) {
    await page.fill(`${form} input[name="password"]`, pwd);
    await page.fill(`${form} input[name="confirm"]`, confirm);
    await page.click(`${form} button[type="submit"]`);
}

async function scenario(page, label, screenshotsDir) {
    await page.click('.owned-list-tabs .owned-tab[data-tab="profil"]');
    await page.waitForSelector(`${form}`, { state: 'visible' });

    const caveat = await page.textContent('#owned-profil-content');
    assert.match(caveat, /test@example\.com/, `${label} : email du compte affiché`);
    const fields = await page.$$eval(`${form} input[type="password"]`, els => els.map(e => e.name));
    assert.deepEqual(fields, ['password', 'confirm'], `${label} : aucun champ "ancien mot de passe"`);
    console.log(`  ✓ section Compte visible, sans ancien mot de passe`);

    await fill(page, 'court', 'court');
    assert.match(await errorText(page), /au moins 8 caractères/);
    await fill(page, 'motdepasse1', 'motdepasse2');
    assert.match(await errorText(page), /ne correspondent pas/);
    assert.equal((await page.evaluate(() => window.__stub.passwordCalls)).length, 0, `${label} : aucun appel serveur si invalide`);
    console.log(`  ✓ validations locales (longueur, confirmation) sans appel serveur`);

    await page.evaluate(() => { window.__stub.passwordMode = 'notfound'; });
    await fill(page, 'nouveauMdp123', 'nouveauMdp123');
    await page.waitForFunction(() => {
        const el = document.querySelector('[data-form="change-password"] [data-password-error]');
        return el && !el.hidden && /non déployée/.test(el.textContent);
    });
    assert.equal(await page.$eval(`${form} button[type="submit"]`, b => b.disabled), false, `${label} : bouton réactivé après erreur`);
    console.log(`  ✓ erreur serveur affichée, bouton réactivé`);

    await page.evaluate(() => { window.__stub.passwordMode = 'ok'; });
    await fill(page, 'nouveauMdp123', 'nouveauMdp123');
    await page.waitForSelector('.toast, [class*="toast"]', { state: 'attached', timeout: 3000 }).catch(() => {});
    await page.waitForFunction(() => window.__stub.passwordCalls.length === 2);
    await page.waitForTimeout(300); // laisse passer le re-rendu déclenché par la reconnexion simulée
    assert.equal(await page.evaluate(() => window.__stub.passwordCalls.at(-1)), 'nouveauMdp123');
    assert.equal(await errorText(page), '', `${label} : pas d'erreur après succès`);
    assert.equal(await page.inputValue(`${form} input[name="password"]`), '', `${label} : champs vidés après succès`);
    const toastSeen = await page.evaluate(() => document.body.innerText.includes('Mot de passe changé'));
    assert.ok(toastSeen, `${label} : toast de confirmation`);
    assert.ok(await page.isVisible('.owned-list-tabs .owned-tab[data-tab="profil"]'), `${label} : toujours connecté`);
    console.log(`  ✓ succès : appel avec le nouveau mot de passe, champs vidés, toast, session conservée`);

    if (screenshotsDir) await page.screenshot({ path: `${screenshotsDir}/change-password-${label}.png`, fullPage: true });
}

const browser = await chromium.launch();
let failed = false;
for (const [label, path, viewport] of [
    ['pc', '/owned.html', { width: 1366, height: 900 }],
    ['index', '/index.html', { width: 1366, height: 900 }],
    ['iphone', '/owned.html', { width: 393, height: 852 }]
]) {
    console.log(`\n${label} — ${path}`);
    const { page, context, errors } = await openPage(browser, path, viewport);
    try {
        if (path === '/index.html') await page.click('.workspace-tab[data-target="collection-panel"]');
        await scenario(page, label, process.env.CP_SCREENSHOTS);
        assert.deepEqual(errors, [], `${label} : aucune erreur JS`);
        console.log('  ✓ aucune erreur JS');
    } catch (err) {
        failed = true;
        console.error(`  ✗ ${err.message}`);
        if (errors.length) console.error(errors.join('\n'));
    } finally {
        await context.close();
    }
}
await browser.close();
if (failed) process.exit(1);
console.log('\nOK');
