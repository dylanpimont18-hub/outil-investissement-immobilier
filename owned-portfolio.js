// Module Portefeuille biens detenus — CRUD (ownedAssets, Firestore via owned-cloud.js), rendu (liste, fiche detail,
// onglets Acquisition/Exploitation/Travaux/Projection) et evenements. Extrait de main.js (axe 3).
//
// Interface : initOwnedPortfolio(deps) doit etre appelee en tout premier (avant le premier render()),
// avec { state, nodes, IS_MOBILE_PAGE } (les memes objets partages
// que main.js, passes par reference) — renderCollections() en depend des le premier rendu.
// IS_MOBILE_PAGE (true depuis owned-entry.js, false depuis main.js) fait sauter dashboard/carte/
// graphiques/comparaison regimes/diagnostic IA dans le rendu, pour ne garder sur owned.html (page
// iPhone) que la saisie/edition d'un bien + le detail du calcul du CF net-net. initOwnedPortfolioEvents()
// cable les listeners persistants et doit etre appelee separement, au meme moment que dans main.js
// avant l'extraction (apres le rendu initial). renderCollections() est ensuite appelee a chaque cycle
// de rendu par main.js.

import { icone, definirTexteAvecIcone } from './icones.js';
import { state, nodes, definirContexte } from './owned-contexte.js';
import { escapeHtml, showToast } from './utils.js';
import { savePref, cloudListArchives, cloudUploadArchive, cloudReadArchive } from './cloud-store.js';
import { nomArchiveUnique } from './archives-regles.js';
import { openAssetReportPreview, openBankDossierModal } from './owned-rapports.js';
import { openCompteResultatModal, openProjectionImpotsModal, openSimulationTravauxModal } from './owned-fiscal.js';
import { openOwnedDiagnosticDrawer } from './owned-diagnostic.js';
import { _importPortfolioObject, openOwnedImportModal, renderOwnedPortfolioList } from './owned-liste.js';
import { closeOwnedDetail, openOwnedDetail, renderOwnedDetail } from './owned-fiche.js';
import { _downloadOrShareFile, _wireOwnedModalEscape } from './owned-outils.js';
import { _authUser, _cloudLoaded, _initCloudSync, _metaLoaded, _prefsLoaded, createOwnedAsset, deleteOwnedAsset, loadOwnedAssets, updateOwnedAsset } from './owned-donnees.js';
import { _syncQuickFabVisibility, closeOwnedAddModal, closeOwnedDeleteModal, initOwnedQuickFab, initOwnedQuickRail, openOwnedAddModal } from './owned-actions.js';
import { _renderAuthGate } from './owned-auth.js';
export { renderAuthGateInto } from './owned-auth.js';

export { openOwnedAddModal, closeOwnedAddModal, _refreshAfterFacturesAdd, openOwnedDeleteModal, closeOwnedDeleteModal } from './owned-actions.js';

export { formatDateAchat, _authUser, syncProfileToCloud, loadOwnedAssets, saveOwnedAssets, createOwnedAsset, getOwnedAsset, updateOwnedAsset, updateOwnedAcquisition, updateOwnedCredit, updateOwnedPostAchat, addOwnedLot, updateOwnedLot, deleteOwnedLot, NATURES_FRAIS, natureFraisOptionsHtml, suggererNatureFrais, alerteDoublonTaxeFonciere, findSimilarTravail, addOwnedTravail, updateOwnedTravail, deleteOwnedTravail, uploadOwnedDocument, addOwnedNote, deleteOwnedNote, addOwnedChargesAnnuelles, deleteOwnedChargesAnnuelles, addOwnedLoyerHistorique, deleteOwnedLoyerHistorique, geocodeOwnedAsset, loadPortfolioGoals, savePortfolioGoals, addOwnedScenario, updateOwnedScenarioVar, updateOwnedScenarioNom, deleteOwnedScenario, getOwnedTmi, getOwnedRegime, setOwnedRegime, getOwnedDefaultScenario, getOrderedAssetList, buildPortfolioSummaryForAI } from './owned-donnees.js';

export { _showOwnedModal, _downloadOrShareFile, _copyText } from './owned-outils.js';

