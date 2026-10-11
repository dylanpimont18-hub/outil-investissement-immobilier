// Tests navigateur (Playwright) de la version 100 % web — voir
// docs/superpowers/specs/2026-10-11-passage-tout-web-prompt.md, <verification>.
// Prérequis : `node scripts/serve-static.mjs 8090` lancé, `npm install`, `npx playwright install chromium`.
// Lancer : SPARK_TEST_BASE=http://127.0.0.1:8090 node tests/playwright/tout-web.mjs
// TW_SCREENSHOTS=<dir> enregistre des captures PNG. Hors `npm test` volontairement (serveur + navigateur).
import { chromium } from 'playwright';
import { BASE, assert, openPage, reloadWithStore, assertNoStorageHits, waitAppStarted, step, getFailures } from './_harness.mjs';

const SHOTS = process.env.TW_SCREENSHOTS || '';
const shot = (page, name) => SHOTS ? page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false }) : Promise.resolve();
const PC = { width: 1366, height: 900 };
const IPHONE = { width: 393, height: 852 };

async function scenarioImpression(browser, viewport, label) {
    console.log(`\nImpression — ${label}`);
    const { page, context, errors } = await openPage(browser, '/index.html', { viewport });
    await waitAppStarted(page);

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
        assert.ok(p.fontFaces > 0, '@font-face hissés dans le document (sinon polices de repli à l\'impression)');
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
        else { await assertNoStorageHits(page, 'navigation'); await page.goto(BASE + '/owned.html', { waitUntil: 'load' }); await page.waitForSelector('#owned-quickfab:not([hidden])'); }
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

    await step('zéro accès localStorage/sessionStorage', async () => {
        assert.deepEqual(await page.evaluate(() => window.__storageHits), []);
    });
    await step('aucune erreur JS', () => assert.deepEqual(errors, []));
    await context.close();
}

async function scenarioConnexion(browser, viewport, label) {
    console.log(`\nConnexion — ${label}`);
    const { page, context, errors } = await openPage(browser, '/index.html', { viewport, seedCloud: { user: null } });

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
        await waitAppStarted(page);
        assert.deepEqual(await page.evaluate(() => window.__stub.signIns.map(s => s.email)), ['test@example.com', 'test@example.com']);
    });

    await step('zéro accès localStorage/sessionStorage', async () => {
        assert.deepEqual(await page.evaluate(() => window.__storageHits), []);
    });
    await step('aucune erreur JS', () => assert.deepEqual(errors, []));
    await context.close();

    console.log(`\nConnexion owned.html — ${label}`);
    const o = await openPage(browser, '/owned.html', { viewport, seedCloud: { user: null } });
    await step('owned.html non connecté → #owned-auth-gate visible', async () => {
        await o.page.waitForSelector('#owned-auth-gate:not([hidden]) form#owned-auth-form', { timeout: 8000 });
        assert.equal(await o.page.isVisible('#owned-list-view'), false);
    });
    await step('zéro accès localStorage/sessionStorage', async () => {
        assert.deepEqual(await o.page.evaluate(() => window.__storageHits), []);
    });
    await step('aucune erreur JS', () => assert.deepEqual(o.errors, []));
    await o.context.close();
}

async function scenarioPreferences(browser, viewport, label) {
    console.log(`\nPréférences — ${label}`);
    const { page, context, errors } = await openPage(browser, '/index.html', { viewport });
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
        await assertNoStorageHits(page, 'rechargement');
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

    await step('zéro accès localStorage/sessionStorage', async () => {
        assert.deepEqual(await page.evaluate(() => window.__storageHits), []);
    });
    await step('aucune erreur JS', () => assert.deepEqual(errors, []));
    await context.close();
}

