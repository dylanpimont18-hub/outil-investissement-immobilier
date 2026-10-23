// Impression groupée des factures (2026-10-22) : sélection des frais d'un ou plusieurs biens
// (année, nature) puis assemblage d'UN SEUL PDF = récapitulatif + justificatifs dans le même ordre.
//
// Module pur : aucun accès DOM ni réseau. pdf-lib est injecté (`PDFLib`, chargé à la demande par
// owned-portfolio.js depuis vendor/pdf-lib/, ou depuis node_modules dans les tests) et le contenu
// des justificatifs est fourni par le rappel `chargerJustificatif(item)` → Uint8Array.
// Testé par tests/test_factures_pdf.mjs.

import { estFraisDeductible } from './calculs.js';

export const LIBELLES_NATURES_DEFAUT = {
    'a-classifier': 'À classifier',
    'deductible': 'Déductible',
    'taxe-fonciere': 'Taxe foncière',
    'frais-emprunt': "Frais d'emprunt",
    'non-deductible': 'Non déductible',
};

const anneeDe = date => (/^\d{4}/.test(date || '') ? Number(String(date).slice(0, 4)) : null);

// Années présentes dans les frais (décroissant), pour un bien ou pour tous ('tous').
export function anneesDisponibles(assets, assetId = 'tous') {
    const set = new Set();
    for (const a of assets) {
        if (assetId !== 'tous' && a.id !== assetId) continue;
        for (const t of a.postAchat?.travaux || []) {
            const y = anneeDe(t.date);
            if (y) set.add(y);
        }
    }
    return [...set].sort((a, b) => b - a);
}

// Filtre : assetId ('tous' ou un id), annee ('toutes' ou nombre), nature ('toutes', 'deductibles'
// = les trois natures déductibles au réel, ou une valeur exacte). Tri chronologique (frais sans
// date en dernier), puis par bien.
export function selectionnerFrais(assets, { assetId = 'tous', annee = 'toutes', nature = 'toutes' } = {}) {
    const items = [];
    for (const a of assets) {
        if (assetId !== 'tous' && a.id !== assetId) continue;
        for (const t of a.postAchat?.travaux || []) {
            if (annee !== 'toutes' && anneeDe(t.date) !== Number(annee)) continue;
            if (nature === 'deductibles' && !estFraisDeductible(t.tag)) continue;
            if (nature !== 'toutes' && nature !== 'deductibles' && t.tag !== nature) continue;
            items.push({ assetId: a.id, assetNom: a.nom || 'Sans nom', travail: t });
        }
    }
    return items.sort((x, y) => {
        const dx = x.travail.date || '9999', dy = y.travail.date || '9999';
        return dx.localeCompare(dy) || x.assetNom.localeCompare(y.assetNom, 'fr');
    });
}

export function formatEuros(n) {
    const v = Math.round((Number(n) || 0) * 100) / 100;
    const [ent, dec] = Math.abs(v).toFixed(2).split('.');
    const groupes = ent.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return `${v < 0 ? '-' : ''}${groupes}${dec === '00' ? '' : ',' + dec} €`;
}

export function formatDateFr(date) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date || '');
    return m ? `${m[3]}/${m[2]}/${m[1]}` : 'Sans date';
}

// Données du récapitulatif (indépendantes de la mise en page).
export function buildRecapFactures(items, { libellesNatures = LIBELLES_NATURES_DEFAUT } = {}) {
    const parNature = new Map();
    const parBien = new Map();
    let total = 0;
    let avecJustificatif = 0;
    for (const { assetNom, travail: t } of items) {
        const montant = Number(t.montant) || 0;
        total += montant;
        if (t.pdfFilename) avecJustificatif++;
        const lib = libellesNatures[t.tag] || t.tag || 'Sans nature';
        const n = parNature.get(lib) || { libelle: lib, nombre: 0, total: 0 };
        n.nombre++; n.total += montant; parNature.set(lib, n);
        const b = parBien.get(assetNom) || { libelle: assetNom, nombre: 0, total: 0 };
        b.nombre++; b.total += montant; parBien.set(assetNom, b);
    }
    const totalDeductible = items.filter(i => estFraisDeductible(i.travail.tag))
        .reduce((s, i) => s + (Number(i.travail.montant) || 0), 0);
    return {
        nombre: items.length,
        total,
        totalDeductible,
        avecJustificatif,
        parNature: [...parNature.values()].sort((a, b) => b.total - a.total),
        parBien: [...parBien.values()].sort((a, b) => b.total - a.total),
    };
}

