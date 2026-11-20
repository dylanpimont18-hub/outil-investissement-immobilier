// Couche données du portefeuille biens détenus (découpage d'owned-portfolio.js, audit T7) : cache local alimenté par les
// abonnements temps réel Firestore (biens, métadonnées, préférences), lecture synchrone `loadOwnedAssets`, écriture
// optimiste `saveOwnedAssets` (diff poussé vers Firestore, jamais au chargement), CRUD des biens, frais, notes, charges,
// loyers, scénarios, objectifs, régime et TMI du portefeuille. Déplacé tel quel : aucun changement de comportement.

import { computeOwnedAssetCF, computePatrimoineNet, computeEndettementGlobal, computePortfolioAlerts, resolveRevenuFoyer, resolveTmiFoyer, resolveScenarioCourant, libellePeriodeCF } from './calculs.js';
import { state } from './owned-contexte.js';
import { escapeHtml, showToast } from './utils.js';
import { watchAuth, watchOwnedAssets, cloudSetAsset, cloudDeleteAssetDoc, watchPortfolioMeta, cloudSaveMeta, cloudUploadDocument, cloudDeleteDocument, cloudDeleteAllDocuments, cloudGeocode } from './owned-cloud.js';
import { watchPrefs } from './cloud-store.js';
import { _planifierDecorticage } from './owned-travaux.js';
import { renderOwnedMap } from './owned-liste.js';
import { renderCollections } from './owned-portfolio.js';

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
export let _cloudLoaded = false; // premier snapshot ownedAssets recu depuis la connexion
export let _metaLoaded = false; // premier snapshot portfolioMeta (regime/profil/ordre) recu depuis la connexion
export let _prefsLoaded = false;

// Un seul compte Firebase pour tout le portefeuille (PC + iPhone) ; tant que personne n'est
// connecte, renderCollections() affiche la grille de connexion (_renderAuthGate) a la place.
let _unsubAssets = null, _unsubMeta = null, _unsubPrefs = null;
export function _initCloudSync() {
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

export function deleteOwnedAsset(id) {
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
