// Constantes config (récupérées depuis /api/status au démarrage)
const API = {
  scan: '/api/scan',
  scanFull: '/api/scan/full',
  enrich: '/api/enrich',
  pendingCount: '/api/pending_count',
  status: '/api/status',
  results: '/api/results',
  bienDetail: bienId => `/api/bien/${encodeURIComponent(bienId)}`,
};
const RESULTS_PAGE_SIZE = 250;
const SCANNER_MISSING_THRESHOLD_STORAGE_KEY = 'investissementWebScannerMissingThreshold';
const DEFAULT_MISSING_SCAN_THRESHOLD = 3;

function _loadMissingScanThreshold() {
  try {
    const raw = localStorage.getItem(SCANNER_MISSING_THRESHOLD_STORAGE_KEY);
    const parsed = Number.parseInt(raw || '', 10);
    if (Number.isNaN(parsed) || parsed < 0) {
      return DEFAULT_MISSING_SCAN_THRESHOLD;
    }
    return parsed;
  } catch {
    return DEFAULT_MISSING_SCAN_THRESHOLD;
  }
}

function _getMissingScanThreshold() {
  return Number.isInteger(_missingScanThreshold) ? _missingScanThreshold : DEFAULT_MISSING_SCAN_THRESHOLD;
}

function _saveMissingScanThreshold(nextThreshold) {
  _missingScanThreshold = Number.isInteger(nextThreshold) && nextThreshold >= 0
    ? nextThreshold
    : DEFAULT_MISSING_SCAN_THRESHOLD;
  try {
    localStorage.setItem(SCANNER_MISSING_THRESHOLD_STORAGE_KEY, String(_missingScanThreshold));
  } catch {}
}

function _buildScannerApiUrl(path) {
  const url = new URL(path, window.location.origin);
  url.searchParams.set('missing_scan_threshold', String(_getMissingScanThreshold()));
  return url;
}

