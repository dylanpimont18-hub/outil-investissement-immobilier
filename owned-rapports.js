// Rapports du portefeuille biens détenus (découpage d'owned-portfolio.js, audit T7) : dossier bancaire (PDF multi-biens,
// assistant en deux étapes), rapport d'un bien (aperçu → PDF / .md) et rapport annuel du portefeuille. Déplacé tel quel :
// aucun changement de comportement. Les données viennent de rapport-bien.js / rapport-annuel.js / pdf.js (modules purs).

import { parseDateAchat } from './calculs.js';
import { icone } from './icones.js';
import { state } from './owned-contexte.js';
import { escapeHtml, showToast, openPrintDocument } from './utils.js';
import { buildBankDossierPrintDocument } from './pdf.js';
import { buildAssetReportData, buildAssetReportHTML, buildAssetReportMarkdown, assetReportMarkdownFilename } from './rapport-bien.js';
import { buildRapportAnnuelData, buildRapportAnnuelTexte } from './rapport-annuel.js';
import { _copyText, _downloadOrShareFile, _showOwnedModal } from './owned-outils.js';
import { getOrderedAssetList, getOwnedAsset, getOwnedRegime, getOwnedTmi, loadOwnedAssets } from './owned-donnees.js';

// ─── DOSSIER BANCAIRE (PDF multi-biens) ─────────────────────────────────────
// Voir docs/superpowers/specs/2026-09-22-pdf-dossier-bancaire.md. Modale en 2 écrans : biens +
// blocs de contenu à inclure (écran 1), puis surbrillance des indicateurs individuels parmi les
// blocs cochés (écran 2, même sélection appliquée à tous les biens). buildBankDossierPrintDocument
// (pdf.js) fait tout le calcul/rendu HTML ; ce module ne fait que collecter la sélection utilisateur.

const BANK_DOSSIER_SECTION_DEFS = [
    { key: 'donnees', label: 'Données du bien', detail: 'Adresse, prix, surface, date d\'achat, valeur estimée' },
    { key: 'indicateurs', label: 'Indicateurs clés', detail: 'Mensualité, investissement total, CF, rendement, DSCR, patrimoine net' },
    { key: 'credit', label: 'Crédit & fiscalité', detail: 'Comparatif des 3 régimes + projection graphique et tableau des flux de trésorerie (10 ans)' },
];

// Même liste que BANK_DOSSIER_METRIC_DEFS dans pdf.js (dupliquée volontairement : ce module ne doit
// pas dépendre du détail interne de la fonction de rendu PDF pour construire son propre formulaire).
const BANK_DOSSIER_INDICATEUR_DEFS = [
    { key: 'mensualiteTotale', label: 'Mensualité crédit', section: 'indicateurs' },
    { key: 'investissementTotal', label: 'Investissement total', section: 'indicateurs' },
    { key: 'cfAvantImpot', label: 'CF avant impôt', section: 'indicateurs' },
    { key: 'cfNetNet', label: 'CF après impôt', section: 'indicateurs' },
    { key: 'rentaBrute', label: 'Rendement brut', section: 'indicateurs' },
    { key: 'dscr', label: 'DSCR', section: 'indicateurs' },
    { key: 'patrimoineNet', label: 'Patrimoine net', section: 'indicateurs' },
    { key: 'regimeOptimal', label: 'Régime optimal', section: 'credit' },
];

