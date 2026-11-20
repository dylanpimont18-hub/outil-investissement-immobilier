// Outils d'interface partagés du portefeuille biens détenus (découpage d'owned-portfolio.js, audit T7) : modale générique
// (`_showOwnedModal`, fermeture par Échap), téléchargement/partage d'un fichier (feuille de partage sur écran tactile) et
// copie dans le presse-papiers. Module sans dépendance vers le reste du portefeuille. Déplacé tel quel.

import { nodes } from './owned-contexte.js';
import { showToast } from './utils.js';
import { closeOwnedAddModal, closeOwnedDeleteModal } from './owned-actions.js';

// Échap commun à toutes les modales du portefeuille (B4) : modales génériques (.owned-modal-overlay),
// Import et Suppression (.owned-delete-modal), « Ajouter un bien » mobile (.owned-add-modal) et
// aperçu du Rapport. Posé dès initOwnedPortfolioEvents (avant, il ne l'était qu'à la première modale
// générique, d'où l'Échap muet sur Import). Chaque modale passe par sa fonction de fermeture pour
// remettre son état à zéro (formulaire, bien en attente de suppression).
let _ownedModalEscWired = false;
export function _wireOwnedModalEscape() {
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