function _syncMissingScanThresholdControl() {
  const select = document.getElementById('scanner-missing-threshold');
  if (select) {
    select.value = String(_getMissingScanThreshold());
  }
}

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

  function _biensCounts() {
    const counts = {};
    for (const r of _allResultats) {
      if (r.code_postal) counts[r.code_postal] = (counts[r.code_postal] || 0) + 1;
    }
    return counts;
  }

  // Construit la liste des villes présentes dans les résultats courants
  function _villesFromResults() {
    const counts = _biensCounts();
    const seen = new Set();
    const out = [];
    for (const r of _allResultats) {
      const key = `${r.code_postal}|${(r.ville||'').toLowerCase()}`;
      if (!seen.has(key) && r.code_postal && r.ville) {
        seen.add(key);
        out.push({ cp: r.code_postal, commune: r.ville, n: counts[r.code_postal] || 0 });
      }
    }
    return out.sort((a, b) => b.n - a.n || a.commune.localeCompare(b.commune, 'fr'));
  }

  // Construit la liste à partir du fichier communes (recherche libre)
  function _villesFromSearch(val) {
    if (!_communesData) return [];
    const counts = _biensCounts();
    const matches = [];
    const valLow = val.toLowerCase();
    for (const [cp, communes] of Object.entries(_communesData)) {
      if (cp.startsWith(val)) {
        for (const commune of communes) matches.push({ cp, commune, n: counts[cp] || 0 });
      } else {
        for (const commune of communes) {
          if (commune.toLowerCase().includes(valLow)) matches.push({ cp, commune, n: counts[cp] || 0 });
        }
      }
    }
    return matches;
  }

  function _renderCPDropdown(items, groupLabel) {
    if (!items.length) { dropdown.style.display = 'none'; return; }
    let html = '';
    if (groupLabel) {
      html += `<div style="padding:6px 14px 4px;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em">${groupLabel}</div>`;
    }
    const uniqueCPs = [...new Set(items.map(m => m.cp))];
    if (uniqueCPs.length > 1 && !groupLabel) {
      const total = items.reduce((s, m) => s + m.n, 0);
      html += `<div class="cp-option cp-option-all" data-cp="${items[0].cp.slice(0,2)}" data-commune="__all__"
        style="padding:9px 14px;cursor:pointer;border-bottom:1px solid var(--border);font-weight:600;color:var(--accent-gold,#C5A059)">
        Toutes <span style="color:var(--muted);font-weight:400">(${total} biens)</span></div>`;
    }
    for (const { cp, commune, n } of items.slice(0, 50)) {
      html += `<div class="cp-option" data-cp="${cp}" data-commune="${_esc(commune)}"
        style="padding:8px 14px;cursor:pointer;font-size:13px">
        <span style="color:var(--muted);font-size:11px;margin-right:6px">${cp}</span>${_esc(commune)}
        <span style="color:var(--muted);font-size:11px;float:right">${n} bien${n !== 1 ? 's' : ''}</span>
      </div>`;
    }
    dropdown.innerHTML = html;
    dropdown.style.display = 'block';
    dropdown.querySelectorAll('.cp-option').forEach(el => {
      el.addEventListener('mouseenter', () => { el.style.background = 'var(--surface-strong)'; });
      el.addEventListener('mouseleave', () => { el.style.background = ''; });
      el.addEventListener('click', () => {
        const cp = el.dataset.cp;
        const commune = el.dataset.commune;
        _setCPFilter(cp, commune === '__all__' ? null : commune, commune === '__all__' ? `${cp}… (toutes)` : `${cp} — ${commune}`);
        dropdown.style.display = 'none';
        input.value = '';
      });
    });
  }

  input.addEventListener('focus', async () => {
    await _loadCommunesData();
    if (!input.value.trim()) {
      const villes = _villesFromResults();
      _renderCPDropdown(villes, villes.length ? 'Villes dans les résultats' : '');
    }
  });

  input.addEventListener('input', () => {
    const val = input.value.trim();
    if (!val) {
      _renderCPDropdown(_villesFromResults(), 'Villes dans les résultats');
      return;
    }
    if (val.length < 2) { dropdown.style.display = 'none'; return; }
    _renderCPDropdown(_villesFromSearch(val), '');
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

function _setScanTarget(cp, commune, label) {
  _scanTarget = { cp, commune, label };
  _saveScanTargetToStorage(_scanTarget);
  const badge = document.getElementById('scan-target-cp-badge');
  const reset = document.getElementById('scan-target-cp-reset');
  if (badge) { badge.textContent = label; badge.style.display = ''; }
  if (reset) reset.style.display = '';
  const input = document.getElementById('scan-target-cp-input');
  if (input) input.value = label;
  // M1 — update hero zone chip
  const zoneChip = document.getElementById('scanner-zone-chip');
  if (zoneChip) zoneChip.textContent = label;
  const headerSub = document.getElementById('scanner-header-sub');
  if (headerSub) headerSub.textContent = label;
  _updateScanButtonsState();
  _renderScannerHero();
}

function _updateScanButtonsState() {
  const canScan = !!_scanTarget && !_scanRunning;
  ['btn-scan', 'btn-scan-full'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = !canScan;
  });
  const optionsBtn = document.getElementById('btn-scan-options');
  if (optionsBtn) optionsBtn.disabled = _scanRunning;
  const input = document.getElementById('scan-target-cp-input');
  const reset = document.getElementById('scan-target-cp-reset');
  if (input) input.disabled = _scanRunning;
  if (reset) reset.style.display = (_scanTarget && !_scanRunning) ? '' : 'none';
}

function _initScanTargetSelector() {
  const input = document.getElementById('scan-target-cp-input');
  const dropdown = document.getElementById('scan-target-cp-dropdown');
  const resetBtn = document.getElementById('scan-target-cp-reset');
  if (!input) return;

  function _buildMatches(val) {
    if (!_communesData) return [];
    if (!val) {
      // Toutes les villes triées alphabétiquement
      const all = [];
      for (const [cp, communes] of Object.entries(_communesData))
        for (const commune of communes) all.push({ cp, commune });
      return all.sort((a, b) => a.commune.localeCompare(b.commune, 'fr'));
    }
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
    return matches;
  }

  function _renderDropdown(val) {
    const matches = _buildMatches(val);
    if (!matches.length) { dropdown.style.display = 'none'; return; }

    let html = '';
    for (const { cp, commune } of matches) {
      html += `<div class="cp-option" data-cp="${cp}" data-commune="${_esc(commune)}"
        style="padding:8px 14px;cursor:pointer;font-size:13px">
        <span style="color:var(--muted);font-size:11px;margin-right:6px">${cp}</span>${_esc(commune)}
      </div>`;
    }

    dropdown.innerHTML = html;
    dropdown.style.display = 'block';

    dropdown.querySelectorAll('.cp-option').forEach(el => {
      el.addEventListener('mouseenter', () => { el.style.background = 'var(--surface-strong)'; });
      el.addEventListener('mouseleave', () => { el.style.background = ''; });
      el.addEventListener('click', () => {
        _setScanTarget(el.dataset.cp, el.dataset.commune, `${el.dataset.cp} — ${el.dataset.commune}`);
        dropdown.style.display = 'none';
        input.value = '';
      });
    });
  }

  input.addEventListener('focus', async () => {
    await _loadCommunesData();
    _renderDropdown(input.value.trim());
  });

  input.addEventListener('input', () => {
    if (!_communesData) return;
    _renderDropdown(input.value.trim());
  });

  input.addEventListener('keydown', e => {
    const options = [...dropdown.querySelectorAll('.cp-option')];
    const active = dropdown.querySelector('.cp-option--active');
    const idx = options.indexOf(active);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = options[idx + 1] || options[0];
      if (active) { active.classList.remove('cp-option--active'); active.style.background = ''; }
      if (next) { next.classList.add('cp-option--active'); next.style.background = 'var(--surface-strong)'; }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = options[idx - 1] || options[options.length - 1];
      if (active) { active.classList.remove('cp-option--active'); active.style.background = ''; }
      if (prev) { prev.classList.add('cp-option--active'); prev.style.background = 'var(--surface-strong)'; }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = active || options[0];
      if (target) {
        _setScanTarget(target.dataset.cp, target.dataset.commune, `${target.dataset.cp} — ${target.dataset.commune}`);
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
    _scanTarget = null;
    input.value = '';
    const badge = document.getElementById('scan-target-cp-badge');
    if (badge) badge.style.display = 'none';
    resetBtn.style.display = 'none';
    _updateScanButtonsState();
  });
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
let _scanTarget = null; // { cp, commune, label } — ville cible du prochain scan

// ─── Persistance zone cible ───────────────────────────────────────────────────
const SCANNER_TARGET_STORAGE_KEY = 'investissementWebScannerTarget';

function _loadScanTargetFromStorage() {
  try {
    const raw = localStorage.getItem(SCANNER_TARGET_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.cp && parsed.commune && parsed.label) return parsed;
    return null;
  } catch { return null; }
}

function _saveScanTargetToStorage(target) {
  try {
    localStorage.setItem(SCANNER_TARGET_STORAGE_KEY, JSON.stringify(target));
  } catch {}
}

// ─── Persistance rayon ────────────────────────────────────────────────────────
const SCANNER_RAYON_STORAGE_KEY = 'scannerRayonKm';

function _loadRayonKm() {
  try {
    const raw = localStorage.getItem(SCANNER_RAYON_STORAGE_KEY);
    const parsed = Number(raw);
    return [5, 10, 20, 30].includes(parsed) ? parsed : 5;
  } catch { return 5; }
}

let _scannerRayonKm = _loadRayonKm();

const VIERZON_LAT = 47.222;
const VIERZON_LNG = 2.069;

// Static fallback coords for common postal codes around Vierzon
const _COMMUNE_COORDS = {
  '18100': [47.222, 2.069],
  '18200': [47.080, 2.397],
  '18110': [47.166, 2.165],
  '18120': [47.280, 1.951],
  '18130': [47.090, 2.270],
  '18300': [47.085, 2.394],
  '36100': [46.836, 1.691],
  '41200': [47.348, 1.733],
  '45300': [48.178, 2.367],
};

function _haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function _getDistanceKmFromVierzon(codePostal) {
  const coords = _COMMUNE_COORDS[codePostal];
  if (!coords) return null;
  return _haversineKm(VIERZON_LAT, VIERZON_LNG, coords[0], coords[1]);
}

function _getScannerRayonKm() {
  return _scannerRayonKm;
}

function _setRayonKm(km) {
  _scannerRayonKm = km;
  try { localStorage.setItem(SCANNER_RAYON_STORAGE_KEY, String(km)); } catch {}
  _updateScannerHeaderSub();
  _updateMapRadiusCircle();
}

let _missingScanThreshold = _loadMissingScanThreshold();
let _scannerLogsExpanded = false;
let _distanceFilterKm = 50;

// ─── État tableau ─────────────────────────────────────────────────────────────
let _allResultats = [];
let _displayedResultats = [];
let _detailCache = new Map();
let _summaryRowsById = new Map();
let _resultsById = new Map();
let _summaryRenderCache = { signature: null, rows: [], html: '' };
let _resultsLoadInfo = { total: 0, loaded: 0, pages: 0 };
let _latestGeneratedAt = null;
let _latestStatusLabel = 'En attente';
let _activeDrawerBienId = null;
let _sortKey = 'cf_net';
let _sortDir = -1; // -1 = décroissant, 1 = croissant
let _displayCount = 20; // nombre ou 'all'
let _selectedFilterPreset = 'all';
let _scannerFiltersDrawerOpen = false;
let _detailDrawerCloseTimer = null;
let _drawerReturnFocusTarget = null;

const FILTER_PRESET_LABELS = {
  all: 'Tous les biens',
  'ranking-top': 'Score de classement élevé',
  solid: 'Décision favorable',
  'ia-ready': 'Analyses IA prêtes',
  'ia-pending': 'Analyses IA en attente',
  'cf-positive': 'CF après impôt positif',
  immeuble: 'Immeubles de rapport',
  'safe-dpe': 'DPE A-D',
  'no-works': 'Sans travaux',
  rented: 'Déjà loués',
};

const SORT_COLS = [
  { key: 'cf_net',         label: 'CF net',          th: 'CF net' },
  { key: 'cf_apres_impot', label: 'CF après impôt',  th: 'CF après impôt' },
  { key: 'renta_brute',    label: 'Renta brute',      th: 'Renta brute' },
  { key: 'score',          label: 'Score scanner',    th: 'Score scanner' },
  { key: 'dscr',           label: 'DSCR',             th: 'DSCR' },
  { key: 'prix',           label: 'Prix',             th: 'Prix' },
  { key: 'loyer_estime',   label: 'Loyer',            th: 'Loyer' },
  { key: 'prix_m2',        label: 'Prix/m²',          th: 'Prix/m²' },
  { key: 'surface',        label: 'Surface',          th: 'Surface' },
  { key: 'mensualite',     label: 'Mensualité',       th: 'Mensualité' },
];

const DETAIL_SORT_OPTIONS = [
  { key: 'cf_apres_impot', label: 'CF après impôt' },
  { key: 'cf_net', label: 'CF net' },
  { key: 'score', label: 'Score scanner' },
  { key: 'dscr', label: 'DSCR' },
  { key: 'renta_brute', label: 'Rendement brut' },
  { key: 'prix', label: 'Prix' },
  { key: 'loyer_estime', label: 'Loyer' },
  { key: 'surface', label: 'Surface' },
];

const FILTER_NUMERIC_INPUTS = {
  'prix-min': { rangeId: 'range-prix-min', boundary: 'min' },
  'prix-max': { rangeId: 'range-prix-max', boundary: 'max' },
  'surface-min': { rangeId: 'range-surface-min', boundary: 'min' },
  'surface-max': { rangeId: 'range-surface-max', boundary: 'max' },
  'renta-min': { rangeId: 'range-renta', boundary: 'min' },
  'cf-min': { rangeId: 'range-cf', boundary: 'min' },
  'dscr-min': { rangeId: 'range-dscr', boundary: 'min' },
  'score-min': { rangeId: 'range-score-min', boundary: 'min' },
};

const REGIME_LABELS = {
  micro: 'Micro',
  reel: 'Réel',
  sci_is: 'SCI IS',
};

function _coerceNullableBool(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1') return true;
  if (value === 0 || value === '0') return false;
  return Boolean(value);
}

function _parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function _normalizeResultRow(raw) {
  return {
    ...raw,
    ia_enrichi: _coerceNullableBool(raw.ia_enrichi) === true,
    travaux: _coerceNullableBool(raw.travaux) === true,
    immeuble_rapport: _coerceNullableBool(raw.immeuble_rapport) === true,
    deja_loue: _coerceNullableBool(raw.deja_loue),
    meuble: _coerceNullableBool(raw.meuble),
    parking_garage: _coerceNullableBool(raw.parking_garage) === true,
    points_forts: _parseJsonArray(raw.points_forts),
    points_faibles: _parseJsonArray(raw.points_faibles),
  };
}

function _getVal(r, key) {
  if (key === 'prix_m2') return r.surface ? r.prix / r.surface : null;
  const v = r[key];
  return v != null ? v : null;
}

function _getScannerDecision(r) {
  if (!r?.ia_enrichi) {
    return {
      label: 'Analyse IA en attente',
      tone: 'pending',
      summary: 'La fiche n est pas encore structurée par l IA. Les indicateurs restent donc provisoires.',
      action: 'Lancer l analyse IA avant classement.',
    };
  }

  if (r.cf_apres_impot == null || r.dscr == null || r.renta_nette_nette == null) {
    return {
      label: 'Données partielles',
      tone: 'neutral',
      summary: 'Les métriques clés sont incomplètes, ce qui empêche une lecture comparative fiable.',
      action: 'Compléter les données manquantes avant classement.',
    };
  }

  if (r.cf_apres_impot < -150 || r.dscr < 0.95 || r.renta_nette_nette < 3.5) {
    return {
      label: 'Sous seuil',
      tone: 'negative',
      summary: 'Les indicateurs restent insuffisants au regard du cash-flow, du DSCR ou du rendement net-net.',
      action: 'Écarter ce bien du lot ou ne le reprendre qu après correction nette du prix.',
    };
  }
  if (r.cf_apres_impot < 0 || r.dscr < 1 || r.renta_nette_nette < 4) {
    return {
      label: 'À recalibrer',
      tone: 'watch',
      summary: 'Le dossier peut redevenir recevable, mais les indicateurs restent sous les seuils cibles.',
      action: 'Réviser le prix ou l hypothèse locative avant décision.',
    };
  }
  if (r.cf_apres_impot < 75 || r.dscr < 1.1 || r.renta_nette_nette < 4.8) {
    return {
      label: 'Intermédiaire',
      tone: 'neutral',
      summary: 'Le dossier couvre les flux principaux, mais la marge reste limitée.',
      action: 'Conserver en observation et vérifier prix, charges et loyer.',
    };
  }
  if (r.cf_apres_impot < 200 || r.dscr < 1.25 || r.renta_nette_nette < 6) {
    return {
      label: 'Conforme',
      tone: 'positive',
      summary: 'Le dossier respecte les seuils clés et peut passer en revue détaillée.',
      action: 'Documenter les points restants avant décision.',
    };
  }
  return {
    label: 'Favorable',
    tone: 'excellent',
    summary: 'Le dossier dépasse les seuils cibles avec une marge observable sur les principaux indicateurs.',
    action: 'Passer en revue détaillée et confirmer les points terrain.',
  };
}

function _renderScannerTonePill(label, tone) {
  const toneClass = ['excellent', 'positive', 'neutral', 'watch', 'negative', 'pending'].includes(tone)
    ? tone
    : 'neutral';
  return `<span class="scanner-tone-pill scanner-tone-pill--${toneClass}">${_esc(label)}</span>`;
}

function _getScannerContextLabel(resultats = []) {
  if (_cpFilter?.commune) return `${_cpFilter.cp} — ${_cpFilter.commune}`;
  if (_cpFilter?.cp) return `${_cpFilter.cp}`;
  if (_scanTarget?.label) return _scanTarget.label;
  const first = resultats[0];
  if (!first) return 'scanner';
  if (first.ville && first.code_postal) return `${first.ville} (${first.code_postal})`;
  return first.ville || first.code_postal || 'scanner';
}

function _slugifyFilenamePart(value) {
  return String(value || 'scanner')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'scanner';
}

function _buildScannerFilename(prefix, extension, resultats = []) {
  const zone = _slugifyFilenamePart(_getScannerContextLabel(resultats));
  const date = new Date().toISOString().slice(0, 10);
  return `${prefix}-${zone}-${date}.${extension}`;
}

function _getLoyerSourceLabel(source) {
  if (source === 'annonce') return 'Annonce';
  if (source === 'marche') return 'Marché';
  if (source === 'taux_fixe') return 'Taux fixe';
  return '—';
}

function _getScannerSignals(r) {
  const notes = [];
  if (Array.isArray(r.points_faibles) && r.points_faibles.length) {
    notes.push(...r.points_faibles.slice(0, 2));
  }
  if (!notes.length && ['e', 'f', 'g'].includes((r.dpe || '').toLowerCase())) {
    notes.push(`DPE ${String(r.dpe || '').toUpperCase()}`);
  }
  if (!notes.length && r.travaux) notes.push('Travaux à prévoir');
  if (!notes.length && r.immeuble_rapport) notes.push('Immeuble de rapport');
  if (!notes.length && r.deja_loue === true) notes.push('Déjà loué');
  if (!notes.length && !r.ia_enrichi) notes.push('En attente d’enrichissement IA');
  return notes.length ? notes.join(' · ') : 'RAS';
}

function _buildScannerSummaryRow(r) {
  const decision = _getScannerDecision(r);
  const ranking = _getScannerRanking(r, decision);
  const statusLabel = r.ia_enrichi ? 'Analyse prête' : 'À structurer';
  const statusTone = r.ia_enrichi ? 'positive' : 'pending';
  const regimeLabel = r.regime_optimal ? (REGIME_LABELS[r.regime_optimal] || r.regime_optimal) : '—';
  const dpeLabel = r.dpe ? `DPE ${String(r.dpe).toUpperCase()}` : '—';
  const subtitle = [
    r.ville,
    r.surface ? `${Math.round(r.surface)} m²` : null,
    r.nb_pieces ? `T${r.nb_pieces}` : null,
    r.type_bien ? `${r.type_bien.charAt(0).toUpperCase()}${r.type_bien.slice(1)}` : null,
  ].filter(Boolean).join(' · ');

  const baisseValue = typeof r.baisse === 'number' && r.baisse > 0 ? r.baisse : null;
  const baisseDateLabel = baisseValue && r.date_baisse ? r.date_baisse.slice(0, 10) : null;
  const baisseLabel = baisseValue
    ? `↓ -${_fmtEur(baisseValue)}`
    : null;

  const distKm = _getDistanceKmFromVierzon(r.code_postal);
  const distLabel = distKm != null ? `${Math.round(distKm)} km` : null;
  const distTone = distKm == null ? '' : distKm < 10 ? 'near' : distKm < 20 ? 'mid' : 'far';

  return {
    bienId: r.bien_id,
    title: r.titre || 'Bien sans titre',
    subtitle,
    city: r.ville || '',
    postalCode: r.code_postal || '',
    typeLabel: r.type_bien ? `${r.type_bien.charAt(0).toUpperCase()}${r.type_bien.slice(1)}` : '—',
    surfaceLabel: r.surface != null ? `${Math.round(r.surface)}` : '',
    roomsLabel: r.nb_pieces != null ? `T${r.nb_pieces}` : '',
    statusLabel,
    statusTone,
    decisionLabel: decision.label,
    decisionTone: decision.tone,
    rankScore: ranking.score,
    rankLabel: ranking.label,
    rankTone: ranking.tone,
    rankDetail: ranking.detail,
    priceLabel: _fmtEur(r.prix),
    priceValue: r.prix,
    baisseLabel,
    baisseDateLabel,
    baisseValue,
    rentLabel: r.loyer_estime != null ? _fmtEur(r.loyer_estime) : '—',
    rentValue: r.loyer_estime,
    rentSourceLabel: _getLoyerSourceLabel(r.loyer_source),
    cfNetLabel: r.cf_net != null ? `${r.cf_net >= 0 ? '+' : ''}${_fmtEur(r.cf_net)}` : '—',
    cfNetValue: r.cf_net,
    cfAfterTaxLabel: r.cf_apres_impot != null ? `${r.cf_apres_impot >= 0 ? '+' : ''}${_fmtEur(r.cf_apres_impot)}` : '—',
    cfAfterTaxValue: r.cf_apres_impot,
    rentaBruteLabel: r.renta_brute != null ? `${r.renta_brute.toFixed(1)} %` : '—',
    rentaBruteValue: r.renta_brute,
    rentaNetNetLabel: r.renta_nette_nette != null ? `${r.renta_nette_nette.toFixed(1)} %` : '—',
    rentaNetNetValue: r.renta_nette_nette,
    dscrLabel: r.dscr != null ? r.dscr.toFixed(2) : '—',
    dscrValue: r.dscr,
    scoreLabel: r.score != null ? `${r.score}/100` : '—',
    scoreValue: r.score,
    regimeLabel,
    dpeLabel,
    signalsLabel: _getScannerSignals(r),
    resumeLabel: r.resume_ia || '',
    url: r.url || '',
    distLabel,
    distTone,
    raw: r,
  };
}

function _getCachedScannerSummaryRow(r) {
  return _summaryRowsById.get(r.bien_id) || _buildScannerSummaryRow(r);
}

function _matchSelectedPreset(r) {
  if (_selectedFilterPreset === 'all') return true;

  if (_selectedFilterPreset === 'ia-ready') return r.ia_enrichi === true;
  if (_selectedFilterPreset === 'ia-pending') return r.ia_enrichi !== true;
  if (_selectedFilterPreset === 'cf-positive') return r.cf_apres_impot != null && r.cf_apres_impot > 0;
  if (_selectedFilterPreset === 'immeuble') return r.immeuble_rapport === true || r.type_bien === 'immeuble';
  if (_selectedFilterPreset === 'safe-dpe') return !['e', 'f', 'g'].includes((r.dpe || '').toLowerCase());
  if (_selectedFilterPreset === 'no-works') return r.travaux !== true;
  if (_selectedFilterPreset === 'rented') return r.deja_loue === true;

  const summaryRow = _getCachedScannerSummaryRow(r);
  if (_selectedFilterPreset === 'solid') {
    return summaryRow.decisionTone === 'positive' || summaryRow.decisionTone === 'excellent';
  }
  if (_selectedFilterPreset === 'ranking-top') {
    return summaryRow.rankScore >= 85;
  }

  return true;
}

function _getDecisionRankWeight(tone) {
  if (tone === 'excellent') return 34;
  if (tone === 'positive') return 26;
  if (tone === 'neutral') return 18;
  if (tone === 'watch') return 8;
  if (tone === 'negative') return 0;
  return 0;
}

function _getScannerRanking(r, decision) {
  if (!r?.ia_enrichi) {
    return {
      score: 0,
      label: 'Analyse requise',
      tone: 'pending',
      detail: 'Analyse IA requise avant classement.',
    };
  }

  let score = 0;
  score += _getDecisionRankWeight(decision.tone);

  if (typeof r.score === 'number') score += Math.max(0, Math.min(30, Math.round(r.score * 0.3)));
  if (typeof r.cf_apres_impot === 'number') {
    if (r.cf_apres_impot >= 300) score += 18;
    else if (r.cf_apres_impot >= 150) score += 14;
    else if (r.cf_apres_impot >= 50) score += 10;
    else if (r.cf_apres_impot >= 0) score += 6;
    else if (r.cf_apres_impot >= -100) score += 2;
  }
  if (typeof r.dscr === 'number') {
    if (r.dscr >= 1.3) score += 12;
    else if (r.dscr >= 1.15) score += 9;
    else if (r.dscr >= 1.0) score += 5;
  }
  if (typeof r.renta_nette_nette === 'number') {
    if (r.renta_nette_nette >= 6) score += 10;
    else if (r.renta_nette_nette >= 5) score += 7;
    else if (r.renta_nette_nette >= 4) score += 4;
  }

  if (['e', 'f', 'g'].includes((r.dpe || '').toLowerCase())) score -= 8;
  if (Array.isArray(r.points_faibles) && r.points_faibles.length) score -= Math.min(8, r.points_faibles.length * 2);
  if (r.travaux) score -= 3;

  score = Math.max(0, Math.min(100, Math.round(score)));

  let label = 'Score faible';
  let tone = 'watch';
  if (score >= 85) {
    label = 'Score élevé';
    tone = 'excellent';
  } else if (score >= 70) {
    label = 'Score favorable';
    tone = 'positive';
  } else if (score >= 55) {
    label = 'Score intermédiaire';
    tone = 'positive';
  } else if (score >= 40) {
    label = 'Score à confirmer';
    tone = 'neutral';
  } else if (score >= 20) {
    label = 'Score faible';
    tone = 'watch';
  } else {
    label = 'Score très faible';
    tone = 'negative';
  }

  const detail = [
    typeof r.cf_apres_impot === 'number' ? `${r.cf_apres_impot >= 0 ? '+' : ''}${Math.round(r.cf_apres_impot)} €/mois après impôt` : null,
    typeof r.dscr === 'number' ? `DSCR ${r.dscr.toFixed(2)}` : null,
    typeof r.score === 'number' ? `Score ${r.score}/100` : null,
  ].filter(Boolean).join(' · ');

  return { score, label, tone, detail };
}

function _compareSummaryRowsForRanking(a, b) {
  if (b.rankScore !== a.rankScore) return b.rankScore - a.rankScore;
  if ((b.cfAfterTaxValue ?? -Infinity) !== (a.cfAfterTaxValue ?? -Infinity)) {
    return (b.cfAfterTaxValue ?? -Infinity) - (a.cfAfterTaxValue ?? -Infinity);
  }
  if ((b.scoreValue ?? -Infinity) !== (a.scoreValue ?? -Infinity)) {
    return (b.scoreValue ?? -Infinity) - (a.scoreValue ?? -Infinity);
  }
  return (a.priceValue ?? Infinity) - (b.priceValue ?? Infinity);
}

function _buildRankBadge(index) {
  if (index === 0) return { label: '1', tone: 'gold' };
  if (index === 1) return { label: '2', tone: 'silver' };
  if (index === 2) return { label: '3', tone: 'bronze' };
  return { label: String(index + 1), tone: 'default' };
}

function _renderRankPill(rankIndex, rankLabel, rankScore) {
  const badge = _buildRankBadge(rankIndex);
  return `
    <span class="scanner-rank-pill">
      <span class="scanner-rank-marker scanner-rank-marker--${badge.tone}">${badge.label}</span>
      <span class="scanner-rank-copy">
        <span class="scanner-rank-label">${_esc(rankLabel)}</span>
        <span class="scanner-rank-score">${rankScore}/100</span>
      </span>
    </span>`;
}

function _renderScannerRankingStrip(rows) {
  const ranked = rows.filter(row => row.raw.ia_enrichi).slice(0, 5);
  if (!ranked.length) return '';

  const cards = ranked.map(row => {
    const badge = _buildRankBadge(row.rankIndex);
    const cfTone = row.cfAfterTaxValue != null && row.cfAfterTaxValue >= 0 ? 'positive' : 'negative';
    const resumeSnippet = row.resumeLabel
      ? `<div class="scanner-curation-card__resume">${_esc(row.resumeLabel.slice(0, 120))}${row.resumeLabel.length > 120 ? '…' : ''}</div>`
      : '';
    return `
      <article class="scanner-curation-card">
        <div class="scanner-curation-card__top">
          <span class="scanner-rank-marker scanner-rank-marker--${badge.tone} scanner-rank-marker--hero">${badge.label}</span>
          ${_renderScannerTonePill(row.decisionLabel, row.decisionTone)}
        </div>
        <div class="scanner-curation-card__title">${_esc(row.title)}</div>
        <div class="scanner-curation-card__subtitle">${_esc(row.subtitle || 'Informations principales indisponibles')}</div>
        <div class="scanner-curation-card__metrics">
          <div class="scanner-curation-metric">
            <div class="scanner-curation-metric__label">Classement</div>
            <div class="scanner-curation-metric__value">${row.rankScore}/100</div>
          </div>
          <div class="scanner-curation-metric">
            <div class="scanner-curation-metric__label">CF après impôt</div>
            <div class="scanner-curation-metric__value scanner-curation-metric__value--${cfTone}">${row.cfAfterTaxLabel}</div>
          </div>
        </div>
        <div class="scanner-curation-card__detail">${_esc(row.rankDetail || row.signalsLabel)}</div>
        ${resumeSnippet}
      </article>`;
  }).join('');

  return `
    <section class="scanner-curation">
      <div class="scanner-curation__head">
        <div>
          <div class="scanner-curation__eyebrow">Classement</div>
          <div class="scanner-curation__title-block">Dossiers les mieux notés</div>
          <div class="scanner-curation__copy">Le score agrège décision, score IA, CF après impôt, DSCR et pénalités de risque.</div>
        </div>
      </div>
      <div class="scanner-curation__grid">${cards}</div>
    </section>`;
}

function _getScannerSummaryRows(resultats) {
  const rows = resultats.map(r => _getCachedScannerSummaryRow(r));

  return [...rows]
    .sort(_compareSummaryRowsForRanking)
    .map((row, index) => ({
      ...row,
      rankIndex: index,
      rankDisplay: index + 1,
    }));
}

function _downloadTextFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function _escapeCsvValue(value) {
  const text = value == null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function _exportScannerCsv(resultats) {
  const rows = _getScannerSummaryRows(resultats);
  if (!rows.length) {
    alert('Aucun bien à exporter dans le tableau courant.');
    return;
  }

  const headers = [
    'Rang', 'Classement', 'Bien', 'Ville', 'Code postal', 'Type', 'Surface m2', 'Pieces',
    'Statut fiche', 'Decision', 'Prix', 'Loyer', 'Source loyer',
    'CF net', 'CF apres impot', 'Renta brute', 'Renta nette-nette',
    'DSCR', 'Score', 'Regime optimal', 'DPE', 'Signaux', 'Resume IA', 'URL'
  ];

  const lines = rows.map(row => [
    row.rankDisplay,
    row.rankScore,
    row.title,
    row.city,
    row.postalCode,
    row.typeLabel,
    row.surfaceLabel,
    row.roomsLabel,
    row.statusLabel,
    row.decisionLabel,
    row.priceValue ?? '',
    row.rentValue ?? '',
    row.rentSourceLabel,
    row.cfNetValue ?? '',
    row.cfAfterTaxValue ?? '',
    row.rentaBruteValue ?? '',
    row.rentaNetNetValue ?? '',
    row.dscrValue ?? '',
    row.scoreValue ?? '',
    row.regimeLabel,
    row.dpeLabel,
    row.signalsLabel,
    row.resumeLabel,
    row.url,
  ].map(_escapeCsvValue).join(';'));

  const csv = ['\uFEFF' + headers.map(_escapeCsvValue).join(';'), ...lines].join('\r\n');
  _downloadTextFile(csv, _buildScannerFilename('scanner-bilan', 'csv', resultats), 'text/csv;charset=utf-8;');
}

function _buildScannerReportDocument(resultats) {
  const rows = _getScannerSummaryRows(resultats);
  const contextLabel = _getScannerContextLabel(resultats);
  const generatedAt = new Date().toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const enrichedCount = rows.filter(row => row.raw.ia_enrichi).length;
  const pendingCount = rows.length - enrichedCount;
  const positiveCount = rows.filter(row => row.cfAfterTaxValue != null && row.cfAfterTaxValue > 0).length;

  const reportRows = rows.map(row => `
    <tr>
      <td style="text-align:center">${row.rankDisplay}</td>
      <td>
        <div style="font-weight:700;color:#171717">${_esc(row.title)}</div>
        <div style="font-size:11px;color:#6b7280;margin-top:2px">${_esc(row.subtitle || 'Informations principales indisponibles')}</div>
      </td>
      <td style="text-align:center">${row.rankScore}/100</td>
      <td>${_esc(row.statusLabel)}</td>
      <td>${_esc(row.decisionLabel)}</td>
      <td style="text-align:right">${_esc(row.priceLabel)}</td>
      <td style="text-align:right">${_esc(row.rentLabel)}</td>
      <td style="text-align:right">${_esc(row.cfAfterTaxLabel)}</td>
      <td style="text-align:right">${_esc(row.rentaNetNetLabel)}</td>
      <td style="text-align:center">${_esc(row.dscrLabel)}</td>
      <td style="text-align:center">${_esc(row.scoreLabel)}</td>
      <td>${_esc(row.regimeLabel)}</td>
      <td>${_esc(row.dpeLabel)}</td>
      <td>${_esc(row.signalsLabel)}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Rapport scanner - ${_esc(contextLabel)}</title>
  <style>
    :root {
      color-scheme: light;
      --paper: #f7f2e7;
      --ink: #171717;
      --muted: #6b7280;
      --line: #d6c7a7;
      --accent: #8a6b2d;
      --panel: #fffdfa;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Manrope", "Segoe UI", sans-serif;
      color: var(--ink);
      background: linear-gradient(180deg, #fcf8ef 0%, var(--paper) 100%);
    }
    .page {
      width: min(1440px, calc(100vw - 48px));
      margin: 24px auto 48px;
    }
    .toolbar {
      display: flex;
      justify-content: flex-end;
      margin-bottom: 16px;
    }
    .toolbar button {
      border: 1px solid var(--accent);
      background: var(--accent);
      color: white;
      border-radius: 999px;
      padding: 10px 16px;
      font: inherit;
      cursor: pointer;
    }
    .hero {
      display: grid;
      gap: 14px;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 20px;
      padding: 24px 28px;
      box-shadow: 0 16px 40px rgba(138, 107, 45, 0.08);
    }
    .eyebrow {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: .14em;
      color: var(--accent);
      font-weight: 800;
    }
    h1 {
      margin: 0;
      font-family: "Cormorant Garamond", Georgia, serif;
      font-size: 42px;
      line-height: 1;
      font-weight: 700;
    }
    .meta {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      color: var(--muted);
      font-size: 13px;
    }
    .chips {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
      margin-top: 6px;
    }
    .chip {
      background: rgba(138, 107, 45, 0.08);
      border: 1px solid rgba(138, 107, 45, 0.16);
      border-radius: 16px;
      padding: 14px 16px;
    }
    .chip strong {
      display: block;
      font-size: 24px;
      margin-bottom: 4px;
    }
    .chip span {
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: .08em;
    }
    .table-shell {
      margin-top: 18px;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 20px;
      overflow: hidden;
      box-shadow: 0 16px 40px rgba(138, 107, 45, 0.06);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }
    thead th {
      text-align: left;
      background: #efe4cb;
      color: #5b4630;
      padding: 12px 14px;
      border-bottom: 1px solid var(--line);
      white-space: nowrap;
    }
    tbody td {
      padding: 12px 14px;
      border-bottom: 1px solid rgba(214, 199, 167, 0.55);
      vertical-align: top;
    }
    tbody tr:nth-child(even) td {
      background: rgba(255, 255, 255, 0.45);
    }
    @media print {
      body { background: white; }
      .page { width: 100%; margin: 0; }
      .toolbar { display: none; }
      .hero, .table-shell { box-shadow: none; }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="toolbar">
      <button type="button" onclick="window.print()">Imprimer le rapport</button>
    </div>
    <section class="hero">
      <div class="eyebrow">Scanner d'annonces</div>
      <h1>Rapport global du lot</h1>
      <div class="meta">
        <span>Zone : ${_esc(contextLabel)}</span>
        <span>Édité le ${_esc(generatedAt)}</span>
        <span>${rows.length} biens dans la vue courante</span>
      </div>
      <div class="chips">
        <div class="chip"><strong>${rows.length}</strong><span>Biens filtrés</span></div>
        <div class="chip"><strong>${enrichedCount}</strong><span>Fiches IA prêtes</span></div>
        <div class="chip"><strong>${pendingCount}</strong><span>Fiches brutes</span></div>
        <div class="chip"><strong>${positiveCount}</strong><span>CF après impôt positif</span></div>
      </div>
    </section>
    <section class="table-shell">
      <table>
        <thead>
          <tr>
            <th style="text-align:center">Rang</th>
            <th>Bien</th>
            <th style="text-align:center">Classement</th>
            <th>Statut</th>
            <th>Décision</th>
            <th style="text-align:right">Prix</th>
            <th style="text-align:right">Loyer</th>
            <th style="text-align:right">CF après impôt</th>
            <th style="text-align:right">Renta N/N</th>
            <th style="text-align:center">DSCR</th>
            <th style="text-align:center"><abbr title="Score scanner : calculé par l'algorithme d'analyse automatique (CF, DSCR, renta brute, DPE). Non comparable au score du simulateur.">Score scanner</abbr></th>
            <th>Régime</th>
            <th>DPE</th>
            <th>Signaux</th>
          </tr>
        </thead>
        <tbody>${reportRows}</tbody>
      </table>
    </section>
  </div>
</body>
</html>`;
}

function _openScannerGlobalReport(resultats) {
  const rows = _getScannerSummaryRows(resultats);
  if (!rows.length) {
    alert('Aucun bien à inclure dans le rapport global.');
    return;
  }

  const reportWindow = window.open('', '_blank', 'noopener,noreferrer');
  if (!reportWindow) {
    alert('Le navigateur a bloqué l\'ouverture du rapport. Autorisez les fenêtres pop-up pour continuer.');
    return;
  }

  reportWindow.document.open();
  reportWindow.document.write(_buildScannerReportDocument(resultats));
  reportWindow.document.close();
}

function _renderFreshnessLabel(dateDerniereVue) {
  if (!dateDerniereVue) return '';
  const daysDiff = Math.floor((Date.now() - new Date(dateDerniereVue).getTime()) / 86400000);
  const label = daysDiff === 0 ? 'Vu aujourd\'hui' : `Vu il y a ${daysDiff} j`;
  const staleClass = daysDiff > 10 ? ' scanner-freshness--stale' : '';
  return `<div class="scanner-freshness${staleClass}">${label}</div>`;
}

function _renderGlobalOverviewTable(rows) {
  const enrichedCount = rows.filter(row => row.raw.ia_enrichi).length;
  const pendingCount = Math.max(0, rows.length - enrichedCount);
  const defendableCount = rows.filter(row => row.decisionTone === 'positive' || row.decisionTone === 'excellent').length;
  const bestScore = rows[0]?.rankScore ?? null;
  const rankingStrip = _renderScannerRankingStrip(rows);

  if (!rows.length) {
    return `
      <section class="scanner-overview scanner-overview--empty">
        <div class="scanner-overview__head">
          <div>
            <div class="scanner-overview__eyebrow">Lecture du lot</div>
            <div class="scanner-overview__title">Aucun dossier ne passe les filtres courants</div>
            <div class="scanner-overview__meta">La combinaison de filtres est plus restrictive que le lot actuellement disponible.</div>
          </div>
          <div class="scanner-overview__empty-actions">
            <button id="scanner-reset-filters-empty" type="button" class="scanner-btn scanner-btn--outline">Réinitialiser les filtres</button>
            <div class="scanner-overview__hint">${_allResultats.length ? `${_allResultats.length} biens restent disponibles dans le lot complet.` : 'Définissez une zone puis lancez un scan pour constituer un premier lot.'}</div>
          </div>
        </div>
      </section>`;
  }

  const rowsHtml = rows.map(row => {
    const cfTone = row.cfAfterTaxValue != null && row.cfAfterTaxValue >= 0 ? 'positive' : 'negative';
    const dpeBadge = row.raw.dpe
      ? `<span class="scanner-dpe-badge scanner-dpe-badge--${row.raw.dpe.toLowerCase()}">${row.raw.dpe.toUpperCase()}</span>`
      : '<span class="scanner-dpe-badge scanner-dpe-badge--nc">—</span>';
    const statusInline = _renderScannerTonePill(row.statusLabel, row.statusTone);
    const signals = row.raw.ia_enrichi && row.signalsLabel !== 'RAS'
      ? `<span class="scanner-signal-inline">${_esc(row.signalsLabel)}</span>`
      : '';
    const freshness = row.raw.date_derniere_vue
      ? _renderFreshnessLabel(row.raw.date_derniere_vue)
      : '';
    const priceDrop = row.baisseLabel
      ? `<span class="scanner-price-drop" title="Baisse le ${_esc(row.baisseDateLabel || '?')}">${_esc(row.baisseLabel)}</span>`
      : '';
    const distBadge = row.distLabel
      ? `<span class="scanner-dist-badge scanner-dist-badge--${row.distTone}">${_esc(row.raw.ville || '')} · ${_esc(row.distLabel)}</span>`
      : '';
    return `
      <tr class="scanner-summary-row${row.raw.ia_enrichi ? '' : ' scanner-summary-row--pending'}" data-bien-id="${row.bienId}">
        <td class="scanner-align-left scanner-summary-cell scanner-summary-cell--rank">
          ${_renderRankPill(row.rankIndex, row.rankLabel, row.rankScore)}
        </td>
        <td class="scanner-align-left scanner-summary-cell scanner-summary-cell--primary">
          <div class="scanner-summary-row__title">${_esc(row.title)}</div>
          <div class="scanner-summary-row__subtitle">${_esc(row.subtitle || '')}</div>
          ${distBadge}
          <div class="scanner-summary-row__badges">${statusInline}${signals}</div>
          ${freshness}
        </td>
        <td class="scanner-align-right scanner-summary-cell scanner-summary-cell--numeric">
          <div>${row.priceLabel}${priceDrop}</div>
        </td>
        <td class="scanner-align-right scanner-summary-cell scanner-summary-cell--numeric">
          <div>${row.rentLabel}</div>
          <div class="scanner-summary-row__aux">${_esc(row.rentSourceLabel)}</div>
        </td>
        <td class="scanner-align-right scanner-summary-cell scanner-summary-cell--numeric">
          <span class="scanner-summary-row__value scanner-summary-row__value--${cfTone}">${row.cfAfterTaxLabel}</span>
        </td>
        <td class="scanner-align-right scanner-summary-cell scanner-summary-cell--numeric">${row.rentaNetNetLabel}</td>
        <td class="scanner-align-center scanner-summary-cell">${dpeBadge}</td>
        <td class="scanner-align-left scanner-summary-cell">
          <div class="scanner-score-decision">
            <span class="scanner-score-decision__score">${row.scoreLabel}</span>
            ${_renderScannerTonePill(row.decisionLabel, row.decisionTone)}
          </div>
        </td>
      </tr>`;
  }).join('');

  return `
    ${rankingStrip}
    <section class="scanner-overview">
      <div class="scanner-overview__head">
        <div class="scanner-overview__title-wrap">
          <div class="scanner-overview__eyebrow">Lecture du lot</div>
          <div class="scanner-overview__title">Tableau de bord du lot</div>
          <div class="scanner-overview__meta">${rows.length} biens filtrés · ${enrichedCount} analyses IA prêtes · ${pendingCount} fiches à structurer · classement établi à partir des flux, du score et des pénalités de risque</div>
          <div class="scanner-overview__metrics">
            <article class="scanner-overview__metric">
              <span>Décisions favorables</span>
              <strong>${defendableCount}</strong>
            </article>
            <article class="scanner-overview__metric">
              <span>Analyses prêtes</span>
              <strong>${enrichedCount}</strong>
            </article>
            <article class="scanner-overview__metric">
              <span>Fiches à structurer</span>
              <strong>${pendingCount}</strong>
            </article>
            <article class="scanner-overview__metric">
              <span>Meilleur score</span>
              <strong>${bestScore != null ? `${bestScore}/100` : '—'}</strong>
            </article>
          </div>
        </div>
        <div class="scanner-overview__actions">
          <button id="scanner-export-csv" type="button" class="scanner-btn scanner-btn--outline">Exporter CSV</button>
          <button id="scanner-open-report" type="button" class="scanner-btn scanner-btn--primary">Exporter le rapport</button>
          <div class="scanner-overview__hint">Ouvrez une ligne pour passer du lot global à la fiche détaillée.</div>
        </div>
      </div>
      <div class="scanner-table-shell scanner-table-shell--summary">
        <div class="scanner-table-scroll scanner-table-scroll--summary">
        <table class="scanner-table scanner-table--summary">
          <thead>
            <tr>
              <th class="scanner-align-left" style="width:60px">Rang</th>
              <th class="scanner-align-left">Bien</th>
              <th class="scanner-align-right">Prix</th>
              <th class="scanner-align-right">Loyer</th>
              <th class="scanner-align-right">CF fiscal</th>
              <th class="scanner-align-right">Renta N/N</th>
              <th class="scanner-align-center" style="width:60px">DPE</th>
              <th class="scanner-align-left">Score / Décision</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
        </div>
      </div>
    </section>`;
}

// ─── Points d'entrée publics ────────────────────────────────────────────────

function _getCheckedValues(selector) {
  return [...document.querySelectorAll(selector)].map(el => el.value);
}

function _parseNullableNumber(value) {
  const parsed = parseFloat(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function _parseActiveNumericFilterValue(inputId) {
  const input = document.getElementById(inputId);
  if (!input) return null;

  const parsed = _parseNullableNumber(input.value);
  if (parsed == null) return null;

  const config = FILTER_NUMERIC_INPUTS[inputId];
  if (!config) return parsed;

  const range = document.getElementById(config.rangeId);
  if (!range) return parsed;

  const baseline = config.boundary === 'max'
    ? _parseNullableNumber(range.max)
    : _parseNullableNumber(range.min);

  if (baseline != null && parsed === baseline) {
    return null;
  }

  return parsed;
}

function _isNumericFilterInputActive(inputId) {
  return _parseActiveNumericFilterValue(inputId) != null;
}

function _captureFilterSnapshot() {
  return {
    activeScores: new Set(_getCheckedValues('input[name="score-filter"]:checked')),
    filterCfPositif: document.getElementById('filter-cf-positif')?.checked === true,
    filterCfNegatif: document.getElementById('filter-cf-negatif')?.checked === true,
    filterCfAiPositif: document.getElementById('filter-cfai-positif')?.checked === true,
    activeDpe: new Set(_getCheckedValues('input[name="dpe-filter"]:checked').map(value => value.toLowerCase())),
    filterDpeSafe: document.getElementById('filter-dpe-safe')?.checked === true,
    activeTypes: _getCheckedValues('input[name="type-filter"]:checked').map(value => value.toLowerCase()),
    filterDejaLoue: document.getElementById('filter-deja-loue')?.checked === true,
    filterTravaux: document.getElementById('filter-travaux')?.checked === true,
    filterSansTravaux: document.getElementById('filter-sans-travaux')?.checked === true,
    filterMeuble: document.getElementById('filter-meuble')?.checked === true,
    filterLoyerMarche: document.getElementById('filter-loyer-marche')?.checked === true,
    filterLoyerAnnonce: document.getElementById('filter-loyer-annonce')?.checked === true,
    activePieces: _getCheckedValues('input[name="pieces-filter"]:checked')
      .map(value => parseInt(value, 10))
      .filter(value => !Number.isNaN(value)),
    filterParking: document.getElementById('filter-parking')?.checked === true,
    prixMin: _parseActiveNumericFilterValue('prix-min'),
    prixMax: _parseActiveNumericFilterValue('prix-max'),
    surfaceMin: _parseActiveNumericFilterValue('surface-min'),
    surfaceMax: _parseActiveNumericFilterValue('surface-max'),
    rentaMin: _parseActiveNumericFilterValue('renta-min'),
    cfMin: _parseActiveNumericFilterValue('cf-min'),
    dscrMin: _parseActiveNumericFilterValue('dscr-min'),
    scoreMin: _parseActiveNumericFilterValue('score-min'),
  };
}

export function initScanner({ saveCurrentStudy } = {}) {
  _saveCurrentStudy = saveCurrentStudy || null;
  _syncMissingScanThresholdControl();
  _bindButtons();
  _renderScannerHero();
  _loadResults(false);
  _loadPendingCount();
}

export function onScannerTabActivated() {
  _syncMissingScanThresholdControl();
  _renderScannerHero();
  _loadResults(false);
  _loadPendingCount();
  if (_scanRunning) _startPolling();
}

function _bindButtons() {
  const resultsContainer = document.getElementById('scanner-results');
  const activeFiltersContainer = document.getElementById('scanner-active-filters');

  document.getElementById('btn-scan')?.addEventListener('click', () => _startScan('/api/scan'));
  document.getElementById('btn-scan-full')?.addEventListener('click', () => {
    if (confirm('Vider le cache et relancer un scan complet sur toutes les annonces ?')) {
      _startScan('/api/scan/full');
    }
  });
  document.getElementById('btn-enrich')?.addEventListener('click', () => _startEnrich());
  document.getElementById('scanner-missing-threshold')?.addEventListener('change', async event => {
    const nextThreshold = Number.parseInt(event.target.value || '', 10);
    _saveMissingScanThreshold(Number.isNaN(nextThreshold) ? DEFAULT_MISSING_SCAN_THRESHOLD : nextThreshold);
    _syncMissingScanThresholdControl();
    await _loadResults(true);
    await _loadPendingCount();
  });
  document.getElementById('btn-clear-cache')?.addEventListener('click', async () => {
    if (confirm('Vider le cache ? Le prochain scan traitera toutes les annonces.')) {
      alert('Cache vidé au prochain "Scan complet".');
    }
  });
  document.getElementById('scanner-log-toggle')?.addEventListener('click', () => {
    _setScannerLogsExpanded(!_scannerLogsExpanded);
  });
  // Options dropdown toggle (M1)
  document.getElementById('btn-scan-options')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const dd = document.getElementById('scanner-options-dropdown');
    if (dd) dd.hidden = !dd.hidden;
  });
  document.addEventListener('click', () => {
    const dd = document.getElementById('scanner-options-dropdown');
    if (dd) dd.hidden = true;
  });
  document.getElementById('btn-toggle-filters')?.addEventListener('click', () => {
    if (_isMobileScannerFiltersMode()) {
      _setScannerFiltersDrawerOpen(true);
      return;
    }
    document.getElementById('scanner-filters')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  document.getElementById('scanner-filters-close')?.addEventListener('click', () => {
    _setScannerFiltersDrawerOpen(false);
  });
  document.getElementById('scanner-filters-backdrop')?.addEventListener('click', () => {
    _setScannerFiltersDrawerOpen(false);
  });
  document.getElementById('scanner-empty-focus-target')?.addEventListener('click', () => {
    document.getElementById('scan-target-cp-input')?.focus();
  });
  activeFiltersContainer?.addEventListener('click', event => {
    if (event.target.closest('#scanner-active-filters-reset')) {
      _resetFilters();
    }
  });

  resultsContainer?.addEventListener('click', event => {
    const analyseBtn = event.target.closest('.scanner-analyser-btn');
    if (analyseBtn) {
      const rank = parseInt(analyseBtn.dataset.rank, 10);
      if (!Number.isNaN(rank)) _analyserBien(_displayedResultats[rank]);
      return;
    }

    const sortHeader = event.target.closest('th[data-sort]');
    if (sortHeader) {
      const key = sortHeader.dataset.sort;
      if (_sortKey === key) {
        _sortDir *= -1;
      } else {
        _sortKey = key;
        _sortDir = -1;
      }
      _applyTable();
      return;
    }

    if (event.target.closest('#scanner-sort-direction')) {
      _sortDir *= -1;
      _applyTable();
      return;
    }

    const summaryRow = event.target.closest('.scanner-summary-row');
    if (summaryRow && !event.target.closest('button, a')) {
      const bienId = parseInt(summaryRow.dataset.bienId, 10);
      const target = _resultsById.get(bienId);
      if (target) _openDrawer(target);
      return;
    }

    const detailRow = event.target.closest('tr[data-rank]');
    if (detailRow && !event.target.closest('button, a')) {
      const idx = parseInt(detailRow.dataset.rank, 10);
      if (!Number.isNaN(idx)) _openDrawer(_displayedResultats[idx]);
      return;
    }

    if (event.target.closest('#scanner-export-csv')) {
      _exportScannerCsv(_getCurrentFilteredResults());
      return;
    }

    if (event.target.closest('#scanner-open-report')) {
      _openScannerGlobalReport(_getCurrentFilteredResults());
      return;
    }

    if (event.target.closest('#scanner-reset-filters-empty')) {
      _resetFilters();
    }
  });

  resultsContainer?.addEventListener('change', event => {
    const sortSelect = event.target.closest('#scanner-sort-select');
    if (sortSelect) {
      _sortKey = sortSelect.value || _sortKey;
      _applyTable();
      return;
    }

    const countSelect = event.target.closest('#scanner-count-select');
    if (countSelect) {
      const value = countSelect.value;
      const customInput = document.getElementById('scanner-count-custom');
      const setCustomVisible = visible => {
        if (!customInput) return;
        customInput.classList.toggle('scanner-count-custom--hidden', !visible);
        customInput.hidden = false;
      };

      if (value === 'all') {
        _displayCount = 'all';
        setCustomVisible(false);
        _applyTable();
      } else if (value === 'custom') {
        if (customInput) {
          setCustomVisible(true);
          customInput.focus();
        }
      } else {
        _displayCount = parseInt(value, 10);
        setCustomVisible(false);
        _applyTable();
      }
      return;
    }

    const customInput = event.target.closest('#scanner-count-custom');
    if (customInput) {
      const count = parseInt(customInput.value, 10);
      if (count > 0) {
        _displayCount = count;
        _applyTable();
      }
    }
  });

  document.getElementById('scanner-filters')?.addEventListener('change', () => {
    _updateFilterCount();
    _applyTable();
  });

  document.getElementById('scanner-filter-reset')?.addEventListener('click', () => _resetFilters());

  document.getElementById('scanner-filter-preset')?.addEventListener('change', event => {
    _selectedFilterPreset = event.target.value || 'all';
    _updateFilterCount();
    _applyTable();
  });

  document.getElementById('btn-voir-resultats')?.addEventListener('click', () => {
    if (_isMobileScannerFiltersMode()) {
      _setScannerFiltersDrawerOpen(false);
    }
    document.getElementById('scanner-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (_scannerFiltersDrawerOpen) {
        _setScannerFiltersDrawerOpen(false);
        return;
      }
      const drawer = document.getElementById('detail-drawer');
      if (drawer?.classList.contains('is-open')) {
        _closeDrawer();
      }
    }
  });

  window.addEventListener('resize', _syncScannerFiltersDrawerState);
  _syncScannerFiltersDrawerState();

  _initCPSelector();
  _initScanTargetSelector();

  // Pré-remplir Vierzon si aucune zone sauvegardée
  const _savedTarget = _loadScanTargetFromStorage();
  if (_savedTarget) {
    _setScanTarget(_savedTarget.cp, _savedTarget.commune, _savedTarget.label);
  } else {
    _loadCommunesData().then(() => {
      _setScanTarget('18100', 'Vierzon', 'Vierzon — 18100');
    });
  }

  _initFilterSections();
  _setScannerView('table');

  function _openFilterAndScroll(sectionIndex) {
    const sidebar = document.getElementById('scanner-filters');
    if (!sidebar) return;
    const sections = sidebar.querySelectorAll('.scanner-filter-section');
    if (sections[sectionIndex]) {
      if (_isMobileScannerFiltersMode()) {
        _setScannerFiltersDrawerOpen(true);
      }
      _setFilterSectionOpen(sections[sectionIndex], true);
      setTimeout(() => sections[sectionIndex].scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
    }
  }

  document.getElementById('qf-budget-btn')?.addEventListener('click', () => _openFilterAndScroll(4));
  document.getElementById('qf-pieces-btn')?.addEventListener('click', () => _openFilterAndScroll(0));
  document.getElementById('qf-surface-btn')?.addEventListener('click', () => _openFilterAndScroll(4));
  document.getElementById('qf-type-btn')?.addEventListener('click', () => _openFilterAndScroll(2));

  document.getElementById('tab-tableau')?.addEventListener('click', () => _setScannerView('table'));

  document.getElementById('tab-carte')?.addEventListener('click', () => _setScannerView('map'));

  // Rayon sélecteur
  document.querySelectorAll('input[name="scanner-rayon"]').forEach(radio => {
    if (Number(radio.value) === _scannerRayonKm) radio.checked = true;
    radio.addEventListener('change', () => {
      if (radio.checked) _setRayonKm(Number(radio.value));
    });
  });

  // Distance filter slider
  const distSlider = document.getElementById('scanner-dist-filter');
  const distLabelEl = document.getElementById('scanner-dist-filter-value');
  distSlider?.addEventListener('input', () => {
    _distanceFilterKm = Number(distSlider.value);
    if (distLabelEl) distLabelEl.textContent = _distanceFilterKm >= 50 ? 'Illimité' : `${_distanceFilterKm} km`;
    _applyTable();
  });
}

function _isMobileScannerFiltersMode() {
  return window.matchMedia('(max-width: 980px)').matches;
}

function _setScannerFiltersDrawerOpen(shouldOpen) {
  const sidebar = document.getElementById('scanner-filters');
  const backdrop = document.getElementById('scanner-filters-backdrop');
  const trigger = document.getElementById('btn-toggle-filters');
  if (!sidebar || !backdrop) return;

  const open = Boolean(shouldOpen) && _isMobileScannerFiltersMode();
  _scannerFiltersDrawerOpen = open;

  sidebar.classList.toggle('is-mobile-open', open);
  backdrop.hidden = !open;
  backdrop.classList.toggle('is-visible', open);
  document.body.classList.toggle('scanner-filters-open', open);
  if (trigger) trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function _syncScannerFiltersDrawerState() {
  if (!_isMobileScannerFiltersMode()) {
    _setScannerFiltersDrawerOpen(false);
  }
}

function _countActiveFilterSectionInputs(section) {
  if (!section) return 0;

  let activeCount = section.querySelectorAll('input[type="checkbox"]:checked').length;
  section.querySelectorAll('input[type="number"]').forEach(input => {
    if (_isNumericFilterInputActive(input.id)) {
      activeCount += 1;
    }
  });
  return activeCount;
}

function _setFilterSectionOpen(section, shouldOpen) {
  if (!section) return;
  const open = Boolean(shouldOpen);
  section.dataset.open = open ? 'true' : 'false';
  const title = section.querySelector('.scanner-filter-section-title');
  if (title) title.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function _getDefaultFilterSectionState(sectionIndex, section) {
  return _countActiveFilterSectionInputs(section) > 0 || [0, 2, 4].includes(sectionIndex);
}

function _refreshFilterSectionMeta() {
  document.querySelectorAll('#scanner-filters .scanner-filter-section').forEach(section => {
    const count = _countActiveFilterSectionInputs(section);
    const countNode = section.querySelector('.scanner-filter-section-count');
    if (countNode) {
      countNode.textContent = count > 0 ? String(count) : '';
      countNode.hidden = count === 0;
    }
    section.dataset.activeCount = count > 0 ? String(count) : '0';
  });
}

function _restoreDefaultFilterSections() {
  document.querySelectorAll('#scanner-filters .scanner-filter-section').forEach((section, index) => {
    _setFilterSectionOpen(section, _getDefaultFilterSectionState(index, section));
  });
}

function _initFilterSections() {
  document.querySelectorAll('#scanner-filters .scanner-filter-section').forEach((section, index) => {
    const title = section.querySelector('.scanner-filter-section-title');
    if (!title) return;

    if (!title.querySelector('.scanner-filter-section-label')) {
      const label = title.textContent.trim();
      title.textContent = '';

      const labelNode = document.createElement('span');
      labelNode.className = 'scanner-filter-section-label';
      labelNode.textContent = label;

      const metaNode = document.createElement('span');
      metaNode.className = 'scanner-filter-section-meta';

      const countNode = document.createElement('span');
      countNode.className = 'scanner-filter-section-count';
      countNode.hidden = true;

      const chevronNode = document.createElement('span');
      chevronNode.className = 'scanner-filter-section-chevron';
      chevronNode.setAttribute('aria-hidden', 'true');
      chevronNode.textContent = '▾';

      metaNode.append(countNode, chevronNode);
      title.append(labelNode, metaNode);
    }

    title.setAttribute('role', 'button');
    title.setAttribute('tabindex', '0');

    if (!title.dataset.bound) {
      title.addEventListener('click', () => {
        _setFilterSectionOpen(section, section.dataset.open !== 'true');
      });
      title.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          _setFilterSectionOpen(section, section.dataset.open !== 'true');
        }
      });
      title.dataset.bound = 'true';
    }

    _setFilterSectionOpen(section, _getDefaultFilterSectionState(index, section));
  });

  _refreshFilterSectionMeta();
}

function _setScannerView(view) {
  const isMapView = view === 'map';
  const mapContainer = document.getElementById('scanner-map-container');
  const resultsContainer = document.getElementById('scanner-results');
  const tableTab = document.getElementById('tab-tableau');
  const mapTab = document.getElementById('tab-carte');

  if (mapContainer) mapContainer.style.display = isMapView ? '' : 'none';
  if (resultsContainer) resultsContainer.style.display = isMapView ? 'none' : '';
  tableTab?.classList.toggle('is-active', !isMapView);
  mapTab?.classList.toggle('is-active', isMapView);

  if (isMapView) {
    _renderMap(_displayedResultats);
    setTimeout(() => _leafletMap?.invalidateSize(), 100);
  }
}

function _updateFilterCount() {
  let active = document.querySelectorAll('#scanner-filters input[type="checkbox"]:checked').length;
  for (const id of Object.keys(FILTER_NUMERIC_INPUTS)) {
    if (_isNumericFilterInputActive(id)) active++;
  }
  if (_selectedFilterPreset !== 'all') active++;
  if (_cpFilter) active++;

  const countEl = document.getElementById('scanner-filter-count');
  if (countEl) {
    const suffix = _selectedFilterPreset !== 'all' ? ` · preset ${FILTER_PRESET_LABELS[_selectedFilterPreset] || _selectedFilterPreset}` : '';
    countEl.textContent = active > 0 ? `${active} filtre${active > 1 ? 's' : ''} actif${active > 1 ? 's' : ''}${suffix}` : '';
  }

  const badge = document.getElementById('scanner-filter-count-badge');
  if (badge) {
    badge.textContent = active > 0 ? active : '';
    badge.style.display = active > 0 ? '' : 'none';
  }

  const resultCount = document.getElementById('filter-result-count');
  if (resultCount) {
    resultCount.textContent = _getCurrentFilteredResults().length;
  }

  _refreshFilterSectionMeta();
}

function _clearResultsCPFilter() {
  _cpFilter = null;
  const input = document.getElementById('cp-search');
  const badge = document.getElementById('cp-active-badge');
  const reset = document.getElementById('cp-reset');
  if (input) input.value = '';
  if (badge) {
    badge.textContent = '';
    badge.style.display = 'none';
  }
  if (reset) reset.style.display = 'none';
}

function _resetFilters({ clearCp = true } = {}) {
  document.querySelectorAll('#scanner-filters input[type="checkbox"]').forEach(cb => { cb.checked = false; });
  _selectedFilterPreset = 'all';

  const presetSelect = document.getElementById('scanner-filter-preset');
  if (presetSelect) presetSelect.value = 'all';

  ['range-prix-min', 'range-surface-min', 'range-cf', 'range-renta', 'range-dscr', 'range-score-min'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = el.min;
  });
  ['range-prix-max', 'range-surface-max'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = el.max;
  });
  Object.keys(FILTER_NUMERIC_INPUTS).forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  if (clearCp) _clearResultsCPFilter();

  _restoreDefaultFilterSections();
  _updateFilterCount();
  _applyTable();
}

function _setScannerResultsMeta(filteredCount, totalCount) {
  const meta = document.getElementById('scanner-results-meta');
  if (!meta) return;

  if (!totalCount) {
    meta.textContent = 'Choisis une zone pour préparer un scan ciblé.';
    return;
  }

  if (filteredCount === totalCount) {
    meta.textContent = `${totalCount} biens dans le lot courant, prêts pour la revue.`;
    return;
  }

  meta.textContent = `${filteredCount} biens retenus sur ${totalCount} dans la vue en cours.`;
}

function _formatActiveRange(label, minValue, maxValue, formatter) {
  const parts = [];
  if (minValue != null) parts.push(`min ${formatter(minValue)}`);
  if (maxValue != null) parts.push(`max ${formatter(maxValue)}`);
  return parts.length ? `${label} ${parts.join(' · ')}` : null;
}

function _renderActiveFilterBar(filters, filteredCount, totalCount) {
  const container = document.getElementById('scanner-active-filters');
  if (!container) return;

  _setScannerResultsMeta(filteredCount, totalCount);

  const badges = [];
  if (_cpFilter?.commune) badges.push(`Zone ${_cpFilter.cp} — ${_cpFilter.commune}`);
  else if (_cpFilter?.cp) badges.push(`Zone ${_cpFilter.cp}`);
  if (_selectedFilterPreset !== 'all') badges.push(`Preset ${FILTER_PRESET_LABELS[_selectedFilterPreset] || _selectedFilterPreset}`);
  if (filters.activeTypes.length) badges.push(`Type ${filters.activeTypes.map(value => value.charAt(0).toUpperCase() + value.slice(1)).join(', ')}`);
  if (filters.activePieces.length) badges.push(`Pièces ${filters.activePieces.map(value => value === 5 ? '5+' : value).join(', ')}`);
  if (filters.activeScores.size) badges.push(`Score ${[...filters.activeScores].join(', ')}`);
  if (filters.filterDpeSafe) badges.push('DPE A-D');
  if (filters.activeDpe.size) badges.push(`DPE ${[...filters.activeDpe].map(value => value.toUpperCase()).join(', ')}`);
  if (filters.filterCfPositif) badges.push('CF net positif');
  if (filters.filterCfAiPositif) badges.push('CF après impôt positif');
  if (filters.filterSansTravaux) badges.push('Sans travaux');
  if (filters.filterTravaux) badges.push('Avec travaux');
  if (filters.filterDejaLoue) badges.push('Déjà loué');
  if (filters.filterParking) badges.push('Parking');

  const budgetFilter = _formatActiveRange('Budget', filters.prixMin, filters.prixMax, _fmtEur);
  const surfaceFilter = _formatActiveRange('Surface', filters.surfaceMin, filters.surfaceMax, value => `${Math.round(value)} m²`);
  const rentaFilter = filters.rentaMin != null ? `Rendement brut min ${filters.rentaMin.toFixed(1)} %` : null;
  const cfFilter = filters.cfMin != null ? `CF net min ${_fmtEur(filters.cfMin)}` : null;
  const dscrFilter = filters.dscrMin != null ? `DSCR min ${filters.dscrMin.toFixed(2)}` : null;
  const scoreFilter = filters.scoreMin != null ? `Score min ${Math.round(filters.scoreMin)}/100` : null;

  [budgetFilter, surfaceFilter, rentaFilter, cfFilter, dscrFilter, scoreFilter]
    .filter(Boolean)
    .forEach(label => badges.push(label));

  if (!badges.length) {
    container.style.display = 'none';
    container.innerHTML = '';
    return;
  }

  const visibleBadges = badges.slice(0, 6);
  const remaining = badges.length - visibleBadges.length;
  const chipsHtml = visibleBadges.map(label => `<span class="scanner-active-filter-chip">${_esc(label)}</span>`).join('');
  const overflowChip = remaining > 0
    ? `<span class="scanner-active-filter-chip scanner-active-filter-chip--muted">+${remaining} filtre${remaining > 1 ? 's' : ''}</span>`
    : '';
  const excludedCount = Math.max(0, totalCount - filteredCount);

  container.innerHTML = `
    <div class="scanner-active-filters__summary">
      <strong>${filteredCount}</strong>
      <span>sur ${totalCount} biens dans la revue</span>
      ${excludedCount > 0 ? `<span class="scanner-active-filters__delta">${excludedCount} écarté${excludedCount > 1 ? 's' : ''}</span>` : ''}
    </div>
    <div class="scanner-active-filters__chips">${chipsHtml}${overflowChip}</div>
    <button id="scanner-active-filters-reset" type="button" class="scanner-btn scanner-btn--ghost scanner-btn--compact">Tout réinitialiser</button>
  `;
  container.style.display = '';
}

async function _startScan(endpoint) {
  if (_scanRunning || !_scanTarget) return;
  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code_postal: _scanTarget.cp,
        ville: _scanTarget.commune,
        rayon_km: _getScannerRayonKm(),
      }),
    });
    if (resp.status === 409) { alert('Un scan est déjà en cours.'); return; }
    if (!resp.ok) throw new Error(await resp.text());
    _scanRunning = true;
    _setButtonsDisabled(true);
    _showProgress(true);
    const progressTitle = document.getElementById('scanner-progress-title');
    if (progressTitle) progressTitle.textContent = 'Scan ciblé en cours';
    _setStatus('running', 'Scan en cours…');
    _startPolling();
  } catch (e) {
    alert('Erreur au démarrage du scan : ' + e.message);
  }
}

