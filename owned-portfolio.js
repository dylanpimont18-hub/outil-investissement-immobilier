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
import { state, nodes, IS_MOBILE_PAGE, definirContexte } from './owned-contexte.js';
import { escapeHtml, showToast } from './utils.js';
import { cloudSignIn } from './owned-cloud.js';
import { savePref, cloudListArchives, cloudUploadArchive, cloudReadArchive } from './cloud-store.js';
import { nomArchiveUnique } from './archives-regles.js';
import { openAssetReportPreview, openBankDossierModal } from './owned-rapports.js';
import { openCompteResultatModal, openProjectionImpotsModal, openSimulationTravauxModal } from './owned-fiscal.js';
import { openAjoutFacturesModal, openImportDossierModal } from './owned-factures.js';
import { renderOwnedTravauxTab } from './owned-travaux.js';
import { openOwnedDiagnosticDrawer } from './owned-diagnostic.js';
import { _importPortfolioObject, openOwnedImportModal, renderOwnedPortfolioList } from './owned-liste.js';
import { renderAccordionPostAchat, renderAccordionSimulateur } from './owned-exploitation.js';
import { renderOwnedCalculTab, renderOwnedSynthese } from './owned-calcul.js';
import { closeOwnedDetail, openOwnedDetail, renderOwnedDetail } from './owned-fiche.js';
import { _downloadOrShareFile, _wireOwnedModalEscape } from './owned-outils.js';
import { _authUser, _cloudLoaded, _initCloudSync, _metaLoaded, _prefsLoaded, createOwnedAsset, deleteOwnedAsset, getOwnedAsset, loadOwnedAssets, updateOwnedAsset } from './owned-donnees.js';
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

// Sur mobile (owned.html), la modale #owned-add-modal existe encore. Sur PC (index.html), elle a été
// retirée le 2026-08-04 au profit du rail Actions rapides (#owned-quickrail) — openOwnedAddModal()
// reste le point d'entrée commun appelé par les CTA "état vide" (mobile + PC), et bascule vers le rail
// quand la modale est absente.
export function openOwnedAddModal() {
    if (nodes.ownedAddModal) {
        nodes.ownedAddModal.hidden = false;
        nodes.ownedAddNom?.focus();
        return;
    }
    openOwnedQuickPanel('add-bien');
}

export function closeOwnedAddModal() {
    if (!nodes.ownedAddModal) return;
    nodes.ownedAddModal.hidden = true;
    nodes.ownedAddForm?.reset();
}

// Après un ajout de frais depuis la modale globale (openAjoutFacturesModal) : reste sur la vue
// courante (pas de navigation forcée). Si la fiche du bien concerné est ouverte on la rafraîchit,
// sinon la liste/dashboard visible. Le snapshot Firestore re-rendra de toute façon, ceci rend le
// retour visuel immédiat.
export function _refreshAfterFacturesAdd(assetId) {
    if (state.activeOwnedAssetId === assetId) {
        const fresh = getOwnedAsset(assetId);
        if (fresh) {
            renderOwnedTravauxTab(fresh);
            renderAccordionPostAchat(fresh);
            renderOwnedSynthese(fresh);
            renderOwnedCalculTab(fresh);
            renderAccordionSimulateur(fresh);
        }
    } else {
        renderOwnedPortfolioList();
    }
}

// ─── Rail Actions rapides (#owned-quickrail, PC uniquement — absent de owned.html) ──────────────
// Ouvre/ferme sur place un mini-formulaire (Ajouter un bien / Ajouter une facture) juste sous le
// bouton cliqué, sans quitter la vue courante (liste ou fiche d'un bien).
function openOwnedQuickPanel(action) {
    const rail = document.getElementById('owned-quickrail');
    if (!rail) return false;
    rail.querySelectorAll('[data-quickpanel]').forEach(p => { p.hidden = p.dataset.quickpanel !== action; });
    rail.querySelectorAll('[data-quickaction]').forEach(b => { b.classList.toggle('owned-quickrail__action--active', b.dataset.quickaction === action); });
    if (action === 'add-bien') {
        document.getElementById('owned-quick-add-bien-form')?.querySelector('[name="nom"]')?.focus();
    }
    return true;
}

