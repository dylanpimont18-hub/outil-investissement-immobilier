import { calculateTMI, computeAnalysisViewModel, computePortfolioViewModel, getHouseholdTaxParts, capitalRestantDu, computeOwnedAssetCF, computeOwnedAssetTimeline, computeAmortizationSchedule, computePatrimoineNet, computeEndettementGlobal, computeCapaciteEmprunt, getOptimalRegime, computeRevenusLocatifsBruts, computeTresorerieReelle, computeCompteResultat, computePortfolioAlerts, computeSimulationTravaux, computeCFBreakdown, computeRegimeComparison } from './calculs.js';
import { buildDecisionPrintDocument } from './pdf.js';
import { initScanner, onScannerTabActivated } from './scanner.js';
import { renderDonutChart, destroyDonut } from './ui.js';

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
    ownedCompact: 'investissementWebOwnedCompact'
};

// --- Portfolio biens détenus ---

function loadOwnedAssets() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.ownedAssets)) || {}; }
    catch { return {}; }
}

function saveOwnedAssets(assets) {
    localStorage.setItem(STORAGE_KEYS.ownedAssets, JSON.stringify(assets));
}

function createOwnedAssetId() {
    return `oa-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function createOwnedAsset(nom, ville) {
    const id = createOwnedAssetId();
    const asset = {
        id,
        nom: String(nom || '').trim(),
        ville: String(ville || '').trim(),
        codePostal: '',
        anneeAchat: null,
        acquisition: {
            prix: 0, fraisAgence: 0, fraisNotaire: 0, loyerInitial: 0,
            surface: 0, typeBien: 'appartement',
            credit: { montant: 0, duree: 0, taux: 0, assurance: 0 }
        },
        postAchat: {
            taxeFonciere: 0, chargesCopro: 0, gestionLocative: 0, assurancePNO: 0,
            travaux: [], notes: []
        },
        scenarios: [
            { id: 'pessimiste', nom: 'Pessimiste', variables: { vacance: 8, regime: state.ownedRegime || 'micro-foncier' } },
            { id: 'realiste',   nom: 'Réaliste',   variables: { vacance: 5, regime: state.ownedRegime || 'micro-foncier' } },
            { id: 'optimiste',  nom: 'Optimiste',  variables: { vacance: 2, regime: state.ownedRegime || 'micro-foncier' } }
        ],
        lastDiagnostic: null
    };
    const all = loadOwnedAssets();
    all[id] = asset;
    saveOwnedAssets(all);
    return asset;
}

function getOwnedAsset(id) {
    return loadOwnedAssets()[id] || null;
}

function updateOwnedAsset(id, patch) {
    const all = loadOwnedAssets();
    if (!all[id]) return;
    all[id] = { ...all[id], ...patch };
    saveOwnedAssets(all);
}

function deleteOwnedAsset(id) {
    const all = loadOwnedAssets();
    delete all[id];
    saveOwnedAssets(all);
}

function updateOwnedAcquisition(id, patch) {
    const all = loadOwnedAssets();
    if (!all[id]) return;
    all[id].acquisition = { ...all[id].acquisition, ...patch };
    saveOwnedAssets(all);
}

function updateOwnedCredit(id, patch) {
    const all = loadOwnedAssets();
    if (!all[id]) return;
    all[id].acquisition.credit = { ...all[id].acquisition.credit, ...patch };
    saveOwnedAssets(all);
}

function updateOwnedPostAchat(id, patch) {
    const all = loadOwnedAssets();
    if (!all[id]) return;
    all[id].postAchat = { ...all[id].postAchat, ...patch };
    saveOwnedAssets(all);
}

function addOwnedTravail(assetId, travail) {
    const all = loadOwnedAssets();
    if (!all[assetId]) return;
    const entry = {
        id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        date: travail.date || '',
        description: travail.description || '',
        montant: Math.max(0, Number(travail.montant) || 0),
        tag: ['deductible', 'non-deductible', 'a-classifier'].includes(travail.tag) ? travail.tag : 'a-classifier',
        credit: travail.credit || null
    };
    all[assetId].postAchat.travaux.push(entry);
    saveOwnedAssets(all);
}

function deleteOwnedTravail(assetId, travailId) {
    const all = loadOwnedAssets();
    if (!all[assetId]) return;
    all[assetId].postAchat.travaux = all[assetId].postAchat.travaux.filter(t => t.id !== travailId);
    saveOwnedAssets(all);
}

function addOwnedNote(assetId, text) {
    if (!String(text || '').trim()) return;
    const all = loadOwnedAssets();
    if (!all[assetId]) return;
    all[assetId].postAchat.notes.push({
        id: `n-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        createdAt: new Date().toISOString(),
        text: String(text).trim()
    });
    saveOwnedAssets(all);
}

function deleteOwnedNote(assetId, noteId) {
    const all = loadOwnedAssets();
    if (!all[assetId]) return;
    const post = all[assetId].postAchat || {};
    all[assetId].postAchat.notes = (post.notes || []).filter(n => n.id !== noteId);
    saveOwnedAssets(all);
}

function addOwnedChargesAnnuelles(assetId, entry) {
    const all = loadOwnedAssets();
    if (!all[assetId]) return;
    const post = all[assetId].postAchat || {};
    const list = [...(post.chargesAnnuelles || [])].filter(e => e.annee !== entry.annee);
    list.push(entry);
    list.sort((a, b) => a.annee - b.annee);
    updateOwnedPostAchat(assetId, { chargesAnnuelles: list });
}

function deleteOwnedChargesAnnuelles(assetId, annee) {
    const all = loadOwnedAssets();
    if (!all[assetId]) return;
    const post = all[assetId].postAchat || {};
    const list = (post.chargesAnnuelles || []).filter(e => e.annee !== annee);
    updateOwnedPostAchat(assetId, { chargesAnnuelles: list });
}

function addOwnedLoyerReel(assetId, entry) {
    const all = loadOwnedAssets();
    if (!all[assetId]) return;
    const post = all[assetId].postAchat || {};
    const list = (post.loyersReels || []).filter(e => e.mois !== entry.mois);
    list.push({ mois: entry.mois, montant: Number(entry.montant) || 0, statut: entry.statut || 'encaisse' });
    list.sort((a, b) => b.mois.localeCompare(a.mois));
    updateOwnedPostAchat(assetId, { loyersReels: list });
}

function deleteOwnedLoyerReel(assetId, mois) {
    const all = loadOwnedAssets();
    if (!all[assetId]) return;
    const post = all[assetId].postAchat || {};
    updateOwnedPostAchat(assetId, { loyersReels: (post.loyersReels || []).filter(e => e.mois !== mois) });
}

function addOwnedDeficitFoncier(assetId, entry) {
    const all = loadOwnedAssets();
    if (!all[assetId]) return;
    const post = all[assetId].postAchat || {};
    const list = (post.deficitFoncierReporte || []).filter(e => e.annee !== entry.annee);
    list.push({ annee: Number(entry.annee), montantInitial: Number(entry.montantInitial) || 0, utilise: Number(entry.utilise) || 0 });
    list.sort((a, b) => b.annee - a.annee);
    updateOwnedPostAchat(assetId, { deficitFoncierReporte: list });
}

function deleteOwnedDeficitFoncier(assetId, annee) {
    const all = loadOwnedAssets();
    if (!all[assetId]) return;
    const post = all[assetId].postAchat || {};
    updateOwnedPostAchat(assetId, { deficitFoncierReporte: (post.deficitFoncierReporte || []).filter(e => e.annee !== annee) });
}

const STORAGE_GOALS = 'investissementWebPortfolioGoals';
function loadPortfolioGoals() {
    try { return JSON.parse(localStorage.getItem(STORAGE_GOALS)) || {}; } catch { return {}; }
}
function savePortfolioGoals(goals) {
    localStorage.setItem(STORAGE_GOALS, JSON.stringify(goals));
}

function addOwnedScenario(assetId) {
    const all = loadOwnedAssets();
    if (!all[assetId]) return;
    const id = `sc-${Date.now()}`;
    all[assetId].scenarios.push({
        id, nom: 'Nouveau', variables: { vacance: 5, regime: 'micro-foncier' }
    });
    saveOwnedAssets(all);
    return id;
}

function updateOwnedScenarioVar(assetId, scenarioId, key, value) {
    const all = loadOwnedAssets();
    if (!all[assetId]) return;
    const sc = all[assetId].scenarios.find(s => s.id === scenarioId);
    if (!sc) return;
    sc.variables[key] = value;
    saveOwnedAssets(all);
}

function updateOwnedScenarioNom(assetId, scenarioId, nom) {
    const all = loadOwnedAssets();
    if (!all[assetId]) return;
    const sc = all[assetId].scenarios.find(s => s.id === scenarioId);
    if (!sc) return;
    sc.nom = nom;
    saveOwnedAssets(all);
}

function deleteOwnedScenario(assetId, scenarioId) {
    const all = loadOwnedAssets();
    if (!all[assetId]) return;
    all[assetId].scenarios = all[assetId].scenarios.filter(s => s.id !== scenarioId);
    saveOwnedAssets(all);
}


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
    analysisPopupBlocked: false,
    ownedAssets: loadOwnedAssets(),
    activeOwnedAssetId: null,
    ownedRegime: localStorage.getItem('investissementWebOwnedRegime') || 'micro-foncier',
    ownedYearFilter: 1,
    ownedYearFilters: JSON.parse(localStorage.getItem('investissementWebOwnedYearFilters') || '{}'),
    ownedLoyerPage: {},
    ownedOrder: JSON.parse(localStorage.getItem(STORAGE_KEYS.ownedOrder) || '[]'),
    ownedCompact: localStorage.getItem(STORAGE_KEYS.ownedCompact) === '1',
};

let analysisWindowRef = null;
let syncChannel = null;
let assetDetailCloseTimer = null;
let profileModalReturnFocusTarget = null;
let assetDetailReturnFocusTarget = null;

const nodes = {
    btnViewQuick: document.getElementById('btn-view-quick'),
    btnViewFull: document.getElementById('btn-view-full'),
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
    portfolioHero: document.getElementById('portfolio-hero'),
    portfolioSimulator: document.getElementById('portfolio-simulator'),
    portfolioSummary: document.getElementById('portfolio-summary'),
    portfolioAiDrawer: document.getElementById('portfolio-ai-drawer'),
    portfolioAiOverlay: document.getElementById('portfolio-ai-overlay'),
    portfolioAiDrawerContent: document.getElementById('portfolio-ai-drawer-content'),
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
    _openDrawer(nodes.creditDrawerOverlay, nodes.creditDrawer, closeCreditDrawer, nodes.creditDateDebut);
}