export { openOwnedDetail, renderOwnedVerdictBlock } from './owned-fiche.js';

export { renderOwnedSynthese, renderOwnedCalculTab, parseOwnedYear } from './owned-calcul.js';

export { renderAccordionPostAchat, renderAccordionSimulateur } from './owned-exploitation.js';

export { renderAccordionAcquisition } from './owned-acquisition.js';

export { invalidateOwnedMap, renderOwnedPortfolioList } from './owned-liste.js';


export { addOwnedAutreCredit, patchProfileData } from './owned-profil.js';

export { openDocumentPreview, renderOwnedTravauxTab } from './owned-travaux.js'; // premier snapshot settings/prefs (densite, tri, filtres d'annee, dernier bien factures)

export function initOwnedPortfolio(deps) {
    definirContexte(deps);
    _initCloudSync();
}

export { initOwnedPortfolioEvents };

function initOwnedPortfolioEvents() {
    _wireOwnedModalEscape();
    // Export JSON : téléchargement (feuille de partage sur écran tactile) PUIS copie dans Storage
    // users/{uid}/archives/ — remplace le dossier exports/ de l'ancien serveur local. Le fichier part
    // d'abord : navigator.share doit rester dans le geste utilisateur, l'upload peut attendre.
    const exportBtn = document.getElementById('owned-export-btn');
    if (exportBtn) {
        exportBtn.addEventListener('click', async () => {
            const json = JSON.stringify(loadOwnedAssets(), null, 2);
            const base = `portefeuille-${new Date().toISOString().slice(0, 10)}`;
            await _downloadOrShareFile(new File([json], `${base}.json`, { type: 'application/json' }), 'Portefeuille Spark');
            try {
                const existants = (await cloudListArchives()).map(a => a.name);
                const archiveName = nomArchiveUnique(base, existants);
                await cloudUploadArchive(archiveName, json);
                definirTexteAvecIcone(exportBtn, 'coche', archiveName);
                setTimeout(() => { exportBtn.innerHTML = `${icone('fleche-bas')} Export`; }, 3000);
            } catch {
                showToast('Archive cloud non enregistrée — le fichier a tout de même été téléchargé', 'negative');
            }
        });
    }

    const densityBtn = document.getElementById('owned-density-btn');
    if (densityBtn) {
        densityBtn.addEventListener('click', () => {
            state.ownedCompact = !state.ownedCompact;
            savePref({ ownedCompact: state.ownedCompact }).catch(() => {});
            renderOwnedPortfolioList();
        });
    }

    const importBtn = document.getElementById('owned-import-btn');
    if (importBtn) {
        importBtn.addEventListener('click', openOwnedImportModal);
    }

    const importModal = document.getElementById('owned-import-modal');
    const importCancel = document.getElementById('owned-import-modal-cancel');
    const importConfirm = document.getElementById('owned-import-modal-confirm');
    if (importCancel) importCancel.addEventListener('click', () => { if (importModal) importModal.hidden = true; });
    if (importModal) importModal.addEventListener('click', e => { if (e.target === importModal) importModal.hidden = true; });
    const importFileInput = document.getElementById('owned-import-file-input');
    if (importFileInput) {
        // Un fichier choisi devient la sélection courante (désélectionne l'archive cloud éventuelle).
        importFileInput.addEventListener('change', () => {
            const file = importFileInput.files?.[0];
            if (!file || !importModal) return;
            const list = document.getElementById('owned-import-file-list');
            // Un seul fichier local à la fois : l'ancienne ligne disparaît, la nouvelle est cliquable
            // (pour revenir au fichier après avoir cliqué une archive).
            importModal._fileRow?.remove();
            importModal.querySelectorAll('.owned-import-file-item--selected').forEach(i => i.classList.remove('owned-import-file-item--selected'));
            importModal._pendingFile = file;
            const row = document.createElement('div');
            row.className = 'owned-import-file-item owned-import-file-item--selected';
            row.innerHTML = `<span class="owned-import-file-item__name">${escapeHtml(file.name)}</span><span class="owned-import-note">fichier local</span>`;
            row.addEventListener('click', () => {
                importModal.querySelectorAll('.owned-import-file-item--selected').forEach(i => i.classList.remove('owned-import-file-item--selected'));
                row.classList.add('owned-import-file-item--selected');
                importModal._pendingFile = file;
                if (importConfirm) importConfirm.disabled = false;
            });
            importModal._fileRow = row;
            list?.prepend(row);
            // Vide l'input : rechoisir le même fichier redéclenchera `change`.
            importFileInput.value = '';
            if (importConfirm) importConfirm.disabled = false;
        });
    }
    if (importConfirm) {
        importConfirm.addEventListener('click', async () => {
            const selected = importModal?.querySelector('.owned-import-file-item--selected');
            const filename = selected?.dataset.filename;
            if (!filename && !importModal?._pendingFile) return;
            try {
                const portfolio = !filename
                    ? JSON.parse(await importModal._pendingFile.text())
                    : await cloudReadArchive(filename);
                const added = _importPortfolioObject(portfolio);
                importModal.hidden = true;
                renderOwnedPortfolioList();
                importConfirm.textContent = added > 0 ? `${added} bien(s) importé(s)` : 'Tous les biens sont déjà présents';
                if (added > 0) setTimeout(() => { importConfirm.textContent = 'Importer'; }, 3000);
            } catch (err) {
                showToast(`Import impossible : ${err?.message || 'fichier illisible'}`, 'negative');
            }
        });
    }

    if (nodes.ownedAddBtn) {
        nodes.ownedAddBtn.addEventListener('click', openOwnedAddModal);
    }
    if (nodes.ownedAddCancel) {
        nodes.ownedAddCancel.addEventListener('click', closeOwnedAddModal);
    }
    nodes.ownedAddModal?.querySelector('[data-close-add-modal]')?.addEventListener('click', closeOwnedAddModal);
    if (nodes.ownedAddForm) {
        nodes.ownedAddForm.addEventListener('submit', e => {
            e.preventDefault();
            const nom = nodes.ownedAddNom?.value.trim();
            if (!nom) { nodes.ownedAddNom?.focus(); return; }
            const ville = nodes.ownedAddVille?.value.trim() || '';
            const cp = nodes.ownedAddCp?.value.trim() || '';
            const asset = createOwnedAsset(nom, ville);
            if (cp) updateOwnedAsset(asset.id, { codePostal: cp });
            closeOwnedAddModal();
            openOwnedDetail(asset.id);
        });
    }
    initOwnedQuickRail();
    initOwnedQuickFab();
    if (nodes.ownedBackBtn) {
        nodes.ownedBackBtn.addEventListener('click', closeOwnedDetail);
    }
    // Diagnostic IA : le bouton ouvre d'abord l'historique du bien ; un nouveau diagnostic (appel
    // IA payant) n'est lancé qu'après confirmation explicite dans le drawer (demande utilisateur
    // 2026-10-01 — avant, le clic lançait directement l'analyse).
    if (nodes.ownedDiagnosticBtn) {
        nodes.ownedDiagnosticBtn.addEventListener('click', () => {
            const id = state.activeOwnedAssetId;
            if (id) openOwnedDiagnosticDrawer(id);
        });
    }
    if (nodes.ownedReportBtn) {
        nodes.ownedReportBtn.addEventListener('click', () => {
            const id = state.activeOwnedAssetId;
            if (id) openAssetReportPreview(id);
        });
    }
    if (nodes.ownedBankDossierBtn) {
        nodes.ownedBankDossierBtn.addEventListener('click', () => {
            const id = state.activeOwnedAssetId;
            if (id) openBankDossierModal(id);
        });
    }
    if (nodes.ownedAiDrawerClose) {
        nodes.ownedAiDrawerClose.addEventListener('click', () => {
            nodes.ownedAiDrawer?.classList.remove('is-open');
            nodes.ownedAiOverlay?.classList.remove('is-open');
        });
    }
    if (nodes.ownedAiOverlay) {
        nodes.ownedAiOverlay.addEventListener('click', () => {
            nodes.ownedAiDrawer?.classList.remove('is-open');
            nodes.ownedAiOverlay.classList.remove('is-open');
        });
    }
    if (nodes.ownedDeleteModalInput) {
        nodes.ownedDeleteModalInput.addEventListener('input', () => {
            if (nodes.ownedDeleteModalConfirm) {
                nodes.ownedDeleteModalConfirm.disabled = nodes.ownedDeleteModalInput.value.trim().toLowerCase() !== 'supprimer';
            }
        });
    }
    if (nodes.ownedDeleteModalCancel) {
        nodes.ownedDeleteModalCancel.addEventListener('click', closeOwnedDeleteModal);
    }
    if (nodes.ownedDeleteModalConfirm) {
        nodes.ownedDeleteModalConfirm.addEventListener('click', () => {
            const id = nodes.ownedDeleteModal._pendingId;
            if (!id) return;
            deleteOwnedAsset(id);
            closeOwnedDeleteModal();
            renderOwnedPortfolioList();
        });
    }
    nodes.ownedDeleteModal?.addEventListener('click', e => {
        if (e.target === nodes.ownedDeleteModal) closeOwnedDeleteModal();
    });

    // Délégation sur la vue détail pour les boutons dynamiques
    document.getElementById('owned-detail-view')?.addEventListener('click', e => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const id = state.activeOwnedAssetId;
        const action = btn.dataset.action;
        if (action === 'open-compte-resultat' && id) {
            openCompteResultatModal(id);
        } else if (action === 'open-simu-travaux' && id) {
            openSimulationTravauxModal(id);
        } else if (action === 'open-projection-impots') {
            openProjectionImpotsModal(id);
        } else if (action === 'focus-valeur-estimee') {
            e.preventDefault();
            const accBtn = document.querySelector('[data-acc="acquisition"]');
            accBtn?.setAttribute('aria-expanded', 'true');
            document.getElementById('acc-acquisition-body')?.removeAttribute('hidden');
            setTimeout(() => {
                const input = nodes.accAcquisitionContent?.querySelector('[data-acq-field="valeurEstimee"]');
                input?.focus();
                input?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 100);
        }
    });
}

