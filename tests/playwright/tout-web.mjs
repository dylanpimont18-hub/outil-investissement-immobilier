// Tests navigateur (Playwright) de la version 100 % web — voir
// docs/superpowers/specs/2026-10-11-passage-tout-web-prompt.md, <verification>.
// Prérequis : `node scripts/serve-static.mjs 8090` lancé, `npm install`, `npx playwright install chromium`.
// Lancer : SPARK_TEST_BASE=http://127.0.0.1:8090 node tests/playwright/tout-web.mjs
// TW_SCREENSHOTS=<dir> enregistre des captures PNG. Hors `npm test` volontairement (serveur + navigateur).
import { chromium } from 'playwright';
import { BASE, assert, openPage, reloadWithStore, waitAppStarted, step, getFailures } from './_harness.mjs';

const SHOTS = process.env.TW_SCREENSHOTS || '';
const shot = (page, name) => SHOTS ? page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false }) : Promise.resolve();
const PC = { width: 1366, height: 900 };
const IPHONE = { width: 393, height: 852 };

async function scenarioImpression(browser, viewport, label) {
    console.log(`\nImpression — ${label}`);
    const { page, context, errors } = await openPage(browser, '/index.html', { viewport, spyStorage: false,
        // Temporaire (jusqu en Tache 5-6) : main.js lit encore localStorage ; sans ce drapeau l onboarding profil bloque les clics.
        initScripts: [[() => localStorage.setItem('investissementWebProfileConfigured', '1'), null]] });
    await page.waitForSelector('#owned-quickfab:not([hidden])');

    await step('PDF décision : window.print sur un Shadow DOM titré d après le fichier', async () => {
        await page.fill('#variables-form [name="prix"]', '150000');
        await page.fill('#variables-form [name="loyer"]', '750');
        await page.click('#export-decision-pdf');
        await page.waitForFunction(() => window.__prints.length === 1, null, { timeout: 8000 });
        const p = await page.evaluate(() => window.__prints[0]);
        assert.equal(p.hostCount, 1);
        assert.equal(p.printing, true);
        assert.doesNotMatch(p.title, /\.pdf$/i);
        assert.ok(p.title.length > 3, `titre vide : ${p.title}`);
        assert.match(p.text, /Rapport d.analyse/);
        assert.ok(p.bg, 'fond non défini (variables :root perdues ?)');
        assert.equal(p.hasPageRule, true, '@page hissé dans le document');
        await page.waitForFunction(() => !document.getElementById('spark-print-root'));
        assert.equal(await page.title(), 'Spark Investissement | Analyse locative', 'titre restauré après afterprint');
    });

    await step('deux impressions successives → jamais deux hôtes', async () => {
        // Impressions sans afterprint (navigateur mobile capricieux) : on neutralise l'événement
        await page.evaluate(() => { const orig = window.print; window.print = () => { const h = document.getElementById('spark-print-root'); window.__prints.push({ hostCount: document.querySelectorAll('#spark-print-root').length, title: document.title, text: (h?.shadowRoot?.textContent || '').slice(0, 50) }); }; window.__restorePrint = orig; });
        await page.click('#export-decision-pdf');
        await page.waitForFunction(() => window.__prints.length === 2);
        await page.click('#export-decision-pdf');
        await page.waitForFunction(() => window.__prints.length === 3);
        const last = await page.evaluate(() => window.__prints[2]);
        assert.equal(last.hostCount, 1, 'l hôte précédent est nettoyé au nouvel appel');
        await page.evaluate(() => { window.print = window.__restorePrint; window.dispatchEvent(new Event('afterprint')); });
    });

    await step('dossier bancaire (PC) et rapport d un bien → print avec le bon titre', async () => {
        if (viewport.width > 600) await page.click('.workspace-tab[data-target="collection-panel"]');
        // Sur iPhone le portefeuille vit dans owned.html (index.html n y affiche pas le détail d un bien).
        else { await page.goto(BASE + '/owned.html', { waitUntil: 'load' }); await page.waitForSelector('#owned-quickfab:not([hidden])'); }
        await page.locator('[data-open-asset="oa-test-1"], [data-asset-id="oa-test-1"]').first().click();
        await page.waitForSelector('#owned-detail-view:not([hidden])');
        const before = await page.evaluate(() => window.__prints.length);
        if (viewport.width > 600) {
            await page.click('#owned-bank-dossier-btn');
            await page.waitForSelector('#owned-bank-dossier-modal:not([hidden])');
            await page.click('#bank-dossier-next');
            await page.click('#bank-dossier-generate');
            await page.waitForFunction(n => window.__prints.length === n + 1, before, { timeout: 8000 });
            const p = await page.evaluate(() => window.__prints.at(-1));
            assert.match(p.text, /Dossier bancaire/);
            assert.match(p.title, /ossier/);
            assert.ok(p.bg, 'fond non défini (variables :root perdues ?)');
        }
        const before2 = await page.evaluate(() => window.__prints.length);
        await page.click('#owned-report-btn');
        await page.waitForSelector('#asset-report-overlay');
        await page.click('#asset-report-pdf');
        await page.waitForFunction(n => window.__prints.length === n + 1, before2, { timeout: 8000 });
        const r = await page.evaluate(() => window.__prints.at(-1));
        assert.match(r.text, /Rue des Lilas/);
        assert.match(r.title, /lilas/i);
        await shot(page, `print-${label}`);
        await page.click('#asset-report-close');
    });

    await step('aucune erreur JS', () => assert.deepEqual(errors, []));
    await context.close();
}

