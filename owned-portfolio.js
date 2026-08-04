// Module Portefeuille biens detenus — CRUD (ownedAssets, localStorage), rendu (liste, fiche detail,
// onglets Acquisition/Exploitation/Travaux/Projection) et evenements. Extrait de main.js (axe 3).
//
// Interface : initOwnedPortfolio(deps) doit etre appelee en tout premier (avant le premier render()),
// avec { state, nodes, STORAGE_KEYS, IS_ANALYSIS_WINDOW, IS_MOBILE_PAGE } (les memes objets partages
// que main.js, passes par reference) — renderCollections() en depend des le premier rendu.
// IS_MOBILE_PAGE (true depuis owned-entry.js, false depuis main.js) fait sauter dashboard/carte/
// graphiques/comparaison regimes/diagnostic IA dans le rendu, pour ne garder sur owned.html (page
// iPhone) que la saisie/edition d'un bien + le detail du calcul du CF net-net. initOwnedPortfolioEvents()
// cable les listeners persistants et doit etre appelee separement, au meme moment que dans main.js
// avant l'extraction (apres le rendu initial). renderCollections() est ensuite appelee a chaque cycle
// de rendu par main.js.

import {
    computeOwnedAssetCF, computeOwnedAssetTimeline, computeAmortizationSchedule,
    computePatrimoineNet, computeEndettementGlobal, computeCapaciteEmprunt, getOptimalRegime,
    computeRevenusLocatifsBruts, computeCompteResultat, computePortfolioAlerts,
    computeSimulationTravaux, computeCFBreakdown, computeRegimeComparison, resolveLoyerVacance,
    computeDeclaration2044, parseDateAchat, computeDeficitFoncierHistorique,
    computeRevenuFoncierPortefeuille, computeImpotFoyer, resolveRevenuFoyer, resolveTmiFoyer
} from './calculs.js';
import { escapeHtml, showToast, formatSignedCurrency, formatCompactCurrency } from './utils.js';
import {
    watchAuth, cloudSignIn, watchOwnedAssets, cloudSetAsset, cloudDeleteAssetDoc,
    watchPortfolioMeta, cloudSaveMeta, cloudUploadDocument, cloudUploadDocumentAs, cloudDocumentUrl,
    cloudDeleteDocument, cloudDeleteAllDocuments, cloudGeocode, cloudExtraireFraisFacture
} from './owned-cloud.js';

let state, nodes, STORAGE_KEYS, IS_ANALYSIS_WINDOW, IS_MOBILE_PAGE;

// Affichage de dateAchat ('YYYY-MM', voir parseDateAchat dans calculs.js) au format français MM/YYYY.
// Accepte aussi une année brute (biens saisis avant l'ajout du mois précis) : affichée telle quelle.
function formatDateAchat(dateAchat) {
    if (typeof dateAchat === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(dateAchat)) {
        const [annee, mois] = dateAchat.split('-');
        return `${mois}/${annee}`;
    }
    return dateAchat ? String(dateAchat) : '';
}

// Cache local tenu a jour par les abonnements temps reel Firestore (onSnapshot). loadOwnedAssets()/
// loadPortfolioGoals() le lisent de facon synchrone (comme avant, quand la source etait localStorage) ;
// saveOwnedAssets()/savePortfolioGoals() l'ecrivent de facon optimiste puis poussent un diff vers
// Firestore en arriere-plan (fire-and-forget) — voir _initCloudSync.
let _assetsCache = {};
let _metaCache = {};
let _authUser = null;
let _cloudLoaded = false; // premier snapshot ownedAssets recu depuis la connexion
let _metaLoaded = false; // premier snapshot portfolioMeta (regime/profil/ordre) recu depuis la connexion

export function initOwnedPortfolio(deps) {
    state = deps.state;
    nodes = deps.nodes;
    STORAGE_KEYS = deps.STORAGE_KEYS;
    IS_ANALYSIS_WINDOW = deps.IS_ANALYSIS_WINDOW;
    IS_MOBILE_PAGE = !!deps.IS_MOBILE_PAGE;
    _initCloudSync();
}

// Un seul compte Firebase pour tout le portefeuille (PC + iPhone) ; tant que personne n'est
// connecte, renderCollections() affiche la grille de connexion (_renderAuthGate) a la place.
let _unsubAssets = null, _unsubMeta = null;
function _initCloudSync() {
    watchAuth(user => {
        _authUser = user;
        if (_unsubAssets) { _unsubAssets(); _unsubAssets = null; }
        if (_unsubMeta) { _unsubMeta(); _unsubMeta = null; }
        if (!user) {
            _assetsCache = {};
            _metaCache = {};
            _cloudLoaded = false;
            _metaLoaded = false;
            renderCollections();
            return;
        }
        _unsubAssets = watchOwnedAssets(map => {
            _assetsCache = map;
            _cloudLoaded = true;
            renderCollections();
        }, () => showToast('Connexion au portefeuille cloud impossible — vérifiez votre connexion internet', 'negative'));
        _unsubMeta = watchPortfolioMeta(meta => {
            _metaCache = meta || {};
            _metaLoaded = true;
            if (_metaCache.order) state.ownedOrder = _metaCache.order;
            if (_metaCache.regime) state.ownedRegime = _metaCache.regime;
            // Profil du foyer (income/adults/children, seuls champs qui pilotent le TMI donc les
            // impots dans le CF net-net) : synchronise via Firestore comme order/regime, pour que
            // owned.html (iPhone, sans formulaire Profil) calcule le meme CF net-net apres impot
            // que index.html (PC, seul endroit ou le profil s'edite). Voir syncProfileToCloud().
            if (_metaCache.profile) {
                state.profileData = { ...state.profileData, ...(_metaCache.profile) };
            } else if (state.profileConfigured) {
                // Bootstrap : le cloud n'a encore jamais recu de profil (premiere connexion depuis
                // ce mecanisme), mais celui-ci est deja configure localement (PC uniquement —
                // owned-entry.js/owned.html ne pose jamais profileConfigured=true) -> on le pousse.
                syncProfileToCloud();
            }
            renderCollections();
        }, () => {});
    });
}

// Pousse le profil du foyer vers Firestore, pour que owned.html (iPhone) reste aligne sur celui
// saisi sur index.html (PC) — desormais editable des deux cotes via l'onglet Profil (voir
// renderOwnedProfilTab), donc synchronise dans son integralite (pas seulement income/adults/
// children comme avant l'ajout du revenu historise) : nom, revenus (historique), composition du
// foyer, objectifs, et autres credits (utilises par le taux d'endettement global).
// Appelee par main.js->saveProfileData() et par saveOwnedProfileData() (onglet Profil) a chaque
// sauvegarde ; no-op si non connecte (le profil reste alors purement local a l'appareil).
export function syncProfileToCloud() {
    if (!_authUser || !state?.profileData) return;
    const { name = '', income = 0, adults = 2, children = 0, revenuHistorique = [], objectifCF = 1000, revaloAnnuelle = 2, autresCredits = [] } = state.profileData;
    const profile = { name, income, adults, children, revenuHistorique, objectifCF, revaloAnnuelle, autresCredits };
    _metaCache = { ..._metaCache, profile };
    cloudSaveMeta({ profile }).catch(() => {});
}

export { initOwnedPortfolioEvents };

function loadOwnedAssets() {
    // Copie profonde jetable : tout le fichier mute librement l'objet retourne puis appelle
    // saveOwnedAssets() pour committer — reproduit exactement le contrat de l'ancien
    // JSON.parse(localStorage...) qui recreait deja un objet frais a chaque appel.
    return JSON.parse(JSON.stringify(_assetsCache));
}

