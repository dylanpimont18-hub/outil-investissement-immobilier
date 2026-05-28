// Constantes config (récupérées depuis /api/status au démarrage)
const API = {
  scan: '/api/scan',
  scanFull: '/api/scan/full',
  status: '/api/status',
  results: '/api/results',
};

// ─── Sélecteur CP ─────────────────────────────────────────────────────────────

let _communesData = null;   // {cp: [commune, ...]}
let _cpFilter = null;       // {cp: string, commune: string|null} ou null

async function _loadCommunesData() {
  if (_communesData) return;
  try {
    const resp = await fetch('/data/communes_centre_val.json');
    _communesData = await resp.json();
  } catch (e) {
    _communesData = {};
  }
}

function _initCPSelector() {
  const input = document.getElementById('cp-search');
  const dropdown = document.getElementById('cp-dropdown');
  const resetBtn = document.getElementById('cp-reset');
  if (!input) return;

  input.addEventListener('focus', () => _loadCommunesData());

  input.addEventListener('input', () => {
    const val = input.value.trim();
    if (val.length < 2 || !_communesData) { dropdown.style.display = 'none'; return; }

    // Trouver les communes correspondantes (par CP ou par nom de commune)
    const matches = [];
    const valLow = val.toLowerCase();
    for (const [cp, communes] of Object.entries(_communesData)) {
      if (cp.startsWith(val)) {
        for (const commune of communes) matches.push({ cp, commune });
      } else {
        for (const commune of communes) {
          if (commune.toLowerCase().includes(valLow)) matches.push({ cp, commune });
        }
      }
    }

    if (!matches.length) { dropdown.style.display = 'none'; return; }

    // Compter les biens par CP
    const biensCounts = {};
    for (const r of _allResultats) {
      if (r.code_postal) biensCounts[r.code_postal] = (biensCounts[r.code_postal] || 0) + 1;
    }

    // Grouper par préfixe pour l'option "Toutes"
    const totalMatching = matches.reduce((sum, m) => sum + (biensCounts[m.cp] || 0), 0);
    const uniqueCPs = [...new Set(matches.map(m => m.cp))];

    let html = '';
    if (uniqueCPs.length > 1) {
      html += `<div class="cp-option cp-option-all" data-cp="${val}" data-commune="__all__"
        style="padding:9px 14px;cursor:pointer;border-bottom:1px solid var(--border);font-weight:600;color:var(--accent-gold,#C5A059)">
        Toutes les communes "${val}…" <span style="color:var(--muted);font-weight:400">(${totalMatching} biens)</span>
      </div>`;
    }
    for (const { cp, commune } of matches.slice(0, 30)) {
      const n = biensCounts[cp] || 0;
      html += `<div class="cp-option" data-cp="${cp}" data-commune="${_esc(commune)}"
        style="padding:8px 14px;cursor:pointer;font-size:13px">
        <span style="color:var(--muted);font-size:11px;margin-right:6px">${cp}</span>${_esc(commune)}
        <span style="color:var(--muted);font-size:11px;float:right">${n} bien${n !== 1 ? 's' : ''}</span>
      </div>`;
    }

    dropdown.innerHTML = html;
    dropdown.style.display = 'block';

    dropdown.querySelectorAll('.cp-option').forEach(el => {
      el.addEventListener('mouseenter', () => {
        dropdown.querySelectorAll('.cp-option--active').forEach(a => { a.classList.remove('cp-option--active'); a.style.background = ''; });
        el.style.background = 'var(--surface-strong)';
      });
      el.addEventListener('mouseleave', () => el.style.background = '');
      el.addEventListener('click', () => {
        const cp = el.dataset.cp;
        const commune = el.dataset.commune;
        _setCPFilter(cp, commune === '__all__' ? null : commune, commune === '__all__' ? `${cp}… (toutes)` : `${cp} — ${commune}`);
        dropdown.style.display = 'none';
      });
    });
  });

  input.addEventListener('keydown', e => {
    const options = [...dropdown.querySelectorAll('.cp-option')];
    const active = dropdown.querySelector('.cp-option--active');
    const idx = options.indexOf(active);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = options[idx + 1] || options[0];
      if (active) active.classList.remove('cp-option--active');
      if (next) { next.classList.add('cp-option--active'); next.style.background = 'var(--surface-strong)'; }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = options[idx - 1] || options[options.length - 1];
      if (active) active.classList.remove('cp-option--active');
      if (prev) { prev.classList.add('cp-option--active'); prev.style.background = 'var(--surface-strong)'; }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = active || options[0];
      if (target) {
        const cp = target.dataset.cp;
        const commune = target.dataset.commune;
        _setCPFilter(cp, commune === '__all__' ? null : commune, commune === '__all__' ? `${cp}… (toutes)` : `${cp} — ${commune}`);
        dropdown.style.display = 'none';
      }
    } else if (e.key === 'Escape') {
      dropdown.style.display = 'none';
    }
  });

  document.addEventListener('click', e => {
    if (!input.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.style.display = 'none';
    }
  });

  resetBtn?.addEventListener('click', () => {
    _cpFilter = null;
    input.value = '';
    document.getElementById('cp-active-badge').style.display = 'none';
    resetBtn.style.display = 'none';
    _applyTable();
  });
}

function _setCPFilter(cp, commune, label) {
  _cpFilter = { cp, commune };
  const badge = document.getElementById('cp-active-badge');
  const reset = document.getElementById('cp-reset');
  if (badge) { badge.textContent = label; badge.style.display = ''; }
  if (reset)   reset.style.display = '';
  document.getElementById('cp-search').value = label;
  _applyTable();
}

function _matchCP(r) {
  if (!_cpFilter) return true;
  const cp = (r.code_postal || '');
  if (_cpFilter.commune) {
    return cp === _cpFilter.cp && (r.ville || '').toLowerCase() === _cpFilter.commune.toLowerCase();
  }
  return cp.startsWith(_cpFilter.cp);
}

// ─── État scanner ─────────────────────────────────────────────────────────────

let _pollInterval = null;
let _scanRunning = false;
let _saveCurrentStudy = null;

// ─── État tableau ─────────────────────────────────────────────────────────────
let _allResultats = [];
let _displayedResultats = [];
let _sortKey = 'cf_net';
let _sortDir = -1; // -1 = décroissant, 1 = croissant
let _displayCount = 20; // nombre ou 'all'

const SORT_COLS = [
  { key: 'cf_net',         label: 'CF net',          th: 'CF net' },
  { key: 'cf_apres_impot', label: 'CF après impôt',  th: 'CF après impôt' },
  { key: 'renta_brute',    label: 'Renta brute',      th: 'Renta brute' },
  { key: 'score',          label: 'Score IA',         th: 'Score' },
  { key: 'dscr',           label: 'DSCR',             th: 'DSCR' },
  { key: 'prix',           label: 'Prix',             th: 'Prix' },
  { key: 'loyer_estime',   label: 'Loyer',            th: 'Loyer' },
  { key: 'prix_m2',        label: 'Prix/m²',          th: 'Prix/m²' },
  { key: 'surface',        label: 'Surface',          th: 'Surface' },
  { key: 'mensualite',     label: 'Mensualité',       th: 'Mensualité' },
];

