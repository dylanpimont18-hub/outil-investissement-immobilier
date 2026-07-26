import { calculateTMI, computeAnalysisViewModel, getHouseholdTaxParts, capitalRestantDu } from './calculs.js';
import { buildDecisionPrintDocument } from './pdf.js';
import { initScanner, onScannerTabActivated } from './scanner.js';
import { renderDonutChart, destroyDonut } from './ui.js';
import { escapeHtml, formatMultilineText, showToast, formatCurrency, formatPercent, formatRatio, formatSignedCurrency, formatCompactCurrency, formatPlainCurrency, formatShortDateTime, getMetricClass, getDecisionClass, getRegimeLabel, getTypeBienLabel, getChecklistTone, getChecklistLabel } from './utils.js';
import { initOwnedPortfolio, initOwnedPortfolioEvents, renderCollections } from './owned-portfolio.js';

const _counterState = new WeakMap();

function animateCounter(el, targetText) {
    const match = targetText.match(/^([^0-9\-]*)(-?[\d.,]+)(.*)$/);
    if (!match) { el.textContent = targetText; return; }
    const [, prefix, rawNum, suffix] = match;
    const target = parseFloat(rawNum.replace(',', '.'));
    if (isNaN(target)) { el.textContent = targetText; return; }

    const prev = _counterState.get(el) ?? target;
    _counterState.set(el, target);
    if (prev === target) return;

    const start = performance.now();
    const duration = 300;
    const decimals = (rawNum.includes(',') || rawNum.includes('.'))
        ? rawNum.split(/[,.]/).pop().length : 0;

    function tick(now) {
        const t = Math.min((now - start) / duration, 1);
        const current = prev + (target - prev) * t;
        el.textContent = prefix + current.toFixed(decimals).replace('.', ',') + suffix;
        if (t < 1) requestAnimationFrame(tick);
        else _counterState.set(el, target);
    }
    requestAnimationFrame(tick);
}

const STORAGE_KEYS = {
    theme: 'investissementWebTheme',
    screens: 'investissementWebScreens',
    profilePreset: 'investissementWebProfile',
    profileData: 'investissementWebProfileData',
    profileConfigured: 'investissementWebProfileConfigured',
    variablesData: 'investissementWebVariablesData',
    assetRecords: 'investissementWebAssetRecords',
    activeAssetId: 'investissementWebActiveAssetId',
    syncTick: 'investissementWebSyncTick',
    guidedMode: 'investissementWebGuidedMode',
    sparkMode: 'investissementWebSparkMode',
    ownedAssets: 'investissementWebOwnedAssets',
    ownedOrder: 'investissementWebOwnedOrder',
    ownedCompact: 'investissementWebOwnedCompact',
    ownedSort: 'investissementWebOwnedSort'
};

// --- Portfolio biens détenus ---

const PROFILE_OPTIONS = [
    {
        key: 'solo',
        label: 'Solo',
        defaults: { name: 'Solo', income: 42000, adults: 1, children: 0 },
        note: 'Profil simple pour lire rapidement l impact fiscal et la capacité d\'investissement du foyer.'
    },
    {
        key: 'couple',
        label: 'Couple',
        defaults: { name: 'Couple', income: 76000, adults: 2, children: 0 },
        note: 'Base à deux adultes sans enfant, utile pour cadrer rapidement la capacité du foyer.'
    },
    {
        key: 'famille',
        label: 'Famille',
        defaults: { name: 'Famille', income: 60000, adults: 2, children: 2 },
        note: 'Profil familial pour visualiser clairement la composition du foyer et l effet des parts fiscales.'
    },
    {
        key: 'personnalise',
        label: 'Personnalisé',
        defaults: { name: 'Personnalisé', income: 0, adults: 2, children: 0 },
        note: 'Profil libre à ajuster manuellement selon les revenus du foyer et sa composition.'
    }
];

const VARIABLE_DEFAULTS = {
    'nom-bien': 'Nouvelle étude',
    'type-bien': 'appartement',
    ville: 'Ville à préciser',
    adresse: '',
    prix: 0,
    nego: 0,
    loyer: 0,
    notaire: 8,
    travaux: 0,
    meubles: 0,
    agence: 0,
    dpe: 'D',
    'loyer-marche': 0,
    'copro-risque': 'stable',
    'source-loyer': 'estimated',
    'source-charges': 'estimated',
    'source-travaux': 'estimated',
    'source-documents': 'unknown',
    apport: 0,
    'taux-input': 3.17,
    duree: 20,
    assurance: 0.3,
    'frais-bancaires': 1500,
    vacance: 5,
    copro: 40,
    fonciere: 1500,
    pno: 150,
    gestion: 7,
    'seuil-cf-min': 0,
    'seuil-dscr-min': 1,
    'seuil-vacance-max': 8,
    'seuil-ecart-loyer-max': 10,
    'seuil-effort-max': 10,
    'blocage-passoire': 'yes',
    regime: 'reel',
    'decision-thesis': '',
    'decision-next-step': '',
    'annee-achat': null
};

