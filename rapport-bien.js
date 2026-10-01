// Rapport d'un bien détenu (spec 2026-10-01) : données du bien, achat, situation actuelle, travaux
// et prévisionnel des 10 prochaines années civiles (CF annuel + CF cumulé depuis aujourd'hui).
//
// Module pur (aucun accès DOM/window/localStorage, testable sous Node — tests/test_rapport_bien.mjs) :
//   buildAssetReportData(asset, { profileData, regime })  → modèle de données unique
//   buildAssetReportHTML(data)     → { documentHTML, bodyHTML, css, filename } imprimable (aperçu + PDF)
//   buildAssetReportMarkdown(data) → texte .md (export destiné à être exploité par une IA)
// Le PDF et le Markdown sont tous deux rendus depuis le MÊME modèle : ils ne peuvent pas diverger.
import {
    computeOwnedAssetCF, computeOwnedAssetTimeline, computeAmortizationSchedule,
    resolveTmiFoyer, resolveLoyerVacance, parseDateAchat
} from './calculs.js';

const HORIZON_ANS = 10;
const REGIME_LABELS = { 'micro-foncier': 'Micro-foncier', 'reel': 'Foncier réel', 'sci-is': 'SCI-IS' };
const TYPE_BIEN_LABELS = { appartement: 'Appartement', maison: 'Maison', immeuble: 'Immeuble de rapport' };
const TAG_LABELS = { 'deductible': 'Déductible', 'non-deductible': 'Non déductible', 'a-classifier': 'À classifier' };

// ─── Modèle de données ───────────────────────────────────────────────────────

