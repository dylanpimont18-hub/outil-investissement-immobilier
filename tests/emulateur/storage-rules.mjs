// Test des règles Storage (storage.rules) dans l'émulateur Firebase — hors `npm test` :
// il demande Java (JRE 11+) et firebase-tools. Lancer depuis la racine du projet :
//   firebase emulators:exec --only storage --project demo-spark "node tests/emulateur/storage-rules.mjs"
// Aucun accès au vrai projet : l'émulateur est local, le projet « demo-spark » est fictif.
import assert from 'node:assert/strict';

const HOTE = process.env.FIREBASE_STORAGE_EMULATOR_HOST || '127.0.0.1:9199';
const BUCKET = 'demo-spark.appspot.com';
const MO = 1024 * 1024;

// Jeton « non signé » que l'émulateur accepte : seul le contenu (user_id) compte pour les règles.
function jeton(uid) {
    const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
    return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ user_id: uid, sub: uid, aud: 'demo-spark', iss: 'https://securetoken.google.com/demo-spark', firebase: { sign_in_provider: 'password' } })}.`;
}
const entetes = (uid, extra = {}) => ({ ...(uid ? { Authorization: `Firebase ${jeton(uid)}` } : {}), ...extra });
const urlObjet = chemin => `http://${HOTE}/v0/b/${BUCKET}/o/${encodeURIComponent(chemin)}`;

// Envoi « multipart » comme le SDK web : métadonnées JSON (contentType) + contenu.
async function envoyer(uid, chemin, { type, taille }) {
    const frontiere = 'frontiere-test';
    const meta = JSON.stringify({ name: chemin, contentType: type });
    const debut = Buffer.from(`--${frontiere}\r\nContent-Type: application/json\r\n\r\n${meta}\r\n--${frontiere}\r\nContent-Type: ${type}\r\n\r\n`);
    const fin = Buffer.from(`\r\n--${frontiere}--`);
    const corps = Buffer.concat([debut, Buffer.alloc(taille, 65), fin]);
    const res = await fetch(`http://${HOTE}/v0/b/${BUCKET}/o?name=${encodeURIComponent(chemin)}`, {
        method: 'POST',
        headers: entetes(uid, { 'X-Goog-Upload-Protocol': 'multipart', 'Content-Type': `multipart/related; boundary=${frontiere}` }),
        body: corps,
    });
    return res.status;
}
const lire = async (uid, chemin) => (await fetch(`${urlObjet(chemin)}?alt=media`, { headers: entetes(uid) })).status;
const supprimer = async (uid, chemin) => (await fetch(urlObjet(chemin), { method: 'DELETE', headers: entetes(uid) })).status;
// Le jeton « owner » de l'émulateur contourne les règles : sert à préparer d'anciens fichiers.
async function deposerAdmin(chemin) {
    const res = await fetch(`http://${HOTE}/v0/b/${BUCKET}/o?name=${encodeURIComponent(chemin)}&uploadType=media`, {
        method: 'POST', headers: { Authorization: 'Bearer owner', 'Content-Type': 'text/plain' }, body: 'ancien',
    });
    assert.equal(res.status, 200, 'préparation admin');
}

const ok = s => assert.ok(s >= 200 && s < 300, `attendu 2xx, reçu ${s}`);
const refuse = s => assert.equal(s, 403, `attendu 403, reçu ${s}`);
let n = 0;
const cas = async (titre, fn) => { await fn(); console.log(`Test ${++n} OK — ${titre}`); };

const MOI = 'utilisateur-a', AUTRE = 'utilisateur-b';
const DOC = nom => `users/${MOI}/documents/bien1/${nom}`;
const ARC = nom => `users/${MOI}/archives/${nom}`;

await cas('justificatif PDF de 1 Mo accepté', async () => ok(await envoyer(MOI, DOC('a.pdf'), { type: 'application/pdf', taille: MO })));
await cas('justificatif JPEG et PNG acceptés', async () => {
    ok(await envoyer(MOI, DOC('b.jpg'), { type: 'image/jpeg', taille: 2000 }));
    ok(await envoyer(MOI, DOC('c.png'), { type: 'image/png', taille: 2000 }));
});
await cas('15 Mo pile acceptés, 15 Mo + 1 octet refusés', async () => {
    ok(await envoyer(MOI, DOC('limite.pdf'), { type: 'application/pdf', taille: 15 * MO }));
    refuse(await envoyer(MOI, DOC('trop.pdf'), { type: 'application/pdf', taille: 15 * MO + 1 }));
});
await cas('type non prévu refusé (HTML, SVG, octet-stream, texte)', async () => {
    for (const type of ['text/html', 'image/svg+xml', 'application/octet-stream', 'text/plain', 'application/zip']) {
        refuse(await envoyer(MOI, DOC(`x-${type.replace(/\W/g, '')}.bin`), { type, taille: 100 }));
    }
});
await cas('archive JSON acceptée ; archive PDF ou trop grosse refusée', async () => {
    ok(await envoyer(MOI, ARC('portefeuille-2026-11-19.json'), { type: 'application/json', taille: 50_000 }));
    refuse(await envoyer(MOI, ARC('faux.json'), { type: 'application/pdf', taille: 100 }));
    refuse(await envoyer(MOI, ARC('gros.json'), { type: 'application/json', taille: 15 * MO + 1 }));
});
await cas('lecture et suppression de ses propres fichiers', async () => {
    ok(await lire(MOI, DOC('a.pdf')));
    ok(await supprimer(MOI, DOC('b.jpg')));
    ok(await lire(MOI, ARC('portefeuille-2026-11-19.json')));
});
await cas('un autre utilisateur ne peut ni lire, ni écrire, ni supprimer', async () => {
    refuse(await lire(AUTRE, DOC('a.pdf')));
    refuse(await envoyer(AUTRE, DOC('intrus.pdf'), { type: 'application/pdf', taille: 100 }));
    refuse(await supprimer(AUTRE, DOC('a.pdf')));
});
await cas('sans connexion : tout est refusé', async () => {
    refuse(await lire(null, DOC('a.pdf')));
    refuse(await envoyer(null, DOC('anonyme.pdf'), { type: 'application/pdf', taille: 100 }));
});
await cas('écriture refusée hors des deux dossiers connus et hors users/{uid}', async () => {
    refuse(await envoyer(MOI, `users/${MOI}/autre/x.pdf`, { type: 'application/pdf', taille: 100 }));
    refuse(await envoyer(MOI, `users/${MOI}/documents/y.pdf`, { type: 'application/pdf', taille: 100 }));
    refuse(await envoyer(MOI, `public/x.pdf`, { type: 'application/pdf', taille: 100 }));
});
await cas('anciens fichiers d\'un autre dossier : toujours lisibles et supprimables par leur propriétaire', async () => {
    await deposerAdmin(`users/${MOI}/ancien/vieux.txt`);
    ok(await lire(MOI, `users/${MOI}/ancien/vieux.txt`));
    refuse(await lire(AUTRE, `users/${MOI}/ancien/vieux.txt`));
    ok(await supprimer(MOI, `users/${MOI}/ancien/vieux.txt`));
});

console.log('\nTous les tests des règles Storage passent.');
