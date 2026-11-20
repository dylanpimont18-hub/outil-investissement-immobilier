// Vue liste du portefeuille biens détenus (découpage d'owned-portfolio.js, audit T7) : dashboard dirigeant, carte Leaflet,
// graphiques de synthèse (Chart.js), sélecteur de régime, liste/tableau des biens (PC) et liste mobile (iPhone),
// import d'archives. Déplacé tel quel : aucun changement de comportement.

import { computeOwnedAssetCF, computeOwnedAssetTimeline, computePatrimoineNet, computeEndettementGlobal, computePortfolioAlerts, computeCFBreakdown, computeRegimeComparison, resolveLoyerVacance, parseDateAchat, resolveRevenuFoyer, resolveTmiFoyer, libellePeriodeCF, periodeCFReference } from './calculs.js';
import { icone } from './icones.js';
import { state, nodes, IS_MOBILE_PAGE } from './owned-contexte.js';
import { escapeHtml, formatSignedCurrency, formatRatio, formatPercent } from './utils.js';
import { cloudSaveMeta } from './owned-cloud.js';
import { savePref, cloudListArchives } from './cloud-store.js';
import { openRapportAnnuelModal } from './owned-rapports.js';
import { openCapaciteEmpruntModal, openDeclarationFiscaleModal, openObjectifsModal, openProjectionImpotsModal } from './owned-fiscal.js';
import { openImpressionFacturesModal } from './owned-factures.js';
import { renderOwnedImpotTab, renderOwnedProfilTab } from './owned-profil.js';
import { _authUser, formatDateAchat, getOrderedAssetList, getOwnedAsset, getOwnedDefaultScenario, getOwnedRegime, getOwnedTmi, loadOwnedAssets, loadPortfolioGoals, openOwnedAddModal, openOwnedDeleteModal, openOwnedDetail, parseOwnedYear, renderOwnedCalculTab, renderOwnedSynthese, saveOwnedAssets, setOwnedRegime } from './owned-portfolio.js';

// ─── DASHBOARD DIRIGEANT (vue liste) ─────────────────────────────────────────