const VARIABLE_KEYS = Object.keys(VARIABLE_DEFAULTS);
const TUTO_STEPS = [
    {
        title: 'Bienvenue sur Spark Investissement',
        description: 'Ce tutoriel vous guide pas à pas. Cliquez Suivant pour démarrer.',
        accordTitle: null,
        fields: []
    },
    {
        title: 'Identité du dossier',
        description: 'Donnez un nom à votre étude et indiquez la ville du bien.',
        accordTitle: 'Identité du dossier',
        fields: [
            { id: 'nom-bien', label: 'Nom du bien', exemple: 'ex : Appart T2 Lyon 7e', explication: 'Un nom libre pour retrouver ce dossier dans votre comparateur et vos exports PDF.' },
            { id: 'ville', label: 'Ville', exemple: 'ex : Lyon', explication: 'Ville où se situe le bien, pour contextualiser l\'analyse.' }
        ]
    },
    {
        title: 'Prix & loyer',
        description: 'Le prix vendeur et le loyer cible : les deux chiffres qui définissent la rentabilité.',
        accordTitle: 'Acquisition',
        fields: [
            { id: 'prix', label: 'Prix affiché', exemple: 'ex : 185 000', explication: 'Prix demandé par le vendeur, avant toute négociation.' },
            { id: 'loyer', label: 'Loyer cible mensuel', exemple: 'ex : 750', explication: 'Loyer mensuel hors charges que vous estimez pouvoir obtenir.' },
            { id: 'nego', label: 'Négociation visée (%)', exemple: 'ex : 5', explication: 'Décote visée sur le prix. 5 % sur 185 000 € = offre à 175 750 €.' },
            { id: 'notaire', label: 'Frais de notaire (%)', exemple: 'ex : 7.5', explication: 'Environ 7–8 % dans l\'ancien, 2–3 % dans le neuf.' },
            { id: 'travaux', label: 'Budget travaux', exemple: 'ex : 15 000', explication: 'Travaux de rénovation estimés, intégrés au coût total d\'acquisition.' }
        ]
    },
    {
        title: 'Financement',
        description: 'Les conditions de votre crédit immobilier définissent votre mensualité et votre cash-flow.',
        accordTitle: 'Financement',
        fields: [
            { id: 'apport', label: 'Apport', exemple: 'ex : 20 000', explication: 'Somme apportée sans emprunt. Réduit le capital à financer.' },
            { id: 'taux-input', label: 'Taux d\'intérêt (%)', exemple: 'ex : 3.75', explication: 'Taux annuel du crédit, hors assurance. Comparez plusieurs banques.' },
            { id: 'duree', label: 'Durée du prêt (ans)', exemple: 'ex : 20', explication: 'Plus longue = mensualité plus basse, mais coût total plus élevé.' },
            { id: 'assurance', label: 'Assurance emprunteur (%)', exemple: 'ex : 0.30', explication: 'Taux d\'assurance décès-invalidité annuel, en % du capital emprunté.' }
        ]
    },
    {
        title: 'Exploitation locative',
        description: 'Les charges et aléas réels. Ne sous-estimez pas la vacance : elle impacte directement le rendement.',
        accordTitle: 'Exploitation locative',
        fields: [
            { id: 'vacance', label: 'Vacance (%)', exemple: 'ex : 5', explication: '5 % = environ 18 jours sans locataire par an.' },
            { id: 'fonciere', label: 'Taxe foncière / an', exemple: 'ex : 1 200', explication: 'Demandez l\'avis de taxe foncière au vendeur ou estimez via impots.gouv.fr.' },
            { id: 'copro', label: 'Charges de copro / mois', exemple: 'ex : 80', explication: 'Part non récupérable sur le locataire. Demandez les 3 derniers PV d\'AG.' },
            { id: 'gestion', label: 'Gestion (%)', exemple: 'ex : 0', explication: 'Honoraires d\'agence de gestion. 0 si vous gérez en direct.' }
        ]
    },
    {
        title: 'Fiscalité',
        description: 'Le régime fiscal détermine comment vos revenus locatifs sont imposés.',
        accordTitle: 'Fiscalité',
        fields: [
            { id: 'regime', label: 'Régime fiscal', exemple: 'Micro-foncier, Foncier réel ou SCI IS', explication: 'Micro-foncier : abattement 30 % forfaitaire. Réel : déduction des charges réelles. SCI IS : imposition comme une société.' }
        ]
    },
    {
        title: 'Analyse disponible',
        description: 'Toutes les données essentielles sont saisies. Consultez le panneau Analyse — verdict, métriques et projections sont à jour.',
        accordTitle: null,
        fields: []
    }
];
const WIZARD_STEPS = [
    {
        num: 1,
        title: 'Identité du dossier',
        desc: 'Donnez un nom à votre étude et indiquez la ville du bien.',
        fields: [
            { id: 'nom-bien', label: 'Nom du dossier', type: 'text', hint: 'ex : Appart T2 Lyon 7e — un nom pour retrouver ce dossier.' },
            { id: 'ville', label: 'Ville du bien', type: 'text', hint: 'ex : Lyon' }
        ]
    },
    {
        num: 2,
        title: 'Prix & loyer',
        desc: 'Les deux chiffres qui définissent la rentabilité du bien.',
        fields: [
            { id: 'prix', label: 'Prix affiché par le vendeur (€)', type: 'number', hint: 'Prix demandé, avant négociation.' },
            { id: 'loyer', label: 'Loyer cible mensuel (€)', type: 'number', hint: 'Loyer mensuel hors charges que vous estimez pouvoir obtenir.' },
            { id: 'nego', label: 'Négociation visée (%)', type: 'number', hint: 'Décote visée sur le prix. 0 si vous gardez le prix affiché.' },
            { id: 'travaux', label: 'Budget travaux (€)', type: 'number', hint: 'Travaux à intégrer au coût d\'acquisition. 0 si aucun.' }
        ]
    },
    {
        num: 3,
        title: 'Financement',
        desc: 'Les conditions de votre crédit définissent votre mensualité.',
        fields: [
            { id: 'apport', label: 'Apport personnel (€)', type: 'number', hint: 'Somme apportée sans emprunt.' },
            { id: 'taux-input', label: 'Taux d\'intérêt (%)', type: 'number', hint: 'Taux annuel du crédit, hors assurance.' },
            { id: 'duree', label: 'Durée du prêt (ans)', type: 'number', hint: 'ex : 20' },
            { id: 'notaire', label: 'Frais de notaire (%)', type: 'number', hint: 'Environ 7–8 % dans l\'ancien.' }
        ]
    },
    {
        num: 4,
        title: 'Exploitation & fiscalité',
        desc: 'Charges et régime fiscal pour un calcul précis.',
        fields: [
            { id: 'vacance', label: 'Vacance locative (%)', type: 'number', hint: '5 % = environ 18 jours sans locataire/an.' },
            { id: 'copro', label: 'Charges copro / mois (€)', type: 'number', hint: 'Part non récupérable sur le locataire.' },
            { id: 'fonciere', label: 'Taxe foncière / an (€)', type: 'number', hint: 'Demandez l\'avis de taxe au vendeur.' },
            { id: 'regime', label: 'Régime fiscal', type: 'select', hint: 'Micro-foncier, Foncier réel ou SCI IS.' }
        ]
    }
];
const REGIME_VALUES = new Set(['micro-foncier', 'reel', 'sci-is']);
const TYPE_BIEN_VALUES = new Set(['appartement', 'maison', 'immeuble']);
const DPE_VALUES = new Set(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
const COPRO_RISK_VALUES = new Set(['stable', 'medium', 'high']);
const SOURCE_STATUS_VALUES = new Set(['verified', 'estimated', 'unknown']);
const PASSOIRE_POLICY_VALUES = new Set(['yes', 'no']);
const STORAGE_SYNC_KEYS = new Set(Object.values(STORAGE_KEYS));
const PANEL_MODE = getPanelMode();
const IS_ANALYSIS_WINDOW = PANEL_MODE === 'analysis';
const initialProfilePreset = loadProfilePreset();

const state = {
    theme: loadTheme(),
    screens: loadScreens(),
    profilePreset: initialProfilePreset,
    profileData: loadProfileData(initialProfilePreset),
    profileConfigured: loadProfileConfigured(),
    isProfileModalOpen: false,
    variablesData: loadVariablesData(),
    assetRecords: loadAssetRecords(),
    activeAssetId: loadActiveAssetId(),
    sparkMode: loadSparkMode(),
    guidedStepIndex: 0,
    analysisPopupBlocked: false,
    activeOwnedAssetId: null,
    ownedRegime: localStorage.getItem('investissementWebOwnedRegime') || 'micro-foncier',
    ownedYearFilter: 1,
    ownedYearFilters: JSON.parse(localStorage.getItem('investissementWebOwnedYearFilters') || '{}'),
    ownedOrder: JSON.parse(localStorage.getItem(STORAGE_KEYS.ownedOrder) || '[]'),
    ownedCompact: localStorage.getItem(STORAGE_KEYS.ownedCompact) === '1',
    ownedSort: JSON.parse(localStorage.getItem(STORAGE_KEYS.ownedSort) || 'null'),
    ownedExpandedIds: new Set(),
};

let analysisWindowRef = null;
let syncChannel = null;
let profileModalReturnFocusTarget = null;

const nodes = {
    btnViewQuick: document.getElementById('btn-view-quick'),
    btnViewFull: document.getElementById('btn-view-full'),
    themeToggle: document.getElementById('theme-toggle'),
    screenToggle: document.getElementById('screen-toggle'),
    profileTrigger: document.getElementById('profile-trigger'),
    topbarVersion: document.getElementById('topbar-version'),
    topbarStudyName: document.getElementById('topbar-study-name'),
    topbarStudyMeta: document.getElementById('topbar-study-meta'),
    topbarProfileLabel: document.getElementById('topbar-profile-label'),
    topbarProfileMeta: document.getElementById('topbar-profile-meta'),
    workspaceTitle: document.getElementById('workspace-title'),
    workspaceSubtitle: document.getElementById('workspace-subtitle'),
    workspaceHero: document.getElementById('workspace-hero'),
    workspaceBoard: document.getElementById('workspace-board'),
    variablesPanel: document.getElementById('variables-panel'),
    analysisPanel: document.getElementById('analysis-panel'),
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
    accAcquisitionBody: document.getElementById('acc-acquisition-body'),
    accAcquisitionContent: document.getElementById('acc-acquisition-content'),
    accAcquisitionSummary: document.getElementById('acc-acquisition-summary'),
    accPostAchatBody: document.getElementById('acc-postachat-body'),
    accPostAchatContent: document.getElementById('acc-postachat-content'),
    accPostAchatSummary: document.getElementById('acc-postachat-summary'),
    ownedSynthese: document.getElementById('owned-synthese'),
    ownedVerdict: document.getElementById('owned-verdict'),
    ownedCfTableWrap: document.getElementById('owned-cf-table-wrap'),
    ownedTravauxContent: document.getElementById('owned-travaux-content'),
    ownedDeleteModal: document.getElementById('owned-delete-modal'),
    ownedDeleteModalName: document.getElementById('owned-delete-modal-name'),
    ownedDeleteModalInput: document.getElementById('owned-delete-modal-input'),
    ownedDeleteModalCancel: document.getElementById('owned-delete-modal-cancel'),
    ownedDeleteModalConfirm: document.getElementById('owned-delete-modal-confirm'),
    accSimulateurBody: document.getElementById('acc-simulateur-body'),
    accSimulateurContent: document.getElementById('acc-simulateur-content'),
    accSimulateurSummary: document.getElementById('acc-simulateur-summary'),
    ownedAiDrawer: document.getElementById('owned-ai-drawer'),
    ownedAiOverlay: document.getElementById('owned-ai-overlay'),
    ownedAiDrawerContent: document.getElementById('owned-ai-drawer-content'),
    ownedAiDrawerClose: document.getElementById('owned-ai-drawer-close'),
    variablesKicker: document.getElementById('variables-kicker'),
    variablesSubtitle: document.getElementById('variables-subtitle'),
    variablesContext: document.getElementById('variables-context'),
    variablesForm: document.getElementById('variables-form'),
    decisionThesisError: document.getElementById('decision-thesis-error'),
    decisionNextStepError: document.getElementById('decision-next-step-error'),
    newAsset: document.getElementById('new-asset'),
    saveAsset: document.getElementById('save-asset'),
    exportDecisionPdf: document.getElementById('export-decision-pdf'),
    analysisKicker: document.getElementById('analysis-kicker'),
    analysisSubtitle: document.getElementById('analysis-subtitle'),
    analysisStickySummary: document.getElementById('analysis-sticky-summary'),
    analysisAcquisitionDecision: document.getElementById('analysis-acquisition-decision'),
    analysisConfidence: document.getElementById('analysis-confidence'),
    analysisScenarios: document.getElementById('analysis-scenarios'),
    analysisJournal: document.getElementById('analysis-journal'),
    analysisMetrics: document.getElementById('analysis-metrics'),
    analysisMonthlyChart: document.getElementById('analysis-monthly-chart'),
    analysisCostChart: document.getElementById('analysis-cost-chart'),
    analysisTimelineChart: document.getElementById('analysis-timeline-chart'),
    analysisPriceRentMatrix: document.getElementById('analysis-price-rent-matrix'),
    analysisRegimeTable: document.getElementById('analysis-regime-table'),
    analysisSensitivityTable: document.getElementById('analysis-sensitivity-table'),
    analysisCashflowTable: document.getElementById('analysis-cashflow-table'),
    analysisSummary: document.getElementById('analysis-summary'),
    analysisActionPlan: document.getElementById('analysis-action-plan'),
    analysisDetails: document.getElementById('analysis-details'),
    portfolioAiDrawer: document.getElementById('portfolio-ai-drawer'),
    portfolioAiOverlay: document.getElementById('portfolio-ai-overlay'),
    portfolioAiDrawerContent: document.getElementById('portfolio-ai-drawer-content'),
    assetStatusBar: document.getElementById('asset-status-bar'),
    profileModal: document.getElementById('profile-modal'),
    profileClose: document.getElementById('profile-close'),
    profileSkip: document.getElementById('profile-skip'),
    profileSave: document.getElementById('profile-save'),
    profileModalNote: document.getElementById('profile-modal-note'),
    profileSelect: document.getElementById('profile-select'),
    profileForm: document.getElementById('profile-form'),
    profileName: document.getElementById('profile-name'),
    profileIncome: document.getElementById('profile-income'),
    profileIncomeHint: document.getElementById('profile-income-hint'),
    profileIncomeUnitMensuel: document.getElementById('profile-income-unit-mensuel'),
    profileIncomeUnitAnnuel: document.getElementById('profile-income-unit-annuel'),
    profileAdults: document.getElementById('profile-adults'),
    profileChildren: document.getElementById('profile-children'),
    profileObjectifCF: document.getElementById('profile-objectif-cf'),
    profileRevaloAnnuelle: document.getElementById('profile-revalo-annuelle'),
    autreCreditDrawerOverlay: document.getElementById('autre-credit-drawer-overlay'),
    autreCreditDrawer: document.getElementById('autre-credit-drawer'),
    autreCreditDrawerId: document.getElementById('autre-credit-drawer-id'),
    autreCreditLibelle: document.getElementById('autre-credit-libelle'),
    autreCreditMensualite: document.getElementById('autre-credit-mensualite'),
    autreCreditMensualiteHa: document.getElementById('autre-credit-mensualite-ha'),
    autreCreditDateDebut: document.getElementById('autre-credit-date-debut'),
    autreCreditDateFin: document.getElementById('autre-credit-date-fin'),
    autreCreditCrd: document.getElementById('autre-credit-crd'),
    profileParts: document.getElementById('profile-parts'),
    profileTmi: document.getElementById('profile-tmi'),
    profileComposition: document.getElementById('profile-composition'),
    themeMeta: document.querySelector('meta[name="theme-color"]'),
    fkpiRdtBrut: document.getElementById('fkpi-rdt-brut'),
    fkpiCfNet: document.getElementById('fkpi-cf-net'),
    fkpiDscr: document.getElementById('fkpi-dscr'),
    financeLiveCredit: document.getElementById('finance-live-credit'),
    financeLiveInsurance: document.getElementById('finance-live-insurance'),
    financeLiveTotal: document.getElementById('finance-live-total'),
    guidedToggle: document.getElementById('guided-toggle'),
    modeToggle: document.getElementById('mode-toggle'),
    modeBtnGuided: document.getElementById('mode-btn-guided'),
    modeBtnFull: document.getElementById('mode-btn-full'),
    guidedModeBody: document.getElementById('guided-mode-body'),
    guidedStepsBar: document.getElementById('guided-steps-bar'),
    guidedProgressFill: document.getElementById('guided-progress-fill'),
    guidedStepContent: document.getElementById('guided-step-content'),
    analysisCFWaterfall: document.getElementById('analysis-cf-waterfall'),
    tutoBar: document.getElementById('tuto-bar'),
    tutoTooltip: document.getElementById('tuto-tooltip'),
    tutoStepLabel: document.getElementById('tuto-step-label'),
    tutoBarTitle: document.getElementById('tuto-bar-title'),
    tutoBarDesc: document.getElementById('tuto-bar-desc'),
    tutoPrev: document.getElementById('tuto-prev'),
    tutoNext: document.getElementById('tuto-next'),
};

function getPanelMode() {
    const panel = new URLSearchParams(window.location.search).get('panel');
    return panel === 'analysis' ? 'analysis' : 'workspace';
}

function buildPanelUrl(panel) {
    const url = new URL(window.location.href);
    if (panel === 'analysis') {
        url.searchParams.set('panel', 'analysis');
    } else {
        url.searchParams.delete('panel');
    }
    return url.toString();
}

function loadTheme() {
    const savedTheme = localStorage.getItem(STORAGE_KEYS.theme);
    if (savedTheme === 'light' || savedTheme === 'dark') {
        return savedTheme;
    }
    return 'dark';
}

function loadScreens() {
    const savedValue = Number.parseInt(localStorage.getItem(STORAGE_KEYS.screens) || '1', 10);
    return savedValue === 1 ? 1 : 2;
}

function loadProfilePreset() {
    const savedProfile = localStorage.getItem(STORAGE_KEYS.profilePreset);
    return PROFILE_OPTIONS.some(profile => profile.key === savedProfile) ? savedProfile : 'famille';
}

function loadProfileConfigured() {
    return localStorage.getItem(STORAGE_KEYS.profileConfigured) === '1';
}

function getProfileOption(profileKey) {
    return PROFILE_OPTIONS.find(profile => profile.key === profileKey) || PROFILE_OPTIONS[0];
}

function createProfileData(profileKey) {
    return sanitizeProfileData(getProfileOption(profileKey).defaults);
}

function loadProfileData(profileKey) {
    const profile = getProfileOption(profileKey);
    const defaults = profile.defaults;

    try {
        const savedData = JSON.parse(localStorage.getItem(STORAGE_KEYS.profileData) || 'null');
        if (savedData && typeof savedData === 'object') {
            return sanitizeProfileData({ ...defaults, ...savedData });
        }
    } catch (error) {
        // Ignore malformed local data and fall back to defaults.
    }

    return sanitizeProfileData(defaults);
}

function loadVariablesData() {
    try {
        const savedData = JSON.parse(localStorage.getItem(STORAGE_KEYS.variablesData) || 'null');
        if (savedData && typeof savedData === 'object') {
            return sanitizeVariablesData({ ...VARIABLE_DEFAULTS, ...savedData });
        }
    } catch (error) {
        // Ignore malformed local data and fall back to defaults.
    }

    return sanitizeVariablesData(VARIABLE_DEFAULTS);
}

function loadSparkMode() {
    const saved = localStorage.getItem(STORAGE_KEYS.sparkMode);
    return saved === 'guided' ? 'guided' : 'full';
}

function saveSparkMode(mode) {
    localStorage.setItem(STORAGE_KEYS.sparkMode, mode);
}

function renderModeSwitch(mode) {
    if (!nodes.modeBtnGuided || !nodes.modeBtnFull) return;
    const isGuided = mode === 'guided';

    nodes.modeBtnGuided.setAttribute('aria-pressed', String(isGuided));
    nodes.modeBtnFull.setAttribute('aria-pressed', String(!isGuided));

    if (nodes.variablesForm) nodes.variablesForm.hidden = isGuided;
    if (nodes.guidedModeBody) nodes.guidedModeBody.hidden = !isGuided;

    if (isGuided) {
        renderGuidedSteps(state.guidedStepIndex ?? 0);
        renderGuidedStep(state.guidedStepIndex ?? 0);
    }
}

function renderGuidedSteps(currentIndex) {
    if (!nodes.guidedStepsBar || !nodes.guidedProgressFill) return;

    const total = WIZARD_STEPS.length;
    let html = '';
    for (let i = 0; i < total; i++) {
        const stepState = i < currentIndex ? 'done' : (i === currentIndex ? 'active' : '');
        const label = i < currentIndex ? '✓' : String(i + 1);
        html += `<div class="guided-step-pip ${stepState ? 'guided-step-pip--' + stepState : ''}" aria-label="Étape ${i + 1}">${escapeHtml(label)}</div>`;
        if (i < total - 1) {
            html += `<div class="guided-step-line ${i < currentIndex ? 'guided-step-line--done' : ''}"></div>`;
        }
    }
    nodes.guidedStepsBar.innerHTML = html;
    nodes.guidedProgressFill.style.width = `${(currentIndex / total) * 100}%`;
}

function renderGuidedStep(index) {
    if (!nodes.guidedStepContent) return;

    const step = WIZARD_STEPS[index];
    if (!step) return;

    const total = WIZARD_STEPS.length;
    const isFirst = index === 0;
    const isLast = index === total - 1;

    const REGIME_OPTIONS = [
        { value: 'micro-foncier', label: 'Micro-foncier' },
        { value: 'reel', label: 'Foncier réel' },
        { value: 'sci-is', label: "SCI à l'IS" }
    ];

    const fieldsHtml = step.fields.map(f => {
        const currentVal = state.variablesData[f.id] ?? VARIABLE_DEFAULTS[f.id] ?? '';
        let inputHtml;
        if (f.type === 'select' && f.id === 'regime') {
            const opts = REGIME_OPTIONS.map(o =>
                `<option value="${escapeHtml(o.value)}" ${currentVal === o.value ? 'selected' : ''}>${escapeHtml(o.label)}</option>`
            ).join('');
            inputHtml = `<select id="guided-field-${escapeHtml(f.id)}" name="${escapeHtml(f.id)}" class="variables-input">${opts}</select>`;
        } else {
            inputHtml = `<input id="guided-field-${escapeHtml(f.id)}" name="${escapeHtml(f.id)}" type="${escapeHtml(f.type)}" class="variables-input" value="${escapeHtml(String(currentVal))}">`;
        }
        return `
        <div class="guided-field">
            <label for="guided-field-${escapeHtml(f.id)}">${escapeHtml(f.label)}</label>
            ${inputHtml}
            <span class="guided-field__hint">${escapeHtml(f.hint)}</span>
        </div>`;
    }).join('');

    nodes.guidedStepContent.innerHTML = `
        <div class="guided-step-num">ÉTAPE ${step.num} / ${total}</div>
        <h3 class="guided-step-title">${escapeHtml(step.title)}</h3>
        <p class="guided-step-desc">${escapeHtml(step.desc)}</p>
        ${fieldsHtml}
        <div class="guided-step-actions">
            ${!isFirst ? `<button type="button" class="guided-btn-ghost" id="guided-prev">← Retour</button>` : ''}
            <button type="button" class="guided-btn-gold" id="guided-next">${isLast ? 'Terminer ✓' : 'Suivant →'}</button>
        </div>
    `;

    const prevBtn = nodes.guidedStepContent.querySelector('#guided-prev');
    const nextBtn = nodes.guidedStepContent.querySelector('#guided-next');

    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            syncGuidedFieldsToForm();
            state.guidedStepIndex = Math.max(0, index - 1);
            renderGuidedSteps(state.guidedStepIndex);
            renderGuidedStep(state.guidedStepIndex);
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            syncGuidedFieldsToForm();
            if (isLast) {
                state.sparkMode = 'full';
                saveSparkMode('full');
                renderModeSwitch('full');
            } else {
                state.guidedStepIndex = Math.min(total - 1, index + 1);
                renderGuidedSteps(state.guidedStepIndex);
                renderGuidedStep(state.guidedStepIndex);
            }
        });
    }
}

function syncGuidedFieldsToForm() {
    if (!nodes.variablesForm) return;
    const guidedInputs = nodes.guidedStepContent
        ? nodes.guidedStepContent.querySelectorAll('[name]')
        : [];
    guidedInputs.forEach(guidedInput => {
        const formField = nodes.variablesForm.elements.namedItem(guidedInput.name);
        if (formField) {
            formField.value = guidedInput.value;
            formField.dispatchEvent(new Event('input', { bubbles: true }));
        }
    });
}

function loadAssetRecords() {
    try {
        const savedAssets = JSON.parse(localStorage.getItem(STORAGE_KEYS.assetRecords) || 'null');
        if (Array.isArray(savedAssets)) {
            return savedAssets
                .map(sanitizeAssetRecord)
                .filter(Boolean);
        }
    } catch (error) {
        // Ignore malformed local data and fall back to empty array.
    }

    return [];
}

function loadActiveAssetId() {
    const savedValue = localStorage.getItem(STORAGE_KEYS.activeAssetId);
    return typeof savedValue === 'string' && savedValue ? savedValue : null;
}

function normalizeLegacyCopy(value) {
    const text = String(value || '').trim();

    if (text === 'Bien a etudier') {
        return VARIABLE_DEFAULTS['nom-bien'];
    }

    if (text === 'Ville non renseignee') {
        return VARIABLE_DEFAULTS.ville;
    }

    if (text === 'Personnalise') {
        return 'Personnalisé';
    }

    return text;
}

function sanitizeProfileData(rawProfile) {
    return {
        name: normalizeLegacyCopy(rawProfile.name || 'Profil') || 'Profil',
        income: Math.max(0, Number(rawProfile.income) || 0),
        incomeUnit: rawProfile.incomeUnit === 'annuel' ? 'annuel' : 'mensuel',
        adults: Math.min(2, Math.max(1, Number(rawProfile.adults) || 1)),
        children: Math.max(0, Math.round(Number(rawProfile.children) || 0)),
        objectifCF: Math.max(0, Number(rawProfile.objectifCF) || 1000),
        revaloAnnuelle: Math.max(0, Math.min(20, Number(rawProfile.revaloAnnuelle) || 2)),
        autresCredits: Array.isArray(rawProfile.autresCredits) ? rawProfile.autresCredits : []
    };
}

function getTypeBienDefaults(type) {
    if (type === 'maison') return { copro: 0, 'seuil-cf-min': 50, 'seuil-dscr-min': 1.0, 'seuil-vacance-max': 8, 'seuil-effort-max': 10, gestion: 5 };
    if (type === 'immeuble') return { copro: 0, 'seuil-cf-min': 150, 'seuil-dscr-min': 1.10, 'seuil-vacance-max': 10, 'seuil-effort-max': 12, gestion: 8 };
    return { copro: 40, 'seuil-cf-min': 0, 'seuil-dscr-min': 1.0, 'seuil-vacance-max': 8, 'seuil-effort-max': 10, gestion: 7 };
}

