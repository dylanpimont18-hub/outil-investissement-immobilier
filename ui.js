import { CSG_CRDS_RATE, computeCF } from './calculs.js';

let myChart = null;
let evolutionChart = null;
let negoTableMode = 'pct';

export function setNegoTableMode(mode) { negoTableMode = mode; }

export function updateColor(id, value) {
    const el = document.getElementById(id);
    el.innerText = value.toFixed(2) + ' €';
    el.className = 'value ' + (value >= 0 ? 'positive' : 'negative');
}

function getThemeTextColor() {
    const isDark = document.documentElement.dataset.theme === 'dark' ||
        (!document.documentElement.dataset.theme &&
         window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    return isDark ? '#f4f4f5' : '#09090b';
}

export function updateChart(credit, charges, impots, cf) {
    const cfDisplay = cf > 0 ? cf : 0;
    const textColor = getThemeTextColor();

    if (myChart) {
        myChart.data.datasets[0].data = [credit, charges, impots, cfDisplay];
        myChart.options.plugins.legend.labels.color = textColor;
        myChart.update();
        return;
    }
    const ctx = document.getElementById('cashflowChart').getContext('2d');
    myChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Banque', 'Charges', 'Impôts', 'Cash-Flow'],
            datasets: [{ data: [credit, charges, impots, cfDisplay], backgroundColor: ['#F85149', '#ff9500', '#af52de', '#3FB950'], borderWidth: 0 }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: textColor } } } }
    });
}

export function updateEvolutionChart(labels, capitalRestant, cfCumule, enrichissement) {
    const textColor = getThemeTextColor();
    const cfColor = cfCumule[cfCumule.length - 1] >= 0 ? '#3FB950' : '#F85149';

    const datasets = [
        { label: 'Capital Restant Dû',   data: capitalRestant,  borderColor: '#3B82F6', borderWidth: 2,   tension: 0.3, fill: false, pointRadius: 3, pointHoverRadius: 5 },
        { label: 'Cash-Flow Cumulé',      data: cfCumule,        borderColor: cfColor,   borderWidth: 2,   tension: 0.3, fill: false, pointRadius: 3, pointHoverRadius: 5 },
        { label: 'Enrichissement Total',  data: enrichissement,  borderColor: '#C9A84C', borderWidth: 2.5, tension: 0.3, fill: false, pointRadius: 3, pointHoverRadius: 5 }
    ];

    if (evolutionChart) {
        evolutionChart.data.labels = labels;
        evolutionChart.data.datasets = datasets;
        evolutionChart.options.plugins.legend.labels.color = textColor;
        evolutionChart.options.scales.x.ticks.color = textColor;
        evolutionChart.options.scales.y.ticks.color = textColor;
        evolutionChart.update();
        return;
    }

    const ctx = document.getElementById('evolutionChart').getContext('2d');
    evolutionChart = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'top', labels: { color: textColor, usePointStyle: true, padding: 15, font: { size: 11 } } },
                tooltip: { callbacks: { label: function(ctx) { return ctx.dataset.label + ' : ' + Math.round(ctx.raw).toLocaleString('fr-FR') + ' €'; } } }
            },
            scales: {
                x: { ticks: { color: textColor }, grid: { display: false } },
                y: { ticks: { color: textColor, callback: function(v) { return Math.round(v / 1000) + 'k €'; } }, grid: { color: 'rgba(142,142,147,0.15)' } }
            }
        }
    });
}

