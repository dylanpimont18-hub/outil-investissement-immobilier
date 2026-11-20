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

import { computeOwnedAssetCF, computeOwnedAssetTimeline, computePatrimoineNet, computeEndettementGlobal, getOptimalRegime, computeRevenusLocatifsBruts, computePortfolioAlerts, computeCFBreakdown, computeRegimeComparison, resolveLoyerVacance, parseDateAchat, computeDeficitFoncierHistorique, resolveRevenuFoyer, resolveTmiFoyer, ratioRemboursement, resolveScenarioCourant, estFraisDeductible, computeCFBreakdownReference, libellePeriodeCF, periodeCFReference } from './calculs.js';
import { icone, definirTexteAvecIcone } from './icones.js';
import { state, nodes, IS_MOBILE_PAGE, definirContexte } from './owned-contexte.js';
import { escapeHtml, showToast, formatRatio, formatPercent } from './utils.js';
import { watchAuth, cloudSignIn, watchOwnedAssets, cloudSetAsset, cloudDeleteAssetDoc, watchPortfolioMeta, cloudSaveMeta, cloudUploadDocument, cloudDeleteDocument, cloudDeleteAllDocuments, cloudGeocode } from './owned-cloud.js';
import { watchPrefs, savePref, cloudListArchives, cloudUploadArchive, cloudReadArchive } from './cloud-store.js';
import { nomArchiveUnique } from './archives-regles.js';
import { openAssetReportPreview, openBankDossierModal } from './owned-rapports.js';
import { openCompteResultatModal, openProjectionImpotsModal, openSimulationTravauxModal } from './owned-fiscal.js';
import { _formatMoisFr } from './owned-fichiers.js';
import { openAjoutFacturesModal, openImportDossierModal } from './owned-factures.js';
import { _planifierDecorticage, renderOwnedTravauxTab } from './owned-travaux.js';
import { openOwnedDiagnosticDrawer } from './owned-diagnostic.js';
import { _importPortfolioObject, openOwnedImportModal, renderOwnedMap, renderOwnedPortfolioList, renderOwnedRegimeSelector } from './owned-liste.js';
export { invalidateOwnedMap, renderOwnedPortfolioList } from './owned-liste.js';


export { addOwnedAutreCredit, patchProfileData } from './owned-profil.js';

export { openDocumentPreview, renderOwnedTravauxTab } from './owned-travaux.js';


