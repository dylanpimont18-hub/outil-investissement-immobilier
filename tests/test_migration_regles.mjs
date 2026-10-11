// Tests des règles pures de la migration locale → cloud (migration-regles.js).
import assert from 'node:assert/strict';
import {
    choisirEtude, comparerProfond, normaliserPourFirestore, nomArchiveUnique,
    lireEtudesLocales, lireAnalyseLocale, lirePrefsLocales, lireProfilLocal, lireMetaLocale
} from '../migration-regles.js';

const fauxStockage = entries => {
    const m = new Map(Object.entries(entries));
    return key => (m.has(key) ? m.get(key) : null);
};

// choisirEtude : le plus récent gagne, à défaut l'étude locale
assert.equal(choisirEtude({ id: 'a', updatedAt: 10 }, null).updatedAt, 10, 'pas de cloud → locale');
assert.equal(choisirEtude(null, { id: 'a', updatedAt: 5 }).updatedAt, 5, 'pas de locale → cloud');
assert.equal(choisirEtude({ id: 'a', updatedAt: 10 }, { id: 'a', updatedAt: 20 }).updatedAt, 20, 'cloud plus récent');
assert.equal(choisirEtude({ id: 'a', updatedAt: 30 }, { id: 'a', updatedAt: 20 }).updatedAt, 30, 'locale plus récente');
assert.equal(choisirEtude({ id: 'a', updatedAt: 20 }, { id: 'a', updatedAt: 20, cloud: true }).cloud, undefined, 'égalité → locale');
assert.equal(choisirEtude({ id: 'a' }, { id: 'a', updatedAt: 1 }).updatedAt, 1, 'locale sans updatedAt → cloud daté gagne');

// comparerProfond : indépendant de l'ordre des clés, strict sur les valeurs
assert.equal(comparerProfond({ a: 1, b: [1, { c: null }] }, { b: [1, { c: null }], a: 1 }), true);
assert.equal(comparerProfond({ a: 1 }, { a: '1' }), false);
assert.equal(comparerProfond({ a: 1 }, { a: 1, b: 2 }), false);
assert.equal(comparerProfond([1, 2], [2, 1]), false);
assert.equal(comparerProfond({ a: undefined }, {}), true, 'undefined = absent (Firestore ne stocke pas undefined)');
assert.equal(comparerProfond(NaN, NaN), true);

// normaliserPourFirestore : clone JSON, retire undefined/fonctions
const n = normaliserPourFirestore({ a: 1, b: undefined, c: () => 1, d: { e: [1, undefined] } });
assert.deepEqual(n, { a: 1, d: { e: [1, null] } });

// nomArchiveUnique : même règle que l'ancien server.py (suffixe -1, -2…)
assert.equal(nomArchiveUnique('portefeuille-2026-10-11', []), 'portefeuille-2026-10-11.json');
assert.equal(nomArchiveUnique('portefeuille-2026-10-11', ['portefeuille-2026-10-11.json']), 'portefeuille-2026-10-11-1.json');
assert.equal(nomArchiveUnique('portefeuille-2026-10-11', ['portefeuille-2026-10-11.json', 'portefeuille-2026-10-11-1.json']), 'portefeuille-2026-10-11-2.json');

// Lecture typée de l'ancien localStorage
const getItem = fauxStockage({
    investissementWebAssetRecords: JSON.stringify([{ id: 'asset-1', variablesData: { prix: 100000 }, createdAt: 1, updatedAt: 2 }, 'pas un objet']),
    investissementWebVariablesData: JSON.stringify({ prix: 150000, loyer: 700 }),
    investissementWebActiveAssetId: 'asset-1',
    investissementWebTheme: 'light',
    investissementWebScreens: '2',
    investissementWebProfile: 'couple',
    investissementWebGuidedMode: 'true',
    investissementWebSparkMode: 'guided',
    sparkTutoStep: '3',
    investissementWebAnalysisView: 'full',
    investissementWebOwnedCompact: '1',
    investissementWebOwnedSort: JSON.stringify({ criterion: 'cf', dir: 'desc' }),
    investissementWebOwnedYearFilters: JSON.stringify({ 'oa-1': 3 }),
    investissementWebOwnedPieYear: JSON.stringify({ 'oa-1': 2026 }),
    'spark:factures:lastAsset': 'oa-1',
    investissementWebProfileData: JSON.stringify({ name: 'Nous', income: 50000, adults: 2, children: 1 }),
    investissementWebProfileConfigured: '1',
    investissementWebOwnedRegime: 'reel',
    investissementWebOwnedOrder: JSON.stringify(['oa-1']),
    investissementWebPortfolioGoals: JSON.stringify({ cfMensuel: 500 })
});
assert.deepEqual(lireEtudesLocales(getItem), [{ id: 'asset-1', variablesData: { prix: 100000 }, createdAt: 1, updatedAt: 2 }], 'entrées non-objet ignorées');
assert.deepEqual(lireAnalyseLocale(getItem), { variablesData: { prix: 150000, loyer: 700 }, activeAssetId: 'asset-1' });
assert.deepEqual(lirePrefsLocales(getItem), {
    theme: 'light', screens: 2, profilePreset: 'couple', guidedMode: true, sparkMode: 'guided', tutoStep: 3,
    analysisView: 'full', ownedCompact: true, ownedSort: { criterion: 'cf', dir: 'desc' }, ownedYearFilters: { 'oa-1': 3 },
    ownedPieYear: { 'oa-1': 2026 }, facturesLastAsset: 'oa-1'
}, 'ownedPieMonth absent → clé omise');
assert.deepEqual(lireProfilLocal(getItem), { profil: { name: 'Nous', income: 50000, adults: 2, children: 1 }, configure: true });
assert.deepEqual(lireMetaLocale(getItem), { regime: 'reel', order: ['oa-1'], goals: { cfMensuel: 500 } });

// Stockage vide ou corrompu : rien ne casse, rien n'est inventé
const vide = fauxStockage({ investissementWebVariablesData: '{pas du json', investissementWebAssetRecords: '42' });
assert.deepEqual(lireEtudesLocales(vide), []);
assert.equal(lireAnalyseLocale(vide), null);
assert.deepEqual(lirePrefsLocales(vide), {});
assert.deepEqual(lireProfilLocal(vide), { profil: null, configure: false });
assert.deepEqual(lireMetaLocale(vide), {});

console.log('test_migration_regles: OK');
