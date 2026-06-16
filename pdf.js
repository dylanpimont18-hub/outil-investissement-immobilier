function buildPDFParts(uploadedPhotos) {
    const projectName = document.getElementById('project-name').value.trim() || 'Investissement';
    const today = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });

    const scoreBanner = document.getElementById('score-banner');
    const scoreClass  = scoreBanner.className;
    const scoreLabel  = document.getElementById('score-label').innerText;
    const scoreStars  = document.getElementById('score-stars').innerText;
    const scoreDetail = document.getElementById('score-detail').innerText;

    const rentaBrute  = document.getElementById('renta-brute').innerText;
    const rentaNette  = document.getElementById('renta-nette').innerText;
    const rentaNetnet = document.getElementById('renta-netnet').innerText;
    const cfNetnetEl  = document.getElementById('cf-netnet');
    const cfNetnet    = cfNetnetEl.innerText;
    const cfIsNeg     = cfNetnetEl.classList.contains('negative');

    const outPrixNet     = document.getElementById('out-prix-net').innerText;
    const outFraisFixes  = document.getElementById('out-frais-fixes').innerText;
    const outCoutTotal   = document.getElementById('out-cout-total').innerText;
    const outFinancement = document.getElementById('out-financement').innerText;
    const outMensualite  = document.getElementById('out-mensualite').innerText;

    const cocVal  = document.getElementById('metric-coc').innerText;
    const grmVal  = document.getElementById('metric-grm').innerText;
    const dscrVal = document.getElementById('metric-dscr').innerText;
    const beVal   = document.getElementById('metric-breakeven').innerText;

    const bestRegimeEl    = document.querySelector('#regime-compare-grid .regime-best .regime-name');
    const bestRegimeLabel = bestRegimeEl ? bestRegimeEl.innerText.trim() : '—';

    const chartCanvas    = document.getElementById('cashflowChart');
    const chartImg       = chartCanvas ? chartCanvas.toDataURL('image/png') : null;
    const evolutionCanvas = document.getElementById('evolutionChart');
    const evolutionImg   = evolutionCanvas ? evolutionCanvas.toDataURL('image/png') : null;

    const regimeHTML          = document.getElementById('regime-compare-grid').innerHTML;
    const fiscalBreakdownHTML = document.getElementById('fiscal-breakdown').innerHTML;
    const optimizationHTML    = document.getElementById('optimization-tips-container').innerHTML;
    const negoHTML            = document.getElementById('nego-table-container').innerHTML;
    const projHTML            = document.getElementById('projection-tbody').innerHTML;
    const reventeSection      = document.getElementById('revente-results-section');
    const reventeVisible      = reventeSection && reventeSection.style.display !== 'none';
    const reventeSummary      = document.getElementById('revente-summary');
    const reventeTableBody    = document.getElementById('revente-tbody');

    const notesEl   = document.getElementById('commentaires-display');
    const notesText = notesEl ? notesEl.innerText.trim() : '';

    const verdictWhyEl  = document.getElementById('verdict-why');
    const verdictWhyRaw = verdictWhyEl ? verdictWhyEl.innerText.trim() : '';
    const verdictWhy    = verdictWhyRaw.length > 120 ? verdictWhyRaw.slice(0, 117) + '…' : verdictWhyRaw;

    const activePhotos = uploadedPhotos.filter(p => p);
    const photosHTML   = activePhotos.map(p => `<img src="${p}" class="r-photo-img">`).join('');

    let scoreBg = '#fffbeb', scoreBorder = '#f59e0b', scoreColor = '#92400e';
    if (scoreClass.includes('score-excellent') || scoreClass.includes('verdict--rentable')) {
      scoreBg = '#f0fdf4'; scoreBorder = '#22c55e'; scoreColor = '#166534';
    } else if (scoreClass.includes('score-bon') || scoreClass.includes('verdict--correct')) {
      scoreBg = '#eff6ff'; scoreBorder = '#3b82f6'; scoreColor = '#1e40af';
    } else if (scoreClass.includes('score-moyen') || scoreClass.includes('verdict--fragile')) {
      scoreBg = '#fffbeb'; scoreBorder = '#f59e0b'; scoreColor = '#92400e';
    } else if (scoreClass.includes('score-risque') || scoreClass.includes('verdict--eviter')) {
      scoreBg = '#fef2f2'; scoreBorder = '#ef4444'; scoreColor = '#991b1b';
    }

    const css = `
#pdf-render {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
    font-size: 11px;
    color: #1e293b;
    background: white;
    width: 680px;
    color-scheme: light;
}
#pdf-render * { box-sizing: border-box; margin: 0; padding: 0; }

/* ── EN-TÊTE ── */
#pdf-render .r-header {
    background: #1e3a5f;
    padding: 16px 20px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
    border-radius: 6px;
}
#pdf-render .r-title { font-size: 20px; font-weight: 800; color: #ffffff; letter-spacing: -0.3px; }
#pdf-render .r-sub   { font-size: 10px; color: rgba(255,255,255,0.60); margin-top: 3px; }
#pdf-render .r-date  { font-size: 9px; color: rgba(255,255,255,0.55); text-align: right; }

/* ── SCORE ── */
#pdf-render .r-score {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 11px 15px;
    border-radius: 7px;
    border: 1.5px solid ${scoreBorder};
    background: ${scoreBg};
    margin-bottom: 14px;
}
#pdf-render .r-score-l { font-size: 14px; font-weight: 800; color: ${scoreColor}; }
#pdf-render .r-score-r { font-size: 10px; font-weight: 500; color: ${scoreColor}; max-width: 380px; text-align: right; }

/* ── KPI GRID ── */
#pdf-render .r-kpi-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
    margin-bottom: 14px;
}
#pdf-render .r-kpi {
    border: 1px solid #e2e8f0;
    border-radius: 7px;
    padding: 10px 8px 9px;
    text-align: center;
    background: #fafafa;
    page-break-inside: avoid;
}
#pdf-render .r-kpi.gold { border-top: 3px solid #f59e0b; background: #fffbeb; }
#pdf-render .r-kpi.blue { border-top: 3px solid #3b82f6; background: #eff6ff; }
#pdf-render .r-kpi-lbl { font-size: 7.5px; text-transform: uppercase; letter-spacing: .6px; color: #64748b; margin-bottom: 5px; }
#pdf-render .r-kpi-val { font-size: 19px; font-weight: 800; color: #0f172a; line-height: 1.1; }
#pdf-render .r-kpi-val.neg { color: #ef4444; }
#pdf-render .r-kpi-val.pos { color: #16a34a; }
#pdf-render .r-kpi-s { font-size: 7px; color: #94a3b8; margin-top: 3px; }

/* ── RÉSUMÉ + GRAPHIQUE ── */
#pdf-render .r-summary-row { display: flex; gap: 10px; margin-bottom: 14px; }
#pdf-render .r-summary {
    flex: 1;
    border: 1px solid #e2e8f0;
    border-radius: 7px;
    padding: 12px 14px;
    background: white;
}
#pdf-render .r-summary h3 {
    font-size: 11px; font-weight: 700; color: #1e3a5f;
    margin-bottom: 9px; padding-bottom: 7px;
    border-bottom: 1px solid #e2e8f0;
}
#pdf-render .r-summary ul { list-style: none; }
#pdf-render .r-summary li {
    display: flex; justify-content: space-between;
    padding: 4.5px 0; border-bottom: 1px solid #f1f5f9;
    font-size: 9.5px; color: #475569;
}
#pdf-render .r-summary li:last-child { border-bottom: none; }
#pdf-render .r-summary li strong { font-weight: 700; color: #1e293b; }
#pdf-render .r-summary .total li { font-weight: 700; }
#pdf-render .r-summary .total strong { color: #1e3a5f; font-size: 10px; }
#pdf-render .r-chart {
    width: 148px; flex-shrink: 0;
    border: 1px solid #e2e8f0;
    border-radius: 7px; padding: 10px;
    display: flex; align-items: center; justify-content: center;
    background: #fafafa;
}
#pdf-render .r-chart img { width: 122px; height: 122px; object-fit: contain; }

/* ── CARTES SECTIONS ── */
#pdf-render .r-card {
    border: 1px solid #e2e8f0;
    border-left: 3px solid #3b82f6;
    border-radius: 7px;
    padding: 12px 14px;
    margin-bottom: 14px;
    background: white;
}
#pdf-render .r-card h3 {
    font-size: 11.5px; font-weight: 700; color: #1e3a5f;
    margin-bottom: 4px;
}
#pdf-render .r-card-sub { font-size: 8.5px; color: #94a3b8; margin-bottom: 10px; }

/* ── SAUTS DE PAGE ── */
#pdf-render .r-page-break { page-break-before: always; height: 1px; }

/* ── RÉGIMES ── */
#pdf-render .regime-compare-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px; margin-bottom: 10px;
}
#pdf-render .regime-card {
    border: 1px solid #e2e8f0; border-radius: 7px;
    padding: 10px; text-align: center; background: #fafafa;
    page-break-inside: avoid;
}
#pdf-render .regime-best { border-color: #22c55e; background: #f0fdf4; }
#pdf-render .regime-name { font-size: 7.5px; text-transform: uppercase; color: #64748b; letter-spacing: .5px; margin-bottom: 5px; }
#pdf-render .regime-cf   { font-size: 16px; font-weight: 800; margin-bottom: 3px; }
#pdf-render .regime-badge { font-size: 8px; color: #94a3b8; }

/* ── TABLEAU NÉGOCIATION ── */
#pdf-render .nego-table { width: 100%; border-collapse: collapse; font-size: 9.5px; }
#pdf-render .nego-table thead tr { background: #f1f5f9; }
#pdf-render .nego-table th {
    padding: 6px 8px; text-align: left;
    font-size: 7.5px; text-transform: uppercase; color: #64748b;
    letter-spacing: .5px; font-weight: 700;
    border-bottom: 2px solid #e2e8f0;
}
#pdf-render .nego-table td { padding: 5px 8px; border-bottom: 1px solid #f1f5f9; text-align: right; }
#pdf-render .nego-table td:first-child { text-align: left; font-weight: 600; }
#pdf-render .nego-table tbody tr:nth-child(even) { background: #f8fafc; }
#pdf-render .nego-table tr { page-break-inside: avoid; }
#pdf-render .nego-table tr:last-child td { border-bottom: none; }
#pdf-render .nego-table .nego-row-current { background: #eff6ff !important; }
#pdf-render .nego-table .nego-row-current td:first-child::after { content: ' ◀ actuel'; font-size: 7.5px; color: #3b82f6; font-weight: 700; }

/* ── TABLEAU PROJECTION ── */
#pdf-render .r-proj-table { width: 100%; border-collapse: collapse; font-size: 9.5px; }
#pdf-render .r-proj-table thead tr { background: #f1f5f9; }
#pdf-render .r-proj-table th {
    padding: 6px 8px; text-align: left;
    font-size: 7.5px; text-transform: uppercase; color: #64748b;
    letter-spacing: .5px; font-weight: 700;
    border-bottom: 2px solid #e2e8f0;
}
#pdf-render .r-proj-table td { padding: 5px 8px; border-bottom: 1px solid #f1f5f9; }
#pdf-render .r-proj-table tbody tr:nth-child(even) { background: #f8fafc; }
#pdf-render .r-proj-table tr { page-break-inside: avoid; }
#pdf-render .r-proj-table tr:last-child td { border-bottom: none; }

/* ── CONSEILS OPTIM ── */
#pdf-render .tip-card {
    display: flex; align-items: flex-start; gap: 9px;
    padding: 9px 11px; border: 1px solid #e2e8f0;
    border-left: 3px solid #3b82f6;
    border-radius: 7px; margin-bottom: 7px;
    page-break-inside: avoid; background: white;
}
#pdf-render .tip-card.tip-fiscal { border-left-color: #8b5cf6; }
#pdf-render .tip-card.tip-profit { border-left-color: #16a34a; }
#pdf-render .tip-icon { font-size: 13px; width: 20px; text-align: center; flex-shrink: 0; padding-top: 1px; }
#pdf-render .tip-content { flex: 1; min-width: 0; }
#pdf-render .tip-title { font-size: 9.5px; font-weight: 700; color: #1e3a5f; margin-bottom: 2px; }
#pdf-render .tip-explanation { font-size: 8.5px; color: #64748b; line-height: 1.55; }
#pdf-render .tip-gain { font-size: 9.5px; font-weight: 700; color: #16a34a; white-space: nowrap; flex-shrink: 0; padding-top: 1px; }
#pdf-render .tip-optimized { text-align: center; padding: 14px; color: #16a34a; font-weight: 700; font-size: 10px; }

/* ── FISCALITÉ ── */
#pdf-render .fiscal-breakdown-table { width: 100%; border-collapse: collapse; font-size: 8.5px; margin-top: 10px; }
#pdf-render .fiscal-breakdown-table thead tr { background: #f1f5f9; }
#pdf-render .fiscal-breakdown-table th {
    padding: 5px 6px; font-size: 7.5px; text-transform: uppercase;
    color: #64748b; letter-spacing: .3px; font-weight: 700;
    text-align: right; border-bottom: 2px solid #e2e8f0;
}
#pdf-render .fiscal-breakdown-table th:first-child { text-align: left; }
#pdf-render .fiscal-breakdown-table td { padding: 4.5px 6px; border-bottom: 1px solid #f1f5f9; text-align: right; }
#pdf-render .fiscal-breakdown-table td:first-child { text-align: left; color: #64748b; }
#pdf-render .fiscal-breakdown-table tr.fiscal-total td { font-weight: 700; border-top: 1.5px solid #e2e8f0; color: #1e3a5f; }
#pdf-render .fiscal-breakdown-table .fiscal-best { color: #16a34a; font-weight: 700; }
#pdf-render .fiscal-breakdown-table tr { page-break-inside: avoid; }

/* ── PHOTOS ── */
#pdf-render .r-photo-grid { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 10px; }
#pdf-render .r-photo-img  { width: calc(50% - 5px); height: 165px; object-fit: cover; border-radius: 6px; }

/* ── NOTES ── */
#pdf-render .r-notes { white-space: pre-wrap; font-size: 10px; line-height: 1.7; margin-top: 8px; color: #475569; }

/* ── OVERRIDES ESTHÉTIQUES ── */
#pdf-render {
  font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
  line-height: 1.45;
  color: #0f172a;
  background: #ffffff;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

#pdf-render .r-header {
  background: linear-gradient(135deg, #183458 0%, #21486f 55%, #102640 100%);
  padding: 20px 22px;
  margin-bottom: 18px;
  border-radius: 18px;
  box-shadow: 0 16px 36px rgba(15, 23, 42, 0.16);
}

#pdf-render .r-header-copy {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  position: relative;
  z-index: 1;
}

#pdf-render .r-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 9px;
  border-radius: 999px;
  background: rgba(255,255,255,0.14);
  color: rgba(255,255,255,0.84);
  font-size: 8px;
  font-weight: 700;
  letter-spacing: 1.1px;
  text-transform: uppercase;
  margin-bottom: 9px;
}

#pdf-render .r-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

#pdf-render .r-title {
  font-family: "Space Grotesk", "Inter", Arial, sans-serif;
  font-size: 26px;
  letter-spacing: -0.6px;
}

#pdf-render .r-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 4px 8px;
  border-radius: 999px;
  background: rgba(255,255,255,0.12);
  color: rgba(255,255,255,0.82);
  font-size: 7.4px;
  font-weight: 800;
  letter-spacing: .08em;
  text-transform: uppercase;
}

#pdf-render .r-sub {
  font-size: 11px;
  color: rgba(255,255,255,0.74);
  margin-top: 5px;
}

#pdf-render .r-date-wrap {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}

#pdf-render .r-date-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 4px 10px;
  border-radius: 999px;
  background: #c9a84c;
  color: #183458;
  font-size: 7.8px;
  font-weight: 800;
  letter-spacing: .9px;
  text-transform: uppercase;
}

#pdf-render .r-date-lbl {
  font-size: 7.4px;
  font-weight: 700;
  letter-spacing: .1em;
  text-transform: uppercase;
  color: rgba(255,255,255,0.62);
}

#pdf-render .r-date {
  font-size: 9.5px;
  color: rgba(255,255,255,0.7);
  line-height: 1.5;
}

#pdf-render .r-score {
  display: grid;
  grid-template-columns: 210px 1fr;
  gap: 16px;
  padding: 14px 16px;
  border-radius: 18px;
  border-width: 1px;
  margin-bottom: 16px;
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.08);
}

#pdf-render .r-score-l {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-start;
}

#pdf-render .r-score-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 5px 10px;
  border-radius: 999px;
  background: rgba(255,255,255,0.65);
  font-size: 8px;
  font-weight: 800;
  letter-spacing: .95px;
  text-transform: uppercase;
}

#pdf-render .r-score-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

#pdf-render .r-score-stars {
  font-family: "Space Grotesk", "Inter", Arial, sans-serif;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: .18em;
}

#pdf-render .r-score-r {
  max-width: none;
  text-align: left;
  font-size: 10.2px;
  line-height: 1.6;
}

#pdf-render .r-kpi-grid {
  gap: 10px;
  margin-bottom: 16px;
}

#pdf-render .r-kpi {
  border-radius: 16px;
  border: 1px solid #dbe5ef;
  padding: 13px 12px 12px;
  text-align: left;
  background: #ffffff;
  box-shadow: 0 12px 24px rgba(15, 23, 42, 0.06);
  min-height: 88px;
}

#pdf-render .r-kpi.gold {
  border-top: 4px solid #c9a84c;
  background: linear-gradient(180deg, #fff8e7 0%, #ffffff 100%);
}

#pdf-render .r-kpi.blue {
  border-top: 4px solid #2563eb;
  background: linear-gradient(180deg, #eff6ff 0%, #ffffff 100%);
}

#pdf-render .r-kpi-lbl {
  font-size: 6.9px;
  letter-spacing: .9px;
  margin-bottom: 8px;
}

#pdf-render .r-kpi-val {
  font-family: "Space Grotesk", "Inter", Arial, sans-serif;
  font-size: 21px;
  letter-spacing: -0.4px;
  margin-bottom: 2px;
}

#pdf-render .r-kpi-s {
  font-size: 7px;
  color: #94a3b8;
  margin-top: 5px;
}

#pdf-render .r-summary-row {
  gap: 12px;
  margin-bottom: 16px;
}

#pdf-render .r-summary,
#pdf-render .r-chart {
  border-radius: 18px;
  border: 1px solid #dbe5ef;
  box-shadow: 0 12px 24px rgba(15, 23, 42, 0.06);
}

#pdf-render .r-summary {
  padding: 14px 16px;
  background: #ffffff;
}

#pdf-render .r-summary h3 {
  font-size: 11.4px;
  margin-bottom: 10px;
  padding-bottom: 9px;
  border-bottom: 1px solid #e2e8f0;
}

#pdf-render .r-summary li {
  padding: 5.5px 0;
  font-size: 9.4px;
}

#pdf-render .r-summary li strong {
  color: #0f172a;
}

#pdf-render .r-chart {
  width: 160px;
  padding: 12px;
  background: linear-gradient(180deg, #f8fbff 0%, #ffffff 100%);
}

#pdf-render .r-chart img {
  width: 132px;
  height: 132px;
}

#pdf-render .r-card {
  position: relative;
  border-left: none;
  border-top: 4px solid #2563eb;
  border-radius: 18px;
  padding: 15px 16px 16px;
  margin-bottom: 16px;
  background: #ffffff;
  box-shadow: 0 14px 30px rgba(15, 23, 42, 0.06);
}

#pdf-render .r-card h3 {
  font-size: 12px;
  margin-bottom: 5px;
}

#pdf-render .r-card-sub {
  font-size: 8.4px;
  color: #94a3b8;
  margin-bottom: 11px;
}

#pdf-render .regime-compare-grid {
  gap: 10px;
  margin-bottom: 12px;
}

#pdf-render .regime-card {
  border-radius: 15px;
  padding: 12px 10px;
  background: #f8fbff;
  box-shadow: inset 0 0 0 1px #e2e8f0;
}

#pdf-render .regime-best {
  background: linear-gradient(180deg, #f0fdf4 0%, #ffffff 100%);
  box-shadow: inset 0 0 0 1px #86efac;
}

#pdf-render .regime-name {
  font-size: 7px;
  letter-spacing: .85px;
  margin-bottom: 6px;
}

#pdf-render .regime-cf {
  font-family: "Space Grotesk", "Inter", Arial, sans-serif;
  font-size: 17px;
}

#pdf-render .nego-table,
#pdf-render .r-proj-table,
#pdf-render .fiscal-breakdown-table {
  border-collapse: separate;
  border-spacing: 0;
}

#pdf-render .nego-table thead tr,
#pdf-render .r-proj-table thead tr,
#pdf-render .fiscal-breakdown-table thead tr {
  background: #183458;
}

#pdf-render .nego-table th,
#pdf-render .r-proj-table th,
#pdf-render .fiscal-breakdown-table th {
  color: rgba(255,255,255,0.92);
  border-bottom: none;
  padding: 7px 8px;
}

#pdf-render .nego-table th:first-child,
#pdf-render .r-proj-table th:first-child,
#pdf-render .fiscal-breakdown-table th:first-child {
  border-top-left-radius: 10px;
}

#pdf-render .nego-table th:last-child,
#pdf-render .r-proj-table th:last-child,
#pdf-render .fiscal-breakdown-table th:last-child {
  border-top-right-radius: 10px;
}

#pdf-render .nego-table td,
#pdf-render .r-proj-table td,
#pdf-render .fiscal-breakdown-table td {
  padding: 6px 8px;
}

#pdf-render .nego-table tbody tr:nth-child(even),
#pdf-render .r-proj-table tbody tr:nth-child(even),
#pdf-render .fiscal-breakdown-table tbody tr:nth-child(even) {
  background: #fafcff;
}

#pdf-render .nego-table .nego-row-current {
  background: #edf5ff !important;
}

#pdf-render .tip-card {
  padding: 11px 12px;
  border-radius: 14px;
  border-left-width: 4px;
  margin-bottom: 9px;
  background: #ffffff;
  box-shadow: 0 10px 22px rgba(15, 23, 42, 0.05);
}

#pdf-render .tip-title {
  font-size: 9.8px;
  margin-bottom: 3px;
}

#pdf-render .tip-explanation {
  font-size: 8.5px;
  line-height: 1.62;
}

#pdf-render .tip-gain {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 5px 8px;
  border-radius: 999px;
  background: #f0fdf4;
  margin-left: 6px;
}

#pdf-render .tip-optimized {
  border: 1px solid #bbf7d0;
  border-radius: 14px;
  background: #f0fdf4;
}

#pdf-render .fiscal-breakdown-table tr.fiscal-total td {
  color: #183458;
  background: #f8fbff;
}

#pdf-render .r-photo-grid {
  gap: 12px;
}

#pdf-render .r-photo-img {
  border-radius: 12px;
  box-shadow: 0 10px 20px rgba(15, 23, 42, 0.08);
}

#pdf-render .r-notes {
  margin-top: 10px;
  padding: 12px 14px;
  border-radius: 14px;
  background: #f8fbff;
  border: 1px solid #e2e8f0;
}

@media (max-width: 720px) {
  #pdf-render .r-header,
  #pdf-render .r-score,
  #pdf-render .r-summary-row {
    display: block;
  }

  #pdf-render .r-date-wrap {
    align-items: flex-start;
    margin-top: 12px;
  }

  #pdf-render .r-score-r {
    margin-top: 10px;
  }

  #pdf-render .r-chart {
    width: 100%;
    margin-top: 12px;
  }
}

/* ── RÉSUMÉ EXÉCUTIF ── */
#pdf-render .r-exec-summary {
  margin-bottom: 14px;
  padding: 12px 16px 10px;
  background: #f1f7ff;
  border: 1px solid #dbe5ef;
  border-radius: 14px;
}
#pdf-render .r-exec-title {
  font-size: 6.8px;
  text-transform: uppercase;
  letter-spacing: 1.1px;
  color: #64748b;
  font-weight: 800;
  margin-bottom: 8px;
}
#pdf-render .r-exec-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  margin-bottom: 8px;
}
#pdf-render .r-exec-item {
  display: flex;
  flex-direction: column;
  gap: 3px;
  text-align: center;
  padding: 4px 0;
}
#pdf-render .r-exec-item:not(:last-child) {
  border-right: 1px solid #dbe5ef;
}
#pdf-render .r-exec-lbl {
  font-size: 6.2px;
  text-transform: uppercase;
  letter-spacing: .8px;
  color: #94a3b8;
  font-weight: 700;
}
#pdf-render .r-exec-val {
  font-family: "Space Grotesk", "Inter", Arial, sans-serif;
  font-size: 10.5px;
  font-weight: 800;
  color: #0f172a;
  line-height: 1.2;
}
#pdf-render .r-exec-val.pos { color: #16a34a; }
#pdf-render .r-exec-val.neg { color: #ef4444; }
#pdf-render .r-exec-why {
  font-size: 8.5px;
  color: #475569;
  line-height: 1.5;
  border-top: 1px solid #dbe5ef;
  padding-top: 7px;
  font-style: italic;
}
`;

    const html = `
<div class="r-header">
  <div class="r-header-copy">
    <div class="r-eyebrow">Rapport complet</div>
    <div class="r-title-row">
      <div class="r-title">Investisseur Pro</div>
      <div class="r-pill">Version imprimable</div>
    </div>
    <div class="r-sub">${projectName}</div>
  </div>
  <div class="r-date-wrap">
    <div class="r-date-badge">Analyse locative</div>
    <div class="r-date-lbl">Généré le</div>
    <div class="r-date">${today}</div>
  </div>
</div>

<div class="r-exec-summary">
  <div class="r-exec-title">Ce bien en 30 secondes</div>
  <div class="r-exec-grid">
    <div class="r-exec-item">
      <div class="r-exec-lbl">Verdict</div>
      <div class="r-exec-val" style="color:${scoreColor}">${scoreLabel}</div>
    </div>
    <div class="r-exec-item">
      <div class="r-exec-lbl">Cash-Flow / mois</div>
      <div class="r-exec-val ${cfIsNeg ? 'neg' : 'pos'}">${cfNetnet}</div>
    </div>
    <div class="r-exec-item">
      <div class="r-exec-lbl">Renta nette-nette</div>
      <div class="r-exec-val">${rentaNetnet}</div>
    </div>
    <div class="r-exec-item">
      <div class="r-exec-lbl">Régime optimal</div>
      <div class="r-exec-val">${bestRegimeLabel}</div>
    </div>
  </div>
  ${verdictWhy ? `<div class="r-exec-why">${verdictWhy}</div>` : ''}
</div>

<div class="r-score">
  <div class="r-score-chip">Verdict</div>
  <div class="r-score-main">
    <div class="r-score-l">${scoreLabel}<span class="r-score-stars">${scoreStars}</span></div>
    <div class="r-score-r">${scoreDetail}</div>
  </div>
</div>

<div class="r-kpi-grid">
  <div class="r-kpi"><div class="r-kpi-lbl">Rentabilité Brute</div><div class="r-kpi-val">${rentaBrute}</div></div>
  <div class="r-kpi"><div class="r-kpi-lbl">Rentabilité Nette</div><div class="r-kpi-val">${rentaNette}</div></div>
  <div class="r-kpi gold"><div class="r-kpi-lbl">Renta. Nette-Nette</div><div class="r-kpi-val">${rentaNetnet}</div><div class="r-kpi-s">Après impôts</div></div>
  <div class="r-kpi blue"><div class="r-kpi-lbl">Cash-Flow Net-Net</div><div class="r-kpi-val ${cfIsNeg ? 'neg' : 'pos'}">${cfNetnet}</div><div class="r-kpi-s">Dans votre poche / mois</div></div>
</div>

<div class="r-kpi-grid">
  <div class="r-kpi"><div class="r-kpi-lbl">Cash-on-Cash</div><div class="r-kpi-val">${cocVal}</div><div class="r-kpi-s">Rendement sur apport</div></div>
  <div class="r-kpi"><div class="r-kpi-lbl">GRM</div><div class="r-kpi-val">${grmVal}</div><div class="r-kpi-s">Coût / loyers annuels</div></div>
  <div class="r-kpi"><div class="r-kpi-lbl">DSCR</div><div class="r-kpi-val">${dscrVal}</div><div class="r-kpi-s">Couverture de la dette</div></div>
  <div class="r-kpi"><div class="r-kpi-lbl">Break-even</div><div class="r-kpi-val">${beVal}</div><div class="r-kpi-s">CF cumulé positif</div></div>
</div>

<div class="r-summary-row">
  <div class="r-summary">
    <h3>Enveloppe Financière</h3>
    <ul>
      <li><span>Prix net vendeur estimé</span><strong>${outPrixNet} €</strong></li>
      <li><span>Frais fixes (Notaire, Travaux…)</span><strong>${outFraisFixes} €</strong></li>
      <li><span>Coût total de l'opération</span><strong>${outCoutTotal} €</strong></li>
      <li><span>Montant emprunté</span><strong>${outFinancement} €</strong></li>
      <li><span>Mensualité crédit + assurance</span><strong>${outMensualite} €</strong></li>
    </ul>
  </div>
  ${chartImg ? `<div class="r-chart"><img src="${chartImg}" alt="Répartition CF"></div>` : ''}
</div>

<div class="r-card">
  <h3>⚖️ Comparaison des Régimes Fiscaux</h3>
  <div class="r-card-sub">CF net-net mensuel estimé pour chaque régime avec vos paramètres actuels.</div>
  <div class="regime-compare-grid">${regimeHTML}</div>
  ${fiscalBreakdownHTML}
</div>

<div class="r-card">
  <h3>💡 Conseils d'Optimisation</h3>
  <div class="r-card-sub">Recommandations personnalisées basées sur vos chiffres.</div>
  ${optimizationHTML}
</div>

<div class="r-page-break"></div>

<div class="r-card" style="page-break-inside:auto;">
  <h3>📉 Impact de la Négociation sur le CF</h3>
  <div class="r-card-sub">CF net-net mensuel selon le niveau de négociation sur le prix affiché (0 → 25 %).</div>
  ${negoHTML}
</div>

${evolutionImg ? `
<div class="r-card">
  <h3>📈 Évolution sur 25 ans</h3>
  <div class="r-card-sub">Capital restant dû, cash-flow cumulé et enrichissement total.</div>
  <img src="${evolutionImg}" style="width:100%;max-height:210px;object-fit:contain;margin-top:8px;display:block;" alt="Évolution 25 ans">