function closeOwnedQuickPanels() {
    const rail = document.getElementById('owned-quickrail');
    if (!rail) return;
    rail.querySelectorAll('[data-quickpanel]').forEach(p => { p.hidden = true; });
    rail.querySelectorAll('[data-quickaction]').forEach(b => b.classList.remove('owned-quickrail__action--active'));
}

function initOwnedQuickRail() {
    const rail = document.getElementById('owned-quickrail');
    if (!rail) return; // absent sur owned.html (mobile) : voir initOwnedQuickFab pour l'équivalent

    rail.querySelectorAll('[data-quickaction]').forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.dataset.quickaction;
            // « Ajouter une facture » n'a plus de panneau inline (2026-10-02) : même modale globale
            // que le bouton flottant, bien pré-sélectionné si une fiche est ouverte.
            if (action === 'add-facture') {
                closeOwnedQuickPanels();
                openAjoutFacturesModal({ assetId: state.activeOwnedAssetId || null });
                return;
            }
            const panel = rail.querySelector(`[data-quickpanel="${action}"]`);
            const wasOpen = panel && !panel.hidden;
            closeOwnedQuickPanels();
            if (!wasOpen) openOwnedQuickPanel(action);
        });
    });
    rail.querySelectorAll('[data-quickcancel]').forEach(btn => {
        btn.addEventListener('click', () => closeOwnedQuickPanels());
    });

    // ─── Ajouter un bien ──────────────────────────────────────────────────────
    document.getElementById('owned-quick-add-bien-form')?.addEventListener('submit', e => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const nom = String(fd.get('nom') || '').trim();
        if (!nom) return;
        const ville = String(fd.get('ville') || '').trim();
        const cp = String(fd.get('cp') || '').trim();
        const asset = createOwnedAsset(nom, ville);
        if (cp) updateOwnedAsset(asset.id, { codePostal: cp });
        e.target.reset();
        closeOwnedQuickPanels();
        openOwnedDetail(asset.id);
    });

    // ─── Importer un dossier (création directe depuis des documents) ──────────
    document.getElementById('owned-quick-import-dossier-btn')?.addEventListener('click', () => {
        closeOwnedQuickPanels();
        openImportDossierModal(null);
    });
}

// ─── Bouton flottant « Ajouter des factures » (#owned-quickfab, index.html ET owned.html) ───────
// Depuis le 2026-10-02 : présent sur toutes les pages (PC : tous les onglets ; mobile : liste et
// fiche), ouvre la modale globale openAjoutFacturesModal avec le bien de la fiche ouverte
// pré-sélectionné. Plus de modale-formulaire dédiée (#owned-quickfab-modal supprimée).
function initOwnedQuickFab() {
    const fab = document.getElementById('owned-quickfab');
    if (!fab) return;
    fab.addEventListener('click', () => openAjoutFacturesModal({ assetId: state.activeOwnedAssetId || null }));
    if (IS_MOBILE_PAGE) _initFabAutoHide();
}

// iPhone (owned.html) uniquement : les boutons flottants ✦ et 📄 (.owned-quickfab) se replient quand
// on fait défiler vers le bas, pour ne pas masquer le contenu qui passe dessous, et reviennent dès
// qu'on remonte, qu'on atteint le bas de la page ou qu'un bouton reçoit le focus (audit 2026-11-18
// F3, choix utilisateur du 2026-11-19). La classe body.owned-fabs-tucked est stylée dans styles.css.
function _initFabAutoHide() {
    let lastY = window.scrollY;
    let ticking = false;
    const update = () => {
        ticking = false;
        const y = window.scrollY;
        const atBottom = y + window.innerHeight >= document.documentElement.scrollHeight - 4;
        const delta = y - lastY;
        if (Math.abs(delta) < 6 && !atBottom) return; // petits à-coups du défilement inertiel
        document.body.classList.toggle('owned-fabs-tucked', delta > 0 && y > 80 && !atBottom);
        lastY = y;
    };
    window.addEventListener('scroll', () => {
        if (ticking) return;
        ticking = true;
        window.requestAnimationFrame(update);
    }, { passive: true });
    document.addEventListener('focusin', (e) => {
        if (e.target.closest?.('.owned-quickfab')) document.body.classList.remove('owned-fabs-tucked');
    });
}

