// Couche cloud des données hors portefeuille (Firebase Firestore + Storage) : études du comparateur,
// réglages (étude en cours, préférences d'interface, marqueur de migration) et archives JSON du
// portefeuille. Wrapper fin, même esprit qu'owned-cloud.js : aucune logique métier ici. Importé par
// main.js et owned-portfolio.js (lecture seule : scripts/controle-migration.mjs). Tout vit sous users/{uid}/ (règles
// firestore.rules / storage.rules inchangées). Voir docs/superpowers/specs/2026-10-11-passage-tout-web-prompt.md.
import { auth, db, storage } from './firebase-init.js';
import {
    collection, doc, onSnapshot, setDoc, deleteDoc, getDoc, getDocs
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import {
    ref, uploadBytes, listAll, getBlob, getMetadata
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-storage.js';

function requireUid() {
    const user = auth.currentUser;
    if (!user) throw new Error('not_authenticated');
    return user.uid;
}

// Les écrivains sont async : hors connexion ils REJETTENT (un .catch() d'appelant les rattrape) au lieu de lever en synchrone.

// ─── studies : une étude du comparateur par document ─────────────────────────
// Forme : { id, variablesData, createdAt, updatedAt } (sanitizeAssetRecord, main.js).

export function watchStudies(onChange, onError) {
    const uid = requireUid();
    return onSnapshot(collection(db, 'users', uid, 'studies'), snap => {
        const map = {};
        snap.forEach(d => { map[d.id] = d.data(); });
        onChange(map);
    }, onError);
}

export async function cloudSetStudy(id, record) {
    return setDoc(doc(db, 'users', requireUid(), 'studies', id), record);
}

export async function cloudDeleteStudy(id) {
    return deleteDoc(doc(db, 'users', requireUid(), 'studies', id));
}

// Lecture ponctuelle (migration : fusion puis relecture de contrôle), pas un abonnement.
export async function cloudGetAllStudies() {
    const snap = await getDocs(collection(db, 'users', requireUid(), 'studies'));
    const map = {};
    snap.forEach(d => { map[d.id] = d.data(); });
    return map;
}

// ─── settings/{analysis|prefs|migration} ─────────────────────────────────────

export function watchAnalysis(onChange, onError) {
    const uid = requireUid();
    return onSnapshot(doc(db, 'users', uid, 'settings', 'analysis'), snap => {
        onChange(snap.exists() ? snap.data() : null);
    }, onError);
}

export async function cloudSaveAnalysis(patch) {
    return setDoc(doc(db, 'users', requireUid(), 'settings', 'analysis'), patch, { merge: true });
}

// {} tant que le document n'existe pas : chaque clé absente garde sa valeur par défaut côté app,
// sans jamais être écrite (voir main.js / owned-portfolio.js).
export function watchPrefs(onChange, onError) {
    const uid = requireUid();
    return onSnapshot(doc(db, 'users', uid, 'settings', 'prefs'), snap => {
        onChange(snap.exists() ? snap.data() : {});
    }, onError);
}

export async function savePref(patch) {
    return setDoc(doc(db, 'users', requireUid(), 'settings', 'prefs'), patch, { merge: true });
}

export async function cloudGetSetting(name) {
    const snap = await getDoc(doc(db, 'users', requireUid(), 'settings', name));
    return snap.exists() ? snap.data() : null;
}

export async function cloudSetSetting(name, data, { merge = true } = {}) {
    return setDoc(doc(db, 'users', requireUid(), 'settings', name), data, { merge });
}

// ─── Archives JSON du portefeuille : Storage users/{uid}/archives/ ───────────
// Remplace le dossier exports/ de l'ancien server.py (export → copie cloud, import → liste).

function _archiveRef(filename) {
    return ref(storage, `users/${requireUid()}/archives/${filename}`);
}

export async function cloudUploadArchive(filename, blobOrText) {
    const blob = blobOrText instanceof Blob ? blobOrText : new Blob([String(blobOrText)], { type: 'application/json' });
    await uploadBytes(_archiveRef(filename), blob, { contentType: 'application/json' });
}

export async function cloudListArchives() {
    const { items } = await listAll(ref(storage, `users/${requireUid()}/archives`));
    const metas = await Promise.all(items.map(item => getMetadata(item).catch(() => null)));
    return items
        .map((item, i) => ({ name: item.name, size: metas[i]?.size ?? null, updated: metas[i]?.updated ?? null }))
        .sort((a, b) => b.name.localeCompare(a.name));
}

export async function cloudReadArchive(filename) {
    const blob = await getBlob(_archiveRef(filename));
    return JSON.parse(await blob.text());
}

export async function cloudArchiveMeta(filename) {
    try {
        const meta = await getMetadata(_archiveRef(filename));
        return { size: meta.size, updated: meta.updated };
    } catch (err) {
        if (err?.code === 'storage/object-not-found') return null;
        throw err;
    }
}