</div>` : ''}

<div class="r-page-break"></div>

<div class="r-card" style="page-break-inside:auto;">
  <h3>📊 Projection Financière (25 ans)</h3>
  <div class="r-card-sub">Simulation année par année : capital amorti, capital restant, intérêts, impôts, cash-flow net.</div>
  <table class="r-proj-table">
    <thead>
      <tr>
        <th>Année</th>
        <th>Capital amorti</th>
        <th>Capital restant</th>
        <th>Intérêts</th>
        <th>Impôts</th>
        <th>CF net / an</th>
      </tr>
    </thead>
    <tbody>${projHTML}</tbody>
  </table>
</div>

${reventeVisible ? `
<div class="r-page-break"></div>
<div class="r-card" style="page-break-inside:auto;">
  <h3>💰 Quand Revendre ?</h3>
  <div class="r-card-sub">Simulation de sortie annuelle selon vos hypothèses de revente.</div>
  ${reventeSummary ? `<div style="font-size:9px;color:#64748b;margin-bottom:8px;">${reventeSummary.innerText}</div>` : ''}
  <table class="nego-table">
    <thead><tr><th>Année</th><th>Prix de vente</th><th>Frais</th><th>Impôt PV</th><th>Net vendeur</th><th>CRD</th><th>Cash net sortie</th><th>Gain global</th><th>Verdict</th></tr></thead>
    <tbody>${reventeTableBody ? reventeTableBody.innerHTML : ''}</tbody>
  </table>
