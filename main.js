import { calculateTMI, computeAnalysisViewModel, computePortfolioViewModel, getHouseholdTaxParts } from './calculs.js';
import { buildDecisionPrintDocument } from './pdf.js';

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
    guidedMode: 'investissementWebGuidedMode'
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
    analysisAcquisitionDecision: document.getElementById('analysis-acquisition-decision'),
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

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
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

function buildAnalysisAcquisitionDecision(analysisModel) {
    const { acquisitionDecision, metrics, cfNet, loyerMinimum, monthly, annual } = analysisModel;
    const cfNetClass = metrics.cfNetNet > 0 ? 'is-positive' : (metrics.cfNetNet < 0 ? 'is-negative' : '');
    const cfAvantClass = cfNet > 0 ? 'is-positive' : (cfNet < 0 ? 'is-negative' : '');
    const loyer12 = annual.loyersEncaisses / 12;
    const charges12 = annual.charges / 12;
    const impots12 = annual.impots / 12;
    const regimeLabel = getRegimeLabel(state.variablesData.regime);

    nodes.analysisAcquisitionDecision.innerHTML = `
        <div class="buybox">
            <div class="buybox-head">
                <div class="buybox-copy">
                    <span class="status-label">Décision d'achat</span>
                    <div class="decision-head">
                        <h4>${acquisitionDecision.label}</h4>
                        <div class="buybox-badges">
                            <strong class="decision-badge decision-badge--${acquisitionDecision.tone}">${acquisitionDecision.priceBand}</strong>
                        </div>
                    </div>
                    <p class="analysis-verdict">${acquisitionDecision.summary}</p>
                    <p class="decision-hint">Action prioritaire : <strong>${acquisitionDecision.action}</strong></p>
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

            <div class="buybox-cf-row">
                <article class="buybox-cf-card ${cfAvantClass}">
                    <span class="status-label">CF avant impôt</span>
                    <strong>${formatSignedCurrency(cfNet)} <small>/ mois</small></strong>
                </article>
                <div class="buybox-cf-arrow" aria-hidden="true">→</div>
                <article class="buybox-cf-card ${cfNetClass}">
                    <span class="status-label">CF net-net (après impôt)</span>
                    <strong>${formatSignedCurrency(metrics.cfNetNet)} <small>/ mois</small></strong>
                </article>
            </div>

            <div class="buybox-breakdown">
                <span class="status-label">Décomposition mensuelle</span>
                <ul class="cf-waterfall">
                    <li class="cf-waterfall__row">
                        <span>Loyer encaissé</span>
                        <strong class="value-positive">${formatSignedCurrency(loyer12)}</strong>
                    </li>
                    <li class="cf-waterfall__row">
                        <span>Mensualité crédit</span>
                        <strong class="value-negative">−${formatPlainCurrency(monthly.mensualiteTotale)}</strong>
                    </li>
                    <li class="cf-waterfall__row">
                        <span>Charges d'exploitation</span>
                        <strong class="value-negative">−${formatPlainCurrency(charges12)}</strong>
                    </li>
                    <li class="cf-waterfall__row cf-waterfall__row--subtotal ${cfAvantClass}">
                        <span>= CF avant impôt</span>
                        <strong>${formatSignedCurrency(cfNet)}</strong>
                    </li>
                    <li class="cf-waterfall__row">
                        <span>Impôts (${regimeLabel})</span>
                        <strong class="${impots12 > 0 ? 'value-negative' : ''}">${impots12 > 0 ? '−' : ''}${formatPlainCurrency(Math.abs(impots12))}</strong>
                    </li>
                    <li class="cf-waterfall__row cf-waterfall__row--total ${cfNetClass}">
                        <span>= CF net-net</span>
                        <strong>${formatSignedCurrency(metrics.cfNetNet)}</strong>
                    </li>
                </ul>
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
                <article class="buybox-kpi ${acquisitionDecision.negotiationToTenable > 0 ? 'is-watch' : 'is-positive'}">
                    <span>Baisse minimale</span>
                    <strong>${acquisitionDecision.negotiationToTenable > 0 ? formatPlainCurrency(acquisitionDecision.negotiationToTenable) : 'Aucune'}</strong>
                </article>
                <article class="buybox-kpi">
                    <span>Prix de revient</span>
                    <strong>${formatCurrency(metrics.coutTotal)}</strong>
                </article>
                <article class="buybox-kpi">
                    <span>Mensualité crédit</span>
                    <strong>${formatPlainCurrency(monthly.mensualiteTotale)}</strong>
                </article>
                <article class="buybox-kpi ${loyerMinimum > (analysisModel.annual.loyersEncaisses / 12) ? 'is-watch' : 'is-positive'}">
                    <span>Loyer min. viable</span>
                    <strong>${formatPlainCurrency(loyerMinimum)}</strong>
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
    const { tmi } = analysisModel;
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
    buildAnalysisAcquisitionDecision(analysisModel);
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

    collectionPanel.style.display = 'none'; // hide on load — workspace tab is active by default

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('is-active'));
            tab.classList.add('is-active');
            const target = tab.dataset.target;
            if (target === 'collection-panel') {
                workspacePanel.style.display = 'none';
                collectionPanel.style.display = '';
                collectionPanel.style.animation = 'tabFadeIn 200ms ease-out';
            } else {
                collectionPanel.style.display = 'none';
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