export function buildAssetReportData(asset, { profileData = {}, regime = 'micro-foncier', now = new Date() } = {}) {
    const acq = asset.acquisition || {};
    const post = asset.postAchat || {};
    const credit = acq.credit || {};
    const currentYear = now.getFullYear();
    const tmi = resolveTmiFoyer(profileData, currentYear);

    // ── Achat
    const investissementTotal = (acq.prix || 0) + (acq.fraisAgence || 0) + (acq.fraisNotaire || 0);
    const montantCredit = credit.montant || 0;
    const nMois = (credit.duree || 0) * 12;
    const tauxM = ((credit.taux || 0) / 100) / 12;
    let mensualiteCredit = 0;
    if (montantCredit > 0 && nMois > 0) {
        mensualiteCredit = tauxM > 0 ? (montantCredit * tauxM) / (1 - Math.pow(1 + tauxM, -nMois)) : montantCredit / nMois;
    }
    let crdActuel = 0;
    if (montantCredit > 0 && nMois > 0) {
        const { schedule } = computeAmortizationSchedule(montantCredit, credit.taux || 0, credit.duree || 0, asset.dateAchat, credit.assurance || 0, credit.assuranceMode);
        const row = schedule.find(r => r.annee === currentYear);
        const last = schedule[schedule.length - 1];
        crdActuel = row ? row.crdFin : (last && currentYear > last.annee ? 0 : montantCredit);
    }

    // ── Situation actuelle : mêmes conventions que l'onglet Calcul (scénario réaliste, régime
    // du portefeuille, TMI de l'année en cours) pour que le rapport affiche les chiffres de l'app.
    const scenarios = asset.scenarios || [];
    const scenario = scenarios.find(s => s.id === 'realiste') || scenarios[0] || { variables: {} };
    const cf = computeOwnedAssetCF(asset, scenario.variables || {}, tmi, regime);
    const charges = _resolveChargesActuelles(post, currentYear);
    const { loyer, vacancePct: vacanceProjection } = resolveLoyerVacance(asset);
    const vacanceActuelle = scenario.variables?.vacance ?? 5;
    const rentaNette = investissementTotal > 0
        ? ((cf.loyerEffectif - cf.chargesMensuelles) * 12 / investissementTotal) * 100
        : 0;

    // ── Travaux et dépenses (plus récent d'abord)
    const lignesTravaux = (post.travaux || [])
        .filter(t => t && (t.montant || t.description))
        .map(t => ({
            date: t.date || '',
            description: t.description || '',
            montant: Number(t.montant) || 0,
            tag: t.tag || 'a-classifier',
            tagLabel: TAG_LABELS[t.tag] || TAG_LABELS['a-classifier'],
            financeParCredit: !!t.financeParCredit
        }))
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    // ── Prévisionnel : années civiles N+1 → N+10, cumul repartant de 0 aujourd'hui
    const firstYear = currentYear + 1;
    const lastYear = currentYear + HORIZON_ANS;
    const timeline = computeOwnedAssetTimeline(asset, profileData, regime, { horizonYear: lastYear });
    const byYear = new Map(timeline.years.map(y => [y.year, y]));
    let cumul = 0;
    const projection = [];
    for (let year = firstYear; year <= lastYear; year++) {
        const y = byYear.get(year);
        const cfAnnuel = y ? y.cfAnnuel : 0;
        cumul += cfAnnuel;
        projection.push({
            year,
            loyers: y ? y.loyersAnnuels : 0,
            depenses: y ? y.depensesAnnee : 0,
            cfAnnuel,
            cumul
        });
    }

    const { annee: anneeAchat, mois: moisAchat } = parseDateAchat(asset.dateAchat);
    const creditFin = montantCredit > 0 && credit.duree ? anneeAchat + credit.duree : null;

    return {
        generatedAt: now.toISOString(),
        regime,
        regimeLabel: REGIME_LABELS[regime] || regime,
        tmi,
        bien: {
            nom: asset.nom || 'Bien sans nom',
            adresse: asset.adresse || '',
            ville: asset.ville || '',
            codePostal: asset.codePostal || '',
            typeBien: TYPE_BIEN_LABELS[acq.typeBien] || TYPE_BIEN_LABELS.appartement,
            surface: acq.surface || 0,
            dateAchat: asset.dateAchat ? `${String(moisAchat).padStart(2, '0')}/${anneeAchat}` : ''
        },
        acquisition: {
            prix: acq.prix || 0,
            fraisNotaire: acq.fraisNotaire || 0,
            fraisAgence: acq.fraisAgence || 0,
            investissementTotal,
            apport: Math.max(0, investissementTotal - montantCredit),
            credit: {
                montant: montantCredit,
                taux: credit.taux || 0,
                duree: credit.duree || 0,
                assurance: credit.assurance || 0,
                assuranceMode: credit.assuranceMode === 'crd' ? 'sur capital restant dû' : 'sur capital initial',
                mensualiteHorsAssurance: mensualiteCredit,
                capitalRestantDu: crdActuel,
                anneeFin: creditFin
            }
        },
        actuel: {
            loyer,
            vacancePct: vacanceActuelle,
            loyerEffectif: cf.loyerEffectif,
            taxeFonciere: charges.taxeFonciere,
            chargesCopro: charges.chargesCopro,
            assurancePNO: charges.assurancePNO,
            gestionPct: charges.gestionPct,
            chargesMensuelles: cf.chargesMensuelles,
            mensualite: cf.mensualiteTotale,
            impotsAnnuels: cf.impotsAnnee,
            cfNet: cf.cfNet,
            cfNetNet: cf.cfNetNet,
            rentaBrute: cf.rentaBrute,
            rentaNette,
            dscr: cf.dscr
        },
        travaux: {
            lignes: lignesTravaux,
            total: lignesTravaux.reduce((s, t) => s + t.montant, 0),
            totalDeductible: lignesTravaux.filter(t => t.tag === 'deductible').reduce((s, t) => s + t.montant, 0)
        },
        projection,
        hypotheses: [
            `Régime fiscal : ${REGIME_LABELS[regime] || regime} (régime choisi pour le portefeuille), TMI ${tmi} % pour l'année en cours.`,
            `Situation actuelle : scénario « ${scenario.nom || 'Réaliste'} », vacance locative ${vacanceActuelle} %.`,
            `Prévisionnel : vacance locative ${vacanceProjection} %, loyer et charges maintenus au dernier montant connu (aucune indexation ni revalorisation).`,
            `Revenus du foyer maintenus au dernier montant connu pour le calcul de l'impôt des années futures.`,
            `Cash-flow cumulé calculé à partir du 1er janvier ${firstYear} (l'historique depuis l'achat n'est pas inclus).`,
            creditFin
                ? `Crédit : mensualités jusqu'en ${creditFin}${creditFin <= lastYear ? ', plus aucune échéance ensuite' : ''}.`
                : `Aucun crédit en cours renseigné.`,
            `Travaux futurs non connus : non pris en compte.`
        ]
    };
}

