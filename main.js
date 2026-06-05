import { calculateTMI, computeAnalysisViewModel, computePortfolioViewModel, getHouseholdTaxParts, capitalRestantDu } from './calculs.js';
import { buildDecisionPrintDocument } from './pdf.js';
import { initScanner, onScannerTabActivated } from './scanner.js';

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
    sparkMode: 'investissementWebSparkMode'
};

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
    'statut-bien': 'candidate',
    ville: 'Ville à préciser',
    adresse: '',
    prix: 107000,
    nego: 0,
    loyer: 700,
    notaire: 8,
    travaux: 5000,
    meubles: 4000,
    agence: 0,
    dpe: 'D',
    'loyer-marche': 700,
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
    'decision-next-step': ''
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
            { id: 'ville', label: 'Ville', exemple: 'ex : Lyon', explication: 'Ville où se situe le bien, pour contextualiser l\'analyse.' },
            { id: 'statut-bien', label: 'Statut', exemple: 'À étudier ou Déjà au portefeuille', explication: 'Indiquez si ce bien est en cours d\'étude ou déjà acquis.' }
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
const OWNERSHIP_VALUES = new Set(['candidate', 'owned']);
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
    analysisPopupBlocked: false
};

let analysisWindowRef = null;
let syncChannel = null;
let assetDetailCloseTimer = null;
let profileModalReturnFocusTarget = null;
let assetDetailReturnFocusTarget = null;