async function _startEnrich() {
  if (_scanRunning) return;
  try {
    const resp = await fetch(API.enrich, { method: 'POST' });
    if (resp.status === 409) { alert('Une opération est déjà en cours.'); return; }
    if (!resp.ok) throw new Error(await resp.text());
    _scanRunning = true;
    _setButtonsDisabled(true);
    _showProgress(true);
    const progressTitle = document.getElementById('scanner-progress-title');
    if (progressTitle) progressTitle.textContent = 'Enrichissement IA en cours';
    _setStatus('running', 'Analyse IA en cours…');
    _startPolling();
  } catch (e) {
    alert('Erreur au démarrage de l\'analyse IA : ' + e.message);
  }
}

async function _loadPendingCount() {
  try {
    const resp = await fetch(_buildScannerApiUrl(API.pendingCount).toString());
    if (!resp.ok) return;
    const { count } = await resp.json();
    const badge = document.getElementById('enrich-pending-badge');
    const btn   = document.getElementById('btn-enrich');
    if (badge) {
      if (count > 0) {
        badge.textContent = count;
        badge.style.display = '';
      } else {
        badge.style.display = 'none';
      }
    }
    if (btn) btn.disabled = count === 0 || _scanRunning;
  } catch (_) {}
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
        await _loadPendingCount();
        if (_scanTarget) {
          _setCPFilter(_scanTarget.cp, _scanTarget.commune, _scanTarget.label);
        }
      }
    }
  } catch (e) {
    console.error('Poll error', e);
  }
}

