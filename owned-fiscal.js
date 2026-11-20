// Modales fiscales et projections du portefeuille biens détenus (découpage d'owned-portfolio.js, audit T7) : compte de
// résultat, simulation de travaux, projection des impôts (3 onglets, graphiques Chart.js), capacité d'emprunt, objectifs
// et déclaration fiscale (2044). Déplacé tel quel : aucun changement de comportement. Les calculs sont dans calculs.js.

import { computeEndettementGlobal, computeCapaciteEmprunt, computeCompteResultat, computeSimulationTravaux, computeDeclaration2044, parseDateAchat, resolveRevenuFoyer, computeProjectionImpotsFoyer, computeOptimisationTravaux, computeProjectionRegimesFoyer } from './calculs.js';
import { icone } from './icones.js';
import { state } from './owned-contexte.js';
import { escapeHtml, showToast, formatPercent } from './utils.js';
import { _showOwnedModal, getOwnedAsset, getOwnedRegime, loadOwnedAssets, loadPortfolioGoals, renderOwnedPortfolioList, savePortfolioGoals } from './owned-portfolio.js';

// ─── COMPTE DE RÉSULTAT ──────────────────────────────────────────────────────

export function openCompteResultatModal(assetId) {
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
                ${cr.fraisEmprunt > 0 ? `<div class="cr-row cr-row--sub"><span>&nbsp;&nbsp;Frais d'emprunt (garantie, courtage, dossier)</span><span>${cr.fraisEmprunt.toLocaleString('fr-FR')} €</span></div>` : ''}
                ${cr.taxeFonciere > 0 ? `<div class="cr-row cr-row--sub"><span>&nbsp;&nbsp;Taxe foncière</span><span>${cr.taxeFonciere.toLocaleString('fr-FR')} €</span></div>` : ''}
                ${cr.taxeFonciereFrais > 0 ? `<div class="cr-row cr-row--sub"><span>&nbsp;&nbsp;Taxe foncière (frais saisis)</span><span>${cr.taxeFonciereFrais.toLocaleString('fr-FR')} €</span></div>` : ''}
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
                    <button class="btn btn--ghost" data-close-modal aria-label="Fermer">${icone('croix')}</button>
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

export function openSimulationTravauxModal(assetId) {
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
                <button class="btn btn--ghost" data-close-modal aria-label="Fermer">${icone('croix')}</button>
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

// ─── PROJECTION DES IMPÔTS (effet des travaux déductibles) ───────────────────
// « Combien d'impôts les années suivantes, et que faire ? » — modale à trois onglets, tous
// calculés au niveau du FOYER (calculs.js) à partir du même formulaire de simulation (bien,
// montant, année, répartition sur 1 à 3 ans) :
//   - Projection : computeProjectionImpotsFoyer (régime réel simulé) — phrase de synthèse, KPI,
//     graphique de l'impôt par année, réserve de déficit, détail d'une année, tableau replié ;
//   - Quand faire les travaux ? : computeOptimisationTravaux — options année × étalement ;
//   - Quel régime ? : computeProjectionRegimesFoyer — micro / réel / SCI-IS dans le temps.
// Ouverte depuis le dashboard (aucun bien présélectionné) ou depuis l'onglet Travaux d'un bien (ce
// bien présélectionné). Desktop uniquement (bouton non rendu si IS_MOBILE_PAGE). Voir
// docs/superpowers/specs/2026-10-05-projection-impots-analyse-visuel.md.
let _projectionCharts = [];

function _destroyProjectionCharts() {
    _projectionCharts.forEach(c => c.destroy());
    _projectionCharts = [];
}

// Palette validée (scripts/validate_palette.js du skill dataviz, toutes paires, clair et sombre) :
// or = régime réel / impôt du foyer, bleu = référence comparée, sarcelle = troisième série. Le
// rouge (--danger) est réservé au statut « report expiré ».
function _projectionPalette() {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    const css = getComputedStyle(document.documentElement);
    const tok = (name, fallback) => (css.getPropertyValue(name) || '').trim() || fallback;
    return {
        dark,
        gold: dark ? '#B3902E' : '#B08A3E', // couleur de série (palette catégorielle validée), pas l'accent de l'interface — voir charte_graphique.txt §3
        blue: dark ? '#5A85E6' : '#3F6FD1',
        teal: dark ? '#17A28C' : '#0E9E8A',
        neutral: dark ? 'rgba(255,255,255,0.38)' : 'rgba(15,23,42,0.38)',
        danger: tok('--danger', '#EF4444'),
        surface: tok('--surface', dark ? '#201E23' : '#FFFFFF'),
        text: tok('--text-secondary', dark ? '#A09890' : '#475569'),
        grid: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
    };
}

function _projectionChartOptions(pal, { stacked = false, onClick = null } = {}) {
    const fmtAxis = v => (Math.abs(v) >= 1000 ? (v / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' k' : v) + ' €';
    const tickFont = { family: "'IBM Plex Mono', monospace", size: 10 };
    return {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        onClick,
        onHover: onClick ? (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; } : undefined,
        plugins: {
            legend: { position: 'top', align: 'start', labels: { color: pal.text, usePointStyle: true, pointStyle: 'rectRounded', boxWidth: 10, boxHeight: 10, padding: 14, font: { family: "'Inter', system-ui, sans-serif", size: 11 } } },
            tooltip: { callbacks: { label: ctx => `${ctx.dataset.label} : ${Math.round(ctx.parsed.y).toLocaleString('fr-FR')} €` } },
        },
        scales: {
            x: { stacked, ticks: { color: pal.text, font: tickFont }, grid: { display: false }, border: { color: pal.grid } },
            y: { stacked, beginAtZero: true, ticks: { color: pal.text, font: tickFont, callback: fmtAxis, maxTicksLimit: 6 }, grid: { color: pal.grid }, border: { display: false } },
        },
    };
}

export function openProjectionImpotsModal(assetId = null) {
    const assets = Object.values(loadOwnedAssets()).filter(a => (a.acquisition?.prix || 0) > 0);
    const regime = getOwnedRegime();
    const currentYear = new Date().getFullYear();
    const fmt = v => `${Math.round(v).toLocaleString('fr-FR')} €`;
    const fmtS = v => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Math.round(v)).toLocaleString('fr-FR')} €`;
    const REGIME_LABEL = { 'micro-foncier': 'micro-foncier', 'reel': 'foncier réel', 'sci-is': 'SCI à l\'IS' };
    const REGIME_TITRE = { 'micro-foncier': 'Micro-foncier', 'reel': 'Foncier réel', 'sci-is': 'SCI à l\'IS' };
    const cibleInitiale = assetId && assets.some(a => a.id === assetId) ? assetId : (assets[0]?.id ?? '');

    // État de la modale, conservé d'un recalcul à l'autre (chaque frappe du formulaire).
    let activeTab = 'projection';
    let anneeDetail = currentYear;
    let lastProj = null;

    const lireFormulaire = () => {
        const m = Math.max(0, Number(modal.querySelector('#proj-montant')?.value) || 0);
        const aBrut = Math.round(Number(modal.querySelector('#proj-annee')?.value)) || currentYear;
        const a = Math.min(currentYear + 10, Math.max(currentYear, aBrut));
        const n = Math.min(3, Math.max(1, Number(modal.querySelector('#proj-repartition')?.value) || 1));
        const c = modal.querySelector('#proj-bien')?.value || '';
        return { montant: m, annee: a, repartition: n, cibleId: c };
    };
    const travauxSimules = f => f.montant > 0
        ? Array.from({ length: f.repartition }, (_, k) => ({ assetId: f.cibleId || null, montant: f.montant / f.repartition, annee: f.annee + k }))
        : null;

    // ── Onglet Projection ────────────────────────────────────────────────────
    function renderDetailAnnee(proj) {
        const r = proj.years.find(y => y.annee === anneeDetail) || proj.years[0];
        const effetIR = r.irNet - r.impotSalairesSeuls;
        const ligne = (label, valeur, cls = '') => `<div class="projection-ledger__row ${cls}"><span>${label}</span><span>${valeur}</span></div>`;
        const foncier = [
            ligne('Loyers encaissés', fmt(r.loyers)),
            ligne('Charges (taxe foncière, copro, PNO, gestion, forfait 20 € par local)', `−${fmt(r.chargesHorsTravaux)}`),
            ligne('Intérêts, assurance et frais d\'emprunt', r.interets ? `−${fmt(r.interets)}` : '—'),
            ligne(`Travaux déductibles${r.travauxSimules ? ` <small>dont ${fmt(r.travauxSimules)} simulés</small>` : ''}`, r.travaux ? `−${fmt(r.travaux)}` : '—'),
            ligne('Résultat foncier', fmtS(r.resultatFoncier), 'projection-ledger__row--total'),
        ];
        if (r.resultatFoncier >= 0) {
            foncier.push(ligne('Report des années précédentes utilisé', r.reportUtilise ? `−${fmt(r.reportUtilise)}` : '—'));
            foncier.push(ligne('Revenu foncier imposable', fmt(r.revenuFoncierImposable), 'projection-ledger__row--total'));
        } else {
            foncier.push(ligne(`Déduit des salaires <small>plafond ${fmt(proj.plafondRevenuGlobal)}, intérêts imputés d'abord sur les loyers</small>`, r.imputeRevenuGlobal ? fmt(r.imputeRevenuGlobal) : '—'));
            foncier.push(ligne('Reporté sur les loyers des 10 années suivantes', r.deficitReporte ? fmt(r.deficitReporte) : '—'));
        }
        if (r.deficitPerdu) foncier.push(ligne('Report ancien expiré cette année', fmt(r.deficitPerdu), 'negative'));

        const impot = [
            ligne(`Impôt sur les salaires seuls <small>revenu salarial ${fmt(r.revenuSalarial)}</small>`, fmt(r.impotSalairesSeuls)),
            ligne('Effet de l\'immobilier sur l\'impôt sur le revenu', fmtS(effetIR), effetIR < 0 ? 'positive' : ''),
            ligne('Prélèvements sociaux 17,2 % sur le revenu foncier', r.psFoncier ? fmt(r.psFoncier) : '—'),
            ligne('Impôt du foyer', fmt(r.impotTotal), 'projection-ledger__row--total'),
        ];
        if (r.economie) impot.push(ligne('Sans les travaux à venir, il serait de', `${fmt(r.impotSansTravaux)} <small>(économie ${fmt(r.economie)})</small>`));

        return `
            <div class="projection-detail__head">
                <div class="owned-section-title" style="margin:0">D'où vient l'impôt de</div>
                <select class="variables-input projection-detail__annee" id="proj-annee-detail" aria-label="Année détaillée">
                    ${proj.years.map(y => `<option value="${y.annee}" ${y.annee === r.annee ? 'selected' : ''}>${y.annee}</option>`).join('')}
                </select>
                <span class="owned-caveat" style="margin:0">ou cliquez une barre du graphique</span>
            </div>
            <div class="projection-detail__cols">
                <div class="projection-ledger"><div class="projection-ledger__title">Revenu foncier ${r.annee}</div>${foncier.join('')}</div>
                <div class="projection-ledger"><div class="projection-ledger__title">Impôt du foyer ${r.annee}</div>${impot.join('')}</div>
            </div>`;
    }

    function renderProjection(proj, f) {
        const t = proj.totaux;
        const s = proj.synthese;
        const nomCible = assets.find(a => a.id === f.cibleId)?.nom || '';
        const toneEco = t.economie > 0 ? 'positive' : t.economie < 0 ? 'negative' : '';
        const effetMoyen = Math.round(proj.years.reduce((acc, r) => acc + r.effetFoncier, 0) / proj.years.length);

        const phrase = [
            `De ${proj.anneeDebut} à ${proj.anneeFin}, votre foyer paierait en moyenne <strong>${fmt(s.impotMoyen)}</strong> d'impôt par an.`,
            effetMoyen > 0
                ? `L'immobilier y ajoute en moyenne <strong>${fmt(effetMoyen)}</strong> par an par rapport à vos seuls salaires.`
                : effetMoyen < 0
                    ? `L'immobilier le réduit en moyenne de <strong>${fmt(-effetMoyen)}</strong> par an par rapport à vos seuls salaires.`
                    : '',
            s.anneeFinReport ? `Votre réserve de déficit reportable s'épuise en <strong>${s.anneeFinReport}</strong> : à partir de là, les loyers sont de nouveau pleinement imposés.` : '',
            s.impotMax > s.impotMoyen ? `Année la plus chère : <strong>${s.anneeMax}</strong> (${fmt(s.impotMax)}).` : '',
        ].filter(Boolean).join(' ');

        const rows = proj.years.map(r => `
            <tr>
                <td>${r.annee}</td>
                <td>${fmt(r.loyers)}</td>
                <td>${fmt(r.chargesHorsTravaux + r.interets)}</td>
                <td>${r.travaux ? fmt(r.travaux) + (r.travauxSimules ? ' <small>dont ' + fmt(r.travauxSimules) + ' simulés</small>' : '') : '—'}</td>
                <td class="${r.resultatFoncier < 0 ? 'negative' : ''}">${fmtS(r.resultatFoncier)}</td>
                <td>${r.imputeRevenuGlobal ? `−${fmt(r.imputeRevenuGlobal)}` : '—'}</td>
                <td>${r.reportUtilise ? `−${fmt(r.reportUtilise)}` : '—'}</td>
                <td>${r.stockFin ? fmt(r.stockFin) : '—'}${r.deficitPerdu ? ` <small class="negative">${fmt(r.deficitPerdu)} expirés</small>` : ''}</td>
                <td><strong>${fmt(r.impotTotal)}</strong></td>
                <td>${fmt(r.impotSansTravaux)}</td>
                <td class="${r.economie > 0 ? 'positive' : r.economie < 0 ? 'negative' : ''}">${r.economie ? fmtS(r.economie) : '—'}</td>
            </tr>`).join('');

        const aDuReport = proj.stockInitial > 0 || proj.years.some(r => r.stockFin || r.reportUtilise || r.deficitPerdu);

        return `
            <p class="projection-impots__synthese">${phrase}</p>
            <div class="projection-impots__kpis">
                <div class="projection-impots__kpi">
                    <div class="projection-impots__kpi-label">Économie d'impôt sur ${proj.horizon} ans</div>
                    <div class="projection-impots__kpi-value ${toneEco}">${fmtS(t.economie)}</div>
                    <div class="owned-caveat" style="margin:4px 0 0">due aux travaux à venir</div>
                </div>
                <div class="projection-impots__kpi">
                    <div class="projection-impots__kpi-label">Travaux déductibles à venir</div>
                    <div class="projection-impots__kpi-value">${fmt(t.travaux)}</div>
                    ${t.travauxSimules ? `<div class="owned-caveat" style="margin:4px 0 0">dont ${fmt(t.travauxSimules)} simulés${nomCible ? ` (${escapeHtml(nomCible)})` : ''}</div>` : ''}
                </div>
                <div class="projection-impots__kpi">
                    <div class="projection-impots__kpi-label">Déduits des salaires</div>
                    <div class="projection-impots__kpi-value">${fmt(t.imputeRevenuGlobal)}</div>
                    <div class="owned-caveat" style="margin:4px 0 0">plafond ${fmt(proj.plafondRevenuGlobal)}/an</div>
                </div>
                <div class="projection-impots__kpi">
                    <div class="projection-impots__kpi-label">Déduits des loyers (report)</div>
                    <div class="projection-impots__kpi-value">${fmt(t.reportUtilise)}</div>
                    <div class="owned-caveat" style="margin:4px 0 0">report au 1ᵉʳ janv. ${proj.anneeDebut} : ${fmt(proj.stockInitial)}</div>
                </div>
            </div>
            ${t.deficitPerdu > 0 ? `<div class="owned-alert owned-alert--warning">${fmt(t.deficitPerdu)} de déficit reportable expireront sans avoir servi (règle des ${proj.expirationAns} ans) : des loyers insuffisants pour les absorber à temps. Étaler les travaux peut l'éviter (onglet « Quand faire les travaux ? »).</div>` : ''}
            <div class="projection-impots__charts">
                <div class="owned-chart-block projection-impots__chart">
                    <div class="owned-chart-title">Impôt du foyer par année</div>
                    <div class="projection-impots__canvas"><canvas id="proj-chart-impot" role="img" aria-label="Impôt du foyer par année, comparé au scénario sans travaux à venir et à l'impôt sur les seuls salaires. Valeurs détaillées dans le tableau année par année."></canvas></div>
                    <div class="owned-caveat" style="margin:6px 0 0">Écart entre la barre et la ligne grise : ce que l'immobilier ajoute (ou retire) à l'impôt de vos seuls salaires.</div>
                </div>
                ${aDuReport ? `
                <div class="owned-chart-block projection-impots__chart">
                    <div class="owned-chart-title">Réserve de déficit reportable</div>
                    <div class="projection-impots__canvas"><canvas id="proj-chart-report" role="img" aria-label="Déficit foncier reportable : restant en fin d'année, utilisé et expiré chaque année. Valeurs détaillées dans le tableau année par année."></canvas></div>
                    <div class="owned-caveat" style="margin:6px 0 0">Déficit mis de côté pour être déduit des loyers des 10 années suivantes.</div>
                </div>` : ''}
            </div>
            <div class="cr-section projection-detail" id="proj-detail">${renderDetailAnnee(proj)}</div>
            <details class="projection-impots__table">
                <summary>Détail année par année (tableau)</summary>
                <div class="owned-cf-table-wrap">
                    <div class="owned-cf-table">
                        <div class="owned-cf-table__note">Impôt du foyer = IR au barème progressif (salaires + revenu foncier imposable) + prélèvements sociaux 17,2 % sur le revenu foncier. Colonne « Sans travaux » : même foyer, mêmes biens, aucun travaux déductible à partir de ${proj.anneeDebut}.</div>
                        <div class="owned-cf-table__scroll">
                            <table>
                                <thead><tr>
                                    <th>Année</th><th>Loyers</th><th>Charges + intérêts</th><th>Travaux déductibles</th><th>Résultat foncier</th>
                                    <th>Déduit des salaires</th><th>Déduit des loyers</th><th>Report restant</th>
                                    <th>Impôt du foyer</th><th>Sans travaux</th><th>Économie</th>
                                </tr></thead>
                                <tbody>${rows}</tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </details>
            <ul class="projection-impots__notes">
                <li>Déficit foncier (art. 156 I 3° CGI) : les intérêts d'emprunt (avec l'assurance et les frais d'emprunt) s'imputent d'abord sur les loyers ; le reste du déficit s'impute sur le revenu global jusqu'à ${fmt(proj.plafondRevenuGlobal)} par an, à condition de louer le bien jusqu'au 31 décembre de la 3ᵉ année suivante ; l'excédent et la part des intérêts non couverte par les loyers se reportent sur les revenus fonciers des ${proj.expirationAns} années suivantes.</li>
                <li>Hypothèses de projection : loyers et charges au dernier niveau connu, revenu salarial du profil (historisé, puis dernier connu), barème ${currentYear} reconduit, échéancier de crédit réel. Revente, plus-value et évolution des loyers ne sont pas modélisées.</li>
                <li>Calcul indicatif à partir de vos saisies — ne remplace pas un professionnel.</li>
            </ul>`;
    }

    function drawProjectionCharts(proj) {
        const pal = _projectionPalette();
        const labels = proj.years.map(r => String(r.annee));
        const cvImpot = modal.querySelector('#proj-chart-impot');
        if (cvImpot) {
            _projectionCharts.push(new Chart(cvImpot, {
                type: 'bar',
                data: {
                    labels,
                    datasets: [
                        { type: 'bar', label: 'Impôt du foyer', data: proj.years.map(r => r.impotTotal), backgroundColor: pal.gold, hoverBackgroundColor: pal.gold, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 32, order: 3 },
                        { type: 'line', label: 'Sans les travaux à venir', data: proj.years.map(r => r.impotSansTravaux), borderColor: pal.blue, backgroundColor: pal.blue, borderWidth: 2, pointRadius: 3, pointHoverRadius: 5, pointBorderColor: pal.surface, pointBorderWidth: 2, tension: 0, order: 1 },
                        { type: 'line', label: 'Salaires seuls', data: proj.years.map(r => r.impotSalairesSeuls), borderColor: pal.neutral, backgroundColor: pal.neutral, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0, order: 2 },
                    ],
                },
                options: _projectionChartOptions(pal, {
                    onClick: (e, els, chart) => {
                        const pts = chart.getElementsAtEventForMode(e, 'index', { intersect: false }, false);
                        if (!pts.length) return;
                        anneeDetail = proj.years[pts[0].index].annee;
                        refreshDetail();
                    },
                }),
            }));
        }
        const cvReport = modal.querySelector('#proj-chart-report');
        if (cvReport) {
            const segment = (label, key, color, top) => ({
                label, data: proj.years.map(r => r[key]), backgroundColor: color, hoverBackgroundColor: color,
                borderColor: pal.surface, borderWidth: top ? { top: 2 } : 0, borderSkipped: false, borderRadius: top ? { topLeft: 4, topRight: 4 } : 0, maxBarThickness: 32,
            });
            _projectionCharts.push(new Chart(cvReport, {
                type: 'bar',
                data: {
                    labels,
                    datasets: [
                        segment('Report restant en fin d\'année', 'stockFin', pal.gold, false),
                        segment('Utilisé dans l\'année', 'reportUtilise', pal.teal, true),
                        segment('Expiré dans l\'année', 'deficitPerdu', pal.danger, true),
                    ],
                },
                options: _projectionChartOptions(pal, { stacked: true }),
            }));
        }
    }

    function refreshDetail() {
        const el = modal.querySelector('#proj-detail');
        if (el && lastProj) el.innerHTML = renderDetailAnnee(lastProj);
    }

    // ── Onglet Quand faire les travaux ? ─────────────────────────────────────
    const libelleTexte = o => o.etalement === 1 ? `${o.annee}, en une fois` : `${o.annees[0]} → ${o.annees.at(-1)}`;
    function libelleOption(o) {
        if (o.etalement === 1) return `${o.annee}, en une fois`;
        return `${o.annees[0]} → ${o.annees.at(-1)} <small>${o.etalement} × ${fmt(o.montantParAn)}</small>`;
    }

    function renderOptimisation(f) {
        if (!f.montant) {
            return `<div class="projection-impots__vide">Saisissez ci-dessus le <strong>montant</strong> d'un chantier envisagé : cet onglet compare alors l'économie d'impôt selon l'année où vous le faites et selon que vous l'étalez sur 1, 2 ou 3 ans.</div>`;
        }
        const opt = computeOptimisationTravaux(assets, state.profileData, { montant: f.montant, assetId: f.cibleId || null, anneeDebut: currentYear, fenetre: 5, horizon: 10 });
        const best = opt.meilleure;
        const actuelle = opt.options.find(o => o.annee === f.annee && o.etalement === f.repartition);
        const maxEco = Math.max(1, ...opt.options.map(o => o.economie));
        const tri = [...opt.options].sort((a, b) => b.economie - a.economie || a.annee - b.annee || a.etalement - b.etalement);

        const nbEquiv = opt.options.filter(o => o.equivalente).length;
        const phrase = opt.economieMax <= 0
            ? `Avec vos revenus et vos loyers actuels, ces ${fmt(f.montant)} de travaux ne réduiraient pas votre impôt sur la période ${currentYear}–${opt.anneeFinCalcul}, quel que soit le calendrier.`
            : `Meilleur calendrier pour ${fmt(f.montant)} de travaux : <strong>${libelleTexte(best)}</strong>${best.etalement > 1 ? ` (${best.etalement} × ${fmt(best.montantParAn)})` : ''}, soit <strong>${fmt(best.economie)}</strong> d'impôt en moins sur ${currentYear}–${opt.anneeFinCalcul} (${best.parEuro.toLocaleString('fr-FR')} € par euro de travaux).`
              + (nbEquiv > 1 ? ` ${nbEquiv} calendriers se valent à ${fmt(opt.tolerance)} près : celui retenu est le plus tôt, puis le moins étalé.` : '')
              + (actuelle === best ? ' C\'est le calendrier actuellement saisi.'
                : actuelle?.equivalente ? ` Votre choix actuel (${libelleTexte(actuelle)}) est équivalent : ${fmt(actuelle.economie)}.`
                : actuelle ? ` Votre choix actuel (${libelleTexte(actuelle)}) rapporte ${fmt(actuelle.economie)}, soit ${fmt(best.economie - actuelle.economie)} de moins.` : '');

        const rows = tri.map(o => {
            const estBest = o === best && opt.economieMax > 0;
            const estEquiv = !estBest && o.equivalente && opt.economieMax > 0;
            const estActuelle = o === actuelle;
            const largeur = Math.max(0, Math.round((o.economie / maxEco) * 100));
            return `
            <tr class="${estBest ? 'projection-opt--best' : ''} ${estEquiv ? 'projection-opt--equiv' : ''} ${estActuelle ? 'projection-opt--actuelle' : ''}">
                <td>${libelleOption(o)}${estBest ? ' <span class="owned-badge owned-badge--optimal">Meilleure option</span>' : ''}${estEquiv ? ' <small>équivalente</small>' : ''}${estActuelle ? ' <span class="owned-badge">Choix actuel</span>' : ''}</td>
                <td class="projection-opt__eco">
                    <span class="projection-opt__bar" aria-hidden="true"><span style="width:${largeur}%"></span></span>
                    <span class="projection-opt__val">${fmt(o.economie)}</span>
                </td>
                <td>${o.parEuro.toLocaleString('fr-FR')} €</td>
                <td>${fmt(o.imputeRevenuGlobal)}</td>
                <td class="${o.deficitPerdu ? 'negative' : ''}">${o.deficitPerdu ? fmt(o.deficitPerdu) : '—'}</td>
                <td>${estActuelle ? '' : `<button type="button" class="btn btn--ghost btn--sm" data-proj-appliquer="${o.annee}:${o.etalement}">Appliquer</button>`}</td>
            </tr>`;
        }).join('');

        return `
            <p class="projection-impots__synthese">${phrase}</p>
            <div class="owned-cf-table">
                <div class="owned-cf-table__scroll">
                    <table class="projection-opt">
                        <thead><tr>
                            <th>Calendrier</th><th>Économie d'impôt ${currentYear}–${opt.anneeFinCalcul}</th><th>Par euro de travaux</th>
                            <th>Déduit des salaires</th><th>Report expiré</th><th></th>
                        </tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
            </div>
            <ul class="projection-impots__notes">
                <li>Pourquoi le calendrier compte : la part du déficit <strong>déduite des salaires</strong> (jusqu'à 10 700 €/an, hors intérêts) n'économise que l'impôt sur le revenu ; la part <strong>reportée sur les loyers</strong> économise aussi les prélèvements sociaux (17,2 %), mais expire si les loyers des 10 années suivantes ne suffisent pas à l'absorber. Avec des loyers confortables, un seul chantier est souvent meilleur ; avec des loyers faibles, étaler évite de perdre du report.</li>
                <li>Toutes les options sont comparées sur la même période (${currentYear}–${opt.anneeFinCalcul}), pour laisser à chacune au moins 10 ans de report. Les travaux déjà saisis sont pris en compte dans tous les cas. Montants non actualisés : un euro économisé dans 5 ans compte comme un euro aujourd'hui.</li>
                <li>Régime foncier réel simulé ; location à maintenir jusqu'au 31 décembre de la 3ᵉ année suivant chaque déduction des salaires.</li>
            </ul>`;
    }

    // ── Onglet Quel régime ? ─────────────────────────────────────────────────
    function renderRegimes(reg) {
        const ordre = ['micro-foncier', 'reel', 'sci-is'];
        const best = reg.meilleur;
        const totalSuivi = reg.totaux[regime];
        const ecartSuivi = totalSuivi != null && best ? totalSuivi - reg.totaux[best] : 0;
        const anneesInelig = reg.years.filter(y => !y.micro.eligible).map(y => y.annee);

        const phrase = !best ? '' : (best === regime
            ? `Sur ${reg.anneeDebut}–${reg.anneeFin}, votre régime actuel (<strong>${REGIME_LABEL[regime]}</strong>) est celui qui coûte le moins d'impôt au foyer : <strong>${fmt(reg.totaux[best])}</strong> au total.`
            : `Sur ${reg.anneeDebut}–${reg.anneeFin}, le régime le moins imposé serait <strong>${REGIME_LABEL[best]}</strong> : <strong>${fmt(reg.totaux[best])}</strong> d'impôt au total pour le foyer, soit <strong>${fmt(ecartSuivi)}</strong> de moins que votre régime actuel (${REGIME_LABEL[regime] || regime}).`)
            + (best === 'sci-is' ? ' Attention : ce chiffre ne compte ni les frais de structure de la SCI, ni le coût de transfert des biens, ni l\'impôt sur les dividendes si vous sortez l\'argent.' : '');

        const remarques = {
            'micro-foncier': reg.microEligible
                ? 'Abattement forfaitaire de 30 % ; aucune charge, aucun intérêt, aucun travaux déduits.'
                : `Non accessible en ${anneesInelig.length === reg.years.length ? 'toute année de la période' : anneesInelig.join(', ')} : loyers du foyer au-delà de ${fmt(reg.plafondMicro)}.`,
            'reel': 'Charges, intérêts et travaux déduits ; déficit foncier. Option irrévocable 3 ans.',
            'sci-is': 'Une SCI unique, aucun dividende. Amortissement du bâti (80 % du prix sur 30 ans). Hors frais de structure (~1 500–2 500 €/an), transfert des biens et fiscalité de sortie.',
        };
        const rows = ordre.map(r => {
            const ecart = reg.totaux[r] - totalSuivi;
            const exclu = r === 'micro-foncier' && !reg.microEligible;
            return `
            <tr class="${r === best ? 'projection-opt--best' : ''} ${exclu ? 'projection-regime--exclu' : ''}">
                <td><span class="projection-regime__puce projection-regime__puce--${r}" aria-hidden="true"></span>${REGIME_TITRE[r]}${r === regime ? ' <span class="owned-badge">Suivi actuellement</span>' : ''}${r === best ? ' <span class="owned-badge owned-badge--optimal">Le moins imposé</span>' : ''}</td>
                <td><strong>${fmt(reg.totaux[r])}</strong></td>
                <td class="${ecart < 0 ? 'positive' : ecart > 0 ? 'negative' : ''}">${r === regime ? '—' : fmtS(ecart)}</td>
                <td class="projection-regime__remarque">${remarques[r]}</td>
            </tr>`;
        }).join('');

        return `
            <p class="projection-impots__synthese">${phrase}</p>
            <div class="owned-chart-block projection-impots__chart">
                <div class="owned-chart-title">Impôt total du foyer selon le régime</div>
                <div class="projection-impots__canvas"><canvas id="proj-chart-regimes" role="img" aria-label="Impôt total du foyer par année pour le micro-foncier, le foncier réel et la SCI à l'IS. Totaux dans le tableau ci-dessous."></canvas></div>
                ${anneesInelig.length ? `<div class="owned-caveat" style="margin:6px 0 0">Trait pointillé : années où le micro-foncier n'est pas accessible (loyers > ${fmt(reg.plafondMicro)}).</div>` : ''}
            </div>
            <div class="owned-cf-table">
                <div class="owned-cf-table__scroll">
                    <table class="projection-opt">
                        <thead><tr><th>Régime</th><th>Impôt du foyer ${reg.anneeDebut}–${reg.anneeFin}</th><th>Écart vs régime actuel</th><th>À savoir</th></tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
            </div>
            <ul class="projection-impots__notes">
                <li>Chaque régime est supposé appliqué depuis l'achat de vos biens (déficits et amortissements reconstitués depuis le début) ; les travaux simulés ci-dessus sont pris en compte en réel et en SCI.</li>
                <li>On compare l'<strong>impôt</strong> payé (impôt sur le revenu, prélèvements sociaux, impôt sur les sociétés), pas le cash-flow ni la fiscalité à la revente. En SCI à l'IS, l'argent reste dans la société : le sortir en dividendes coûte en plus 30 % (flat tax).</li>
                <li>Calcul indicatif à partir de vos saisies — un changement de régime se décide avec un professionnel.</li>
            </ul>`;
    }

    function drawRegimesChart(reg) {
        const cv = modal.querySelector('#proj-chart-regimes');
        if (!cv) return;
        const pal = _projectionPalette();
        const inelig = reg.years.map(y => !y.micro.eligible);
        const line = (label, data, color, extra = {}) => ({
            label, data, borderColor: color, backgroundColor: color, borderWidth: 2, pointRadius: 3, pointHoverRadius: 5,
            pointBorderColor: pal.surface, pointBorderWidth: 2, tension: 0, ...extra,
        });
        _projectionCharts.push(new Chart(cv, {
            type: 'line',
            data: {
                labels: reg.years.map(y => String(y.annee)),
                datasets: [
                    line('Micro-foncier', reg.years.map(y => y.micro.impot), pal.blue, {
                        segment: { borderDash: ctx => (inelig[ctx.p0DataIndex] || inelig[ctx.p1DataIndex]) ? [5, 4] : undefined },
                    }),
                    line('Foncier réel', reg.years.map(y => y.reel.impot), pal.gold),
                    line('SCI à l\'IS', reg.years.map(y => y.sciIs.impot), pal.teal),
                ],
            },
            options: _projectionChartOptions(pal),
        }));
    }

    // ── Assemblage ───────────────────────────────────────────────────────────
    function renderBody() {
        _destroyProjectionCharts();
        const f = lireFormulaire();
        const sim = travauxSimules(f);
        const body = modal.querySelector('#proj-body');
        if (!body) return;

        let html = '';
        let after = () => {};
        if (activeTab === 'projection') {
            const proj = computeProjectionImpotsFoyer(assets, state.profileData, { anneeDebut: currentYear, horizon: 10, travauxSimules: sim });
            lastProj = proj;
            if (!proj.years.some(y => y.annee === anneeDetail)) anneeDetail = proj.anneeDebut;
            html = renderProjection(proj, f);
            after = () => drawProjectionCharts(proj);
        } else if (activeTab === 'optimisation') {
            html = renderOptimisation(f);
        } else {
            const reg = computeProjectionRegimesFoyer(assets, state.profileData, { anneeDebut: currentYear, horizon: 10, travauxSimules: sim });
            html = renderRegimes(reg);
            after = () => drawRegimesChart(reg);
        }

        const bandeau = regime !== 'reel' && activeTab !== 'regimes'
            ? `<div class="owned-alert owned-alert--info">Votre portefeuille est suivi en <strong>${REGIME_LABEL[regime] || regime}</strong> : cet onglet simule le <strong>régime foncier réel</strong>, seul régime où les travaux sont déductibles et où le déficit foncier existe. Comparez les régimes dans l'onglet « Quel régime ? ».</div>`
            : '';
        body.innerHTML = `<div class="projection-impots">${bandeau}${html}</div>`;
        after();
    }

    _destroyProjectionCharts();
    const TABS = [
        { key: 'projection', label: 'Projection' },
        { key: 'optimisation', label: 'Quand faire les travaux ?' },
        { key: 'regimes', label: 'Quel régime ?' },
    ];
    const modal = _showOwnedModal(`
        <div class="owned-modal owned-modal--projection">
            <div class="owned-modal-head">
                <div>
                    <h3 class="owned-modal-title">Impôts des prochaines années</h3>
                    <div class="owned-modal-sub">Impôt du foyer de ${currentYear} à ${currentYear + 10} — ${assets.length} bien${assets.length > 1 ? 's' : ''}</div>
                </div>
                <button class="btn btn--ghost" data-close-modal aria-label="Fermer">${icone('croix')}</button>
            </div>
            <div class="cr-section">
                <div class="owned-section-title" style="margin-top:0">Travaux supplémentaires à simuler (non saisis)</div>
                <div class="owned-form-grid projection-impots__form">
                    <label class="variables-field">
                        <span class="variables-label">Bien concerné</span>
                        <select class="variables-input" id="proj-bien" ${assets.length ? '' : 'disabled'}>
                            ${assets.map(a => `<option value="${escapeHtml(a.id)}" ${a.id === cibleInitiale ? 'selected' : ''}>${escapeHtml(a.nom || 'Bien')}</option>`).join('') || '<option value="">Aucun bien</option>'}
                        </select>
                    </label>
                    <label class="variables-field">
                        <span class="variables-label">Montant déductible (€)</span>
                        <input class="variables-input" type="number" id="proj-montant" min="0" step="500" value="0">
                    </label>
                    <label class="variables-field">
                        <span class="variables-label">Année de début</span>
                        <input class="variables-input" type="number" id="proj-annee" min="${currentYear}" max="${currentYear + 10}" step="1" value="${currentYear}">
                    </label>
                    <label class="variables-field">
                        <span class="variables-label">Répartition</span>
                        <select class="variables-input" id="proj-repartition">
                            <option value="1">En une fois</option>
                            <option value="2">Sur 2 ans</option>
                            <option value="3">Sur 3 ans</option>
                        </select>
                    </label>
                </div>
                <p class="owned-caveat" style="margin:6px 0 0">Les frais déjà saisis avec le tag « Déductible » (onglet Travaux de chaque bien) sont pris en compte automatiquement ; ce formulaire sert à tester un chantier supplémentaire.</p>
            </div>
            <div class="owned-tabs projection-impots__tabs" role="tablist">
                ${TABS.map(t => `<button type="button" class="owned-tab ${t.key === activeTab ? 'owned-tab--active' : ''}" role="tab" aria-selected="${t.key === activeTab}" data-proj-tab="${t.key}">${t.label}</button>`).join('')}
            </div>
            <div id="proj-body"></div>
        </div>
    `, 'owned-projection-impots-modal');

    renderBody();

    modal.querySelector('#proj-montant')?.addEventListener('input', renderBody);
    modal.querySelector('#proj-annee')?.addEventListener('input', renderBody);
    modal.querySelector('#proj-bien')?.addEventListener('change', renderBody);
    modal.querySelector('#proj-repartition')?.addEventListener('change', renderBody);
    modal.querySelectorAll('[data-proj-tab]').forEach(btn => btn.addEventListener('click', () => {
        activeTab = btn.dataset.projTab;
        modal.querySelectorAll('[data-proj-tab]').forEach(b => {
            b.classList.toggle('owned-tab--active', b === btn);
            b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
        });
        renderBody();
    }));
    // Délégation sur #proj-body (re-rendu à chaque frappe) : choix de l'année détaillée et
    // « Appliquer » une option de calendrier dans le formulaire partagé.
    const body = modal.querySelector('#proj-body');
    body?.addEventListener('change', e => {
        if (e.target.id === 'proj-annee-detail') {
            anneeDetail = Number(e.target.value);
            refreshDetail();
        }
    });
    body?.addEventListener('click', e => {
        const btn = e.target.closest('[data-proj-appliquer]');
        if (!btn) return;
        const [annee, etalement] = btn.dataset.projAppliquer.split(':');
        modal.querySelector('#proj-annee').value = annee;
        modal.querySelector('#proj-repartition').value = etalement;
        renderBody();
    });
}