function renderCollections() {
    _syncQuickFabVisibility();
    nodes.collectionPanel.hidden = false;

    const gate = document.getElementById('owned-auth-gate');
    const regimeLabel = document.querySelector('.owned-regime-slider-label');
    const regimeAnchor = document.getElementById('owned-regime-slider-anchor');
    if (!_authUser) {
        if (gate) gate.hidden = false;
        _renderAuthGate();
        if (regimeLabel) regimeLabel.hidden = true;
        if (regimeAnchor) regimeAnchor.hidden = true;
        if (nodes.ownedListView) nodes.ownedListView.hidden = true;
        if (nodes.ownedDetailView) nodes.ownedDetailView.hidden = true;
        return;
    }
    if (gate) gate.hidden = true;
    if (regimeLabel) regimeLabel.hidden = false;
    if (regimeAnchor) regimeAnchor.hidden = false;
    // En attente du premier snapshot Firestore (biens, regime/profil ET preferences) : sans _metaLoaded,
    // un rendu prematuré utiliserait la valeur par defaut locale de state.ownedRegime/profileData
    // (ex. "Micro-foncier") le temps que watchPortfolioMeta reponde, provoquant un flash visible
    // du CF net-net avant qu'il ne se corrige vers la vraie valeur (audit UX 2026-07-29) ; sans
    // _prefsLoaded, la densite/le tri/les filtres d'annee basculeraient apres le premier rendu.
    if (!_cloudLoaded || !_metaLoaded || !_prefsLoaded) return;

    if (state.activeOwnedAssetId) {
        if (nodes.ownedListView) nodes.ownedListView.hidden = true;
        if (nodes.ownedDetailView) nodes.ownedDetailView.hidden = false;
        renderOwnedDetail();
    } else {
        if (nodes.ownedListView) nodes.ownedListView.hidden = false;
        if (nodes.ownedDetailView) nodes.ownedDetailView.hidden = true;
        renderOwnedPortfolioList();
    }
}


export { renderCollections };
