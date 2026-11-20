// Factures du portefeuille biens détenus (découpage d'owned-portfolio.js, audit T7) : impression groupée des factures
// (récapitulatif + justificatifs en un PDF), modale globale « Ajouter des factures » (lecture IA par lot, doublons, taxe
// foncière) et import d'un dossier de documents d'un bien. Déplacé tel quel : aucun changement de comportement.

import { icone, definirTexteAvecIcone } from './icones.js';
import { state, IS_MOBILE_PAGE } from './owned-contexte.js';
import { escapeHtml, showToast } from './utils.js';
import { cloudDocumentUrl, cloudExtraireFraisFacture, cloudExtraireDossierBien } from './owned-cloud.js';
import { savePref } from './cloud-store.js';
import { anneesDisponibles, selectionnerFrais, nomFichierFactures, formatEuros, formatDateFr, genererPdfFactures } from './factures-pdf.js';
import { FM_MAX_FILES_PER_DROP, _collectDroppedFiles, _fileToBase64, _filterFactureFiles, _formatDateFr, _loadPdfLib, _pdfFirstPageToPngFile, _prepareFactureImage, _runWithConcurrencyLimit, _telechargerBlob } from './owned-fichiers.js';
import { NATURES_FRAIS, _refreshAfterFacturesAdd, _showOwnedModal, addOwnedTravail, alerteDoublonTaxeFonciere, createOwnedAsset, findSimilarTravail, getOrderedAssetList, getOwnedAsset, natureFraisOptionsHtml, openDocumentPreview, openOwnedAddModal, openOwnedDetail, renderAccordionAcquisition, renderAccordionPostAchat, renderAccordionSimulateur, renderOwnedCalculTab, renderOwnedSynthese, renderOwnedTravauxTab, suggererNatureFrais, updateOwnedAcquisition, updateOwnedAsset, updateOwnedCredit, updateOwnedPostAchat, uploadOwnedDocument } from './owned-portfolio.js';

