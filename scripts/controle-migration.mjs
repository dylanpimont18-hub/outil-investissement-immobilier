// scripts/controle-migration.mjs — Phase 4 du passage au tout-web : relit settings/migration, compte les
// études et liste les archives, dans un vrai Chromium (SDK Firebase réel, aucune dépendance npm
// supplémentaire). Lecture seule : rien n'est écrit, aucun clic dans la page.
// Par défaut, l'utilisateur se connecte lui-même dans la fenêtre ouverte (jamais de mot de passe dans le script).
// Prérequis : `node scripts/serve-static.mjs 8090`. Lancer : node scripts/controle-migration.mjs
// Options (variables d'environnement) :
//   SPARK_USER_DATA_DIR : profil Chromium persistant (session Firebase déjà ouverte), sans fenêtre ni mot de passe ;
//                         les requêtes de SPARK_ORIGIN (défaut http://127.0.0.1:8080) sont servies depuis SPARK_TEST_BASE.
//   SPARK_LOGIN_TIMEOUT_MS : délai d'attente de la connexion en ms (défaut 300000).
import { chromium } from 'playwright';

const BASE = process.env.SPARK_TEST_BASE || 'http://127.0.0.1:8090';
const ORIGIN = process.env.SPARK_ORIGIN || 'http://127.0.0.1:8080';
const USER_DATA_DIR = process.env.SPARK_USER_DATA_DIR;
const LOGIN_TIMEOUT_MS = Number(process.env.SPARK_LOGIN_TIMEOUT_MS) || 300000;

let browser = null;
let context = null;
let page;
if (USER_DATA_DIR) {
    // Mode profil : l'origine du profil est interceptée et rechargée depuis le serveur statique local (aucune connexion TCP au port d'origine).
    context = await chromium.launchPersistentContext(USER_DATA_DIR, { headless: true, viewport: { width: 1200, height: 800 } });
    await context.route(`${ORIGIN}/**`, async route => {
        const resp = await route.fetch({ url: route.request().url().replace(ORIGIN, BASE) });
        await route.fulfill({ response: resp });
    });
    page = await context.newPage();
    await page.goto(`${ORIGIN}/index.html`, { waitUntil: 'load' });
} else {
    browser = await chromium.launch({ headless: false });
    page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.goto(`${BASE}/index.html`, { waitUntil: 'load' });
    console.log('Connectez-vous dans la fenêtre ouverte (5 minutes max)…');
}
try {
    // Le prédicat de waitForFunction doit être synchrone (une Promise serait toujours « vraie ») : on garde donc `auth` sur window.
    await page.evaluate(async () => { window.__sparkAuth = (await import('./firebase-init.js')).auth; });
    await page.waitForFunction(() => window.__sparkAuth.currentUser !== null, null, { timeout: LOGIN_TIMEOUT_MS, polling: 1000 });
    const resultat = await page.evaluate(async () => {
        const store = await import('./cloud-store.js');
        const [migration, studies, analysis, prefs, archives] = await Promise.all([
            store.cloudGetSetting('migration'), store.cloudGetAllStudies(), store.cloudGetSetting('analysis'), store.cloudGetSetting('prefs'), store.cloudListArchives()
        ]);
        return {
            migration,
            nbEtudes: Object.keys(studies).length,
            etudes: Object.values(studies).map(s => ({ id: s.id, nom: s.variablesData?.['nom-bien'], updatedAt: new Date(s.updatedAt).toISOString() })),
            analysis: analysis ? { nom: analysis.variablesData?.['nom-bien'], activeAssetId: analysis.activeAssetId } : null,
            prefsKeys: Object.keys(prefs || {}),
            archives: archives.map(a => `${a.name} (${a.size} o)`)
        };
    });
    console.log(JSON.stringify(resultat, null, 2));
} finally {
    if (context) await context.close();
    else await browser.close();
}