async function scenarioOnboarding(browser) {
    const seed = { meta: { order: ['oa-test-1'], regime: 'micro-foncier' } };

    console.log('\nOnboarding profil (Valider seul) — PC');
    {
        const { page, context, errors } = await openPage(browser, '/index.html', { viewport: PC, seedCloud: seed });
        await waitAppStarted(page);
        await step('sans profil cloud, Valider sans toucher un champ → portfolioMeta.profile créé, modale fermée', async () => {
            await page.waitForSelector('#profile-modal.open', { timeout: 5000 });
            assert.deepEqual(await page.evaluate(() => window.__stub.metaWrites), [], 'rien d écrit tant que rien n est validé');
            await page.click('#profile-save');
            await page.waitForFunction(() => window.__stub.meta.profile && typeof window.__stub.meta.profile === 'object');
            const income = await page.evaluate(() => window.__stub.meta.profile.income);
            assert.ok(Number.isFinite(income), `revenu du preset par défaut attendu, reçu : ${income}`);
            await page.waitForSelector('#profile-modal:not(.open)', { state: 'attached' });
        });
        await step('zéro accès localStorage/sessionStorage', async () => {
            assert.deepEqual(await page.evaluate(() => window.__storageHits), []);
        });
        await step('aucune erreur JS', () => assert.deepEqual(errors, []));
        await context.close();
    }

    console.log('\nOnboarding profil (saisie) — PC');
    {
        const { page, context, errors } = await openPage(browser, '/index.html', { viewport: PC, seedCloud: seed });
        await waitAppStarted(page);
        await step('saisie du revenu : l écho du snapshot ne réécrit pas le champ ni ne ferme la modale', async () => {
            await page.waitForSelector('#profile-modal.open', { timeout: 5000 });
            await page.fill('#profile-income', '3000');
            await page.waitForFunction(() => window.__stub.meta.profile && window.__stub.meta.profile.income === 36000);
            await page.waitForTimeout(300);
            assert.equal(await page.inputValue('#profile-income'), '3000');
            assert.equal(await page.isVisible('#profile-modal.open'), true, 'la modale reste ouverte pendant la saisie');
            assert.equal(await page.isVisible('#profile-skip'), true, 'onboarding non terminé : « Plus tard » toujours proposé');
        });
        await step('Valider ferme la modale', async () => {
            await page.click('#profile-save');
            await page.waitForSelector('#profile-modal:not(.open)', { state: 'attached' });
        });
        await step('zéro accès localStorage/sessionStorage', async () => {
            assert.deepEqual(await page.evaluate(() => window.__storageHits), []);
        });
        await step('aucune erreur JS', () => assert.deepEqual(errors, []));
        await context.close();
    }
}

async function scenarioEtudes(browser, viewport, label) {
    console.log(`\nÉtudes — ${label}`);
    const { page, context, errors } = await openPage(browser, '/index.html', { viewport });
    await waitAppStarted(page);

    await step('saisie → une seule écriture settings/analysis après 1,5 s d inactivité', async () => {
        await page.fill('#variables-form [name="nom-bien"]', 'Studio test');
        await page.fill('#variables-form [name="prix"]', '150000');
        await page.fill('#variables-form [name="loyer"]', '750');
        await page.waitForTimeout(700);
        assert.equal(await page.evaluate(() => window.__store.writes.filter(w => w[0] === 'analysis').length), 0, 'pas encore écrit (débounce)');
        await page.waitForFunction(() => window.__store.settings.analysis?.variablesData?.prix === 150000, null, { timeout: 4000 });
        const writes = await page.evaluate(() => window.__store.writes.filter(w => w[0] === 'analysis').length);
        assert.equal(writes, 1, `écritures analysis : ${writes}`);
        assert.ok(await page.evaluate(() => Number.isFinite(window.__store.settings.analysis.updatedAt)));
    });

    await step('Sauvegarder → studies/{id} avec id, variablesData, createdAt, updatedAt', async () => {
        await page.click('#save-asset');
        await page.waitForFunction(() => Object.keys(window.__store.studies).length === 1);
        const study = await page.evaluate(() => Object.values(window.__store.studies)[0]);
        assert.match(study.id, /^asset-/);
        assert.equal(study.variablesData['nom-bien'], 'Studio test');
        assert.ok(study.createdAt > 0 && study.updatedAt >= study.createdAt);
        await page.waitForFunction(id => window.__store.settings.analysis?.activeAssetId === id, study.id, { timeout: 4000 });
    });

    await step('rechargement → étude et saisie reviennent du cloud, aucune écriture', async () => {
        await reloadWithStore(page, context);
        await waitAppStarted(page);
        assert.equal(await page.inputValue('#variables-form [name="nom-bien"]'), 'Studio test');
        assert.equal(await page.inputValue('#variables-form [name="prix"]'), '150000');
        assert.match(await page.textContent('#asset-status-bar'), /À jour/);
        await page.waitForTimeout(800);
        assert.deepEqual(await page.evaluate(() => window.__store.writes), []);
        await shot(page, `etudes-${label}`);
    });

    await step('snapshot distant plus ancien pendant la frappe → la saisie locale reste', async () => {
        await page.fill('#variables-form [name="prix"]', '160000');
        // Un autre appareil pousse une vieille valeur avant la fin du débounce local
        await page.evaluate(() => window.__store.listeners.analysis.forEach(cb => cb({ variablesData: { prix: 99999 }, activeAssetId: null, updatedAt: 1 })));
        await page.waitForTimeout(100);
        assert.equal(await page.inputValue('#variables-form [name="prix"]'), '160000');
        await page.waitForFunction(() => window.__store.settings.analysis?.variablesData?.prix === 160000, null, { timeout: 4000 });
    });

    await step('snapshot distant au repos → appliqué', async () => {
        await page.evaluate(() => window.__store.listeners.analysis.forEach(cb => cb({ ...window.__store.settings.analysis, variablesData: { ...window.__store.settings.analysis.variablesData, loyer: 800 }, updatedAt: Date.now() })));
        await page.waitForFunction(() => document.querySelector('#variables-form [name="loyer"]').value === '800', null, { timeout: 2000 });
    });

    await step('masquage de l onglet → flush immédiat', async () => {
        await page.fill('#variables-form [name="loyer"]', '820');
        await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
        await page.waitForFunction(() => window.__store.settings.analysis?.variablesData?.loyer === 820, null, { timeout: 500 });
        await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); });
    });

    await step('zéro accès localStorage/sessionStorage', async () => {
        assert.deepEqual(await page.evaluate(() => window.__storageHits), []);
    });
    await step('aucune erreur JS', () => assert.deepEqual(errors, []));
    await context.close();
}