export function nomFichierFactures({ annee = 'toutes', bienNom = null } = {}) {
    const slug = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'bien';
    const periode = annee === 'toutes' ? 'toutes-annees' : String(annee);
    return `Factures_${periode}_${bienNom ? slug(bienNom) : 'tous-les-biens'}.pdf`;
}

// Type réel d'un justificatif d'après ses premiers octets (le nom de fichier peut mentir).
export function detecterTypeFichier(bytes) {
    const b = bytes || [];
    if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'pdf';
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'png';
    if (b[0] === 0xFF && b[1] === 0xD8) return 'jpg';
    // Un PDF peut commencer par quelques octets parasites avant « %PDF ».
    const tete = String.fromCharCode(...Array.from(b.slice ? b.slice(0, 1024) : []));
    return tete.includes('%PDF') ? 'pdf' : null;
}

// ─── Mise en page ─────────────────────────────────────────────────────────────

const A4 = [595.28, 841.89];
const MARGE = 40;
const OR = [197 / 255, 160 / 255, 89 / 255];
const ENCRE = [0.13, 0.13, 0.15];
const GRIS = [0.42, 0.42, 0.46];
const FILET = [0.85, 0.85, 0.87];
const FOND = [0.965, 0.955, 0.93];

// Helvetica (police standard, encodage WinAnsi) : tout caractère hors jeu ferait échouer
// drawText. Espaces fines/insécables → espace, le reste → « ? ».
function texteSur(font, s) {
    const jeu = new Set(font.getCharacterSet());
    return String(s ?? '').replace(/[   ]/g, ' ')
        .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
        .replace(/\s+/g, ' ')
        .split('').map(c => (jeu.has(c.codePointAt(0)) ? c : '?')).join('')
        .replace(/\?{2,}/g, '?');
}

function tronquer(font, size, s, largeur) {
    if (font.widthOfTextAtSize(s, size) <= largeur) return s;
    let t = s;
    while (t.length > 1 && font.widthOfTextAtSize(t + '…', size) > largeur) t = t.slice(0, -1);
    return t.trimEnd() + '…';
}

