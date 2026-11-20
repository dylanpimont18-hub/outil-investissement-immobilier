// Onglet Acquisition d'un bien détenu (découpage d'owned-portfolio.js, audit T7) : données du bien, prix et frais, crédit
// (avec la lecture « pour 1 € emprunté »), localisation et import d'un dossier. Déplacé tel quel : aucun changement de
// comportement.

import { resolveLoyerVacance, parseDateAchat, ratioRemboursement } from './calculs.js';
import { icone } from './icones.js';
import { state, nodes, IS_MOBILE_PAGE } from './owned-contexte.js';
import { escapeHtml, showToast, formatPercent } from './utils.js';
import { openImportDossierModal } from './owned-factures.js';
import { addOwnedLot, deleteOwnedLot, formatDateAchat, geocodeOwnedAsset, getOwnedAsset, renderAccordionSimulateur, renderOwnedCalculTab, renderOwnedSynthese, renderOwnedVerdictBlock, updateOwnedAcquisition, updateOwnedAsset, updateOwnedCredit, updateOwnedLot } from './owned-portfolio.js';

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