async function scenarioDeuxFenetres(browser) {
    console.log('\nDeux fenêtres — PC');
    const { page, context, errors } = await openPage(browser, '/index.html', { viewport: PC });
    await waitAppStarted(page);
    const popup = await context.newPage();
    const popupErrors = [];
    popup.on('pageerror', err => popupErrors.push(err.message));
    await popup.goto(`${BASE}/index.html?panel=analysis`, { waitUntil: 'load' });
    await waitAppStarted(popup);

    await step('la fenêtre d analyse suit la frappe sans attendre le débounce', async () => {
        await page.fill('#variables-form [name="nom-bien"]', 'Maison sync');
        await popup.waitForFunction(() => /Maison sync/.test(document.getElementById('topbar-study-name')?.textContent || ''), null, { timeout: 1000 });
        assert.equal(await popup.isVisible('#collection-panel'), false, 'fenêtre détachée : pas de portefeuille');
    });

    await step('thème basculé dans la fenêtre principale → appliqué dans la fenêtre d analyse', async () => {
        await page.click('#theme-toggle');
        await popup.waitForFunction(() => document.documentElement.dataset.theme === 'light', null, { timeout: 1000 });
    });

    await step('zéro accès localStorage/sessionStorage', async () => {
        assert.deepEqual(await page.evaluate(() => window.__storageHits), []);
        assert.deepEqual(await popup.evaluate(() => window.__storageHits), []);
    });
    await step('aucune erreur JS dans les deux fenêtres', () => { assert.deepEqual(errors, []); assert.deepEqual(popupErrors, []); });
    await context.close();
}