// Récapitulatif. En `dryRun`, rien n'est dessiné : on compte seulement les pages, pour connaître
// la page de départ de chaque justificatif avant de dessiner la colonne « Page ».
function dessinerRecap({ PDFLib, doc, fonts, recap, items, entete, refs, dryRun }) {
    const { rgb } = PDFLib;
    const c = arr => rgb(...arr);
    const [W, H] = A4;
    const pages = [];
    let page, y;
    const nouvellePage = () => {
        page = dryRun ? null : doc.addPage(A4);
        pages.push(page);
        y = H - MARGE;
    };
    const texte = (s, x, yy, { size = 9, font = fonts.regular, color = ENCRE, align = 'left', largeur = null } = {}) => {
        let t = texteSur(font, s);
        if (largeur) t = tronquer(font, size, t, largeur);
        if (dryRun) return;
        const w = font.widthOfTextAtSize(t, size);
        const xx = align === 'right' ? x - w : x;
        page.drawText(t, { x: xx, y: yy, size, font, color: c(color) });
    };
    const ligne = (x1, yy, x2, color = FILET, epaisseur = 0.6) => {
        if (!dryRun) page.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness: epaisseur, color: c(color) });
    };
    const rect = (x, yy, w, h, color) => {
        if (!dryRun) page.drawRectangle({ x, y: yy, width: w, height: h, color: c(color) });
    };

    nouvellePage();
    // En-tête
    texte('Factures et justificatifs', MARGE, y - 20, { size: 20, font: fonts.bold });
    y -= 30;
    ligne(MARGE, y, W - MARGE, OR, 1.5);
    y -= 16;
    for (const l of entete) { texte(l, MARGE, y, { size: 9.5, color: GRIS }); y -= 13; }
    y -= 8;

    // Chiffres clés
    const cartes = [
        ['Frais', String(recap.nombre)],
        ['Total', formatEuros(recap.total)],
        ['dont déductible au réel', formatEuros(recap.totalDeductible)],
        ['Justificatifs joints', `${recap.avecJustificatif} / ${recap.nombre}`],
    ];
    const lc = (W - 2 * MARGE - 3 * 8) / 4;
    cartes.forEach(([lib, val], i) => {
        const x = MARGE + i * (lc + 8);
        rect(x, y - 42, lc, 42, FOND);
        texte(lib, x + 8, y - 15, { size: 8, color: GRIS, largeur: lc - 16 });
        texte(val, x + 8, y - 33, { size: 13, font: fonts.bold, largeur: lc - 16 });
    });
    y -= 60;

    // Totaux par nature (et par bien si plusieurs)
    const blocs = [['Par nature', recap.parNature]];
    if (recap.parBien.length > 1) blocs.push(['Par bien', recap.parBien]);
    const lb = blocs.length > 1 ? (W - 2 * MARGE - 16) / 2 : (W - 2 * MARGE) / 2;
    let yBas = y;
    blocs.forEach(([titre, lignes], i) => {
        const x = MARGE + i * (lb + 16);
        let yy = y;
        texte(titre, x, yy, { size: 9, font: fonts.bold });
        yy -= 5; ligne(x, yy, x + lb); yy -= 12;
        for (const l of lignes) {
            texte(`${l.libelle} (${l.nombre})`, x, yy, { size: 8.5, largeur: lb - 80 });
            texte(formatEuros(l.total), x + lb, yy, { size: 8.5, font: fonts.bold, align: 'right' });
            yy -= 12;
        }
        yBas = Math.min(yBas, yy);
    });
    y = yBas - 14;

    // Tableau détaillé
    const multiBiens = recap.parBien.length > 1;
    const largeurUtile = W - 2 * MARGE;
    const cols = [
        { cle: 'num', titre: 'N°', w: 22 },
        { cle: 'date', titre: 'Date', w: 54 },
        ...(multiBiens ? [{ cle: 'bien', titre: 'Bien', w: 82 }] : []),
        { cle: 'desc', titre: 'Description', w: 0 },
        { cle: 'nature', titre: 'Nature', w: 74 },
        { cle: 'montant', titre: 'Montant', w: 66, align: 'right' },
        { cle: 'page', titre: 'Justificatif', w: 52, align: 'right' },
    ];
    const fixe = cols.reduce((s, col) => s + col.w, 0) + 6 * (cols.length - 1);
    cols.find(col => col.cle === 'desc').w = largeurUtile - fixe;
    const HL = 15;

    const enteteTableau = () => {
        rect(MARGE, y - 4, largeurUtile, HL, FOND);
        let x = MARGE;
        for (const col of cols) {
            texte(col.titre, col.align === 'right' ? x + col.w - 3 : x + 3, y + 1, { size: 8, font: fonts.bold, color: GRIS, align: col.align || 'left' });
            x += col.w + 6;
        }
        y -= HL;
    };
    texte('Détail', MARGE, y, { size: 9, font: fonts.bold });
    y -= 14;
    enteteTableau();
    items.forEach((item, i) => {
        if (y < MARGE + 30) { nouvellePage(); enteteTableau(); }
        const t = item.travail;
        const valeurs = {
            num: String(i + 1),
            date: formatDateFr(t.date),
            bien: item.assetNom,
            desc: [t.description, t.commentaire].filter(Boolean).join(' · ') || '—',
            nature: (recap.libellesNatures || LIBELLES_NATURES_DEFAUT)[t.tag] || t.tag || '—',
            montant: formatEuros(t.montant),
            page: refs[i] == null ? (t.pdfFilename ? '—' : 'absent') : `p. ${refs[i]}`,
        };
        let x = MARGE;
        for (const col of cols) {
            const absent = col.cle === 'page' && !t.pdfFilename;
            texte(valeurs[col.cle], col.align === 'right' ? x + col.w - 3 : x + 3, y, {
                size: 8.5, largeur: col.w - 6, align: col.align || 'left',
                font: col.cle === 'montant' ? fonts.bold : fonts.regular,
                color: absent ? GRIS : ENCRE,
            });
            x += col.w + 6;
        }
        y -= 5; ligne(MARGE, y, W - MARGE); y -= HL - 5;
    });
    if (y < MARGE + 30) nouvellePage();
    texte('Total', MARGE + 3, y - 2, { size: 9.5, font: fonts.bold });
    texte(formatEuros(recap.total), W - MARGE - 58 - 3, y - 2, { size: 9.5, font: fonts.bold, align: 'right' });
    y -= 10; ligne(MARGE, y, W - MARGE, OR, 1.2);

    if (!dryRun) {
        pages.forEach((p, i) => {
            const s = texteSur(fonts.regular, `Récapitulatif · page ${i + 1} / ${pages.length}`);
            p.drawText(s, { x: W - MARGE - fonts.regular.widthOfTextAtSize(s, 7.5), y: 22, size: 7.5, font: fonts.regular, color: c(GRIS) });
        });
    }
    return pages.length;
}