function closeCreditDrawer() {
    _closeDrawer(nodes.creditDrawerOverlay, nodes.creditDrawer);
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
    const flashBtn = nodes.saveAsset;
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
    renderProfileCreditsList();
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
                <button class="profile-credit-row__edit" data-delete-credit="${escapeHtml(c.id)}" style="color:var(--color-negative,#ef4444)">✕</button>
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
    const statut = state.variablesData['statut-bien'];
    nodes.saveAsset.textContent = isSaved
        ? (statut === 'owned' ? 'Mettre à jour le bien' : 'Mettre à jour')
        : (statut === 'owned' ? 'Ajouter au portefeuille' : 'Enregistrer');

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
// ─── HELPER MODAL GÉNÉRIQUE ──────────────────────────────────────────────────

function _showOwnedModal(html, id = 'owned-generic-modal') {
    let modal = document.getElementById(id);
    if (!modal) {
        modal = document.createElement('div');
        modal.id = id;
        document.body.appendChild(modal);
    }
    modal.className = 'owned-modal-overlay';
    modal.innerHTML = html;
    modal.hidden = false;
    const close = () => { modal.hidden = true; };
    modal.addEventListener('click', e => { if (e.target === modal) close(); });
    modal.querySelectorAll('[data-close-modal]').forEach(el => el.addEventListener('click', close));
    return modal;
}

// ─── COMPTE DE RÉSULTAT ──────────────────────────────────────────────────────

function openCompteResultatModal(assetId) {
    const asset = getOwnedAsset(assetId);
    if (!asset) return;
    const tmi = getOwnedTmi();
    const regime = getOwnedRegime();
    const anneeAchat = asset.anneeAchat || new Date().getFullYear();
    const currentYear = new Date().getFullYear();
    const annees = [];
    for (let y = anneeAchat; y <= currentYear; y++) annees.push(y);

    function renderCR(annee) {
        const cr = computeCompteResultat(asset, annee, tmi, regime);
        const signCR = v => v >= 0 ? `+${v.toLocaleString('fr-FR')}` : v.toLocaleString('fr-FR');
        const cfTone = cr.cfReel >= 0 ? 'color:var(--success)' : 'color:var(--danger)';
        return `
        <div class="cr-body">
            <div class="cr-section">
                <div class="cr-row cr-row--total"><span>Recettes locatives brutes</span><span>${cr.recettesBrutes.toLocaleString('fr-FR')} €</span></div>
                <div class="cr-row cr-row--sub"><span>&nbsp;&nbsp;dont loyers théoriques</span><span>${cr.loyersTheoriques.toLocaleString('fr-FR')} €</span></div>
                ${cr.vacanceEst > 0 ? `<div class="cr-row cr-row--sub"><span>&nbsp;&nbsp;dont vacance estimée</span><span style="color:var(--danger)">-${cr.vacanceEst.toLocaleString('fr-FR')} €</span></div>` : ''}
            </div>
            <div class="cr-section">
                <div class="cr-row cr-row--total"><span>Charges ${regime === 'micro-foncier' ? 'réelles' : 'déductibles'}</span><span>${cr.chargesDeductibles.toLocaleString('fr-FR')} €</span></div>
                ${cr.interetsAnnee > 0 ? `<div class="cr-row cr-row--sub"><span>&nbsp;&nbsp;Intérêts d'emprunt</span><span>${cr.interetsAnnee.toLocaleString('fr-FR')} €</span></div>` : ''}
                ${cr.assuranceAnnee > 0 ? `<div class="cr-row cr-row--sub"><span>&nbsp;&nbsp;Assurance crédit</span><span>${cr.assuranceAnnee.toLocaleString('fr-FR')} €</span></div>` : ''}
                ${cr.taxeFonciere > 0 ? `<div class="cr-row cr-row--sub"><span>&nbsp;&nbsp;Taxe foncière</span><span>${cr.taxeFonciere.toLocaleString('fr-FR')} €</span></div>` : ''}
                ${cr.chargesCopro > 0 ? `<div class="cr-row cr-row--sub"><span>&nbsp;&nbsp;Charges copro</span><span>${cr.chargesCopro.toLocaleString('fr-FR')} €</span></div>` : ''}
                ${cr.assurancePNO > 0 ? `<div class="cr-row cr-row--sub"><span>&nbsp;&nbsp;Assurance PNO</span><span>${cr.assurancePNO.toLocaleString('fr-FR')} €</span></div>` : ''}
                ${cr.gestionLocative > 0 ? `<div class="cr-row cr-row--sub"><span>&nbsp;&nbsp;Gestion locative</span><span>${cr.gestionLocative.toLocaleString('fr-FR')} €</span></div>` : ''}
                ${cr.travauxDed > 0 ? `<div class="cr-row cr-row--sub"><span>&nbsp;&nbsp;Travaux déductibles</span><span>${cr.travauxDed.toLocaleString('fr-FR')} €</span></div>` : ''}
            </div>
            ${regime === 'micro-foncier' ? `
            <div class="cr-section">
                <div class="cr-row cr-row--sub"><span>Abattement forfaitaire (30%)</span><span>-${Math.round(cr.recettesBrutes * 0.3).toLocaleString('fr-FR')} €</span></div>
                <div class="cr-row cr-row--sub"><span>Base imposable</span><span>${cr.baseImposable.toLocaleString('fr-FR')} €</span></div>
            </div>` : ''}
            <div class="cr-section">
                <div class="cr-row cr-row--kpi"><span>Résultat foncier</span><span style="${cr.resultatFoncier < 0 ? 'color:var(--danger)' : ''}">${signCR(cr.resultatFoncier)} €</span></div>
                <div class="cr-row cr-row--kpi"><span>Impôts (${regime})</span><span style="${cr.impots > 0 ? 'color:var(--danger)' : 'color:var(--success)'}">${cr.impots > 0 ? '-' : '+'}${Math.abs(cr.impots).toLocaleString('fr-FR')} €</span></div>
                <div class="cr-row cr-row--kpi"><span>Résultat net après impôt</span><span style="${cr.resultatNet < 0 ? 'color:var(--danger)' : ''}">${signCR(cr.resultatNet)} €</span></div>
            </div>
            <div class="cr-section">
                <div class="cr-row cr-row--sub"><span>Capital remboursé (hors intérêts)</span><span>-${cr.capitalRembourse.toLocaleString('fr-FR')} €</span></div>
                <div class="cr-row cr-row--total cr-row--cf"><span>Cash-flow réel de l'année</span><span style="${cfTone}">${signCR(cr.cfReel)} €</span></div>
                <div class="cr-row cr-row--sub" style="font-style:italic"><span>soit</span><span style="${cfTone}">${signCR(Math.round(cr.cfReel / 12))} €/mois</span></div>
            </div>
        </div>`;
    }

    const modal = _showOwnedModal(`
        <div class="owned-modal owned-modal--wide">
            <div class="owned-modal-head">
                <div>
                    <h3 class="owned-modal-title">Compte de résultat — ${escapeHtml(asset.nom)}</h3>
                    <div class="owned-modal-sub">Régime : ${getOwnedRegime()}</div>
                </div>
                <div style="display:flex;align-items:center;gap:12px">
                    <label style="font-size:.8rem;color:var(--text-secondary)">Année :
                        <select id="cr-annee-select" class="variables-input" style="width:auto;margin-left:6px">
                            ${annees.map(y => `<option value="${y}" ${y === currentYear ? 'selected' : ''}>${y}</option>`).join('')}
                        </select>
                    </label>
                    <button class="btn btn--ghost" data-close-modal>✕</button>
                </div>
            </div>
            <div id="cr-content">${renderCR(currentYear)}</div>
        </div>
    `, 'owned-cr-modal');
    modal.querySelector('#cr-annee-select')?.addEventListener('change', e => {
        const cr = document.getElementById('cr-content');
        if (cr) cr.innerHTML = renderCR(Number(e.target.value));
    });
}

// ─── SIMULATION TRAVAUX ───────────────────────────────────────────────────────

function openSimulationTravauxModal(assetId) {
    const asset = getOwnedAsset(assetId);
    if (!asset) return;
    const tmi = getOwnedTmi();
    const regime = getOwnedRegime();
    const currentYear = new Date().getFullYear();

    function renderSimu(montant, annee, deductible) {
        const sim = computeSimulationTravaux(asset, montant, annee, deductible, tmi, regime);
        const rn = v => v >= 0 ? `+${v.toLocaleString('fr-FR')}` : v.toLocaleString('fr-FR');
        return `
        <div class="cr-section">
            <div class="cr-row cr-row--kpi"><span>Impact CF (mois 1)</span><span style="color:var(--danger)">${rn(sim.impactCFMois)} €/mois</span></div>
            ${sim.applicable ? `
            <div class="cr-row cr-row--kpi"><span>Déficit foncier créé</span><span>${sim.deficitCree.toLocaleString('fr-FR')} €</span></div>
            <div class="cr-row cr-row--kpi"><span>Économie fiscale sur 3 ans</span><span style="color:var(--success)">+${sim.economieFiscale3ans.toLocaleString('fr-FR')} €</span></div>
            <div class="cr-row cr-row--kpi"><span>Nouveau CF estimé (mois 1)</span><span style="${sim.nouveauCFMois >= 0 ? 'color:var(--success)' : 'color:var(--danger)'}">${rn(sim.nouveauCFMois)} €/mois</span></div>
            ` : `<div class="cr-row" style="color:var(--text-tertiary);font-style:italic"><span colspan="2">${deductible ? 'Travaux déductibles nécessitent le régime Foncier Réel.' : 'Travaux non déductibles : impact cash uniquement.'}</span></div>`}
        </div>`;
    }

    const modal = _showOwnedModal(`
        <div class="owned-modal">
            <div class="owned-modal-head">
                <h3 class="owned-modal-title">Simuler des travaux — ${escapeHtml(asset.nom)}</h3>
                <button class="btn btn--ghost" data-close-modal>✕</button>
            </div>
            <div class="cr-section">
                <div class="owned-form-grid">
                    <label class="variables-field">
                        <span class="variables-label">Montant des travaux (€)</span>
                        <input class="variables-input" type="number" id="simu-montant" min="0" step="500" value="10000">
                    </label>
                    <label class="variables-field">
                        <span class="variables-label">Année de réalisation</span>
                        <input class="variables-input" type="number" id="simu-annee" min="${asset.anneeAchat || 2020}" max="${currentYear + 5}" value="${currentYear}">
                    </label>
                </div>
                <label style="display:flex;align-items:center;gap:8px;margin-top:8px;font-size:.85rem">
                    <input type="checkbox" id="simu-deductible" checked> Travaux déductibles (régime réel)
                </label>
            </div>
            <div id="simu-result">${renderSimu(10000, currentYear, true)}</div>
        </div>
    `, 'owned-simu-modal');
    const update = () => {
        const m = Number(modal.querySelector('#simu-montant')?.value) || 0;
        const a = Number(modal.querySelector('#simu-annee')?.value) || currentYear;
        const d = modal.querySelector('#simu-deductible')?.checked ?? true;
        const r = modal.querySelector('#simu-result');
        if (r) r.innerHTML = renderSimu(m, a, d);
    };
    modal.querySelector('#simu-montant')?.addEventListener('input', update);
    modal.querySelector('#simu-annee')?.addEventListener('input', update);
    modal.querySelector('#simu-deductible')?.addEventListener('change', update);
}

// ─── CAPACITÉ D'EMPRUNT ───────────────────────────────────────────────────────

function openCapaciteEmpruntModal() {
    const assets = Object.values(loadOwnedAssets());
    const tmi = getOwnedTmi();
    const regime = getOwnedRegime();
    const revenusMens = (state.profileData?.income || 0) / 12;
    const endettement = computeEndettementGlobal(assets, revenusMens, state.profileData?.autresCredits || []);

    function renderCapacite(duree, taux, apport) {
        const capRes = endettement.capaciteResiduelle;
        if (capRes <= 0) return `<div class="owned-alert owned-alert--error">Capacité résiduelle nulle (taux d'endettement ≥ 35 %).</div>`;
        const cap = computeCapaciteEmprunt(capRes, duree, taux, apport);
        return `
        <div class="cr-section">
            <div class="cr-row"><span>Capacité mensualité résiduelle</span><span>${Math.round(capRes).toLocaleString('fr-FR')} €/mois</span></div>
            <div class="cr-row cr-row--kpi"><span>Montant empruntable</span><span style="color:var(--accent-gold)">${cap.montantEmpruntable.toLocaleString('fr-FR')} €</span></div>
            <div class="cr-row cr-row--kpi"><span>Prix d'achat max (frais notaire ~8%)</span><span style="color:var(--accent-gold)">${cap.prixAchatMax.toLocaleString('fr-FR')} €</span></div>
        </div>`;
    }

    const endettTone = endettement.tauxEndettement > 35 ? 'var(--danger)' : endettement.tauxEndettement > 30 ? 'var(--warning)' : 'var(--success)';
    const modal = _showOwnedModal(`
        <div class="owned-modal">
            <div class="owned-modal-head">
                <h3 class="owned-modal-title">Capacité d'emprunt</h3>
                <button class="btn btn--ghost" data-close-modal>✕</button>
            </div>
            <div class="cr-section">
                <div class="cr-row"><span>Mensualités totales actuelles</span><span>${Math.round(endettement.totalMensualites).toLocaleString('fr-FR')} €/mois</span></div>
                <div class="cr-row cr-row--kpi"><span>Taux d'endettement</span><span style="color:${endettTone}">${endettement.tauxEndettement.toFixed(1)} %</span></div>
            </div>
            <div class="cr-section">
                <div class="owned-form-grid">
                    <label class="variables-field"><span class="variables-label">Durée crédit (ans)</span>
                        <select id="cap-duree" class="variables-input">
                            <option value="15">15 ans</option>
                            <option value="20" selected>20 ans</option>
                            <option value="25">25 ans</option>
                        </select></label>
                    <label class="variables-field"><span class="variables-label">Taux envisagé (%)</span>
                        <input type="number" id="cap-taux" class="variables-input" min="0" max="10" step="0.01" value="3.5"></label>
                    <label class="variables-field"><span class="variables-label">Apport disponible (€)</span>
                        <input type="number" id="cap-apport" class="variables-input" min="0" step="1000" value="20000"></label>
                </div>
            </div>
            <div id="cap-result">${renderCapacite(20, 3.5, 20000)}</div>
        </div>
    `, 'owned-cap-modal');
    const update = () => {
        const duree = Number(modal.querySelector('#cap-duree')?.value) || 20;
        const taux = Number(modal.querySelector('#cap-taux')?.value) || 3.5;
        const apport = Number(modal.querySelector('#cap-apport')?.value) || 0;
        const r = modal.querySelector('#cap-result');
        if (r) r.innerHTML = renderCapacite(duree, taux, apport);
    };
    modal.querySelector('#cap-duree')?.addEventListener('change', update);
    modal.querySelector('#cap-taux')?.addEventListener('input', update);
    modal.querySelector('#cap-apport')?.addEventListener('input', update);
}

// ─── OBJECTIFS ────────────────────────────────────────────────────────────────

function openObjectifsModal() {
    const goals = loadPortfolioGoals();
    const modal = _showOwnedModal(`
        <div class="owned-modal">
            <div class="owned-modal-head">
                <h3 class="owned-modal-title">⚙ Objectifs portefeuille</h3>
                <button class="btn btn--ghost" data-close-modal>✕</button>
            </div>
            <div class="cr-section">
                <div class="owned-form-grid">
                    <label class="variables-field"><span class="variables-label">CF mensuel cible (€)</span>
                        <input type="number" id="goal-cf" class="variables-input" min="0" step="100" value="${goals.cfCible || 0}"></label>
                    <label class="variables-field"><span class="variables-label">Patrimoine net cible (€)</span>
                        <input type="number" id="goal-pat" class="variables-input" min="0" step="10000" value="${goals.patrimoineCible || 0}"></label>
                    <label class="variables-field"><span class="variables-label">Date objectif</span>
                        <input type="month" id="goal-date" class="variables-input" value="${goals.dateObjectif || ''}"></label>
                </div>
                <textarea id="goal-comment" class="variables-input" rows="2" placeholder="Commentaire…" style="margin-top:8px;width:100%">${escapeHtml(goals.commentaire || '')}</textarea>
            </div>
            <div class="owned-modal-actions">
                <button class="btn btn--ghost" data-close-modal>Annuler</button>
                <button class="btn btn--primary" id="goal-save">Enregistrer</button>
            </div>
        </div>
    `, 'owned-goals-modal');
    modal.querySelector('#goal-save')?.addEventListener('click', () => {
        savePortfolioGoals({
            cfCible: Number(modal.querySelector('#goal-cf')?.value) || 0,
            patrimoineCible: Number(modal.querySelector('#goal-pat')?.value) || 0,
            dateObjectif: modal.querySelector('#goal-date')?.value || '',
            commentaire: modal.querySelector('#goal-comment')?.value.trim() || '',
        });
        modal.hidden = true;
        renderOwnedPortfolioList();
    });
}

// ─── RAPPORT ANNUEL ────────────────────────────────────────────────────────────

function openRapportAnnuelModal() {
    const assets = Object.values(loadOwnedAssets());
    const tmi = getOwnedTmi();
    const regime = getOwnedRegime();
    const REGIME_LABELS = { 'micro-foncier': 'Micro-foncier', 'reel': 'Foncier réel', 'sci-is': 'SCI-IS' };
    const currentYear = new Date().getFullYear();
    const anneeMin = assets.reduce((m, a) => Math.min(m, a.anneeAchat || currentYear), currentYear);

    function buildRapport(annee) {
        if (!assets.length) return '<p style="color:var(--text-tertiary);text-align:center">Aucun bien dans le portefeuille.</p>';
        let totalValeur = 0, totalCRD = 0, totalLoyers = 0, totalCharges = 0, totalMens = 0, totalImpots = 0;
        const lignesBiens = [];

        for (const a of assets) {
            const acq = a.acquisition || {};
            const post = a.postAchat || {};
            const sc = getOwnedDefaultScenario(a);
            const r = computeOwnedAssetCF(a, { ...sc.variables, regime }, tmi);
            const cr = computeCompteResultat(a, annee, tmi, regime);
            const pn = computePatrimoineNet(a);

            totalValeur += acq.valeurEstimee || 0;
            totalCRD += pn.crd || 0;
            totalLoyers += cr.recettesBrutes;
            totalCharges += cr.chargesDeductibles;
            totalMens += r.mensualiteTotale * 12;
            totalImpots += cr.impots;

            lignesBiens.push({ nom: a.nom, cf: r.cfNetNet, rdt: r.rentaBrute, patNet: pn.patrimoineNet });
        }

        const patNet = totalValeur - totalCRD;
        const cfAnnuel = assets.reduce((sum, a) => {
            const { years } = computeOwnedAssetTimeline(a, tmi, regime);
            const row = years.find(y => y.year === annee) || years[years.length - 1];
            return sum + (row ? row.cfAnnuel : 0);
        }, 0);
        const sig = v => v >= 0 ? `+${v.toLocaleString('fr-FR')}` : v.toLocaleString('fr-FR');

        return `<pre class="rapport-text">
═══════════════════════════════════════════
  RAPPORT PORTEFEUILLE — ${annee}
═══════════════════════════════════════════

PATRIMOINE
  Valeur estimée totale     : ${totalValeur > 0 ? totalValeur.toLocaleString('fr-FR') + ' €' : 'Non renseignée'}
  Capital restant dû total  : ${('-' + totalCRD.toLocaleString('fr-FR') + ' €')}
  Patrimoine net            : ${patNet.toLocaleString('fr-FR')} €

CASH-FLOW (${annee})
  Loyers encaissés          : ${totalLoyers.toLocaleString('fr-FR')} €
  Charges totales           : -${totalCharges.toLocaleString('fr-FR')} €
  Mensualités crédit        : -${Math.round(totalMens).toLocaleString('fr-FR')} €
  Impôts estimés            : -${Math.round(totalImpots).toLocaleString('fr-FR')} €
  CF net-net annuel         : ${sig(Math.round(cfAnnuel))} €
  CF net-net mensuel moy.   : ${sig(Math.round(cfAnnuel / 12))} €

PAR BIEN
${lignesBiens.map(b => `  ${escapeHtml(b.nom).padEnd(20)} │ CF : ${(b.cf >= 0 ? '+' : '') + Math.round(b.cf).toLocaleString('fr-FR')} €/m │ Rdt : ${b.rdt.toFixed(1)} % │ Patrim. net : ${b.patNet !== null ? (b.patNet / 1000).toFixed(0) + 'k€' : '—'}`).join('\n')}

FISCALITÉ
  Régime actuel             : ${REGIME_LABELS[regime] || regime}
  Revenus fonciers bruts    : ${totalLoyers.toLocaleString('fr-FR')} €
  Impôts estimés            : ${Math.round(totalImpots).toLocaleString('fr-FR')} €
═══════════════════════════════════════════</pre>`;
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
                    <button class="btn btn--ghost" data-close-modal>✕</button>
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

// ─── DASHBOARD DIRIGEANT (vue liste) ─────────────────────────────────────────

function renderOwnedDashboard(list, tmi, regime) {
    const wrap = document.getElementById('owned-dashboard-wrap');
    if (!wrap) return;

    if (!list.length) { wrap.innerHTML = ''; return; }

    const revenusMens = (state.profileData?.income || 0) / 12;
    const endettement = computeEndettementGlobal(list, revenusMens, state.profileData?.autresCredits || []);
    const alerts = computePortfolioAlerts(list, tmi, regime, revenusMens);
    const goals = loadPortfolioGoals();

    // Snapshot : patrimoine net total, CF total, endettement, prochain crédit
    const totalPatNet = list.reduce((s, a) => {
        const pn = computePatrimoineNet(a);
        return s + (pn.patrimoineNet || 0);
    }, 0);
    const totalCF = list.reduce((s, a) => {
        const sc = getOwnedDefaultScenario(a);
        return s + computeOwnedAssetCF(a, { ...sc.variables, regime }, tmi).cfNetNet;
    }, 0);
    const cfTone = totalCF >= 0 ? 'positive' : 'negative';
    const endettTone = endettement.tauxEndettement > 35 ? 'negative' : endettement.tauxEndettement > 30 ? 'watch' : 'positive';
    const prochainCredit = endettement.prochainCreditTermine;
    const SEVERITY_ICON = { error: '🔴', warning: '🟡', info: '🔵' };

    // Projections objectifs
    const hasGoals = goals.cfCible > 0 || goals.patrimoineCible > 0;
    const cfProgress = goals.cfCible > 0 ? Math.min(100, (Math.max(0, totalCF) / goals.cfCible) * 100) : 0;
    const patProgress = goals.patrimoineCible > 0 ? Math.min(100, (Math.max(0, totalPatNet) / goals.patrimoineCible) * 100) : 0;
    const dateObjectif = goals.dateObjectif ? new Date(goals.dateObjectif + '-01') : null;
    const moisRestantsObj = dateObjectif ? Math.max(0, Math.round((dateObjectif - new Date()) / (1000 * 60 * 60 * 24 * 30.44))) : null;

    wrap.innerHTML = `
    <div class="owned-dashboard">
        <div class="owned-dashboard-head">
            <span class="owned-dashboard-title">Dashboard dirigeant</span>
            <div style="display:flex;gap:8px">
                <button class="btn btn--ghost btn--sm" data-action="open-capacite">💳 Capacité d'emprunt</button>
                <button class="btn btn--ghost btn--sm" data-action="open-objectifs">⚙ Objectifs</button>
                <button class="btn btn--ghost btn--sm" data-action="open-rapport">📋 Rapport annuel</button>
            </div>
        </div>

        <!-- Ligne 1 : Snapshot -->
        <div class="owned-dashboard-kpis">
            <div class="owned-dashboard-kpi">
                <span class="owned-dashboard-kpi__label">Patrimoine net total</span>
                <span class="owned-dashboard-kpi__value">${totalPatNet !== 0 ? totalPatNet.toLocaleString('fr-FR') + ' €' : '—'}</span>
            </div>
            <div class="owned-dashboard-kpi">
                <span class="owned-dashboard-kpi__label">CF net-net / mois</span>
                <span class="owned-dashboard-kpi__value owned-dashboard-kpi__value--${cfTone}">${totalCF >= 0 ? '+' : ''}${Math.round(totalCF).toLocaleString('fr-FR')} €</span>
            </div>
            <div class="owned-dashboard-kpi">
                <span class="owned-dashboard-kpi__label">Taux d'endettement</span>
                <span class="owned-dashboard-kpi__value owned-dashboard-kpi__value--${endettTone}">${endettement.tauxEndettement.toFixed(1)} %</span>
                <div class="owned-jauge-wrap">
                    <div class="owned-jauge-bar">
                        <div class="owned-jauge-fill owned-jauge-fill--${endettTone}" style="width:${Math.min(100, endettement.tauxEndettement).toFixed(1)}%"></div>
                        <div class="owned-jauge-seuil" style="left:35%" title="Seuil HCSF 35%"></div>
                    </div>
                    <span class="owned-jauge-hint">Capacité résiduelle : ${Math.round(endettement.capaciteResiduelle).toLocaleString('fr-FR')} €/mois</span>
                </div>
            </div>
            <div class="owned-dashboard-kpi">
                <span class="owned-dashboard-kpi__label">Prochain crédit terminé</span>
                <span class="owned-dashboard-kpi__value">${prochainCredit ? escapeHtml(prochainCredit.assetNom) : '—'}</span>
                ${prochainCredit ? `<span class="owned-dashboard-kpi__sub">dans ${Math.round(prochainCredit.moisRestants)} mois (${prochainCredit.anneeFinCredit})</span>` : ''}
            </div>
        </div>

        <!-- Ligne 2 : Alertes -->
        ${alerts.length ? `
        <div class="owned-dashboard-alerts">
            <div class="owned-dashboard-section-title">Alertes (${alerts.length})</div>
            ${alerts.map(a => `
            <div class="owned-dashboard-alert owned-dashboard-alert--${a.severity}">
                ${SEVERITY_ICON[a.severity] || '•'} ${escapeHtml(a.msg)}
                ${a.assetId ? `<button class="btn btn--ghost btn--xs" data-action="go-asset" data-id="${escapeHtml(a.assetId)}">→</button>` : ''}
            </div>`).join('')}
        </div>` : '<div class="owned-dashboard-no-alerts">✓ Aucune alerte active sur le portefeuille</div>'}

        <!-- Ligne 3 : Objectifs -->
        ${hasGoals ? `
        <div class="owned-dashboard-goals">
            <div class="owned-dashboard-section-title">Objectifs
                <button class="btn btn--ghost btn--xs" data-action="open-objectifs" style="margin-left:8px">Modifier</button>
            </div>
            ${goals.cfCible > 0 ? `
            <div class="owned-goal-row">
                <span class="owned-goal-label">CF mensuel : ${Math.round(totalCF).toLocaleString('fr-FR')} € / ${goals.cfCible.toLocaleString('fr-FR')} € cible</span>
                <div class="owned-goal-bar-wrap"><div class="owned-goal-bar" style="width:${cfProgress.toFixed(1)}%"></div></div>
                <span class="owned-goal-delta">${totalCF >= goals.cfCible ? '✓ Atteint !' : 'Il manque ' + Math.round(goals.cfCible - totalCF).toLocaleString('fr-FR') + ' €/mois'}</span>
            </div>` : ''}
            ${goals.patrimoineCible > 0 ? `
            <div class="owned-goal-row">
                <span class="owned-goal-label">Patrimoine : ${totalPatNet.toLocaleString('fr-FR')} € / ${goals.patrimoineCible.toLocaleString('fr-FR')} € cible</span>
                <div class="owned-goal-bar-wrap"><div class="owned-goal-bar" style="width:${patProgress.toFixed(1)}%"></div></div>
                <span class="owned-goal-delta">${totalPatNet >= goals.patrimoineCible ? '✓ Atteint !' : 'Il manque ' + Math.round(goals.patrimoineCible - totalPatNet).toLocaleString('fr-FR') + ' €'}</span>
            </div>` : ''}
            ${moisRestantsObj !== null ? `<div class="owned-goal-deadline">⏱ ${moisRestantsObj > 0 ? moisRestantsObj + ' mois restants avant l\'objectif' : 'Date objectif dépassée'}</div>` : ''}
        </div>` : `
        <div class="owned-dashboard-goals owned-dashboard-goals--empty">
            Aucun objectif défini. <button class="btn btn--ghost btn--xs" data-action="open-objectifs">Définir mes objectifs</button>
        </div>`}
    </div>`;

    wrap.querySelectorAll('[data-action="go-asset"]').forEach(btn => {
        btn.addEventListener('click', () => openOwnedDetail(btn.dataset.id));
    });
    wrap.querySelectorAll('[data-action="open-capacite"]').forEach(btn => {
        btn.addEventListener('click', openCapaciteEmpruntModal);
    });
    wrap.querySelectorAll('[data-action="open-objectifs"]').forEach(btn => {
        btn.addEventListener('click', openObjectifsModal);
    });
    wrap.querySelectorAll('[data-action="open-rapport"]').forEach(btn => {
        btn.addEventListener('click', openRapportAnnuelModal);
    });
}

function initOwnedPortfolioEvents() {
    const exportBtn = document.getElementById('owned-export-btn');
    if (exportBtn) {
        exportBtn.addEventListener('click', async () => {
            const data = loadOwnedAssets();
            try {
                const res = await fetch('/api/portfolio/export', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ portfolio: data })
                });
                const json = await res.json();
                if (json.filename) {
                    exportBtn.textContent = `✓ ${json.filename}`;
                    setTimeout(() => { exportBtn.textContent = '↓ Export'; }, 3000);
                }
            } catch {
                // fallback client-side
                const json = JSON.stringify(data, null, 2);
                const blob = new Blob([json], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = `portefeuille-${new Date().toISOString().slice(0, 10)}.json`;
                a.click(); URL.revokeObjectURL(url);
            }
        });
    }

    const densityBtn = document.getElementById('owned-density-btn');
    if (densityBtn) {
        densityBtn.addEventListener('click', () => {
            state.ownedCompact = !state.ownedCompact;
            localStorage.setItem(STORAGE_KEYS.ownedCompact, state.ownedCompact ? '1' : '0');
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
    if (importConfirm) {
        importConfirm.addEventListener('click', async () => {
            const selected = importModal?.querySelector('.owned-import-file-item--selected');
            if (!selected) return;
            const filename = selected.dataset.filename;
            try {
                const res = await fetch('/api/portfolio/import', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filename })
                });
                const json = await res.json();
                if (json.portfolio) {
                    const existing = loadOwnedAssets();
                    let added = 0;
                    for (const [id, asset] of Object.entries(json.portfolio)) {
                        if (!existing[id]) { existing[id] = asset; added++; }
                    }
                    localStorage.setItem('investissementWebOwnedAssets', JSON.stringify(existing));
                    importModal.hidden = true;
                    renderOwnedPortfolioList();
                    importConfirm.textContent = added > 0
                        ? `✓ ${added} bien(s) importé(s)`
                        : '⚠ Tous les biens sont déjà présents';
                    if (added > 0) setTimeout(() => { importConfirm.textContent = 'Importer'; }, 3000);
                }
            } catch (err) {
                console.error('Import error', err);
            }
        });
    }

    if (nodes.ownedAddBtn) {
        nodes.ownedAddBtn.addEventListener('click', openOwnedAddModal);
    }
    if (nodes.ownedAddCancel) {
        nodes.ownedAddCancel.addEventListener('click', closeOwnedAddModal);
    }
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
    if (nodes.ownedBackBtn) {
        nodes.ownedBackBtn.addEventListener('click', closeOwnedDetail);
    }
    if (nodes.ownedDiagnosticBtn) {
        nodes.ownedDiagnosticBtn.addEventListener('click', () => {
            const id = state.activeOwnedAssetId;
            if (id) callOwnedDiagnosticIA(id);
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
        } else if (action === 'analyse-loyer-marche' && id) {
            const assetForLoyer = getOwnedAsset(id);
            if (!assetForLoyer?.ville) return;
            const acqForLoyer = assetForLoyer.acquisition || {};
            if (!acqForLoyer.surface) { showToast('Renseignez la surface dans l\'accordéon Acquisition'); return; }

            const _fetchLoyerMarche = () => fetch('/api/loyer-marche', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ville: assetForLoyer.ville,
                    type_bien: acqForLoyer.typeBien || 'appartement',
                    surface: acqForLoyer.surface
                })
            }).then(r => r.json());

            if (btn.dataset.loyerState === 'no-data') {
                // État B → C : lancer le refresh
                if (!assetForLoyer.codePostal) {
                    showToast('Renseignez le code postal dans l\'accordéon Acquisition');
                    return;
                }
                btn.disabled = true;
                btn.textContent = '⏳ Récupération…';
                fetch('/api/loyer-marche/refresh', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        ville: assetForLoyer.ville,
                        code_postal: assetForLoyer.codePostal,
                        type_bien: acqForLoyer.typeBien || 'appartement'
                    })
                }).then(r => r.json()).then(data => {
                    if (data.error) {
                        showToast(`Erreur lors de la récupération : ${data.error}`, 'negative');
                        btn.disabled = false;
                        btn.dataset.loyerState = 'no-data';
                        btn.textContent = `📡 Récupérer pour ${assetForLoyer.ville}`;
                        return;
                    }
                    return _fetchLoyerMarche().then(d => {
                        btn.disabled = false;
                        delete btn.dataset.loyerState;
                        if (d.error) {
                            showToast(`Aucune annonce de location trouvée pour ${assetForLoyer.ville}`, 'neutral');
                            btn.textContent = `📡 Récupérer pour ${assetForLoyer.ville}`;
                            btn.dataset.loyerState = 'no-data';
                        } else {
                            updateOwnedAsset(id, { loyerMarche: { loyerMedian: d.loyerMedian, nbSamples: d.nbSamples } });
                            renderOwnedSynthese(getOwnedAsset(id));
                        }
                    });
                }).catch(() => {
                    showToast('Erreur réseau lors de la récupération', 'negative');
                    btn.disabled = false;
                    btn.dataset.loyerState = 'no-data';
                    btn.textContent = `📡 Récupérer pour ${assetForLoyer.ville}`;
                });
            } else {
                // État A : tentative normale
                btn.disabled = true;
                btn.textContent = '…';
                _fetchLoyerMarche().then(data => {
                    btn.disabled = false;
                    if (data.error) {
                        btn.dataset.loyerState = 'no-data';
                        btn.textContent = `📡 Récupérer pour ${assetForLoyer.ville}`;
                    } else {
                        delete btn.dataset.loyerState;
                        updateOwnedAsset(id, { loyerMarche: { loyerMedian: data.loyerMedian, nbSamples: data.nbSamples } });
                        renderOwnedSynthese(getOwnedAsset(id));
                    }
                }).catch(() => { btn.disabled = false; btn.textContent = '📈 Loyer marché'; });
            }
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

