// Bootstrap minimal pour owned.html (page iPhone) — equivalent, pour le seul module portefeuille,
// de ce que main.js fait pour toute l'app. STORAGE_KEYS/state ne couvrent que les reglages d'affichage
// locaux a cet appareil (ownedCompact/ownedSort/ownedYearFilters) : les donnees du portefeuille
// elles-memes viennent de Firestore via owned-cloud.js (voir initOwnedPortfolio dans owned-portfolio.js).
import { initOwnedPortfolio, initOwnedPortfolioEvents, renderCollections } from './owned-portfolio.js';

const STORAGE_KEYS = {
    ownedOrder: 'investissementWebOwnedOrder',
    ownedCompact: 'investissementWebOwnedCompact',
    ownedSort: 'investissementWebOwnedSort'
};

const state = {
    activeOwnedAssetId: null,
    ownedExpandedIds: new Set(),
    ownedYearFilters: JSON.parse(localStorage.getItem('investissementWebOwnedYearFilters') || '{}'),
    ownedOrder: JSON.parse(localStorage.getItem(STORAGE_KEYS.ownedOrder) || '[]'),
    ownedCompact: localStorage.getItem(STORAGE_KEYS.ownedCompact) === '1',
    ownedSort: JSON.parse(localStorage.getItem(STORAGE_KEYS.ownedSort) || 'null'),
    ownedRegime: localStorage.getItem('investissementWebOwnedRegime') || 'micro-foncier',
    // Profil du foyer (TMI) : reglage local a cet appareil, comme sur PC — a renseigner une fois ici
    // aussi pour que les impots/CF net-net affiches soient corrects (non synchronise depuis le PC).
    profileData: JSON.parse(localStorage.getItem('investissementWebProfileData') || 'null') || { income: 0, adults: 1, children: 0, autresCredits: [] }
};

const nodes = {
    collectionPanel: document.getElementById('collection-panel'),
    ownedListView: document.getElementById('owned-list-view'),
    ownedDetailView: document.getElementById('owned-detail-view'),
    ownedAddBtn: document.getElementById('owned-add-btn'),
    ownedAddModal: document.getElementById('owned-add-modal'),
    ownedAddForm: document.getElementById('owned-add-form'),
    ownedAddNom: document.getElementById('owned-add-nom'),
    ownedAddVille: document.getElementById('owned-add-ville'),
    ownedAddCp: document.getElementById('owned-add-cp'),
    ownedAddCancel: document.getElementById('owned-add-cancel'),
    ownedKpiBanner: document.getElementById('owned-kpi-banner'),
    ownedListTable: document.getElementById('owned-list-table'),
    ownedBackBtn: document.getElementById('owned-back-btn'),
    ownedDetailTitle: document.getElementById('owned-detail-title'),
    ownedDiagnosticBtn: document.getElementById('owned-diagnostic-btn'),
    ownedSynthese: document.getElementById('owned-synthese'),
    ownedVerdict: document.getElementById('owned-verdict'),
    ownedCfTableWrap: document.getElementById('owned-cf-table-wrap'),
    ownedTravauxContent: document.getElementById('owned-travaux-content'),
    ownedDeleteModal: document.getElementById('owned-delete-modal'),
    ownedDeleteModalName: document.getElementById('owned-delete-modal-name'),
    ownedDeleteModalInput: document.getElementById('owned-delete-modal-input'),
    ownedDeleteModalCancel: document.getElementById('owned-delete-modal-cancel'),
    ownedDeleteModalConfirm: document.getElementById('owned-delete-modal-confirm'),
    ownedAiDrawer: document.getElementById('owned-ai-drawer'),
    ownedAiOverlay: document.getElementById('owned-ai-overlay'),
    ownedAiDrawerContent: document.getElementById('owned-ai-drawer-content'),
    ownedAiDrawerClose: document.getElementById('owned-ai-drawer-close'),
    accAcquisitionContent: document.getElementById('acc-acquisition-content'),
    accAcquisitionSummary: document.getElementById('acc-acquisition-summary'),
    accPostAchatContent: document.getElementById('acc-postachat-content'),
    accPostAchatSummary: document.getElementById('acc-postachat-summary'),
    accSimulateurContent: document.getElementById('acc-simulateur-content'),
    accSimulateurSummary: document.getElementById('acc-simulateur-summary')
};

initOwnedPortfolio({ state, nodes, STORAGE_KEYS, IS_ANALYSIS_WINDOW: false, IS_MOBILE_PAGE: true });
initOwnedPortfolioEvents();
renderCollections();

// Bouton "Recharger l'application" (topbar) : une fois ajoutée à l'écran d'accueil (mode
// standalone), iOS reprend souvent la page depuis la mémoire au lieu de la recharger — la seule
// façon de récupérer une mise à jour déployée est alors de supprimer puis réinstaller l'icône.
// Ce bouton force une vraie navigation réseau (URL jamais vue, donc jamais servie depuis un cache
// ou une reprise d'état) sans avoir à toucher à l'icône.
document.getElementById('app-reload-btn')?.addEventListener('click', () => {
    const url = new URL(location.href);
    url.searchParams.set('_r', Date.now());
    location.replace(url.toString());
});