</div>` : ''}

${notesText ? `
<div class="r-page-break"></div>
<div class="r-card">
  <h3>📝 Notes &amp; Commentaires</h3>
  <p class="r-notes">${notesText}</p>
</div>` : ''}

${activePhotos.length ? `
<div class="r-page-break"></div>
<div class="r-card">
  <h3>📷 Galerie Photos</h3>
  <div class="r-photo-grid">${photosHTML}</div>
</div>` : ''}

<div class="r-page-break"></div>
<div class="r-card" style="page-break-inside:auto;">
  <h3>Méthodologie — Définitions des indicateurs</h3>
  <div class="r-card-sub">Formules utilisées par ce simulateur. Résultats à titre indicatif, ne remplacent pas un conseil professionnel.</div>
  <table class="r-proj-table" style="font-size:8.5px;">
    <thead><tr><th style="width:22%">Indicateur</th><th style="width:42%">Formule simplifiée</th><th>Repères / Interprétation</th></tr></thead>
    <tbody>
      <tr><td>Renta Brute</td><td>Loyers annuels théoriques ÷ Coût total × 100</td><td>&gt; 7 % bon, &gt; 10 % très bon</td></tr>
      <tr><td>Renta Nette</td><td>(Loyers encaissés − Charges exploitation) ÷ Coût total × 100</td><td>&gt; 5 % correct, &gt; 7 % bon</td></tr>
      <tr><td>Renta Nette-Nette</td><td>(Loyers − Charges − Impôts Année 1) ÷ Coût total × 100</td><td>&gt; 4 % correct, &gt; 6 % bon</td></tr>
      <tr><td>Cash-Flow Net-Net</td><td>Loyers/12 − Mensualité totale − Charges/12 − Impôts/12</td><td>&gt; 0 = s'autofinance partiellement</td></tr>
      <tr><td>Cash-on-Cash</td><td>CF Net-Net annuel ÷ Apport × 100</td><td>Mesure l'effet de levier sur l'apport</td></tr>
      <tr><td>GRM</td><td>Coût total ÷ Loyers annuels théoriques</td><td>&lt; 14 bon, &lt; 20 correct, &gt; 20 cher</td></tr>
      <tr><td>DSCR</td><td>(Loyers encaissés − Charges) ÷ Mensualités annuelles</td><td>&gt; 1,0 couvert, &gt; 1,25 confortable banque</td></tr>
      <tr><td>Seuil rentabilité</td><td>Première année où CF cumulé &gt; 0</td><td>Plus tôt = plus sécurisé</td></tr>
      <tr><td>Équité An 1</td><td>Apport + Capital remboursé en Année 1</td><td>Patrimoine net réel dès la 1ère année</td></tr>
    </tbody>
  </table>
  <div style="margin-top:12px;font-size:8px;color:#64748b;line-height:1.5;">
    <strong>Régimes fiscaux :</strong> Micro-Foncier = Loyers × 70 % × (TMI + 17,2 %) · Foncier Réel = (Loyers − Charges − Intérêts) × (TMI + 17,2 %), déficit déductible jusqu'à 10 700 €/an · SCI-IS = Bénéfice comptable (après amortissement bâti 80 %/30 ans) taxé à 15 % jusqu'à 42 500 €, puis 25 %.
    <br><strong>Plus-value :</strong> Exonération IR à 22 ans de détention, PS à 30 ans (Micro/Réel). SCI-IS : IS sur plus-value comptable (reprise d'amortissements).
  </div>
  <p style="font-size:7.5px;color:#94a3b8;margin-top:10px;border-top:1px solid #e2e8f0;padding-top:8px;">Simulation indicative — outil d'aide à la décision uniquement. Ne remplace pas un conseil fiscal, juridique ou financier personnalisé.</p>
</div>
`;

    const projectSlug = (document.getElementById('project-name').value.trim() || 'InvestPro').replace(/\s+/g, '-');
    const filename = `Rapport-${projectSlug}.pdf`;

    return { css, html, filename };

}

export function buildPDFDOM(uploadedPhotos) {
    const { css, html, filename } = buildPDFParts(uploadedPhotos);

    const styleEl = document.createElement('style');
    styleEl.id = 'pdf-temp-style';
    styleEl.textContent = css;
    document.head.appendChild(styleEl);

    const mount = document.createElement('div');
    mount.id = 'pdf-render-mount';
    mount.setAttribute('aria-hidden', 'true');
    mount.style.cssText = 'position:fixed;top:0;left:-10000px;width:680px;background:white;pointer-events:none;';

    const container = document.createElement('div');
    container.id = 'pdf-render';
    container.style.cssText = 'width:680px;background:white;color-scheme:light;';
    container.innerHTML = html;

    mount.appendChild(container);
    document.body.appendChild(mount);
    void container.offsetHeight;

    return { mount, container, styleEl, filename };
}

export function cleanupPDFDOM(mount, styleEl) {
    if (mount)    mount.remove();
    if (styleEl)   styleEl.remove();
}