// ─── Résultats ────────────────────────────────────────────────────────────────

function _buildResultsUrl(limit, offset = 0) {
  const url = _buildScannerApiUrl(API.results);
  if (limit != null) {
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(offset));
  }
  return url.toString();
}

async function _fetchResultsPaginated() {
  let offset = 0;
  let stats = null;
  let generatedAt = null;
  let total = 0;
  let pages = 0;
  const resultats = [];

  while (true) {
    const resp = await fetch(_buildResultsUrl(RESULTS_PAGE_SIZE, offset));
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }

    const data = await resp.json();
    if (!data || !data.resultats) {
      return data;
    }

    if (!stats) stats = data.stats;
    if (!generatedAt) generatedAt = data.generated_at;

    const currentRows = data.resultats.map(_normalizeResultRow);
    resultats.push(...currentRows);
    pages += 1;

    const pagination = data.pagination || {};
    total = pagination.total ?? resultats.length;
    if (!pagination.has_more) {
      return {
        resultats,
        stats,
        generated_at: generatedAt,
        pagination: {
          total,
          loaded: resultats.length,
          pages,
          limit: pagination.limit ?? RESULTS_PAGE_SIZE,
          offset: 0,
          has_more: false,
        },
      };
    }

    offset += pagination.limit ?? RESULTS_PAGE_SIZE;
    _setStatus('running', `Chargement résultats ${Math.min(resultats.length, total)}/${total}…`);
  }
}

