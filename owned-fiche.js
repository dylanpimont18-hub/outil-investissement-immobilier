// Fiche détaillée d'un bien détenu (découpage d'owned-portfolio.js, audit T7) : ouverture/fermeture avec la transition
// liste ↔ détail, en-tête, verdict et assemblage des onglets (Acquisition, Exploitation, Travaux, Calcul).
// Déplacé tel quel : aucun changement de comportement.

import { computeOwnedAssetCF, computeOwnedAssetTimeline, parseDateAchat, libellePeriodeCF } from './calculs.js';
import { state, nodes, IS_MOBILE_PAGE } from './owned-contexte.js';
import { escapeHtml } from './utils.js';
import { savePref } from './cloud-store.js';
import { renderOwnedTravauxTab } from './owned-travaux.js';
import { renderOwnedPortfolioList, renderOwnedRegimeSelector } from './owned-liste.js';
import { renderAccordionAcquisition } from './owned-acquisition.js';
import { renderAccordionPostAchat, renderAccordionSimulateur } from './owned-exploitation.js';
import { libelleAnneeCF, ownedYearButtonHTML, parseOwnedYear, renderOwnedCalculTab, renderOwnedSynthese } from './owned-calcul.js';
import { addOwnedChargesAnnuelles, formatDateAchat, getOrderedAssetList, getOwnedAsset, getOwnedDefaultScenario, getOwnedRegime, getOwnedTmi, updateOwnedAsset } from './owned-donnees.js';

let _ownedTransitionTimer = null;

export function openOwnedDetail(assetId) {
    state._listScrollY = window.scrollY;
    state.activeOwnedAssetId = assetId;
    // Initialiser chargesAnnuelles si vide à partir des valeurs plates existantes
    const _a = getOwnedAsset(assetId);
    if (_a) {
        const post = _a.postAchat || {};
        if (!post.chargesAnnuelles || post.chargesAnnuelles.length === 0) {
            const annee = parseDateAchat(_a.dateAchat).annee;
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

export function closeOwnedDetail() {
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

export function renderOwnedDetail() {
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
            <div class="owned-detail-title__meta">${escapeHtml(asset.ville)}${asset.dateAchat ? ` · Acquis ${formatDateAchat(asset.dateAchat)}` : ''}</div>
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
    if (nodes.ownedReportBtn) {
        nodes.ownedReportBtn.hidden = !((asset.acquisition?.prix || 0) > 0);
    }
    if (nodes.ownedBankDossierBtn) {
        nodes.ownedBankDossierBtn.hidden = IS_MOBILE_PAGE;
    }

    renderOwnedRegimeSelector();
    // Version smartphone : saisie/édition d'un bien + onglet Calcul complet (indicateurs, détail CF,
    // comparatif régimes) — identique au PC depuis 2026-08-04. Pas de dashboard portefeuille, de
    // carte, de bloc Verdict ni de diagnostic IA sur mobile — cf. spec
    // docs/superpowers/specs/2026-08-04-onglet-calcul-portefeuille.md.
    renderOwnedSynthese(asset);
    renderOwnedCalculTab(asset);
    if (!IS_MOBILE_PAGE) {
        renderOwnedVerdictBlock(asset);
    }
    renderAccordionAcquisition(asset);
    renderAccordionPostAchat(asset);
    renderOwnedTravauxTab(asset);
    if (!IS_MOBILE_PAGE) {
        renderAccordionSimulateur(asset);
    }

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

export function renderOwnedVerdictBlock(asset) {
    if (IS_MOBILE_PAGE) return; // bloc desktop uniquement
    const el = nodes.ownedVerdict || document.getElementById('owned-verdict');
    if (!el) return;
    const acq = asset.acquisition || {};
    const hasData = (acq.prix || 0) > 0;
    if (!hasData) { el.innerHTML = ''; return; }

    const regime = getOwnedRegime();
    const { annee: anneeAchat } = parseDateAchat(asset.dateAchat);
    // Défaut 'actuel' = CF de référence (12 prochains mois, chantier CF unique), le même chiffre que
    // la liste et le dashboard ; avant, l'année civile en cours ÷ 12 (diluée l'année d'achat).
    const yr = (state.ownedYearFilters?.[asset.id]) ?? 'actuel';
    const YEAR_OPTIONS = ['actuel', 1, 3, 5, 10];

    let cfNetNet, basePeriode;
    if (yr === 'actuel') {
        const r = computeOwnedAssetCF(asset, getOwnedDefaultScenario(asset).variables, getOwnedTmi(), regime, state.profileData);
        cfNetNet = Math.round(r.cfNetNet);
        basePeriode = libellePeriodeCF(r.periode);
    } else {
        const { years: timeline } = computeOwnedAssetTimeline(asset, state.profileData, regime);
        const targetAbsYear = anneeAchat + yr - 1;
        const yearRow = timeline.find(y => y.year === targetAbsYear) || timeline[timeline.length - 1];
        cfNetNet = Math.round((yearRow ? yearRow.cfAnnuel : 0) / 12);
        basePeriode = libelleAnneeCF(asset, yr);
    }

    const effort = Math.max(0, -cfNetNet);

    const cfTone = cfNetNet > 0 ? 'positive' : cfNetNet >= -100 ? 'watch' : 'negative';
    const cfSign = cfNetNet > 0 ? '+' : '';
    const effortTone = effort === 0 ? 'positive' : effort < 200 ? 'watch' : 'negative';

    const yearSelectorHtml = `
        <div class="owned-year-selector" style="margin-bottom:8px">
            <span class="owned-year-selector__label">Vue</span>
            <div class="owned-year-selector__btns">
                ${YEAR_OPTIONS.map(y => ownedYearButtonHTML(y, yr, anneeAchat, 'data-verdict-year')).join('')}
            </div>
        </div>`;

    el.innerHTML = yearSelectorHtml + `
        <div class="owned-verdict__grid">
            <div class="owned-verdict__metric">
                <span class="owned-verdict__label">CF net-net / mois · ${escapeHtml(basePeriode)}</span>
                <span class="owned-verdict__value owned-verdict__value--${cfTone}">${cfSign}${cfNetNet.toLocaleString('fr-FR')} €</span>
            </div>
            <div class="owned-verdict__metric">
                <span class="owned-verdict__label">Effort d'épargne / mois</span>
                <span class="owned-verdict__value owned-verdict__value--${effortTone}">${effort.toLocaleString('fr-FR')} €/mois</span>
            </div>
        </div>
    `;

    el.querySelectorAll('[data-verdict-year]').forEach(btn => {
        btn.addEventListener('click', () => {
            state.ownedYearFilters = { ...(state.ownedYearFilters || {}), [asset.id]: parseOwnedYear(btn.dataset.verdictYear) };
            savePref({ ownedYearFilters: state.ownedYearFilters }).catch(() => {});
            renderOwnedVerdictBlock(asset);
            const freshPost = getOwnedAsset(asset.id);
            if (freshPost) renderOwnedCalculTab(freshPost);
        });
    });
}