async function openOwnedImportModal() {
    const modal = document.getElementById('owned-import-modal');
    const list = document.getElementById('owned-import-file-list');
    const confirm = document.getElementById('owned-import-modal-confirm');
    if (!modal || !list) return;
    list.innerHTML = '<div class="owned-import-empty">Chargement…</div>';
    if (confirm) confirm.disabled = true;
    modal.hidden = false;
    try {
        const res = await fetch('/api/portfolio/import/list');
        const { files } = await res.json();
        if (!files || !files.length) {
            list.innerHTML = '<div class="owned-import-empty">Aucun fichier dans le dossier exports/.</div>';
            return;
        }
        list.innerHTML = files.map(f => `
            <div class="owned-import-file-item" data-filename="${escapeHtml(f)}">
                <span class="owned-import-file-item__name">${escapeHtml(f)}</span>
            </div>`).join('');
        list.querySelectorAll('.owned-import-file-item').forEach(item => {
            item.addEventListener('click', () => {
                list.querySelectorAll('.owned-import-file-item').forEach(i => i.classList.remove('owned-import-file-item--selected'));
                item.classList.add('owned-import-file-item--selected');
                if (confirm) confirm.disabled = false;
            });
        });
    } catch {
        list.innerHTML = '<div class="owned-import-empty">Erreur lors du chargement des fichiers.</div>';
    }
}

function getOwnedTmi() {
    return calculateTMI(state.profileData.income || 0, {
        adults: state.profileData.adults || 2,
        children: state.profileData.children || 0
    });
}

function getOwnedRegime() {
    return state.ownedRegime || 'micro-foncier';
}

function setOwnedRegime(regime) {
    state.ownedRegime = regime;
    localStorage.setItem('investissementWebOwnedRegime', regime);
}

function getOwnedDefaultScenario(asset) {
    return asset.scenarios.find(s => s.id === 'realiste') || asset.scenarios[0] || { variables: {} };
}

function renderOwnedRegimeSelector() {
    const current = getOwnedRegime();
    const options = [
        { value: 'micro-foncier', label: 'Micro-foncier' },
        { value: 'reel', label: 'Réel' },
        { value: 'sci-is', label: 'SCI-IS' },
    ];
    const sliderHtml = `<div class="owned-regime-slider" id="owned-regime-slider">${options.map(o => `<button class="owned-regime-slider__btn${o.value === current ? ' owned-regime-slider__btn--active' : ''}" data-regime="${o.value}" type="button">${o.label}</button>`).join('')}</div>`;
    const existing = document.getElementById('owned-regime-slider');
    const anchor = document.getElementById('owned-regime-slider-anchor');
    if (existing) {
        existing.outerHTML = sliderHtml;
    } else if (anchor) {
        anchor.insertAdjacentHTML('afterend', sliderHtml);
    } else {
        nodes.ownedKpiBanner?.insertAdjacentHTML('beforebegin', sliderHtml);
    }
    document.getElementById('owned-regime-slider')?.querySelectorAll('[data-regime]').forEach(btn => {
        btn.addEventListener('click', () => {
            setOwnedRegime(btn.dataset.regime);
            renderOwnedPortfolioList();
            if (state.activeOwnedAssetId) {
                const fresh = getOwnedAsset(state.activeOwnedAssetId);
                if (fresh) { renderOwnedSynthese(fresh); renderOwnedCharts(fresh); }
            }
        });
    });
}

function renderOwnedDonutSVG(recettes, depenses, positive) {
    const R = 18, cx = 22, cy = 22, strokeW = 5, ringR = 20;
    const total = recettes + depenses;
    if (total <= 0) return '<div class="owned-donut-wrap"></div>';
    const circ = 2 * Math.PI * R;
    const recPct = recettes / total;
    const depPct = depenses / total;
    const recLen = recPct * circ;
    const depLen = depPct * circ;
    const gap = Math.min(1.5, circ * 0.02);
    const ringColor = positive ? '#22c55e' : '#ef4444';
    const ringCirc = 2 * Math.PI * ringR;
    return `<div class="owned-donut-wrap">
        <svg class="owned-donut-svg" width="44" height="44" viewBox="0 0 44 44">
            <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="var(--border)" stroke-width="${strokeW}"/>
            <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="#22c55e" stroke-width="${strokeW}"
                stroke-dasharray="${recLen - gap} ${circ - recLen + gap}"
                stroke-dashoffset="${circ / 4}" stroke-linecap="round"/>
            <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="#ef4444" stroke-width="${strokeW}"
                stroke-dasharray="${depLen - gap} ${circ - depLen + gap}"
                stroke-dashoffset="${circ / 4 - recLen}" stroke-linecap="round"/>
            <circle cx="${cx}" cy="${cy}" r="${ringR}" fill="none" stroke="${ringColor}" stroke-width="2.5"
                stroke-dasharray="${ringCirc * 0.92} ${ringCirc * 0.08}"
                stroke-dashoffset="${ringCirc / 4}" opacity="0.5"/>
        </svg>
    </div>`;
}

function getOrderedAssetList() {
    const assets = loadOwnedAssets();
    const list = Object.values(assets);
    const order = state.ownedOrder || [];
    if (!order.length) return list;
    const orderMap = Object.fromEntries(order.map((id, i) => [id, i]));
    return [...list].sort((a, b) => {
        const ia = orderMap[a.id] ?? Infinity;
        const ib = orderMap[b.id] ?? Infinity;
        return ia - ib;
    });
}