async function _loadResults(showEmpty) {
  try {
    const data = await _fetchResultsPaginated();
    if (!data || !data.resultats) {
      _resultsLoadInfo = { total: 0, loaded: 0, pages: 0 };
      _latestGeneratedAt = null;
      _renderScannerHero();
      if (showEmpty) _showEmpty(true);
      return;
    }

    const resultats = data.resultats;
    _resultsLoadInfo = {
      total: data.pagination?.total ?? resultats.length,
      loaded: data.pagination?.loaded ?? resultats.length,
      pages: data.pagination?.pages ?? 1,
    };
    _latestGeneratedAt = data.generated_at || null;

    _renderStats(data.stats, resultats);
    _renderTable(resultats);
    _showEmpty(false);
    document.getElementById('scanner-stats').style.display = '';
    document.getElementById('scanner-results').style.display = '';
    document.getElementById('scanner-view-tabs')?.style.setProperty('display', 'flex');
    document.getElementById('scanner-search-bar')?.style.setProperty('display', '');
    document.getElementById('scanner-content-layout')?.style.setProperty('display', 'grid');
    if (data.stats?.last_run || data.generated_at) {
      _setStatus('done', 'Dernier scan · ' + _fmtDatetime(data.generated_at));
    }
    const headerSub = document.getElementById('scanner-header-sub');
    if (headerSub && data.generated_at) {
      const pagesLabel = _resultsLoadInfo.pages > 1 ? ` · ${_resultsLoadInfo.pages} pages chargées` : '';
      headerSub.textContent = 'Centre-Val de Loire · Dernier scan : ' + _fmtDatetime(data.generated_at) + pagesLabel;
    }
  } catch (e) {
    _resultsLoadInfo = { total: 0, loaded: 0, pages: 0 };
    _renderScannerHero();
    if (showEmpty) _showEmpty(true);
  }
}