async function scenarioPrefsPortefeuille(browser) {
    console.log('\nPréférences portefeuille — owned.html iPhone');
    const { page, context, errors } = await openPage(browser, '/owned.html', { viewport: IPHONE });
    await page.waitForSelector('#owned-list-view:not([hidden])', { timeout: 8000 });

    await step('chargement : aucune écriture', async () => {
        await page.waitForTimeout(800);
        assert.deepEqual(await page.evaluate(() => window.__store.writes), []);
    });

    await step('densité compacte → prefs.ownedCompact, conservée après rechargement', async () => {
        // Bouton masqué en CSS sur owned.html (.shell--owned) : clic programmatique sur le vrai handler.
        await page.evaluate(() => document.getElementById('owned-density-btn').click());
        await page.waitForFunction(() => window.__store.settings.prefs?.ownedCompact === true);
        await reloadWithStore(page, context);
        await page.waitForSelector('#owned-list-view:not([hidden])', { timeout: 8000 });
        assert.equal(await page.evaluate(() => window.__store.settings.prefs.ownedCompact), true);
        // Bouton masqué en CSS sur owned.html (.shell--owned) : clic programmatique sur le vrai handler.
        await page.evaluate(() => document.getElementById('owned-density-btn').click());
        await page.waitForFunction(() => window.__store.settings.prefs?.ownedCompact === false, null, { timeout: 2000 });
    });

    await step('filtre d année d un bien → prefs.ownedYearFilters[id]', async () => {
        await page.locator('[data-open-asset="oa-test-1"], [data-asset-id="oa-test-1"]').first().click();
        await page.waitForSelector('#owned-detail-view:not([hidden])');
        await page.click('.owned-tab[data-tab="calcul"]');
        const btn = page.locator('[data-calcul-year]').nth(2);
        const year = await btn.getAttribute('data-calcul-year');
        await btn.click();
        await page.waitForFunction(y => window.__store.settings.prefs?.ownedYearFilters?.['oa-test-1'] === Number(y), year);
    });

    await step('modale factures : dernier bien mémorisé dans prefs.facturesLastAsset', async () => {
        await page.click('#owned-quickfab');
        await page.waitForSelector('#owned-factures-modal:not([hidden])');
        await page.selectOption('[data-fm-asset]', 'oa-test-1');
        await page.waitForFunction(() => window.__store.settings.prefs?.facturesLastAsset === 'oa-test-1');
        await page.click('#owned-factures-modal [data-close-modal]');
    });

    await step('zéro accès localStorage/sessionStorage', async () => {
        assert.deepEqual(await page.evaluate(() => window.__storageHits), []);
    });
    await step('aucune erreur JS', () => assert.deepEqual(errors, []));
    await context.close();
}

