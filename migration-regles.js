// Règles pures de la migration unique « stockage local de l'exe → cloud » (voir migration-locale.js
// et docs/superpowers/specs/2026-10-11-passage-tout-web-prompt.md, point 5). Aucun accès DOM,
// window ou localStorage : les lecteurs reçoivent une fonction getItem(key) pour rester testables
// sous Node (tests/test_migration_regles.mjs). nomArchiveUnique est aussi utilisée par l'export du
// portefeuille (owned-portfolio.js).

// Une étude du comparateur existe des deux côtés : la plus récente (updatedAt) gagne, à défaut la
// locale — elle vient de l'appareil que l'utilisateur utilisait réellement jusqu'ici.
export function choisirEtude(locale, cloud) {
    if (!cloud) return locale;
    if (!locale) return cloud;
    const dateCloud = Number(cloud.updatedAt) || 0;
    const dateLocale = Number(locale.updatedAt) || 0;
    return dateCloud > dateLocale ? cloud : locale;
}

// Égalité profonde indépendante de l'ordre des clés (Firestore ne garantit pas l'ordre à la
// relecture). `undefined` vaut « absent » : Firestore ne stocke jamais cette valeur.
export function comparerProfond(a, b) {
    if (Object.is(a, b)) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) {
        return a.length === b.length && a.every((v, i) => comparerProfond(v, b[i]));
    }
    const clesA = Object.keys(a).filter(k => a[k] !== undefined);
    const clesB = Object.keys(b).filter(k => b[k] !== undefined);
    if (clesA.length !== clesB.length) return false;
    return clesA.every(k => Object.prototype.hasOwnProperty.call(b, k) && comparerProfond(a[k], b[k]));
}

// Firestore rejette undefined et les fonctions : un aller-retour JSON les retire (les Dates
// deviendraient des chaînes, mais aucune donnée Spark n'en contient).
export function normaliserPourFirestore(obj) {
    return JSON.parse(JSON.stringify(obj));
}

// Même convention que l'ancien server.py : portefeuille-AAAA-MM-JJ.json, puis -1, -2…
export function nomArchiveUnique(base, existants) {
    const pris = new Set(existants || []);
    let nom = `${base}.json`;
    for (let i = 1; pris.has(nom); i++) nom = `${base}-${i}.json`;
    return nom;
}

function _json(getItem, key) {
    try {
        const raw = getItem(key);
        return raw === null || raw === undefined ? null : JSON.parse(raw);
    } catch {
        return null;
    }
}
const _estObjet = v => v !== null && typeof v === 'object' && !Array.isArray(v);

export function lireEtudesLocales(getItem) {
    const brut = _json(getItem, 'investissementWebAssetRecords');
    return Array.isArray(brut) ? brut.filter(_estObjet) : [];
}

export function lireAnalyseLocale(getItem) {
    const variablesData = _json(getItem, 'investissementWebVariablesData');
    if (!_estObjet(variablesData)) return null;
    const active = getItem('investissementWebActiveAssetId');
    return { variablesData, activeAssetId: typeof active === 'string' && active ? active : null };
}

// Clés d'interface de l'ancien localStorage → document settings/prefs. Clé absente → omise (la valeur
// par défaut s'applique côté app sans jamais être écrite).
export function lirePrefsLocales(getItem) {
    const prefs = {};
    const theme = getItem('investissementWebTheme');
    if (theme === 'light' || theme === 'dark') prefs.theme = theme;
    const screens = getItem('investissementWebScreens');
    if (screens === '1' || screens === '2') prefs.screens = Number(screens);
    const preset = getItem('investissementWebProfile');
    if (typeof preset === 'string' && preset) prefs.profilePreset = preset;
    const guided = getItem('investissementWebGuidedMode');
    if (guided === 'true' || guided === 'false') prefs.guidedMode = guided === 'true';
    const sparkMode = getItem('investissementWebSparkMode');
    if (sparkMode === 'guided' || sparkMode === 'full') prefs.sparkMode = sparkMode;
    const tuto = getItem('sparkTutoStep');
    if (tuto !== null && Number.isInteger(Number(tuto))) prefs.tutoStep = Number(tuto);
    const view = getItem('investissementWebAnalysisView');
    if (view === 'quick' || view === 'full') prefs.analysisView = view;
    const compact = getItem('investissementWebOwnedCompact');
    if (compact === '1' || compact === '0') prefs.ownedCompact = compact === '1';
    const sort = _json(getItem, 'investissementWebOwnedSort');
    if (_estObjet(sort)) prefs.ownedSort = sort;
    for (const [cle, locale] of [['ownedYearFilters', 'investissementWebOwnedYearFilters'], ['ownedPieYear', 'investissementWebOwnedPieYear'], ['ownedPieMonth', 'investissementWebOwnedPieMonth']]) {
        const v = _json(getItem, locale);
        if (_estObjet(v)) prefs[cle] = v;
    }
    const lastAsset = getItem('spark:factures:lastAsset');
    if (typeof lastAsset === 'string' && lastAsset) prefs.facturesLastAsset = lastAsset;
    return prefs;
}

export function lireProfilLocal(getItem) {
    const profil = _json(getItem, 'investissementWebProfileData');
    return { profil: _estObjet(profil) ? profil : null, configure: getItem('investissementWebProfileConfigured') === '1' };
}

// Ancien portefeuille local (régime, ordre, objectifs) : à ne pousser que si portfolioMeta ne les a pas.
export function lireMetaLocale(getItem) {
    const meta = {};
    const regime = getItem('investissementWebOwnedRegime');
    if (typeof regime === 'string' && regime) meta.regime = regime;
    const order = _json(getItem, 'investissementWebOwnedOrder');
    if (Array.isArray(order)) meta.order = order;
    const goals = _json(getItem, 'investissementWebPortfolioGoals');
    if (_estObjet(goals)) meta.goals = goals;
    return meta;
}
