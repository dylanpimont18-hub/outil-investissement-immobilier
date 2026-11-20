// Onglet Travaux d'un bien détenu (découpage d'owned-portfolio.js, audit T7) : liste des frais et justificatifs, sous-vue
// « Par corps d'état » (factures décortiquées par l'IA, file d'analyse limitée), modale d'édition d'un frais et aperçu d'un
// justificatif. Déplacé tel quel : aucun changement de comportement. Regroupement et nettoyage : corps-etat.js (pur).

import { estFraisDeductible } from './calculs.js';
import { icone, definirTexteAvecIcone } from './icones.js';
import { state, nodes, IS_MOBILE_PAGE } from './owned-contexte.js';
import { escapeHtml, showToast } from './utils.js';
import { cloudDocumentUrl, cloudDeleteDocument, cloudExtraireFraisFacture, cloudDecortiquerFacture } from './owned-cloud.js';
import { CORPS_ETAT, nettoyerArticles, fusionnerReclassements, corpsEtatLibres, travauxADecortiquer, regrouperParCorpsEtat, reclasserArticle } from './corps-etat.js';
import { formatEuros, formatDateFr } from './factures-pdf.js';
import { TRAVAUX_ACCEPTED_MIME, TRAVAUX_MAX_FILE_SIZE, TRAVAUX_MAX_STORED_SIZE, _canvasVersJpeg, _fileToBase64, _formatDateFr, _loadPdfjs, _normalizeSearchText, _prepareFactureImage } from './owned-fichiers.js';
import { _buildFactureDescription, openAjoutFacturesModal, openImpressionFacturesModal } from './owned-factures.js';
import { NATURES_FRAIS, _showOwnedModal, addOwnedTravail, alerteDoublonTaxeFonciere, deleteOwnedTravail, findSimilarTravail, getOwnedAsset, loadOwnedAssets, natureFraisOptionsHtml, renderAccordionPostAchat, renderAccordionSimulateur, renderOwnedCalculTab, renderOwnedSynthese, saveOwnedAssets, suggererNatureFrais, updateOwnedTravail, uploadOwnedDocument } from './owned-portfolio.js';

const _isImageFilename = filename => /\.(jpe?g|png)$/i.test(filename || '');