function saveOwnedAssets(assets) {
    const prev = _assetsCache;
    _assetsCache = assets;
    if (!_authUser) return;
    const ids = new Set([...Object.keys(prev), ...Object.keys(assets)]);
    for (const id of ids) {
        const had = id in prev, has = id in assets;
        if (has && (!had || JSON.stringify(prev[id]) !== JSON.stringify(assets[id]))) {
            cloudSetAsset(id, assets[id]).catch(() => showToast('Échec de synchronisation — modification non sauvegardée', 'negative'));
        } else if (had && !has) {
            cloudDeleteAssetDoc(id).catch(() => {});
        }
    }
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
        adresse: '',
        lat: null,
        lng: null,
        dateAchat: null,
        acquisition: {
            prix: 0, fraisAgence: 0, fraisNotaire: 0, loyerInitial: 0,
            surface: 0, typeBien: 'appartement',
            credit: { montant: 0, duree: 0, taux: 0, assurance: 0, assuranceMode: 'initial' }
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
    cloudDeleteAllDocuments(id).catch(() => {});
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

// Lots d'un immeuble de rapport — optionnel, n'existe que si l'utilisateur en ajoute (asset.lots).
// Un bien sans lots reste mono-lot : resolveLoyerVacance() (calculs.js) retombe sur acquisition.loyerInitial.
function addOwnedLot(assetId, lot) {
    const all = loadOwnedAssets();
    if (!all[assetId]) return;
    const entry = {
        id: `lot-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        nom: String(lot.nom || '').trim() || `Lot ${(all[assetId].lots || []).length + 1}`,
        loyer: Math.max(0, Number(lot.loyer) || 0),
        vacance: Math.max(0, Number(lot.vacance) || 0),
        locataire: String(lot.locataire || '').trim(),
    };
    all[assetId].lots = [...(all[assetId].lots || []), entry];
    saveOwnedAssets(all);
    return entry;
}

function updateOwnedLot(assetId, lotId, patch) {
    const all = loadOwnedAssets();
    if (!all[assetId]) return;
    all[assetId].lots = (all[assetId].lots || []).map(l => l.id === lotId ? { ...l, ...patch } : l);
    saveOwnedAssets(all);
}

function deleteOwnedLot(assetId, lotId) {
    const all = loadOwnedAssets();
    if (!all[assetId]) return;
    all[assetId].lots = (all[assetId].lots || []).filter(l => l.id !== lotId);
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
        commentaire: travail.commentaire || '',
        pdfFilename: travail.pdfFilename || null,
        credit: travail.credit || null,
        // Frais inclus dans l'enveloppe du crédit immobilier principal (pas payé cash) : reste
        // déductible fiscalement l'année où la dépense a eu lieu, mais n'est plus retranché du
        // cash-flow ici — la mensualité du crédit rembourse déjà cette part au fil des années
        // (calculs.js, resolveTravauxAnnee) ; sans quoi le montant serait décompté deux fois.
        financeParCredit: !!travail.financeParCredit
    };
    all[assetId].postAchat.travaux.push(entry);
    saveOwnedAssets(all);
    return entry;
}

// Modifie un frais existant. Mêmes validations que addOwnedTravail ; le PDF joint
// (pdfFilename) n'est pas modifiable ici — supprimer/recréer le frais pour le changer.
function updateOwnedTravail(assetId, travailId, patch) {
    const all = loadOwnedAssets();
    if (!all[assetId]) return;
    const list = all[assetId].postAchat.travaux || [];
    const idx = list.findIndex(t => t.id === travailId);
    if (idx === -1) return;
    const current = list[idx];
    list[idx] = {
        ...current,
        date: patch.date ?? current.date,
        description: patch.description ?? current.description,
        montant: patch.montant != null ? Math.max(0, Number(patch.montant) || 0) : current.montant,
        tag: ['deductible', 'non-deductible', 'a-classifier'].includes(patch.tag) ? patch.tag : current.tag,
        commentaire: patch.commentaire ?? current.commentaire,
        // undefined = champ absent du patch, ne pas toucher ; null = retirer le justificatif.
        pdfFilename: patch.pdfFilename !== undefined ? patch.pdfFilename : current.pdfFilename,
        financeParCredit: patch.financeParCredit !== undefined ? !!patch.financeParCredit : current.financeParCredit
    };
    saveOwnedAssets(all);
    return list[idx];
}

function deleteOwnedTravail(assetId, travailId) {
    const all = loadOwnedAssets();
    if (!all[assetId]) return;
    const entry = (all[assetId].postAchat.travaux || []).find(t => t.id === travailId);
    all[assetId].postAchat.travaux = all[assetId].postAchat.travaux.filter(t => t.id !== travailId);
    saveOwnedAssets(all);
    if (entry?.pdfFilename) {
        cloudDeleteDocument(assetId, entry.pdfFilename).catch(() => {});
    }
}

async function uploadOwnedDocument(assetId, file) {
    return cloudUploadDocument(assetId, file);
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

// Historique du loyer : une entrée par prise d'effet ({ mois: 'YYYY-MM', montant }).
// La première entrée porte le loyer de départ et la date de début de location ; chaque
// augmentation/baisse ultérieure ajoute une entrée. La résolution à une date donnée
// (dernière entrée dont le mois est <= à la date) vit dans resolveLoyerVacance (calculs.js).
function addOwnedLoyerHistorique(assetId, entry) {
    const all = loadOwnedAssets();
    if (!all[assetId]) return;
    const post = all[assetId].postAchat || {};
    const list = (post.loyerHistorique || []).filter(e => e.mois !== entry.mois);
    list.push({ mois: entry.mois, montant: Math.max(0, Number(entry.montant) || 0) });
    list.sort((a, b) => a.mois.localeCompare(b.mois));
    updateOwnedPostAchat(assetId, { loyerHistorique: list });
}

function deleteOwnedLoyerHistorique(assetId, mois) {
    const all = loadOwnedAssets();
    if (!all[assetId]) return;
    const post = all[assetId].postAchat || {};
    updateOwnedPostAchat(assetId, { loyerHistorique: (post.loyerHistorique || []).filter(e => e.mois !== mois) });
}

// Géocode l'adresse d'un bien et mémorise lat/lng dessus, pour la carte du portefeuille.
// Le hint (élément DOM optionnel) donne le retour visuel pendant/après l'appel.
async function geocodeOwnedAsset(assetId, adresse, hintEl) {
    const clean = String(adresse || '').trim();
    if (!clean) {
        updateOwnedAsset(assetId, { lat: null, lng: null });
        if (hintEl) hintEl.textContent = '';
        renderOwnedMap();
        return;
    }
    if (hintEl) hintEl.textContent = 'Localisation en cours…';
    try {
        const json = await cloudGeocode(clean);
        const lat = json?.lat ?? null;
        const lng = json?.lng ?? null;
        updateOwnedAsset(assetId, { lat, lng });
        if (hintEl) {
            hintEl.textContent = lat != null
                ? '📍 Localisé sur la carte'
                : '⚠ Adresse non localisée — vérifiez l\'orthographe';
        }
        renderOwnedMap();
    } catch {
        if (hintEl) hintEl.textContent = '⚠ Localisation indisponible (hors ligne ?)';
    }
}

function loadPortfolioGoals() {
    return _metaCache.goals || {};
}
function savePortfolioGoals(goals) {
    _metaCache = { ..._metaCache, goals };
    if (_authUser) cloudSaveMeta({ goals }).catch(() => showToast('Échec de synchronisation des objectifs', 'negative'));
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



let _ownedModalEscWired = false;
function _wireOwnedModalEscape() {
    if (_ownedModalEscWired) return;
    _ownedModalEscWired = true;
    document.addEventListener('keydown', e => {
        if (e.key !== 'Escape') return;
        document.querySelectorAll('.owned-modal-overlay').forEach(m => { if (!m.hidden) m.hidden = true; });
    });
}

function _showOwnedModal(html, id = 'owned-generic-modal') {
    _wireOwnedModalEscape();
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
    const regime = getOwnedRegime();
    const { annee: anneeAchat } = parseDateAchat(asset.dateAchat);
    const currentYear = new Date().getFullYear();
    const annees = [];
    for (let y = anneeAchat; y <= currentYear; y++) annees.push(y);

    function renderCR(annee) {
        const cr = computeCompteResultat(asset, annee, state.profileData, regime);
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
                    <button class="btn btn--ghost" data-close-modal aria-label="Fermer">✕</button>
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
    const regime = getOwnedRegime();
    const currentYear = new Date().getFullYear();

    function renderSimu(montant, annee, deductible) {
        const sim = computeSimulationTravaux(asset, montant, annee, deductible, state.profileData, regime);
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
                <button class="btn btn--ghost" data-close-modal aria-label="Fermer">✕</button>
            </div>
            <div class="cr-section">
                <div class="owned-form-grid">
                    <label class="variables-field">
                        <span class="variables-label">Montant des travaux (€)</span>
                        <input class="variables-input" type="number" id="simu-montant" min="0" step="500" value="10000">
                    </label>
                    <label class="variables-field">
                        <span class="variables-label">Année de réalisation</span>
                        <input class="variables-input" type="number" id="simu-annee" min="${parseDateAchat(asset.dateAchat).annee}" max="${currentYear + 5}" value="${currentYear}">
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
    const revenusMens = resolveRevenuFoyer(state.profileData, new Date().getFullYear()) / 12;
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
                <button class="btn btn--ghost" data-close-modal aria-label="Fermer">✕</button>
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
                <button class="btn btn--ghost" data-close-modal aria-label="Fermer">✕</button>
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
    const anneeMin = assets.reduce((m, a) => Math.min(m, parseDateAchat(a.dateAchat).annee), currentYear);

    function buildRapport(annee) {
        if (!assets.length) return '<p style="color:var(--text-tertiary);text-align:center">Aucun bien dans le portefeuille.</p>';
        let totalValeur = 0, totalCRD = 0, totalLoyers = 0, totalCharges = 0, totalMens = 0, totalImpots = 0;
        const lignesBiens = [];

        for (const a of assets) {
            const acq = a.acquisition || {};
            const post = a.postAchat || {};
            const sc = getOwnedDefaultScenario(a);
            const r = computeOwnedAssetCF(a, { ...sc.variables, regime }, tmi);
            const cr = computeCompteResultat(a, annee, state.profileData, regime);
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
            const { years } = computeOwnedAssetTimeline(a, state.profileData, regime);
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
                    <button class="btn btn--ghost" data-close-modal aria-label="Fermer">✕</button>
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

// ─── DÉCLARATION FISCALE ──────────────────────────────────────────────────────
// Pré-remplissage indicatif de la 2044 (foncier réel) — cf. computeDeclaration2044 (calculs.js) pour le
// mapping de cases (sourcé sur la notice DGFiP 2044-NOT-SD). Pour la SCI-IS, la vraie déclaration est le
// formulaire 2065 (liasse comptable avec amortissement de l'immeuble, pas un simple 2072) — l'app ne
// calcule pas cet amortissement comptable, donc pas de récap chiffré généré pour ce régime : on
// affiche une explication + recommandation expert-comptable plutôt qu'un mapping non fiabilisé.
function openDeclarationFiscaleModal() {
    const assets = Object.values(loadOwnedAssets()).filter(a => (a.acquisition?.prix || 0) > 0);
    const regime = getOwnedRegime();
    const currentYear = new Date().getFullYear();
    const anneeMin = assets.reduce((m, a) => Math.min(m, parseDateAchat(a.dateAchat).annee), currentYear);
    const annees = [];
    for (let y = Math.max(anneeMin, currentYear - 5); y <= currentYear; y++) annees.push(y);

    const DISCLAIMER = `⚠ Calcul indicatif basé sur vos données saisies — à vérifier avant télédéclaration. Ne remplace pas un professionnel (expert-comptable, centre des impôts). Source : notice DGFiP 2044-NOT-SD.`;

    function buildReel(annee) {
        if (!assets.length) return `<p style="color:var(--text-tertiary);text-align:center">Aucun bien avec un prix d'achat renseigné.</p>`;
        const decl = computeDeclaration2044(assets, annee, state.profileData);
        const fmt = v => v.toLocaleString('fr-FR') + ' €';
        return `<pre class="rapport-text">
═══════════════════════════════════════════
  DÉCLARATION 2044 — FONCIER RÉEL — ${annee}
═══════════════════════════════════════════
${DISCLAIMER}

PAR BIEN
${decl.lignes.map(l => `  ${escapeHtml(l.nom)}
    211 Loyers bruts encaissés              : ${fmt(l.case211)}
    221 Frais de gestion / agence           : ${fmt(l.case221)}
    222 Frais de gestion (forfait légal)    : ${fmt(l.case222)}
    223 Primes d'assurance (PNO)            : ${fmt(l.case223)}
    224 Travaux déductibles                 : ${fmt(l.case224)}
    227 Taxe foncière                       : ${fmt(l.case227)}
    229 Charges de copropriété              : ${fmt(l.case229)}
    250 Intérêts d'emprunt + assurance      : ${fmt(l.case250)}
    263 Résultat de l'immeuble              : ${l.case263 >= 0 ? '+' : ''}${fmt(l.case263)}`).join('\n\n')}

TOTAL PORTEFEUILLE
  420 Résultat foncier total (→ 2042 case 4BA si positif) : ${decl.case420 >= 0 ? '+' : ''}${fmt(decl.case420)}
${decl.deficit ? `
DÉFICIT FONCIER (résultat négatif)
  Déficit total                                          : -${fmt(decl.deficit.totalDeficit)}
  436 Imputable sur le revenu global (→ 2042 case 4BC)    : ${fmt(decl.deficit.imputableRevenuGlobal)}
       (plafond de droit commun : ${fmt(decl.deficit.plafond)}/an — peut être porté à 15 300 € ou 21 400 € sous conditions, non vérifiées ici)
  439 Report sur revenus fonciers des 10 ans suivants (→ 2042 case 4BB) : ${fmt(decl.deficit.reportFoncier10ans)}
` : ''}
POINTS À VÉRIFIER VOUS-MÊME
  · Case 227 : si votre taxe foncière saisie inclut la TEOM (ordures ménagères), retirez-la — elle n'est pas déductible ici (charge récupérable sur le locataire).
  · Case 229/230 : la régularisation annuelle des provisions de charges de copropriété n'est pas gérée automatiquement.
  · Si un déficit a été imputé sur le revenu global une année donnée, le bien doit rester loué jusqu'au 31/12 de la 3ᵉ année suivante.
═══════════════════════════════════════════</pre>`;
    }

    const SCI_IS_MSG = `
        <div class="owned-alert owned-alert--info" style="margin-bottom:12px">
            Pour une SCI à l'IS, la déclaration à produire n'est <strong>pas le formulaire 2072</strong>
            (réservé aux sociétés immobilières non soumises à l'IS) mais le <strong>formulaire 2065</strong>,
            accompagné d'une liasse comptable complète (bilan, compte de résultat, tableau 2033 ou 2050-2059)
            incluant notamment l'<strong>amortissement comptable de l'immeuble</strong> — une donnée que
            l'application ne calcule pas aujourd'hui.
        </div>
        <p style="color:var(--text-secondary);font-size:.85rem">
            Générer un récapitulatif chiffré ici présenterait un risque d'erreur trop élevé sans ce calcul
            d'amortissement. Pour une SCI-IS, l'accompagnement d'un expert-comptable est recommandé pour
            l'établissement de la liasse fiscale.
        </p>`;

    const MICRO_MSG = `
        <div class="owned-alert owned-alert--info">
            En micro-foncier, aucun formulaire 2044 n'est requis : vos revenus fonciers bruts se déclarent
            directement sur la <strong>déclaration 2042, case 4BE</strong>. L'abattement forfaitaire de 30 %
            est appliqué automatiquement par l'administration — rien à recopier depuis cette application.
        </div>`;

    const modal = _showOwnedModal(`
        <div class="owned-modal owned-modal--wide">
            <div class="owned-modal-head">
                <div style="display:flex;align-items:center;gap:12px">
                    <h3 class="owned-modal-title">Déclaration fiscale</h3>
                    ${regime === 'reel' ? `<select id="decl-annee" class="variables-input" style="width:auto">
                        ${annees.map(y => `<option value="${y}" ${y === currentYear ? 'selected' : ''}>${y}</option>`).join('')}
                    </select>` : ''}
                </div>
                <div style="display:flex;gap:8px">
                    ${regime === 'reel' ? `<button class="btn btn--ghost btn--sm" id="decl-copy">⎘ Copier</button>` : ''}
                    <button class="btn btn--ghost" data-close-modal aria-label="Fermer">✕</button>
                </div>
            </div>
            <div id="decl-content">${regime === 'reel' ? buildReel(currentYear) : regime === 'sci-is' ? SCI_IS_MSG : MICRO_MSG}</div>
        </div>
    `, 'owned-declaration-modal');

    if (regime === 'reel') {
        modal.querySelector('#decl-annee')?.addEventListener('change', e => {
            const c = modal.querySelector('#decl-content');
            if (c) c.innerHTML = buildReel(Number(e.target.value));
        });
        modal.querySelector('#decl-copy')?.addEventListener('click', () => {
            const pre = modal.querySelector('.rapport-text');
            if (pre) navigator.clipboard?.writeText(pre.textContent);
            showToast('Récapitulatif copié dans le presse-papiers', 'success');
        });
    }
}

// ─── ONGLET IMPÔT (vue liste) ────────────────────────────────────────────────
// Reprend le revenu salarial du profil (déjà net imposable, après abattement 10 % — saisi tel quel
// par l'utilisateur) + le revenu foncier imposable du portefeuille, et calcule l'IR au barème
// progressif tranche par tranche (computeImpotFoyer, calculs.js) — pas juste la TMI en taux plat.
function renderOwnedImpotTab() {
    const el = document.getElementById('owned-impot-content');
    if (!el) return;

    const assets = Object.values(loadOwnedAssets()).filter(a => (a.acquisition?.prix || 0) > 0);
    const regime = getOwnedRegime();
    const foyer = { adults: state.profileData?.adults || 2, children: state.profileData?.children || 0 };
    const currentYear = new Date().getFullYear();
    const anneeMin = assets.length
        ? assets.reduce((m, a) => Math.min(m, parseDateAchat(a.dateAchat).annee), currentYear)
        : currentYear;
    const annees = [];
    for (let y = Math.max(anneeMin, currentYear - 5); y <= currentYear; y++) annees.push(y);

    const fmt = v => Math.round(v).toLocaleString('fr-FR') + ' €';
    const REGIME_LABEL = { 'micro-foncier': 'Micro-foncier', 'reel': 'Foncier réel', 'sci-is': 'SCI à l\'IS' };

    function build(annee) {
        // Revenu salarial résolu pour l'ANNÉE VISÉE par le sélecteur (pas le revenu actuel) :
        // cet onglet reconstruit l'impôt d'une année fiscale précise, voir revenuHistorique.
        const revenuSalarial = resolveRevenuFoyer(state.profileData, annee);
        if (!revenuSalarial && !assets.length) {
            return `<p style="color:var(--text-tertiary);text-align:center">Renseignez vos revenus salariaux (onglet Profil) et au moins un bien avec un prix d'achat pour voir l'estimation.</p>`;
        }
        const foncier = computeRevenuFoncierPortefeuille(assets, annee, state.profileData, regime);
        const impot = computeImpotFoyer(revenuSalarial, foncier.revenuFoncierImposable, foyer);

        const trancheRows = impot.tranches.map(t => `
            <tr>
                <td>${fmt(t.seuilBas)} – ${t.seuilHaut !== null ? fmt(t.seuilHaut) : '∞'}</td>
                <td>${t.taux} %</td>
                <td>${fmt(t.montantImposable)}</td>
                <td>${fmt(t.impot)}</td>
            </tr>`).join('');

        return `
            <div class="owned-alert owned-alert--info">
                ⚠ Estimation indicative basée sur vos données saisies — barème IR ${annee} appliqué tranche par tranche, décote incluse.
                Ne prend pas en compte : autres revenus (dividendes, BIC…), autres crédits/réductions d'impôt, cas particuliers de plafonnement (parent isolé, invalidité, veuvage).
                Ne remplace pas votre avis d'imposition réel.
            </div>

            <div class="owned-dashboard-kpis">
                <div class="owned-dashboard-kpi">
                    <span class="owned-dashboard-kpi__label">Revenu salarial net imposable</span>
                    <span class="owned-dashboard-kpi__value">${fmt(impot.revenuSalarial)}</span>
                </div>
                <div class="owned-dashboard-kpi">
                    <span class="owned-dashboard-kpi__label">Revenu foncier imposable (${REGIME_LABEL[regime]})</span>
                    <span class="owned-dashboard-kpi__value owned-dashboard-kpi__value--${impot.revenuFoncierImposable >= 0 ? 'positive' : 'negative'}">${impot.revenuFoncierImposable >= 0 ? '+' : ''}${fmt(impot.revenuFoncierImposable)}</span>
                </div>
                <div class="owned-dashboard-kpi">
                    <span class="owned-dashboard-kpi__label">Revenu net global imposable</span>
                    <span class="owned-dashboard-kpi__value">${fmt(impot.revenuGlobal)}</span>
                </div>
                <div class="owned-dashboard-kpi">
                    <span class="owned-dashboard-kpi__label">Total estimé à payer</span>
                    <span class="owned-dashboard-kpi__value owned-dashboard-kpi__value--negative">${fmt(impot.total)}</span>
                </div>
            </div>

            ${regime === 'reel' && foncier.lignes.length ? `
            <div class="owned-cf-table-wrap">
                <div class="owned-cf-table">
                    <div class="owned-cf-table__title">Détail des revenus fonciers par bien</div>
                    <div class="owned-cf-table__scroll">
                        <table>
                            <thead><tr><th>Bien</th><th>Loyers bruts</th><th>Résultat net</th></tr></thead>
                            <tbody>
                                ${foncier.lignes.map(l => `<tr><td>${escapeHtml(l.nom)}</td><td>${fmt(l.case211)}</td><td class="${l.case263 >= 0 ? 'positive' : 'negative'}">${l.case263 >= 0 ? '+' : ''}${fmt(l.case263)}</td></tr>`).join('')}
                            </tbody>
                        </table>
                    </div>
                    ${foncier.deficit ? `<div class="owned-cf-table__note">Déficit foncier de ${fmt(foncier.deficit.totalDeficit)} : ${fmt(foncier.deficit.imputableRevenuGlobal)} imputable sur le revenu global cette année (plafond 10 700 €), ${fmt(foncier.deficit.reportFoncier10ans)} reporté sur les revenus fonciers des 10 prochaines années.</div>` : ''}
                </div>
            </div>` : ''}

            ${regime === 'sci-is' ? `
            <div class="owned-alert owned-alert--info">
                En SCI à l'IS, le résultat foncier est taxé séparément à l'impôt sur les sociétés (formulaire 2065, avec amortissement comptable de l'immeuble — non calculé par l'application, voir « Déclaration fiscale ») — il n'entre pas dans le calcul de votre IR personnel ci-dessus, sauf distribution de dividendes (non gérée ici).
            </div>` : ''}

            <div class="owned-cf-table-wrap">
                <div class="owned-cf-table">
                    <div class="owned-cf-table__title">Calcul de l'IR — barème progressif ${annee}</div>
                    <div class="owned-cf-table__note">Quotient familial : ${fmt(impot.revenuGlobal)} ÷ ${impot.parts} part${impot.parts > 1 ? 's' : ''} = ${fmt(impot.quotient)}</div>
                    <div class="owned-cf-table__scroll">
                        <table>
                            <thead><tr><th>Tranche</th><th>Taux</th><th>Montant imposé</th><th>Impôt</th></tr></thead>
                            <tbody>${trancheRows}</tbody>
                        </table>
                    </div>
                    ${impot.plafonnementQF?.applique ? `
                    <div class="owned-cf-table__note">
                        ⚠ Plafonnement du quotient familial appliqué : l'avantage lié à vos parts enfants (${fmt(impot.plafonnementQF.avantage)}) dépasse le plafond légal (${fmt(impot.plafonnementQF.plafond)}) — IR brut recalculé sans ce plafonnement aurait été ${fmt(impot.plafonnementQF.irBrutSansPlafonnement)}.
                    </div>` : ''}
                    <div class="owned-cf-table__note">
                        IR brut (× ${impot.parts} part${impot.parts > 1 ? 's' : ''}) = ${fmt(impot.irBrut)}
                        · Décote = − ${fmt(impot.decote)}
                        · <strong>IR net = ${fmt(impot.irNet)}</strong>
                        · Prélèvements sociaux fonciers (17,2 % sur le résultat foncier positif) = ${fmt(impot.psFoncier)}
                        · <strong>Total = ${fmt(impot.total)}</strong>
                    </div>
                </div>
            </div>
        `;
    }

    el.innerHTML = `
        <div class="owned-impot-head" style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
            <div class="owned-section-title" style="margin:0">Impôt sur le revenu du foyer</div>
            <select id="owned-impot-annee" class="variables-input" style="width:auto">
                ${annees.map(y => `<option value="${y}" ${y === currentYear ? 'selected' : ''}>${y}</option>`).join('')}
            </select>
        </div>
        <div id="owned-impot-body">${build(currentYear)}</div>
    `;
    el.querySelector('#owned-impot-annee')?.addEventListener('change', e => {
        const body = el.querySelector('#owned-impot-body');
        if (body) body.innerHTML = build(Number(e.target.value));
    });
}

// ─── ONGLET PROFIL (revenus historisés + composition du foyer) ──────────────
// Remplace la modale Profil pour toute édition courante (PC et téléphone) — la modale ne sert plus
// qu'au tout premier remplissage (onboarding), voir main.js. Persistance identique à
// main.js:saveProfileData() (localStorage + sync cloud) pour rester cohérent entre les deux points
// d'entrée : les champs simples partagent le même state.profileData que la modale.
function saveOwnedProfileData() {
    localStorage.setItem(STORAGE_KEYS.profileData, JSON.stringify(state.profileData));
    syncProfileToCloud();
}

function addOwnedRevenuHistorique(entry) {
    const list = (state.profileData.revenuHistorique || []).filter(e => e.annee !== entry.annee);
    list.push({ annee: entry.annee, revenu: Math.max(0, Number(entry.revenu) || 0) });
    list.sort((a, b) => a.annee - b.annee);
    state.profileData = { ...state.profileData, revenuHistorique: list };
    saveOwnedProfileData();
}

function deleteOwnedRevenuHistorique(annee) {
    state.profileData = {
        ...state.profileData,
        revenuHistorique: (state.profileData.revenuHistorique || []).filter(e => e.annee !== annee)
    };
    saveOwnedProfileData();
}

function addOwnedAutreCredit(entry) {
    const credits = [...(state.profileData.autresCredits || [])];
    credits.push({ id: `credit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, libelle: entry.libelle, mensualite: Math.max(0, Number(entry.mensualite) || 0) });
    state.profileData = { ...state.profileData, autresCredits: credits };
    saveOwnedProfileData();
}

function deleteOwnedAutreCredit(id) {
    state.profileData = {
        ...state.profileData,
        autresCredits: (state.profileData.autresCredits || []).filter(c => c.id !== id)
    };
    saveOwnedProfileData();
}

function renderOwnedProfilTab() {
    const el = document.getElementById('owned-profil-content');
    if (!el) return;

    const pd = state.profileData || {};
    const anneeCourante = new Date().getFullYear();
    const revenuHistorique = [...(pd.revenuHistorique || [])].sort((a, b) => b.annee - a.annee);
    const revenuActuel = resolveRevenuFoyer(pd, anneeCourante);
    const credits = pd.autresCredits || [];

    el.innerHTML = `
        <div class="owned-section-title">Profil du foyer</div>
        <p class="owned-caveat">Pilote le TMI — donc l'impôt calculé pour tous les biens du portefeuille (dashboard, comptes de résultat, déclaration 2044, onglet Impôt).</p>

        <form class="owned-form-grid" data-form="profil-simple" style="margin-top:12px">
            <label class="variables-field">
                <span class="variables-label">Nom du profil</span>
                <input name="name" class="variables-input" type="text" value="${escapeHtml(pd.name || '')}" placeholder="ex : Notre foyer">
            </label>
            <label class="variables-field">
                <span class="variables-label">Adultes</span>
                <input name="adults" class="variables-input" type="number" min="1" max="2" value="${pd.adults ?? 2}">
            </label>
            <label class="variables-field">
                <span class="variables-label">Enfants à charge</span>
                <input name="children" class="variables-input" type="number" min="0" value="${pd.children ?? 0}">
            </label>
            <label class="variables-field">
                <span class="variables-label">Objectif CF mensuel (€)</span>
                <input name="objectifCF" class="variables-input" type="number" min="0" step="50" value="${pd.objectifCF ?? 1000}">
            </label>
            <label class="variables-field">
                <span class="variables-label">Revalorisation annuelle (%)</span>
                <input name="revaloAnnuelle" class="variables-input" type="number" min="0" step="0.5" value="${pd.revaloAnnuelle ?? 2}">
            </label>
            <button type="submit" class="btn btn--primary btn--sm" style="align-self:end">Enregistrer</button>
        </form>

        <div class="owned-section-title" style="margin-top:20px">Revenus du foyer</div>
        <p class="owned-caveat">Une entrée s'applique à partir de son année et jusqu'à la suivante (même logique que le loyer d'un bien) — le TMI de chaque année passée reste donc celui du revenu de l'époque, pas celui d'aujourd'hui.</p>
        <div class="owned-loyer-actuel owned-revenu-actuel">
            <span class="owned-loyer-actuel__label">Revenu retenu pour ${anneeCourante}</span>
            <span class="owned-loyer-actuel__value owned-revenu-actuel__value">${Math.round(revenuActuel).toLocaleString('fr-FR')} €/an</span>
        </div>
        ${revenuHistorique.length ? `
        <div class="owned-charges-annuelles-list">
            ${revenuHistorique.map((e, idx) => `
                <div class="owned-charges-annuelles-row">
                    <span class="owned-charges-annuelles-row__year">${e.annee}</span>
                    <span class="owned-charges-annuelles-row__vals">
                        ${Math.round(e.revenu || 0).toLocaleString('fr-FR')} €/an
                        ${idx === revenuHistorique.length - 1 ? ' · <em>revenu de départ</em>' : ''}
                    </span>
                    <button class="owned-travaux-delete" data-delete-revenu-hist="${e.annee}" title="Supprimer" aria-label="Supprimer le revenu ${e.annee}">✕</button>
                </div>
            `).join('')}
        </div>` : `<p style="font-size:.82rem;color:var(--text-tertiary);font-style:italic">Aucune évolution enregistrée — le revenu ci-dessus s'applique à toutes les années.</p>`}
        <form class="owned-loyers-form" data-form="add-revenu-hist" novalidate>
            <input type="number" name="revenu" class="variables-input" placeholder="Revenu €/an" min="0" step="500" required style="flex:1;min-width:120px">
            <label class="owned-loyer-date-label">
                <span>à partir de</span>
                <input type="number" name="annee" class="variables-input" value="${anneeCourante}" min="2000" max="2100" required style="min-width:100px">
            </label>
            <button type="submit" class="btn btn--primary btn--sm">+ Ajouter</button>
        </form>

        <div class="owned-section-title" style="margin-top:20px">Autres crédits (hors immobilier)</div>
        <p class="owned-caveat">Ajoutés au taux d'endettement global et à la capacité d'emprunt résiduelle.</p>
        ${credits.length ? `
        <div class="owned-charges-annuelles-list">
            ${credits.map(c => `
                <div class="owned-charges-annuelles-row">
                    <span class="owned-charges-annuelles-row__year">${escapeHtml(c.libelle || 'Crédit')}</span>
                    <span class="owned-charges-annuelles-row__vals">${Math.round(c.mensualite || 0).toLocaleString('fr-FR')} €/mois</span>
                    <button class="owned-travaux-delete" data-delete-autre-credit="${escapeHtml(c.id)}" title="Supprimer" aria-label="Supprimer ${escapeHtml(c.libelle || 'ce crédit')}">✕</button>
                </div>
            `).join('')}
        </div>` : `<p style="font-size:.82rem;color:var(--text-tertiary);font-style:italic">Aucun crédit hors immobilier enregistré.</p>`}
        <form class="owned-loyers-form" data-form="add-autre-credit" novalidate>
            <input type="text" name="libelle" class="variables-input" placeholder="ex : Crédit auto" required style="flex:1;min-width:120px">
            <input type="number" name="mensualite" class="variables-input" placeholder="Mensualité €/mois" min="0" step="10" required style="min-width:140px">
            <button type="submit" class="btn btn--primary btn--sm">+ Ajouter</button>
        </form>
    `;

    el.querySelector('[data-form="profil-simple"]')?.addEventListener('submit', e => {
        e.preventDefault();
        const fd = new FormData(e.target);
        state.profileData = {
            ...state.profileData,
            name: String(fd.get('name') || '').trim(),
            adults: Math.min(2, Math.max(1, Number(fd.get('adults')) || 2)),
            children: Math.max(0, Number(fd.get('children')) || 0),
            objectifCF: Math.max(0, Number(fd.get('objectifCF')) || 0),
            revaloAnnuelle: Math.max(0, Number(fd.get('revaloAnnuelle')) || 0)
        };
        saveOwnedProfileData();
        showToast('Profil enregistré');
        renderCollections();
    });

    el.querySelectorAll('[data-delete-revenu-hist]').forEach(btn => {
        btn.addEventListener('click', () => {
            deleteOwnedRevenuHistorique(Number(btn.dataset.deleteRevenuHist));
            showToast('Revenu supprimé');
            renderCollections();
        });
    });

    el.querySelector('[data-form="add-revenu-hist"]')?.addEventListener('submit', e => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const annee = Number(fd.get('annee'));
        if (!annee) return;
        addOwnedRevenuHistorique({ annee, revenu: Number(fd.get('revenu')) || 0 });
        showToast('Revenu enregistré');
        renderCollections();
    });

    el.querySelectorAll('[data-delete-autre-credit]').forEach(btn => {
        btn.addEventListener('click', () => {
            deleteOwnedAutreCredit(btn.dataset.deleteAutreCredit);
            showToast('Crédit supprimé');
            renderCollections();
        });
    });

    el.querySelector('[data-form="add-autre-credit"]')?.addEventListener('submit', e => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const libelle = String(fd.get('libelle') || '').trim();
        if (!libelle) return;
        addOwnedAutreCredit({ libelle, mensualite: Number(fd.get('mensualite')) || 0 });
        showToast('Crédit enregistré');
        renderCollections();
    });
}

// ─── DASHBOARD DIRIGEANT (vue liste) ─────────────────────────────────────────

function renderOwnedDashboard(list, profileData, regime) {
    if (IS_MOBILE_PAGE) return; // bloc desktop uniquement — voir renderOwnedVerdictBlock
    const wrap = document.getElementById('owned-dashboard-wrap');
    if (!wrap) return;

    if (!list.length) { wrap.innerHTML = ''; return; }

    // Taux courant (aujourd'hui) pour le CF total et les alertes CF/DSCR — computePortfolioAlerts
    // résout lui-même un TMI par année pour le déficit foncier historique (voir calculs.js).
    const tmi = resolveTmiFoyer(profileData, new Date().getFullYear());
    const revenusMens = resolveRevenuFoyer(profileData, new Date().getFullYear()) / 12;
    const endettement = computeEndettementGlobal(list, revenusMens, state.profileData?.autresCredits || []);
    const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 };
    const alerts = computePortfolioAlerts(list, profileData, regime, revenusMens)
        .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
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
                <button class="btn btn--ghost btn--sm" data-action="open-capacite">Capacité d'emprunt</button>
                <button class="btn btn--ghost btn--sm" data-action="open-objectifs">Objectifs</button>
                <button class="btn btn--ghost btn--sm" data-action="open-rapport">Rapport annuel</button>
                <button class="btn btn--ghost btn--sm" data-action="open-declaration">Déclaration fiscale</button>
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

        <!-- Ligne 2 : Centre d'actions -->
        ${alerts.length ? `
        <div class="owned-dashboard-alerts">
            <div class="owned-dashboard-section-title">Centre d'actions (${alerts.length})</div>
            ${alerts.map(a => `
            <div class="owned-dashboard-alert owned-dashboard-alert--${a.severity}">
                ${escapeHtml(a.msg)}
                ${a.assetId ? `<button class="btn btn--ghost btn--xs" data-action="go-asset" data-id="${escapeHtml(a.assetId)}" title="Voir le bien" aria-label="Voir le bien concerné">→</button>` : ''}
            </div>`).join('')}
        </div>` : '<div class="owned-dashboard-no-alerts">✓ Aucune action en attente sur le portefeuille</div>'}

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
    wrap.querySelectorAll('[data-action="open-declaration"]').forEach(btn => {
        btn.addEventListener('click', openDeclarationFiscaleModal);
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
                    saveOwnedAssets(existing);
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
    initOwnedQuickRail();
    initOwnedQuickFab();
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

// TMI "taux courant" (année en cours) — pour les fonctions qui répondent à « si ma situation
// actuelle se maintient » (computeOwnedAssetCF, cartes, KPI...), jamais pour une reconstruction
// d'année fiscale précise (celles-ci reçoivent state.profileData directement et résolvent le TMI
// de CHAQUE année visée elles-mêmes — voir resolveTmiFoyer, calculs.js).
function getOwnedTmi() {
    return resolveTmiFoyer(state.profileData, new Date().getFullYear());
}

function getOwnedRegime() {
    return state.ownedRegime || 'micro-foncier';
}

function setOwnedRegime(regime) {
    state.ownedRegime = regime;
    _metaCache = { ..._metaCache, regime };
    if (_authUser) cloudSaveMeta({ regime }).catch(() => {});
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
                if (fresh) { renderOwnedSynthese(fresh); renderOwnedCalculTab(fresh); }
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

// ─── Carte du portefeuille (Leaflet) ─────────────────────────────────────────
// Un marqueur par bien géocodé (asset.lat/lng, alimentés par geocodeOwnedAsset).
// La carte est instanciée une seule fois puis réutilisée ; L vient de vendor/leaflet.

let _ownedMap = null;
let _ownedMapMarkers = null;

// Exportée pour main.js : le panneau Portefeuille peut être caché (display:none, autre onglet
// actif) au moment où Firestore livre les biens et où la carte s'initialise pour la première fois
// — Leaflet mesure alors un conteneur à 0x0 et ne charge que quelques tuiles. Le seul rattrapage
// interne (renderOwnedMap, plus bas) ne suffit pas si aucun second rendu ne survient pendant que
// le panneau redevient visible : il faut recalculer la taille au moment précis où l'onglet
// Portefeuille est cliqué, ce que seul main.js (propriétaire du wiring des onglets) peut détecter.
export function invalidateOwnedMap() {
    _ownedMap?.invalidateSize();
}

function _initOwnedMap() {
    if (_ownedMap || typeof L === 'undefined') return _ownedMap;
    const canvas = document.getElementById('owned-map');
    if (!canvas) return null;
    // Centre par défaut : France métropolitaine, remplacé par fitBounds dès qu'un bien est localisé.
    _ownedMap = L.map(canvas, { center: [46.6, 2.4], zoom: 5, scrollWheelZoom: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
    }).addTo(_ownedMap);
    _ownedMapMarkers = L.layerGroup().addTo(_ownedMap);
    return _ownedMap;
}

function renderOwnedMap(list = null) {
    if (IS_MOBILE_PAGE) return; // bloc desktop uniquement — voir renderOwnedVerdictBlock
    const section = document.getElementById('owned-map-section');
    if (!section) return;

    const assets = list || getOrderedAssetList();
    if (!assets.length) {
        section.hidden = true;
        return;
    }
    section.hidden = false;

    const emptyEl = document.getElementById('owned-map-empty');
    const unlocEl = document.getElementById('owned-map-unloc');
    const located = assets.filter(a => a.lat != null && a.lng != null);
    const missing = assets.length - located.length;

    if (emptyEl) {
        emptyEl.hidden = located.length > 0;
        if (!located.length) {
            emptyEl.textContent = 'Aucun bien localisé — renseignez l\'adresse complète de vos biens dans l\'onglet Acquisition pour les voir apparaître ici.';
        }
    }
    if (unlocEl) {
        unlocEl.textContent = (located.length && missing)
            ? `${missing} bien${missing > 1 ? 's' : ''} sans adresse — ajoutez-la dans l'onglet Acquisition pour ${missing > 1 ? 'les' : 'le'} placer sur la carte.`
            : '';
    }

    if (!located.length) return;
    if (!_initOwnedMap()) return;
    _ownedMapMarkers.clearLayers();

    const tmi = getOwnedTmi();
    const regime = getOwnedRegime();
    const bounds = [];

    for (const asset of located) {
        const sc = getOwnedDefaultScenario(asset);
        const cf = computeOwnedAssetCF(asset, sc.variables, tmi, regime);
        const positif = cf.cfNetNet >= 0;
        const marker = L.circleMarker([asset.lat, asset.lng], {
            radius: 10,
            fillColor: positif ? '#16a34a' : '#dc2626',
            fillOpacity: 0.85,
            color: '#fff',
            weight: 2,
        });

        const cfLabel = `${positif ? '+' : ''}${Math.round(cf.cfNetNet).toLocaleString('fr-FR')} €/mois`;
        marker.bindPopup(`
            <div class="owned-map-popup">
                <div class="owned-map-popup__title">${escapeHtml(asset.nom || 'Sans nom')}</div>
                <div class="owned-map-popup__meta">${escapeHtml(asset.ville || '')}</div>
                <div class="owned-map-popup__cf" style="color:${positif ? '#16a34a' : '#dc2626'}">
                    CF net-net : <strong>${cfLabel}</strong>
                </div>
                <button type="button" class="owned-map-popup__btn" data-map-open="${escapeHtml(asset.id)}">Voir le détail →</button>
            </div>
        `);
        marker.addTo(_ownedMapMarkers);
        bounds.push([asset.lat, asset.lng]);
    }

    if (bounds.length > 1) {
        _ownedMap.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    } else {
        _ownedMap.setView(bounds[0], 14);
    }
    // Leaflet calcule mal ses dimensions quand la section vient d'être révélée.
    setTimeout(() => _ownedMap?.invalidateSize(), 0);

    if (!section.dataset.mapWired) {
        section.dataset.mapWired = '1';
        section.addEventListener('click', e => {
            const btn = e.target.closest('[data-map-open]');
            if (btn) openOwnedDetail(btn.dataset.mapOpen);
        });
    }
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

    if (IS_MOBILE_PAGE) {
        // Ne PAS `return` ici : le branchement des onglets et le rendu de l'onglet Profil (plus bas
        // dans cette fonction, hors de ce bloc desktop-only) doivent aussi s'exécuter sur owned.html —
        // un `return` prématuré les court-circuitait entièrement, rendant l'onglet Profil totalement
        // inerte sur téléphone (aucune erreur, juste jamais câblé — bug remonté par l'utilisateur,
        // reproduit et diagnostiqué via Playwright le 2026-08-04, voir docs/superpowers/specs/).
        _renderOwnedListMobile(list);
    } else {
    renderOwnedMap(list);

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

            const sort = state.ownedSort; // { criterion: 'cf'|'rendement'|'dscr', dir: 'asc'|'desc' } | null
            const SORT_LABELS = { cf: 'CF net-net /mois', rendement: 'Rendement net', dscr: 'DSCR' };
            const sortSelectorHtml = `
                <div class="owned-sort-selector">
                    <label class="owned-sort-selector__label" for="owned-sort-select">Trier par</label>
                    <select id="owned-sort-select" class="owned-sort-selector__select">
                        <option value="manual"${!sort ? ' selected' : ''}>Ordre manuel</option>
                        ${Object.entries(SORT_LABELS).map(([key, label]) =>
                            `<option value="${key}"${sort?.criterion === key ? ' selected' : ''}>${label}${sort?.criterion === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</option>`
                        ).join('')}
                    </select>
                </div>`;

            // Métriques pré-calculées pour chaque bien (affichage + tri)
            const rowData = list.map(asset => {
                const { years: timeline } = computeOwnedAssetTimeline(asset, state.profileData, regime);
                const { annee: anneeAchat } = parseDateAchat(asset.dateAchat);
                const targetAbsYear = anneeAchat + yr - 1;
                const yearRow = timeline.find(y => y.year === targetAbsYear) || timeline[timeline.length - 1];
                const cfAnnuel = yearRow ? yearRow.cfAnnuel : 0;
                const cfMens = cfAnnuel / 12;

                // DSCR/rendement calculés pour la MÊME année ciblée que cfAnnuel (via computeCFBreakdown,
                // qui accepte un targetYear comme computeOwnedAssetTimeline) — pas via computeOwnedAssetCF,
                // qui reflète toujours aujourd'hui : sinon la colonne CF suit le sélecteur "Métriques en
                // An X" pendant que DSCR/Rendement restaient figés sur la situation actuelle, deux bases
                // temporelles différentes affichées côte à côte sur la même ligne (bug remonté par
                // l'utilisateur, 2026-08-03).
                const bd = computeCFBreakdown(asset, state.profileData, regime, yr);
                const investissementTotal = (asset.acquisition?.prix || 0) + (asset.acquisition?.fraisAgence || 0) + (asset.acquisition?.fraisNotaire || 0);
                const noiAnnuel = bd ? (bd.loyersEncaisses - bd.charges) : 0;
                const rentaNette = investissementTotal > 0 ? (noiAnnuel / investissementTotal) * 100 : 0;
                const dscr = bd && bd.mensualiteCredit > 0 ? noiAnnuel / bd.mensualiteCredit : 0;

                return { asset, cfMens, dscr, rentaNette, cfAnnuel, targetAbsYear };
            });

            if (sort) {
                const valueFor = row => sort.criterion === 'cf' ? row.cfMens : sort.criterion === 'rendement' ? row.rentaNette : row.dscr;
                rowData.sort((a, b) => (valueFor(a) - valueFor(b)) * (sort.dir === 'asc' ? 1 : -1));
            }

            const sortArrow = key => sort?.criterion === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '';
            const sortHeaderAttr = (key, tooltip) => `data-sort-header="${key}" role="button" tabindex="0" title="${tooltip ? tooltip + ' ' : ''}Trier par ${SORT_LABELS[key]}"`;

            nodes.ownedListTable.innerHTML = yearSelectorHtml + sortSelectorHtml + `
                <table>
                    <thead>
                        <tr>
                            <th class="owned-col-drag"></th>
                            <th></th>
                            <th>Bien</th>
                            <th style="text-align:right" class="owned-col-sortable" ${sortHeaderAttr('cf')}>CF net/mois${sortArrow('cf')}</th>
                            <th style="text-align:right" class="owned-col-hideable owned-col-sortable" ${sortHeaderAttr('rendement')}>Rendement net${sortArrow('rendement')}</th>
                            <th style="text-align:right" class="owned-col-hideable owned-col-sortable" ${sortHeaderAttr('dscr', 'DSCR : capacité de remboursement par le loyer (loyers ÷ mensualité crédit). Au-dessus de 1, le loyer couvre le crédit.')}>DSCR${sortArrow('dscr')}</th>
                            <th>Statut</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rowData.map(({ asset, cfMens, dscr, rentaNette, cfAnnuel, targetAbsYear }) => {
                            const cfTone = cfMens >= 0 ? 'positive' : 'negative';

                            // Alerte régime : comparer régime optimal an 1 vs an 5
                            const cmp = computeRegimeComparison(asset, state.profileData, [1, 5]);
                            const optAn1 = cmp.optimal[1];
                            const optAn5 = cmp.optimal[5];
                            const regimeAlertHtml = (optAn1 && optAn5 && optAn1 !== optAn5)
                                ? `<span class="owned-regime-alert" title="Régime optimal change en an 5">⚠ Régime an 5</span>`
                                : '';

                            // Donut inline SVG — loyer résolu à targetAbsYear (même année que cfAnnuel via
                            // resolveLoyerVacance, cohérent avec le sélecteur "Métriques en An X" ; sans ça
                            // le donut mélangeait le loyer d'AUJOURD'HUI avec un cfAnnuel d'une autre année).
                            const { loyer: loyerDonut, vacancePct: vacanceDonut } = resolveLoyerVacance(asset, String(targetAbsYear));
                            const recettes = Math.max(0, loyerDonut * 12 * (1 - vacanceDonut / 100));
                            const depenses = Math.max(0, recettes - cfAnnuel);
                            const total = recettes + depenses;
                            const donutHtml = total > 0 ? renderOwnedDonutSVG(recettes, depenses, cfMens >= 0) : '<div class="owned-donut-wrap"></div>';

                            const hasUnclassified = (asset.postAchat?.travaux || []).some(t => t.tag === 'a-classifier');
                            let statusTone, statusLabel;
                            if (cfMens < -50) {
                                statusTone = 'negative'; statusLabel = `CF ${Math.round(cfMens).toLocaleString('fr-FR')} €`;
                            } else if (dscr > 0 && dscr < 1) {
                                statusTone = 'negative'; statusLabel = `DSCR ${dscr.toFixed(2).replace('.', ',')}`;
                            } else if (dscr >= 1 && dscr < 1.1) {
                                statusTone = 'watch'; statusLabel = 'DSCR tendu';
                            } else if (hasUnclassified) {
                                statusTone = 'watch'; statusLabel = '⚠ Travaux';
                            } else {
                                statusTone = 'ras'; statusLabel = 'RAS';
                            }
                            const isExpanded = state.ownedExpandedIds.has(asset.id);
                            const mainRow = `
                            <tr data-asset-id="${escapeHtml(asset.id)}"${sort ? '' : ' draggable="true"'}>
                                <td class="owned-col-drag${sort ? ' owned-drag-handle--disabled' : ' owned-drag-handle'}" title="${sort ? 'Choisir « Ordre manuel » pour réordonner' : 'Glisser pour réordonner'}" role="button" aria-label="Glisser pour réordonner ${escapeHtml(asset.nom || 'le bien')}">⠿</td>
                                <td style="padding:6px 4px 6px 0;width:52px;display:flex;align-items:center;gap:4px">
                                    <button class="owned-expand-btn" data-expand-id="${escapeHtml(asset.id)}" title="Aperçu rapide" aria-label="${isExpanded ? 'Réduire' : 'Développer'} l'aperçu de ${escapeHtml(asset.nom || 'ce bien')}">${isExpanded ? '▾' : '▸'}</button>
                                    ${donutHtml}
                                </td>
                                <td>
                                    <div class="owned-table-name">${escapeHtml(asset.nom)}</div>
                                    <div class="owned-table-meta">${escapeHtml(asset.ville)}${asset.dateAchat ? ` · ${formatDateAchat(asset.dateAchat)}` : ''}${regimeAlertHtml ? ' ' + regimeAlertHtml : ''}</div>
                                </td>
                                <td class="owned-table-num owned-table-num--${cfTone}">
                                    ${cfMens >= 0 ? '+' : ''}${Math.round(cfMens).toLocaleString('fr-FR')} €
                                </td>
                                <td class="owned-table-num owned-col-hideable">${rentaNette.toFixed(1).replace('.', ',')} %</td>
                                <td class="owned-table-num owned-col-hideable">${dscr.toFixed(2).replace('.', ',')}</td>
                                <td>
                                    <span class="owned-status-badge owned-status-badge--${statusTone}">
                                        ${statusLabel}
                                    </span>
                                </td>
                                <td>
                                    <button class="btn btn--ghost btn--sm" data-action="delete-owned" data-id="${escapeHtml(asset.id)}" title="Supprimer" aria-label="Supprimer ${escapeHtml(asset.nom || 'le bien')}">✕</button>
                                </td>
                            </tr>
                            `;
                            const expandedRow = isExpanded ? `
<tr class="owned-expanded-row" data-expanded-for="${escapeHtml(asset.id)}">
    <td colspan="8">
        <div class="owned-expanded-content">
            <div class="owned-expanded-metric">
                <span class="owned-expanded-label">CF net/mois</span>
                <span class="owned-expanded-value owned-expanded-value--${cfTone}">${cfMens >= 0 ? '+' : ''}${Math.round(cfMens).toLocaleString('fr-FR')} €</span>
            </div>
            <div class="owned-expanded-metric">
                <span class="owned-expanded-label">Rendement net</span>
                <span class="owned-expanded-value">${rentaNette.toFixed(1)} %</span>
            </div>
            <div class="owned-expanded-metric">
                <span class="owned-expanded-label">DSCR</span>
                <span class="owned-expanded-value owned-expanded-value--${dscr >= 1.2 ? 'positive' : dscr >= 1 ? 'watch' : 'negative'}">${dscr.toFixed(2)}</span>
            </div>
            <div class="owned-expanded-metric">
                <span class="owned-expanded-label">Prix d'achat</span>
                <span class="owned-expanded-value">${(asset.acquisition?.prix || 0).toLocaleString('fr-FR')} €</span>
            </div>
            <div class="owned-expanded-metric">
                <span class="owned-expanded-label">Loyer initial</span>
                <span class="owned-expanded-value">${(asset.acquisition?.loyerInitial || 0).toLocaleString('fr-FR')} €/mois</span>
            </div>
            <button class="btn btn--ghost btn--sm" style="margin-left:auto" data-open-asset="${escapeHtml(asset.id)}">Ouvrir →</button>
        </div>
    </td>
</tr>` : '';
                            return mainRow + expandedRow;
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

            // Sort selector + sortable column headers
            const applyOwnedSort = criterion => {
                if (criterion === 'manual') {
                    state.ownedSort = null;
                } else if (state.ownedSort?.criterion === criterion) {
                    state.ownedSort = { criterion, dir: state.ownedSort.dir === 'asc' ? 'desc' : 'asc' };
                } else {
                    state.ownedSort = { criterion, dir: 'asc' };
                }
                localStorage.setItem(STORAGE_KEYS.ownedSort, JSON.stringify(state.ownedSort));
                renderOwnedPortfolioList();
            };
            const sortSelect = document.getElementById('owned-sort-select');
            if (sortSelect) {
                sortSelect.addEventListener('change', () => {
                    const val = sortSelect.value;
                    if (val === 'manual') {
                        state.ownedSort = null;
                    } else {
                        state.ownedSort = { criterion: val, dir: 'asc' };
                    }
                    localStorage.setItem(STORAGE_KEYS.ownedSort, JSON.stringify(state.ownedSort));
                    renderOwnedPortfolioList();
                });
            }
            nodes.ownedListTable.querySelectorAll('[data-sort-header]').forEach(th => {
                th.addEventListener('click', () => applyOwnedSort(th.dataset.sortHeader));
                th.addEventListener('keydown', e => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); applyOwnedSort(th.dataset.sortHeader); }
                });
            });

            nodes.ownedListTable.querySelectorAll('tr[data-asset-id]').forEach(row => {
                row.addEventListener('click', e => {
                    if (e.target.closest('[data-action]') || e.target.closest('.owned-year-btn') || e.target.closest('.owned-expand-btn')) return;
                    openOwnedDetail(row.dataset.assetId);
                });
            });

            nodes.ownedListTable.querySelectorAll('[data-action="delete-owned"]').forEach(btn => {
                btn.addEventListener('click', e => {
                    e.stopPropagation();
                    openOwnedDeleteModal(btn.dataset.id);
                });
            });

            // Expand row toggle
            nodes.ownedListTable.querySelectorAll('.owned-expand-btn').forEach(btn => {
                btn.addEventListener('click', e => {
                    e.stopPropagation();
                    const id = btn.dataset.expandId;
                    if (state.ownedExpandedIds.has(id)) {
                        state.ownedExpandedIds.delete(id);
                    } else {
                        state.ownedExpandedIds.add(id);
                    }
                    renderOwnedPortfolioList();
                });
            });

            // "Ouvrir →" button in expanded row
            nodes.ownedListTable.querySelectorAll('[data-open-asset]').forEach(btn => {
                btn.addEventListener('click', () => openOwnedDetail(btn.dataset.openAsset));
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
                        if (_authUser) cloudSaveMeta({ order: ids }).catch(() => {});
                        renderOwnedPortfolioList();
                    });
                });
            })();
        }
    }
    renderOwnedPortfolioCharts(list, state.profileData, regime);
    renderOwnedDashboard(list, state.profileData, regime);
    renderOwnedCfConsolidatedSection(list, tmi, regime);
    }

    // Le branchement du clic sur les onglets est fait AVANT de rendre le contenu des onglets
    // eux-mêmes (Profil/Impôt, juste après) : si l'un de ces rendus lève une exception sur une
    // forme de donnée imprévue, le clic reste fonctionnel pour tous les onglets au lieu d'être
    // silencieusement jamais câblé (bug remonté par l'utilisateur — clic sur "Profil" sans effet
    // sur owned.html, cause exacte non confirmée faute d'accès navigateur, corrigé par prudence).
    const listView = nodes.ownedListView;
    if (listView && !listView.dataset.tabWired) {
        listView.dataset.tabWired = '1';
        listView.addEventListener('click', e => {
            const btn = e.target.closest('.owned-list-tabs .owned-tab');
            if (!btn) return;
            const tabKey = btn.dataset.tab;
            listView.querySelectorAll('.owned-list-tabs .owned-tab').forEach(t => {
                t.classList.toggle('owned-tab--active', t === btn);
                t.setAttribute('aria-selected', t === btn ? 'true' : 'false');
            });
            listView.querySelectorAll(':scope > .owned-tab-panel').forEach(p => {
                p.hidden = p.id !== `owned-list-tab-${tabKey}`;
            });
        });
    }

    // Onglet Profil : PC et téléphone (l'utilisateur veut pouvoir mettre à jour ses revenus depuis
    // les deux). Onglet Impôt : reste PC uniquement, cohérent avec la simplification mobile du
    // 2026-07-28 (owned.html n'a pas de tableau de bord fiscal détaillé). Chacun protégé par
    // try/catch : une exception sur une forme de donnée imprévue ne doit dégrader que cet onglet,
    // jamais le reste du rendu ni le clic câblé juste au-dessus.
    try {
        renderOwnedProfilTab();
    } catch (err) {
        console.error('[Spark] renderOwnedProfilTab a échoué :', err);
    }
    if (!IS_MOBILE_PAGE) {
        try {
            renderOwnedImpotTab();
        } catch (err) {
            console.error('[Spark] renderOwnedImpotTab a échoué :', err);
        }
    }
}

// Vue liste smartphone (owned.html) : juste nom/ville/CF net-net par bien, tap pour ouvrir
// la fiche. Pas de tri, pas de glisser-déposer, pas de carte/graphiques/dashboard — cf. spec
// docs/superpowers/specs/2026-07-28-owned-mobile-simplification.md.
function _renderOwnedListMobile(list) {
    if (!nodes.ownedListTable) return;
    const tmi = getOwnedTmi();
    const regime = getOwnedRegime();

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
        return;
    }

    nodes.ownedListTable.innerHTML = `
        <div class="owned-mobile-list">
            ${list.map(asset => {
                const sc = getOwnedDefaultScenario(asset);
                const r = computeOwnedAssetCF(asset, sc.variables, tmi, regime);
                const cfMens = r.cfNetNet;
                const cfTone = cfMens >= 0 ? 'positive' : 'negative';
                const cfSign = cfMens >= 0 ? '+' : '−';
                return `
                <button type="button" class="owned-mobile-list__item" data-asset-id="${escapeHtml(asset.id)}">
                    <span class="owned-mobile-list__info">
                        <span class="owned-mobile-list__name">${escapeHtml(asset.nom || 'Sans nom')}</span>
                        <span class="owned-mobile-list__ville">${escapeHtml(asset.ville || '')}</span>
                    </span>
                    <span class="owned-mobile-list__cf owned-mobile-list__cf--${cfTone}">${cfSign}${Math.round(Math.abs(cfMens)).toLocaleString('fr-FR')} €<small>/mois</small></span>
                </button>`;
            }).join('')}
        </div>
    `;
    nodes.ownedListTable.querySelectorAll('[data-asset-id]').forEach(btn => {
        btn.addEventListener('click', () => openOwnedDetail(btn.dataset.assetId));
    });
}

function renderOwnedCfConsolidatedSection(list, tmi, regime) {
    if (IS_MOBILE_PAGE) return; // bloc desktop uniquement — voir renderOwnedVerdictBlock
    const wrap = document.getElementById('owned-portfolio-cf-consolidated');
    if (!wrap) return;
    if (!list.length) { wrap.innerHTML = ''; return; }

    // Le graphique "CF net cumulé — portefeuille" est déjà affiché par
    // renderOwnedPortfolioCharts() (Chart.js, #owned-portfolio-charts) juste au-dessus —
    // ne pas le redessiner ici en SVG (doublon même courbe, voir audit UX 2026-07).
    wrap.innerHTML = renderOwnedRepartitionBarHTML(list, tmi, regime);
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

// Sur mobile (owned.html), la modale #owned-add-modal existe encore. Sur PC (index.html), elle a été
// retirée le 2026-08-04 au profit du rail Actions rapides (#owned-quickrail) — openOwnedAddModal()
// reste le point d'entrée commun appelé par les CTA "état vide" (mobile + PC), et bascule vers le rail
// quand la modale est absente.
function openOwnedAddModal() {
    if (nodes.ownedAddModal) {
        nodes.ownedAddModal.hidden = false;
        nodes.ownedAddNom?.focus();
        return;
    }
    openOwnedQuickPanel('add-bien');
}

function closeOwnedAddModal() {
    if (!nodes.ownedAddModal) return;
    nodes.ownedAddModal.hidden = true;
    nodes.ownedAddForm?.reset();
}

// ─── Capture rapide d'une facture — briques partagées entre le rail PC (#owned-quickrail) et le
// bouton flottant mobile (#owned-quickfab), ajouté le 2026-08-04. Un "root" (le panneau du rail ou
// la modale mobile) doit contenir : un sélecteur [data-quick-asset-select], une dropzone
// [data-quick-dropzone]/[data-quick-dropzone-body]/[data-quick-file-input]/[data-quick-status], et un
// formulaire [data-quick-facture-form] avec des champs [data-quick-field="date|description|montant|tag"].
// Réutilise les mêmes briques que renderOwnedTravauxTab (TRAVAUX_ACCEPTED_MIME,
// cloudExtraireFraisFacture, addOwnedTravail) — un seul flux d'extraction IA, PC et mobile.
function _populateQuickAssetSelect(root) {
    const select = root?.querySelector('[data-quick-asset-select]');
    if (!select) return;
    const list = getOrderedAssetList();
    select.innerHTML = list.length
        ? list.map(a => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.nom)}</option>`).join('')
        : '<option value="" disabled selected>Aucun bien — ajoute-en un d\'abord</option>';
}

// Reste sur la vue courante après l'ajout (pas de navigation forcée) : si la fiche du bien concerné
// est déjà ouverte on la rafraîchit, sinon on rafraîchit la liste/dashboard visible.
function _refreshAfterQuickFacture(assetId) {
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

function _wireQuickFactureForm(root, onSubmitted) {
    let quickPendingFile = null;
    const dropzone = root.querySelector('[data-quick-dropzone]');
    const dropzoneBody = root.querySelector('[data-quick-dropzone-body]');
    const fileInput = root.querySelector('[data-quick-file-input]');
    const statusEl = root.querySelector('[data-quick-status]');
    const factureForm = root.querySelector('[data-quick-facture-form]');
    const fieldDate = factureForm?.querySelector('[data-quick-field="date"]');
    const fieldDesc = factureForm?.querySelector('[data-quick-field="description"]');
    const fieldMontant = factureForm?.querySelector('[data-quick-field="montant"]');
    const fieldTag = factureForm?.querySelector('[data-quick-field="tag"]');

    const resetQuickDropzone = () => {
        quickPendingFile = null;
        if (fileInput) fileInput.value = '';
        dropzone?.classList.remove('owned-travaux-dropzone--filled', 'owned-travaux-dropzone--dragover');
        if (dropzoneBody) dropzoneBody.hidden = false;
        if (statusEl) { statusEl.hidden = true; statusEl.className = 'owned-travaux-dropzone__status'; statusEl.textContent = ''; }
        [fieldDate, fieldDesc, fieldMontant].forEach(f => f?.classList.remove('ai-filled'));
    };

    const handleQuickFile = async file => {
        if (!TRAVAUX_ACCEPTED_MIME.includes(file.type)) {
            showToast('Format non supporté (PDF, JPG ou PNG uniquement)', 'negative');
            return;
        }
        quickPendingFile = file;
        if (dropzoneBody) dropzoneBody.hidden = true;
        dropzone?.classList.add('owned-travaux-dropzone--filled');
        if (statusEl) {
            statusEl.hidden = false;
            statusEl.className = 'owned-travaux-dropzone__status owned-travaux-dropzone__status--loading';
            statusEl.textContent = `📄 ${file.name} — lecture de la facture…`;
        }
        if (file.size > TRAVAUX_MAX_FILE_SIZE) {
            if (statusEl) {
                statusEl.className = 'owned-travaux-dropzone__status owned-travaux-dropzone__status--error';
                statusEl.textContent = `📄 ${file.name} — trop volumineux (max 8 Mo), remplis à la main`;
            }
            return;
        }
        try {
            const base64 = await _fileToBase64(file);
            const result = await cloudExtraireFraisFacture(base64, file.type);
            if (result.date && fieldDate) { fieldDate.value = result.date; fieldDate.classList.add('ai-filled'); }
            if (result.description && fieldDesc) { fieldDesc.value = result.description; fieldDesc.classList.add('ai-filled'); }
            if (result.montant > 0 && fieldMontant) { fieldMontant.value = result.montant; fieldMontant.classList.add('ai-filled'); }
            if (fieldTag) fieldTag.value = result.tagSuggestion || 'a-classifier';
            if (statusEl) {
                statusEl.className = 'owned-travaux-dropzone__status owned-travaux-dropzone__status--ok';
                statusEl.textContent = `📄 ${file.name} — ✓ pré-rempli`;
            }
        } catch {
            if (statusEl) {
                statusEl.className = 'owned-travaux-dropzone__status owned-travaux-dropzone__status--error';
                statusEl.textContent = `📄 ${file.name} — extraction impossible, remplis à la main`;
            }
            showToast('Extraction impossible, remplis le formulaire à la main', 'negative');
        }
    };

    dropzone?.addEventListener('click', () => fileInput?.click());
    dropzone?.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput?.click(); } });
    dropzone?.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('owned-travaux-dropzone--dragover'); });
    dropzone?.addEventListener('dragleave', () => dropzone.classList.remove('owned-travaux-dropzone--dragover'));
    dropzone?.addEventListener('drop', e => {
        e.preventDefault();
        dropzone.classList.remove('owned-travaux-dropzone--dragover');
        const file = e.dataTransfer.files?.[0];
        if (file) handleQuickFile(file);
    });
    fileInput?.addEventListener('change', () => {
        const file = fileInput.files?.[0];
        if (file) handleQuickFile(file);
        fileInput.value = '';
    });

    factureForm?.addEventListener('submit', async e => {
        e.preventDefault();
        const assetId = root.querySelector('[data-quick-asset-select]')?.value;
        if (!assetId) { showToast('Choisis un bien', 'negative'); return; }
        const date = fieldDate?.value;
        const description = fieldDesc?.value.trim();
        const montant = Number(fieldMontant?.value);
        if (!date || !description || !montant) { showToast('Date, description et montant sont requis', 'negative'); return; }
        let pdfFilename = null;
        if (quickPendingFile) {
            try {
                pdfFilename = await uploadOwnedDocument(assetId, quickPendingFile);
            } catch {
                showToast('Échec de l\'import du fichier', 'negative');
                return;
            }
        }
        addOwnedTravail(assetId, {
            date, description, montant,
            tag: fieldTag?.value || 'a-classifier',
            commentaire: '',
            pdfFilename,
            financeParCredit: false
        });
        factureForm.reset();
        resetQuickDropzone();
        showToast('Frais ajouté');
        onSubmitted(assetId);
    });

    return { reset: resetQuickDropzone };
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
    } else if (action === 'add-facture') {
        _populateQuickAssetSelect(rail);
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

    // ─── Ajouter une facture ──────────────────────────────────────────────────
    _wireQuickFactureForm(rail, assetId => {
        closeOwnedQuickPanels();
        _refreshAfterQuickFacture(assetId);
    });
}