async function scenarioConnexion(browser, viewport, label) {
    console.log(`\nConnexion — ${label}`);
    const { page, context, errors } = await openPage(browser, '/index.html', { viewport, seedCloud: { user: null }, spyStorage: false });

    await step('non connecté : gate plein écran sur index.html, rien d autre cliquable', async () => {
        await page.waitForSelector('#app-auth-gate:not([hidden]) form#owned-auth-form', { timeout: 8000 });
        assert.equal(await page.isVisible('#app-cloud-loading'), false, 'indicateur de chargement masqué tant que non connecté');
        const gateTitle = await page.$eval('#app-auth-gate h2', h => h.textContent);
        assert.match(gateTitle, /Connexion/);
        await shot(page, `gate-${label}`);
    });

    await step('mot de passe refusé → message, toujours sur le gate', async () => {
        await page.fill('#app-auth-gate [name="email"]', 'test@example.com');
        await page.fill('#app-auth-gate [name="password"]', 'mauvais');
        await page.click('#app-auth-gate button[type="submit"]');
        await page.waitForSelector('#app-auth-gate #owned-auth-error:not([hidden])');
        assert.equal(await page.isVisible('#app-auth-gate'), true);
    });

    await step('connexion → gate masqué, chargement puis application', async () => {
        await page.fill('#app-auth-gate [name="password"]', 'secret');
        await page.click('#app-auth-gate button[type="submit"]');
        await page.waitForSelector('#app-auth-gate[hidden]', { state: 'attached', timeout: 8000 });
        // Temporaire (Tâche 5 restaure waitAppStarted) : main.js n est pas encore migré.
        await page.waitForSelector('#owned-quickfab:not([hidden])');
        assert.deepEqual(await page.evaluate(() => window.__stub.signIns.map(s => s.email)), ['test@example.com', 'test@example.com']);
    });

    await step('aucune erreur JS', () => assert.deepEqual(errors, []));
    await context.close();

    console.log(`\nConnexion owned.html — ${label}`);
    const o = await openPage(browser, '/owned.html', { viewport, seedCloud: { user: null }, spyStorage: false });
    await step('owned.html non connecté → #owned-auth-gate visible', async () => {
        await o.page.waitForSelector('#owned-auth-gate:not([hidden]) form#owned-auth-form', { timeout: 8000 });
        assert.equal(await o.page.isVisible('#owned-list-view'), false);
    });
    await step('aucune erreur JS', () => assert.deepEqual(o.errors, []));
    await o.context.close();
}

