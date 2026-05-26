import { calculateTMI, computeAnalysisViewModel, computePortfolioViewModel, getHouseholdTaxParts } from './calculs.js';
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
        defaults: { name: 'Famille', income: 98000, adults: 2, children: 2 },
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
    'nom-bien': 'Bien à étudier',
    'statut-bien': 'candidate',
    ville: 'Ville non renseignée',
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

const nodes = {
    themeToggle: document.getElementById('theme-toggle'),
    screenToggle: document.getElementById('screen-toggle'),
    profileTrigger: document.getElementById('profile-trigger'),
    workspaceTitle: document.getElementById('workspace-title'),
    workspaceSubtitle: document.getElementById('workspace-subtitle'),
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
    portfolioSummary: document.getElementById('portfolio-summary'),
    portfolioDecision: document.getElementById('portfolio-decision'),
    portfolioAlerts: document.getElementById('portfolio-alerts'),
    portfolioCapacity: document.getElementById('portfolio-capacity'),
    portfolioConcentration: document.getElementById('portfolio-concentration'),
    portfolioPriorities: document.getElementById('portfolio-priorities'),
    acquisitionArbitrage: document.getElementById('acquisition-arbitrage'),
    comparisonTable: document.getElementById('comparison-table'),
    portfolioTable: document.getElementById('portfolio-table'),
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
    profileParts: document.getElementById('profile-parts'),
    profileTmi: document.getElementById('profile-tmi'),
    profileComposition: document.getElementById('profile-composition'),
    themeMeta: document.querySelector('meta[name="theme-color"]'),
    fkpiRdtBrut: document.getElementById('fkpi-rdt-brut'),
    fkpiCfNet: document.getElementById('fkpi-cf-net'),
    fkpiDscr: document.getElementById('fkpi-dscr'),
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
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function loadScreens() {
    const savedValue = Number.parseInt(localStorage.getItem(STORAGE_KEYS.screens) || '2', 10);
    return savedValue === 1 ? 1 : 2;
}

function loadProfilePreset() {
    const savedProfile = localStorage.getItem(STORAGE_KEYS.profilePreset);
    return PROFILE_OPTIONS.some(profile => profile.key === savedProfile) ? savedProfile : 'solo';
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
        children: Math.max(0, Math.round(Number(rawProfile.children) || 0))
    };
}