function _getVal(r, key) {
  if (key === 'prix_m2') return r.surface ? r.prix / r.surface : null;
  const v = r[key];
  return v != null ? v : null;
}

// ─── Points d'entrée publics ────────────────────────────────────────────────

export function initScanner({ saveCurrentStudy } = {}) {
  _saveCurrentStudy = saveCurrentStudy || null;
  _bindButtons();
  // tente de charger les résultats précédents (silencieux si absents)
  _loadResults(false);
}

export function onScannerTabActivated() {
  _loadResults(false);
  if (_scanRunning) _startPolling();
}

// ─── Boutons ─────────────────────────────────────────────────────────────────

function _bindButtons() {
  document.getElementById('btn-scan')?.addEventListener('click', () => _startScan('/api/scan'));
  document.getElementById('btn-scan-full')?.addEventListener('click', () => {
    if (confirm('Vider le cache et relancer un scan complet sur toutes les annonces ?')) {
      _startScan('/api/scan/full');
    }
  });
  document.getElementById('btn-clear-cache')?.addEventListener('click', async () => {
    if (confirm('Vider le cache ? Le prochain scan traitera toutes les annonces.')) {
      alert('Cache vidé au prochain "Scan complet".');
    }
  });

  // Délégation unique pour les boutons "→ Analyser" (rebind évité à chaque re-render)
  document.getElementById('scanner-results')?.addEventListener('click', e => {
    const btn = e.target.closest('.scanner-analyser-btn');
    if (!btn) return;
    _analyserBien(_displayedResultats[parseInt(btn.dataset.rank, 10)]);
  });

  // Filtres à cocher — un seul listener sur le panel
  document.getElementById('scanner-filters')?.addEventListener('change', () => {
    _updateFilterCount();
    _applyTable();
  });

  document.getElementById('scanner-filter-reset')?.addEventListener('click', () => {
    document.querySelectorAll('#scanner-filters input[type="checkbox"]').forEach(cb => { cb.checked = false; });
    // Remet les sliders à leurs bornes initiales
    ['range-prix-min','range-surface-min','range-cf','range-renta','range-dscr','range-score-min'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.value = el.min; }
    });
    ['range-prix-max','range-surface-max'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.value = el.max; }
    });
    ['prix-min','surface-min','cf-min','renta-min','dscr-min','score-min'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    ['prix-max','surface-max'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    _updateFilterCount();
    _applyTable();
  });

  // Bouton "Voir les annonces"
  document.getElementById('btn-voir-resultats')?.addEventListener('click', () => {
    document.getElementById('scanner-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  _initCPSelector();

  // Quick filter buttons → ouvrir le panel et scroller vers la section
  function _openFilterAndScroll(sectionIndex) {
    const sidebar = document.getElementById('scanner-filters');
    if (!sidebar) return;
    const sections = sidebar.querySelectorAll('.scanner-filter-section');
    if (sections[sectionIndex]) {
      setTimeout(() => sections[sectionIndex].scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
    }
  }
  // Budget → section BUDGET ET SURFACE (index 4)
  document.getElementById('qf-budget-btn')?.addEventListener('click', () => _openFilterAndScroll(4));
  // Nb de pièces → section À PROPOS DU BIEN (index 0)
  document.getElementById('qf-pieces-btn')?.addEventListener('click', () => _openFilterAndScroll(0));
  // Surface → section BUDGET ET SURFACE (index 4)
  document.getElementById('qf-surface-btn')?.addEventListener('click', () => _openFilterAndScroll(4));
  // Type de bien → section TYPE ET ÉTAT (index 2)
  document.getElementById('qf-type-btn')?.addEventListener('click', () => _openFilterAndScroll(2));

  document.getElementById('tab-tableau')?.addEventListener('click', () => {
    document.getElementById('scanner-map-container').style.display = 'none';
    document.getElementById('scanner-results').style.display = '';
    document.getElementById('tab-tableau').style.cssText = 'padding:6px 18px;border-radius:6px;border:1px solid var(--accent-gold,#C5A059);background:var(--accent-gold,#C5A059)22;color:var(--accent-gold,#C5A059);font-size:13px;cursor:pointer;font-weight:600';
    document.getElementById('tab-carte').style.cssText   = 'padding:6px 18px;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--muted);font-size:13px;cursor:pointer';
  });

  document.getElementById('tab-carte')?.addEventListener('click', () => {
    document.getElementById('scanner-results').style.display = 'none';
    document.getElementById('scanner-map-container').style.display = '';
    document.getElementById('tab-carte').style.cssText   = 'padding:6px 18px;border-radius:6px;border:1px solid var(--accent-gold,#C5A059);background:var(--accent-gold,#C5A059)22;color:var(--accent-gold,#C5A059);font-size:13px;cursor:pointer;font-weight:600';
    document.getElementById('tab-tableau').style.cssText = 'padding:6px 18px;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--muted);font-size:13px;cursor:pointer';
    _renderMap(_displayedResultats);
    setTimeout(() => _leafletMap?.invalidateSize(), 100);
  });
}

function _updateFilterCount() {
  let active = document.querySelectorAll('#scanner-filters input[type="checkbox"]:checked').length;
  // Compte les filtres numériques non nuls
  const numericIds = ['prix-min','prix-max','surface-min','surface-max','renta-min','cf-min','dscr-min','score-min'];
  for (const id of numericIds) {
    const el = document.getElementById(id);
    if (el && el.value !== '' && parseFloat(el.value) !== 0) active++;
  }
  // Label dans le panel
  const countEl = document.getElementById('scanner-filter-count');
  if (countEl) countEl.textContent = active > 0 ? `${active} filtre${active > 1 ? 's' : ''} actif${active > 1 ? 's' : ''}` : '';
  // Badge dans la barre de recherche
  const badge = document.getElementById('scanner-filter-count-badge');
  if (badge) {
    badge.textContent = active > 0 ? active : '';
    badge.style.display = active > 0 ? '' : 'none';
  }
  // Résultat count dans le bouton "Voir les annonces"
  const resultCount = document.getElementById('filter-result-count');
  if (resultCount) {
    const total = _allResultats.filter(_matchFilters).length;
    resultCount.textContent = total;
  }
}

async function _startScan(endpoint) {
  if (_scanRunning) return;
  try {
    const resp = await fetch(endpoint, { method: 'POST' });
    if (resp.status === 409) { alert('Un scan est déjà en cours.'); return; }
    if (!resp.ok) throw new Error(await resp.text());
    _scanRunning = true;
    _setButtonsDisabled(true);
    _showProgress(true);
    _setStatus('running', 'Scan en cours…');
    _startPolling();
  } catch (e) {
    alert('Erreur au démarrage du scan : ' + e.message);
  }
}

// ─── Polling ─────────────────────────────────────────────────────────────────

function _startPolling() {
  if (_pollInterval) return;
  _pollInterval = setInterval(_pollStatus, 2000);
}

function _stopPolling() {
  clearInterval(_pollInterval);
  _pollInterval = null;
}

async function _pollStatus() {
  try {
    const resp = await fetch(API.status);
    const data = await resp.json();
    _updateProgress(data);
    if (!data.running) {
      _scanRunning = false;
      _stopPolling();
      _setButtonsDisabled(false);
      if (data.error) {
        _setStatus('error', 'Erreur : ' + data.error);
      } else {
        _setStatus('done', 'Terminé · ' + _fmtDatetime(data.last_run));
        _showProgress(false);
        await _loadResults(true);
      }
    }
  } catch (e) {
    console.error('Poll error', e);
  }
}

// ─── Résultats ────────────────────────────────────────────────────────────────

async function _loadResults(showEmpty) {
  try {
    const resp = await fetch(API.results);
    if (!resp.ok) return;
    const data = await resp.json();
    if (!data || !data.resultats) {
      if (showEmpty) _showEmpty(true);
      return;
    }
    _renderStats(data.stats);
    _renderTable(data.resultats);
    _showEmpty(false);
    document.getElementById('scanner-stats').style.display = '';
    document.getElementById('scanner-results').style.display = '';
    document.getElementById('scanner-view-tabs')?.style.setProperty('display', 'flex');
    document.getElementById('scanner-search-bar')?.style.setProperty('display', '');
    document.getElementById('scanner-content-layout')?.style.setProperty('display', 'flex');
    if (data.stats?.last_run || data.generated_at) {
      _setStatus('done', 'Dernier scan · ' + _fmtDatetime(data.generated_at));
    }
    const headerSub = document.getElementById('scanner-header-sub');
    if (headerSub && data.generated_at) {
      headerSub.textContent = 'Centre-Val de Loire · Dernier scan : ' + _fmtDatetime(data.generated_at);
    }
  } catch (e) {
    if (showEmpty) _showEmpty(true);
  }
}

// ─── Rendu stats ─────────────────────────────────────────────────────────────

function _renderStats(stats) {
  if (!stats) return;
  const cfAiMax = stats.meilleur_cf_apres_impot;
  const cfAiSign = cfAiMax != null && cfAiMax >= 0 ? '+' : '';
  const cfSign = stats.meilleur_cf >= 0 ? '+' : '';

  document.getElementById('scanner-stats').innerHTML = `
    ${_statCard(stats.nouvelles, 'Analysées', '')}
    ${_statCard(stats.positifs, 'CF positif', 'pos')}
    ${_statCard(stats.pct_positifs?.toFixed(0) + '%', 'Taux positif', '')}
    ${_statCard(cfSign + stats.meilleur_cf?.toFixed(0) + ' €', 'Meilleur CF net', stats.meilleur_cf >= 0 ? 'pos' : 'neg')}
    ${cfAiMax != null ? _statCard(cfAiSign + cfAiMax.toFixed(0) + ' €', 'Meilleur CF après impôt', cfAiMax >= 0 ? 'pos' : 'neg') : ''}
    ${_statCard(_fmtPct(stats.meilleur_renta), 'Meilleur renta', 'gold')}
    ${stats.score_moyen != null ? _statCard(stats.score_moyen + '/100', 'Score moyen', 'gold') : ''}
    ${stats.dpe_risque ? _statCard(stats.dpe_risque, 'Alertes DPE', 'warn') : ''}
  `;
}

function _statCard(val, label, cls) {
  return `<div class="scanner-stat">
    <div class="scanner-stat-val ${cls}">${val}</div>
    <div class="scanner-stat-lbl">${label}</div>
  </div>`;
}

// ─── Rendu tableau ────────────────────────────────────────────────────────────

function _renderTable(resultats) {
  _allResultats = resultats;
  _initRangeFilters(resultats);
  _applyTable();
}

function _initRangeFilters(resultats) {
  if (!resultats.length) return;

  const prices = resultats.map(r => r.prix).filter(v => v != null);
  const surfaces = resultats.map(r => r.surface).filter(v => v != null);
  const cfs = resultats.map(r => r.cf_net).filter(v => v != null);

  const pMin = Math.floor(Math.min(...prices) / 1000) * 1000;
  const pMax = Math.ceil(Math.max(...prices) / 1000) * 1000;
  const sMin = Math.floor(Math.min(...surfaces) / 5) * 5;
  const sMax = Math.ceil(Math.max(...surfaces) / 5) * 5;
  const cfMin = Math.floor(Math.min(...cfs) / 50) * 50;
  const cfMax = Math.ceil(Math.max(...cfs) / 50) * 50;

  _setRange('range-prix-min', pMin, pMax, pMin);
  _setRange('range-prix-max', pMin, pMax, pMax);
  _setRange('range-surface-min', sMin, sMax, sMin);
  _setRange('range-surface-max', sMin, sMax, sMax);
  _setRange('range-cf', cfMin, cfMax, cfMin);

  _syncInputFromRange('range-prix-min', 'prix-min');
  _syncInputFromRange('range-prix-max', 'prix-max');
  _syncInputFromRange('range-surface-min', 'surface-min');
  _syncInputFromRange('range-surface-max', 'surface-max');
  _syncInputFromRange('range-cf', 'cf-min');
  _syncInputFromRange('range-renta', 'renta-min');
  _syncInputFromRange('range-dscr', 'dscr-min');
  _syncInputFromRange('range-score-min', 'score-min');

  _bindRange('range-prix-min', 'prix-min');
  _bindRange('range-prix-max', 'prix-max');
  _bindRange('range-surface-min', 'surface-min');
  _bindRange('range-surface-max', 'surface-max');
  _bindRange('range-cf', 'cf-min');
  _bindRange('range-renta', 'renta-min');
  _bindRange('range-dscr', 'dscr-min');
  _bindRange('range-score-min', 'score-min');
}

function _setRange(id, min, max, val) {
  const el = document.getElementById(id);
  if (!el) return;
  el.min = min;
  el.max = max;
  el.value = val;
}

function _syncInputFromRange(rangeId, inputId) {
  const range = document.getElementById(rangeId);
  const input = document.getElementById(inputId);
  if (!range || !input) return;
  input.value = range.value;
}

function _bindRange(rangeId, inputId) {
  const range = document.getElementById(rangeId);
  const input = document.getElementById(inputId);
  if (!range || !input) return;

  range.addEventListener('input', () => {
    input.value = range.value;
    _applyTable();
  });
  input.addEventListener('input', () => {
    range.value = input.value;
    _applyTable();
  });
}

function _matchFilters(r) {
  if (!_matchCP(r)) return false;
  // Chips — Score par bande
  const activeScores = [...document.querySelectorAll('input[name="score-filter"]:checked')].map(el => el.value);
  if (activeScores.length > 0) {
    const band = r.score >= 80 ? 'excellent' : r.score >= 60 ? 'bon' : r.score >= 40 ? 'neutre' : r.score >= 20 ? 'attention' : 'faible';
    if (!activeScores.includes(band)) return false;
  }

  // Chips — Cash-flow
  if (document.getElementById('filter-cf-positif')?.checked && (r.cf_net == null || r.cf_net < 0)) return false;
  if (document.getElementById('filter-cf-negatif')?.checked && (r.cf_net == null || r.cf_net >= 0)) return false;
  if (document.getElementById('filter-cfai-positif')?.checked && (r.cf_apres_impot == null || r.cf_apres_impot < 0)) return false;

  // Chips — DPE
  const activeDpe = [...document.querySelectorAll('input[name="dpe-filter"]:checked')].map(el => el.value);
  if (activeDpe.length > 0 && !(r.dpe && activeDpe.includes(r.dpe.toLowerCase()))) return false;
  if (document.getElementById('filter-dpe-safe')?.checked && ['e','f','g'].includes((r.dpe || '').toLowerCase())) return false;

  // Chips — Type de bien
  const activeTypes = [...document.querySelectorAll('input[name="type-filter"]:checked')].map(el => el.value);
  if (activeTypes.length > 0 && !(r.type_bien && activeTypes.some(t => r.type_bien.toLowerCase().includes(t)))) return false;

  // Chips — État
  if (document.getElementById('filter-deja-loue')?.checked && r.deja_loue !== true) return false;
  if (document.getElementById('filter-travaux')?.checked && !r.travaux) return false;
  if (document.getElementById('filter-sans-travaux')?.checked && r.travaux) return false;
  if (document.getElementById('filter-meuble')?.checked && r.meuble !== true) return false;

  // Chips — Source loyer
  if (document.getElementById('filter-loyer-marche')?.checked && r.loyer_source !== 'marche') return false;
  if (document.getElementById('filter-loyer-annonce')?.checked && r.loyer_source !== 'annonce') return false;

  // Chips — Nb de pièces
  const activePieces = [...document.querySelectorAll('input[name="pieces-filter"]:checked')].map(el => parseInt(el.value, 10));
  if (activePieces.length > 0) {
    const p = r.nb_pieces != null ? r.nb_pieces : null;
    const match = activePieces.some(v => v === 5 ? p != null && p >= 5 : p === v);
    if (!match) return false;
  }

  // Chips — Parking / Garage
  if (document.getElementById('filter-parking')?.checked && !r.parking_garage) return false;

  // Sliders numériques — Prix
  const prixMin = parseFloat(document.getElementById('prix-min')?.value);
  const prixMax = parseFloat(document.getElementById('prix-max')?.value);
  if (!isNaN(prixMin) && r.prix != null && r.prix < prixMin) return false;
  if (!isNaN(prixMax) && r.prix != null && r.prix > prixMax) return false;

  // Sliders numériques — Surface
  const surfaceMin = parseFloat(document.getElementById('surface-min')?.value);
  const surfaceMax = parseFloat(document.getElementById('surface-max')?.value);
  if (!isNaN(surfaceMin) && r.surface != null && r.surface < surfaceMin) return false;
  if (!isNaN(surfaceMax) && r.surface != null && r.surface > surfaceMax) return false;

  // Sliders numériques — Renta brute min
  const rentaMin = parseFloat(document.getElementById('renta-min')?.value);
  if (!isNaN(rentaMin) && rentaMin > 0 && (r.renta_brute == null || r.renta_brute < rentaMin)) return false;

  // Sliders numériques — CF net min
  const cfMin = parseFloat(document.getElementById('cf-min')?.value);
  if (!isNaN(cfMin) && (r.cf_net == null || r.cf_net < cfMin)) return false;

  // Sliders numériques — DSCR min
  const dscrMin = parseFloat(document.getElementById('dscr-min')?.value);
  if (!isNaN(dscrMin) && dscrMin > 0 && (r.dscr == null || r.dscr < dscrMin)) return false;

  // Sliders numériques — Score min
  const scoreMin = parseFloat(document.getElementById('score-min')?.value);
  if (!isNaN(scoreMin) && scoreMin > 0 && (r.score == null || r.score < scoreMin)) return false;

  return true;
}

function _applyTable() {
  const filtered = _allResultats.filter(_matchFilters);
  const sorted = [...filtered].sort((a, b) => {
    const av = _getVal(a, _sortKey);
    const bv = _getVal(b, _sortKey);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return (av - bv) * _sortDir;
  });

  _displayedResultats = _displayCount === 'all' ? sorted : sorted.slice(0, _displayCount);

  const total = filtered.length;
  const shown = _displayedResultats.length;
  const sortLabel = SORT_COLS.find(c => c.key === _sortKey)?.label ?? _sortKey;
  const dirArrow = _sortDir === -1 ? '↓' : '↑';

  // Options du select d'affichage
  const countPresets = [10, 20, 50, 100];
  const isCustom = _displayCount !== 'all' && !countPresets.includes(_displayCount);
  const countOptions = [
    ...countPresets.map(n => `<option value="${n}" ${_displayCount === n ? 'selected' : ''}>${n} biens</option>`),
    `<option value="all" ${_displayCount === 'all' ? 'selected' : ''}>Tout (${total})</option>`,
    `<option value="custom" ${isCustom ? 'selected' : ''}>Personnalisé…</option>`,
  ].join('');

  const customInput = (isCustom || false)
    ? `<input id="scanner-count-custom" type="number" min="1" max="${total}" value="${_displayCount}" style="width:60px;background:var(--surface-strong);border:1px solid var(--accent-gold);color:var(--text);border-radius:5px;padding:3px 6px;font-size:12px">`
    : `<input id="scanner-count-custom" type="number" min="1" max="${total}" value="${_displayCount}" style="width:60px;background:var(--surface-strong);border:1px solid var(--accent-gold);color:var(--text);border-radius:5px;padding:3px 6px;font-size:12px;display:none">`;

  // En-têtes triables
  const thSortable = (key, label) => {
    const active = key === _sortKey;
    const arrow = active ? (` ${dirArrow}`) : ' <span style="opacity:.35;font-size:10px">↕</span>';
    const style = active
      ? `color:var(--accent-gold);font-weight:600;border-bottom:2px solid var(--accent-gold);cursor:pointer;white-space:nowrap;padding:8px 10px;text-align:right`
      : `cursor:pointer;white-space:nowrap;padding:8px 10px;text-align:right;color:var(--muted);font-weight:500`;
    return `<th data-sort="${key}" style="${style}">${label}${arrow}</th>`;
  };

  const rows = _displayedResultats.map((r, i) => _renderRow(r, i + 1, i)).join('');

  const container = document.getElementById('scanner-results');
  container.innerHTML = `
    <div class="scanner-results-header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
      <span style="font-size:12px;color:var(--muted)">
        <span style="color:var(--text);font-weight:600">${shown}</span>${shown < total ? ` / ${total}` : ''} biens — triés par <span style="color:var(--accent-gold)">${sortLabel} ${dirArrow}</span>
      </span>
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:11px;color:var(--muted)">Afficher :</span>
        <select id="scanner-count-select" style="background:var(--surface-strong);border:1px solid var(--border);color:var(--text);border-radius:5px;padding:3px 8px;font-size:12px">${countOptions}</select>
        ${customInput}
      </div>
    </div>
    <table class="scanner-table">
      <thead>
        <tr>
          <th style="padding:8px 10px;text-align:center;color:var(--text-muted,#8b949e);font-weight:500">#</th>
          <th style="padding:8px 10px;text-align:left;color:var(--text-muted,#8b949e);font-weight:500">Bien</th>
          ${thSortable('prix', 'Prix')}
          ${thSortable('loyer_estime', 'Loyer')}
          ${thSortable('prix_m2', 'Prix/m²')}
          ${thSortable('mensualite', 'Mensualité')}
          ${thSortable('cf_net', 'CF net')}
          ${thSortable('cf_apres_impot', 'CF après impôt')}
          ${thSortable('dscr', 'DSCR')}
          ${thSortable('renta_brute', 'Renta brute')}
          ${thSortable('score', 'Score')}
          <th style="padding:8px 10px;color:var(--text-muted,#8b949e);font-weight:500">Lien</th>
          <th></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  // Tri par clic sur en-tête
  container.querySelectorAll('th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (_sortKey === key) {
        _sortDir *= -1;
      } else {
        _sortKey = key;
        _sortDir = -1;
      }
      _applyTable();
    });
  });

  // Clic ligne → drawer détail
  container.querySelectorAll('tbody tr').forEach(tr => {
    tr.addEventListener('click', e => {
      if (e.target.closest('button, a')) return;
      const idx = parseInt(tr.dataset.rank, 10);
      if (!isNaN(idx)) _openDrawer(_displayedResultats[idx]);
    });
  });

  // Sélecteur d'affichage
  document.getElementById('scanner-count-select')?.addEventListener('change', e => {
    const v = e.target.value;
    if (v === 'all') {
      _displayCount = 'all';
      document.getElementById('scanner-count-custom').style.display = 'none';
    } else if (v === 'custom') {
      document.getElementById('scanner-count-custom').style.display = '';
      document.getElementById('scanner-count-custom').focus();
    } else {
      _displayCount = parseInt(v, 10);
      document.getElementById('scanner-count-custom').style.display = 'none';
      _applyTable();
    }
  });

  document.getElementById('scanner-count-custom')?.addEventListener('change', e => {
    const n = parseInt(e.target.value, 10);
    if (n > 0) { _displayCount = n; _applyTable(); }
  });
}

function _analyserBien(r) {
  const nomBien = document.getElementById('nom-bien')?.value || '';
  _showAnalyserModal(nomBien, {
    onSave: () => {
      if (_saveCurrentStudy) _saveCurrentStudy();
      _chargerBienDansFormulaire(r);
    },
    onIgnore: () => _chargerBienDansFormulaire(r),
  });
}

function _chargerBienDansFormulaire(r) {
  const VALID_DPE = new Set(['a','b','c','d','e','f','g']);
  const fields = {
    'nom-bien': r.titre || '',
    'ville':    r.ville || '',
    'prix':     r.prix != null ? String(Math.round(r.prix)) : '',
    'loyer':    r.loyer_estime != null ? String(Math.round(r.loyer_estime)) : '',
    'travaux':  r.travaux_montant != null ? String(Math.round(r.travaux_montant)) : '0',
    'dpe':      VALID_DPE.has((r.dpe || '').toLowerCase()) ? r.dpe.toLowerCase() : 'nr',
  };

  const highlighted = [];
  for (const [id, val] of Object.entries(fields)) {
    const el = document.getElementById(id);
    if (el) {
      el.value = val;
      highlighted.push(el);
    }
  }

  const tabBtn = document.querySelector('[data-target="workspace-panel"]');
  if (tabBtn) tabBtn.click();

  const form = document.getElementById('variables-form');
  if (form) form.dispatchEvent(new Event('input', { bubbles: true }));

  highlighted.forEach(el => {
    el.classList.add('field--scanner-highlight');
    setTimeout(() => el.classList.remove('field--scanner-highlight'), 1800);
  });
}

function _showAnalyserModal(nomBien, { onSave, onIgnore }) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center';

  const sousTitre = nomBien ? `<p style="color:var(--text-muted,#888);font-size:13px;margin:4px 0 0">${_esc(nomBien)}</p>` : '';

  overlay.innerHTML = `
    <div style="background:var(--surface,#161B22);border-radius:12px;padding:28px 32px;max-width:420px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,0.4)">
      <p style="font-size:16px;font-weight:600;margin:0">Sauvegarder l'étude en cours ?</p>
      ${sousTitre}
      <div style="display:flex;gap:10px;margin-top:24px;flex-wrap:wrap">
        <button id="_modal-save" style="flex:1;padding:10px 16px;border-radius:8px;border:none;background:#C5A059;color:#111;font-weight:600;cursor:pointer;font-size:13px">Sauvegarder</button>
        <button id="_modal-ignore" style="flex:1;padding:10px 16px;border-radius:8px;border:1px solid #555;background:transparent;color:var(--text,#ccc);cursor:pointer;font-size:13px">Ignorer</button>
        <button id="_modal-cancel" style="width:100%;padding:8px;border:none;background:transparent;color:#888;cursor:pointer;font-size:12px;text-decoration:underline">Annuler</button>
      </div>
    </div>
  `;

  const close = () => overlay.remove();

  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelector('#_modal-cancel').addEventListener('click', close);
  overlay.querySelector('#_modal-save').addEventListener('click', () => { close(); onSave(); });
  overlay.querySelector('#_modal-ignore').addEventListener('click', () => { close(); onIgnore(); });

  document.body.appendChild(overlay);
}

function _renderRow(r, rank, idx) {
  const cfCls = r.cf_net >= 0 ? 'pos' : 'neg';
  const cfSign = r.cf_net >= 0 ? '+' : '';
  const cfAi = r.cf_apres_impot;
  const cfAiCls = cfAi != null && cfAi >= 0 ? 'pos' : 'neg';
  const cfAiSign = cfAi != null && cfAi >= 0 ? '+' : '';

  const dscr = r.dscr;
  const dscrColor = dscr >= 1.2 ? '#4ade80' : dscr >= 1.0 ? '#f59e0b' : '#f87171';

  const badges = [];
  if (r.dpe_alerte) {
    const dpeColors = { g: '#dc2626', f: '#e3720c', e: '#f59e0b' };
    badges.push(_badge(r.dpe_alerte[0], dpeColors[r.dpe] || '#888', '2px solid ' + (dpeColors[r.dpe] || '#888') + '44'));
  } else if (r.dpe) {
    const dpeColors = { a:'#00a550',b:'#51b845',c:'#c8d200',d:'#ffcc00',e:'#f4a623',f:'#e3720c',g:'#cc0000' };
    badges.push(_badge('DPE ' + r.dpe.toUpperCase(), dpeColors[r.dpe] || '#888'));
  }
  if (r.immeuble_rapport && r.lots_total) {
    badges.push(_badge(`Immeuble ${r.lots_loues ?? '?'}/${r.lots_total} loués`, '#0369a1'));
  } else if (r.deja_loue === true) {
    badges.push(_badge('Déjà loué ✓', '#16a34a'));
  } else if (r.deja_loue === false) {
    badges.push(_badge('Libre', '#64748b'));
  }
  if (r.travaux) {
    const label = r.travaux_montant ? `Travaux ~${_fmtEur(r.travaux_montant)}` : 'Travaux';
    badges.push(_badge(label, '#7c3aed'));
  }
  if (r.meuble === true) badges.push(_badge('Meublé', '#6d28d9'));
  if (r.parking_garage) badges.push(_badge('Parking ✓', '#0369a1'));
  if (r.chauffage === 'electrique') badges.push(_badge('Chauf. élec.', '#d97706'));

  const scoreColor = r.score >= 80 ? '#16a34a' : r.score >= 60 ? '#22c55e' : r.score >= 40 ? '#f59e0b' : r.score >= 20 ? '#e3720c' : '#dc2626';
  const scoreTone = r.score >= 80 ? 'excellent' : r.score >= 60 ? 'positif' : r.score >= 40 ? 'neutre' : r.score >= 20 ? 'watch' : 'négatif';

  const loyerNote = r.loyer_source === 'annonce'
    ? `<br><span style="color:#22d3ee;font-size:10px">annonce</span>`
    : r.loyer_source === 'marche'
    ? `<br><span style="color:#4ade80;font-size:10px">marché</span>`
    : `<br><span style="color:#f59e0b;font-size:10px">estimé</span>`;

  const surfaceLabel = r.surface
    ? `${r.surface.toFixed(0)} m²${r.surface_source === 'ia' ? '<sup style="color:#C5A059;font-size:9px"> IA</sup>' : ''}`
    : '—';

  const prixM2 = r.surface ? r.prix / r.surface : null;

  return `<tr style="cursor:pointer" data-rank="${idx}">
    <td style="color:#555;font-size:11px;text-align:center">${rank}</td>
    <td>
      <div style="font-weight:600;font-size:13px;color:var(--text)">${_esc(r.titre)}</div>
      <div style="font-size:11px;color:var(--muted);margin-top:2px">${_esc(r.ville)} · ${surfaceLabel}${r.nb_pieces ? ` · T${r.nb_pieces}` : ''} · ${_esc((r.type_bien || '').charAt(0).toUpperCase() + (r.type_bien || '').slice(1))}</div>
      <div style="margin-top:4px">${badges.join('')}</div>
      ${r.resume_ia ? `<div style="font-size:11px;color:var(--muted);font-style:italic;margin-top:3px">${_esc(r.resume_ia)}</div>` : ''}
    </td>
    <td style="white-space:nowrap;text-align:right">${_fmtEur(r.prix)}</td>
    <td style="white-space:nowrap;text-align:right">${_fmtEur(r.loyer_estime)}${loyerNote}</td>
    <td style="white-space:nowrap;text-align:right">${prixM2 != null ? Math.round(prixM2).toLocaleString('fr-FR') + ' €' : '—'}</td>
    <td style="white-space:nowrap;text-align:right">${_fmtEur(r.mensualite)}</td>
    <td style="white-space:nowrap;text-align:right;font-weight:700;color:${r.cf_net >= 0 ? '#4ade80' : '#f87171'}">${cfSign}${_fmtEur(r.cf_net)}</td>
    <td style="white-space:nowrap;text-align:right;font-weight:700;color:${cfAi != null && cfAi >= 0 ? '#4ade80' : '#f87171'}">${cfAi != null ? cfAiSign + _fmtEur(cfAi) : '—'}</td>
    <td style="text-align:center;font-weight:700;color:${dscrColor}">${dscr != null ? dscr.toFixed(2) : '—'}</td>
    <td style="white-space:nowrap;text-align:right">${r.renta_brute != null ? r.renta_brute.toFixed(1) + ' %' : '—'}</td>
    <td>${r.score != null ? `<span class="scanner-score-badge" style="background:${scoreColor}">${r.score}/100 ${scoreTone}</span>` : '—'}</td>
    <td><a href="${_esc(r.url)}" target="_blank" style="color:#C5A059;text-decoration:none;font-size:11px">Voir ↗</a></td>
    <td><button class="scanner-analyser-btn" data-rank="${idx}" style="cursor:pointer;padding:4px 10px;border-radius:6px;border:1px solid #C5A059;background:transparent;color:#C5A059;font-size:11px;white-space:nowrap">→ Analyser</button></td>
  </tr>`;
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

function _updateProgress(data) {
  const pct = data.progress ?? 0;
  const logs = data.logs ?? [];
  const lastLog = logs[logs.length - 1] ?? '…';
  const fill = document.getElementById('scanner-progress-fill');
  const logEl = document.getElementById('scanner-log-line');
  const pctEl = document.getElementById('scanner-pct');
  if (fill) fill.style.width = pct + '%';
  if (logEl) logEl.textContent = lastLog;
  if (pctEl) pctEl.textContent = pct + '%';
}

function _showProgress(visible) {
  const el = document.getElementById('scanner-progress');
  if (el) el.style.display = visible ? '' : 'none';
}

function _showEmpty(visible) {
  const el = document.getElementById('scanner-empty');
  if (el) el.style.display = visible ? '' : 'none';
  if (!visible) {
    document.getElementById('scanner-stats')?.style.setProperty('display', '');
    document.getElementById('scanner-results')?.style.setProperty('display', '');
    document.getElementById('scanner-cp-wrapper')?.style.setProperty('display', '');
  }
}

function _setStatus(state, label) {
  const chip = document.getElementById('scanner-status-chip');
  const lbl = document.getElementById('scanner-status-label');
  if (!chip || !lbl) return;
  chip.className = 'scanner-status-chip scanner-status--' + state;
  lbl.textContent = label;
}

function _setButtonsDisabled(disabled) {
  ['btn-scan', 'btn-scan-full', 'btn-clear-cache'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = disabled;
  });
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function _fmtEur(val) {
  if (val == null) return '—';
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(val) + ' €';
}

function _fmtPct(val) {
  if (val == null) return '—';
  return val.toFixed(1) + ' %';
}

function _fmtDatetime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

function _badge(label, bg, border = 'none') {
  return `<span class="scanner-badge" style="background:${bg}22;color:${bg};border:1px solid ${bg}44">${_esc(label)}</span>`;
}

function _esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Panneau de détail (drawer) ───────────────────────────────────────────────

function _openDrawer(r) {
  const overlay = document.getElementById('detail-overlay');
  const drawer  = document.getElementById('detail-drawer');
  const content = document.getElementById('detail-content');
  if (!drawer || !content) return;

  content.innerHTML = _renderDetailContent(r);
  overlay.style.display = 'block';
  drawer.style.display  = 'block';
  requestAnimationFrame(() => drawer.style.transform = 'translateX(0)');

  overlay.onclick = _closeDrawer;
  content.querySelector('#detail-close')?.addEventListener('click', _closeDrawer);
  content.querySelector('#detail-analyser-btn')?.addEventListener('click', () => {
    _closeDrawer();
    _analyserBien(r);
  });

  // Charger l'historique des prix
  _loadPriceHistory(r.url, content.querySelector('#detail-historique'));
}

function _closeDrawer() {
  const overlay = document.getElementById('detail-overlay');
  const drawer  = document.getElementById('detail-drawer');
  if (overlay) overlay.style.display = 'none';
  if (drawer)  drawer.style.display  = 'none';
}

function _renderDetailContent(r) {
  const dpe = (r.dpe || '').toLowerCase();
  const dpeColors = { a:'#00a550',b:'#51b845',c:'#c8d200',d:'#ffcc00',e:'#f4a623',f:'#e3720c',g:'#cc0000' };
  const dpeColor  = dpeColors[dpe] || 'var(--muted)';
  const dpeAlerte = r.dpe_alerte ? `<span style="background:${dpeColor}22;color:${dpeColor};border:1px solid ${dpeColor}44;padding:3px 8px;border-radius:6px;font-size:12px;font-weight:600">${_esc(r.dpe_alerte[0])}</span>` : '';

  const loyerSourceLabel = r.loyer_source === 'annonce' ? 'loyer de l\'annonce'
    : r.loyer_source === 'marche' ? `loyer médian marché${r.loyer_marche_ref ? ` (${r.loyer_marche_ref} annonces ref.)` : ''}`
    : 'loyer estimé (taux fixe)';
  const loyerSourceColor = r.loyer_source === 'annonce' ? '#22d3ee' : r.loyer_source === 'marche' ? '#4ade80' : '#f59e0b';

  const prixM2 = r.surface ? Math.round(r.prix / r.surface) : null;

  // 3 régimes fiscaux
  // cf_apres_impot = le meilleur régime; cf_apres_impot_reel et cf_apres_impot_sci sont les valeurs individuelles
  // Pour micro: on déduit depuis regime_optimal
  const cfMicroVal = r.cf_apres_impot_micro ?? (r.regime_optimal === 'micro' ? r.cf_apres_impot : null);
  const regimes = [
    { id: 'micro',  label: 'Micro-foncier', cf: cfMicroVal,           note: 'Abattement 30 %' },
    { id: 'reel',   label: 'Réel foncier',  cf: r.cf_apres_impot_reel, note: 'Déduction charges réelles' },
    { id: 'sci_is', label: 'SCI à l\'IS',   cf: r.cf_apres_impot_sci,  note: 'IS 15 % + amortissement' },
  ];
  const regimeHtml = regimes.map(reg => {
    const isOptimal = r.regime_optimal === reg.id;
    const cf = reg.cf;
    const cfStr = cf != null ? `${cf >= 0 ? '+' : ''}${_fmtEur(cf)}` : '—';
    const cfColor = cf != null && cf >= 0 ? '#4ade80' : '#f87171';
    return `
      <div style="flex:1;padding:12px;border-radius:8px;border:${isOptimal ? '2px solid var(--accent-gold,#C5A059)' : '1px solid var(--border)'};background:${isOptimal ? 'var(--accent-gold,#C5A059)11' : 'var(--surface-strong)'}">
        <div style="font-size:11px;color:var(--muted);margin-bottom:4px">${_esc(reg.label)}</div>
        <div style="font-size:16px;font-weight:700;color:${cfColor}">${cfStr}<span style="font-size:11px;font-weight:400;color:var(--muted)">/mois</span></div>
        <div style="font-size:10px;color:var(--muted);margin-top:4px">${_esc(reg.note)}</div>
        ${isOptimal ? '<div style="margin-top:6px;font-size:10px;font-weight:700;color:var(--accent-gold,#C5A059)">★ MEILLEUR RÉGIME</div>' : ''}
      </div>`;
  }).join('');

  // Points forts / faibles
  const ptsForts   = (r.points_forts  || []);
  const ptsFaibles = (r.points_faibles || []);
  const ptsFortHtml  = ptsForts.length  ? ptsForts.map(p  => `<li style="color:#4ade80">+ ${_esc(p)}</li>`).join('')  : '<li style="color:var(--muted)">—</li>';
  const ptsFaibleHtml= ptsFaibles.length? ptsFaibles.map(p => `<li style="color:#f87171">- ${_esc(p)}</li>`).join(''): '<li style="color:var(--muted)">—</li>';

  return `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:16px">
      <div style="flex:1">
        <h2 style="font-size:15px;font-weight:700;margin:0 0 4px">${_esc(r.titre)}</h2>
        <div style="font-size:12px;color:var(--muted)">${_esc(r.ville)} · ${r.surface ? r.surface.toFixed(0) + ' m²' : '—'}${r.nb_pieces ? ' · T' + r.nb_pieces : ''} · ${_esc((r.type_bien || '').charAt(0).toUpperCase() + (r.type_bien || '').slice(1))} · <span style="color:var(--muted)">${_esc(r.site)}</span></div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        ${dpeAlerte}
        <button id="detail-close" style="background:none;border:none;color:var(--muted);font-size:20px;cursor:pointer;padding:0 4px">×</button>
      </div>
    </div>

    <!-- Métriques clés -->
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px">
      ${_detailCard(_fmtEur(r.prix), 'Prix')}
      ${_detailCard(_fmtEur(r.loyer_estime) + '/mois', 'Loyer', loyerSourceLabel, loyerSourceColor)}
      ${_detailCard(_fmtEur(r.mensualite) + '/mois', 'Mensualité crédit')}
      ${_detailCard(r.renta_brute != null ? r.renta_brute.toFixed(1) + ' %' : '—', 'Renta brute')}
      ${_detailCard(r.dscr != null ? r.dscr.toFixed(2) : '—', 'DSCR')}
      ${_detailCard(prixM2 != null ? prixM2.toLocaleString('fr-FR') + ' €/m²' : '—', 'Prix/m²')}
    </div>

    <!-- 3 régimes -->
    <div style="margin-bottom:16px">
      <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Comparaison régimes fiscaux</div>
      <div style="display:flex;gap:8px">${regimeHtml}</div>
    </div>

    <!-- Infos IA -->
    <div style="margin-bottom:16px">
      <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Informations IA</div>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px;font-size:12px">
        ${_detailInfo('Travaux', r.travaux ? (r.travaux_montant ? '~' + _fmtEur(r.travaux_montant) : 'Oui') : 'Non')}
        ${_detailInfo('Chauffage', r.chauffage || '—')}
        ${_detailInfo('Meublé', r.meuble === true ? 'Oui' : r.meuble === false ? 'Non' : '—')}
        ${_detailInfo('Parking', r.parking_garage ? 'Oui' : 'Non')}
        ${r.immeuble_rapport && r.lots_total ? _detailInfo('Lots', `${r.lots_loues ?? '?'}/${r.lots_total} loués`) : ''}
        ${_detailInfo('Déjà loué', r.deja_loue === true ? 'Oui' : r.deja_loue === false ? 'Non' : '—')}
      </div>
      ${r.resume_ia ? `<div style="margin-top:8px;font-size:12px;color:var(--muted);font-style:italic;padding:8px;background:var(--surface-strong);border-radius:6px">"${_esc(r.resume_ia)}"</div>` : ''}
    </div>

    <!-- Points forts / faibles -->
    ${ptsForts.length || ptsFaibles.length ? `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
      <div>
        <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;margin-bottom:6px">Points forts</div>
        <ul style="margin:0;padding:0 0 0 14px;font-size:12px;line-height:1.7">${ptsFortHtml}</ul>
      </div>
      <div>
        <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;margin-bottom:6px">Points faibles</div>
        <ul style="margin:0;padding:0 0 0 14px;font-size:12px;line-height:1.7">${ptsFaibleHtml}</ul>
      </div>
    </div>` : ''}

    <!-- Historique des prix (chargé async) -->
    <div style="margin-bottom:16px">
      <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Historique des prix</div>
      <div id="detail-historique" style="font-size:12px;color:var(--muted)">Chargement…</div>
    </div>

    <!-- Actions -->
    <div style="display:flex;gap:10px;margin-top:8px">
      <button id="detail-analyser-btn" style="flex:1;padding:10px 16px;border-radius:8px;border:none;background:var(--accent-gold,#C5A059);color:#111;font-weight:600;cursor:pointer;font-size:13px">→ Analyser</button>
      <a href="${_esc(r.url)}" target="_blank" style="flex:1;padding:10px 16px;border-radius:8px;border:1px solid var(--border);color:var(--text);text-decoration:none;font-size:13px;text-align:center">Voir l'annonce ↗</a>
    </div>`;
}

function _detailCard(val, label, note = '', noteColor = 'var(--muted)') {
  return `<div style="background:var(--surface-strong);border-radius:8px;padding:10px;text-align:center">
    <div style="font-size:14px;font-weight:700">${val}</div>
    <div style="font-size:10px;color:var(--muted);margin-top:2px">${_esc(label)}</div>
    ${note ? `<div style="font-size:10px;color:${noteColor};margin-top:2px">${_esc(note)}</div>` : ''}
  </div>`;
}

function _detailInfo(label, val) {
  return `<div style="display:flex;justify-content:space-between;padding:4px 8px;background:var(--surface-strong);border-radius:6px">
    <span style="color:var(--muted)">${_esc(label)}</span>
    <span style="font-weight:600">${_esc(String(val))}</span>
  </div>`;
}

// ─── Carte Leaflet ────────────────────────────────────────────────────────────

let _leafletMap = null;
let _leafletMarkers = null;

function _initMap() {
  if (_leafletMap) return;
  if (typeof L === 'undefined') return;

  _leafletMap = L.map('scanner-map', {
    center: [47.5, 1.5],  // Centre-Val de Loire
    zoom: 8,
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 18,
  }).addTo(_leafletMap);

  _leafletMarkers = L.layerGroup().addTo(_leafletMap);

  _leafletMap.once('tileerror', () => {
    document.getElementById('scanner-map-offline').style.display = '';
  });
}

async function _renderMap(resultats) {
  if (typeof L === 'undefined') return;
  _initMap();
  _leafletMarkers.clearLayers();

  // Collecter les villes/CP uniques à géocoder
  const toGeocode = [];
  const seen = new Set();
  for (const r of resultats) {
    const key = `${r.ville}|${r.code_postal}`;
    if (!seen.has(key) && r.ville) {
      seen.add(key);
      toGeocode.push({ ville: r.ville, code_postal: r.code_postal });
    }
  }

  let geoData = {};
  try {
    const resp = await fetch('/api/geocode/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toGeocode),
    });
    geoData = await resp.json();
  } catch (e) {
    console.warn('Géocodage échoué', e);
  }

  let nonLocalises = 0;
  const bounds = [];

  for (const r of resultats) {
    const key   = `${r.ville}|${r.code_postal}`;
    const coord = geoData[key];
    if (!coord || !coord.lat) { nonLocalises++; continue; }

    const color = r.score >= 80 ? '#16a34a'
                : r.score >= 60 ? '#22c55e'
                : r.score >= 40 ? '#f59e0b'
                : r.score >= 20 ? '#e3720c'
                : '#dc2626';

    const marker = L.circleMarker([coord.lat, coord.lng], {
      radius: 9,
      fillColor: color,
      fillOpacity: 0.85,
      color: '#fff',
      weight: 1.5,
    });

    const cfStr = r.cf_apres_impot != null
      ? `${r.cf_apres_impot >= 0 ? '+' : ''}${Math.round(r.cf_apres_impot)} €/mois`
      : '—';

    marker.bindPopup(`
      <div style="min-width:180px;font-family:sans-serif">
        <div style="font-weight:700;font-size:13px;margin-bottom:4px">${_esc(r.titre)}</div>
        <div style="font-size:11px;color:#666">${_esc(r.ville)} · ${r.surface ? r.surface.toFixed(0) + ' m²' : '—'}</div>
        <div style="margin:6px 0;font-size:13px"><strong>${r.prix ? r.prix.toLocaleString('fr-FR') + ' €' : '—'}</strong></div>
        <div style="font-size:12px">CF : <strong style="color:${r.cf_apres_impot >= 0 ? 'green' : 'red'}">${cfStr}</strong></div>
        <div style="font-size:12px">Score : <strong>${r.score ?? '—'}/100</strong></div>
        <button onclick="window._openDrawerFromMap('${_esc(r.url)}')"
          style="margin-top:8px;width:100%;padding:5px;border-radius:5px;border:1px solid #C5A059;background:transparent;color:#C5A059;cursor:pointer;font-size:12px">
          Voir le détail →
        </button>
      </div>
    `);

    marker.addTo(_leafletMarkers);
    bounds.push([coord.lat, coord.lng]);
  }

  if (bounds.length > 1) _leafletMap.fitBounds(bounds, { padding: [30, 30] });

  const unloc = document.getElementById('scanner-map-unloc');
  if (unloc) unloc.textContent = nonLocalises > 0
    ? `${nonLocalises} bien${nonLocalises > 1 ? 's' : ''} non localisé${nonLocalises > 1 ? 's' : ''} (ville inconnue).`
    : '';
}

// Accessible depuis le popup Leaflet (contexte global)
window._openDrawerFromMap = function(url) {
  const r = _displayedResultats.find(x => x.url === url)
         || _allResultats.find(x => x.url === url);
  if (r) _openDrawer(r);
};

async function _loadPriceHistory(url, container) {
  if (!container) return;
  try {
    const resp = await fetch('/api/bien/historique?url=' + encodeURIComponent(url));
    const data = await resp.json();
    if (!data.length) {
      container.textContent = 'Aucune variation de prix enregistrée.';
      return;
    }
    container.innerHTML = data.map((h, i) => {
      const diff = h.prix_nouveau - h.prix_ancien;
      const diffStr = diff < 0
        ? `<span style="color:#4ade80">${diff.toLocaleString('fr-FR')} €</span>`
        : `<span style="color:#f87171">+${diff.toLocaleString('fr-FR')} €</span>`;
      const isLast = i === data.length - 1;
      return `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:${isLast ? 'none' : '1px solid var(--border)'}">
        <span style="color:var(--muted)">${new Date(h.date_changement).toLocaleDateString('fr-FR')}</span>
        <span>${h.prix_nouveau.toLocaleString('fr-FR')} € ${diffStr}</span>
      </div>`;
    }).join('');
  } catch (e) {
    container.textContent = 'Erreur chargement historique.';
  }
}