async function scenarioPreferences(browser, viewport, label) {
    console.log(`\nPréférences — ${label}`);
    const { page, context, errors } = await openPage(browser, '/index.html', { viewport, spyStorage: false });
    await waitAppStarted(page);

    await step('chargement : thème sombre par défaut, AUCUNE écriture cloud', async () => {
        assert.equal(await page.getAttribute('html', 'data-theme'), 'dark');
        await page.waitForTimeout(800);
        assert.deepEqual(await page.evaluate(() => window.__store.writes), [], 'rien ne doit être écrit au simple chargement');
        assert.deepEqual(await page.evaluate(() => window.__stub.metaWrites), [], 'ni dans portfolioMeta');
    });

    await step('version lue depuis le fichier VERSION', async () => {
        await page.waitForFunction(() => /^v\d+\.\d+\.\d+$/.test(document.getElementById('topbar-version').textContent), null, { timeout: 5000 });
    });

    await step('thème → settings/prefs.theme, conservé après rechargement', async () => {
        await page.click('#theme-toggle');
        await page.waitForFunction(() => window.__store.settings.prefs?.theme === 'light');
        await reloadWithStore(page, context);
        await waitAppStarted(page);
        assert.equal(await page.getAttribute('html', 'data-theme'), 'light');
    });

    await step('prefs seedées appliquées sans flash : vue analyse complète, saisie guidée', async () => {
        // guidedMode (tuto) n'a pas de DOM dédié dans index.html (#guided-toggle absent) : on vérifie sparkMode.
        await context.addInitScript(`window.__seedStore = ${JSON.stringify({ settings: { prefs: { theme: 'light', analysisView: 'full', sparkMode: 'guided', screens: 1 } } })};`);
        await page.reload({ waitUntil: 'load' });
        await waitAppStarted(page);
        assert.equal(await page.getAttribute('#analysis-panel', 'data-analysis-view'), 'full');
        assert.equal(await page.getAttribute('#mode-btn-guided', 'aria-pressed'), 'true');
        await page.waitForTimeout(500);
        assert.deepEqual(await page.evaluate(() => window.__store.writes), [], 'appliquer des prefs ne réécrit rien');
        await shot(page, `prefs-${label}`);
    });

    await step('profil cloud → TMI/profil affichés, pas de modale d onboarding', async () => {
        assert.equal(await page.isVisible('#profile-modal.open'), false);
        assert.match(await page.textContent('#topbar-profile-label'), /Test/);
    });

    await step('aucune erreur JS', () => assert.deepEqual(errors, []));
    await context.close();
}

async function scenarioOnboarding(browser) {
    console.log('\nOnboarding profil — PC');
    const { page, context, errors } = await openPage(browser, '/index.html', { viewport: PC, spyStorage: false, seedCloud: { meta: { order: ['oa-test-1'], regime: 'micro-foncier' } } });
    await waitAppStarted(page);
    await step('sans profil cloud → modale profil ouverte, Valider pousse portfolioMeta.profile', async () => {
        await page.waitForSelector('#profile-modal.open', { timeout: 5000 });
        await page.fill('#profile-income', '3000');
        await page.click('#profile-save');
        await page.waitForFunction(() => window.__stub.meta.profile && window.__stub.meta.profile.income === 36000);
        await page.waitForSelector('#profile-modal:not(.open)', { state: 'attached' });
    });
    await step('aucune erreur JS', () => assert.deepEqual(errors, []));
    await context.close();
}

const browser = await chromium.launch();
try {
    await scenarioConnexion(browser, PC, 'PC');
    await scenarioConnexion(browser, IPHONE, 'iPhone');
    await scenarioPreferences(browser, PC, 'PC');
    await scenarioPreferences(browser, IPHONE, 'iPhone');
    await scenarioOnboarding(browser);
    await scenarioImpression(browser, PC, 'PC');
    await scenarioImpression(browser, IPHONE, 'iPhone');
} finally {
    await browser.close();
}
console.log(getFailures() === 0 ? '\nOK — tous les scénarios passent' : `\nÉCHEC — ${getFailures()} étape(s) en erreur`);
process.exit(getFailures() === 0 ? 0 : 1);