// ─── Bouton flottant Actions rapides mobile (#owned-quickfab, absent d'index.html) ──────────────
// Équivalent mobile de "Ajouter une facture" du rail PC : visible partout sur owned.html (liste et
// fiche d'un bien), ouvre une modale plein écran plutôt qu'un panneau inline (écran trop étroit).
// Pas d'action "Ajouter un bien" ici : déjà accessible via le bouton existant de la Vue d'ensemble.
function initOwnedQuickFab() {
    const fab = document.getElementById('owned-quickfab');
    const modal = document.getElementById('owned-quickfab-modal');
    if (!fab || !modal) return; // absent sur index.html (PC) : voir initOwnedQuickRail

    const closeModal = () => modal.hidden = true;

    fab.addEventListener('click', () => {
        modal.hidden = false;
        _populateQuickAssetSelect(modal);
    });
    modal.querySelector('[data-quickcancel]')?.addEventListener('click', closeModal);
    modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

    _wireQuickFactureForm(modal, assetId => {
        closeModal();
        _refreshAfterQuickFacture(assetId);
    });
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

let _ownedTransitionTimer = null;

function openOwnedDetail(assetId) {
    state._listScrollY = window.scrollY;
    state.activeOwnedAssetId = assetId;
    // Initialiser chargesAnnuelles si vide à partir des valeurs plates existantes
    const _a = getOwnedAsset(assetId);
    if (_a) {
        const post = _a.postAchat || {};
        if (!post.chargesAnnuelles || post.chargesAnnuelles.length === 0) {
            const annee = parseDateAchat(_a.dateAchat).annee;
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
    if (_ownedTransitionTimer) { clearTimeout(_ownedTransitionTimer); _ownedTransitionTimer = null; }
    nodes.ownedListView.classList.add('owned-slide-out-left');
    _ownedTransitionTimer = setTimeout(() => {
        _ownedTransitionTimer = null;
        nodes.ownedListView.hidden = true;
        nodes.ownedListView.classList.remove('owned-slide-out-left');
        nodes.ownedDetailView.hidden = false;
        nodes.ownedDetailView.classList.add('owned-slide-in-right');
        renderOwnedDetail();
        setTimeout(() => nodes.ownedDetailView.classList.remove('owned-slide-in-right'), 200);
    }, 140);
}

function closeOwnedDetail() {
    state.activeOwnedAssetId = null;
    const navEl = document.getElementById('owned-detail-nav');
    if (navEl) navEl.remove();
    if (_ownedTransitionTimer) { clearTimeout(_ownedTransitionTimer); _ownedTransitionTimer = null; }
    nodes.ownedDetailView.classList.add('owned-slide-out-right');
    _ownedTransitionTimer = setTimeout(() => {
        _ownedTransitionTimer = null;
        nodes.ownedDetailView.hidden = true;
        nodes.ownedDetailView.classList.remove('owned-slide-out-right');
        nodes.ownedListView.hidden = false;
        nodes.ownedListView.classList.add('owned-slide-in-left');
        renderOwnedPortfolioList();
        setTimeout(() => nodes.ownedListView.classList.remove('owned-slide-in-left'), 200);
        requestAnimationFrame(() => {
            window.scrollTo({ top: state._listScrollY || 0, behavior: 'instant' });
        });
    }, 120);
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
            <div class="owned-detail-title__meta">${escapeHtml(asset.ville)}${asset.dateAchat ? ` · Acquis ${formatDateAchat(asset.dateAchat)}` : ''}</div>
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
        nodes.ownedDiagnosticBtn.hidden = IS_MOBILE_PAGE || !hasData;
        nodes.ownedDiagnosticBtn.disabled = !hasData;
    }

    renderOwnedRegimeSelector();
    // Version smartphone : saisie/édition d'un bien + onglet Calcul complet (indicateurs, détail CF,
    // comparatif régimes) — identique au PC depuis 2026-08-04. Pas de dashboard portefeuille, de
    // carte, de bloc Verdict ni de diagnostic IA sur mobile — cf. spec
    // docs/superpowers/specs/2026-08-04-onglet-calcul-portefeuille.md.
    renderOwnedSynthese(asset);
    renderOwnedCalculTab(asset);
    if (!IS_MOBILE_PAGE) {
        renderOwnedVerdictBlock(asset);
    }
    renderAccordionAcquisition(asset);
    renderAccordionPostAchat(asset);
    renderOwnedTravauxTab(asset);
    if (!IS_MOBILE_PAGE) {
        renderAccordionSimulateur(asset);
    }

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
    if (IS_MOBILE_PAGE) return; // bloc desktop uniquement
    const el = nodes.ownedVerdict || document.getElementById('owned-verdict');
    if (!el) return;
    const acq = asset.acquisition || {};
    const hasData = (acq.prix || 0) > 0;
    if (!hasData) { el.innerHTML = ''; return; }

    const regime = getOwnedRegime();
    const { annee: anneeAchat } = parseDateAchat(asset.dateAchat);
    const defaultYrVerdict = Math.max(1, new Date().getFullYear() - anneeAchat + 1);
    const yr = (state.ownedYearFilters?.[asset.id]) ?? defaultYrVerdict;
    const YEAR_OPTIONS = [1, 3, 5, 10];

    // Métriques selon l'année sélectionnée
    const { years: timeline } = computeOwnedAssetTimeline(asset, state.profileData, regime);
    const targetAbsYear = anneeAchat + yr - 1;
    const yearRow = timeline.find(y => y.year === targetAbsYear) || timeline[timeline.length - 1];
    const cfAnnuel = yearRow ? yearRow.cfAnnuel : 0;
    const cfNetNet = Math.round(cfAnnuel / 12);

    const effort = Math.max(0, -cfNetNet);

    const cfTone = cfNetNet > 0 ? 'positive' : cfNetNet >= -100 ? 'watch' : 'negative';
    const cfSign = cfNetNet > 0 ? '+' : '';
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
            if (freshPost) renderOwnedCalculTab(freshPost);
        });
    });
}