function renderOwnedPortfolioList() {
    if (!nodes.ownedListView || !nodes.ownedDetailView) return;

    const list = getOrderedAssetList();
    const tmi = getOwnedTmi();
    const regime = getOwnedRegime();
    renderOwnedRegimeSelector();

    if (nodes.ownedKpiBanner) {
        if (!list.length) {
            nodes.ownedKpiBanner.innerHTML = '';
        } else {
            const results = list.map(a => {
                const sc = getOwnedDefaultScenario(a);
                return computeOwnedAssetCF(a, sc.variables, tmi, regime);
            });
            const totalCF = results.reduce((s, r) => s + r.cfNetNet, 0);
            const totalInvest = list.reduce((s, a) =>
                s + (a.acquisition?.prix || 0) + (a.acquisition?.fraisAgence || 0) + (a.acquisition?.fraisNotaire || 0), 0);
            const avgRdt = totalInvest > 0
                ? results.reduce((s, r, i) => {
                    const invest = (list[i].acquisition?.prix || 0) + (list[i].acquisition?.fraisAgence || 0) + (list[i].acquisition?.fraisNotaire || 0);
                    return s + r.rentaBrute * invest;
                }, 0) / totalInvest
                : 0;
            const cfTone = totalCF >= 0 ? 'positive' : 'negative';
            nodes.ownedKpiBanner.innerHTML = `
                <div class="owned-kpi-card">
                    <span class="owned-kpi-card__label">CF net-net / mois</span>
                    <span class="owned-kpi-card__value owned-kpi-card__value--${cfTone}">
                        ${totalCF >= 0 ? '+' : ''}${Math.round(totalCF).toLocaleString('fr-FR')} €
                    </span>
                </div>
                <div class="owned-kpi-card">
                    <span class="owned-kpi-card__label">Rendement brut moy.</span>
                    <span class="owned-kpi-card__value">${avgRdt.toFixed(1).replace('.', ',')} %</span>
                </div>
                <div class="owned-kpi-card">
                    <span class="owned-kpi-card__label">Biens détenus</span>
                    <span class="owned-kpi-card__value">${list.length}</span>
                </div>
            `;
        }
    }

    if (nodes.ownedListTable) {
        const densityBtn = document.getElementById('owned-density-btn');
        if (densityBtn) densityBtn.textContent = state.ownedCompact ? '⊞ Complet' : '≡ Compact';
        nodes.ownedListTable.classList.toggle('owned-list-table--compact', !!state.ownedCompact);

        if (!list.length) {
            nodes.ownedListTable.innerHTML = `
                <div class="owned-empty-state">
                    <p>Aucun bien enregistré dans le portefeuille.</p>
                    <button class="btn btn--primary" id="owned-empty-add-btn" type="button">+ Ajouter mon premier bien</button>
                </div>
            `;
            nodes.ownedListTable.querySelector('#owned-empty-add-btn')?.addEventListener('click', () => {
                openOwnedAddModal();
            });
        } else {
            const yr = state.ownedYearFilter || 1;
            const YEAR_OPTIONS = [1, 3, 5, 10];
            const yearSelectorHtml = `
                <div class="owned-year-selector">
                    <span class="owned-year-selector__label">Métriques en</span>
                    <div class="owned-year-selector__btns">
                        ${YEAR_OPTIONS.map(y => `<button class="owned-year-btn${y === yr ? ' owned-year-btn--active' : ''}" data-year="${y}">An ${y}</button>`).join('')}
                    </div>
                </div>`;

            nodes.ownedListTable.innerHTML = yearSelectorHtml + `
                <table>
                    <thead>
                        <tr>
                            <th class="owned-col-drag"></th>
                            <th></th>
                            <th>Bien</th>
                            <th style="text-align:right">CF net/mois</th>
                            <th style="text-align:right" class="owned-col-hideable">Rdt brut</th>
                            <th style="text-align:right" class="owned-col-hideable">DSCR</th>
                            <th>Statut</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        ${list.map(asset => {
                            // Métriques selon l'année sélectionnée
                            const { years: timeline } = computeOwnedAssetTimeline(asset, tmi, regime);
                            const anneeAchat = asset.anneeAchat || new Date().getFullYear();
                            const targetAbsYear = anneeAchat + yr - 1;
                            const yearRow = timeline.find(y => y.year === targetAbsYear) || timeline[timeline.length - 1];
                            const cfAnnuel = yearRow ? yearRow.cfAnnuel : 0;
                            const cfMens = cfAnnuel / 12;

                            const sc = getOwnedDefaultScenario(asset);
                            const r = computeOwnedAssetCF(asset, sc.variables, tmi, regime);
                            const cfTone = cfMens >= 0 ? 'positive' : 'negative';

                            // Alerte régime : comparer régime optimal an 1 vs an 5
                            const cmp = computeRegimeComparison(asset, tmi, [1, 5]);
                            const optAn1 = cmp.optimal[1];
                            const optAn5 = cmp.optimal[5];
                            const regimeAlertHtml = (optAn1 && optAn5 && optAn1 !== optAn5)
                                ? `<span class="owned-regime-alert" title="Régime optimal change en an 5">⚠ Régime an 5</span>`
                                : '';

                            // Donut inline SVG
                            const recettes = Math.max(0, (asset.acquisition?.loyerInitial || 0) * 12 * (1 - (asset.postAchat?.vacance ?? 5) / 100));
                            const depenses = Math.max(0, recettes - cfAnnuel);
                            const total = recettes + depenses;
                            const donutHtml = total > 0 ? renderOwnedDonutSVG(recettes, depenses, cfMens >= 0) : '<div class="owned-donut-wrap"></div>';

                            const hasUnclassified = (asset.postAchat?.travaux || []).some(t => t.tag === 'a-classifier');
                            let statusTone, statusLabel;
                            if (cfMens < -50) {
                                statusTone = 'negative'; statusLabel = `CF ${Math.round(cfMens).toLocaleString('fr-FR')} €`;
                            } else if (r.dscr > 0 && r.dscr < 1) {
                                statusTone = 'negative'; statusLabel = `DSCR ${r.dscr.toFixed(2).replace('.', ',')}`;
                            } else if (r.dscr >= 1 && r.dscr < 1.1) {
                                statusTone = 'watch'; statusLabel = 'DSCR tendu';
                            } else if (hasUnclassified) {
                                statusTone = 'watch'; statusLabel = '⚠ Travaux';
                            } else {
                                statusTone = 'ras'; statusLabel = 'RAS';
                            }
                            return `
                            <tr data-asset-id="${escapeHtml(asset.id)}" draggable="true">
                                <td class="owned-col-drag owned-drag-handle" title="Glisser pour réordonner">⠿</td>
                                <td style="padding:6px 4px 6px 0;width:52px">${donutHtml}</td>
                                <td>
                                    <div class="owned-table-name">${escapeHtml(asset.nom)}</div>
                                    <div class="owned-table-meta">${escapeHtml(asset.ville)}${asset.anneeAchat ? ` · ${asset.anneeAchat}` : ''}${regimeAlertHtml ? ' ' + regimeAlertHtml : ''}</div>
                                </td>
                                <td class="owned-table-num owned-table-num--${cfTone}">
                                    ${cfMens >= 0 ? '+' : ''}${Math.round(cfMens).toLocaleString('fr-FR')} €
                                </td>
                                <td class="owned-table-num owned-col-hideable">${r.rentaBrute.toFixed(1).replace('.', ',')} %</td>
                                <td class="owned-table-num owned-col-hideable">${r.dscr.toFixed(2).replace('.', ',')}</td>
                                <td>
                                    <span class="owned-status-badge owned-status-badge--${statusTone}">
                                        ${statusLabel}
                                    </span>
                                </td>
                                <td>
                                    <button class="btn btn--ghost btn--sm" data-action="delete-owned" data-id="${escapeHtml(asset.id)}" title="Supprimer">✕</button>
                                </td>
                            </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            `;

            // Year selector events
            nodes.ownedListTable.querySelectorAll('.owned-year-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    state.ownedYearFilter = Number(btn.dataset.year);
                    renderOwnedPortfolioList();
                });
            });

            nodes.ownedListTable.querySelectorAll('tr[data-asset-id]').forEach(row => {
                row.addEventListener('click', e => {
                    if (e.target.closest('[data-action]') || e.target.closest('.owned-year-btn')) return;
                    openOwnedDetail(row.dataset.assetId);
                });
            });

            nodes.ownedListTable.querySelectorAll('[data-action="delete-owned"]').forEach(btn => {
                btn.addEventListener('click', e => {
                    e.stopPropagation();
                    openOwnedDeleteModal(btn.dataset.id);
                });
            });

            // Drag-to-reorder
            (() => {
                let _dragSrcId = null;
                nodes.ownedListTable.querySelectorAll('tr[data-asset-id]').forEach(tr => {
                    tr.addEventListener('dragstart', e => {
                        _dragSrcId = tr.dataset.assetId;
                        tr.classList.add('owned-row--dragging');
                        e.dataTransfer.effectAllowed = 'move';
                    });
                    tr.addEventListener('dragend', () => {
                        tr.classList.remove('owned-row--dragging');
                        nodes.ownedListTable.querySelectorAll('.owned-row--dragover').forEach(r => r.classList.remove('owned-row--dragover'));
                    });
                    tr.addEventListener('dragover', e => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        nodes.ownedListTable.querySelectorAll('.owned-row--dragover').forEach(r => r.classList.remove('owned-row--dragover'));
                        if (tr.dataset.assetId !== _dragSrcId) tr.classList.add('owned-row--dragover');
                    });
                    tr.addEventListener('drop', e => {
                        e.preventDefault();
                        const targetId = tr.dataset.assetId;
                        if (!_dragSrcId || _dragSrcId === targetId) return;
                        const currentList = getOrderedAssetList();
                        const ids = currentList.map(a => a.id);
                        const fromIdx = ids.indexOf(_dragSrcId);
                        const toIdx = ids.indexOf(targetId);
                        if (fromIdx < 0 || toIdx < 0) return;
                        ids.splice(fromIdx, 1);
                        ids.splice(toIdx, 0, _dragSrcId);
                        state.ownedOrder = ids;
                        localStorage.setItem(STORAGE_KEYS.ownedOrder, JSON.stringify(ids));
                        renderOwnedPortfolioList();
                    });
                });
            })();
        }
    }
    renderOwnedPortfolioCharts(list, tmi, regime);
    renderOwnedDashboard(list, tmi, regime);
    renderOwnedCfConsolidatedSection(list, tmi, regime);
}

function renderOwnedCfConsolidatedSection(list, tmi, regime) {
    const wrap = document.getElementById('owned-portfolio-cf-consolidated');
    if (!wrap) return;
    if (!list.length) { wrap.innerHTML = ''; return; }

    const YEARS = 20;
    const currentYear = new Date().getFullYear();
    const labels = Array.from({ length: YEARS }, (_, i) => currentYear + i);

    // Sum cfAnnuel per year across all assets
    const yearlyCf = labels.map(yr => {
        return list.reduce((sum, asset) => {
            const { years } = computeOwnedAssetTimeline(asset, tmi, regime);
            const entry = years.find(y => y.year === yr);
            if (entry) return sum + entry.cfAnnuel;
            const last = years[years.length - 1];
            return sum + (last ? last.cfAnnuel : 0);
        }, 0);
    });
    let cumSum = 0;
    const cumValues = yearlyCf.map(v => { cumSum += v; return cumSum; });

    const width = 760; const height = 200;
    const pad = { top: 16, right: 16, bottom: 32, left: 60 };
    const pw = width - pad.left - pad.right;
    const ph = height - pad.top - pad.bottom;
    const minV = Math.min(0, ...cumValues);
    const maxV = Math.max(0, ...cumValues);
    const range = Math.max(1, maxV - minV);
    const ticks = Array.from({ length: 4 }, (_, i) => maxV - (range / 3) * i);
    const xFor = i => pad.left + (YEARS <= 1 ? pw / 2 : (pw * i) / (YEARS - 1));
    const yFor = v => pad.top + ((maxV - v) / range) * ph;
    const pts = cumValues.map((v, i) => ({ x: xFor(i), y: yFor(v) }));
    const pathD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
    const fillD = `${pathD} L${pts[pts.length-1].x.toFixed(1)} ${(pad.top+ph).toFixed(1)} L${pad.left} ${(pad.top+ph).toFixed(1)} Z`;
    const finalCum = cumValues[YEARS - 1] || 0;

    wrap.innerHTML = `
        <div class="owned-dashboard-cf-chart-wrap">
            <div class="owned-dashboard-chart-title">CF net cumulé — portefeuille entier (${list.length} bien${list.length > 1 ? 's' : ''})</div>
            <div class="owned-dashboard-chart-meta">
                <span>Horizon : 20 ans</span>
                <span>Fin : <strong class="${finalCum >= 0 ? 'value-positive' : 'value-negative'}">${formatSignedCurrency(finalCum)}</strong></span>
            </div>
            <svg viewBox="0 0 ${width} ${height}" class="owned-cf-svg" aria-label="CF net cumulé du portefeuille">
                ${ticks.map(v => `
                    <line class="owned-cf-grid-line" x1="${pad.left}" y1="${yFor(v).toFixed(1)}" x2="${width-pad.right}" y2="${yFor(v).toFixed(1)}"></line>
                    <text class="owned-cf-axis-text" x="${pad.left - 6}" y="${(yFor(v)+4).toFixed(1)}" text-anchor="end">${formatCompactCurrency(v)}</text>
                `).join('')}
                ${(minV < 0 && maxV > 0) ? `<line class="owned-cf-zero-line" x1="${pad.left}" y1="${yFor(0).toFixed(1)}" x2="${width-pad.right}" y2="${yFor(0).toFixed(1)}"></line>` : ''}
                ${labels.filter((_, i) => i % 4 === 0 || i === YEARS - 1).map((yr, _, __, i = labels.indexOf(yr)) => `
                    <text class="owned-cf-axis-text" x="${xFor(i).toFixed(1)}" y="${height - 6}" text-anchor="middle">${yr}</text>
                `).join('')}
                <path class="owned-cf-fill" d="${fillD}"></path>
                <path class="owned-cf-path" d="${pathD}"></path>
                ${pts.filter((_, i) => i % 4 === 0 || i === YEARS - 1).map(p => `<circle class="owned-cf-dot" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5"></circle>`).join('')}
            </svg>
        </div>
        ${renderOwnedRepartitionBarHTML(list, tmi, regime)}
    `;
}

function renderOwnedRepartitionBarHTML(list, tmi, regime) {
    const cfs = list.map(asset => {
        const sc = getOwnedDefaultScenario(asset);
        const r = computeOwnedAssetCF(asset, sc.variables, tmi, regime);
        return { name: asset.nom, cf: r.cfNetNet };
    });
    const totalAbs = cfs.reduce((s, c) => s + Math.abs(c.cf), 0);
    if (!totalAbs) return '';
    const COLORS_POS = ['#2DA44E','#3FB950','#56D364','#7EE787'];
    const COLORS_NEG = ['#CF222E','#F85149','#FF6B6B','#FFA8A8'];
    let pi = 0; let ni = 0;
    const segs = cfs.map(c => ({
        name: c.name, cf: c.cf,
        w: (Math.abs(c.cf) / totalAbs * 100).toFixed(1),
        color: c.cf >= 0 ? COLORS_POS[pi++ % 4] : COLORS_NEG[ni++ % 4],
        pos: c.cf >= 0
    }));
    return `
        <div class="owned-repartition-bar-wrap">
            <div class="owned-dashboard-chart-title">Répartition du CF par bien</div>
            <div class="owned-repartition-bar">${segs.map(s => `<div class="owned-repartition-segment" style="width:${s.w}%;background:${s.color}" title="${escapeHtml(s.name)} : ${formatSignedCurrency(s.cf)}/mois"></div>`).join('')}</div>
            <div class="owned-repartition-legend">${segs.map(s => `<span class="owned-repartition-legend-item"><span class="owned-repartition-swatch" style="background:${s.color}"></span><span>${escapeHtml(s.name)}</span><strong class="${s.pos ? 'value-positive' : 'value-negative'}">${formatSignedCurrency(s.cf)}</strong></span>`).join('')}</div>
        </div>
    `;
}

function openOwnedAddModal() {
    if (!nodes.ownedAddModal) return;
    nodes.ownedAddModal.hidden = false;
    nodes.ownedAddNom?.focus();
}

function closeOwnedAddModal() {
    if (!nodes.ownedAddModal) return;
    nodes.ownedAddModal.hidden = true;
    nodes.ownedAddForm?.reset();
}

function openOwnedDeleteModal(assetId) {
    const asset = getOwnedAsset(assetId);
    if (!asset || !nodes.ownedDeleteModal) return;
    nodes.ownedDeleteModal._pendingId = assetId;
    if (nodes.ownedDeleteModalName) nodes.ownedDeleteModalName.textContent = asset.nom || assetId;
    if (nodes.ownedDeleteModalInput) nodes.ownedDeleteModalInput.value = '';
    if (nodes.ownedDeleteModalConfirm) nodes.ownedDeleteModalConfirm.disabled = true;
    nodes.ownedDeleteModal.hidden = false;
    nodes.ownedDeleteModalInput?.focus();
}

function closeOwnedDeleteModal() {
    if (!nodes.ownedDeleteModal) return;
    nodes.ownedDeleteModal.hidden = true;
    nodes.ownedDeleteModal._pendingId = null;
    if (nodes.ownedDeleteModalInput) nodes.ownedDeleteModalInput.value = '';
}

function openOwnedDetail(assetId) {
    state._listScrollY = window.scrollY;
    state.activeOwnedAssetId = assetId;
    // Initialiser chargesAnnuelles si vide à partir des valeurs plates existantes
    const _a = getOwnedAsset(assetId);
    if (_a) {
        const post = _a.postAchat || {};
        if (!post.chargesAnnuelles || post.chargesAnnuelles.length === 0) {
            const annee = _a.anneeAchat || new Date().getFullYear();
            if ((post.taxeFonciere ?? 0) > 0 || (post.gestionLocative ?? 0) > 0 || (post.assurancePNO ?? 0) > 0 || (post.chargesCopro ?? 0) > 0) {
                addOwnedChargesAnnuelles(assetId, {
                    annee,
                    taxeFonciere: post.taxeFonciere ?? 0,
                    gestionLocative: post.gestionLocative ?? 0,
                    assurancePNO: post.assurancePNO ?? 0,
                    chargesCopro: post.chargesCopro ?? 0,
                });
            }
        }
    }
    nodes.ownedListView.hidden = true;
    nodes.ownedDetailView.hidden = false;
    renderOwnedDetail();
}

function closeOwnedDetail() {
    state.activeOwnedAssetId = null;
    const navEl = document.getElementById('owned-detail-nav');
    if (navEl) navEl.remove();
    nodes.ownedDetailView.hidden = true;
    nodes.ownedListView.hidden = false;
    renderOwnedPortfolioList();
    requestAnimationFrame(() => {
        window.scrollTo({ top: state._listScrollY || 0, behavior: 'instant' });
    });
}

function renderOwnedProjectionContent(asset) {
    const el = document.getElementById('owned-projection-content');
    if (!el) return;
    const hasData = (asset.acquisition?.prix || 0) > 0;
    if (!hasData) { el.innerHTML = ''; return; }
    const tmi = getOwnedTmi();
    const cmp = computeRegimeComparison(asset, tmi);
    el.innerHTML = renderRegimeComparisonHTML(cmp);
}

function renderOwnedDetail() {
    const assetId = state.activeOwnedAssetId;
    if (!assetId) return;
    const asset = getOwnedAsset(assetId);
    if (!asset) { closeOwnedDetail(); return; }

    if (nodes.ownedDetailTitle) {
        nodes.ownedDetailTitle.innerHTML = `
            <div class="owned-detail-title__name"
                 contenteditable="true"
                 data-rename-asset="${escapeHtml(asset.id)}"
                 spellcheck="false"
                 title="Cliquer pour renommer">${escapeHtml(asset.nom)}</div>
            <div class="owned-detail-title__meta">${escapeHtml(asset.ville)}${asset.anneeAchat ? ` · Acquis ${asset.anneeAchat}` : ''}</div>
        `;
        const nameEl = nodes.ownedDetailTitle.querySelector('[data-rename-asset]');
        if (nameEl && !nameEl.dataset.renameWired) {
            nameEl.dataset.renameWired = '1';
            const originalName = asset.nom;
            let _escaping = false;
            nameEl.addEventListener('blur', () => {
                if (_escaping) { _escaping = false; return; }
                const newName = nameEl.textContent.trim();
                if (!newName) { nameEl.textContent = originalName; return; }
                if (newName === originalName) return;
                updateOwnedAsset(asset.id, { nom: newName });
                renderOwnedPortfolioList();
            });
            nameEl.addEventListener('keydown', e => {
                if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); }
                if (e.key === 'Escape') { _escaping = true; nameEl.textContent = originalName; nameEl.blur(); }
            });
        }
    }

    // Navigation prev/next
    const orderedList = getOrderedAssetList();
    const currentIdx = orderedList.findIndex(a => a.id === assetId);
    const prevAsset = currentIdx > 0 ? orderedList[currentIdx - 1] : null;
    const nextAsset = currentIdx < orderedList.length - 1 ? orderedList[currentIdx + 1] : null;

    let navEl = document.getElementById('owned-detail-nav');
    if (!navEl) {
        navEl = document.createElement('div');
        navEl.id = 'owned-detail-nav';
        navEl.className = 'owned-detail-nav';
        const header = document.querySelector('.owned-detail-header');
        if (header) header.insertBefore(navEl, header.querySelector('#owned-back-btn').nextSibling);
    }
    navEl.innerHTML = `
        <button class="btn btn--ghost btn--sm owned-nav-btn"
                data-nav-asset="${prevAsset ? escapeHtml(prevAsset.id) : ''}"
                ${!prevAsset ? 'disabled' : ''}
                title="${prevAsset ? escapeHtml(prevAsset.nom) : ''}">‹</button>
        <span class="owned-nav-pos">${currentIdx + 1} / ${orderedList.length}</span>
        <button class="btn btn--ghost btn--sm owned-nav-btn"
                data-nav-asset="${nextAsset ? escapeHtml(nextAsset.id) : ''}"
                ${!nextAsset ? 'disabled' : ''}
                title="${nextAsset ? escapeHtml(nextAsset.nom) : ''}">›</button>
    `;
    if (!navEl.dataset.navWired) {
        navEl.dataset.navWired = '1';
        navEl.addEventListener('click', e => {
            const btn = e.target.closest('[data-nav-asset]');
            if (!btn || btn.disabled || !btn.dataset.navAsset) return;
            openOwnedDetail(btn.dataset.navAsset);
        });
    }

    if (nodes.ownedDiagnosticBtn) {
        const hasData = (asset.acquisition?.prix || 0) > 0;
        nodes.ownedDiagnosticBtn.hidden = !hasData;
        nodes.ownedDiagnosticBtn.disabled = !hasData;
    }

    renderOwnedRegimeSelector();
    renderOwnedSynthese(asset);
    renderOwnedVerdictBlock(asset);
    renderOwnedCharts(asset);
    renderOwnedCrdChart(asset);
    renderAccordionAcquisition(asset);
    renderAccordionPostAchat(asset);
    renderAccordionSimulateur(asset);
    renderOwnedCfTable(asset);
    renderOwnedProjectionContent(asset);
    renderOwnedTravauxTab(asset);

    const detail = nodes.ownedDetailView;
    if (detail && !detail.dataset.tabWired) {
        detail.dataset.tabWired = '1';
        detail.addEventListener('click', e => {
            const btn = e.target.closest('.owned-tab');
            if (!btn) return;
            const tabKey = btn.dataset.tab;
            detail.querySelectorAll('.owned-tab').forEach(t => {
                t.classList.toggle('owned-tab--active', t === btn);
                t.setAttribute('aria-selected', t === btn ? 'true' : 'false');
            });
            detail.querySelectorAll('.owned-tab-panel').forEach(p => {
                p.hidden = p.id !== `owned-tab-${tabKey}`;
            });
        });
    }
}

function renderOwnedVerdictBlock(asset) {
    const el = nodes.ownedVerdict || document.getElementById('owned-verdict');
    if (!el) return;
    const acq = asset.acquisition || {};
    const hasData = (acq.prix || 0) > 0;
    if (!hasData) { el.innerHTML = ''; return; }

    const tmi = getOwnedTmi();
    const regime = getOwnedRegime();
    const anneeAchat = asset.anneeAchat || new Date().getFullYear();
    const defaultYrVerdict = Math.max(1, new Date().getFullYear() - anneeAchat + 1);
    const yr = (state.ownedYearFilters?.[asset.id]) ?? defaultYrVerdict;
    const YEAR_OPTIONS = [1, 3, 5, 10];

    // Métriques selon l'année sélectionnée
    const { years: timeline } = computeOwnedAssetTimeline(asset, tmi, regime);
    const targetAbsYear = anneeAchat + yr - 1;
    const yearRow = timeline.find(y => y.year === targetAbsYear) || timeline[timeline.length - 1];
    const cfAnnuel = yearRow ? yearRow.cfAnnuel : 0;
    const cfNetNet = Math.round(cfAnnuel / 12);

    const sc = getOwnedDefaultScenario(asset);
    const r = computeOwnedAssetCF(asset, sc.variables, tmi, regime);
    const rentaBrute = r.rentaBrute || 0;
    const dscr = r.dscr || 0;
    const effort = Math.max(0, -cfNetNet);

    const cfTone = cfNetNet > 0 ? 'positive' : cfNetNet >= -100 ? 'watch' : 'negative';
    const cfSign = cfNetNet > 0 ? '+' : '';
    const rentaTone = rentaBrute > 6 ? 'positive' : rentaBrute >= 4 ? 'watch' : 'negative';
    const dscrTone = dscr > 1.2 ? 'positive' : dscr >= 1 ? 'watch' : 'negative';
    const effortTone = effort === 0 ? 'positive' : effort < 200 ? 'watch' : 'negative';

    const yearSelectorHtml = `
        <div class="owned-year-selector" style="margin-bottom:8px">
            <span class="owned-year-selector__label">Vue</span>
            <div class="owned-year-selector__btns">
                ${YEAR_OPTIONS.map(y => { const absYear = anneeAchat + y - 1; return `<button class="owned-year-btn${y === yr ? ' owned-year-btn--active' : ''}" data-verdict-year="${y}">An ${y} <span style="font-size:.65em;opacity:.6">${absYear}</span></button>`; }).join('')}
            </div>
        </div>`;

    el.innerHTML = yearSelectorHtml + `
        <div class="owned-verdict__grid">
            <div class="owned-verdict__metric">
                <span class="owned-verdict__label">CF net / mois (an ${yr})</span>
                <span class="owned-verdict__value owned-verdict__value--${cfTone}">${cfSign}${cfNetNet.toLocaleString('fr-FR')} €</span>
            </div>
            <div class="owned-verdict__metric">
                <span class="owned-verdict__label">Rendement brut</span>
                <span class="owned-verdict__value owned-verdict__value--${rentaTone}">${rentaBrute.toFixed(1)} %</span>
            </div>
            <div class="owned-verdict__metric">
                <span class="owned-verdict__label">DSCR</span>
                <span class="owned-verdict__value owned-verdict__value--${dscrTone}">${dscr.toFixed(2)}</span>
            </div>
            <div class="owned-verdict__metric">
                <span class="owned-verdict__label">Effort épargne (an ${yr})</span>
                <span class="owned-verdict__value owned-verdict__value--${effortTone}">${effort.toLocaleString('fr-FR')} €/mois</span>
            </div>
        </div>
    `;

    el.querySelectorAll('[data-verdict-year]').forEach(btn => {
        btn.addEventListener('click', () => {
            state.ownedYearFilters = { ...(state.ownedYearFilters || {}), [asset.id]: Number(btn.dataset.verdictYear) };
            localStorage.setItem('investissementWebOwnedYearFilters', JSON.stringify(state.ownedYearFilters));
            renderOwnedVerdictBlock(asset);
            const freshPost = getOwnedAsset(asset.id);
            if (freshPost) renderAccordionPostAchat(freshPost);
        });
    });
}

function renderOwnedCfTable(asset) {
    const wrap = nodes.ownedCfTableWrap || document.getElementById('owned-cf-table-wrap');
    if (!wrap) return;
    const acq = asset.acquisition || {};
    const hasData = (acq.prix || 0) > 0;
    if (!hasData) { wrap.innerHTML = ''; return; }

    const tmi = getOwnedTmi();
    const regime = getOwnedRegime();
    const { years } = computeOwnedAssetTimeline(asset, tmi, regime);
    if (!years || !years.length) { wrap.innerHTML = ''; return; }

    const first20 = years.slice(0, 20);
    const rows = first20.map(y => {
        const cf = y.cfAnnuel ?? y.cfNet ?? 0;
        const cfCls = cf >= 0 ? 'positive' : 'negative';
        const cfSign = cf >= 0 ? '+' : '';
        const loyers = Math.round(y.recettesAnnee ?? y.loyers ?? 0);
        const depenses = Math.round(y.depensesAnnee ?? y.charges ?? 0);
        return `<tr>
            <td>${y.year}</td>
            <td>${loyers.toLocaleString('fr-FR')} €</td>
            <td>${depenses.toLocaleString('fr-FR')} €</td>
            <td class="${cfCls}">${cfSign}${Math.round(cf).toLocaleString('fr-FR')} €</td>
            <td style="font-size:.75rem;color:var(--text-tertiary)">${Math.round(y.cumulCF ?? 0).toLocaleString('fr-FR')} €</td>
        </tr>`;
    }).join('');

    wrap.innerHTML = `
        <div class="owned-cf-table">
            <div class="owned-cf-table__title">Flux de trésorerie annuels</div>
            <div class="owned-cf-table__scroll">
                <table>
                    <thead>
                        <tr>
                            <th>Année</th>
                            <th>Recettes</th>
                            <th>Dépenses</th>
                            <th>CF annuel</th>
                            <th>CF cumulé</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        </div>
    `;
}

function renderOwnedTravauxTab(asset) {
    const el = nodes.ownedTravauxContent || document.getElementById('owned-travaux-content');
    if (!el) return;

    const post = asset.postAchat || {};
    const TAG_LABELS = { 'deductible': 'Déductible', 'non-deductible': 'Non déductible', 'a-classifier': 'À classifier' };
    const TAG_CSS = { 'deductible': 'tag--green', 'non-deductible': 'tag--grey', 'a-classifier': 'tag--orange' };

    const currentYear = new Date().getFullYear();
    const sorted = [...(post.travaux || [])].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const totalDed = (post.travaux || [])
        .filter(t => t.tag === 'deductible' && t.date && new Date(t.date).getFullYear() === currentYear)
        .reduce((s, t) => s + t.montant, 0);

    el.innerHTML = `
        <div class="owned-section-title">Travaux</div>
        <div class="owned-travaux-list">
            ${sorted.length ? sorted.map(t => `
                <div class="owned-travaux-row">
                    <span class="owned-travaux-date">${escapeHtml(t.date || '—')}</span>
                    <span class="owned-travaux-desc">${escapeHtml(t.description || '—')}</span>
                    <span class="owned-travaux-montant">${Math.round(t.montant).toLocaleString('fr-FR')} €</span>
                    <span class="tag ${TAG_CSS[t.tag] || 'tag--grey'}">${escapeHtml(TAG_LABELS[t.tag] || t.tag)}</span>
                    <button class="owned-travaux-delete" data-delete-travail-tab="${escapeHtml(t.id)}" title="Supprimer" aria-label="Supprimer">✕</button>
                </div>
            `).join('') : '<p style="font-size:.82rem;color:var(--text-tertiary);font-style:italic">Aucun travail enregistré.</p>'}
        </div>
        ${totalDed > 0 ? `<div class="owned-travaux-totals"><span>Déductible ${currentYear} : <strong>${Math.round(totalDed).toLocaleString('fr-FR')} €</strong></span></div>` : ''}
        <form class="owned-travaux-form" data-form="add-travail-tab" novalidate>
            <input type="date" name="date" class="variables-input" required placeholder="Date" style="flex:0 0 140px">
            <input type="text" name="description" class="variables-input" required placeholder="Description" style="flex:1;min-width:120px">
            <input type="number" name="montant" class="variables-input" required placeholder="Montant €" min="0" style="flex:0 0 100px">
            <select name="tag" class="variables-input" style="flex:0 0 130px">
                <option value="a-classifier">À classifier</option>
                <option value="deductible">Déductible</option>
                <option value="non-deductible">Non déductible</option>
            </select>
            <button type="submit" class="btn btn--primary btn--sm">Ajouter</button>
        </form>
    `;

    el.querySelectorAll('[data-delete-travail-tab]').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = state.activeOwnedAssetId;
            if (!id) return;
            deleteOwnedTravail(id, btn.dataset.deleteTravailTab);
            const fresh = getOwnedAsset(id);
            renderOwnedTravauxTab(fresh);
            renderAccordionPostAchat(fresh);
            renderOwnedSynthese(fresh);
            renderOwnedCharts(fresh);
            renderAccordionSimulateur(fresh);
        });
    });

    el.querySelector('[data-form="add-travail-tab"]')?.addEventListener('submit', e => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const id = state.activeOwnedAssetId;
        if (!id) return;
        addOwnedTravail(id, {
            date: fd.get('date'),
            description: fd.get('description')?.trim(),
            montant: Number(fd.get('montant')),
            tag: fd.get('tag')
        });
        e.target.reset();
        const fresh = getOwnedAsset(id);
        renderOwnedTravauxTab(fresh);
        renderAccordionPostAchat(fresh);
        renderOwnedSynthese(fresh);
        renderOwnedCharts(fresh);
        renderAccordionSimulateur(fresh);
    });
}

let _ownedCfCumChart = null;
let _ownedEcartChart = null;
let _ownedCrdChart = null;
let _ownedPortfolioCfChart = null;
let _ownedPortfolioEcartChart = null;

function renderOwnedCharts(asset) {
    const wrap = document.getElementById('owned-charts-detail');
    if (!wrap) return;

    if (!((asset.acquisition?.prix || 0) > 0)) {
        wrap.hidden = true;
        if (_ownedCfCumChart) { _ownedCfCumChart.destroy(); _ownedCfCumChart = null; }
        if (_ownedEcartChart) { _ownedEcartChart.destroy(); _ownedEcartChart = null; }
        return;
    }

    wrap.hidden = false;
    const tmi = getOwnedTmi();
    const regime = getOwnedRegime();
    const { years } = computeOwnedAssetTimeline(asset, tmi, regime);

    const labels = years.map(y => String(y.year));
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const gold = '#C5A059';
    const green = '#22c55e';
    const red = '#ef4444';
    const textClr = isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.4)';
    const gridClr = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
    const scaleOpts = {
        x: { ticks: { color: textClr, maxRotation: 45, minRotation: 45, font: { family: "'IBM Plex Mono', monospace", size: 10 } }, grid: { color: gridClr } },
        y: { ticks: { color: textClr, callback: v => (Math.abs(v) >= 1000 ? (v/1000).toFixed(0) + 'k' : v) + '€', font: { family: "'IBM Plex Mono', monospace", size: 10 } }, grid: { color: gridClr } }
    };

    if (_ownedCfCumChart) { _ownedCfCumChart.destroy(); _ownedCfCumChart = null; }
    const canvasCF = document.getElementById('owned-cfcum-chart');
    if (canvasCF) {
        _ownedCfCumChart = new Chart(canvasCF, {
            type: 'line',
            data: { labels, datasets: [{ data: years.map(y => Math.round(y.cumulCF)), borderColor: gold, backgroundColor: isDark ? 'rgba(197,160,89,0.08)' : 'rgba(197,160,89,0.13)', borderWidth: 2, pointRadius: 3, pointBackgroundColor: gold, tension: 0.25, fill: true }] },
            options: { responsive: true, plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ctx.parsed.y.toLocaleString('fr-FR') + ' €' } } }, scales: scaleOpts }
        });
    }

    if (_ownedEcartChart) { _ownedEcartChart.destroy(); _ownedEcartChart = null; }
    const canvasEcart = document.getElementById('owned-ecart-chart');
    if (canvasEcart) {
        _ownedEcartChart = new Chart(canvasEcart, {
            type: 'line',
            data: { labels, datasets: [
                { label: 'Recettes', data: years.map(y => Math.round(y.recettesCum)), borderColor: green, backgroundColor: 'rgba(34,197,94,0.06)', borderWidth: 2, pointRadius: 2, tension: 0.25, fill: false },
                { label: 'Dépenses', data: years.map(y => Math.round(y.depensesCum)), borderColor: red, backgroundColor: 'rgba(239,68,68,0.06)', borderWidth: 2, pointRadius: 2, tension: 0.25, fill: false }
            ]},
            options: { responsive: true, plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ctx.dataset.label + ' : ' + ctx.parsed.y.toLocaleString('fr-FR') + ' €' } } }, scales: scaleOpts }
        });
    }
}

function renderOwnedPortfolioCharts(list, tmi, regime) {
    const container = document.getElementById('owned-portfolio-charts');
    if (!container) return;

    if (!list.length) {
        container.hidden = true;
        if (_ownedPortfolioCfChart) { _ownedPortfolioCfChart.destroy(); _ownedPortfolioCfChart = null; }
        if (_ownedPortfolioEcartChart) { _ownedPortfolioEcartChart.destroy(); _ownedPortfolioEcartChart = null; }
        return;
    }

    const currentYear = new Date().getFullYear();
    const allRanges = list.map(a => {
        const anneeAchat = a.anneeAchat || currentYear;
        const duree = a.acquisition?.credit?.duree || 0;
        return { start: anneeAchat, end: Math.max(currentYear + 2, anneeAchat + duree) };
    });
    const globalStart = Math.min(...allRanges.map(r => r.start));
    const globalEnd = Math.max(...allRanges.map(r => r.end));

    const aggCF = {}, aggRec = {}, aggDep = {};
    for (let y = globalStart; y <= globalEnd; y++) { aggCF[y] = 0; aggRec[y] = 0; aggDep[y] = 0; }

    for (const asset of list) {
        const { years } = computeOwnedAssetTimeline(asset, tmi, regime);
        for (const row of years) {
            if (row.year >= globalStart && row.year <= globalEnd) {
                aggCF[row.year] += row.cfAnnuel;
                aggRec[row.year] += row.recettesAnnee;
                aggDep[row.year] += row.depensesAnnee;
            }
        }
    }

    const labels = [], dataCF = [], dataRec = [], dataDep = [];
    let cumCF = 0, cumRec = 0, cumDep = 0;
    for (let y = globalStart; y <= globalEnd; y++) {
        labels.push(String(y));
        cumCF += aggCF[y] || 0; cumRec += aggRec[y] || 0; cumDep += aggDep[y] || 0;
        dataCF.push(Math.round(cumCF)); dataRec.push(Math.round(cumRec)); dataDep.push(Math.round(cumDep));
    }

    container.hidden = false;
    if (!document.getElementById('owned-portfolio-cf-chart')) {
        container.innerHTML = `
            <div class="owned-chart-block">
                <div class="owned-chart-title">CF net cumulé — portefeuille</div>
                <canvas id="owned-portfolio-cf-chart" height="200"></canvas>
            </div>
            <div class="owned-chart-block">
                <div class="owned-chart-title">Recettes vs Dépenses — portefeuille</div>
                <canvas id="owned-portfolio-ecart-chart" height="200"></canvas>
                <div class="owned-chart-legend">
                    <span class="owned-chart-legend__item owned-chart-legend__item--recettes">Recettes</span>
                    <span class="owned-chart-legend__item owned-chart-legend__item--depenses">Dépenses</span>
                    <span class="owned-chart-legend__hint">Consolidé sur tous les biens détenus</span>
                </div>
            </div>`;
    }

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const gold = '#C5A059', green = '#22c55e', red = '#ef4444';
    const textClr = isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.4)';
    const gridClr = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
    const scaleOpts = {
        x: { ticks: { color: textClr, maxRotation: 45, minRotation: 45, font: { family: "'IBM Plex Mono', monospace", size: 10 } }, grid: { color: gridClr } },
        y: { ticks: { color: textClr, callback: v => (Math.abs(v) >= 1000 ? (v/1000).toFixed(0) + 'k' : v) + '€', font: { family: "'IBM Plex Mono', monospace", size: 10 } }, grid: { color: gridClr } }
    };

    if (_ownedPortfolioCfChart) { _ownedPortfolioCfChart.destroy(); _ownedPortfolioCfChart = null; }
    const cvCF = document.getElementById('owned-portfolio-cf-chart');
    if (cvCF) {
        _ownedPortfolioCfChart = new Chart(cvCF, {
            type: 'line',
            data: { labels, datasets: [{ data: dataCF, borderColor: gold, backgroundColor: isDark ? 'rgba(197,160,89,0.08)' : 'rgba(197,160,89,0.13)', borderWidth: 2, pointRadius: 2, tension: 0.25, fill: true }] },
            options: { responsive: true, plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ctx.parsed.y.toLocaleString('fr-FR') + ' €' } } }, scales: scaleOpts }
        });
    }

    if (_ownedPortfolioEcartChart) { _ownedPortfolioEcartChart.destroy(); _ownedPortfolioEcartChart = null; }
    const cvEcart = document.getElementById('owned-portfolio-ecart-chart');
    if (cvEcart) {
        _ownedPortfolioEcartChart = new Chart(cvEcart, {
            type: 'line',
            data: { labels, datasets: [
                { label: 'Recettes', data: dataRec, borderColor: green, borderWidth: 2, pointRadius: 2, tension: 0.25, fill: false },
                { label: 'Dépenses', data: dataDep, borderColor: red, borderWidth: 2, pointRadius: 2, tension: 0.25, fill: false }
            ]},
            options: { responsive: true, plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ctx.dataset.label + ' : ' + ctx.parsed.y.toLocaleString('fr-FR') + ' €' } } }, scales: scaleOpts }
        });
    }
}

function renderOwnedCrdChart(asset) {
    const wrap = document.getElementById('owned-crd-chart-wrap');
    if (!wrap) return;
    if (_ownedCrdChart) { _ownedCrdChart.destroy(); _ownedCrdChart = null; }

    const credit = asset.acquisition?.credit || {};
    const montant = credit.montant || 0;
    const duree = credit.duree || 0;
    const anneeAchat = asset.anneeAchat || new Date().getFullYear();

    if (!montant || !duree) { wrap.hidden = true; return; }
    wrap.hidden = false;

    const { schedule } = computeAmortizationSchedule(montant, credit.taux || 0, duree, anneeAchat);
    const labels = schedule.map(r => String(r.annee));
    const dataCRD = schedule.map(r => r.crdDebut);
    const currentYear = new Date().getFullYear();

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const textClr = isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.4)';
    const gridClr = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
    const canvas = document.getElementById('owned-crd-chart');
    if (!canvas) return;

    _ownedCrdChart = new Chart(canvas, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                data: dataCRD,
                borderColor: '#ef4444',
                backgroundColor: isDark ? 'rgba(239,68,68,0.07)' : 'rgba(239,68,68,0.08)',
                borderWidth: 2,
                pointRadius: 2,
                tension: 0.1,
                fill: true
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: ctx => 'CRD : ' + Math.round(ctx.parsed.y).toLocaleString('fr-FR') + ' €' } }
            },
            scales: {
                x: { ticks: { color: textClr, maxRotation: 45, font: { family: "'IBM Plex Mono', monospace", size: 10 } }, grid: { color: gridClr } },
                y: { ticks: { color: textClr, callback: v => (Math.abs(v) >= 1000 ? (v/1000).toFixed(0) + 'k' : v) + '€', font: { family: "'IBM Plex Mono', monospace", size: 10 } }, grid: { color: gridClr } }
            }
        }
    });
}

function renderOwnedSynthese(asset) {
    if (!nodes.ownedSynthese) return;
    const acq = asset.acquisition || {};
    const credit = acq.credit || {};
    const hasData = (acq.prix || 0) > 0;

    if (!hasData) {
        nodes.ownedSynthese.innerHTML = '';
        return;
    }

    const tmi = getOwnedTmi();
    const sc = getOwnedDefaultScenario(asset);

    // Mensualité crédit calculée
    const montant = credit.montant || 0;
    const nMois = (credit.duree || 0) * 12;
    const tauxM = ((credit.taux || 0) / 100) / 12;
    let mensualiteCredit = 0;
    if (tauxM > 0 && nMois > 0) mensualiteCredit = (montant * tauxM) / (1 - Math.pow(1 + tauxM, -nMois));
    else if (nMois > 0) mensualiteCredit = montant / nMois;
    const assuranceMens = (montant * ((credit.assurance || 0) / 100)) / 12;
    const mensualiteTotale = mensualiteCredit + assuranceMens;
    const investTotal = (acq.prix || 0) + (acq.fraisAgence || 0) + (acq.fraisNotaire || 0);
    const apport = Math.max(0, investTotal - montant);

    // Métriques scénario réaliste — régime global
    const r = computeOwnedAssetCF(asset, sc.variables, tmi, getOwnedRegime());
    const cfAvantTone = r.cfNet >= 0 ? 'positive' : 'negative';
    const cfApresTone = r.cfNetNet >= 0 ? 'positive' : 'negative';
    const dscrTone = r.dscr > 0 && r.dscr < 1 ? 'negative' : r.dscr >= 1.1 ? 'positive' : '';

    // Comparaison défiscalisation : 3 régimes avec les variables du scénario réaliste
    const REGIMES = [
        { key: 'micro-foncier', label: 'Micro-foncier' },
        { key: 'reel', label: 'Réel' },
        { key: 'sci-is', label: 'SCI-IS' },
    ];
    const currentRegime = getOwnedRegime();
    const defisca = REGIMES.map(({ key, label }) => {
        const rd = computeOwnedAssetCF(asset, { ...sc.variables, regime: key }, tmi);
        return { key, label, impots: rd.impotsAnnee, cfNetNet: rd.cfNetNet };
    });

    // Patrimoine net
    const patNet = computePatrimoineNet(asset);
    const patTone = patNet.patrimoineNet !== null ? (patNet.patrimoineNet >= 0 ? 'positive' : 'negative') : '';

    // Trésorerie réelle
    const tresoReel = computeTresorerieReelle(asset, tmi, currentRegime);

    // Régime optimal
    const optRegime = getOptimalRegime(asset, tmi);
    const REGIME_LABELS_SHORT = { 'micro-foncier': 'Micro-foncier', 'reel': 'Foncier réel', 'sci-is': 'SCI-IS' };
    const optGain = optRegime.optimal ? (optRegime.optimalCF || 0) - (optRegime.allCFs[currentRegime] || 0) : 0;
    const hasOptAlert = optRegime.optimal && optRegime.optimal !== currentRegime && optGain > 20;

    // Revenus bruts pour alerte 15k
    const allAssets = Object.values(loadOwnedAssets());
    const revenusBruts = computeRevenusLocatifsBruts(allAssets);
    const alerteMicroFoncier = revenusBruts > 15000 && currentRegime === 'micro-foncier';
    const anneeComp = new Date().getFullYear();

    const loyerMarche = asset.loyerMarche || null;
    const loyerInitialVal = acq.loyerInitial || 0;
    const loyerSousEvalue = loyerMarche && loyerInitialVal > 0 && loyerInitialVal < loyerMarche.loyerMedian * 0.9;

    nodes.ownedSynthese.innerHTML = `
        ${alerteMicroFoncier ? `<div class="owned-alert owned-alert--error">⚠ Revenus fonciers bruts ${Math.round(revenusBruts).toLocaleString('fr-FR')} €/an — Micro-foncier interdit au-delà de 15 000 €. Changez de régime.</div>` : ''}
        ${hasOptAlert ? `<div class="owned-alert owned-alert--warning">💡 ${REGIME_LABELS_SHORT[optRegime.optimal]} serait plus favorable de <strong>+${Math.round(optGain).toLocaleString('fr-FR')} €/mois</strong> pour ce bien</div>` : ''}
        ${loyerSousEvalue ? `<div class="owned-alert owned-alert--warning">📈 Loyer potentiellement sous-évalué : marché à <strong>${Math.round(loyerMarche.loyerMedian).toLocaleString('fr-FR')} €/mois</strong> (médiane sur ${loyerMarche.nbSamples} biens)</div>` : ''}
        <div class="owned-synthese__title">Synthèse · scénario réaliste
            ${asset.ville ? `<button class="btn btn--ghost btn--sm" data-action="analyse-loyer-marche" style="font-size:0.75rem" title="Comparer le loyer au marché local">📈 Loyer marché</button>` : ''}
            <button class="btn btn--ghost btn--sm" data-action="open-compte-resultat" data-annee="${anneeComp}" style="margin-left:auto;font-size:0.75rem">📊 Compte de résultat ${anneeComp}</button>
        </div>
        <div class="owned-synthese__cards">
            <div class="owned-synthese__card">
                <span class="owned-synthese__card-label">Mensualité crédit</span>
                <span class="owned-synthese__card-value">${Math.round(mensualiteTotale).toLocaleString('fr-FR')} €/mois</span>
                ${assuranceMens > 0 ? `<span class="owned-synthese__card-sub">dont ${Math.round(assuranceMens).toLocaleString('fr-FR')} € assurance</span>` : ''}
            </div>
            <div class="owned-synthese__card">
                <span class="owned-synthese__card-label">Investissement total</span>
                <span class="owned-synthese__card-value">${Math.round(investTotal).toLocaleString('fr-FR')} €</span>
                <span class="owned-synthese__card-sub">Apport : ${Math.round(apport).toLocaleString('fr-FR')} €</span>
            </div>
            <div class="owned-synthese__card">
                <span class="owned-synthese__card-label">CF avant impôt</span>
                <span class="owned-synthese__card-value owned-synthese__card-value--${cfAvantTone}">
                    ${r.cfNet >= 0 ? '+' : ''}${Math.round(r.cfNet).toLocaleString('fr-FR')} €/mois
                </span>
            </div>
            <div class="owned-synthese__card">
                <span class="owned-synthese__card-label">CF après impôt</span>
                <span class="owned-synthese__card-value owned-synthese__card-value--${cfApresTone}">
                    ${r.cfNetNet >= 0 ? '+' : ''}${Math.round(r.cfNetNet).toLocaleString('fr-FR')} €/mois
                </span>
            </div>
            <div class="owned-synthese__card">
                <span class="owned-synthese__card-label">Renta brute</span>
                <span class="owned-synthese__card-value">${r.rentaBrute.toFixed(1).replace('.', ',')} %</span>
            </div>
            <div class="owned-synthese__card">
                <span class="owned-synthese__card-label">DSCR</span>
                <span class="owned-synthese__card-value ${dscrTone ? `owned-synthese__card-value--${dscrTone}` : ''}">
                    ${r.dscr.toFixed(2).replace('.', ',')}
                </span>
            </div>
            <div class="owned-synthese__card ${patNet.patrimoineNet !== null ? (patTone === 'positive' ? 'owned-synthese__card--patrimoine-pos' : 'owned-synthese__card--patrimoine-neg') : ''}">
                <span class="owned-synthese__card-label">Patrimoine net</span>
                ${patNet.patrimoineNet !== null
                    ? `<span class="owned-synthese__card-value owned-synthese__card-value--${patTone}">${patNet.patrimoineNet >= 0 ? '+' : ''}${patNet.patrimoineNet.toLocaleString('fr-FR')} €</span>
                       <span class="owned-synthese__card-sub">Valeur ${patNet.valeurEstimee.toLocaleString('fr-FR')} € − CRD ${patNet.crd.toLocaleString('fr-FR')} €</span>`
                    : `<span class="owned-synthese__card-value" style="color:var(--text-tertiary)">—</span>
                       <span class="owned-synthese__card-sub"><a href="#" data-action="focus-valeur-estimee" style="color:var(--accent-gold)">Renseigner la valeur</a></span>`
                }
            </div>
        </div>
        ${tresoReel ? `
        <div class="owned-synthese__title" style="margin-top:16px">Trésorerie réelle · 12 derniers mois</div>
        ${tresoReel.n < 6 ? `<div style="color:var(--warning,#e6a817);font-size:.75rem;margin-bottom:6px">⚠ ${tresoReel.n} mois seulement — moyenne peu représentative</div>` : ''}
        <div class="owned-synthese__cards">
            <div class="owned-synthese__card">
                <span class="owned-synthese__card-label">Taux d'occupation réel</span>
                <span class="owned-synthese__card-value">${tresoReel.tauxOccupation.toFixed(0)} %</span>
                <span class="owned-synthese__card-sub">sur ${tresoReel.n} mois saisis</span>
            </div>
            <div class="owned-synthese__card">
                <span class="owned-synthese__card-label">CF réel moyen</span>
                <span class="owned-synthese__card-value ${tresoReel.cfReelMoyen >= 0 ? 'owned-synthese__card-value--positive' : 'owned-synthese__card-value--negative'}">
                    ${tresoReel.cfReelMoyen >= 0 ? '+' : ''}${Math.round(tresoReel.cfReelMoyen).toLocaleString('fr-FR')} €/mois
                </span>
            </div>
            <div class="owned-synthese__card">
                <span class="owned-synthese__card-label">Écart vs prévisionnel</span>
                <span class="owned-synthese__card-value ${tresoReel.ecart >= 0 ? 'owned-synthese__card-value--positive' : 'owned-synthese__card-value--negative'}">
                    ${tresoReel.ecart >= 0 ? '+' : ''}${Math.round(tresoReel.ecart).toLocaleString('fr-FR')} €/mois
                </span>
            </div>
        </div>` : ''}
        <div class="owned-synthese__title" style="margin-top:16px">Défiscalisation — comparaison des régimes
            <button class="btn btn--ghost btn--sm" data-action="open-simu-travaux" style="margin-left:auto;font-size:0.75rem">🔧 Simuler des travaux</button>
        </div>
        <div class="owned-synthese__defisca">
            ${defisca.map(d => {
                const isActive = d.key === currentRegime;
                const isOptimal = d.key === optRegime.optimal;
                const cfTone = d.cfNetNet >= 0 ? 'positive' : 'negative';
                return `
                <div class="owned-synthese__defisca-card${isActive ? ' owned-synthese__defisca-card--active' : ''}">
                    <span class="owned-synthese__defisca-name">${d.label}${isActive ? ' ✓' : ''}${isOptimal && !isActive ? ' <span class="owned-badge owned-badge--optimal">Optimal</span>' : ''}${isOptimal && isActive ? ' <span class="owned-badge owned-badge--optimal">✓ Optimal</span>' : ''}</span>
                    <div class="owned-synthese__defisca-row">
                        <span>Impôts/an</span>
                        <span>${Math.round(d.impots).toLocaleString('fr-FR')} €</span>
                    </div>
                    <div class="owned-synthese__defisca-row">
                        <span>CF net-net</span>
                        <span class="owned-synthese__defisca-cf--${cfTone}">${d.cfNetNet >= 0 ? '+' : ''}${Math.round(d.cfNetNet).toLocaleString('fr-FR')} €/mois</span>
                    </div>
                </div>`;
            }).join('')}
        </div>
    `;
}

function renderAccordionAcquisition(asset) {
    if (!nodes.accAcquisitionContent) return;
    const acq = asset.acquisition || {};
    const credit = acq.credit || {};

    const investTotal = (acq.prix || 0) + (acq.fraisAgence || 0) + (acq.fraisNotaire || 0);
    if (nodes.accAcquisitionSummary) {
        nodes.accAcquisitionSummary.textContent = investTotal > 0
            ? `${Math.round(investTotal).toLocaleString('fr-FR')} € investis`
            : '';
    }

    nodes.accAcquisitionContent.innerHTML = `
        <div class="owned-form-grid">
            <label class="variables-field">
                <span class="variables-label">Prix d'achat (€)</span>
                <input class="variables-input" type="number" min="0" step="1000" data-acq-field="prix" value="${acq.prix || 0}">
            </label>
            <label class="variables-field">
                <span class="variables-label">Frais d'agence (€)</span>
                <input class="variables-input" type="number" min="0" step="100" data-acq-field="fraisAgence" value="${acq.fraisAgence || 0}">
            </label>
            <label class="variables-field">
                <span class="variables-label">Frais de notaire (€)</span>
                <input class="variables-input" type="number" min="0" step="100" data-acq-field="fraisNotaire" value="${acq.fraisNotaire || 0}">
            </label>
            <label class="variables-field">
                <span class="variables-label">Loyer initial (€/mois)</span>
                <input class="variables-input" type="number" min="0" step="10" data-acq-field="loyerInitial" value="${acq.loyerInitial || 0}">
            </label>
            <label class="variables-field">
                <span class="variables-label">Surface (m²)</span>
                <input class="variables-input" type="number" min="0" step="1" data-acq-field="surface" value="${acq.surface || 0}">
            </label>
            <label class="variables-field">
                <span class="variables-label">Type de bien</span>
                <select class="variables-input" data-acq-field="typeBien">
                    <option value="appartement"${(acq.typeBien || 'appartement') === 'appartement' ? ' selected' : ''}>Appartement</option>
                    <option value="maison"${acq.typeBien === 'maison' ? ' selected' : ''}>Maison</option>
                    <option value="immeuble"${acq.typeBien === 'immeuble' ? ' selected' : ''}>Immeuble de rapport</option>
                </select>
            </label>
            <label class="variables-field">
                <span class="variables-label">Année d'achat</span>
                <input class="variables-input" type="number" min="1900" max="2099" step="1" data-owned-field="anneeAchat" value="${asset.anneeAchat || ''}">
            </label>
            <label class="variables-field">
                <span class="variables-label">Ville</span>
                <input class="variables-input" type="text" data-owned-field="ville" value="${escapeHtml(asset.ville || '')}">
            </label>
            <label class="variables-field">
                <span class="variables-label">Code postal</span>
                <input class="variables-input" type="text" maxlength="5" data-owned-field="codePostal" value="${escapeHtml(asset.codePostal || '')}">
            </label>
        </div>
        <div class="owned-section-title">Crédit immobilier</div>
        <div class="owned-form-grid">
            <label class="variables-field">
                <span class="variables-label">Montant emprunté (€)</span>
                <input class="variables-input" type="number" min="0" step="1000" data-credit-field="montant" value="${credit.montant || 0}">
            </label>
            <label class="variables-field">
                <span class="variables-label">Durée (ans)</span>
                <input class="variables-input" type="number" min="0" max="30" step="1" data-credit-field="duree" value="${credit.duree || 0}">
            </label>
            <label class="variables-field">
                <span class="variables-label">Taux (%)</span>
                <input class="variables-input" type="number" min="0" max="20" step="0.01" data-credit-field="taux" value="${credit.taux || 0}">
            </label>
            <label class="variables-field">
                <span class="variables-label">Assurance (%/an)</span>
                <input class="variables-input" type="number" min="0" max="5" step="0.01" data-credit-field="assurance" value="${credit.assurance || 0}">
            </label>
        </div>
        <div class="owned-section-title" style="margin-top:20px">Valeur patrimoniale</div>
        <div class="owned-form-grid">
            <label class="variables-field">
                <span class="variables-label">Valeur estimée actuelle (€)</span>
                <input class="variables-input" type="number" min="0" step="1000" data-acq-field="valeurEstimee" value="${acq.valeurEstimee || 0}">
            </label>
            <label class="variables-field">
                <span class="variables-label">Date d'estimation</span>
                <input class="variables-input" type="month" data-acq-field="dateEstimation" value="${acq.dateEstimation || ''}">
            </label>
        </div>
    `;

    if (!nodes.accAcquisitionContent.dataset.acqWired) {
        nodes.accAcquisitionContent.dataset.acqWired = '1';
        nodes.accAcquisitionContent.addEventListener('change', e => {
            const input = e.target.closest('input, select');
            if (!input) return;
            const id = state.activeOwnedAssetId;
            if (!id) return;
            const val = input.type === 'number' ? Number(input.value) : input.value;
            if (input.dataset.acqField) {
                updateOwnedAcquisition(id, { [input.dataset.acqField]: val });
            } else if (input.dataset.creditField) {
                updateOwnedCredit(id, { [input.dataset.creditField]: val });
            } else if (input.dataset.ownedField) {
                updateOwnedAsset(id, { [input.dataset.ownedField]: val });
            }
            const freshAsset = getOwnedAsset(id);
            if (!freshAsset) return;
            const acq2 = freshAsset.acquisition || {};
            const total2 = (acq2.prix || 0) + (acq2.fraisAgence || 0) + (acq2.fraisNotaire || 0);
            if (nodes.accAcquisitionSummary) {
                nodes.accAcquisitionSummary.textContent = total2 > 0 ? `${Math.round(total2).toLocaleString('fr-FR')} € investis` : '';
            }
            if (nodes.ownedDetailTitle) {
                const metaEl = nodes.ownedDetailTitle.querySelector('.owned-detail-title__meta');
                if (metaEl) metaEl.textContent = `${freshAsset.ville}${freshAsset.anneeAchat ? ` · Acquis ${freshAsset.anneeAchat}` : ''}`;
            }
            renderOwnedSynthese(freshAsset);
            renderOwnedVerdictBlock(freshAsset);
            renderOwnedCfTable(freshAsset);
            renderOwnedCharts(freshAsset);
            renderAccordionSimulateur(freshAsset);
            renderOwnedCrdChart(freshAsset);
        });
    }
}

function renderCFBreakdownHTML(bd, yr) {
    const fmt = v => Math.abs(v).toLocaleString('fr-FR') + ' €';
    const cfCls = bd.cfNetNet >= 0 ? 'pos' : bd.cfNetNet >= -50 ? 'watch' : 'neg';
    const cfSign = bd.cfNetNet >= 0 ? '+' : '−';
    return `<div class="cf-breakdown">
        <div class="cf-breakdown__title">Décomposition CF annuel — an ${yr}</div>
        <div class="cf-breakdown__row">
            <span class="cf-breakdown__op"></span>
            <span class="cf-breakdown__label">Loyer brut théorique</span>
            <span class="cf-breakdown__value">${fmt(bd.loyerBrut)}</span>
        </div>
        <div class="cf-breakdown__row cf-breakdown__row--sub">
            <span class="cf-breakdown__op">−</span>
            <span class="cf-breakdown__label">Vacance locative</span>
            <span class="cf-breakdown__value cf-breakdown__value--neg">−${fmt(bd.vacanceEuros)}</span>
        </div>
        <div class="cf-breakdown__row cf-breakdown__row--separator">
            <span class="cf-breakdown__op">=</span>
            <span class="cf-breakdown__label">Loyers encaissés</span>
            <span class="cf-breakdown__value">${fmt(bd.loyersEncaisses)}</span>
        </div>
        <div class="cf-breakdown__row">
            <span class="cf-breakdown__op">−</span>
            <span class="cf-breakdown__label">Charges (taxe, copro, PNO, gestion)</span>
            <span class="cf-breakdown__value cf-breakdown__value--neg">−${fmt(bd.charges)}</span>
        </div>
        ${bd.mensualiteCredit > 0 ? `<div class="cf-breakdown__row">
            <span class="cf-breakdown__op">−</span>
            <span class="cf-breakdown__label">Mensualités crédit</span>
            <span class="cf-breakdown__value cf-breakdown__value--neg">−${fmt(bd.mensualiteCredit)}</span>
        </div>` : ''}
        <div class="cf-breakdown__row">
            <span class="cf-breakdown__op">−</span>
            <span class="cf-breakdown__label">Impôts (${getOwnedRegime() === 'micro-foncier' ? 'micro-foncier' : getOwnedRegime() === 'reel' ? 'réel' : 'SCI-IS'})</span>
            <span class="cf-breakdown__value cf-breakdown__value--neg">−${fmt(bd.impots)}</span>
        </div>
        <div class="cf-breakdown__row cf-breakdown__row--total">
            <span class="cf-breakdown__op">=</span>
            <span class="cf-breakdown__label">CF net-net annuel</span>
            <span class="cf-breakdown__value cf-breakdown__value--${cfCls}">${cfSign}${fmt(bd.cfNetNet)}</span>
        </div>
        <div style="font-size:11px;color:var(--text-tertiary);margin-top:6px;padding-left:24px">
            soit ${cfSign}${Math.round(bd.cfNetNet / 12).toLocaleString('fr-FR')} €/mois
        </div>
    </div>`;
}

function renderRegimeComparisonHTML(cmp, yr) {
    const REGIME_LABELS = { 'micro-foncier': 'Micro-foncier', 'reel': 'Foncier Réel', 'sci-is': 'SCI-IS' };
    const YEARS = [1, 3, 5, 10];
    const regimes = ['micro-foncier', 'reel', 'sci-is'];
    const fmt = v => v === null ? '—' : (v >= 0 ? '+' : '−') + Math.abs(Math.round(v / 12)).toLocaleString('fr-FR') + ' €/m';
    const cls = v => v === null ? '' : v >= 0 ? 'cf-pos' : 'cf-neg';

    // Alerte : régime optimal change-t-il entre an 1 et an 5 ?
    const opt1 = cmp.optimal[1];
    const opt5 = cmp.optimal[5];
    const alertHtml = (opt1 && opt5 && opt1 !== opt5)
        ? `<div class="regime-comparison__alert">⚠ Régime optimal an 1 : <strong>${REGIME_LABELS[opt1]}</strong> — mais en an 5 : <strong>${REGIME_LABELS[opt5]}</strong> devient plus avantageux. Rappel : le foncier réel engage sur 3 ans minimum.</div>`
        : '';

    return `<div class="regime-comparison">
        <div class="regime-comparison__title">Comparatif régimes fiscaux — CF mensuel net</div>
        <table>
            <thead>
                <tr>
                    <th>Régime</th>
                    ${YEARS.map(y => `<th>An ${y}</th>`).join('')}
                </tr>
            </thead>
            <tbody>
                ${regimes.map(regime => `<tr>
                    <td>${REGIME_LABELS[regime]}</td>
                    ${YEARS.map(y => {
                        const v = cmp.byRegime[regime]?.[y] ?? null;
                        const isOpt = cmp.optimal[y] === regime;
                        return `<td><span class="${cls(v)}">${fmt(v)}</span>${isOpt ? '<span class="optimal-badge">✓</span>' : ''}</td>`;
                    }).join('')}
                </tr>`).join('')}
            </tbody>
        </table>
        ${alertHtml}
    </div>`;
}

function renderAccordionPostAchat(asset) {
    if (!nodes.accPostAchatContent) return;
    const post = asset.postAchat || {};

    const hasUnclassified = (post.travaux || []).some(t => t.tag === 'a-classifier');
    if (nodes.accPostAchatSummary) {
        nodes.accPostAchatSummary.textContent = hasUnclassified
            ? `⚠ ${(post.travaux || []).filter(t => t.tag === 'a-classifier').length} travail(x) à classifier`
            : post.travaux?.length ? `${post.travaux.length} travail(x)` : '';
    }

    const TAG_LABELS = { 'deductible': 'Déductible', 'non-deductible': 'Non déductible', 'a-classifier': 'À classifier' };
    const TAG_CSS = { 'deductible': 'tag--green', 'non-deductible': 'tag--grey', 'a-classifier': 'tag--orange' };

    const currentYear = new Date().getFullYear();
    const totalDed = (post.travaux || [])
        .filter(t => t.tag === 'deductible' && t.date && new Date(t.date).getFullYear() === currentYear)
        .reduce((s, t) => s + t.montant, 0);

    const sorted = [...(post.travaux || [])].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    // CF Breakdown pour l'année sélectionnée (filtre par bien)
    const tmi = getOwnedTmi();
    const regime = getOwnedRegime();
    const defaultYear = asset.anneeAchat
        ? Math.max(1, currentYear - asset.anneeAchat + 1)
        : 1;
    const yr = (state.ownedYearFilters?.[asset.id]) ?? defaultYear;
    const breakdown = (asset.acquisition?.prix || 0) > 0 ? computeCFBreakdown(asset, tmi, regime, yr) : null;
    const breakdownHtml = breakdown ? renderCFBreakdownHTML(breakdown, yr) : '';

    // P0-B : résoudre les valeurs courantes depuis chargesAnnuelles pour les inputs plats
    const recentEntriesDisplay = (post.chargesAnnuelles || [])
        .filter(e => e.annee <= currentYear)
        .sort((a, b) => b.annee - a.annee);
    const ceDisplay = recentEntriesDisplay[0] || null;
    const displayTF = ceDisplay ? (ceDisplay.taxeFonciere ?? post.taxeFonciere ?? 0) : (post.taxeFonciere ?? 0);
    const displayGestion = ceDisplay ? (ceDisplay.gestionLocative ?? post.gestionLocative ?? 0) : (post.gestionLocative ?? 0);
    const displayPNO = ceDisplay ? (ceDisplay.assurancePNO ?? post.assurancePNO ?? 0) : (post.assurancePNO ?? 0);
    const displayCopro = ceDisplay ? (ceDisplay.chargesCopro ?? post.chargesCopro ?? 0) : (post.chargesCopro ?? 0);
    const displayFromYear = ceDisplay ? ceDisplay.annee : null;

    nodes.accPostAchatContent.innerHTML = `
        <div class="owned-section-title">Charges récurrentes</div>
        ${displayFromYear ? `
        <div style="font-size:.75rem;color:var(--accent-gold);margin-bottom:8px;
          padding:6px 10px;background:var(--surface-raised,var(--surface));
          border-left:2px solid var(--accent-gold);border-radius:4px">
          ⚠ Ces valeurs proviennent de l'entrée <strong>${displayFromYear}</strong>
          de l'historique. Modifiez-les ici pour mettre à jour cette entrée.
        </div>` : ''}
        <div class="owned-form-grid">
            <label class="variables-field">
                <span class="variables-label">Vacance locative (%)</span>
                <input class="variables-input" type="number" min="0" max="100" step="0.5" data-post-field="vacance" value="${post.vacance ?? 5}">
            </label>
            <label class="variables-field">
                <span class="variables-label">Taxe foncière (€/an)${displayFromYear ? ` <small style="color:var(--text-tertiary)">(depuis ${displayFromYear})</small>` : ''}</span>
                <input class="variables-input" type="number" min="0" step="10" data-post-field="taxeFonciere" value="${displayTF}">
            </label>
            <label class="variables-field">
                <span class="variables-label">Charges copro (€/mois)${displayFromYear ? ` <small style="color:var(--text-tertiary)">(depuis ${displayFromYear})</small>` : ''}</span>
                <input class="variables-input" type="number" min="0" step="5" data-post-field="chargesCopro" value="${displayCopro}">
            </label>
            <label class="variables-field">
                <span class="variables-label">Gestion locative (% loyer)${displayFromYear ? ` <small style="color:var(--text-tertiary)">(depuis ${displayFromYear})</small>` : ''}</span>
                <input class="variables-input" type="number" min="0" max="20" step="0.5" data-post-field="gestionLocative" value="${displayGestion}">
            </label>
            <label class="variables-field">
                <span class="variables-label">Assurance PNO (€/an)${displayFromYear ? ` <small style="color:var(--text-tertiary)">(depuis ${displayFromYear})</small>` : ''}</span>
                <input class="variables-input" type="number" min="0" step="10" data-post-field="assurancePNO" value="${displayPNO}">
            </label>
        </div>

        <div class="owned-section-title" style="margin-top:20px">Évolution des charges</div>
        <div class="owned-charges-annuelles-list">
            ${(post.chargesAnnuelles || []).length ? (post.chargesAnnuelles || []).map(e => `
                <div class="owned-charges-annuelles-row">
                    <span class="owned-charges-annuelles-row__year">${e.annee}</span>
                    <span class="owned-charges-annuelles-row__vals">TF : ${(e.taxeFonciere ?? 0).toLocaleString('fr-FR')} €/an · Copro : ${(e.chargesCopro ?? 0).toLocaleString('fr-FR')} €/mois · Gest. : ${e.gestionLocative ?? 0} % · PNO : ${(e.assurancePNO ?? 0).toLocaleString('fr-FR')} €/an</span>
                    <button class="owned-travaux-delete" data-delete-charges="${e.annee}" title="Supprimer">✕</button>
                </div>
            `).join('') : '<p style="font-size:.82rem;color:var(--text-tertiary);font-style:italic">Ajoutez une année pour suivre l\'évolution des charges.</p>'}
        </div>
        <form class="owned-charges-form" data-form="add-charges" novalidate>
            <input type="number" name="annee" class="variables-input" placeholder="Année" min="${asset.anneeAchat || 2020}" step="1" required style="min-width:0">
            <input type="number" name="taxeFonciere" class="variables-input" placeholder="TF (€/an)" min="0" step="10" style="min-width:0">
            <input type="number" name="chargesCopro" class="variables-input" placeholder="Copro (€/mois)" min="0" step="5" style="min-width:0">
            <input type="number" name="gestionLocative" class="variables-input" placeholder="Gestion (%)" min="0" max="20" step="0.5" style="min-width:0">
            <input type="number" name="assurancePNO" class="variables-input" placeholder="PNO (€/an)" min="0" step="10" style="min-width:0">
            <button type="submit" class="btn btn--primary btn--sm">+ Ajouter</button>
        </form>

        ${breakdownHtml}

        <div class="owned-section-title">Travaux</div>
        <div class="owned-travaux-list">
            ${sorted.length ? sorted.map(t => `
                <div class="owned-travaux-row">
                    <span class="owned-travaux-date">${escapeHtml(t.date || '—')}</span>
                    <span class="owned-travaux-desc">${escapeHtml(t.description || '—')}</span>
                    <span class="owned-travaux-montant">${Math.round(t.montant).toLocaleString('fr-FR')} €</span>
                    <span class="tag ${TAG_CSS[t.tag] || 'tag--grey'}">${escapeHtml(TAG_LABELS[t.tag] || t.tag)}</span>
                    <button class="owned-travaux-delete" data-delete-travail="${escapeHtml(t.id)}" title="Supprimer" aria-label="Supprimer">✕</button>
                </div>
            `).join('') : '<p style="font-size:.82rem;color:var(--text-tertiary);font-style:italic">Aucun travail enregistré.</p>'}
        </div>
        ${totalDed > 0 ? `<div class="owned-travaux-totals"><span>Déductible ${currentYear} : <strong>${Math.round(totalDed).toLocaleString('fr-FR')} €</strong></span></div>` : ''}

        <form class="owned-travaux-form" data-form="add-travail" novalidate>
            <input type="date" name="date" class="variables-input" required placeholder="Date" style="flex:0 0 140px">
            <input type="text" name="description" class="variables-input" required placeholder="Description" style="flex:1;min-width:120px">
            <input type="number" name="montant" class="variables-input" required placeholder="Montant €" min="0" style="flex:0 0 100px">
            <select name="tag" class="variables-input" style="flex:0 0 130px">
                <option value="a-classifier">À classifier</option>
                <option value="deductible">Déductible</option>
                <option value="non-deductible">Non déductible</option>
            </select>
            <button type="submit" class="btn btn--primary btn--sm">Ajouter</button>
        </form>

        <div class="owned-section-title" style="margin-top:20px">Suivi des loyers réels</div>
        ${(() => {
            const ALL_LOYERS = [...(post.loyersReels || [])].sort((a, b) => b.mois.localeCompare(a.mois));
            const PAGE_SIZE = 12;
            const loyerPage = state.ownedLoyerPage?.[asset.id] || 0;
            const loyers = ALL_LOYERS.slice(loyerPage * PAGE_SIZE, (loyerPage + 1) * PAGE_SIZE);
            const hasMore = ALL_LOYERS.length > (loyerPage + 1) * PAGE_SIZE;
            const hasPrev = loyerPage > 0;
            const loyerPrevu = asset.acquisition?.loyerInitial || 0;
            const STATUT_LABELS = { encaisse: '✓ Encaissé', impaye: '✗ Impayé', vacant: '○ Vacant', partiel: '~ Partiel' };
            const STATUT_CSS = { encaisse: 'loyer-statut--ok', impaye: 'loyer-statut--bad', vacant: 'loyer-statut--vacant', partiel: 'loyer-statut--partial' };
            return `
            <table class="owned-loyers-table">
                <thead><tr><th>Mois</th><th>Prévu</th><th>Réel</th><th>Statut</th><th>Écart</th><th></th></tr></thead>
                <tbody>
                ${loyers.length ? loyers.map(e => {
                    const ecart = (e.montant || 0) - loyerPrevu;
                    return `<tr>
                        <td>${e.mois}</td>
                        <td>${loyerPrevu.toLocaleString('fr-FR')} €</td>
                        <td>${(e.montant || 0).toLocaleString('fr-FR')} €</td>
                        <td><span class="loyer-statut ${STATUT_CSS[e.statut] || ''}">${STATUT_LABELS[e.statut] || e.statut}</span></td>
                        <td class="${ecart < 0 ? 'owned-table-num--negative' : ''}">${ecart >= 0 ? '+' : ''}${ecart.toLocaleString('fr-FR')} €</td>
                        <td><button class="owned-travaux-delete" data-delete-loyer="${escapeHtml(e.mois)}" title="Supprimer">✕</button></td>
                    </tr>`;
                }).join('') : '<tr><td colspan="6" style="text-align:center;font-style:italic;color:var(--text-tertiary);padding:12px">Aucun loyer saisi</td></tr>'}
                </tbody>
            </table>
            <div style="display:flex;gap:8px;margin-top:6px">
                ${hasPrev ? `<button class="btn btn--ghost btn--sm" data-loyer-page="${loyerPage - 1}">← Précédent</button>` : ''}
                ${hasMore ? `<button class="btn btn--ghost btn--sm" data-loyer-page="${loyerPage + 1}">Suivant →</button>` : ''}
            </div>
            <form class="owned-loyers-form" data-form="add-loyer" novalidate>
                <input type="month" name="mois" class="variables-input" required style="flex:1;min-width:120px">
                <input type="number" name="montant" class="variables-input" placeholder="Montant €" min="0" step="10" style="flex:1;min-width:80px">
                <select name="statut" class="variables-input" style="flex:1;min-width:100px">
                    <option value="encaisse">Encaissé</option>
                    <option value="partiel">Partiel</option>
                    <option value="impaye">Impayé</option>
                    <option value="vacant">Vacant</option>
                </select>
                <button type="submit" class="btn btn--primary btn--sm">+ Ajouter</button>
            </form>`;
        })()}

        <div class="owned-section-title" style="margin-top:20px">Déficits fonciers reportables</div>
        ${(() => {
            const defs = [...(post.deficitFoncierReporte || [])].sort((a, b) => b.annee - a.annee);
            const currentYear = new Date().getFullYear();
            const stockTotal = defs.filter(d => d.annee >= currentYear - 10).reduce((s, d) => s + Math.max(0, (d.montantInitial || 0) - (d.utilise || 0)), 0);
            return `
            ${stockTotal > 0 ? `<div class="owned-deficit-total">Stock reportable : <strong>${Math.round(stockTotal).toLocaleString('fr-FR')} €</strong></div>` : ''}
            <table class="owned-loyers-table">
                <thead><tr><th>Année</th><th>Montant initial</th><th>Utilisé</th><th>Restant</th><th>Expire</th><th></th></tr></thead>
                <tbody>
                ${defs.length ? defs.map(d => {
                    const restant = Math.max(0, (d.montantInitial || 0) - (d.utilise || 0));
                    const expire = d.annee + 10;
                    const expired = expire <= currentYear;
                    return `<tr ${expired ? 'style="opacity:0.4"' : ''}>
                        <td>${d.annee}</td>
                        <td>${(d.montantInitial || 0).toLocaleString('fr-FR')} €</td>
                        <td>${(d.utilise || 0).toLocaleString('fr-FR')} €</td>
                        <td>${restant.toLocaleString('fr-FR')} €</td>
                        <td>${expired ? '<span style="color:var(--danger)">Expiré</span>' : expire}</td>
                        <td><button class="owned-travaux-delete" data-delete-deficit="${d.annee}" title="Supprimer">✕</button></td>
                    </tr>`;
                }).join('') : '<tr><td colspan="6" style="text-align:center;font-style:italic;color:var(--text-tertiary);padding:12px">Aucun déficit enregistré</td></tr>'}
                </tbody>
            </table>
            <form class="owned-deficit-form" data-form="add-deficit" novalidate>
                <input type="number" name="annee" class="variables-input" placeholder="Année" min="${asset.anneeAchat || 2015}" max="${currentYear}" step="1" required style="flex:0 0 80px">
                <input type="number" name="montantInitial" class="variables-input" placeholder="Montant (€)" min="0" step="100" required style="flex:1">
                <input type="number" name="utilise" class="variables-input" placeholder="Déjà utilisé (€)" min="0" step="100" style="flex:1">
                <button type="submit" class="btn btn--primary btn--sm">+ Ajouter</button>
            </form>`;
        })()}

        <div class="owned-section-title" style="margin-top:20px">Notes</div>
        <div class="owned-notes-list">
            ${[...(post.notes || [])].reverse().map(n => `
                <div class="owned-note-entry">
                    <p class="owned-note-text">${escapeHtml(n.text)}</p>
                    <div style="display:flex;align-items:center;gap:8px">
                        <span class="owned-note-date">${new Date(n.createdAt).toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })}</span>
                        <button class="owned-travaux-delete" data-delete-note="${escapeHtml(n.id)}" title="Supprimer" style="margin-left:auto">✕</button>
                    </div>
                </div>
            `).join('') || '<p style="font-size:.82rem;color:var(--text-tertiary);font-style:italic">Aucune note.</p>'}
        </div>
        <div class="owned-notes-add">
            <textarea class="variables-input owned-notes-textarea" placeholder="Ajouter une note…" rows="3"></textarea>
            <button class="btn btn--primary btn--sm" data-action="save-note" type="button">Enregistrer</button>
        </div>
    `;

    nodes.accPostAchatContent.querySelectorAll('[data-post-field]').forEach(input => {
        input.addEventListener('change', () => {
            const id = state.activeOwnedAssetId;
            if (!id) return;
            updateOwnedPostAchat(id, { [input.dataset.postField]: Number(input.value) });

            // B1 : synchroniser vers chargesAnnuelles
            const freshForCharges = getOwnedAsset(id);
            const postForCharges = freshForCharges?.postAchat || {};
            const ca = postForCharges.chargesAnnuelles || [];
            const currentYearSync = new Date().getFullYear();
            const lastEntry = [...ca].filter(e => e.annee <= currentYearSync)
                                     .sort((a, b) => b.annee - a.annee)[0];
            if (lastEntry) {
                const field = input.dataset.postField;
                if (['taxeFonciere', 'chargesCopro', 'gestionLocative', 'assurancePNO'].includes(field)) {
                    addOwnedChargesAnnuelles(id, { ...lastEntry, [field]: Number(input.value) });
                }
            }

            const fresh = getOwnedAsset(id);
            renderOwnedSynthese(fresh);
            renderOwnedVerdictBlock(fresh);
            renderOwnedCfTable(fresh);
            renderOwnedCharts(fresh);
            renderAccordionSimulateur(fresh);
            renderOwnedProjectionContent(fresh);

            // B3 : mise à jour ciblée du bloc CF breakdown sans re-rendre tout l'accordéon
            const yr2 = (state.ownedYearFilters?.[id]) ?? 1;
            const bdNew = (fresh.acquisition?.prix || 0) > 0
                ? computeCFBreakdown(fresh, getOwnedTmi(), getOwnedRegime(), yr2)
                : null;
            const bdWrap = nodes.accPostAchatContent.querySelector('.cf-breakdown');
            if (bdWrap && bdNew) bdWrap.outerHTML = renderCFBreakdownHTML(bdNew, yr2);
        });
    });

    nodes.accPostAchatContent.querySelectorAll('[data-delete-travail]').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = state.activeOwnedAssetId;
            if (!id) return;
            deleteOwnedTravail(id, btn.dataset.deleteTravail);
            const fresh = getOwnedAsset(id);
            renderAccordionPostAchat(fresh);
            renderOwnedSynthese(fresh);
            renderOwnedCharts(fresh);
            renderAccordionSimulateur(fresh);
            renderOwnedTravauxTab(fresh);
        });
    });

    nodes.accPostAchatContent.querySelector('[data-form="add-travail"]')?.addEventListener('submit', e => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const id = state.activeOwnedAssetId;
        if (!id) return;
        addOwnedTravail(id, {
            date: fd.get('date'),
            description: fd.get('description')?.trim(),
            montant: Number(fd.get('montant')),
            tag: fd.get('tag')
        });
        e.target.reset();
        showToast('Travail ajouté');
        const fresh = getOwnedAsset(id);
        renderAccordionPostAchat(fresh);
        renderOwnedSynthese(fresh);
        renderOwnedCharts(fresh);
        renderAccordionSimulateur(fresh);
        renderOwnedTravauxTab(fresh);
    });

    nodes.accPostAchatContent.querySelectorAll('[data-delete-charges]').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = state.activeOwnedAssetId;
            if (!id) return;
            deleteOwnedChargesAnnuelles(id, Number(btn.dataset.deleteCharges));
            const fresh = getOwnedAsset(id);
            renderAccordionPostAchat(fresh);
            renderOwnedSynthese(fresh);
            renderOwnedCharts(fresh);
            renderAccordionSimulateur(fresh);
        });
    });

    nodes.accPostAchatContent.querySelector('[data-form="add-charges"]')?.addEventListener('submit', e => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const id = state.activeOwnedAssetId;
        if (!id) return;
        const annee = Number(fd.get('annee'));
        if (!annee) return;
        const anneeAchatMin = getOwnedAsset(id)?.anneeAchat || 2000;
        if (annee < anneeAchatMin || annee > new Date().getFullYear() + 1) {
            showToast(`Année invalide (min : ${anneeAchatMin})`, 'negative');
            return;
        }
        addOwnedChargesAnnuelles(id, {
            annee,
            taxeFonciere: Number(fd.get('taxeFonciere')) || 0,
            chargesCopro: Number(fd.get('chargesCopro')) || 0,
            gestionLocative: Number(fd.get('gestionLocative')) || 0,
            assurancePNO: Number(fd.get('assurancePNO')) || 0,
        });
        e.target.reset();
        const fresh = getOwnedAsset(id);
        renderAccordionPostAchat(fresh);
        renderOwnedSynthese(fresh);
        renderOwnedCharts(fresh);
        renderAccordionSimulateur(fresh);
    });

    nodes.accPostAchatContent.querySelector('[data-action="save-note"]')?.addEventListener('click', () => {
        const id = state.activeOwnedAssetId;
        if (!id) return;
        const textarea = nodes.accPostAchatContent.querySelector('.owned-notes-textarea');
        const text = textarea?.value.trim();
        if (!text) return;
        addOwnedNote(id, text);
        if (textarea) textarea.value = '';
        showToast('Note enregistrée');
        renderAccordionPostAchat(getOwnedAsset(id));
    });

    nodes.accPostAchatContent.querySelectorAll('[data-delete-note]').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = state.activeOwnedAssetId;
            if (!id) return;
            deleteOwnedNote(id, btn.dataset.deleteNote);
            renderAccordionPostAchat(getOwnedAsset(id));
        });
    });

    nodes.accPostAchatContent.querySelectorAll('[data-delete-loyer]').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = state.activeOwnedAssetId;
            if (!id) return;
            deleteOwnedLoyerReel(id, btn.dataset.deleteLoyer);
            const fresh = getOwnedAsset(id);
            renderAccordionPostAchat(fresh);
            renderOwnedSynthese(fresh);
        });
    });

    nodes.accPostAchatContent.querySelector('[data-form="add-loyer"]')?.addEventListener('submit', e => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const id = state.activeOwnedAssetId;
        if (!id) return;
        const mois = fd.get('mois');
        if (!mois) return;
        addOwnedLoyerReel(id, { mois, montant: Number(fd.get('montant')) || 0, statut: fd.get('statut') || 'encaisse' });
        e.target.reset();
        showToast('Loyer enregistré');
        const fresh = getOwnedAsset(id);
        renderAccordionPostAchat(fresh);
        renderOwnedSynthese(fresh);
    });

    nodes.accPostAchatContent.querySelectorAll('[data-delete-deficit]').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = state.activeOwnedAssetId;
            if (!id) return;
            deleteOwnedDeficitFoncier(id, Number(btn.dataset.deleteDeficit));
            renderAccordionPostAchat(getOwnedAsset(id));
        });
    });

    nodes.accPostAchatContent.querySelector('[data-form="add-deficit"]')?.addEventListener('submit', e => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const id = state.activeOwnedAssetId;
        if (!id) return;
        const annee = Number(fd.get('annee'));
        if (!annee) return;
        addOwnedDeficitFoncier(id, { annee, montantInitial: Number(fd.get('montantInitial')) || 0, utilise: Number(fd.get('utilise')) || 0 });
        e.target.reset();
        showToast('Déficit enregistré');
        renderAccordionPostAchat(getOwnedAsset(id));
    });

    nodes.accPostAchatContent.querySelectorAll('[data-loyer-page]').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = state.activeOwnedAssetId;
            if (!id) return;
            state.ownedLoyerPage = { ...(state.ownedLoyerPage || {}), [id]: Number(btn.dataset.loyerPage) };
            renderAccordionPostAchat(getOwnedAsset(id));
        });
    });
}

function renderAccordionSimulateur(asset) {
    if (!nodes.accSimulateurContent) return;
    const tmi = getOwnedTmi();
    const scenarios = asset.scenarios || [];

    if (nodes.accSimulateurSummary) {
        nodes.accSimulateurSummary.textContent = `${scenarios.length} scénario${scenarios.length > 1 ? 's' : ''}`;
    }

    const loyerInitial = asset.acquisition?.loyerInitial || 0;
    const VARS = [
        { key: 'loyer', label: `Loyer (€/mois)`, type: 'number', step: 10, min: 0, placeholder: loyerInitial || '' },
        { key: 'taxeFonciere', label: 'Taxe foncière (€/an)', type: 'number', step: 10, min: 0 },
        { key: 'vacance', label: 'Vacance (%)', type: 'number', step: 1, min: 0, max: 100 },
        { key: 'chargesCopro', label: 'Charges copro (€/mois)', type: 'number', step: 5, min: 0 },
        { key: 'gestionLocative', label: 'Gestion locative (% loyer)', type: 'number', step: 0.5, min: 0, max: 20 },
        { key: 'assurancePNO', label: 'Assurance PNO (€/an)', type: 'number', step: 10, min: 0 },
        { key: 'regime', label: 'Régime fiscal', type: 'select', options: [
            { value: 'micro-foncier', label: 'Micro-foncier' },
            { value: 'reel', label: 'Réel' },
            { value: 'sci-is', label: 'SCI-IS' }
        ]},
    ];

    const globalRegime = getOwnedRegime();
    const results = scenarios.map(sc =>
        computeOwnedAssetCF(asset, sc.variables, tmi,
            sc.variables.regime ? null : globalRegime)
    );

    function cellInput(sc, varDef) {
        const val = sc.variables[varDef.key] ?? '';
        const isRealiste = sc.id === 'realiste';
        const cls = isRealiste ? 'col-realiste' : '';
        if (varDef.type === 'select') {
            return `<td class="${cls}">
                <select data-sc-id="${escapeHtml(sc.id)}" data-var-key="${escapeHtml(varDef.key)}">
                    ${varDef.options.map(o => `<option value="${o.value}" ${val === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
                </select>
            </td>`;
        }
        const placeholder = varDef.placeholder !== undefined ? varDef.placeholder : '';
        return `<td class="${cls}">
            <input type="number" min="${varDef.min ?? ''}" max="${varDef.max ?? ''}" step="${varDef.step}"
                value="${val}" placeholder="${placeholder}" data-sc-id="${escapeHtml(sc.id)}" data-var-key="${escapeHtml(varDef.key)}">
        </td>`;
    }

    nodes.accSimulateurContent.innerHTML = `
        <div class="owned-simulator-table-wrap">
            <table class="owned-simulator-table">
                <thead>
                    <tr>
                        <th class="col-var">Variable</th>
                        ${scenarios.map(sc => `
                            <th class="${sc.id === 'realiste' ? 'col-realiste' : ''}">
                                <input type="text" value="${escapeHtml(sc.nom)}"
                                    data-sc-nom="${escapeHtml(sc.id)}"
                                    style="background:transparent;border:none;color:inherit;font-weight:700;font-size:.7rem;text-transform:uppercase;letter-spacing:.06em;width:90px;text-align:center;cursor:text"
                                    title="Renommer le scénario">
                                ${scenarios.length > 1 ? `<button class="owned-sim-delete-sc" data-sc-id="${escapeHtml(sc.id)}" title="Supprimer" style="background:none;border:none;color:var(--text-tertiary);cursor:pointer;font-size:.7rem;padding:0 2px">✕</button>` : ''}
                            </th>
                        `).join('')}
                        <th><button class="owned-sim-add-btn" type="button">+ Scénario</button></th>
                    </tr>
                </thead>
                <tbody>
                    ${VARS.map(v => `
                    <tr>
                        <td class="col-var">${escapeHtml(v.label)}</td>
                        ${scenarios.map(sc => cellInput(sc, v)).join('')}
                        <td></td>
                    </tr>
                    `).join('')}
                    <tr class="row-result row-result--sub">
                        <td class="col-var">Loyer effectif / mois</td>
                        ${scenarios.map((sc, i) => {
                            const r = results[i];
                            return `<td class="${sc.id === 'realiste' ? 'col-realiste' : ''}">
                                ${Math.round(r.loyerEffectif).toLocaleString('fr-FR')} €
                            </td>`;
                        }).join('')}
                        <td></td>
                    </tr>
                    <tr class="row-result row-result--sub">
                        <td class="col-var">Mensualité totale</td>
                        ${scenarios.map((sc, i) => {
                            const r = results[i];
                            return `<td class="${sc.id === 'realiste' ? 'col-realiste' : ''}">
                                −${Math.round(r.mensualiteTotale).toLocaleString('fr-FR')} €
                            </td>`;
                        }).join('')}
                        <td></td>
                    </tr>
                    <tr class="row-result row-result--sub">
                        <td class="col-var">Charges / mois</td>
                        ${scenarios.map((sc, i) => {
                            const r = results[i];
                            return `<td class="${sc.id === 'realiste' ? 'col-realiste' : ''}">
                                −${Math.round(r.chargesMensuelles).toLocaleString('fr-FR')} €
                            </td>`;
                        }).join('')}
                        <td></td>
                    </tr>
                    <tr class="row-result">
                        <td class="col-var">CF avant impôt / mois</td>
                        ${scenarios.map((sc, i) => {
                            const r = results[i];
                            const cf = r.cfNet;
                            const color = cf >= 0 ? '#3FB950' : '#F85149';
                            return `<td class="${sc.id === 'realiste' ? 'col-realiste' : ''}" style="color:${color}">
                                ${cf >= 0 ? '+' : ''}${Math.round(cf).toLocaleString('fr-FR')} €
                            </td>`;
                        }).join('')}
                        <td></td>
                    </tr>
                    <tr class="row-result row-result--sub">
                        <td class="col-var">Impôts / mois</td>
                        ${scenarios.map((sc, i) => {
                            const r = results[i];
                            const imp = r.impotsAnnee / 12;
                            return `<td class="${sc.id === 'realiste' ? 'col-realiste' : ''}">
                                ${imp > 0 ? '−' : ''}${Math.round(imp).toLocaleString('fr-FR')} €
                            </td>`;
                        }).join('')}
                        <td></td>
                    </tr>
                    <tr class="row-result row-result--strong">
                        <td class="col-var">CF après impôt / mois</td>
                        ${scenarios.map((sc, i) => {
                            const r = results[i];
                            const cf = r.cfNetNet;
                            const color = cf >= 0 ? '#3FB950' : '#F85149';
                            return `<td class="${sc.id === 'realiste' ? 'col-realiste' : ''}" style="color:${color};font-weight:700">
                                ${cf >= 0 ? '+' : ''}${Math.round(cf).toLocaleString('fr-FR')} €
                            </td>`;
                        }).join('')}
                        <td></td>
                    </tr>
                </tbody>
            </table>
        </div>
        <p class="owned-sim-hint">Variables non renseignées → valeurs héritées de Acquisition et Post-achat</p>
    `;

    nodes.accSimulateurContent.querySelectorAll('[data-sc-id][data-var-key]').forEach(input => {
        input.addEventListener('change', () => {
            const id = state.activeOwnedAssetId;
            if (!id) return;
            let val;
            if (input.tagName === 'SELECT') {
                val = input.value;
            } else if (input.value === '') {
                val = undefined;
            } else {
                val = Number(input.value);
            }
            updateOwnedScenarioVar(id, input.dataset.scId, input.dataset.varKey, val);
            const fresh = getOwnedAsset(id);
            renderOwnedSynthese(fresh);
            renderOwnedVerdictBlock(fresh);
            renderOwnedCfTable(fresh);
            renderAccordionSimulateur(fresh);
        });
    });

    nodes.accSimulateurContent.querySelectorAll('[data-sc-nom]').forEach(input => {
        input.addEventListener('change', () => {
            const id = state.activeOwnedAssetId;
            if (!id) return;
            updateOwnedScenarioNom(id, input.dataset.scNom, input.value.trim() || 'Sans nom');
        });
    });

    nodes.accSimulateurContent.querySelector('.owned-sim-add-btn')?.addEventListener('click', () => {
        const id = state.activeOwnedAssetId;
        if (!id) return;
        addOwnedScenario(id);
        renderAccordionSimulateur(getOwnedAsset(id));
    });

    nodes.accSimulateurContent.querySelectorAll('.owned-sim-delete-sc').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = state.activeOwnedAssetId;
            if (!id) return;
            deleteOwnedScenario(id, btn.dataset.scId);
            renderAccordionSimulateur(getOwnedAsset(id));
        });
    });
}