// Affichage de dateAchat ('YYYY-MM', voir parseDateAchat dans calculs.js) au format français MM/YYYY.
// Accepte aussi une année brute (biens saisis avant l'ajout du mois précis) : affichée telle quelle.
export function formatDateAchat(dateAchat) {
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
export let _authUser = null;
let _cloudLoaded = false; // premier snapshot ownedAssets recu depuis la connexion
let _metaLoaded = false; // premier snapshot portfolioMeta (regime/profil/ordre) recu depuis la connexion
let _prefsLoaded = false; // premier snapshot settings/prefs (densite, tri, filtres d'annee, dernier bien factures)

export function initOwnedPortfolio(deps) {
    definirContexte(deps);
    _initCloudSync();
}

// Un seul compte Firebase pour tout le portefeuille (PC + iPhone) ; tant que personne n'est
// connecte, renderCollections() affiche la grille de connexion (_renderAuthGate) a la place.
let _unsubAssets = null, _unsubMeta = null, _unsubPrefs = null;
function _initCloudSync() {
    watchAuth(user => {
        _authUser = user;
        if (_unsubAssets) { _unsubAssets(); _unsubAssets = null; }
        if (_unsubMeta) { _unsubMeta(); _unsubMeta = null; }
        if (_unsubPrefs) { _unsubPrefs(); _unsubPrefs = null; }
        if (!user) {
            _assetsCache = {};
            _metaCache = {};
            _cloudLoaded = false;
            _metaLoaded = false;
            _prefsLoaded = false;
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
            }
            renderCollections();
        }, () => {});
        // Préférences d'affichage du portefeuille : settings/prefs (cloud-store.js), partagées avec
        // main.js qui y lit les siennes (thème, écrans…). Clé absente → défaut local, jamais écrit.
        _unsubPrefs = watchPrefs(prefs => {
            state.ownedCompact = prefs.ownedCompact === true;
            state.ownedSort = prefs.ownedSort && typeof prefs.ownedSort === 'object' ? prefs.ownedSort : null;
            state.ownedYearFilters = prefs.ownedYearFilters && typeof prefs.ownedYearFilters === 'object' ? prefs.ownedYearFilters : {};
            state.facturesLastAsset = typeof prefs.facturesLastAsset === 'string' ? prefs.facturesLastAsset : null;
            _prefsLoaded = true;
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

export function loadOwnedAssets() {
    // Copie profonde jetable : tout le fichier mute librement l'objet retourne puis appelle
    // saveOwnedAssets() pour committer — reproduit exactement le contrat de l'ancien
    // JSON.parse(localStorage...) qui recreait deja un objet frais a chaque appel.
    return JSON.parse(JSON.stringify(_assetsCache));
}

export function saveOwnedAssets(assets) {
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

export function createOwnedAsset(nom, ville) {
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
        diagnosticHistory: []
    };
    const all = loadOwnedAssets();
    all[id] = asset;
    saveOwnedAssets(all);
    return asset;
}

export function getOwnedAsset(id) {
    return loadOwnedAssets()[id] || null;
}

export function updateOwnedAsset(id, patch) {
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

export function updateOwnedAcquisition(id, patch) {
    const all = loadOwnedAssets();
    if (!all[id]) return;
    all[id].acquisition = { ...all[id].acquisition, ...patch };
    saveOwnedAssets(all);
}

export function updateOwnedCredit(id, patch) {
    const all = loadOwnedAssets();
    if (!all[id]) return;
    all[id].acquisition.credit = { ...all[id].acquisition.credit, ...patch };
    saveOwnedAssets(all);
}

export function updateOwnedPostAchat(id, patch) {
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

// Natures d'un frais (champ `tag`), dans l'ordre des listes déroulantes. 'taxe-fonciere' et
// 'frais-emprunt' (bilan 2026-10-12, B9) sont déductibles au réel comme 'deductible', mais vont en
// case 227 / case 250 de la 2044 et non en travaux (case 224) — voir NATURES_FRAIS_DEDUCTIBLES dans
// calculs.js. `label` : listes déroulantes ; `court` : badge de la liste des frais.
export const NATURES_FRAIS = [
    { value: 'a-classifier', label: 'À classifier', court: 'À classifier', css: 'tag--orange' },
    { value: 'deductible', label: 'Déductible', court: 'Déductible', css: 'tag--green' },
    { value: 'taxe-fonciere', label: 'Taxe foncière (case 227)', court: 'Taxe foncière', css: 'tag--green' },
    { value: 'frais-emprunt', label: "Frais d'emprunt : garantie, courtage, dossier (case 250)", court: "Frais d'emprunt", css: 'tag--green' },
    { value: 'non-deductible', label: 'Non déductible', court: 'Non déductible', css: 'tag--grey' },
];
const NATURES_FRAIS_VALUES = NATURES_FRAIS.map(n => n.value);

export function natureFraisOptionsHtml(selected = 'a-classifier') {
    return NATURES_FRAIS.map(n => `<option value="${n.value}"${n.value === selected ? ' selected' : ''}>${escapeHtml(n.label)}</option>`).join('');
}

// La Cloud Function de lecture des factures ne connaît que 3 natures (deductible, non-deductible,
// a-classifier) : les deux natures B9 sont déduites ici des mots du fournisseur et du résumé.
const RE_TAXE_FONCIERE = /taxe\s+fonci|\btf\b/i;
// Volontairement étroit : « garantie » seul capterait la garantie loyers impayés (assurance du
// bailleur, case 223), le dépôt de garantie ou la garantie décennale.
const RE_FRAIS_EMPRUNT = /courtage|frais\s+de\s+(dossier|garantie)|cr[ée]dit\s+logement|garantie\s+(du\s+pr[êe]t|hypoth|bancaire)|caution\s+(bancaire|du\s+pr[êe]t)|hypoth[èe]que/i;
const RE_PAS_FRAIS_EMPRUNT = /loyers?\s+impay|d[ée]p[ôo]t|d[ée]cennale/i;

export function suggererNatureFrais({ fournisseur = '', description = '', tagSuggestion = '' } = {}) {
    const texte = `${fournisseur || ''} ${description || ''}`;
    if (RE_TAXE_FONCIERE.test(texte)) return 'taxe-fonciere';
    if (RE_FRAIS_EMPRUNT.test(texte) && !RE_PAS_FRAIS_EMPRUNT.test(texte)) return 'frais-emprunt';
    return NATURES_FRAIS_VALUES.includes(tagSuggestion) ? tagSuggestion : 'a-classifier';
}

// Taxe foncière saisie dans les charges (onglet Exploitation) pour l'année d'une date : même
// résolution que computeCompteResultat (entrée chargesAnnuelles la plus récente <= année, sinon
// postAchat.taxeFonciere).
function taxeFonciereChargesAnnee(asset, date) {
    const post = asset?.postAchat || {};
    const annee = date ? new Date(date).getFullYear() : new Date().getFullYear();
    const entree = (post.chargesAnnuelles || [])
        .filter(e => e.annee <= annee)
        .sort((a, b) => b.annee - a.annee)[0];
    return Number(entree ? (entree.taxeFonciere ?? post.taxeFonciere ?? 0) : (post.taxeFonciere ?? 0)) || 0;
}

// Avertissement NON bloquant (B9) : un frais classé « taxe foncière » (ou décrit comme tel) alors
// que la taxe foncière de l'année est déjà dans les charges — elle serait comptée deux fois en
// case 227. Retourne le texte à afficher, ou null.
export function alerteDoublonTaxeFonciere(asset, { tag, description = '', fournisseur = '', date } = {}) {
    const estTF = tag === 'taxe-fonciere' || RE_TAXE_FONCIERE.test(`${fournisseur || ''} ${description || ''}`);
    if (!estTF || !asset) return null;
    const tf = taxeFonciereChargesAnnee(asset, date);
    if (!(tf > 0)) return null;
    return `La taxe foncière est déjà saisie dans les charges (${Math.round(tf).toLocaleString('fr-FR')} €/an) : ne la comptez pas deux fois`;
}

const TRAVAIL_DUPLICATE_MONTANT_TOLERANCE = 2; // €, arrondis de saisie (ex. 149,99 vs 150)
const TRAVAIL_DUPLICATE_JOURS_TOLERANCE = 5; // jours, date de facture vs date de paiement/saisie

// Détection de doublon probable AVANT ajout — critère volontairement simple et non-bloquant (montant
// quasi identique + date proche) : la description peut légitimement différer pour la même dépense
// (ex. « Facture plombier » saisie manuellement vs « Réparation fuite salle de bain » extraite d'une
// facture), donc elle n'entre pas dans le calcul. Retourne l'entrée existante la plus proche (ou null),
// jamais une liste — un seul avertissement suffit, charge à l'appelant de laisser l'utilisateur décider
// (jamais un blocage dur : un vrai doublon existe parfois, ex. deux factures distinctes du même
// montant le même mois). Utilisée par les 5 points d'ajout d'un frais (formulaires, import groupé,
// import dossier, Assistant IA) — centralisée ici pour ne pas dupliquer le critère 5 fois.
export function findSimilarTravail(asset, { montant, date }) {
    const m = Number(montant) || 0;
    if (m <= 0 || !date) return null;
    const target = new Date(date).getTime();
    if (Number.isNaN(target)) return null;

    const travaux = asset?.postAchat?.travaux || [];
    let best = null;
    let bestDeltaJours = Infinity;
    for (const t of travaux) {
        if (Math.abs((t.montant || 0) - m) > TRAVAIL_DUPLICATE_MONTANT_TOLERANCE) continue;
        if (!t.date) continue;
        const tTime = new Date(t.date).getTime();
        if (Number.isNaN(tTime)) continue;
        const deltaJours = Math.abs(tTime - target) / 86400000;
        if (deltaJours <= TRAVAIL_DUPLICATE_JOURS_TOLERANCE && deltaJours < bestDeltaJours) {
            best = t;
            bestDeltaJours = deltaJours;
        }
    }
    return best;
}

export function addOwnedTravail(assetId, travail) {
    const all = loadOwnedAssets();
    if (!all[assetId]) return;
    const entry = {
        id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        date: travail.date || '',
        description: travail.description || '',
        montant: Math.max(0, Number(travail.montant) || 0),
        tag: NATURES_FRAIS_VALUES.includes(travail.tag) ? travail.tag : 'a-classifier',
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
    // Toute facture ajoutée avec justificatif est décortiquée par corps d'état en arrière-plan
    // (onglet Travaux, vue « Par corps d'état ») ; un échec n'affecte jamais le frais enregistré.
    if (entry.pdfFilename) _planifierDecorticage(assetId, entry.id);
    return entry;
}

// Modifie un frais existant. Mêmes validations que addOwnedTravail ; le PDF joint
// (pdfFilename) n'est pas modifiable ici — supprimer/recréer le frais pour le changer.
export function updateOwnedTravail(assetId, travailId, patch) {
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
        tag: NATURES_FRAIS_VALUES.includes(patch.tag) ? patch.tag : current.tag,
        commentaire: patch.commentaire ?? current.commentaire,
        // undefined = champ absent du patch, ne pas toucher ; null = retirer le justificatif.
        pdfFilename: patch.pdfFilename !== undefined ? patch.pdfFilename : current.pdfFilename,
        financeParCredit: patch.financeParCredit !== undefined ? !!patch.financeParCredit : current.financeParCredit
    };
    // Justificatif remplacé ou retiré : le détail par corps d'état décrivait l'ancien, on l'efface
    // (et on décortique le nouveau).
    const justificatifChange = list[idx].pdfFilename !== current.pdfFilename;
    if (justificatifChange) delete list[idx].detail;
    saveOwnedAssets(all);
    if (justificatifChange && list[idx].pdfFilename) _planifierDecorticage(assetId, travailId);
    return list[idx];
}

export function deleteOwnedTravail(assetId, travailId) {
    const all = loadOwnedAssets();
    if (!all[assetId]) return;
    const entry = (all[assetId].postAchat.travaux || []).find(t => t.id === travailId);
    all[assetId].postAchat.travaux = all[assetId].postAchat.travaux.filter(t => t.id !== travailId);
    saveOwnedAssets(all);
    if (entry?.pdfFilename) {
        cloudDeleteDocument(assetId, entry.pdfFilename).catch(() => {});
    }
}

export async function uploadOwnedDocument(assetId, file) {
    return cloudUploadDocument(assetId, file);
}

export function addOwnedNote(assetId, text) {
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
                ? 'Localisé sur la carte'
                : 'Adresse non localisée — vérifiez l\'orthographe';
        }
        renderOwnedMap();
    } catch {
        if (hintEl) hintEl.textContent = 'Localisation indisponible (hors ligne ?)';
    }
}

export function loadPortfolioGoals() {
    return _metaCache.goals || {};
}
export function savePortfolioGoals(goals) {
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


// Échap commun à toutes les modales du portefeuille (B4) : modales génériques (.owned-modal-overlay),
// Import et Suppression (.owned-delete-modal), « Ajouter un bien » mobile (.owned-add-modal) et
// aperçu du Rapport. Posé dès initOwnedPortfolioEvents (avant, il ne l'était qu'à la première modale
// générique, d'où l'Échap muet sur Import). Chaque modale passe par sa fonction de fermeture pour
// remettre son état à zéro (formulaire, bien en attente de suppression).
let _ownedModalEscWired = false;
function _wireOwnedModalEscape() {
    if (_ownedModalEscWired) return;
    _ownedModalEscWired = true;
    document.addEventListener('keydown', e => {
        if (e.key !== 'Escape') return;
        document.querySelectorAll('.owned-modal-overlay').forEach(m => { if (!m.hidden) m.hidden = true; });
        const importModal = document.getElementById('owned-import-modal');
        if (importModal && !importModal.hidden) importModal.hidden = true;
        if (nodes.ownedDeleteModal && !nodes.ownedDeleteModal.hidden) closeOwnedDeleteModal();
        if (nodes.ownedAddModal && !nodes.ownedAddModal.hidden) closeOwnedAddModal();
    });
}

export function _showOwnedModal(html, id = 'owned-generic-modal') {
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

// ─── COÛT D'UN EURO EMPRUNTÉ (formulaire Crédit d'un bien) ───────────────────
// Lecture directe sous les champs Durée/Taux du crédit : « pour 1 € emprunté, X € remboursés ».
// Même formule que la calculette de la barre latérale (ratioRemboursement, calculs.js). Rien
// n'est affiché tant que le crédit n'a pas de durée (bien payé comptant ou saisie incomplète).
function renderRatioCreditOwned(credit) {
    if (!(Number(credit?.duree) > 0)) return '';
    const r = ratioRemboursement(credit.taux || 0, credit.duree);
    if (r.ratio === null) return '';
    const fmt3 = v => v.toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
    const fmt1 = v => v.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
    const borne = r.borne
        ? ` <span class="ratio-credit-readout__borne">(calcul borné à ${fmt1(r.taux)} % sur ${fmt1(r.duree)} ans)</span>`
        : '';
    return `<div class="ratio-credit-readout ratio-credit-readout--owned">Pour <strong>1 €</strong> emprunté : <strong>${fmt3(r.ratio)} €</strong> remboursés sur ${fmt1(r.duree)} ans, soit ${fmt1(r.pctInterets)} % d'intérêts (hors assurance)${borne}</div>`;
}

// Remet un fichier à l'utilisateur : feuille de partage sur écran tactile (iOS, où un lien blob ne
// télécharge rien en mode écran d'accueil), téléchargement classique sinon. Partagé avec l'export
// JSON du portefeuille. À appeler dans le geste utilisateur (navigator.share l'exige).
export async function _downloadOrShareFile(file, title) {
    if (window.matchMedia?.('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
        try {
            await navigator.share({ files: [file], title });
        } catch (err) {
            if (err?.name !== 'AbortError') showToast('Partage impossible, utilisez Copier', 'negative');
        }
        return;
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function _copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        // Repli (contexte non sécurisé / WebView sans API Clipboard)
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch { ok = false; }
        ta.remove();
        return ok;
    }
}

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

// TMI "taux courant" (année en cours) — pour les fonctions qui répondent à « si ma situation
// actuelle se maintient » (computeOwnedAssetCF, cartes, KPI...), jamais pour une reconstruction
// d'année fiscale précise (celles-ci reçoivent state.profileData directement et résolvent le TMI
// de CHAQUE année visée elles-mêmes — voir resolveTmiFoyer, calculs.js).
export function getOwnedTmi() {
    return resolveTmiFoyer(state.profileData, new Date().getFullYear());
}

export function getOwnedRegime() {
    return state.ownedRegime || 'micro-foncier';
}

export function setOwnedRegime(regime) {
    state.ownedRegime = regime;
    _metaCache = { ..._metaCache, regime };
    if (_authUser) cloudSaveMeta({ regime }).catch(() => {});
}

// Scénario des chiffres « au rythme actuel » (liste, dashboard, KPI, rapports) : le scénario
// réaliste, mais avec la vacance de l'onglet Exploitation (resolveScenarioCourant, calculs.js) —
// l'éditeur des scénarios est masqué, sa vacance par défaut (5 %) ne doit plus rien piloter.
// Le simulateur de scénarios (renderOwnedScenarios) lit, lui, asset.scenarios tels que saisis.
export function getOwnedDefaultScenario(asset) {
    return resolveScenarioCourant(asset);
}

export function getOrderedAssetList() {
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

// Résumé JSON du portefeuille entier pour l'Assistant IA (assistant-chat.js) — mêmes primitives
// que renderOwnedDashboard (calculs.js), mais sous forme de données plutôt que de rendu DOM.
// Volontairement compact (pas de justificatifs/documents) : un bien sans données saisies (prix=0)
// est inclus quand même, l'IA doit pouvoir signaler qu'il manque d'infos.
export function buildPortfolioSummaryForAI() {
    const list = getOrderedAssetList();
    const regime = getOwnedRegime();
    const profileData = state.profileData || {};
    const tmi = getOwnedTmi();
    const revenusMens = resolveRevenuFoyer(profileData, new Date().getFullYear()) / 12;

    const biens = list.map(asset => {
        const sc = getOwnedDefaultScenario(asset);
        const cf = computeOwnedAssetCF(asset, { ...sc.variables, regime }, tmi, null, profileData);
        const pn = computePatrimoineNet(asset);
        return {
            id: asset.id,
            nom: asset.nom,
            ville: asset.ville,
            dateAchat: asset.dateAchat,
            prixAchat: asset.acquisition?.prix || 0,
            loyerMensuel: asset.acquisition?.loyerInitial || 0,
            credit: asset.acquisition?.credit,
            cfNetNetMensuel: Math.round(cf.cfNetNet),
            cfPeriode: libellePeriodeCF(cf.periode) + ', hors frais ponctuels',
            patrimoineNet: Math.round(pn.patrimoineNet || 0),
            crd: Math.round(pn.crd || 0)
        };
    });

    const endettement = computeEndettementGlobal(list, revenusMens, profileData.autresCredits || []);
    const alerts = computePortfolioAlerts(list, profileData, regime, revenusMens);
    const totalCF = biens.reduce((s, b) => s + b.cfNetNetMensuel, 0);
    const totalPatNet = biens.reduce((s, b) => s + b.patrimoineNet, 0);

    return {
        regimeFiscal: regime,
        tmiFoyer: tmi,
        nombreBiens: biens.length,
        biens,
        totaux: { cfNetNetMensuel: Math.round(totalCF), patrimoineNet: Math.round(totalPatNet) },
        endettement: {
            tauxEndettement: Math.round(endettement.tauxEndettement * 10) / 10,
            capaciteResiduelleMensuelle: Math.round(endettement.capaciteResiduelle)
        },
        alertes: alerts.map(a => a.msg)
    };
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

function closeOwnedAddModal() {
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

function closeOwnedDeleteModal() {
    if (!nodes.ownedDeleteModal) return;
    nodes.ownedDeleteModal.hidden = true;
    nodes.ownedDeleteModal._pendingId = null;
    if (nodes.ownedDeleteModalInput) nodes.ownedDeleteModalInput.value = '';
}

let _ownedTransitionTimer = null;

export function openOwnedDetail(assetId) {
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
        nodes.ownedDiagnosticBtn.hidden = !hasData;
        nodes.ownedDiagnosticBtn.disabled = !hasData;
    }
    if (nodes.ownedReportBtn) {
        nodes.ownedReportBtn.hidden = !((asset.acquisition?.prix || 0) > 0);
    }
    if (nodes.ownedBankDossierBtn) {
        nodes.ownedBankDossierBtn.hidden = IS_MOBILE_PAGE;
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
    // Défaut 'actuel' = CF de référence (12 prochains mois, chantier CF unique), le même chiffre que
    // la liste et le dashboard ; avant, l'année civile en cours ÷ 12 (diluée l'année d'achat).
    const yr = (state.ownedYearFilters?.[asset.id]) ?? 'actuel';
    const YEAR_OPTIONS = ['actuel', 1, 3, 5, 10];

    let cfNetNet, basePeriode;
    if (yr === 'actuel') {
        const r = computeOwnedAssetCF(asset, getOwnedDefaultScenario(asset).variables, getOwnedTmi(), regime, state.profileData);
        cfNetNet = Math.round(r.cfNetNet);
        basePeriode = libellePeriodeCF(r.periode);
    } else {
        const { years: timeline } = computeOwnedAssetTimeline(asset, state.profileData, regime);
        const targetAbsYear = anneeAchat + yr - 1;
        const yearRow = timeline.find(y => y.year === targetAbsYear) || timeline[timeline.length - 1];
        cfNetNet = Math.round((yearRow ? yearRow.cfAnnuel : 0) / 12);
        basePeriode = libelleAnneeCF(asset, yr);
    }

    const effort = Math.max(0, -cfNetNet);

    const cfTone = cfNetNet > 0 ? 'positive' : cfNetNet >= -100 ? 'watch' : 'negative';
    const cfSign = cfNetNet > 0 ? '+' : '';
    const effortTone = effort === 0 ? 'positive' : effort < 200 ? 'watch' : 'negative';

    const yearSelectorHtml = `
        <div class="owned-year-selector" style="margin-bottom:8px">
            <span class="owned-year-selector__label">Vue</span>
            <div class="owned-year-selector__btns">
                ${YEAR_OPTIONS.map(y => ownedYearButtonHTML(y, yr, anneeAchat, 'data-verdict-year')).join('')}
            </div>
        </div>`;

    el.innerHTML = yearSelectorHtml + `
        <div class="owned-verdict__grid">
            <div class="owned-verdict__metric">
                <span class="owned-verdict__label">CF net-net / mois · ${escapeHtml(basePeriode)}</span>
                <span class="owned-verdict__value owned-verdict__value--${cfTone}">${cfSign}${cfNetNet.toLocaleString('fr-FR')} €</span>
            </div>
            <div class="owned-verdict__metric">
                <span class="owned-verdict__label">Effort d'épargne / mois</span>
                <span class="owned-verdict__value owned-verdict__value--${effortTone}">${effort.toLocaleString('fr-FR')} €/mois</span>
            </div>
        </div>
    `;

    el.querySelectorAll('[data-verdict-year]').forEach(btn => {
        btn.addEventListener('click', () => {
            state.ownedYearFilters = { ...(state.ownedYearFilters || {}), [asset.id]: parseOwnedYear(btn.dataset.verdictYear) };
            savePref({ ownedYearFilters: state.ownedYearFilters }).catch(() => {});
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

// Alertes uniquement (régime optimal plus avantageux, seuil micro-foncier dépassé, loyer sous-évalué)
// — toujours visibles au-dessus des onglets, PC et mobile. Les indicateurs chiffrés et le comparatif
// des régimes ont été déplacés dans l'onglet Calcul (renderOwnedCalculTab), voir spec
// docs/superpowers/specs/2026-08-04-onglet-calcul-portefeuille.md.
export function renderOwnedSynthese(asset) {
    if (!nodes.ownedSynthese) return;
    const acq = asset.acquisition || {};
    const hasData = (acq.prix || 0) > 0;

    if (!hasData) {
        nodes.ownedSynthese.innerHTML = '';
        return;
    }

    const tmi = getOwnedTmi();
    const currentRegime = getOwnedRegime();
    const optRegime = getOptimalRegime(asset, tmi, state.profileData);
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
        ${alerteMicroFoncier ? `<div class="owned-alert owned-alert--error">${icone('alerte')} Revenus fonciers bruts ${Math.round(revenusBruts).toLocaleString('fr-FR')} €/an — Micro-foncier interdit au-delà de 15 000 €. Changez de régime.</div>` : ''}
        ${hasOptAlert ? `<div class="owned-alert owned-alert--info">${icone('ampoule')} ${REGIME_LABELS_SHORT[optRegime.optimal]} serait plus favorable de <strong>+${Math.round(optGain).toLocaleString('fr-FR')} €/mois</strong> pour ce bien${optRegime.optimal === 'sci-is' ? ' <span class="owned-caveat" data-tooltip="Comparaison basée sur le seul CF net-net : ne compte pas les frais de structure d\'une SCI-IS (comptable, formalisme, ~1500-2500 €/an) ni sa fiscalité de sortie, moins favorable (pas d\'abattement pour durée de détention, flat tax sur les dividendes).">(hors frais de structure et fiscalité de sortie)</span>' : ''}</div>` : ''}
        ${loyerSousEvalue ? `<div class="owned-alert owned-alert--warning">${icone('graphique')} Loyer potentiellement sous-évalué : marché à <strong>${Math.round(loyerMarche.loyerMedian).toLocaleString('fr-FR')} €/mois</strong> (médiane sur ${loyerMarche.nbSamples} biens)</div>` : ''}
    `;
}

// Onglet Calcul : détail de tous les indicateurs d'un bien, identique PC et mobile — indicateurs clés,
// défiscalisation (comparaison des régimes pour le scénario courant), détail CF net-net (avec sélecteur
// d'année partagé avec le bloc Verdict via state.ownedYearFilters), flux de trésorerie annuel
// (renderOwnedCfTable, cible owned-cf-table-wrap séparément), comparatif des régimes dans le temps,
// accès au compte de résultat. Voir docs/superpowers/specs/2026-08-04-onglet-calcul-portefeuille.md.
export function renderOwnedCalculTab(asset) {
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

    const montant = credit.montant || 0;
    const investTotal = (acq.prix || 0) + (acq.fraisAgence || 0) + (acq.fraisNotaire || 0);
    const apport = Math.max(0, investTotal - montant);

    // Métriques scénario courant — régime global
    const r = computeOwnedAssetCF(asset, sc.variables, tmi, regime, state.profileData);
    // Mensualité = échéance du mois civil courant (même source que le CF, la liste et le rapport du
    // bien) : avant, l'assurance de l'année civile ÷ 12 était diluée l'année d'achat (bilan B3,
    // 470 € ici contre 492 € dans le rapport). Crédit soldé ou pas encore démarré : 0 €.
    const assuranceMens = r.assuranceMensuelle;
    const mensualiteTotale = r.mensualiteTotale;
    const periodeCF = libellePeriodeCF(r.periode);
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
        const rd = computeOwnedAssetCF(asset, { ...sc.variables, regime: key }, tmi, null, state.profileData);
        return { key, label, impots: rd.impotsAnnee, cfNetNet: rd.cfNetNet };
    });

    // Patrimoine net
    const patNet = computePatrimoineNet(asset);
    const patTone = patNet.patrimoineNet !== null ? (patNet.patrimoineNet >= 0 ? 'positive' : 'negative') : '';

    // Régime optimal (pour le badge sur les cartes défiscalisation)
    const optRegime = getOptimalRegime(asset, tmi, state.profileData);

    // Détail CF net-net — sélecteur d'année, état partagé avec le bloc Verdict (state.ownedYearFilters)
    const { annee: anneeAchat } = parseDateAchat(asset.dateAchat);
    const yr = (state.ownedYearFilters?.[asset.id]) ?? 'actuel';
    const YEAR_OPTIONS = ['actuel', 1, 3, 5, 10];
    const yearSelectorHtml = `
        <div class="owned-year-selector" style="margin-bottom:8px">
            <span class="owned-year-selector__label">Vue</span>
            <div class="owned-year-selector__btns">
                ${YEAR_OPTIONS.map(y => ownedYearButtonHTML(y, yr, anneeAchat, 'data-calcul-year')).join('')}
            </div>
        </div>`;
    const breakdown = yr === 'actuel'
        ? computeCFBreakdownReference(asset, state.profileData, regime)
        : computeCFBreakdown(asset, state.profileData, regime, yr);
    const breakdownHtml = breakdown ? renderCFBreakdownHTML(breakdown, yr === 'actuel' ? libellePeriodeCF(breakdown.periode) : libelleAnneeCF(asset, yr)) : '';

    topEl.innerHTML = `
        <div class="owned-section-title">Indicateurs clés</div>
        <div class="owned-synthese__cards">
            <div class="owned-synthese__card">
                <span class="owned-synthese__card-label">Mensualité crédit</span>
                <span class="owned-synthese__card-value">${Math.round(mensualiteTotale).toLocaleString('fr-FR')} €/mois</span>
                ${mensualiteTotale > 0 ? `<span class="owned-synthese__card-sub">${assuranceMens > 0 ? `dont ${Math.round(assuranceMens).toLocaleString('fr-FR')} € assurance · ` : ''}moyenne des 12 prochains mois</span>` : ''}
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
                <span class="owned-synthese__card-sub">${escapeHtml(periodeCF)}</span>
            </div>
            <div class="owned-synthese__card">
                <span class="owned-synthese__card-label">CF après impôt</span>
                <span class="owned-synthese__card-value owned-synthese__card-value--${cfApresTone}">
                    ${r.cfNetNet >= 0 ? '+' : ''}${Math.round(r.cfNetNet).toLocaleString('fr-FR')} €/mois
                </span>
                <span class="owned-synthese__card-sub">${escapeHtml(periodeCF)}, hors frais ponctuels</span>
            </div>
            <div class="owned-synthese__card">
                <span class="owned-synthese__card-label">Renta brute</span>
                <span class="owned-synthese__card-value">${r.rentaBrute.toFixed(1).replace('.', ',')} %</span>
            </div>
            <div class="owned-synthese__card">
                <span class="owned-synthese__card-label" data-tooltip="Capacité de remboursement par le loyer : loyers ÷ mensualité crédit. Au-dessus de 1, le loyer couvre intégralement le crédit.">DSCR</span>
                <span class="owned-synthese__card-value ${dscrTone ? `owned-synthese__card-value--${dscrTone}` : ''}">
                    ${formatRatio(r.dscr)}
                </span>
            </div>
            <div class="owned-synthese__card ${patNet.patrimoineNet !== null ? (patTone === 'positive' ? 'owned-synthese__card--patrimoine-pos' : 'owned-synthese__card--patrimoine-neg') : ''}">
                <span class="owned-synthese__card-label">Patrimoine net</span>
                ${patNet.patrimoineNet !== null
                    ? `<span class="owned-synthese__card-value owned-synthese__card-value--${patTone}">${patNet.patrimoineNet >= 0 ? '+' : ''}${patNet.patrimoineNet.toLocaleString('fr-FR')} €</span>
                       <span class="owned-synthese__card-sub">Valeur ${patNet.valeurEstimee.toLocaleString('fr-FR')} € − CRD ${patNet.crd.toLocaleString('fr-FR')} €</span>`
                    : `<span class="owned-synthese__card-value" style="color:var(--text-tertiary)">—</span>
                       <span class="owned-synthese__card-sub"><a href="#" data-action="focus-valeur-estimee" style="color:var(--accent-text)">Renseigner la valeur</a></span>`
                }
            </div>
        </div>
        <div class="owned-synthese__title" style="margin-top:16px">Comparaison des régimes — ${escapeHtml(libellePeriodeCF(periodeCFReference()))}
            <button class="btn btn--ghost btn--sm" data-action="open-simu-travaux" style="margin-left:auto;font-size:0.75rem">${icone('outil')} Simuler des travaux</button>
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
                    <span class="owned-synthese__defisca-name">${d.label}${isActive ? ` ${icone('coche')}` : ''}${isOptimal && !isActive ? ` <span class="owned-badge owned-badge--optimal"${optimalTooltip}>Optimal</span>` : ''}${isOptimal && isActive ? ` <span class="owned-badge owned-badge--optimal"${optimalTooltip}>${icone('coche')} Optimal</span>` : ''}</span>
                    <div class="owned-synthese__defisca-row">
                        <span>Impôts sur 12 mois</span>
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
            state.ownedYearFilters = { ...(state.ownedYearFilters || {}), [asset.id]: parseOwnedYear(btn.dataset.calculYear) };
            savePref({ ownedYearFilters: state.ownedYearFilters }).catch(() => {});
            renderOwnedCalculTab(asset);
            if (!IS_MOBILE_PAGE) renderOwnedVerdictBlock(asset);
        });
    });

    renderOwnedCfTable(asset);

    const cmp = computeRegimeComparison(asset, state.profileData);
    const anneeComp = new Date().getFullYear();
    bottomEl.innerHTML = `
        <div class="owned-section-title" style="margin-top:20px">Comparaison des régimes — par année civile de détention</div>
        ${renderRegimeComparisonHTML(cmp, asset)}
        <button type="button" class="btn btn--ghost btn--sm" data-action="open-compte-resultat" data-annee="${anneeComp}" style="margin-top:12px">${icone('graphique')} Compte de résultat ${anneeComp}</button>
    `;
}

export function renderAccordionAcquisition(asset) {
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
        ${IS_MOBILE_PAGE ? '' : `
        <div class="owned-import-dossier-row">
            <button type="button" class="btn btn--ghost btn--sm" data-action="import-dossier">${icone('dossier')} Importer un dossier de documents</button>
            <span class="owned-caveat">Acte de vente, offre de prêt, taxe foncière, charges copro… pré-remplit les champs ci-dessous</span>
        </div>`}
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
                            ? 'Localisé sur la carte'
                            : 'Adresse non localisée — vérifiez l\'orthographe')
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
                    <td><input class="variables-input variables-input--sm" type="text" data-lot-field="nom" aria-label="Nom du lot" value="${escapeHtml(l.nom)}"></td>
                    <td><input class="variables-input variables-input--sm" type="number" min="0" step="10" data-lot-field="loyer" aria-label="Loyer (€/mois) de ${escapeHtml(l.nom)}" value="${l.loyer}"></td>
                    <td><input class="variables-input variables-input--sm" type="number" min="0" max="100" step="1" data-lot-field="vacance" aria-label="Vacance (%) de ${escapeHtml(l.nom)}" value="${l.vacance}"></td>
                    <td><input class="variables-input variables-input--sm" type="text" data-lot-field="locataire" aria-label="Locataire de ${escapeHtml(l.nom)}" value="${escapeHtml(l.locataire || '')}" placeholder="Nom locataire"></td>
                    <td><button class="owned-travaux-delete" data-delete-lot="${escapeHtml(l.id)}" title="Supprimer ce lot" aria-label="Supprimer ${escapeHtml(l.nom)}">${icone('croix')}</button></td>
                </tr>`).join('') : '<tr><td colspan="5" style="text-align:center;font-style:italic;color:var(--text-tertiary);padding:12px">Aucun lot — ajoutez le premier lot ci-dessous</td></tr>'}
            </tbody>
        </table>
        <form class="owned-loyers-form" data-form="add-lot" novalidate>
            <label class="field-inline"><span class="field-inline__label">Nom du lot</span><input type="text" name="nom" class="variables-input" placeholder="Nom du lot (ex. Appt 1)" style="flex:1;min-width:120px"></label>
            <label class="field-inline"><span class="field-inline__label">Loyer (€/mois)</span><input type="number" name="loyer" class="variables-input" placeholder="Loyer €/mois" min="0" step="10" style="flex:1;min-width:80px"></label>
            <label class="field-inline"><span class="field-inline__label">Vacance (%)</span><input type="number" name="vacance" class="variables-input" placeholder="Vacance %" min="0" max="100" step="1" value="5" style="flex:1;min-width:80px"></label>
            <label class="field-inline"><span class="field-inline__label">Locataire</span><input type="text" name="locataire" class="variables-input" placeholder="Locataire" style="flex:1;min-width:100px"></label>
            <button type="submit" class="btn btn--primary btn--sm">+ Ajouter un lot</button>
        </form>
        ${lots.length ? `<div class="owned-caveat" style="margin-top:6px">CF consolidé sur ${lots.length} lot${lots.length > 1 ? 's' : ''} : ${Math.round(resolveLoyerVacance(asset).loyer).toLocaleString('fr-FR')} €/mois de loyer cumulé, ${formatPercent(resolveLoyerVacance(asset).vacancePct)} de vacance pondérée.</div>` : ''}
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
        ${renderRatioCreditOwned(credit)}
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
                return;
            }
            if (e.target.closest('[data-action="import-dossier"]')) {
                const id = state.activeOwnedAssetId;
                if (!id) return;
                openImportDossierModal(id);
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

// Sélecteur « 12 mois / An 1 / An 3 / An 5 / An 10 » (chantier CF unique) : 'actuel' = CF de référence.
export function parseOwnedYear(v) {
    return v === 'actuel' ? 'actuel' : Number(v);
}
function ownedYearButtonHTML(y, yr, anneeAchat, attr) {
    const active = y === yr ? ' owned-year-btn--active' : '';
    if (y === 'actuel') {
        return `<button class="owned-year-btn${active}" ${attr}="actuel" title="CF de référence : moyenne des 12 prochains mois, hors frais ponctuels">12 mois</button>`;
    }
    return `<button class="owned-year-btn${active}" ${attr}="${y}">An ${y} <span style="font-size:11px;opacity:.6">${anneeAchat + y - 1}</span></button>`;
}
// Libellé d'une année civile de détention : « An 1 · 2026, 5 mois détenus » / « An 3 · 2028 ».
function libelleAnneeCF(asset, yr) {
    const { annee: anneeAchat, mois: moisAchat } = parseDateAchat(asset.dateAchat);
    const annee = anneeAchat + yr - 1;
    const mois = yr === 1 ? 13 - moisAchat : 12;
    return `An ${yr} · ${annee}${mois < 12 ? `, ${mois} mois détenu${mois > 1 ? 's' : ''}` : ''}`;
}

// basePeriode : libellé de la période (« 12 prochains mois (…) » ou « An 1 · 2026, 5 mois détenus »).
function renderCFBreakdownHTML(bd, basePeriode) {
    const fmt = v => Math.abs(v).toLocaleString('fr-FR') + ' €';
    const cfCls = bd.cfNetNet >= 0 ? 'pos' : bd.cfNetNet >= -50 ? 'watch' : 'neg';
    const cfSign = bd.cfNetNet >= 0 ? '+' : '−';
    return `<div class="cf-breakdown">
        <div class="cf-breakdown__title">Décomposition du CF — ${escapeHtml(basePeriode)}</div>
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
            <span class="cf-breakdown__label">CF net-net sur la période</span>
            <span class="cf-breakdown__value cf-breakdown__value--${cfCls}">${cfSign}${fmt(bd.cfNetNet)}</span>
        </div>
        <div style="font-size:12px;color:var(--text-tertiary);margin-top:6px;padding-left:24px">
            soit ${cfSign}${Math.abs(Math.round(bd.cfNetNet / 12)).toLocaleString('fr-FR')} €/mois
        </div>
    </div>`;
}

// Audit 2026-11-18, F6 : chaque colonne est une année civile de détention (« An 1 · 2024 »), alors que
// les cartes du haut de l'onglet portent sur les 12 prochains mois : les chiffres diffèrent, la note le dit.
function renderRegimeComparisonHTML(cmp, asset) {
    const REGIME_LABELS = { 'micro-foncier': 'Micro-foncier', 'reel': 'Foncier Réel', 'sci-is': 'SCI-IS' };
    const YEARS = [1, 3, 5, 10];
    const anneeAchat = asset ? parseDateAchat(asset.dateAchat).annee : null;
    const enTete = y => anneeAchat ? `An ${y} · ${anneeAchat + y - 1}` : `An ${y}`;
    const regimes = ['micro-foncier', 'reel', 'sci-is'];
    const fmt = v => v === null ? '—' : (v >= 0 ? '+' : '−') + Math.abs(Math.round(v / 12)).toLocaleString('fr-FR') + ' €/m';
    const cls = v => v === null ? '' : v >= 0 ? 'cf-pos' : 'cf-neg';

    // Alerte : régime optimal change-t-il entre an 1 et an 5 ?
    const opt1 = cmp.optimal[1];
    const opt5 = cmp.optimal[5];
    const alertHtml = (opt1 && opt5 && opt1 !== opt5)
        ? `<div class="regime-comparison__alert">${icone('alerte')} Régime optimal an 1 : <strong>${REGIME_LABELS[opt1]}</strong> — mais en an 5 : <strong>${REGIME_LABELS[opt5]}</strong> devient plus avantageux. Rappel : le foncier réel engage sur 3 ans minimum.</div>`
        : '';

    return `<div class="regime-comparison">
        <div class="regime-comparison__title">CF net-net de chaque année civile, ramené au mois (÷ 12)</div>
        <p class="regime-comparison__note">An 1 = année d'achat, comptée à partir du mois d'achat. Les cartes « ${escapeHtml(libellePeriodeCF(periodeCFReference()))} » plus haut couvrent une autre période : leurs montants diffèrent de ce tableau.</p>
        <table>
            <thead>
                <tr>
                    <th>Régime</th>
                    ${YEARS.map(y => `<th>${enTete(y)}</th>`).join('')}
                </tr>
            </thead>
            <tbody>
                ${regimes.map(regime => `<tr>
                    <td>${REGIME_LABELS[regime]}</td>
                    ${YEARS.map(y => {
                        const v = cmp.byRegime[regime]?.[y] ?? null;
                        const isOpt = cmp.optimal[y] === regime;
                        return `<td><span class="${cls(v)}">${fmt(v)}</span>${isOpt ? `<span class="optimal-badge" role="img" aria-label="Régime optimal">${icone('coche')}</span>` : ''}</td>`;
                    }).join('')}
                </tr>`).join('')}
            </tbody>
        </table>
        ${alertHtml}
    </div>`;
}

export function renderAccordionPostAchat(asset) {
    if (!nodes.accPostAchatContent) return;
    const post = asset.postAchat || {};

    const hasUnclassified = (post.travaux || []).some(t => t.tag === 'a-classifier');
    if (nodes.accPostAchatSummary) {
        nodes.accPostAchatSummary.textContent = hasUnclassified
            ? `${(post.travaux || []).filter(t => t.tag === 'a-classifier').length} travail(x) à classifier`
            : post.travaux?.length ? `${post.travaux.length} travail(x)` : '';
    }

    const currentYear = new Date().getFullYear();
    const totalDed = (post.travaux || [])
        .filter(t => estFraisDeductible(t.tag) && t.date && new Date(t.date).getFullYear() === currentYear)
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
        <div style="font-size:.75rem;color:var(--accent-text);margin-bottom:8px;
          padding:6px 10px;background:var(--surface-raised,var(--surface));
          border-left:2px solid var(--accent);border-radius:4px">
          ${icone('alerte')} Ces valeurs proviennent de l'entrée <strong>${displayFromYear}</strong>
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
                <label class="variables-label" style="display:flex;align-items:center;gap:6px;cursor:pointer">
                    <input type="checkbox" data-gestion-toggle ${hasGestionLocative ? 'checked' : ''}>
                    Gestion locative${displayFromYear ? ` <small style="color:var(--text-tertiary)">(depuis ${displayFromYear})</small>` : ''}
                </label>
                <input class="variables-input" type="number" min="0" max="20" step="0.5" placeholder="% loyer" aria-label="Gestion locative (% du loyer)" data-post-field="gestionLocative" value="${displayGestion}" ${hasGestionLocative ? '' : 'hidden'}>
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
                    <button class="owned-travaux-delete" data-delete-charges="${e.annee}" title="Supprimer" aria-label="Supprimer l'entrée de charges ${e.annee}">${icone('croix')}</button>
                </div>
            `).join('') : '<p style="font-size:.82rem;color:var(--text-tertiary);font-style:italic">Ajoutez une année pour suivre l\'évolution des charges.</p>'}
        </div>
        <form class="owned-charges-form" data-form="add-charges" novalidate>
            <label class="field-inline"><span class="field-inline__label">Année</span><input type="number" name="annee" class="variables-input" placeholder="Année" min="${asset.dateAchat ? parseDateAchat(asset.dateAchat).annee : 2020}" step="1" required style="min-width:0"></label>
            <label class="field-inline"><span class="field-inline__label">Taxe foncière (€/an)</span><input type="number" name="taxeFonciere" class="variables-input" placeholder="TF (€/an)" min="0" step="10" style="min-width:0"></label>
            <label class="field-inline"><span class="field-inline__label">Charges copro (€/mois)</span><input type="number" name="chargesCopro" class="variables-input" placeholder="Copro (€/mois)" min="0" step="5" style="min-width:0"></label>
            <label class="field-inline"><span class="field-inline__label">Gestion locative (%)</span><input type="number" name="gestionLocative" class="variables-input" placeholder="Gestion (%)" min="0" max="20" step="0.5" style="min-width:0"></label>
            <label class="field-inline"><span class="field-inline__label">Assurance PNO (€/an)</span><input type="number" name="assurancePNO" class="variables-input" placeholder="PNO (€/an)" min="0" step="10" style="min-width:0"></label>
            <button type="submit" class="btn btn--primary btn--sm">+ Ajouter</button>
        </form>

        <div class="owned-section-title" style="margin-top:20px">Travaux</div>
        <p style="font-size:.82rem;color:var(--text-tertiary)">
            ${(post.travaux || []).length ? `${post.travaux.length} frais enregistré(s)` : 'Aucun frais enregistré.'}
            ${totalDed > 0 ? ` · ${Math.round(totalDed).toLocaleString('fr-FR')} € déductible ${currentYear}` : ''}
        </p>
        <button type="button" class="btn btn--ghost btn--sm" data-action="goto-travaux-tab">Gérer les frais &amp; justificatifs ${icone('fleche-droite')}</button>

        <div class="owned-section-title" style="margin-top:20px">Loyer</div>
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
                        <span class="owned-charges-annuelles-row__year">${escapeHtml(_formatMoisFr(e.mois))}</span>
                        <span class="owned-charges-annuelles-row__vals">
                            ${Math.round(e.montant || 0).toLocaleString('fr-FR')} €/mois
                            ${idx === historique.length - 1 ? ' · <em>début de location</em>' : ''}
                        </span>
                        <button class="owned-travaux-delete" data-delete-loyer-hist="${escapeHtml(e.mois)}" title="Supprimer" aria-label="Supprimer le loyer à partir de ${escapeHtml(_formatMoisFr(e.mois))}">${icone('croix')}</button>
                    </div>
                `).join('')}
            </div>` : `<p style="font-size:.82rem;color:var(--text-tertiary);font-style:italic">
                Saisissez le loyer de départ et le mois de début de location. Ajoutez ensuite une ligne
                à chaque changement de loyer.
            </p>`}
            <form class="owned-loyers-form" data-form="add-loyer-hist" novalidate>
                <label class="field-inline"><span class="field-inline__label">Loyer (€/mois)</span><input type="number" name="montant" class="variables-input" placeholder="Loyer €/mois" min="0" step="10" required style="flex:1;min-width:110px"></label>
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
                <thead><tr><th>Année</th><th>Montant</th><th>Utilisé</th><th>Restant</th><th>Imputable jusqu'en</th></tr></thead>
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
                        <button class="owned-travaux-delete" data-delete-note="${escapeHtml(n.id)}" title="Supprimer" aria-label="Supprimer la note" style="margin-left:auto">${icone('croix')}</button>
                    </div>
                </div>
            `).join('') || '<p style="font-size:.82rem;color:var(--text-tertiary);font-style:italic">Aucune note.</p>'}
        </div>
        <div class="owned-notes-add">
            <label class="field-inline"><span class="field-inline__label">Nouvelle note</span><textarea class="variables-input owned-notes-textarea" placeholder="Ajouter une note…" rows="3"></textarea></label>
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

export function renderAccordionSimulateur(asset) {
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
            sc.variables.regime ? null : globalRegime, state.profileData)
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
                                    style="background:transparent;border:none;color:inherit;font-weight:700;font-size:0.75rem;text-transform:uppercase;letter-spacing:.06em;width:90px;text-align:center;cursor:text"
                                    title="Renommer le scénario">
                                ${scenarios.length > 1 ? `<button class="owned-sim-delete-sc" data-sc-id="${escapeHtml(sc.id)}" title="Supprimer" aria-label="Supprimer le scénario ${escapeHtml(sc.nom)}" style="background:none;border:none;color:var(--text-tertiary);cursor:pointer;font-size:0.75rem;padding:0 2px">${icone('croix')}</button>` : ''}
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