// `local` ({ url }) : fichier encore en mémoire (modale « Ajouter des factures », URL blob), pas
// encore stocké — même overlay et mêmes règles tactiles que pour un justificatif cloud.
export async function openDocumentPreview(assetId, filename, local = null) {
    const resolveUrl = () => (local?.url ? Promise.resolve(local.url) : cloudDocumentUrl(assetId, filename));
    // Écran tactile + PDF : Safari iOS n'affiche que la 1re page d'un <embed> PDF, sans défilement
    // ni zoom. On ouvre plutôt le lecteur PDF natif dans un nouvel onglet. La fenêtre est ouverte
    // AVANT l'await (dans le geste utilisateur) sinon iOS bloque le popup, puis redirigée vers l'URL.
    if (!_isImageFilename(filename) && window.matchMedia?.('(pointer: coarse)').matches) {
        const win = window.open('', '_blank');
        try {
            const url = await resolveUrl();
            if (win) win.location.href = url; else window.location.href = url;
        } catch {
            win?.close();
            showToast('Document indisponible — vérifiez votre connexion internet', 'negative');
        }
        return;
    }
    let overlay = document.getElementById('document-preview-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'document-preview-overlay';
        overlay.className = 'document-preview-overlay';
        overlay.innerHTML = `
            <div class="document-preview-dialog">
                <button type="button" class="document-preview-close" aria-label="Fermer">${icone('croix')}</button>
                <embed class="document-preview-embed" type="application/pdf" hidden>
                <img class="document-preview-img" alt="Justificatif" hidden>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.hidden = true; });
        overlay.querySelector('.document-preview-close').addEventListener('click', () => { overlay.hidden = true; });
    }
    const embed = overlay.querySelector('.document-preview-embed');
    const img = overlay.querySelector('.document-preview-img');
    const isImage = _isImageFilename(filename);
    embed.hidden = isImage;
    img.hidden = !isImage;
    embed.src = '';
    img.src = '';
    overlay.hidden = false;
    try {
        const url = await resolveUrl();
        if (isImage) img.src = url; else embed.src = url;
    } catch {
        overlay.hidden = true;
        showToast('Document indisponible — vérifiez votre connexion internet', 'negative');
    }
}

// Modale d'édition d'un frais existant (onglet Travaux). Le PDF joint n'y est pas
// modifiable : le remplacer demande de supprimer puis recréer le frais.
function openEditTravailModal(assetId, travailId) {
    const asset = getOwnedAsset(assetId);
    const travail = (asset?.postAchat?.travaux || []).find(t => t.id === travailId);
    if (!travail) return;

    const modal = _showOwnedModal(`
        <div class="owned-modal">
            <div class="owned-modal-head">
                <h3 class="owned-modal-title">Modifier le frais</h3>
                <button class="btn btn--ghost" data-close-modal aria-label="Fermer">${icone('croix')}</button>
            </div>
            <form class="owned-form-grid" data-form="edit-travail" novalidate>
                <label class="variables-field">
                    <span class="variables-label">Date</span>
                    <input class="variables-input" type="date" name="date" value="${escapeHtml(travail.date || '')}" required>
                </label>
                <label class="variables-field">
                    <span class="variables-label">Montant (€)</span>
                    <input class="variables-input" type="number" name="montant" min="0" step="1" value="${travail.montant || 0}" required>
                </label>
                <label class="variables-field" style="grid-column:1/-1">
                    <span class="variables-label">Description</span>
                    <input class="variables-input" type="text" name="description" value="${escapeHtml(travail.description || '')}" required>
                </label>
                <label class="variables-field">
                    <span class="variables-label">Nature</span>
                    <select class="variables-input" name="tag">
                        ${natureFraisOptionsHtml(travail.tag)}
                    </select>
                </label>
                <label class="variables-field">
                    <span class="variables-label">Commentaire</span>
                    <input class="variables-input" type="text" name="commentaire" value="${escapeHtml(travail.commentaire || '')}">
                </label>
                <label class="variables-field" style="grid-column:1/-1;flex-direction:row;align-items:center;gap:8px" data-tooltip="À cocher si ce frais fait partie de l'enveloppe du crédit immobilier principal (pas payé cash) — reste déductible fiscalement l'année du frais, mais n'est plus retranché du cash-flow puisque la mensualité rembourse déjà cette part">
                    <input type="checkbox" name="financeParCredit" value="1" ${travail.financeParCredit ? 'checked' : ''}>
                    <span class="variables-label" style="margin:0">Financé par le crédit immobilier principal</span>
                </label>
                <div class="variables-field" style="grid-column:1/-1">
                    <span class="variables-label">Justificatif</span>
                    ${travail.pdfFilename ? `
                    <div class="owned-edit-pdf-current" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                        <button type="button" class="btn btn--ghost btn--sm" data-preview-current-pdf>${icone('document')} Voir le justificatif actuel</button>
                        <label style="display:flex;align-items:center;gap:6px;font-size:.82rem;color:var(--text-secondary);cursor:pointer">
                            <input type="checkbox" name="removePdf" value="1"> Supprimer ce justificatif
                        </label>
                    </div>
                    <span class="variables-label" style="margin-top:10px;font-weight:400;font-size:.78rem">Remplacer par un autre fichier (PDF, JPG ou PNG — optionnel)</span>
                    ` : `<span class="variables-label" style="font-weight:400;font-size:.78rem">Ajouter un justificatif (PDF, JPG ou PNG — optionnel)</span>`}
                    <input class="variables-input" type="file" name="pdf" accept="${TRAVAUX_ACCEPTED_MIME.join(',')}" style="margin-top:6px">
                </div>
                <div class="owned-modal-actions" style="grid-column:1/-1">
                    <button type="button" class="btn btn--ghost" data-close-modal>Annuler</button>
                    <button type="submit" class="btn btn--primary">Enregistrer</button>
                </div>
            </form>
        </div>
    `, 'owned-edit-travail-modal');

    modal.querySelector('[data-preview-current-pdf]')?.addEventListener('click', () => {
        if (travail.pdfFilename) openDocumentPreview(assetId, travail.pdfFilename);
    });

    modal.querySelector('[data-form="edit-travail"]')?.addEventListener('submit', async e => {
        e.preventDefault();
        const form = e.target;
        const fd = new FormData(form);
        const removePdf = fd.get('removePdf') === '1';
        const file = fd.get('pdf');
        // undefined = ne pas toucher au justificatif existant ; null = le retirer.
        let pdfFilename;
        if (file && file.size > 0) {
            if (!TRAVAUX_ACCEPTED_MIME.includes(file.type)) {
                showToast('Format non supporté (PDF, JPG ou PNG uniquement)', 'negative');
                return;
            }
            if (file.size > TRAVAUX_MAX_STORED_SIZE) {
                showToast('Fichier trop volumineux (15 Mo maximum)', 'negative');
                return;
            }
            try {
                const newFilename = await uploadOwnedDocument(assetId, file);
                if (travail.pdfFilename) cloudDeleteDocument(assetId, travail.pdfFilename).catch(() => {});
                pdfFilename = newFilename;
            } catch {
                showToast('Échec de l\'import du fichier', 'negative');
                return;
            }
        } else if (removePdf && travail.pdfFilename) {
            cloudDeleteDocument(assetId, travail.pdfFilename).catch(() => {});
            pdfFilename = null;
        }
        updateOwnedTravail(assetId, travailId, {
            date: fd.get('date'),
            description: String(fd.get('description') || '').trim(),
            montant: Number(fd.get('montant')),
            tag: fd.get('tag'),
            commentaire: String(fd.get('commentaire') || '').trim(),
            financeParCredit: fd.get('financeParCredit') === '1',
            ...(pdfFilename !== undefined ? { pdfFilename } : {})
        });
        modal.hidden = true;
        showToast('Frais modifié');
        const fresh = getOwnedAsset(assetId);
        renderOwnedTravauxTab(fresh);
        renderAccordionPostAchat(fresh);
        renderOwnedSynthese(fresh);
        renderOwnedCalculTab(fresh);
        renderAccordionSimulateur(fresh);
    });
}

// ─── FACTURES DÉCORTIQUÉES PAR CORPS D'ÉTAT ──────────────────────────────────────────────────
// Chaque frais avec justificatif est envoyé (toutes ses pages) à la Cloud Function
// decortiquerFacture ; les articles reviennent classés par corps d'état et sont stockés dans
// `travail.detail` (forme et regroupement : corps-etat.js). Vue de lecture, hors calculs. Voir
// docs/superpowers/specs/2026-10-27-factures-par-corps-etat-design.md.
// File d'attente en mémoire : 3 analyses simultanées sur PC, 1 sur iPhone (mémoire limitée pour
// rasteriser les PDF) ; un plafond IA atteint annule le reste de la file (frais laissés « à
// décortiquer », rien n'est écrit pour eux).
const DECORTICAGE_MAX_PAGES = 8;              // = MAX_PAGES_DECORTICAGE de functions/index.js
const DECORTICAGE_MAX_PAGES_MOBILE = 3;
const DECORTICAGE_MAX_BASE64 = 9_000_000;     // = MAX_TOTAL_BASE64_DECORTICAGE de functions/index.js
const DECORTICAGE_LARGEUR_MAX = 1600;         // px : lisible pour l'IA, léger à envoyer
const _decorticageEnCours = new Set();        // ids des frais en file ou en cours d'analyse
const _decorticageFile = [];
let _decorticageActifs = 0;

export function _planifierDecorticage(assetId, travailId) {
    if (_decorticageEnCours.has(travailId)) return Promise.resolve('ignore');
    _decorticageEnCours.add(travailId);
    setTimeout(() => _rafraichirVueCorpsEtat(assetId), 0);
    return new Promise(resolve => {
        _decorticageFile.push({ assetId, travailId, resolve });
        _pomperDecorticage();
    });
}

function _pomperDecorticage() {
    const max = IS_MOBILE_PAGE ? 1 : 3;
    while (_decorticageActifs < max && _decorticageFile.length) {
        const job = _decorticageFile.shift();
        _decorticageActifs++;
        _decortiquerTravail(job.assetId, job.travailId)
            .catch(() => 'echec')
            .then(resultat => {
                _decorticageActifs--;
                _decorticageEnCours.delete(job.travailId);
                if (resultat === 'plafond') {
                    for (const j of _decorticageFile.splice(0)) {
                        _decorticageEnCours.delete(j.travailId);
                        j.resolve('plafond');
                    }
                }
                _rafraichirVueCorpsEtat(job.assetId);
                job.resolve(resultat);
                _pomperDecorticage();
            });
    }
}

async function _chargerJustificatifFichier(assetId, pdfFilename) {
    const url = await cloudDocumentUrl(assetId, pdfFilename);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`http_${res.status}`);
    const blob = await res.blob();
    const type = /\.pdf$/i.test(pdfFilename) ? 'application/pdf'
        : /\.png$/i.test(pdfFilename) ? 'image/png'
        : /\.jpe?g$/i.test(pdfFilename) ? 'image/jpeg'
        : blob.type;
    return new File([blob], pdfFilename, { type });
}

// Pages d'une facture prêtes pour l'IA : un PDF est rasterisé page par page (au plus `maxPages`),
// une image est réduite si elle dépasse DECORTICAGE_LARGEUR_MAX. Les pages au-delà du budget de
// taille sont abandonnées (analyse « partielle »). → { images: [{base64, mimeType}], pagesTotal }
async function _preparerPagesFacture(file, maxPages) {
    const blobs = [];
    let pagesTotal = 1;
    if (file.type === 'application/pdf') {
        const pdfjs = await _loadPdfjs();
        const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
        pagesTotal = pdf.numPages;
        if (pagesTotal > maxPages) return { images: [], pagesTotal };
        for (let n = 1; n <= pagesTotal; n++) {
            const page = await pdf.getPage(n);
            const base = page.getViewport({ scale: 1 });
            const viewport = page.getViewport({ scale: Math.min(2, DECORTICAGE_LARGEUR_MAX / base.width) });
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(viewport.width);
            canvas.height = Math.round(viewport.height);
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            await page.render({ canvasContext: ctx, viewport }).promise;
            blobs.push(await _canvasVersJpeg(canvas));
            canvas.width = canvas.height = 0;
        }
        pdf.destroy?.();
    } else {
        const bitmap = await createImageBitmap(file);
        if (bitmap.width <= DECORTICAGE_LARGEUR_MAX && file.size < 3_000_000) {
            blobs.push(file);
        } else {
            const ratio = Math.min(1, DECORTICAGE_LARGEUR_MAX / bitmap.width);
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(bitmap.width * ratio);
            canvas.height = Math.round(bitmap.height * ratio);
            canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            blobs.push(await _canvasVersJpeg(canvas));
        }
        bitmap.close?.();
    }
    const images = [];
    let taille = 0;
    for (const blob of blobs) {
        const base64 = await _fileToBase64(blob);
        if (taille + base64.length > DECORTICAGE_MAX_BASE64) break;
        taille += base64.length;
        images.push({ base64, mimeType: blob.type === 'image/png' ? 'image/png' : 'image/jpeg' });
    }
    return { images, pagesTotal };
}

// → 'ok' | 'echec' | 'plafond' | 'reporte' (iPhone, facture trop longue) | 'ignore'
async function _decortiquerTravail(assetId, travailId) {
    const travail = getOwnedAsset(assetId)?.postAchat?.travaux?.find(t => t.id === travailId);
    if (!travail?.pdfFilename) return 'ignore';
    const { pdfFilename } = travail;
    const maxPages = IS_MOBILE_PAGE ? DECORTICAGE_MAX_PAGES_MOBILE : DECORTICAGE_MAX_PAGES;
    let pages;
    try {
        pages = await _preparerPagesFacture(await _chargerJustificatifFichier(assetId, pdfFilename), maxPages);
    } catch {
        return _enregistrerDetail(assetId, travailId, pdfFilename, { statut: 'echec', raison: 'justificatif illisible' });
    }
    if (!pages.images.length) {
        if (IS_MOBILE_PAGE) return 'reporte';
        const raison = pages.pagesTotal > maxPages ? `facture trop longue (${pages.pagesTotal} pages, ${maxPages} max)` : 'justificatif trop volumineux';
        return _enregistrerDetail(assetId, travailId, pdfFilename, { statut: 'echec', raison });
    }
    let res;
    try {
        res = await cloudDecortiquerFacture(pages.images);
    } catch (err) {
        if (err?.code === 'functions/resource-exhausted') return 'plafond';
        return _enregistrerDetail(assetId, travailId, pdfFilename, { statut: 'echec', raison: 'service IA indisponible, réessaie plus tard' });
    }
    return _enregistrerDetail(assetId, travailId, pdfFilename, {
        statut: pages.images.length < pages.pagesTotal ? 'partiel' : 'ok',
        pages: pages.images.length,
        articlesBruts: res?.articles
    });
}

// Écrit le résultat sur l'état COURANT du bien (il a pu changer pendant l'analyse) ; abandonne si le
// frais a disparu ou si son justificatif a été remplacé entre-temps.
function _enregistrerDetail(assetId, travailId, pdfFilename, { statut, raison = '', pages = 0, articlesBruts = [] }) {
    const all = loadOwnedAssets();
    const travaux = all[assetId]?.postAchat?.travaux || [];
    const t = travaux.find(x => x.id === travailId);
    if (!t || t.pdfFilename !== pdfFilename) return 'ignore';
    const articles = statut === 'echec' ? [] : nettoyerArticles(articlesBruts, corpsEtatLibres(travaux));
    t.detail = {
        statut,
        analyseLe: new Date().toISOString().slice(0, 10),
        pages,
        ...(raison ? { raison } : {}),
        articles: fusionnerReclassements(t.detail?.articles, articles)
    };
    saveOwnedAssets(all);
    return statut === 'echec' ? 'echec' : 'ok';
}

function _rafraichirVueCorpsEtat(assetId) {
    if (state.activeOwnedAssetId !== assetId) return;
    const asset = getOwnedAsset(assetId);
    if (asset) _renderVueCorpsEtat(asset);
}

const CE_RAISONS = {
    'sans-justificatif': 'Pas de justificatif',
    'a-decortiquer': 'Pas encore décortiquée',
    'en-cours': 'Analyse en cours…',
    'echec': "Échec de l'analyse",
    'aucun-article': 'Aucun article lu sur la facture'
};

function _renderVueCorpsEtat(asset) {
    const content = nodes.ownedTravauxContent || document.getElementById('owned-travaux-content');
    const root = content?.querySelector('[data-ce-root]');
    if (!root) return;
    const travaux = asset.postAchat?.travaux || [];
    const vue = regrouperParCorpsEtat(travaux, { enCours: _decorticageEnCours });
    const aFaire = travauxADecortiquer(travaux).filter(t => !_decorticageEnCours.has(t.id));
    const enCours = travaux.filter(t => _decorticageEnCours.has(t.id)).length;
    const libres = corpsEtatLibres(travaux);
    const optionsCe = [...CORPS_ETAT.map(c => [c.cle, c.libelle]), ...libres.map(l => [l, l])];
    const filtre = state.ownedCeFiltre || 'tous';
    const fmt = n => escapeHtml(formatEuros(n));
    const fmtNb = n => (n === null || n === undefined ? '—' : escapeHtml(String(n).replace('.', ',')));
    const refFacture = f => `${f.date ? escapeHtml(formatDateFr(f.date)) + ' · ' : ''}${escapeHtml(f.description || 'Facture')}`;
    const boutonFacture = f => (f.pdfFilename
        ? `<button type="button" class="owned-ce__facture" data-preview-pdf="${escapeHtml(f.pdfFilename)}" title="Voir le justificatif">${refFacture(f)}</button>`
        : `<span class="owned-ce__facture">${refFacture(f)}</span>`);
    const peutRelancer = !IS_MOBILE_PAGE;

    const sections = [];
    vue.groupes.forEach(g => {
        sections.push({ cle: g.ce, libelle: g.libelle, total: g.total, compte: `${g.nbArticles} article${g.nbArticles > 1 ? 's' : ''}`, lignes: g.lignes.map(a => `
            <div class="owned-ce__row">
                <span class="owned-ce__d">${escapeHtml(a.d)}${a.mo ? ' <span class="owned-ce__mo" title="Main-d\'œuvre">MO</span>' : ''}</span>
                <span class="owned-ce__q" data-label="Qté">${fmtNb(a.q)}</span>
                <span class="owned-ce__pu" data-label="P.U.">${a.pu === null ? '—' : fmt(a.pu)}</span>
                <span class="owned-ce__t">${fmt(a.t)}</span>
                ${boutonFacture(a.facture)}
                <select class="variables-input owned-ce__select" data-ce-reclasser data-travail-id="${escapeHtml(a.facture.travailId)}" data-index="${a.index}" aria-label="Corps d'état de ${escapeHtml(a.d)}">
                    ${optionsCe.map(([v, l]) => `<option value="${escapeHtml(v)}" ${v === a.ce ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('')}
                </select>
            </div>`).join('') });
    });
    if (vue.ecarts.lignes.length) {
        sections.push({ cle: '__ecart', libelle: 'Écart (TVA / remise)', total: vue.ecarts.total, compte: `${vue.ecarts.lignes.length} facture${vue.ecarts.lignes.length > 1 ? 's' : ''}`, lignes: vue.ecarts.lignes.map(e => `
            <div class="owned-ce__row owned-ce__row--info">
                <span class="owned-ce__d">Articles ${fmt(e.sommeArticles)} / facture ${fmt(e.montantFrais)}${e.partiel ? ' — pages non lues' : ''}</span>
                <span class="owned-ce__t">${fmt(e.montant)}</span>
                ${boutonFacture(e.facture)}
                ${peutRelancer ? `<button type="button" class="btn btn--ghost btn--sm owned-ce__relancer" data-ce-relancer="${escapeHtml(e.facture.travailId)}">Relancer l'analyse</button>` : '<span></span>'}
            </div>`).join('') });
    }
    if (vue.nonDetaille.lignes.length) {
        sections.push({ cle: '__non-detaille', libelle: 'Non détaillé', total: vue.nonDetaille.total, compte: `${vue.nonDetaille.lignes.length} frais`, lignes: vue.nonDetaille.lignes.map(l => {
            const relancable = peutRelancer && (l.raison === 'a-decortiquer' || l.raison === 'echec' || l.raison === 'aucun-article');
            const raison = l.raison === 'a-decortiquer' && IS_MOBILE_PAGE ? 'À décortiquer depuis le PC' : CE_RAISONS[l.raison];
            return `
            <div class="owned-ce__row owned-ce__row--info">
                <span class="owned-ce__d">${escapeHtml(raison)}${l.detailRaison ? ` (${escapeHtml(l.detailRaison)})` : ''}</span>
                <span class="owned-ce__t">${fmt(l.montant)}</span>
                ${boutonFacture(l)}
                ${relancable ? `<button type="button" class="btn btn--ghost btn--sm owned-ce__relancer" data-ce-relancer="${escapeHtml(l.travailId)}">${l.raison === 'a-decortiquer' ? 'Décortiquer' : "Relancer l'analyse"}</button>` : '<span></span>'}
            </div>`;
        }).join('') });
    }
    const filtreValide = filtre === 'tous' || sections.some(s => s.cle === filtre) ? filtre : 'tous';

    root.innerHTML = !travaux.length
        ? '<p class="owned-ce__vide">Aucun frais enregistré.</p>'
        : `
        <div class="owned-ce">
            <div class="owned-ce__toolbar">
                <span class="owned-ce__total">Total des frais <strong>${fmt(vue.total)}</strong></span>
                <span class="owned-ce__progress" aria-live="polite">${enCours ? `Analyse en cours : ${enCours} facture${enCours > 1 ? 's' : ''}…` : ''}</span>
                ${!IS_MOBILE_PAGE && aFaire.length ? `<button type="button" class="btn btn--ghost btn--sm" data-action="decortiquer-factures">Décortiquer les factures (${aFaire.length})</button>` : ''}
            </div>
            <div class="owned-ce__chips" role="group" aria-label="Filtrer par corps d'état">
                <button type="button" class="owned-ce__chip" data-ce-filtre="tous" aria-pressed="${filtreValide === 'tous'}">Tous</button>
                ${sections.map(s => `<button type="button" class="owned-ce__chip" data-ce-filtre="${escapeHtml(s.cle)}" aria-pressed="${filtreValide === s.cle}">${escapeHtml(s.libelle)}</button>`).join('')}
            </div>
            <div class="owned-ce__table">
                <div class="owned-ce__cols" aria-hidden="true"><span>Article</span><span>Qté</span><span>P.U.</span><span>Total</span><span>Facture</span><span>Corps d'état</span></div>
                ${sections.map(s => `
                <section class="owned-ce__group${s.cle.startsWith('__') ? ' owned-ce__group--info' : ''}" data-ce-group="${escapeHtml(s.cle)}" ${filtreValide === 'tous' || filtreValide === s.cle ? '' : 'hidden'}>
                    <div class="owned-ce__head"><span class="owned-ce__head-nom">${escapeHtml(s.libelle)}</span><span class="owned-ce__head-compte">${s.compte}</span><strong>${fmt(s.total)}</strong></div>
                    ${s.lignes}
                </section>`).join('')}
            </div>
        </div>`;

    root.querySelectorAll('[data-ce-filtre]').forEach(chip => {
        chip.addEventListener('click', () => {
            state.ownedCeFiltre = chip.dataset.ceFiltre;
            root.querySelectorAll('[data-ce-filtre]').forEach(c => c.setAttribute('aria-pressed', String(c === chip)));
            root.querySelectorAll('[data-ce-group]').forEach(g => {
                g.hidden = state.ownedCeFiltre !== 'tous' && g.dataset.ceGroup !== state.ownedCeFiltre;
            });
        });
    });
    root.querySelectorAll('[data-preview-pdf]').forEach(btn => {
        btn.addEventListener('click', () => openDocumentPreview(asset.id, btn.dataset.previewPdf));
    });
    root.querySelectorAll('[data-ce-reclasser]').forEach(sel => {
        sel.addEventListener('change', () => {
            const all = loadOwnedAssets();
            const list = all[asset.id]?.postAchat?.travaux || [];
            const t = list.find(x => x.id === sel.dataset.travailId);
            if (!t?.detail) return;
            t.detail = reclasserArticle(t.detail, Number(sel.dataset.index), sel.value, corpsEtatLibres(list));
            saveOwnedAssets(all);
            _renderVueCorpsEtat(getOwnedAsset(asset.id));
        });
    });
    root.querySelectorAll('[data-ce-relancer]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const resultat = await _planifierDecorticage(asset.id, btn.dataset.ceRelancer);
            if (resultat === 'plafond') showToast("Limite d'analyses IA atteinte pour l'heure — réessaie plus tard", 'negative');
            else if (resultat === 'echec') showToast('Analyse impossible pour cette facture', 'negative');
        });
    });
    root.querySelector('[data-action="decortiquer-factures"]')?.addEventListener('click', async () => {
        const resultats = await Promise.all(aFaire.map(t => _planifierDecorticage(asset.id, t.id)));
        const nb = r => resultats.filter(x => x === r).length;
        if (nb('plafond')) {
            showToast(`${nb('ok')} facture${nb('ok') > 1 ? 's décortiquées' : ' décortiquée'} — limite d'analyses IA atteinte, relance dans une heure (les factures déjà traitées sont gardées)`, 'negative');
        } else if (nb('echec')) {
            showToast(`${nb('ok')} facture${nb('ok') > 1 ? 's décortiquées' : ' décortiquée'}, ${nb('echec')} en échec`, 'negative');
        } else {
            showToast(`${nb('ok')} facture${nb('ok') > 1 ? 's décortiquées' : ' décortiquée'}`);
        }
    });
}