export function buildPrintDocument(uploadedPhotos) {
    const { css, html, filename } = buildPDFParts(uploadedPhotos);
    const title = filename.replace(/\.pdf$/i, '');
    const printBootstrap = `
  (function () {
    function waitForImages() {
      return Promise.all(Array.from(document.images).map(function(img) {
        if (img.complete) return Promise.resolve();
        return new Promise(function(resolve) {
          img.addEventListener('load', resolve, { once: true });
          img.addEventListener('error', resolve, { once: true });
        });
      }));
    }

    async function launchPrint() {
      if (document.fonts && document.fonts.ready) {
        try { await document.fonts.ready; } catch (err) {}
      }
      await waitForImages();
      window.focus();
      window.setTimeout(function() {
        window.print();
      }, 60);
    }

    window.addEventListener('load', function() {
      launchPrint();
    }, { once: true });

    window.addEventListener('afterprint', function() {
      window.close();
    });
  })();`;

    const assetBaseUrl = window.location.origin;

    const documentHTML = `<!DOCTYPE html>
  <html lang="fr">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
  ${buildLocalFontFaceCss(assetBaseUrl, { includeLegacyAliases: true })}
  ${css}

  html, body {
    margin: 0;
    padding: 0;
    background: linear-gradient(180deg, #eef4fb 0%, #dfe9f5 100%);
  }

  body {
    padding: 24px;
  }

  #pdf-render {
    margin: 0 auto;
    box-sizing: border-box;
    border-radius: 24px;
    box-shadow: 0 24px 60px rgba(15, 23, 42, 0.15);
  }

  @page {
    size: A4 portrait;
    margin: 10mm;
  }

  @media print {
    html, body {
      background: white;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    body {
      padding: 0;
    }

    #pdf-render {
      margin: 0;
      box-shadow: none;
      border-radius: 0;
    }
  }
    </style>
  </head>
  <body>
    <div id="pdf-render">${html}</div>
    <script>${printBootstrap}<\/script>
  </body>
  </html>`;

    return { documentHTML, filename };
}

function buildLocalFontFaceCss(assetBaseUrl, options = {}) {
    const { includeLegacyAliases = false } = options;
    const baseUrl = String(assetBaseUrl || '').replace(/\/$/, '');
    const fontUrl = fileName => `${baseUrl}/vendor/fonts/${fileName}`;

    const sharedFonts = `
@font-face {
  font-family: 'Cormorant Garamond';
  font-style: normal;
  font-weight: 500;
  font-display: swap;
  src: url('${fontUrl('CormorantGaramond-500.ttf')}') format('truetype');
}
@font-face {
  font-family: 'Cormorant Garamond';
  font-style: normal;
  font-weight: 600;
  font-display: swap;
  src: url('${fontUrl('CormorantGaramond-600.ttf')}') format('truetype');
}
@font-face {
  font-family: 'Cormorant Garamond';
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url('${fontUrl('CormorantGaramond-700.ttf')}') format('truetype');
}
@font-face {
  font-family: 'IBM Plex Mono';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url('${fontUrl('IBMPlexMono-400.ttf')}') format('truetype');
}
@font-face {
  font-family: 'IBM Plex Mono';
  font-style: normal;
  font-weight: 500;
  font-display: swap;
  src: url('${fontUrl('IBMPlexMono-500.ttf')}') format('truetype');
}
@font-face {
  font-family: 'IBM Plex Mono';
  font-style: normal;
  font-weight: 600;
  font-display: swap;
  src: url('${fontUrl('IBMPlexMono-600.ttf')}') format('truetype');
}
@font-face {
  font-family: 'Manrope';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url('${fontUrl('Manrope-400.ttf')}') format('truetype');
}
@font-face {
  font-family: 'Manrope';
  font-style: normal;
  font-weight: 500;
  font-display: swap;
  src: url('${fontUrl('Manrope-500.ttf')}') format('truetype');
}
@font-face {
  font-family: 'Manrope';
  font-style: normal;
  font-weight: 600;
  font-display: swap;
  src: url('${fontUrl('Manrope-600.ttf')}') format('truetype');
}
@font-face {
  font-family: 'Manrope';
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url('${fontUrl('Manrope-700.ttf')}') format('truetype');
}
@font-face {
  font-family: 'Manrope';
  font-style: normal;
  font-weight: 800;
  font-display: swap;
  src: url('${fontUrl('Manrope-800.ttf')}') format('truetype');
}
`;

    if (!includeLegacyAliases) {
        return sharedFonts;
    }

    return `${sharedFonts}
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url('${fontUrl('Manrope-400.ttf')}') format('truetype');
}
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 500;
  font-display: swap;
  src: url('${fontUrl('Manrope-500.ttf')}') format('truetype');
}
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 600;
  font-display: swap;
  src: url('${fontUrl('Manrope-600.ttf')}') format('truetype');
}
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url('${fontUrl('Manrope-700.ttf')}') format('truetype');
}
@font-face {
  font-family: 'Space Grotesk';
  font-style: normal;
  font-weight: 500;
  font-display: swap;
  src: url('${fontUrl('Manrope-600.ttf')}') format('truetype');
}
@font-face {
  font-family: 'Space Grotesk';
  font-style: normal;
  font-weight: 600;
  font-display: swap;
  src: url('${fontUrl('Manrope-700.ttf')}') format('truetype');
}
@font-face {
  font-family: 'Space Grotesk';
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url('${fontUrl('Manrope-800.ttf')}') format('truetype');
}`;
}

function escapeDecisionPdfHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatDecisionPdfMultiline(value) {
    return escapeDecisionPdfHtml(value).replace(/\n/g, '<br>');
}

function formatDecisionPdfCurrency(value) {
    if (!Number.isFinite(value)) {
        return '--';
    }

    return new Intl.NumberFormat('fr-FR', {
        style: 'currency',
        currency: 'EUR',
        maximumFractionDigits: 0
    }).format(Math.round(value)).replace(/\u00a0/g, ' ');
}

function formatDecisionPdfSignedCurrency(value) {
    const roundedValue = Math.round(Number(value) || 0);
    const label = formatDecisionPdfCurrency(Math.abs(roundedValue));

    if (roundedValue > 0) {
        return `+${label}`;
    }

    if (roundedValue < 0) {
        return `-${label}`;
    }

    return label;
}

function formatDecisionPdfRatio(value) {
    if (!Number.isFinite(value)) {
        return '--';
    }

    return value.toFixed(2);
}

function formatDecisionPdfPercent(value) {
    if (!Number.isFinite(value)) {
        return '--';
    }

    return `${value.toFixed(1)} %`;
}

function slugifyDecisionPdfLabel(value) {
    return String(value || 'Investissement')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80) || 'Investissement';
}

function getDecisionPdfToneClass(tone) {
    if (tone === 'positive' || tone === 'excellent' || tone === 'watch' || tone === 'negative') {
        return `tone-${tone}`;
    }

    return 'tone-neutral';
}

function getDecisionPdfChecklistState(status) {
    if (status === 'ready') {
        return { label: 'OK', tone: 'positive' };
    }

    if (status === 'watch') {
        return { label: 'A verifier', tone: 'watch' };
    }

    return { label: 'Bloquant', tone: 'negative' };
}

function buildDecisionPdfNotes(items, emptyLabel, emptyDetail) {
    if (!items || !items.length) {
        return `
            <li>
                <strong>${escapeDecisionPdfHtml(emptyLabel)}</strong>
                <p>${escapeDecisionPdfHtml(emptyDetail)}</p>
            </li>
        `;
    }

    return items.map(item => `
        <li>
            <strong>${escapeDecisionPdfHtml(item.label)}</strong>
            <p>${escapeDecisionPdfHtml(item.detail)}</p>
        </li>
    `).join('');
}

