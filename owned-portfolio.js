// Module Portefeuille biens detenus — CRUD (ownedAssets, localStorage), rendu (liste, fiche detail,
// onglets Acquisition/Exploitation/Travaux/Projection) et evenements. Extrait de main.js (axe 3).
//
// Interface : initOwnedPortfolio(deps) doit etre appelee en tout premier (avant le premier render()),
// avec { state, nodes, STORAGE_KEYS, IS_ANALYSIS_WINDOW } (les memes objets partages que main.js,
// passes par reference) — renderCollections() en depend des le premier rendu. initOwnedPortfolioEvents()
// cable les listeners persistants et doit etre appelee separement, au meme moment que dans main.js
// avant l'extraction (apres le rendu initial). renderCollections() est ensuite appelee a chaque cycle
// de rendu par main.js.

import {
    calculateTMI, computeOwnedAssetCF, computeOwnedAssetTimeline, computeAmortizationSchedule,
    computePatrimoineNet, computeEndettementGlobal, computeCapaciteEmprunt, getOptimalRegime,
    computeRevenusLocatifsBruts, computeCompteResultat, computePortfolioAlerts,
    computeSimulationTravaux, computeCFBreakdown, computeRegimeComparison, resolveLoyerVacance,
    computeDeclaration2044
} from './calculs.js';
import { escapeHtml, showToast, formatSignedCurrency, formatCompactCurrency } from './utils.js';

let state, nodes, STORAGE_KEYS, IS_ANALYSIS_WINDOW;

export function initOwnedPortfolio(deps) {
    state = deps.state;
    nodes = deps.nodes;
    STORAGE_KEYS = deps.STORAGE_KEYS;
    IS_ANALYSIS_WINDOW = deps.IS_ANALYSIS_WINDOW;
}