// ─── Rendu stats ─────────────────────────────────────────────────────────────

function _renderStats(stats, resultats = []) {
  if (!stats && !resultats.length) return;
  const totalBiens = resultats.length || stats?.nouvelles || 0;
  const enrichis = resultats.filter(r => r.ia_enrichi).length;
  const pendingIa = Math.max(0, totalBiens - enrichis);
  const cfAiMax = typeof stats?.meilleur_cf_apres_impot === 'number' ? stats.meilleur_cf_apres_impot : null;
  const dpeRisque = typeof stats?.dpe_risque === 'number' ? stats.dpe_risque : null;
  const solides = resultats.filter(resultat => {
    const tone = _getScannerDecision(resultat).tone;
    return tone === 'positive' || tone === 'excellent';
  }).length;
  const pagesNote = _resultsLoadInfo.pages > 1
    ? `${_resultsLoadInfo.pages} pages consolidées`
    : 'lot courant chargé';

  let lotHeadline = 'Lot à analyser';
  let lotDetail = 'La lecture détaillée se construit après enrichissement et classement des fiches.';
  if (pendingIa === totalBiens && totalBiens > 0) {
    lotHeadline = 'Analyse IA requise';
    lotDetail = `${pendingIa} fiche${pendingIa > 1 ? 's' : ''} attend${pendingIa > 1 ? 'ent' : ''} encore l IA avant lecture comparative.`;
  } else if (solides > 0) {
    lotHeadline = `${solides} dossier${solides > 1 ? 's' : ''} en décision favorable`;
    lotDetail = cfAiMax != null
      ? `Le meilleur CF après impôt atteint ${cfAiMax >= 0 ? '+' : ''}${_fmtEur(cfAiMax)}.`
      : 'Le lot comporte déjà des dossiers compatibles avec une revue détaillée.';
  } else if (dpeRisque > 0) {
    lotHeadline = 'Risque énergétique à cadrer';
    lotDetail = `${dpeRisque} annonce${dpeRisque > 1 ? 's' : ''} réclame${dpeRisque > 1 ? 'nt' : ''} une vérification DPE.`;
  } else if (enrichis > 0) {
    lotHeadline = 'Lot analysé';
    lotDetail = `${enrichis} fiche${enrichis > 1 ? 's' : ''} sont prêtes pour une revue détaillée.`;
  }

  document.getElementById('scanner-stats').innerHTML = `
    ${_statCard(totalBiens, 'Biens détectés', '', pagesNote)}
    ${_statCard(enrichis, 'Analyses IA prêtes', enrichis > 0 ? 'gold' : '', pendingIa > 0 ? `${pendingIa} encore à structurer` : 'analyse complète')}
    ${_statCard(solides, 'Décisions favorables', solides > 0 ? 'pos' : '', enrichis > 0 ? `${Math.round((solides / enrichis) * 100)} % des fiches analysées` : 'analyse IA requise')}
    ${_statCard(dpeRisque != null ? dpeRisque : '—', 'Alertes DPE', dpeRisque ? 'warn' : '', dpeRisque ? 'vérification énergétique requise' : 'aucune alerte dominante')}
    ${_statCard(lotHeadline, 'État du lot', 'gold', lotDetail, 'scanner-stat--insight')}
  `;

  _renderScannerHero();
}

function _updateScannerHeaderSub() {
  const sub = document.getElementById('scanner-header-sub');
  const chip = document.getElementById('scanner-zone-chip');
  const rayonKm = typeof _getScannerRayonKm === 'function' ? _getScannerRayonKm() : 5;
  const zone = _scanTarget ? `${_scanTarget.commune} ${_scanTarget.cp}` : 'Vierzon 18100';
  const count = _allResultats.length;
  const label = count
    ? `${zone} · ${rayonKm} km · ${count} bien${count > 1 ? 's' : ''}`
    : zone;
  if (sub) sub.textContent = label;
  if (chip) chip.textContent = zone;
}

function _renderScannerHero() {
  const container = document.getElementById('scanner-hero-summary');
  if (!container) return;

  const totalBiens = _allResultats.length;
  const readyCount = _allResultats.filter(result => result.ia_enrichi).length;
  const pendingCount = Math.max(0, totalBiens - readyCount);
  const solidCount = _allResultats.filter(result => {
    const tone = _getScannerDecision(result).tone;
    return tone === 'positive' || tone === 'excellent';
  }).length;
  const tone = _scanRunning
    ? 'watch'
    : solidCount > 0
      ? 'positive'
      : totalBiens > 0
        ? 'watch'
        : 'neutral';

  let title = 'Préparer un lot';
  let summary = 'Choisissez une zone, lancez un scan ciblé, puis filtrez le lot pour isoler les dossiers compatibles avec vos seuils.';
  let action = 'Définissez une zone puis lancez un scan pour constituer un premier lot.';

  if (_scanRunning) {
    title = 'Traitement du lot en cours';
    summary = `${_latestStatusLabel}. Le pipeline collecte, structure et classe les annonces en temps réel.`;
    action = 'Attendez la fin du traitement, puis passez en revue les fiches analysées.';
  } else if (totalBiens > 0) {
    title = solidCount > 0
      ? `${solidCount} dossier${solidCount > 1 ? 's' : ''} en décision favorable`
      : `${totalBiens} bien${totalBiens > 1 ? 's' : ''} dans le lot courant`;
    summary = readyCount > 0
      ? `${readyCount} fiche${readyCount > 1 ? 's' : ''} analysée${readyCount > 1 ? 's' : ''} sont déjà disponibles pour revue détaillée.`
      : 'Le lot est chargé, mais reste encore à structurer avant comparaison.';
    action = _scanTarget
      ? `Zone courante : ${_scanTarget.label}. Affinez ensuite les filtres pour réduire le bruit.`
      : 'Affinez la zone ou les filtres pour faire émerger un sous-ensemble exploitable.';
  }

  const zoneLabel = _scanTarget?.label || 'Zone à définir';
  const generatedLabel = _latestGeneratedAt ? _fmtDatetime(_latestGeneratedAt) : 'Pas de scan récent';
  const statusLabel = _latestStatusLabel || 'En attente';
  const pagesLoaded = totalBiens > 0 ? Math.max(1, _resultsLoadInfo.pages || 0) : 0;

  container.innerHTML = `
    <div class="workspace-hero-card workspace-hero-card--${tone}">
      <div class="workspace-hero-copy">
        <div class="workspace-hero-eyebrow">
          <span class="workspace-hero-kicker">Analyse scanner</span>
          <span class="workspace-hero-mode">${_esc(statusLabel)}</span>
          <span class="status-pill status-pill--${tone}">${_scanRunning ? 'Traitement en cours' : totalBiens > 0 ? 'Lot chargé' : 'En attente'}</span>
        </div>
        <h2>${_esc(title)}</h2>
        <p class="workspace-hero-summary">${_esc(summary)}</p>
        <div class="workspace-hero-action">
          <span>Action suivante</span>
          <strong>${_esc(action)}</strong>
        </div>
        <div class="workspace-hero-meta">
          <span class="workspace-hero-chip">Zone ${_esc(zoneLabel)}</span>
          <span class="workspace-hero-chip">Dernier scan ${_esc(generatedLabel)}</span>
          <span class="workspace-hero-chip">${_resultsLoadInfo.pages > 1 ? `${_resultsLoadInfo.pages} pages consolidées` : 'Lot courant prêt'}</span>
        </div>
      </div>
      <aside class="workspace-hero-score">
        <span class="workspace-hero-score-label">Lot courant</span>
        <strong class="workspace-hero-score-value workspace-hero-score-value--${tone}">${totalBiens}<small>${totalBiens > 1 ? ' biens' : ' bien'}</small></strong>
        <span class="decision-badge decision-badge--${tone}">${_scanRunning ? 'En cours' : totalBiens > 0 ? 'Chargé' : 'À lancer'}</span>
        <div class="workspace-hero-mini-grid">
          <article class="workspace-hero-mini-card">
            <span>Analyses prêtes</span>
            <strong>${readyCount}</strong>
          </article>
          <article class="workspace-hero-mini-card">
            <span>À structurer</span>
            <strong>${pendingCount}</strong>
          </article>
          <article class="workspace-hero-mini-card">
            <span>Décisions favorables</span>
            <strong>${solidCount}</strong>
          </article>
          <article class="workspace-hero-mini-card">
            <span>Pages chargées</span>
            <strong>${pagesLoaded}</strong>
          </article>
        </div>
      </aside>
    </div>
  `;
  _updateScannerHeaderSub();
}

function _statCard(val, label, cls, note = '', extraClass = '') {
  const toneClass = cls ? ` scanner-stat--${cls}` : '';
  return `<article class="workspace-hero-mini-card${toneClass}${extraClass ? ' ' + extraClass : ''}">
    <span>${_esc(label)}</span>
    <strong class="${cls || ''}">${_esc(String(val))}</strong>
    ${note ? `<div class="scanner-stat-note">${_esc(note)}</div>` : ''}
  </article>`;
}

// ─── Rendu tableau ────────────────────────────────────────────────────────────

function _renderTable(resultats) {
  _allResultats = resultats;
  _resultsById = new Map(resultats.map(result => [parseInt(result.bien_id, 10), result]));
  _detailCache = new Map();
  _summaryRowsById = new Map(resultats.map(result => {
    const summaryRow = _buildScannerSummaryRow(result);
    return [summaryRow.bienId, summaryRow];
  }));
  _summaryRenderCache = { signature: null, rows: [], html: '' };
  _renderScannerHero();
  _initRangeFilters(resultats);
  _applyTable();
  _updateScannerHeaderSub();
}