function legendeJustificatif(item, numero, total) {
    const t = item.travail;
    return `Facture ${numero} / ${total} · ${formatDateFr(t.date)} · ${t.description || 'Sans description'} · ${formatEuros(t.montant)}`;
}

// Petite étiquette « Facture n / N » en haut à droite d'une page de facture PDF copiée.
function estampiller(PDFLib, page, fonts, texteEtiquette) {
    const { rgb, degrees } = PDFLib;
    if ((page.getRotation?.().angle || 0) % 360 !== 0) return;
    const box = page.getCropBox ? page.getCropBox() : { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() };
    const s = texteSur(fonts.bold, texteEtiquette);
    const w = fonts.bold.widthOfTextAtSize(s, 7) + 8;
    const x = box.x + box.width - w - 6;
    const y = box.y + box.height - 15;
    page.drawRectangle({ x, y, width: w, height: 11, color: rgb(1, 1, 1), opacity: 0.85, borderColor: rgb(...OR), borderWidth: 0.6, rotate: degrees(0) });
    page.drawText(s, { x: x + 4, y: y + 3, size: 7, font: fonts.bold, color: rgb(...ENCRE) });
}

function pageImage(PDFLib, doc, fonts, image, legende) {
    const { rgb } = PDFLib;
    const [W, H] = A4;
    const page = doc.addPage(A4);
    const s = tronquer(fonts.regular, 8.5, texteSur(fonts.regular, legende), W - 2 * MARGE);
    page.drawText(s, { x: MARGE, y: H - 28, size: 8.5, font: fonts.regular, color: rgb(...GRIS) });
    page.drawLine({ start: { x: MARGE, y: H - 34 }, end: { x: W - MARGE, y: H - 34 }, thickness: 0.6, color: rgb(...OR) });
    const zoneW = W - 2 * 24, zoneH = H - 34 - 10 - 24;
    const k = Math.min(zoneW / image.width, zoneH / image.height, 1.5);
    const w = image.width * k, h = image.height * k;
    page.drawImage(image, { x: (W - w) / 2, y: 24 + zoneH - h, width: w, height: h });
}

function pageIndisponible(PDFLib, doc, fonts, legende, raison) {
    const { rgb } = PDFLib;
    const [W, H] = A4;
    const page = doc.addPage(A4);
    page.drawText(tronquer(fonts.bold, 11, texteSur(fonts.bold, legende), W - 2 * MARGE), { x: MARGE, y: H - 60, size: 11, font: fonts.bold, color: rgb(...ENCRE) });
    page.drawText(texteSur(fonts.regular, raison), { x: MARGE, y: H - 80, size: 10, font: fonts.regular, color: rgb(...GRIS) });
}

// Cause lisible d'un justificatif non chargé, avec le code technique (sinon impossible de distinguer
// un fichier absent du stockage, un accès refusé, un téléchargement bloqué ou un PDF corrompu).
function raisonEchecChargement(err) {
    const code = err?.code || err?.message || String(err);
    let cause;
    if (code === 'storage/object-not-found') cause = 'Fichier absent du stockage.';
    else if (code === 'storage/unauthorized' || code === 'storage/unauthenticated') cause = 'Accès au fichier refusé (reconnectez-vous).';
    else if (/^http_\d+/.test(code)) cause = `Le serveur a refusé le téléchargement (${code.slice(5)}).`;
    else if (err?.name === 'TypeError') cause = 'Téléchargement bloqué (connexion ou sécurité du navigateur).';
    else if (/pdf|parse|header|xref|trailer/i.test(code)) cause = 'PDF illisible.';
    else cause = 'Fichier illisible.';
    return `${cause} Code : ${code}. Ouvrez-le depuis l'application.`;
}