export { initOwnedPortfolioEvents };

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
        adresse: '',
        lat: null,
        lng: null,
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
    fetch(`/api/documents/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
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
        credit: travail.credit || null
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
        commentaire: patch.commentaire ?? current.commentaire
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
        fetch(`/api/documents/${encodeURIComponent(assetId)}/${encodeURIComponent(entry.pdfFilename)}`, { method: 'DELETE' }).catch(() => {});
    }
}

async function uploadOwnedDocument(assetId, file) {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`/api/documents/${encodeURIComponent(assetId)}/upload`, { method: 'POST', body: fd });
    const json = await res.json();
    if (!res.ok || !json.filename) {
        throw new Error(json.error || 'upload_failed');
    }
    return json.filename;
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
        const res = await fetch('/api/geocode/address', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ adresse: clean })
        });
        const json = await res.json();
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
    const tmi = getOwnedTmi();
    const regime = getOwnedRegime();
    const currentYear = new Date().getFullYear();
    const anneeMin = assets.reduce((m, a) => Math.min(m, a.anneeAchat || currentYear), currentYear);
    const annees = [];
    for (let y = Math.max(anneeMin, currentYear - 5); y <= currentYear; y++) annees.push(y);

    const DISCLAIMER = `⚠ Calcul indicatif basé sur vos données saisies — à vérifier avant télédéclaration. Ne remplace pas un professionnel (expert-comptable, centre des impôts). Source : notice DGFiP 2044-NOT-SD.`;

    function buildReel(annee) {
        if (!assets.length) return `<p style="color:var(--text-tertiary);text-align:center">Aucun bien avec un prix d'achat renseigné.</p>`;
        const decl = computeDeclaration2044(assets, annee, tmi);
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

// ─── DASHBOARD DIRIGEANT (vue liste) ─────────────────────────────────────────

function renderOwnedDashboard(list, tmi, regime) {
    const wrap = document.getElementById('owned-dashboard-wrap');
    if (!wrap) return;

    if (!list.length) { wrap.innerHTML = ''; return; }

    const revenusMens = (state.profileData?.income || 0) / 12;
    const endettement = computeEndettementGlobal(list, revenusMens, state.profileData?.autresCredits || []);
    const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 };
    const alerts = computePortfolioAlerts(list, tmi, regime, revenusMens)
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
                <button class="btn btn--ghost btn--sm" data-action="open-declaration">📄 Déclaration fiscale</button>
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
                ${SEVERITY_ICON[a.severity] || '•'} ${escapeHtml(a.msg)}
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

// ─── Carte du portefeuille (Leaflet) ─────────────────────────────────────────
// Un marqueur par bien géocodé (asset.lat/lng, alimentés par geocodeOwnedAsset).
// La carte est instanciée une seule fois puis réutilisée ; L vient de vendor/leaflet.

let _ownedMap = null;
let _ownedMapMarkers = null;

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
                const { years: timeline } = computeOwnedAssetTimeline(asset, tmi, regime);
                const anneeAchat = asset.anneeAchat || new Date().getFullYear();
                const targetAbsYear = anneeAchat + yr - 1;
                const yearRow = timeline.find(y => y.year === targetAbsYear) || timeline[timeline.length - 1];
                const cfAnnuel = yearRow ? yearRow.cfAnnuel : 0;
                const cfMens = cfAnnuel / 12;

                const sc = getOwnedDefaultScenario(asset);
                const r = computeOwnedAssetCF(asset, sc.variables, tmi, regime);
                const investissementTotal = (asset.acquisition?.prix || 0) + (asset.acquisition?.fraisAgence || 0) + (asset.acquisition?.fraisNotaire || 0);
                const rentaNette = investissementTotal > 0
                    ? ((r.loyerEffectif * 12 - r.chargesMensuelles * 12) / investissementTotal) * 100
                    : 0;

                return { asset, cfMens, r, rentaNette, cfAnnuel };
            });

            if (sort) {
                const valueFor = row => sort.criterion === 'cf' ? row.cfMens : sort.criterion === 'rendement' ? row.rentaNette : row.r.dscr;
                rowData.sort((a, b) => (valueFor(a) - valueFor(b)) * (sort.dir === 'asc' ? 1 : -1));
            }

            const sortArrow = key => sort?.criterion === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '';
            const sortHeaderAttr = key => `data-sort-header="${key}" role="button" tabindex="0" title="Trier par ${SORT_LABELS[key]}"`;

            nodes.ownedListTable.innerHTML = yearSelectorHtml + sortSelectorHtml + `
                <table>
                    <thead>
                        <tr>
                            <th class="owned-col-drag"></th>
                            <th></th>
                            <th>Bien</th>
                            <th style="text-align:right" class="owned-col-sortable" ${sortHeaderAttr('cf')}>CF net/mois${sortArrow('cf')}</th>
                            <th style="text-align:right" class="owned-col-hideable owned-col-sortable" ${sortHeaderAttr('rendement')}>Rendement net${sortArrow('rendement')}</th>
                            <th style="text-align:right" class="owned-col-hideable owned-col-sortable" ${sortHeaderAttr('dscr')}>DSCR${sortArrow('dscr')}</th>
                            <th>Statut</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rowData.map(({ asset, cfMens, r, rentaNette, cfAnnuel }) => {
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
                                    <div class="owned-table-meta">${escapeHtml(asset.ville)}${asset.anneeAchat ? ` · ${asset.anneeAchat}` : ''}${regimeAlertHtml ? ' ' + regimeAlertHtml : ''}</div>
                                </td>
                                <td class="owned-table-num owned-table-num--${cfTone}">
                                    ${cfMens >= 0 ? '+' : ''}${Math.round(cfMens).toLocaleString('fr-FR')} €
                                </td>
                                <td class="owned-table-num owned-col-hideable">${rentaNette.toFixed(1).replace('.', ',')} %</td>
                                <td class="owned-table-num owned-col-hideable">${r.dscr.toFixed(2).replace('.', ',')}</td>
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
                <span class="owned-expanded-value owned-expanded-value--${r.dscr >= 1.2 ? 'positive' : r.dscr >= 1 ? 'watch' : 'negative'}">${r.dscr.toFixed(2)}</span>
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

let _ownedTransitionTimer = null;

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
    const hasApportYear = first20.some(y => (y.apportAnnee || 0) > 0);
    const rows = first20.map(y => {
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
        </div>
    `;
}