export function renderOwnedTravauxTab(asset) {
    const el = nodes.ownedTravauxContent || document.getElementById('owned-travaux-content');
    if (!el) return;

    const post = asset.postAchat || {};
    const TAG_LABELS = Object.fromEntries(NATURES_FRAIS.map(n => [n.value, n.court]));
    const TAG_CSS = Object.fromEntries(NATURES_FRAIS.map(n => [n.value, n.css]));

    const currentYear = new Date().getFullYear();
    const totalDed = (post.travaux || [])
        .filter(t => estFraisDeductible(t.tag) && t.date && new Date(t.date).getFullYear() === currentYear)
        .reduce((s, t) => s + t.montant, 0);

    const byYear = {};
    for (const t of (post.travaux || [])) {
        const y = t.date ? new Date(t.date).getFullYear() : 'sans-date';
        (byYear[y] = byYear[y] || []).push(t);
    }
    const years = Object.keys(byYear).sort((a, b) => (b === 'sans-date' ? -1 : a === 'sans-date' ? 1 : b - a));

    const yearBlocksHtml = years.length ? years.map(y => {
        const rows = byYear[y].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        const yearTotal = rows.reduce((s, t) => s + t.montant, 0);
        const isCurrent = String(y) === String(currentYear);
        return `
        <details class="owned-travaux-year" data-default-open="${isCurrent ? '1' : '0'}" ${isCurrent ? 'open' : ''}>
            <summary class="owned-travaux-year__summary">
                <span>${y === 'sans-date' ? 'Sans date' : y}</span>
                <strong>${Math.round(yearTotal).toLocaleString('fr-FR')} €</strong>
            </summary>
            <div class="owned-travaux-list">
                ${rows.map(t => `
                    <div class="owned-travaux-row" data-search-text="${escapeHtml(`${t.description || ''} ${t.montant || ''} ${t.commentaire || ''}`)}">
                        <span class="owned-travaux-date">${escapeHtml(_formatDateFr(t.date))}</span>
                        <span class="owned-travaux-desc">${escapeHtml(t.description || '—')}${t.financeParCredit ? ` <small class="owned-caveat" data-tooltip="Inclus dans le crédit immobilier principal (pas payé cash) — reste déductible l'année du frais, mais n'est plus retranché du cash-flow puisque la mensualité rembourse déjà cette part">${icone('banque')} financé</small>` : ''}${t.commentaire ? `<br><small style="color:var(--text-tertiary)">${escapeHtml(t.commentaire)}</small>` : ''}</span>
                        <span class="owned-travaux-montant">${Math.round(t.montant).toLocaleString('fr-FR')} €</span>
                        <span class="tag ${TAG_CSS[t.tag] || 'tag--grey'}">${escapeHtml(TAG_LABELS[t.tag] || t.tag)}</span>
                        ${t.pdfFilename ? `<button type="button" class="owned-travaux-pdf-btn" data-preview-pdf="${escapeHtml(t.pdfFilename)}" title="Voir le justificatif" aria-label="Voir le justificatif de ${escapeHtml(t.description || 'ce frais')}">${icone('document')}</button>` : '<span class="owned-travaux-pdf-vide"></span>'}
                        <button type="button" class="owned-travaux-edit" data-edit-travail="${escapeHtml(t.id)}" title="Modifier" aria-label="Modifier ${escapeHtml(t.description || 'ce frais')}">${icone('crayon')}</button>
                        <button class="owned-travaux-delete" data-delete-travail-tab="${escapeHtml(t.id)}" title="Supprimer" aria-label="Supprimer">${icone('croix')}</button>
                    </div>
                `).join('')}
            </div>
        </details>`;
    }).join('') : '<p style="font-size:.82rem;color:var(--text-tertiary);font-style:italic">Aucun frais enregistré.</p>';

    const vueCorps = state.ownedTravauxVue === 'corps';
    el.innerHTML = `
        <div class="owned-travaux-head">
            <div class="owned-section-title">Frais &amp; justificatifs</div>
            <div class="mode-toggle mode-toggle--sm" role="group" aria-label="Affichage des frais">
                <button type="button" class="mode-toggle__btn" data-travaux-vue-btn="liste" aria-pressed="${vueCorps ? 'false' : 'true'}">Liste des frais</button>
                <button type="button" class="mode-toggle__btn" data-travaux-vue-btn="corps" aria-pressed="${vueCorps ? 'true' : 'false'}">Par corps d'état</button>
            </div>
        </div>
        <div data-ce-root ${vueCorps ? '' : 'hidden'}></div>
        <div data-travaux-liste ${vueCorps ? 'hidden' : ''}>
        <div class="owned-travaux-toolbar">
            <span class="owned-travaux-search-wrap">${icone('loupe')}<input type="search" class="variables-input owned-travaux-search" data-travaux-search placeholder="Rechercher un frais…" aria-label="Rechercher un frais"></span>
            <button type="button" class="btn btn--ghost btn--sm" data-action="print-factures" ${(post.travaux || []).length ? '' : 'disabled'}>Imprimer les factures</button>
            ${IS_MOBILE_PAGE ? '' : `<button type="button" class="btn btn--ghost btn--sm" data-action="open-projection-impots" title="Effet des travaux déductibles sur l'impôt du foyer, année par année">Impôts des prochaines années</button>`}
        </div>
        ${yearBlocksHtml}
        ${totalDed > 0 ? `<div class="owned-travaux-totals"><span>Déductible ${currentYear} : <strong>${Math.round(totalDed).toLocaleString('fr-FR')} €</strong></span></div>` : ''}
        </div>
        <div class="owned-travaux-add-row">
            <div class="owned-travaux-dropzone" data-travaux-dropzone tabindex="0" role="button" aria-label="Déposer une facture ou une photo">
                <input type="file" accept="application/pdf,image/jpeg,image/png" multiple data-travaux-file-input hidden>
                <div class="owned-travaux-dropzone__body" data-travaux-dropzone-body>
                    <div class="owned-travaux-dropzone__icon">${icone('document')}</div>
                    <div class="owned-travaux-dropzone__label">Dépose une facture ou une photo</div>
                    <div class="owned-travaux-dropzone__hint">PDF, JPG ou PNG — glisser-déposer ou <span class="owned-travaux-dropzone__browse">choisir un fichier</span></div>
                </div>
                <div class="owned-travaux-dropzone__status" data-travaux-status hidden></div>
            </div>
            <form class="owned-travaux-form" data-form="add-travail-tab" novalidate>
                <div class="owned-travaux-ai-banner" data-travaux-ai-banner hidden></div>
                <label class="field-inline"><span class="field-inline__label">Date du frais</span><input type="date" name="date" class="variables-input" required placeholder="Date" data-field="date" style="flex:0 0 140px"></label>
                <label class="field-inline"><span class="field-inline__label">Description</span><input type="text" name="description" class="variables-input" required placeholder="Description" data-field="description" style="flex:1;min-width:120px"></label>
                <label class="field-inline"><span class="field-inline__label">Montant (€)</span><input type="number" name="montant" class="variables-input" required placeholder="Montant €" min="0" data-field="montant" style="flex:0 0 100px"></label>
                <span class="owned-travaux-tag-wrap">
                    <label class="field-inline"><span class="field-inline__label">Nature du frais</span><select name="tag" class="variables-input" data-field="tag" style="flex:0 0 130px">
                        ${natureFraisOptionsHtml()}
                    </select></label>
                    <span class="owned-tag-suggested-badge" data-tag-suggested-badge hidden>${icone('etincelle')} suggéré</span>
                </span>
                <label class="field-inline"><span class="field-inline__label">Commentaire (optionnel)</span><input type="text" name="commentaire" class="variables-input" placeholder="Commentaire (optionnel)" style="flex:1;min-width:120px"></label>
                <label style="display:flex;align-items:center;gap:6px;font-size:.78rem;color:var(--text-secondary);white-space:nowrap;flex:0 0 auto" data-tooltip="À cocher si ce frais fait partie de l'enveloppe du crédit immobilier principal (pas payé cash) — reste déductible fiscalement l'année du frais, mais n'est plus retranché du cash-flow puisque la mensualité rembourse déjà cette part">
                    <input type="checkbox" name="financeParCredit" value="1"> Financé par le crédit
                </label>
                <button type="submit" class="btn btn--primary btn--sm">Ajouter</button>
            </form>
        </div>
    `;

    el.querySelector('[data-action="print-factures"]')?.addEventListener('click', () => {
        openImpressionFacturesModal({ assetId: state.activeOwnedAssetId });
    });

    // Bascule « Liste des frais » / « Par corps d'état » : choix gardé en mémoire de session
    // (state), pas de persistance.
    el.querySelectorAll('[data-travaux-vue-btn]').forEach(btn => {
        btn.addEventListener('click', () => {
            const corps = btn.dataset.travauxVueBtn === 'corps';
            state.ownedTravauxVue = corps ? 'corps' : 'liste';
            el.querySelectorAll('[data-travaux-vue-btn]').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
            el.querySelector('[data-ce-root]').hidden = !corps;
            el.querySelector('[data-travaux-liste]').hidden = corps;
        });
    });
    _renderVueCorpsEtat(asset);

    el.querySelectorAll('[data-preview-pdf]').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = state.activeOwnedAssetId;
            if (!id) return;
            openDocumentPreview(id, btn.dataset.previewPdf);
        });
    });

    el.querySelectorAll('[data-edit-travail]').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = state.activeOwnedAssetId;
            if (!id) return;
            openEditTravailModal(id, btn.dataset.editTravail);
        });
    });

    el.querySelectorAll('[data-delete-travail-tab]').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = state.activeOwnedAssetId;
            if (!id) return;
            deleteOwnedTravail(id, btn.dataset.deleteTravailTab);
            const fresh = getOwnedAsset(id);
            renderOwnedTravauxTab(fresh);
            renderAccordionPostAchat(fresh);
            renderOwnedSynthese(fresh);
            renderOwnedCalculTab(fresh);
            renderAccordionSimulateur(fresh);
        });
    });

    // ─── Recherche (filtre client, déplie les années qui matchent) ───────────
    const searchInput = el.querySelector('[data-travaux-search]');
    searchInput?.addEventListener('input', () => {
        const q = _normalizeSearchText(searchInput.value.trim());
        el.querySelectorAll('.owned-travaux-year').forEach(details => {
            if (!q) {
                details.hidden = false;
                details.open = details.dataset.defaultOpen === '1';
                details.querySelectorAll('.owned-travaux-row').forEach(row => { row.hidden = false; });
                return;
            }
            let anyMatch = false;
            details.querySelectorAll('.owned-travaux-row').forEach(row => {
                const match = _normalizeSearchText(row.dataset.searchText).includes(q);
                row.hidden = !match;
                if (match) anyMatch = true;
            });
            details.hidden = !anyMatch;
            if (anyMatch) details.open = true;
        });
    });

    // ─── Dépôt facture/photo → extraction IA (Cloud Function extraireFraisFacture) ──────────
    // Pré-remplit le formulaire ci-contre ; le fichier reste attaché comme justificatif au
    // clic "Ajouter" même si l'extraction échoue (toast, pas de blocage). Voir spec
    // docs/superpowers/specs/2026-08-04-onglet-travaux-refonte.md.
    let pendingFile = null;
    const dropzone = el.querySelector('[data-travaux-dropzone]');
    const dropzoneBody = el.querySelector('[data-travaux-dropzone-body]');
    const fileInput = el.querySelector('[data-travaux-file-input]');
    const statusEl = el.querySelector('[data-travaux-status]');
    const aiBanner = el.querySelector('[data-travaux-ai-banner]');
    const tagBadge = el.querySelector('[data-tag-suggested-badge]');
    const form = el.querySelector('[data-form="add-travail-tab"]');
    const fieldDate = form.querySelector('[data-field="date"]');
    const fieldDesc = form.querySelector('[data-field="description"]');
    const fieldMontant = form.querySelector('[data-field="montant"]');
    const fieldTag = form.querySelector('[data-field="tag"]');

    const resetDropzone = () => {
        pendingFile = null;
        if (fileInput) fileInput.value = '';
        dropzone.classList.remove('owned-travaux-dropzone--filled', 'owned-travaux-dropzone--dragover');
        dropzoneBody.hidden = false;
        statusEl.hidden = true;
        statusEl.className = 'owned-travaux-dropzone__status';
        statusEl.textContent = '';
        aiBanner.hidden = true;
        tagBadge.hidden = true;
        [fieldDate, fieldDesc, fieldMontant].forEach(f => f.classList.remove('ai-filled'));
    };

    const handleFile = async file => {
        if (!TRAVAUX_ACCEPTED_MIME.includes(file.type)) {
            showToast('Format non supporté (PDF, JPG ou PNG uniquement)', 'negative');
            return;
        }
        if (file.size > TRAVAUX_MAX_STORED_SIZE) {
            showToast('Fichier trop volumineux (15 Mo maximum)', 'negative');
            return;
        }
        pendingFile = file;
        dropzoneBody.hidden = true;
        dropzone.classList.add('owned-travaux-dropzone--filled');
        statusEl.hidden = false;
        statusEl.className = 'owned-travaux-dropzone__status owned-travaux-dropzone__status--loading';
        definirTexteAvecIcone(statusEl, 'document', `${file.name} — lecture de la facture…`);

        if (file.size > TRAVAUX_MAX_FILE_SIZE) {
            statusEl.className = 'owned-travaux-dropzone__status owned-travaux-dropzone__status--error';
            definirTexteAvecIcone(statusEl, 'document', `${file.name} — trop volumineux pour l'extraction (max 8 Mo), remplis à la main`);
            return;
        }

        try {
            const { base64, mimeType } = await _prepareFactureImage(file);
            const result = await cloudExtraireFraisFacture(base64, mimeType);
            const descriptionIA = _buildFactureDescription(result.fournisseur, result.description);
            if (result.date) { fieldDate.value = result.date; fieldDate.classList.add('ai-filled'); }
            if (descriptionIA) { fieldDesc.value = descriptionIA; fieldDesc.classList.add('ai-filled'); }
            if (result.montant > 0) { fieldMontant.value = result.montant; fieldMontant.classList.add('ai-filled'); }
            fieldTag.value = suggererNatureFrais(result);
            tagBadge.hidden = false;
            aiBanner.hidden = false;
            definirTexteAvecIcone(aiBanner, 'etincelle', `Facture : ${file.name} — vérifie les champs avant de valider`);
            statusEl.className = 'owned-travaux-dropzone__status owned-travaux-dropzone__status--ok';
            definirTexteAvecIcone(statusEl, 'document', `${file.name} — pré-rempli`);
        } catch (err) {
            statusEl.className = 'owned-travaux-dropzone__status owned-travaux-dropzone__status--error';
            definirTexteAvecIcone(statusEl, 'document', `${file.name} — extraction impossible, remplis à la main`);
            showToast('Extraction impossible, remplis le formulaire à la main', 'negative');
        }
    };

    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
    dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('owned-travaux-dropzone--dragover'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('owned-travaux-dropzone--dragover'));
    // Plusieurs fichiers a la fois -> modale globale « Ajouter des factures » verrouillee sur ce
    // bien (openAjoutFacturesModal, remplace l'import groupe du 2026-08-04) ; un seul fichier ->
    // flux inline existant (handleFile), inchange.
    const handleFiles = fileList => {
        const files = Array.from(fileList || []);
        if (files.length === 0) return;
        if (files.length === 1) { handleFile(files[0]); return; }
        openAjoutFacturesModal({ assetId: state.activeOwnedAssetId, files, lockAsset: true });
    };
    dropzone.addEventListener('drop', e => {
        e.preventDefault();
        dropzone.classList.remove('owned-travaux-dropzone--dragover');
        handleFiles(e.dataTransfer.files);
    });
    fileInput.addEventListener('change', () => {
        handleFiles(fileInput.files);
        fileInput.value = '';
    });

    form.addEventListener('submit', async e => {
        e.preventDefault();
        const fd = new FormData(form);
        const id = state.activeOwnedAssetId;
        if (!id) return;
        const date = fd.get('date');
        const description = fd.get('description')?.trim();
        const montant = Number(fd.get('montant'));
        if (!date || !description || !montant) {
            showToast('Date, description et montant sont requis', 'negative');
            return;
        }
        const doublon = findSimilarTravail(getOwnedAsset(id), { montant, date });
        // Taxe foncière déjà dans les charges : avertissement non bloquant (B9), porté par le toast
        // de confirmation de l'ajout (un seul toast à la fois, voir showToast).
        const alerteTF = alerteDoublonTaxeFonciere(getOwnedAsset(id), { tag: fd.get('tag'), description, date });
        if (doublon && !window.confirm(`Une dépense très proche existe déjà : « ${doublon.description || 'sans description'} » du ${_formatDateFr(doublon.date)} (${Math.round(doublon.montant).toLocaleString('fr-FR')} €).\n\nAjouter quand même ce frais ?`)) {
            return;
        }
        let pdfFilename = null;
        if (pendingFile) {
            try {
                pdfFilename = await uploadOwnedDocument(id, pendingFile);
            } catch {
                showToast('Échec de l\'import du fichier', 'negative');
                return;
            }
        }
        addOwnedTravail(id, {
            date,
            description,
            montant,
            tag: fd.get('tag'),
            commentaire: fd.get('commentaire')?.trim(),
            pdfFilename,
            financeParCredit: fd.get('financeParCredit') === '1'
        });
        form.reset();
        resetDropzone();
        showToast(alerteTF ? `Frais ajouté. ${alerteTF}` : 'Frais ajouté', alerteTF ? 'negative' : 'positive');
        const fresh = getOwnedAsset(id);
        renderOwnedTravauxTab(fresh);
        renderAccordionPostAchat(fresh);
        renderOwnedSynthese(fresh);
        renderOwnedCalculTab(fresh);
        renderAccordionSimulateur(fresh);
    });
}