function renderOwnedDashboard(list, profileData, regime) {
    if (IS_MOBILE_PAGE) return; // bloc desktop uniquement — voir renderOwnedVerdictBlock
    const wrap = document.getElementById('owned-dashboard-wrap');
    if (!wrap) return;

    if (!list.length) { wrap.innerHTML = ''; return; }

    // Taux courant (aujourd'hui) pour le CF total et les alertes CF/DSCR — computePortfolioAlerts
    // résout lui-même un TMI par année pour le déficit foncier historique (voir calculs.js).
    const tmi = resolveTmiFoyer(profileData, new Date().getFullYear());
    const revenusMens = resolveRevenuFoyer(profileData, new Date().getFullYear()) / 12;
    const endettement = computeEndettementGlobal(list, revenusMens, state.profileData?.autresCredits || []);
    const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 };
    const alerts = computePortfolioAlerts(list, profileData, regime, revenusMens)
        .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
    const goals = loadPortfolioGoals();

    // Snapshot : patrimoine net total, CF total, endettement, prochain crédit
    const totalPatNet = list.reduce((s, a) => {
        const pn = computePatrimoineNet(a);
        return s + (pn.patrimoineNet || 0);
    }, 0);
    const totalCF = list.reduce((s, a) => {
        const sc = getOwnedDefaultScenario(a);
        return s + computeOwnedAssetCF(a, { ...sc.variables, regime }, tmi, null, profileData).cfNetNet;
    }, 0);
    const cfTone = totalCF >= 0 ? 'positive' : 'negative';
    const endettTone = endettement.tauxEndettement > 35 ? 'negative' : endettement.tauxEndettement > 30 ? 'watch' : 'positive';
    const prochainCredit = endettement.prochainCreditTermine;

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
                <button class="btn btn--ghost btn--sm" data-action="open-capacite">Capacité d'emprunt</button>
                <button class="btn btn--ghost btn--sm" data-action="open-objectifs">Objectifs</button>
                <button class="btn btn--ghost btn--sm" data-action="open-rapport">Rapport annuel</button>
                <button class="btn btn--ghost btn--sm" data-action="open-declaration">Déclaration fiscale</button>
                <button class="btn btn--ghost btn--sm" data-action="open-factures">Factures</button>
                <button class="btn btn--ghost btn--sm" data-action="open-projection-impots">Impôts à venir</button>
            </div>
        </div>

        <!-- Ligne 1 : Snapshot -->
        <div class="owned-dashboard-kpis">
            <div class="owned-dashboard-kpi">
                <span class="owned-dashboard-kpi__label">Patrimoine net total</span>
                <span class="owned-dashboard-kpi__value">${totalPatNet !== 0 ? totalPatNet.toLocaleString('fr-FR') + ' €' : '—'}</span>
            </div>
            <div class="owned-dashboard-kpi">
                <span class="owned-dashboard-kpi__label" title="${escapeHtml(libellePeriodeCF(periodeCFReference()))}, hors frais ponctuels">CF net-net / mois · 12 prochains mois</span>
                <span class="owned-dashboard-kpi__value owned-dashboard-kpi__value--${cfTone}">${totalCF >= 0 ? '+' : ''}${Math.round(totalCF).toLocaleString('fr-FR')} €</span>
            </div>
            <div class="owned-dashboard-kpi">
                <span class="owned-dashboard-kpi__label">Taux d'endettement</span>
                <span class="owned-dashboard-kpi__value owned-dashboard-kpi__value--${endettTone}">${formatPercent(endettement.tauxEndettement)}</span>
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
                ${escapeHtml(a.msg)}
                ${a.assetId ? `<button class="btn btn--ghost btn--xs" data-action="go-asset" data-id="${escapeHtml(a.assetId)}" title="Voir le bien" aria-label="Voir le bien concerné">${icone('fleche-droite')}</button>` : ''}
            </div>`).join('')}
        </div>` : `<div class="owned-dashboard-no-alerts">${icone('coche')} Aucune action en attente sur le portefeuille</div>`}

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
                <span class="owned-goal-delta">${totalCF >= goals.cfCible ? `${icone('coche')} Atteint !` : 'Il manque ' + Math.round(goals.cfCible - totalCF).toLocaleString('fr-FR') + ' €/mois'}</span>
            </div>` : ''}
            ${goals.patrimoineCible > 0 ? `
            <div class="owned-goal-row">
                <span class="owned-goal-label">Patrimoine : ${totalPatNet.toLocaleString('fr-FR')} € / ${goals.patrimoineCible.toLocaleString('fr-FR')} € cible</span>
                <div class="owned-goal-bar-wrap"><div class="owned-goal-bar" style="width:${patProgress.toFixed(1)}%"></div></div>
                <span class="owned-goal-delta">${totalPatNet >= goals.patrimoineCible ? `${icone('coche')} Atteint !` : 'Il manque ' + Math.round(goals.patrimoineCible - totalPatNet).toLocaleString('fr-FR') + ' €'}</span>
            </div>` : ''}
            ${moisRestantsObj !== null ? `<div class="owned-goal-deadline">${icone('horloge')} ${moisRestantsObj > 0 ? moisRestantsObj + ' mois restants avant l\'objectif' : 'Date objectif dépassée'}</div>` : ''}
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
    wrap.querySelectorAll('[data-action="open-projection-impots"]').forEach(btn => {
        btn.addEventListener('click', () => openProjectionImpotsModal(null));
    });
    wrap.querySelectorAll('[data-action="open-factures"]').forEach(btn => {
        btn.addEventListener('click', () => openImpressionFacturesModal({ assetId: null }));
    });
}

export async function openOwnedImportModal() {
    const modal = document.getElementById('owned-import-modal');
    const list = document.getElementById('owned-import-file-list');
    const confirm = document.getElementById('owned-import-modal-confirm');
    const fileInput = document.getElementById('owned-import-file-input');
    if (!modal || !list) return;
    list.innerHTML = '<div class="owned-import-empty">Chargement…</div>';
    if (confirm) { confirm.disabled = true; confirm.textContent = 'Importer'; }
    if (fileInput) fileInput.value = '';
    modal._pendingFile = null;
    modal._fileRow = null;
    modal.hidden = false;
    // Un fichier local choisi pendant le chargement ne doit pas être effacé par la réécriture de la liste.
    const keepFileRow = () => { if (modal._fileRow) list.prepend(modal._fileRow); };
    try {
        const archives = await cloudListArchives();
        if (!archives.length) {
            list.innerHTML = '<div class="owned-import-empty">Aucune archive dans le cloud — utilisez « Export », ou choisissez un fichier.</div>';
            keepFileRow();
            return;
        }
        list.innerHTML = archives.map(a => `
            <div class="owned-import-file-item" data-filename="${escapeHtml(a.name)}">
                <span class="owned-import-file-item__name">${escapeHtml(a.name)}</span>
                <span class="owned-import-note">${a.size != null ? escapeHtml(`${Math.round(a.size / 1024)} Ko`) : ''}</span>
            </div>`).join('');
        list.querySelectorAll('.owned-import-file-item').forEach(item => {
            item.addEventListener('click', () => {
                list.querySelectorAll('.owned-import-file-item').forEach(i => i.classList.remove('owned-import-file-item--selected'));
                item.classList.add('owned-import-file-item--selected');
                modal._pendingFile = null;
                if (confirm) confirm.disabled = false;
            });
        });
        keepFileRow();
    } catch {
        list.innerHTML = '<div class="owned-import-empty">Erreur lors du chargement des archives.</div>';
        keepFileRow();
    }
}

// Fusionne un export { id: bien } dans le portefeuille sans écraser les biens existants (même règle
// qu'avant). Un contenu qui n'est pas un objet de biens est refusé avant toute écriture.
export function _importPortfolioObject(portfolio) {
    if (!portfolio || typeof portfolio !== 'object' || Array.isArray(portfolio)) {
        throw new Error('ce fichier ne contient pas un portefeuille Spark');
    }
    // Forme minimale d'un bien Spark : `acquisition` objet (createOwnedAsset la pose toujours) — sans elle
    // les rendus ultérieurs planteraient.
    const entries = Object.entries(portfolio).filter(([, asset]) => asset && typeof asset === 'object' && !Array.isArray(asset)
        && asset.acquisition && typeof asset.acquisition === 'object');
    if (!entries.length) throw new Error('aucun bien dans ce fichier');
    const existing = loadOwnedAssets();
    let added = 0;
    for (const [id, asset] of entries) {
        if (!existing[id]) { existing[id] = { ...asset, id }; added++; }
    }
    if (added) saveOwnedAssets(existing);
    return added;
}

export function renderOwnedRegimeSelector() {
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
                if (fresh) { renderOwnedSynthese(fresh); renderOwnedCalculTab(fresh); }
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

// ─── Carte du portefeuille (Leaflet) ─────────────────────────────────────────
// Un marqueur par bien géocodé (asset.lat/lng, alimentés par geocodeOwnedAsset).
// La carte est instanciée une seule fois puis réutilisée ; L vient de vendor/leaflet.

let _ownedMap = null;
let _ownedMapMarkers = null;

// Exportée pour main.js : le panneau Portefeuille peut être caché (display:none, autre onglet
// actif) au moment où Firestore livre les biens et où la carte s'initialise pour la première fois
// — Leaflet mesure alors un conteneur à 0x0 et ne charge que quelques tuiles. Le seul rattrapage
// interne (renderOwnedMap, plus bas) ne suffit pas si aucun second rendu ne survient pendant que
// le panneau redevient visible : il faut recalculer la taille au moment précis où l'onglet
// Portefeuille est cliqué, ce que seul main.js (propriétaire du wiring des onglets) peut détecter.
export function invalidateOwnedMap() {
    _ownedMap?.invalidateSize();
}

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

export function renderOwnedMap(list = null) {
    if (IS_MOBILE_PAGE) return; // bloc desktop uniquement — voir renderOwnedVerdictBlock
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

    // Audit 2026-11-18, A6 : sans aucun bien localisé, plus de carte vide de ~300 px — titre et cadre
    // masqués (.owned-map-section--empty), une seule ligne d'invite à la place.
    const wasEmpty = section.classList.contains('owned-map-section--empty');
    section.classList.toggle('owned-map-section--empty', !located.length);
    if (emptyEl) emptyEl.hidden = true;
    if (unlocEl) {
        unlocEl.textContent = !located.length
            ? 'Carte du portefeuille : aucun bien localisé. Renseignez l’adresse d’un bien (onglet Acquisition) pour le placer sur la carte.'
            : (missing
                ? `${missing} bien${missing > 1 ? 's' : ''} sans adresse — ajoutez-la dans l'onglet Acquisition pour ${missing > 1 ? 'les' : 'le'} placer sur la carte.`
                : '');
    }

    if (!located.length) return;
    if (!_initOwnedMap()) return;
    if (wasEmpty) window.requestAnimationFrame(() => _ownedMap?.invalidateSize()); // cadre ré-affiché
    _ownedMapMarkers.clearLayers();

    const tmi = getOwnedTmi();
    const regime = getOwnedRegime();
    const bounds = [];

    for (const asset of located) {
        const sc = getOwnedDefaultScenario(asset);
        const cf = computeOwnedAssetCF(asset, sc.variables, tmi, regime, state.profileData);
        const positif = cf.cfNetNet >= 0;
        const marker = L.circleMarker([asset.lat, asset.lng], {
            radius: 10,
            fillColor: positif ? '#16a34a' : '#dc2626',
            fillOpacity: 0.85,
            color: '#fff',
            weight: 2,
        });

        const cfLabel = `${positif ? '+' : ''}${Math.round(cf.cfNetNet).toLocaleString('fr-FR')} €/mois (12 prochains mois)`;
        marker.bindPopup(`
            <div class="owned-map-popup">
                <div class="owned-map-popup__title">${escapeHtml(asset.nom || 'Sans nom')}</div>
                <div class="owned-map-popup__meta">${escapeHtml(asset.ville || '')}</div>
                <div class="owned-map-popup__cf" style="color:${positif ? '#16a34a' : '#dc2626'}">
                    CF net-net : <strong>${cfLabel}</strong>
                </div>
                <button type="button" class="owned-map-popup__btn" data-map-open="${escapeHtml(asset.id)}">Voir le détail ${icone('fleche-droite')}</button>
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

export function renderOwnedPortfolioList() {
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
                return computeOwnedAssetCF(a, sc.variables, tmi, regime, state.profileData);
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
            // Audit 2026-11-18, A2 : sur PC, le dashboard juste au-dessus affiche déjà ce CF ; la carte
            // n'est gardée que sur owned.html, où le dashboard n'est pas rendu (IS_MOBILE_PAGE).
            nodes.ownedKpiBanner.innerHTML = `
                ${IS_MOBILE_PAGE ? `<div class="owned-kpi-card">
                    <span class="owned-kpi-card__label" title="${escapeHtml(libellePeriodeCF(periodeCFReference()))}, hors frais ponctuels">CF net-net / mois · 12 prochains mois</span>
                    <span class="owned-kpi-card__value owned-kpi-card__value--${cfTone}">
                        ${totalCF >= 0 ? '+' : ''}${Math.round(totalCF).toLocaleString('fr-FR')} €
                    </span>
                </div>` : ''}
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

    if (IS_MOBILE_PAGE) {
        // Ne PAS `return` ici : le branchement des onglets et le rendu de l'onglet Profil (plus bas
        // dans cette fonction, hors de ce bloc desktop-only) doivent aussi s'exécuter sur owned.html —
        // un `return` prématuré les court-circuitait entièrement, rendant l'onglet Profil totalement
        // inerte sur téléphone (aucune erreur, juste jamais câblé — bug remonté par l'utilisateur,
        // reproduit et diagnostiqué via Playwright le 2026-08-04, voir docs/superpowers/specs/).
        _renderOwnedListMobile(list);
    } else {
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
            // 'actuel' (défaut) = CF de référence, 12 prochains mois (chantier CF unique) ; An N = projection.
            const yr = state.ownedYearFilter ?? 'actuel';
            const YEAR_OPTIONS = ['actuel', 1, 3, 5, 10];
            const yearSelectorHtml = `
                <div class="owned-year-selector">
                    <span class="owned-year-selector__label">Métriques en</span>
                    <div class="owned-year-selector__btns">
                        ${YEAR_OPTIONS.map(y => `<button class="owned-year-btn${y === yr ? ' owned-year-btn--active' : ''}" data-year="${y}"${y === 'actuel' ? ' title="CF de référence : moyenne des 12 prochains mois, hors frais ponctuels"' : ''}>${y === 'actuel' ? '12 mois' : `An ${y}`}</button>`).join('')}
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
                const investissementTotal = (asset.acquisition?.prix || 0) + (asset.acquisition?.fraisAgence || 0) + (asset.acquisition?.fraisNotaire || 0);
                if (yr === 'actuel') {
                    // CF de référence : mêmes chiffres que le dashboard, la carte, la fiche et le rapport.
                    const r = computeOwnedAssetCF(asset, getOwnedDefaultScenario(asset).variables, tmi, regime, state.profileData);
                    const rentaNette = investissementTotal > 0 ? ((r.loyerEffectif - r.chargesExploitationMensuelles) * 12 / investissementTotal) * 100 : 0;
                    return { asset, cfMens: r.cfNetNet, dscr: r.dscr, rentaNette, cfAnnuel: r.cfNetNet * 12, targetAbsYear: r.periode.debut.annee };
                }
                const { years: timeline } = computeOwnedAssetTimeline(asset, state.profileData, regime);
                const { annee: anneeAchat } = parseDateAchat(asset.dateAchat);
                const targetAbsYear = anneeAchat + yr - 1;
                const yearRow = timeline.find(y => y.year === targetAbsYear) || timeline[timeline.length - 1];
                const cfAnnuel = yearRow ? yearRow.cfAnnuel : 0;
                const cfMens = cfAnnuel / 12;

                // DSCR/rendement calculés pour la MÊME année ciblée que cfAnnuel (via computeCFBreakdown,
                // qui accepte un targetYear comme computeOwnedAssetTimeline) — pas via computeOwnedAssetCF,
                // qui reflète toujours aujourd'hui : sinon la colonne CF suit le sélecteur "Métriques en
                // An X" pendant que DSCR/Rendement restaient figés sur la situation actuelle, deux bases
                // temporelles différentes affichées côte à côte sur la même ligne (bug remonté par
                // l'utilisateur, 2026-08-03).
                const bd = computeCFBreakdown(asset, state.profileData, regime, yr);
                const noiAnnuel = bd ? (bd.loyersEncaisses - bd.charges) : 0;
                const rentaNette = investissementTotal > 0 ? (noiAnnuel / investissementTotal) * 100 : 0;
                const dscr = bd && bd.mensualiteCredit > 0 ? noiAnnuel / bd.mensualiteCredit : 0;

                return { asset, cfMens, dscr, rentaNette, cfAnnuel, targetAbsYear };
            });

            if (sort) {
                const valueFor = row => sort.criterion === 'cf' ? row.cfMens : sort.criterion === 'rendement' ? row.rentaNette : row.dscr;
                rowData.sort((a, b) => (valueFor(a) - valueFor(b)) * (sort.dir === 'asc' ? 1 : -1));
            }

            const sortArrow = key => sort?.criterion === key ? ` ${icone(sort.dir === 'asc' ? 'chevron-haut' : 'chevron-bas')}` : '';
            const basePeriodeListe = yr === 'actuel' ? '12 mois' : `An ${yr}`;
            const sortHeaderAttr = (key, tooltip) => `data-sort-header="${key}" role="button" tabindex="0" title="${tooltip ? tooltip + ' ' : ''}Trier par ${SORT_LABELS[key]}"`;

            nodes.ownedListTable.innerHTML = yearSelectorHtml + sortSelectorHtml + `
                <table>
                    <thead>
                        <tr>
                            <th class="owned-col-drag"></th>
                            <th></th>
                            <th>Bien</th>
                            <th style="text-align:right" class="owned-col-sortable" ${sortHeaderAttr('cf')}>CF net-net/mois <span class="owned-col-periode">(${basePeriodeListe})</span>${sortArrow('cf')}</th>
                            <th style="text-align:right" class="owned-col-hideable owned-col-sortable" ${sortHeaderAttr('rendement')}>Rendement net${sortArrow('rendement')}</th>
                            <th style="text-align:right" class="owned-col-hideable owned-col-sortable" ${sortHeaderAttr('dscr', 'DSCR : capacité de remboursement par le loyer (loyers ÷ mensualité crédit). Au-dessus de 1, le loyer couvre le crédit.')}>DSCR${sortArrow('dscr')}</th>
                            <th>Statut</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rowData.map(({ asset, cfMens, dscr, rentaNette, cfAnnuel, targetAbsYear }) => {
                            const cfTone = cfMens >= 0 ? 'positive' : 'negative';

                            // Alerte régime : comparer régime optimal an 1 vs an 5
                            const cmp = computeRegimeComparison(asset, state.profileData, [1, 5]);
                            const optAn1 = cmp.optimal[1];
                            const optAn5 = cmp.optimal[5];
                            const regimeAlertHtml = (optAn1 && optAn5 && optAn1 !== optAn5)
                                ? `<span class="owned-regime-alert" title="Régime optimal change en an 5">${icone('alerte')} Régime an 5</span>`
                                : '';

                            // Donut inline SVG — loyer résolu à targetAbsYear (même année que cfAnnuel via
                            // resolveLoyerVacance, cohérent avec le sélecteur "Métriques en An X" ; sans ça
                            // le donut mélangeait le loyer d'AUJOURD'HUI avec un cfAnnuel d'une autre année).
                            const { loyer: loyerDonut, vacancePct: vacanceDonut } = resolveLoyerVacance(asset, String(targetAbsYear));
                            const recettes = Math.max(0, loyerDonut * 12 * (1 - vacanceDonut / 100));
                            const depenses = Math.max(0, recettes - cfAnnuel);
                            const total = recettes + depenses;
                            const donutHtml = total > 0 ? renderOwnedDonutSVG(recettes, depenses, cfMens >= 0) : '<div class="owned-donut-wrap"></div>';

                            const hasUnclassified = (asset.postAchat?.travaux || []).some(t => t.tag === 'a-classifier');
                            let statusTone, statusLabel;
                            if (cfMens < -50) {
                                statusTone = 'negative'; statusLabel = `CF ${Math.round(cfMens).toLocaleString('fr-FR')} €`;
                            } else if (dscr > 0 && dscr < 1) {
                                statusTone = 'negative'; statusLabel = `DSCR ${formatRatio(dscr)}`;
                            } else if (dscr >= 1 && dscr < 1.1) {
                                statusTone = 'watch'; statusLabel = 'DSCR tendu';
                            } else if (hasUnclassified) {
                                statusTone = 'watch'; statusLabel = 'Travaux';
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
                                    <div class="owned-table-meta">${escapeHtml(asset.ville)}${asset.dateAchat ? ` · ${formatDateAchat(asset.dateAchat)}` : ''}${regimeAlertHtml ? ' ' + regimeAlertHtml : ''}</div>
                                </td>
                                <td class="owned-table-num owned-table-num--${cfTone}">
                                    ${cfMens >= 0 ? '+' : ''}${Math.round(cfMens).toLocaleString('fr-FR')} €
                                </td>
                                <td class="owned-table-num owned-col-hideable">${rentaNette.toFixed(1).replace('.', ',')} %</td>
                                <td class="owned-table-num owned-col-hideable">${formatRatio(dscr)}</td>
                                <td>
                                    <span class="owned-status-badge owned-status-badge--${statusTone}">
                                        ${statusLabel}
                                    </span>
                                </td>
                                <td>
                                    <button class="btn btn--ghost btn--sm" data-action="delete-owned" data-id="${escapeHtml(asset.id)}" title="Supprimer" aria-label="Supprimer ${escapeHtml(asset.nom || 'le bien')}">${icone('croix')}</button>
                                </td>
                            </tr>
                            `;
                            const expandedRow = isExpanded ? `
<tr class="owned-expanded-row" data-expanded-for="${escapeHtml(asset.id)}">
    <td colspan="8">
        <div class="owned-expanded-content">
            <div class="owned-expanded-metric">
                <span class="owned-expanded-label">CF net-net/mois (${basePeriodeListe})</span>
                <span class="owned-expanded-value owned-expanded-value--${cfTone}">${cfMens >= 0 ? '+' : ''}${Math.round(cfMens).toLocaleString('fr-FR')} €</span>
            </div>
            <div class="owned-expanded-metric">
                <span class="owned-expanded-label">Rendement net</span>
                <span class="owned-expanded-value">${formatPercent(rentaNette)}</span>
            </div>
            <div class="owned-expanded-metric">
                <span class="owned-expanded-label">DSCR</span>
                <span class="owned-expanded-value owned-expanded-value--${dscr >= 1.2 ? 'positive' : dscr >= 1 ? 'watch' : 'negative'}">${formatRatio(dscr)}</span>
            </div>
            <div class="owned-expanded-metric">
                <span class="owned-expanded-label">Prix d'achat</span>
                <span class="owned-expanded-value">${(asset.acquisition?.prix || 0).toLocaleString('fr-FR')} €</span>
            </div>
            <div class="owned-expanded-metric">
                <span class="owned-expanded-label">Loyer initial</span>
                <span class="owned-expanded-value">${(asset.acquisition?.loyerInitial || 0).toLocaleString('fr-FR')} €/mois</span>
            </div>
            <button class="btn btn--ghost btn--sm" style="margin-left:auto" data-open-asset="${escapeHtml(asset.id)}">Ouvrir ${icone('fleche-droite')}</button>
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
                    state.ownedYearFilter = parseOwnedYear(btn.dataset.year);
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
                savePref({ ownedSort: state.ownedSort }).catch(() => {});
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
                    savePref({ ownedSort: state.ownedSort }).catch(() => {});
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
                        if (_authUser) cloudSaveMeta({ order: ids }).catch(() => {});
                        renderOwnedPortfolioList();
                    });
                });
            })();
        }
    }
    renderOwnedPortfolioCharts(list, state.profileData, regime);
    renderOwnedDashboard(list, state.profileData, regime);
    renderOwnedCfConsolidatedSection(list, tmi, regime);
    }

    // Le branchement du clic sur les onglets est fait AVANT de rendre le contenu des onglets
    // eux-mêmes (Profil/Impôt, juste après) : si l'un de ces rendus lève une exception sur une
    // forme de donnée imprévue, le clic reste fonctionnel pour tous les onglets au lieu d'être
    // silencieusement jamais câblé (bug remonté par l'utilisateur — clic sur "Profil" sans effet
    // sur owned.html, cause exacte non confirmée faute d'accès navigateur, corrigé par prudence).
    const listView = nodes.ownedListView;
    if (listView && !listView.dataset.tabWired) {
        listView.dataset.tabWired = '1';
        listView.addEventListener('click', e => {
            const btn = e.target.closest('.owned-list-tabs .owned-tab');
            if (!btn) return;
            const tabKey = btn.dataset.tab;
            listView.querySelectorAll('.owned-list-tabs .owned-tab').forEach(t => {
                t.classList.toggle('owned-tab--active', t === btn);
                t.setAttribute('aria-selected', t === btn ? 'true' : 'false');
            });
            listView.querySelectorAll(':scope > .owned-tab-panel').forEach(p => {
                p.hidden = p.id !== `owned-list-tab-${tabKey}`;
            });
        });
    }

    // Onglet Profil : PC et téléphone (l'utilisateur veut pouvoir mettre à jour ses revenus depuis
    // les deux). Onglet Impôt : reste PC uniquement, cohérent avec la simplification mobile du
    // 2026-07-28 (owned.html n'a pas de tableau de bord fiscal détaillé). Chacun protégé par
    // try/catch : une exception sur une forme de donnée imprévue ne doit dégrader que cet onglet,
    // jamais le reste du rendu ni le clic câblé juste au-dessus.
    try {
        renderOwnedProfilTab();
    } catch (err) {
        console.error('[Spark] renderOwnedProfilTab a échoué :', err);
    }
    if (!IS_MOBILE_PAGE) {
        try {
            renderOwnedImpotTab();
        } catch (err) {
            console.error('[Spark] renderOwnedImpotTab a échoué :', err);
        }
    }
}