function _initRangeFilters(resultats) {
  if (!resultats.length) return;

  const prices = resultats.map(r => r.prix).filter(v => v != null);
  const surfaces = resultats.map(r => r.surface).filter(v => v != null);
  const cfs = resultats.map(r => r.cf_net).filter(v => v != null);

  const pMin = prices.length ? Math.floor(Math.min(...prices) / 1000) * 1000 : 0;
  const pMax = prices.length ? Math.ceil(Math.max(...prices) / 1000) * 1000 : 0;
  const sMin = surfaces.length ? Math.floor(Math.min(...surfaces) / 5) * 5 : 0;
  const sMax = surfaces.length ? Math.ceil(Math.max(...surfaces) / 5) * 5 : 0;
  const cfMin = cfs.length ? Math.floor(Math.min(...cfs) / 50) * 50 : 0;
  const cfMax = cfs.length ? Math.ceil(Math.max(...cfs) / 50) * 50 : 0;

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

function _matchFilters(r, filters) {
  if (!_matchCP(r)) return false;
  if (!_matchSelectedPreset(r)) return false;
  // Chips — Score par bande
  if (filters.activeScores.size > 0) {
    const band = r.score >= 80 ? 'excellent' : r.score >= 60 ? 'bon' : r.score >= 40 ? 'neutre' : r.score >= 20 ? 'attention' : 'faible';
    if (!filters.activeScores.has(band)) return false;
  }

  // Chips — Cash-flow
  if (filters.filterCfPositif && (r.cf_net == null || r.cf_net < 0)) return false;
  if (filters.filterCfNegatif && (r.cf_net == null || r.cf_net >= 0)) return false;
  if (filters.filterCfAiPositif && (r.cf_apres_impot == null || r.cf_apres_impot < 0)) return false;

  // Chips — DPE
  if (filters.activeDpe.size > 0 && !(r.dpe && filters.activeDpe.has(r.dpe.toLowerCase()))) return false;
  if (filters.filterDpeSafe && ['e','f','g'].includes((r.dpe || '').toLowerCase())) return false;

  // Chips — Type de bien
  if (filters.activeTypes.length > 0 && !(r.type_bien && filters.activeTypes.some(t => r.type_bien.toLowerCase().includes(t)))) return false;

  // Chips — État
  if (filters.filterDejaLoue && r.deja_loue !== true) return false;
  if (filters.filterTravaux && !r.travaux) return false;
  if (filters.filterSansTravaux && r.travaux) return false;
  if (filters.filterMeuble && r.meuble !== true) return false;

  // Chips — Source loyer
  if (filters.filterLoyerMarche && r.loyer_source !== 'marche') return false;
  if (filters.filterLoyerAnnonce && r.loyer_source !== 'annonce') return false;

  // Chips — Nb de pièces
  if (filters.activePieces.length > 0) {
    const p = r.nb_pieces != null ? r.nb_pieces : null;
    const match = filters.activePieces.some(v => v === 5 ? p != null && p >= 5 : p === v);
    if (!match) return false;
  }

  // Chips — Parking / Garage
  if (filters.filterParking && !r.parking_garage) return false;

  // Sliders numériques — Prix
  if (filters.prixMin != null && r.prix != null && r.prix < filters.prixMin) return false;
  if (filters.prixMax != null && r.prix != null && r.prix > filters.prixMax) return false;

  // Sliders numériques — Surface
  if (filters.surfaceMin != null && r.surface != null && r.surface < filters.surfaceMin) return false;
  if (filters.surfaceMax != null && r.surface != null && r.surface > filters.surfaceMax) return false;

  // Sliders numériques — Renta brute min
  if (filters.rentaMin != null && filters.rentaMin > 0 && (r.renta_brute == null || r.renta_brute < filters.rentaMin)) return false;

  // Sliders numériques — CF net min
  if (filters.cfMin != null && (r.cf_net == null || r.cf_net < filters.cfMin)) return false;

  // Sliders numériques — DSCR min
  if (filters.dscrMin != null && filters.dscrMin > 0 && (r.dscr == null || r.dscr < filters.dscrMin)) return false;

  // Sliders numériques — Score min
  if (filters.scoreMin != null && filters.scoreMin > 0 && (r.score == null || r.score < filters.scoreMin)) return false;

  return true;
}

function _matchDistance(r) {
  if (_distanceFilterKm >= 50) return true;
  const dist = _getDistanceKmFromVierzon(r.code_postal);
  if (dist == null) return true; // CP inconnu → ne pas exclure
  return dist <= _distanceFilterKm;
}

function _getCurrentFilteredResults(filters = _captureFilterSnapshot()) {
  return _allResultats.filter(r => _matchFilters(r, filters) && _matchDistance(r));
}

function _getSummarySignature(resultats) {
  return resultats.length ? resultats.map(result => result.bien_id).join('|') : 'empty';
}

function _getSummaryRenderCache(resultats) {
  const signature = _getSummarySignature(resultats);
  if (_summaryRenderCache.signature === signature) {
    return _summaryRenderCache;
  }

  const rows = _getScannerSummaryRows(resultats);
  const html = _renderGlobalOverviewTable(rows);
  _summaryRenderCache = { signature, rows, html };
  return _summaryRenderCache;
}

function _applyTable() {
  const filters = _captureFilterSnapshot();
  const filtered = _getCurrentFilteredResults(filters);
  const summaryRender = _getSummaryRenderCache(filtered);
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
  const filteredReadyCount = summaryRender.rows.filter(row => row.raw.ia_enrichi).length;
  const filteredDefendableCount = summaryRender.rows.filter(row => row.decisionTone === 'positive' || row.decisionTone === 'excellent').length;
  const sortLabel = DETAIL_SORT_OPTIONS.find(option => option.key === _sortKey)?.label
    ?? SORT_COLS.find(col => col.key === _sortKey)?.label
    ?? _sortKey;
  const dirArrow = _sortDir === -1 ? '↓' : '↑';
  const pagesLabel = _resultsLoadInfo.pages > 1 ? ` · ${_resultsLoadInfo.pages} pages chargées` : '';
  const sortDirectionLabel = _sortDir === -1 ? 'Décroissant' : 'Croissant';

  // Options du select d'affichage
  const countPresets = [10, 20, 50, 100];
  const isCustom = _displayCount !== 'all' && !countPresets.includes(_displayCount);
  const countOptions = [
    ...countPresets.map(n => `<option value="${n}" ${_displayCount === n ? 'selected' : ''}>${n} biens</option>`),
    `<option value="all" ${_displayCount === 'all' ? 'selected' : ''}>Tout (${total})</option>`,
    `<option value="custom" ${isCustom ? 'selected' : ''}>Personnalisé…</option>`,
  ].join('');

  const customValue = typeof _displayCount === 'number' ? _displayCount : Math.min(total || 1, 20);
  const customInput = `<input id="scanner-count-custom" type="number" min="1" max="${total}" value="${customValue}" class="scanner-count-custom${isCustom ? '' : ' scanner-count-custom--hidden'}">`;
  const sortOptions = DETAIL_SORT_OPTIONS.map(option => `
    <option value="${option.key}" ${_sortKey === option.key ? 'selected' : ''}>${option.label}</option>`).join('');

  const rows = _displayedResultats.map((r, i) => _renderRow(r, i + 1, i)).join('');
  const summaryTable = summaryRender.html;

  const container = document.getElementById('scanner-results');
  _renderActiveFilterBar(filters, total, _allResultats.length);

  if (total === 0) {
    container.innerHTML = `${summaryTable}`;
    return;
  }

  container.innerHTML = `
    ${summaryTable}
    <section class="scanner-detail-shell">
      <div class="scanner-detail-heading">
        <div class="scanner-overview__eyebrow">Analyse opérationnelle</div>
        <div class="scanner-detail-title">Revue détaillée du lot</div>
        <p class="scanner-detail-intro">${total} dossier${total > 1 ? 's' : ''} restent visibles avec le filtre courant. ${filteredReadyCount} sont déjà structurés par l IA et ${filteredDefendableCount} présentent actuellement une décision favorable.</p>
        <div class="scanner-detail-pills">
          <span class="scanner-detail-pill">Tri ${_esc(sortLabel)} ${dirArrow}</span>
          <span class="scanner-detail-pill">${shown}${shown < total ? ` sur ${total}` : ''} affiché${shown > 1 ? 's' : ''}</span>
          <span class="scanner-detail-pill">${_resultsLoadInfo.pages > 1 ? `${_resultsLoadInfo.pages} pages consolidées` : 'Lot courant consolidé'}</span>
        </div>
      </div>
      <div class="scanner-results-header scanner-results-header--detail">
        <div class="scanner-detail-toolbar__summary">
          <span class="scanner-detail-toolbar__count">${shown}</span>${shown < total ? ` / ${total}` : ''} biens en lecture active, ordonnés par <span class="scanner-detail-toolbar__sort">${sortLabel} ${dirArrow}</span>${pagesLabel}
        </div>
        <div class="scanner-detail-toolbar__controls">
          <span class="scanner-detail-toolbar__label">Ordonner par</span>
          <select id="scanner-sort-select" class="scanner-count-select">${sortOptions}</select>
          <button id="scanner-sort-direction" type="button" class="scanner-sort-direction">${dirArrow} ${sortDirectionLabel}</button>
          <span class="scanner-detail-toolbar__label">Afficher</span>
          <select id="scanner-count-select" class="scanner-count-select">${countOptions}</select>
          ${customInput}
        </div>
      </div>
      <div class="scanner-table-shell scanner-table-shell--detail">
        <div class="scanner-table-scroll scanner-table-scroll--detail">
    <table class="scanner-table scanner-table--detail">
      <thead>
        <tr>
          <th class="scanner-align-center">#</th>
          <th class="scanner-align-left">Bien</th>
          <th class="scanner-align-right">Prix</th>
          <th class="scanner-align-right">Loyer</th>
          <th class="scanner-align-right">CF après impôt</th>
          <th class="scanner-align-left">Solidité</th>
          <th class="scanner-align-left">Score</th>
          <th class="scanner-align-right">Actions</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
        </div>
      </div>
    </section>
  `;
}

function _analyserBien(r) {
  if (!r?.ia_enrichi) {
    alert('Lance d\'abord l\'analyse IA pour enrichir la fiche avant de l\'envoyer dans Saisie & Analyse.');
    return;
  }
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
  const cfSign = r.cf_net >= 0 ? '+' : '';
  const cfAi = r.cf_apres_impot;
  const cfAiSign = cfAi != null && cfAi >= 0 ? '+' : '';
  const cfTone = r.cf_net >= 0 ? 'positive' : 'negative';
  const cfAiTone = cfAi != null && cfAi >= 0 ? 'positive' : 'negative';

  const dscr = r.dscr;
  const dscrTone = dscr >= 1.2 ? 'positive' : dscr >= 1.0 ? 'watch' : 'negative';

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

  const scoreTone = r.score >= 80 ? 'excellent' : r.score >= 60 ? 'positive' : r.score >= 40 ? 'neutral' : r.score >= 20 ? 'watch' : 'negative';
  const scoreToneLabel = r.score >= 80 ? 'excellent' : r.score >= 60 ? 'solide' : r.score >= 40 ? 'neutre' : r.score >= 20 ? 'attention' : 'faible';

  const loyerSourceTone = r.loyer_source === 'annonce' ? 'info' : r.loyer_source === 'marche' ? 'positive' : 'watch';
  const loyerSourceLabel = r.loyer_source === 'annonce' ? 'annonce' : r.loyer_source === 'marche' ? 'marché' : 'estimé';
  const loyerNote = r.loyer_source === 'annonce'
    ? `<br><span class="scanner-inline-note scanner-inline-note--${loyerSourceTone}">${loyerSourceLabel}</span>`
    : r.loyer_source === 'marche'
    ? `<br><span class="scanner-inline-note scanner-inline-note--${loyerSourceTone}">${loyerSourceLabel}</span>`
    : `<br><span class="scanner-inline-note scanner-inline-note--${loyerSourceTone}">${loyerSourceLabel}</span>`;

  const surfaceLabel = r.surface
    ? `${r.surface.toFixed(0)} m²${r.surface_source === 'ia' ? '<sup class="scanner-inline-note scanner-inline-note--accent">IA</sup>' : ''}`
    : '—';

  const prixM2 = r.surface ? r.prix / r.surface : null;

  const nonEnrichi = !r.ia_enrichi;
  const actionBtnLabel = nonEnrichi ? 'IA requise' : '→ Analyser';
  const pendingBadge = nonEnrichi ? _renderScannerTonePill('En attente IA', 'pending') : '';
  const typeBien = _esc((r.type_bien || '').charAt(0).toUpperCase() + (r.type_bien || '').slice(1));
  const decision = _getScannerDecision(r);
  const regimeLabel = r.regime_optimal ? (REGIME_LABELS[r.regime_optimal] || r.regime_optimal) : 'Régime à confirmer';
  const dpeLabel = r.dpe ? `DPE ${String(r.dpe).toUpperCase()}` : 'DPE —';

  return `<tr class="scanner-detail-row${nonEnrichi ? ' scanner-detail-row--pending' : ''}" data-rank="${idx}">
    <td class="scanner-align-center scanner-detail-rank">${rank}</td>
    <td class="scanner-detail-cell scanner-detail-cell--property">
      <div class="scanner-detail-row__title">${_esc(r.titre)}</div>
      <div class="scanner-detail-row__meta">${_esc(r.ville)} · ${surfaceLabel}${r.nb_pieces ? ` · T${r.nb_pieces}` : ''} · ${typeBien}</div>
      <div class="scanner-detail-row__badges">${badges.join('')}${pendingBadge}</div>
      ${r.resume_ia ? `<div class="scanner-detail-row__note">${_esc(r.resume_ia)}</div>` : ''}
    </td>
    <td class="scanner-align-right scanner-detail-value">${_fmtEur(r.prix)}</td>
    <td class="scanner-align-right scanner-detail-value">${_fmtEur(r.loyer_estime)}${loyerNote}</td>
    <td class="scanner-align-right scanner-detail-value scanner-detail-value--${cfAiTone}">
      ${cfAi != null ? cfAiSign + _fmtEur(cfAi) : '—'}
      <div class="scanner-detail-row__aux scanner-detail-row__aux--${cfTone}">CF net ${cfSign}${_fmtEur(r.cf_net)}</div>
    </td>
    <td class="scanner-detail-cell">
      <div class="scanner-detail-row__decision">${_renderScannerTonePill(decision.label, decision.tone)}</div>
      <div class="scanner-detail-row__aux">DSCR ${dscr != null ? dscr.toFixed(2) : '—'} · ${r.renta_brute != null ? r.renta_brute.toFixed(1) + ' % brut' : 'Rendement —'}</div>
      <div class="scanner-detail-row__aux">${_esc(regimeLabel)} · ${_esc(dpeLabel)}</div>
    </td>
    <td class="scanner-detail-cell">
      ${r.score != null ? `<span class="scanner-score-badge scanner-score-badge--${scoreTone}">${r.score}/100 ${scoreToneLabel}</span>` : `<span class="scanner-tone-pill scanner-tone-pill--pending">En attente IA</span>`}
      <div class="scanner-detail-row__note">${_esc(_getScannerSignals(r))}</div>
    </td>
    <td class="scanner-align-right scanner-detail-cell">
      <div class="scanner-detail-actions">
        <a href="${_esc(r.url)}" target="_blank" class="scanner-link">Voir ↗</a>
        <button class="scanner-analyser-btn" data-rank="${idx}" ${nonEnrichi ? 'disabled title="Analyse IA requise"' : ''}>${actionBtnLabel}</button>
      </div>
    </td>
  </tr>`;
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

function _updateProgress(data) {
  const pct = data.progress ?? 0;
  const logs = data.logs ?? [];
  const lastLog = logs[logs.length - 1] ?? '…';
  const fill  = document.getElementById('scanner-progress-fill');
  const logEl = document.getElementById('scanner-log-line');
  const pctEl = document.getElementById('scanner-pct');
  const logsEl = document.getElementById('scanner-logs');
  if (fill)  fill.style.width = pct + '%';
  if (logEl) logEl.textContent = lastLog;
  if (pctEl) pctEl.textContent = pct + '%';
  if (logsEl) {
    logsEl.innerHTML = logs.map(l => `<div>${_esc(l)}</div>`).join('');
    logsEl.scrollTop = logsEl.scrollHeight;
  }
  _syncProgressStages(pct, lastLog);
}

function _showProgress(visible) {
  const el = document.getElementById('scanner-progress-wrap');
  if (el) el.style.display = visible ? '' : 'none';
  if (visible) {
    const logsEl = document.getElementById('scanner-logs');
    if (logsEl) logsEl.innerHTML = '';
    _setScannerLogsExpanded(false);
    _syncProgressStages(0, '');
  }
}

function _showEmpty(visible) {
  const el = document.getElementById('scanner-empty');
  if (el) el.style.display = visible ? '' : 'none';
  if (visible) {
    _allResultats = [];
    _displayedResultats = [];
    _renderScannerHero();
  }
  if (!visible) {
    document.getElementById('scanner-stats')?.style.setProperty('display', '');
    document.getElementById('scanner-results')?.style.setProperty('display', '');
    document.getElementById('scanner-cp-wrapper')?.style.setProperty('display', '');
  }
}

function _setStatus(state, label) {
  const chip = document.getElementById('scanner-status-chip');
  const lbl = document.getElementById('scanner-status-label');
  _latestStatusLabel = label;
  if (!chip || !lbl) return;
  chip.className = 'scanner-status-chip scanner-status--' + state;
  lbl.textContent = label;
  // Rendre le texte sélectionnable uniquement sur erreur (pour copier le message)
  lbl.style.userSelect = state === 'error' ? 'text' : '';
  lbl.style.webkitUserSelect = state === 'error' ? 'text' : '';
  _renderScannerHero();
}

function _setScannerLogsExpanded(expanded) {
  _scannerLogsExpanded = Boolean(expanded);
  const logs = document.getElementById('scanner-logs');
  const toggle = document.getElementById('scanner-log-toggle');
  if (logs) logs.hidden = !_scannerLogsExpanded;
  if (toggle) {
    toggle.setAttribute('aria-expanded', _scannerLogsExpanded ? 'true' : 'false');
    toggle.textContent = _scannerLogsExpanded ? 'Masquer le journal' : 'Journal détaillé';
  }
}

function _syncProgressStages(progress, lastLog) {
  const stages = [...document.querySelectorAll('#scanner-progress-stages .scanner-progress-stage')];
  if (!stages.length) return;

  const log = String(lastLog || '').toLowerCase();
  let activeIndex = 0;
  if (progress >= 100) activeIndex = 4;
  else if (log.includes('classe') || log.includes('score') || log.includes('decision') || progress >= 82) activeIndex = 3;
  else if (log.includes('qualif') || log.includes('filtr') || log.includes('calcul') || log.includes('enrich') || progress >= 55) activeIndex = 2;
  else if (log.includes('annonce') || log.includes('collect') || log.includes('scrap') || progress >= 22) activeIndex = 1;

  stages.forEach((stage, index) => {
    stage.classList.toggle('is-active', index === activeIndex);
    stage.classList.toggle('is-done', index < activeIndex);
  });
}

function _setButtonsDisabled(disabled) {
  const btn = document.getElementById('btn-clear-cache');
  if (btn) btn.disabled = disabled;
  const btnEnrich = document.getElementById('btn-enrich');
  if (btnEnrich) btnEnrich.disabled = disabled;
  _updateScanButtonsState();
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

async function _loadBienDetail(r) {
  if (!r?.bien_id) return r;

  const cached = _detailCache.get(r.bien_id);
  if (cached) {
    return _normalizeResultRow({ ...r, ...cached });
  }

  try {
    const resp = await fetch(_buildScannerApiUrl(API.bienDetail(r.bien_id)).toString());
    if (!resp.ok) return r;
    const detail = await resp.json();
    _detailCache.set(r.bien_id, detail);
    return _normalizeResultRow({ ...r, ...detail });
  } catch {
    return r;
  }
}

function _bindDrawerContent(content, r) {
  content.querySelector('#detail-close')?.addEventListener('click', _closeDrawer);
  content.querySelector('#detail-analyser-btn')?.addEventListener('click', () => {
    _closeDrawer();
    _analyserBien(r);
  });

  _loadPriceHistory(r.url, content.querySelector('#detail-historique'));
}

function _renderDrawerContent(content, r) {
  content.innerHTML = _renderDetailContent(r);
  _bindDrawerContent(content, r);
}

async function _openDrawer(r) {
  const overlay = document.getElementById('detail-overlay');
  const drawer  = document.getElementById('detail-drawer');
  const content = document.getElementById('detail-content');
  if (!overlay || !drawer || !content) return;

  if (_detailDrawerCloseTimer) {
    clearTimeout(_detailDrawerCloseTimer);
    _detailDrawerCloseTimer = null;
  }

  _drawerReturnFocusTarget = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;
  _activeDrawerBienId = r?.bien_id ?? null;
  _renderDrawerContent(content, { ...r, _detailLoading: true });
  overlay.style.display = 'block';
  drawer.style.display  = 'block';
  overlay.setAttribute('aria-hidden', 'false');
  document.body.classList.add('drawer-open');
  void overlay.offsetWidth;
  void drawer.offsetWidth;
  overlay.classList.add('is-open');
  drawer.classList.add('is-open');

  overlay.onclick = _closeDrawer;
  window.requestAnimationFrame(() => {
    content.querySelector('#detail-close')?.focus();
  });

  const detailedRow = await _loadBienDetail(r);
  if (_activeDrawerBienId !== r?.bien_id || drawer.style.display === 'none') {
    return;
  }
  _renderDrawerContent(content, detailedRow);
}

function _closeDrawer() {
  const overlay = document.getElementById('detail-overlay');
  const drawer  = document.getElementById('detail-drawer');
  const focusTarget = _drawerReturnFocusTarget && document.contains(_drawerReturnFocusTarget)
    ? _drawerReturnFocusTarget
    : null;
  _activeDrawerBienId = null;
  overlay?.classList.remove('is-open');
  drawer?.classList.remove('is-open');
  if (overlay) overlay.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('drawer-open');
  focusTarget?.focus();
  if (_detailDrawerCloseTimer) clearTimeout(_detailDrawerCloseTimer);
  _detailDrawerCloseTimer = setTimeout(() => {
    if (overlay) overlay.style.display = 'none';
    if (drawer) drawer.style.display = 'none';
    _drawerReturnFocusTarget = null;
    _detailDrawerCloseTimer = null;
  }, 220);
}

function _renderDetailContent(r) {
  const detailLoading = r._detailLoading === true;
  const decision = _getScannerDecision(r);
  const dpe = (r.dpe || '').toLowerCase();
  const dpeColors = { a:'#00a550',b:'#51b845',c:'#c8d200',d:'#ffcc00',e:'#f4a623',f:'#e3720c',g:'#cc0000' };
  const dpeColor  = dpeColors[dpe] || 'var(--muted)';
  const dpeAlerte = r.dpe_alerte
    ? `<span class="detail-chip detail-chip--alert" style="--detail-chip-color:${dpeColor}">${_esc(r.dpe_alerte[0])}</span>`
    : '';
  const detailDecision = _renderScannerTonePill(decision.label, decision.tone);
  const loadingChip = detailLoading ? '<span class="detail-chip detail-chip--muted">Chargement en cours</span>' : '';

  const loyerSourceLabel = r.loyer_source === 'annonce' ? 'loyer de l\'annonce'
    : r.loyer_source === 'marche' ? `loyer médian marché${r.loyer_marche_ref ? ` (${r.loyer_marche_ref} annonces ref.)` : ''}`
    : 'loyer estimé (taux fixe)';
  const loyerSourceColor = r.loyer_source === 'annonce' ? '#22d3ee' : r.loyer_source === 'marche' ? '#4ade80' : '#f59e0b';
  const scoreLabel = r.score != null ? `${r.score}/100` : 'IA requise';
  const scoreChip = `<span class="collection-table-chip">Score ${_esc(scoreLabel)}</span>`;
  const regimeChip = `<span class="collection-table-chip">${_esc(r.regime_optimal ? (REGIME_LABELS[r.regime_optimal] || r.regime_optimal) : 'Régime à confirmer')}</span>`;
  const loyerChip = `<span class="collection-table-chip">${_esc(loyerSourceLabel)}</span>`;
  const qualificationChip = `<span class="collection-table-chip">${r.ia_enrichi ? 'Analyse IA prête' : 'Analyse IA en attente'}</span>`;

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
      <article class="detail-regime-card${isOptimal ? ' is-optimal' : ''}" style="--detail-regime-color:${cfColor}">
        <div class="detail-regime-card__label">${_esc(reg.label)}</div>
        <div class="detail-regime-card__value">${cfStr}<span>/mois</span></div>
        <div class="detail-regime-card__note">${_esc(reg.note)}</div>
        ${isOptimal ? '<div class="detail-regime-card__flag">Meilleur régime</div>' : ''}
      </article>`;
  }).join('');

  // Points forts / faibles
  const ptsForts   = (r.points_forts  || []);
  const ptsFaibles = (r.points_faibles || []);
  const ptsFortHtml  = ptsForts.length
    ? ptsForts.map(p => `<li class="detail-points__item detail-points__item--positive">${_esc(p)}</li>`).join('')
    : '<li class="detail-points__item detail-points__item--empty">Aucun signal fort remonté.</li>';
  const ptsFaibleHtml = ptsFaibles.length
    ? ptsFaibles.map(p => `<li class="detail-points__item detail-points__item--negative">${_esc(p)}</li>`).join('')
    : '<li class="detail-points__item detail-points__item--empty">Aucun point bloquant remonté.</li>';
  const descriptionBrute = detailLoading && typeof r.description === 'undefined'
    ? '<span class="detail-raw__placeholder">Chargement du contenu brut…</span>'
    : r.description
    ? _esc(r.description).replace(/\n/g, '<br>')
    : '<span class="detail-raw__placeholder">Description brute indisponible.</span>';
  const analyseButton = r.ia_enrichi
    ? '<button id="detail-analyser-btn" class="detail-action-button detail-action-button--primary">Charger dans l étude</button>'
    : '<button id="detail-analyser-btn" class="detail-action-button detail-action-button--muted" disabled title="Analyse IA requise">Analyse IA requise</button>';

  return `
    <article class="detail-sheet${detailLoading ? ' detail-sheet--loading' : ''}">
      <header class="detail-sheet__header">
        <div class="detail-sheet__copy">
          <div class="detail-sheet__eyebrow">Fiche d'annonce</div>
          <h2 class="detail-sheet__title">${_esc(r.titre)}</h2>
          <div class="detail-sheet__meta">${_esc(r.ville)} · ${r.surface ? r.surface.toFixed(0) + ' m²' : '—'}${r.nb_pieces ? ' · T' + r.nb_pieces : ''} · ${_esc((r.type_bien || '').charAt(0).toUpperCase() + (r.type_bien || '').slice(1))} · <span>${_esc(r.site)}</span></div>
          <div class="asset-detail-chip-row">
            ${scoreChip}
            ${regimeChip}
            ${loyerChip}
            ${qualificationChip}
          </div>
        </div>
        <div class="detail-sheet__actions">
          ${loadingChip}
          ${detailDecision}
          ${dpeAlerte}
          <button id="detail-close" class="detail-close" type="button">Fermer</button>
        </div>
      </header>

      <section class="detail-kpi-grid">
      ${_detailCard(_fmtEur(r.prix), 'Prix')}
      ${_detailCard(_fmtEur(r.loyer_estime) + '/mois', 'Loyer', loyerSourceLabel, loyerSourceColor)}
      ${_detailCard(_fmtEur(r.mensualite) + '/mois', 'Mensualité crédit')}
      ${_detailCard(r.renta_brute != null ? r.renta_brute.toFixed(1) + ' %' : '—', 'Renta brute')}
      ${_detailCard(r.dscr != null ? r.dscr.toFixed(2) : '—', 'DSCR')}
      ${_detailCard(prixM2 != null ? prixM2.toLocaleString('fr-FR') + ' €/m²' : '—', 'Prix/m²')}
      </section>

      <section class="detail-section">
        <div class="detail-section__label">Comparaison régimes fiscaux</div>
        <div class="detail-regime-grid">${regimeHtml}</div>
      </section>

      <section class="detail-section detail-section--split">
        <div class="detail-section__pane">
          <div class="detail-section__label">Synthèse d arbitrage</div>
          <div class="decision-card asset-detail-card">
            <div class="decision-head">
              <span class="status-label">Verdict scanner</span>
              ${detailDecision}
            </div>
            <p class="analysis-verdict">${_esc(decision.summary)}</p>
            <p class="decision-hint">Action recommandée : <strong>${_esc(decision.action)}</strong></p>
            <div class="asset-detail-secondary-decision">
              <span>État de qualification</span>
              <strong class="status-pill status-pill--${r.ia_enrichi ? 'positive' : 'watch'}">${r.ia_enrichi ? 'IA prête' : 'Analyse à lancer'}</strong>
            </div>
          </div>
          <div class="detail-section__label">Lecture IA</div>
          <div class="detail-info-grid">
        ${_detailInfo('Travaux', r.travaux ? (r.travaux_montant ? '~' + _fmtEur(r.travaux_montant) : 'Oui') : 'Non')}
        ${_detailInfo('Chauffage', r.chauffage || '—')}
        ${_detailInfo('Meublé', r.meuble === true ? 'Oui' : r.meuble === false ? 'Non' : '—')}
        ${_detailInfo('Parking', r.parking_garage ? 'Oui' : 'Non')}
        ${r.immeuble_rapport && r.lots_total ? _detailInfo('Lots', `${r.lots_loues ?? '?'}/${r.lots_total} loués`) : ''}
        ${_detailInfo('Déjà loué', r.deja_loue === true ? 'Oui' : r.deja_loue === false ? 'Non' : '—')}
          </div>
          ${r.resume_ia ? `<blockquote class="detail-quote">${_esc(r.resume_ia)}</blockquote>` : ''}
        </div>
        <div class="detail-section__pane">
          <div class="detail-section__label">Forces et risques</div>
          <div class="detail-points-grid">
            <div class="detail-points-card">
              <div class="detail-points-card__title">Points forts</div>
              <ul class="detail-points">${ptsFortHtml}</ul>
            </div>
            <div class="detail-points-card">
              <div class="detail-points-card__title">Points faibles</div>
              <ul class="detail-points">${ptsFaibleHtml}</ul>
            </div>
          </div>
        </div>
      </section>

      <section class="detail-section">
        <div class="detail-section__label">Annonce brute</div>
        <div class="detail-raw">${descriptionBrute}</div>
      </section>

      <section class="detail-section">
        <div class="detail-section__label">Historique des prix</div>
        <div id="detail-historique" class="detail-history">Chargement…</div>
      </section>

      <footer class="detail-sheet__footer">
        ${analyseButton}
        <a href="${_esc(r.url)}" target="_blank" class="detail-action-link">Voir l annonce source ↗</a>
      </footer>
    </article>`;
}

function _detailCard(val, label, note = '', noteColor = 'var(--muted)') {
  return `<article class="detail-kpi-card">
    <div class="detail-kpi-card__value">${val}</div>
    <div class="detail-kpi-card__label">${_esc(label)}</div>
    ${note ? `<div class="detail-kpi-card__note" style="--detail-note-color:${noteColor}">${_esc(note)}</div>` : ''}
  </article>`;
}

function _detailInfo(label, val) {
  return `<div class="detail-info-card">
    <span class="detail-info-card__label">${_esc(label)}</span>
    <span class="detail-info-card__value">${_esc(String(val))}</span>
  </div>`;
}

// ─── Carte Leaflet ────────────────────────────────────────────────────────────

let _leafletMap = null;
let _leafletMarkers = null;

function _initMap() {
  if (_leafletMap) return;
  if (typeof L === 'undefined') return;

  _leafletMap = L.map('scanner-map', {
    center: [VIERZON_LAT, VIERZON_LNG],
    zoom: 10,
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 18,
  }).addTo(_leafletMap);

  _leafletMarkers = L.layerGroup().addTo(_leafletMap);

  _leafletMap.once('tileerror', () => {
    document.getElementById('scanner-map-offline').style.display = '';
  });

  _updateMapRadiusCircle();
}

let _mapRadiusCircle = null;

function _updateMapRadiusCircle() {
  if (!_leafletMap) return;
  if (_mapRadiusCircle) { _mapRadiusCircle.remove(); _mapRadiusCircle = null; }
  const rayonM = _getScannerRayonKm() * 1000;
  _mapRadiusCircle = L.circle([VIERZON_LAT, VIERZON_LNG], {
    radius: rayonM,
    color: '#D4AF37',
    fillColor: '#D4AF37',
    fillOpacity: 0.05,
    weight: 2,
  }).addTo(_leafletMap);
}

async function _renderMap(resultats) {
  if (typeof L === 'undefined') return;
  _initMap();
  _updateMapRadiusCircle();
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
      const diffClass = diff < 0 ? 'detail-history__diff--negative' : 'detail-history__diff--positive';
      const diffStr = diff < 0
        ? `<span class="${diffClass}">${diff.toLocaleString('fr-FR')} €</span>`
        : `<span class="${diffClass}">+${diff.toLocaleString('fr-FR')} €</span>`;
      return `<div class="detail-history__row">
        <span class="detail-history__date">${new Date(h.date_changement).toLocaleDateString('fr-FR')}</span>
        <span class="detail-history__price">${h.prix_nouveau.toLocaleString('fr-FR')} € ${diffStr}</span>
      </div>`;
    }).join('');
  } catch (e) {
    container.textContent = 'Erreur chargement historique.';
  }
}