async function callOwnedDiagnosticIA(assetId) {
    const asset = getOwnedAsset(assetId);
    if (!asset) return;
    const tmi = getOwnedTmi();

    const scenarios = asset.scenarios.map(sc => {
        const r = computeOwnedAssetCF(asset, sc.variables, tmi);
        return { nom: sc.nom, cfNetNet: Math.round(r.cfNetNet) };
    });

    const payload = {
        bien: {
            nom: asset.nom,
            ville: asset.ville,
            anneeAchat: asset.anneeAchat,
            acquisition: asset.acquisition,
            postAchat: {
                taxeFonciere: asset.postAchat?.taxeFonciere,
                chargesCopro: asset.postAchat?.chargesCopro,
                travaux: (asset.postAchat?.travaux || []).map(t => ({
                    date: t.date, description: t.description, montant: t.montant, tag: t.tag
                })),
                notes: (asset.postAchat?.notes || []).map(n => ({ text: n.text }))
            },
            scenarios,
            profilFiscal: { tmi }
        }
    };

    if (!nodes.ownedAiDrawer || !nodes.ownedAiOverlay || !nodes.ownedAiDrawerContent) return;

    nodes.ownedAiDrawerContent.innerHTML = `<p style="color:var(--text-secondary);text-align:center;padding:24px">Analyse en cours…</p>`;
    void nodes.ownedAiDrawer.offsetWidth;
    nodes.ownedAiDrawer.classList.add('is-open');
    nodes.ownedAiOverlay.classList.add('is-open');

    try {
        const resp = await fetch('/api/portfolio-diagnostic', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await resp.json();

        if (!resp.ok || data.error) {
            nodes.ownedAiDrawerContent.innerHTML = `<p style="color:#F85149;padding:16px">${escapeHtml(data.error || 'Erreur inconnue')}</p>`;
            return;
        }

        const recs = data.recommendations || [];
        const now = new Date().toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });

        nodes.ownedAiDrawerContent.innerHTML = `
            <p style="font-size:.75rem;color:var(--text-tertiary);margin-bottom:16px">Analyse du ${now}</p>
            ${recs.map((r, i) => `
                <div style="border:1px solid var(--border-subtle);border-radius:8px;padding:14px;margin-bottom:10px">
                    <div style="font-weight:700;font-size:.9rem;color:var(--text-primary);margin-bottom:6px">${i + 1}. ${escapeHtml(r.title)}</div>
                    <p style="font-size:.83rem;color:var(--text-secondary);line-height:1.5;margin:0 0 8px">${escapeHtml(r.explanation)}</p>
                    <div style="font-size:.78rem;color:var(--accent-gold,#C5A059)">→ ${escapeHtml(r.action)}</div>
                </div>
            `).join('')}
        `;

        updateOwnedAsset(assetId, { lastDiagnostic: { date: new Date().toISOString(), recommendations: recs } });

    } catch (err) {
        nodes.ownedAiDrawerContent.innerHTML = `<p style="color:#F85149;padding:16px">Erreur réseau : ${escapeHtml(err.message)}</p>`;
    }
}

function renderCollections() {
    if (IS_ANALYSIS_WINDOW) {
        nodes.collectionPanel.hidden = true;
        return;
    }
    nodes.collectionPanel.hidden = false;

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
    buildCashflowTable(analysisModel.cashflowTable);
    buildAnalysisSummary(analysisModel, tmi, parts, composition);
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
    nodes.saveAsset.addEventListener('click', () => {
        const statut = state.variablesData['statut-bien'];
        createOrUpdateCurrentAsset(statut === 'owned' ? { inPortfolio: true } : { inComparison: true });
    });
    nodes.exportDecisionPdf.addEventListener('click', handleDecisionSummaryExport);
    if (nodes.portfolioAssetGridOwned) nodes.portfolioAssetGridOwned.addEventListener('click', handlePortfolioCardAction);
    if (nodes.portfolioAssetGridPipeline) nodes.portfolioAssetGridPipeline.addEventListener('click', handlePortfolioCardAction);
    document.getElementById('credit-drawer-close')?.addEventListener('click', closeCreditDrawer);
    document.getElementById('credit-drawer-cancel')?.addEventListener('click', closeCreditDrawer);
    document.getElementById('credit-drawer-form')?.addEventListener('submit', handleCreditDrawerSave);
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