function sanitizeVariablesData(rawVariables) {
    return {
        'nom-bien': normalizeLegacyCopy(rawVariables['nom-bien'] || VARIABLE_DEFAULTS['nom-bien']) || VARIABLE_DEFAULTS['nom-bien'],
        'statut-bien': OWNERSHIP_VALUES.has(rawVariables['statut-bien']) ? rawVariables['statut-bien'] : 'candidate',
        ville: normalizeLegacyCopy(rawVariables.ville || VARIABLE_DEFAULTS.ville) || VARIABLE_DEFAULTS.ville,
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

    return {
        id: typeof rawAsset.id === 'string' && rawAsset.id ? rawAsset.id : createAssetId(),
        variablesData: sanitizeVariablesData({ ...VARIABLE_DEFAULTS, ...(rawAsset.variablesData || {}) }),
        inComparison: Boolean(rawAsset.inComparison),
        inPortfolio: Boolean(rawAsset.inPortfolio),
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
        thesisField.reportValidity();
        thesisField.focus();
        return false;
    }

    if (nextStepMessage && nextStepField) {
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
                <span class="matrix-legend-item"><span class="matrix-legend-swatch matrix-legend-swatch--excellent"></span>Très favorable</span>
                <span class="matrix-legend-item"><span class="matrix-legend-swatch matrix-legend-swatch--positive"></span>Acheter</span>
                <span class="matrix-legend-item"><span class="matrix-legend-swatch matrix-legend-swatch--watch"></span>Négocier</span>
                <span class="matrix-legend-item"><span class="matrix-legend-swatch matrix-legend-swatch--negative"></span>Refuser</span>
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
            <button type="button" class="table-action" data-action="load-asset" data-id="${assetId}">Ouvrir</button>
            <button type="button" class="table-action" data-action="remove-asset" data-scope="${scope}" data-id="${assetId}">Retirer</button>
        </div>
    `;
}

function buildEmptyTableMarkup(message) {
    return `<p class="collection-empty">${message}</p>`;
}

function buildCollectionMetricCards(summary, capacity, concentration) {
    const cards = [
        { label: 'Biens suivis', value: String(summary.assetCount), cssClass: '' },
        { label: 'Biens détenus', value: String(summary.ownedCount), cssClass: '' },
        { label: 'CF consolidé', value: formatSignedCurrency(summary.totalCashflow), cssClass: getMetricClass(summary.totalCashflow) },
        { label: 'Fiscalité locative', value: formatPlainCurrency(summary.consolidatedTaxAnnual), cssClass: summary.consolidatedTaxAnnual > 0 ? 'is-watch' : 'is-positive' },
        { label: 'Dette mensuelle', value: formatPlainCurrency(summary.totalDebtMonthly), cssClass: '' },
        { label: 'Valeur créée à 10 ans', value: formatSignedCurrency(summary.totalTraction), cssClass: getMetricClass(summary.totalTraction) },
        { label: 'Marge d\'achat', value: formatSignedCurrency(capacity.remainingEffort), cssClass: getDecisionClass(capacity.tone) },
        { label: 'Ville la plus exposée', value: concentration.cityCount ? `${Math.round(concentration.topCityShare)} %` : '--', cssClass: getDecisionClass(concentration.tone) },
        { label: 'Acquisitions prêtes', value: String(summary.readyAcquisitions), cssClass: summary.readyAcquisitions > 0 ? 'is-positive' : '' }
    ];

    nodes.portfolioSummary.innerHTML = cards.map(card => `
        <article class="metric-card">
            <span class="metric-label">${card.label}</span>
            <strong class="metric-value ${card.cssClass}">${card.value}</strong>
        </article>
    `).join('');
}

function buildPortfolioDecision(decision) {
    nodes.portfolioDecision.innerHTML = `
        <div class="decision-card">
            <div class="decision-head">
                <span class="status-label">Vision consolidée</span>
                <strong class="decision-badge decision-badge--${decision.tone}">${decision.label}</strong>
            </div>
            <p class="analysis-verdict">${decision.summary}</p>
            <p class="decision-hint">Étape recommandée : <strong>${decision.action}</strong></p>
            ${decision.checkpoints.length ? `
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
            ` : '<p class="collection-empty">Ajoutez des biens pour activer la lecture consolidée du portefeuille.</p>'}
        </div>
    `;
}

function buildPortfolioAlerts(alerts) {
    if (!alerts.length) {
        nodes.portfolioAlerts.innerHTML = '<p class="collection-empty">Aucune alerte prioritaire pour l\'instant.</p>';
        return;
    }

    nodes.portfolioAlerts.innerHTML = `
        <div class="alert-list">
            ${alerts.map(alert => `
                <article class="alert-card alert-card--${alert.tone}">
                    <div class="lever-head">
                        <strong>${alert.title}</strong>
                        <span class="status-pill status-pill--${alert.tone}">${alert.tone === 'negative' ? 'Alerte' : 'Surveillance'}</span>
                    </div>
                    <p>${alert.detail}</p>
                </article>
            `).join('')}
        </div>
    `;
}

function buildPortfolioCapacity(capacity) {
    nodes.portfolioCapacity.innerHTML = `
        <div class="capacity-shell">
            <div class="decision-head">
                <span class="status-label">Capacité d'achat</span>
                <strong class="status-pill status-pill--${capacity.tone}">${capacity.label}</strong>
            </div>
            <p class="decision-hint">${capacity.summary}</p>
            <div class="buybox-kpis">
                <article class="buybox-kpi">
                    <span>Effort cible</span>
                    <strong>${formatPlainCurrency(capacity.allowedEffort)}</strong>
                </article>
                <article class="buybox-kpi ${getDecisionClass(capacity.tone)}">
                    <span>Marge disponible</span>
                    <strong>${formatSignedCurrency(capacity.remainingEffort)}</strong>
                </article>
                <article class="buybox-kpi ${capacity.financedAmount > 0 ? 'is-positive' : 'is-neutral'}">
                    <span>Budget finançable</span>
                    <strong>${formatPlainCurrency(capacity.financedAmount)}</strong>
                </article>
                <article class="buybox-kpi ${capacity.acquisitionBudget > 0 ? 'is-positive' : 'is-neutral'}">
                    <span>Budget total mobilisable</span>
                    <strong>${formatPlainCurrency(capacity.acquisitionBudget)}</strong>
                </article>
            </div>
        </div>
    `;
}

function buildPortfolioConcentration(concentration) {
    nodes.portfolioConcentration.innerHTML = `
        <div class="concentration-shell">
            <div class="decision-head">
                <span class="status-label">Concentration des loyers</span>
                <strong class="status-pill status-pill--${concentration.tone}">${concentration.label}</strong>
            </div>
            <p class="decision-hint">${concentration.summary}</p>
            ${concentration.cities.length ? `
                <div class="timeline-summary">
                    <div class="timeline-pill">
                        <span>Villes suivies</span>
                        <strong>${concentration.cityCount}</strong>
                    </div>
                    <div class="timeline-pill">
                        <span>Top ville</span>
                        <strong>${Math.round(concentration.topCityShare)} %</strong>
                    </div>
                    <div class="timeline-pill">
                        <span>Top bien</span>
                        <strong>${Math.round(concentration.topAssetShare)} %</strong>
                    </div>
                </div>
                <div class="concentration-list">
                    ${concentration.cities.map(item => `
                        <article class="scenario-card scenario-card--${concentration.tone}">
                            <div class="lever-head">
                                <strong>${escapeHtml(item.label)}</strong>
                                <span class="status-pill status-pill--${concentration.tone}">${Math.round(item.share)} %</span>
                            </div>
                            <p>${item.count} bien${item.count > 1 ? 's' : ''} · ${formatPlainCurrency(item.monthlyRent)} / mois</p>
                        </article>
                    `).join('')}
                </div>
            ` : '<p class="collection-empty">Renseignez au moins une ville pour lire la concentration du risque.</p>'}
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

function buildAcquisitionArbitrage(acquisitions) {
    if (!acquisitions.length) {
        nodes.acquisitionArbitrage.innerHTML = '<p class="collection-empty">Aucun candidat à arbitrer tant qu aucun bien n est enregistré au comparateur.</p>';
        return;
    }

    nodes.acquisitionArbitrage.innerHTML = `
        <table class="analysis-table">
            <thead>
                <tr>
                    <th>Dossier</th>
                    <th>Décision</th>
                    <th>Arbitrage</th>
                    <th>Δ CF</th>
                    <th>Δ fiscalité</th>
                    <th>DSCR simulé</th>
                    <th>Marge restante</th>
                </tr>
            </thead>
            <tbody>
                ${acquisitions.map(item => `
                    <tr>
                        <td>
                            <strong>${escapeHtml(item.name)}</strong>
                            <div class="table-subline">${item.summary}</div>
                        </td>
                        <td><span class="status-pill status-pill--${item.recommendation.tone}">${item.decisionLabel}</span></td>
                        <td><span class="status-pill status-pill--${item.recommendation.tone}">${item.recommendation.label}</span></td>
                        <td><strong class="${item.deltaCashflow >= 0 ? 'value-positive' : 'value-negative'}">${formatSignedCurrency(item.deltaCashflow)}</strong></td>
                        <td><strong class="${item.deltaTaxAnnual <= 0 ? 'value-positive' : 'value-negative'}">${formatSignedCurrency(-item.deltaTaxAnnual)}</strong></td>
                        <td>${formatRatio(item.scenarioDscr)}</td>
                        <td><strong class="${item.scenarioCapacity >= 0 ? 'value-positive' : 'value-negative'}">${formatSignedCurrency(item.scenarioCapacity)}</strong></td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

function buildComparisonTable(items) {
    if (!items.length) {
        nodes.comparisonTable.innerHTML = buildEmptyTableMarkup('Aucun dossier dans le comparateur pour l\'instant.');
        return;
    }

    nodes.comparisonTable.innerHTML = `
        <table class="analysis-table">
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
                            <div class="table-subline">${escapeHtml(item.city || 'Ville non renseignée')}</div>
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
    `;
}

function buildPortfolioTable(items) {
    if (!items.length) {
        nodes.portfolioTable.innerHTML = buildEmptyTableMarkup('Aucun bien au portefeuille pour l\'instant.');
        return;
    }

    nodes.portfolioTable.innerHTML = `
        <table class="analysis-table">
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
                            <div class="table-subline">${escapeHtml(item.city || 'Ville non renseignée')} · ${item.analysisModel.decision.label}</div>
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
    `;
}

function buildCollectionsView() {
    return computePortfolioViewModel(state.assetRecords, {
        income: state.profileData.income,
        adults: state.profileData.adults,
        children: state.profileData.children
    }, state.activeAssetId, state.variablesData);
}

function createOrUpdateCurrentAsset(flags) {
    if (!validateDecisionJournalBeforeSave()) {
        return;
    }

    const existingIndex = state.assetRecords.findIndex(asset => asset.id === state.activeAssetId);
    const now = Date.now();
    const baseRecord = existingIndex >= 0 ? state.assetRecords[existingIndex] : null;
    const assetId = baseRecord?.id || createAssetId();
    const nextRecord = {
        id: assetId,
        variablesData: sanitizeVariablesData(state.variablesData),
        inComparison: Boolean(baseRecord?.inComparison) || Boolean(flags.inComparison),
        inPortfolio: Boolean(baseRecord?.inPortfolio) || Boolean(flags.inPortfolio),
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
    render({ syncVariables: false, syncProfile: false });
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
        studyChip.textContent = state.variablesData?.['nom-bien'] || '—';
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

function openProfileModal() {
    state.isProfileModalOpen = true;
    render({ syncProfile: false, syncVariables: false });
    window.requestAnimationFrame(() => {
        nodes.profileName.focus();
    });
}

function closeProfileModal(markConfigured = true) {
    state.isProfileModalOpen = false;
    if (markConfigured) {
        setProfileConfigured();
        emitStateUpdate();
    }
    render({ syncProfile: false, syncVariables: false });
}

function applyProfilePreset(profileKey) {
    state.profilePreset = profileKey;
    localStorage.setItem(STORAGE_KEYS.profilePreset, state.profilePreset);
    state.profileData = createProfileData(profileKey);
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
            label: 'Zone solide',
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

    nodes.analysisStickySummary.innerHTML = `
        <div class="analysis-sticky-card">
            <div class="analysis-sticky-copy">
                <span class="status-label">En un coup d œil</span>
                <div class="analysis-sticky-head">
                    <strong class="decision-badge decision-badge--${acquisitionDecision.tone}">${acquisitionDecision.label}</strong>
                    <p class="analysis-sticky-action">${escapeHtml(acquisitionDecision.action)}</p>
                </div>
            </div>
            <div class="analysis-sticky-kpis">
                <article class="analysis-sticky-kpi">
                    <span>Score</span>
                    <strong>${acquisitionDecision.score}/100</strong>
                </article>
                <article class="analysis-sticky-kpi">
                    <span>Offre plafond</span>
                    <strong>${formatPlainCurrency(acquisitionDecision.maxOfferPrice)}</strong>
                </article>
                <article class="analysis-sticky-kpi">
                    <span>Fiabilité</span>
                    <strong>${confidenceModel.label}</strong>
                </article>
                <article class="analysis-sticky-kpi">
                    <span>Stress</span>
                    <strong>${scenarioModel.label}</strong>
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

function renderCollections() {
    if (IS_ANALYSIS_WINDOW) {
        nodes.collectionPanel.hidden = true;
        return;
    }

    nodes.collectionPanel.hidden = false;
    const collectionsView = buildCollectionsView();
    buildCollectionMetricCards(collectionsView.dashboard, collectionsView.capacity, collectionsView.concentration);
    buildPortfolioDecision(collectionsView.decision);
    buildPortfolioAlerts(collectionsView.alerts);
    buildPortfolioCapacity(collectionsView.capacity);
    buildPortfolioConcentration(collectionsView.concentration);
    buildPortfolioPriorities(collectionsView.priorities);
    buildAcquisitionArbitrage(collectionsView.acquisitions);
    buildComparisonTable(collectionsView.comparisonItems);
    buildPortfolioTable(collectionsView.portfolioItems);
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
        nodes.workspaceTitle.textContent = 'Vue analyse détachée';
        nodes.workspaceSubtitle.textContent = 'Fenêtre secondaire synchronisée avec la saisie de la fenêtre principale.';
        nodes.analysisKicker.textContent = 'Analyse détachée';
        nodes.analysisSubtitle.textContent = 'Cette vue se met à jour dès qu une hypothèse change dans la fenêtre principale.';
    } else if (state.screens === 1) {
        nodes.workspaceTitle.textContent = 'Vue simple écran';
        nodes.workspaceSubtitle.textContent = 'La saisie et l\'analyse restent sur une seule page, dans un flux continu.';
        nodes.analysisKicker.textContent = 'Analyse';
        nodes.analysisSubtitle.textContent = 'Décision, robustesse et leviers d\'action s enchaînent juste après la saisie.';
    } else if (useLocalFallback) {
        nodes.workspaceTitle.textContent = 'Vue double écran';
        nodes.workspaceSubtitle.textContent = 'La fenêtre secondaire a été bloquée. L\'analyse reste visible ici en mode secours.';
        nodes.analysisKicker.textContent = 'Analyse locale';
        nodes.analysisSubtitle.textContent = 'La lecture décisionnelle reste disponible ici en attendant l\'ouverture de la fenêtre dédiée.';
    } else {
        nodes.workspaceTitle.textContent = 'Vue double écran';
        nodes.workspaceSubtitle.textContent = 'La fenêtre principale conserve la saisie. L\'analyse s ouvre dans une fenêtre secondaire synchronisée.';
        nodes.analysisKicker.textContent = 'Analyse détachée';
        nodes.analysisSubtitle.textContent = 'Cette vue met l\'accent sur la décision, la robustesse et les leviers d\'action.';
    }

    nodes.variablesKicker.textContent = state.screens === 1 ? 'Saisie' : 'Écran 1';
    const studyChip = document.getElementById('topbar-study-name');
    if (studyChip) studyChip.textContent = state.variablesData['nom-bien'] || '—';
    nodes.variablesSubtitle.textContent = state.screens === 1
        ? 'Toutes les hypothèses restent modifiables en tête de page.'
        : 'Toutes les hypothèses restent pilotées depuis la fenêtre principale.';
    nodes.variablesContext.textContent = `Étude active : ${getCurrentAssetName()} · ${getCurrentAssetStatus()} · Foyer : ${state.profileData.name} · ${formatCurrency(state.profileData.income)} · ${composition} · TMI ${tmi} %.`;

    if (showVariables) renderFormKpiBar(analysisModel);
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

    nodes.profileTrigger.textContent = `Foyer : ${state.profileData.name}`;
    nodes.profileParts.textContent = `${parts.toLocaleString('fr-FR')} part${parts > 1 ? 's' : ''}`;
    nodes.profileTmi.textContent = `${tmi} %`;
    nodes.profileComposition.textContent = getProfileComposition(state.profileData);
    nodes.profileModalNote.textContent = profile.note;
    nodes.profileSave.textContent = state.profileConfigured ? 'Fermer' : 'Enregistrer le profil';

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
    nodes.screenToggle.textContent = state.screens === 1 ? 'Affichage : 1 écran' : 'Affichage : 2 écrans';

    if (syncProfile) {
        syncProfileForm();
    }

    if (syncVariables) {
        syncVariablesForm();
    }

    renderWorkspaceContent();
    renderModalState();
}

function updateProfileFromForm() {
    state.profileData = sanitizeProfileData({
        name: nodes.profileName.value,
        income: nodes.profileIncome.value,
        adults: nodes.profileAdults.value,
        children: nodes.profileChildren.value
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
    nodes.profileSave.addEventListener('click', () => closeProfileModal());

    nodes.profileModal.addEventListener('click', event => {
        if (event.target === nodes.profileModal) {
            closeProfileModal();
        }
    });

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && state.isProfileModalOpen) {
            closeProfileModal();
        }
    });

    nodes.profileSelect.addEventListener('change', event => {
        applyProfilePreset(event.target.value);
    });

    nodes.profileForm.addEventListener('input', updateProfileFromForm);
    nodes.profileForm.addEventListener('change', updateProfileFromForm);
    nodes.variablesForm.addEventListener('input', updateVariablesFromForm);
    nodes.variablesForm.addEventListener('change', updateVariablesFromForm);
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
    nodes.comparisonTable.addEventListener('click', handleAssetTableAction);
    nodes.portfolioTable.addEventListener('click', handleAssetTableAction);

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

populateProfiles();
setupCrossWindowSync();
bindEvents();
render();
applyGuidedModeUI(isGuidedModeActive());
initWorkspaceTabs();
initScanner({ saveCurrentStudy });
initAccordion();
initTutoBar();

if (!IS_ANALYSIS_WINDOW && state.screens === 2) {
    openAnalysisWindow({ focus: false });
    if (state.analysisPopupBlocked) {
        render({ syncVariables: false, syncProfile: false });
    }
}

if (!state.profileConfigured && !IS_ANALYSIS_WINDOW) {
    openProfileModal();
}