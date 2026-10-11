// Harnais commun des tests navigateur : stubs des deux modules cloud (owned-cloud.js, cloud-store.js),
// espion localStorage/sessionStorage, ouverture de page avec collecte des erreurs. Les stubs exportent
// TOUTES les fonctions du module réel (un export manquant casse l'import du module sans erreur claire).
import assert from 'node:assert/strict';

export const BASE = process.env.SPARK_TEST_BASE || 'http://127.0.0.1:8090';

export const ASSET_TEST_1 = {
    id: 'oa-test-1', nom: 'Rue des Lilas', ville: 'Bourges', codePostal: '18000', adresse: '',
    lat: null, lng: null, dateAchat: '2024-03',
    acquisition: { prix: 120000, fraisAgence: 0, fraisNotaire: 9000, loyerInitial: 650, surface: 45, typeBien: 'appartement',
        credit: { montant: 100000, duree: 20, taux: 3.2, assurance: 0.3, assuranceMode: 'initial' } },
    postAchat: { taxeFonciere: 800, chargesCopro: 0, gestionLocative: 0, assurancePNO: 120,
        travaux: [{ id: 't-1', date: '2026-08-28', description: 'Parquet chambre', montant: 890, tag: 'deductible', commentaire: '', pdfFilename: 'facture-1.pdf', credit: null, financeParCredit: false }],
        notes: [] },
    scenarios: [
        { id: 'pessimiste', nom: 'Pessimiste', variables: { vacance: 8, regime: 'micro-foncier' } },
        { id: 'realiste', nom: 'Réaliste', variables: { vacance: 5, regime: 'micro-foncier' } },
        { id: 'optimiste', nom: 'Optimiste', variables: { vacance: 2, regime: 'micro-foncier' } }
    ],
    diagnosticHistory: []
};
export const META_TEST = {
    order: ['oa-test-1'], regime: 'micro-foncier',
    profile: { name: 'Test', income: 40000, adults: 1, children: 0, revenuHistorique: [], objectifCF: 1000, revaloAnnuelle: 2, autresCredits: [] }
};

// Stub d'owned-cloud.js. Seed via window.__seedCloud = { assets, meta, user } (addInitScript) :
// user: null → déconnecté (cloudSignIn connecte). window.__stub expose l'état pour les assertions.
export const OWNED_CLOUD_STUB_SOURCE = `
const seed = window.__seedCloud || {};
const S = window.__stub = {
    assets: seed.assets || {}, meta: seed.meta || {},
    user: seed.user === undefined ? { uid: 'u-test', email: 'test@example.com' } : seed.user,
    documents: seed.documents || {},            // { 'assetId/filename': true }
    authListeners: [], assetListeners: [], metaListeners: [],
    uploads: [], uploadsAs: [], signIns: [], metaWrites: []
};
const clone = v => JSON.parse(JSON.stringify(v));
const later = fn => setTimeout(fn, 0);
export function watchAuth(cb) { S.authListeners.push(cb); later(() => cb(S.user)); return () => {}; }
export async function cloudSignIn(email, password) {
    S.signIns.push({ email, password });
    if (password === 'mauvais') { const e = new Error('auth/wrong-password'); e.code = 'auth/wrong-password'; throw e; }
    S.user = { uid: 'u-test', email };
    S.authListeners.forEach(cb => cb(S.user));
}
export async function cloudSignOut() { S.user = null; S.authListeners.forEach(cb => cb(null)); }
export async function cloudChangePassword() { return { relogged: true }; }
export function watchOwnedAssets(cb) { S.assetListeners.push(cb); later(() => cb(clone(S.assets))); return () => {}; }
export function cloudSetAsset(id, data) { S.assets[id] = clone(data); later(() => S.assetListeners.forEach(cb => cb(clone(S.assets)))); return Promise.resolve(); }
export function cloudDeleteAssetDoc(id) { delete S.assets[id]; later(() => S.assetListeners.forEach(cb => cb(clone(S.assets)))); return Promise.resolve(); }
export function watchPortfolioMeta(cb) { S.metaListeners.push(cb); later(() => cb(clone(S.meta))); return () => {}; }
export function cloudSaveMeta(patch) { S.metaWrites.push(clone(patch)); Object.assign(S.meta, clone(patch)); later(() => S.metaListeners.forEach(cb => cb(clone(S.meta)))); return Promise.resolve(); }
export async function cloudGetMeta() { return clone(S.meta); }
export async function cloudGetAllAssets() { return clone(S.assets); }
export async function cloudUploadDocument(assetId, file) { const name = 'up-' + (S.uploads.length + 1) + '-' + file.name; S.uploads.push({ assetId, name, type: file.type, size: file.size }); S.documents[assetId + '/' + name] = true; return name; }
export async function cloudUploadDocumentAs(assetId, filename, blob) { S.uploadsAs.push({ assetId, filename, size: blob.size }); S.documents[assetId + '/' + filename] = true; }
export async function cloudDocumentExists(assetId, filename) { return !!S.documents[assetId + '/' + filename]; }
export function cloudDocumentUrl() { return Promise.resolve('data:application/pdf;base64,JVBERi0xLjQK'); }
export async function cloudDeleteDocument() {}
export async function cloudDeleteAllDocuments() {}
export async function cloudExtraireFraisFacture() { return { fournisseur: '', description: '', montant: 0, date: '', tagSuggestion: 'a-classifier', confiance: 'basse' }; }
export async function cloudExtraireDossierBien() { throw new Error('not stubbed'); }
export async function cloudDiagnosticPortefeuille() { return { recommendations: [] }; }
export async function cloudChatPortefeuille() { return { reply: '' }; }
export async function cloudGeocode() { return { lat: null, lng: null }; }
`;