export function openImpressionFacturesModal({ assetId = null } = {}) {
    const assets = getOrderedAssetList();
    if (!assets.length) return;
    const LIBELLES = Object.fromEntries(NATURES_FRAIS.map(n => [n.value, n.court]));
    const TAG_CSS = Object.fromEntries(NATURES_FRAIS.map(n => [n.value, n.css]));
    const anneeCourante = new Date().getFullYear();
    const filtre = { assetId: assetId && assets.some(a => a.id === assetId) ? assetId : (assets.length === 1 ? assets[0].id : 'tous'), annee: 'toutes', nature: 'toutes' };
    const annees0 = anneesDisponibles(assets, filtre.assetId);
    filtre.annee = annees0.includes(anneeCourante) ? anneeCourante : (annees0[0] ?? 'toutes');
    const exclus = new Set(); // ids de frais décochés à la main (survivent aux changements de filtre)

    const modal = _showOwnedModal(`
        <div class="owned-modal owned-modal--wide owned-pf" role="dialog" aria-labelledby="owned-pf-title">
            <div class="owned-modal-head">
                <div>
                    <h3 class="owned-modal-title" id="owned-pf-title">Imprimer les factures</h3>
                    <div class="owned-modal-sub">Un seul PDF : le récapitulatif, puis chaque facture dans le même ordre.</div>
                </div>
                <button class="btn btn--ghost" data-close-modal aria-label="Fermer">${icone('croix')}</button>
            </div>
            <div class="owned-pf__filters">
                <label class="variables-field">
                    <span class="variables-label">Bien</span>
                    <select class="variables-input" data-pf="asset">
                        ${assets.length > 1 ? `<option value="tous">Tous les biens</option>` : ''}
                        ${assets.map(a => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.nom || 'Sans nom')}</option>`).join('')}
                    </select>
                </label>
                <label class="variables-field">
                    <span class="variables-label">Année</span>
                    <select class="variables-input" data-pf="annee"></select>
                </label>
                <label class="variables-field">
                    <span class="variables-label">Nature</span>
                    <select class="variables-input" data-pf="nature">
                        <option value="toutes">Toutes les natures</option>
                        <option value="deductibles">Déductibles au réel uniquement</option>
                        ${NATURES_FRAIS.map(n => `<option value="${n.value}">${escapeHtml(n.court)}</option>`).join('')}
                    </select>
                </label>
            </div>
            <div class="owned-pf__bar">
                <label class="owned-pf__all"><input type="checkbox" data-pf-all> Tout sélectionner</label>
                <span class="owned-pf__summary" data-pf-summary></span>
            </div>
            <div class="owned-pf__list" data-pf-list></div>
            <div class="owned-modal-actions">
                <span class="owned-pf__status" data-pf-status role="status"></span>
                <button type="button" class="btn btn--ghost" data-close-modal>Annuler</button>
                <button type="button" class="btn btn--primary" data-pf-generate>Générer le PDF</button>
            </div>
        </div>
    `, 'owned-print-factures-modal');

    const sel = name => modal.querySelector(`[data-pf="${name}"]`);
    const listEl = modal.querySelector('[data-pf-list]');
    const summaryEl = modal.querySelector('[data-pf-summary]');
    const allCb = modal.querySelector('[data-pf-all]');
    const genBtn = modal.querySelector('[data-pf-generate]');
    const statusEl = modal.querySelector('[data-pf-status]');
    let items = [];

    const remplirAnnees = () => {
        const annees = anneesDisponibles(assets, filtre.assetId);
        if (filtre.annee !== 'toutes' && !annees.includes(Number(filtre.annee))) filtre.annee = annees[0] ?? 'toutes';
        sel('annee').innerHTML = `<option value="toutes">Toutes les années</option>`
            + annees.map(y => `<option value="${y}">${y}</option>`).join('');
        sel('annee').value = String(filtre.annee);
    };

    const selectionnes = () => items.filter(i => !exclus.has(i.travail.id));

    const majResume = () => {
        const choisis = selectionnes();
        const total = choisis.reduce((s, i) => s + (Number(i.travail.montant) || 0), 0);
        const justif = choisis.filter(i => i.travail.pdfFilename).length;
        summaryEl.textContent = choisis.length
            ? `${choisis.length} frais · ${formatEuros(total)} · ${justif} justificatif${justif > 1 ? 's' : ''}`
            : 'Aucun frais sélectionné';
        allCb.checked = items.length > 0 && choisis.length === items.length;
        allCb.indeterminate = choisis.length > 0 && choisis.length < items.length;
        allCb.disabled = items.length === 0;
        genBtn.disabled = choisis.length === 0;
    };

    const rendreListe = () => {
        items = selectionnerFrais(assets, filtre);
        const multi = filtre.assetId === 'tous';
        listEl.innerHTML = items.length ? items.map(({ assetNom, travail: t }) => `
            <label class="owned-pf-row">
                <input type="checkbox" data-pf-item="${escapeHtml(t.id)}" ${exclus.has(t.id) ? '' : 'checked'}>
                <span class="owned-pf-row__date">${escapeHtml(formatDateFr(t.date))}</span>
                <span class="owned-pf-row__desc">${escapeHtml(t.description || '—')}${multi ? `<small>${escapeHtml(assetNom)}</small>` : ''}</span>
                <span class="tag ${TAG_CSS[t.tag] || 'tag--grey'}">${escapeHtml(LIBELLES[t.tag] || t.tag || '—')}</span>
                <span class="owned-pf-row__montant">${escapeHtml(formatEuros(t.montant))}</span>
                <span class="owned-pf-row__justif${t.pdfFilename ? '' : ' owned-pf-row__justif--absent'}">${t.pdfFilename ? 'Facture jointe' : 'Sans facture'}</span>
            </label>`).join('')
            : '<p class="owned-pf__empty">Aucun frais pour ces critères.</p>';
        listEl.querySelectorAll('[data-pf-item]').forEach(cb => cb.addEventListener('change', () => {
            if (cb.checked) exclus.delete(cb.dataset.pfItem); else exclus.add(cb.dataset.pfItem);
            majResume();
        }));
        majResume();
    };

    sel('asset').value = filtre.assetId;
    remplirAnnees();
    sel('asset').addEventListener('change', () => { filtre.assetId = sel('asset').value; remplirAnnees(); rendreListe(); });
    sel('annee').addEventListener('change', () => { filtre.annee = sel('annee').value === 'toutes' ? 'toutes' : Number(sel('annee').value); rendreListe(); });
    sel('nature').addEventListener('change', () => { filtre.nature = sel('nature').value; rendreListe(); });
    allCb.addEventListener('change', () => {
        items.forEach(i => { if (allCb.checked) exclus.delete(i.travail.id); else exclus.add(i.travail.id); });
        rendreListe();
    });
    rendreListe();

    genBtn.addEventListener('click', async () => {
        const choisis = selectionnes();
        if (!choisis.length) return;
        const libNature = sel('nature').selectedOptions[0]?.textContent || 'Toutes les natures';
        const bienNom = filtre.assetId === 'tous' ? null : (assets.find(a => a.id === filtre.assetId)?.nom || 'Sans nom');
        const entete = [
            bienNom ? `Bien : ${bienNom}` : `Biens : tous les biens (${new Set(choisis.map(i => i.assetId)).size})`,
            `Période : ${filtre.annee === 'toutes' ? 'toutes les années' : `année ${filtre.annee}`}`,
            `Nature : ${filtre.nature === 'toutes' ? 'toutes' : libNature}`,
            `Édité le ${new Date().toLocaleDateString('fr-FR')}`,
        ];
        genBtn.disabled = true;
        statusEl.textContent = 'Préparation…';
        try {
            const PDFLib = await _loadPdfLib();
            const { bytes, echecs } = await genererPdfFactures({
                PDFLib, items: choisis, entete, libellesNatures: LIBELLES,
                chargerJustificatif: async item => {
                    const url = await cloudDocumentUrl(item.assetId, item.travail.pdfFilename);
                    const res = await fetch(url);
                    if (!res.ok) throw new Error(`http_${res.status}`);
                    return res.arrayBuffer();
                },
                onProgress: (n, N) => { statusEl.textContent = `Téléchargement des factures ${n} / ${N}…`; },
            });
            _telechargerBlob(new Blob([bytes], { type: 'application/pdf' }), nomFichierFactures({ annee: filtre.annee, bienNom }));
            statusEl.textContent = '';
            if (echecs.length) {
                showToast(`PDF généré, mais ${echecs.length} facture${echecs.length > 1 ? 's illisibles' : ' illisible'} (page d'avertissement à la place)`, 'negative');
            } else {
                showToast('PDF des factures généré');
                modal.hidden = true;
            }
        } catch (err) {
            statusEl.textContent = '';
            showToast('Impossible de générer le PDF des factures', 'negative');
        } finally {
            genBtn.disabled = selectionnes().length === 0;
        }
    });
}

// ─── IMPORT DE DOSSIER BIEN : conversion PDF, extraction multi-documents, fusion ─────────────
// Voir spec docs/superpowers/specs/2026-09-22-import-dossier-bien.md. PC uniquement
// (IS_MOBILE_PAGE) — le mobile reste un usage de visualisation/édition légère.

const DOSSIER_ACCEPTED_EXT = /\.(pdf|jpe?g|png)$/i;
const DOSSIER_MAX_FILE_SIZE = 8 * 1024 * 1024;

// Convertit chaque PDF du dossier en PNG avant extraction (Mammouth AI n'accepte que
// image/jpeg|png côté serveur — voir functions/index.js). Les fichiers JPG/PNG natifs passent
// tels quels. Un échec de conversion (PDF chiffré, scan illisible) ne bloque pas le reste du
// dossier : le fichier original est conservé avec un statut d'erreur.
async function _prepareDossierFiles(files) {
    return Promise.all(files.map(async (original) => {
        if (!/\.pdf$/i.test(original.name)) {
            return { original, imageFile: original, conversionError: null };
        }
        try {
            const imageFile = await _pdfFirstPageToPngFile(original);
            return { original, imageFile, conversionError: null };
        } catch (err) {
            return { original, imageFile: null, conversionError: 'Conversion PDF impossible (fichier chiffré ou illisible)' };
        }
    }));
}

