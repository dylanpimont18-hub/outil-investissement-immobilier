// Actions globales du portefeuille biens détenus (découpage d'owned-portfolio.js, audit T7) : rail « Actions rapides » (PC),
// boutons flottants « Ajouter des factures » (repliés au défilement sur iPhone), modales « Ajouter un bien » et de
// suppression. Déplacé tel quel : aucun changement de comportement.

import { state, nodes, IS_MOBILE_PAGE } from './owned-contexte.js';
import { openAjoutFacturesModal, openImportDossierModal } from './owned-factures.js';
import { renderOwnedTravauxTab } from './owned-travaux.js';
import { renderOwnedPortfolioList } from './owned-liste.js';
import { renderAccordionPostAchat, renderAccordionSimulateur } from './owned-exploitation.js';
import { renderOwnedCalculTab, renderOwnedSynthese } from './owned-calcul.js';
import { openOwnedDetail } from './owned-fiche.js';
import { _authUser, _cloudLoaded, createOwnedAsset, getOwnedAsset, updateOwnedAsset } from './owned-donnees.js';

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

export function initOwnedQuickRail() {
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
export function initOwnedQuickFab() {
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
export function _syncQuickFabVisibility() {
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
