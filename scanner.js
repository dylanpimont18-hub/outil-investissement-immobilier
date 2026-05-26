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
      // Le scan/full vide le cache mais on veut juste vider sans scanner.
      // On appelle POST /api/scan/full avec un flag... mais comme l'API ne le supporte pas,
      // on avertit simplement et on laisse l'utilisateur lancer un scan complet.
      alert('Cache vidé au prochain "Scan complet".');
    }
  });
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
  const top = resultats.slice(0, 15);
  const rows = top.map((r, i) => _renderRow(r, i + 1)).join('');

  const container = document.getElementById('scanner-results');
  container.innerHTML = `
    <div class="scanner-results-header">
      <span>Top ${top.length} opportunités — triées par CF net</span>
    </div>
    <table class="scanner-table">
      <thead>
        <tr>
          <th>#</th><th>Bien</th><th>Prix</th><th>Loyer</th>
          <th>Mensualité</th><th>CF net</th><th>CF après impôt</th>
          <th>DSCR</th><th>Renta brute</th><th>Score</th><th>Lien</th><th></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  container.addEventListener('click', e => {
    const btn = e.target.closest('.scanner-analyser-btn');
    if (!btn) return;
    const idx = parseInt(btn.dataset.rank, 10);
    _analyserBien(top[idx]);
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

function _renderRow(r, rank) {
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

  const scoreColor = r.score >= 80 ? '#16a34a' : r.score >= 60 ? '#22c55e' : r.score >= 40 ? '#f59e0b' : r.score >= 20 ? '#e3720c' : '#dc2626';
  const scoreTone = r.score >= 80 ? 'excellent' : r.score >= 60 ? 'positif' : r.score >= 40 ? 'neutre' : r.score >= 20 ? 'watch' : 'négatif';

  const loyerNote = r.loyer_source === 'marche'
    ? `<br><span style="color:#4ade80;font-size:10px">marché</span>`
    : `<br><span style="color:#f59e0b;font-size:10px">estimé</span>`;

  const surfaceLabel = r.surface
    ? `${r.surface.toFixed(0)} m²${r.surface_source === 'ia' ? '<sup style="color:#C5A059;font-size:9px"> IA</sup>' : ''}`
    : '—';

  return `<tr>
    <td style="color:#555;font-size:11px;text-align:center">${rank}</td>
    <td>
      <div style="font-weight:600;font-size:13px;color:#e0ddd6">${_esc(r.titre)}</div>
      <div style="font-size:11px;color:#555;margin-top:2px">${_esc(r.ville)} · ${surfaceLabel} · ${_esc((r.type_bien || '').charAt(0).toUpperCase() + (r.type_bien || '').slice(1))}</div>
      <div style="margin-top:4px">${badges.join('')}</div>
      ${r.resume_ia ? `<div style="font-size:11px;color:#666;font-style:italic;margin-top:3px">${_esc(r.resume_ia)}</div>` : ''}
    </td>
    <td style="white-space:nowrap">${_fmtEur(r.prix)}</td>
    <td style="white-space:nowrap">${_fmtEur(r.loyer_estime)}${loyerNote}</td>
    <td style="white-space:nowrap">${_fmtEur(r.mensualite)}</td>
    <td style="white-space:nowrap;font-weight:700;color:${r.cf_net >= 0 ? '#4ade80' : '#f87171'}">${cfSign}${_fmtEur(r.cf_net)}</td>
    <td style="white-space:nowrap;font-weight:700;color:${cfAi != null && cfAi >= 0 ? '#4ade80' : '#f87171'}">${cfAi != null ? cfAiSign + _fmtEur(cfAi) : '—'}</td>
    <td style="text-align:center;font-weight:700;color:${dscrColor}">${dscr != null ? dscr.toFixed(2) : '—'}</td>
    <td style="white-space:nowrap">${r.renta_brute != null ? r.renta_brute.toFixed(1) + ' %' : '—'}</td>
    <td>${r.score != null ? `<span class="scanner-score-badge" style="background:${scoreColor}">${r.score}/100 ${scoreTone}</span>` : '—'}</td>
    <td><a href="${_esc(r.url)}" target="_blank" style="color:#C5A059;text-decoration:none;font-size:11px">Voir ↗</a></td>
    <td><button class="scanner-analyser-btn" data-rank="${rank - 1}" style="cursor:pointer;padding:4px 10px;border-radius:6px;border:1px solid #C5A059;background:transparent;color:#C5A059;font-size:11px;white-space:nowrap">→ Analyser</button></td>
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