// Chemins de champs fusionnables (bien/acquisition/credit/charges) -> where ils s'écrivent sur
// l'asset. `sub` = null pour les champs top-level (ville, codePostal...), sinon le nom du
// sous-objet cible (acquisition/credit/postAchat).
const DOSSIER_FIELD_MAP = {
    'bien.adresse':          { label: 'Adresse',                 sub: null,         key: 'adresse' },
    'bien.ville':             { label: 'Ville',                   sub: null,         key: 'ville' },
    'bien.codePostal':        { label: 'Code postal',             sub: null,         key: 'codePostal' },
    'bien.surface':           { label: 'Surface (m²)',            sub: 'acquisition', key: 'surface' },
    'bien.typeBien':          { label: 'Type de bien',            sub: 'acquisition', key: 'typeBien' },
    'acquisition.prix':       { label: "Prix d'achat (€)",        sub: 'acquisition', key: 'prix' },
    'acquisition.fraisNotaire': { label: 'Frais de notaire (€)',  sub: 'acquisition', key: 'fraisNotaire' },
    'acquisition.fraisAgence': { label: "Frais d'agence (€)",     sub: 'acquisition', key: 'fraisAgence' },
    'acquisition.dateAchat':  { label: "Date d'achat",            sub: null,         key: 'dateAchat' },
    'acquisition.valeurEstimee': { label: 'Valeur estimée (€)',   sub: 'acquisition', key: 'valeurEstimee' },
    'acquisition.dateEstimation': { label: "Date d'estimation",   sub: 'acquisition', key: 'dateEstimation' },
    'credit.montant':         { label: 'Montant emprunté (€)',    sub: 'credit',     key: 'montant' },
    'credit.duree':           { label: 'Durée du crédit (ans)',   sub: 'credit',     key: 'duree' },
    'credit.taux':            { label: 'Taux (%)',                sub: 'credit',     key: 'taux' },
    'credit.assurance':       { label: 'Assurance (%/an)',        sub: 'credit',     key: 'assurance' },
    'charges.taxeFonciere':   { label: 'Taxe foncière (€/an)',    sub: 'postAchat',  key: 'taxeFonciere' },
    'charges.chargesCopro':   { label: 'Charges copro (€/mois)',  sub: 'postAchat',  key: 'chargesCopro' },
    'charges.assurancePNO':   { label: 'Assurance PNO (€/an)',    sub: 'postAchat',  key: 'assurancePNO' },
    'charges.gestionLocative': { label: 'Gestion locative (%)',   sub: 'postAchat',  key: 'gestionLocative' }
};
const DOSSIER_CONFIANCE_RANK = { haute: 3, moyenne: 2, basse: 1 };

// Fusionne les résultats d'extraction de plusieurs documents en un seul jeu de champs "bien".
// Règle : en cas de valeurs différentes pour le même champ, la confiance la plus haute gagne
// (égalité -> premier document traité dans l'ordre du tableau qui gagne). Chaque champ retenu
// garde sa provenance (fichier + confiance) pour affichage dans le tableau de revue. Les
// documents facture_travaux ne participent pas à cette fusion (traités à part, voir _extractDossierTravaux).
function _mergeDossierResults(rows) {
    const merged = {}; // path -> { value, source: filename, confiance }
    for (const row of rows) {
        if (row.status !== 'ok' || !row.result) continue;
        const { result, file } = row;
        const confRank = DOSSIER_CONFIANCE_RANK[result.confiance] || 1;
        for (const path of Object.keys(DOSSIER_FIELD_MAP)) {
            const [group, field] = path.split('.');
            const groupData = result[group];
            if (!groupData || groupData[field] === undefined) continue;
            const candidate = { value: groupData[field], source: file.name, confiance: result.confiance || 'basse' };
            const existing = merged[path];
            if (!existing || confRank > (DOSSIER_CONFIANCE_RANK[existing.confiance] || 1)) {
                merged[path] = candidate;
            }
        }
    }
    return merged;
}

// Extrait les lignes "travaux détectés" (documentType facture_travaux) des résultats — traitées
// séparément de la fusion de champs bien, une ligne par facture comme le batch Travaux existant.
function _extractDossierTravaux(rows) {
    return rows
        .filter(row => row.status === 'ok' && row.result?.documentType === 'facture_travaux' && row.result.travail)
        .map(row => ({
            file: row.file,
            date: row.result.travail.date || '',
            description: row.result.travail.description || '',
            montant: Number(row.result.travail.montant) || 0,
            tag: suggererNatureFrais(row.result.travail)
        }));
}
const FM_EXISTING_VISIBLE = 10;

// Description du frais enregistré : « Fournisseur — résumé ». Pas de champ fournisseur dédié sur
// le modèle travail (choix spec 2026-10-02 : visible et éditable partout sans toucher aux rendus
// Travaux/PDF/rapport/Assistant) ; pas de tiret orphelin si l'un des deux manque.
export function _buildFactureDescription(fournisseur, resume) {
    const f = String(fournisseur || '').trim(), r = String(resume || '').trim();
    return f && r ? `${f} — ${r}` : (r || f);
}

// Erreur `resource-exhausted` de la Cloud Function (rate-limit 30 lectures/h, functions/index.js).
function _isQuotaError(err) {
    return /resource-exhausted/.test(String(err?.code || err?.message || ''));
}

