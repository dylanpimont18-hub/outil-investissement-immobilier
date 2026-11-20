// Diagnostic IA du portefeuille biens détenus (découpage d'owned-portfolio.js, audit T7) : tiroir latéral, historique des
// diagnostics par bien, appel de la Cloud Function (cloudDiagnosticPortefeuille) et affichage des recommandations.
// Déplacé tel quel : aucun changement de comportement.

import { computeOwnedAssetCF } from './calculs.js';
import { icone } from './icones.js';
import { state, nodes } from './owned-contexte.js';
import { escapeHtml } from './utils.js';
import { cloudDiagnosticPortefeuille } from './owned-cloud.js';
import { getOwnedAsset, getOwnedTmi, updateOwnedAsset } from './owned-donnees.js';

const OWNED_DIAGNOSTIC_HISTORY_MAX = 10;

function formatOwnedDiagnosticDate(iso) {
    return new Date(iso).toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

// Ouvre le drawer Diagnostic IA sur l'historique du bien (sans lancer d'analyse).
export function openOwnedDiagnosticDrawer(assetId) {
    if (!nodes.ownedAiDrawer || !nodes.ownedAiOverlay || !nodes.ownedAiDrawerContent) return;
    const asset = getOwnedAsset(assetId);
    if (!asset) return;
    void nodes.ownedAiDrawer.offsetWidth;
    nodes.ownedAiDrawer.classList.add('is-open');
    nodes.ownedAiOverlay.classList.add('is-open');
    renderOwnedDiagnosticDrawer(asset.diagnosticHistory || [], 0);
}

// Barre d'action en tête du drawer : bouton "Nouveau diagnostic", puis confirmation inline
// (Annuler / Lancer) avant tout appel IA. `errorHtml` : message d'erreur du dernier essai.
function _diagnosticActionBar(hasHistory, confirming, errorHtml = '') {
    const asset = getOwnedAsset(state.activeOwnedAssetId);
    if (confirming) {
        return `
        <div class="ai-diag-confirm" role="alertdialog" aria-label="Confirmer le diagnostic">
            <p class="ai-diag-confirm__text">Lancer une nouvelle analyse IA de « ${escapeHtml(asset?.nom || 'ce bien')} » ? Elle prend environ 20 secondes${hasHistory ? ' et s\'ajoute à l\'historique' : ''}.</p>
            <div class="ai-diag-confirm__buttons">
                <button type="button" class="btn btn--ghost btn--sm" data-diag-cancel>Annuler</button>
                <button type="button" class="btn btn--primary btn--sm" data-diag-confirm>Lancer l'analyse</button>
            </div>
        </div>`;
    }
    return `
        ${errorHtml}
        <button type="button" class="btn btn--primary ai-diag-new" data-diag-new>${icone('etincelle')} ${hasHistory ? 'Nouveau diagnostic' : 'Lancer le diagnostic'}</button>`;
}

// Rendu du drawer Diagnostic IA : barre d'action (nouveau diagnostic + confirmation), puis
// sélecteur de dates (historique, le plus récent en premier) au-dessus des recommandations de
// l'entrée sélectionnée. history est trié anté-chronologique.
function renderOwnedDiagnosticDrawer(history, selectedIndex, { confirming = false, errorMessage = '' } = {}) {
    const errorHtml = errorMessage
        ? `<p class="ai-diag-error">${escapeHtml(errorMessage)}</p>`
        : '';
    const actionBar = _diagnosticActionBar(history.length > 0, confirming, errorHtml);
    const wireActions = () => {
        const content = nodes.ownedAiDrawerContent;
        content.querySelector('[data-diag-new]')?.addEventListener('click', () =>
            renderOwnedDiagnosticDrawer(history, selectedIndex, { confirming: true }));
        content.querySelector('[data-diag-cancel]')?.addEventListener('click', () =>
            renderOwnedDiagnosticDrawer(history, selectedIndex));
        content.querySelector('[data-diag-confirm]')?.addEventListener('click', () => {
            const id = state.activeOwnedAssetId;
            if (id) callOwnedDiagnosticIA(id);
        });
    };

    if (!history.length) {
        nodes.ownedAiDrawerContent.innerHTML = `
            ${actionBar}
            <p style="color:var(--text-secondary);text-align:center;padding:24px">Aucun diagnostic pour ce bien pour le moment.</p>`;
        wireActions();
        return;
    }
    const entry = history[selectedIndex] || history[0];
    const tabs = history.length > 1 ? `
        <div class="portfolio-ai-drawer__history" role="tablist" aria-label="Historique des diagnostics">
            ${history.map((h, i) => `
                <button type="button" class="portfolio-ai-drawer__history-tab${i === selectedIndex ? ' is-active' : ''}" data-diag-index="${i}" role="tab" aria-selected="${i === selectedIndex}">${formatOwnedDiagnosticDate(h.date)}</button>
            `).join('')}
        </div>
    ` : '';

    nodes.ownedAiDrawerContent.innerHTML = `
        ${actionBar}
        ${tabs}
        <p style="font-size:.75rem;color:var(--text-tertiary);margin-bottom:16px">Analyse du ${formatOwnedDiagnosticDate(entry.date)}</p>
        ${(entry.recommendations || []).map((r, i) => `
            <div style="border:1px solid var(--border-subtle);border-radius:8px;padding:14px;margin-bottom:10px">
                <div style="font-weight:700;font-size:.9rem;color:var(--text-primary);margin-bottom:6px">${i + 1}. ${escapeHtml(r.title)}</div>
                <p style="font-size:.83rem;color:var(--text-secondary);line-height:1.5;margin:0 0 8px">${escapeHtml(r.explanation)}</p>
                <div style="font-size:.78rem;color:var(--accent-text)">${icone('fleche-droite')} ${escapeHtml(r.action)}</div>
            </div>
        `).join('')}
    `;

    nodes.ownedAiDrawerContent.querySelectorAll('[data-diag-index]').forEach(btn => {
        btn.addEventListener('click', () => renderOwnedDiagnosticDrawer(history, Number(btn.dataset.diagIndex)));
    });
    wireActions();
}

async function callOwnedDiagnosticIA(assetId) {
    const asset = getOwnedAsset(assetId);
    if (!asset) return;
    const tmi = getOwnedTmi();

    const scenarios = (asset.scenarios || []).map(sc => {
        const r = computeOwnedAssetCF(asset, sc.variables, tmi, null, state.profileData);
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
        // Cloud Function (functions/index.js) : même appel depuis le logiciel PC, index.html en
        // ligne et owned.html — plus de dépendance au serveur Flask local.
        const data = await cloudDiagnosticPortefeuille(payload);
        const recs = data?.recommendations || [];
        if (!recs.length) {
            renderOwnedDiagnosticDrawer(asset.diagnosticHistory || [], 0, { errorMessage: "L'IA n'a renvoyé aucune recommandation — réessayez." });
            return;
        }
        const newEntry = { date: new Date().toISOString(), recommendations: recs };
        const history = [newEntry, ...(asset.diagnosticHistory || [])].slice(0, OWNED_DIAGNOSTIC_HISTORY_MAX);

        updateOwnedAsset(assetId, { diagnosticHistory: history });
        renderOwnedDiagnosticDrawer(history, 0);

    } catch (err) {
        // Retour à l'historique (rien n'est perdu) avec le message d'erreur au-dessus du bouton
        renderOwnedDiagnosticDrawer(asset.diagnosticHistory || [], 0, { errorMessage: err?.message || 'Erreur inconnue' });
    }
}