// Visible dès que le portefeuille cloud est chargé ; masqué hors connexion (rien à rattacher).
// Appelé à chaque renderCollections() — seul point commun à
// tous les changements d'état auth/cloud. `.owned-quickfab[hidden]` est explicitement display:none
// en CSS, car la classe pose display:flex qui l'emporterait sinon sur l'attribut hidden.
function _syncQuickFabVisibility() {
    const fab = document.getElementById('owned-quickfab');
    if (!fab) return;
    fab.hidden = !_authUser || !_cloudLoaded;
}

export function openOwnedDeleteModal(assetId) {
    const asset = getOwnedAsset(assetId);
    if (!asset || !nodes.ownedDeleteModal) return;
    nodes.ownedDeleteModal._pendingId = assetId;
    if (nodes.ownedDeleteModalName) nodes.ownedDeleteModalName.textContent = asset.nom || assetId;
    if (nodes.ownedDeleteModalInput) nodes.ownedDeleteModalInput.value = '';
    if (nodes.ownedDeleteModalConfirm) nodes.ownedDeleteModalConfirm.disabled = true;
    nodes.ownedDeleteModal.hidden = false;
    nodes.ownedDeleteModalInput?.focus();
}

export function closeOwnedDeleteModal() {
    if (!nodes.ownedDeleteModal) return;
    nodes.ownedDeleteModal.hidden = true;
    nodes.ownedDeleteModal._pendingId = null;
    if (nodes.ownedDeleteModalInput) nodes.ownedDeleteModalInput.value = '';
}

// ─── CONNEXION (compte unique PC + iPhone) ───────────────────────────────────

// Formulaire de connexion (compte unique PC + iPhone). Sert deux conteneurs : #owned-auth-gate dans
// le panneau Portefeuille (owned.html, et index.html hors onglet actif) et #app-auth-gate, le gate
// plein écran d'index.html géré par main.js — connexion obligatoire pour toute l'app depuis le
// passage au tout-web. Câblé une seule fois par conteneur (data-wired).
export function renderAuthGateInto(gate, { title = 'Connexion' } = {}) {
    if (!gate) return;
    if (!gate.innerHTML.trim()) {
        gate.innerHTML = `
            <div class="owned-auth-gate">
                <h2>${escapeHtml(title)}</h2>
                <p class="owned-auth-gate__hint">Un seul compte, partagé entre le PC et l'iPhone.</p>
                <form id="owned-auth-form" novalidate>
                    <label class="variables-field">
                        <span class="variables-label">Email</span>
                        <input class="variables-input" type="email" name="email" required autocomplete="username">
                    </label>
                    <label class="variables-field">
                        <span class="variables-label">Mot de passe</span>
                        <input class="variables-input" type="password" name="password" required autocomplete="current-password">
                    </label>
                    <div id="owned-auth-error" class="owned-auth-gate__error" hidden></div>
                    <button type="submit" class="btn btn--primary">Se connecter</button>
                </form>
            </div>`;
    }
    if (gate.dataset.wired) return;
    gate.dataset.wired = '1';
    gate.querySelector('#owned-auth-form')?.addEventListener('submit', async e => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const errEl = gate.querySelector('#owned-auth-error');
        const btn = e.target.querySelector('button[type="submit"]');
        if (errEl) errEl.hidden = true;
        if (btn) { btn.disabled = true; btn.textContent = 'Connexion…'; }
        try {
            await cloudSignIn(String(fd.get('email') || '').trim(), String(fd.get('password') || ''));
        } catch {
            if (errEl) { errEl.textContent = 'Email ou mot de passe incorrect.'; errEl.hidden = false; }
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = 'Se connecter'; }
        }
    });
}

function _renderAuthGate() {
    renderAuthGateInto(document.getElementById('owned-auth-gate'), { title: 'Portefeuille — Connexion' });
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