function sanitizeVariablesData(rawVariables) {
    return {
        'nom-bien': normalizeLegacyCopy(rawVariables['nom-bien'] || VARIABLE_DEFAULTS['nom-bien']) || VARIABLE_DEFAULTS['nom-bien'],
        'type-bien': TYPE_BIEN_VALUES.has(rawVariables['type-bien']) ? rawVariables['type-bien'] : 'appartement',
        ville: normalizeLegacyCopy(rawVariables.ville || VARIABLE_DEFAULTS.ville) || VARIABLE_DEFAULTS.ville,
        adresse: String(rawVariables.adresse || '').trim(),
        prix: Math.max(0, Number(rawVariables.prix) || 0),
        nego: Math.max(0, Number(rawVariables.nego) || 0),
        loyer: Math.max(0, Number(rawVariables.loyer) || 0),
        notaire: Math.max(0, Number(rawVariables.notaire) || 0),
        travaux: Math.max(0, Number(rawVariables.travaux) || 0),
        meubles: Math.max(0, Number(rawVariables.meubles) || 0),
        agence: Math.max(0, Number(rawVariables.agence) || 0),
        dpe: DPE_VALUES.has(String(rawVariables.dpe || '').toUpperCase()) ? String(rawVariables.dpe).toUpperCase() : 'D',
        'loyer-marche': Math.max(0, Number(rawVariables['loyer-marche']) || Number(rawVariables.loyer) || 0),
        'copro-risque': COPRO_RISK_VALUES.has(rawVariables['copro-risque']) ? rawVariables['copro-risque'] : 'stable',
        'source-loyer': SOURCE_STATUS_VALUES.has(rawVariables['source-loyer']) ? rawVariables['source-loyer'] : 'estimated',
        'source-charges': SOURCE_STATUS_VALUES.has(rawVariables['source-charges']) ? rawVariables['source-charges'] : 'estimated',
        'source-travaux': SOURCE_STATUS_VALUES.has(rawVariables['source-travaux']) ? rawVariables['source-travaux'] : 'estimated',
        'source-documents': SOURCE_STATUS_VALUES.has(rawVariables['source-documents']) ? rawVariables['source-documents'] : 'unknown',
        apport: Math.max(0, Number(rawVariables.apport) || 0),
        'taux-input': Math.max(0, Number(rawVariables['taux-input']) || 0),
        duree: Math.max(1, Number(rawVariables.duree) || 1),
        assurance: Math.max(0, Number(rawVariables.assurance) || 0),
        'frais-bancaires': Math.max(0, Number(rawVariables['frais-bancaires']) || 0),
        vacance: Math.max(0, Number(rawVariables.vacance) || 0),
        copro: Math.max(0, Number(rawVariables.copro) || 0),
        fonciere: Math.max(0, Number(rawVariables.fonciere) || 0),
        pno: Math.max(0, Number(rawVariables.pno) || 0),
        gestion: Math.max(0, Number(rawVariables.gestion) || 0),
        'seuil-cf-min': Number(rawVariables['seuil-cf-min']) || 0,
        'seuil-dscr-min': Math.max(0.5, Number(rawVariables['seuil-dscr-min']) || 1),
        'seuil-vacance-max': Math.max(0, Number(rawVariables['seuil-vacance-max']) || 0),
        'seuil-ecart-loyer-max': Math.max(0, Number(rawVariables['seuil-ecart-loyer-max']) || 0),
        'seuil-effort-max': Math.max(1, Number(rawVariables['seuil-effort-max']) || 1),
        'blocage-passoire': PASSOIRE_POLICY_VALUES.has(rawVariables['blocage-passoire']) ? rawVariables['blocage-passoire'] : 'yes',
        regime: REGIME_VALUES.has(rawVariables.regime) ? rawVariables.regime : 'reel',
        'decision-thesis': String(rawVariables['decision-thesis'] || '').trim(),
        'decision-next-step': String(rawVariables['decision-next-step'] || '').trim(),
        'annee-achat': rawVariables['annee-achat']
            ? Math.max(1900, Math.min(new Date().getFullYear(), Math.round(Number(rawVariables['annee-achat']))))
            : null
    };
}

function sanitizeAssetRecord(rawAsset) {
    if (!rawAsset || typeof rawAsset !== 'object') {
        return null;
    }

    return {
        id: typeof rawAsset.id === 'string' && rawAsset.id ? rawAsset.id : createAssetId(),
        variablesData: sanitizeVariablesData({ ...VARIABLE_DEFAULTS, ...(rawAsset.variablesData || {}) }),
        createdAt: Number(rawAsset.createdAt) || Date.now(),
        updatedAt: Number(rawAsset.updatedAt) || Date.now()
    };
}