const nodes = {
    themeToggle: document.getElementById('theme-toggle'),
    screenToggle: document.getElementById('screen-toggle'),
    profileTrigger: document.getElementById('profile-trigger'),
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
    variablesKicker: document.getElementById('variables-kicker'),
    variablesSubtitle: document.getElementById('variables-subtitle'),
    variablesContext: document.getElementById('variables-context'),
    variablesForm: document.getElementById('variables-form'),
    decisionThesisError: document.getElementById('decision-thesis-error'),
    decisionNextStepError: document.getElementById('decision-next-step-error'),
    newAsset: document.getElementById('new-asset'),
    saveComparison: document.getElementById('save-comparison'),
    savePortfolio: document.getElementById('save-portfolio'),
    exportDecisionPdf: document.getElementById('export-decision-pdf'),
    analysisKicker: document.getElementById('analysis-kicker'),
    analysisSubtitle: document.getElementById('analysis-subtitle'),
    analysisStickySummary: document.getElementById('analysis-sticky-summary'),
    analysisAcquisitionDecision: document.getElementById('analysis-acquisition-decision'),
    analysisChecklist: document.getElementById('analysis-checklist'),
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
    analysisSummary: document.getElementById('analysis-summary'),
    analysisActionPlan: document.getElementById('analysis-action-plan'),
    analysisDetails: document.getElementById('analysis-details'),
    portfolioHero: document.getElementById('portfolio-hero'),
    portfolioSimulator: document.getElementById('portfolio-simulator'),
    portfolioSummary: document.getElementById('portfolio-summary'),
    portfolioPriorities: document.getElementById('portfolio-priorities'),
    portfolioKpiBanner: document.getElementById('portfolio-kpi-banner'),
    portfolioAssetGridOwned: document.getElementById('portfolio-asset-grid-owned'),
    portfolioAssetGridPipeline: document.getElementById('portfolio-asset-grid-pipeline'),
    creditDrawerOverlay: document.getElementById('credit-drawer-overlay'),
    creditDrawer: document.getElementById('credit-drawer'),
    creditDrawerAssetId: document.getElementById('credit-drawer-asset-id'),
    creditDrawerAssetName: document.getElementById('credit-drawer-asset-name'),
    creditDateDebut: document.getElementById('credit-date-debut'),
    creditDateFin: document.getElementById('credit-date-fin'),
    creditMensualite: document.getElementById('credit-mensualite'),
    creditDateRevente: document.getElementById('credit-date-revente'),
    assetStatusBar: document.getElementById('asset-status-bar'),
    assetDetailOverlay: document.getElementById('asset-detail-overlay'),
    assetDetailDrawer: document.getElementById('asset-detail-drawer'),
    assetDetailContent: document.getElementById('asset-detail-content'),
    profileModal: document.getElementById('profile-modal'),
    profileClose: document.getElementById('profile-close'),
    profileSave: document.getElementById('profile-save'),
    profileModalNote: document.getElementById('profile-modal-note'),
    profileSelect: document.getElementById('profile-select'),
    profileForm: document.getElementById('profile-form'),
    profileName: document.getElementById('profile-name'),
    profileIncome: document.getElementById('profile-income'),
    profileAdults: document.getElementById('profile-adults'),
    profileChildren: document.getElementById('profile-children'),
    profileObjectifCF: document.getElementById('profile-objectif-cf'),
    profileRevaloAnnuelle: document.getElementById('profile-revalo-annuelle'),
    portfolioFiscal: document.getElementById('portfolio-fiscal'),
    portfolioDebtRatios: document.getElementById('portfolio-debt-ratios'),
    portfolioObjectif: document.getElementById('portfolio-objectif'),
    portfolioProjection: document.getElementById('portfolio-projection'),
    portfolioRepartition: document.getElementById('portfolio-repartition'),
    portfolioCredits: document.getElementById('portfolio-credits'),
    autreCreditDrawerOverlay: document.getElementById('autre-credit-drawer-overlay'),
    autreCreditDrawer: document.getElementById('autre-credit-drawer'),
    autreCreditDrawerId: document.getElementById('autre-credit-drawer-id'),
    autreCreditLibelle: document.getElementById('autre-credit-libelle'),
    autreCreditMensualite: document.getElementById('autre-credit-mensualite'),
    autreCreditMensualiteHa: document.getElementById('autre-credit-mensualite-ha'),
    autreCreditDateDebut: document.getElementById('autre-credit-date-debut'),
    autreCreditDateFin: document.getElementById('autre-credit-date-fin'),
    autreCreditCrd: document.getElementById('autre-credit-crd'),
    portfolioTimeline: document.getElementById('portfolio-timeline'),
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

function getTypeBienLabel(type) {
    if (type === 'maison') return 'Maison';
    if (type === 'immeuble') return 'Immeuble de rapport';
    return 'Appartement';
}

function sanitizeVariablesData(rawVariables) {
    return {
        'nom-bien': normalizeLegacyCopy(rawVariables['nom-bien'] || VARIABLE_DEFAULTS['nom-bien']) || VARIABLE_DEFAULTS['nom-bien'],
        'type-bien': TYPE_BIEN_VALUES.has(rawVariables['type-bien']) ? rawVariables['type-bien'] : 'appartement',
        'statut-bien': OWNERSHIP_VALUES.has(rawVariables['statut-bien']) ? rawVariables['statut-bien'] : 'candidate',
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
        'decision-next-step': String(rawVariables['decision-next-step'] || '').trim()
    };
}

function sanitizeAssetRecord(rawAsset) {
    if (!rawAsset || typeof rawAsset !== 'object') {
        return null;
    }

    const raw = rawAsset.creditSchedule;
    const creditSchedule = (raw && typeof raw === 'object') ? {
        dateDebut: typeof raw.dateDebut === 'string' ? raw.dateDebut : '',
        dateFin: typeof raw.dateFin === 'string' ? raw.dateFin : '',
        mensualite: Math.max(0, Number(raw.mensualite) || 0)
    } : null;

    return {
        id: typeof rawAsset.id === 'string' && rawAsset.id ? rawAsset.id : createAssetId(),
        variablesData: sanitizeVariablesData({ ...VARIABLE_DEFAULTS, ...(rawAsset.variablesData || {}) }),
        inComparison: Boolean(rawAsset.inComparison),
        inPortfolio: Boolean(rawAsset.inPortfolio),
        creditSchedule: creditSchedule,
        dateRevente: typeof rawAsset.dateRevente === 'string' ? rawAsset.dateRevente : '',
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

function showToast(message, tone = 'positive') {
    const existing = document.getElementById('app-toast');
    if (existing) existing.remove();
    const el = document.createElement('div');
    el.id = 'app-toast';
    el.className = `app-toast app-toast--${tone}`;
    el.textContent = message;
    document.body.appendChild(el);
    el.getBoundingClientRect();
    el.classList.add('app-toast--visible');
    setTimeout(() => {
        el.classList.remove('app-toast--visible');
        el.addEventListener('transitionend', () => el.remove(), { once: true });
    }, 3000);
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

function formatCurrency(value) {
    return new Intl.NumberFormat('fr-FR', {
        style: 'currency',
        currency: 'EUR',
        maximumFractionDigits: 0
    }).format(value);
}

function formatPercent(value) {
    if (!Number.isFinite(value)) {
        return '--';
    }
    return `${value.toFixed(1)} %`;
}

function formatRatio(value) {
    if (!Number.isFinite(value)) {
        return '--';
    }
    return value.toFixed(2);
}

function formatSignedCurrency(value) {
    const roundedValue = Math.round(value);
    const label = formatCurrency(Math.abs(roundedValue));
    if (roundedValue > 0) {
        return `+${label}`;
    }
    if (roundedValue < 0) {
        return `-${label}`;
    }
    return label;
}

function formatCompactCurrency(value) {
    if (!Number.isFinite(value)) {
        return '--';
    }
    const roundedValue = Math.round(value);
    const sign = roundedValue > 0 ? '+' : (roundedValue < 0 ? '-' : '');
    const compactValue = new Intl.NumberFormat('fr-FR', {
        notation: 'compact',
        maximumFractionDigits: 1
    }).format(Math.abs(roundedValue));
    return `${sign}${compactValue} €`;
}

function formatPlainCurrency(value) {
    return formatCurrency(value).replace(/\u00A0/g, ' ');
}

function formatShortDateTime(value) {
    if (!value) {
        return '—';
    }

    try {
        return new Intl.DateTimeFormat('fr-FR', {
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        }).format(new Date(value));
    } catch (error) {
        return '—';
    }
}

function getMetricClass(value) {
    if (value > 0) return 'is-positive';
    if (value < 0) return 'is-negative';
    return '';
}

function getDecisionClass(tone) {
    if (tone === 'positive') return 'is-positive';
    if (tone === 'excellent') return 'is-excellent';
    if (tone === 'watch') return 'is-watch';
    if (tone === 'negative') return 'is-negative';
    return 'is-neutral';
}

function getRegimeLabel(regime) {
    if (regime === 'micro-foncier') return 'Micro-foncier';
    if (regime === 'sci-is') return 'SCI à l\'IS';
    return 'Foncier réel';
}

function getChecklistTone(status) {
    if (status === 'ready') return 'positive';
    if (status === 'watch') return 'watch';
    return 'negative';
}

function getChecklistLabel(status) {
    if (status === 'ready') return 'OK';
    if (status === 'watch') return 'A verifier';
    return 'Bloquant';
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatMultilineText(value) {
    return escapeHtml(value).replace(/\n/g, '<br>');
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

function getOwnershipLabel(status) {
    return status === 'owned' ? 'Déjà au portefeuille' : 'À étudier';
}

function getCurrentAssetName() {
    return state.variablesData['nom-bien'] || VARIABLE_DEFAULTS['nom-bien'];
}

function getCurrentAssetStatus() {
    return getOwnershipLabel(state.variablesData['statut-bien']);
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

function buildWorkspaceHero(analysisModel, { tmi, composition, useLocalFallback = false } = {}) {
    if (!nodes.workspaceHero) {
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
                        <strong>${escapeHtml(cityLabel)} · ${escapeHtml(typeLabel)} · ${escapeHtml(getCurrentAssetStatus())}</strong>
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

function buildAssetActionButtons(assetId, scope) {
    return `
        <div class="table-actions">
            <button type="button" class="table-action" data-action="preview-asset" data-scope="${scope}" data-id="${assetId}">Voir</button>
            <button type="button" class="table-action" data-action="load-asset" data-id="${assetId}">Ouvrir</button>
            <button type="button" class="table-action" data-action="remove-asset" data-scope="${scope}" data-id="${assetId}">Retirer</button>
        </div>
    `;
}

function getAssetRecordById(assetId) {
    return state.assetRecords.find(item => item.id === assetId) || null;
}

function getAssetDetailScopeMeta(asset, scope) {
    const effectiveScope = scope === 'portfolio' ? 'portfolio' : 'comparison';
    const inBothScopes = asset.inComparison && asset.inPortfolio;
    const isOwned = asset.variablesData?.['statut-bien'] === 'owned';

    if (effectiveScope === 'portfolio') {
        return {
            scope: effectiveScope,
            eyebrow: 'Fiche portefeuille',
            scopeLabel: isOwned ? 'Actif détenu' : (inBothScopes ? 'Actif suivi et arbitré' : 'Actif suivi au portefeuille'),
            primaryDecisionLabel: 'Lecture d exploitation',
            secondaryDecisionLabel: 'Lecture acquisition',
            removeLabel: 'Retirer du portefeuille'
        };
    }

    return {
        scope: effectiveScope,
        eyebrow: 'Fiche comparateur',
        scopeLabel: inBothScopes ? 'Dossier déjà lié au portefeuille' : 'Dossier à arbitrer',
        primaryDecisionLabel: 'Lecture acquisition',
        secondaryDecisionLabel: 'Lecture d exploitation',
        removeLabel: 'Retirer du comparateur'
    };
}

function buildAssetDetailMetricCard(value, label, note = '') {
    return `
        <article class="detail-kpi-card">
            <div class="detail-kpi-card__value">${value}</div>
            <div class="detail-kpi-card__label">${escapeHtml(label)}</div>
            ${note ? `<div class="detail-kpi-card__note">${escapeHtml(note)}</div>` : ''}
        </article>
    `;
}

function buildAssetDetailInfoCard(label, value) {
    return `
        <div class="detail-info-card">
            <span class="detail-info-card__label">${escapeHtml(label)}</span>
            <span class="detail-info-card__value">${escapeHtml(String(value))}</span>
        </div>
    `;
}

function buildAssetDetailContent(asset, requestedScope) {
    const scopeMeta = getAssetDetailScopeMeta(asset, requestedScope);
    const assetInputs = sanitizeVariablesData(asset.variablesData);
    const analysisModel = computeAnalysisViewModel({
        ...assetInputs,
        revenus: state.profileData.income,
        adults: state.profileData.adults,
        children: state.profileData.children
    });
    const { metrics, acquisitionDecision, decision, confidenceModel, scenarioModel, decisionJournal } = analysisModel;
    const primaryDecision = scopeMeta.scope === 'portfolio' ? decision : acquisitionDecision;
    const secondaryDecision = scopeMeta.scope === 'portfolio' ? acquisitionDecision : decision;
    const thesis = decisionJournal.thesis || decisionJournal.suggestedThesis;
    const nextStep = decisionJournal.nextStep || decisionJournal.suggestedNextStep;
    const monthlyRent = analysisModel.annual?.loyersEncaisses != null ? analysisModel.annual.loyersEncaisses / 12 : null;
    const debtMonthly = analysisModel.monthly?.mensualiteTotale;
    const checkpointsHtml = Array.isArray(decision.checkpoints) && decision.checkpoints.length
        ? decision.checkpoints.map(checkpoint => `
            <li>
                <div>
                    <span>${escapeHtml(checkpoint.label)}</span>
                    <small>${escapeHtml(checkpoint.target)}</small>
                </div>
                <strong class="status-pill status-pill--${checkpoint.tone}">${formatCheckpointValue(checkpoint)}</strong>
            </li>
        `).join('')
        : '<li><div><span>Lecture de contrôle</span><small>Aucune anomalie remontée</small></div><strong class="status-pill status-pill--neutral">Stable</strong></li>';

    return `
        <article class="detail-sheet asset-detail-sheet">
            <header class="detail-sheet__header">
                <div class="detail-sheet__copy">
                    <div class="detail-sheet__eyebrow">${escapeHtml(scopeMeta.eyebrow)}</div>
                    <h2 class="detail-sheet__title">${escapeHtml(assetInputs['nom-bien'] || VARIABLE_DEFAULTS['nom-bien'])}</h2>
                    <div class="detail-sheet__meta">${escapeHtml(assetInputs.ville || VARIABLE_DEFAULTS.ville)} · ${escapeHtml(getTypeBienLabel(assetInputs['type-bien']))} · ${escapeHtml(getOwnershipLabel(assetInputs['statut-bien']))} · mis à jour ${formatShortDateTime(asset.updatedAt)}</div>
                    <div class="asset-detail-chip-row">
                        <span class="collection-table-chip">${escapeHtml(scopeMeta.scopeLabel)}</span>
                        <span class="collection-table-chip">${confidenceModel.score}/100 fiabilité</span>
                        <span class="collection-table-chip">Stress ${escapeHtml(scenarioModel.label)}</span>
                        <span class="collection-table-chip">Régime ${escapeHtml(getRegimeLabel(assetInputs.regime))}</span>
                    </div>
                </div>
                <div class="detail-sheet__actions">
                    <span class="status-pill status-pill--${primaryDecision.tone}">${escapeHtml(scopeMeta.primaryDecisionLabel)}</span>
                    <strong class="decision-badge decision-badge--${primaryDecision.tone}">${escapeHtml(primaryDecision.label)}</strong>
                    <button id="asset-detail-close" class="detail-close" type="button">Fermer</button>
                </div>
            </header>

            <section class="detail-kpi-grid">
                ${buildAssetDetailMetricCard(`${acquisitionDecision.score}/100`, 'Score achat', acquisitionDecision.priceBand || 'Lecture de prix')}
                ${buildAssetDetailMetricCard(formatSignedCurrency(metrics.cfNetNet), 'CF net / mois', primaryDecision.action || '')}
                ${buildAssetDetailMetricCard(formatRatio(metrics.dscr), 'DSCR', decision.label)}
                ${buildAssetDetailMetricCard(formatPlainCurrency(acquisitionDecision.maxOfferPrice), 'Offre plafond', formatPlainCurrency(acquisitionDecision.currentPrice))}
                ${buildAssetDetailMetricCard(monthlyRent != null ? `${formatPlainCurrency(monthlyRent)}/mois` : '—', 'Loyers encaissés')}
                ${buildAssetDetailMetricCard(debtMonthly != null ? `${formatPlainCurrency(debtMonthly)}/mois` : '—', 'Dette mensuelle')}
            </section>

            <section class="detail-section detail-section--split">
                <div class="detail-section__pane">
                    <div class="detail-section__label">Verdict de dossier</div>
                    <div class="decision-card asset-detail-card">
                        <div class="decision-head">
                            <span class="status-label">${escapeHtml(scopeMeta.primaryDecisionLabel)}</span>
                            <strong class="decision-badge decision-badge--${primaryDecision.tone}">${escapeHtml(primaryDecision.label)}</strong>
                        </div>
                        <p class="analysis-verdict">${escapeHtml(primaryDecision.summary)}</p>
                        <p class="decision-hint">Action recommandée : <strong>${escapeHtml(primaryDecision.action)}</strong></p>
                        <div class="asset-detail-secondary-decision">
                            <span>${escapeHtml(scopeMeta.secondaryDecisionLabel)}</span>
                            <strong class="status-pill status-pill--${secondaryDecision.tone}">${escapeHtml(secondaryDecision.label)}</strong>
                        </div>
                    </div>
                </div>
                <div class="detail-section__pane">
                    <div class="detail-section__label">Hypothèses structurantes</div>
                    <div class="detail-info-grid">
                        ${buildAssetDetailInfoCard('Prix affiché', formatPlainCurrency(acquisitionDecision.currentPrice))}
                        ${buildAssetDetailInfoCard('Loyer cible', formatPlainCurrency(assetInputs.loyer) + ' / mois')}
                        ${buildAssetDetailInfoCard('Apport', formatPlainCurrency(assetInputs.apport))}
                        ${buildAssetDetailInfoCard('Travaux', formatPlainCurrency(assetInputs.travaux))}
                        ${buildAssetDetailInfoCard('Taux', `${assetInputs['taux-input']} %`) }
                        ${buildAssetDetailInfoCard('Durée', `${assetInputs.duree} ans`) }
                        ${buildAssetDetailInfoCard('DPE', String(assetInputs.dpe || 'NR').toUpperCase())}
                        ${buildAssetDetailInfoCard('Créé le', formatShortDateTime(asset.createdAt))}
                    </div>
                </div>
            </section>

            <section class="detail-section detail-section--split">
                <div class="detail-section__pane">
                    <div class="detail-section__label">Thèse d investissement</div>
                    <blockquote class="detail-quote">${formatMultilineText(thesis)}</blockquote>
                </div>
                <div class="detail-section__pane">
                    <div class="detail-section__label">Prochaine étape</div>
                    <div class="asset-detail-note">${formatMultilineText(nextStep)}</div>
                </div>
            </section>

            <section class="detail-section">
                <div class="detail-section__label">Points de contrôle</div>
                <ul class="decision-checkpoints asset-detail-checkpoints">${checkpointsHtml}</ul>
            </section>

            <footer class="detail-sheet__footer">
                <button id="asset-detail-load" class="detail-action-button detail-action-button--primary" type="button">Ouvrir dans l'étude</button>
                <button id="asset-detail-remove" class="detail-action-button detail-action-button--secondary" type="button">${escapeHtml(scopeMeta.removeLabel)}</button>
            </footer>
        </article>
    `;
}

function renderAssetDetailContent(asset, scope) {
    if (!nodes.assetDetailContent) {
        return;
    }

    nodes.assetDetailContent.innerHTML = buildAssetDetailContent(asset, scope);
    nodes.assetDetailContent.querySelector('#asset-detail-close')?.addEventListener('click', closeAssetDetailDrawer);
    nodes.assetDetailContent.querySelector('#asset-detail-load')?.addEventListener('click', () => {
        closeAssetDetailDrawer();
        loadAssetIntoWorkspace(asset.id);
    });
    nodes.assetDetailContent.querySelector('#asset-detail-remove')?.addEventListener('click', () => {
        closeAssetDetailDrawer();
        removeAssetFromScope(asset.id, scope);
    });
}

function openAssetDetailDrawer(assetId, scope) {
    const asset = getAssetRecordById(assetId);
    if (!asset || !nodes.assetDetailOverlay || !nodes.assetDetailDrawer || !nodes.assetDetailContent) {
        return;
    }

    if (assetDetailCloseTimer) {
        clearTimeout(assetDetailCloseTimer);
        assetDetailCloseTimer = null;
    }

    assetDetailReturnFocusTarget = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    renderAssetDetailContent(asset, scope);
    nodes.assetDetailOverlay.style.display = 'block';
    nodes.assetDetailDrawer.style.display = 'block';
    nodes.assetDetailOverlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('drawer-open');
    void nodes.assetDetailOverlay.offsetWidth;
    void nodes.assetDetailDrawer.offsetWidth;
    nodes.assetDetailOverlay.classList.add('is-open');
    nodes.assetDetailDrawer.classList.add('is-open');
    nodes.assetDetailOverlay.onclick = closeAssetDetailDrawer;
    window.requestAnimationFrame(() => {
        nodes.assetDetailContent.querySelector('#asset-detail-close')?.focus();
    });
}

function closeAssetDetailDrawer() {
    const focusTarget = assetDetailReturnFocusTarget && document.contains(assetDetailReturnFocusTarget)
        ? assetDetailReturnFocusTarget
        : null;

    nodes.assetDetailOverlay?.classList.remove('is-open');
    nodes.assetDetailDrawer?.classList.remove('is-open');
    if (nodes.assetDetailOverlay) {
        nodes.assetDetailOverlay.setAttribute('aria-hidden', 'true');
    }
    document.body.classList.remove('drawer-open');
    focusTarget?.focus();
    if (assetDetailCloseTimer) {
        clearTimeout(assetDetailCloseTimer);
    }
    assetDetailCloseTimer = setTimeout(() => {
        if (nodes.assetDetailOverlay) {
            nodes.assetDetailOverlay.style.display = 'none';
        }
        if (nodes.assetDetailDrawer) {
            nodes.assetDetailDrawer.style.display = 'none';
        }
        assetDetailReturnFocusTarget = null;
        assetDetailCloseTimer = null;
    }, 220);
}

function openCreditDrawer(assetId) {
    const asset = getAssetRecordById(assetId);
    if (!asset || !nodes.creditDrawer) return;

    const cs = asset.creditSchedule;
    nodes.creditDrawerAssetId.value = assetId;
    nodes.creditDrawerAssetName.textContent = asset.variablesData['nom-bien'] || 'Bien';
    nodes.creditDateDebut.value = cs?.dateDebut || '';
    nodes.creditDateFin.value = cs?.dateFin || '';
    nodes.creditMensualite.value = cs?.mensualite != null ? String(cs.mensualite) : '';
    nodes.creditDateRevente.value = asset.dateRevente || '';

    nodes.creditDrawerOverlay.style.display = 'block';
    nodes.creditDrawer.style.display = 'block';
    nodes.creditDrawerOverlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('drawer-open');
    void nodes.creditDrawer.offsetWidth;
    nodes.creditDrawerOverlay.classList.add('is-open');
    nodes.creditDrawer.classList.add('is-open');
    nodes.creditDrawerOverlay.onclick = closeCreditDrawer;
    window.requestAnimationFrame(() => nodes.creditDateDebut?.focus());
}

function closeCreditDrawer() {
    nodes.creditDrawerOverlay?.classList.remove('is-open');
    nodes.creditDrawer?.classList.remove('is-open');
    nodes.creditDrawerOverlay?.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('drawer-open');
    setTimeout(() => {
        if (nodes.creditDrawerOverlay) nodes.creditDrawerOverlay.style.display = 'none';
        if (nodes.creditDrawer) nodes.creditDrawer.style.display = 'none';
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
    nodes.autreCreditDrawerOverlay.style.display = 'block';
    nodes.autreCreditDrawer.style.display = 'block';
    nodes.autreCreditDrawerOverlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('drawer-open');
    void nodes.autreCreditDrawer.offsetWidth;
    nodes.autreCreditDrawerOverlay.classList.add('is-open');
    nodes.autreCreditDrawer.classList.add('is-open');
    nodes.autreCreditDrawerOverlay.onclick = closeAutreCreditDrawer;
    window.requestAnimationFrame(() => nodes.autreCreditLibelle?.focus());
}

function closeAutreCreditDrawer() {
    nodes.autreCreditDrawerOverlay?.classList.remove('is-open');
    nodes.autreCreditDrawer?.classList.remove('is-open');
    nodes.autreCreditDrawerOverlay?.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('drawer-open');
    setTimeout(() => {
        if (nodes.autreCreditDrawerOverlay) nodes.autreCreditDrawerOverlay.style.display = 'none';
        if (nodes.autreCreditDrawer) nodes.autreCreditDrawer.style.display = 'none';
    }, 220);
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
    showToast('Crédit supprimé.');
}

function handlePortfolioCreditsAction(event) {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    const creditId = button.dataset.creditId;
    if (action === 'add-autre-credit') { openAutreCreditDrawer(null); return; }
    if (action === 'edit-autre-credit' && creditId) { openAutreCreditDrawer(creditId); return; }
    if (action === 'delete-autre-credit' && creditId) { handleDeleteAutreCredit(creditId); return; }
}

function handleCreditDrawerSave(event) {
    event.preventDefault();
    const assetId = nodes.creditDrawerAssetId.value;
    const assetIndex = state.assetRecords.findIndex(a => a.id === assetId);
    if (assetIndex < 0) { closeCreditDrawer(); return; }

    const mensualite = Math.max(0, Number(nodes.creditMensualite.value) || 0);
    const dateDebut = nodes.creditDateDebut.value || '';
    const dateFin = nodes.creditDateFin.value || '';
    const dateRevente = nodes.creditDateRevente.value || '';

    const creditSchedule = (mensualite > 0 || dateDebut || dateFin)
        ? { dateDebut, dateFin, mensualite }
        : null;

    const existing = state.assetRecords[assetIndex];
    state.assetRecords.splice(assetIndex, 1, { ...existing, creditSchedule, dateRevente, updatedAt: Date.now() });
    saveAssetRecords();
    closeCreditDrawer();
    emitStateUpdate();
    render({ syncVariables: false, syncProfile: false });
    showToast('Échéancier crédit enregistré.');
}

function buildEmptyTableMarkup(message) {
    return `<p class="collection-empty">${message}</p>`;
}

function buildCollectionTableShell({
    eyebrow,
    title,
    summary,
    chips = [],
    emptyMessage,
    tableMarkup,
}) {
    const chipsMarkup = chips.length
        ? `<div class="collection-table-meta">${chips.map(chip => `<span class="collection-table-chip">${escapeHtml(chip)}</span>`).join('')}</div>`
        : '';

    return `
        <div class="collection-table-panel">
            <div class="collection-table-head">
                <div class="collection-table-copy">
                    <div class="collection-table-kicker">${escapeHtml(eyebrow)}</div>
                    <div class="collection-table-title">${escapeHtml(title)}</div>
                    <p class="collection-table-summary">${escapeHtml(summary)}</p>
                </div>
                ${chipsMarkup}
            </div>
            ${tableMarkup ? `<div class="collection-table-scroll">${tableMarkup}</div>` : `<div class="collection-table-empty">${escapeHtml(emptyMessage || '')}</div>`}
        </div>
    `;
}

function buildCollectionMetricCards(dashboard) {
    const cards = [
        { label: 'Biens suivis', value: String(dashboard.assetCount), cssClass: '' },
        { label: 'Biens détenus', value: String(dashboard.ownedCount), cssClass: '' },
        { label: 'CF consolidé', value: formatSignedCurrency(dashboard.totalCashflow), cssClass: getMetricClass(dashboard.totalCashflow) },
        { label: 'Fiscalité locative', value: formatPlainCurrency(dashboard.consolidatedTaxAnnual), cssClass: dashboard.consolidatedTaxAnnual > 0 ? 'is-watch' : 'is-positive' },
        { label: 'Dette mensuelle', value: formatPlainCurrency(dashboard.totalDebtMonthly), cssClass: '' },
        { label: 'Valeur créée à 10 ans', value: formatSignedCurrency(dashboard.totalTraction), cssClass: getMetricClass(dashboard.totalTraction) },
    ];

    nodes.portfolioSummary.innerHTML = cards.map(card => `
        <article class="metric-card">
            <span class="metric-label">${card.label}</span>
            <strong class="metric-value ${card.cssClass}">${card.value}</strong>
        </article>
    `).join('');
}

function buildPortfolioHero(collectionsView) {
    if (!nodes.portfolioHero) return;

    const { dashboard } = collectionsView;
    const assetCount = dashboard.assetCount || 0;

    let tone = 'neutral', label = 'À initialiser', summary = 'Ajoutez un premier actif pour obtenir une synthèse consolidée.', action = 'Enregistrer un dossier dans le comparateur ou le portefeuille.';
    if (assetCount > 0) {
        if (dashboard.totalCashflow < 0 || dashboard.dscr < 1) {
            tone = 'negative'; label = 'Sous tension';
            summary = 'Le portefeuille consomme de la trésorerie ou ne couvre plus sa dette.';
            action = 'Traiter les biens les plus faibles avant toute nouvelle acquisition.';
        } else if (dashboard.totalCashflow < 150 || dashboard.dscr < 1.1) {
            tone = 'watch'; label = 'À consolider';
            summary = 'Le portefeuille tient globalement, mais certains équilibres doivent encore être stabilisés.';
            action = 'Sécuriser les actifs les moins réguliers avant extension.';
        } else {
            tone = 'positive'; label = 'Conforme';
            summary = 'Le portefeuille couvre sa dette et conserve une marge consolidée exploitable.';
            action = 'Examiner uniquement les acquisitions qui améliorent l équilibre global.';
        }
    }

    nodes.portfolioHero.innerHTML = `
        <div class="workspace-hero-card workspace-hero-card--${tone}">
            <div class="workspace-hero-copy">
                <div class="workspace-hero-eyebrow">
                    <span class="workspace-hero-kicker">Synthèse portefeuille</span>
                    <span class="status-pill status-pill--${tone}">${escapeHtml(label)}</span>
                </div>
                <h2>${assetCount > 0 ? `${assetCount} actif${assetCount > 1 ? 's' : ''} suivi${assetCount > 1 ? 's' : ''}` : 'Portefeuille à initialiser'}</h2>
                <p class="workspace-hero-summary">${escapeHtml(summary)}</p>
                <div class="workspace-hero-action">
                    <span>Point de contrôle</span>
                    <strong>${escapeHtml(action)}</strong>
                </div>
                <div class="workspace-hero-meta">
                    <span class="workspace-hero-chip">${dashboard.ownedCount} détenu${dashboard.ownedCount > 1 ? 's' : ''}</span>
                    <span class="workspace-hero-chip">${escapeHtml(getProfileDisplayName())}</span>
                </div>
            </div>
            <aside class="workspace-hero-score">
                <span class="workspace-hero-score-label">Actifs suivis</span>
                <strong class="workspace-hero-score-value workspace-hero-score-value--${tone}">${assetCount}<small>${assetCount > 1 ? ' biens' : ' bien'}</small></strong>
                <span class="decision-badge decision-badge--${tone}">${escapeHtml(label)}</span>
                <div class="workspace-hero-mini-grid">
                    <article class="workspace-hero-mini-card">
                        <span>CF consolidé</span>
                        <strong class="value-${dashboard.totalCashflow >= 0 ? 'positive' : 'negative'}">${formatSignedCurrency(dashboard.totalCashflow)}</strong>
                    </article>
                    <article class="workspace-hero-mini-card">
                        <span>Dette mensuelle</span>
                        <strong>${formatPlainCurrency(dashboard.totalDebtMonthly)}</strong>
                    </article>
                    <article class="workspace-hero-mini-card">
                        <span>DSCR consolidé</span>
                        <strong class="value-${dashboard.dscr >= 1.1 ? 'positive' : dashboard.dscr >= 1 ? '' : 'negative'}">${dashboard.dscr.toFixed(2).replace('.', ',')}</strong>
                    </article>
                    <article class="workspace-hero-mini-card">
                        <span>Fiscalité / an</span>
                        <strong>${formatPlainCurrency(dashboard.consolidatedTaxAnnual)}</strong>
                    </article>
                </div>
            </aside>
        </div>
    `;
}


function buildPortfolioPriorities(priorities) {
    if (!priorities.length) {
        nodes.portfolioPriorities.innerHTML = '<p class="collection-empty">Aucune priorité d\'action tant qu aucun bien n est suivi au portefeuille.</p>';
        return;
    }

    nodes.portfolioPriorities.innerHTML = `
        <table class="analysis-table">
            <thead>
                <tr>
                    <th>Bien</th>
                    <th>Décision</th>
                    <th>CF / mois</th>
                    <th>Levier prioritaire</th>
                    <th>Impact</th>
                </tr>
            </thead>
            <tbody>
                ${priorities.map(item => `
                    <tr>
                        <td><strong>${item.name}</strong></td>
                        <td><span class="status-pill status-pill--${item.tone}">${item.decisionLabel}</span></td>
                        <td><strong class="${item.cfNetNet >= 0 ? 'value-positive' : 'value-negative'}">${formatSignedCurrency(item.cfNetNet)}</strong></td>
                        <td>${item.leverLabel}</td>
                        <td><strong class="${item.leverDelta >= 0 ? 'value-positive' : 'value-negative'}">${formatSignedCurrency(item.leverDelta)}</strong></td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}


function buildPortfolioKpiBanner(collectionsView) {
    if (!nodes.portfolioKpiBanner) return;

    const { dashboard, capacity, decision, portfolioItems } = collectionsView;

    if (!dashboard.assetCount) {
        nodes.portfolioKpiBanner.innerHTML = '';
        return;
    }

    const avgRdtBrut = portfolioItems.length
        ? portfolioItems.reduce((s, i) => s + (i.metrics.rentaBrute || 0), 0) / portfolioItems.length
        : 0;

    const cfTone = dashboard.totalCashflow >= 0 ? 'success' : 'danger';
    const dscrTone = dashboard.dscr >= 1.1 ? 'success' : dashboard.dscr >= 1 ? 'watch' : 'danger';
    const scoreRank = decision.rank ?? 0;
    const scoreTone = scoreRank >= 3 ? 'positive' : scoreRank >= 2 ? 'neutral' : scoreRank >= 1 ? 'watch' : 'negative';
    const scoreValue = [15, 35, 55, 75, 90][Math.min(4, scoreRank)];

    nodes.portfolioKpiBanner.innerHTML = `
        <div class="portfolio-health-bar">
            <div class="portfolio-health-score portfolio-health-score--${scoreTone}">${scoreValue}</div>
            <div class="portfolio-health-copy">
                <div class="portfolio-health-title">Score santé portefeuille · ${escapeHtml(decision.label)}</div>
                <div class="portfolio-health-note">${escapeHtml(decision.summary || decision.action || '')}</div>
            </div>
            <div class="portfolio-health-meta">${dashboard.ownedCount} bien${dashboard.ownedCount > 1 ? 's' : ''} détenu${dashboard.ownedCount > 1 ? 's' : ''} · ${collectionsView.comparisonItems.length} suivi${collectionsView.comparisonItems.length > 1 ? 's' : ''}</div>
        </div>
        <div class="portfolio-kpi-banner">
            <div class="portfolio-kpi-card portfolio-kpi-card--${cfTone === 'success' ? 'success' : 'neutral'}">
                <div class="portfolio-kpi-label">CF net-net</div>
                <div class="portfolio-kpi-value portfolio-kpi-value--${cfTone}">${formatSignedCurrency(dashboard.totalCashflow)}</div>
                <div class="portfolio-kpi-sub">/ mois consolidé</div>
            </div>
            <div class="portfolio-kpi-card portfolio-kpi-card--gold">
                <div class="portfolio-kpi-label">Rendement</div>
                <div class="portfolio-kpi-value portfolio-kpi-value--gold">${avgRdtBrut.toFixed(1).replace('.', ',')} %</div>
                <div class="portfolio-kpi-sub">brut moyen</div>
            </div>
            <div class="portfolio-kpi-card portfolio-kpi-card--info">
                <div class="portfolio-kpi-label">Patrimoine</div>
                <div class="portfolio-kpi-value portfolio-kpi-value--info">${Math.round(dashboard.totalValue / 1000)} k€</div>
                <div class="portfolio-kpi-sub">coût total investi</div>
            </div>
            <div class="portfolio-kpi-card portfolio-kpi-card--${dscrTone === 'success' ? 'success' : dscrTone}">
                <div class="portfolio-kpi-label">DSCR moyen</div>
                <div class="portfolio-kpi-value portfolio-kpi-value--${dscrTone}">${dashboard.dscr.toFixed(2).replace('.', ',')}</div>
                <div class="portfolio-kpi-sub">couverture dette</div>
            </div>
            <div class="portfolio-kpi-card portfolio-kpi-card--neutral">
                <div class="portfolio-kpi-label">Loyers / mois</div>
                <div class="portfolio-kpi-value">${formatCurrency(dashboard.totalRentMonthly)}</div>
                <div class="portfolio-kpi-sub">bruts encaissés</div>
            </div>
            <div class="portfolio-kpi-card portfolio-kpi-card--purple">
                <div class="portfolio-kpi-label">Capacité restante</div>
                <div class="portfolio-kpi-value portfolio-kpi-value--purple">${Math.round((capacity.acquisitionBudget || 0) / 1000)} k€</div>
                <div class="portfolio-kpi-sub">endettement estimé</div>
            </div>
        </div>
    `;
}

function buildPortfolioAssetCard(item, isPipeline) {
    const cf = item.metrics.cfNetNet || 0;
    const tone = isPipeline
        ? (item.analysisModel.acquisitionDecision?.tone || 'neutral')
        : (item.analysisModel.decision?.tone || 'neutral');
    const cfTone = cf > 0 ? 'positive' : cf < 0 ? 'negative' : 'watch';

    const loyerMensuel = (item.model.loyersEncaisses || 0) / 12;
    const creditMensuel = item.model.mensualiteTotale || (loyerMensuel * 0.55);
    const chargesMensuel = (item.model.chargesExploitationAnnuelles || 0) / 12;
    const netMensuel = cf;
    const totalFlux = Math.max(loyerMensuel, 1);

    function segWidth(val) {
        return Math.max(4, Math.min(60, (Math.abs(val) / totalFlux) * 100)).toFixed(1) + '%';
    }

    const prix = item.variablesData?.['prix']
        ? item.variablesData['prix'] - (item.variablesData['nego'] || 0)
        : item.metrics.coutTotal || 0;
    const regime = item.variablesData?.['regime'] || '';
    const decisionLabel = isPipeline
        ? (item.analysisModel.acquisitionDecision?.label || '')
        : (item.analysisModel.decision?.label || '');
    const decisionTone = isPipeline
        ? (item.analysisModel.acquisitionDecision?.tone || 'neutral')
        : (item.analysisModel.decision?.tone || 'neutral');
    const decisionValueTone = decisionTone === 'excellent' || decisionTone === 'positive' ? 'positive'
        : decisionTone === 'negative' ? 'negative' : 'watch';

    const detailParts = [
        loyerMensuel > 0 ? `Loyers ${formatCurrency(loyerMensuel)}` : null,
        creditMensuel > 0 ? `Crédit ${formatCurrency(creditMensuel)}` : null,
        chargesMensuel > 0 ? `Charges ${formatCurrency(chargesMensuel)}` : null,
        regime ? escapeHtml(regime.replace('micro-foncier','Micro-foncier').replace('reel','Réel').replace('sci-is','SCI-IS')) : null,
    ].filter(Boolean).join(' · ');

    return `
        <div class="asset-card asset-card--${tone}" data-asset-id="${escapeHtml(item.id)}">
            <div class="asset-card__inner">
                <div class="asset-card__header">
                    <div>
                        <div class="asset-card__name">${escapeHtml(item.name)}</div>
                        <div class="asset-card__meta">${escapeHtml(item.typeBien || '')} · ${escapeHtml(item.city || '')}${item.isActive ? ' · <strong>En cours</strong>' : ''}</div>
                    </div>
                    <div class="asset-card__cf">
                        <span class="asset-card__cf-value asset-card__cf-value--${cfTone}">${cf >= 0 ? '+' : ''}${Math.round(cf).toLocaleString('fr-FR')} €</span>
                        <span class="asset-card__cf-label">/mois net-net</span>
                    </div>
                </div>
                <div class="asset-card__waterfall" title="Loyers → Crédit → Charges → Net">
                    <div class="asset-card__waterfall-seg asset-card__waterfall-seg--income"  style="flex:${segWidth(loyerMensuel)}"></div>
                    <div class="asset-card__waterfall-seg asset-card__waterfall-seg--expense" style="flex:${segWidth(creditMensuel)}"></div>
                    <div class="asset-card__waterfall-seg asset-card__waterfall-seg--charges" style="flex:${segWidth(chargesMensuel)}"></div>
                    <div class="asset-card__waterfall-seg asset-card__waterfall-seg--${netMensuel >= 0 ? 'net-pos' : 'net-neg'}" style="flex:${segWidth(Math.abs(netMensuel))}"></div>
                </div>
                <div class="asset-card__kpis">
                    <div class="asset-card__kpi">
                        <span class="asset-card__kpi-value asset-card__kpi-value--gold">${(item.metrics.rentaBrute || 0).toFixed(1).replace('.', ',')} %</span>
                        <span class="asset-card__kpi-label">Rdt brut</span>
                    </div>
                    <div class="asset-card__kpi">
                        <span class="asset-card__kpi-value ${(item.metrics.dscr || 0) < 1 ? 'asset-card__kpi-value--negative' : ''}">${(item.metrics.dscr || 0).toFixed(2).replace('.', ',')}</span>
                        <span class="asset-card__kpi-label">DSCR</span>
                    </div>
                    <div class="asset-card__kpi">
                        <span class="asset-card__kpi-value asset-card__kpi-value--info">${Math.round(prix / 1000)} k€</span>
                        <span class="asset-card__kpi-label">Prix net</span>
                    </div>
                    <div class="asset-card__kpi">
                        <span class="asset-card__kpi-value asset-card__kpi-value--${decisionValueTone}">${escapeHtml(decisionLabel)}</span>
                        <span class="asset-card__kpi-label">Décision</span>
                    </div>
                </div>
                ${detailParts ? `<div class="asset-card__detail">${detailParts}</div>` : ''}
                <div class="asset-card__actions">
                    <button type="button" class="asset-card__action${isPipeline ? ' asset-card__action--primary' : ''}" data-action="open-asset" data-id="${escapeHtml(item.id)}">↩ Ouvrir</button>
                    <button type="button" class="asset-card__action" data-action="preview-asset" data-scope="${isPipeline ? 'comparison' : 'portfolio'}" data-id="${escapeHtml(item.id)}">Fiche</button>
                    <button type="button" class="asset-card__action" data-action="pdf-asset" data-id="${escapeHtml(item.id)}">PDF</button>
                    ${!isPipeline ? `<button type="button" class="asset-card__action${item.creditSchedule ? ' asset-card__action--has-credit' : ''}" data-action="edit-credit" data-id="${escapeHtml(item.id)}">Crédit${item.creditSchedule ? ' ✓' : ''}</button>` : ''}
                </div>
            </div>
        </div>
    `;
}

function buildPortfolioAssetGrid(collectionsView) {
    const { portfolioItems, comparisonItems } = collectionsView;
    const pipelineItems = comparisonItems.filter(item => !item.inPortfolio);

    if (nodes.portfolioAssetGridOwned) {
        if (!portfolioItems.length) {
            nodes.portfolioAssetGridOwned.innerHTML = `
                <div class="portfolio-asset-section-head">
                    <span class="portfolio-asset-section-title">Parc détenu</span>
                    <span class="portfolio-asset-section-badge portfolio-asset-section-badge--neutral">0 bien</span>
                </div>
                <p class="collection-empty">Aucun bien détenu enregistré. Ajoutez un bien avec le statut "Déjà au portefeuille".</p>
            `;
        } else {
            nodes.portfolioAssetGridOwned.innerHTML = `
                <div class="portfolio-asset-section-head">
                    <span class="portfolio-asset-section-title">Parc détenu</span>
                    <span class="portfolio-asset-section-badge portfolio-asset-section-badge--success">${portfolioItems.length} bien${portfolioItems.length > 1 ? 's' : ''}</span>
                </div>
                <div class="portfolio-asset-grid">
                    ${portfolioItems.map(item => buildPortfolioAssetCard(item, false)).join('')}
                </div>
            `;
        }
    }

    if (nodes.portfolioAssetGridPipeline) {
        if (!pipelineItems.length) {
            nodes.portfolioAssetGridPipeline.innerHTML = `
                <div class="portfolio-asset-section-head">
                    <span class="portfolio-asset-section-title">Pipeline d'acquisition</span>
                    <span class="portfolio-asset-section-badge portfolio-asset-section-badge--watch">0 dossier</span>
                </div>
                <p class="collection-empty">Aucun dossier dans le comparateur. Enregistrez une étude depuis Saisie &amp; Analyse.</p>
            `;
        } else {
            const placeholder = pipelineItems.length < 6
                ? `<div class="asset-card asset-card--placeholder">
                    <div style="text-align:center">
                        <span style="font-size:22px;color:var(--border);display:block;margin-bottom:4px">+</span>
                        <span style="font-size:10px;color:var(--muted)">Enregistrer une étude<br>depuis le simulateur</span>
                    </div>
                </div>` : '';
            nodes.portfolioAssetGridPipeline.innerHTML = `
                <div class="portfolio-asset-section-head">
                    <span class="portfolio-asset-section-title">Pipeline d'acquisition</span>
                    <span class="portfolio-asset-section-badge portfolio-asset-section-badge--watch">${pipelineItems.length} dossier${pipelineItems.length > 1 ? 's' : ''}</span>
                </div>
                <div class="portfolio-asset-grid">
                    ${pipelineItems.map(item => buildPortfolioAssetCard(item, true)).join('')}
                    ${placeholder}
                </div>
            `;
        }
    }
}

function buildComparisonTable(items) {
    const positiveCount = items.filter(item => {
        const tone = item.analysisModel.acquisitionDecision.tone;
        return tone === 'positive' || tone === 'excellent';
    }).length;
    const activeCount = items.filter(item => item.isActive).length;
    const uniqueCities = new Set(items.map(item => item.city).filter(Boolean)).size;

    if (!items.length) {
        nodes.comparisonTable.innerHTML = buildCollectionTableShell({
            eyebrow: 'Pipeline d acquisition',
            title: 'Comparateur actif',
            summary: 'Le comparateur se remplit avec les opportunités à étudier avant arbitrage final.',
            chips: ['0 dossier', '0 ville couverte'],
            emptyMessage: 'Aucun dossier n est encore chargé dans le comparateur.',
            tableMarkup: '',
        });
        return;
    }

    nodes.comparisonTable.innerHTML = buildCollectionTableShell({
        eyebrow: 'Pipeline d acquisition',
        title: 'Comparateur actif',
        summary: `${items.length} dossier${items.length > 1 ? 's' : ''} restent en file d étude avant passage au portefeuille ou arbitrage.`,
        chips: [
            `${positiveCount} dossier${positiveCount > 1 ? 's' : ''} favorable${positiveCount > 1 ? 's' : ''}`,
            `${activeCount} étude ouverte`,
            `${uniqueCities} ville${uniqueCities > 1 ? 's' : ''} couverte${uniqueCities > 1 ? 's' : ''}`,
        ],
        tableMarkup: `
            <table class="analysis-table analysis-table--collection">
                <thead>
                    <tr>
                        <th>Dossier</th>
                        <th>Statut</th>
                        <th>Décision</th>
                        <th>CF / mois</th>
                        <th>DSCR</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${items.map(item => `
                        <tr class="${item.isActive ? 'table-row-active' : ''}">
                            <td>
                                <strong>${escapeHtml(item.name)}</strong>
                                <div class="table-subline">${escapeHtml(item.city || 'Ville à préciser')}</div>
                                ${item.typeBien ? `<span class="type-badge type-badge--${item.typeBien}">${getTypeBienLabel(item.typeBien)}</span>` : ''}
                            </td>
                            <td><span class="status-pill status-pill--neutral">${item.statusLabel}</span></td>
                            <td><span class="status-pill status-pill--${item.analysisModel.acquisitionDecision.tone}">${item.analysisModel.acquisitionDecision.label}</span></td>
                            <td><strong class="${item.metrics.cfNetNet >= 0 ? 'value-positive' : 'value-negative'}">${formatSignedCurrency(item.metrics.cfNetNet)}</strong></td>
                            <td>${formatRatio(item.metrics.dscr)}</td>
                            <td>${buildAssetActionButtons(item.id, 'comparison')}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `,
    });
}

function buildPortfolioTable(items) {
    const totalCashflow = items.reduce((sum, item) => sum + (Number(item.metrics.cfNetNet) || 0), 0);
    const totalDebt = items.reduce((sum, item) => sum + (Number(item.analysisModel.monthly.mensualiteTotale) || 0), 0);
    const uniqueCities = new Set(items.map(item => item.city).filter(Boolean)).size;

    if (!items.length) {
        nodes.portfolioTable.innerHTML = buildCollectionTableShell({
            eyebrow: 'Parc détenu',
            title: 'Portefeuille stabilisé',
            summary: 'Les actifs déjà détenus doivent être enregistrés ici pour nourrir la lecture consolidée.',
            chips: ['0 actif', '0 ville couverte'],
            emptyMessage: 'Aucun actif n est encore enregistré dans le portefeuille.',
            tableMarkup: '',
        });
        return;
    }

    nodes.portfolioTable.innerHTML = buildCollectionTableShell({
        eyebrow: 'Parc détenu',
        title: 'Portefeuille stabilisé',
        summary: `${items.length} actif${items.length > 1 ? 's' : ''} alimentent désormais la lecture consolidée du portefeuille et de sa capacité d achat.`,
        chips: [
            `${items.length} actif${items.length > 1 ? 's' : ''}`,
            `CF consolidé ${formatSignedCurrency(totalCashflow)}`,
            `${uniqueCities} ville${uniqueCities > 1 ? 's' : ''} couverte${uniqueCities > 1 ? 's' : ''}`,
            `Dette ${formatPlainCurrency(totalDebt)}/mois`,
        ],
        tableMarkup: `
            <table class="analysis-table analysis-table--collection">
                <thead>
                    <tr>
                        <th>Bien</th>
                        <th>Statut</th>
                        <th>CF / mois</th>
                        <th>Loyers / mois</th>
                        <th>Dette / mois</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${items.map(item => `
                        <tr class="${item.isActive ? 'table-row-active' : ''}">
                            <td>
                                <strong>${escapeHtml(item.name)}</strong>
                                <div class="table-subline">${escapeHtml(item.city || 'Ville à préciser')} · ${item.analysisModel.decision?.label || '—'}</div>
                                ${item.typeBien ? `<span class="type-badge type-badge--${item.typeBien}">${getTypeBienLabel(item.typeBien)}</span>` : ''}
                            </td>
                            <td><span class="status-pill status-pill--neutral">${item.statusLabel}</span></td>
                            <td><strong class="${item.metrics.cfNetNet >= 0 ? 'value-positive' : 'value-negative'}">${formatSignedCurrency(item.metrics.cfNetNet)}</strong></td>
                            <td>${formatPlainCurrency(item.analysisModel.annual.loyersEncaisses / 12)}</td>
                            <td>${formatPlainCurrency(item.analysisModel.monthly.mensualiteTotale)}</td>
                            <td>${buildAssetActionButtons(item.id, 'portfolio')}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `,
    });
}

function buildCollectionsView() {
    return computePortfolioViewModel(state.assetRecords, {
        income: state.profileData.income,
        adults: state.profileData.adults,
        children: state.profileData.children,
        objectifCF: state.profileData.objectifCF,
        revaloAnnuelle: state.profileData.revaloAnnuelle,
        autresCredits: state.profileData.autresCredits
    }, state.activeAssetId, state.variablesData);
}

function createOrUpdateCurrentAsset(flags) {
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
        inComparison: Boolean(baseRecord?.inComparison) || Boolean(flags.inComparison),
        inPortfolio: Boolean(baseRecord?.inPortfolio) || Boolean(flags.inPortfolio),
        creditSchedule: baseRecord?.creditSchedule ?? null,
        dateRevente: baseRecord?.dateRevente ?? '',
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

    if (flags.inPortfolio) {
        showToast(isNew ? 'Dossier ajouté au portefeuille.' : 'Portefeuille mis à jour.');
    } else if (flags.inComparison) {
        showToast(isNew ? 'Dossier enregistré dans le comparateur.' : 'Comparateur mis à jour.');
    }

    // Flash de confirmation sur le bouton cliqué
    const flashBtn = flags.inComparison ? nodes.saveComparison : nodes.savePortfolio;
    if (flashBtn) {
        const originalText = flashBtn.textContent;
        flashBtn.classList.add('is-saved-flash');
        flashBtn.textContent = flags.inComparison
            ? (isNew ? '✓ Enregistré dans le comparateur' : '✓ Comparateur mis à jour')
            : (isNew ? '✓ Ajouté au portefeuille' : '✓ Portefeuille mis à jour');
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
        inComparison: Boolean(base?.inComparison),
        inPortfolio: Boolean(base?.inPortfolio),
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

function removeAssetFromScope(assetId, scope) {
    const assetIndex = state.assetRecords.findIndex(item => item.id === assetId);
    if (assetIndex < 0) {
        return;
    }

    const asset = state.assetRecords[assetIndex];
    const nextAsset = {
        ...asset,
        inComparison: scope === 'comparison' ? false : asset.inComparison,
        inPortfolio: scope === 'portfolio' ? false : asset.inPortfolio,
        updatedAt: Date.now()
    };

    if (!nextAsset.inComparison && !nextAsset.inPortfolio) {
        state.assetRecords.splice(assetIndex, 1);
        if (state.activeAssetId === assetId) {
            state.activeAssetId = null;
        }
    } else {
        state.assetRecords.splice(assetIndex, 1, nextAsset);
    }

    saveAssetRecords();
    saveActiveAssetId();
    emitStateUpdate();
    render({ syncVariables: false, syncProfile: false });
}

function handleAssetTableAction(event) {
    const button = event.target.closest('button[data-action]');
    if (!button) {
        return;
    }

    const assetId = button.dataset.id;
    const action = button.dataset.action;

    if (action === 'preview-asset') {
        openAssetDetailDrawer(assetId, button.dataset.scope);
        return;
    }

    if (action === 'load-asset') {
        loadAssetIntoWorkspace(assetId);
        return;
    }

    if (action === 'remove-asset') {
        removeAssetFromScope(assetId, button.dataset.scope);
    }
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
    nodes.profileIncome.value = String(state.profileData.income);
    nodes.profileAdults.value = String(state.profileData.adults);
    nodes.profileChildren.value = String(state.profileData.children);
    if (nodes.profileObjectifCF) nodes.profileObjectifCF.value = String(state.profileData.objectifCF || 1000);
    if (nodes.profileRevaloAnnuelle) nodes.profileRevaloAnnuelle.value = String(state.profileData.revaloAnnuelle || 2);
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
    nodes.saveComparison.textContent = isSaved ? 'Mettre a jour le comparateur' : 'Enregistrer dans le comparateur';
    nodes.savePortfolio.textContent = isSaved
        ? (state.variablesData['statut-bien'] === 'owned' ? 'Mettre a jour le bien detenu' : 'Mettre a jour le portefeuille')
        : (state.variablesData['statut-bien'] === 'owned' ? 'Ajouter comme bien detenu' : 'Ajouter au portefeuille');

    // Barre de statut
    if (nodes.assetStatusBar) {
        const savedRecord = state.activeAssetId
            ? state.assetRecords.find(r => r.id === state.activeAssetId)
            : null;

        let barState, dotClass, text, badgesHtml;

        if (!savedRecord) {
            barState = 'new';
            dotClass = 'new';
            text = 'Nouvelle étude · pas encore enregistrée';
            badgesHtml = '';
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

            const badges = [];
            if (savedRecord.inComparison) badges.push('<span class="asset-status-badge asset-status-badge--comparison">Comparateur ✓</span>');
            if (savedRecord.inPortfolio) badges.push('<span class="asset-status-badge asset-status-badge--portfolio">Portefeuille ✓</span>');
            badgesHtml = badges.join('');
        }

        nodes.assetStatusBar.className = `asset-status-bar asset-status-bar--${barState}`;
        nodes.assetStatusBar.innerHTML = `
            <div class="asset-status-bar__left">
                <span class="asset-status-bar__dot asset-status-bar__dot--${dotClass}">${dotClass === 'saved' ? '✓' : dotClass === 'modified' ? '●' : '○'}</span>
                <span class="asset-status-bar__text">${text}</span>
            </div>
            <div class="asset-status-bar__badges">${badgesHtml}</div>
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

function openPrintDocument(documentHTML, filename) {
    const printWindow = window.open('', '_blank', 'noopener=yes,noreferrer=yes');

    if (!printWindow) {
        window.alert('Le navigateur a bloqué l\'ouverture de la note PDF. Autorisez les fenêtres pop-up pour lancer l\'impression.');
        return;
    }

    printWindow.document.open();
    printWindow.document.write(documentHTML);
    printWindow.document.close();
    printWindow.document.title = filename.replace(/\.pdf$/i, '');
}

function handleDecisionSummaryExport() {
    const analysisModel = getCurrentAnalysisModel();
    const { documentHTML, filename } = buildDecisionPrintDocument({
        analysisModel,
        profileData: state.profileData,
        variablesData: state.variablesData
    });

    openPrintDocument(documentHTML, filename);
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
    const { monthlyBreakdown, metrics } = analysisModel;

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

    const rdtBrut = metrics.rentaBrute != null ? metrics.rentaBrute.toFixed(1) + ' %' : '—';
    const dscrVal = metrics.dscr != null ? metrics.dscr.toFixed(2) : '—';

    nodes.analysisCFWaterfall.innerHTML = `
        <div class="cf-waterfall__head">
            <span class="cf-waterfall__title">Cash-flow — calcul en direct</span>
            <span class="cf-waterfall__live">● LIVE</span>
        </div>
        <div class="cf-waterfall__kpis">
            <div class="cf-waterfall__kpi">
                <span class="cf-waterfall__kpi-val" style="color:var(--accent-gold)">${escapeHtml(rdtBrut)}</span>
                <span class="cf-waterfall__kpi-lbl">Rendement brut</span>
            </div>
            <div class="cf-waterfall__kpi">
                <span class="cf-waterfall__kpi-val" style="color:${cfColor}">${escapeHtml(fmtEur(cfVal))}</span>
                <span class="cf-waterfall__kpi-lbl">CF net/mois</span>
            </div>
            <div class="cf-waterfall__kpi">
                <span class="cf-waterfall__kpi-val">${escapeHtml(dscrVal)}</span>
                <span class="cf-waterfall__kpi-lbl">DSCR</span>
            </div>
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
    const { metrics, acquisitionDecision, confidenceModel, scenarioModel } = analysisModel;
    const cards = [
        {
            label: 'Cash-flow net-net',
            value: formatSignedCurrency(metrics.cfNetNet),
            rawValue: metrics.cfNetNet,
            cssClass: getMetricClass(metrics.cfNetNet),
            barPct: Math.min(100, Math.max(0, (metrics.cfNetNet + 200) / 400 * 100))
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
            label: 'Offre plafond',
            value: formatPlainCurrency(acquisitionDecision.maxOfferPrice),
            rawValue: acquisitionDecision.maxOfferPrice,
            cssClass: acquisitionDecision.currentPrice <= acquisitionDecision.maxOfferPrice + 500 ? 'is-positive' : 'is-watch',
            barPct: Math.min(100, Math.max(0, (acquisitionDecision.maxOfferPrice / (acquisitionDecision.currentPrice || 1)) * 100))
        },
        {
            label: 'Score décision',
            value: `${acquisitionDecision.score}/100`,
            rawValue: acquisitionDecision.score,
            cssClass: getDecisionClass(acquisitionDecision.tone),
            barPct: acquisitionDecision.score
        },
        {
            label: 'Fiabilité',
            value: `${confidenceModel.score}/100`,
            rawValue: confidenceModel.score,
            cssClass: getDecisionClass(confidenceModel.tone),
            barPct: confidenceModel.score
        },
        {
            label: 'Seuil favorable',
            value: formatPlainCurrency(acquisitionDecision.solidOfferPrice),
            rawValue: acquisitionDecision.solidOfferPrice,
            cssClass: acquisitionDecision.currentPrice <= acquisitionDecision.solidOfferPrice + 500 ? 'is-positive' : 'is-neutral',
            barPct: Math.min(100, Math.max(0, (acquisitionDecision.solidOfferPrice / (acquisitionDecision.currentPrice || 1)) * 100))
        },
        {
            label: 'Résistance',
            value: scenarioModel.label,
            rawValue: 0,
            cssClass: getDecisionClass(scenarioModel.tone),
            barPct: 50
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
    const { acquisitionDecision, confidenceModel, scenarioModel } = analysisModel;
    const negotiationGap = Math.max(0, acquisitionDecision.negotiationToTenable || 0);

    nodes.analysisStickySummary.innerHTML = `
        <div class="analysis-sticky-card analysis-sticky-card--${acquisitionDecision.tone}">
            <div class="analysis-sticky-copy">
                <div class="analysis-sticky-overline">
                    <span class="status-label">Tableau de bord décisionnel</span>
                    <div class="analysis-sticky-pill-row">
                        <strong class="status-pill status-pill--${confidenceModel.tone}">Fiabilité ${confidenceModel.label}</strong>
                        <strong class="status-pill status-pill--${scenarioModel.tone}">Stress ${scenarioModel.label}</strong>
                    </div>
                </div>
                <div class="analysis-sticky-head">
                    <div class="analysis-sticky-main">
                        <strong class="decision-badge decision-badge--${acquisitionDecision.tone}">${acquisitionDecision.label}</strong>
                        <p class="analysis-sticky-note">${escapeHtml(acquisitionDecision.summary)}</p>
                    </div>
                    <div class="analysis-sticky-action">
                        <span>Action</span>
                        <strong>${escapeHtml(acquisitionDecision.action)}</strong>
                    </div>
                </div>
            </div>
            <div class="analysis-sticky-kpis">
                <article class="analysis-sticky-kpi">
                    <span>Score</span>
                    <strong>${acquisitionDecision.score}/100</strong>
                </article>
                <article class="analysis-sticky-kpi">
                    <span>Offre cible</span>
                    <strong>${formatPlainCurrency(acquisitionDecision.maxOfferPrice)}</strong>
                </article>
                <article class="analysis-sticky-kpi">
                    <span>Prix affiché</span>
                    <strong>${formatPlainCurrency(acquisitionDecision.currentPrice)}</strong>
                </article>
                <article class="analysis-sticky-kpi">
                    <span>Baisse à viser</span>
                    <strong>${negotiationGap > 0 ? formatPlainCurrency(negotiationGap) : 'Aucune'}</strong>
                </article>
            </div>
        </div>
    `;
}

function buildAnalysisAcquisitionDecision(analysisModel) {
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

function buildAnalysisChecklist(analysisModel) {
    const { acquisitionChecklist } = analysisModel;

    nodes.analysisChecklist.innerHTML = `
        <div class="checklist-shell">
            <div class="decision-head">
                <span class="status-label">Vérifications terrain</span>
                <strong class="status-pill status-pill--${acquisitionChecklist.readinessTone}">${acquisitionChecklist.readinessLabel}</strong>
            </div>
            <p class="decision-hint">${acquisitionChecklist.summary}</p>
            <div class="checklist-list">
                ${acquisitionChecklist.items.map(item => {
                    const tone = getChecklistTone(item.status);
                    return `
                        <article class="checklist-item checklist-item--${tone}">
                            <div class="lever-head">
                                <strong>${item.label}</strong>
                                <span class="status-pill status-pill--${tone}">${getChecklistLabel(item.status)}</span>
                            </div>
                            <p>${item.detail}</p>
                        </article>
                    `;
                }).join('')}
            </div>
        </div>
    `;
}

function buildAnalysisConfidence(analysisModel) {
    const { confidenceModel } = analysisModel;

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

function buildAnalysisSummary(analysisModel, tmi, parts, composition) {
    const { decision } = analysisModel;
    nodes.analysisSummary.innerHTML = `
        <div class="decision-card">
            <div class="decision-head">
                <span class="status-label">Décision d'exploitation</span>
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
                <li><span>Profil actif</span><strong>${state.profileData.name}</strong></li>
                <li><span>Composition du foyer</span><strong>${composition}</strong></li>
                <li><span>Parts fiscales</span><strong>${parts.toLocaleString('fr-FR')} part${parts > 1 ? 's' : ''}</strong></li>
                <li><span>TMI estimée</span><strong>${tmi} %</strong></li>
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
            <li><span>Statut du dossier</span><strong>${getCurrentAssetStatus()}</strong></li>
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

function buildPortfolioFiscal(fiscal) {
    if (!nodes.portfolioFiscal) return;
    if (!fiscal || Object.values(fiscal.regimes).every(r => r.count === 0)) {
        nodes.portfolioFiscal.innerHTML = '<p class="collection-empty">Aucun bien détenu pour calculer la fiscalité consolidée.</p>';
        return;
    }
    const regimesActifs = Object.entries(fiscal.regimes).filter(([, r]) => r.count > 0);
    nodes.portfolioFiscal.innerHTML = `
        <div class="fiscal-shell">
            <div class="decision-head">
                <span class="status-label">TMI du foyer</span>
                <strong class="status-pill status-pill--neutral">${fiscal.tmi} %</strong>
            </div>
            <div class="timeline-summary">
                <div class="timeline-pill">
                    <span>Total impôts / an</span>
                    <strong>${formatPlainCurrency(fiscal.totalImpots)}</strong>
                </div>
                <div class="timeline-pill">
                    <span>Total impôts / mois</span>
                    <strong>${formatPlainCurrency(fiscal.totalImpots / 12)}</strong>
                </div>
            </div>
            <div class="fiscal-regimes">
                ${regimesActifs.map(([, r]) => `
                    <article class="scenario-card scenario-card--neutral">
                        <div class="lever-head">
                            <strong>${escapeHtml(r.label)}</strong>
                            <span class="status-pill status-pill--neutral">${r.count} bien${r.count > 1 ? 's' : ''}</span>
                        </div>
                        <p>Loyers : ${formatPlainCurrency(r.loyersAnnuels)} / an · Impôts : ${formatPlainCurrency(r.impots)} / an</p>
                    </article>
                `).join('')}
            </div>
        </div>
    `;
}

function buildPortfolioDebtRatios(debtRatios) {
    if (!nodes.portfolioDebtRatios) return;
    if (!debtRatios) {
        nodes.portfolioDebtRatios.innerHTML = '<p class="collection-empty">Aucun bien détenu pour calculer le taux d\'endettement.</p>';
        return;
    }
    function gauge(ratio, seuil, tone, label, method) {
        const pct = Math.min(100, (ratio / seuil) * 100);
        return `
            <div class="debt-gauge">
                <div class="debt-gauge-head">
                    <span class="debt-gauge-method">${escapeHtml(method)}</span>
                    <strong class="status-pill status-pill--${tone}">${ratio.toFixed(1).replace('.', ',')} %</strong>
                </div>
                <div class="debt-gauge-bar">
                    <div class="debt-gauge-fill debt-gauge-fill--${tone}" style="width:${pct.toFixed(1)}%"></div>
                </div>
                <div class="debt-gauge-footer">
                    <span>${escapeHtml(label)}</span>
                    <span>Seuil : ${seuil} %</span>
                </div>
            </div>
        `;
    }
    const breakdownHtml = debtRatios.autresMensualites > 0 ? `
        <div class="analysis-list-compact" style="margin-bottom:1rem">
            <div class="status-item">
                <span class="status-label">Mensualités immo</span>
                <strong>${formatPlainCurrency(debtRatios.mensualitesImmo)}/mois</strong>
            </div>
            <div class="status-item">
                <span class="status-label">Crédits hors immo</span>
                <strong>${formatPlainCurrency(debtRatios.autresMensualites)}/mois</strong>
            </div>
            <div class="status-item">
                <span class="status-label">Total mensualités</span>
                <strong>${formatPlainCurrency(debtRatios.mensualitesTotales)}/mois</strong>
            </div>
        </div>` : '';
    nodes.portfolioDebtRatios.innerHTML = `
        <div class="debt-ratios-shell">
            ${breakdownHtml}
            ${gauge(debtRatios.hcsf.ratio, debtRatios.hcsf.seuil, debtRatios.hcsf.tone,
                'Mensualités totales / (Revenus nets + 70 % loyers bruts)', 'Méthode HCSF 2021')}
            ${gauge(debtRatios.differentielle.ratio, debtRatios.differentielle.seuil, debtRatios.differentielle.tone,
                'Effort net total / Revenus nets', 'Méthode différentielle')}
        </div>
    `;
}

function buildPortfolioObjectif(objectif) {
    if (!nodes.portfolioObjectif) return;
    const pctStr = objectif.pct.toFixed(0);
    nodes.portfolioObjectif.innerHTML = `
        <div class="objectif-shell">
            <div class="decision-head">
                <span class="status-label">Objectif mensuel</span>
                <strong class="status-pill status-pill--${objectif.tone}">${formatSignedCurrency(objectif.target)}</strong>
            </div>
            <div class="objectif-progress">
                <div class="objectif-bar">
                    <div class="objectif-fill objectif-fill--${objectif.tone}" style="width:${pctStr}%"></div>
                </div>
                <div class="objectif-labels">
                    <span class="objectif-current">${formatSignedCurrency(objectif.current)} actuellement</span>
                    <span class="objectif-pct">${pctStr} %</span>
                </div>
            </div>
            ${objectif.delta > 0 ? `
                <p class="decision-hint">Écart : <strong>${formatSignedCurrency(objectif.delta)}</strong> / mois manquants${objectif.estimatedAssetsNeeded ? ` · ~${objectif.estimatedAssetsNeeded} bien${objectif.estimatedAssetsNeeded > 1 ? 's' : ''} supplémentaire${objectif.estimatedAssetsNeeded > 1 ? 's' : ''}` : ''}</p>
            ` : `<p class="decision-hint">Objectif atteint.</p>`}
        </div>
    `;
}

function buildPortfolioProjection(projection) {
    if (!nodes.portfolioProjection) return;
    const seriesGross = projection.seriesGross;
    const seriesNet = projection.seriesNet;
    if (!seriesGross || !seriesGross.length) {
        nodes.portfolioProjection.innerHTML = `
            <div class="projection-shell">
                <div class="decision-head">
                    <span class="status-label">Revalorisation estimée</span>
                    <strong class="status-pill status-pill--neutral">${projection.revaloAnnuelle} % / an</strong>
                </div>
                <p class="decision-hint">Valeur actuelle du parc : <strong>${formatPlainCurrency(projection.currentValue)}</strong></p>
                <div class="timeline-summary">
                    <div class="timeline-pill"><span>Dans 5 ans</span><strong>${formatPlainCurrency(projection.at5)}</strong></div>
                    <div class="timeline-pill"><span>Dans 10 ans</span><strong>${formatPlainCurrency(projection.at10)}</strong></div>
                    <div class="timeline-pill"><span>Dans 15 ans</span><strong>${formatPlainCurrency(projection.at15)}</strong></div>
                </div>
            </div>
        `;
        return;
    }
    const maxVal = Math.max(...seriesGross, ...seriesNet.map(v => Math.max(0, v)), 1);
    const xScale = t => (t / 15) * 380 + 10;
    const yScale = v => 110 - (Math.max(0, v) / maxVal) * 100;
    const buildPath = series => series.map((v, t) => `${t === 0 ? 'M' : 'L'} ${xScale(t).toFixed(1)},${yScale(v).toFixed(1)}`).join(' ');
    const grossPath = buildPath(seriesGross);
    const netPath = buildPath(seriesNet);
    const grossAreaPath = `${grossPath} L ${xScale(15).toFixed(1)},115 L ${xScale(0).toFixed(1)},115 Z`;
    const netAreaPath = `${netPath} L ${xScale(15).toFixed(1)},115 L ${xScale(0).toFixed(1)},115 Z`;
    const markerTs = [0, 5, 10, 15];
    const markers = markerTs.map(t => `<circle cx="${xScale(t).toFixed(1)}" cy="${yScale(seriesGross[t]).toFixed(1)}" r="3" fill="#C5A059"/>`).join('');
    nodes.portfolioProjection.innerHTML = `
        <div class="projection-shell">
            <div class="decision-head">
                <span class="status-label">Revalorisation estimée</span>
                <strong class="status-pill status-pill--neutral">${projection.revaloAnnuelle} % / an</strong>
            </div>
            <div class="projection-svg-shell">
                <svg viewBox="0 0 400 128" preserveAspectRatio="none">
                    <path d="${grossAreaPath}" fill="#C5A059" fill-opacity="0.1"/>
                    <path d="${grossPath}" fill="none" stroke="#C5A059" stroke-width="2" stroke-dasharray="6 3"/>
                    <path d="${netAreaPath}" fill="#4ade80" fill-opacity="0.15"/>
                    <path d="${netPath}" fill="none" stroke="#4ade80" stroke-width="2"/>
                    ${markers}
                    <line x1="${xScale(0).toFixed(1)}" y1="10" x2="${xScale(0).toFixed(1)}" y2="115" stroke="var(--border)" stroke-width="1" stroke-dasharray="2 2"/>
                    <text x="${xScale(0).toFixed(1)}" y="120" font-size="8" fill="var(--muted)" text-anchor="middle">Auj.</text>
                    <text x="${xScale(5).toFixed(1)}" y="120" font-size="8" fill="var(--muted)" text-anchor="middle">+5 ans</text>
                    <text x="${xScale(10).toFixed(1)}" y="120" font-size="8" fill="var(--muted)" text-anchor="middle">+10 ans</text>
                    <text x="${xScale(15).toFixed(1)}" y="120" font-size="8" fill="var(--muted)" text-anchor="middle">+15 ans</text>
                </svg>
            </div>
            <div style="display:flex;gap:16px;margin-bottom:8px;font-size:11px;color:var(--muted)">
                <span><span style="display:inline-block;width:16px;border-top:2px dashed #C5A059;vertical-align:middle;margin-right:4px"></span>Valeur brute</span>
                <span><span style="display:inline-block;width:16px;border-top:2px solid #4ade80;vertical-align:middle;margin-right:4px"></span>Valeur nette (−dette)</span>
            </div>
            <div class="timeline-summary">
                <div class="timeline-pill"><span>Aujourd'hui</span><strong>${formatPlainCurrency(projection.currentValue)}</strong></div>
                <div class="timeline-pill"><span>Dans 5 ans</span><strong>${formatPlainCurrency(projection.at5)}</strong></div>
                <div class="timeline-pill"><span>Dans 10 ans</span><strong>${formatPlainCurrency(projection.at10)}</strong></div>
                <div class="timeline-pill"><span>Dans 15 ans</span><strong>${formatPlainCurrency(projection.at15)}</strong></div>
            </div>
            ${seriesNet[15] > 0 ? `<p class="decision-hint">Equity dans 15 ans : <strong style="color:#4ade80">${formatPlainCurrency(seriesNet[15])}</strong></p>` : ''}
        </div>
    `;
}

let _portfolioMap = null;

function buildPortfolioRepartition(portfolioItems) {
    if (!nodes.portfolioRepartition) return;
    if (!portfolioItems.length) {
        nodes.portfolioRepartition.innerHTML = '<p class="collection-empty">Aucun bien détenu pour afficher la répartition.</p>';
        return;
    }
    const hasAddresses = portfolioItems.some(item => String(item.variablesData?.adresse || '').trim());
    const maxLoyer = Math.max(...portfolioItems.map(item => (item.model.loyersEncaisses || 0) / 12), 1);
    nodes.portfolioRepartition.innerHTML = `
        ${hasAddresses ? '<div id="portfolio-map-canvas" class="portfolio-map-canvas"></div>' : ''}
        <div class="repartition-list">
            ${portfolioItems.map(item => {
                const loyer = (item.model.loyersEncaisses || 0) / 12;
                const cf = item.metrics.cfNetNet || 0;
                const loyerPct = Math.max(4, (loyer / maxLoyer) * 100);
                const cfTone = cf >= 0 ? 'positive' : 'negative';
                const cfPct = Math.max(4, (Math.abs(cf) / maxLoyer) * 100);
                return `
                    <div class="repartition-row">
                        <div class="repartition-label">
                            <strong>${escapeHtml(item.name)}</strong>
                            <span class="repartition-city">${escapeHtml(item.city)}</span>
                        </div>
                        <div class="repartition-bars">
                            <div class="repartition-bar-wrap" title="Loyer brut ${formatCurrency(loyer)}/mois">
                                <div class="repartition-bar repartition-bar--loyer" style="width:${loyerPct.toFixed(1)}%"></div>
                                <span class="repartition-val">${formatCurrency(loyer)}</span>
                            </div>
                            <div class="repartition-bar-wrap" title="CF net-net ${formatSignedCurrency(cf)}/mois">
                                <div class="repartition-bar repartition-bar--cf repartition-bar--${cfTone}" style="width:${cfPct.toFixed(1)}%"></div>
                                <span class="repartition-val ${cf >= 0 ? 'value-positive' : 'value-negative'}">${formatSignedCurrency(cf)}</span>
                            </div>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
        <div class="repartition-legend">
            <span class="repartition-legend-item repartition-legend-item--loyer">Loyer brut</span>
            <span class="repartition-legend-item repartition-legend-item--cf">CF net-net</span>
        </div>
    `;
    if (hasAddresses) {
        buildPortfolioMap(portfolioItems);
    }
}

async function buildPortfolioMap(portfolioItems) {
    const canvas = document.getElementById('portfolio-map-canvas');
    if (!canvas || typeof L === 'undefined') return;

    if (_portfolioMap) {
        _portfolioMap.remove();
        _portfolioMap = null;
    }

    const withAddress = portfolioItems.filter(item => String(item.variablesData?.adresse || '').trim());
    if (!withAddress.length) return;

    _portfolioMap = L.map(canvas, { center: [46.8, 1.7], zoom: 6 });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 18,
    }).addTo(_portfolioMap);

    const payload = withAddress.map(item => ({
        id: item.id,
        query: [
            String(item.variablesData.adresse || '').trim(),
            String(item.variablesData.ville || '').trim(),
            'France',
        ].filter(Boolean).join(', '),
    }));

    let geoData = {};
    try {
        const resp = await fetch('/api/geocode/portfolio', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        geoData = await resp.json();
    } catch (e) {
        console.warn('Géocodage portefeuille échoué', e);
    }

    const bounds = [];
    for (const item of withAddress) {
        const coord = geoData[item.id];
        if (!coord || !coord.lat) continue;
        const cf = item.metrics?.cfNetNet || 0;
        const loyer = (item.model?.loyersEncaisses || 0) / 12;
        const adresse = escapeHtml(String(item.variablesData?.adresse || '').trim());
        const ville = escapeHtml(String(item.variablesData?.ville || '').trim());
        const marker = L.circleMarker([coord.lat, coord.lng], {
            radius: 10,
            fillColor: '#C5A059',
            fillOpacity: 0.92,
            color: '#fff',
            weight: 2,
        });
        marker.bindPopup(`
            <strong>${escapeHtml(item.name)}</strong><br>
            <span style="font-size:11px;color:#888">${adresse}${adresse && ville ? ', ' : ''}${ville}</span><br>
            <span>CF : <strong>${cf >= 0 ? '+' : ''}${Math.round(cf)} €/mois</strong></span><br>
            <span>Loyer : ${Math.round(loyer)} €/mois</span>
        `);
        marker.addTo(_portfolioMap);
        bounds.push([coord.lat, coord.lng]);
    }

    if (bounds.length === 1) {
        _portfolioMap.setView(bounds[0], 14);
    } else if (bounds.length > 1) {
        _portfolioMap.fitBounds(bounds, { padding: [30, 30] });
    }
}

function buildPortfolioCredits(portfolioItems, autresCredits) {
    if (!nodes.portfolioCredits) return;
    const itemsWithCredit = portfolioItems.filter(item => item.creditSchedule || item.model.mensualiteTotale > 0);
    const credits = autresCredits || [];

    if (!itemsWithCredit.length && !credits.length) {
        nodes.portfolioCredits.innerHTML = '<p class="collection-empty">Aucun crédit configuré.</p>';
        return;
    }

    let immoHtml = '';
    if (itemsWithCredit.length) {
        immoHtml = `
        <h5 class="analysis-subsection-title">Crédits immobiliers</h5>
        <table class="analysis-table">
            <thead><tr><th>Bien</th><th>Mensualité</th><th>Capital restant dû</th><th>Date de fin</th><th>Source</th></tr></thead>
            <tbody>
                ${itemsWithCredit.map(item => {
                    const cs = item.creditSchedule;
                    const mensualite = cs ? cs.mensualite : (item.model.mensualiteTotale || 0);
                    const cap = cs ? capitalRestantDu(cs.mensualite, cs.dateFin) : null;
                    const dateFin = cs?.dateFin ? cs.dateFin.replace('-', '/') : '--';
                    const source = cs ? 'Échéancier réel' : 'Simulé';
                    return `
                        <tr>
                            <td><strong>${escapeHtml(item.name)}</strong><div class="table-subline">${escapeHtml(item.city)}</div></td>
                            <td><strong>${formatPlainCurrency(mensualite)}</strong></td>
                            <td>${cap != null ? `<strong>${formatPlainCurrency(cap)}</strong>` : '--'}</td>
                            <td>${escapeHtml(dateFin)}</td>
                            <td><span class="status-pill status-pill--${cs ? 'positive' : 'neutral'}">${escapeHtml(source)}</span></td>
                        </tr>
                    `;
                }).join('')}
            </tbody>
        </table>`;
    }

    const totalMensualiteHI = credits.reduce((s, c) => s + (c.mensualite || 0), 0);
    const totalCrdHI = credits.some(c => c.capitalRestantDu != null)
        ? credits.reduce((s, c) => s + (c.capitalRestantDu || 0), 0)
        : null;

    const horsImmoHtml = `
        <h5 class="analysis-subsection-title" style="margin-top:1.5rem">Crédits hors immobilier</h5>
        ${credits.length ? `
        <table class="analysis-table">
            <thead><tr><th>Libellé</th><th>Mensualité</th><th>Capital restant dû</th><th>Date de fin</th><th></th></tr></thead>
            <tbody>
                ${credits.map(c => {
                    const dateFin = c.dateFin ? c.dateFin.replace('-', '/') : '--';
                    return `
                        <tr>
                            <td><strong>${escapeHtml(c.libelle)}</strong></td>
                            <td><strong>${formatPlainCurrency(c.mensualite)}</strong></td>
                            <td>${c.capitalRestantDu != null ? `<strong>${formatPlainCurrency(c.capitalRestantDu)}</strong>` : '--'}</td>
                            <td>${escapeHtml(dateFin)}</td>
                            <td style="white-space:nowrap">
                                <button class="btn-icon" data-action="edit-autre-credit" data-credit-id="${escapeHtml(c.id)}" title="Modifier">✎</button>
                                <button class="btn-icon btn-icon--danger" data-action="delete-autre-credit" data-credit-id="${escapeHtml(c.id)}" title="Supprimer">✕</button>
                            </td>
                        </tr>
                    `;
                }).join('')}
                <tr class="analysis-table__total">
                    <td><strong>Total</strong></td>
                    <td><strong>${formatPlainCurrency(totalMensualiteHI)}</strong></td>
                    <td>${totalCrdHI != null ? `<strong>${formatPlainCurrency(totalCrdHI)}</strong>` : '--'}</td>
                    <td colspan="2"></td>
                </tr>
            </tbody>
        </table>` : '<p class="collection-empty">Aucun crédit hors immobilier.</p>'}
        <div style="margin-top:0.75rem">
            <button class="btn-secondary" data-action="add-autre-credit">+ Ajouter un crédit</button>
        </div>`;

    nodes.portfolioCredits.innerHTML = immoHtml + horsImmoHtml;
}

function buildPortfolioTimeline(portfolioItems) {
    if (!nodes.portfolioTimeline) return;
    const itemsWithDates = portfolioItems.filter(item => item.creditSchedule?.dateDebut || item.creditSchedule?.dateFin);
    if (!itemsWithDates.length) {
        nodes.portfolioTimeline.innerHTML = '<p class="collection-empty">Configurez l\'échéancier crédit d\'au moins un bien pour afficher la chronologie.</p>';
        return;
    }

    const now = new Date();
    const parseYM = str => { if (!str) return null; const parts = str.split('-').map(Number); return new Date(parts[0], parts[1] - 1, 1); };

    const allDates = itemsWithDates.flatMap(item => [
        parseYM(item.creditSchedule?.dateDebut),
        parseYM(item.creditSchedule?.dateFin),
        parseYM(item.dateRevente)
    ]).filter(Boolean);

    const minDate = new Date(Math.min(...allDates.map(d => d.getTime()), now.getTime()));
    const maxDate = new Date(Math.max(...allDates.map(d => d.getTime()), now.getTime()));
    const totalMs = Math.max(1, maxDate - minDate);

    function pct(date) { return ((date - minDate) / totalMs * 100).toFixed(2); }

    const minYear = minDate.getFullYear();
    const maxYear = maxDate.getFullYear();
    const yearMarkers = [];
    for (let y = minYear; y <= maxYear; y++) {
        const d = new Date(y, 0, 1);
        if (d >= minDate && d <= maxDate) yearMarkers.push({ year: y, pct: pct(d) });
    }

    nodes.portfolioTimeline.innerHTML = `
        <div class="timeline-chart">
            <div class="timeline-axis">
                ${yearMarkers.map(m => `<span class="timeline-year" style="left:${m.pct}%">${m.year}</span>`).join('')}
                <div class="timeline-now" style="left:${pct(now)}%" title="Aujourd'hui"></div>
            </div>
            ${itemsWithDates.map(item => {
                const debut = parseYM(item.creditSchedule?.dateDebut);
                const fin = parseYM(item.creditSchedule?.dateFin);
                const revente = parseYM(item.dateRevente);
                const left = debut ? parseFloat(pct(debut)) : 0;
                const right = fin ? parseFloat(pct(fin)) : 100;
                const width = Math.max(1, right - left);
                return `
                    <div class="timeline-row">
                        <div class="timeline-row-label">${escapeHtml(item.name)}</div>
                        <div class="timeline-row-track">
                            <div class="timeline-bar" style="left:${left}%;width:${width}%" title="${escapeHtml(item.name)} · ${item.creditSchedule?.dateDebut || '?'} → ${item.creditSchedule?.dateFin || '?'}"></div>
                            ${revente ? `<div class="timeline-marker-revente" style="left:${pct(revente)}%" title="Revente envisagée ${item.dateRevente}"></div>` : ''}
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

let _simulatedIds = new Set();

function buildPortfolioSimulator(collectionsView) {
    if (!nodes.portfolioSimulator) return;

    const pipelineItems = collectionsView.comparisonItems.filter(item => !item.inPortfolio);

    if (!pipelineItems.length) {
        _simulatedIds.clear();
        nodes.portfolioSimulator.innerHTML = `
            <div class="analysis-block">
                <h4>Simulateur de croissance</h4>
                <div class="simulator-empty">Ajoutez des dossiers dans le comparateur pour simuler leur impact sur le portefeuille.</div>
            </div>
        `;
        return;
    }

    function computeSimulated() {
        if (_simulatedIds.size === 0) return null;
        const simulatedRecords = state.assetRecords.map(record => {
            if (_simulatedIds.has(record.id)) {
                return { ...record, inPortfolio: true };
            }
            return record;
        });
        return computePortfolioViewModel(simulatedRecords, {
            income: state.profileData.income,
            adults: state.profileData.adults,
            children: state.profileData.children,
            objectifCF: state.profileData.objectifCF,
            revaloAnnuelle: state.profileData.revaloAnnuelle
        }, state.activeAssetId, state.variablesData);
    }

    function renderSimulatorContent() {
        // Prune stale IDs
        const validIds = new Set(pipelineItems.map(item => item.id));
        for (const id of _simulatedIds) {
            if (!validIds.has(id)) _simulatedIds.delete(id);
        }

        const simView = computeSimulated();
        const current = collectionsView;

        const currentHcsf = current.debtRatios?.hcsf;
        const currentDiff = current.debtRatios?.differentielle;
        const currentHcsfPill = currentHcsf
            ? `<span class="hcsf-pill hcsf-pill--${currentHcsf.ratio <= 35 ? 'ok' : 'over'}">${currentHcsf.ratio.toFixed(1).replace('.', ',')} %</span>`
            : '—';

        let simulatedCol = `<div class="simulator-state"><span class="simulator-state-label">Avec sélection</span><p style="color:var(--muted);font-size:12px">Cochez un bien pour simuler.</p></div>`;
        if (simView) {
            const simHcsf = simView.debtRatios?.hcsf;
            const simDiff = simView.debtRatios?.differentielle;
            const cfDelta = simView.dashboard.totalCashflow - current.dashboard.totalCashflow;
            const simHcsfPill = simHcsf
                ? `<span class="hcsf-pill hcsf-pill--${simHcsf.ratio <= 35 ? 'ok' : 'over'}">${simHcsf.ratio.toFixed(1).replace('.', ',')} % ${simHcsf.ratio > 35 ? '⚠' : '✓'}</span>`
                : '—';
            simulatedCol = `
                <div class="simulator-state simulator-state--simulated">
                    <span class="simulator-state-label">Avec sélection</span>
                    <div class="simulator-kpi">
                        <span class="simulator-kpi-label">CF / mois</span>
                        <span class="simulator-kpi-value" style="color:${simView.dashboard.totalCashflow >= 0 ? '#4ade80' : '#f87171'}">${formatSignedCurrency(simView.dashboard.totalCashflow)}</span>
                    </div>
                    <div class="simulator-kpi">
                        <span class="simulator-kpi-label">Delta CF</span>
                        <span class="simulator-kpi-value" style="color:${cfDelta >= 0 ? '#4ade80' : '#f87171'}">${cfDelta >= 0 ? '+' : ''}${Math.round(cfDelta).toLocaleString('fr-FR')} €</span>
                    </div>
                    <div class="simulator-kpi">
                        <span class="simulator-kpi-label">DSCR</span>
                        <span class="simulator-kpi-value">${simView.dashboard.dscr.toFixed(2).replace('.', ',')}</span>
                    </div>
                    <div class="simulator-kpi">
                        <span class="simulator-kpi-label">HCSF</span>
                        <span class="simulator-kpi-value">${simHcsfPill}</span>
                    </div>
                    <div class="simulator-kpi">
                        <span class="simulator-kpi-label">Taux diff.</span>
                        <span class="simulator-kpi-value">${simDiff ? simDiff.ratio.toFixed(1).replace('.', ',') + ' %' : '—'}</span>
                    </div>
                    <div class="simulator-kpi">
                        <span class="simulator-kpi-label">Capacité</span>
                        <span class="simulator-kpi-value">${Math.round((simView.capacity?.acquisitionBudget || 0) / 1000)} k€</span>
                    </div>
                </div>
            `;
        }

        nodes.portfolioSimulator.innerHTML = `
            <section class="analysis-block">
                <h4>Simulateur de croissance</h4>
                <div class="simulator-shell">
                    <div class="simulator-cols">
                        <div>
                            <p style="font-size:11px;color:var(--muted);margin-bottom:8px">Sélectionner les biens à intégrer :</p>
                            <div class="simulator-check-list">
                                ${pipelineItems.map(item => {
                                    const cf = item.metrics?.cfNetNet || 0;
                                    const checked = _simulatedIds.has(item.id) ? 'checked' : '';
                                    return `
                                        <label class="simulator-check-item">
                                            <input type="checkbox" data-sim-id="${escapeHtml(item.id)}" ${checked}>
                                            <span class="simulator-check-name">${escapeHtml(item.name)}</span>
                                            <span class="simulator-check-cf" style="color:${cf >= 0 ? '#4ade80' : '#f87171'}">${cf >= 0 ? '+' : ''}${Math.round(cf).toLocaleString('fr-FR')} €</span>
                                        </label>
                                    `;
                                }).join('')}
                            </div>
                        </div>
                        <div class="simulator-compare">
                            <div class="simulator-compare-cols">
                                <div class="simulator-state">
                                    <span class="simulator-state-label">État actuel</span>
                                    <div class="simulator-kpi">
                                        <span class="simulator-kpi-label">CF / mois</span>
                                        <span class="simulator-kpi-value" style="color:${current.dashboard.totalCashflow >= 0 ? '#4ade80' : '#f87171'}">${formatSignedCurrency(current.dashboard.totalCashflow)}</span>
                                    </div>
                                    <div class="simulator-kpi">
                                        <span class="simulator-kpi-label">Delta CF</span>
                                        <span class="simulator-kpi-value" style="color:var(--muted)">—</span>
                                    </div>
                                    <div class="simulator-kpi">
                                        <span class="simulator-kpi-label">DSCR</span>
                                        <span class="simulator-kpi-value">${current.dashboard.dscr.toFixed(2).replace('.', ',')}</span>
                                    </div>
                                    <div class="simulator-kpi">
                                        <span class="simulator-kpi-label">HCSF</span>
                                        <span class="simulator-kpi-value">${currentHcsfPill}</span>
                                    </div>
                                    <div class="simulator-kpi">
                                        <span class="simulator-kpi-label">Taux diff.</span>
                                        <span class="simulator-kpi-value">${currentDiff ? currentDiff.ratio.toFixed(1).replace('.', ',') + ' %' : '—'}</span>
                                    </div>
                                    <div class="simulator-kpi">
                                        <span class="simulator-kpi-label">Capacité</span>
                                        <span class="simulator-kpi-value">${Math.round((current.capacity?.acquisitionBudget || 0) / 1000)} k€</span>
                                    </div>
                                </div>
                                ${simulatedCol}
                            </div>
                        </div>
                    </div>
                </div>
            </section>
        `;

        nodes.portfolioSimulator.querySelectorAll('input[data-sim-id]').forEach(checkbox => {
            checkbox.addEventListener('change', () => {
                const id = checkbox.dataset.simId;
                if (checkbox.checked) _simulatedIds.add(id);
                else _simulatedIds.delete(id);
                renderSimulatorContent();
            });
        });
    }

    renderSimulatorContent();
}

function renderCollections() {
    if (IS_ANALYSIS_WINDOW) {
        nodes.collectionPanel.hidden = true;
        return;
    }

    nodes.collectionPanel.hidden = false;
    const collectionsView = buildCollectionsView();
    buildPortfolioSimulator(collectionsView);
    buildPortfolioKpiBanner(collectionsView);
    buildPortfolioHero(collectionsView);
    buildCollectionMetricCards(collectionsView.dashboard);
    buildPortfolioAssetGrid(collectionsView);
    buildPortfolioPriorities(collectionsView.priorities);
    buildPortfolioFiscal(collectionsView.fiscal);
    buildPortfolioDebtRatios(collectionsView.debtRatios);
    buildPortfolioObjectif(collectionsView.objectif);
    buildPortfolioProjection(collectionsView.projection);
    buildPortfolioRepartition(collectionsView.portfolioItems);
    buildPortfolioCredits(collectionsView.portfolioItems, state.profileData.autresCredits);
    buildPortfolioTimeline(collectionsView.portfolioItems);
}

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
        nodes.topbarStudyMeta.textContent = `${state.variablesData.ville || VARIABLE_DEFAULTS.ville} · ${getTypeBienLabel(state.variablesData['type-bien'])} · ${getCurrentAssetStatus()}`;
    }
    nodes.variablesSubtitle.textContent = state.screens === 1
        ? 'Hypothèses, coûts et financement peuvent être ajustés en continu.'
        : 'Cette vue centralise les hypothèses, coûts et paramètres de financement.';
    nodes.variablesContext.textContent = `Dossier : ${getCurrentAssetName()} · ${state.variablesData.ville || VARIABLE_DEFAULTS.ville} · ${getCurrentAssetStatus()} · ${getProfileContextSummary()} · TMI ${tmi} %.`;

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
    buildAnalysisSummary(analysisModel, tmi, parts, composition);
    buildAnalysisChecklist(analysisModel);
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
    calculateFeasibilityStrategy();
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
    state.profileData = sanitizeProfileData({
        name: nodes.profileName.value,
        income: nodes.profileIncome.value,
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
    nodes.profileSave.addEventListener('click', () => {
        if (state.profileConfigured) {
            closeProfileModal();
            return;
        }

        confirmProfileModal();
    });

    nodes.profileModal.addEventListener('click', event => {
        if (event.target === nodes.profileModal) {
            closeProfileModal();
        }
    });

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && state.isProfileModalOpen) {
            closeProfileModal();
            return;
        }

        if (event.key === 'Escape' && nodes.assetDetailDrawer?.classList.contains('is-open')) {
            closeAssetDetailDrawer();
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
    nodes.saveComparison.addEventListener('click', () => createOrUpdateCurrentAsset({ inComparison: true }));
    nodes.savePortfolio.addEventListener('click', () => createOrUpdateCurrentAsset({ inPortfolio: true }));
    nodes.exportDecisionPdf.addEventListener('click', handleDecisionSummaryExport);
    if (nodes.portfolioAssetGridOwned) nodes.portfolioAssetGridOwned.addEventListener('click', handlePortfolioCardAction);
    if (nodes.portfolioAssetGridPipeline) nodes.portfolioAssetGridPipeline.addEventListener('click', handlePortfolioCardAction);
    document.getElementById('credit-drawer-close')?.addEventListener('click', closeCreditDrawer);
    document.getElementById('credit-drawer-cancel')?.addEventListener('click', closeCreditDrawer);
    document.getElementById('credit-drawer-form')?.addEventListener('submit', handleCreditDrawerSave);
    document.getElementById('autre-credit-drawer-close')?.addEventListener('click', closeAutreCreditDrawer);
    document.getElementById('autre-credit-drawer-cancel')?.addEventListener('click', closeAutreCreditDrawer);
    document.getElementById('autre-credit-drawer-form')?.addEventListener('submit', handleAutreCreditDrawerSave);
    if (nodes.portfolioCredits) nodes.portfolioCredits.addEventListener('click', handlePortfolioCreditsAction);

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

function handlePortfolioCardAction(event) {
    const button = event.target.closest('button[data-action]');
    if (!button) return;

    const assetId = button.dataset.id;
    const action = button.dataset.action;

    if (action === 'open-asset') {
        loadAssetIntoWorkspace(assetId);
        return;
    }

    if (action === 'preview-asset') {
        openAssetDetailDrawer(assetId, button.dataset.scope || 'portfolio');
        return;
    }

    if (action === 'pdf-asset') {
        loadAssetIntoWorkspace(assetId);
        // Attendre le prochain render puis déclencher l'export PDF
        setTimeout(() => handleDecisionSummaryExport(), 300);
        return;
    }

    if (action === 'edit-credit') {
        openCreditDrawer(assetId);
        return;
    }

    if (action === 'remove-asset') {
        removeAssetFromScope(assetId, button.dataset.scope || 'portfolio');
    }
}

function initWorkspaceTabs() {
    const tabs = document.querySelectorAll('.workspace-tab');
    const workspacePanel = document.querySelector('.workspace-panel');
    const collectionPanel = document.getElementById('collection-panel');
    const scannerPanel = document.getElementById('scanner-panel');
    const feasibilityPanel = document.getElementById('feasibility-panel');

    collectionPanel.style.display = 'none';
    if (scannerPanel) scannerPanel.style.display = 'none';
    if (feasibilityPanel) feasibilityPanel.style.display = 'none';

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('is-active'));
            tab.classList.add('is-active');
            const target = tab.dataset.target;
            workspacePanel.style.display = 'none';
            collectionPanel.style.display = 'none';
            if (scannerPanel) scannerPanel.style.display = 'none';
            if (feasibilityPanel) feasibilityPanel.style.display = 'none';

            if (target === 'collection-panel') {
                collectionPanel.style.display = '';
                collectionPanel.style.animation = 'tabFadeIn 200ms ease-out';
                if (_portfolioMap) { window.requestAnimationFrame(() => _portfolioMap.invalidateSize()); }
            } else if (target === 'scanner-panel') {
                if (scannerPanel) {
                    scannerPanel.style.display = '';
                    scannerPanel.style.animation = 'tabFadeIn 200ms ease-out';
                    onScannerTabActivated();
                }
            } else if (target === 'feasibility-panel') {
                if (feasibilityPanel) {
                    feasibilityPanel.style.display = '';
                    feasibilityPanel.style.animation = 'tabFadeIn 200ms ease-out';
                    calculateFeasibilityStrategy();
                }
            } else {
                workspacePanel.style.display = '';
                workspacePanel.style.animation = 'tabFadeIn 200ms ease-out';
            }
        });
    });
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

function calculateFeasibilityStrategy() {
    const variablesData = state.variablesData || {};
    const tmi = state.profileData ? (state.profileData.tmi || 30) : 30;

    const targetCF = parseFloat(document.getElementById('feasibility-target-cf')?.value) || 0;
    const prixMaxEl = document.getElementById('feasibility-prix-max');
    const loyerMinEl = document.getElementById('feasibility-loyer-min');
    if (!prixMaxEl || !loyerMinEl) return;

    const loyerEstime = parseFloat(document.getElementById('feasibility-loyer-estime')?.value) || 0;

    const agence = variablesData.agence || 0;
    const inputs = { ...variablesData };

    // Recherche dichotomique : prix max pour atteindre targetCF avec loyerEstime
    let minPrice = 1; let maxPrice = 2000000; let bestPrice = 0;
    const cfAtMin = computeCFForFeasibility(1, loyerEstime, inputs, tmi);
    if (cfAtMin < targetCF) {
        prixMaxEl.textContent = 'Impossible pour ce niveau de loyer';
        prixMaxEl.className = 'feasibility-result-value feasibility-result-value--impossible';
    } else {
        for (let i = 0; i < 50; i++) {
            const mid = (minPrice + maxPrice) / 2;
            if (computeCFForFeasibility(mid, loyerEstime, inputs, tmi) >= targetCF) {
                bestPrice = mid; minPrice = mid;
            } else { maxPrice = mid; }
        }
        const prixFaiMax = bestPrice + agence;
        prixMaxEl.textContent = Math.round(prixFaiMax).toLocaleString('fr-FR') + ' €';
        prixMaxEl.className = 'feasibility-result-value feasibility-result-value--positive';
    }

    // Recherche dichotomique : loyer min pour atteindre targetCF avec prixAnnonce
    const prixAnnonceFai = parseFloat(document.getElementById('feasibility-prix-annonce')?.value) || 0;
    const prixNetVendeur = prixAnnonceFai - agence;

    if (computeCFForFeasibility(prixNetVendeur, 10000, inputs, tmi) < targetCF) {
        loyerMinEl.textContent = 'Impossible avec ce prix';
        loyerMinEl.className = 'feasibility-result-value feasibility-result-value--impossible';
    } else {
        let minRent = 1; let maxRent = 10000; let bestRent = 10000;
        for (let i = 0; i < 50; i++) {
            const mid = (minRent + maxRent) / 2;
            if (computeCFForFeasibility(prixNetVendeur, mid, inputs, tmi) >= targetCF) {
                bestRent = mid; maxRent = mid;
            } else { minRent = mid; }
        }
        loyerMinEl.textContent = Math.round(bestRent).toLocaleString('fr-FR') + ' €/mois';
        loyerMinEl.className = 'feasibility-result-value feasibility-result-value--positive';
    }
}

function computeCFForFeasibility(prixNet, loyer, inputs, tmi) {
    const notaire = prixNet * ((inputs.notaire || 7.5) / 100);
    const fraisFixes = (inputs.agence || 0) + (inputs.travaux || 0) + (inputs.meubles || 0) + (inputs['frais-bancaires'] || 0);
    const coutTotal = prixNet + notaire + fraisFixes;
    const montantFinance = Math.max(0, coutTotal - (inputs.apport || 0));

    const nMois = (inputs.duree || 20) * 12;
    const tauxMensuel = ((inputs['taux-input'] || 3.5) / 100) / 12;
    let mensualiteCredit = 0;
    if (tauxMensuel > 0 && nMois > 0) {
        mensualiteCredit = (montantFinance * tauxMensuel) / (1 - Math.pow(1 + tauxMensuel, -nMois));
    } else if (nMois > 0) {
        mensualiteCredit = montantFinance / nMois;
    }
    const mensualiteAssurance = (montantFinance * ((inputs.assurance || 0.25) / 100)) / 12;
    const mensualiteTotale = mensualiteCredit + mensualiteAssurance;

    const vacance = (inputs.vacance || 5) / 100;
    const loyersEncaisses = loyer * 12 * (1 - vacance);
    const charges = (inputs.copro || 0) * 12 + (inputs.fonciere || 0) + (inputs.pno || 0) + loyersEncaisses * ((inputs.gestion || 0) / 100);

    const interets1an = montantFinance * tauxMensuel * 12;
    let impots = 0;
    const regime = inputs.regime || 'micro-foncier';
    if (regime === 'micro-foncier') {
        impots = loyersEncaisses * 0.7 * ((tmi / 100) + 0.172);
    } else if (regime === 'reel') {
        const revNets = Math.max(0, loyersEncaisses - charges - mensualiteAssurance * 12 - interets1an - (inputs.travaux || 0) - (inputs['frais-bancaires'] || 0));
        impots = revNets * ((tmi / 100) + 0.172);
    } else if (regime === 'sci-is') {
        const amort = prixNet * 0.80 / 30;
        const benefice = loyersEncaisses - charges - mensualiteAssurance * 12 - interets1an - amort;
        if (benefice > 0) impots = Math.min(benefice, 42500) * 0.15 + Math.max(0, benefice - 42500) * 0.25;
    }

    return (loyersEncaisses / 12) - mensualiteTotale - (charges / 12) - (impots / 12);
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
initScanner({ saveCurrentStudy });
if (!state.profileConfigured && !IS_ANALYSIS_WINDOW) {
    setTimeout(() => openProfileModal(), 400);
}
initAccordion();
initTutoBar();
initSliders();

// Event listeners faisabilité
['feasibility-target-cf', 'feasibility-loyer-estime', 'feasibility-prix-annonce'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', calculateFeasibilityStrategy);
});

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