export function buildDecisionPrintDocument({ analysisModel, profileData, variablesData }) {
    const generatedOn = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
    const acquisitionDecision = analysisModel.acquisitionDecision;
    const acquisitionChecklist = analysisModel.acquisitionChecklist;
    const confidenceModel = analysisModel.confidenceModel;
    const scenarioModel = analysisModel.scenarioModel;
    const decisionJournal = analysisModel.decisionJournal;
    const decisionThresholds = analysisModel.decisionThresholds;
    const metrics = analysisModel.metrics;
    const filename = `Analyse-locative-${slugifyDecisionPdfLabel(variablesData['nom-bien'])}.pdf`;
    const thesis = decisionJournal.thesis || decisionJournal.suggestedThesis || 'Analyse non renseignée.';
    const nextStep = decisionJournal.nextStep || decisionJournal.suggestedNextStep || acquisitionDecision.action;
    const profileSummary = `${profileData.name || 'Profil'} · ${Math.round(profileData.income || 0).toLocaleString('fr-FR')} € / an · ${profileData.adults || 1} adulte${(profileData.adults || 1) > 1 ? 's' : ''} · ${profileData.children || 0} enfant${(profileData.children || 0) > 1 ? 's' : ''}`;
    const assetStatusLabel = variablesData['statut-bien'] === 'owned' ? 'Bien au portefeuille' : 'Dossier en analyse';
    const assetTypeLabel = variablesData['type-bien'] === 'maison'
      ? 'Maison'
      : variablesData['type-bien'] === 'immeuble'
        ? 'Immeuble de rapport'
        : 'Appartement';
    const decisionToneClass = getDecisionPdfToneClass(acquisitionDecision.tone);
    const scoreCardToneClass = decisionToneClass.replace('tone-', 'score-card--');
    const cfToneClass = metrics.cfNetNet >= 0 ? 'tone-positive' : 'tone-negative';
    const dscrToneClass = metrics.dscr >= decisionThresholds.minDscr ? 'tone-positive' : 'tone-watch';
    const confidenceToneClass = confidenceModel.score >= 70 ? 'tone-positive' : confidenceModel.score >= 45 ? 'tone-watch' : 'tone-negative';
    const robustnessToneClass = getDecisionPdfToneClass(scenarioModel.tone);
    const assetBaseUrl = typeof window !== 'undefined' ? window.location.origin : '';

    const checklistMarkup = (acquisitionChecklist.items || []).map(item => {
        const checklistState = getDecisionPdfChecklistState(item.status);
        return `
            <li>
                <div>
                    <strong>${escapeDecisionPdfHtml(item.label)}</strong>
                    <p>${escapeDecisionPdfHtml(item.detail)}</p>
                </div>
                <span class="pill ${getDecisionPdfToneClass(checklistState.tone)}">${escapeDecisionPdfHtml(checklistState.label)}</span>
            </li>
        `;
    }).join('');

    const scenarioMarkup = (scenarioModel.scenarios || []).map(item => `
        <article class="scenario-card ${getDecisionPdfToneClass(item.tone)}">
            <div class="scenario-head">
                <strong>${escapeDecisionPdfHtml(item.label)}</strong>
                <span class="pill ${getDecisionPdfToneClass(item.tone)}">${escapeDecisionPdfHtml(item.matrixLabel)}</span>
            </div>
            <p>${escapeDecisionPdfHtml(item.description)}</p>
            <div class="scenario-metrics">
                <span>CF ${escapeDecisionPdfHtml(formatDecisionPdfSignedCurrency(item.cfNetNet))}</span>
                <span>DSCR ${escapeDecisionPdfHtml(formatDecisionPdfRatio(item.dscr))}</span>
            </div>
        </article>
    `).join('');

    const documentHTML = `<!DOCTYPE html>
  <html lang="fr">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeDecisionPdfHtml(filename.replace(/\.pdf$/i, ''))}</title>
    <style>
      ${buildLocalFontFaceCss(assetBaseUrl)}
      :root {
        color-scheme: light;
        --paper: #f3f6fa;
        --paper-deep: #e8eef5;
        --surface: #ffffff;
        --surface-soft: #f6f9fc;
        --surface-muted: #edf3f8;
        --text: #17202a;
        --muted: #5b6673;
        --border: rgba(23, 32, 42, 0.12);
        --accent: #2f6e8e;
        --accent-strong: #1f536e;
        --accent-soft: rgba(47, 110, 142, 0.10);
        --success: #2d6a4f;
        --success-soft: rgba(45, 106, 79, 0.10);
        --watch: #9a6700;
        --watch-soft: rgba(154, 103, 0, 0.12);
        --danger: #b42318;
        --danger-soft: rgba(180, 35, 24, 0.10);
        --neutral-soft: rgba(91, 102, 115, 0.10);
        --shadow-soft: 0 10px 24px rgba(15, 23, 42, 0.06);
        --shadow-lift: 0 12px 28px rgba(15, 23, 42, 0.08);
      }

      * {
        box-sizing: border-box;
      }

      html, body {
        margin: 0;
        padding: 0;
        background: linear-gradient(180deg, var(--paper) 0%, var(--paper-deep) 100%);
        color: var(--text);
        font-family: 'Manrope', sans-serif;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }

      body {
        padding: 22px;
      }

      .sheet {
        max-width: 980px;
        margin: 0 auto;
        display: grid;
        gap: 18px;
      }

      .hero,
      .panel,
      .metric-card,
      .score-card,
      .scenario-card,
      .journal-box {
        position: relative;
        overflow: hidden;
        border: 1px solid var(--border);
        border-radius: 16px;
        background: var(--surface);
        box-shadow: var(--shadow-soft);
        break-inside: avoid;
        page-break-inside: avoid;
      }

      .hero {
        display: grid;
        grid-template-columns: minmax(0, 1.65fr) minmax(260px, 0.92fr);
        gap: 18px;
        padding: 22px;
        background: linear-gradient(180deg, var(--surface-soft) 0%, var(--surface) 100%);
        box-shadow: var(--shadow-lift);
      }

      .hero::after {
        display: none;
      }

      .hero-copy,
      .score-panel {
        position: relative;
        z-index: 1;
      }

      .eyebrow,
      .hero-badge,
      .meta-chip,
      .label,
      .journal-label,
      .panel-kicker,
      .pill {
        font-family: 'IBM Plex Mono', monospace;
        text-transform: uppercase;
        letter-spacing: 0.12em;
      }

      .eyebrow-row {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
        margin-bottom: 12px;
      }

      .eyebrow {
        margin: 0;
        display: inline-flex;
        align-items: center;
        gap: 10px;
        font-size: 11px;
        color: var(--accent-strong);
      }

      .eyebrow::before {
        content: '';
        width: 28px;
        height: 1px;
        background: var(--border);
      }

      .hero-badge,
      .meta-chip {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 30px;
        padding: 6px 12px;
        border-radius: 999px;
        border: 1px solid var(--border);
        background: var(--surface-soft);
        color: var(--muted);
        font-size: 10px;
      }

      .hero h1,
      .panel h2 {
        margin: 0;
        font-family: 'Manrope', sans-serif;
        font-weight: 700;
        letter-spacing: -0.03em;
        color: var(--text);
      }

      .hero h1 {
        max-width: 14ch;
        font-size: 38px;
        line-height: 1;
      }

      .hero-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin: 16px 0 0;
      }

      .hero .summary,
      .panel-note,
      .bullet-list p,
      .checklist-list p,
      .journal-note,
      .scenario-card p,
      .footer-note,
      .hero-ledger-item p,
      .score-note,
      .metric-note {
        color: var(--muted);
        line-height: 1.68;
      }

      .hero .summary {
        margin: 18px 0 0;
        font-size: 15px;
        color: var(--muted);
        max-width: 60ch;
      }

      .hero .action {
        margin: 16px 0 0;
        padding: 14px 16px;
        border-radius: 14px;
        border: 1px solid var(--border);
        background: var(--surface-soft);
      }

      .hero .action strong {
        display: block;
        margin-bottom: 6px;
        font-family: 'IBM Plex Mono', monospace;
        font-size: 10px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--muted);
      }

      .hero-ledger {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
        margin-top: 16px;
      }

      .hero-ledger-item {
        padding: 14px 15px;
        border: 1px solid var(--border);
        border-radius: 14px;
        background: var(--surface-soft);
      }

      .hero-ledger-item strong {
        display: block;
        margin-top: 8px;
        font-size: 14px;
        color: var(--text);
      }

      .hero-ledger-item p {
        margin: 8px 0 0;
        font-size: 12px;
      }

      .score-panel {
        display: grid;
        gap: 12px;
        align-content: start;
      }

      .score-card {
        padding: 18px;
        background: var(--surface);
      }

      .score-card--primary {
        padding: 20px;
      }

      .score-card--primary::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 4px;
        background: var(--accent);
      }

      .score-card--positive::before,
      .score-card--excellent::before {
        background: var(--success);
      }

      .score-card--watch::before {
        background: var(--watch);
      }

      .score-card--negative::before {
        background: var(--danger);
      }

      .label,
      .journal-label,
      .panel-kicker {
        font-size: 10px;
        color: var(--muted);
      }

      .score-value {
        margin-top: 10px;
        font-family: 'Manrope', sans-serif;
        font-size: 46px;
        font-weight: 700;
        line-height: 0.92;
        letter-spacing: -0.05em;
        color: var(--accent-strong);
      }

      .score-card--positive .score-value,
      .score-card--excellent .score-value {
        color: var(--success);
      }

      .score-card--watch .score-value {
        color: var(--watch);
      }

      .score-card--negative .score-value {
        color: var(--danger);
      }

      .score-value small {
        font-size: 18px;
      }

      .score-card--primary .pill {
        margin-top: 12px;
      }

      .score-note {
        margin: 12px 0 0;
        font-size: 13px;
      }

      .score-pill-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 12px;
      }

      .panel,
      .metric-card {
        padding: 18px;
      }

      .panel--metrics {
        padding: 18px;
      }

      .panel-head {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 14px;
      }

      .panel-note {
        margin: 10px 0 0;
        font-size: 13px;
      }

      .metric-grid,
      .panel-grid,
      .scenario-grid {
        display: grid;
        gap: 16px;
      }

      .panel--metrics .metric-grid {
        margin-top: 16px;
        gap: 12px;
      }

      .metric-grid {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }

      .metric-card {
        min-height: 110px;
        border-radius: 14px;
        background: var(--surface);
      }

      .metric-card strong {
        display: block;
        margin-top: 10px;
        font-family: 'Manrope', sans-serif;
        font-size: 25px;
        font-weight: 700;
        letter-spacing: -0.04em;
        line-height: 1.08;
        color: var(--text);
      }

      .metric-note {
        display: block;
        margin-top: 8px;
        font-size: 12px;
      }

      .metric-card--ink {
        background: var(--surface);
      }

      .metric-card--accent {
        border-color: rgba(47, 110, 142, 0.22);
        background: linear-gradient(180deg, var(--surface-soft) 0%, var(--surface) 100%);
      }

      .metric-card--accent strong {
        color: var(--accent-strong);
      }

      .metric-card.tone-positive,
      .metric-card.tone-excellent,
      .scenario-card.tone-positive,
      .scenario-card.tone-excellent {
        color: var(--text);
        border-color: rgba(46, 106, 74, 0.22);
        background: linear-gradient(180deg, #f4faf7 0%, var(--surface) 100%);
      }

      .metric-card.tone-positive strong,
      .metric-card.tone-excellent strong {
        color: var(--success);
      }

      .metric-card.tone-watch,
      .scenario-card.tone-watch {
        color: var(--text);
        border-color: rgba(160, 109, 21, 0.24);
        background: linear-gradient(180deg, #fff9f0 0%, var(--surface) 100%);
      }

      .metric-card.tone-watch strong {
        color: var(--watch);
      }

      .metric-card.tone-negative,
      .scenario-card.tone-negative {
        color: var(--text);
        border-color: rgba(185, 75, 75, 0.22);
        background: linear-gradient(180deg, #fff6f5 0%, var(--surface) 100%);
      }

      .metric-card.tone-negative strong {
        color: var(--danger);
      }

      .panel-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .panel h2 {
        font-size: 28px;
        line-height: 0.96;
      }

      .pill {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 28px;
        padding: 5px 10px;
        border-radius: 999px;
        border: 1px solid transparent;
        font-size: 10px;
      }

      .tone-positive,
      .tone-excellent {
        background: var(--success-soft);
        color: var(--success);
        border-color: rgba(46, 106, 74, 0.18);
      }

      .tone-watch {
        background: var(--watch-soft);
        color: var(--watch);
        border-color: rgba(160, 109, 21, 0.18);
      }

      .tone-negative {
        background: var(--danger-soft);
        color: var(--danger);
        border-color: rgba(185, 75, 75, 0.16);
      }

      .tone-neutral {
        background: var(--neutral-soft);
        color: var(--muted);
        border-color: rgba(109, 102, 92, 0.12);
      }

      .bullet-list,
      .checklist-list,
      .mini-list {
        list-style: none;
        padding: 0;
        margin: 16px 0 0;
      }

      .bullet-list li {
        padding: 14px 0;
        border-top: 1px solid var(--border);
      }

      .bullet-list li:first-child,
      .mini-list li:first-child {
        padding-top: 0;
        border-top: 0;
      }

      .bullet-list strong,
      .checklist-list strong {
        display: block;
        margin-bottom: 4px;
      }

      .checklist-list {
        display: grid;
        gap: 10px;
      }

      .checklist-list li {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 12px;
        padding: 14px 16px;
        border: 1px solid var(--border);
        border-radius: 18px;
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.9), rgba(248, 242, 231, 0.92));
      }

      .mini-list li {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 12px;
        padding: 10px 0;
        border-top: 1px solid var(--border);
      }

      .mini-list span {
        color: var(--muted);
      }

      .mini-list strong {
        font-family: 'IBM Plex Mono', monospace;
        font-size: 18px;
        line-height: 1.08;
      }

      .journal-box {
        padding: 16px;
        border-radius: 14px;
        border: 1px solid var(--border);
        background: var(--surface-soft);
      }

      .journal-box + .journal-box {
        margin-top: 12px;
      }

      .journal-label {
        display: inline-block;
        margin-bottom: 8px;
        color: var(--accent-strong);
      }

      .journal-note {
        margin: 0;
        font-size: 14px;
      }

      .scenario-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
        margin-top: 16px;
      }

      .scenario-card {
        padding: 16px;
      }

      .scenario-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
      }

      .scenario-head strong {
        font-size: 16px;
      }

      .scenario-card p {
        margin: 10px 0 0;
        font-size: 13px;
      }

      .scenario-metrics {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 12px;
        font-family: 'IBM Plex Mono', monospace;
        font-size: 11px;
        color: var(--muted);
      }

      .footer-note {
        margin: 4px 0 0;
        padding: 16px 0 6px;
        border-top: 1px solid var(--border);
        font-size: 11px;
        text-align: center;
      }

      @page {
        size: A4 portrait;
        margin: 12mm;
      }

      @media print {
        body {
          padding: 0;
          background: #ffffff;
        }

        .sheet {
          max-width: none;
          gap: 12px;
        }

        .hero,
        .panel,
        .metric-card,
        .score-card,
        .scenario-card,
        .journal-box {
          box-shadow: none;
        }
      }

      @media (max-width: 900px) {
        .hero,
        .hero-ledger,
        .metric-grid,
        .panel-grid,
        .scenario-grid {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <main class="sheet">
      <section class="hero">
        <div class="hero-copy">
          <div class="eyebrow-row">
            <p class="eyebrow">Rapport d'analyse</p>
            <span class="hero-badge">Génération locale</span>
          </div>

          <h1>${escapeDecisionPdfHtml(variablesData['nom-bien'] || 'Bien à étudier')}</h1>

          <div class="hero-meta">
            <span class="meta-chip">${escapeDecisionPdfHtml(variablesData.ville || 'Ville non renseignée')}</span>
            <span class="meta-chip">${escapeDecisionPdfHtml(assetStatusLabel)}</span>
            <span class="meta-chip">${escapeDecisionPdfHtml(assetTypeLabel)}</span>
            <span class="meta-chip">Généré le ${escapeDecisionPdfHtml(generatedOn)}</span>
          </div>

          <p class="summary">${escapeDecisionPdfHtml(acquisitionDecision.summary)}</p>
          <p class="action"><strong>Recommandation</strong>${escapeDecisionPdfHtml(acquisitionDecision.action)}</p>

          <div class="hero-ledger">
            <article class="hero-ledger-item">
              <span class="label">Profil de calcul</span>
              <strong>${escapeDecisionPdfHtml(profileSummary)}</strong>
              <p>Paramètres utilisés pour la fiscalité, la capacité et les seuils de contrôle du dossier.</p>
            </article>
            <article class="hero-ledger-item">
              <span class="label">État de lecture</span>
              <strong>${escapeDecisionPdfHtml(acquisitionDecision.priceBand)}</strong>
              <p>Checklist ${escapeDecisionPdfHtml(acquisitionDecision.checklistLabel)} · Fiabilité ${escapeDecisionPdfHtml(confidenceModel.label)} · Stress ${escapeDecisionPdfHtml(scenarioModel.label)}</p>
            </article>
          </div>
        </div>

        <aside class="score-panel">
          <div class="score-card score-card--primary ${scoreCardToneClass}">
            <span class="label">Indice de décision</span>
            <div class="score-value">${escapeDecisionPdfHtml(String(acquisitionDecision.score))}<small>/100</small></div>
            <span class="pill ${decisionToneClass}">${escapeDecisionPdfHtml(acquisitionDecision.label)}</span>
            <p class="score-note">Score composite basé sur le prix, le cash-flow, la couverture de dette, la qualité des hypothèses et la tenue au stress.</p>
          </div>

          <div class="score-card">
            <span class="label">États synthétiques</span>
            <div class="score-pill-row">
              <span class="pill tone-neutral">${escapeDecisionPdfHtml(acquisitionDecision.priceBand)}</span>
              <span class="pill ${decisionToneClass}">${escapeDecisionPdfHtml(acquisitionDecision.checklistLabel)}</span>
              <span class="pill ${confidenceToneClass}">${escapeDecisionPdfHtml(confidenceModel.label)}</span>
              <span class="pill ${robustnessToneClass}">${escapeDecisionPdfHtml(scenarioModel.label)}</span>
            </div>
            <p class="score-note">États retenus pour la lecture synthétique du dossier au moment de l export.</p>
          </div>
        </aside>
      </section>

      <section class="panel panel--metrics">
        <div class="panel-head">
          <div>
            <p class="panel-kicker">Indicateurs</p>
            <h2>Synthèse chiffrée</h2>
          </div>
          <span class="pill ${decisionToneClass}">${escapeDecisionPdfHtml(acquisitionDecision.label)}</span>
        </div>
        <p class="panel-note">Indicateurs principaux utilisés dans l évaluation économique et documentaire du dossier.</p>
        <div class="metric-grid">
          <article class="metric-card metric-card--ink">
            <span class="label">Prix affiché</span>
            <strong>${escapeDecisionPdfHtml(formatDecisionPdfCurrency(acquisitionDecision.currentPrice))}</strong>
            <span class="metric-note">Base vendeur actuelle.</span>
          </article>
          <article class="metric-card metric-card--accent">
            <span class="label">Seuil d'offre</span>
            <strong>${escapeDecisionPdfHtml(formatDecisionPdfCurrency(acquisitionDecision.maxOfferPrice))}</strong>
            <span class="metric-note">Seuil à ne pas dépasser.</span>
          </article>
          <article class="metric-card metric-card--accent">
            <span class="label">Seuil favorable</span>
            <strong>${escapeDecisionPdfHtml(formatDecisionPdfCurrency(acquisitionDecision.solidOfferPrice))}</strong>
            <span class="metric-note">Zone de négociation avec marge de sécurité.</span>
          </article>
          <article class="metric-card ${cfToneClass}">
            <span class="label">CF net-net</span>
            <strong>${escapeDecisionPdfHtml(formatDecisionPdfSignedCurrency(metrics.cfNetNet))}</strong>
            <span class="metric-note">Après charges et impôts.</span>
          </article>
          <article class="metric-card ${dscrToneClass}">
            <span class="label">DSCR</span>
            <strong>${escapeDecisionPdfHtml(formatDecisionPdfRatio(metrics.dscr))}</strong>
            <span class="metric-note">Couverture de la dette.</span>
          </article>
          <article class="metric-card metric-card--accent">
            <span class="label">Renta nette-nette</span>
            <strong>${escapeDecisionPdfHtml(formatDecisionPdfPercent(metrics.rentaNetNet))}</strong>
            <span class="metric-note">Rendement après fiscalité.</span>
          </article>
          <article class="metric-card ${confidenceToneClass}">
            <span class="label">Fiabilité</span>
            <strong>${escapeDecisionPdfHtml(`${confidenceModel.score}/100`)}</strong>
            <span class="metric-note">Qualité des hypothèses.</span>
          </article>
          <article class="metric-card ${robustnessToneClass}">
            <span class="label">Robustesse</span>
            <strong>${escapeDecisionPdfHtml(scenarioModel.label)}</strong>
            <span class="metric-note">Tenue du dossier au stress.</span>
          </article>
        </div>
      </section>

      <section class="panel-grid">
        <article class="panel">
          <div class="panel-head">
            <div>
              <p class="panel-kicker">01 vérification</p>
              <h2>Checklist avant offre</h2>
            </div>
            <span class="pill ${decisionToneClass}">${escapeDecisionPdfHtml(acquisitionDecision.checklistLabel)}</span>
          </div>
          <p class="panel-note">${escapeDecisionPdfHtml(acquisitionChecklist.summary)}</p>
          <ul class="checklist-list">${checklistMarkup}</ul>
        </article>

        <article class="panel">
          <div class="panel-head">
            <div>
              <p class="panel-kicker">02 seuils</p>
              <h2>Seuils retenus</h2>
            </div>
            <span class="pill tone-neutral">Seuils</span>
          </div>
          <p class="panel-note">Paramètres retenus au moment de l export.</p>
          <ul class="mini-list">
            <li><span>CF mini / mois</span><strong>${escapeDecisionPdfHtml(formatDecisionPdfSignedCurrency(decisionThresholds.minCf))}</strong></li>
            <li><span>DSCR mini</span><strong>${escapeDecisionPdfHtml(formatDecisionPdfRatio(decisionThresholds.minDscr))}</strong></li>
            <li><span>Vacance max</span><strong>${escapeDecisionPdfHtml(formatDecisionPdfPercent(decisionThresholds.maxVacancy))}</strong></li>
            <li><span>Écart loyer max</span><strong>${escapeDecisionPdfHtml(formatDecisionPdfPercent(decisionThresholds.maxRentGapRatio * 100))}</strong></li>
            <li><span>Effort foyer max</span><strong>${escapeDecisionPdfHtml(formatDecisionPdfPercent(decisionThresholds.maxEffortRatio))}</strong></li>
            <li><span>Passoire bloquante</span><strong>${escapeDecisionPdfHtml(variablesData['blocage-passoire'] === 'yes' ? 'Oui' : 'Non')}</strong></li>
          </ul>
        </article>
      </section>

      <section class="panel-grid">
        <article class="panel">
          <div class="panel-head">
            <div>
              <p class="panel-kicker">03 hypothèses</p>
              <h2>Qualité des hypothèses</h2>
            </div>
            <span class="pill ${confidenceToneClass}">${escapeDecisionPdfHtml(confidenceModel.label)}</span>
          </div>
          <p class="panel-note">${escapeDecisionPdfHtml(confidenceModel.summary)}</p>
          <ul class="mini-list">
            <li><span>Score</span><strong>${escapeDecisionPdfHtml(`${confidenceModel.score}/100`)}</strong></li>
            <li><span>Vérifiées</span><strong>${escapeDecisionPdfHtml(String(confidenceModel.verifiedCount))}</strong></li>
            <li><span>Estimées</span><strong>${escapeDecisionPdfHtml(String(confidenceModel.estimatedCount))}</strong></li>
            <li><span>Inconnues</span><strong>${escapeDecisionPdfHtml(String(confidenceModel.unknownCount))}</strong></li>
          </ul>
        </article>

        <article class="panel">
          <div class="panel-head">
            <div>
              <p class="panel-kicker">04 journal</p>
              <h2>Journal d'analyse</h2>
            </div>
            <span class="pill tone-neutral">Mémo</span>
          </div>
          <div class="journal-box">
            <span class="journal-label">Thèse</span>
            <p class="journal-note">${formatDecisionPdfMultiline(thesis)}</p>
          </div>
          <div class="journal-box">
            <span class="journal-label">Prochaine action</span>
            <p class="journal-note">${formatDecisionPdfMultiline(nextStep)}</p>
          </div>
        </article>
      </section>

      <section class="panel">
        <div class="panel-head">
          <div>
            <p class="panel-kicker">05 scénarios</p>
            <h2>Scénarios de stress</h2>
          </div>
          <span class="pill ${robustnessToneClass}">${escapeDecisionPdfHtml(scenarioModel.label)}</span>
        </div>
        <p class="panel-note">${escapeDecisionPdfHtml(scenarioModel.summary)}</p>
        <div class="scenario-grid">${scenarioMarkup}</div>
      </section>

      <section class="panel-grid">
        <article class="panel">
          <div class="panel-head">
            <div>
              <p class="panel-kicker">06 risques</p>
              <h2>Blocages</h2>
            </div>
            <span class="pill tone-negative">À lever</span>
          </div>
          <ul class="bullet-list">${buildDecisionPdfNotes(acquisitionDecision.blockers, 'Aucun blocage majeur', 'Aucun point bloquant majeur n a été remonté sur ce dossier à ce stade.')}</ul>
        </article>

        <article class="panel">
          <div class="panel-head">
            <div>
              <p class="panel-kicker">06 appuis</p>
              <h2>Points d'appui</h2>
            </div>
            <span class="pill tone-positive">À confirmer</span>
          </div>
          <ul class="bullet-list">${buildDecisionPdfNotes(acquisitionDecision.strengths, 'Appuis limités', 'Le dossier ne fait pas encore apparaître de point d appui majeur au-delà des ratios de base.')}</ul>
        </article>
      </section>

      <p class="footer-note">Document généré localement depuis Spark Investissement. Cette synthèse aide à la décision et ne remplace pas un conseil fiscal, juridique ou bancaire personnalisé.</p>
    </main>
    <script>
      (function () {
        function launchPrint() {
          var ready = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
          ready.then(function () {
            window.focus();
            window.setTimeout(function () {
              window.print();
            }, 60);
          }).catch(function () {
            window.print();
          });
        }

        window.addEventListener('load', launchPrint, { once: true });
        window.addEventListener('afterprint', function () {
          window.close();
        });
      })();
    <\/script>
  </body>
  </html>`;

    return { documentHTML, filename };
}