function createAssetId() {
    return `asset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function saveProfileData() {
    localStorage.setItem(STORAGE_KEYS.profileData, JSON.stringify(state.profileData));
}

function saveVariablesData() {
    localStorage.setItem(STORAGE_KEYS.variablesData, JSON.stringify(state.variablesData));
}

function saveAssetRecords() {
    localStorage.setItem(STORAGE_KEYS.assetRecords, JSON.stringify(state.assetRecords));
}

function saveActiveAssetId() {
    if (state.activeAssetId) {
        localStorage.setItem(STORAGE_KEYS.activeAssetId, state.activeAssetId);
    } else {
        localStorage.removeItem(STORAGE_KEYS.activeAssetId);
    }
}

function emitStateUpdate() {
    localStorage.setItem(STORAGE_KEYS.syncTick, String(Date.now()));
    if (syncChannel) {
        syncChannel.postMessage({ type: 'state-update' });
    }
}

function refreshStateFromStorage() {
    const nextPreset = loadProfilePreset();
    state.theme = loadTheme();
    state.screens = loadScreens();
    state.profilePreset = nextPreset;
    state.profileData = loadProfileData(nextPreset);
    state.profileConfigured = loadProfileConfigured();
    state.variablesData = loadVariablesData();
    state.assetRecords = loadAssetRecords();
    state.activeAssetId = loadActiveAssetId();

    if (state.activeAssetId && !state.assetRecords.some(asset => asset.id === state.activeAssetId)) {
        state.activeAssetId = null;
        saveActiveAssetId();
    }

    if (!IS_ANALYSIS_WINDOW && state.screens === 1) {
        closeAnalysisWindow();
    }

    render();
}

function setupCrossWindowSync() {
    if ('BroadcastChannel' in window) {
        syncChannel = new BroadcastChannel('investissement-web-sync');
        syncChannel.addEventListener('message', event => {
            if (event.data && event.data.type === 'state-update') {
                refreshStateFromStorage();
            }
        });
    }

    window.addEventListener('storage', event => {
        if (event.key && STORAGE_SYNC_KEYS.has(event.key)) {
            refreshStateFromStorage();
        }
    });
}

function getProfileComposition(profileData) {
    return `${profileData.adults} adulte${profileData.adults > 1 ? 's' : ''} · ${profileData.children} enfant${profileData.children > 1 ? 's' : ''}`;
}

function getDecisionJournalFields() {
    return {
        thesisField: nodes.variablesForm.elements.namedItem('decision-thesis'),
        nextStepField: nodes.variablesForm.elements.namedItem('decision-next-step')
    };
}

function setDecisionJournalFieldState(field, errorNode, message) {
    const hasError = Boolean(message);

    if (field) {
        field.setCustomValidity(hasError ? message : '');
        field.setAttribute('aria-invalid', hasError ? 'true' : 'false');
    }

    if (errorNode) {
        errorNode.textContent = message;
        errorNode.hidden = !hasError;
    }
}

function syncDecisionJournalValidity(options = {}) {
    const { force = false } = options;
    const { thesisField, nextStepField } = getDecisionJournalFields();
    const thesisValue = String(thesisField?.value || '').trim();
    const nextStepValue = String(nextStepField?.value || '').trim();
    const thesisTouched = force || thesisField?.dataset.touched === 'true';
    const nextStepTouched = force || nextStepField?.dataset.touched === 'true';
    const thesisMessage = thesisValue.length >= 20
        ? ''
        : (thesisTouched
            ? (thesisValue.length
                ? 'Renseignez une thèse d\'investissement d au moins 20 caractères.'
                : 'La thèse d\'investissement est requise pour enregistrer ce dossier.')
            : '');
    const nextStepMessage = nextStepValue.length >= 10
        ? ''
        : (nextStepTouched
            ? (nextStepValue.length
                ? 'Précisez la prochaine étape avec au moins 10 caractères.'
                : 'La prochaine étape est requise pour enregistrer ce dossier.')
            : '');

    setDecisionJournalFieldState(thesisField, nodes.decisionThesisError, thesisMessage);
    setDecisionJournalFieldState(nextStepField, nodes.decisionNextStepError, nextStepMessage);

    return { thesisMessage, nextStepMessage };
}

function openAccordionForField(field) {
    const section = field.closest('.accord-section');
    if (!section || section.dataset.open === 'true') return;
    section.dataset.open = 'true';
    const btn = section.querySelector('.accord-head');
    if (btn) btn.setAttribute('aria-expanded', 'true');
}

function validateDecisionJournalBeforeSave() {
    const { thesisField, nextStepField } = getDecisionJournalFields();
    if (thesisField) {
        thesisField.dataset.touched = 'true';
    }
    if (nextStepField) {
        nextStepField.dataset.touched = 'true';
    }

    const { thesisMessage, nextStepMessage } = syncDecisionJournalValidity({ force: true });

    if (thesisMessage && thesisField) {
        openAccordionForField(thesisField);
        thesisField.reportValidity();
        thesisField.focus();
        return false;
    }

    if (nextStepMessage && nextStepField) {
        openAccordionForField(nextStepField);
        nextStepField.reportValidity();
        nextStepField.focus();
        return false;
    }

    return true;
}

function getCurrentAssetName() {
    return state.variablesData['nom-bien'] || VARIABLE_DEFAULTS['nom-bien'];
}

function getProfileDisplayName() {
    return state.profileConfigured ? state.profileData.name : 'Profil incomplet';
}

function getProfileContextSummary() {
    const composition = getProfileComposition(state.profileData);

    if (state.profileConfigured) {
        return `Profil : ${state.profileData.name} · ${formatCurrency(state.profileData.income)} · ${composition}`;
    }

    return `Profil provisoire · ${formatCurrency(state.profileData.income)} · ${composition}`;
}

function getWorkspaceModeLabel({ useLocalFallback = false } = {}) {
    if (IS_ANALYSIS_WINDOW) return 'Vue analyse synchronisée';
    if (state.screens === 1) return 'Vue intégrée';
    if (useLocalFallback) return 'Vue locale';
    return 'Vue séparée';
}

function isEssentialDataMissing() {
    const prix = Number(state.variablesData?.prix) || 0;
    const loyer = Number(state.variablesData?.loyer) || 0;
    return prix <= 0 || loyer <= 0;
}

function buildNeutralAnalysisPlaceholder() {
    return `
        <div class="analysis-neutral-card">
            <h2>Renseignez le prix et le loyer</h2>
            <p>L'analyse démarre dès que le prix affiché et le loyer cible sont renseignés dans le formulaire ci-dessous.</p>
        </div>
    `;
}

function buildWorkspaceHero(analysisModel, { tmi, composition, useLocalFallback = false } = {}) {
    if (!nodes.workspaceHero) {
        return;
    }
    if (isEssentialDataMissing()) {
        nodes.workspaceHero.innerHTML = buildNeutralAnalysisPlaceholder();
        return;
    }

    const { acquisitionDecision, metrics, confidenceModel, scenarioModel, decisionThresholds } = analysisModel;
    const cityLabel = state.variablesData.ville || VARIABLE_DEFAULTS.ville;
    const typeLabel = getTypeBienLabel(state.variablesData['type-bien']);
    const priceGap = acquisitionDecision.currentPrice - acquisitionDecision.maxOfferPrice;
    const priceGapLabel = priceGap <= 0 ? 'Marge sous plafond' : 'Écart au plafond';
    const priceGapValue = priceGap === 0 ? 'Aligné' : formatPlainCurrency(Math.abs(priceGap));
    const dscrTone = metrics.dscr >= decisionThresholds.minDscr
        ? 'positive'
        : metrics.dscr >= Math.max(0.85, decisionThresholds.minDscr - 0.15)
            ? 'watch'
            : 'negative';
    const actionNote = priceGap <= 0
        ? 'Prix affiché compatible avec le plafond cible.'
        : `${priceGapLabel} : ${priceGapValue}`;
    const profileTone = state.profileConfigured ? 'ready' : 'pending';

    nodes.workspaceHero.innerHTML = `
        <div class="workspace-hero-card workspace-hero-card--decision workspace-hero-card--${acquisitionDecision.tone}">
            <div class="workspace-hero-decision__main">
                <div class="workspace-hero-decision__eyebrow">
                    <span class="workspace-hero-decision__kicker">Évaluation du dossier</span>
                    <span class="workspace-hero-decision__mode">${escapeHtml(getWorkspaceModeLabel({ useLocalFallback }))}</span>
                    <span class="workspace-hero-decision__profile workspace-hero-decision__profile--${profileTone}">${state.profileConfigured ? 'Profil validé' : 'Profil incomplet'}</span>
                </div>
                <div class="workspace-hero-decision__heading">
                    <span class="workspace-hero-decision__study">${escapeHtml(getCurrentAssetName())}</span>
                    <h2>${escapeHtml(acquisitionDecision.label)}</h2>
                </div>
                <p class="workspace-hero-decision__summary">${escapeHtml(acquisitionDecision.summary)}</p>
                <div class="workspace-hero-decision__action">
                    <span>Recommandation</span>
                    <strong>${escapeHtml(acquisitionDecision.action)}</strong>
                    <small>${escapeHtml(actionNote)}</small>
                </div>
                <div class="workspace-hero-decision__facts">
                    <article class="workspace-hero-decision__fact">
                        <span>Dossier</span>
                        <strong>${escapeHtml(cityLabel)} · ${escapeHtml(typeLabel)}</strong>
                    </article>
                    <article class="workspace-hero-decision__fact">
                        <span>Profil</span>
                        <strong>${escapeHtml(getProfileDisplayName())} · ${escapeHtml(composition)} · TMI ${tmi} %</strong>
                    </article>
                    <article class="workspace-hero-decision__fact">
                        <span>Contrôles</span>
                        <strong>Fiabilité ${escapeHtml(confidenceModel.label)} · Stress ${escapeHtml(scenarioModel.label)}</strong>
                    </article>
                </div>
            </div>
            <aside class="workspace-hero-decision__aside">
                <div class="workspace-hero-decision__scoreline">
                    <span class="workspace-hero-score-label">Indice de décision</span>
                    <div class="workspace-hero-decision__scorepack">
                        <strong class="workspace-hero-score-value workspace-hero-score-value--${acquisitionDecision.tone}">${acquisitionDecision.score}<small>/100</small></strong>
                        <span class="decision-badge decision-badge--${acquisitionDecision.tone}">${escapeHtml(acquisitionDecision.label)}</span>
                    </div>
                </div>
                <div class="workspace-hero-decision__kpis">
                    <article class="workspace-hero-decision__kpi">
                        <span>Seuil d'offre</span>
                        <strong class="workspace-hero-decision__kpi-value workspace-hero-decision__kpi-value--gold">${formatPlainCurrency(acquisitionDecision.maxOfferPrice)}</strong>
                    </article>
                    <article class="workspace-hero-decision__kpi">
                        <span>Cash-flow net / mois</span>
                        <strong class="workspace-hero-decision__kpi-value workspace-hero-decision__kpi-value--${metrics.cfNetNet >= 0 ? 'positive' : 'negative'}">${formatSignedCurrency(metrics.cfNetNet)}</strong>
                    </article>
                    <article class="workspace-hero-decision__kpi">
                        <span>DSCR</span>
                        <strong class="workspace-hero-decision__kpi-value workspace-hero-decision__kpi-value--${dscrTone}">${formatRatio(metrics.dscr)}</strong>
                    </article>
                </div>
            </aside>
        </div>
    `;
}

function getCurrentAnalysisModel() {
    return computeAnalysisViewModel({
        ...state.variablesData,
        revenus: state.profileData.income,
        adults: state.profileData.adults,
        children: state.profileData.children
    });
}

function formatCheckpointValue(checkpoint) {
    if (checkpoint.kind === 'currency') {
        return formatSignedCurrency(checkpoint.value);
    }
    if (checkpoint.kind === 'ratio') {
        return formatRatio(checkpoint.value);
    }
    if (checkpoint.kind === 'percent') {
        return formatPercent(checkpoint.value);
    }
    return String(checkpoint.value);
}

function buildBarChartMarkup(items) {
    const maxValue = Math.max(1, ...items.map(item => Math.abs(item.value)));
    return `
        <div class="chart-list">
            ${items.map(item => {
                const formattedValue = item.signedValue !== undefined
                    ? formatSignedCurrency(item.signedValue)
                    : formatCurrency(item.value);
                const width = Math.max(6, Math.round((Math.abs(item.value) / maxValue) * 100));
                return `
                    <div class="chart-row">
                        <div class="chart-meta">
                            <span>${item.label}</span>
                            <strong>${formattedValue}</strong>
                        </div>
                        <div class="chart-track">
                            <div class="chart-fill chart-fill--${item.kind}" style="width: ${width}%"></div>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

function buildSvgPath(points) {
    return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
}

function buildProjectionChart(projection) {
    const width = 760;
    const height = 280;
    const padding = { top: 18, right: 18, bottom: 34, left: 56 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const series = [
        { key: 'cumulativeCashflow', label: 'CF cumulé', tone: 'cashflow' },
        { key: 'cumulativePrincipal', label: 'Capital remboursé', tone: 'principal' },
        { key: 'traction', label: 'Valeur créée', tone: 'wealth' }
    ];
    const values = projection.years.flatMap(item => series.map(seriesItem => item[seriesItem.key]));
    const minValue = Math.min(0, ...values);
    const maxValue = Math.max(0, ...values);
    const valueRange = Math.max(1, maxValue - minValue);
    const tickCount = 5;
    const finalYear = projection.years[projection.years.length - 1] || {
        cumulativeCashflow: 0,
        cumulativePrincipal: 0,
        traction: 0
    };

    const xForIndex = index => padding.left + (projection.years.length <= 1 ? plotWidth / 2 : (plotWidth * index) / (projection.years.length - 1));
    const yForValue = value => padding.top + ((maxValue - value) / valueRange) * plotHeight;
    const tickValues = Array.from({ length: tickCount }, (_, index) => maxValue - ((valueRange / (tickCount - 1)) * index));

    return `
        <div class="timeline-chart">
            <div class="timeline-summary">
                <div class="timeline-pill">
                    <span>Projection</span>
                    <strong>${projection.horizonYears} ans</strong>
                </div>
                <div class="timeline-pill">
                    <span>CF cumulé</span>
                    <strong>${formatSignedCurrency(finalYear.cumulativeCashflow)}</strong>
                </div>
                <div class="timeline-pill">
                    <span>Capital remboursé</span>
                    <strong>${formatCurrency(finalYear.cumulativePrincipal)}</strong>
                </div>
                <div class="timeline-pill">
                    <span>Valeur créée</span>
                    <strong>${formatSignedCurrency(finalYear.traction)}</strong>
                </div>
            </div>
            <div class="timeline-legend">
                ${series.map(item => `
                    <span class="timeline-legend-item">
                        <span class="timeline-swatch timeline-swatch--${item.tone}"></span>
                        <span>${item.label}</span>
                    </span>
                `).join('')}
            </div>
            <svg viewBox="0 0 ${width} ${height}" class="timeline-svg" aria-label="Projection pluriannuelle">
                ${tickValues.map(value => `
                    <g>
                        <line class="timeline-grid-line" x1="${padding.left}" y1="${yForValue(value).toFixed(1)}" x2="${width - padding.right}" y2="${yForValue(value).toFixed(1)}"></line>
                        <text class="timeline-axis-text" x="${padding.left - 10}" y="${(yForValue(value) + 4).toFixed(1)}" text-anchor="end">${formatCompactCurrency(value)}</text>
                    </g>
                `).join('')}
                ${(minValue < 0 && maxValue > 0) ? `<line class="timeline-zero-line" x1="${padding.left}" y1="${yForValue(0).toFixed(1)}" x2="${width - padding.right}" y2="${yForValue(0).toFixed(1)}"></line>` : ''}
                ${projection.years.map((item, index) => `
                    <text class="timeline-axis-text" x="${xForIndex(index).toFixed(1)}" y="${height - 8}" text-anchor="middle">A${item.year}</text>
                `).join('')}
                ${series.map(seriesItem => {
                    const points = projection.years.map((item, index) => ({
                        x: xForIndex(index),
                        y: yForValue(item[seriesItem.key])
                    }));
                    return `
                        <path class="timeline-path timeline-path--${seriesItem.tone}" d="${buildSvgPath(points)}"></path>
                        ${points.map(point => `
                            <circle class="timeline-dot timeline-dot--${seriesItem.tone}" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="3.5"></circle>
                        `).join('')}
                    `;
                }).join('')}
            </svg>
        </div>
    `;
}

function getMatrixToneClass(value) {
    if (value >= 100) return 'excellent';
    if (value >= 0) return 'positive';
    if (value >= -100) return 'watch';
    return 'negative';
}

function buildPriceRentMatrixMarkup(matrix) {
    return `
        <div class="matrix-shell">
            <div class="matrix-legend">
                <span class="matrix-legend-item"><span class="matrix-legend-swatch matrix-legend-swatch--excellent"></span>Favorable</span>
                <span class="matrix-legend-item"><span class="matrix-legend-swatch matrix-legend-swatch--positive"></span>Recevable</span>
                <span class="matrix-legend-item"><span class="matrix-legend-swatch matrix-legend-swatch--watch"></span>Réviser</span>
                <span class="matrix-legend-item"><span class="matrix-legend-swatch matrix-legend-swatch--negative"></span>Écarter</span>
            </div>
            <div class="matrix-scroll">
                <div class="matrix-grid" style="grid-template-columns: minmax(132px, 1.15fr) repeat(${matrix.columnRents.length}, minmax(92px, 1fr));">
                    <div class="matrix-corner">
                        <span>Prix affiché</span>
                        <strong>Loyer visé</strong>
                    </div>
                    ${matrix.columnRents.map(column => `
                        <div class="matrix-axis ${column.isBase ? 'is-base' : ''}">
                            <span>Loyer</span>
                            <strong>${formatCurrency(column.value)}</strong>
                        </div>
                    `).join('')}
                    ${matrix.rows.map(row => `
                        <div class="matrix-axis matrix-axis--row ${row.isBase ? 'is-base' : ''}">
                            <span>Prix d'offre</span>
                            <strong>${formatCurrency(row.value)}</strong>
                        </div>
                        ${row.cells.map(cell => `
                            <div class="matrix-cell matrix-cell--${cell.decisionTone} ${cell.isBase ? 'is-base' : ''}">
                                <span class="matrix-decision matrix-decision--${cell.decisionTone}">${cell.decisionLabel}</span>
                                <strong>${formatSignedCurrency(cell.cfNetNet)}</strong>
                                <small>${cell.isBase ? 'Référence · CF / mois' : 'CF / mois'}</small>
                            </div>
                        `).join('')}
                    `).join('')}
                </div>
            </div>
        </div>
    `;
}

function buildRegimeTable(regimeComparison) {
    nodes.analysisRegimeTable.innerHTML = `
        <table class="analysis-table">
            <thead>
                <tr>
                    <th>Régime</th>
                    <th>CF / mois</th>
                    <th>Lecture</th>
                </tr>
            </thead>
            <tbody>
                ${regimeComparison.map((item, index) => {
                    const cssClass = item.cfNetNet >= 0 ? 'value-positive' : 'value-negative';
                    const status = index === 0 ? 'Optimal' : (item.isCurrent ? 'Actuel' : '');
                    return `
                        <tr>
                            <td>${item.label}</td>
                            <td><strong class="${cssClass}">${formatSignedCurrency(item.cfNetNet)}</strong></td>
                            <td>${status}</td>
                        </tr>
                    `;
                }).join('')}
            </tbody>
        </table>
    `;
}

function buildCashflowTable(rows) {
    if (!nodes.analysisCashflowTable) return;
    if (!rows || rows.length === 0) {
        nodes.analysisCashflowTable.innerHTML = '';
        return;
    }
    const hasDeficit = rows.some(r => (r.deficitReporte || 0) > 0);
    nodes.analysisCashflowTable.innerHTML = `
        <div class="analysis-cashflow-scroll">
            <table class="analysis-table analysis-table--cashflow">
                <thead>
                    <tr>
                        <th>Année</th>
                        <th>CF avant impôt</th>
                        <th>CF après impôt</th>
                        <th>Écart fiscal</th>
                        ${hasDeficit ? '<th>Déficit reporté</th>' : ''}
                    </tr>
                </thead>
                <tbody>
                    ${rows.map(row => {
                        const avantClass = row.cfAvantImpot >= 0 ? 'value-positive' : 'value-negative';
                        const apresClass = row.cfApresImpot >= 0 ? 'value-positive' : 'value-negative';
                        const ecart = row.cfAvantImpot - row.cfApresImpot;
                        return `
                            <tr>
                                <td>Année ${row.year}</td>
                                <td><strong class="${avantClass}">${formatSignedCurrency(row.cfAvantImpot)}</strong></td>
                                <td><strong class="${apresClass}">${formatSignedCurrency(row.cfApresImpot)}</strong></td>
                                <td class="value-neutral">${formatCurrency(ecart)}</td>
                                ${hasDeficit ? `<td class="value-neutral">${row.deficitReporte > 0 ? formatCurrency(row.deficitReporte) : '—'}</td>` : ''}
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function buildSensitivityTable(sensitivity) {
    nodes.analysisSensitivityTable.innerHTML = `
        <table class="analysis-table">
            <thead>
                <tr>
                    <th>Scénario</th>
                    <th>CF / mois</th>
                    <th>Impact</th>
                </tr>
            </thead>
            <tbody>
                ${sensitivity.map(item => {
                    const cfClass = item.cfNetNet >= 0 ? 'value-positive' : 'value-negative';
                    const deltaClass = item.delta >= 0 ? 'value-positive' : 'value-negative';
                    return `
                        <tr>
                            <td>${item.label}</td>
                            <td><strong class="${cfClass}">${formatSignedCurrency(item.cfNetNet)}</strong></td>
                            <td><strong class="${deltaClass}">${formatSignedCurrency(item.delta)}</strong></td>
                        </tr>
                    `;
                }).join('')}
            </tbody>
        </table>
    `;
}

function _openDrawer(overlay, drawer, onClose, focusTarget) {
    overlay.style.display = 'block';
    drawer.style.display = 'block';
    overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('drawer-open');
    void drawer.offsetWidth;
    overlay.classList.add('is-open');
    drawer.classList.add('is-open');
    overlay.onclick = onClose;
    if (focusTarget) window.requestAnimationFrame(() => focusTarget?.focus());
}

function _closeDrawer(overlay, drawer) {
    overlay?.classList.remove('is-open');
    drawer?.classList.remove('is-open');
    overlay?.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('drawer-open');
    setTimeout(() => {
        if (overlay) overlay.style.display = 'none';
        if (drawer) drawer.style.display = 'none';
    }, 220);
}

function openAutreCreditDrawer(creditId) {
    const credit = creditId
        ? (state.profileData.autresCredits || []).find(c => c.id === creditId)
        : null;
    if (!nodes.autreCreditDrawer || !nodes.autreCreditDrawerOverlay) return;
    nodes.autreCreditDrawerId.value = creditId || '';
    nodes.autreCreditLibelle.value = credit?.libelle || '';
    nodes.autreCreditMensualite.value = credit?.mensualite != null ? String(credit.mensualite) : '';
    nodes.autreCreditMensualiteHa.value = credit?.mensualiteHorsAssurance != null ? String(credit.mensualiteHorsAssurance) : '';
    nodes.autreCreditDateDebut.value = credit?.dateDebut || '';
    nodes.autreCreditDateFin.value = credit?.dateFin || '';
    nodes.autreCreditCrd.value = credit?.capitalRestantDu != null ? String(credit.capitalRestantDu) : '';
    _openDrawer(nodes.autreCreditDrawerOverlay, nodes.autreCreditDrawer, closeAutreCreditDrawer, nodes.autreCreditLibelle);
}

function closeAutreCreditDrawer() {
    _closeDrawer(nodes.autreCreditDrawerOverlay, nodes.autreCreditDrawer);
}

function handleAutreCreditDrawerSave(event) {
    event.preventDefault();
    const creditId = nodes.autreCreditDrawerId.value;
    const libelle = nodes.autreCreditLibelle.value.trim();
    if (!libelle) { nodes.autreCreditLibelle.focus(); return; }
    const mensualite = Math.max(0, Number(nodes.autreCreditMensualite.value) || 0);
    if (!mensualite) { nodes.autreCreditMensualite.focus(); return; }
    const haRaw = nodes.autreCreditMensualiteHa.value;
    const mensualiteHorsAssurance = haRaw !== '' ? Math.max(0, Number(haRaw) || 0) : null;
    const dateDebut = nodes.autreCreditDateDebut.value || null;
    const dateFin = nodes.autreCreditDateFin.value || null;
    const crdRaw = nodes.autreCreditCrd.value;
    const capitalRestantDu = crdRaw !== '' ? Math.max(0, Number(crdRaw) || 0) : null;

    const entry = {
        id: creditId || Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        libelle,
        mensualite,
        mensualiteHorsAssurance,
        dateDebut,
        dateFin,
        capitalRestantDu
    };
    const credits = [...(state.profileData.autresCredits || [])];
    const idx = credits.findIndex(c => c.id === entry.id);
    if (idx >= 0) credits.splice(idx, 1, entry);
    else credits.push(entry);

    state.profileData = { ...state.profileData, autresCredits: credits };
    saveProfileData();
    closeAutreCreditDrawer();
    emitStateUpdate();
    render({ syncVariables: false, syncProfile: false });
    renderProfileCreditsList();
    showToast('Crédit enregistré.');
}

function handleDeleteAutreCredit(creditId) {
    state.profileData = {
        ...state.profileData,
        autresCredits: (state.profileData.autresCredits || []).filter(c => c.id !== creditId)
    };
    saveProfileData();
    emitStateUpdate();
    render({ syncVariables: false, syncProfile: false });
    renderProfileCreditsList();
    showToast('Crédit supprimé.');
}


function createOrUpdateCurrentAsset() {
    const nomBien = String(state.variablesData['nom-bien'] || '').trim();
    if (!nomBien) {
        const nomField = nodes.variablesForm?.elements?.namedItem('nom-bien');
        if (nomField) { nomField.focus(); }
        showToast('Le nom du bien est requis pour enregistrer.', 'negative');
        return;
    }

    const existingIndex = state.assetRecords.findIndex(asset => asset.id === state.activeAssetId);
    const isNew = existingIndex < 0;
    const now = Date.now();
    const baseRecord = existingIndex >= 0 ? state.assetRecords[existingIndex] : null;
    const assetId = baseRecord?.id || createAssetId();
    const nextRecord = {
        id: assetId,
        variablesData: sanitizeVariablesData(state.variablesData),
        createdAt: baseRecord?.createdAt || now,
        updatedAt: now
    };

    if (existingIndex >= 0) {
        state.assetRecords.splice(existingIndex, 1, nextRecord);
    } else {
        state.assetRecords.push(nextRecord);
    }

    state.activeAssetId = assetId;
    saveAssetRecords();
    saveActiveAssetId();
    emitStateUpdate();
    try {
        render({ syncVariables: false, syncProfile: false });
    } catch (err) {
        console.error('[Spark] render() after save failed:', err);
    }

    showToast(isNew ? 'Dossier enregistré dans le comparateur.' : 'Comparateur mis à jour.');

    // Flash de confirmation sur le bouton cliqué
    const flashBtn = nodes.saveAsset;
    if (flashBtn) {
        const originalText = flashBtn.textContent;
        flashBtn.classList.add('is-saved-flash');
        flashBtn.textContent = isNew ? '✓ Enregistré dans le comparateur' : '✓ Comparateur mis à jour';
        setTimeout(() => {
            flashBtn.classList.remove('is-saved-flash');
            flashBtn.textContent = originalText;
        }, 2000);
    }
}

function loadAssetIntoWorkspace(assetId) {
    const asset = state.assetRecords.find(item => item.id === assetId);
    if (!asset) {
        return;
    }

    state.activeAssetId = asset.id;
    state.variablesData = sanitizeVariablesData(asset.variablesData);
    saveVariablesData();
    saveActiveAssetId();
    emitStateUpdate();
    render({ syncVariables: true, syncProfile: false });
    // Navigate to Saisie & Analyse tab
    const workspaceTab = document.querySelector('.workspace-tab[data-target="workspace-panel"]');
    if (workspaceTab && !IS_ANALYSIS_WINDOW) workspaceTab.click();
}

export function saveCurrentStudy() {
    const existingIndex = state.assetRecords.findIndex(a => a.id === state.activeAssetId);
    const now = Date.now();
    const base = existingIndex >= 0 ? state.assetRecords[existingIndex] : null;
    const id = base?.id || createAssetId();
    const record = {
        id,
        variablesData: sanitizeVariablesData(state.variablesData),
        createdAt: base?.createdAt || now,
        updatedAt: now,
    };
    if (existingIndex >= 0) state.assetRecords.splice(existingIndex, 1, record);
    else state.assetRecords.push(record);
    state.activeAssetId = id;
    saveAssetRecords();
    saveActiveAssetId();
    emitStateUpdate();
}

function applyTheme() {
    document.documentElement.dataset.theme = state.theme;
    document.body.classList.toggle('panel-analysis', IS_ANALYSIS_WINDOW);
    localStorage.setItem(STORAGE_KEYS.theme, state.theme);

    if (nodes.themeMeta) {
        nodes.themeMeta.setAttribute('content', state.theme === 'dark' ? '#09090b' : '#f4f4f5');
    }

    nodes.themeToggle.textContent = state.theme === 'dark' ? '☀' : '☾';

    const studyChip = document.getElementById('topbar-study-name');
    if (studyChip) {
        studyChip.textContent = getCurrentAssetName();
    }
}

function populateProfiles() {
    nodes.profileSelect.innerHTML = PROFILE_OPTIONS
        .map(profile => `<option value="${profile.key}">${profile.label}</option>`)
        .join('');
    nodes.profileSelect.value = state.profilePreset;
}

function syncProfileForm() {
    nodes.profileSelect.value = state.profilePreset;
    nodes.profileName.value = String(state.profileData.name);
    const incomeUnit = state.profileData.incomeUnit || 'annuel';
    nodes.profileIncome.value = incomeUnit === 'mensuel'
        ? String(Math.round(state.profileData.income / 12))
        : String(state.profileData.income);
    setProfileIncomeUnit(incomeUnit, { convert: false });
    nodes.profileAdults.value = String(state.profileData.adults);
    nodes.profileChildren.value = String(state.profileData.children);
    if (nodes.profileObjectifCF) nodes.profileObjectifCF.value = String(state.profileData.objectifCF || 1000);
    if (nodes.profileRevaloAnnuelle) nodes.profileRevaloAnnuelle.value = String(state.profileData.revaloAnnuelle || 2);
    renderProfileCreditsList();
}

function setProfileIncomeUnit(unit, { convert = true } = {}) {
    const previousUnit = nodes.profileIncomeUnitMensuel.getAttribute('aria-pressed') === 'true' ? 'mensuel' : 'annuel';
    if (convert && unit !== previousUnit) {
        const current = Number(nodes.profileIncome.value) || 0;
        nodes.profileIncome.value = String(unit === 'mensuel' ? Math.round(current / 12) : Math.round(current * 12));
    }
    nodes.profileIncomeUnitMensuel.setAttribute('aria-pressed', unit === 'mensuel' ? 'true' : 'false');
    nodes.profileIncomeUnitAnnuel.setAttribute('aria-pressed', unit === 'annuel' ? 'true' : 'false');
    nodes.profileIncome.placeholder = unit === 'mensuel' ? 'ex : 3 200' : 'ex : 38 400';
    updateProfileIncomeHint();
}

function updateProfileIncomeHint() {
    const unit = nodes.profileIncomeUnitMensuel.getAttribute('aria-pressed') === 'true' ? 'mensuel' : 'annuel';
    const value = Number(nodes.profileIncome.value) || 0;
    if (!value) {
        nodes.profileIncomeHint.textContent = '';
        return;
    }
    nodes.profileIncomeHint.textContent = unit === 'mensuel'
        ? `soit ${formatCurrency(value * 12)}/an`
        : `soit ${formatCurrency(value / 12)}/mois`;
}

function renderProfileCreditsList() {
    const list = document.getElementById('profile-credits-list');
    const addBtn = document.getElementById('profile-add-credit-btn');
    if (!list) return;
    const credits = state.profileData.autresCredits || [];
    if (!credits.length) {
        list.innerHTML = '<div class="profile-credits-empty">Aucun crédit hors immo saisi. Cela peut sous-estimer votre taux d\'endettement.</div>';
    } else {
        list.innerHTML = credits.map(c => `
            <div class="profile-credit-row">
                <span class="profile-credit-row__label">${escapeHtml(c.libelle || 'Crédit')}</span>
                <span class="profile-credit-row__amount">−${(c.mensualite || 0).toLocaleString('fr-FR')} €/mois</span>
                ${c.dateFin ? `<span style="font-size:11px;color:var(--text-tertiary)">jusqu'à ${c.dateFin}</span>` : ''}
                <button class="profile-credit-row__edit" data-edit-credit="${escapeHtml(c.id)}">Modifier</button>
                <button class="profile-credit-row__edit" data-delete-credit="${escapeHtml(c.id)}" style="color:var(--color-negative,#ef4444)" title="Supprimer" aria-label="Supprimer le crédit ${escapeHtml(c.libelle || '')}">✕</button>
            </div>`).join('');
        list.querySelectorAll('[data-edit-credit]').forEach(btn => {
            btn.addEventListener('click', () => openAutreCreditDrawer(btn.dataset.editCredit));
        });
        list.querySelectorAll('[data-delete-credit]').forEach(btn => {
            btn.addEventListener('click', () => { handleDeleteAutreCredit(btn.dataset.deleteCredit); renderProfileCreditsList(); });
        });
    }
    if (addBtn && !addBtn.dataset.wired) {
        addBtn.dataset.wired = '1';
        addBtn.addEventListener('click', () => openAutreCreditDrawer(null));
    }
}

function syncVariablesForm() {
    VARIABLE_KEYS.forEach(key => {
        const field = nodes.variablesForm.elements.namedItem(key);
        if (!field) return;
        field.value = String(state.variablesData[key]);
    });

    const { thesisField, nextStepField } = getDecisionJournalFields();
    [thesisField, nextStepField].forEach(field => {
        if (field) {
            delete field.dataset.touched;
        }
    });

    syncDecisionJournalValidity();
}

function syncAssetActionLabels() {
    const isSaved = Boolean(state.activeAssetId && state.assetRecords.some(asset => asset.id === state.activeAssetId));
    nodes.newAsset.disabled = !isSaved;
    nodes.saveAsset.textContent = isSaved ? 'Mettre à jour' : 'Enregistrer';

    // Barre de statut
    if (nodes.assetStatusBar) {
        const savedRecord = state.activeAssetId
            ? state.assetRecords.find(r => r.id === state.activeAssetId)
            : null;

        let barState, dotClass, text;

        if (!savedRecord) {
            barState = 'new';
            dotClass = 'new';
            text = 'Nouvelle étude · pas encore enregistrée';
        } else {
            const currentJson = JSON.stringify(sanitizeVariablesData(state.variablesData));
            const savedJson = JSON.stringify(sanitizeVariablesData(savedRecord.variablesData));
            const isModified = currentJson !== savedJson;

            if (isModified) {
                barState = 'modified';
                dotClass = 'modified';
                text = 'Modifié · non sauvegardé';
            } else {
                const mins = Math.round((Date.now() - (savedRecord.updatedAt || Date.now())) / 60000);
                barState = 'saved';
                dotClass = 'saved';
                text = mins < 1 ? 'À jour · vient d\'être sauvegardé'
                    : mins < 60 ? `À jour · sauvegardé il y a ${mins} min`
                    : 'À jour · sauvegardé';
            }
        }

        nodes.assetStatusBar.className = `asset-status-bar asset-status-bar--${barState}`;
        nodes.assetStatusBar.innerHTML = `
            <div class="asset-status-bar__left">
                <span class="asset-status-bar__dot asset-status-bar__dot--${dotClass}">${dotClass === 'saved' ? '✓' : dotClass === 'modified' ? '●' : '○'}</span>
                <span class="asset-status-bar__text">${text}</span>
            </div>
        `;
    }
}

function detachCurrentAsset() {
    if (!state.activeAssetId) {
        return;
    }

    state.activeAssetId = null;
    state.variablesData = sanitizeVariablesData({
        ...state.variablesData,
        'nom-bien': `${getCurrentAssetName()} variante`
    });
    saveVariablesData();
    saveActiveAssetId();
    render({ syncVariables: true, syncProfile: false });
    openEssentielAccordions();
}

function openEssentielAccordions() {
    const essentielZone = document.querySelector('.form-zone[data-zone="essentiel"]');
    if (essentielZone) {
        essentielZone.dataset.open = 'true';
        essentielZone.querySelectorAll('.accord-section').forEach(section => {
            section.dataset.open = 'true';
            const btn = section.querySelector('.accord-head');
            const body = section.querySelector('.accord-body');
            if (btn) btn.setAttribute('aria-expanded', 'true');
            if (body) body.hidden = false;
        });
    }
}

function setProfileConfigured() {
    state.profileConfigured = true;
    localStorage.setItem(STORAGE_KEYS.profileConfigured, '1');
}

function canDismissProfileModal() {
    return state.profileConfigured;
}

function openProfileModal() {
    const activeElement = document.activeElement;
    const canRestoreToActiveElement = activeElement instanceof HTMLElement
        && activeElement !== document.body
        && activeElement !== document.documentElement
        && !nodes.profileModal?.contains(activeElement);

    profileModalReturnFocusTarget = canRestoreToActiveElement
        ? activeElement
        : nodes.profileTrigger;
    state.isProfileModalOpen = true;
    render({ syncProfile: false, syncVariables: false });
    window.requestAnimationFrame(() => {
        nodes.profileName.focus();
    });
}

function dismissProfileModal() {
    const focusTarget = profileModalReturnFocusTarget && document.contains(profileModalReturnFocusTarget)
        ? profileModalReturnFocusTarget
        : nodes.profileTrigger;

    if (focusTarget instanceof HTMLElement) {
        focusTarget.focus();
    } else if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
    }

    window.requestAnimationFrame(() => {
        state.isProfileModalOpen = false;
        render({ syncProfile: false, syncVariables: false });

        window.requestAnimationFrame(() => {
            focusTarget?.focus();
            profileModalReturnFocusTarget = null;
        });
    });
}

function confirmProfileModal() {
    setProfileConfigured();
    emitStateUpdate();
    dismissProfileModal();
}

function skipProfileModal() {
    dismissProfileModal();
}

function closeProfileModal() {
    if (!canDismissProfileModal()) {
        return;
    }

    dismissProfileModal();
}

function applyProfilePreset(profileKey) {
    state.profilePreset = profileKey;
    localStorage.setItem(STORAGE_KEYS.profilePreset, state.profilePreset);
    state.profileData = { ...createProfileData(profileKey), autresCredits: state.profileData.autresCredits };
    saveProfileData();
    emitStateUpdate();
    render({ syncProfile: false, syncVariables: false });
}

function openAnalysisWindow(options = {}) {
    const { focus = false } = options;

    if (IS_ANALYSIS_WINDOW || state.screens !== 2) {
        return;
    }

    if (analysisWindowRef && !analysisWindowRef.closed) {
        state.analysisPopupBlocked = false;
        if (focus) {
            analysisWindowRef.focus();
        }
        return;
    }

    const width = Math.max(960, Math.floor(window.screen.availWidth * 0.48));
    const height = Math.max(760, Math.floor(window.screen.availHeight * 0.92));
    const left = Math.max(0, window.screenX + window.outerWidth + 24);
    const top = Math.max(0, window.screenY);
    const features = `popup=yes,resizable=yes,scrollbars=yes,width=${width},height=${height},left=${left},top=${top}`;
    analysisWindowRef = window.open(buildPanelUrl('analysis'), 'investissement-web-analysis', features);
    state.analysisPopupBlocked = !analysisWindowRef;

    if (analysisWindowRef && focus) {
        analysisWindowRef.focus();
    }
}

async function openPrintDocument(documentHTML, filename) {
    const btn = document.getElementById('export-decision-pdf');
    const originalLabel = btn ? btn.textContent : null;
    if (btn) { btn.textContent = 'Génération…'; btn.disabled = true; }
    try {
        const resp = await fetch('/api/generate-pdf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ html: documentHTML, filename }),
        });
        const json = await resp.json().catch(() => null);
        if (!resp.ok) {
            window.alert('Erreur lors de la génération du PDF : ' + ((json && json.error) || resp.statusText));
            return;
        }
        const savedTo = json && json.saved_to ? json.saved_to : '';
        window.alert('PDF sauvegardé dans le dossier Téléchargements :\n' + (savedTo || filename));
    } catch (err) {
        window.alert('Erreur lors de la génération du PDF : ' + err.message);
    } finally {
        if (btn) { btn.textContent = originalLabel; btn.disabled = false; }
    }
}

async function handleDecisionSummaryExport() {
    const analysisModel = getCurrentAnalysisModel();
    const { documentHTML, filename } = buildDecisionPrintDocument({
        analysisModel,
        profileData: state.profileData,
        variablesData: state.variablesData
    });

    await openPrintDocument(documentHTML, filename);
}

function closeAnalysisWindow() {
    if (analysisWindowRef && !analysisWindowRef.closed) {
        analysisWindowRef.close();
    }
    analysisWindowRef = null;
    state.analysisPopupBlocked = false;
}

function renderFormKpiBar(analysisModel) {
    if (!nodes.fkpiRdtBrut || !nodes.fkpiCfNet || !nodes.fkpiDscr) return;
    const { metrics } = analysisModel;
    const prix = state.variablesData.prix ?? 0;

    if (!prix) {
        nodes.fkpiRdtBrut.textContent = '—';
        nodes.fkpiRdtBrut.className = 'form-kpi-bar__value form-kpi-bar__value--gold';
        nodes.fkpiCfNet.textContent = '—';
        nodes.fkpiCfNet.className = 'form-kpi-bar__value';
        nodes.fkpiDscr.textContent = '—';
        nodes.fkpiDscr.className = 'form-kpi-bar__value';
        return;
    }

    const rdt = metrics.rentaBrute ?? 0;
    nodes.fkpiRdtBrut.textContent = `${rdt.toFixed(2).replace('.', ',')} %`;
    nodes.fkpiRdtBrut.className = 'form-kpi-bar__value form-kpi-bar__value--gold';

    const cf = metrics.cfNetNet ?? 0;
    const cfText = (cf >= 0 ? '+' : '') + cf.toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' €';
    nodes.fkpiCfNet.textContent = cfText;
    nodes.fkpiCfNet.className = `form-kpi-bar__value ${cf >= 0 ? 'form-kpi-bar__value--green' : 'form-kpi-bar__value--red'}`;

    const dscr = metrics.dscr ?? 0;
    nodes.fkpiDscr.textContent = dscr.toFixed(2).replace('.', ',');
    nodes.fkpiDscr.className = 'form-kpi-bar__value';
}

function renderFinanceLiveSummary(analysisModel) {
    if (!nodes.financeLiveCredit || !nodes.financeLiveInsurance || !nodes.financeLiveTotal) return;

    const monthly = analysisModel.monthly || {};
    const credit = Number(monthly.credit) || 0;
    const assurance = Number(monthly.assurance) || 0;
    const total = Number(monthly.mensualiteTotale) || 0;

    nodes.financeLiveCredit.textContent = `${formatPlainCurrency(credit)} / mois`;
    nodes.financeLiveInsurance.textContent = `${formatPlainCurrency(assurance)} / mois`;
    nodes.financeLiveTotal.textContent = `${formatPlainCurrency(total)} / mois`;
}

function renderCFWaterfall(analysisModel) {
    if (!nodes.analysisCFWaterfall) return;
    const { monthlyBreakdown } = analysisModel;

    const loyerRow  = monthlyBreakdown.find(r => r.label === 'Loyers encaissés');
    const creditRow = monthlyBreakdown.find(r => r.label === 'Crédit + assurance');
    const chargesRow = monthlyBreakdown.find(r => r.label === "Charges d'exploitation");
    const impotsRow = monthlyBreakdown.find(r => r.label === 'Impôts');
    const cfRow     = monthlyBreakdown.find(r => r.label === 'Cash-flow net-net');

    const loyerBrut = loyerRow ? loyerRow.value : 1;
    const cfVal = cfRow ? cfRow.signedValue : 0;
    const cfColor = cfVal >= 0 ? 'var(--success)' : 'var(--danger)';

    function barPct(val) {
        return Math.min(100, Math.max(2, (Math.abs(val) / loyerBrut) * 100)).toFixed(1);
    }

    function fmtEur(v) {
        const sign = v >= 0 ? '+' : '−';
        return `${sign}${Math.abs(Math.round(v)).toLocaleString('fr-FR')} €`;
    }

    const rows = [
        { label: loyerRow?.label || 'Loyers', val: loyerRow?.signedValue || 0, kind: 'income' },
        { label: creditRow?.label || 'Crédit', val: creditRow?.signedValue || 0, kind: 'expense' },
        { label: chargesRow?.label || 'Charges', val: chargesRow?.signedValue || 0, kind: 'watch' },
        { label: impotsRow?.label || 'Impôts', val: impotsRow?.signedValue || 0, kind: impotsRow?.kind || 'expense' },
    ];

    nodes.analysisCFWaterfall.innerHTML = `
        <div class="cf-waterfall__head">
            <span class="cf-waterfall__title">Cash-flow — calcul en direct</span>
            <span class="cf-waterfall__live">● LIVE</span>
        </div>
        <div class="cf-waterfall__bars">
            ${rows.map(r => `
            <div class="cf-waterfall__row">
                <span class="cf-waterfall__row-label">${escapeHtml(r.label)}</span>
                <div class="cf-waterfall__bar"><div class="cf-waterfall__bar-fill cf-waterfall__bar-fill--${escapeHtml(r.kind)}" style="width:${barPct(r.val)}%"></div></div>
                <span class="cf-waterfall__row-val" style="color:${r.val >= 0 ? 'var(--success)' : 'var(--danger)'}">${escapeHtml(fmtEur(r.val))}</span>
            </div>`).join('')}
            <div class="cf-waterfall__row cf-waterfall__row--total">
                <span class="cf-waterfall__row-label">Net net</span>
                <div class="cf-waterfall__bar"><div class="cf-waterfall__bar-fill cf-waterfall__bar-fill--${cfVal >= 0 ? 'positive' : 'negative'}" style="width:${barPct(cfVal)}%"></div></div>
                <span class="cf-waterfall__row-val" style="color:${cfColor};font-weight:700">${escapeHtml(fmtEur(cfVal))}</span>
            </div>
        </div>
    `;
}

function buildAnalysisMetrics(analysisModel) {
    const { metrics, confidenceModel } = analysisModel;
    const cards = [
        {
            label: 'Cash-flow net-net',
            value: formatSignedCurrency(metrics.cfNetNet),
            rawValue: metrics.cfNetNet,
            cssClass: getMetricClass(metrics.cfNetNet),
            barPct: Math.min(100, Math.max(0, (metrics.cfNetNet + 200) / 400 * 100))
        },
        {
            label: 'CF avant impôt',
            value: formatSignedCurrency(metrics.cfNet),
            rawValue: metrics.cfNet,
            cssClass: getMetricClass(metrics.cfNet),
            barPct: Math.min(100, Math.max(0, (metrics.cfNet + 200) / 400 * 100))
        },
        {
            label: 'Rentabilité brute',
            value: `${(metrics.rentaBrute ?? 0).toFixed(2).replace('.', ',')} %`,
            rawValue: metrics.rentaBrute ?? 0,
            cssClass: (metrics.rentaBrute ?? 0) >= 7 ? 'is-positive' : (metrics.rentaBrute ?? 0) >= 5 ? 'is-watch' : 'is-negative',
            barPct: Math.min(100, ((metrics.rentaBrute ?? 0) / 10) * 100)
        },
        {
            label: 'DSCR',
            value: formatRatio(metrics.dscr),
            rawValue: metrics.dscr,
            cssClass: metrics.dscr >= 1.1 ? 'is-positive' : (metrics.dscr >= 1 ? 'is-watch' : 'is-negative'),
            barPct: Math.min(100, (metrics.dscr / 1.5) * 100)
        },
        {
            label: 'Fiabilité',
            value: `${confidenceModel.score}/100`,
            rawValue: confidenceModel.score,
            cssClass: getDecisionClass(confidenceModel.tone),
            barPct: confidenceModel.score
        }
    ];

    nodes.analysisMetrics.innerHTML = cards.map((card, i) => `
        <article class="kpi-card" data-kpi-index="${i}">
            <div class="kpi-value ${card.cssClass}" data-kpi-value="${escapeHtml(card.value)}">${escapeHtml(card.value)}</div>
            <div class="kpi-label">${escapeHtml(card.label)}</div>
            <div class="kpi-bar"><div class="kpi-bar-fill" style="--pct: ${card.barPct ?? 50}%"></div></div>
        </article>
    `).join('');

    nodes.analysisMetrics.querySelectorAll('[data-kpi-value]').forEach(el => {
        animateCounter(el, el.dataset.kpiValue);
    });
}

function buildAnalysisStickySummary(analysisModel) {
    if (isEssentialDataMissing()) {
        nodes.analysisStickySummary.innerHTML = buildNeutralAnalysisPlaceholder();
        return;
    }
    const { acquisitionDecision } = analysisModel;

    nodes.analysisStickySummary.innerHTML = `
        <div class="analysis-sticky-card analysis-sticky-card--${acquisitionDecision.tone}">
            <strong class="decision-badge decision-badge--${acquisitionDecision.tone}">${acquisitionDecision.label}</strong>
            <span class="analysis-sticky-score">${acquisitionDecision.score}<small>/100</small></span>
            <span class="analysis-sticky-divider"></span>
            <span class="analysis-sticky-action-inline">
                <span>Action</span>
                <strong>${escapeHtml(acquisitionDecision.action)}</strong>
            </span>
        </div>
    `;
}

function buildAnalysisAcquisitionDecision(analysisModel) {
    if (isEssentialDataMissing()) {
        nodes.analysisAcquisitionDecision.innerHTML = buildNeutralAnalysisPlaceholder();
        return;
    }
    const { acquisitionDecision, acquisitionChecklist, confidenceModel, scenarioModel } = analysisModel;

    nodes.analysisAcquisitionDecision.innerHTML = `
        <div class="buybox">
            <div class="buybox-head">
                <div class="buybox-copy">
                    <span class="status-label">Décision d'achat</span>
                    <div class="decision-head">
                        <h4>${acquisitionDecision.label}</h4>
                        <div class="buybox-badges">
                            <strong class="decision-badge decision-badge--${acquisitionDecision.tone}">${acquisitionDecision.priceBand}</strong>
                            <strong class="status-pill status-pill--${acquisitionDecision.checklistTone}">${acquisitionDecision.checklistLabel}</strong>
                            <strong class="status-pill status-pill--${confidenceModel.tone}">Fiabilité ${confidenceModel.label}</strong>
                            <strong class="status-pill status-pill--${scenarioModel.tone}">Stress ${scenarioModel.label}</strong>
                        </div>
                    </div>
                    <p class="analysis-verdict">${acquisitionDecision.summary}</p>
                    <p class="decision-hint">Action prioritaire : <strong>${acquisitionDecision.action}</strong></p>
                    <p class="decision-hint">Vérifications terrain : <strong>${acquisitionChecklist.summary}</strong></p>
                </div>
                <div class="score-hero">
                    <svg class="score-gauge" viewBox="0 0 120 120" width="96" height="96" role="img" aria-label="Score ${acquisitionDecision.score}/100">
                        <circle class="gauge-track" cx="60" cy="60" r="46"/>
                        <circle class="gauge-fill gauge-fill--${acquisitionDecision.tone}" cx="60" cy="60" r="46"
                            style="stroke-dashoffset: ${(289 * (1 - acquisitionDecision.score / 100)).toFixed(1)}"/>
                        <text class="gauge-number" x="60" y="68">${acquisitionDecision.score}</text>
                    </svg>
                    <div class="score-meta">
                        <span class="score-verdict score-verdict--${acquisitionDecision.tone}">${acquisitionDecision.label}</span>
                        <span class="score-label">Score de décision</span>
                    </div>
                </div>
            </div>

            <div class="buybox-kpis">
                <article class="buybox-kpi">
                    <span>Prix affiché</span>
                    <strong>${formatCurrency(acquisitionDecision.currentPrice)}</strong>
                </article>
                <article class="buybox-kpi ${acquisitionDecision.currentPrice <= acquisitionDecision.maxOfferPrice + 500 ? 'is-positive' : 'is-watch'}">
                    <span>Offre plafond</span>
                    <strong>${formatCurrency(acquisitionDecision.maxOfferPrice)}</strong>
                </article>
                <article class="buybox-kpi ${acquisitionDecision.currentPrice <= acquisitionDecision.solidOfferPrice + 500 ? 'is-positive' : 'is-neutral'}">
                    <span>Prix confortable</span>
                    <strong>${formatCurrency(acquisitionDecision.solidOfferPrice)}</strong>
                </article>
                <article class="buybox-kpi ${acquisitionDecision.negotiationToTenable > 0 ? 'is-watch' : 'is-positive'}">
                    <span>Baisse minimale</span>
                    <strong>${acquisitionDecision.negotiationToTenable > 0 ? formatPlainCurrency(acquisitionDecision.negotiationToTenable) : 'Aucune'}</strong>
                </article>
            </div>

            <div class="buybox-columns">
                <section class="buybox-panel">
                    <span class="status-label">Points de vigilance</span>
                    ${acquisitionDecision.blockers.length ? `
                        <ul class="buybox-list">
                            ${acquisitionDecision.blockers.map(item => `
                                <li>
                                    <strong>${item.label}</strong>
                                    <p>${item.detail}</p>
                                </li>
                            `).join('')}
                        </ul>
                    ` : '<p class="collection-empty">Aucun point bloquant majeur sur les ratios clés à ce stade.</p>'}
                </section>

                <section class="buybox-panel">
                    <span class="status-label">Points d'appui</span>
                    ${acquisitionDecision.strengths.length ? `
                        <ul class="buybox-list">
                            ${acquisitionDecision.strengths.map(item => `
                                <li>
                                    <strong>${item.label}</strong>
                                    <p>${item.detail}</p>
                                </li>
                            `).join('')}
                        </ul>
                    ` : '<p class="collection-empty">Le dossier ne déclenche pas encore de signal franchement favorable.</p>'}
                </section>
            </div>
        </div>
    `;
}


function buildAnalysisConfidence(analysisModel) {
    const { confidenceModel, acquisitionChecklist } = analysisModel;

    nodes.analysisConfidence.innerHTML = `
        <div class="confidence-shell">
            <div class="decision-head">
                <span class="status-label">Fiabilité des hypothèses</span>
                <strong class="status-pill status-pill--${confidenceModel.tone}">${confidenceModel.label}</strong>
            </div>
            <p class="decision-hint">${confidenceModel.summary}</p>
            <div class="timeline-summary">
                <div class="timeline-pill">
                    <span>Score</span>
                    <strong>${confidenceModel.score}/100</strong>
                </div>
                <div class="timeline-pill">
                    <span>Confirmées</span>
                    <strong>${confidenceModel.verifiedCount}</strong>
                </div>
                <div class="timeline-pill">
                    <span>Estimées</span>
                    <strong>${confidenceModel.estimatedCount}</strong>
                </div>
                <div class="timeline-pill">
                    <span>Manquantes</span>
                    <strong>${confidenceModel.unknownCount}</strong>
                </div>
            </div>
            <ul class="decision-checkpoints">
                ${confidenceModel.items.map(item => `
                    <li>
                        <div>
                            <span>${item.label}</span>
                            <small>${item.critical ? 'Point critique' : 'Point de confort'}</small>
                        </div>
                        <strong class="status-pill status-pill--${item.tone}">${item.statusLabel}</strong>
                    </li>
                `).join('')}
            </ul>
            ${(() => {
                const alerts = acquisitionChecklist.items.filter(i => i.status !== 'ready');
                if (!alerts.length) return '';
                return `
                    <div class="confidence-checklist-alerts">
                        <div class="decision-head decision-head--spaced">
                            <span class="status-label">Points de vérification terrain</span>
                            <strong class="status-pill status-pill--${acquisitionChecklist.readinessTone}">${escapeHtml(acquisitionChecklist.readinessLabel)}</strong>
                        </div>
                        <ul class="decision-checkpoints">
                            ${alerts.map(item => {
                                const tone = item.status === 'block' ? 'negative' : 'watch';
                                return `<li>
                                    <div><span>${escapeHtml(item.label)}</span><small>${escapeHtml(item.detail)}</small></div>
                                    <strong class="status-pill status-pill--${tone}">${item.status === 'block' ? 'Bloquant' : 'Vigilance'}</strong>
                                </li>`;
                            }).join('')}
                        </ul>
                    </div>
                `;
            })()}
        </div>
    `;
}

function buildAnalysisScenarios(analysisModel) {
    const { scenarioModel } = analysisModel;

    nodes.analysisScenarios.innerHTML = `
        <div class="scenario-shell">
            <div class="decision-head">
                <span class="status-label">Scénarios de stress</span>
                <strong class="status-pill status-pill--${scenarioModel.tone}">${scenarioModel.label}</strong>
            </div>
            <p class="decision-hint">${scenarioModel.summary}</p>
            <div class="scenario-list">
                ${scenarioModel.scenarios.map(item => `
                    <article class="scenario-card scenario-card--${item.tone}">
                        <div class="lever-head">
                            <strong>${item.label}</strong>
                            <span class="status-pill status-pill--${item.tone}">${item.matrixLabel}</span>
                        </div>
                        <p>${item.description}</p>
                        <div class="scenario-metrics">
                            <span>CF ${formatSignedCurrency(item.cfNetNet)}</span>
                            <span>DSCR ${formatRatio(item.dscr)}</span>
                        </div>
                    </article>
                `).join('')}
            </div>
        </div>
    `;
}

function buildAnalysisJournal(analysisModel) {
    const { decisionJournal } = analysisModel;
    const thesis = decisionJournal.thesis || decisionJournal.suggestedThesis;
    const nextStep = decisionJournal.nextStep || decisionJournal.suggestedNextStep;

    nodes.analysisJournal.innerHTML = `
        <div class="journal-card">
            <div class="decision-head">
                <span class="status-label">Trace de décision</span>
                <strong class="status-pill status-pill--${decisionJournal.tone}">${decisionJournal.label}</strong>
            </div>
            <p class="decision-hint">${decisionJournal.summary}</p>
            <div class="journal-block">
                <span class="status-label">Thèse d'investissement</span>
                <p class="journal-note ${decisionJournal.thesis ? '' : 'is-suggested'}">${formatMultilineText(thesis)}</p>
            </div>
            <div class="journal-block">
                <span class="status-label">Prochaine étape</span>
                <p class="journal-note ${decisionJournal.nextStep ? '' : 'is-suggested'}">${formatMultilineText(nextStep)}</p>
            </div>
        </div>
    `;
}

function buildAnalysisSummary(analysisModel, parts) {
    const { decision } = analysisModel;
    nodes.analysisSummary.innerHTML = `
        <div class="decision-card">
            <div class="decision-head">
                <strong class="decision-badge decision-badge--${decision.tone}">${decision.label}</strong>
            </div>
            <p class="analysis-verdict">${decision.summary}</p>
            <p class="decision-hint">Étape recommandée : <strong>${decision.action}</strong></p>
            <ul class="decision-checkpoints">
                ${decision.checkpoints.map(checkpoint => `
                    <li>
                        <div>
                            <span>${checkpoint.label}</span>
                            <small>${checkpoint.target}</small>
                        </div>
                        <strong class="status-pill status-pill--${checkpoint.tone}">${formatCheckpointValue(checkpoint)}</strong>
                    </li>
                `).join('')}
            </ul>
            <ul class="analysis-list analysis-list--compact">
                <li><span>Parts fiscales</span><strong>${parts.toLocaleString('fr-FR')} part${parts > 1 ? 's' : ''}</strong></li>
            </ul>
        </div>
    `;
}

function buildActionPlan(levers) {
    if (!levers.length) {
        nodes.analysisActionPlan.innerHTML = '<p class="collection-empty">Aucun levier prioritaire n a été identifié à ce stade.</p>';
        return;
    }

    nodes.analysisActionPlan.innerHTML = `
        <div class="lever-list">
            ${levers.map((lever, index) => `
                <article class="lever-card">
                    <div class="lever-head">
                        <span class="status-label">Priorité ${index + 1}</span>
                        <span class="status-pill status-pill--${lever.delta >= 0 ? 'positive' : 'negative'}">${formatSignedCurrency(lever.delta)} / mois</span>
                    </div>
                    <strong>${lever.label}</strong>
                    <p>${lever.category} · CF projeté ${formatSignedCurrency(lever.nextCf)}</p>
                </article>
            `).join('')}
        </div>
    `;
}

function buildAnalysisDetails(analysisModel, composition) {
    const { metrics, decision, confidenceModel, decisionThresholds } = analysisModel;
    nodes.analysisDetails.innerHTML = `
        <ul class="analysis-list">
            <li><span>Nom du bien</span><strong>${escapeHtml(getCurrentAssetName())}</strong></li>
            <li><span>Ville</span><strong>${escapeHtml(state.variablesData.ville || 'Ville non renseignée')}</strong></li>
            <li><span>Prix net vendeur</span><strong>${formatCurrency(metrics.prixNet)}</strong></li>
            <li><span>Rentabilité brute</span><strong>${formatPercent(metrics.rentaBrute)}</strong></li>
            <li><span>Rentabilité nette</span><strong>${formatPercent(metrics.rentaNette)}</strong></li>
            <li><span>Cash-on-cash</span><strong>${formatPercent(metrics.coc)}</strong></li>
            <li><span>DSCR</span><strong>${formatRatio(metrics.dscr)}</strong></li>
            <li><span>GRM</span><strong>${formatRatio(metrics.grm)}</strong></li>
            <li><span>Fiabilité du dossier</span><strong>${confidenceModel.score}/100</strong></li>
            <li><span>CF minimum</span><strong>${formatSignedCurrency(decisionThresholds.minCf)}</strong></li>
            <li><span>DSCR minimum</span><strong>${formatRatio(decisionThresholds.minDscr)}</strong></li>
            <li><span>Régime choisi</span><strong>${getRegimeLabel(state.variablesData.regime)}</strong></li>
            <li><span>Verdict d'exploitation</span><strong>${decision.label}</strong></li>
            <li><span>Composition du foyer</span><strong>${composition}</strong></li>
        </ul>
    `;
}

function buildAnalysisVisuals(analysisModel) {
    nodes.analysisMonthlyChart.innerHTML = buildBarChartMarkup(analysisModel.monthlyBreakdown);
    nodes.analysisCostChart.innerHTML = buildBarChartMarkup(analysisModel.costBreakdown);
    nodes.analysisTimelineChart.innerHTML = buildProjectionChart(analysisModel.projection);
    nodes.analysisPriceRentMatrix.innerHTML = buildPriceRentMatrixMarkup(analysisModel.priceRentMatrix);
}



// ─── HELPER MODAL GÉNÉRIQUE ──────────────────────────────────────────────────

function renderWorkspaceContent() {
    const analysisModel = getCurrentAnalysisModel();
    const { metrics, parts, tmi } = analysisModel;
    const composition = getProfileComposition(state.profileData);
    const useLocalFallback = !IS_ANALYSIS_WINDOW && state.screens === 2 && state.analysisPopupBlocked;
    const showVariables = !IS_ANALYSIS_WINDOW;
    const showAnalysis = IS_ANALYSIS_WINDOW || state.screens === 1 || useLocalFallback;

    if (IS_ANALYSIS_WINDOW && state.screens !== 2 && window.opener) {
        window.close();
        return;
    }

    nodes.variablesPanel.hidden = !showVariables;
    nodes.analysisPanel.hidden = !showAnalysis;
    nodes.workspaceBoard.dataset.layout = (!IS_ANALYSIS_WINDOW && state.screens === 2 && useLocalFallback) ? '2' : '1';

    if (IS_ANALYSIS_WINDOW) {
        nodes.workspaceTitle.textContent = 'Analyse synchronisée';
        nodes.workspaceSubtitle.textContent = 'Cette fenêtre affiche les résultats calculés à partir de la saisie principale.';
        nodes.analysisKicker.textContent = 'Analyse';
        nodes.analysisSubtitle.textContent = 'Décision, sensibilité et contrôles sont recalculés en temps réel.';
    } else if (state.screens === 1) {
        nodes.workspaceTitle.textContent = 'Étude active';
        nodes.workspaceSubtitle.textContent = 'Les hypothèses et les résultats sont présentés dans une même vue.';
        nodes.analysisKicker.textContent = 'Analyse';
        nodes.analysisSubtitle.textContent = 'Les indicateurs, scénarios et contrôles suivent chaque modification.';
    } else if (useLocalFallback) {
        nodes.workspaceTitle.textContent = 'Étude active';
        nodes.workspaceSubtitle.textContent = 'La fenêtre séparée n a pas pu s ouvrir. Les résultats restent affichés localement.';
        nodes.analysisKicker.textContent = 'Analyse locale';
        nodes.analysisSubtitle.textContent = 'Les résultats sont calculés ici tant que la vue séparée n est pas ouverte.';
    } else {
        nodes.workspaceTitle.textContent = 'Paramétrage';
        nodes.workspaceSubtitle.textContent = 'Cette fenêtre regroupe les hypothèses. Les résultats sont affichés dans la vue séparée.';
        nodes.analysisKicker.textContent = 'Analyse séparée';
        nodes.analysisSubtitle.textContent = 'Décision, sensibilité et contrôles restent synchronisés dans la seconde fenêtre.';
    }

    nodes.variablesKicker.textContent = state.screens === 1 ? 'Hypothèses' : 'Paramétrage';
    if (nodes.topbarStudyName) {
        nodes.topbarStudyName.textContent = getCurrentAssetName();
    }
    if (nodes.topbarStudyMeta) {
        nodes.topbarStudyMeta.textContent = `${state.variablesData.ville || VARIABLE_DEFAULTS.ville} · ${getTypeBienLabel(state.variablesData['type-bien'])}`;
    }
    nodes.variablesSubtitle.textContent = state.screens === 1
        ? 'Hypothèses, coûts et financement peuvent être ajustés en continu.'
        : 'Cette vue centralise les hypothèses, coûts et paramètres de financement.';
    nodes.variablesContext.textContent = `Dossier : ${getCurrentAssetName()} · ${state.variablesData.ville || VARIABLE_DEFAULTS.ville} · ${getProfileContextSummary()} · TMI ${tmi} %.`;

    buildWorkspaceHero(analysisModel, { tmi, composition, useLocalFallback });
    if (showVariables) {
        renderFormKpiBar(analysisModel);
        renderFinanceLiveSummary(analysisModel);
    }
    buildAnalysisStickySummary(analysisModel);
    renderCFWaterfall(analysisModel);
    buildAnalysisMetrics(analysisModel);
    buildAnalysisAcquisitionDecision(analysisModel);
    buildAnalysisConfidence(analysisModel);
    buildAnalysisScenarios(analysisModel);
    buildAnalysisJournal(analysisModel);
    buildAnalysisVisuals(analysisModel);
    buildRegimeTable(analysisModel.regimeComparison);
    buildSensitivityTable(analysisModel.sensitivity);
    buildCashflowTable(analysisModel.cashflowTable);
    buildAnalysisSummary(analysisModel, parts);
    buildActionPlan(analysisModel.actionLevers);
    buildAnalysisDetails(analysisModel, composition);
    renderCollections();
    syncAssetActionLabels();
}

function renderModalState() {
    const profile = getProfileOption(state.profilePreset);
    const parts = getHouseholdTaxParts(state.profileData.adults, state.profileData.children);
    const tmi = calculateTMI(state.profileData.income, {
        adults: state.profileData.adults,
        children: state.profileData.children
    });

    if (nodes.topbarProfileLabel) {
        nodes.topbarProfileLabel.textContent = state.profileConfigured ? state.profileData.name : 'Profil du foyer';
    }
    if (nodes.topbarProfileMeta) {
        nodes.topbarProfileMeta.textContent = state.profileConfigured
            ? `${formatCurrency(state.profileData.income)} · ${getProfileComposition(state.profileData)}`
            : 'Configuration requise pour les calculs';
    }
    nodes.profileTrigger.classList.toggle('is-pending', !state.profileConfigured);
    nodes.profileParts.textContent = `${parts.toLocaleString('fr-FR')} part${parts > 1 ? 's' : ''}`;
    nodes.profileTmi.textContent = `${tmi} %`;
    nodes.profileComposition.textContent = getProfileComposition(state.profileData);
    nodes.profileModal.dataset.onboarding = state.profileConfigured ? 'false' : 'true';
    nodes.profileClose.hidden = !state.profileConfigured;
    if (nodes.profileSkip) nodes.profileSkip.hidden = state.profileConfigured;
    nodes.profileModalNote.textContent = state.profileConfigured
        ? `Cadre actif : ${profile.note}`
        : `Étape requise : ${profile.note}`;
    nodes.profileSave.textContent = state.profileConfigured ? 'Fermer le panneau' : 'Valider le profil';

    nodes.profileModal.classList.toggle('open', state.isProfileModalOpen);
    nodes.profileModal.setAttribute('aria-hidden', String(!state.isProfileModalOpen));
    document.body.classList.toggle('modal-open', state.isProfileModalOpen);
}

function isGuidedModeActive() {
    return localStorage.getItem(STORAGE_KEYS.guidedMode) === 'true';
}

function getTutoStep() {
    return parseInt(localStorage.getItem('sparkTutoStep') || '0', 10);
}

function setTutoStep(n) {
    localStorage.setItem('sparkTutoStep', String(n));
}

function setGuidedMode(active) {
    localStorage.setItem(STORAGE_KEYS.guidedMode, String(active));
    if (active) setTutoStep(0);
    applyGuidedModeUI(active);
    render({ syncVariables: false, syncProfile: false });
}

function applyGuidedModeUI(active) {
    if (!nodes.guidedToggle) return;
    nodes.guidedToggle.setAttribute('aria-pressed', String(active));
    nodes.guidedToggle.classList.toggle('is-active', active);
    document.body.classList.toggle('tuto-active', active);
    if (nodes.tutoBar) nodes.tutoBar.hidden = !active;
    if (active) {
        applyTutoStep(getTutoStep());
    } else {
        removeTutoHighlights();
        if (nodes.tutoTooltip) nodes.tutoTooltip.hidden = true;
    }
}

function removeTutoHighlights() {
    document.querySelectorAll('.tuto-highlight').forEach(el => el.classList.remove('tuto-highlight'));
}

function applyTutoStep(n) {
    const step = TUTO_STEPS[n];
    if (!step) return;
    setTutoStep(n);

    // Open the relevant accordion
    if (step.accordTitle) {
        const accordHead = [...document.querySelectorAll('.accord-head')]
            .find(btn => btn.querySelector('.accord-title')?.textContent.trim() === step.accordTitle);
        if (accordHead) {
            const section = accordHead.closest('.accord-section');
            if (section && section.dataset.open !== 'true') accordHead.click();
        }
    }

    // Highlight fields
    removeTutoHighlights();
    step.fields.forEach(f => {
        const input = document.getElementById(f.id);
        if (input) {
            const label = input.closest('label') || input.closest('.variables-field');
            if (label) label.classList.add('tuto-highlight');
        }
    });

    // Position tooltip on first field
    const firstField = step.fields[0];
    if (firstField && nodes.tutoTooltip) {
        const firstInput = document.getElementById(firstField.id);
        const label = firstInput?.closest('label') || firstInput?.closest('.variables-field');
        if (label) {
            const rect = label.getBoundingClientRect();
            nodes.tutoTooltip.innerHTML = '';
            const strong = document.createElement('strong');
            strong.textContent = firstField.label;
            const em = document.createElement('em');
            em.textContent = firstField.exemple;
            const span = document.createElement('span');
            span.textContent = firstField.explication;
            nodes.tutoTooltip.append(strong, em, span);
            nodes.tutoTooltip.hidden = false;
            const top = Math.max(8, rect.top + window.scrollY - nodes.tutoTooltip.offsetHeight - 10);
            const left = Math.min(rect.left, window.innerWidth - 296);
            nodes.tutoTooltip.style.top = `${top}px`;
            nodes.tutoTooltip.style.left = `${Math.max(8, left)}px`;
            label.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
            nodes.tutoTooltip.hidden = true;
        }
    } else if (nodes.tutoTooltip) {
        nodes.tutoTooltip.hidden = true;
    }

    renderTutoBar(n);
}

function renderTutoBar(n) {
    const step = TUTO_STEPS[n];
    if (!step || !nodes.tutoBar || !nodes.tutoStepLabel || !nodes.tutoBarTitle
        || !nodes.tutoBarDesc || !nodes.tutoPrev || !nodes.tutoNext) return;
    const total = TUTO_STEPS.length - 1;
    nodes.tutoStepLabel.textContent =
        n === 0 ? 'Introduction'
        : n === TUTO_STEPS.length - 1 ? 'Conclusion'
        : `Étape ${n} / ${total - 1}`;
    nodes.tutoBarTitle.textContent = step.title;
    nodes.tutoBarDesc.textContent = step.description;
    nodes.tutoPrev.disabled = n === 0;
    nodes.tutoNext.textContent = n === TUTO_STEPS.length - 1 ? 'Terminer' : 'Suivant →';
}

function initTutoBar() {
    if (!nodes.tutoPrev || !nodes.tutoNext) return;
    nodes.tutoPrev.addEventListener('click', () => {
        const current = getTutoStep();
        if (current > 0) applyTutoStep(current - 1);
    });
    nodes.tutoNext.addEventListener('click', () => {
        const current = getTutoStep();
        if (current < TUTO_STEPS.length - 1) {
            applyTutoStep(current + 1);
        } else {
            setGuidedMode(false);
        }
    });
}

function render(options = {}) {
    const { syncProfile = true, syncVariables = true } = options;

    applyTheme();
    if (!IS_ANALYSIS_WINDOW) renderModeSwitch(state.sparkMode);
    nodes.screenToggle.textContent = state.screens === 1 ? '1 écran' : '2 écrans';

    if (syncProfile) {
        syncProfileForm();
    }

    if (syncVariables) {
        syncVariablesForm();
    }

    renderWorkspaceContent();
    renderModalState();
}

function debounce(callback, delay = 250) {
    let timerId = null;
    return (...args) => {
        window.clearTimeout(timerId);
        timerId = window.setTimeout(() => {
            callback(...args);
        }, delay);
    };
}

function updateProfileFromForm() {
    const incomeUnit = nodes.profileIncomeUnitMensuel.getAttribute('aria-pressed') === 'true' ? 'mensuel' : 'annuel';
    const enteredIncome = Number(nodes.profileIncome.value) || 0;
    state.profileData = sanitizeProfileData({
        name: nodes.profileName.value,
        income: incomeUnit === 'mensuel' ? enteredIncome * 12 : enteredIncome,
        incomeUnit,
        adults: nodes.profileAdults.value,
        children: nodes.profileChildren.value,
        objectifCF: nodes.profileObjectifCF?.value,
        revaloAnnuelle: nodes.profileRevaloAnnuelle?.value,
        autresCredits: state.profileData.autresCredits
    });
    saveProfileData();
    emitStateUpdate();
    render({ syncProfile: false, syncVariables: false });
}

function updateVariablesFromForm() {
    const rawVariables = {};
    VARIABLE_KEYS.forEach(key => {
        const field = nodes.variablesForm.elements.namedItem(key);
        if (field) {
            rawVariables[key] = field.value;
        }
    });
    state.variablesData = sanitizeVariablesData(rawVariables);
    syncDecisionJournalValidity();
    saveVariablesData();
    emitStateUpdate();
    render({ syncVariables: false, syncProfile: false });
}

function handleScreenToggle() {
    state.screens = state.screens === 1 ? 2 : 1;
    localStorage.setItem(STORAGE_KEYS.screens, String(state.screens));

    if (!IS_ANALYSIS_WINDOW) {
        if (state.screens === 2) {
            openAnalysisWindow({ focus: false });
        } else {
            closeAnalysisWindow();
        }
    }

    emitStateUpdate();
    render({ syncVariables: false, syncProfile: false });
}

function bindEvents() {
    if (nodes.guidedToggle) {
        nodes.guidedToggle.addEventListener('click', () => {
            setGuidedMode(!isGuidedModeActive());
        });
    }
    nodes.themeToggle.addEventListener('click', () => {
        state.theme = state.theme === 'dark' ? 'light' : 'dark';
        localStorage.setItem(STORAGE_KEYS.theme, state.theme);
        emitStateUpdate();
        render({ syncVariables: false, syncProfile: false });
    });

    function toggleFormZone(zoneHead) {
        const zone = zoneHead.closest('.form-zone');
        if (!zone) return;
        const isOpen = zone.dataset.open === 'true';
        zone.dataset.open = String(!isOpen);
        zoneHead.setAttribute('aria-expanded', String(!isOpen));
        const body = zone.querySelector('.form-zone__body');
        if (body) body.hidden = isOpen;
    }
    document.addEventListener('click', e => {
        const zoneHead = e.target.closest('.form-zone__head');
        if (zoneHead) toggleFormZone(zoneHead);
    });
    document.addEventListener('keydown', e => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const zoneHead = e.target.closest('.form-zone__head');
        if (!zoneHead) return;
        e.preventDefault();
        toggleFormZone(zoneHead);
    });

    nodes.screenToggle.addEventListener('click', handleScreenToggle);
    nodes.profileTrigger.addEventListener('click', openProfileModal);
    nodes.profileClose.addEventListener('click', () => closeProfileModal());
    nodes.profileSkip?.addEventListener('click', () => skipProfileModal());
    nodes.profileSave.addEventListener('click', () => {
        if (state.profileConfigured) {
            closeProfileModal();
            return;
        }

        confirmProfileModal();
    });

    nodes.profileIncomeUnitMensuel.addEventListener('click', () => setProfileIncomeUnit('mensuel'));
    nodes.profileIncomeUnitAnnuel.addEventListener('click', () => setProfileIncomeUnit('annuel'));
    nodes.profileIncome.addEventListener('input', updateProfileIncomeHint);

    nodes.profileModal.addEventListener('click', event => {
        if (event.target === nodes.profileModal) {
            closeProfileModal();
        }
    });

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && state.isProfileModalOpen) {
            skipProfileModal();
        }
    });

    nodes.profileSelect.addEventListener('change', event => {
        applyProfilePreset(event.target.value);
    });

    nodes.profileForm.addEventListener('input', updateProfileFromForm);
    nodes.profileForm.addEventListener('change', updateProfileFromForm);
    const debouncedUpdateVariablesFromForm = debounce(updateVariablesFromForm, 250);
    nodes.variablesForm.addEventListener('input', debouncedUpdateVariablesFromForm);
    nodes.variablesForm.addEventListener('change', updateVariablesFromForm);

    document.getElementById('type-bien')?.addEventListener('change', e => {
        const newType = e.target.value;
        const isVirgin = state.variablesData.prix === VARIABLE_DEFAULTS.prix && state.variablesData.loyer === VARIABLE_DEFAULTS.loyer;
        if (!isVirgin && !confirm(`Changer le type réinitialisera les seuils recommandés. Continuer ?`)) {
            e.target.value = state.variablesData['type-bien'];
            return;
        }
        const defaults = getTypeBienDefaults(newType);
        for (const [key, val] of Object.entries(defaults)) {
            const field = nodes.variablesForm.elements.namedItem(key);
            if (field) field.value = String(val);
        }
    });
    getDecisionJournalFields().thesisField?.addEventListener('blur', () => {
        getDecisionJournalFields().thesisField.dataset.touched = 'true';
        syncDecisionJournalValidity();
    });
    getDecisionJournalFields().nextStepField?.addEventListener('blur', () => {
        getDecisionJournalFields().nextStepField.dataset.touched = 'true';
        syncDecisionJournalValidity();
    });
    nodes.newAsset.addEventListener('click', detachCurrentAsset);
    nodes.saveAsset.addEventListener('click', () => {
        createOrUpdateCurrentAsset();
    });
    nodes.exportDecisionPdf.addEventListener('click', handleDecisionSummaryExport);
    document.getElementById('autre-credit-drawer-close')?.addEventListener('click', closeAutreCreditDrawer);
    document.getElementById('autre-credit-drawer-cancel')?.addEventListener('click', closeAutreCreditDrawer);
    document.getElementById('autre-credit-drawer-form')?.addEventListener('submit', handleAutreCreditDrawerSave);

    if (nodes.modeToggle && !IS_ANALYSIS_WINDOW) {
        nodes.modeToggle.addEventListener('click', e => {
            const btn = e.target.closest('[data-mode]');
            if (!btn) return;
            const newMode = btn.dataset.mode;
            state.sparkMode = newMode;
            saveSparkMode(newMode);
            renderModeSwitch(newMode);
        });
    }

    window.addEventListener('beforeunload', () => {
        if (syncChannel) {
            syncChannel.close();
        }
        if (!IS_ANALYSIS_WINDOW) {
            closeAnalysisWindow();
        }
    });

}

// ── Toggle Vue rapide / Vue complète ──────────────────────────────────────
const ANALYSIS_VIEW_KEY = 'investissementWebAnalysisView';

function _applyAnalysisView(view) {
    if (!nodes.analysisPanel) return;
    nodes.analysisPanel.dataset.analysisView = view;
    if (nodes.btnViewQuick) {
        nodes.btnViewQuick.classList.toggle('view-toggle-btn--active', view === 'quick');
        nodes.btnViewQuick.setAttribute('aria-pressed', String(view === 'quick'));
    }
    if (nodes.btnViewFull) {
        nodes.btnViewFull.classList.toggle('view-toggle-btn--active', view === 'full');
        nodes.btnViewFull.setAttribute('aria-pressed', String(view === 'full'));
    }
    try { localStorage.setItem(ANALYSIS_VIEW_KEY, view); } catch {}
}

function _initAnalysisViewToggle() {
    let saved = 'quick';
    try { saved = localStorage.getItem(ANALYSIS_VIEW_KEY) || 'quick'; } catch {}
    _applyAnalysisView(saved === 'full' ? 'full' : 'quick');
    nodes.btnViewQuick?.addEventListener('click', () => _applyAnalysisView('quick'));
    nodes.btnViewFull?.addEventListener('click', () => _applyAnalysisView('full'));
}

function initWorkspaceTabs() {
    const tabs = document.querySelectorAll('.workspace-tab');
    const workspacePanel = document.querySelector('.workspace-panel');
    const collectionPanel = document.getElementById('collection-panel');
    const scannerPanel = document.getElementById('scanner-panel');
    collectionPanel.style.display = 'none';
    if (scannerPanel) scannerPanel.style.display = 'none';

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('is-active'));
            tab.classList.add('is-active');
            const target = tab.dataset.target;
            workspacePanel.style.display = 'none';
            collectionPanel.style.display = 'none';
            if (scannerPanel) scannerPanel.style.display = 'none';

            if (target === 'collection-panel') {
                collectionPanel.style.display = '';
                collectionPanel.style.animation = 'tabFadeIn 200ms ease-out';
                if (typeof _portfolioMap !== 'undefined' && _portfolioMap) { window.requestAnimationFrame(() => _portfolioMap.invalidateSize()); }
            } else if (target === 'scanner-panel') {
                if (scannerPanel) {
                    scannerPanel.style.display = '';
                    scannerPanel.style.animation = 'tabFadeIn 200ms ease-out';
                    onScannerTabActivated();
                }
            } else {
                workspacePanel.style.display = '';
                workspacePanel.style.animation = 'tabFadeIn 200ms ease-out';
            }
        });
    });
}

function initGlossaire() {
    const GLOSSAIRE_DATA = [
        {
            section: 'Rentabilité',
            terms: [
                { name: 'CF brut', def: 'Première mesure de rendement, avant toute déduction.', formula: 'Loyers annuels bruts / Prix d\'achat × 100' },
                { name: 'CF net', def: 'Cash-flow après déduction des charges (crédit, charges courantes, vacance, gestion). Hors impôts.', formula: 'CF net = Loyers × (1 - vacance) - crédit annuel - charges' },
                { name: 'CF net-net', def: 'Cash-flow après impôts. Indicateur final de ce qui reste en poche chaque mois.', formula: 'CF net-net = CF net - impôts' },
                { name: 'Rendement brut', def: 'Benchmark rapide, ne tient pas compte des charges ni des impôts.', formula: 'Loyers annuels / Prix d\'achat total × 100' },
                { name: 'Rendement net', def: 'Rendement après charges et impôts. Plus représentatif de la performance réelle.', formula: null },
                { name: 'GRM (Gross Rent Multiplier)', def: 'Nombre d\'années de loyers bruts pour rembourser le bien. Plus bas = mieux.', formula: 'Prix d\'achat / Loyers annuels bruts' },
                { name: 'CoC (Cash-on-Cash)', def: 'Rendement sur le capital investi personnellement. Mesure l\'efficacité de l\'effet de levier.', formula: 'CF net annuel / Apport × 100' },
                { name: 'Effort d\'épargne', def: 'Montant mensuel que l\'investisseur doit débourser de sa poche si le CF net-net est négatif.', formula: 'max(0, -CF net-net mensuel)' }
            ]
        },
        {
            section: 'Financement',
            terms: [
                { name: 'DSCR (Debt Service Coverage Ratio)', def: 'Capacité du bien à couvrir sa dette. > 1.2 = confortable, < 1 = le bien ne s\'autofinance pas.', formula: 'Loyers nets / Mensualité crédit' },
                { name: 'Apport', def: 'Capital personnel investi (hors crédit). Influence le CoC et le taux d\'endettement.', formula: null },
                { name: 'Taux d\'endettement', def: 'Limite réglementaire en France : 35 %.', formula: 'Total mensualités crédit / Revenus mensuels nets × 100' },
                { name: 'CRD (Capital Restant Dû)', def: 'Montant encore dû à la banque à une date donnée. Diminue au fil des remboursements.', formula: null },
                { name: 'Amortissement', def: 'Part de la mensualité qui rembourse le capital (vs intérêts). Augmente avec le temps.', formula: null }
            ]
        },
        {
            section: 'Fiscalité & Risque',
            terms: [
                { name: 'TMI (Tranche Marginale d\'Imposition)', def: 'Taux de la dernière tranche d\'imposition du foyer. Détermine l\'impôt sur les revenus fonciers en régime réel ou micro.', formula: null },
                { name: 'Micro-foncier', def: 'Régime simplifié avec abattement forfaitaire de 30 % sur les loyers. Plafond 15 000 €/an. Pas de déduction des charges réelles.', formula: null },
                { name: 'Réel foncier', def: 'Régime permettant de déduire les charges réelles (crédit, travaux, gestion…). Souvent plus avantageux si charges > 30 % des loyers.', formula: null },
                { name: 'SCI IS', def: 'Société Civile Immobilière soumise à l\'Impôt sur les Sociétés. Taux IS 15 % jusqu\'à 42 500 €. Amortissement du bien déductible.', formula: null },
                { name: 'Vacance locative', def: 'Période sans locataire. Paramétrable en % des loyers annuels.', formula: null },
                { name: 'Score de confiance', def: 'Note interne (0–100) mesurant la fiabilité des hypothèses saisies (loyer, charges, travaux…). Plus les données sont sourcées, plus le score est élevé.', formula: null }
            ]
        }
    ];

    const drawer = document.getElementById('glossaire-drawer');
    const overlay = document.getElementById('glossaire-overlay');
    const btn = document.getElementById('glossaire-btn');
    const closeBtn = document.getElementById('glossaire-close');
    const content = document.getElementById('glossaire-content');
    if (!drawer || !overlay || !btn || !closeBtn || !content) return;

    const html = GLOSSAIRE_DATA.map(({ section, terms }) => {
        const termsHtml = terms.map(({ name, def, formula }) => `
            <div class="glossaire-term">
                <div class="glossaire-term__name">${escapeHtml(name)}</div>
                <div class="glossaire-term__def">${escapeHtml(def)}</div>
                ${formula ? `<span class="glossaire-term__formula">${escapeHtml(formula)}</span>` : ''}
            </div>
        `).join('');
        return `<div class="glossaire-section"><div class="glossaire-section__title">${escapeHtml(section)}</div>${termsHtml}</div>`;
    }).join('');
    content.innerHTML = html;

    function openGlossaire() { drawer.hidden = false; overlay.hidden = false; closeBtn.focus(); }
    function closeGlossaire() { drawer.hidden = true; overlay.hidden = true; btn.focus(); }

    btn.addEventListener('click', openGlossaire);
    closeBtn.addEventListener('click', closeGlossaire);
    overlay.addEventListener('click', closeGlossaire);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !drawer.hidden) closeGlossaire(); });
}

function initAccordion() {
    const sections = document.querySelectorAll('.accord-section');
    sections.forEach(section => {
        const btn = section.querySelector('.accord-head');
        btn.addEventListener('click', () => {
            const isOpen = section.dataset.open === 'true';
            sections.forEach(s => {
                s.dataset.open = 'false';
                s.querySelector('.accord-head').setAttribute('aria-expanded', 'false');
            });
            if (!isOpen) {
                section.dataset.open = 'true';
                btn.setAttribute('aria-expanded', 'true');
            }
        });
    });
}

// Synchronisation sliders
function initSliders() {
    const pairs = [
        { input: 'taux-input', slider: 'taux-slider' },
        { input: 'duree', slider: 'duree-slider' },
    ];
    pairs.forEach(({ input, slider }) => {
        const inputEl = document.getElementById(input);
        const sliderEl = document.getElementById(slider);
        if (!inputEl || !sliderEl) return;

        // Sync slider → input
        sliderEl.addEventListener('input', () => {
            inputEl.value = sliderEl.value;
            inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        });

        // Sync input → slider
        inputEl.addEventListener('input', () => {
            const val = parseFloat(inputEl.value);
            if (!isNaN(val)) sliderEl.value = Math.min(Math.max(val, parseFloat(sliderEl.min)), parseFloat(sliderEl.max));
        });

        // Init slider depuis valeur input
        const initVal = parseFloat(inputEl.value);
        if (!isNaN(initVal)) sliderEl.value = Math.min(Math.max(initVal, parseFloat(sliderEl.min)), parseFloat(sliderEl.max));
    });
}

console.log('[Spark] Init start');
initOwnedPortfolio({ state, nodes, STORAGE_KEYS, IS_ANALYSIS_WINDOW });
populateProfiles();
setupCrossWindowSync();
bindEvents();
try {
    render();
    console.log('[Spark] render() OK');
} catch (err) {
    console.error('[Spark] Erreur au render initial :', err);
    showToast('Erreur au démarrage — consultez la console.', 'negative');
}
applyGuidedModeUI(isGuidedModeActive());
initWorkspaceTabs();
_initAnalysisViewToggle();
initScanner({ saveCurrentStudy });
initOwnedPortfolioEvents();
if (!state.profileConfigured && !IS_ANALYSIS_WINDOW) {
    setTimeout(() => openProfileModal(), 400);
}
initAccordion();
initTutoBar();
initGlossaire();
initSliders();

fetch('/api/version')
    .then((res) => res.json())
    .then((data) => {
        if (nodes.topbarVersion && data && data.version) {
            nodes.topbarVersion.textContent = `v${data.version}`;
        }
    })
    .catch(() => {});

// Modal régimes fiscaux
const btnRegimeModal = document.getElementById('btn-regime-modal');
const modalRegimes = document.getElementById('modal-regimes');
const modalRegimesClose = document.getElementById('modal-regimes-close');
if (btnRegimeModal && modalRegimes) {
    btnRegimeModal.addEventListener('click', () => {
        modalRegimes.setAttribute('aria-hidden', 'false');
        modalRegimes.classList.add('is-open');
    });
    modalRegimesClose?.addEventListener('click', () => {
        modalRegimes.setAttribute('aria-hidden', 'true');
        modalRegimes.classList.remove('is-open');
    });
    modalRegimes.addEventListener('click', (e) => {
        if (e.target === modalRegimes) {
            modalRegimes.setAttribute('aria-hidden', 'true');
            modalRegimes.classList.remove('is-open');
        }
    });
}

if (!IS_ANALYSIS_WINDOW && state.screens === 2) {
    openAnalysisWindow({ focus: false });
    if (state.analysisPopupBlocked) {
        render({ syncVariables: false, syncProfile: false });
    }
}

