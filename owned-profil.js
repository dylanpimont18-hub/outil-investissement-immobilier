// Onglets Impôt et Profil du portefeuille biens détenus (découpage d'owned-portfolio.js, audit T7) : estimation de l'impôt
// du foyer, revenus historisés, composition du foyer, crédits hors immobilier et section Compte (changement du mot de
// passe). Déplacé tel quel : aucun changement de comportement. Les calculs sont dans calculs.js.

import { parseDateAchat, computeRevenuFoncierPortefeuille, computeImpotFoyer, resolveRevenuFoyer } from './calculs.js';
import { icone } from './icones.js';
import { state } from './owned-contexte.js';
import { escapeHtml, showToast } from './utils.js';
import { cloudChangePassword } from './owned-cloud.js';
import { renderCollections } from './owned-portfolio.js';
import { _authUser, getOwnedRegime, loadOwnedAssets, syncProfileToCloud } from './owned-donnees.js';

// ─── ONGLET IMPÔT (vue liste) ────────────────────────────────────────────────
// Reprend le revenu salarial du profil (déjà net imposable, après abattement 10 % — saisi tel quel
// par l'utilisateur) + le revenu foncier imposable du portefeuille, et calcule l'IR au barème
// progressif tranche par tranche (computeImpotFoyer, calculs.js) — pas juste la TMI en taux plat.
export function renderOwnedImpotTab() {
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
                ${icone('alerte')} Estimation indicative basée sur vos données saisies — barème IR ${annee} appliqué tranche par tranche, décote incluse.
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
                        ${icone('alerte')} Plafonnement du quotient familial appliqué : l'avantage lié à vos parts enfants (${fmt(impot.plafonnementQF.avantage)}) dépasse le plafond légal (${fmt(impot.plafonnementQF.plafond)}) — IR brut recalculé sans ce plafonnement aurait été ${fmt(impot.plafonnementQF.irBrutSansPlafonnement)}.
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
// main.js:saveProfileData() : portfolioMeta.profile, source unique. Les champs simples partagent
// le même state.profileData que la modale.
function saveOwnedProfileData() {
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

export function addOwnedAutreCredit(entry) {
    const credits = [...(state.profileData.autresCredits || [])];
    credits.push({ id: `credit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, libelle: entry.libelle, mensualite: Math.max(0, Number(entry.mensualite) || 0) });
    state.profileData = { ...state.profileData, autresCredits: credits };
    saveOwnedProfileData();
}

// Patch générique de champs simples de profileData (income, objectifCF...) — pour l'Assistant IA
// (assistant-chat.js), qui ne connaît que ces deux champs pour l'instant. Ne remplace pas la modale
// Profil complète (revenuHistorique/adults/children/autresCredits ont leurs propres CRUD dédiés
// ci-dessus) : seulement les champs scalaires qu'un message en langage naturel peut porter sans
// ambiguïté. Number(...) || 0 rejette silencieusement une valeur non numérique plutôt que de stocker
// NaN — l'appelant est responsable d'avoir déjà validé la valeur avant d'arriver ici.
export function patchProfileData(patch) {
    const next = { ...state.profileData };
    if (patch.income !== undefined) next.income = Math.max(0, Number(patch.income) || 0);
    if (patch.objectifCF !== undefined) next.objectifCF = Math.max(0, Number(patch.objectifCF) || 0);
    state.profileData = next;
    saveOwnedProfileData();
}

function deleteOwnedAutreCredit(id) {
    state.profileData = {
        ...state.profileData,
        autresCredits: (state.profileData.autresCredits || []).filter(c => c.id !== id)
    };
    saveOwnedProfileData();
}

export function renderOwnedProfilTab() {
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
                    <button class="owned-travaux-delete" data-delete-revenu-hist="${e.annee}" title="Supprimer" aria-label="Supprimer le revenu ${e.annee}">${icone('croix')}</button>
                </div>
            `).join('')}
        </div>` : `<p style="font-size:.82rem;color:var(--text-tertiary);font-style:italic">Aucune évolution enregistrée — le revenu ci-dessus s'applique à toutes les années.</p>`}
        <form class="owned-loyers-form" data-form="add-revenu-hist" novalidate>
            <label class="field-inline"><span class="field-inline__label">Revenu (€/an)</span><input type="number" name="revenu" class="variables-input" placeholder="Revenu €/an" min="0" step="500" required style="flex:1;min-width:120px"></label>
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
                    <button class="owned-travaux-delete" data-delete-autre-credit="${escapeHtml(c.id)}" title="Supprimer" aria-label="Supprimer ${escapeHtml(c.libelle || 'ce crédit')}">${icone('croix')}</button>
                </div>
            `).join('')}
        </div>` : `<p style="font-size:.82rem;color:var(--text-tertiary);font-style:italic">Aucun crédit hors immobilier enregistré.</p>`}
        <form class="owned-loyers-form" data-form="add-autre-credit" novalidate>
            <label class="field-inline"><span class="field-inline__label">Libellé du crédit</span><input type="text" name="libelle" class="variables-input" placeholder="ex : Crédit auto" required style="flex:1;min-width:120px"></label>
            <label class="field-inline"><span class="field-inline__label">Mensualité (€/mois)</span><input type="number" name="mensualite" class="variables-input" placeholder="Mensualité €/mois" min="0" step="10" required style="min-width:140px"></label>
            <button type="submit" class="btn btn--primary btn--sm">+ Ajouter</button>
        </form>

        ${_renderAccountSection()}
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

    _wireAccountSection(el);
}

// ─── COMPTE : changement de mot de passe (onglet Profil, PC + web + iPhone) ──
// Sans ressaisie de l'ancien mot de passe (choix utilisateur 2026-10-04) — voir
// cloudChangePassword (owned-cloud.js) et la Cloud Function changerMotDePasse.
const PASSWORD_MIN_LENGTH = 8; // doit rester aligné sur functions/index.js

function _renderAccountSection() {
    if (!_authUser) return '';
    return `
        <div class="owned-section-title" style="margin-top:20px">Compte</div>
        <p class="owned-caveat">Connecté en tant que <strong>${escapeHtml(_authUser.email || '')}</strong>. Le nouveau mot de passe s'applique au PC, à la version web et à l'iPhone ; les autres appareils devront se reconnecter avec lui.</p>
        <form class="owned-form-grid owned-password-form" data-form="change-password" novalidate style="margin-top:12px">
            <input type="email" name="username" value="${escapeHtml(_authUser.email || '')}" autocomplete="username" hidden>
            <label class="variables-field">
                <span class="variables-label">Nouveau mot de passe</span>
                <input name="password" class="variables-input" type="password" minlength="${PASSWORD_MIN_LENGTH}" maxlength="128" required autocomplete="new-password">
            </label>
            <label class="variables-field">
                <span class="variables-label">Confirmer le mot de passe</span>
                <input name="confirm" class="variables-input" type="password" minlength="${PASSWORD_MIN_LENGTH}" maxlength="128" required autocomplete="new-password">
            </label>
            <button type="submit" class="btn btn--primary btn--sm" style="align-self:end">Changer le mot de passe</button>
            <div class="owned-auth-gate__error owned-password-form__error" data-password-error role="alert" hidden></div>
        </form>`;
}

function _passwordErrorMessage(err) {
    const code = String(err?.code || '');
    const message = String(err?.message || '').trim();
    // Messages français construits par la Cloud Function (validation, quota, erreur Firebase
    // détaillée avec son code) : affichés tels quels. "INTERNAL" seul = plantage non prévu.
    if (['functions/invalid-argument', 'functions/resource-exhausted', 'functions/internal'].includes(code)
        && message && message !== 'INTERNAL') return message;
    if (code === 'functions/not-found') return "La fonction de changement de mot de passe n'est pas déployée sur le serveur. Mot de passe inchangé.";
    if (code === 'functions/unauthenticated' || message === 'not_authenticated') return 'Session expirée : reconnectez-vous puis réessayez. Mot de passe inchangé.';
    if (code === 'functions/unavailable' || code === 'functions/deadline-exceeded' || code.includes('network')) {
        return 'Le serveur ne répond pas (connexion internet absente ou trop lente). Mot de passe inchangé, réessayez.';
    }
    if (code === 'functions/permission-denied') return 'Requête refusée par le serveur. Mot de passe inchangé.';
    return `Erreur inattendue${code ? ` (code : ${code})` : ''}${message && message !== 'INTERNAL' ? ` : ${message}` : ''}. Mot de passe inchangé, réessayez.`;
}

function _wireAccountSection(root) {
    const form = root.querySelector('[data-form="change-password"]');
    if (!form) return;
    form.addEventListener('submit', async e => {
        e.preventDefault();
        const fd = new FormData(form);
        const password = String(fd.get('password') || '');
        const confirm = String(fd.get('confirm') || '');
        const errEl = form.querySelector('[data-password-error]');
        const btn = form.querySelector('button[type="submit"]');
        const showError = msg => { errEl.textContent = msg; errEl.hidden = false; };
        errEl.hidden = true;

        if (password.length < PASSWORD_MIN_LENGTH) return showError(`Le mot de passe doit contenir au moins ${PASSWORD_MIN_LENGTH} caractères.`);
        if (password.length > 128) return showError('Le mot de passe ne peut pas dépasser 128 caractères.');
        if (password !== confirm) return showError('Les deux mots de passe ne correspondent pas.');

        btn.disabled = true;
        btn.textContent = 'Changement…';
        try {
            const { relogged } = await cloudChangePassword(password);
            form.reset();
            showToast(relogged
                ? 'Mot de passe changé'
                : "Mot de passe changé, mais la reconnexion automatique a échoué : reconnectez-vous avec le nouveau mot de passe si l'app vous déconnecte", 'success');
        } catch (err) {
            showError(_passwordErrorMessage(err));
        } finally {
            btn.disabled = false;
            btn.textContent = 'Changer le mot de passe';
        }
    });
}