export function updateScoreBanner(cfNetNet, rentaNette, tips) {
    let pts = 0;
    if (cfNetNet >= 300) pts += 3; else if (cfNetNet >= 100) pts += 2; else if (cfNetNet >= 0) pts += 1;
    if (rentaNette >= 7) pts += 3; else if (rentaNette >= 5) pts += 2; else if (rentaNette >= 3.5) pts += 1;

    let cls, label, phrase, stars;
    if (pts >= 5) {
        cls    = 'verdict--rentable';
        label  = 'Rentable';
        stars  = '★★★';
        phrase = 'Ce bien présente un profil solide. Vous pouvez avancer sereinement.';
    } else if (pts >= 3) {
        cls    = 'verdict--correct';
        label  = 'Correct — à négocier';
        stars  = '★★☆';
        phrase = 'Ce bien est viable, mais une négociation du prix améliorerait sensiblement la rentabilité.';
    } else if (pts >= 1) {
        cls    = 'verdict--fragile';
        label  = 'Fragile';
        stars  = '★☆☆';
        phrase = 'Ce bien reste équilibré dans le meilleur des cas. Examinez les leviers avant de vous engager.';
    } else {
        cls    = 'verdict--eviter';
        label  = 'À éviter';
        stars  = '☆☆☆';
        phrase = 'Ce bien génère un cash-flow négatif significatif. Il est déconseillé sans renégociation majeure.';
    }

    const banner = document.getElementById('score-banner');
    banner.className = 'score-banner ' + cls;
    document.getElementById('score-label').innerText = label;
    document.getElementById('score-stars').innerText = stars;

    const sign = cfNetNet >= 0 ? '+' : '';
    document.getElementById('score-detail').innerText =
        `CF ${sign}${Math.round(cfNetNet)} €/mois · Renta nette ${rentaNette.toFixed(1)} %`;

    const phraseEl = document.getElementById('verdict-phrase');
    if (phraseEl) phraseEl.innerText = phrase;

    const emojiEl = document.getElementById('score-emoji');
    if (emojiEl) emojiEl.innerText = '';

    _updateVerdictWhy(cfNetNet, rentaNette, tips, pts);
}

function _updateVerdictWhy(cfNetNet, rentaNette, tips, pts) {
    const el = document.getElementById('verdict-why');
    if (!el) return;
    const sign = cfNetNet >= 0 ? '+' : '';
    const cfStr = `${sign}${Math.round(cfNetNet)} €/mois`;
    const rentaStr = `${rentaNette.toFixed(1)} %`;
    const topTip = tips && tips.find(t => t.gainPerMonth && t.gainPerMonth > 0 && t.shortAdvice);

    let msg = '';
    if (pts >= 5) {
        msg = `Ce bien affiche un cash-flow de ${cfStr} et une rentabilité nette de ${rentaStr}. Les fondamentaux sont solides — c'est une opportunité à saisir.`;
    } else if (pts >= 3) {
        msg = `Bon investissement. Le cash-flow de ${cfStr} est positif et la rentabilité nette de ${rentaStr} est convenable.`;
        if (topTip) msg += ` Pour aller plus loin : ${topTip.shortAdvice.toLowerCase()}.`;
    } else if (pts >= 1) {
        msg = `Investissement moyen. Le cash-flow de ${cfStr} est limité et la rentabilité nette de ${rentaStr} reste faible.`;
        if (topTip) msg += ` Levier principal : ${topTip.shortAdvice.toLowerCase()}.`;
        else msg += ` Des ajustements sont recommandés avant de s'engager.`;
    } else {
        msg = `Opération risquée. Le cash-flow de ${cfStr} est négatif — vous devrez compléter le financement chaque mois.`;
        if (topTip) msg += ` Action prioritaire : ${topTip.shortAdvice.toLowerCase()}.`;
        else msg += ` Négociez le prix ou optimisez la fiscalité avant de vous engager.`;
    }
    el.textContent = msg;
}

