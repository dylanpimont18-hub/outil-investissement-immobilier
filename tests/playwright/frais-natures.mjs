// Test navigateur des natures de frais « taxe foncière » / « frais d'emprunt » et de l'alerte
// doublon de taxe foncière (bilan d'ergonomie du 2026-10-12, B9).
// Prérequis : `node scripts/serve-static.mjs 8090` lancé, `npm install`, `npx playwright install chromium`.
// Lancer : SPARK_TEST_BASE=http://127.0.0.1:8090 node tests/playwright/frais-natures.mjs
// FN_SCREENSHOTS=<dir> enregistre des captures PNG. Hors `npm test` volontairement (serveur + navigateur).
import { chromium } from 'playwright';
import { assert, openPage, waitAppStarted, step, getFailures, ASSET_TEST_1, META_TEST, OWNED_CLOUD_STUB_SOURCE } from './_harness.mjs';

const SHOTS = process.env.FN_SCREENSHOTS || '';
const shot = (page, name, opts = {}) => SHOTS ? page.screenshot({ path: `${SHOTS}/${name}.png`, ...opts }) : Promise.resolve();
const PC = { width: 1366, height: 900 };

// Taxe foncière de 800 €/an dans les charges (ASSET_TEST_1.postAchat.taxeFonciere).
const SEED = { assets: { 'oa-test-1': JSON.parse(JSON.stringify(ASSET_TEST_1)) }, meta: META_TEST };

