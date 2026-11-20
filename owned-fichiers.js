// Utilitaires fichiers et PDF du portefeuille biens détenus (découpage d'owned-portfolio.js, audit T7) : formats et tailles
// acceptés pour un justificatif, lecture base64, concurrence limitée, chargement paresseux de pdf-lib et pdf.js (vendor/),
// rendu de la 1re page d'un PDF en image, filtrage d'un lot de fichiers déposés, formats de date. Partagés par les modules
// factures, travaux et import de dossier. Déplacé tel quel : aucun changement de comportement.

// ─── IMPRESSION GROUPÉE DES FACTURES (2026-10-22) ──────────────────────────────
// Un seul PDF = récapitulatif + justificatifs, assemblé dans le navigateur par factures-pdf.js
// (pdf-lib vendorisé, chargé à la demande comme pdf.js). Les fichiers sont lus depuis Firebase
// Storage par leur URL de téléchargement (CORS ouvert sur firebasestorage.googleapis.com).

let _pdfLibPromise = null;
export function _loadPdfLib() {
    if (!_pdfLibPromise) _pdfLibPromise = import('/vendor/pdf-lib/pdf-lib.esm.min.js');
    return _pdfLibPromise;
}

export function _telechargerBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function _normalizeSearchText(str) {
    return String(str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export const TRAVAUX_ACCEPTED_MIME = ['application/pdf', 'image/jpeg', 'image/png'];
export const TRAVAUX_MAX_FILE_SIZE = 8 * 1024 * 1024; // 8 Mo — marge sous la limite de la Cloud Function
export const TRAVAUX_MAX_STORED_SIZE = 15 * 1024 * 1024; // 15 Mo — plafond de storage.rules pour un justificatif enregistré (au-delà de 8 Mo, sans lecture IA)

export function _fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}

// Lance worker(item) sur chaque item de `items`, au plus `limit` en simultane — evite de
// saturer l'API Anthropic quand plusieurs factures sont deposees d'un coup (import groupe).
export async function _runWithConcurrencyLimit(items, limit, worker) {
    let cursor = 0;
    async function next() {
        while (cursor < items.length) {
            const current = cursor++;
            await worker(items[current], current);
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, next));
} // 8 Mo, comme TRAVAUX_MAX_FILE_SIZE

let _pdfjsModulePromise = null;
// Charge pdf.js à la demande (jamais au démarrage de l'app) : évite d'alourdir le chargement
// initial pour une fonctionnalité utilisée ponctuellement. Fichiers vendorisés localement
// (vendor/pdfjs/), pas de CDN — cohérent avec le fonctionnement 100% local de l'app.
export function _loadPdfjs() {
    if (!_pdfjsModulePromise) {
        _pdfjsModulePromise = import('/vendor/pdfjs/pdf.min.mjs').then(pdfjs => {
            pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
            return pdfjs;
        });
    }
    return _pdfjsModulePromise;
}

// Rasterise la première page d'un PDF en PNG (échelle 2x pour la lisibilité OCR). Un acte de
// vente de plusieurs pages perd les pages suivantes — acceptable car les informations clés
// (prix, date, parties, surface) sont presque toujours en première page pour les documents visés.
export async function _pdfFirstPageToPngFile(file) {
    const pdfjs = await _loadPdfjs();
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: buffer }).promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('pdf_to_png_failed');
    const pngName = file.name.replace(/\.pdf$/i, '.png');
    return new File([blob], pngName, { type: 'image/png' });
}

export function _canvasVersJpeg(canvas) {
    return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('jpeg_failed'))), 'image/jpeg', 0.85));
}

