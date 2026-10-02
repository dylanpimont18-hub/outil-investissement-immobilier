// Test navigateur (Playwright) de la modale globale « Ajouter des factures » — voir
// docs/superpowers/specs/2026-10-02-ajout-factures-bouton-global.md.
//
// Prérequis : `python server.py` lancé (http://127.0.0.1:8080, ou autre port via SPARK_TEST_BASE), `npm install` fait,
// `npx playwright install chromium` fait. Lancer : `node tests/playwright/factures-modal.mjs`.
// Hors `npm test` volontairement (dépend d'un serveur et d'un navigateur).
//
// Le module owned-cloud.js est remplacé par un stub (page.route) : aucun appel Firebase réel,
// aucune donnée réelle touchée. Le stub pilote owned-portfolio.js tel quel.

import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { chromium } from 'playwright';

// Port configurable : l'exe Spark de bureau occupe souvent 8080 avec ses PROPRES fichiers (figés
// au build) — pour tester le code courant, lancer server.py sur un autre port et passer
// SPARK_TEST_BASE=http://127.0.0.1:8090.
const BASE = process.env.SPARK_TEST_BASE || 'http://127.0.0.1:8080';

// ─── Fichiers de test générés en mémoire ─────────────────────────────────────────────────────

function crc32(buf) {
    let crc = ~0;
    for (const b of buf) {
        crc ^= b;
        for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
    }
    return (~crc) >>> 0;
}
function pngChunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const typeBuf = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
    return Buffer.concat([len, typeBuf, data, crc]);
}
// PNG RGB valide de width×height, avec un chunk tEXt de `pad` octets pour contrôler la taille
// (le stub d'extraction choisit sa réponse selon la taille du base64 reçu).
function makePng(width, height, pad = 0) {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x80)]);
    const raw = Buffer.concat(Array.from({ length: height }, () => row));
    const chunks = [
        Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
        pngChunk('IHDR', ihdr),
        pngChunk('IDAT', zlib.deflateSync(raw))
    ];
    if (pad > 0) chunks.push(pngChunk('tEXt', Buffer.concat([Buffer.from('Comment\0', 'ascii'), Buffer.alloc(pad, 0x78)])));
    chunks.push(pngChunk('IEND', Buffer.alloc(0)));
    return Buffer.concat(chunks);
}
// PDF minimal d'une page vierge 200×200 pt, xref correct (pdf.js le rasterise sans broncher).
function makePdf() {
    const objs = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>'
    ];
    let body = '%PDF-1.4\n';
    const offsets = [];
    objs.forEach((o, i) => { offsets.push(body.length); body += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = body.length;
    body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) body += `${String(off).padStart(10, '0')} 00000 n \n`;
    body += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(body, 'latin1');
}

const FILE_A = { name: 'facture-leroy.png', mimeType: 'image/png', buffer: makePng(1, 1) };            // base64 court
const FILE_B = { name: 'facture-plombier.pdf', mimeType: 'application/pdf', buffer: makePdf() };        // rasterisé → base64 moyen
const FILE_C = { name: 'IMG_2041.png', mimeType: 'image/png', buffer: makePng(1, 1, 20000) };           // base64 long

// ─── Stub owned-cloud.js ──────────────────────────────────────────────────────────────────────