// Lecture IA simulée : la Cloud Function ne renvoie que deductible / non-deductible / a-classifier ;
// la nature fine est déduite côté client du fournisseur et du résumé.
const REPONSES_IA = [
    { fournisseur: 'SIP Bourges', description: 'Taxe foncière 2026', montant: 334, date: '2026-10-01', tagSuggestion: 'deductible', confiance: 'haute' },
    { fournisseur: 'Crédit Logement', description: 'Frais de garantie du prêt', montant: 750, date: '2026-08-20', tagSuggestion: 'deductible', confiance: 'haute' },
    { fournisseur: 'Cafpi', description: 'Frais de courtage', montant: 1250, date: '2026-08-20', tagSuggestion: 'non-deductible', confiance: 'haute' },
    // Faux amis de « garantie » / « caution » : ne doivent PAS devenir des frais d'emprunt.
    { fournisseur: 'Hiscox', description: 'Garantie loyers impayés', montant: 210, date: '2026-09-01', tagSuggestion: 'deductible', confiance: 'haute' },
    { fournisseur: 'Agence Martin', description: 'Dépôt de garantie restitué', montant: 650, date: '2026-09-02', tagSuggestion: 'non-deductible', confiance: 'haute' },
    { fournisseur: 'Banque Populaire', description: 'Frais de garantie Crédit Logement', montant: 480, date: '2026-08-21', tagSuggestion: 'deductible', confiance: 'haute' },
];
const STUB = OWNED_CLOUD_STUB_SOURCE.replace(
    /export async function cloudExtraireFraisFacture\(\) \{[^\n]*\n/,
    `export async function cloudExtraireFraisFacture() { const i = S.extractCount = (S.extractCount || 0) + 1; await new Promise(r => setTimeout(r, 30 * i)); return ${JSON.stringify(REPONSES_IA)}[(i - 1) % ${REPONSES_IA.length}]; }\n`
);
assert.notEqual(STUB, OWNED_CLOUD_STUB_SOURCE, 'stub d\'extraction remplacé');

// PNG 1×1 valide (le fichier est rasterisé/lu avant l'appel au stub d'extraction).
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC', 'base64');
const fichier = name => ({ name, mimeType: 'image/png', buffer: PNG_1X1 });

const readRows = page => page.$$eval('[data-fm-row]', rows => rows.map(r => ({
    fournisseur: r.querySelector('[data-fm-field="fournisseur"]').value,
    tag: r.querySelector('[data-fm-field="tag"]').value,
    checked: r.querySelector('[data-fm-check]').checked,
    alerte: r.querySelector('[data-fm-dup]').hidden ? '' : r.querySelector('[data-fm-dup]').textContent,
})));

async function scenarioPC(browser) {
    console.log('\nPC — natures de frais et alerte doublon taxe foncière');
    const { page, errors } = await openPage(browser, '/index.html', {
        viewport: PC, seedCloud: SEED,
        routes: [['**/owned-cloud.js', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB })]],
    });
    await waitAppStarted(page);

    await step('modale factures : natures suggérées depuis le fournisseur / résumé', async () => {
        await page.click('#owned-quickfab');
        await page.waitForSelector('#owned-factures-modal:not([hidden])');
        const options = await page.$$eval('[data-fm-row] [data-fm-field="tag"] option, #owned-factures-modal select[data-fm-field="tag"] option', o => o.map(x => x.value));
        await page.setInputFiles('[data-fm-file-input]', [fichier('avis-tf.png'), fichier('garantie.png'), fichier('courtage.png'), fichier('gli.png'), fichier('depot.png'), fichier('garantie-cl.png')]);
        await page.waitForFunction(() => document.querySelectorAll('[data-fm-row]').length === 6
            && [...document.querySelectorAll('[data-fm-status]')].every(s => !/Lecture…/.test(s.textContent)), null, { timeout: 15000 });
        const rows = await readRows(page);
        const parFournisseur = Object.fromEntries(rows.map(r => [r.fournisseur, r]));
        assert.equal(parFournisseur['SIP Bourges'].tag, 'taxe-fonciere');
        assert.equal(parFournisseur['Crédit Logement'].tag, 'frais-emprunt');
        assert.equal(parFournisseur['Cafpi'].tag, 'frais-emprunt', 'courtage : frais d\'emprunt même si l\'IA dit non déductible');
        assert.equal(parFournisseur['Hiscox'].tag, 'deductible', 'garantie loyers impayés : assurance du bailleur, pas un frais d\'emprunt');
        assert.equal(parFournisseur['Agence Martin'].tag, 'non-deductible', 'dépôt de garantie : pas un frais d\'emprunt');
        assert.equal(parFournisseur['Banque Populaire'].tag, 'frais-emprunt', 'frais de garantie Crédit Logement');
        assert.equal(options.length, 0, 'aucune ligne avant le dépôt');
    });

    await step('alerte doublon taxe foncière : texte, non bloquante (ligne cochée)', async () => {
        const tf = (await readRows(page)).find(r => r.fournisseur === 'SIP Bourges');
        assert.equal(tf.alerte, '⚠ La taxe foncière est déjà saisie dans les charges (800 €/an) : ne la comptez pas deux fois');
        assert.equal(tf.checked, true, 'avertissement seulement : la ligne reste cochée');
        const autres = (await readRows(page)).filter(r => r.fournisseur !== 'SIP Bourges');
        assert.ok(autres.every(r => r.alerte === ''), 'pas d\'alerte sur les frais d\'emprunt');
        const labels = await page.$$eval('[data-fm-row] [data-fm-field="tag"]', s => [...s[0].options].map(o => o.textContent));
        assert.ok(labels.includes('Taxe foncière (case 227)'));
        assert.ok(labels.includes('Frais d\'emprunt : garantie, courtage, dossier (case 250)'));
        const row = page.locator('[data-fm-row]', { has: page.locator('[data-fm-field="fournisseur"]') }).first();
        await row.scrollIntoViewIfNeeded();
        await shot(page, 'fn-modale-alerte-tf', { clip: await page.locator('#owned-factures-modal .owned-modal').boundingBox() });
    });

    await step('changer la nature et le résumé retire l\'alerte', async () => {
        const idx = (await readRows(page)).findIndex(r => r.fournisseur === 'SIP Bourges');
        const row = page.locator('[data-fm-row]').nth(idx);
        await row.locator('[data-fm-field="fournisseur"]').fill('Peintre');
        await row.locator('[data-fm-field="fournisseur"]').dispatchEvent('change');
        await row.locator('[data-fm-field="description"]').fill('Peinture');
        await row.locator('[data-fm-field="description"]').dispatchEvent('change');
        await row.locator('[data-fm-field="tag"]').selectOption('deductible');
        assert.equal((await readRows(page))[idx].alerte, '');
        await row.locator('[data-fm-field="tag"]').selectOption('taxe-fonciere');
        assert.match((await readRows(page))[idx].alerte, /déjà saisie dans les charges \(800 €\/an\)/, 'la nature seule suffit à déclencher l\'alerte');
    });

    await step('ajout : natures enregistrées telles quelles', async () => {
        await page.click('[data-fm-submit]');
        await page.waitForFunction(() => document.querySelectorAll('[data-fm-row]').length === 0, null, { timeout: 5000 });
        const travaux = await page.evaluate(() => window.__stub.assets['oa-test-1'].postAchat.travaux);
        const tags = Object.fromEntries(travaux.map(t => [t.montant, t.tag]));
        assert.equal(tags[334], 'taxe-fonciere');
        assert.equal(tags[750], 'frais-emprunt');
        assert.equal(tags[1250], 'frais-emprunt');
        await page.click('#owned-factures-modal [data-close-modal]');
    });

    await step('onglet Travaux : badges des natures + formulaire (toast d\'alerte TF)', async () => {
        await page.click('.workspace-tab[data-target="collection-panel"]');
        await page.locator('[data-open-asset="oa-test-1"], [data-asset-id="oa-test-1"]').first().click();
        await page.waitForSelector('#owned-detail-view:not([hidden])');
        await page.click('#owned-detail-view .owned-tab[data-tab="travaux"]');
        await page.waitForSelector('[data-form="add-travail-tab"]');
        const badges = await page.$$eval('#owned-tab-travaux .owned-travaux-row .tag', b => b.map(x => x.textContent.trim()));
        assert.ok(badges.includes('Taxe foncière'), JSON.stringify(badges));
        assert.ok(badges.includes('Frais d\'emprunt'), JSON.stringify(badges));
        const form = page.locator('[data-form="add-travail-tab"]');
        await form.locator('[name="date"]').fill('2026-10-05');
        await form.locator('[name="description"]').fill('Taxe foncière 2026 (prorata vendeur)');
        await form.locator('[name="montant"]').fill('120');
        await form.locator('[name="tag"]').selectOption('taxe-fonciere');
        await form.locator('button[type="submit"]').click();
        await page.waitForFunction(() => (document.getElementById('app-toast')?.textContent || '')
            === 'Frais ajouté. ⚠ La taxe foncière est déjà saisie dans les charges (800 €/an) : ne la comptez pas deux fois', null, { timeout: 3000 });
        await shot(page, 'fn-travaux-toast');
        const travaux = await page.evaluate(() => window.__stub.assets['oa-test-1'].postAchat.travaux);
        assert.ok(travaux.some(t => t.montant === 120 && t.tag === 'taxe-fonciere'), 'avertissement non bloquant : le frais est ajouté');
    });

    await step('zéro erreur JS', async () => {
        assert.deepEqual(errors, []);
    });
}

const browser = await chromium.launch();
try {
    await scenarioPC(browser);
} finally {
    await browser.close();
}
const failures = getFailures();
console.log(failures ? `\n${failures} échec(s)` : '\nTous les scénarios passent.');
process.exit(failures ? 1 : 0);