export async function openAjoutFacturesModal({ assetId = null, files = [], lockAsset = false } = {}) {
    const assets = getOrderedAssetList();
    if (!assets.length) {
        const empty = _showOwnedModal(`
            <div class="owned-modal owned-fm">
                <div class="owned-modal-head">
                    <h3 class="owned-modal-title">Ajouter des factures</h3>
                    <button class="btn btn--ghost" data-close-modal aria-label="Fermer">${icone('croix')}</button>
                </div>
                <div class="owned-fm__none">
                    <p>Crée d'abord un bien : les factures s'enregistrent sur un bien du portefeuille.</p>
                    <button type="button" class="btn btn--primary" data-fm-add-bien>Ajouter un bien</button>
                </div>
            </div>`, 'owned-factures-modal');
        empty.querySelector('[data-fm-add-bien]')?.addEventListener('click', () => { empty.hidden = true; openOwnedAddModal(); });
        return;
    }
    const lastUsed = state.facturesLastAsset;
    const initialId = [assetId, lastUsed, assets[0].id].find(id => id && assets.some(a => a.id === id));
    let currentAssetId = initialId;

    const TAG_OPTIONS = natureFraisOptionsHtml();

    const modal = _showOwnedModal(`
        <div class="owned-modal owned-modal--xwide owned-fm">
            <div class="owned-modal-head">
                <div>
                    <h3 class="owned-modal-title">Ajouter des factures</h3>
                    <div class="owned-modal-sub">Dépose, vérifie, valide — l'IA lit fournisseur, résumé, montant et date d'émission.</div>
                </div>
                <button class="btn btn--ghost" data-close-modal aria-label="Fermer">${icone('croix')}</button>
            </div>
            <label class="owned-fm__asset">
                <span class="variables-label">Bien</span>
                <select class="variables-input" data-fm-asset ${lockAsset ? 'disabled' : ''}>
                    ${assets.map(a => `<option value="${escapeHtml(a.id)}" ${a.id === initialId ? 'selected' : ''}>${escapeHtml(a.nom || a.id)}${a.ville ? ` · ${escapeHtml(a.ville)}` : ''}</option>`).join('')}
                </select>
            </label>
            <div class="owned-travaux-dropzone owned-fm__dropzone" data-fm-dropzone tabindex="0" role="button" aria-label="Déposer des factures">
                <input type="file" data-fm-file-input multiple accept="application/pdf,image/*" hidden>
                <input type="file" data-fm-folder-input webkitdirectory multiple hidden>
                <div class="owned-travaux-dropzone__icon">⤓</div>
                <div class="owned-travaux-dropzone__label">${IS_MOBILE_PAGE ? 'Prends une photo ou choisis des fichiers' : 'Glisse des fichiers ou un dossier entier'}</div>
                <div class="owned-travaux-dropzone__hint">PDF, JPG ou PNG — 8 Mo max par fichier</div>
                <div class="owned-fm__dropzone-actions">
                    <button type="button" class="btn btn--ghost btn--sm" data-fm-files-btn>Choisir des fichiers</button>
                    <button type="button" class="btn btn--ghost btn--sm" data-fm-folder-btn ${IS_MOBILE_PAGE ? 'hidden' : ''}>Choisir un dossier</button>
                </div>
            </div>
            <section class="owned-fm__section" data-fm-pending-section hidden>
                <div class="owned-fm__section-title">En cours d'ajout <span class="owned-fm__count" data-fm-pending-count></span></div>
                <div class="owned-fm__rows" data-fm-rows></div>
                <div class="owned-modal-actions">
                    <button type="button" class="btn btn--primary" data-fm-submit disabled>Ajouter</button>
                </div>
            </section>
            <details class="owned-fm__existing" data-fm-existing-details ${IS_MOBILE_PAGE ? '' : 'open'}>
                <summary>Déjà enregistrées sur ce bien <span class="owned-fm__count" data-fm-existing-count></span></summary>
                <div data-fm-existing></div>
            </details>
        </div>`, 'owned-factures-modal');
    modal.classList.add('owned-modal-overlay--fm');

    const q = sel => modal.querySelector(sel);
    const assetSelect = q('[data-fm-asset]');
    const dropzone = q('[data-fm-dropzone]');
    const fileInput = q('[data-fm-file-input]');
    const folderInput = q('[data-fm-folder-input]');
    const rowsEl = q('[data-fm-rows]');
    const pendingSection = q('[data-fm-pending-section]');
    const pendingCount = q('[data-fm-pending-count]');
    const submitBtn = q('[data-fm-submit]');
    const existingEl = q('[data-fm-existing]');
    const existingCount = q('[data-fm-existing-count]');

    const rows = [];           // { rid, file, imageFile, base64, mimeType, previewUrl, status, el, dupSeen }
    let ridSeq = 0;
    let existingExpanded = false;
    const objectUrls = new Set();
    const makeUrl = blob => { const u = URL.createObjectURL(blob); objectUrls.add(u); return u; };
    const releaseUrls = () => { objectUrls.forEach(u => URL.revokeObjectURL(u)); objectUrls.clear(); };

    // ─── Liste du bas : frais déjà enregistrés sur le bien sélectionné (tri date d'émission ↓) ───
    const renderExisting = () => {
        const asset = getOwnedAsset(currentAssetId);
        const travaux = [...(asset?.postAchat?.travaux || [])].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        if (existingCount) existingCount.textContent = travaux.length ? `(${travaux.length})` : '';
        if (!travaux.length) { existingEl.innerHTML = '<p class="owned-fm__empty">Aucun frais enregistré sur ce bien.</p>'; return; }
        const visible = existingExpanded ? travaux : travaux.slice(0, FM_EXISTING_VISIBLE);
        const hiddenCount = travaux.length - visible.length;
        existingEl.innerHTML = `
            <div class="owned-fm-existing__list">
                ${visible.map(t => `
                    <div class="owned-fm-existing__row" data-travail-id="${escapeHtml(t.id)}">
                        <span class="owned-fm-existing__date" data-fm-existing-date>${escapeHtml(_formatDateFr(t.date))}</span>
                        <span class="owned-fm-existing__desc" data-fm-existing-desc title="${escapeHtml(t.description || '')}">${escapeHtml(t.description || '—')}</span>
                        <span class="owned-fm-existing__montant" data-fm-existing-montant>${Math.round(t.montant || 0).toLocaleString('fr-FR')} €</span>
                        ${t.pdfFilename
                            ? `<button type="button" class="owned-fm-existing__preview" data-fm-existing-preview="${escapeHtml(t.pdfFilename)}" title="Voir la facture" aria-label="Voir la facture de ${escapeHtml(t.description || 'ce frais')}">${icone('document')}</button>`
                            : '<span class="owned-fm-existing__nopreview" aria-hidden="true">—</span>'}
                    </div>`).join('')}
            </div>
            ${hiddenCount > 0 ? `<button type="button" class="btn btn--ghost btn--sm owned-fm-existing__more" data-fm-existing-more>Voir les ${hiddenCount} autres</button>` : ''}`;
        existingEl.querySelector('[data-fm-existing-more]')?.addEventListener('click', () => { existingExpanded = true; renderExisting(); refreshDuplicates(); });
        existingEl.querySelectorAll('[data-fm-existing-preview]').forEach(btn => {
            btn.addEventListener('click', () => openDocumentPreview(currentAssetId, btn.dataset.fmExistingPreview));
        });
    };

    // ─── Lignes en cours : le DOM est la source de vérité des valeurs (éditables) ───
    const rowValues = row => ({
        fournisseur: row.el.querySelector('[data-fm-field="fournisseur"]').value.trim(),
        description: row.el.querySelector('[data-fm-field="description"]').value.trim(),
        montant: Number(row.el.querySelector('[data-fm-field="montant"]').value) || 0,
        date: row.el.querySelector('[data-fm-field="date"]').value,
        tag: row.el.querySelector('[data-fm-field="tag"]').value
    });
    const isComplete = v => !!(v.date && v.description && v.montant > 0);
    const rowCheck = row => row.el.querySelector('[data-fm-check]');
    const setStatus = (row, text, tone = '') => {
        const el = row.el.querySelector('[data-fm-status]');
        el.textContent = text;
        el.className = `owned-batch-status${tone ? ` owned-batch-status--${tone}` : ''}`;
    };

    const updateSubmit = () => {
        const eligible = rows.filter(r => r.status !== 'loading' && rowCheck(r).checked && isComplete(rowValues(r))).length;
        submitBtn.disabled = eligible === 0;
        submitBtn.textContent = eligible === 0 ? 'Ajouter' : eligible === 1 ? 'Ajouter 1 frais' : `Ajouter les ${eligible} frais`;
        pendingSection.hidden = rows.length === 0;
        pendingCount.textContent = rows.length ? `(${rows.length})` : '';
    };

    // Doublon : contre les frais DÉJÀ enregistrés sur le bien (findSimilarTravail, ±2 € / ±5 j),
    // jamais entre deux lignes en cours (deux factures du même montant le même jour restent un cas
    // légitime). Ligne décochée une seule fois par précaution (dupSeen) — l'utilisateur peut la
    // recocher sans qu'on la décoche à nouveau ; la ligne existante correspondante est surlignée.
    const refreshDuplicates = () => {
        existingEl.querySelectorAll('.owned-fm-existing__row--dup').forEach(el => el.classList.remove('owned-fm-existing__row--dup'));
        const asset = getOwnedAsset(currentAssetId);
        for (const row of rows) {
            const dupEl = row.el.querySelector('[data-fm-dup]');
            const v = rowValues(row);
            const doublon = asset && v.montant > 0 && v.date ? findSimilarTravail(asset, { montant: v.montant, date: v.date }) : null;
            // Taxe foncière déjà dans les charges (B9) : même bandeau, mais la ligne reste cochée.
            const alerteTF = alerteDoublonTaxeFonciere(asset, v);
            const messages = [];
            if (doublon) {
                messages.push(`Doublon probable : « ${doublon.description || 'sans description'} » du ${_formatDateFr(doublon.date)} (${Math.round(doublon.montant).toLocaleString('fr-FR')} €) — décoché par précaution`);
                existingEl.querySelector(`[data-travail-id="${CSS.escape(doublon.id)}"]`)?.classList.add('owned-fm-existing__row--dup');
                if (!row.dupSeen) { row.dupSeen = true; rowCheck(row).checked = false; }
            }
            if (alerteTF) messages.push(alerteTF);
            dupEl.hidden = messages.length === 0;
            dupEl.replaceChildren(...messages.map(m => { const d = document.createElement('div'); definirTexteAvecIcone(d, 'alerte', m); return d; }));
        }
        updateSubmit();
    };

    const fillRow = (row, result) => {
        const set = (field, value) => {
            const input = row.el.querySelector(`[data-fm-field="${field}"]`);
            input.value = value;
            input.classList.toggle('ai-filled', value !== '' && value !== 0);
        };
        set('fournisseur', result.fournisseur || '');
        set('description', result.description || '');
        set('montant', result.montant > 0 ? result.montant : '');
        set('date', result.date || '');
        row.el.querySelector('[data-fm-field="tag"]').value = suggererNatureFrais(result);
    };

    const extractRow = async row => {
        row.status = 'loading';
        row.el.classList.add('owned-fm-row--loading');
        row.el.querySelector('[data-fm-retry]').hidden = true;
        setStatus(row, 'Lecture…');
        updateSubmit();
        try {
            if (!row.base64) {
                const prepared = await _prepareFactureImage(row.file);
                row.imageFile = prepared.imageFile;
                row.base64 = prepared.base64;
                row.mimeType = prepared.mimeType;
                const thumb = row.el.querySelector('[data-fm-thumb]');
                if (thumb.hidden) {
                    thumb.src = makeUrl(row.imageFile);
                    thumb.hidden = false;
                    row.el.querySelector('[data-fm-thumb-icon]').hidden = true;
                }
            }
            const result = await cloudExtraireFraisFacture(row.base64, row.mimeType);
            fillRow(row, result);
            row.status = 'ok';
            const complete = isComplete(rowValues(row));
            setStatus(row, complete ? 'Lu par l\'IA — vérifie avant d\'ajouter' : 'À compléter (date, résumé, montant)', complete ? 'ok' : '');
            rowCheck(row).checked = complete;
        } catch (err) {
            row.status = 'error';
            rowCheck(row).checked = false;
            row.el.querySelector('[data-fm-retry]').hidden = false;
            setStatus(row, _isQuotaError(err)
                ? 'Quota IA atteint — réessaie dans une heure, ou complète à la main'
                : 'Lecture impossible — complète à la main', 'error');
        }
        row.el.classList.remove('owned-fm-row--loading');
        refreshDuplicates();
    };

    const removeRow = row => {
        const i = rows.indexOf(row);
        if (i >= 0) rows.splice(i, 1);
        row.el.remove();
        refreshDuplicates();
    };

    const addRow = file => {
        const rid = `fm-${++ridSeq}`;
        const el = document.createElement('div');
        el.className = 'owned-fm-row';
        el.dataset.fmRow = rid;
        const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
        el.innerHTML = `
            <input type="checkbox" class="owned-fm-row__check" data-fm-check aria-label="Inclure ${escapeHtml(file.name)}">
            <button type="button" class="owned-fm-row__thumb" data-fm-preview title="Aperçu de la facture" aria-label="Aperçu de ${escapeHtml(file.name)}">
                <img data-fm-thumb alt="" hidden>
                <span data-fm-thumb-icon aria-hidden="true">${icone(isPdf ? 'document' : 'image')}</span>
            </button>
            <div class="owned-fm-row__main">
                <div class="owned-fm-row__line">
                    <input type="text" class="variables-input" data-fm-field="fournisseur" placeholder="Fournisseur" aria-label="Fournisseur">
                    <input type="number" class="variables-input owned-fm-row__montant" data-fm-field="montant" placeholder="Montant €" min="0" step="0.01" aria-label="Montant">
                </div>
                <div class="owned-fm-row__line">
                    <input type="text" class="variables-input" data-fm-field="description" placeholder="Résumé (ex : peinture salon)" aria-label="Résumé">
                    <label class="owned-fm-row__date">émise le <input type="date" class="variables-input" data-fm-field="date" aria-label="Date d'émission"></label>
                    <select class="variables-input" data-fm-field="tag" aria-label="Nature fiscale">${TAG_OPTIONS}</select>
                </div>
                <div class="owned-fm-row__meta">
                    <span class="owned-fm-row__file" data-fm-filename title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>
                    <span class="owned-batch-status" data-fm-status>Lecture…</span>
                    <button type="button" class="owned-fm-row__retry" data-fm-retry hidden>Relire</button>
                </div>
                <div class="owned-batch-duplicate" data-fm-dup hidden></div>
            </div>
            <div class="owned-fm-row__tools">
                <button type="button" data-fm-remove title="Retirer de la liste" aria-label="Retirer ${escapeHtml(file.name)}">${icone('croix')}</button>
            </div>`;
        rowsEl.appendChild(el);
        const row = { rid, file, imageFile: null, base64: null, mimeType: null, previewUrl: null, status: 'loading', el, dupSeen: false };
        rows.push(row);
        if (!isPdf) {
            const thumb = el.querySelector('[data-fm-thumb]');
            thumb.src = makeUrl(file);
            thumb.hidden = false;
            el.querySelector('[data-fm-thumb-icon]').hidden = true;
        }
        el.querySelector('[data-fm-check]').addEventListener('change', updateSubmit);
        ['montant', 'date', 'tag', 'fournisseur'].forEach(f => el.querySelector(`[data-fm-field="${f}"]`).addEventListener('change', refreshDuplicates));
        el.querySelector('[data-fm-field="description"]').addEventListener('change', refreshDuplicates);
        el.querySelector('[data-fm-retry]').addEventListener('click', () => extractRow(row));
        el.querySelector('[data-fm-remove]').addEventListener('click', () => removeRow(row));
        el.querySelector('[data-fm-preview]').addEventListener('click', () => {
            if (!row.previewUrl) row.previewUrl = makeUrl(row.file);
            openDocumentPreview(null, row.file.name, { url: row.previewUrl });
        });
        return row;
    };

    const addFiles = async incoming => {
        const { accepted, rejectedFormat, rejectedSize, truncated } = _filterFactureFiles(incoming);
        const notes = [];
        if (rejectedFormat.length) notes.push(`${rejectedFormat.length} fichier${rejectedFormat.length > 1 ? 's' : ''} ignoré${rejectedFormat.length > 1 ? 's' : ''} (format non supporté)`);
        if (rejectedSize.length) notes.push(`${rejectedSize.length} fichier${rejectedSize.length > 1 ? 's' : ''} ignoré${rejectedSize.length > 1 ? 's' : ''} (plus de 8 Mo)`);
        if (truncated) notes.push(`seuls les ${FM_MAX_FILES_PER_DROP} premiers fichiers ont été pris`);
        if (notes.length) showToast(notes.join(' · '), 'negative');
        if (!accepted.length) return;
        const newRows = accepted.map(addRow);
        updateSubmit();
        await _runWithConcurrencyLimit(newRows, 3, extractRow);
    };

    // ─── Validation : upload de l'original + addOwnedTravail par ligne cochée et complète ───
    submitBtn.addEventListener('click', async () => {
        const asset = getOwnedAsset(currentAssetId);
        if (!asset) { showToast('Ce bien n\'existe plus', 'negative'); return; }
        const toAdd = rows.filter(r => r.status !== 'loading' && rowCheck(r).checked && isComplete(rowValues(r)));
        if (!toAdd.length) return;
        submitBtn.disabled = true;
        submitBtn.textContent = 'Ajout en cours…';
        let added = 0, failed = 0;
        for (const row of toAdd) {
            const v = rowValues(row);
            let pdfFilename = null;
            try {
                pdfFilename = await uploadOwnedDocument(currentAssetId, row.file);
            } catch {
                failed++;
                setStatus(row, 'Échec de l\'envoi du fichier — réessaie', 'error');
                continue;
            }
            addOwnedTravail(currentAssetId, {
                date: v.date,
                description: _buildFactureDescription(v.fournisseur, v.description),
                montant: v.montant,
                tag: v.tag,
                commentaire: '',
                pdfFilename,
                financeParCredit: false
            });
            added++;
            const i = rows.indexOf(row);
            if (i >= 0) rows.splice(i, 1);
            row.el.remove();
        }
        state.facturesLastAsset = currentAssetId; savePref({ facturesLastAsset: currentAssetId }).catch(() => {});
        if (added) showToast(`${added} frais ajouté${added > 1 ? 's' : ''} à ${asset.nom || 'ce bien'}${failed ? ` — ${failed} en échec` : ''}`, failed ? 'negative' : 'positive');
        else if (failed) showToast('Aucun frais ajouté — échec de l\'envoi des fichiers', 'negative');
        renderExisting();
        refreshDuplicates();
        _refreshAfterFacturesAdd(currentAssetId);
    });

    // ─── Dépôt ───
    const openFilePicker = () => fileInput.click();
    dropzone.addEventListener('click', openFilePicker);
    dropzone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFilePicker(); } });
    q('[data-fm-files-btn]').addEventListener('click', e => { e.stopPropagation(); openFilePicker(); });
    q('[data-fm-folder-btn]').addEventListener('click', e => { e.stopPropagation(); folderInput.click(); });
    dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('owned-travaux-dropzone--dragover'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('owned-travaux-dropzone--dragover'));
    dropzone.addEventListener('drop', e => {
        e.preventDefault();
        dropzone.classList.remove('owned-travaux-dropzone--dragover');
        _collectDroppedFiles(e.dataTransfer).then(addFiles).catch(() => showToast('Lecture du dossier impossible', 'negative'));
    });
    fileInput.addEventListener('change', () => { addFiles(Array.from(fileInput.files || [])); fileInput.value = ''; });
    folderInput.addEventListener('change', () => { addFiles(Array.from(folderInput.files || [])); folderInput.value = ''; });

    assetSelect.addEventListener('change', () => {
        currentAssetId = assetSelect.value;
        state.facturesLastAsset = currentAssetId; savePref({ facturesLastAsset: currentAssetId }).catch(() => {});
        rows.forEach(r => { r.dupSeen = false; });
        existingExpanded = false;
        renderExisting();
        refreshDuplicates();
    });

    // Libère les URL blob à la fermeture (✕, clic hors modale, Échap). L'overlay est réutilisé
    // par _showOwnedModal d'une ouverture à l'autre : on observe l'attribut hidden plutôt qu'un
    // événement dédié, et l'observateur se détache dès la première fermeture.
    const observer = new MutationObserver(() => {
        if (modal.hidden) { releaseUrls(); observer.disconnect(); }
    });
    observer.observe(modal, { attributes: true, attributeFilter: ['hidden'] });

    renderExisting();
    updateSubmit();
    if (files.length) addFiles(Array.from(files));
}