const CF_TABLE_YEARS_COLLAPSED = 5;
const expandedCfTables = new Set(); // ids d'actifs dont on a demandé les 20 années (état en mémoire, non persisté)

function renderOwnedCfTable(asset) {
    const wrap = nodes.ownedCfTableWrap || document.getElementById('owned-cf-table-wrap');
    if (!wrap) return;
    const acq = asset.acquisition || {};
    const hasData = (acq.prix || 0) > 0;
    if (!hasData) { wrap.innerHTML = ''; return; }

    const regime = getOwnedRegime();
    const { years } = computeOwnedAssetTimeline(asset, state.profileData, regime);
    if (!years || !years.length) { wrap.innerHTML = ''; return; }

    const first20 = years.slice(0, 20);
    const isExpanded = expandedCfTables.has(asset.id);
    const visibleYears = isExpanded ? first20 : first20.slice(0, CF_TABLE_YEARS_COLLAPSED);
    const hasApportYear = first20.some(y => (y.apportAnnee || 0) > 0);
    const rows = visibleYears.map(y => {
        const cf = y.cfAnnuel ?? y.cfNet ?? 0;
        const cfCls = cf >= 0 ? 'positive' : 'negative';
        const cfSign = cf >= 0 ? '+' : '';
        const apport = Math.round(y.apportAnnee || 0);
        const loyers = Math.round(y.recettesAnnee ?? y.loyers ?? 0);
        // Dépenses opérationnelles (hors apport) pour que Recettes − Dépenses = CF annuel affiché sur la ligne.
        const depenses = Math.round((y.depensesAnnee ?? y.charges ?? 0) - apport);
        return `<tr>
            <td>${y.year}${apport > 0 ? ` <span class="owned-caveat" data-tooltip="Apport initial de ${apport.toLocaleString('fr-FR')} € investi cette année-là, non compté dans Dépenses/CF (voir Investissement total).">+ apport</span>` : ''}</td>
            <td>${loyers.toLocaleString('fr-FR')} €</td>
            <td>${depenses.toLocaleString('fr-FR')} €</td>
            <td class="${cfCls}">${cfSign}${Math.round(cf).toLocaleString('fr-FR')} €</td>
            <td style="font-size:.75rem;color:var(--text-tertiary)">${Math.round(y.cumulCF ?? 0).toLocaleString('fr-FR')} €</td>
        </tr>`;
    }).join('');

    wrap.innerHTML = `
        <div class="owned-cf-table">
            <div class="owned-cf-table__title">Flux de trésorerie annuels</div>
            ${hasApportYear ? `<div class="owned-cf-table__note">Dépenses = charges + crédit + impôts de l'année (hors apport initial, indiqué séparément).</div>` : ''}
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
            ${first20.length > CF_TABLE_YEARS_COLLAPSED ? `<button type="button" class="btn btn--ghost btn--sm owned-cf-table__toggle" data-action="toggle-cf-table">${isExpanded ? 'Réduire' : `Voir les ${first20.length} années`}</button>` : ''}
        </div>
    `;

    wrap.querySelector('[data-action="toggle-cf-table"]')?.addEventListener('click', () => {
        if (isExpanded) expandedCfTables.delete(asset.id);
        else expandedCfTables.add(asset.id);
        const fresh = getOwnedAsset(asset.id);
        if (fresh) renderOwnedCfTable(fresh);
    });
}

const _isImageFilename = filename => /\.(jpe?g|png)$/i.test(filename || '');

async function openDocumentPreview(assetId, filename) {
    let overlay = document.getElementById('document-preview-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'document-preview-overlay';
        overlay.className = 'document-preview-overlay';
        overlay.innerHTML = `
            <div class="document-preview-dialog">
                <button type="button" class="document-preview-close" aria-label="Fermer">✕</button>
                <embed class="document-preview-embed" type="application/pdf" hidden>
                <img class="document-preview-img" alt="Justificatif" hidden>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.hidden = true; });
        overlay.querySelector('.document-preview-close').addEventListener('click', () => { overlay.hidden = true; });
    }
    const embed = overlay.querySelector('.document-preview-embed');
    const img = overlay.querySelector('.document-preview-img');
    const isImage = _isImageFilename(filename);
    embed.hidden = isImage;
    img.hidden = !isImage;
    embed.src = '';
    img.src = '';
    overlay.hidden = false;
    try {
        const url = await cloudDocumentUrl(assetId, filename);
        if (isImage) img.src = url; else embed.src = url;
    } catch {
        overlay.hidden = true;
        showToast('Document indisponible — vérifiez votre connexion internet', 'negative');
    }
}