export function updateRegimeComparison(prixNet, inputs, tmi, loyersEncaisses, chargesExploitationAnnuelles, coutAssuranceMensuel, firstYearInterets) {
    const currentRegime = inputs['regime'];
    const loyer = inputs['loyer'];

    const allRegimes = [
        { id: 'micro-foncier', label: 'Micro-Foncier' },
        { id: 'reel',          label: 'Foncier Réel'  },
        { id: 'sci-is',        label: 'SCI à l\'IS'   },
    ];

    const results = allRegimes.map(r => {
        const cf = computeCF(prixNet, loyer, Object.assign({}, inputs, { regime: r.id }), tmi);
        return { ...r, cf };
    });

    const bestCF = Math.max(...results.map(r => r.cf));

    document.getElementById('regime-compare-grid').innerHTML = results.map(r => {
        const isBest = r.cf === bestCF;
        const isCurrent = r.id === currentRegime;
        const color = r.cf >= 0 ? 'var(--success-color)' : 'var(--danger-color)';
        const cfHTML = `<span style="color:${color}">${r.cf >= 0 ? '+' : ''}${Math.round(r.cf)} €</span>`;
        let badge = '';
        if (isBest) badge = `<div class="regime-badge" style="color:var(--success-color)">✅ Meilleur</div>`;
        else if (isCurrent) badge = `<div class="regime-badge" style="color:var(--primary-color)">◀ Actuel</div>`;
        else badge = `<div class="regime-badge">&nbsp;</div>`;

        const cls = ['regime-card', isBest ? 'regime-best' : ''].join(' ').trim();
        return `<div class="${cls}"><div class="regime-name">${r.label}</div><div class="regime-cf">${cfHTML}</div>${badge}</div>`;
    }).join('');

    // --- Détail fiscal comparatif ---
    if (loyersEncaisses !== undefined) {
        const fmt = n => Math.round(n).toLocaleString('fr-FR');
        const assuranceAnnuelle = coutAssuranceMensuel * 12;

        const microAbattement = loyersEncaisses * 0.30;
        const microBase = loyersEncaisses * 0.70;
        const microIR  = microBase * (tmi / 100);
        const microCSG = microBase * CSG_CRDS_RATE;
        const microTotal = microIR + microCSG;

        const chargesReelDeductibles = chargesExploitationAnnuelles + assuranceAnnuelle + firstYearInterets + inputs['travaux'] + inputs['frais-bancaires'];
        const reelBase = loyersEncaisses - chargesReelDeductibles;
        let reelIR, reelCSG, reelTotal;
        let reelBaseLabel, deficitNote = '';
        if (reelBase > 0) {
            reelIR    = reelBase * (tmi / 100);
            reelCSG   = reelBase * CSG_CRDS_RATE;
            reelTotal = reelIR + reelCSG;
            reelBaseLabel = fmt(reelBase) + ' €';
        } else {
            const soldeHorsInterets = loyersEncaisses - (chargesExploitationAnnuelles + assuranceAnnuelle + inputs['travaux'] + inputs['frais-bancaires']);
            if (soldeHorsInterets < 0) {
                const imputable = Math.min(10700, Math.abs(soldeHorsInterets));
                reelIR    = -(imputable * (tmi / 100));
                reelCSG   = 0;
                reelTotal = reelIR;
                deficitNote = ` (dont ${fmt(imputable)} € imputés sur revenu global)`;
            } else {
                reelIR = 0; reelCSG = 0; reelTotal = 0;
            }
            reelBaseLabel = `Déficit ${fmt(Math.abs(reelBase))} €`;
        }

        const bestTotal = Math.min(microTotal, reelTotal);
        const clsMicro = microTotal === bestTotal ? 'fiscal-best' : '';
        const clsReel  = reelTotal  === bestTotal ? 'fiscal-best' : '';

        document.getElementById('fiscal-breakdown').innerHTML = `
            <table class="fiscal-breakdown-table">
                <thead><tr><th></th><th>Micro-Foncier</th><th>Foncier Réel</th></tr></thead>
                <tbody>
                    <tr><td>Revenus fonciers bruts</td><td>${fmt(loyersEncaisses)} €</td><td>${fmt(loyersEncaisses)} €</td></tr>
                    <tr><td>Charges déductibles</td><td>−${fmt(microAbattement)} € (30 %)</td><td>−${fmt(chargesReelDeductibles)} € (réel)</td></tr>
                    <tr><td>Base imposable</td><td>${fmt(microBase)} €</td><td>${reelBaseLabel}${deficitNote}</td></tr>
                    <tr><td>Impôt sur le revenu (TMI ${tmi} %)</td><td>${fmt(microIR)} €</td><td>${fmt(reelIR)} €</td></tr>
                    <tr><td>CSG / CRDS (17,2 %)</td><td>${fmt(microCSG)} €</td><td>${fmt(reelCSG)} €</td></tr>
                    <tr class="fiscal-total"><td>Total fiscalité / an</td><td class="${clsMicro}">${fmt(microTotal)} €</td><td class="${clsReel}">${fmt(reelTotal)} €</td></tr>
                    <tr class="fiscal-total"><td>Impact sur le CF / mois</td><td class="${clsMicro}">−${fmt(microTotal / 12)} €</td><td class="${clsReel}">${reelTotal >= 0 ? '−' : '+'}${fmt(Math.abs(reelTotal / 12))} €</td></tr>
                </tbody>
            </table>`;
    }
}