// ─── IMPORT DE DOSSIER BIEN ────────────────────────────────────────────────────────────────
// PC uniquement (voir bouton d'entrée, gate IS_MOBILE_PAGE). `existingAssetId` = null pour un
// nouveau bien (pas encore créé — création différée à la validation), sinon l'id du bien à
// compléter. Voir spec docs/superpowers/specs/2026-09-22-import-dossier-bien.md.
export async function openImportDossierModal(existingAssetId) {
    const existingAsset = existingAssetId ? getOwnedAsset(existingAssetId) : null;

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.webkitdirectory = true;
    fileInput.multiple = true;
    fileInput.hidden = true;
    document.body.appendChild(fileInput);

    const allFiles = await new Promise(resolve => {
        fileInput.addEventListener('change', () => resolve(Array.from(fileInput.files || [])), { once: true });
        fileInput.click();
    });
    fileInput.remove();

    const files = allFiles.filter(f => DOSSIER_ACCEPTED_EXT.test(f.name));
    if (files.length === 0) {
        if (allFiles.length > 0) showToast('Aucun PDF/JPG/PNG trouvé dans ce dossier', 'negative');
        return;
    }

    const modal = _showOwnedModal(`
        <div class="owned-modal owned-modal--xwide">
            <div class="owned-modal-head">
                <div>
                    <h3 class="owned-modal-title">Import de dossier — ${files.length} document${files.length > 1 ? 's' : ''}</h3>
                    <div class="owned-modal-sub" data-dossier-progress>Analyse en cours… 0 / ${files.length}</div>
                </div>
                <button class="btn btn--ghost" data-close-modal aria-label="Fermer">${icone('croix')}</button>
            </div>
            <div data-dossier-body>
                <p style="font-size:.82rem;color:var(--text-tertiary);font-style:italic">Lecture des documents…</p>
            </div>
            <div class="owned-modal-actions">
                <button type="button" class="btn btn--ghost" data-close-modal>Annuler</button>
                <button type="button" class="btn btn--primary" data-dossier-submit disabled>Valider l'import</button>
            </div>
        </div>
    `, 'owned-dossier-import-modal');

    const progressEl = modal.querySelector('[data-dossier-progress]');
    const bodyEl = modal.querySelector('[data-dossier-body]');
    const submitBtn = modal.querySelector('[data-dossier-submit]');

    // ─── Conversion PDF -> PNG puis extraction IA (concurrence limitée à 3, même pattern que
    // le batch Travaux) ────────────────────────────────────────────────────────────────────
    const prepared = await _prepareDossierFiles(files);
    const rows = prepared.map((p, idx) => ({
        idx, file: p.original, imageFile: p.imageFile,
        status: p.conversionError ? 'error' : 'loading',
        errorReason: p.conversionError,
        result: null
    }));

    let doneCount = rows.filter(r => r.status === 'error').length;
    const updateProgress = () => {
        progressEl.textContent = doneCount < files.length
            ? `Analyse en cours… ${doneCount} / ${files.length}`
            : `Analyse terminée — vérifie les champs avant de valider`;
    };
    updateProgress();

    await _runWithConcurrencyLimit(rows.filter(r => r.status !== 'error'), 3, async row => {
        try {
            const base64 = await _fileToBase64(row.imageFile);
            row.result = await cloudExtraireDossierBien(base64, row.imageFile.type);
            row.status = 'ok';
        } catch (err) {
            row.status = 'error';
            row.errorReason = err?.message === 'resource-exhausted'
                ? 'Limite horaire atteinte, réessayez plus tard'
                : 'Extraction impossible';
        }
        doneCount++;
        updateProgress();
    });

    // ─── Fusion + rendu du tableau de revue ───────────────────────────────────────────────
    const merged = _mergeDossierResults(rows);
    const travauxRows = _extractDossierTravaux(rows);
    const failedRows = rows.filter(r => r.status === 'error');

    const currentValueOf = (sub, key) => {
        if (!existingAsset) return null;
        const src = sub === null ? existingAsset : (sub === 'acquisition' ? existingAsset.acquisition : sub === 'credit' ? existingAsset.acquisition?.credit : existingAsset.postAchat);
        const v = src?.[key];
        return (v !== undefined && v !== null && v !== '' && v !== 0) ? v : null;
    };

    const bienFieldsHtml = Object.entries(DOSSIER_FIELD_MAP).map(([path, meta]) => {
        const found = merged[path];
        if (!found) return '';
        const current = currentValueOf(meta.sub, meta.key);
        return `
        <tr data-dossier-field-row="${escapeHtml(path)}">
            <td><input type="checkbox" data-dossier-field-check="${escapeHtml(path)}" checked ${current !== null ? 'data-has-current="1"' : ''}></td>
            <td>${escapeHtml(meta.label)}</td>
            <td><input type="text" class="variables-input" data-dossier-field-value="${escapeHtml(path)}" value="${escapeHtml(String(found.value))}"></td>
            <td>
                <span class="owned-caveat">${escapeHtml(found.source)} — confiance ${escapeHtml(found.confiance)}</span>
                ${current !== null ? `<br><span class="owned-caveat" style="color:var(--warning, #d97706)">valeur actuelle : ${escapeHtml(String(current))}</span>` : ''}
            </td>
        </tr>`;
    }).join('');

    // Un doublon ne peut se comparer qu'à des travaux DÉJÀ enregistrés sur un bien EXISTANT — un
    // nouveau bien (existingAsset null, import qui crée le bien) n'a par définition aucun travail
    // préexistant à rapprocher.
    const travauxRowsHtml = travauxRows.map((t, idx) => {
        const doublon = existingAsset ? findSimilarTravail(existingAsset, { montant: t.montant, date: t.date }) : null;
        const alerteTF = alerteDoublonTaxeFonciere(existingAsset, t);
        return `
        <tr>
            <td><input type="checkbox" data-dossier-travail-check="${idx}" checked></td>
            <td class="owned-batch-filename">
                ${icone('document')} ${escapeHtml(t.file.name)}
                ${doublon ? `<div class="owned-batch-duplicate">${icone('alerte')} Possible doublon : « ${escapeHtml(doublon.description || 'sans description')} » du ${escapeHtml(_formatDateFr(doublon.date))}</div>` : ''}
                ${alerteTF ? `<div class="owned-batch-duplicate">${icone('alerte')} ${escapeHtml(alerteTF)}</div>` : ''}
            </td>
            <td><input type="date" class="variables-input" data-dossier-travail-field="date" data-idx="${idx}" value="${escapeHtml(t.date)}"></td>
            <td><input type="text" class="variables-input" data-dossier-travail-field="description" data-idx="${idx}" value="${escapeHtml(t.description)}"></td>
            <td><input type="number" class="variables-input" data-dossier-travail-field="montant" data-idx="${idx}" min="0" value="${t.montant || ''}"></td>
            <td>
                <select class="variables-input" data-dossier-travail-field="tag" data-idx="${idx}">
                    ${natureFraisOptionsHtml(t.tag)}
                </select>
            </td>
        </tr>`;
    }).join('');

    const failedHtml = failedRows.map(r => `
        <div class="owned-batch-filename">${icone('document')} ${escapeHtml(r.file.name)} — <span class="owned-caveat" style="color:#ef4444">${escapeHtml(r.errorReason || 'échec')}</span></div>
    `).join('');

    bodyEl.innerHTML = `
        ${Object.keys(merged).length ? `
        <div class="owned-section-title">Bien</div>
        <div class="owned-batch-table-wrap">
            <table class="owned-batch-table">
                <thead><tr><th></th><th>Champ</th><th>Valeur</th><th>Provenance</th></tr></thead>
                <tbody>${bienFieldsHtml}</tbody>
            </table>
        </div>` : '<p style="font-size:.82rem;color:var(--text-tertiary);font-style:italic">Aucune information de bien détectée dans ce dossier.</p>'}

        ${travauxRows.length ? `
        <div class="owned-section-title" style="margin-top:20px">Travaux détectés</div>
        <div class="owned-batch-table-wrap">
            <table class="owned-batch-table">
                <thead><tr><th></th><th>Fichier</th><th>Date</th><th>Description</th><th>Montant</th><th>Tag</th></tr></thead>
                <tbody>${travauxRowsHtml}</tbody>
            </table>
        </div>` : ''}

        ${failedRows.length ? `
        <details class="owned-travaux-year" style="margin-top:20px">
            <summary class="owned-travaux-year__summary"><span>Non traités (${failedRows.length})</span></summary>
            <div class="owned-travaux-list">${failedHtml}</div>
        </details>` : ''}
    `;

    submitBtn.disabled = Object.keys(merged).length === 0 && travauxRows.length === 0;

    submitBtn.addEventListener('click', async () => {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Import en cours…';

        let assetId = existingAssetId;
        if (!assetId) {
            const villeField = modal.querySelector('[data-dossier-field-value="bien.ville"]');
            const nom = villeField?.value ? `Bien ${villeField.value}` : `Nouveau bien ${new Date().toLocaleDateString('fr-FR')}`;
            const asset = createOwnedAsset(nom, villeField?.value || '');
            assetId = asset.id;
        }

        const acqPatch = {}, creditPatch = {}, postAchatPatch = {}, assetPatch = {};
        modal.querySelectorAll('[data-dossier-field-check]:checked').forEach(cb => {
            const path = cb.dataset.dossierFieldCheck;
            const meta = DOSSIER_FIELD_MAP[path];
            const valueInput = modal.querySelector(`[data-dossier-field-value="${path}"]`);
            if (!meta || !valueInput || !valueInput.value.trim()) return;
            const raw = valueInput.value.trim();
            const isNumeric = !['adresse', 'ville', 'codePostal', 'dateAchat', 'dateEstimation', 'typeBien'].includes(meta.key);
            const value = isNumeric ? (Number(raw) || 0) : raw;
            if (meta.sub === 'acquisition') acqPatch[meta.key] = value;
            else if (meta.sub === 'credit') creditPatch[meta.key] = value;
            else if (meta.sub === 'postAchat') postAchatPatch[meta.key] = value;
            else assetPatch[meta.key] = value;
        });

        if (Object.keys(assetPatch).length) updateOwnedAsset(assetId, assetPatch);
        if (Object.keys(acqPatch).length) updateOwnedAcquisition(assetId, acqPatch);
        if (Object.keys(creditPatch).length) updateOwnedCredit(assetId, creditPatch);
        if (Object.keys(postAchatPatch).length) updateOwnedPostAchat(assetId, postAchatPatch);

        let travauxAdded = 0;
        for (let idx = 0; idx < travauxRows.length; idx++) {
            const checked = modal.querySelector(`[data-dossier-travail-check="${idx}"]`)?.checked;
            if (!checked) continue;
            const date = modal.querySelector(`[data-dossier-travail-field="date"][data-idx="${idx}"]`)?.value;
            const description = modal.querySelector(`[data-dossier-travail-field="description"][data-idx="${idx}"]`)?.value.trim();
            const montant = Number(modal.querySelector(`[data-dossier-travail-field="montant"][data-idx="${idx}"]`)?.value);
            const tag = modal.querySelector(`[data-dossier-travail-field="tag"][data-idx="${idx}"]`)?.value;
            if (!date || !description || !montant) continue;
            let pdfFilename = null;
            try {
                pdfFilename = await uploadOwnedDocument(assetId, travauxRows[idx].file);
            } catch { /* justificatif optionnel, on continue sans */ }
            addOwnedTravail(assetId, { date, description, montant, tag, commentaire: '', pdfFilename, financeParCredit: false });
            travauxAdded++;
        }

        modal.hidden = true;
        showToast(`Import du dossier terminé — bien mis à jour${travauxAdded ? `, ${travauxAdded} frais ajoutés` : ''}`);

        if (!existingAssetId) {
            openOwnedDetail(assetId);
        } else {
            const fresh = getOwnedAsset(assetId);
            renderAccordionAcquisition(fresh);
            renderAccordionPostAchat(fresh);
            renderOwnedTravauxTab(fresh);
            renderOwnedSynthese(fresh);
            renderOwnedCalculTab(fresh);
            renderAccordionSimulateur(fresh);
        }
    });
}