// Vue liste smartphone (owned.html) : juste nom/ville/CF net-net par bien, tap pour ouvrir
// la fiche. Pas de tri, pas de glisser-déposer, pas de carte/graphiques/dashboard — cf. spec
// docs/superpowers/specs/2026-07-28-owned-mobile-simplification.md.
function _renderOwnedListMobile(list) {
    if (!nodes.ownedListTable) return;
    const tmi = getOwnedTmi();
    const regime = getOwnedRegime();

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
        return;
    }

    nodes.ownedListTable.innerHTML = `
        <div class="owned-mobile-list">
            ${list.map(asset => {
                const sc = getOwnedDefaultScenario(asset);
                const r = computeOwnedAssetCF(asset, sc.variables, tmi, regime, state.profileData);
                const cfMens = r.cfNetNet;
                const cfTone = cfMens >= 0 ? 'positive' : 'negative';
                const cfSign = cfMens >= 0 ? '+' : '−';
                return `
                <button type="button" class="owned-mobile-list__item" data-asset-id="${escapeHtml(asset.id)}">
                    <span class="owned-mobile-list__info">
                        <span class="owned-mobile-list__name">${escapeHtml(asset.nom || 'Sans nom')}</span>
                        <span class="owned-mobile-list__ville">${escapeHtml(asset.ville || '')}</span>
                    </span>
                    <span class="owned-mobile-list__cf owned-mobile-list__cf--${cfTone}">${cfSign}${Math.round(Math.abs(cfMens)).toLocaleString('fr-FR')} €<small>/mois</small></span>
                </button>`;
            }).join('')}
        </div>
    `;
    nodes.ownedListTable.querySelectorAll('[data-asset-id]').forEach(btn => {
        btn.addEventListener('click', () => openOwnedDetail(btn.dataset.assetId));
    });
}