export function openBankDossierModal(startAssetId) {
    const assets = Object.values(loadOwnedAssets());
    const assetsHTML = assets.map(a => `
        <label class="owned-bank-dossier__asset-row">
            <input type="checkbox" data-bank-asset="${escapeHtml(a.id)}" ${a.id === startAssetId ? 'checked' : ''}>
            <span>${escapeHtml(a.nom || 'Bien sans nom')}</span>
            <span class="owned-bank-dossier__asset-ville">${escapeHtml(a.ville || '')}</span>
        </label>
    `).join('');

    const sectionsHTML = BANK_DOSSIER_SECTION_DEFS.map(s => `
        <label class="owned-bank-dossier__section-row">
            <input type="checkbox" data-bank-section="${s.key}" checked>
            <span>
                <strong>${escapeHtml(s.label)}</strong>
                <small>${escapeHtml(s.detail)}</small>
            </span>
        </label>
    `).join('');

    const modal = _showOwnedModal(`
        <div class="owned-modal owned-modal--wide owned-bank-dossier-modal">
            <div class="owned-modal-head">
                <h3 class="owned-modal-title">Dossier bancaire</h3>
                <button class="btn btn--ghost" data-close-modal aria-label="Fermer">${icone('croix')}</button>
            </div>
            <div class="cr-section">
                <div class="owned-bank-dossier__step-label">Étape 1/2 — Biens et contenu</div>
                <div class="owned-bank-dossier__group">
                    <div class="owned-bank-dossier__group-title">Biens à inclure</div>
                    ${assetsHTML || '<p style="color:var(--text-tertiary)">Aucun bien dans le portefeuille.</p>'}
                </div>
                <div class="owned-bank-dossier__group">
                    <div class="owned-bank-dossier__group-title">Contenu à inclure</div>
                    ${sectionsHTML}
                </div>
            </div>
            <div class="owned-modal-actions">
                <button class="btn btn--ghost" data-close-modal>Annuler</button>
                <button class="btn btn--primary" id="bank-dossier-next" ${assets.length ? '' : 'disabled'}>Suivant ${icone('fleche-droite')}</button>
            </div>
        </div>
    `, 'owned-bank-dossier-modal');

    modal.querySelector('#bank-dossier-next')?.addEventListener('click', () => {
        const selectedAssetIds = Array.from(modal.querySelectorAll('[data-bank-asset]:checked')).map(el => el.dataset.bankAsset);
        const sections = Object.fromEntries(
            BANK_DOSSIER_SECTION_DEFS.map(s => [s.key, !!modal.querySelector(`[data-bank-section="${s.key}"]`)?.checked])
        );
        if (!selectedAssetIds.length) { showToast('Sélectionnez au moins un bien', 'negative'); return; }
        if (!Object.values(sections).some(Boolean)) { showToast('Sélectionnez au moins un bloc de contenu', 'negative'); return; }
        openBankDossierHighlightStep(selectedAssetIds, sections);
    });
}

function openBankDossierHighlightStep(selectedAssetIds, sections) {
    const applicableIndicateurs = BANK_DOSSIER_INDICATEUR_DEFS.filter(i => sections[i.section]);
    const rowsHTML = applicableIndicateurs.map(i => `
        <label class="owned-bank-dossier__highlight-row">
            <input type="checkbox" data-bank-highlight="${i.key}">
            <span>${escapeHtml(i.label)}</span>
        </label>
    `).join('');

    const modal = _showOwnedModal(`
        <div class="owned-modal owned-modal--wide owned-bank-dossier-modal">
            <div class="owned-modal-head">
                <h3 class="owned-modal-title">Dossier bancaire</h3>
                <button class="btn btn--ghost" data-close-modal aria-label="Fermer">${icone('croix')}</button>
            </div>
            <div class="cr-section">
                <div class="owned-bank-dossier__step-label">Étape 2/2 — Mise en surbrillance</div>
                <p style="font-size:.85rem;color:var(--text-tertiary);margin-bottom:12px">
                    Les indicateurs cochés seront mis en avant visuellement dans le PDF, sur chaque bien du dossier.
                </p>
                <div class="owned-bank-dossier__group">
                    ${rowsHTML || '<p style="color:var(--text-tertiary)">Aucun indicateur disponible avec le contenu sélectionné.</p>'}
                </div>
            </div>
            <div class="owned-modal-actions">
                <button class="btn btn--ghost" id="bank-dossier-back">${icone('fleche-gauche')} Retour</button>
                <button class="btn btn--primary" id="bank-dossier-generate">Générer le PDF</button>
            </div>
        </div>
    `, 'owned-bank-dossier-modal');

    modal.querySelector('#bank-dossier-back')?.addEventListener('click', () => {
        openBankDossierModal(selectedAssetIds[0]);
        // Ré-ouvrir l'écran 1 réinitialise les cases à leur défaut (tout coché) — cohérent avec le
        // choix produit de ne pas persister la sélection entre deux ouvertures (voir spec).
    });

    modal.querySelector('#bank-dossier-generate')?.addEventListener('click', async () => {
        const highlights = new Set(
            Array.from(modal.querySelectorAll('[data-bank-highlight]:checked')).map(el => el.dataset.bankHighlight)
        );
        modal.hidden = true;
        await _generateBankDossierPdf(selectedAssetIds, sections, highlights);
    });
}

