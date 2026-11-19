// Corrections du lot 3 de l'audit du 18/11/2026 (docs/audits/2026-11-18-audit-defauts.md).
// Hors `npm test` : serveur statique 8090 + Chromium requis.
//   SPARK_TEST_BASE=http://127.0.0.1:8090 node tests/playwright/audit-lot3.mjs
//   L3_ONLY=T5,T2…  limite aux scénarios nommés ; L3_SCREENSHOTS=<dossier> enregistre des captures
//   PC 1440×900 et iPhone 393×852.
import { chromium } from 'playwright';
import fs from 'node:fs';
import { openPage, waitAppStarted, step, getFailures, assert, assertNoStorageHits, BASE, ASSET_TEST_1, META_TEST } from './_harness.mjs';

const SHOTS = process.env.L3_SCREENSHOTS || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const PC = { width: 1440, height: 900 };
const IPHONE = { width: 393, height: 852 };
const TOUCH = { hasTouch: true, isMobile: true };

async function shot(page, name, opts = {}) {
    if (!SHOTS) return;
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${SHOTS}/${name}.png`, ...opts });
}

// Capture dans les DEUX thèmes (l'app s'ouvre en sombre par défaut) : <nom>-clair.png puis <nom>-sombre.png.
async function shotThemes(page, name, opts = {}) {
    if (!SHOTS) return;
    for (const [theme, suffixe] of [['light', 'clair'], ['dark', 'sombre']]) {
        await page.evaluate(t => { document.documentElement.dataset.theme = t; }, theme);
        await shot(page, `${name}-${suffixe}`, opts);
    }
}

async function openPcIndex(browser, opts = {}) {
    const ctx = await openPage(browser, '/index.html', { viewport: PC, ...opts });
    await waitAppStarted(ctx.page);
    if (await ctx.page.locator('#profile-modal:not([hidden])').count()) await ctx.page.keyboard.press('Escape');
    return ctx;
}

async function finish(ctx, label) {
    await step(`${label} : zéro accès localStorage/sessionStorage`, () => assertNoStorageHits(ctx.page, 'fin du scénario'));
    await step(`${label} : aucune erreur JS ni 404`, () => assert.deepEqual(ctx.errors, []));
    await ctx.context.close();
}

// ── T5 : un justificatif de plus de 15 Mo est refusé avec un message clair ──────────────────
async function scenarioT5(browser) {
    console.log('T5 — plafond de taille des justificatifs (storage.rules)');
    const ctx = await openPcIndex(browser);
    const { page } = ctx;
    await page.click('.workspace-tab[data-target="collection-panel"]');
    await page.locator('[data-open-asset="oa-test-1"], [data-asset-id="oa-test-1"]').first().click();
    await page.waitForSelector('#owned-detail-view:not([hidden])');
    await page.click('#owned-detail-view .owned-tab[data-tab="travaux"]');
    await page.waitForSelector('[data-travaux-file-input]', { state: 'attached' });
    const Mo = 1024 * 1024;
    await step('16 Mo : refusé, message « 15 Mo maximum », rien d\'enregistré', async () => {
        await page.setInputFiles('[data-travaux-file-input]', { name: 'scan-enorme.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(16 * Mo, 65) });
        await page.waitForSelector('#app-toast');
        assert.match(await page.textContent('#app-toast'), /15 Mo maximum/);
        assert.equal(await page.$('.owned-travaux-dropzone--filled'), null);
        assert.equal(await page.evaluate(() => window.__stub.uploads.length), 0);
        await shotThemes(page, 't5-pc-toast');
    });
    await step('10 Mo : accepté (pas de lecture IA au-delà de 8 Mo, saisie à la main)', async () => {
        await page.setInputFiles('[data-travaux-file-input]', { name: 'scan.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(10 * Mo, 65) });
        await page.waitForSelector('.owned-travaux-dropzone--filled');
        assert.match(await page.textContent('.owned-travaux-dropzone__status'), /trop volumineux pour l'extraction/);
    });
    await finish(ctx, 'T5');
}

// Même contrôle sur la page iPhone (owned.html), qui a son propre bootstrap.
async function scenarioT5Iphone(browser) {
    console.log('T5 — plafond de taille, iPhone');
    const ctx = await openPage(browser, '/owned.html', { viewport: IPHONE, contextOptions: TOUCH });
    const { page } = ctx;
    await page.waitForSelector('#owned-list-view:not([hidden])', { timeout: 10000 });
    await page.locator('[data-open-asset="oa-test-1"], [data-asset-id="oa-test-1"]').first().click();
    await page.waitForSelector('#owned-detail-view:not([hidden])');
    await page.click('#owned-detail-view .owned-tab[data-tab="travaux"]');
    await page.waitForSelector('[data-travaux-file-input]', { state: 'attached' });
    await step('16 Mo refusé avec message clair', async () => {
        await page.setInputFiles('[data-travaux-file-input]', { name: 'scan-enorme.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(16 * 1024 * 1024, 65) });
        await page.waitForSelector('#app-toast');
        assert.match(await page.textContent('#app-toast'), /15 Mo maximum/);
        await shotThemes(page, 't5-iphone-toast');
    });
    await finish(ctx, 'T5 iPhone');
}

// ── T2 : Chart.js et Leaflet servis par le site, chargés sans bloquer l'affichage ───────────
// Espion posé avant tout script : si la page lit `Chart` avant que la bibliothèque l'ait défini,
// window.__chartLuTropTot passe à true.
const ESPION_CHART = () => {
    let valeur;
    window.__chartLuTropTot = false;
    Object.defineProperty(window, 'Chart', {
        configurable: true,
        get() { if (valeur === undefined) window.__chartLuTropTot = true; return valeur; },
        set(v) { valeur = v; },
    });
};
// Un bien géolocalisé et un second bien : le dashboard dessine ses graphiques et la carte ses marqueurs.
const clone = o => JSON.parse(JSON.stringify(o));
const BIEN_1 = { ...clone(ASSET_TEST_1), lat: 47.08, lng: 2.4 };
const BIEN_2 = { ...clone(ASSET_TEST_1), id: 'oa-test-2', nom: 'Studio Lyon', ville: 'Lyon', codePostal: '69003', lat: 45.76, lng: 4.84, dateAchat: '2023-05' };
const SEED_T2 = { assets: { 'oa-test-1': BIEN_1, 'oa-test-2': BIEN_2 }, meta: META_TEST };
const PIXEL_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC', 'base64');
const ROUTES_T2 = [['**/*.tile.openstreetmap.org/**', r => r.fulfill({ status: 200, contentType: 'image/png', body: PIXEL_PNG })]];
// Graphique réellement dessiné : instance Chart.js attachée ET au moins un pixel non transparent.
const dessine = (page, sel) => page.$eval(sel, c => c.width > 100 && c.height > 100 && !!window.Chart?.getChart(c)
    && c.getContext('2d').getImageData(0, 0, c.width, c.height).data.some((v, i) => i % 4 === 3 && v > 0));

async function scenarioT2(browser) {
    console.log('T2 — Chart.js et Leaflet locaux, chargés en defer');
    for (const [label, path, viewport, opts] of [['PC', '/index.html', PC, {}], ['iPhone', '/owned.html', IPHONE, { contextOptions: TOUCH }]]) {
        const scripts = [];
        const ctx = await openPage(browser, path, { viewport, seedCloud: SEED_T2, routes: ROUTES_T2, initScripts: [[ESPION_CHART, null]], ...opts });
        const { page } = ctx;
        page.on('request', r => { if (r.resourceType() === 'script') scripts.push(r.url()); });
        await page.reload({ waitUntil: 'load' });
        if (path === '/index.html') {
            await waitAppStarted(page);
            if (await page.locator('#profile-modal:not([hidden])').count()) await page.keyboard.press('Escape');
        } else {
            await page.waitForSelector('#owned-list-view:not([hidden])', { timeout: 10000 });
        }

        await step(`${label} : aucun script ne vient d'un autre site`, () => {
            const base = new URL(BASE).origin;
            assert.ok(scripts.length >= 3, JSON.stringify(scripts));
            assert.deepEqual(scripts.filter(u => new URL(u).origin !== base), []);
            assert.ok(scripts.some(u => u.endsWith('/vendor/chartjs/chart.umd.min.js')), 'Chart.js local demandé');
            assert.ok(scripts.some(u => u.endsWith('/vendor/leaflet/leaflet.js')), 'Leaflet local demandé');
        });
        await step(`${label} : balises de bibliothèque en defer, avant le module de l'application`, async () => {
            const r = await page.evaluate(() => {
                const s = [...document.querySelectorAll('script')];
                const idx = re => s.findIndex(x => re.test(x.getAttribute('src') || ''));
                const module = s.findIndex(x => x.type === 'module');
                return { chartDefer: s[idx(/chart\.umd/)]?.defer, leafletDefer: s[idx(/leaflet\.js/)]?.defer,
                    avant: idx(/chart\.umd/) < module && idx(/leaflet\.js/) < module };
            });
            assert.deepEqual(r, { chartDefer: true, leafletDefer: true, avant: true });
        });
        await step(`${label} : aucun appel à Chart avant son chargement ; Chart 4.4.0 et L définis`, async () => {
            assert.equal(await page.evaluate(() => window.__chartLuTropTot), false);
            assert.deepEqual(await page.evaluate(() => [typeof window.Chart, typeof window.L, window.Chart.version]), ['function', 'object', '4.4.0']);
        });

        if (path === '/index.html') {
            await page.click('.workspace-tab[data-target="collection-panel"]');
            await page.waitForSelector('#owned-portfolio-cf-chart', { state: 'attached' });
            await step('PC dashboard : graphique du cash-flow cumulé dessiné', async () => {
                await page.waitForFunction(() => { const c = document.getElementById('owned-portfolio-cf-chart'); return c && window.Chart.getChart(c); });
                assert.equal(await dessine(page, '#owned-portfolio-cf-chart'), true);
            });
            await step('PC dashboard : carte Leaflet affichée avec ses marqueurs', async () => {
                await page.waitForSelector('#owned-map.leaflet-container');
                assert.ok((await page.$$eval('#owned-map .leaflet-interactive', e => e.length)) >= 2);
            });
            await shotThemes(page, 't2-pc-dashboard', { fullPage: true });
            await page.click('#owned-dashboard-wrap [data-action="open-projection-impots"]');
            await page.waitForSelector('#owned-projection-impots-modal:not([hidden])');
            await step('PC projection des impôts : graphique de l\'impôt dessiné (et celui du report s\'il y a un déficit)', async () => {
                assert.equal(await dessine(page, '#owned-projection-impots-modal #proj-chart-impot'), true);
                if (await page.$('#owned-projection-impots-modal #proj-chart-report')) assert.equal(await dessine(page, '#owned-projection-impots-modal #proj-chart-report'), true);
            });
            await shotThemes(page, 't2-pc-projection');
            await page.click('#owned-projection-impots-modal [data-proj-tab="regimes"]');
            await step('PC projection, onglet régimes : graphique dessiné', async () => {
                await page.waitForSelector('#owned-projection-impots-modal #proj-chart-regimes');
                assert.equal(await dessine(page, '#owned-projection-impots-modal #proj-chart-regimes'), true);
                await shotThemes(page, 't2-pc-regimes');
            });
            await page.keyboard.press('Escape');
            await page.locator('[data-open-asset="oa-test-1"], [data-asset-id="oa-test-1"]').first().click();
            await page.waitForSelector('#owned-detail-view:not([hidden])');
            for (const onglet of ['Exploitation', 'Calcul']) {
                await page.locator('#owned-detail-view .owned-tab', { hasText: onglet }).click();
                await page.waitForTimeout(400);
                await shotThemes(page, `t2-pc-fiche-${onglet.toLowerCase()}`, { fullPage: true });
            }
            await page.click('.workspace-tab[data-target="workspace-panel"]');
            await shotThemes(page, 't2-pc-analyse', { fullPage: true });
        } else {
            await shotThemes(page, 't2-iphone-liste', { fullPage: true });
            await page.locator('[data-open-asset="oa-test-1"], [data-asset-id="oa-test-1"]').first().click();
            await page.waitForSelector('#owned-detail-view:not([hidden])');
            await shotThemes(page, 't2-iphone-fiche', { fullPage: true });
        }
        await finish(ctx, `T2 ${label}`);
    }
}