// Stub de cloud-store.js. Seed via window.__seedStore = { studies, settings, archives, failUploadArchive,
// corruptStudiesRead }. window.__store.writes journalise chaque écriture (règle « rien n'est écrit au chargement »).
export const CLOUD_STORE_STUB_SOURCE = `
const seed = window.__seedStore || {};
const S = window.__store = {
    studies: seed.studies || {}, settings: seed.settings || {}, archives: seed.archives || {},
    failUploadArchive: !!seed.failUploadArchive, corruptStudiesRead: !!seed.corruptStudiesRead,
    listeners: { studies: [], analysis: [], prefs: [] }, writes: [],
    dump() { return JSON.parse(JSON.stringify({ studies: this.studies, settings: this.settings, archives: this.archives })); }
};
const clone = v => JSON.parse(JSON.stringify(v));
const notify = (k, v) => setTimeout(() => S.listeners[k].forEach(cb => cb(clone(v))), 0);
export function watchStudies(cb) { S.listeners.studies.push(cb); setTimeout(() => cb(clone(S.studies)), 0); return () => {}; }
export function cloudSetStudy(id, data) { S.writes.push(['study', id]); S.studies[id] = clone(data); notify('studies', S.studies); return Promise.resolve(); }
export function cloudDeleteStudy(id) { S.writes.push(['deleteStudy', id]); delete S.studies[id]; notify('studies', S.studies); return Promise.resolve(); }
export async function cloudGetAllStudies() { const m = clone(S.studies); if (S.corruptStudiesRead) for (const id in m) m[id].updatedAt = 1; return m; }
export function watchAnalysis(cb) { S.listeners.analysis.push(cb); setTimeout(() => cb(S.settings.analysis ? clone(S.settings.analysis) : null), 0); return () => {}; }
export function cloudSaveAnalysis(patch) { S.writes.push(['analysis']); S.settings.analysis = { ...(S.settings.analysis || {}), ...clone(patch) }; notify('analysis', S.settings.analysis); return Promise.resolve(); }
export function watchPrefs(cb) { S.listeners.prefs.push(cb); setTimeout(() => cb(clone(S.settings.prefs || {})), 0); return () => {}; }
export function savePref(patch) { S.writes.push(['prefs', Object.keys(patch).join(',')]); S.settings.prefs = { ...(S.settings.prefs || {}), ...clone(patch) }; notify('prefs', S.settings.prefs); return Promise.resolve(); }
export async function cloudGetSetting(name) { return S.settings[name] ? clone(S.settings[name]) : null; }
export async function cloudSetSetting(name, data, { merge = true } = {}) { S.writes.push(['setting', name]); S.settings[name] = merge ? { ...(S.settings[name] || {}), ...clone(data) } : clone(data); if (S.listeners[name]) notify(name, S.settings[name]); }
export async function cloudUploadArchive(name, blobOrText) { if (S.failUploadArchive) { const e = new Error('storage/retry-limit-exceeded'); e.code = 'storage/retry-limit-exceeded'; throw e; } S.writes.push(['archive', name]); S.archives[name] = typeof blobOrText === 'string' ? blobOrText : await blobOrText.text(); }
export async function cloudListArchives() { return Object.keys(S.archives).sort().reverse().map(name => ({ name, size: S.archives[name].length, updated: '2026-10-11T10:00:00.000Z' })); }
export async function cloudReadArchive(name) { if (!(name in S.archives)) { const e = new Error('storage/object-not-found'); e.code = 'storage/object-not-found'; throw e; } return JSON.parse(S.archives[name]); }
export async function cloudArchiveMeta(name) { return name in S.archives ? { size: S.archives[name].length, updated: '2026-10-11T10:00:00.000Z' } : null; }
`;