// ===== CONSEILS D'OPTIMISATION =====
export function generateOptimizationTips(inputs, tmi, data) {
    const tips = [];
    const { prixNet, cfNetNet, loyersEncaisses, chargesExploitationAnnuelles, coutAssuranceMensuel, firstYearInterets } = data;
    const tauxGlobalImpot = (tmi / 100) + CSG_CRDS_RATE;
    const loyer = inputs['loyer'];

    const cfMicro = computeCF(prixNet, loyer, Object.assign({}, inputs, { regime: 'micro-foncier' }), tmi);
    const cfReel  = computeCF(prixNet, loyer, Object.assign({}, inputs, { regime: 'reel' }), tmi);
    const cfSciIs = computeCF(prixNet, loyer, Object.assign({}, inputs, { regime: 'sci-is' }), tmi);
    const currentRegime = inputs['regime'];
    const cfCurrent = currentRegime === 'micro-foncier' ? cfMicro : (currentRegime === 'reel' ? cfReel : cfSciIs);
    const allAlternatives = [
        { id: 'micro-foncier', label: 'Micro-Foncier', cf: cfMicro },
        { id: 'reel', label: 'Foncier Réel', cf: cfReel },
        { id: 'sci-is', label: 'SCI à l\'IS', cf: cfSciIs },
    ].filter(r => r.id !== currentRegime);
    const bestAlt = allAlternatives.reduce((a, b) => a.cf > b.cf ? a : b);
    const cfOther   = bestAlt.cf;
    const otherLabel = bestAlt.label;
    const diff = Math.round(cfOther - cfCurrent);

    const chargesReellesAnnuelles = chargesExploitationAnnuelles + (coutAssuranceMensuel * 12) + firstYearInterets + inputs['travaux'] + inputs['frais-bancaires'];
    const pctChargesReelles = loyersEncaisses > 0 ? Math.round((chargesReellesAnnuelles / loyersEncaisses) * 100) : 0;

    if (diff > 0) {
        let expl = '';
        if (currentRegime === 'micro-foncier') {
            expl = `Vos charges réelles représentent ${pctChargesReelles} % de vos loyers, soit plus que l'abattement forfaitaire de 30 % du Micro-Foncier. En passant au Foncier Réel, vous déduiriez ${Math.round(chargesReellesAnnuelles).toLocaleString('fr-FR')} € de charges réelles au lieu de ${Math.round(loyersEncaisses * 0.3).toLocaleString('fr-FR')} € d'abattement.`;
        } else {
            expl = `Vos charges réelles ne représentent que ${pctChargesReelles} % de vos loyers. L'abattement forfaitaire de 30 % du Micro-Foncier serait plus avantageux et simplifie votre comptabilité.`;
        }
        tips.push({ icon: '⚖️', title: `Passez au ${otherLabel}`, explanation: expl, gainPerMonth: diff, shortAdvice: `Passez au ${otherLabel} pour +${diff} €/mois`, category: 'fiscal' });
    } else {
        const saving = Math.abs(diff);
        const currentLabel = currentRegime === 'micro-foncier' ? 'Micro-Foncier' : (currentRegime === 'reel' ? 'Foncier Réel' : 'SCI à l\'IS');
        tips.push({ icon: '✅', title: `Régime fiscal optimal`, explanation: `Vous êtes déjà sur le régime le plus avantageux (${currentLabel}). Il vous fait économiser ${saving} €/mois par rapport aux autres régimes.`, gainPerMonth: 0, shortAdvice: null, category: 'fiscal' });
    }

    if (currentRegime === 'reel' || cfReel > cfMicro) {
        const chargesAnnueesReel = chargesExploitationAnnuelles + (coutAssuranceMensuel * 12) + inputs['travaux'] + inputs['frais-bancaires'];
        const revenusNets = loyersEncaisses - chargesAnnueesReel - firstYearInterets;
        if (revenusNets < 0) {
            const soldeHorsInterets = loyersEncaisses - chargesAnnueesReel;
            if (soldeHorsInterets < 0) {
                const deficitTotal    = Math.abs(revenusNets);
                const imputable       = Math.min(10700, Math.abs(soldeHorsInterets));
                const economieIR      = Math.round(imputable * (tmi / 100));
                const capaciteRestante = 10700 - imputable;
                tips.push({
                    icon: '🏗️', title: 'Déficit foncier actif',
                    explanation: `Votre déficit foncier est de ${Math.round(deficitTotal).toLocaleString('fr-FR')} €/an. La part imputable sur votre revenu global (hors intérêts) est de ${Math.round(imputable).toLocaleString('fr-FR')} € (plafond 10 700 €). Cela vous fait économiser ${economieIR.toLocaleString('fr-FR')} € d'impôt sur le revenu cette année, soit ${Math.round(economieIR / 12)} €/mois.${capaciteRestante > 0 ? ` Il vous reste ${Math.round(capaciteRestante).toLocaleString('fr-FR')} € de capacité d'imputation.` : ' Vous utilisez 100 % du plafond.'}`,
                    gainPerMonth: null, shortAdvice: null, category: 'fiscal'
                });

                if (capaciteRestante > 0 && tmi > 0) {
                    const economiePotentielle = Math.round(capaciteRestante * (tmi / 100));
                    tips.push({
                        icon: '🔧', title: 'Optimisez via des travaux',
                        explanation: `Chaque euro de travaux supplémentaires vous fait économiser ${tmi} centimes d'impôt (TMI à ${tmi} %). Vous pouvez encore déduire jusqu'à ${Math.round(capaciteRestante).toLocaleString('fr-FR')} € de travaux avant d'atteindre le plafond de déficit foncier, soit une économie potentielle de ${economiePotentielle.toLocaleString('fr-FR')} €/an (${Math.round(economiePotentielle / 12)} €/mois).`,
                        gainPerMonth: Math.round(economiePotentielle / 12), shortAdvice: `+${Math.round(economiePotentielle / 12)} €/mois possibles via travaux`, category: 'fiscal'
                    });
                }
            }
        }
    }

    if ((currentRegime === 'reel' || cfReel > cfMicro) && firstYearInterets > 0) {
        const economieInterets = Math.round(firstYearInterets * tauxGlobalImpot);
        tips.push({
            icon: '🏦', title: 'Intérêts d\'emprunt déductibles',
            explanation: `En 1ère année, vous déduisez ${Math.round(firstYearInterets).toLocaleString('fr-FR')} € d'intérêts d'emprunt. Cela représente une économie fiscale potentielle de ${economieInterets.toLocaleString('fr-FR')} €/an (soit ${Math.round(economieInterets / 12)} €/mois). Cette déduction diminue chaque année à mesure que le capital est remboursé.`,
            gainPerMonth: null, shortAdvice: null, category: 'fiscal'
        });
    }

    if (inputs['gestion'] > 0) {
        const cfSansAgence = computeCF(prixNet, loyer, Object.assign({}, inputs, { gestion: 0 }), tmi);
        const gain = Math.round(cfSansAgence - cfNetNet);
        if (gain > 0) {
            const fraisGestionAnnuels = Math.round(loyersEncaisses * (inputs['gestion'] / 100));
            tips.push({
                icon: '🤝', title: 'Gérez vous-même votre bien',
                explanation: `En gérant vous-même votre bien (sans agence), votre cash-flow augmenterait de ${gain} €/mois. Les frais de gestion actuels de ${inputs['gestion']} % représentent ${fraisGestionAnnuels.toLocaleString('fr-FR')} €/an.`,
                gainPerMonth: gain, shortAdvice: `Autogestion : +${gain} €/mois`, category: 'profit'
            });
        }
    }

    if (inputs['vacance'] > 0) {
        const cfSansVacance = computeCF(prixNet, loyer, Object.assign({}, inputs, { vacance: 0 }), tmi);
        const gain = Math.round(cfSansVacance - cfNetNet);
        if (gain > 0) {
            tips.push({
                icon: '🏠', title: 'Réduisez la vacance locative',
                explanation: `En éliminant la vacance locative de ${inputs['vacance']} %, votre cash-flow augmenterait de ${gain} €/mois. Visez un bail solide et un emplacement attractif pour garder votre bien toujours loué.`,
                gainPerMonth: gain, shortAdvice: `0 % vacance : +${gain} €/mois`, category: 'profit'
            });
        }
    }

    const prixAffiche = inputs['prix'];
    if (prixAffiche > 0) {
        const prixNetMoins1 = prixNet - (prixAffiche * 0.01);
        const cfGain = Math.round(computeCF(prixNetMoins1, loyer, inputs, tmi) - cfNetNet);
        if (cfGain > 0) {
            tips.push({
                icon: '📉', title: 'Négociez le prix d\'achat',
                explanation: `Chaque 1 % de négociation supplémentaire sur le prix affiché (soit ${Math.round(prixAffiche * 0.01).toLocaleString('fr-FR')} €) améliorerait votre cash-flow de ${cfGain} €/mois.`,
                gainPerMonth: cfGain, shortAdvice: `1 % de négo = +${cfGain} €/mois`, category: 'profit'
            });
        }
    }

    if (inputs['assurance'] > 0.20) {
        const cfMeilleurAssurance = computeCF(prixNet, loyer, Object.assign({}, inputs, { assurance: 0.15 }), tmi);
        const gain = Math.round(cfMeilleurAssurance - cfNetNet);
        if (gain > 0) {
            tips.push({
                icon: '🛡️', title: 'Renégociez votre assurance emprunteur',
                explanation: `Votre taux d'assurance emprunteur est de ${inputs['assurance']} %. En le renégociant à 0.15 % (délégation d'assurance), vous économiseriez ${gain} €/mois. La loi Lemoine vous permet de changer à tout moment.`,
                gainPerMonth: gain, shortAdvice: `Assurance à 0.15 % : +${gain} €/mois`, category: 'profit'
            });
        }
    }

    tips.sort((a, b) => {
        if (a.gainPerMonth && !b.gainPerMonth) return -1;
        if (!a.gainPerMonth && b.gainPerMonth) return 1;
        return (b.gainPerMonth || 0) - (a.gainPerMonth || 0);
    });

    return tips;
}