// ─── AJOUT DE FACTURES — modale globale ──────────────────────────────────────────────────────
// Ouverte par le bouton flottant #owned-quickfab (PC et mobile), par « Ajouter une facture » du
// rail Actions rapides (PC) et par le dépôt de 2+ fichiers dans l'onglet Frais d'un bien (bien
// verrouillé). Voir spec docs/superpowers/specs/2026-10-02-ajout-factures-bouton-global.md. Remplace
// l'import groupé (openTravauxBatchModal) et les deux formulaires rapides rail/FAB du 2026-08-04 :
// une seule logique — choisir le bien, déposer fichiers/photos/dossier, l'IA lit fournisseur /
// résumé / montant / date d'émission, revue en ligne, un clic pour tout enregistrer. Rien n'est
// stocké tant que l'utilisateur n'a pas validé (pas de boîte de réception persistante, choix spec).

export const FM_MAX_FILES_PER_DROP = 50;
const FM_FILE_EXT = /\.(pdf|jpe?g|png)$/i;

// Prépare l'image envoyée à l'IA : un PDF est rasterisé (première page, _pdfFirstPageToPngFile),
// une image passe telle quelle. Mammouth AI refuse application/pdf côté serveur — jusqu'au
// 2026-10-02 les flux factures envoyaient file.type brut et toute facture PDF échouait en silence
// (« extraction impossible, remplis à la main »). `imageFile` sert aussi de miniature.
export async function _prepareFactureImage(file) {
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
    const imageFile = isPdf ? await _pdfFirstPageToPngFile(file) : file;
    const base64 = await _fileToBase64(imageFile);
    return { base64, mimeType: imageFile.type || 'image/png', imageFile };
}

// Fichiers déposés par glisser-déposer : fichiers isolés ET dossiers (webkitGetAsEntry récursif ;
// readEntries rend par lots de 100, d'où la boucle jusqu'à un lot vide). Les entries sont prises
// synchroniquement dans le handler drop — le DataTransfer est vidé juste après l'événement.
export async function _collectDroppedFiles(dataTransfer) {
    const entries = Array.from(dataTransfer?.items || [])
        .map(item => (typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null))
        .filter(Boolean);
    if (!entries.length) return Array.from(dataTransfer?.files || []);
    const readAll = reader => new Promise((resolve, reject) => {
        const acc = [];
        const step = () => reader.readEntries(batch => {
            if (!batch.length) return resolve(acc);
            acc.push(...batch);
            step();
        }, reject);
        step();
    });
    const out = [];
    const walk = async entry => {
        if (entry.isFile) {
            out.push(await new Promise((resolve, reject) => entry.file(resolve, reject)));
        } else if (entry.isDirectory) {
            for (const child of await readAll(entry.createReader())) await walk(child);
        }
    };
    for (const entry of entries) await walk(entry);
    return out;
}

// Tri des fichiers acceptés : extension OU type MIME (un dossier Windows donne parfois un type
// vide), fichiers cachés (.DS_Store…) ignorés en silence, taille et nombre plafonnés.
export function _filterFactureFiles(files) {
    const accepted = [], rejectedFormat = [], rejectedSize = [];
    for (const file of files) {
        if (!file || /^\./.test(file.name || '')) continue;
        if (!FM_FILE_EXT.test(file.name || '') && !TRAVAUX_ACCEPTED_MIME.includes(file.type)) { rejectedFormat.push(file); continue; }
        if (file.size > TRAVAUX_MAX_FILE_SIZE) { rejectedSize.push(file); continue; }
        accepted.push(file);
    }
    const truncated = Math.max(0, accepted.length - FM_MAX_FILES_PER_DROP);
    return { accepted: accepted.slice(0, FM_MAX_FILES_PER_DROP), rejectedFormat, rejectedSize, truncated };
}

// Format de date affiché partout (audit 2026-11-18, A3) : « 28/08/2026 » ; les mois « 11/2026 ».
export function _formatMoisFr(isoMois) {
    const m = /^(\d{4})-(\d{2})$/.exec(isoMois || '');
    return m ? `${m[2]}/${m[1]}` : (isoMois || '—');
}

export function _formatDateFr(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso || '—');
}