function normalizePDFText(value) {
  return (value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+\n/g, '\n')
    .replace(/\n\s+/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function getElementText(id) {
  const el = document.getElementById(id);
  return el ? normalizePDFText(el.innerText || el.textContent || '') : '';
}

function getCanvasImage(id, quality = 0.88) {
  const canvas = document.getElementById(id);
  if (!canvas) return null;
  try {
    return canvas.toDataURL('image/jpeg', quality);
  } catch (err) {
    return null;
  }
}

function extractTableDataFromElement(table) {
  if (!table) return null;
  const head = Array.from(table.querySelectorAll('thead tr')).map((row) =>
    Array.from(row.querySelectorAll('th, td')).map((cell) => normalizePDFText(cell.innerText || cell.textContent || ''))
  ).filter((row) => row.length);
  const body = Array.from(table.querySelectorAll('tbody tr')).map((row) =>
    Array.from(row.querySelectorAll('th, td')).map((cell) => normalizePDFText(cell.innerText || cell.textContent || ''))
  ).filter((row) => row.length);

  if (!head.length && !body.length) return null;
  return { head, body };
}

function extractTableData(selector) {
  return extractTableDataFromElement(document.querySelector(selector));
}

function extractRegimeComparisonRows() {
  return Array.from(document.querySelectorAll('#regime-compare-grid .regime-card')).map((card) => [
    normalizePDFText(card.querySelector('.regime-name')?.innerText || ''),
    normalizePDFText(card.querySelector('.regime-cf')?.innerText || ''),
    normalizePDFText(card.querySelector('.regime-badge')?.innerText || '')
  ]).filter((row) => row[0]);
}

function extractOptimizationTips() {
  const optimized = document.querySelector('#optimization-tips-container .tip-optimized');
  if (optimized) {
    return [{
      title: 'Investissement optimise',
      explanation: normalizePDFText(optimized.innerText || ''),
      gain: ''
    }];
  }

  return Array.from(document.querySelectorAll('#optimization-tips-container .tip-card')).map((card) => ({
    title: normalizePDFText(card.querySelector('.tip-title')?.innerText || ''),
    explanation: normalizePDFText(card.querySelector('.tip-explanation')?.innerText || ''),
    gain: normalizePDFText(card.querySelector('.tip-gain')?.innerText || '')
  })).filter((tip) => tip.title || tip.explanation);
}

function collectSharePDFSnapshot() {
  return {
    projectName: document.getElementById('project-name').value.trim() || 'Investissement',
    generatedOn: new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }),
    scoreLabel: getElementText('score-label'),
    scoreStars: getElementText('score-stars'),
    scoreDetail: getElementText('score-detail'),
    primaryMetrics: [
      ['Rentabilite brute', getElementText('renta-brute')],
      ['Rentabilite nette', getElementText('renta-nette')],
      ['Renta nette-nette', getElementText('renta-netnet')],
      ['Cash-flow net-net', getElementText('cf-netnet')]
    ],
    secondaryMetrics: [
      ['Cash-on-Cash', getElementText('metric-coc')],
      ['GRM', getElementText('metric-grm')],
      ['DSCR', getElementText('metric-dscr')],
      ['Break-even', getElementText('metric-breakeven')],
      ['Equite an 1', getElementText('metric-equity')]
    ],
    financingSummary: [
      ['Prix net vendeur estime', `${getElementText('out-prix-net')} €`],
      ['Frais fixes', `${getElementText('out-frais-fixes')} €`],
      ['Cout total de l operation', `${getElementText('out-cout-total')} €`],
      ['Montant emprunte', `${getElementText('out-financement')} €`],
      ['Mensualite credit + assurance', `${getElementText('out-mensualite')} €`]
    ],
    cashflowChart: getCanvasImage('cashflowChart'),
    evolutionChart: getCanvasImage('evolutionChart'),
    regimeComparison: extractRegimeComparisonRows(),
    fiscalBreakdown: extractTableData('#fiscal-breakdown table'),
    optimizationTips: extractOptimizationTips(),
    negotiationTable: extractTableData('#nego-table-container table'),
    projectionTable: extractTableDataFromElement(document.getElementById('projection-tbody')?.closest('table')),
    resaleSummary: getElementText('revente-summary'),
    resaleTable: extractTableDataFromElement(document.getElementById('revente-tbody')?.closest('table')),
    notes: getElementText('commentaires-display')
  };
}