export function renderOptimizationSection(tips) {
    const container = document.getElementById('optimization-tips-container');
    if (!container) return;

    if (tips.length === 0) {
        container.innerHTML = '<div class="tip-optimized">✅ Votre investissement est déjà bien optimisé !</div>';
        return;
    }

    container.innerHTML = tips.map(t => {
        const cls = t.category === 'fiscal' ? 'tip-fiscal' : 'tip-profit';
        const gainHTML = (t.gainPerMonth && t.gainPerMonth > 0) ? `<div class="tip-gain">+${t.gainPerMonth} €/mois</div>` : '';
        return `<div class="tip-card ${cls}">
            <div class="tip-icon">${t.icon}</div>
            <div class="tip-content">
                <div class="tip-title">${t.title}</div>
                <div class="tip-explanation">${t.explanation}</div>
            </div>
            ${gainHTML}
        </div>`;
    }).join('');
}

export function updateNegoTable(prixNet, prixAffiche, inputs, tmi) {
    const loyer = inputs['loyer'];
    const container = document.getElementById('nego-table-container');
    if (!container) return;

    if (negoTableMode === 'regimes') {
        const regimes = [{ id: 'micro-foncier', label: 'Micro-Foncier' }, { id: 'reel', label: 'Foncier Réel' }, { id: 'sci-is', label: 'SCI à l\'IS' }];

        let html = `<table class="nego-table">
            <thead><tr>
                <th>Négo.</th>
                <th>Prix vendeur</th>
                ${regimes.map(r => `<th style="color:var(--primary-color)">${r.label}</th>`).join('')}
            </tr></thead><tbody>`;

        for (let pct = 0; pct <= 25; pct++) {
            const prix = prixAffiche * (1 - pct / 100);
            const isCurrent = Math.abs(prix - prixNet) < 1;
            html += `<tr class="${isCurrent ? 'nego-row-current' : ''}">
                <td>${pct} %</td>
                <td style="color:#8e8e93">${Math.round(prix).toLocaleString('fr-FR')} €</td>
                ${regimes.map(r => {
                    const cf = computeCF(prix, loyer, Object.assign({}, inputs, { regime: r.id }), tmi);
                    const color = cf >= 0 ? 'var(--success-color)' : 'var(--danger-color)';
                    const sign = cf >= 0 ? '+' : '';
                    return `<td style="color:${color};font-weight:600">${sign}${Math.round(cf)} €</td>`;
                }).join('')}
            </tr>`;
        }
        html += '</tbody></table>';
        container.innerHTML = html;
        return;
    }

    let rows = [];
    for (let pct = 0; pct <= 25; pct++) {
        const prix = prixAffiche * (1 - pct / 100);
        const cf = computeCF(prix, loyer, inputs, tmi);
        rows.push({ col1: pct + ' %', col2: Math.round(prixAffiche * pct / 100).toLocaleString('fr-FR') + ' €', prix: Math.round(prix), cf });
    }

    let html = `<table class="nego-table">
        <thead><tr><th>Négociation</th><th>Montant</th><th>Prix vendeur</th><th>CF net-net / mois</th></tr></thead><tbody>`;
    rows.forEach(row => {
        const isCurrent = Math.abs(row.prix - prixNet) < 1;
        const cfColor = row.cf >= 0 ? 'var(--success-color)' : 'var(--danger-color)';
        const sign = row.cf >= 0 ? '+' : '';
        html += `<tr class="${isCurrent ? 'nego-row-current' : ''}">
            <td>${row.col1}</td>
            <td style="color:#8e8e93">${row.col2}</td>
            <td>${row.prix.toLocaleString('fr-FR')} €</td>
            <td style="color:${cfColor};font-weight:600">${sign}${Math.round(row.cf)} €</td>
        </tr>`;
    });
    html += '</tbody></table>';
    container.innerHTML = html;
}