const STUB_SOURCE = `
const S = window.__stub = {
    assets: {
        'oa-test-1': {
            id: 'oa-test-1', nom: 'Rue des Lilas', ville: 'Bourges', codePostal: '18000', adresse: '12 rue des Lilas',
            lat: null, lng: null, dateAchat: '2024-03',
            acquisition: { prix: 120000, fraisAgence: 0, fraisNotaire: 9000, loyerInitial: 650, surface: 45, typeBien: 'appartement',
                credit: { montant: 100000, duree: 20, taux: 3.2, assurance: 0.3, assuranceMode: 'initial' } },
            postAchat: { taxeFonciere: 800, chargesCopro: 0, gestionLocative: 0, assurancePNO: 120,
                travaux: [
                    { id: 't-old-1', date: '2026-08-28', description: 'Castorama — Parquet chambre', montant: 890, tag: 'deductible', commentaire: '', pdfFilename: 'old-1.png', credit: null, financeParCredit: false },
                    { id: 't-old-2', date: '2026-09-03', description: 'Plomberie urgence', montant: 380, tag: 'deductible', commentaire: '', pdfFilename: null, credit: null, financeParCredit: false },
                    { id: 't-old-3', date: '2026-06-02', description: 'Taxe foncière 2026', montant: 1120, tag: 'non-deductible', commentaire: '', pdfFilename: null, credit: null, financeParCredit: false }
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
            lat: null, lng: null, dateAchat: '2025-01',
            acquisition: { prix: 90000, fraisAgence: 0, fraisNotaire: 7000, loyerInitial: 520, surface: 22, typeBien: 'appartement',
                credit: { montant: 80000, duree: 20, taux: 3.5, assurance: 0.3, assuranceMode: 'initial' } },
            postAchat: { taxeFonciere: 500, chargesCopro: 0, gestionLocative: 0, assurancePNO: 100, travaux: [], notes: [] },
            scenarios: [
                { id: 'pessimiste', nom: 'Pessimiste', variables: { vacance: 8, regime: 'micro-foncier' } },
                { id: 'realiste', nom: 'Réaliste', variables: { vacance: 5, regime: 'micro-foncier' } },
                { id: 'optimiste', nom: 'Optimiste', variables: { vacance: 2, regime: 'micro-foncier' } }
            ],
            diagnosticHistory: []
        }
    },
    meta: { order: ['oa-test-1', 'oa-test-2'], regime: 'micro-foncier' },
    assetListeners: [],
    extractCalls: [],
    uploads: [],
    extractMode: 'ok'
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
export async function cloudUploadDocument(assetId, file) {
    const name = 'up-' + (S.uploads.length + 1) + '-' + file.name;
    S.uploads.push({ assetId, name, type: file.type, size: file.size });
    return name;
}
export function cloudDocumentUrl() { return Promise.resolve('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC'); }
export async function cloudUploadDocumentAs() {}
export async function cloudDeleteDocument() {}
export async function cloudDeleteAllDocuments() {}
export async function cloudExtraireFraisFacture(base64, mimeType) {
    S.extractCalls.push({ mimeType, len: base64.length });
    await new Promise(r => setTimeout(r, 60));
    if (S.extractMode === 'quota') { const e = new Error('Trop de requêtes'); e.code = 'functions/resource-exhausted'; throw e; }
    if (S.extractMode === 'fail') { throw new Error('Erreur IA (500)'); }
    if (base64.length < 500) return { fournisseur: 'Leroy Merlin', description: 'Peinture salon', montant: 1240, date: '2026-09-12', tagSuggestion: 'deductible', confiance: 'haute' };
    if (base64.length < 10000) return { fournisseur: 'Plombier Martin', description: 'Chauffe-eau', montant: 380, date: '2026-09-03', tagSuggestion: 'deductible', confiance: 'haute' };
    return { fournisseur: '', description: '', montant: 0, date: '', tagSuggestion: 'a-classifier', confiance: 'basse' };
}
export async function cloudExtraireDossierBien() { throw new Error('not stubbed'); }
export async function cloudDiagnosticPortefeuille() { return { diagnostic: '' }; }
export async function cloudChatPortefeuille() { return { reply: '' }; }
export async function cloudGeocode() { return null; }
`;

// ─── Harnais ──────────────────────────────────────────────────────────────────────────────────

async function openPage(browser, path, viewport) {
    const context = await browser.newContext({ viewport });
    // Profil du foyer marqué comme configuré : sinon index.html ouvre la modale d'onboarding
    // (#profile-modal, non fermable) dès l'onglet Portefeuille et bloque tous les clics derrière.
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
    await page.waitForFunction(() => window.__stub && Object.keys(window.__stub.assets).length === 2);
    return { page, context, errors };
}

const readRows = page => page.$$eval('[data-fm-row]', rows => rows.map(r => ({
    file: r.querySelector('[data-fm-filename]')?.textContent.trim(),
    checked: r.querySelector('[data-fm-check]')?.checked,
    fournisseur: r.querySelector('[data-fm-field="fournisseur"]')?.value,
    description: r.querySelector('[data-fm-field="description"]')?.value,
    montant: r.querySelector('[data-fm-field="montant"]')?.value,
    date: r.querySelector('[data-fm-field="date"]')?.value,
    tag: r.querySelector('[data-fm-field="tag"]')?.value,
    status: r.querySelector('[data-fm-status]')?.textContent.trim(),
    dup: !(r.querySelector('[data-fm-dup]')?.hidden ?? true),
    retryVisible: !(r.querySelector('[data-fm-retry]')?.hidden ?? true),
    thumbShown: !(r.querySelector('[data-fm-thumb]')?.hidden ?? true)
})));