const SHARE_PDF_PALETTE = {
  brand: [24, 52, 88],
  brandSoft: [238, 245, 255],
  blue: [59, 130, 246],
  blueSoft: [239, 246, 255],
  gold: [201, 168, 76],
  goldSoft: [255, 249, 235],
  success: [22, 163, 74],
  successSoft: [240, 253, 244],
  danger: [220, 38, 38],
  dangerSoft: [254, 242, 242],
  ink: [15, 23, 42],
  text: [51, 65, 85],
  muted: [100, 116, 139],
  line: [226, 232, 240],
  paper: [248, 250, 252],
  white: [255, 255, 255]
};

function getScoreTheme(scoreLabel) {
  const label = (scoreLabel || '').toLowerCase();
  if (label.includes('excellent')) {
    return { accent: SHARE_PDF_PALETTE.success, soft: SHARE_PDF_PALETTE.successSoft, text: [21, 128, 61] };
  }
  if (label.includes('bon')) {
    return { accent: SHARE_PDF_PALETTE.blue, soft: SHARE_PDF_PALETTE.blueSoft, text: [30, 64, 175] };
  }
  if (label.includes('ris')) {
    return { accent: SHARE_PDF_PALETTE.danger, soft: SHARE_PDF_PALETTE.dangerSoft, text: [153, 27, 27] };
  }
  return { accent: SHARE_PDF_PALETTE.gold, soft: SHARE_PDF_PALETTE.goldSoft, text: [146, 64, 14] };
}

function extractNumericValue(value) {
  if (!value) return null;
  const normalized = value.replace(/\s+/g, '').replace(',', '.');
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function resolveMetricTone(label, value) {
  const labelLower = (label || '').toLowerCase();
  const numericValue = extractNumericValue(value);
  if (labelLower.includes('cash-flow')) {
    if (numericValue !== null && numericValue < 0) {
      return { accent: SHARE_PDF_PALETTE.danger, soft: SHARE_PDF_PALETTE.dangerSoft, value: [153, 27, 27] };
    }
    return { accent: SHARE_PDF_PALETTE.success, soft: SHARE_PDF_PALETTE.successSoft, value: [21, 128, 61] };
  }
  if (labelLower.includes('nette-nette') || labelLower.includes('break-even')) {
    return { accent: SHARE_PDF_PALETTE.gold, soft: SHARE_PDF_PALETTE.goldSoft, value: [146, 64, 14] };
  }
  if (labelLower.includes('dscr') || labelLower.includes('grm')) {
    return { accent: SHARE_PDF_PALETTE.blue, soft: SHARE_PDF_PALETTE.blueSoft, value: [30, 64, 175] };
  }
  return { accent: SHARE_PDF_PALETTE.brand, soft: SHARE_PDF_PALETTE.paper, value: SHARE_PDF_PALETTE.ink };
}

function drawCardBase(doc, x, y, width, height, tone) {
  doc.setFillColor(...tone.soft);
  doc.setDrawColor(...SHARE_PDF_PALETTE.line);
  doc.roundedRect(x, y, width, height, 3, 3, 'FD');
  doc.setFillColor(...tone.accent);
  doc.roundedRect(x, y, width, 2.4, 3, 3, 'F');
}

function drawMetricCard(doc, card, x, y, width, height, options = {}) {
  const tone = options.tone || resolveMetricTone(card.label, card.value);
  const labelFontSize = options.labelFontSize || 6.1;
  let valueFontSize = options.valueFontSize || 14;
  if ((card.value || '').length > 14) valueFontSize = Math.min(valueFontSize, 12.2);
  if ((card.value || '').length > 18) valueFontSize = Math.min(valueFontSize, 10.6);

  drawCardBase(doc, x, y, width, height, tone);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(labelFontSize);
  doc.setTextColor(...SHARE_PDF_PALETTE.muted);
  const labelLines = doc.splitTextToSize((card.label || '').toUpperCase(), width - 8).slice(0, 2);
  doc.text(labelLines, x + 4, y + 6.5);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(valueFontSize);
  doc.setTextColor(...tone.value);
  const valueLines = doc.splitTextToSize(card.value || '--', width - 8).slice(0, 2);
  doc.text(valueLines, x + 4, y + 14.5);

  if (card.note) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.3);
    doc.setTextColor(...SHARE_PDF_PALETTE.muted);
    const noteLines = doc.splitTextToSize(card.note, width - 8).slice(0, 2);
    doc.text(noteLines, x + 4, y + height - 3.8);
  }
}

function drawMetricGrid(doc, cards, y, options = {}) {
  const columns = options.columns || 2;
  const gap = options.gap || 4;
  const x = options.x || 14;
  const width = options.width || (doc.internal.pageSize.getWidth() - 28);
  const cardHeight = options.cardHeight || 24;
  const rows = Math.ceil(cards.length / columns);
  const cardWidth = (width - ((columns - 1) * gap)) / columns;

  cards.forEach((card, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const cardX = x + (column * (cardWidth + gap));
    const cardY = y + (row * (cardHeight + gap));
    drawMetricCard(doc, card, cardX, cardY, cardWidth, cardHeight, options);
  });

  return y + (rows * cardHeight) + ((rows - 1) * gap);
}

function drawDetailRowsCard(doc, rows, y, options = {}) {
  const x = options.x || 14;
  const width = options.width || (doc.internal.pageSize.getWidth() - 28);
  const rowHeight = options.rowHeight || 8.2;
  const topPadding = 4.8;
  const height = topPadding + (rows.length * rowHeight) + 2.2;

  doc.setFillColor(...SHARE_PDF_PALETTE.white);
  doc.setDrawColor(...SHARE_PDF_PALETTE.line);
  doc.roundedRect(x, y, width, height, 3, 3, 'FD');

  rows.forEach((row, index) => {
    const rowTop = y + topPadding + (index * rowHeight);
    if (index > 0) {
      doc.setDrawColor(...SHARE_PDF_PALETTE.line);
      doc.line(x + 4, rowTop - 2.3, x + width - 4, rowTop - 2.3);
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.6);
    doc.setTextColor(...SHARE_PDF_PALETTE.text);
    doc.text(row[0], x + 4, rowTop + 2.1);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...SHARE_PDF_PALETTE.ink);
    doc.text(row[1], x + width - 4, rowTop + 2.1, { align: 'right' });
  });

  return y + height;
}

function drawImagePanel(doc, panel) {
  doc.setFillColor(...SHARE_PDF_PALETTE.white);
  doc.setDrawColor(...SHARE_PDF_PALETTE.line);
  doc.roundedRect(panel.x, panel.y, panel.width, panel.height, 3, 3, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.9);
  doc.setTextColor(...SHARE_PDF_PALETTE.ink);
  doc.text(panel.title, panel.x + 4, panel.y + 6);

  if (panel.subtitle) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.8);
    doc.setTextColor(...SHARE_PDF_PALETTE.muted);
    doc.text(panel.subtitle, panel.x + 4, panel.y + 10.1);
  }

  if (panel.imageData) {
    const topOffset = panel.subtitle ? 13.5 : 10.5;
    const imageMaxWidth = panel.width - 8;
    const imageMaxHeight = panel.height - topOffset - 4;
    const imageWidth = Math.min(panel.imageWidth || imageMaxWidth, imageMaxWidth);
    const imageHeight = Math.min(panel.imageHeight || imageMaxHeight, imageMaxHeight);
    const imageX = panel.x + ((panel.width - imageWidth) / 2);
    const imageY = panel.y + topOffset + ((imageMaxHeight - imageHeight) / 2);
    doc.addImage(panel.imageData, 'JPEG', imageX, imageY, imageWidth, imageHeight, undefined, 'FAST');
  }
}

function drawTipPanel(doc, tip, y, width) {
  const hasGain = Boolean(tip.gain);
  const explanationLines = doc.splitTextToSize(tip.explanation, width - 18);
  const blockHeight = 12 + (explanationLines.length * 4.2) + (hasGain ? 6 : 0);
  const tone = hasGain
    ? { accent: SHARE_PDF_PALETTE.success, soft: SHARE_PDF_PALETTE.successSoft }
    : { accent: SHARE_PDF_PALETTE.blue, soft: SHARE_PDF_PALETTE.blueSoft };

  doc.setFillColor(...SHARE_PDF_PALETTE.white);
  doc.setDrawColor(...SHARE_PDF_PALETTE.line);
  doc.roundedRect(14, y, width, blockHeight, 3, 3, 'FD');
  doc.setFillColor(...tone.accent);
  doc.roundedRect(14, y, 3, blockHeight, 3, 3, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.7);
  doc.setTextColor(...SHARE_PDF_PALETTE.brand);
  doc.text(tip.title || 'Conseil', 20, y + 6);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...SHARE_PDF_PALETTE.text);
  doc.text(explanationLines, 20, y + 10.8);

  if (hasGain) {
    const gainWidth = Math.min(width - 24, doc.getTextWidth(tip.gain) + 8);
    doc.setFillColor(...SHARE_PDF_PALETTE.successSoft);
    doc.roundedRect(20, y + blockHeight - 7, gainWidth, 5, 2.5, 2.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.6);
    doc.setTextColor(...SHARE_PDF_PALETTE.success);
    doc.text(tip.gain, 24, y + blockHeight - 3.4);
  }

  return y + blockHeight;
}

function ensurePdfDependencies() {
  const jsPDF = window.jspdf && window.jspdf.jsPDF;
  if (!jsPDF) {
    throw new Error('jsPDF indisponible');
  }
  if (!jsPDF.API || !jsPDF.API.autoTable) {
    throw new Error('jsPDF AutoTable indisponible');
  }
  return jsPDF;
}

function addTable(doc, config) {
  doc.autoTable({
    margin: { left: 14, right: 14 },
    tableLineColor: SHARE_PDF_PALETTE.line,
    tableLineWidth: 0.12,
    headStyles: {
      fillColor: SHARE_PDF_PALETTE.brand,
      textColor: 255,
      fontStyle: 'bold',
      fontSize: 8.1,
      cellPadding: { top: 2.6, right: 2.4, bottom: 2.5, left: 2.4 }
    },
    bodyStyles: {
      fontSize: 7.8,
      textColor: SHARE_PDF_PALETTE.text,
      cellPadding: { top: 2.2, right: 2.2, bottom: 2.1, left: 2.2 }
    },
    alternateRowStyles: { fillColor: [250, 251, 253] },
    styles: { overflow: 'linebreak', lineColor: SHARE_PDF_PALETTE.line, lineWidth: 0.12, valign: 'middle' },
    ...config
  });
  return doc.lastAutoTable.finalY;
}