function renderOwnedCfConsolidatedSection(list, tmi, regime) {
    if (IS_MOBILE_PAGE) return; // bloc desktop uniquement — voir renderOwnedVerdictBlock
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
        const r = computeOwnedAssetCF(asset, sc.variables, tmi, regime, state.profileData);
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

let _ownedPortfolioCfChart = null;
let _ownedPortfolioEcartChart = null;

function renderOwnedPortfolioCharts(list, profileData, regime) {
    if (IS_MOBILE_PAGE) return; // bloc desktop uniquement — voir renderOwnedVerdictBlock
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
        const anneeAchat = parseDateAchat(a.dateAchat).annee;
        const duree = a.acquisition?.credit?.duree || 0;
        return { start: anneeAchat, end: Math.max(currentYear + 2, anneeAchat + duree) };
    });
    const globalStart = Math.min(...allRanges.map(r => r.start));
    const globalEnd = Math.max(...allRanges.map(r => r.end));

    const aggCF = {}, aggRec = {}, aggDep = {};
    for (let y = globalStart; y <= globalEnd; y++) { aggCF[y] = 0; aggRec[y] = 0; aggDep[y] = 0; }

    for (const asset of list) {
        const { years } = computeOwnedAssetTimeline(asset, profileData, regime);
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
    // Série unique du graphique = couleur d'accent de l'interface (jetons --primary-rgb), pas d'or en dur (audit A5).
    const accentRgb = getComputedStyle(document.documentElement).getPropertyValue('--primary-rgb').trim() || '99, 102, 241';
    const accent = `rgb(${accentRgb})`, green = '#22c55e', red = '#ef4444';
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
            data: { labels, datasets: [{ data: dataCF, borderColor: accent, backgroundColor: `rgba(${accentRgb}, ${isDark ? 0.1 : 0.13})`, borderWidth: 2, pointRadius: 2, tension: 0.25, fill: true }] },
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