function openDocumentPreview(assetId, filename) {
    let overlay = document.getElementById('document-preview-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'document-preview-overlay';
        overlay.className = 'document-preview-overlay';
        overlay.innerHTML = `
            <div class="document-preview-dialog">
                <button type="button" class="document-preview-close" aria-label="Fermer">✕</button>
                <embed class="document-preview-embed" type="application/pdf">
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.hidden = true; });
        overlay.querySelector('.document-preview-close').addEventListener('click', () => { overlay.hidden = true; });
    }
    overlay.querySelector('.document-preview-embed').src = `/api/documents/${encodeURIComponent(assetId)}/${encodeURIComponent(filename)}`;
    overlay.hidden = false;
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
                ${travail.pdfFilename
                    ? '<p class="owned-caveat" style="grid-column:1/-1">Le justificatif PDF joint reste inchangé. Pour le remplacer, supprimez ce frais et recréez-le.</p>'
                    : ''}
                <div class="owned-modal-actions" style="grid-column:1/-1">
                    <button type="button" class="btn btn--ghost" data-close-modal>Annuler</button>
                    <button type="submit" class="btn btn--primary">Enregistrer</button>
                </div>
            </form>
        </div>
    `, 'owned-edit-travail-modal');

    modal.querySelector('[data-form="edit-travail"]')?.addEventListener('submit', e => {
        e.preventDefault();
        const fd = new FormData(e.target);
        updateOwnedTravail(assetId, travailId, {
            date: fd.get('date'),
            description: String(fd.get('description') || '').trim(),
            montant: Number(fd.get('montant')),
            tag: fd.get('tag'),
            commentaire: String(fd.get('commentaire') || '').trim()
        });
        modal.hidden = true;
        showToast('Frais modifié');
        const fresh = getOwnedAsset(assetId);
        renderOwnedTravauxTab(fresh);
        renderAccordionPostAchat(fresh);
        renderOwnedSynthese(fresh);
        renderOwnedCharts(fresh);
        renderAccordionSimulateur(fresh);
    });
}