// Modale d'édition d'un frais existant (onglet Travaux). Le PDF joint n'y est pas
// modifiable : le remplacer demande de supprimer puis recréer le frais.
function openEditTravailModal(assetId, travailId) {
    const asset = getOwnedAsset(assetId);
    const travail = (asset?.postAchat?.travaux || []).find(t => t.id === travailId);
    if (!travail) return;

    const TAGS = [
        { value: 'a-classifier', label: 'À classifier' },
        { value: 'deductible', label: 'Déductible' },
        { value: 'non-deductible', label: 'Non déductible' }
    ];

    const modal = _showOwnedModal(`
        <div class="owned-modal">
            <div class="owned-modal-head">
                <h3 class="owned-modal-title">Modifier le frais</h3>
                <button class="btn btn--ghost" data-close-modal aria-label="Fermer">✕</button>
            </div>
            <form class="owned-form-grid" data-form="edit-travail" novalidate>
                <label class="variables-field">
                    <span class="variables-label">Date</span>
                    <input class="variables-input" type="date" name="date" value="${escapeHtml(travail.date || '')}" required>
                </label>
                <label class="variables-field">
                    <span class="variables-label">Montant (€)</span>
                    <input class="variables-input" type="number" name="montant" min="0" step="1" value="${travail.montant || 0}" required>
                </label>
                <label class="variables-field" style="grid-column:1/-1">
                    <span class="variables-label">Description</span>
                    <input class="variables-input" type="text" name="description" value="${escapeHtml(travail.description || '')}" required>
                </label>
                <label class="variables-field">
                    <span class="variables-label">Nature</span>
                    <select class="variables-input" name="tag">
                        ${TAGS.map(t => `<option value="${t.value}"${travail.tag === t.value ? ' selected' : ''}>${t.label}</option>`).join('')}
                    </select>
                </label>
                <label class="variables-field">
                    <span class="variables-label">Commentaire</span>
                    <input class="variables-input" type="text" name="commentaire" value="${escapeHtml(travail.commentaire || '')}">
                </label>
                <label class="variables-field" style="grid-column:1/-1;flex-direction:row;align-items:center;gap:8px" data-tooltip="À cocher si ce frais fait partie de l'enveloppe du crédit immobilier principal (pas payé cash) — reste déductible fiscalement l'année du frais, mais n'est plus retranché du cash-flow puisque la mensualité rembourse déjà cette part">
                    <input type="checkbox" name="financeParCredit" value="1" ${travail.financeParCredit ? 'checked' : ''}>
                    <span class="variables-label" style="margin:0">Financé par le crédit immobilier principal</span>
                </label>
                <div class="variables-field" style="grid-column:1/-1">
                    <span class="variables-label">Justificatif</span>
                    ${travail.pdfFilename ? `
                    <div class="owned-edit-pdf-current" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                        <button type="button" class="btn btn--ghost btn--sm" data-preview-current-pdf>📄 Voir le justificatif actuel</button>
                        <label style="display:flex;align-items:center;gap:6px;font-size:.82rem;color:var(--text-secondary);cursor:pointer">
                            <input type="checkbox" name="removePdf" value="1"> Supprimer ce justificatif
                        </label>
                    </div>
                    <span class="variables-label" style="margin-top:10px;font-weight:400;font-size:.78rem">Remplacer par un autre fichier (PDF, JPG ou PNG — optionnel)</span>
                    ` : `<span class="variables-label" style="font-weight:400;font-size:.78rem">Ajouter un justificatif (PDF, JPG ou PNG — optionnel)</span>`}
                    <input class="variables-input" type="file" name="pdf" accept="${TRAVAUX_ACCEPTED_MIME.join(',')}" style="margin-top:6px">
                </div>
                <div class="owned-modal-actions" style="grid-column:1/-1">
                    <button type="button" class="btn btn--ghost" data-close-modal>Annuler</button>
                    <button type="submit" class="btn btn--primary">Enregistrer</button>
                </div>
            </form>
        </div>
    `, 'owned-edit-travail-modal');

    modal.querySelector('[data-preview-current-pdf]')?.addEventListener('click', () => {
        if (travail.pdfFilename) openDocumentPreview(assetId, travail.pdfFilename);
    });

    modal.querySelector('[data-form="edit-travail"]')?.addEventListener('submit', async e => {
        e.preventDefault();
        const form = e.target;
        const fd = new FormData(form);
        const removePdf = fd.get('removePdf') === '1';
        const file = fd.get('pdf');
        // undefined = ne pas toucher au justificatif existant ; null = le retirer.
        let pdfFilename;
        if (file && file.size > 0) {
            if (!TRAVAUX_ACCEPTED_MIME.includes(file.type)) {
                showToast('Format non supporté (PDF, JPG ou PNG uniquement)', 'negative');
                return;
            }
            try {
                const newFilename = await uploadOwnedDocument(assetId, file);
                if (travail.pdfFilename) cloudDeleteDocument(assetId, travail.pdfFilename).catch(() => {});
                pdfFilename = newFilename;
            } catch {
                showToast('Échec de l\'import du fichier', 'negative');
                return;
            }
        } else if (removePdf && travail.pdfFilename) {
            cloudDeleteDocument(assetId, travail.pdfFilename).catch(() => {});
            pdfFilename = null;
        }
        updateOwnedTravail(assetId, travailId, {
            date: fd.get('date'),
            description: String(fd.get('description') || '').trim(),
            montant: Number(fd.get('montant')),
            tag: fd.get('tag'),
            commentaire: String(fd.get('commentaire') || '').trim(),
            financeParCredit: fd.get('financeParCredit') === '1',
            ...(pdfFilename !== undefined ? { pdfFilename } : {})
        });
        modal.hidden = true;
        showToast('Frais modifié');
        const fresh = getOwnedAsset(assetId);
        renderOwnedTravauxTab(fresh);
        renderAccordionPostAchat(fresh);
        renderOwnedSynthese(fresh);
        renderOwnedCalculTab(fresh);
        renderAccordionSimulateur(fresh);
    });
}

async function printSelectedDocuments(assetId, filenames) {
    if (!filenames.length) return;
    const win = window.open('', '_blank');
    if (!win) return;
    const pairs = await Promise.all(filenames.map(async f => ({ url: await cloudDocumentUrl(assetId, f).catch(() => null), isImage: _isImageFilename(f) })));
    const embeds = pairs.filter(p => p.url).map(p => p.isImage
        ? `<img src="${p.url}" class="print-doc-embed">`
        : `<embed src="${p.url}" type="application/pdf" class="print-doc-embed">`).join('');
    win.document.write(`
        <!doctype html><html><head><title>Impression des factures</title>
        <style>
            body { margin: 0; }
            .print-doc-embed { width: 100%; height: 100vh; display: block; break-after: page; object-fit: contain; }
            .print-doc-embed:last-child { break-after: auto; }
        </style>
        </head><body>${embeds}</body></html>
    `);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 500);
}

