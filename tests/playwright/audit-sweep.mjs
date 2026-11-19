// Balayage d'audit (lecture seule) : visite chaque onglet PC + iPhone et relève des défauts mesurables.
import { chromium } from 'playwright';
import fs from 'node:fs';
import { openPage, waitAppStarted } from './_harness.mjs';

const OUT = process.env.AUDIT_OUT || '.';
const report = {};

const PROBE = () => {
    const vis = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const out = {};
    out.scrollW = document.documentElement.scrollWidth; out.innerW = window.innerWidth;
    out.overflowX = [...document.querySelectorAll('body *')].filter(el => vis(el) && el.getBoundingClientRect().right > window.innerWidth + 2 && !el.closest('[style*="overflow"], .table-wrap, [class*="scroll"]'))
        .slice(0, 12).map(el => `${el.tagName.toLowerCase()}#${el.id}.${[...el.classList].join('.')} right=${Math.round(el.getBoundingClientRect().right)}`);
    out.badText = [...document.querySelectorAll('body *')].filter(el => vis(el) && el.children.length === 0 && /\b(NaN|undefined|Infinity|null)\b|--\d|€\s*-?NaN|\[object/.test(el.textContent))
        .slice(0, 15).map(el => `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}: ${el.textContent.trim().slice(0, 80)}`);
    out.noName = [...document.querySelectorAll('button, a[href], [role=button]')].filter(el => vis(el) && !(el.textContent.trim() || el.getAttribute('aria-label') || el.getAttribute('title') || el.querySelector('img[alt]')))
        .slice(0, 15).map(el => `${el.tagName.toLowerCase()}#${el.id}.${[...el.classList].join('.')}`);
    out.noLabel = [...document.querySelectorAll('input:not([type=hidden]):not([type=file]), select, textarea')].filter(el => vis(el) && !(el.labels?.length || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title')))
        .slice(0, 25).map(el => `${el.tagName.toLowerCase()}#${el.id}[name=${el.name}] ph="${el.placeholder || ''}"`);
    const ids = {}; document.querySelectorAll('[id]').forEach(el => { ids[el.id] = (ids[el.id] || 0) + 1; });
    out.dupIds = Object.entries(ids).filter(([, n]) => n > 1).map(([id, n]) => `${id}×${n}`);
    out.small = [...document.querySelectorAll('button, a[href], input, select, [role=button], [role=tab]')].filter(el => vis(el)).map(el => [el, el.getBoundingClientRect()])
        .filter(([, r]) => r.width < 44 || r.height < 44).length;
    out.tinyText = [...document.querySelectorAll('body *')].filter(el => vis(el) && el.children.length === 0 && el.textContent.trim() && parseFloat(getComputedStyle(el).fontSize) < 11).length;
    out.fonts = [...new Set([...document.querySelectorAll('body *')].filter(vis).map(el => getComputedStyle(el).fontFamily.split(',')[0].replace(/"/g, '').trim()))];
    out.monoLoaded = document.fonts.check('12px "IBM Plex Mono"');
    out.imgNoAlt = [...document.querySelectorAll('img')].filter(i => !i.hasAttribute('alt')).length;
    out.h1 = document.querySelectorAll('h1').length;
    out.lang = document.documentElement.lang;
    // tokens CSS utilisés mais non définis
    const used = new Set(), defined = new Set();
    for (const sh of document.styleSheets) { let rules; try { rules = sh.cssRules; } catch { continue; }
        const walk = rs => { for (const r of rs) { if (r.cssRules) walk(r.cssRules); if (r.style) { for (const p of r.style) if (p.startsWith('--')) defined.add(p); const t = r.cssText; for (const m of t.matchAll(/var\((--[\w-]+)\s*\)/g)) used.add(m[1]); } } };
        walk(rules); }
    out.undefinedTokens = [...used].filter(v => !defined.has(v) && !getComputedStyle(document.documentElement).getPropertyValue(v));
    return out;
};

async function probe(page, key) {
    await page.waitForTimeout(400);
    report[key] = await page.evaluate(PROBE);
    fs.writeFileSync(`${OUT}/audit-sweep.json`, JSON.stringify(report, null, 1)); fs.writeFileSync(`${OUT}/audit-sweep.json`, JSON.stringify(report, null, 1));
    if (process.env.AUDIT_SHOTS) await page.screenshot({ path: `${process.env.AUDIT_SHOTS}/${key}.png`, fullPage: true });
}

const browser = await chromium.launch();
try {
    // PC
    const pc = await openPage(browser, '/index.html', { viewport: { width: 1440, height: 900 } });
    await waitAppStarted(pc.page);
    const p = pc.page;
    if (await p.locator('#profile-modal:not([hidden])').count()) await p.keyboard.press('Escape');
    await probe(p, 'pc-analyse-vide');
    await p.fill('[name="prix"]', '150000').catch(() => {}); await p.fill('[name="loyer"]', '750').catch(() => {});
    await p.locator('[name="loyer"]').dispatchEvent('input').catch(() => {});
    await probe(p, 'pc-analyse-remplie');
    report.pcTabs = await p.$$eval('.workspace-tab', t => t.map(x => x.dataset.target + ':' + x.textContent.trim()));
    for (const target of ['collection-panel', 'assistant-panel']) {
        await p.click(`.workspace-tab[data-target="${target}"]`).catch(() => {});
        await probe(p, `pc-${target}`);
        report[`pc-${target}-analysisControlsVisible`] = await p.evaluate(() => ['save-asset', 'new-asset', 'export-decision-pdf', 'mode-toggle'].map(id => { const el = document.getElementById(id); if (!el) return id + ':absent'; const r = el.getBoundingClientRect(); return id + ':' + (r.width > 0 && r.height > 0); }));
    }
    await p.click('.workspace-tab[data-target="collection-panel"]');
    await p.locator('[data-open-asset="oa-test-1"], [data-asset-id="oa-test-1"]').first().click({ timeout: 5000 }).catch(e => report.openAssetErr = e.message);
    await p.waitForTimeout(500);
    const tabs = await p.$$eval('#owned-detail-view .owned-tab', t => t.map(x => x.textContent.trim()));
    report.pcAssetTabs = tabs;
    for (let i = 0; i < tabs.length; i++) { await p.locator('#owned-detail-view .owned-tab').nth(i).click({ timeout: 3000 }).catch(() => {}); await probe(p, `pc-bien-${tabs[i].replace(/\W+/g, '_')}`); }
    report.pcErrors = pc.errors;
    await pc.context.close();

    // iPhone
    const m = await openPage(browser, '/owned.html', { viewport: { width: 393, height: 852 }, contextOptions: { hasTouch: true, isMobile: true } });
    await m.page.waitForSelector('#owned-list-view:not([hidden])', { timeout: 10000 });
    await probe(m.page, 'm-liste');
    await m.page.locator('[data-open-asset="oa-test-1"], [data-asset-id="oa-test-1"]').first().click({ timeout: 5000 }).catch(e => report.mOpenErr = e.message);
    await m.page.waitForTimeout(500);
    const mt = await m.page.$$eval('#owned-detail-view .owned-tab', t => t.map(x => x.textContent.trim()));
    for (let i = 0; i < mt.length; i++) { await m.page.locator('#owned-detail-view .owned-tab').nth(i).click({ timeout: 3000 }).catch(() => {}); await probe(m.page, `m-bien-${mt[i].replace(/\W+/g, '_')}`); }
    report.mErrors = m.errors;
    await m.context.close();
    // index.html sur iPhone
    const mi = await openPage(browser, '/index.html', { viewport: { width: 393, height: 852 }, contextOptions: { hasTouch: true, isMobile: true } });
    await waitAppStarted(mi.page); await probe(mi.page, 'm-index');
    report.miErrors = mi.errors; await mi.context.close();
} finally { await browser.close(); }
fs.writeFileSync(`${OUT}/audit-sweep.json`, JSON.stringify(report, null, 1));
console.log('écrit', `${OUT}/audit-sweep.json`);