// ── A4 : charte typographique unique, polices locales, pas de changement de police au 1er affichage ──
// Espion posé avant tout script : heure de la fin de chargement de chaque police et du premier affichage.
const ESPION_POLICES = () => {
    window.__policesFin = [];
    window.__policesDebut = [];
    document.fonts.addEventListener('loading', () => window.__policesDebut.push(performance.now()));
    window.__fcp = null;
    document.fonts.addEventListener('loadingdone', e => window.__policesFin.push({ t: performance.now(), n: e.fontfaces.map(f => `${f.family}/${f.weight}`) }));
    new PerformanceObserver(l => { for (const p of l.getEntries()) if (p.name === 'first-contentful-paint') window.__fcp = p.startTime; }).observe({ type: 'paint', buffered: true });
};

async function scenarioA4(browser) {
    console.log('A4 — charte typographique : Inter + IBM Plex Mono, locales');
    for (const [label, path, viewport, opts] of [['PC', '/index.html', PC, {}], ['iPhone', '/owned.html', IPHONE, { contextOptions: TOUCH }]]) {
        const hotes = new Set(), polices = [];
        const ctx = await openPage(browser, path, { viewport, initScripts: [[ESPION_POLICES, null]], ...opts });
        const { page } = ctx;
        page.on('request', r => { hotes.add(new URL(r.url()).host); if (/\.(woff2?|ttf)(\?|$)/.test(r.url())) polices.push(r.url().split('/').pop()); });
        const cdp = await ctx.context.newCDPSession(page);
        await cdp.send('Network.enable');
        await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
        await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 200, downloadThroughput: 1_500_000 / 8, uploadThroughput: 750_000 / 8 });
        await page.reload({ waitUntil: 'load' });
        if (path === '/index.html') { await waitAppStarted(page); if (await page.locator('#profile-modal:not([hidden])').count()) await page.keyboard.press('Escape'); }
        else await page.waitForSelector('#owned-list-view:not([hidden])', { timeout: 30000 });
        await page.waitForTimeout(800);
        await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

        await step(`${label} : aucune requête vers Google Fonts, uniquement des polices locales`, () => {
            assert.deepEqual([...hotes].filter(h => /googleapis|gstatic/.test(h)), []);
            assert.ok(polices.includes('Inter-latin.woff2') && polices.some(p => /^IBMPlexMono-\d+\.woff2$/.test(p)), polices.join(', '));
            assert.ok(polices.every(p => /\.woff2$/.test(p)), 'seulement du woff2 : ' + polices.join(', '));
            assert.equal(polices.some(p => /Manrope|Cormorant/.test(p)), false);
        });
        await step(`${label} : préchargement des polices du premier affichage`, async () => {
            const pre = await page.$$eval('link[rel=preload][as=font]', l => l.map(x => `${x.getAttribute('href')}|${x.crossOrigin}`));
            assert.deepEqual(pre, ['Inter-latin', 'IBMPlexMono-400', 'IBMPlexMono-500', 'IBMPlexMono-600'].map(n => '/vendor/fonts/' + n + '.woff2|anonymous'));
        });
        await step(`${label} : une seule famille de texte (Inter) et une seule famille de chiffres (IBM Plex Mono) à l'écran`, async () => {
            const r = await page.evaluate(() => {
                const vis = el => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
                const f = new Set([...document.querySelectorAll('body *')].filter(el => vis(el) && el.childNodes.length && [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()))
                    .map(el => getComputedStyle(el).fontFamily.split(',')[0].replace(/["']/g, '').trim()));
                const charges = [...document.fonts].filter(x => x.status === 'loaded').map(x => x.family.replace(/["']/g, ''));
                return { familles: [...f].sort(), inter: charges.includes('Inter'), mono: charges.includes('IBM Plex Mono') };
            });
            assert.deepEqual(r.familles.filter(x => !['Inter', 'IBM Plex Mono'].includes(x)), [], JSON.stringify(r));
            assert.equal(r.inter && r.mono, true);
        });
        await step(`${label} : réseau lent (200 ms de latence) — chaque police est prête en moins de 100 ms dès qu'un texte en a besoin (pas de changement visible)`, async () => {
            const r = await page.evaluate(() => ({ debut: window.__policesDebut, fin: window.__policesFin }));
            assert.ok(r.fin.length >= 2, JSON.stringify(r));
            const lents = r.fin.map(e => ({ n: e.n, ms: Math.round(e.t - Math.max(...r.debut.filter(d => d <= e.t))) })).filter(x => x.ms > 100);
            assert.deepEqual(lents, [], JSON.stringify(r));
        });
        await shotThemes(page, `a4-${label.toLowerCase()}`, { fullPage: true });
        await finish(ctx, `A4 ${label}`);
    }
}

// ── A5 : un seul accent (l'indigo), plus d'or ; contrastes WCAG AA dans les deux thèmes ─────────
// Sonde exécutée dans la page : pour chaque élément visible portant du texte direct, couleur du texte et fond
// effectif (calques semi-transparents composés jusqu'à <html>). Relève (1) tout usage de l'ancien or (texte, fond,
// bordure), (2) tout texte de teinte indigo ou posé sur un fond indigo dont le contraste est sous 4,5:1
// (3:1 pour un grand texte : ≥ 24 px, ou ≥ 18,66 px en gras).
const SONDE_ACCENT = () => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 1;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    const rgba = c => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data;
        // canvas prémultiplie : on relit l'alpha sur fond transparent
        return [d[0], d[1], d[2], d[3] / 255]; };
    const rgbaExact = c => { const m = String(c).match(/rgba?\(([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.%]+))?/); if (m) { let a = m[4] === undefined ? 1 : (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : Number(m[4])); return [+m[1], +m[2], +m[3], a]; } return rgba(c); };
    const over = (top, bot) => { const a = top[3] + bot[3] * (1 - top[3]); if (!a) return [0, 0, 0, 0]; return [0, 1, 2].map(i => (top[i] * top[3] + bot[i] * bot[3] * (1 - top[3])) / a).concat(a); };
    const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    const hue = ([r, g, b]) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); if (mx - mn < 40) return null; const d = mx - mn; let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h = Math.round(h * 60); return h < 0 ? h + 360 : h; };
    const estIndigo = c => { const h = hue(c); return h !== null && h >= 225 && h <= 275; };
    const proche = (c, ref) => Math.abs(c[0] - ref[0]) < 14 && Math.abs(c[1] - ref[1]) < 14 && Math.abs(c[2] - ref[2]) < 14;
    const OR = [[197, 160, 89], [212, 175, 55]];
    const estOr = c => c[3] > 0.02 && OR.some(r => proche(c, r));
    const vis = el => { const b = el.getBoundingClientRect(); const s = getComputedStyle(el); return b.width > 0 && b.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0'; };
    const fond = el => { let calques = []; for (let n = el; n; n = n.parentElement) { const c = rgbaExact(getComputedStyle(n).backgroundColor); if (c[3] > 0) { calques.push(c); if (c[3] >= 1) break; } }
        let res = [255, 255, 255, 1]; for (const c of calques.reverse()) res = over(c, res); return res; };
    const nom = el => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${[...el.classList].slice(0, 2).join('.')} « ${el.textContent.trim().replace(/\s+/g, ' ').slice(0, 28)} »`;
    const or = [], bas = [];
    for (const el of document.querySelectorAll('body *')) {
        if (!vis(el)) continue;
        const s = getComputedStyle(el);
        for (const [prop, val] of [['color', s.color], ['fond', s.backgroundColor], ['bord', s.borderTopWidth !== '0px' ? s.borderTopColor : 'rgba(0,0,0,0)'], ['bord-bas', s.borderBottomWidth !== '0px' ? s.borderBottomColor : 'rgba(0,0,0,0)']]) {
            if (estOr(rgbaExact(val))) or.push(`${prop} ${nom(el)}`);
        }
        const aTexte = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
        if (!aTexte) continue;
        const bg = fond(el), fg = over(rgbaExact(s.color), bg);
        if (!(estIndigo(rgbaExact(s.color)) || estIndigo(bg))) continue;
        const taille = parseFloat(s.fontSize), gras = parseInt(s.fontWeight, 10) >= 700;
        const seuil = (taille >= 24 || (taille >= 18.66 && gras)) ? 3 : 4.5;
        const r = ratio(fg, bg);
        if (r < seuil) bas.push(`${r.toFixed(2)}:1 (< ${seuil}) ${nom(el)}`);
    }
    return { or: [...new Set(or)], bas: [...new Set(bas)] };
};

// Écrans parcourus par les scénarios A5 (couleurs) et A7 (icônes) : [nom, chemin, viewport, options, aller].
function listeEcrans() {
    return [
        ['pc-analyse', '/index.html', PC, {}, async () => {}],
        ['pc-portefeuille', '/index.html', PC, {}, async p => { await p.click('.workspace-tab[data-target="collection-panel"]'); }],
        ...['Acquisition', 'Exploitation', 'Travaux', 'Calcul'].map(o => [`pc-fiche-${o.toLowerCase()}`, '/index.html', PC, {}, async p => {
            await p.click('.workspace-tab[data-target="collection-panel"]');
            await p.locator('[data-open-asset="oa-test-1"], [data-asset-id="oa-test-1"]').first().click();
            await p.waitForSelector('#owned-detail-view:not([hidden])');
            await p.locator('#owned-detail-view .owned-tab', { hasText: o }).click(); }]),
        ['pc-assistant', '/index.html', PC, {}, async p => { await p.click('.workspace-tab[data-target="assistant-panel"]'); }],
        ['pc-modale-projection', '/index.html', PC, {}, async p => { await p.click('.workspace-tab[data-target="collection-panel"]'); await p.click('#owned-dashboard-wrap [data-action="open-projection-impots"]'); await p.waitForSelector('#owned-projection-impots-modal:not([hidden])'); }],
        ['pc-modale-factures', '/index.html', PC, {}, async p => { await p.click('#owned-quickfab'); await p.waitForSelector('#owned-factures-modal:not([hidden])'); }],
        ['pc-analyse-guide', '/index.html', PC, {}, async p => { await p.click('#mode-btn-guided'); }],
        ['pc-modale-regimes', '/index.html', PC, {}, async p => { await p.evaluate(() => { const m = document.getElementById('modal-regimes'); m.classList.add('is-open'); m.setAttribute('aria-hidden', 'false'); }); }],
        ['pc-portefeuille-impot', '/index.html', PC, {}, async p => { await p.click('.workspace-tab[data-target="collection-panel"]'); await p.click('.owned-list-tabs [data-tab="impot"]'); }],
        ['pc-portefeuille-profil', '/index.html', PC, {}, async p => { await p.click('.workspace-tab[data-target="collection-panel"]'); await p.click('.owned-list-tabs [data-tab="profil"]'); }],
        ['pc-modale-import', '/index.html', PC, {}, async p => { await p.click('.workspace-tab[data-target="collection-panel"]'); await p.click('#owned-import-btn'); await p.waitForSelector('#owned-import-modal:not([hidden])'); }],
        ['pc-modale-dossier-bancaire', '/index.html', PC, {}, async p => { await p.click('.workspace-tab[data-target="collection-panel"]'); await p.locator('[data-open-asset="oa-test-1"], [data-asset-id="oa-test-1"]').first().click(); await p.click('#owned-bank-dossier-btn'); await p.waitForTimeout(400); }],
        ['pc-analyse-remplie', '/index.html', PC, {}, async p => { await p.fill('[name="prix"]', '150000'); await p.fill('[name="loyer"]', '750'); await p.locator('[name="loyer"]').dispatchEvent('input'); }],
        ['iphone-liste', '/owned.html', IPHONE, { contextOptions: TOUCH }, async () => {}],
        ...['Acquisition', 'Travaux', 'Calcul'].map(o => [`iphone-fiche-${o.toLowerCase()}`, '/owned.html', IPHONE, { contextOptions: TOUCH }, async p => {
            await p.locator('[data-open-asset="oa-test-1"], [data-asset-id="oa-test-1"]').first().click();
            await p.waitForSelector('#owned-detail-view:not([hidden])');
            await p.locator('#owned-detail-view .owned-tab', { hasText: o }).click(); }]),
    ];
}

async function scenarioA5(browser) {
    console.log('A5 — accent unique (indigo), contrastes AA');
    const ecrans = listeEcrans();
    for (const [nom, path, viewport, opts, aller] of ecrans) {
        const ctx = await openPage(browser, path, { viewport, seedCloud: SEED_T2, routes: ROUTES_T2, ...opts });
        const { page } = ctx;
        if (path === '/index.html') { await waitAppStarted(page); if (await page.locator('#profile-modal:not([hidden])').count()) await page.keyboard.press('Escape'); }
        else await page.waitForSelector('#owned-list-view:not([hidden])', { timeout: 10000 });
        await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" }); // couleurs mesurées à l’état final, pas en cours de transition
        await aller(page);
        await page.waitForTimeout(500);
        for (const [theme, suffixe] of [['light', 'clair'], ['dark', 'sombre']]) {
            await page.evaluate(t => { document.documentElement.dataset.theme = t; }, theme);
            await page.waitForTimeout(250);
            const r = await page.evaluate(SONDE_ACCENT);
            await step(`${nom} (${suffixe}) : aucun usage de l'ancien or ; textes accentués et textes sur fond accentué à 4,5:1 minimum`, () => {
                assert.deepEqual(r.or, [], 'or résiduel');
                assert.deepEqual(r.bas, [], 'contrastes insuffisants');
            });
            await shot(page, `a5-${nom}-${suffixe}`);
        }
        await finish(ctx, `A5 ${nom}`);
    }
}