export function showToast(message, type = 'info', duration = 3500) {
    const icons = { success: '✅', error: '❌', info: 'ℹ️' };
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span class="toast-icon">${icons[type]}</span><span>${message}</span>`;
    container.appendChild(toast);
    requestAnimationFrame(() => { requestAnimationFrame(() => toast.classList.add('show')); });
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

export function validateInputs(inputs) {
    const warnings = [];
    const fields = {};

    if (!inputs['prix'] || inputs['prix'] <= 0) {
        warnings.push('Le prix affiché doit être supérieur à 0.');
        fields['prix'] = 'error';
    }
    if (!inputs['loyer'] || inputs['loyer'] <= 0) {
        warnings.push('Le loyer mensuel doit être supérieur à 0.');
        fields['loyer'] = 'error';
    }
    if (!inputs['taux-input'] || inputs['taux-input'] <= 0) {
        warnings.push('Le taux d\'intérêt doit être supérieur à 0 %.');
        fields['taux-input'] = 'error';
    }
    if (!inputs['duree'] || inputs['duree'] <= 0) {
        warnings.push('La durée du prêt doit être supérieure à 0 ans.');
        fields['duree'] = 'error';
    }
    if (inputs['vacance'] < 0 || inputs['vacance'] > 100) {
        warnings.push('La vacance locative doit être entre 0 % et 100 %.');
        fields['vacance'] = 'warning';
    }
    if (inputs['gestion'] < 0 || inputs['gestion'] > 100) {
        warnings.push('Les frais de gestion doivent être entre 0 % et 100 %.');
        fields['gestion'] = 'warning';
    }
    if (inputs['nego'] < 0) {
        warnings.push('La négociation obtenue ne peut pas être négative.');
        fields['nego'] = 'warning';
    }

    document.querySelectorAll('input.input-warning, input.input-error').forEach(el => {
        el.classList.remove('input-warning', 'input-error');
    });
    Object.entries(fields).forEach(([id, level]) => {
        const el = document.getElementById(id);
        if (el) el.classList.add(level === 'error' ? 'input-error' : 'input-warning');
    });

    const container = document.getElementById('form-warnings');
    if (container) {
        container.innerHTML = warnings.map(w =>
            `<div class="form-warning-item">⚠️ ${w}</div>`
        ).join('');
    }

    return warnings.length === 0;
}

// === HAPTIQUE ===
function haptic() { if (navigator.vibrate) navigator.vibrate(10); }

// === BOTTOM SHEET — INFOBULLES ===
(function() {
    const overlay = document.getElementById('tip-sheet-overlay');
    const body    = document.getElementById('tip-sheet-body');
    const closeBtn = document.getElementById('tip-sheet-close');
    if (!overlay || !body) return;

    function open(text) {
        body.textContent = text;
        overlay.classList.add('open');
        document.body.style.overflow = 'hidden';
    }
    function close() {
        overlay.classList.remove('open');
        document.body.style.overflow = '';
    }

    document.addEventListener('click', (e) => {
        const tip = e.target.closest('.help-tip');
        if (tip && tip.dataset.tip) {
            e.preventDefault();
            e.stopPropagation();
            haptic();
            open(tip.dataset.tip);
            return;
        }
        if (e.target === overlay) { close(); return; }
    });
    if (closeBtn) closeBtn.addEventListener('click', close);
})();

// === MODE TOGGLE (Simplifié / Expert) ===
(function() {
    const DEFAULTS = {
        'nego': 0, 'agence': 0, 'type-bien': 'ancien', 'notaire': 8,
        'travaux': 0, 'meubles': 0, 'frais-bancaires': 1500,
        'taux-input': 3.17, 'taux-slider': 3.17, 'assurance': 0.30,
        'copro': 40, 'fonciere': 1500, 'pno': 150, 'vacance': 5,
        'gestion': 7, 'revenus': 60000, 'regime': 'micro-foncier'
    };
    const PROXY_FIELDS = [
        { simpleId: 'simple-prix',   realId: 'prix'   },
        { simpleId: 'simple-loyer',  realId: 'loyer'  },
        { simpleId: 'simple-apport', realId: 'apport' },
        { simpleId: 'simple-duree',  realId: 'duree'  },
    ];

    const toggle      = document.getElementById('mode-toggle');
    const simpDiv     = document.getElementById('simplified-inputs');
    const expertGrid  = document.querySelector('#view-inputs .grid-2-cols');
    const labelSimple = document.getElementById('label-simple');
    const labelExpert = document.getElementById('label-expert');
    if (!toggle || !simpDiv) return;

    function syncRealToProxy() {
        PROXY_FIELDS.forEach(({ simpleId, realId }) => {
            const proxy = document.getElementById(simpleId);
            const real  = document.getElementById(realId);
            if (proxy && real) proxy.value = real.value;
        });
    }
    function syncProxyToReal() {
        PROXY_FIELDS.forEach(({ simpleId, realId }) => {
            const proxy = document.getElementById(simpleId);
            const real  = document.getElementById(realId);
            if (proxy && real) real.value = proxy.value;
        });
    }
    function applyDefaults() {
        Object.entries(DEFAULTS).forEach(([id, val]) => {
            const el = document.getElementById(id);
            if (el) el.value = val;
        });
    }
    const btnRapide   = document.getElementById('btn-mode-rapide');
    const btnExpert   = document.getElementById('btn-mode-expert');
    const formProgress = document.querySelector('.form-progress');

    function setMode(isExpert) {
        if (isExpert) {
            simpDiv.style.display    = 'none';
            if (expertGrid) expertGrid.style.display = '';
            if (formProgress) formProgress.style.display = '';
            if (btnRapide) btnRapide.classList.remove('mode-pill-active');
            if (btnExpert) btnExpert.classList.add('mode-pill-active');
        } else {
            syncRealToProxy();
            applyDefaults();
            syncProxyToReal();
            simpDiv.style.display    = 'block';
            if (expertGrid) expertGrid.style.display = 'none';
            if (formProgress) formProgress.style.display = 'none';
            if (btnRapide) btnRapide.classList.add('mode-pill-active');
            if (btnExpert) btnExpert.classList.remove('mode-pill-active');
        }
        document.getElementById('calc-form').dispatchEvent(new Event('input', { bubbles: true }));
    }

    if (btnRapide) btnRapide.addEventListener('click', () => { haptic(); toggle.checked = false; setMode(false); });
    if (btnExpert) btnExpert.addEventListener('click', () => { haptic(); toggle.checked = true;  setMode(true);  });

    // Sync des inputs proxy → real
    document.querySelectorAll('.simple-input').forEach(input => {
        input.addEventListener('input', () => {
            const real = document.getElementById(input.dataset.realId);
            if (real) { real.value = input.value; real.dispatchEvent(new Event('input', { bubbles: true })); }
        });
    });

    // Init : mode Estimation rapide par défaut
    toggle.checked = false;
    setMode(false);
})();

// === HAPTIQUE SUR BOUTONS PRINCIPAUX ===
(function() {
    document.querySelectorAll('.btn-simulate, .tab-btn, .btn-primary, .btn-load, .btn-small').forEach(btn => {
        btn.addEventListener('click', () => haptic(), { passive: true });
    });
})();

const _donutInstances = new Map();

export function renderDonutChart(canvasId, credit, charges, impots, cf) {
    const textColor = getThemeTextColor();
    const cfDisplay = Math.max(0, cf);
    const cfNeg = cf < 0 ? Math.abs(cf) : 0;
    const data = [credit, charges, impots, cfDisplay, cfNeg];
    const colors = ['#F85149', '#ff9500', '#af52de', '#3FB950', '#6e6e6e'];
    const labels = ['Banque', 'Charges', 'Impôts', 'CF net-net', 'CF négatif'];

    if (_donutInstances.has(canvasId)) {
        const chart = _donutInstances.get(canvasId);
        chart.data.datasets[0].data = data;
        chart.options.plugins.legend.labels.color = textColor;
        chart.update();
        return;
    }

    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const chart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{ data, backgroundColor: colors, borderWidth: 0 }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'right', labels: { color: textColor, font: { size: 11 } } },
                tooltip: {
                    callbacks: {
                        label: ctx => {
                            const v = ctx.raw;
                            return v > 0 ? ` ${Math.round(v).toLocaleString('fr-FR')} €/mois` : null;
                        }
                    }
                }
            }
        }
    });
    _donutInstances.set(canvasId, chart);
}

export function destroyDonut(canvasId) {
    if (_donutInstances.has(canvasId)) {
        _donutInstances.get(canvasId).destroy();
        _donutInstances.delete(canvasId);
    }
}