// Espion : tout accès à localStorage/sessionStorage est journalisé avec sa pile. Le SDK Firebase
// n'est jamais chargé dans ces tests (modules cloud stubbés), donc la liste doit rester vide.
export const STORAGE_SPY_SCRIPT = `
window.__storageHits = [];
for (const name of ['localStorage', 'sessionStorage']) {
    let real; try { real = window[name]; } catch { real = undefined; }
    Object.defineProperty(window, name, { configurable: true, get() {
        window.__storageHits.push(name + ' ← ' + (new Error().stack || '').split('\\n').slice(2, 5).join(' | '));
        return real;
    } });
}`;

// Espion d'impression : window.print() ne peut pas s'exécuter en headless ; on capture le titre du
// document et le contenu du Shadow DOM d'impression au moment de l'appel, puis on émet afterprint.
export const PRINT_SPY_SCRIPT = `
window.__prints = [];
window.print = () => {
    const host = document.getElementById('spark-print-root');
    window.__prints.push({
        title: document.title,
        hostCount: document.querySelectorAll('#spark-print-root').length,
        printing: document.body.classList.contains('spark-printing'),
        text: (host?.shadowRoot?.querySelector('.print-root')?.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 400),
        hasPageRule: !!document.getElementById('spark-print-page')
    });
    setTimeout(() => window.dispatchEvent(new Event('afterprint')), 0);
};`;

// initScripts : [[fn, arg], …] posés AVANT la première navigation (ex. ancien localStorage du test de migration).
export async function openPage(browser, path, { viewport, seedCloud = {}, seedStore = {}, spyStorage = true, routes = [], initScripts = [] } = {}) {
    const context = await browser.newContext({ viewport, acceptDownloads: true });
    await context.addInitScript(`window.__seedCloud = ${JSON.stringify({ assets: { 'oa-test-1': ASSET_TEST_1 }, meta: META_TEST, ...seedCloud })};`);
    await context.addInitScript(`window.__seedStore = ${JSON.stringify(seedStore)};`);
    if (spyStorage) await context.addInitScript(STORAGE_SPY_SCRIPT);
    await context.addInitScript(PRINT_SPY_SCRIPT);
    for (const [fn, arg] of initScripts) await context.addInitScript(fn, arg);
    await context.route('**/owned-cloud.js', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: OWNED_CLOUD_STUB_SOURCE }));
    await context.route('**/cloud-store.js', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: CLOUD_STORE_STUB_SOURCE }));
    for (const [pattern, handler] of routes) await context.route(pattern, handler);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', err => errors.push(`pageerror: ${err.message}`));
    page.on('console', msg => { if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`); });
    page.on('response', r => { if (r.status() === 404) errors.push('404: ' + r.url()); });
    await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
    return { page, context, errors };
}

// Rechargement « persistant » : le stub vit en mémoire de page, on réinjecte son état comme seed.
export async function reloadWithStore(page, context) {
    const dump = await page.evaluate(() => window.__store.dump());
    await context.addInitScript(`window.__seedStore = ${JSON.stringify(dump)};`);
    await page.reload({ waitUntil: 'load' });
}

export const waitAppStarted = page => page.waitForSelector('#app-cloud-loading[hidden]', { timeout: 10000 });

let failures = 0;
export async function step(name, fn) {
    try { await fn(); console.log(`  ✓ ${name}`); }
    catch (err) { failures++; console.log(`  ✗ ${name}\n      ${String(err.message).split('\n').slice(0, 14).join('\n      ')}`); }
}
export const getFailures = () => failures;
export { assert };