function printSelectedDocuments(assetId, filenames) {
    if (!filenames.length) return;
    const win = window.open('', '_blank');
    if (!win) return;
    const embeds = filenames.map(f => `<embed src="/api/documents/${encodeURIComponent(assetId)}/${encodeURIComponent(f)}" type="application/pdf" class="print-doc-embed">`).join('');
    win.document.write(`
        <!doctype html><html><head><title>Impression des factures</title>
        <style>
            body { margin: 0; }
            .print-doc-embed { width: 100%; height: 100vh; display: block; break-after: page; }
            .print-doc-embed:last-child { break-after: auto; }
        </style>
        </head><body>${embeds}</body></html>
    `);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 500);
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
        <details class="owned-travaux-year" ${isCurrent ? 'open' : ''}>
            <summary class="owned-travaux-year__summary">
                <span>${y === 'sans-date' ? 'Sans date' : y}</span>
                <strong>${Math.round(yearTotal).toLocaleString('fr-FR')} €</strong>
            </summary>
            <div class="owned-travaux-list">
                ${rows.map(t => `
                    <div class="owned-travaux-row">
                        <input type="checkbox" class="owned-travaux-select" data-select-travail="${escapeHtml(t.id)}" ${t.pdfFilename ? '' : 'disabled title="Aucun PDF attaché"'}>
                        <span class="owned-travaux-date">${escapeHtml(t.date || '—')}</span>
                        <span class="owned-travaux-desc">${escapeHtml(t.description || '—')}${t.commentaire ? `<br><small style="color:var(--text-tertiary)">${escapeHtml(t.commentaire)}</small>` : ''}</span>
                        <span class="owned-travaux-montant">${Math.round(t.montant).toLocaleString('fr-FR')} €</span>
                        <span class="tag ${TAG_CSS[t.tag] || 'tag--grey'}">${escapeHtml(TAG_LABELS[t.tag] || t.tag)}</span>
                        ${t.pdfFilename ? `<button type="button" class="owned-travaux-pdf-btn" data-preview-pdf="${escapeHtml(t.pdfFilename)}" title="Voir le PDF" aria-label="Voir le PDF de ${escapeHtml(t.description || 'ce frais')}">📄</button>` : '<span></span>'}
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
            <button type="button" class="btn btn--ghost btn--sm" data-action="print-selection" disabled>🖨 Imprimer la sélection</button>
        </div>
        ${yearBlocksHtml}
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
            <input type="text" name="commentaire" class="variables-input" placeholder="Commentaire (optionnel)" style="flex:1;min-width:120px">
            <input type="file" name="pdf" accept="application/pdf" class="variables-input" style="flex:0 0 220px">
            <button type="submit" class="btn btn--primary btn--sm">Ajouter</button>
        </form>
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
            renderOwnedCharts(fresh);
            renderAccordionSimulateur(fresh);
        });
    });

    el.querySelector('[data-form="add-travail-tab"]')?.addEventListener('submit', async e => {
        e.preventDefault();
        const form = e.target;
        const fd = new FormData(form);
        const id = state.activeOwnedAssetId;
        if (!id) return;
        const file = fd.get('pdf');
        let pdfFilename = null;
        if (file && file.size > 0) {
            try {
                pdfFilename = await uploadOwnedDocument(id, file);
            } catch {
                showToast('Échec de l\'import du PDF', 'negative');
                return;
            }
        }
        addOwnedTravail(id, {
            date: fd.get('date'),
            description: fd.get('description')?.trim(),
            montant: Number(fd.get('montant')),
            tag: fd.get('tag'),
            commentaire: fd.get('commentaire')?.trim(),
            pdfFilename
        });
        form.reset();
        showToast('Frais ajouté');
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
        ${hasOptAlert ? `<div class="owned-alert owned-alert--info">💡 ${REGIME_LABELS_SHORT[optRegime.optimal]} serait plus favorable de <strong>+${Math.round(optGain).toLocaleString('fr-FR')} €/mois</strong> pour ce bien${optRegime.optimal === 'sci-is' ? ' <span class="owned-caveat" data-tooltip="Comparaison basée sur le seul CF net-net : ne compte pas les frais de structure d\'une SCI-IS (comptable, formalisme, ~1500-2500 €/an) ni sa fiscalité de sortie, moins favorable (pas d\'abattement pour durée de détention, flat tax sur les dividendes).">(hors frais de structure et fiscalité de sortie)</span>' : ''}</div>` : ''}
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
                if (metaEl) metaEl.textContent = `${freshAsset.ville}${freshAsset.anneeAchat ? ` · Acquis ${freshAsset.anneeAchat}` : ''}`;
            }
            renderOwnedSynthese(freshAsset);
            renderOwnedVerdictBlock(freshAsset);
            renderOwnedCfTable(freshAsset);
            renderOwnedCharts(freshAsset);
            renderAccordionSimulateur(freshAsset);
            renderOwnedCrdChart(freshAsset);
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
                renderOwnedCfTable(freshAsset);
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
            renderOwnedCfTable(freshAsset);
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
                    <button class="owned-travaux-delete" data-delete-charges="${e.annee}" title="Supprimer" aria-label="Supprimer l'entrée de charges ${e.annee}">✕</button>
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

        <div class="owned-section-title" style="margin-top:20px">Travaux</div>
        <p style="font-size:.82rem;color:var(--text-tertiary)">
            ${(post.travaux || []).length ? `${post.travaux.length} frais enregistré(s)` : 'Aucun frais enregistré.'}
            ${totalDed > 0 ? ` · ${Math.round(totalDed).toLocaleString('fr-FR')} € déductible ${currentYear}` : ''}
        </p>
        <button type="button" class="btn btn--ghost btn--sm" data-action="goto-travaux-tab">Gérer les frais &amp; justificatifs →</button>

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
                        <td><button class="owned-travaux-delete" data-delete-deficit="${d.annee}" title="Supprimer" aria-label="Supprimer le déficit ${d.annee}">✕</button></td>
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

    const refreshAfterLoyerChange = id => {
        const fresh = getOwnedAsset(id);
        renderAccordionPostAchat(fresh);
        renderOwnedSynthese(fresh);
        renderOwnedVerdictBlock(fresh);
        renderOwnedCfTable(fresh);
        renderOwnedCharts(fresh);
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


export { renderCollections };