function _normalizeSearchText(str) {
    return String(str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

const TRAVAUX_ACCEPTED_MIME = ['application/pdf', 'image/jpeg', 'image/png'];
const TRAVAUX_MAX_FILE_SIZE = 8 * 1024 * 1024; // 8 Mo — marge sous la limite de la Cloud Function

function _fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}

// Lance worker(item) sur chaque item de `items`, au plus `limit` en simultane — evite de
// saturer l'API Anthropic quand plusieurs factures sont deposees d'un coup (import groupe).
async function _runWithConcurrencyLimit(items, limit, worker) {
    let cursor = 0;
    async function next() {
        while (cursor < items.length) {
            const current = cursor++;
            await worker(items[current], current);
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, next));
}

function renderOwnedTravauxTab(asset) {
    const el = nodes.ownedTravauxContent || document.getElementById('owned-travaux-content');
    if (!el) return;

    const post = asset.postAchat || {};
    const TAG_LABELS = { 'deductible': 'Déductible', 'non-deductible': 'Non déductible', 'a-classifier': 'À classifier' };
    const TAG_CSS = { 'deductible': 'tag--green', 'non-deductible': 'tag--grey', 'a-classifier': 'tag--orange' };

    const currentYear = new Date().getFullYear();
    const totalDed = (post.travaux || [])
        .filter(t => t.tag === 'deductible' && t.date && new Date(t.date).getFullYear() === currentYear)
        .reduce((s, t) => s + t.montant, 0);

    const byYear = {};
    for (const t of (post.travaux || [])) {
        const y = t.date ? new Date(t.date).getFullYear() : 'sans-date';
        (byYear[y] = byYear[y] || []).push(t);
    }
    const years = Object.keys(byYear).sort((a, b) => (b === 'sans-date' ? -1 : a === 'sans-date' ? 1 : b - a));

    const yearBlocksHtml = years.length ? years.map(y => {
        const rows = byYear[y].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        const yearTotal = rows.reduce((s, t) => s + t.montant, 0);
        const isCurrent = String(y) === String(currentYear);
        return `
        <details class="owned-travaux-year" data-default-open="${isCurrent ? '1' : '0'}" ${isCurrent ? 'open' : ''}>
            <summary class="owned-travaux-year__summary">
                <span>${y === 'sans-date' ? 'Sans date' : y}</span>
                <strong>${Math.round(yearTotal).toLocaleString('fr-FR')} €</strong>
            </summary>
            <div class="owned-travaux-list">
                ${rows.map(t => `
                    <div class="owned-travaux-row" data-search-text="${escapeHtml(`${t.description || ''} ${t.montant || ''} ${t.commentaire || ''}`)}">
                        <input type="checkbox" class="owned-travaux-select" data-select-travail="${escapeHtml(t.id)}" ${t.pdfFilename ? '' : 'disabled title="Aucun justificatif attaché"'}>
                        <span class="owned-travaux-date">${escapeHtml(t.date || '—')}</span>
                        <span class="owned-travaux-desc">${escapeHtml(t.description || '—')}${t.financeParCredit ? ` <small class="owned-caveat" data-tooltip="Inclus dans le crédit immobilier principal (pas payé cash) — reste déductible l'année du frais, mais n'est plus retranché du cash-flow puisque la mensualité rembourse déjà cette part">🏦 financé</small>` : ''}${t.commentaire ? `<br><small style="color:var(--text-tertiary)">${escapeHtml(t.commentaire)}</small>` : ''}</span>
                        <span class="owned-travaux-montant">${Math.round(t.montant).toLocaleString('fr-FR')} €</span>
                        <span class="tag ${TAG_CSS[t.tag] || 'tag--grey'}">${escapeHtml(TAG_LABELS[t.tag] || t.tag)}</span>
                        ${t.pdfFilename ? `<button type="button" class="owned-travaux-pdf-btn" data-preview-pdf="${escapeHtml(t.pdfFilename)}" title="Voir le justificatif" aria-label="Voir le justificatif de ${escapeHtml(t.description || 'ce frais')}">📄</button>` : '<span></span>'}
                        <button type="button" class="owned-travaux-edit" data-edit-travail="${escapeHtml(t.id)}" title="Modifier" aria-label="Modifier ${escapeHtml(t.description || 'ce frais')}">✏️</button>
                        <button class="owned-travaux-delete" data-delete-travail-tab="${escapeHtml(t.id)}" title="Supprimer" aria-label="Supprimer">✕</button>
                    </div>
                `).join('')}
            </div>
        </details>`;
    }).join('') : '<p style="font-size:.82rem;color:var(--text-tertiary);font-style:italic">Aucun frais enregistré.</p>';

    el.innerHTML = `
        <div class="owned-section-title">Frais &amp; justificatifs</div>
        <div class="owned-travaux-toolbar">
            <input type="search" class="variables-input owned-travaux-search" data-travaux-search placeholder="🔍 Rechercher un frais…">
            <button type="button" class="btn btn--ghost btn--sm" data-action="print-selection" disabled>🖨 Imprimer la sélection</button>
        </div>
        ${yearBlocksHtml}
        ${totalDed > 0 ? `<div class="owned-travaux-totals"><span>Déductible ${currentYear} : <strong>${Math.round(totalDed).toLocaleString('fr-FR')} €</strong></span></div>` : ''}
        <div class="owned-travaux-add-row">
            <div class="owned-travaux-dropzone" data-travaux-dropzone tabindex="0" role="button" aria-label="Déposer une facture ou une photo">
                <input type="file" accept="application/pdf,image/jpeg,image/png" multiple data-travaux-file-input hidden>
                <div class="owned-travaux-dropzone__body" data-travaux-dropzone-body>
                    <div class="owned-travaux-dropzone__icon">📄</div>
                    <div class="owned-travaux-dropzone__label">Dépose une facture ou une photo</div>
                    <div class="owned-travaux-dropzone__hint">PDF, JPG ou PNG — glisser-déposer ou <span class="owned-travaux-dropzone__browse">choisir un fichier</span></div>
                </div>
                <div class="owned-travaux-dropzone__status" data-travaux-status hidden></div>
            </div>
            <form class="owned-travaux-form" data-form="add-travail-tab" novalidate>
                <div class="owned-travaux-ai-banner" data-travaux-ai-banner hidden></div>
                <input type="date" name="date" class="variables-input" required placeholder="Date" data-field="date" style="flex:0 0 140px">
                <input type="text" name="description" class="variables-input" required placeholder="Description" data-field="description" style="flex:1;min-width:120px">
                <input type="number" name="montant" class="variables-input" required placeholder="Montant €" min="0" data-field="montant" style="flex:0 0 100px">
                <span class="owned-travaux-tag-wrap">
                    <select name="tag" class="variables-input" data-field="tag" style="flex:0 0 130px">
                        <option value="a-classifier">À classifier</option>
                        <option value="deductible">Déductible</option>
                        <option value="non-deductible">Non déductible</option>
                    </select>
                    <span class="owned-tag-suggested-badge" data-tag-suggested-badge hidden>🤖 suggéré</span>
                </span>
                <input type="text" name="commentaire" class="variables-input" placeholder="Commentaire (optionnel)" style="flex:1;min-width:120px">
                <label style="display:flex;align-items:center;gap:6px;font-size:.78rem;color:var(--text-secondary);white-space:nowrap;flex:0 0 auto" data-tooltip="À cocher si ce frais fait partie de l'enveloppe du crédit immobilier principal (pas payé cash) — reste déductible fiscalement l'année du frais, mais n'est plus retranché du cash-flow puisque la mensualité rembourse déjà cette part">
                    <input type="checkbox" name="financeParCredit" value="1"> Financé par le crédit
                </label>
                <button type="submit" class="btn btn--primary btn--sm">Ajouter</button>
            </form>
        </div>
    `;

    const updateSelectionToolbar = () => {
        const printBtn = el.querySelector('[data-action="print-selection"]');
        const checked = el.querySelectorAll('.owned-travaux-select:checked');
        if (printBtn) printBtn.disabled = checked.length === 0;
    };

    el.querySelectorAll('.owned-travaux-select').forEach(cb => {
        cb.addEventListener('change', updateSelectionToolbar);
    });

    el.querySelector('[data-action="print-selection"]')?.addEventListener('click', () => {
        const id = state.activeOwnedAssetId;
        if (!id) return;
        const fresh = getOwnedAsset(id);
        const checkedIds = [...el.querySelectorAll('.owned-travaux-select:checked')].map(cb => cb.dataset.selectTravail);
        const filenames = (fresh.postAchat.travaux || [])
            .filter(t => checkedIds.includes(t.id) && t.pdfFilename)
            .map(t => t.pdfFilename);
        printSelectedDocuments(id, filenames);
    });

    el.querySelectorAll('[data-preview-pdf]').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = state.activeOwnedAssetId;
            if (!id) return;
            openDocumentPreview(id, btn.dataset.previewPdf);
        });
    });

    el.querySelectorAll('[data-edit-travail]').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = state.activeOwnedAssetId;
            if (!id) return;
            openEditTravailModal(id, btn.dataset.editTravail);
        });
    });

    el.querySelectorAll('[data-delete-travail-tab]').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = state.activeOwnedAssetId;
            if (!id) return;
            deleteOwnedTravail(id, btn.dataset.deleteTravailTab);
            const fresh = getOwnedAsset(id);
            renderOwnedTravauxTab(fresh);
            renderAccordionPostAchat(fresh);
            renderOwnedSynthese(fresh);
            renderOwnedCalculTab(fresh);
            renderAccordionSimulateur(fresh);
        });
    });

    // ─── Recherche (filtre client, déplie les années qui matchent) ───────────
    const searchInput = el.querySelector('[data-travaux-search]');
    searchInput?.addEventListener('input', () => {
        const q = _normalizeSearchText(searchInput.value.trim());
        el.querySelectorAll('.owned-travaux-year').forEach(details => {
            if (!q) {
                details.hidden = false;
                details.open = details.dataset.defaultOpen === '1';
                details.querySelectorAll('.owned-travaux-row').forEach(row => { row.hidden = false; });
                return;
            }
            let anyMatch = false;
            details.querySelectorAll('.owned-travaux-row').forEach(row => {
                const match = _normalizeSearchText(row.dataset.searchText).includes(q);
                row.hidden = !match;
                if (match) anyMatch = true;
            });
            details.hidden = !anyMatch;
            if (anyMatch) details.open = true;
        });
    });

    // ─── Dépôt facture/photo → extraction IA (Cloud Function extraireFraisFacture) ──────────
    // Pré-remplit le formulaire ci-contre ; le fichier reste attaché comme justificatif au
    // clic "Ajouter" même si l'extraction échoue (toast, pas de blocage). Voir spec
    // docs/superpowers/specs/2026-08-04-onglet-travaux-refonte.md.
    let pendingFile = null;
    const dropzone = el.querySelector('[data-travaux-dropzone]');
    const dropzoneBody = el.querySelector('[data-travaux-dropzone-body]');
    const fileInput = el.querySelector('[data-travaux-file-input]');
    const statusEl = el.querySelector('[data-travaux-status]');
    const aiBanner = el.querySelector('[data-travaux-ai-banner]');
    const tagBadge = el.querySelector('[data-tag-suggested-badge]');
    const form = el.querySelector('[data-form="add-travail-tab"]');
    const fieldDate = form.querySelector('[data-field="date"]');
    const fieldDesc = form.querySelector('[data-field="description"]');
    const fieldMontant = form.querySelector('[data-field="montant"]');
    const fieldTag = form.querySelector('[data-field="tag"]');

    const resetDropzone = () => {
        pendingFile = null;
        if (fileInput) fileInput.value = '';
        dropzone.classList.remove('owned-travaux-dropzone--filled', 'owned-travaux-dropzone--dragover');
        dropzoneBody.hidden = false;
        statusEl.hidden = true;
        statusEl.className = 'owned-travaux-dropzone__status';
        statusEl.textContent = '';
        aiBanner.hidden = true;
        tagBadge.hidden = true;
        [fieldDate, fieldDesc, fieldMontant].forEach(f => f.classList.remove('ai-filled'));
    };

    const handleFile = async file => {
        if (!TRAVAUX_ACCEPTED_MIME.includes(file.type)) {
            showToast('Format non supporté (PDF, JPG ou PNG uniquement)', 'negative');
            return;
        }
        pendingFile = file;
        dropzoneBody.hidden = true;
        dropzone.classList.add('owned-travaux-dropzone--filled');
        statusEl.hidden = false;
        statusEl.className = 'owned-travaux-dropzone__status owned-travaux-dropzone__status--loading';
        statusEl.textContent = `📄 ${file.name} — lecture de la facture…`;

        if (file.size > TRAVAUX_MAX_FILE_SIZE) {
            statusEl.className = 'owned-travaux-dropzone__status owned-travaux-dropzone__status--error';
            statusEl.textContent = `📄 ${file.name} — trop volumineux pour l'extraction (max 8 Mo), remplis à la main`;
            return;
        }

        try {
            const base64 = await _fileToBase64(file);
            const result = await cloudExtraireFraisFacture(base64, file.type);
            if (result.date) { fieldDate.value = result.date; fieldDate.classList.add('ai-filled'); }
            if (result.description) { fieldDesc.value = result.description; fieldDesc.classList.add('ai-filled'); }
            if (result.montant > 0) { fieldMontant.value = result.montant; fieldMontant.classList.add('ai-filled'); }
            fieldTag.value = result.tagSuggestion || 'a-classifier';
            tagBadge.hidden = false;
            aiBanner.hidden = false;
            aiBanner.textContent = `🤖 Facture : ${file.name} — vérifie les champs avant de valider`;
            statusEl.className = 'owned-travaux-dropzone__status owned-travaux-dropzone__status--ok';
            statusEl.textContent = `📄 ${file.name} — ✓ pré-rempli`;
        } catch (err) {
            statusEl.className = 'owned-travaux-dropzone__status owned-travaux-dropzone__status--error';
            statusEl.textContent = `📄 ${file.name} — extraction impossible, remplis à la main`;
            showToast('Extraction impossible, remplis le formulaire à la main', 'negative');
        }
    };

    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
    dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('owned-travaux-dropzone--dragover'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('owned-travaux-dropzone--dragover'));
    // Plusieurs fichiers a la fois -> modale de revue groupee (openTravauxBatchModal) ; un seul
    // fichier -> flux inline existant (handleFile), inchange. Voir spec
    // docs/superpowers/specs/2026-08-04-travaux-import-groupe.md.
    const handleFiles = fileList => {
        const files = Array.from(fileList || []);
        if (files.length === 0) return;
        if (files.length === 1) { handleFile(files[0]); return; }
        openTravauxBatchModal(files);
    };
    dropzone.addEventListener('drop', e => {
        e.preventDefault();
        dropzone.classList.remove('owned-travaux-dropzone--dragover');
        handleFiles(e.dataTransfer.files);
    });
    fileInput.addEventListener('change', () => {
        handleFiles(fileInput.files);
        fileInput.value = '';
    });

    form.addEventListener('submit', async e => {
        e.preventDefault();
        const fd = new FormData(form);
        const id = state.activeOwnedAssetId;
        if (!id) return;
        const date = fd.get('date');
        const description = fd.get('description')?.trim();
        const montant = Number(fd.get('montant'));
        if (!date || !description || !montant) {
            showToast('Date, description et montant sont requis', 'negative');
            return;
        }
        let pdfFilename = null;
        if (pendingFile) {
            try {
                pdfFilename = await uploadOwnedDocument(id, pendingFile);
            } catch {
                showToast('Échec de l\'import du fichier', 'negative');
                return;
            }
        }
        addOwnedTravail(id, {
            date,
            description,
            montant,
            tag: fd.get('tag'),
            commentaire: fd.get('commentaire')?.trim(),
            pdfFilename,
            financeParCredit: fd.get('financeParCredit') === '1'
        });
        form.reset();
        resetDropzone();
        showToast('Frais ajouté');
        const fresh = getOwnedAsset(id);
        renderOwnedTravauxTab(fresh);
        renderAccordionPostAchat(fresh);
        renderOwnedSynthese(fresh);
        renderOwnedCalculTab(fresh);
        renderAccordionSimulateur(fresh);
    });
}

// Import groupe : plusieurs fichiers deposes d'un coup sur le dropzone (renderOwnedTravauxTab)
// -> revue en tableau, extraction IA en concurrence limitee, validation en un clic. Voir spec
// docs/superpowers/specs/2026-08-04-travaux-import-groupe.md. Le flux fichier unique
// (handleFile, dans renderOwnedTravauxTab) reste inchange.
async function openTravauxBatchModal(files) {
    const id = state.activeOwnedAssetId;
    if (!id) return;

    const rows = files.map((file, idx) => ({ idx, file, status: 'loading', date: '', description: '', montant: 0, tag: 'a-classifier' }));
    const TAG_OPTIONS = `
        <option value="a-classifier">À classifier</option>
        <option value="deductible">Déductible</option>
        <option value="non-deductible">Non déductible</option>`;

    const rowHtml = row => `
        <tr>
            <td><input type="checkbox" data-batch-check="${row.idx}" checked aria-label="Inclure ${escapeHtml(row.file.name)}"></td>
            <td class="owned-batch-filename">
                📄 ${escapeHtml(row.file.name)}
                <div class="owned-batch-status" data-batch-status="${row.idx}">lecture…</div>
            </td>
            <td><input type="date" class="variables-input" data-batch-field="date" data-idx="${row.idx}"></td>
            <td><input type="text" class="variables-input" data-batch-field="description" data-idx="${row.idx}" placeholder="Description"></td>
            <td><input type="number" class="variables-input" data-batch-field="montant" data-idx="${row.idx}" placeholder="Montant €" min="0"></td>
            <td><select class="variables-input" data-batch-field="tag" data-idx="${row.idx}">${TAG_OPTIONS}</select></td>
        </tr>`;

    const modal = _showOwnedModal(`
        <div class="owned-modal owned-modal--xwide">
            <div class="owned-modal-head">
                <div>
                    <h3 class="owned-modal-title">Import groupé — ${files.length} factures</h3>
                    <div class="owned-modal-sub" data-batch-progress>Analyse en cours… 0 / ${files.length}</div>
                </div>
                <button class="btn btn--ghost" data-close-modal aria-label="Fermer">✕</button>
            </div>
            <div class="owned-batch-table-wrap">
                <table class="owned-batch-table">
                    <thead><tr><th></th><th>Fichier</th><th>Date</th><th>Description</th><th>Montant</th><th>Tag</th></tr></thead>
                    <tbody>${rows.map(rowHtml).join('')}</tbody>
                </table>
            </div>
            <div class="owned-modal-actions">
                <button type="button" class="btn btn--ghost" data-close-modal>Annuler</button>
                <button type="button" class="btn btn--primary" data-batch-submit disabled>Ajouter les ${files.length} frais</button>
            </div>
        </div>
    `, 'owned-travaux-batch-modal');

    const progressEl = modal.querySelector('[data-batch-progress]');
    const submitBtn = modal.querySelector('[data-batch-submit]');

    const updateSubmitLabel = () => {
        if (!submitBtn) return;
        const checkedCount = modal.querySelectorAll('[data-batch-check]:checked').length;
        submitBtn.textContent = checkedCount > 0 ? `Ajouter les ${checkedCount} frais` : 'Aucun frais sélectionné';
        submitBtn.disabled = doneCount < files.length || checkedCount === 0;
    };
    modal.querySelectorAll('[data-batch-check]').forEach(cb => cb.addEventListener('change', updateSubmitLabel));

    const applyRow = row => {
        const statusEl = modal.querySelector(`[data-batch-status="${row.idx}"]`);
        if (statusEl) {
            statusEl.textContent = row.status === 'ok' ? '✓ pré-rempli' : row.status === 'error' ? 'extraction impossible' : 'lecture…';
            statusEl.className = `owned-batch-status ${row.status === 'ok' ? 'owned-batch-status--ok' : row.status === 'error' ? 'owned-batch-status--error' : ''}`;
        }
        const dateEl = modal.querySelector(`[data-batch-field="date"][data-idx="${row.idx}"]`);
        const descEl = modal.querySelector(`[data-batch-field="description"][data-idx="${row.idx}"]`);
        const montantEl = modal.querySelector(`[data-batch-field="montant"][data-idx="${row.idx}"]`);
        const tagEl = modal.querySelector(`[data-batch-field="tag"][data-idx="${row.idx}"]`);
        if (dateEl) dateEl.value = row.date;
        if (descEl) descEl.value = row.description;
        if (montantEl) montantEl.value = row.montant > 0 ? row.montant : '';
        if (tagEl) tagEl.value = row.tag;
    };

    let doneCount = 0;
    await _runWithConcurrencyLimit(rows, 3, async row => {
        try {
            const base64 = await _fileToBase64(row.file);
            const result = await cloudExtraireFraisFacture(base64, row.file.type);
            row.status = 'ok';
            row.date = result.date || '';
            row.description = result.description || '';
            row.montant = result.montant > 0 ? result.montant : 0;
            row.tag = result.tagSuggestion || 'a-classifier';
        } catch {
            row.status = 'error';
        }
        applyRow(row);
        doneCount++;
        progressEl.textContent = doneCount < files.length
            ? `Analyse en cours… ${doneCount} / ${files.length}`
            : `Analyse terminée — vérifie les champs avant de valider`;
        if (doneCount === files.length) updateSubmitLabel();
    });

    submitBtn?.addEventListener('click', async () => {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Ajout en cours…';
        let added = 0, skipped = 0;
        for (const row of rows) {
            const checked = modal.querySelector(`[data-batch-check="${row.idx}"]`)?.checked;
            if (!checked) continue;
            const date = modal.querySelector(`[data-batch-field="date"][data-idx="${row.idx}"]`)?.value;
            const description = modal.querySelector(`[data-batch-field="description"][data-idx="${row.idx}"]`)?.value.trim();
            const montant = Number(modal.querySelector(`[data-batch-field="montant"][data-idx="${row.idx}"]`)?.value);
            const tag = modal.querySelector(`[data-batch-field="tag"][data-idx="${row.idx}"]`)?.value;
            if (!date || !description || !montant) { skipped++; continue; }
            let pdfFilename;
            try {
                pdfFilename = await uploadOwnedDocument(id, row.file);
            } catch {
                skipped++;
                continue;
            }
            addOwnedTravail(id, { date, description, montant, tag, commentaire: '', pdfFilename, financeParCredit: false });
            added++;
        }
        modal.hidden = true;
        showToast(skipped > 0 ? `${added} frais ajoutés, ${skipped} ignoré${skipped > 1 ? 's' : ''}` : `${added} frais ajoutés`);
        const fresh = getOwnedAsset(id);
        renderOwnedTravauxTab(fresh);
        renderAccordionPostAchat(fresh);
        renderOwnedSynthese(fresh);
        renderOwnedCalculTab(fresh);
        renderAccordionSimulateur(fresh);
    });
}

