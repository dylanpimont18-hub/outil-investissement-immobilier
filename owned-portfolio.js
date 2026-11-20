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

import { computeOwnedAssetCF, computePatrimoineNet, computeEndettementGlobal, computePortfolioAlerts, resolveRevenuFoyer, resolveTmiFoyer, resolveScenarioCourant, libellePeriodeCF } from './calculs.js';
import { icone, definirTexteAvecIcone } from './icones.js';
import { state, nodes, IS_MOBILE_PAGE, definirContexte } from './owned-contexte.js';
import { escapeHtml, showToast } from './utils.js';
import { watchAuth, cloudSignIn, watchOwnedAssets, cloudSetAsset, cloudDeleteAssetDoc, watchPortfolioMeta, cloudSaveMeta, cloudUploadDocument, cloudDeleteDocument, cloudDeleteAllDocuments, cloudGeocode } from './owned-cloud.js';
import { watchPrefs, savePref, cloudListArchives, cloudUploadArchive, cloudReadArchive } from './cloud-store.js';
import { nomArchiveUnique } from './archives-regles.js';
import { openAssetReportPreview, openBankDossierModal } from './owned-rapports.js';
import { openCompteResultatModal, openProjectionImpotsModal, openSimulationTravauxModal } from './owned-fiscal.js';
import { openAjoutFacturesModal, openImportDossierModal } from './owned-factures.js';
import { _planifierDecorticage, renderOwnedTravauxTab } from './owned-travaux.js';
import { openOwnedDiagnosticDrawer } from './owned-diagnostic.js';
import { _importPortfolioObject, openOwnedImportModal, renderOwnedMap, renderOwnedPortfolioList } from './owned-liste.js';
import { renderAccordionPostAchat, renderAccordionSimulateur } from './owned-exploitation.js';
import { renderOwnedCalculTab, renderOwnedSynthese } from './owned-calcul.js';
import { closeOwnedDetail, openOwnedDetail, renderOwnedDetail } from './owned-fiche.js';
import { _downloadOrShareFile, _wireOwnedModalEscape } from './owned-outils.js';
export { _showOwnedModal, _downloadOrShareFile, _copyText } from './owned-outils.js';

export { openOwnedDetail, renderOwnedVerdictBlock } from './owned-fiche.js';

export { renderOwnedSynthese, renderOwnedCalculTab, parseOwnedYear } from './owned-calcul.js';

export { renderAccordionPostAchat, renderAccordionSimulateur } from './owned-exploitation.js';

export { renderAccordionAcquisition } from './owned-acquisition.js';

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
export function addOwnedLot(assetId, lot) {
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

export function updateOwnedLot(assetId, lotId, patch) {
    const all = loadOwnedAssets();
    if (!all[assetId]) return;
    all[assetId].lots = (all[assetId].lots || []).map(l => l.id === lotId ? { ...l, ...patch } : l);
    saveOwnedAssets(all);
}

export function deleteOwnedLot(assetId, lotId) {
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

export function deleteOwnedNote(assetId, noteId) {
    const all = loadOwnedAssets();
    if (!all[assetId]) return;
    const post = all[assetId].postAchat || {};
    all[assetId].postAchat.notes = (post.notes || []).filter(n => n.id !== noteId);
    saveOwnedAssets(all);
}

export function addOwnedChargesAnnuelles(assetId, entry) {
    const all = loadOwnedAssets();
    if (!all[assetId]) return;
    const post = all[assetId].postAchat || {};
    const list = [...(post.chargesAnnuelles || [])].filter(e => e.annee !== entry.annee);
    list.push(entry);
    list.sort((a, b) => a.annee - b.annee);
    updateOwnedPostAchat(assetId, { chargesAnnuelles: list });
}

export function deleteOwnedChargesAnnuelles(assetId, annee) {
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
export function addOwnedLoyerHistorique(assetId, entry) {
    const all = loadOwnedAssets();
    if (!all[assetId]) return;
    const post = all[assetId].postAchat || {};
    const list = (post.loyerHistorique || []).filter(e => e.mois !== entry.mois);
    list.push({ mois: entry.mois, montant: Math.max(0, Number(entry.montant) || 0) });
    list.sort((a, b) => a.mois.localeCompare(b.mois));
    updateOwnedPostAchat(assetId, { loyerHistorique: list });
}

export function deleteOwnedLoyerHistorique(assetId, mois) {
    const all = loadOwnedAssets();
    if (!all[assetId]) return;
    const post = all[assetId].postAchat || {};
    updateOwnedPostAchat(assetId, { loyerHistorique: (post.loyerHistorique || []).filter(e => e.mois !== mois) });
}

// Géocode l'adresse d'un bien et mémorise lat/lng dessus, pour la carte du portefeuille.
// Le hint (élément DOM optionnel) donne le retour visuel pendant/après l'appel.
export async function geocodeOwnedAsset(assetId, adresse, hintEl) {
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

export function addOwnedScenario(assetId) {
    const all = loadOwnedAssets();
    if (!all[assetId]) return;
    const id = `sc-${Date.now()}`;
    all[assetId].scenarios.push({
        id, nom: 'Nouveau', variables: { vacance: 5, regime: 'micro-foncier' }
    });
    saveOwnedAssets(all);
    return id;
}

export function updateOwnedScenarioVar(assetId, scenarioId, key, value) {
    const all = loadOwnedAssets();
    if (!all[assetId]) return;
    const sc = all[assetId].scenarios.find(s => s.id === scenarioId);
    if (!sc) return;
    sc.variables[key] = value;
    saveOwnedAssets(all);
}

export function updateOwnedScenarioNom(assetId, scenarioId, nom) {
    const all = loadOwnedAssets();
    if (!all[assetId]) return;
    const sc = all[assetId].scenarios.find(s => s.id === scenarioId);
    if (!sc) return;
    sc.nom = nom;
    saveOwnedAssets(all);
}

export function deleteOwnedScenario(assetId, scenarioId) {
    const all = loadOwnedAssets();
    if (!all[assetId]) return;
    all[assetId].scenarios = all[assetId].scenarios.filter(s => s.id !== scenarioId);
    saveOwnedAssets(all);
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
