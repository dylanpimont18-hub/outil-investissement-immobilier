// Test navigateur (Playwright) du chantier « CF unique » (docs/chantier-cf-unique.md) : un même bien
// affiche le MÊME CF de référence (12 prochains mois, hors frais ponctuels) dans la liste, le
// dashboard, la fiche (verdict), l'onglet Calcul et sur iPhone, avec la période écrite.
//
// Prérequis : `npm run serve` (port 8090, jamais 8080), Chromium installé. Lancer :
// `SPARK_TEST_BASE=http://127.0.0.1:8090 node tests/playwright/cf-unique.mjs` ; `CF_SCREENSHOTS=<dir>`
// enregistre des captures. Hors `npm test` (serveur + navigateur). Stubs cloud du harnais : aucun
// appel Firebase.
import { chromium } from 'playwright';
import { openPage, waitAppStarted, step, getFailures, assert } from './_harness.mjs';
import { computeOwnedAssetCF, resolveScenarioCourant, libellePeriodeCF } from '../../calculs.js';

const SHOTS = process.env.CF_SCREENSHOTS || '';
const now = new Date();
const Y = now.getFullYear();
const M = now.getMonth() + 1;
const ym = (annee, mois) => { const d = new Date(annee, mois - 1, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const scenarios = [
    { id: 'pessimiste', nom: 'Pessimiste', variables: { vacance: 8, regime: 'reel' } },
    { id: 'realiste', nom: 'Réaliste', variables: { vacance: 5, regime: 'reel' } },
    { id: 'optimiste', nom: 'Optimiste', variables: { vacance: 2, regime: 'reel' } },
];
const bien = (id, nom, dateAchat, travaux = []) => ({
    id, nom, ville: 'Bourges', codePostal: '18000', adresse: '', lat: null, lng: null, dateAchat,
    acquisition: { prix: 120000, fraisAgence: 0, fraisNotaire: 9000, loyerInitial: 750, surface: 45, typeBien: 'appartement',
        credit: { montant: 110000, duree: 20, taux: 3.5, assurance: 0.3, assuranceMode: 'initial' } },
    postAchat: { taxeFonciere: 900, chargesCopro: 40, gestionLocative: 0, assurancePNO: 120, vacance: 0, travaux, chargesAnnuelles: [], notes: [] },
    scenarios, diagnosticHistory: [],
});
const ASSETS = {
    'oa-ponctuel': bien('oa-ponctuel', 'Frais ponctuel', `${Y - 3}-01`,
        [{ id: 'f1', date: `${ym(Y, M)}-05`, description: 'Chaudière', montant: 2400, tag: 'non-deductible', commentaire: '', pdfFilename: null, credit: null, financeParCredit: false }]),
    'oa-credit': bien('oa-credit', 'Crédit travaux', `${Y - 3}-01`,
        [{ id: 'c1', date: `${Y - 1}-03-01`, description: 'Cuisine', montant: 12000, tag: 'non-deductible', commentaire: '', pdfFilename: null, financeParCredit: false, credit: { montant: 12000, duree: 10, taux: 4 } }]),
    'oa-recent': bien('oa-recent', 'Achat récent', ym(Y, M - 2)),
};
const PROFILE = { name: 'Test', income: 45000, adults: 2, children: 0, revenuHistorique: [], objectifCF: 1000, revaloAnnuelle: 2, autresCredits: [] };
const META = { order: Object.keys(ASSETS), regime: 'reel', profile: PROFILE };
const seedCloud = { assets: ASSETS, meta: META };

// CF de référence attendu, calculé en Node avec le même moteur.
const attendu = Object.fromEntries(Object.values(ASSETS).map(a => {
    const r = computeOwnedAssetCF(a, resolveScenarioCourant(a).variables, 0, 'reel', PROFILE);
    return [a.id, { cf: Math.round(r.cfNetNet), periode: libellePeriodeCF(r.periode) }];
}));
const euros = txt => { const m = String(txt).replace(/\s| | /g, '').match(/([+−-]?)(\d+)/); return m ? (m[1] === '−' || m[1] === '-' ? -1 : 1) * Number(m[2]) : NaN; };

const shot = async (page, nom) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${nom}.png`, fullPage: false }); };
const somme = Object.values(attendu).reduce((t, v) => t + v.cf, 0);

const browser = await chromium.launch();
try {
    console.log('PC (1440 x 900)');
    const { page, errors } = await openPage(browser, '/index.html', { viewport: { width: 1440, height: 900 }, seedCloud });
    await waitAppStarted(page);
    await page.click('.workspace-tab[data-target="collection-panel"]');
    await page.waitForSelector('#owned-list-table tr[data-asset-id]', { timeout: 8000 });

    await step('liste : vue « 12 mois » par défaut, CF de référence de chaque bien, colonne libellée', async () => {
        assert.match(await page.locator('#owned-list-table .owned-year-btn--active').innerText(), /12 mois/);
        assert.match(await page.locator('#owned-list-table thead').innerText(), /CF NET-NET\/MOIS \(12 MOIS\)/i);
        for (const [id, v] of Object.entries(attendu)) {
            const ligne = await page.locator(`#owned-list-table tr[data-asset-id="${id}"]`).innerText();
            assert.ok(ligne.includes(`${v.cf} €`), `${id} : ${v.cf} € attendu dans « ${ligne.replace(/\s+/g, ' ')} »`);
        }
        await shot(page, 'pc-liste');
    });

    await step('dashboard et bandeau KPI : total = somme des CF de référence, période écrite', async () => {
        const dash = await page.locator('#owned-dashboard-wrap').innerText();
        assert.match(dash, /CF NET-NET \/ MOIS · 12 PROCHAINS MOIS/i);
        assert.ok(dash.includes(`${somme} €`), `total ${somme} € attendu dans le dashboard`);
        const kpi = await page.locator('#owned-kpi-banner').innerText();
        assert.ok(kpi.includes(`${somme} €`), `total ${somme} € attendu dans le bandeau`);
        for (const [id, v] of Object.entries(attendu)) {
            const nom = ASSETS[id].nom;
            if (v.cf < -100) assert.ok(dash.includes(`${nom} — CF négatif : ${v.cf} €/mois`), `alerte ${nom} au CF de référence`);
        }
        await page.locator('#owned-dashboard-wrap').scrollIntoViewIfNeeded();
        await shot(page, 'pc-dashboard');
    });

    for (const id of ['oa-recent', 'oa-ponctuel']) {
        await step(`fiche ${ASSETS[id].nom} : verdict et onglet Calcul = CF de référence, période écrite`, async () => {
            if (await page.locator('#owned-back-btn').isVisible()) await page.click('#owned-back-btn');
            await page.waitForSelector(`#owned-list-table tr[data-asset-id="${id}"]`);
            await page.click(`#owned-list-table tr[data-asset-id="${id}"] .owned-table-name`);
            await page.waitForSelector('#owned-verdict .owned-verdict__grid', { timeout: 8000 });
            const verdict = await page.locator('#owned-verdict').innerText();
            assert.ok(verdict.toUpperCase().includes(attendu[id].periode.toUpperCase()), `période dans le verdict : ${verdict}`);
            assert.ok(verdict.includes(`${attendu[id].cf} €`), `verdict ${attendu[id].cf} € : ${verdict}`);
            await page.click('.owned-tab[data-tab="calcul"]');
            await page.waitForSelector('#owned-calcul-top .owned-synthese__cards');
            const calcul = await page.locator('#owned-calcul-top').innerText();
            assert.ok(calcul.includes(`${attendu[id].cf} €/mois`), `carte CF après impôt ${attendu[id].cf} €/mois`);
            assert.match(calcul, /moyenne des 12 prochains mois/);
            assert.ok(calcul.toUpperCase().includes(`DÉCOMPOSITION DU CF — ${attendu[id].periode}`.toUpperCase()), 'titre du détail avec la période');
            await shot(page, `pc-fiche-${id}`);
        });
    }

    await step("fiche Achat récent : la vue An 1 dit l'année et les mois détenus", async () => {
        if (await page.locator('#owned-back-btn').isVisible()) await page.click('#owned-back-btn');
        await page.click('#owned-list-table tr[data-asset-id="oa-recent"] .owned-table-name');
        await page.waitForSelector('#owned-verdict [data-verdict-year="1"]');
        await page.click('#owned-verdict [data-verdict-year="1"]');
        await page.waitForFunction(() => /AN 1 · \d{4}, \d+ MOIS DÉTENUS/i.test(document.querySelector('#owned-verdict')?.innerText || ''));
        await page.click('#owned-verdict [data-verdict-year="actuel"]');
        await page.waitForFunction(() => /12 PROCHAINS MOIS/i.test(document.querySelector('#owned-verdict')?.innerText || ''));
    });

    await step('PC : aucune erreur JS', async () => assert.deepEqual(errors, []));

    console.log('iPhone (393 x 852)');
    const m = await openPage(browser, '/owned.html', { viewport: { width: 393, height: 852 }, seedCloud, contextOptions: { hasTouch: true, isMobile: true } });
    await m.page.waitForSelector('.owned-mobile-list__item[data-asset-id]', { timeout: 10000 });
    await step('iPhone : liste = CF de référence de chaque bien', async () => {
        for (const [id, v] of Object.entries(attendu)) {
            const cf = await m.page.locator(`.owned-mobile-list__item[data-asset-id="${id}"] .owned-mobile-list__cf`).innerText();
            assert.equal(euros(cf), v.cf, `${id} : ${cf}`);
        }
        await shot(m.page, 'iphone-liste');
    });
    await step("iPhone : onglet Calcul d'un bien = CF de référence", async () => {
        await m.page.click('.owned-mobile-list__item[data-asset-id="oa-credit"]');
        await m.page.click('.owned-tab[data-tab="calcul"]');
        await m.page.waitForSelector('#owned-calcul-top .owned-synthese__cards');
        const calcul = await m.page.locator('#owned-calcul-top').innerText();
        assert.ok(calcul.includes(`${attendu['oa-credit'].cf} €/mois`), `CF ${attendu['oa-credit'].cf} €/mois attendu`);
        await shot(m.page, 'iphone-calcul');
    });
    await step('iPhone : aucune erreur JS', async () => assert.deepEqual(m.errors, []));
} finally {
    await browser.close();
}
console.log(getFailures() ? `${getFailures()} échec(s)` : 'OK — CF unique vérifié dans le navigateur (PC + iPhone)');
process.exit(getFailures() ? 1 : 0);