let _ownedPortfolioCfChart = null;
let _ownedPortfolioEcartChart = null;

function renderOwnedPortfolioCharts(list, profileData, regime) {
    if (IS_MOBILE_PAGE) return; // bloc desktop uniquement — voir renderOwnedVerdictBlock
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
        const anneeAchat = parseDateAchat(a.dateAchat).annee;
        const duree = a.acquisition?.credit?.duree || 0;
        return { start: anneeAchat, end: Math.max(currentYear + 2, anneeAchat + duree) };
    });
    const globalStart = Math.min(...allRanges.map(r => r.start));
    const globalEnd = Math.max(...allRanges.map(r => r.end));

    const aggCF = {}, aggRec = {}, aggDep = {};
    for (let y = globalStart; y <= globalEnd; y++) { aggCF[y] = 0; aggRec[y] = 0; aggDep[y] = 0; }

    for (const asset of list) {
        const { years } = computeOwnedAssetTimeline(asset, profileData, regime);
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

// Alertes uniquement (régime optimal plus avantageux, seuil micro-foncier dépassé, loyer sous-évalué)
// — toujours visibles au-dessus des onglets, PC et mobile. Les indicateurs chiffrés et le comparatif
// des régimes ont été déplacés dans l'onglet Calcul (renderOwnedCalculTab), voir spec
// docs/superpowers/specs/2026-08-04-onglet-calcul-portefeuille.md.
function renderOwnedSynthese(asset) {
    if (!nodes.ownedSynthese) return;
    const acq = asset.acquisition || {};
    const hasData = (acq.prix || 0) > 0;

    if (!hasData) {
        nodes.ownedSynthese.innerHTML = '';
        return;
    }

    const tmi = getOwnedTmi();
    const currentRegime = getOwnedRegime();
    const optRegime = getOptimalRegime(asset, tmi);
    const optGain = optRegime.optimal ? (optRegime.optimalCF || 0) - (optRegime.allCFs[currentRegime] || 0) : 0;
    const REGIME_LABELS_SHORT = { 'micro-foncier': 'Micro-foncier', 'reel': 'Foncier réel', 'sci-is': 'SCI-IS' };
    const hasOptAlert = optRegime.optimal && optRegime.optimal !== currentRegime && optGain > 20;

    // Revenus bruts pour alerte 15k
    const allAssets = Object.values(loadOwnedAssets());
    const revenusBruts = computeRevenusLocatifsBruts(allAssets);
    const alerteMicroFoncier = revenusBruts > 15000 && currentRegime === 'micro-foncier';

    const loyerMarche = asset.loyerMarche || null;
    const loyerInitialVal = acq.loyerInitial || 0;
    const loyerSousEvalue = loyerMarche && loyerInitialVal > 0 && loyerInitialVal < loyerMarche.loyerMedian * 0.9;

    nodes.ownedSynthese.innerHTML = `
        ${alerteMicroFoncier ? `<div class="owned-alert owned-alert--error">⚠ Revenus fonciers bruts ${Math.round(revenusBruts).toLocaleString('fr-FR')} €/an — Micro-foncier interdit au-delà de 15 000 €. Changez de régime.</div>` : ''}
        ${hasOptAlert ? `<div class="owned-alert owned-alert--info">💡 ${REGIME_LABELS_SHORT[optRegime.optimal]} serait plus favorable de <strong>+${Math.round(optGain).toLocaleString('fr-FR')} €/mois</strong> pour ce bien${optRegime.optimal === 'sci-is' ? ' <span class="owned-caveat" data-tooltip="Comparaison basée sur le seul CF net-net : ne compte pas les frais de structure d\'une SCI-IS (comptable, formalisme, ~1500-2500 €/an) ni sa fiscalité de sortie, moins favorable (pas d\'abattement pour durée de détention, flat tax sur les dividendes).">(hors frais de structure et fiscalité de sortie)</span>' : ''}</div>` : ''}
        ${loyerSousEvalue ? `<div class="owned-alert owned-alert--warning">📈 Loyer potentiellement sous-évalué : marché à <strong>${Math.round(loyerMarche.loyerMedian).toLocaleString('fr-FR')} €/mois</strong> (médiane sur ${loyerMarche.nbSamples} biens)</div>` : ''}
    `;
}

// Onglet Calcul : détail de tous les indicateurs d'un bien, identique PC et mobile — indicateurs clés,
// défiscalisation (comparaison des régimes pour le scénario courant), détail CF net-net (avec sélecteur
// d'année partagé avec le bloc Verdict via state.ownedYearFilters), flux de trésorerie annuel
// (renderOwnedCfTable, cible owned-cf-table-wrap séparément), comparatif des régimes dans le temps,
// accès au compte de résultat. Voir docs/superpowers/specs/2026-08-04-onglet-calcul-portefeuille.md.
function renderOwnedCalculTab(asset) {
    const topEl = document.getElementById('owned-calcul-top');
    const bottomEl = document.getElementById('owned-calcul-bottom');
    if (!topEl || !bottomEl) return;
    const acq = asset.acquisition || {};
    const credit = acq.credit || {};
    const hasData = (acq.prix || 0) > 0;
    if (!hasData) { topEl.innerHTML = ''; bottomEl.innerHTML = ''; renderOwnedCfTable(asset); return; }

    const tmi = getOwnedTmi();
    const sc = getOwnedDefaultScenario(asset);
    const regime = getOwnedRegime();

    // Mensualité crédit calculée
    const montant = credit.montant || 0;
    const nMois = (credit.duree || 0) * 12;
    const tauxM = ((credit.taux || 0) / 100) / 12;
    let mensualiteCredit = 0;
    if (tauxM > 0 && nMois > 0) mensualiteCredit = (montant * tauxM) / (1 - Math.pow(1 + tauxM, -nMois));
    else if (nMois > 0) mensualiteCredit = montant / nMois;
    let assuranceMens = 0;
    if (montant > 0 && (credit.duree || 0) > 0) {
        const { schedule } = computeAmortizationSchedule(montant, credit.taux || 0, credit.duree || 0, asset.dateAchat, credit.assurance || 0, credit.assuranceMode);
        const yearRow = schedule.find(r => r.annee === new Date().getFullYear());
        assuranceMens = yearRow ? yearRow.assurance / 12 : 0;
    }
    const mensualiteTotale = mensualiteCredit + assuranceMens;
    const investTotal = (acq.prix || 0) + (acq.fraisAgence || 0) + (acq.fraisNotaire || 0);
    const apport = Math.max(0, investTotal - montant);

    // Métriques scénario réaliste — régime global
    const r = computeOwnedAssetCF(asset, sc.variables, tmi, regime);
    const cfAvantTone = r.cfNet >= 0 ? 'positive' : 'negative';
    const cfApresTone = r.cfNetNet >= 0 ? 'positive' : 'negative';
    const dscrTone = r.dscr > 0 && r.dscr < 1 ? 'negative' : r.dscr >= 1.1 ? 'positive' : '';

    // Comparaison défiscalisation : 3 régimes avec les variables du scénario réaliste
    const REGIMES = [
        { key: 'micro-foncier', label: 'Micro-foncier' },
        { key: 'reel', label: 'Réel' },
        { key: 'sci-is', label: 'SCI-IS' },
    ];
    const currentRegime = regime;
    const defisca = REGIMES.map(({ key, label }) => {
        const rd = computeOwnedAssetCF(asset, { ...sc.variables, regime: key }, tmi);
        return { key, label, impots: rd.impotsAnnee, cfNetNet: rd.cfNetNet };
    });

    // Patrimoine net
    const patNet = computePatrimoineNet(asset);
    const patTone = patNet.patrimoineNet !== null ? (patNet.patrimoineNet >= 0 ? 'positive' : 'negative') : '';

    // Régime optimal (pour le badge sur les cartes défiscalisation)
    const optRegime = getOptimalRegime(asset, tmi);

    // Détail CF net-net — sélecteur d'année, état partagé avec le bloc Verdict (state.ownedYearFilters)
    const { annee: anneeAchat } = parseDateAchat(asset.dateAchat);
    const defaultYear = Math.max(1, new Date().getFullYear() - anneeAchat + 1);
    const yr = (state.ownedYearFilters?.[asset.id]) ?? defaultYear;
    const YEAR_OPTIONS = [1, 3, 5, 10];
    const yearSelectorHtml = `
        <div class="owned-year-selector" style="margin-bottom:8px">
            <span class="owned-year-selector__label">Vue</span>
            <div class="owned-year-selector__btns">
                ${YEAR_OPTIONS.map(y => { const absYear = anneeAchat + y - 1; return `<button class="owned-year-btn${y === yr ? ' owned-year-btn--active' : ''}" data-calcul-year="${y}">An ${y} <span style="font-size:.65em;opacity:.6">${absYear}</span></button>`; }).join('')}
            </div>
        </div>`;
    const breakdown = computeCFBreakdown(asset, state.profileData, regime, yr);
    const breakdownHtml = breakdown ? renderCFBreakdownHTML(breakdown, yr) : '';

    topEl.innerHTML = `
        <div class="owned-section-title">Indicateurs clés</div>
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
                <span class="owned-synthese__card-label" data-tooltip="Capacité de remboursement par le loyer : loyers ÷ mensualité crédit. Au-dessus de 1, le loyer couvre intégralement le crédit.">DSCR</span>
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
        <div class="owned-synthese__title" style="margin-top:16px">Défiscalisation — comparaison des régimes
            <button class="btn btn--ghost btn--sm" data-action="open-simu-travaux" style="margin-left:auto;font-size:0.75rem">🔧 Simuler des travaux</button>
        </div>
        <div class="owned-synthese__defisca">
            ${defisca.map(d => {
                const isActive = d.key === currentRegime;
                const isOptimal = d.key === optRegime.optimal;
                const cfTone = d.cfNetNet >= 0 ? 'positive' : 'negative';
                const optimalTooltip = d.key === 'sci-is'
                    ? ' data-tooltip="Optimal sur le seul CF net-net : hors frais de structure (comptable, formalisme, ~1500-2500 €/an) et fiscalité de sortie, moins favorable qu\'en nom propre."'
                    : '';
                return `
                <div class="owned-synthese__defisca-card${isActive ? ' owned-synthese__defisca-card--active' : ''}">
                    <span class="owned-synthese__defisca-name">${d.label}${isActive ? ' ✓' : ''}${isOptimal && !isActive ? ` <span class="owned-badge owned-badge--optimal"${optimalTooltip}>Optimal</span>` : ''}${isOptimal && isActive ? ` <span class="owned-badge owned-badge--optimal"${optimalTooltip}>✓ Optimal</span>` : ''}</span>
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
        <div class="owned-section-title" style="margin-top:20px">Détail du CF net-net</div>
        ${yearSelectorHtml}
        ${breakdownHtml}
    `;

    topEl.querySelectorAll('[data-calcul-year]').forEach(btn => {
        btn.addEventListener('click', () => {
            state.ownedYearFilters = { ...(state.ownedYearFilters || {}), [asset.id]: Number(btn.dataset.calculYear) };
            localStorage.setItem('investissementWebOwnedYearFilters', JSON.stringify(state.ownedYearFilters));
            renderOwnedCalculTab(asset);
            if (!IS_MOBILE_PAGE) renderOwnedVerdictBlock(asset);
        });
    });

    renderOwnedCfTable(asset);

    const cmp = computeRegimeComparison(asset, state.profileData);
    const anneeComp = new Date().getFullYear();
    bottomEl.innerHTML = `
        <div class="owned-section-title" style="margin-top:20px">Comparatif des régimes fiscaux dans le temps</div>
        ${renderRegimeComparisonHTML(cmp)}
        <button type="button" class="btn btn--ghost btn--sm" data-action="open-compte-resultat" data-annee="${anneeComp}" style="margin-top:12px">📊 Compte de résultat ${anneeComp}</button>
    `;
}

function renderAccordionAcquisition(asset) {
    if (!nodes.accAcquisitionContent) return;
    const acq = asset.acquisition || {};
    const credit = acq.credit || {};
    const lots = asset.lots || [];
    const isImmeuble = (acq.typeBien || 'appartement') === 'immeuble';
    const hasLots = isImmeuble && lots.length > 0;

    const investTotal = (acq.prix || 0) + (acq.fraisAgence || 0) + (acq.fraisNotaire || 0);
    if (nodes.accAcquisitionSummary) {
        nodes.accAcquisitionSummary.textContent = investTotal > 0
            ? `${Math.round(investTotal).toLocaleString('fr-FR')} € investis`
            : '';
    }

    // Valeur affichée dans l'<input type="month"> : toujours 'YYYY-MM' (padding sur le mois),
    // même pour un bien saisi avant l'ajout du mois précis (anneeAchat brute, ex-défaut janvier).
    const dateAchatValue = asset.dateAchat
        ? (() => { const { annee, mois } = parseDateAchat(asset.dateAchat); return `${annee}-${String(mois).padStart(2, '0')}`; })()
        : '';

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
                <span class="variables-label">${hasLots ? 'Loyer total (calculé depuis les lots)' : 'Loyer actuel (€/mois)'}</span>
                <input class="variables-input" type="number" min="0" step="10" value="${Math.round(resolveLoyerVacance(asset).loyer)}" disabled
                    title="${hasLots ? 'Géré via les lots ci-dessous' : 'Géré dans l\'onglet Exploitation, section Loyer'}">
                ${hasLots ? '' : '<span class="owned-field-hint">Se saisit dans l\'onglet <strong>Exploitation</strong> → section Loyer</span>'}
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
                <span class="variables-label" data-tooltip="Date d'effet du crédit et du reste du calcul du bien (loyer, charges, déficit foncier). Le crédit ne démarre pas forcément en janvier : indiquez le mois exact pour une première (et dernière) année d'amortissement correctement proratisée.">Date d'achat</span>
                <input class="variables-input" type="month" data-owned-field="dateAchat" value="${dateAchatValue}">
            </label>
            <label class="variables-field">
                <span class="variables-label">Ville</span>
                <input class="variables-input" type="text" data-owned-field="ville" value="${escapeHtml(asset.ville || '')}">
            </label>
            <label class="variables-field">
                <span class="variables-label">Code postal</span>
                <input class="variables-input" type="text" maxlength="5" data-owned-field="codePostal" value="${escapeHtml(asset.codePostal || '')}">
            </label>
            <label class="variables-field owned-adresse-field">
                <span class="variables-label">Adresse complète <small style="color:var(--text-tertiary)">(pour la carte du portefeuille)</small></span>
                <input class="variables-input" type="text" data-owned-field="adresse" placeholder="12 rue des Lilas" value="${escapeHtml(asset.adresse || '')}">
                <span class="owned-geocode-hint" data-geocode-hint>${
                    asset.adresse
                        ? (asset.lat != null
                            ? '📍 Localisé sur la carte'
                            : '⚠ Adresse non localisée — vérifiez l\'orthographe')
                        : ''
                }</span>
            </label>
        </div>
        ${isImmeuble ? `
        <div class="owned-section-title" style="margin-top:20px">Lots de l'immeuble</div>
        <table class="owned-lots-table">
            <thead>
                <tr><th>Lot</th><th>Loyer (€/mois)</th><th>Vacance (%)</th><th>Locataire</th><th></th></tr>
            </thead>
            <tbody>
                ${lots.length ? lots.map(l => `
                <tr data-lot-id="${escapeHtml(l.id)}">
                    <td><input class="variables-input variables-input--sm" type="text" data-lot-field="nom" value="${escapeHtml(l.nom)}"></td>
                    <td><input class="variables-input variables-input--sm" type="number" min="0" step="10" data-lot-field="loyer" value="${l.loyer}"></td>
                    <td><input class="variables-input variables-input--sm" type="number" min="0" max="100" step="1" data-lot-field="vacance" value="${l.vacance}"></td>
                    <td><input class="variables-input variables-input--sm" type="text" data-lot-field="locataire" value="${escapeHtml(l.locataire || '')}" placeholder="Nom locataire"></td>
                    <td><button class="owned-travaux-delete" data-delete-lot="${escapeHtml(l.id)}" title="Supprimer ce lot" aria-label="Supprimer ${escapeHtml(l.nom)}">✕</button></td>
                </tr>`).join('') : '<tr><td colspan="5" style="text-align:center;font-style:italic;color:var(--text-tertiary);padding:12px">Aucun lot — ajoutez le premier lot ci-dessous</td></tr>'}
            </tbody>
        </table>
        <form class="owned-loyers-form" data-form="add-lot" novalidate>
            <input type="text" name="nom" class="variables-input" placeholder="Nom du lot (ex. Appt 1)" style="flex:1;min-width:120px">
            <input type="number" name="loyer" class="variables-input" placeholder="Loyer €/mois" min="0" step="10" style="flex:1;min-width:80px">
            <input type="number" name="vacance" class="variables-input" placeholder="Vacance %" min="0" max="100" step="1" value="5" style="flex:1;min-width:80px">
            <input type="text" name="locataire" class="variables-input" placeholder="Locataire" style="flex:1;min-width:100px">
            <button type="submit" class="btn btn--primary btn--sm">+ Ajouter un lot</button>
        </form>
        ${lots.length ? `<div class="owned-caveat" style="margin-top:6px">CF consolidé sur ${lots.length} lot${lots.length > 1 ? 's' : ''} : ${Math.round(resolveLoyerVacance(asset).loyer).toLocaleString('fr-FR')} €/mois de loyer cumulé, ${resolveLoyerVacance(asset).vacancePct.toFixed(1)} % de vacance pondérée.</div>` : ''}
        ` : ''}
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
            <label class="variables-field">
                <span class="variables-label" data-tooltip="Certains contrats recalculent la cotisation chaque année sur le capital restant dû (elle diminue), d'autres la fixent une fois pour toute la durée sur le capital emprunté. Vérifiez sur votre échéancier bancaire.">Base de l'assurance</span>
                <select class="variables-input" data-credit-field="assuranceMode">
                    <option value="initial" ${(credit.assuranceMode || 'initial') === 'initial' ? 'selected' : ''}>Capital initial (fixe)</option>
                    <option value="crd" ${credit.assuranceMode === 'crd' ? 'selected' : ''}>Capital restant dû (dégressif)</option>
                </select>
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
            let needsFullRerender = false;
            if (input.dataset.lotField) {
                const lotId = input.closest('tr[data-lot-id]')?.dataset.lotId;
                if (lotId) updateOwnedLot(id, lotId, { [input.dataset.lotField]: val });
                needsFullRerender = true;
            } else if (input.dataset.acqField) {
                updateOwnedAcquisition(id, { [input.dataset.acqField]: val });
                if (input.dataset.acqField === 'typeBien') needsFullRerender = true;
            } else if (input.dataset.creditField) {
                updateOwnedCredit(id, { [input.dataset.creditField]: val });
            } else if (input.dataset.ownedField) {
                updateOwnedAsset(id, { [input.dataset.ownedField]: val });
                if (input.dataset.ownedField === 'adresse') {
                    geocodeOwnedAsset(id, val, input.closest('.owned-adresse-field')?.querySelector('[data-geocode-hint]'));
                }
            }
            const freshAsset = getOwnedAsset(id);
            if (!freshAsset) return;
            if (needsFullRerender) renderAccordionAcquisition(freshAsset);
            const acq2 = freshAsset.acquisition || {};
            const total2 = (acq2.prix || 0) + (acq2.fraisAgence || 0) + (acq2.fraisNotaire || 0);
            if (nodes.accAcquisitionSummary) {
                nodes.accAcquisitionSummary.textContent = total2 > 0 ? `${Math.round(total2).toLocaleString('fr-FR')} € investis` : '';
            }
            if (nodes.ownedDetailTitle) {
                const metaEl = nodes.ownedDetailTitle.querySelector('.owned-detail-title__meta');
                if (metaEl) metaEl.textContent = `${freshAsset.ville}${freshAsset.dateAchat ? ` · Acquis ${formatDateAchat(freshAsset.dateAchat)}` : ''}`;
            }
            renderOwnedSynthese(freshAsset);
            renderOwnedVerdictBlock(freshAsset);
            renderOwnedCalculTab(freshAsset);
            renderAccordionSimulateur(freshAsset);
        });
        nodes.accAcquisitionContent.addEventListener('click', e => {
            const delBtn = e.target.closest('[data-delete-lot]');
            if (delBtn) {
                const id = state.activeOwnedAssetId;
                if (!id) return;
                deleteOwnedLot(id, delBtn.dataset.deleteLot);
                const freshAsset = getOwnedAsset(id);
                renderAccordionAcquisition(freshAsset);
                renderOwnedSynthese(freshAsset);
                renderOwnedCalculTab(freshAsset);
            }
        });
        nodes.accAcquisitionContent.addEventListener('submit', e => {
            const form = e.target.closest('[data-form="add-lot"]');
            if (!form) return;
            e.preventDefault();
            const id = state.activeOwnedAssetId;
            if (!id) return;
            const fd = new FormData(form);
            addOwnedLot(id, {
                nom: fd.get('nom'),
                loyer: Number(fd.get('loyer')) || 0,
                vacance: Number(fd.get('vacance')) || 0,
                locataire: fd.get('locataire'),
            });
            showToast('Lot ajouté');
            const freshAsset = getOwnedAsset(id);
            renderAccordionAcquisition(freshAsset);
            renderOwnedSynthese(freshAsset);
            renderOwnedCalculTab(freshAsset);
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
        ${bd.travaux > 0 ? `<div class="cf-breakdown__row">
            <span class="cf-breakdown__op">−</span>
            <span class="cf-breakdown__label">Travaux de l'année</span>
            <span class="cf-breakdown__value cf-breakdown__value--neg">−${fmt(bd.travaux)}</span>
        </div>` : ''}
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
            soit ${cfSign}${Math.abs(Math.round(bd.cfNetNet / 12)).toLocaleString('fr-FR')} €/mois
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

    const currentYear = new Date().getFullYear();
    const totalDed = (post.travaux || [])
        .filter(t => t.tag === 'deductible' && t.date && new Date(t.date).getFullYear() === currentYear)
        .reduce((s, t) => s + t.montant, 0);

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
    // Charges copro n'a de sens que pour un bien en copropriete (appartement/immeuble) : masquee
    // pour une maison plutot que laissee a 0 sans explication. Gestion locative peut concerner
    // n'importe quel type de bien (agence pour une maison aussi) : case a cocher + montant
    // revele au lieu d'un champ toujours visible, pour ne pas donner l'impression que 0 = "non
    // renseigne" alors que 0 = "pas de gestion locative" est le cas courant. Voir demande
    // utilisateur du 2026-08-04.
    const typeBienPostAchat = asset.acquisition?.typeBien || 'appartement';
    const isMaisonPostAchat = typeBienPostAchat === 'maison';
    const hasGestionLocative = displayGestion > 0;

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
            ${isMaisonPostAchat ? '' : `
            <label class="variables-field">
                <span class="variables-label">Charges copro (€/mois)${displayFromYear ? ` <small style="color:var(--text-tertiary)">(depuis ${displayFromYear})</small>` : ''}</span>
                <input class="variables-input" type="number" min="0" step="5" data-post-field="chargesCopro" value="${displayCopro}">
            </label>`}
            <div class="variables-field">
                <span class="variables-label" style="display:flex;align-items:center;gap:6px;cursor:pointer">
                    <input type="checkbox" data-gestion-toggle ${hasGestionLocative ? 'checked' : ''}>
                    Gestion locative${displayFromYear ? ` <small style="color:var(--text-tertiary)">(depuis ${displayFromYear})</small>` : ''}
                </span>
                <input class="variables-input" type="number" min="0" max="20" step="0.5" placeholder="% loyer" data-post-field="gestionLocative" value="${displayGestion}" ${hasGestionLocative ? '' : 'hidden'}>
            </div>
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
                    <button class="owned-travaux-delete" data-delete-charges="${e.annee}" title="Supprimer" aria-label="Supprimer l'entrée de charges ${e.annee}">✕</button>
                </div>
            `).join('') : '<p style="font-size:.82rem;color:var(--text-tertiary);font-style:italic">Ajoutez une année pour suivre l\'évolution des charges.</p>'}
        </div>
        <form class="owned-charges-form" data-form="add-charges" novalidate>
            <input type="number" name="annee" class="variables-input" placeholder="Année" min="${asset.dateAchat ? parseDateAchat(asset.dateAchat).annee : 2020}" step="1" required style="min-width:0">
            <input type="number" name="taxeFonciere" class="variables-input" placeholder="TF (€/an)" min="0" step="10" style="min-width:0">
            <input type="number" name="chargesCopro" class="variables-input" placeholder="Copro (€/mois)" min="0" step="5" style="min-width:0">
            <input type="number" name="gestionLocative" class="variables-input" placeholder="Gestion (%)" min="0" max="20" step="0.5" style="min-width:0">
            <input type="number" name="assurancePNO" class="variables-input" placeholder="PNO (€/an)" min="0" step="10" style="min-width:0">
            <button type="submit" class="btn btn--primary btn--sm">+ Ajouter</button>
        </form>

        <div class="owned-section-title" style="margin-top:20px">Travaux</div>
        <p style="font-size:.82rem;color:var(--text-tertiary)">
            ${(post.travaux || []).length ? `${post.travaux.length} frais enregistré(s)` : 'Aucun frais enregistré.'}
            ${totalDed > 0 ? ` · ${Math.round(totalDed).toLocaleString('fr-FR')} € déductible ${currentYear}` : ''}
        </p>
        <button type="button" class="btn btn--ghost btn--sm" data-action="goto-travaux-tab">Gérer les frais &amp; justificatifs →</button>

        <div class="owned-section-title" style="margin-top:20px">Loyer
            ${asset.ville ? `<button class="btn btn--ghost btn--sm" data-action="analyse-loyer-marche" style="margin-left:auto;font-size:0.75rem" title="Comparer le loyer au marché local">📈 Loyer marché</button>` : ''}
        </div>
        ${(() => {
            const isImmeubleLoyer = (asset.lots || []).length > 0;
            if (isImmeubleLoyer) {
                return `<p style="font-size:.82rem;color:var(--text-tertiary)">
                    Le loyer de cet immeuble est la somme de ses lots (${(asset.lots || []).length} lot(s)) —
                    modifiez-les dans l'onglet Acquisition.
                </p>`;
            }
            const historique = [...(post.loyerHistorique || [])].sort((a, b) => b.mois.localeCompare(a.mois));
            const loyerActuel = resolveLoyerVacance(asset).loyer;
            const moisDefaut = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
            return `
            <div class="owned-loyer-actuel">
                <span class="owned-loyer-actuel__label">Loyer actuel</span>
                <span class="owned-loyer-actuel__value">${Math.round(loyerActuel).toLocaleString('fr-FR')} €/mois</span>
            </div>
            ${historique.length ? `
            <div class="owned-charges-annuelles-list">
                ${historique.map((e, idx) => `
                    <div class="owned-charges-annuelles-row">
                        <span class="owned-charges-annuelles-row__year">${escapeHtml(e.mois)}</span>
                        <span class="owned-charges-annuelles-row__vals">
                            ${Math.round(e.montant || 0).toLocaleString('fr-FR')} €/mois
                            ${idx === historique.length - 1 ? ' · <em>début de location</em>' : ''}
                        </span>
                        <button class="owned-travaux-delete" data-delete-loyer-hist="${escapeHtml(e.mois)}" title="Supprimer" aria-label="Supprimer le loyer à partir de ${escapeHtml(e.mois)}">✕</button>
                    </div>
                `).join('')}
            </div>` : `<p style="font-size:.82rem;color:var(--text-tertiary);font-style:italic">
                Saisissez le loyer de départ et le mois de début de location. Ajoutez ensuite une ligne
                à chaque changement de loyer.
            </p>`}
            <form class="owned-loyers-form" data-form="add-loyer-hist" novalidate>
                <input type="number" name="montant" class="variables-input" placeholder="Loyer €/mois" min="0" step="10" required style="flex:1;min-width:110px">
                <label class="owned-loyer-date-label">
                    <span>à partir de</span>
                    <input type="month" name="mois" class="variables-input" value="${moisDefaut}" required style="min-width:140px">
                </label>
                <button type="submit" class="btn btn--primary btn--sm">+ Ajouter</button>
            </form>`;
        })()}

        <div class="owned-section-title" style="margin-top:20px">Déficits fonciers reportables</div>
        ${(() => {
            const { lignes, stockTotal } = computeDeficitFoncierHistorique(asset, state.profileData);
            return `
            <p class="owned-caveat">Calculé automatiquement depuis l'historique de ce bien dans l'app (loyers, charges, crédit — régime réel simulé, quel que soit le régime actuellement suivi ci-dessus). Un déficit réel antérieur à la saisie du bien ici n'est pas repris.</p>
            ${stockTotal > 0 ? `<div class="owned-deficit-total">Stock reportable : <strong>${stockTotal.toLocaleString('fr-FR')} €</strong></div>` : ''}
            <table class="owned-loyers-table">
                <thead><tr><th>Année</th><th>Montant</th><th>Utilisé</th><th>Restant</th><th>Expire</th></tr></thead>
                <tbody>
                ${lignes.length ? lignes.map(d => `<tr ${d.expired ? 'style="opacity:0.4"' : ''}>
                        <td>${d.annee}</td>
                        <td>${d.montantInitial.toLocaleString('fr-FR')} €</td>
                        <td>${d.utilise.toLocaleString('fr-FR')} €</td>
                        <td>${d.restant.toLocaleString('fr-FR')} €</td>
                        <td>${d.expired ? '<span style="color:var(--danger)">Expiré</span>' : d.expire}</td>
                    </tr>`).join('') : '<tr><td colspan="5" style="text-align:center;font-style:italic;color:var(--text-tertiary);padding:12px">Aucun déficit détecté sur l\'historique de ce bien</td></tr>'}
                </tbody>
            </table>`;
        })()}

        <div class="owned-section-title" style="margin-top:20px">Notes</div>
        <div class="owned-notes-list">
            ${[...(post.notes || [])].reverse().map(n => `
                <div class="owned-note-entry">
                    <p class="owned-note-text">${escapeHtml(n.text)}</p>
                    <div style="display:flex;align-items:center;gap:8px">
                        <span class="owned-note-date">${new Date(n.createdAt).toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })}</span>
                        <button class="owned-travaux-delete" data-delete-note="${escapeHtml(n.id)}" title="Supprimer" aria-label="Supprimer la note" style="margin-left:auto">✕</button>
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
            renderOwnedCalculTab(fresh);
            renderAccordionSimulateur(fresh);
        });
    });

    // Case a cocher "Gestion locative" : revele/masque le champ montant sur place. Decocher remet
    // le montant a 0 en redeclenchant un 'change' natif sur le champ (deja cable juste au-dessus
    // via [data-post-field]) pour reutiliser exactement la meme logique de sauvegarde/sync que la
    // saisie manuelle, plutot que de la dupliquer ici.
    nodes.accPostAchatContent.querySelector('[data-gestion-toggle]')?.addEventListener('change', e => {
        const amountInput = nodes.accPostAchatContent.querySelector('[data-post-field="gestionLocative"]');
        if (!amountInput) return;
        if (e.target.checked) {
            amountInput.hidden = false;
            amountInput.focus();
        } else {
            amountInput.hidden = true;
            amountInput.value = 0;
            amountInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
    });

    nodes.accPostAchatContent.querySelector('[data-action="goto-travaux-tab"]')?.addEventListener('click', () => {
        const detail = nodes.ownedDetailView;
        detail?.querySelector('.owned-tab[data-tab="travaux"]')?.click();
    });

    nodes.accPostAchatContent.querySelectorAll('[data-delete-charges]').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = state.activeOwnedAssetId;
            if (!id) return;
            deleteOwnedChargesAnnuelles(id, Number(btn.dataset.deleteCharges));
            const fresh = getOwnedAsset(id);
            renderAccordionPostAchat(fresh);
            renderOwnedSynthese(fresh);
            renderOwnedCalculTab(fresh);
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
        const anneeAchatMin = parseDateAchat(getOwnedAsset(id)?.dateAchat).annee;
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
        renderOwnedCalculTab(fresh);
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

    const refreshAfterLoyerChange = id => {
        const fresh = getOwnedAsset(id);
        renderAccordionPostAchat(fresh);
        renderOwnedSynthese(fresh);
        renderOwnedVerdictBlock(fresh);
        renderOwnedCalculTab(fresh);
        renderAccordionAcquisition(fresh);
        renderAccordionSimulateur(fresh);
    };

    nodes.accPostAchatContent.querySelectorAll('[data-delete-loyer-hist]').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = state.activeOwnedAssetId;
            if (!id) return;
            deleteOwnedLoyerHistorique(id, btn.dataset.deleteLoyerHist);
            refreshAfterLoyerChange(id);
        });
    });

    nodes.accPostAchatContent.querySelector('[data-form="add-loyer-hist"]')?.addEventListener('submit', e => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const id = state.activeOwnedAssetId;
        if (!id) return;
        const mois = fd.get('mois');
        if (!mois) return;
        addOwnedLoyerHistorique(id, { mois, montant: Number(fd.get('montant')) || 0 });
        e.target.reset();
        showToast('Loyer enregistré');
        refreshAfterLoyerChange(id);
    });

}

function renderAccordionSimulateur(asset) {
    if (IS_MOBILE_PAGE) return; // bloc desktop uniquement — voir renderOwnedVerdictBlock
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
                                ${scenarios.length > 1 ? `<button class="owned-sim-delete-sc" data-sc-id="${escapeHtml(sc.id)}" title="Supprimer" aria-label="Supprimer le scénario ${escapeHtml(sc.nom)}" style="background:none;border:none;color:var(--text-tertiary);cursor:pointer;font-size:.7rem;padding:0 2px">✕</button>` : ''}
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
            renderOwnedCalculTab(fresh);
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
            dateAchat: asset.dateAchat,
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

// ─── CONNEXION (compte unique PC + iPhone) ───────────────────────────────────

let _authGateWired = false;
function _renderAuthGate() {
    const gate = document.getElementById('owned-auth-gate');
    if (!gate) return;
    if (!gate.innerHTML.trim()) {
        gate.innerHTML = `
            <div class="owned-auth-gate">
                <h2>Portefeuille — Connexion</h2>
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
    if (_authGateWired) return;
    _authGateWired = true;
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

// ─── MIGRATION PONCTUELLE (ancien portefeuille localStorage → Firestore) ─────
// Ne s'affiche que si le portefeuille cloud est vide et qu'un ancien portefeuille local existe sur
// cet appareil — se masque tout seul une fois l'un des deux devenu faux, pas besoin de la retirer.

function _renderMigrationBanner() {
    const el = document.getElementById('owned-migration-banner');
    if (!el) return;
    if (Object.keys(_assetsCache).length > 0) { el.hidden = true; return; }
    let legacy = {};
    try { legacy = JSON.parse(localStorage.getItem('investissementWebOwnedAssets')) || {}; } catch { /* pas de portefeuille local */ }
    const count = Object.keys(legacy).length;
    if (!count) { el.hidden = true; return; }

    el.hidden = false;
    el.innerHTML = `
        <div class="owned-alert owned-alert--info">
            ${count} bien(s) trouvé(s) dans l'ancien stockage local de cet appareil.
            <button type="button" class="btn btn--primary btn--sm" id="owned-migrate-btn">Importer vers le cloud</button>
        </div>`;
    el.querySelector('#owned-migrate-btn')?.addEventListener('click', async e => {
        const btn = e.target;
        btn.disabled = true;
        btn.textContent = 'Import en cours…';
        try {
            for (const [id, asset] of Object.entries(legacy)) {
                await cloudSetAsset(id, asset);
                for (const t of (asset.postAchat?.travaux || [])) {
                    if (!t.pdfFilename) continue;
                    try {
                        const res = await fetch(`/api/documents/${encodeURIComponent(id)}/${encodeURIComponent(t.pdfFilename)}`);
                        if (!res.ok) continue;
                        await cloudUploadDocumentAs(id, t.pdfFilename, await res.blob());
                    } catch { /* PDF illisible localement — ignoré, les autres biens continuent */ }
                }
            }
            let goals = {}, order = [];
            try { goals = JSON.parse(localStorage.getItem('investissementWebPortfolioGoals')) || {}; } catch { /* rien à migrer */ }
            try { order = JSON.parse(localStorage.getItem(STORAGE_KEYS.ownedOrder)) || []; } catch { /* rien à migrer */ }
            const regime = localStorage.getItem('investissementWebOwnedRegime');
            await cloudSaveMeta({ goals, order, ...(regime ? { regime } : {}) });
            showToast(`${count} bien(s) importé(s) dans le cloud`, 'success');
        } catch {
            showToast(`Erreur pendant l'import — réessayez`, 'negative');
            btn.disabled = false;
            btn.textContent = 'Importer vers le cloud';
        }
    });
}

function renderCollections() {
    if (IS_ANALYSIS_WINDOW) {
        nodes.collectionPanel.hidden = true;
        return;
    }
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
    // En attente du premier snapshot Firestore (biens ET regime/profil) : sans _metaLoaded,
    // un rendu prematuré utiliserait la valeur par defaut locale de state.ownedRegime/profileData
    // (ex. "Micro-foncier") le temps que watchPortfolioMeta reponde, provoquant un flash visible
    // du CF net-net avant qu'il ne se corrige vers la vraie valeur (audit UX 2026-07-29).
    if (!_cloudLoaded || !_metaLoaded) return;

    if (state.activeOwnedAssetId) {
        if (nodes.ownedListView) nodes.ownedListView.hidden = true;
        if (nodes.ownedDetailView) nodes.ownedDetailView.hidden = false;
        renderOwnedDetail();
    } else {
        if (nodes.ownedListView) nodes.ownedListView.hidden = false;
        if (nodes.ownedDetailView) nodes.ownedDetailView.hidden = true;
        _renderMigrationBanner();
        renderOwnedPortfolioList();
    }
}


export { renderCollections };
