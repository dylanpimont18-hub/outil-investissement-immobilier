// Test hors ligne de la Cloud Function changerMotDePasse (functions/index.js).
// Lancer : node tests/functions-changer-mot-de-passe.cjs
//
// Le SDK Admin est simulé (aucun appel Firebase réel). La simulation reproduit le piège du premier
// déploiement (2026-10-04) : firebase-functions crée une app Admin interne nommée
// "__FIREBASE_FUNCTIONS_SDK__", et getAuth() échoue avec app/no-app tant que l'app par défaut n'a
// pas été initialisée. Un test qui renvoyait simplement une liste d'apps non vide masquait ce bug.
const assert = require('node:assert/strict');
const path = require('node:path');

const functionsDir = path.join(__dirname, '..', 'functions');
const apps = [{ name: '__FIREBASE_FUNCTIONS_SDK__' }];
const calls = [];
let nextUpdateError = null;

function stubModule(request, exports) {
    const resolved = require.resolve(request, { paths: [functionsDir] });
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
stubModule('firebase-admin/app', {
    getApps: () => apps,
    initializeApp: () => { apps.push({ name: '[DEFAULT]' }); }
});
stubModule('firebase-admin/auth', {
    getAuth: () => {
        if (!apps.some(a => a.name === '[DEFAULT]')) {
            const e = new Error('The default Firebase app does not exist.'); e.code = 'app/no-app'; throw e;
        }
        return {
            updateUser: async (uid, props) => {
                if (nextUpdateError) { const e = new Error('refus'); e.code = nextUpdateError; nextUpdateError = null; throw e; }
                calls.push([uid, props.password]);
            }
        };
    }
});

const fn = require(path.join(functionsDir, 'index.js')).changerMotDePasse;
const run = async req => {
    try { return await fn.run(req); } catch (e) { return { error: e.code, message: e.message }; }
};

(async () => {
    let r = await run({ data: { motDePasse: 'abcdefgh1' } });
    assert.equal(r.error, 'unauthenticated');
    console.log('✓ refus sans connexion');

    r = await run({ auth: { uid: 'u1' }, data: { motDePasse: 'court' } });
    assert.equal(r.error, 'invalid-argument');
    r = await run({ auth: { uid: 'u1' }, data: { motDePasse: 12345678 } });
    assert.equal(r.error, 'invalid-argument');
    console.log('✓ refus d\'un mot de passe trop court ou non textuel');

    r = await run({ auth: { uid: 'u1' }, data: { motDePasse: 'abcdefgh1' } });
    assert.deepEqual(r, { ok: true }, 'succès malgré l\'app interne de firebase-functions');
    assert.deepEqual(calls, [['u1', 'abcdefgh1']]);
    console.log('✓ succès : l\'app Admin par défaut est initialisée même si une app interne existe déjà');

    nextUpdateError = 'auth/password-does-not-meet-requirements';
    r = await run({ auth: { uid: 'u2' }, data: { motDePasse: 'abcdefgh1' } });
    assert.equal(r.error, 'internal');
    assert.match(r.message, /politique de sécurité/);
    assert.match(r.message, /Mot de passe inchangé \(code : auth\/password-does-not-meet-requirements\)/);
    console.log('✓ erreur Firebase traduite en message détaillé avec son code');

    for (let i = 0; i < 4; i++) await run({ auth: { uid: 'u3' }, data: { motDePasse: 'abcdefgh1' } });
    r = await run({ auth: { uid: 'u3' }, data: { motDePasse: 'abcdefgh1' } });
    assert.equal(r.error, undefined, '5e appel encore autorisé');
    r = await run({ auth: { uid: 'u3' }, data: { motDePasse: 'abcdefgh1' } });
    assert.equal(r.error, 'resource-exhausted');
    console.log('✓ plafond de 5 appels par heure et par compte');

    console.log('\nOK');
})().catch(err => { console.error('✗', err.message); process.exit(1); });