async function scenarioExportImport(browser) {
    console.log('\nExport / import — PC');
    const { page, context, errors } = await openPage(browser, '/index.html', { viewport: PC });
    await waitAppStarted(page);
    await page.click('.workspace-tab[data-target="collection-panel"]');
    await page.waitForSelector('#owned-list-view:not([hidden])');

    let archiveName;
    await step('Export → téléchargement portefeuille-AAAA-MM-JJ.json + archive Storage identique', async () => {
        const [download] = await Promise.all([page.waitForEvent('download'), page.click('#owned-export-btn')]);
        assert.match(download.suggestedFilename(), /^portefeuille-\d{4}-\d{2}-\d{2}\.json$/);
        await page.waitForFunction(() => Object.keys(window.__store.archives).length === 1, null, { timeout: 4000 });
        archiveName = await page.evaluate(() => Object.keys(window.__store.archives)[0]);
        assert.equal(archiveName, download.suggestedFilename());
        const content = await page.evaluate(n => JSON.parse(window.__store.archives[n]), archiveName);
        assert.deepEqual(Object.keys(content), ['oa-test-1']);
        await page.waitForFunction(() => /✓/.test(document.getElementById('owned-export-btn').textContent));
    });

    await step('second export le même jour → suffixe -1', async () => {
        await Promise.all([page.waitForEvent('download'), page.click('#owned-export-btn')]);
        await page.waitForFunction(() => Object.keys(window.__store.archives).length === 2, null, { timeout: 4000 });
        assert.ok(await page.evaluate(() => Object.keys(window.__store.archives).some(n => /-1\.json$/.test(n))));
    });

    await step('Import : la liste montre les archives ; une archive sans nouveau bien → rien écrit', async () => {
        await page.click('#owned-import-btn');
        await page.waitForSelector('#owned-import-modal:not([hidden])');
        await page.waitForSelector('.owned-import-file-item');
        assert.equal(await page.$$eval('.owned-import-file-item', l => l.length), 2);
        await page.click(`.owned-import-file-item[data-filename="${archiveName}"]`);
        const before = await page.evaluate(() => Object.keys(window.__stub.assets).length);
        await page.click('#owned-import-modal-confirm');
        await page.waitForFunction(() => /déjà présents/.test(document.getElementById('owned-import-modal-confirm').textContent));
        assert.equal(await page.evaluate(() => Object.keys(window.__stub.assets).length), before);
    });

    await step('Import depuis un fichier : nouveau bien ajouté, bien existant non écrasé', async () => {
        await page.click('#owned-import-btn');
        await page.waitForSelector('#owned-import-modal:not([hidden])');
        const asset2 = { 'oa-test-1': { id: 'oa-test-1', nom: 'ÉCRASÉ ?' }, 'oa-import-9': { id: 'oa-import-9', nom: 'Importé', ville: 'Tours', acquisition: { prix: 50000, credit: {} }, postAchat: { travaux: [], notes: [] }, scenarios: [] } };
        await page.setInputFiles('#owned-import-file-input', { name: 'sauvegarde.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(asset2)) });
        await page.waitForFunction(() => !document.getElementById('owned-import-modal-confirm').disabled);
        await page.click('#owned-import-modal-confirm');
        await page.waitForFunction(() => Object.keys(window.__stub.assets).length === 2, null, { timeout: 4000 });
        assert.equal(await page.evaluate(() => window.__stub.assets['oa-test-1'].nom), 'Rue des Lilas');
        assert.equal(await page.evaluate(() => window.__stub.assets['oa-import-9'].nom), 'Importé');
        await shot(page, 'import-PC');
    });

    await step('fichier invalide (tableau) → message, rien écrit', async () => {
        await page.click('#owned-import-btn');
        await page.waitForSelector('#owned-import-modal:not([hidden])');
        await page.setInputFiles('#owned-import-file-input', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('[1,2,3]') });
        await page.waitForFunction(() => !document.getElementById('owned-import-modal-confirm').disabled);
        await page.click('#owned-import-modal-confirm');
        await page.waitForSelector('#app-toast.app-toast--negative');
        assert.equal(await page.evaluate(() => Object.keys(window.__stub.assets).length), 2);
        await page.click('#owned-import-modal-cancel');
    });

    const bienFichier = (id, nom) => ({ [id]: { id, nom, ville: 'Tours', acquisition: { prix: 50000, credit: {} }, postAchat: { travaux: [], notes: [] }, scenarios: [] } });

    await step('fichier choisi, archive cliquée, puis ligne fichier recliquée → le FICHIER est importé', async () => {
        await page.click('#owned-import-btn');
        await page.waitForSelector('.owned-import-file-item[data-filename]');
        await page.setInputFiles('#owned-import-file-input', { name: 'second.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bienFichier('oa-import-10', 'Du fichier'))) });
        await page.click(`.owned-import-file-item[data-filename="${archiveName}"]`);
        await page.click('.owned-import-file-item:not([data-filename])');
        await page.waitForSelector('.owned-import-file-item--selected:not([data-filename])');
        await page.click('#owned-import-modal-confirm');
        await page.waitForFunction(() => Object.keys(window.__stub.assets).length === 3, null, { timeout: 4000 });
        assert.equal(await page.evaluate(() => window.__stub.assets['oa-import-10'].nom), 'Du fichier');
    });

    await step('fichier sans `acquisition` → toast négatif, rien écrit', async () => {
        await page.click('#owned-import-btn');
        await page.waitForSelector('#owned-import-modal:not([hidden])');
        await page.setInputFiles('#owned-import-file-input', { name: 'sans-acq.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ x: { id: 'x', nom: 'sans acquisition' } })) });
        await page.click('#owned-import-modal-confirm');
        await page.waitForFunction(() => /aucun bien dans ce fichier/.test(document.getElementById('app-toast')?.textContent || ''), null, { timeout: 4000 });
        assert.equal(await page.evaluate(() => Object.keys(window.__stub.assets).length), 3);
        await page.click('#owned-import-modal-cancel');
    });

    await step('fichier choisi pendant « Chargement… » → la ligne survit au rendu des archives et s importe', async () => {
        // Clic + sélection de fichier dans le même tick synchrone, avant que cloudListArchives ne résolve.
        await page.evaluate(([name, content]) => {
            document.getElementById('owned-import-btn').click();
            const dt = new DataTransfer();
            dt.items.add(new File([content], name, { type: 'application/json' }));
            const input = document.getElementById('owned-import-file-input');
            input.files = dt.files;
            input.dispatchEvent(new Event('change', { bubbles: true }));
        }, ['course.json', JSON.stringify(bienFichier('oa-import-11', 'Pendant le chargement'))]);
        await page.waitForSelector('.owned-import-file-item[data-filename]');
        assert.equal(await page.$$eval('.owned-import-file-item--selected:not([data-filename])', l => l.length), 1);
        await page.click('#owned-import-modal-confirm');
        await page.waitForFunction(() => Object.keys(window.__stub.assets).length === 4, null, { timeout: 4000 });
        assert.equal(await page.evaluate(() => window.__stub.assets['oa-import-11'].nom), 'Pendant le chargement');
    });

    await step('zéro accès localStorage/sessionStorage', async () => {
        assert.deepEqual(await page.evaluate(() => window.__storageHits), []);
    });
    await step('aucune erreur JS', () => assert.deepEqual(errors, []));
    await context.close();

    console.log('\nExport avec Storage en panne — PC');
    const k = await openPage(browser, '/index.html', { viewport: PC, seedStore: { failUploadArchive: true } });
    await waitAppStarted(k.page);
    await k.page.click('.workspace-tab[data-target="collection-panel"]');
    await step('le téléchargement a lieu quand même + toast négatif', async () => {
        const [download] = await Promise.all([k.page.waitForEvent('download'), k.page.click('#owned-export-btn')]);
        assert.match(download.suggestedFilename(), /\.json$/);
        await k.page.waitForSelector('#app-toast.app-toast--negative', { timeout: 4000 });
    });
    await step('zéro accès localStorage/sessionStorage', async () => {
        assert.deepEqual(await k.page.evaluate(() => window.__storageHits), []);
    });
    await step('aucune erreur JS', () => assert.deepEqual(k.errors, []));
    await k.context.close();

    console.log('\nExport avec liste des archives en panne — PC');
    const l = await openPage(browser, '/index.html', { viewport: PC, seedStore: { failListArchives: true, archives: { 'portefeuille-2020-01-01.json': '{}' } } });
    await waitAppStarted(l.page);
    await l.page.click('.workspace-tab[data-target="collection-panel"]');
    await step('liste impossible : téléchargement oui, toast négatif, aucune archive écrite (pas d écrasement)', async () => {
        const [download] = await Promise.all([l.page.waitForEvent('download'), l.page.click('#owned-export-btn')]);
        assert.match(download.suggestedFilename(), /\.json$/);
        await l.page.waitForSelector('#app-toast.app-toast--negative', { timeout: 4000 });
        assert.deepEqual(await l.page.evaluate(() => window.__store.writes.filter(w => w[0] === 'archive')), []);
    });
    await step('import : message d erreur de chargement des archives', async () => {
        await l.page.click('#owned-import-btn');
        await l.page.waitForFunction(() => /Erreur lors du chargement des archives/.test(document.getElementById('owned-import-modal')?.textContent || ''), null, { timeout: 4000 });
    });
    await step('zéro accès localStorage/sessionStorage', async () => {
        assert.deepEqual(await l.page.evaluate(() => window.__storageHits), []);
    });
    await step('aucune erreur JS', () => assert.deepEqual(l.errors, []));
    await l.context.close();
}

const browser = await chromium.launch();
try {
    await scenarioDeuxFenetres(browser);
    await scenarioConnexion(browser, PC, 'PC');
    await scenarioConnexion(browser, IPHONE, 'iPhone');
    await scenarioPreferences(browser, PC, 'PC');
    await scenarioPreferences(browser, IPHONE, 'iPhone');
    await scenarioOnboarding(browser);
    await scenarioEtudes(browser, PC, 'PC');
    await scenarioEtudes(browser, IPHONE, 'iPhone');
    await scenarioImpression(browser, PC, 'PC');
    await scenarioImpression(browser, IPHONE, 'iPhone');
    await scenarioPrefsPortefeuille(browser);
    await scenarioExportImport(browser);
} finally {
    await browser.close();
}
console.log(getFailures() === 0 ? '\nOK — tous les scénarios passent' : `\nÉCHEC — ${getFailures()} étape(s) en erreur`);
process.exit(getFailures() === 0 ? 0 : 1);
