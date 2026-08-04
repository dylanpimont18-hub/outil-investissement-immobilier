// Couche cloud du portefeuille biens detenus (Firebase Firestore + Storage + Auth).
// Wrapper fin autour du SDK Firebase : aucune logique metier ici (cache, diff, rendu),
// tout ca reste dans owned-portfolio.js qui est le seul importeur de ce module.
import { auth, db, storage, functions } from './firebase-init.js';
import {
    onAuthStateChanged, signInWithEmailAndPassword, signOut
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import {
    collection, doc, onSnapshot, setDoc, deleteDoc, getDoc
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import {
    ref, uploadBytes, getDownloadURL, deleteObject, listAll
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-storage.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js';

let _uid = null;

function requireUid() {
    if (!_uid) throw new Error('not_authenticated');
    return _uid;
}

export function watchAuth(onChange) {
    return onAuthStateChanged(auth, user => {
        _uid = user ? user.uid : null;
        onChange(user);
    });
}

export function cloudSignIn(email, password) {
    return signInWithEmailAndPassword(auth, email, password);
}

export function cloudSignOut() {
    return signOut(auth);
}

// ─── ownedAssets : un document Firestore par bien ────────────────────────────

export function watchOwnedAssets(onChange, onError) {
    const uid = requireUid();
    return onSnapshot(collection(db, 'users', uid, 'ownedAssets'), snap => {
        const map = {};
        snap.forEach(d => { map[d.id] = d.data(); });
        onChange(map);
    }, onError);
}

export function cloudSetAsset(id, data) {
    return setDoc(doc(db, 'users', requireUid(), 'ownedAssets', id), data);
}

export function cloudDeleteAssetDoc(id) {
    return deleteDoc(doc(db, 'users', requireUid(), 'ownedAssets', id));
}

// ─── portfolioMeta/main : objectifs + ordre glisser-deposer + regime fiscal ──

export function watchPortfolioMeta(onChange, onError) {
    const uid = requireUid();
    return onSnapshot(doc(db, 'users', uid, 'portfolioMeta', 'main'), snap => {
        onChange(snap.exists() ? snap.data() : {});
    }, onError);
}

export function cloudSaveMeta(patch) {
    return setDoc(doc(db, 'users', requireUid(), 'portfolioMeta', 'main'), patch, { merge: true });
}

// ─── Documents (PDF justificatifs) : Firebase Storage ────────────────────────

export async function cloudUploadDocument(assetId, file) {
    const uid = requireUid();
    const ext = (file.name.match(/\.[a-z0-9]+$/i) || ['.pdf'])[0].toLowerCase();
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    await uploadBytes(ref(storage, `users/${uid}/documents/${assetId}/${filename}`), file, { contentType: file.type || 'application/pdf' });
    return filename;
}

export function cloudDocumentUrl(assetId, filename) {
    return getDownloadURL(ref(storage, `users/${requireUid()}/documents/${assetId}/${filename}`));
}

// Reservee a la migration depuis l'ancien stockage local : conserve le nom de fichier d'origine
// (deja reference par asset.postAchat.travaux[].pdfFilename) au lieu d'en generer un nouveau.
export async function cloudUploadDocumentAs(assetId, filename, blob) {
    const uid = requireUid();
    await uploadBytes(ref(storage, `users/${uid}/documents/${assetId}/${filename}`), blob, { contentType: 'application/pdf' });
}

export async function cloudDeleteDocument(assetId, filename) {
    await deleteObject(ref(storage, `users/${requireUid()}/documents/${assetId}/${filename}`)).catch(() => {});
}

export async function cloudDeleteAllDocuments(assetId) {
    const folder = ref(storage, `users/${requireUid()}/documents/${assetId}`);
    const { items } = await listAll(folder).catch(() => ({ items: [] }));
    await Promise.all(items.map(item => deleteObject(item).catch(() => {})));
}

// ─── Extraction IA de facture (onglet Travaux) : Cloud Function ──────────────
// Meme fonction appelee depuis PC et mobile (functions/index.js, extraireFraisFacture) — voir
// spec docs/superpowers/specs/2026-08-04-onglet-travaux-refonte.md. Renvoie
// {date, description, montant, tagSuggestion, confiance}, aucune ecriture Firestore/Storage ici.
const _extraireFraisFacture = httpsCallable(functions, 'extraireFraisFacture');

export async function cloudExtraireFraisFacture(base64, mimeType) {
    const { data } = await _extraireFraisFacture({ base64, mimeType });
    return data;
}

// ─── Geocodage : Nominatim + cache Firestore ─────────────────────────────────
// Remplace le proxy server.py /api/geocode/address (indisponible sans serveur local sur iPhone).
// Nominatim impose 1 req/s ; le cache Firestore evite de re-solliciter l'API a chaque saisie
// d'une adresse deja geocodee (ex. une variante orthographique qui n'a pas change entre-temps).
let _lastNominatimCall = 0;

export async function cloudGeocode(adresse) {
    const uid = requireUid();
    const key = adresse.trim().toLowerCase().replace(/\s+/g, ' ');
    const cacheRef = doc(db, 'users', uid, 'geocodesAdresse', encodeURIComponent(key).slice(0, 300));
    const cached = await getDoc(cacheRef);
    if (cached.exists()) return cached.data();

    const wait = Math.max(0, 1100 - (Date.now() - _lastNominatimCall));
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    _lastNominatimCall = Date.now();

    let result = { lat: null, lng: null };
    try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(adresse)}`, {
            headers: { 'Accept-Language': 'fr' }
        });
        const json = await res.json();
        if (json?.[0]) result = { lat: parseFloat(json[0].lat), lng: parseFloat(json[0].lon) };
    } catch {
        return { lat: null, lng: null };
    }
    await setDoc(cacheRef, result).catch(() => {});
    return result;
}