// ── A7 : une seule famille d'icônes (SVG en ligne), plus d'emoji ni de glyphes, nom accessible partout ──
// Sonde exécutée dans la page : (1) aucun emoji ni glyphe d'interface (✦ ✕ ✓ ✗ ⚠ ☀ ☾ ↑ ↓ ▶ ● ○ ★) dans le texte visible,
// (2) ← et → seulement dans une phrase, jamais en tête/en fin d'un bouton ou d'un lien, (3) tout bouton/lien sans texte
// visible porte un nom (aria-label, title ou aria-labelledby), (4) toute icône est décorative (aria-hidden), visible et
// dimensionnée, (5) aucun marqueur de gabarit « ${ » ni <i data-icone> non remplacé.
const SONDE_ICONES = () => {
    const vis = el => { const b = el.getBoundingClientRect(); const s = getComputedStyle(el); return b.width > 0 && b.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const nom = el => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${[...el.classList].slice(0, 2).join('.')} « ${el.textContent.trim().replace(/\s+/g, ' ').slice(0, 30)} »`;
    const PICTO = /(?![©®™])\p{Extended_Pictographic}|[✦✕✓✗⚠☀☾↑↓▶●○★☆]/u;
    const out = { glyphes: [], fleches: [], sansNom: [], icones: [], gabarit: [] };
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
        const el = n.parentElement;
        if (!el || ['SCRIPT', 'STYLE', 'OPTION', 'TEXTAREA'].includes(el.tagName) || !vis(el)) continue;
        const txt = n.textContent;
        if (PICTO.test(txt)) out.glyphes.push(`${nom(el)} → ${[...txt.matchAll(new RegExp(PICTO.source, 'gu'))].map(m => m[0]).join('')}`);
        if (/\$\{/.test(txt)) out.gabarit.push(nom(el));
        const bouton = el.closest('button, a[href], [role=button], [role=tab], summary');
        if (bouton && /^\s*[←→]|[←→]\s*$/.test(bouton.textContent.trim())) out.fleches.push(nom(bouton));
    }
    for (const el of document.querySelectorAll('button, a[href], [role=button], [role=tab], summary')) {
        if (!vis(el)) continue;
        const clone = el.cloneNode(true); clone.querySelectorAll('svg, .sr-only').forEach(x => x.remove());
        const texteVisible = clone.textContent.trim();
        if (!texteVisible && !(el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('aria-labelledby') || el.querySelector('.sr-only'))) out.sansNom.push(nom(el) + ' ' + el.className);
    }
    for (const s of document.querySelectorAll('svg.icone')) {
        if (!vis(s)) continue;
        const b = s.getBoundingClientRect();
        if (s.getAttribute('aria-hidden') !== 'true' || b.width < 8 || b.height < 8 || b.width > 40) out.icones.push(`${s.getAttribute('class')} ${Math.round(b.width)}x${Math.round(b.height)} dans ${nom(s.parentElement)}`);
    }
    if (document.querySelector('i[data-icone]')) out.gabarit.push('<i data-icone> non remplacé');
    out.nbIcones = [...document.querySelectorAll('svg.icone')].filter(vis).length;
    return out;
};

async function scenarioA7(browser) {
    console.log('A7 — icônes : une seule famille, noms accessibles');
    let total = 0;
    for (const [nom, path, viewport, opts, aller] of listeEcrans()) {
        const ctx = await openPage(browser, path, { viewport, seedCloud: SEED_T2, routes: ROUTES_T2, ...opts });
        const { page } = ctx;
        if (path === '/index.html') { await waitAppStarted(page); if (await page.locator('#profile-modal:not([hidden])').count()) await page.keyboard.press('Escape'); }
        else await page.waitForSelector('#owned-list-view:not([hidden])', { timeout: 10000 });
        await aller(page);
        await page.waitForTimeout(500);
        const r = await page.evaluate(SONDE_ICONES);
        total += r.nbIcones;
        await step(`${nom} : ${r.nbIcones} icônes SVG, aucun emoji/glyphe, flèches seulement dans le texte, boutons nommés, icônes décoratives`, () => {
            assert.deepEqual(r.glyphes, [], 'emoji ou glyphes');
            assert.deepEqual(r.fleches, [], 'flèche texte sur un bouton');
            assert.deepEqual(r.sansNom, [], 'bouton ou lien sans nom accessible');
            assert.deepEqual(r.icones, [], 'icône mal formée');
            assert.deepEqual(r.gabarit, [], 'gabarit non résolu');
        });
        await shotThemes(page, `a7-${nom}`);
        await finish(ctx, `A7 ${nom}`);
    }
    await step(`au total ${total} icônes rendues sur l'ensemble des écrans`, () => assert.ok(total >= 60, String(total)));
}

const SCENARIOS = { T5: scenarioT5, T5IPHONE: scenarioT5Iphone, T2: scenarioT2, A4: scenarioA4, A5: scenarioA5, A7: scenarioA7 };
const only = (process.env.L3_ONLY || '').split(',').filter(Boolean);

const browser = await chromium.launch();
try {
    for (const [name, fn] of Object.entries(SCENARIOS)) {
        if (only.length && !only.includes(name)) continue;
        await fn(browser);
    }
} finally {
    await browser.close();
}
const failures = getFailures();
console.log(failures ? `\n${failures} échec(s)` : '\nOK — toutes les étapes passent');
process.exit(failures ? 1 : 0);