const readExisting = page => page.$$eval('[data-fm-existing] [data-travail-id]', rows => rows.map(r => ({
    id: r.dataset.travailId,
    date: r.querySelector('[data-fm-existing-date]')?.textContent.trim(),
    desc: r.querySelector('[data-fm-existing-desc]')?.textContent.trim(),
    montant: r.querySelector('[data-fm-existing-montant]')?.textContent.trim(),
    hasPreview: !!r.querySelector('[data-fm-existing-preview]'),
    highlighted: r.classList.contains('owned-fm-existing__row--dup')
})));

const waitAllExtracted = page => page.waitForFunction(
    () => Array.from(document.querySelectorAll('[data-fm-status]')).every(s => !/Lecture…/.test(s.textContent)),
    null, { timeout: 15000 }
);

let failures = 0;
async function step(name, fn) {
    try { await fn(); console.log(`  ✓ ${name}`); }
    catch (err) { failures++; console.log(`  ✗ ${name}\n      ${err.message.split('\n').slice(0, 14).join('\n      ')}`); }
}

// ─── Scénario PC (index.html, depuis l'onglet Analyse) ────────────────────────────────────────

async function scenarioPC(browser) {
    console.log('\nPC — index.html');
    const { page, context, errors } = await openPage(browser, '/index.html', { width: 1366, height: 900 });

    await step('bouton flottant visible hors du Portefeuille (onglet Analyse)', async () => {
        await page.waitForSelector('#owned-quickfab:not([hidden])', { timeout: 5000 });
        const insidePortfolio = await page.$eval('#owned-quickfab', b => !!b.closest('#collection-panel'));
        assert.equal(insidePortfolio, false, 'le FAB doit vivre hors de #collection-panel');
        const visible = await page.isVisible('#owned-quickfab');
        assert.equal(visible, true);
    });

    await step('clic FAB → modale avec le premier bien pré-sélectionné', async () => {
        await page.click('#owned-quickfab');
        await page.waitForSelector('#owned-factures-modal:not([hidden])');
        const options = await page.$$eval('[data-fm-asset] option', o => o.map(x => x.value));
        assert.deepEqual(options, ['oa-test-1', 'oa-test-2']);
        assert.equal(await page.$eval('[data-fm-asset]', s => s.value), 'oa-test-1');
        assert.equal(await page.$eval('[data-fm-asset]', s => s.disabled), false);
    });

    await step('liste « déjà enregistrées » : 3 frais, tri date décroissante, aperçu si justificatif', async () => {
        const ex = await readExisting(page);
        assert.deepEqual(ex.map(r => r.id), ['t-old-2', 't-old-1', 't-old-3']);
        assert.equal(ex[0].date, '03/09/2026');
        assert.equal(ex[1].desc, 'Castorama — Parquet chambre');
        assert.match(ex[1].montant.replace(/ | /g, ' '), /890/);
        assert.equal(ex[1].hasPreview, true);
        assert.equal(ex[0].hasPreview, false);
        const open = await page.$eval('[data-fm-existing-details]', d => d.open);
        assert.equal(open, true, 'ouverte par défaut sur PC');
    });

    await step('dépôt de 3 fichiers → 3 lignes « Lecture… » immédiatement', async () => {
        await page.setInputFiles('[data-fm-file-input]', [FILE_A, FILE_B, FILE_C]);
        await page.waitForFunction(() => document.querySelectorAll('[data-fm-row]').length === 3);
        const rows = await readRows(page);
        assert.ok(rows.some(r => /Lecture…/.test(r.status)), 'au moins une ligne en lecture au départ');
        assert.match(await page.$eval('[data-fm-pending-count]', e => e.textContent), /3/);
    });

    await step('extraction : fournisseur / résumé / montant / date remplis, PDF converti en PNG', async () => {
        await waitAllExtracted(page);
        const calls = await page.evaluate(() => window.__stub.extractCalls);
        assert.equal(calls.length, 3);
        assert.ok(calls.every(c => c.mimeType === 'image/png'), `aucun PDF brut ne doit partir : ${JSON.stringify(calls)}`);
        const rows = await readRows(page);
        const a = rows.find(r => r.file === FILE_A.name);
        const b = rows.find(r => r.file === FILE_B.name);
        const c = rows.find(r => r.file === FILE_C.name);
        assert.ok(a && b && c, 'les 3 lignes portent le nom du fichier');
        assert.deepEqual([a.fournisseur, a.description, a.montant, a.date, a.tag], ['Leroy Merlin', 'Peinture salon', '1240', '2026-09-12', 'deductible']);
        assert.deepEqual([b.fournisseur, b.description, b.montant, b.date], ['Plombier Martin', 'Chauffe-eau', '380', '2026-09-03']);
        assert.equal(a.checked, true, 'ligne complète cochée');
        assert.equal(c.checked, false, 'ligne vide décochée');
        assert.match(c.status, /compléter|complète/i);
        assert.equal(a.thumbShown, true, 'miniature image');
        assert.equal(b.thumbShown, true, 'miniature = PNG rasterisé du PDF');
    });

    if (process.env.FM_SCREENSHOTS) await page.screenshot({ path: `${process.env.FM_SCREENSHOTS}/fm-pc.png` });

    await step('doublon : ligne B décochée + bandeau + ligne existante surlignée', async () => {
        const rows = await readRows(page);
        const b = rows.find(r => r.file === FILE_B.name);
        assert.equal(b.dup, true);
        assert.equal(b.checked, false);
        const ex = await readExisting(page);
        assert.equal(ex.find(r => r.id === 't-old-2').highlighted, true);
        assert.equal(ex.find(r => r.id === 't-old-1').highlighted, false);
    });

    await step('bouton d\'ajout : « 1 frais » puis « 2 frais » après re-coche de B', async () => {
        assert.match(await page.$eval('[data-fm-submit]', b => b.textContent), /1 frais/);
        const bRow = page.locator(`[data-fm-row]:has([data-fm-filename]:text-is("${FILE_B.name}"))`);
        await bRow.locator('[data-fm-check]').check();
        assert.match(await page.$eval('[data-fm-submit]', b => b.textContent), /2 frais/);
        assert.equal(await page.$eval('[data-fm-submit]', b => b.disabled), false);
    });

    await step('édition du montant de A puis ajout : frais créés, fichiers uploadés, lignes passées en bas', async () => {
        const aRow = page.locator(`[data-fm-row]:has([data-fm-filename]:text-is("${FILE_A.name}"))`);
        await aRow.locator('[data-fm-field="montant"]').fill('1300');
        await aRow.locator('[data-fm-field="montant"]').dispatchEvent('change');
        await page.click('[data-fm-submit]');
        await page.waitForFunction(() => document.querySelectorAll('[data-fm-row]').length === 1);
        const uploads = await page.evaluate(() => window.__stub.uploads);
        assert.equal(uploads.length, 2);
        assert.ok(uploads.every(u => u.assetId === 'oa-test-1'));
        assert.ok(uploads.some(u => u.type === 'application/pdf'), 'l\'original PDF est stocké tel quel');
        const travaux = await page.evaluate(() => window.__stub.assets['oa-test-1'].postAchat.travaux);
        assert.equal(travaux.length, 5);
        const added = travaux.filter(t => !t.id.startsWith('t-old'));
        const descs = added.map(t => t.description).sort();
        assert.deepEqual(descs, ['Leroy Merlin — Peinture salon', 'Plombier Martin — Chauffe-eau']);
        assert.equal(added.find(t => t.description.startsWith('Leroy')).montant, 1300);
        assert.ok(added.every(t => t.pdfFilename && t.pdfFilename.startsWith('up-')));
        const ex = await readExisting(page);
        assert.equal(ex.length, 5);
        assert.equal(ex[0].date, '12/09/2026');
        const rows = await readRows(page);
        assert.equal(rows[0].file, FILE_C.name, 'la ligne non cochée reste');
        assert.equal(await page.$eval('#owned-factures-modal', m => m.hidden), false, 'la modale reste ouverte');
    });

    await step('aperçu 👁 d\'une ligne en cours → overlay avec le fichier local', async () => {
        await page.click('[data-fm-row] [data-fm-preview]');
        await page.waitForSelector('#document-preview-overlay:not([hidden])');
        const src = await page.$eval('#document-preview-overlay .document-preview-img', i => i.getAttribute('src') || '');
        assert.match(src, /^blob:/);
        await page.click('#document-preview-overlay .document-preview-close');
    });

    await step('aperçu 📄 d\'un frais existant → overlay (URL cloud)', async () => {
        await page.click('[data-fm-existing] [data-fm-existing-preview]');
        await page.waitForSelector('#document-preview-overlay:not([hidden])');
        await page.waitForFunction(() => /^data:image/.test(document.querySelector('#document-preview-overlay .document-preview-img')?.src || ''));
        await page.click('#document-preview-overlay .document-preview-close');
    });

    await step('quota IA → message dédié + Relire ; Relire relance et remplit', async () => {
        await page.evaluate(() => { window.__stub.extractMode = 'quota'; });
        await page.setInputFiles('[data-fm-file-input]', [FILE_A]);
        await page.waitForFunction(() => document.querySelectorAll('[data-fm-row]').length === 2);
        await waitAllExtracted(page);
        let rows = await readRows(page);
        let q = rows.find(r => /Quota IA/.test(r.status));
        assert.ok(q, `une ligne doit afficher le quota : ${JSON.stringify(rows.map(r => r.status))}`);
        assert.equal(q.retryVisible, true);
        assert.equal(q.checked, false);
        await page.evaluate(() => { window.__stub.extractMode = 'ok'; });
        await page.click('[data-fm-row] [data-fm-retry]:not([hidden])');
        await waitAllExtracted(page);
        rows = await readRows(page);
        q = rows.find(r => r.fournisseur === 'Leroy Merlin');
        assert.ok(q, 'la relecture a rempli la ligne');
        assert.equal(q.checked, true);
    });

    await step('changement de bien → liste du bas recalculée, doublons ré-évalués', async () => {
        await page.selectOption('[data-fm-asset]', 'oa-test-2');
        await page.waitForFunction(() => document.querySelectorAll('[data-fm-existing] [data-travail-id]').length === 0);
        const empty = await page.$eval('[data-fm-existing]', e => e.textContent);
        assert.match(empty, /Aucun frais/);
        const rows = await readRows(page);
        assert.ok(rows.every(r => r.dup === false));
    });

    await step('retirer une ligne (✕) puis fermer la modale', async () => {
        const before = (await readRows(page)).length;
        await page.click('[data-fm-row] [data-fm-remove]');
        await page.waitForFunction(n => document.querySelectorAll('[data-fm-row]').length === n - 1, before);
        await page.click('#owned-factures-modal [data-close-modal]');
        assert.equal(await page.$eval('#owned-factures-modal', m => m.hidden), true);
    });

    await step('rail « Ajouter une facture » ouvre la même modale (plus de formulaire inline)', async () => {
        await page.click('.workspace-tab[data-target="collection-panel"]');
        await page.waitForSelector('#owned-quickrail [data-quickaction="add-facture"]');
        assert.equal(await page.$('#owned-quickrail [data-quickpanel="add-facture"]'), null, 'panneau inline supprimé');
        await page.click('#owned-quickrail [data-quickaction="add-facture"]');
        await page.waitForSelector('#owned-factures-modal:not([hidden])');
        await page.click('#owned-factures-modal [data-close-modal]');
    });

    await step('non-régression onglet Frais : 1 PDF → extraction en image/png ; 2 fichiers → modale verrouillée sur le bien', async () => {
        await page.locator('[data-open-asset="oa-test-1"], [data-asset-id="oa-test-1"]').first().click();
        await page.waitForSelector('#owned-detail-view:not([hidden])');
        await page.click('#owned-detail-view .owned-tab[data-tab="travaux"]');
        await page.waitForSelector('[data-travaux-file-input]', { state: 'attached' });
        const callsBefore = await page.evaluate(() => window.__stub.extractCalls.length);
        await page.setInputFiles('[data-travaux-file-input]', [FILE_B]);
        await page.waitForFunction(n => window.__stub.extractCalls.length === n + 1, callsBefore);
        const last = await page.evaluate(() => window.__stub.extractCalls.at(-1));
        assert.equal(last.mimeType, 'image/png');
        await page.waitForFunction(() => document.querySelector('[data-form="add-travail-tab"] [data-field="montant"]')?.value === '380');
        await page.setInputFiles('[data-travaux-file-input]', [FILE_A, FILE_C]);
        await page.waitForSelector('#owned-factures-modal:not([hidden])');
        assert.equal(await page.$eval('[data-fm-asset]', s => s.value), 'oa-test-1');
        assert.equal(await page.$eval('[data-fm-asset]', s => s.disabled), true);
        await page.waitForFunction(() => document.querySelectorAll('[data-fm-row]').length === 2);
        await page.click('#owned-factures-modal [data-close-modal]');
    });

    await step('aucune erreur JS', () => {
        assert.deepEqual(errors, []);
    });

    await context.close();
}