function addSectionTitle(doc, text, y) {
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setDrawColor(...SHARE_PDF_PALETTE.line);
  doc.setLineWidth(0.25);
  doc.line(14, y + 4.2, pageWidth - 14, y + 4.2);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.8);
  const titleWidth = Math.min(pageWidth - 28, doc.getTextWidth(text) + 14);
  doc.setFillColor(...SHARE_PDF_PALETTE.brandSoft);
  doc.roundedRect(14, y, titleWidth, 8.4, 4.2, 4.2, 'F');
  doc.setFillColor(...SHARE_PDF_PALETTE.gold);
  doc.roundedRect(14, y + 2.1, 3.2, 4.2, 2.1, 2.1, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...SHARE_PDF_PALETTE.brand);
  doc.text(text, 20.5, y + 5.6);
  return y + 12;
}

function addWrappedText(doc, text, y, options = {}) {
  const pageHeight = doc.internal.pageSize.getHeight();
  const fontSize = options.fontSize || 9;
  const lineHeight = options.lineHeight || 4.6;
  const x = options.x || 16;
  const maxWidth = options.maxWidth || (doc.internal.pageSize.getWidth() - 32);
  const lines = doc.splitTextToSize(text, maxWidth);
  if (y + (lines.length * lineHeight) > pageHeight - 16) {
    doc.addPage();
    y = 16;
  }
  doc.setFont('helvetica', options.fontStyle || 'normal');
  doc.setFontSize(fontSize);
  doc.setTextColor(51, 65, 85);
  doc.text(lines, x, y);
  return y + (lines.length * lineHeight);
}

export async function buildSharePDFFile(uploadedPhotos) {
  const jsPDF = ensurePdfDependencies();
  const { filename } = buildPDFParts(uploadedPhotos);
  const snapshot = collectSharePDFSnapshot();
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - 28;
  let cursorY = 14;

  const ensureSpace = (neededHeight) => {
    if (cursorY + neededHeight <= pageHeight - 16) return;
    doc.addPage();
    cursorY = 16;
  };

  const scoreTheme = getScoreTheme(snapshot.scoreLabel);
  const primaryCards = [
    { label: snapshot.primaryMetrics[0][0], value: snapshot.primaryMetrics[0][1], note: 'Vision instantanee' },
    { label: snapshot.primaryMetrics[1][0], value: snapshot.primaryMetrics[1][1], note: 'Hors impact fiscal final' },
    { label: snapshot.primaryMetrics[2][0], value: snapshot.primaryMetrics[2][1], note: 'Apres impots' },
    { label: snapshot.primaryMetrics[3][0], value: snapshot.primaryMetrics[3][1], note: 'Ce qu il reste chaque mois' }
  ];
  const secondaryCards = snapshot.secondaryMetrics.map(([label, value]) => ({ label, value }));

  doc.setFillColor(...SHARE_PDF_PALETTE.brand);
  doc.roundedRect(14, cursorY, contentWidth, 24, 4, 4, 'F');
  doc.setFillColor(...SHARE_PDF_PALETTE.gold);
  doc.roundedRect(pageWidth - 62, cursorY + 4, 42, 6.3, 3.1, 3.1, 'F');
  doc.setTextColor(...SHARE_PDF_PALETTE.brand);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.text('RAPPORT PARTAGE', pageWidth - 41, cursorY + 8.1, { align: 'center' });

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(19);
  doc.text('Investisseur Pro', 20, cursorY + 8.5);
  doc.setFontSize(11.3);
  doc.text(snapshot.projectName, 20, cursorY + 16.3);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.8);
  doc.text(`Genere le ${snapshot.generatedOn}`, 20, cursorY + 20.6);
  cursorY += 30;

  doc.setFillColor(...scoreTheme.soft);
  doc.setDrawColor(...SHARE_PDF_PALETTE.line);
  doc.roundedRect(14, cursorY, contentWidth, 18, 3, 3, 'FD');
  doc.setFillColor(...scoreTheme.accent);
  doc.roundedRect(14, cursorY, 4, 18, 3, 3, 'F');
  doc.setFillColor(...scoreTheme.accent);
  doc.roundedRect(20, cursorY + 3.3, 32, 5.4, 2.7, 2.7, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(255, 255, 255);
  doc.text((snapshot.scoreLabel || 'Simulation').toUpperCase(), 36, cursorY + 7, { align: 'center' });
  doc.setTextColor(...scoreTheme.text);
  doc.setFontSize(13);
  doc.text(`${snapshot.scoreLabel} ${snapshot.scoreStars}`.trim(), 56, cursorY + 7.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.8);
  const scoreLines = doc.splitTextToSize(snapshot.scoreDetail || 'Simulation en cours', contentWidth - 48);
  doc.setTextColor(...SHARE_PDF_PALETTE.text);
  doc.text(scoreLines, 56, cursorY + 12.8);
  cursorY += 24;

  cursorY = addSectionTitle(doc, 'Vue d ensemble', cursorY);
  ensureSpace(56);
  cursorY = drawMetricGrid(doc, primaryCards, cursorY, { columns: 2, cardHeight: 24, gap: 4 }) + 6;
  ensureSpace(40);
  cursorY = drawMetricGrid(doc, secondaryCards, cursorY, { columns: 3, cardHeight: 18, gap: 4, valueFontSize: 11.2, labelFontSize: 5.6 }) + 6;

  cursorY = addSectionTitle(doc, 'Enveloppe financiere', cursorY);
  ensureSpace(56);
  cursorY = drawDetailRowsCard(doc, snapshot.financingSummary, cursorY) + 6;

  if (snapshot.cashflowChart || snapshot.evolutionChart) {
    cursorY = addSectionTitle(doc, 'Graphiques', cursorY);
    if (snapshot.cashflowChart && snapshot.evolutionChart) {
      ensureSpace(76);
      drawImagePanel(doc, {
        x: 14,
        y: cursorY,
        width: 64,
        height: 68,
        title: 'Repartition du cash-flow',
        subtitle: 'Vue mensuelle',
        imageData: snapshot.cashflowChart,
        imageWidth: 50,
        imageHeight: 50
      });
      drawImagePanel(doc, {
        x: 82,
        y: cursorY,
        width: 114,
        height: 68,
        title: 'Evolution sur 25 ans',
        subtitle: 'Capital, cash-flow cumule et enrichissement',
        imageData: snapshot.evolutionChart,
        imageWidth: 102,
        imageHeight: 46
      });
      cursorY += 74;
    } else if (snapshot.evolutionChart) {
      ensureSpace(72);
      drawImagePanel(doc, {
        x: 14,
        y: cursorY,
        width: contentWidth,
        height: 66,
        title: 'Evolution sur 25 ans',
        subtitle: 'Capital, cash-flow cumule et enrichissement',
        imageData: snapshot.evolutionChart,
        imageWidth: contentWidth - 12,
        imageHeight: 46
      });
      cursorY += 72;
    } else if (snapshot.cashflowChart) {
      ensureSpace(72);
      drawImagePanel(doc, {
        x: 14,
        y: cursorY,
        width: contentWidth,
        height: 66,
        title: 'Repartition du cash-flow',
        subtitle: 'Vue mensuelle',
        imageData: snapshot.cashflowChart,
        imageWidth: 52,
        imageHeight: 52
      });
      cursorY += 72;
    }
  }

  if (snapshot.regimeComparison.length) {
    cursorY = addSectionTitle(doc, 'Comparaison des regimes fiscaux', cursorY);
    cursorY = addTable(doc, {
      startY: cursorY,
      head: [['Regime', 'CF / mois', 'Repere']],
      body: snapshot.regimeComparison,
      columnStyles: {
        1: { halign: 'right' },
        2: { halign: 'center' }
      }
    }) + 6;
  }

  if (snapshot.fiscalBreakdown) {
    cursorY = addSectionTitle(doc, 'Detail fiscal', cursorY);
    cursorY = addTable(doc, {
      startY: cursorY,
      head: snapshot.fiscalBreakdown.head,
      body: snapshot.fiscalBreakdown.body,
      bodyStyles: { fontSize: 7.3, textColor: SHARE_PDF_PALETTE.text, cellPadding: 1.8 },
      headStyles: { fillColor: SHARE_PDF_PALETTE.brand, textColor: 255, fontStyle: 'bold', fontSize: 7.8 }
    }) + 6;
  }

  if (snapshot.optimizationTips.length) {
    cursorY = addSectionTitle(doc, 'Conseils d optimisation', cursorY);
    snapshot.optimizationTips.slice(0, 6).forEach((tip) => {
      const blockHeight = 12 + (doc.splitTextToSize(tip.explanation, contentWidth - 18).length * 4.2) + (tip.gain ? 6 : 0);
      ensureSpace(blockHeight + 2);
      cursorY = drawTipPanel(doc, tip, cursorY, contentWidth) + 4;
    });
  }

  if (snapshot.negotiationTable) {
    cursorY = addSectionTitle(doc, 'Impact de la negociation', cursorY);
    cursorY = addTable(doc, {
      startY: cursorY,
      head: snapshot.negotiationTable.head,
      body: snapshot.negotiationTable.body,
      bodyStyles: { fontSize: 7.4, textColor: SHARE_PDF_PALETTE.text, cellPadding: 1.8 },
      headStyles: { fillColor: SHARE_PDF_PALETTE.brand, textColor: 255, fontStyle: 'bold', fontSize: 7.8 }
    }) + 6;
  }

  if (snapshot.projectionTable) {
    cursorY = addSectionTitle(doc, 'Projection financiere sur 25 ans', cursorY);
    cursorY = addTable(doc, {
      startY: cursorY,
      head: snapshot.projectionTable.head,
      body: snapshot.projectionTable.body,
      bodyStyles: { fontSize: 7, textColor: SHARE_PDF_PALETTE.text, cellPadding: 1.6 },
      headStyles: { fillColor: SHARE_PDF_PALETTE.brand, textColor: 255, fontStyle: 'bold', fontSize: 7.3 }
    }) + 6;
  }

  if (snapshot.resaleSummary || snapshot.resaleTable) {
    cursorY = addSectionTitle(doc, 'Quand revendre', cursorY);
    if (snapshot.resaleSummary) {
      cursorY = addWrappedText(doc, snapshot.resaleSummary, cursorY, { fontSize: 8.8, lineHeight: 4.3, x: 16, maxWidth: contentWidth });
      cursorY += 4;
    }
    if (snapshot.resaleTable) {
      cursorY = addTable(doc, {
        startY: cursorY,
        head: snapshot.resaleTable.head,
        body: snapshot.resaleTable.body,
        bodyStyles: { fontSize: 6.4, textColor: SHARE_PDF_PALETTE.text, cellPadding: 1.4 },
        headStyles: { fillColor: SHARE_PDF_PALETTE.brand, textColor: 255, fontStyle: 'bold', fontSize: 6.8 },
        styles: { overflow: 'linebreak', lineColor: SHARE_PDF_PALETTE.line, lineWidth: 0.1, cellWidth: 'wrap' }
      }) + 6;
    }
  }

  if (snapshot.notes) {
    cursorY = addSectionTitle(doc, 'Notes', cursorY);
    const noteLines = doc.splitTextToSize(snapshot.notes, contentWidth - 12);
    const noteHeight = 10 + (noteLines.length * 4.5);
    ensureSpace(noteHeight + 2);
    doc.setFillColor(...SHARE_PDF_PALETTE.white);
    doc.setDrawColor(...SHARE_PDF_PALETTE.line);
    doc.roundedRect(14, cursorY, contentWidth, noteHeight, 3, 3, 'FD');
    doc.setFillColor(...SHARE_PDF_PALETTE.goldSoft);
    doc.roundedRect(18, cursorY + 4, 3, noteHeight - 8, 1.5, 1.5, 'F');
    cursorY = addWrappedText(doc, snapshot.notes, cursorY + 6, { fontSize: 9, lineHeight: 4.5, x: 24, maxWidth: contentWidth - 16 });
    cursorY += 6;
  }

  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page++) {
    doc.setPage(page);
    doc.setDrawColor(...SHARE_PDF_PALETTE.line);
    doc.line(14, 10, pageWidth - 14, 10);
    doc.setFillColor(...SHARE_PDF_PALETTE.gold);
    doc.roundedRect(14, 9.1, 24, 1.8, 0.9, 0.9, 'F');
    doc.line(14, pageHeight - 11, pageWidth - 14, pageHeight - 11);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...SHARE_PDF_PALETTE.muted);
    doc.text(snapshot.projectName, 14, pageHeight - 7);
    doc.text(`Page ${page} / ${pageCount}`, pageWidth - 14, pageHeight - 7, { align: 'right' });
  }

  const blob = doc.output('blob');
  return new File([blob], filename, { type: 'application/pdf' });
}