function _resolveChargesActuelles(post, currentYear) {
    const entries = (post.chargesAnnuelles || []).filter(e => e.annee <= currentYear).sort((a, b) => b.annee - a.annee);
    const ce = entries[0] || null;
    const pick = key => (ce ? (ce[key] ?? post[key] ?? 0) : (post[key] ?? 0));
    return {
        taxeFonciere: pick('taxeFonciere'),
        chargesCopro: pick('chargesCopro'),
        assurancePNO: pick('assurancePNO'),
        gestionPct: pick('gestionLocative')
    };
}

// ─── Formatage ───────────────────────────────────────────────────────────────

const _nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const _nf1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const _nf2 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

function eur(v) { return `${_nf0.format(Math.round(Number(v) || 0))} €`; }
function eurSigned(v) {
    const n = Math.round(Number(v) || 0);
    return `${n > 0 ? '+' : n < 0 ? '-' : ''}${_nf0.format(Math.abs(n))} €`;
}
function pct(v) { return `${_nf1.format(Number(v) || 0)} %`; }
function dateFr(iso) {
    if (!iso) return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}
function slugify(s) {
    const slug = String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    return slug || 'bien';
}
function escapeHtml(v) {
    return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
// Texte libre dans du Markdown : neutralise le HTML (rendu par la plupart des lecteurs .md)
function mdText(v) { return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
// Cellule de tableau Markdown : en plus, | et retours à la ligne cassent la ligne du tableau
function mdCell(v) { return mdText(v).replace(/\|/g, '\\|').replace(/\r?\n/g, ' '); }

function _reportFilenameBase(data) {
    return `rapport-${slugify(data.bien.nom)}-${data.generatedAt.slice(0, 10)}`;
}

function _adresseComplete(bien) {
    return [bien.adresse, [bien.codePostal, bien.ville].filter(Boolean).join(' ')].filter(Boolean).join(', ');
}

// ─── Markdown ────────────────────────────────────────────────────────────────

export function buildAssetReportMarkdown(data) {
    const { bien, acquisition: a, actuel: c, travaux, projection } = data;
    const cr = a.credit;
    const first = projection[0]?.year;
    const last = projection[projection.length - 1]?.year;
    const L = [];

    L.push(`# Rapport du bien — ${mdText(bien.nom)}`, '');
    L.push(`_Généré le ${dateFr(data.generatedAt)} · Régime fiscal : ${data.regimeLabel} · TMI : ${data.tmi} %_`, '');

    L.push('## Le bien', '');
    L.push(`- **Adresse** : ${mdText(_adresseComplete(bien) || 'non renseignée')}`);
    L.push(`- **Type** : ${bien.typeBien}${bien.surface ? ` · ${_nf0.format(bien.surface)} m²` : ''}`);
    L.push(`- **Date d'achat** : ${bien.dateAchat || 'non renseignée'}`, '');

    L.push('## Achat', '');
    L.push('| Poste | Montant |', '|---|---:|');
    L.push(`| Prix d'achat | ${eur(a.prix)} |`);
    L.push(`| Frais de notaire | ${eur(a.fraisNotaire)} |`);
    L.push(`| Frais d'agence | ${eur(a.fraisAgence)} |`);
    L.push(`| **Investissement total** | **${eur(a.investissementTotal)}** |`);
    L.push(`| Apport | ${eur(a.apport)} |`, '');
    if (cr.montant > 0) {
        L.push('**Crédit**', '');
        L.push('| Caractéristique | Valeur |', '|---|---:|');
        L.push(`| Montant emprunté | ${eur(cr.montant)} |`);
        L.push(`| Taux nominal | ${_nf2.format(cr.taux)} % |`);
        L.push(`| Durée | ${cr.duree} ans${cr.anneeFin ? ` (fin ${cr.anneeFin})` : ''} |`);
        L.push(`| Assurance emprunteur | ${_nf2.format(cr.assurance)} %/an ${cr.assuranceMode} |`);
        L.push(`| Mensualité hors assurance | ${eur(cr.mensualiteHorsAssurance)} |`);
        L.push(`| Capital restant dû (fin ${new Date(data.generatedAt).getFullYear()}) | ${eur(cr.capitalRestantDu)} |`, '');
    } else {
        L.push('Aucun crédit renseigné.', '');
    }

    L.push('## Situation actuelle (par mois)', '');
    L.push('| Indicateur | Valeur |', '|---|---:|');
    L.push(`| Loyer (hors charges) | ${eur(c.loyer)} |`);
    L.push(`| Loyer encaissé (vacance ${c.vacancePct} %) | ${eur(c.loyerEffectif)} |`);
    L.push(`| Charges d'exploitation | ${eur(c.chargesMensuelles)} |`);
    L.push(`| Mensualité crédit (avec assurance) | ${eur(c.mensualite)} |`);
    L.push(`| Impôts (estimation, par an) | ${eur(c.impotsAnnuels)} |`);
    L.push(`| Cash-flow net (avant impôts) | ${eurSigned(c.cfNet)} |`);
    L.push(`| **Cash-flow net-net (après impôts)** | **${eurSigned(c.cfNetNet)}** |`);
    L.push(`| Rentabilité brute | ${pct(c.rentaBrute)} |`);
    L.push(`| Rentabilité nette de charges | ${pct(c.rentaNette)} |`);
    L.push(`| DSCR (couverture des mensualités) | ${c.dscr > 0 ? _nf2.format(c.dscr) : '—'} |`, '');
    L.push(`Détail des charges : taxe foncière ${eur(c.taxeFonciere)}/an · copropriété ${eur(c.chargesCopro)}/mois · assurance PNO ${eur(c.assurancePNO)}/an · gestion locative ${_nf1.format(c.gestionPct)} % des loyers.`, '');

    L.push('## Travaux et dépenses', '');
    if (travaux.lignes.length) {
        L.push('| Date | Description | Montant | Nature fiscale | Financement |', '|---|---|---:|---|---|');
        for (const t of travaux.lignes) {
            L.push(`| ${dateFr(t.date) || '—'} | ${mdCell(t.description) || '—'} | ${eur(t.montant)} | ${t.tagLabel} | ${t.financeParCredit ? 'Crédit' : 'Cash'} |`);
        }
        L.push('', `Total : ${eur(travaux.total)} dont ${eur(travaux.totalDeductible)} déductibles.`, '');
    } else {
        L.push('Aucune dépense enregistrée.', '');
    }

    L.push(`## Prévisionnel sur 10 ans (${first} → ${last})`, '');
    L.push('| Année | Loyers encaissés | Dépenses | Cash-flow annuel | Cash-flow cumulé |', '|---|---:|---:|---:|---:|');
    for (const p of projection) {
        L.push(`| ${p.year} | ${eur(p.loyers)} | ${eur(p.depenses)} | ${eurSigned(p.cfAnnuel)} | ${eurSigned(p.cumul)} |`);
    }
    L.push('', `Cash-flow cumulé sur la période : **${eurSigned(projection[projection.length - 1]?.cumul || 0)}**.`, '');

    L.push('## Hypothèses', '');
    for (const h of data.hypotheses) L.push(`- ${mdText(h)}`);
    L.push('');

    return L.join('\n');
}

export function assetReportMarkdownFilename(data) {
    return `${_reportFilenameBase(data)}.md`;
}

// ─── HTML imprimable (aperçu + PDF) ──────────────────────────────────────────

// Courbe SVG inline (aucun script : le document est imprimé/capturé tel quel). Un point par année
// avec sa valeur, ligne du zéro marquée ; points verts ≥ 0, rouges < 0.
function buildLineChartSVG(points, { ariaLabel, stroke, area = false }) {
    if (!points.length) return '';
    const W = 900, H = 280, padL = 48, padR = 48, padT = 34, padB = 40;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const values = points.map(p => p.value);
    let min = Math.min(0, ...values);
    let max = Math.max(0, ...values);
    if (max === min) { max += 1; min -= 1; }
    const span = max - min;
    min -= span * 0.08; max += span * 0.08;
    const x = i => padL + (points.length === 1 ? plotW / 2 : (plotW * i) / (points.length - 1));
    const y = v => padT + plotH - ((v - min) / (max - min)) * plotH;
    const zeroY = y(0);
    const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
    const areaPath = area
        ? `${path} L${x(points.length - 1).toFixed(1)},${zeroY.toFixed(1)} L${x(0).toFixed(1)},${zeroY.toFixed(1)} Z`
        : '';
    const dots = points.map((p, i) => {
        const cx = x(i), cy = y(p.value);
        const color = p.value >= 0 ? '#2d6a4f' : '#b42318';
        const labelY = p.value >= 0 ? cy - 10 : cy + 18;
        return `
        <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="4.5" fill="${color}" />
        <text x="${cx.toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="middle" class="chart-value">${escapeHtml(eurSigned(p.value))}</text>
        <text x="${cx.toFixed(1)}" y="${(H - 12).toFixed(1)}" text-anchor="middle" class="chart-axis">${p.label}</text>`;
    }).join('');
    return `
    <svg class="chart" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeHtml(ariaLabel)}">
        <line x1="${padL}" y1="${zeroY.toFixed(1)}" x2="${W - padR}" y2="${zeroY.toFixed(1)}" class="chart-zero" />
        ${area ? `<path d="${areaPath}" fill="${stroke}" fill-opacity="0.12" />` : ''}
        <path d="${path}" fill="none" stroke="${stroke}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
        ${dots}
    </svg>`;
}

function _kv(label, value, strong = false) {
    return `<tr><th>${escapeHtml(label)}</th><td>${strong ? `<strong>${escapeHtml(value)}</strong>` : escapeHtml(value)}</td></tr>`;
}

const REPORT_CSS = `
    @page { size: A4; margin: 14mm 12mm; }
    * { box-sizing: border-box; }
    .report-root { margin: 0; padding: 24px; background: #fff; color: #1f2328; font: 13px/1.5 -apple-system, "Segoe UI", Manrope, Helvetica, Arial, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .report { max-width: 900px; margin: 0 auto; }
    header { border-bottom: 2px solid #C5A059; padding-bottom: 12px; margin-bottom: 18px; }
    .eyebrow { margin: 0; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: #8a6d2f; }
    h1 { margin: 4px 0 6px; font-size: 24px; line-height: 1.2; }
    .meta { margin: 0; color: #57606a; font-size: 12px; }
    h2 { font-size: 15px; margin: 22px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #e5e7eb; break-after: avoid; }
    section { break-inside: avoid; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { padding: 5px 8px; border-bottom: 1px solid #eef0f2; text-align: left; vertical-align: top; }
    td { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    table.list th { background: #f6f8fa; font-weight: 600; }
    table.list td { text-align: right; }
    table.list td.text { text-align: left; white-space: normal; }
    table.list th.num { text-align: right; }
    .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 10px; }
    .kpi { border: 1px solid #e5e7eb; border-radius: 8px; padding: 8px 10px; }
    .kpi span { display: block; font-size: 10.5px; color: #57606a; text-transform: uppercase; letter-spacing: .04em; }
    .kpi strong { font-size: 17px; font-variant-numeric: tabular-nums; }
    .pos { color: #2d6a4f; } .neg { color: #b42318; }
    .chart { width: 100%; height: auto; display: block; margin: 4px 0 10px; }
    .chart-zero { stroke: #9aa1a9; stroke-width: 1; stroke-dasharray: 4 4; }
    .chart-value { font-size: 13px; fill: #1f2328; font-weight: 600; }
    .chart-axis { font-size: 13px; fill: #57606a; }
    .chart-title { margin: 10px 0 0; font-size: 12.5px; font-weight: 600; color: #57606a; }
    .note { color: #57606a; font-size: 11.5px; margin: 6px 0 0; }
    ul.hyp { margin: 0; padding-left: 18px; color: #3d444d; font-size: 12px; }
    footer { margin-top: 24px; color: #8b949e; font-size: 10.5px; text-align: center; }
    @media (max-width: 640px) {
        .report-root { padding: 14px; }
        .grid { grid-template-columns: 1fr; }
        .kpis { grid-template-columns: 1fr 1fr; }
        table.list { font-size: 11px; }
    }
    @media print { .report-root { padding: 0; } .projection { break-before: page; } }
`;

export function buildAssetReportHTML(data) {
    const { bien, acquisition: a, actuel: c, travaux, projection } = data;
    const cr = a.credit;
    const first = projection[0]?.year;
    const last = projection[projection.length - 1]?.year;
    const tone = v => (v >= 0 ? 'pos' : 'neg');
    const cumulFinal = projection[projection.length - 1]?.cumul || 0;

    const creditRows = cr.montant > 0 ? `
        ${_kv('Montant emprunté', eur(cr.montant))}
        ${_kv('Taux nominal', `${_nf2.format(cr.taux)} %`)}
        ${_kv('Durée', `${cr.duree} ans${cr.anneeFin ? ` (fin ${cr.anneeFin})` : ''}`)}
        ${_kv('Assurance emprunteur', `${_nf2.format(cr.assurance)} %/an`)}
        ${_kv('Mensualité hors assurance', eur(cr.mensualiteHorsAssurance))}
        ${_kv(`Capital restant dû (fin ${new Date(data.generatedAt).getFullYear()})`, eur(cr.capitalRestantDu))}`
        : `<tr><th colspan="2">Aucun crédit renseigné</th></tr>`;

    const travauxHTML = travaux.lignes.length ? `
        <table class="list">
            <thead><tr><th>Date</th><th>Description</th><th class="num">Montant</th><th>Nature</th><th>Financement</th></tr></thead>
            <tbody>
                ${travaux.lignes.map(t => `
                <tr>
                    <td class="text">${escapeHtml(dateFr(t.date) || '—')}</td>
                    <td class="text">${escapeHtml(t.description || '—')}</td>
                    <td>${escapeHtml(eur(t.montant))}</td>
                    <td class="text">${escapeHtml(t.tagLabel)}</td>
                    <td class="text">${t.financeParCredit ? 'Crédit' : 'Cash'}</td>
                </tr>`).join('')}
            </tbody>
        </table>
        <p class="note">Total : ${escapeHtml(eur(travaux.total))} dont ${escapeHtml(eur(travaux.totalDeductible))} déductibles.</p>`
        : `<p class="note">Aucune dépense enregistrée.</p>`;

    const chartPoints = key => projection.map(p => ({ label: String(p.year), value: p[key] }));

    const bodyHTML = `
<main class="report">
    <header>
        <p class="eyebrow">Rapport du bien · ${escapeHtml(dateFr(data.generatedAt))}</p>
        <h1>${escapeHtml(bien.nom)}</h1>
        <p class="meta">${escapeHtml(_adresseComplete(bien) || 'Adresse non renseignée')} · ${escapeHtml(bien.typeBien)}${bien.surface ? ` · ${escapeHtml(_nf0.format(bien.surface))} m²` : ''}${bien.dateAchat ? ` · acheté en ${escapeHtml(bien.dateAchat)}` : ''}</p>
        <p class="meta">Régime fiscal : ${escapeHtml(data.regimeLabel)} · TMI ${escapeHtml(String(data.tmi))} %</p>
    </header>

    <section>
        <h2>Situation actuelle</h2>
        <div class="kpis">
            <div class="kpi"><span>CF net-net / mois</span><strong class="${tone(c.cfNetNet)}">${escapeHtml(eurSigned(c.cfNetNet))}</strong></div>
            <div class="kpi"><span>Rentabilité brute</span><strong>${escapeHtml(pct(c.rentaBrute))}</strong></div>
            <div class="kpi"><span>Rentabilité nette</span><strong>${escapeHtml(pct(c.rentaNette))}</strong></div>
            <div class="kpi"><span>DSCR</span><strong>${c.dscr > 0 ? escapeHtml(_nf2.format(c.dscr)) : '—'}</strong></div>
        </div>
        <table>
            ${_kv('Loyer (hors charges)', `${eur(c.loyer)} / mois`)}
            ${_kv(`Loyer encaissé (vacance ${c.vacancePct} %)`, `${eur(c.loyerEffectif)} / mois`)}
            ${_kv("Charges d'exploitation", `${eur(c.chargesMensuelles)} / mois`)}
            ${_kv('Mensualité crédit (avec assurance)', `${eur(c.mensualite)} / mois`)}
            ${_kv('Impôts (estimation)', `${eur(c.impotsAnnuels)} / an`)}
            ${_kv('Cash-flow net (avant impôts)', `${eurSigned(c.cfNet)} / mois`)}
            ${_kv('Cash-flow net-net (après impôts)', `${eurSigned(c.cfNetNet)} / mois`, true)}
        </table>
        <p class="note">Charges : taxe foncière ${escapeHtml(eur(c.taxeFonciere))}/an · copropriété ${escapeHtml(eur(c.chargesCopro))}/mois · assurance PNO ${escapeHtml(eur(c.assurancePNO))}/an · gestion ${escapeHtml(_nf1.format(c.gestionPct))} % des loyers.</p>
    </section>

    <div class="grid">
        <section>
            <h2>Achat</h2>
            <table>
                ${_kv("Prix d'achat", eur(a.prix))}
                ${_kv('Frais de notaire', eur(a.fraisNotaire))}
                ${_kv("Frais d'agence", eur(a.fraisAgence))}
                ${_kv('Investissement total', eur(a.investissementTotal), true)}
                ${_kv('Apport', eur(a.apport))}
            </table>
        </section>
        <section>
            <h2>Crédit</h2>
            <table>${creditRows}</table>
        </section>
    </div>

    <section>
        <h2>Travaux et dépenses</h2>
        ${travauxHTML}
    </section>

    <section class="projection">
        <h2>Prévisionnel sur 10 ans (${first} → ${last})</h2>
        <p class="chart-title">Cash-flow net-net annuel</p>
        ${buildLineChartSVG(chartPoints('cfAnnuel'), { ariaLabel: `Cash-flow annuel ${first}-${last}`, stroke: '#C5A059' })}
        <p class="chart-title">Cash-flow cumulé depuis le 1er janvier ${first} — <span class="${tone(cumulFinal)}">${escapeHtml(eurSigned(cumulFinal))} en ${last}</span></p>
        ${buildLineChartSVG(chartPoints('cumul'), { ariaLabel: `Cash-flow cumulé ${first}-${last}`, stroke: '#6366f1', area: true })}
        <table class="list">
            <thead><tr><th>Année</th><th class="num">Loyers encaissés</th><th class="num">Dépenses</th><th class="num">CF annuel</th><th class="num">CF cumulé</th></tr></thead>
            <tbody>
                ${projection.map(p => `
                <tr>
                    <td class="text">${p.year}</td>
                    <td>${escapeHtml(eur(p.loyers))}</td>
                    <td>${escapeHtml(eur(p.depenses))}</td>
                    <td class="${tone(p.cfAnnuel)}">${escapeHtml(eurSigned(p.cfAnnuel))}</td>
                    <td class="${tone(p.cumul)}">${escapeHtml(eurSigned(p.cumul))}</td>
                </tr>`).join('')}
            </tbody>
        </table>
    </section>

    <section>
        <h2>Hypothèses</h2>
        <ul class="hyp">${data.hypotheses.map(h => `<li>${escapeHtml(h)}</li>`).join('')}</ul>
    </section>

    <footer>Spark Investissement — estimations indicatives, ne constituent pas un conseil fiscal.</footer>
</main>`;

    const documentHTML = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rapport — ${escapeHtml(bien.nom)}</title>
<style>${REPORT_CSS}</style>
</head>
<body class="report-root">${bodyHTML}</body>
</html>`;

    // css + bodyHTML : pour imprimer le rapport dans la page elle-même (Shadow DOM, voir
    // printAssetReportInPage dans owned-portfolio.js) — sur Safari iOS, imprimer une iframe
    // imprime la page parente, pas le contenu de l'iframe.
    return { documentHTML, bodyHTML, css: REPORT_CSS, filename: `${_reportFilenameBase(data)}.pdf` };
}