// ─── Scénario iPhone (owned.html) ─────────────────────────────────────────────────────────────

async function scenarioMobile(browser) {
    console.log('\niPhone — owned.html (393×852)');
    const { page, context, errors } = await openPage(browser, '/owned.html', { width: 393, height: 852 });

    await step('plus de modale-formulaire ; FAB → modale, input multiple + photo, dossier masqué', async () => {
        assert.equal(await page.$('#owned-quickfab-modal'), null, 'ancienne modale supprimée');
        await page.waitForSelector('#owned-quickfab:not([hidden])');
        await page.click('#owned-quickfab');
        await page.waitForSelector('#owned-factures-modal:not([hidden])');
        const input = await page.$eval('[data-fm-file-input]', i => ({ multiple: i.multiple, accept: i.accept }));
        assert.equal(input.multiple, true);
        assert.match(input.accept, /image\/\*/);
        assert.equal(await page.isVisible('[data-fm-folder-btn]'), false, 'bouton dossier masqué sur mobile');
        const open = await page.$eval('[data-fm-existing-details]', d => d.open);
        assert.equal(open, false, 'section du bas repliée sur mobile');
    });

    await step('lignes lisibles sans débordement horizontal, cibles tactiles ≥ 44 px', async () => {
        await page.setInputFiles('[data-fm-file-input]', [FILE_A, FILE_C]);
        await page.waitForFunction(() => document.querySelectorAll('[data-fm-row]').length === 2);
        await waitAllExtracted(page);
        if (process.env.FM_SCREENSHOTS) await page.screenshot({ path: `${process.env.FM_SCREENSHOTS}/fm-mobile.png`, fullPage: false });
        const overflow = await page.evaluate(() => {
            const box = document.querySelector('#owned-factures-modal .owned-modal');
            return { page: document.documentElement.scrollWidth, modal: box.scrollWidth, client: box.clientWidth };
        });
        assert.ok(overflow.page <= 393, `page scrollWidth ${overflow.page}`);
        assert.ok(overflow.modal <= overflow.client + 1, `modale déborde : ${overflow.modal} > ${overflow.client}`);
        const submit = await page.$eval('[data-fm-submit]', b => b.getBoundingClientRect().height);
        assert.ok(submit >= 44, `bouton Ajouter ${submit}px`);
        const eye = await page.$eval('[data-fm-row] [data-fm-preview]', b => b.getBoundingClientRect().height);
        assert.ok(eye >= 44, `bouton aperçu ${eye}px`);
        await page.click('#owned-factures-modal [data-close-modal]');
    });

    await step('depuis une fiche bien, le FAB pré-sélectionne ce bien', async () => {
        await page.locator('[data-open-asset="oa-test-2"], [data-asset-id="oa-test-2"]').first().click();
        await page.waitForSelector('#owned-detail-view:not([hidden])');
        await page.click('#owned-quickfab');
        await page.waitForSelector('#owned-factures-modal:not([hidden])');
        assert.equal(await page.$eval('[data-fm-asset]', s => s.value), 'oa-test-2');
        await page.click('#owned-factures-modal [data-close-modal]');
    });

    await step('aucune erreur JS', () => {
        assert.deepEqual(errors, []);
    });

    await context.close();
}

// ─── Main ─────────────────────────────────────────────────────────────────────────────────────

const browser = await chromium.launch();
try {
    await scenarioPC(browser);
    await scenarioMobile(browser);
} finally {
    await browser.close();
}
console.log(failures === 0 ? '\nOK — tous les scénarios passent' : `\nÉCHEC — ${failures} étape(s) en erreur`);
process.exit(failures === 0 ? 0 : 1);
