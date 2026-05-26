// Constantes config (récupérées depuis /api/status au démarrage)
const API = {
  scan: '/api/scan',
  scanFull: '/api/scan/full',
  status: '/api/status',
  results: '/api/results',
};

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
}

function _updateFilterCount() {
  let active = document.querySelectorAll('#scanner-filters input[type="checkbox"]:checked').length;
  // Compte les filtres numériques non nuls
  const numericIds = ['prix-min','prix-max','surface-min','surface-max','renta-min','cf-min','dscr-min','score-min'];
  for (const id of numericIds) {
    const el = document.getElementById(id);
    if (el && el.value !== '' && parseFloat(el.value) !== 0) active++;
  }
  const el = document.getElementById('scanner-filter-count');
  if (el) el.textContent = active > 0 ? `${active} filtre${active > 1 ? 's' : ''} actif${active > 1 ? 's' : ''}` : '';
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
    document.getElementById('scanner-filters').style.display = '';
    document.getElementById('scanner-results').style.display = '';
    if (data.stats?.last_run || data.generated_at) {
      _setStatus('done', 'Dernier scan · ' + _fmtDatetime(data.generated_at));
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
    ? `<input id="scanner-count-custom" type="number" min="1" max="${total}" value="${_displayCount}" style="width:60px;background:var(--input-bg,#161b22);border:1px solid #C5A059;color:var(--text,#e6edf3);border-radius:5px;padding:3px 6px;font-size:12px">`
    : `<input id="scanner-count-custom" type="number" min="1" max="${total}" value="${_displayCount}" style="width:60px;background:var(--input-bg,#161b22);border:1px solid #C5A059;color:var(--text,#e6edf3);border-radius:5px;padding:3px 6px;font-size:12px;display:none">`;

  // En-têtes triables
  const thSortable = (key, label) => {
    const active = key === _sortKey;
    const arrow = active ? (` ${dirArrow}`) : ' <span style="opacity:.35;font-size:10px">↕</span>';
    const style = active
      ? `color:#C5A059;font-weight:600;border-bottom:2px solid #C5A059;cursor:pointer;white-space:nowrap;padding:8px 10px;text-align:right`
      : `cursor:pointer;white-space:nowrap;padding:8px 10px;text-align:right;color:var(--text-muted,#8b949e);font-weight:500`;
    return `<th data-sort="${key}" style="${style}">${label}${arrow}</th>`;
  };

  const rows = _displayedResultats.map((r, i) => _renderRow(r, i + 1, i)).join('');

  const container = document.getElementById('scanner-results');
  container.innerHTML = `
    <div class="scanner-results-header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
      <span style="font-size:12px;color:var(--text-muted,#8b949e)">
        <span style="color:var(--text,#e6edf3);font-weight:600">${shown}</span>${shown < total ? ` / ${total}` : ''} biens — triés par <span style="color:#C5A059">${sortLabel} ${dirArrow}</span>
      </span>
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:11px;color:var(--text-muted,#8b949e)">Afficher :</span>
        <select id="scanner-count-select" style="background:var(--input-bg,#161b22);border:1px solid var(--border,#30363d);color:var(--text,#e6edf3);border-radius:5px;padding:3px 8px;font-size:12px">${countOptions}</select>
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

  return `<tr>
    <td style="color:#555;font-size:11px;text-align:center">${rank}</td>
    <td>
      <div style="font-weight:600;font-size:13px;color:#e0ddd6">${_esc(r.titre)}</div>
      <div style="font-size:11px;color:#555;margin-top:2px">${_esc(r.ville)} · ${surfaceLabel}${r.nb_pieces ? ` · T${r.nb_pieces}` : ''} · ${_esc((r.type_bien || '').charAt(0).toUpperCase() + (r.type_bien || '').slice(1))}</div>
      <div style="margin-top:4px">${badges.join('')}</div>
      ${r.resume_ia ? `<div style="font-size:11px;color:#666;font-style:italic;margin-top:3px">${_esc(r.resume_ia)}</div>` : ''}
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
