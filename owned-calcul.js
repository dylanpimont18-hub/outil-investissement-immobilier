// Onglet Calcul d'un bien détenu (découpage d'owned-portfolio.js, audit T7) : indicateurs clés, décomposition du cash-flow
// (12 prochains mois, An 1/3/5/10), comparaison des régimes, tableau des flux annuels. Déplacé tel quel : aucun changement
// de comportement. Les calculs sont dans calculs.js.

import { computeOwnedAssetCF, computeOwnedAssetTimeline, computePatrimoineNet, getOptimalRegime, computeRevenusLocatifsBruts, computeCFBreakdown, computeRegimeComparison, parseDateAchat, computeCFBreakdownReference, libellePeriodeCF, periodeCFReference } from './calculs.js';
import { icone } from './icones.js';
import { state, nodes, IS_MOBILE_PAGE } from './owned-contexte.js';
import { escapeHtml, formatRatio } from './utils.js';
import { savePref } from './cloud-store.js';
import { getOwnedAsset, getOwnedDefaultScenario, getOwnedRegime, getOwnedTmi, loadOwnedAssets } from './owned-donnees.js';
import { renderOwnedVerdictBlock } from './owned-fiche.js';

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

// Sélecteur « 12 mois / An 1 / An 3 / An 5 / An 10 » (chantier CF unique) : 'actuel' = CF de référence.
export function parseOwnedYear(v) {
    return v === 'actuel' ? 'actuel' : Number(v);
}
export function ownedYearButtonHTML(y, yr, anneeAchat, attr) {
    const active = y === yr ? ' owned-year-btn--active' : '';
    if (y === 'actuel') {
        return `<button class="owned-year-btn${active}" ${attr}="actuel" title="CF de référence : moyenne des 12 prochains mois, hors frais ponctuels">12 mois</button>`;
    }
    return `<button class="owned-year-btn${active}" ${attr}="${y}">An ${y} <span style="font-size:11px;opacity:.6">${anneeAchat + y - 1}</span></button>`;
}
// Libellé d'une année civile de détention : « An 1 · 2026, 5 mois détenus » / « An 3 · 2028 ».
export function libelleAnneeCF(asset, yr) {
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