// ─── CAPACITÉ D'EMPRUNT ───────────────────────────────────────────────────────

export function openCapaciteEmpruntModal() {
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
            <div class="cr-row cr-row--kpi"><span>Montant empruntable</span><span style="color:var(--accent-text)">${cap.montantEmpruntable.toLocaleString('fr-FR')} €</span></div>
            <div class="cr-row cr-row--kpi"><span>Prix d'achat max (frais notaire ~8%)</span><span style="color:var(--accent-text)">${cap.prixAchatMax.toLocaleString('fr-FR')} €</span></div>
        </div>`;
    }

    const endettTone = endettement.tauxEndettement > 35 ? 'var(--danger)' : endettement.tauxEndettement > 30 ? 'var(--warning)' : 'var(--success)';
    const modal = _showOwnedModal(`
        <div class="owned-modal">
            <div class="owned-modal-head">
                <h3 class="owned-modal-title">Capacité d'emprunt</h3>
                <button class="btn btn--ghost" data-close-modal aria-label="Fermer">${icone('croix')}</button>
            </div>
            <div class="cr-section">
                <div class="cr-row"><span>Mensualités totales actuelles</span><span>${Math.round(endettement.totalMensualites).toLocaleString('fr-FR')} €/mois</span></div>
                <div class="cr-row cr-row--kpi"><span>Taux d'endettement</span><span style="color:${endettTone}">${formatPercent(endettement.tauxEndettement)}</span></div>
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

export function openObjectifsModal() {
    const goals = loadPortfolioGoals();
    const modal = _showOwnedModal(`
        <div class="owned-modal">
            <div class="owned-modal-head">
                <h3 class="owned-modal-title">${icone('engrenage')} Objectifs portefeuille</h3>
                <button class="btn btn--ghost" data-close-modal aria-label="Fermer">${icone('croix')}</button>
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

// ─── DÉCLARATION FISCALE ──────────────────────────────────────────────────────
// Pré-remplissage indicatif de la 2044 (foncier réel) — cf. computeDeclaration2044 (calculs.js) pour le
// mapping de cases (sourcé sur la notice DGFiP 2044-NOT-SD). Pour la SCI-IS, la vraie déclaration est le
// formulaire 2065 (liasse comptable avec amortissement de l'immeuble, pas un simple 2072) — l'app ne
// calcule pas cet amortissement comptable, donc pas de récap chiffré généré pour ce régime : on
// affiche une explication + recommandation expert-comptable plutôt qu'un mapping non fiabilisé.
export function openDeclarationFiscaleModal() {
    const assets = Object.values(loadOwnedAssets()).filter(a => (a.acquisition?.prix || 0) > 0);
    const regime = getOwnedRegime();
    const currentYear = new Date().getFullYear();
    const anneeMin = assets.reduce((m, a) => Math.min(m, parseDateAchat(a.dateAchat).annee), currentYear);
    const annees = [];
    for (let y = Math.max(anneeMin, currentYear - 5); y <= currentYear; y++) annees.push(y);

    const DISCLAIMER = `Calcul indicatif basé sur vos données saisies — à vérifier avant télédéclaration. Ne remplace pas un professionnel (expert-comptable, centre des impôts). Source : notice DGFiP 2044-NOT-SD.`;

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
                    <button class="btn btn--ghost" data-close-modal aria-label="Fermer">${icone('croix')}</button>
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