async function _generateBankDossierPdf(selectedAssetIds, sections, highlights) {
    const assets = selectedAssetIds.map(id => getOwnedAsset(id)).filter(Boolean);
    if (!assets.length) { showToast('Aucun bien sélectionné', 'negative'); return; }
    const { documentHTML, filename } = buildBankDossierPrintDocument({
        assets,
        allAssets: getOrderedAssetList(),
        sections,
        highlights,
        profileData: state.profileData,
        regime: getOwnedRegime(),
    });
    await openPrintDocument(documentHTML, filename, 'owned-bank-dossier-btn');
}

// ─── RAPPORT D'UN BIEN (aperçu → PDF / .md) ──────────────────────────────────
// Contenu construit par rapport-bien.js (module pur). Aperçu plein écran dans une iframe, puis :
//  - PDF : openPrintDocument (utils.js) — impression de la page avec le seul rapport visible
//          (PC : « Enregistrer en PDF » ; iPhone : Partager → Enregistrer dans Fichiers) ;
//  - .md : téléchargement (PC) ou feuille de partage iOS (écran tactile — un lien blob ne marche
//          pas en mode « écran d'accueil ») via _downloadOrShareFile ;
//  - Copier : presse-papiers, pour coller directement dans une IA.

export function openAssetReportPreview(assetId) {
    const asset = getOwnedAsset(assetId);
    if (!asset) return;
    const data = buildAssetReportData(asset, { profileData: state.profileData, regime: getOwnedRegime() });
    const report = buildAssetReportHTML(data);
    const markdown = buildAssetReportMarkdown(data);
    const mdFilename = assetReportMarkdownFilename(data);

    document.getElementById('asset-report-overlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'asset-report-overlay';
    overlay.className = 'asset-report-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', `Rapport — ${data.bien.nom}`);
    overlay.innerHTML = `
        <div class="asset-report-toolbar">
            <span class="asset-report-toolbar__title">Rapport — ${escapeHtml(data.bien.nom)}</span>
            <div class="asset-report-toolbar__actions">
                <button type="button" class="btn btn--primary btn--sm" id="asset-report-pdf">Télécharger le PDF</button>
                <button type="button" class="btn btn--ghost btn--sm" id="asset-report-md">Exporter .md</button>
                <button type="button" class="btn btn--ghost btn--sm" id="asset-report-copy">Copier</button>
            </div>
            <button type="button" class="asset-report-toolbar__close" id="asset-report-close" aria-label="Fermer l'aperçu">${icone('croix')}</button>
        </div>
        <iframe class="asset-report-frame" title="Aperçu du rapport"></iframe>`;
    document.body.appendChild(overlay);
    document.body.classList.add('asset-report-open');
    overlay.querySelector('iframe').srcdoc = report.documentHTML;

    const close = () => {
        overlay.remove();
        document.body.classList.remove('asset-report-open');
        document.removeEventListener('keydown', onKey);
    };
    // Échap : un clic dans l'aperçu donne le focus à l'iframe, dont les touches ne remontent pas au
    // document parent — l'overlay restait alors ouvert et captait les clics. On écoute donc aussi le
    // document de l'iframe (srcdoc = même origine) et on place le focus sur la croix à l'ouverture.
    const onKey = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    const frame = overlay.querySelector('iframe');
    frame.addEventListener('load', () => {
        try { frame.contentDocument?.addEventListener('keydown', onKey); } catch { /* origine différente : ignoré */ }
    });
    overlay.querySelector('#asset-report-close').addEventListener('click', close);
    overlay.querySelector('#asset-report-close').focus();

    overlay.querySelector('#asset-report-pdf').addEventListener('click', () => {
        openPrintDocument(report.documentHTML, report.filename, 'asset-report-pdf');
    });
    overlay.querySelector('#asset-report-md').addEventListener('click', () => exportAssetReportMarkdown(markdown, mdFilename, data.bien.nom));
    overlay.querySelector('#asset-report-copy').addEventListener('click', async () => {
        const ok = await _copyText(markdown);
        showToast(ok ? 'Rapport copié — collez-le dans votre IA' : 'Copie impossible, utilisez Exporter .md', ok ? 'positive' : 'negative');
    });
}