// Assemble le PDF. `chargerJustificatif(item)` → Promise<Uint8Array|ArrayBuffer>. `onProgress(n, N)`
// suit le téléchargement des justificatifs. Retourne { bytes, echecs: [{ numero, raison }] }.
export async function genererPdfFactures({ PDFLib, items, entete = [], libellesNatures = LIBELLES_NATURES_DEFAUT, chargerJustificatif, onProgress = () => {}, concurrence = 3 }) {
    const { PDFDocument, StandardFonts } = PDFLib;
    const recap = { ...buildRecapFactures(items, { libellesNatures }), libellesNatures };
    const N = items.length;

    // 1. Charger chaque justificatif (concurrence limitée) et connaître son nombre de pages.
    const sources = new Array(N).fill(null);
    let faits = 0;
    const aCharger = items.map((item, i) => ({ item, i })).filter(({ item }) => item.travail.pdfFilename);
    let cursor = 0;
    const worker = async () => {
        while (cursor < aCharger.length) {
            const { item, i } = aCharger[cursor++];
            try {
                const brut = await chargerJustificatif(item);
                // Copie : pdf-lib lit .buffer sans tenir compte de byteOffset (vue partielle = fichier illisible).
                const bytes = new Uint8Array(brut);
                const type = detecterTypeFichier(bytes);
                if (type === 'pdf') {
                    const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
                    sources[i] = { type, src, pages: src.getPageCount() };
                } else if (type === 'png' || type === 'jpg') {
                    sources[i] = { type, bytes, pages: 1 };
                } else {
                    sources[i] = { type: 'erreur', raison: 'Format de fichier non reconnu.', pages: 1 };
                }
            } catch (err) {
                console.warn('[factures-pdf] justificatif non chargé', item.travail.pdfFilename, err);
                sources[i] = { type: 'erreur', raison: raisonEchecChargement(err), pages: 1 };
            }
            onProgress(++faits, aCharger.length);
        }
    };
    await Promise.all(Array.from({ length: Math.min(concurrence, aCharger.length) }, worker));

    // 2. Pages de départ de chaque justificatif = pages du récap + pages des justificatifs précédents.
    const doc = await PDFDocument.create();
    doc.setTitle('Factures et justificatifs');
    doc.setCreator('Spark Investissement');
    const fonts = {
        regular: await doc.embedFont(StandardFonts.Helvetica),
        bold: await doc.embedFont(StandardFonts.HelveticaBold),
    };
    const pagesRecap = dessinerRecap({ PDFLib, doc: null, fonts, recap, items, entete, refs: [], dryRun: true });
    const refs = new Array(N).fill(null);
    let prochaine = pagesRecap + 1;
    sources.forEach((s, i) => { if (s) { refs[i] = prochaine; prochaine += s.pages; } });
    const pagesDessinees = dessinerRecap({ PDFLib, doc, fonts, recap, items, entete, refs, dryRun: false });
    if (pagesDessinees !== pagesRecap) throw new Error('recap_pagination_mismatch');

    // 3. Justificatifs, dans l'ordre du tableau.
    const echecs = [];
    let numero = 0;
    for (let i = 0; i < N; i++) {
        const s = sources[i];
        if (!s) continue;
        numero = i + 1;
        const legende = legendeJustificatif(items[i], numero, N);
        try {
            if (s.type === 'pdf') {
                const copies = await doc.copyPages(s.src, s.src.getPageIndices());
                copies.forEach((p, k) => { doc.addPage(p); if (k === 0) estampiller(PDFLib, p, fonts, `Facture ${numero} / ${N}`); });
            } else if (s.type === 'png' || s.type === 'jpg') {
                const image = s.type === 'png' ? await doc.embedPng(s.bytes) : await doc.embedJpg(s.bytes);
                pageImage(PDFLib, doc, fonts, image, legende);
            } else {
                pageIndisponible(PDFLib, doc, fonts, legende, s.raison);
                echecs.push({ numero, raison: s.raison });
            }
        } catch {
            // Le nombre de pages annoncé dans le récap doit rester juste : on comble avec des pages
            // d'avertissement.
            const deja = doc.getPageCount() - (refs[i] - 1);
            const raison = 'Ce justificatif n\'a pas pu être intégré : ouvrez-le depuis l\'application.';
            for (let k = Math.max(0, deja); k < s.pages; k++) pageIndisponible(PDFLib, doc, fonts, legende, raison);
            echecs.push({ numero, raison });
        }
    }
    return { bytes: await doc.save(), echecs, pages: doc.getPageCount(), pagesRecap };
}