async function exportAssetReportMarkdown(markdown, filename, nomBien) {
    await _downloadOrShareFile(new File([markdown], filename, { type: 'text/markdown' }), `Rapport — ${nomBien}`);
}

// ─── RAPPORT ANNUEL ────────────────────────────────────────────────────────────

export function openRapportAnnuelModal() {
    const assets = Object.values(loadOwnedAssets());
    const tmi = getOwnedTmi();
    const regime = getOwnedRegime();
    const currentYear = new Date().getFullYear();
    const anneeMin = assets.reduce((m, a) => Math.min(m, parseDateAchat(a.dateAchat).annee), currentYear);

    function buildRapport(annee) {
        if (!assets.length) return '<p style="color:var(--text-tertiary);text-align:center">Aucun bien dans le portefeuille.</p>';
        // Texte construit par rapport-annuel.js (module pur, testé sous Node) : blocs Patrimoine,
        // Trésorerie (somme = CF de l'année), Fiscal (intérêts en charges déductibles), Par bien.
        const data = buildRapportAnnuelData(assets, annee, { profileData: state.profileData, regime, tmi });
        return `<pre class="rapport-text">${escapeHtml(buildRapportAnnuelTexte(data))}</pre>`;
    }

    const annees = [];
    for (let y = Math.max(anneeMin, currentYear - 5); y <= currentYear; y++) annees.push(y);

    const modal = _showOwnedModal(`
        <div class="owned-modal owned-modal--wide">
            <div class="owned-modal-head">
                <div style="display:flex;align-items:center;gap:12px">
                    <h3 class="owned-modal-title">Rapport annuel portefeuille</h3>
                    <select id="rapport-annee" class="variables-input" style="width:auto">
                        ${annees.map(y => `<option value="${y}" ${y === currentYear ? 'selected' : ''}>${y}</option>`).join('')}
                    </select>
                </div>
                <div style="display:flex;gap:8px">
                    <button class="btn btn--ghost btn--sm" id="rapport-copy">⎘ Copier</button>
                    <button class="btn btn--ghost" data-close-modal aria-label="Fermer">${icone('croix')}</button>
                </div>
            </div>
            <div id="rapport-content">${buildRapport(currentYear)}</div>
        </div>
    `, 'owned-rapport-modal');
    modal.querySelector('#rapport-annee')?.addEventListener('change', e => {
        const r = modal.querySelector('#rapport-content');
        if (r) r.innerHTML = buildRapport(Number(e.target.value));
    });
    modal.querySelector('#rapport-copy')?.addEventListener('click', () => {
        const pre = modal.querySelector('.rapport-text');
        if (pre) navigator.clipboard?.writeText(pre.textContent);
        showToast('Rapport copié dans le presse-papiers', 'success');
    });
}
