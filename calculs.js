export const CSG_CRDS_RATE = 0.172; // Taux CSG+CRDS sur revenus du capital (2024)

const REGIME_LABELS = {
    'micro-foncier': 'Micro-foncier',
    'reel': 'Foncier Réel',
    'sci-is': 'SCI à l\'IS'
};

export function getHouseholdTaxParts(adults = 2, enfants = 0) {
    const adultCount = Math.min(2, Math.max(1, Math.round(Number(adults) || 2)));
    const childCount = Math.max(0, Math.round(Number(enfants) || 0));

    let parts = adultCount;
    if (childCount === 1) parts += 0.5;
    else if (childCount >= 2) parts += 1.0 + (childCount - 2);
    return parts;
}

export function calculateTMI(revenus, foyer = 0) {
    const hasObjectShape = typeof foyer === 'object' && foyer !== null;
    const adults = hasObjectShape ? foyer.adults : 2;
    const enfants = hasObjectShape ? foyer.children : foyer;
    const parts = getHouseholdTaxParts(adults, enfants);
    const quotient = Math.max(0, Number(revenus) || 0) / parts;
    if (quotient <= 11294) return 0;
    if (quotient <= 28797) return 11;
    if (quotient <= 82341) return 30;
    if (quotient <= 177106) return 41;
    return 45;
}

function computeAnnualTaxEstimate(prixNet, loyersEncaisses, chargesExploitationAnnuelles, inputs, tmi, interestYear, insuranceYear, year = 1) {
    const tauxGlobalImpot = (tmi / 100) + CSG_CRDS_RATE;
    const oneOffCharges = year === 1 ? (inputs['travaux'] || 0) + (inputs['frais-bancaires'] || 0) : 0;

    if (inputs['regime'] === 'micro-foncier') {
        return (loyersEncaisses * 0.7) * tauxGlobalImpot;
    }

    if (inputs['regime'] === 'reel') {
        const chargesAnnuelles = chargesExploitationAnnuelles + insuranceYear + oneOffCharges;
        const revenusNets = loyersEncaisses - chargesAnnuelles - interestYear;
        if (revenusNets > 0) {
            return revenusNets * tauxGlobalImpot;
        }

        const soldeHorsInterets = loyersEncaisses - chargesAnnuelles;
        if (soldeHorsInterets < 0) {
            return -(Math.min(10700, Math.abs(soldeHorsInterets)) * (tmi / 100));
        }
        return 0;
    }

    if (inputs['regime'] === 'sci-is') {
        const amortissement = prixNet * 0.80 / 30;
        const chargesDeductibles = chargesExploitationAnnuelles + insuranceYear + interestYear + oneOffCharges;
        const benefice = loyersEncaisses - chargesDeductibles - amortissement;
        if (benefice > 0) {
            return Math.min(benefice, 42500) * 0.15 + Math.max(0, benefice - 42500) * 0.25;
        }
    }

    return 0;
}

function buildFinancialModel(prixNet, loyerMensuel, inputs, tmi) {
    const fraisNotaire = prixNet * (inputs['notaire'] / 100);
    const fraisFixes = inputs['agence'] + inputs['travaux'] + inputs['meubles'] + inputs['frais-bancaires'];
    const coutTotal = prixNet + fraisNotaire + fraisFixes;
    const montantFinance = Math.max(0, coutTotal - inputs['apport']);

    const nMois = inputs['duree'] * 12;
    const tauxMensuel = (inputs['taux-input'] / 100) / 12;
    let mensualiteCredit = 0;
    if (tauxMensuel > 0 && nMois > 0) mensualiteCredit = (montantFinance * tauxMensuel) / (1 - Math.pow(1 + tauxMensuel, -nMois));
    else if (nMois > 0) mensualiteCredit = montantFinance / nMois;

    const coutAssuranceMensuel = (montantFinance * (inputs['assurance'] / 100)) / 12;
    const mensualiteTotale = mensualiteCredit + coutAssuranceMensuel;

    const loyersAnnuelsTheoriques = loyerMensuel * 12;
    const loyersEncaisses = loyersAnnuelsTheoriques * (1 - (inputs['vacance'] / 100));
    const chargesExploitationAnnuelles = (inputs['copro'] * 12) + inputs['fonciere'] + inputs['pno'] + (loyersEncaisses * (inputs['gestion'] / 100));

    let capitalRestant = montantFinance;
    let interetsAnnee1 = 0;
    for (let m = 0; m < 12; m++) {
        if (capitalRestant > 0) {
            let interetMois = capitalRestant * tauxMensuel;
            let capMois = mensualiteCredit - interetMois;
            interetsAnnee1 += interetMois;
            capitalRestant -= capMois;
        }
    }

    const impotsAnnee = computeAnnualTaxEstimate(
        prixNet,
        loyersEncaisses,
        chargesExploitationAnnuelles,
        inputs,
        tmi,
        interetsAnnee1,
        coutAssuranceMensuel * 12,
        1
    );

    const cfNet = (loyersEncaisses / 12) - mensualiteTotale - (chargesExploitationAnnuelles / 12);
    const cfNetNet = cfNet - (impotsAnnee / 12);

    return {
        prixNet,
        fraisNotaire,
        fraisFixes,
        coutTotal,
        montantFinance,
        mensualiteCredit,
        coutAssuranceMensuel,
        mensualiteTotale,
        loyersAnnuelsTheoriques,
        loyersEncaisses,
        chargesExploitationAnnuelles,
        interetsAnnee1,
        impotsAnnee,
        cfNet,
        cfNetNet
    };
}

// ALGORITHME MOTEUR : Calcule le CF Net-Net pour n'importe quelle configuration
export function computeCF(prixVendeur, loyerMensuel, inputs, tmi) {
    const model = buildFinancialModel(prixVendeur, loyerMensuel, inputs, tmi);
    return model.cfNetNet;
}

// --- MÉTRIQUES PROJET (pour comparateur) ---
export function computeProjectMetrics(projectData) {
    const inputs = projectData;
    const tmi = calculateTMI(inputs.revenus || 0, {
        adults: inputs.adults || 2,
        children: inputs.children || 0
    });
    const prixNet = (inputs['prix'] || 0) - (inputs['nego'] || 0);
    const loyer = inputs['loyer'] || 0;
    const model = buildFinancialModel(prixNet, loyer, inputs, tmi);
    const { coutTotal, loyersAnnuelsTheoriques, loyersEncaisses, chargesExploitationAnnuelles, mensualiteTotale, interetsAnnee1, impotsAnnee, cfNet, cfNetNet } = model;
    const rentaBrute = coutTotal > 0 ? (loyersAnnuelsTheoriques / coutTotal) * 100 : 0;
    const rentaNette = coutTotal > 0 ? ((loyersEncaisses - chargesExploitationAnnuelles) / coutTotal) * 100 : 0;
    const rentaNetNet = coutTotal > 0 ? ((loyersEncaisses - chargesExploitationAnnuelles - impotsAnnee) / coutTotal) * 100 : 0;

    const apportVal = inputs['apport'] || 0;
    const coc = apportVal > 0 ? ((cfNetNet * 12) / apportVal) * 100 : Infinity;
    const grm = loyersAnnuelsTheoriques > 0 ? coutTotal / loyersAnnuelsTheoriques : Infinity;
    const dscr = (mensualiteTotale * 12) > 0 ? (loyersEncaisses - chargesExploitationAnnuelles) / (mensualiteTotale * 12) : 0;

    const cfMicro = computeCF(prixNet, loyer, Object.assign({}, inputs, { regime: 'micro-foncier' }), tmi);
    const cfReel  = computeCF(prixNet, loyer, Object.assign({}, inputs, { regime: 'reel' }), tmi);
    const cfSciIs = computeCF(prixNet, loyer, Object.assign({}, inputs, { regime: 'sci-is' }), tmi);
    const maxCf = Math.max(cfMicro, cfReel, cfSciIs);
    const bestRegime = maxCf === cfMicro ? 'Micro-foncier' : (maxCf === cfReel ? 'Foncier réel' : 'SCI à l\'IS');

    let pts = 0;
    if (cfNetNet >= 300) pts += 3; else if (cfNetNet >= 100) pts += 2; else if (cfNetNet >= 0) pts += 1;
    if (rentaNette >= 7) pts += 3; else if (rentaNette >= 5) pts += 2; else if (rentaNette >= 3.5) pts += 1;
    let scoreLabel;
    if (pts >= 5) scoreLabel = 'Élevé'; else if (pts >= 3) scoreLabel = 'Intermédiaire'; else if (pts >= 1) scoreLabel = 'Limite'; else scoreLabel = 'Critique';

    return { prixNet, coutTotal, loyer, rentaBrute, rentaNette, rentaNetNet, cfNet, cfNetNet, coc, grm, dscr, bestRegime, scoreLabel };
}

function getDecisionToneFromThresholds(metrics) {
    if (metrics.cfNetNet < -150 || metrics.dscr < 0.95 || metrics.rentaNetNet < 3.5) {
        return {
            code: 'refuser',
            label: 'Non conforme',
            tone: 'negative',
            rank: 0,
            summary: 'Dans sa configuration actuelle, l exploitation ne couvre pas correctement les charges, la dette et la marge minimale attendue.',
            action: 'Revoir le prix, le loyer cible ou le financement avant de poursuivre.'
        };
    }

    if (metrics.cfNetNet < 0 || metrics.dscr < 1 || metrics.rentaNetNet < 4) {
        return {
            code: 'negocier',
            label: 'À recalibrer',
            tone: 'watch',
            rank: 1,
            summary: 'Le dossier peut devenir acceptable, mais les indicateurs restent sous les seuils cibles.',
            action: 'Réviser les conditions d entrée ou le montage avant arbitrage.'
        };
    }

    if (metrics.cfNetNet < 75 || metrics.dscr < 1.1 || metrics.rentaNetNet < 4.8) {
        return {
            code: 'tenable',
            label: 'Limite',
            tone: 'neutral',
            rank: 2,
            summary: 'Le dossier couvre ses flux, mais avec une marge de sécurité faible.',
            action: 'Confirmer les hypothèses et sécuriser le montage avant décision.'
        };
    }

    if (metrics.cfNetNet < 200 || metrics.dscr < 1.25 || metrics.rentaNetNet < 6) {
        return {
            code: 'solide',
            label: 'Conforme',
            tone: 'positive',
            rank: 3,
            summary: 'Les indicateurs principaux restent cohérents avec une exploitation stabilisée.',
            action: 'Poursuivre l analyse et confirmer les hypothèses de terrain.'
        };
    }

    return {
        code: 'tres-solide',
        label: 'Favorable',
        tone: 'excellent',
        rank: 4,
        summary: 'Les indicateurs dépassent les seuils cibles avec une marge de sécurité observable.',
        action: 'Passer en vérification finale avant offre.'
    };
}

function getCheckpointTone(success, warning) {
    if (success) return 'positive';
    if (warning) return 'watch';
    return 'negative';
}

function buildDecisionModel(metrics, regimeComparison) {
    const currentRegime = regimeComparison.find(item => item.isCurrent) || regimeComparison[0];
    const bestRegime = regimeComparison[0] || currentRegime;
    const regimeGap = Math.max(0, (bestRegime?.cfNetNet || 0) - (currentRegime?.cfNetNet || 0));
    const baseDecision = getDecisionToneFromThresholds(metrics);

    return {
        ...baseDecision,
        regimeGap,
        currentRegimeLabel: currentRegime?.label || REGIME_LABELS.reel,
        bestRegimeLabel: bestRegime?.label || REGIME_LABELS.reel,
        checkpoints: [
            {
                label: 'Autonomie mensuelle',
                kind: 'currency',
                value: metrics.cfNetNet,
                target: '>= 0 € / mois',
                tone: getCheckpointTone(metrics.cfNetNet >= 0, metrics.cfNetNet >= -100)
            },
            {
                label: 'Couverture de dette',
                kind: 'ratio',
                value: metrics.dscr,
                target: '>= 1,10',
                tone: getCheckpointTone(metrics.dscr >= 1.1, metrics.dscr >= 1)
            },
            {
                label: 'Rendement net-net',
                kind: 'percent',
                value: metrics.rentaNetNet,
                target: '>= 4,5 %',
                tone: getCheckpointTone(metrics.rentaNetNet >= 4.5, metrics.rentaNetNet >= 3.5)
            },
            {
                label: 'Régime fiscal',
                kind: 'currency',
                value: regimeGap,
                target: regimeGap > 0 ? `+${Math.round(regimeGap)} € / mois possibles` : 'Régime déjà optimisé',
                tone: getCheckpointTone(regimeGap <= 5, regimeGap <= 25)
            }
        ]
    };
}

function roundToStep(value, step = 500) {
    return Math.max(0, Math.round(value / step) * step);
}

function findDisplayPriceForTargetCf(inputs, tmi, targetCf) {
    const currentDisplayPrice = Math.max(0, Number(inputs['prix']) || 0);
    const currentNegotiation = Math.max(0, Number(inputs['nego']) || 0);
    const currentLoyer = Math.max(0, Number(inputs['loyer']) || 0);
    const lowerBound = currentNegotiation;

    const evaluate = displayPrice => {
        const safeDisplayPrice = Math.max(lowerBound, displayPrice);
        const scenarioInputs = { ...inputs, prix: safeDisplayPrice };
        const prixNet = Math.max(0, safeDisplayPrice - currentNegotiation);
        return computeCF(prixNet, currentLoyer, scenarioInputs, tmi);
    };

    if (evaluate(lowerBound) < targetCf) {
        return roundToStep(lowerBound);
    }

    let upperBound = Math.max(currentDisplayPrice, lowerBound + 1000);
    const ceiling = Math.max(currentDisplayPrice + 500000, lowerBound + 1000);
    while (evaluate(upperBound) >= targetCf && upperBound < ceiling) {
        upperBound += Math.max(5000, Math.round(currentDisplayPrice * 0.08));
    }

    if (evaluate(upperBound) >= targetCf) {
        return roundToStep(upperBound);
    }

    let low = lowerBound;
    let high = upperBound;
    for (let iteration = 0; iteration < 28; iteration++) {
        const mid = (low + high) / 2;
        if (evaluate(mid) >= targetCf) {
            low = mid;
        } else {
            high = mid;
        }
    }

    return roundToStep(low);
}

function normalizeDecisionThresholds(inputs) {
    const minCf = Math.round(Number(inputs['seuil-cf-min']) || 0);
    const minDscr = Math.max(0.5, Number(inputs['seuil-dscr-min']) || 1);
    const maxVacancy = Math.max(0, Number(inputs['seuil-vacance-max']) || 8);
    const maxRentGapRatio = Math.max(0, Number(inputs['seuil-ecart-loyer-max']) || 10) / 100;
    const maxEffortRatio = Math.max(1, Number(inputs['seuil-effort-max']) || 10);
    const blockPassoire = String(inputs['blocage-passoire'] || 'yes') !== 'no';

    return {
        minCf,
        strongCf: minCf + 100,
        minDscr,
        strongDscr: Math.max(1.1, minDscr + 0.1),
        maxVacancy,
        maxRentGapRatio,
        maxEffortRatio,
        blockPassoire
    };
}

function getHypothesisSourceMeta(status) {
    if (status === 'verified') {
        return { score: 1, label: 'Vérifiée', tone: 'positive' };
    }

    if (status === 'estimated') {
        return { score: 0.6, label: 'Estimée', tone: 'watch' };
    }

    return { score: 0.2, label: 'Inconnue', tone: 'negative' };
}

function buildConfidenceModel(inputs) {
    const dimensions = [
        { key: 'source-loyer', label: 'Loyer cible', weight: 0.28, critical: true },
        { key: 'source-charges', label: 'Charges et taxe', weight: 0.22, critical: true },
        { key: 'source-travaux', label: 'Travaux', weight: 0.25, critical: false },
        { key: 'source-documents', label: 'Documents et copro', weight: 0.25, critical: true }
    ];

    const items = dimensions.map(dimension => {
        const meta = getHypothesisSourceMeta(String(inputs[dimension.key] || 'unknown'));
        return {
            key: dimension.key,
            label: dimension.label,
            critical: dimension.critical,
            weight: dimension.weight,
            status: String(inputs[dimension.key] || 'unknown'),
            statusLabel: meta.label,
            tone: meta.tone,
            contribution: meta.score * dimension.weight
        };
    });

    let score = Math.round(items.reduce((sum, item) => sum + (item.contribution * 100), 0));
    if (!(Number(inputs['loyer-marche']) > 0)) score -= 8;
    if (!String(inputs['dpe'] || '').trim()) score -= 5;

    score = Math.max(0, Math.min(100, score));

    const verifiedCount = items.filter(item => item.status === 'verified').length;
    const estimatedCount = items.filter(item => item.status === 'estimated').length;
    const unknownCount = items.filter(item => item.status === 'unknown').length;
    const criticalUnknowns = items.filter(item => item.critical && item.status === 'unknown').length;

    let label = 'Faible';
    let tone = 'negative';
    let summary = 'Les hypothèses critiques restent trop peu documentées pour soutenir une offre ferme.';

    if (score >= 80) {
        label = 'Élevée';
        tone = 'positive';
        summary = 'Les hypothèses critiques sont majoritairement vérifiées et la lecture du dossier reste cohérente.';
    } else if (score >= 60) {
        label = 'Intermédiaire';
        tone = 'watch';
        summary = 'Le dossier est exploitable, mais plusieurs hypothèses reposent encore sur des estimations.';
    }

    return {
        score,
        label,
        tone,
        summary,
        items,
        verifiedCount,
        estimatedCount,
        unknownCount,
        criticalUnknowns,
        weakestItems: items.filter(item => item.status !== 'verified').slice(0, 3)
    };
}

function getEconomicAcquisitionSignal(metrics, currentPrice, maxOfferPrice, solidOfferPrice, thresholds) {
    const negotiationToTenable = Math.max(0, currentPrice - maxOfferPrice);
    const negotiationToSolid = Math.max(0, currentPrice - solidOfferPrice);

    if (currentPrice <= solidOfferPrice + 500 && metrics.cfNetNet >= thresholds.strongCf && metrics.dscr >= thresholds.strongDscr) {
        return {
            code: 'buy-now',
            label: 'Offre recevable',
            matrixLabel: 'Favorable',
            tone: 'excellent',
            summary: 'Le prix se situe déjà sous le seuil favorable avec une marge suffisante pour avancer.',
            action: 'Passer en vérification documentaire avant offre, sous réserve de confirmation terrain.',
            negotiationToTenable,
            negotiationToSolid
        };
    }

    if (currentPrice <= maxOfferPrice + 500 && metrics.cfNetNet >= thresholds.minCf && metrics.dscr >= thresholds.minDscr) {
        return {
            code: 'buy-clean',
            label: 'Offre recevable sous validation',
            matrixLabel: 'Recevable',
            tone: 'positive',
            summary: 'Le prix reste compatible avec les seuils, mais le dossier doit encore être confirmé.',
            action: 'Vérifier le terrain, les travaux et les baux avant formulation d offre.',
            negotiationToTenable,
            negotiationToSolid
        };
    }

    if (negotiationToTenable > 0 || metrics.cfNetNet >= (thresholds.minCf - 150) || metrics.dscr >= Math.max(0.85, thresholds.minDscr - 0.05)) {
        return {
            code: 'conditional',
            label: 'Révision de prix requise',
            matrixLabel: 'Réviser',
            tone: 'watch',
            summary: 'À ce niveau de prix, les indicateurs restent insuffisants. La marge doit être recréée par la négociation.',
            action: `Viser au moins ${Math.round(negotiationToTenable)} € de baisse pour atteindre le seuil minimal, idéalement ${Math.round(negotiationToSolid)} € pour atteindre le seuil favorable.`,
            negotiationToTenable,
            negotiationToSolid
        };
    }

    return {
        code: 'reject',
        label: 'Non recevable',
        matrixLabel: 'Écarter',
        tone: 'negative',
        summary: 'Le bien ne fournit pas un cadre suffisamment défendable pour une offre à ce stade.',
        action: 'Suspendre le dossier, sauf changement majeur de prix, de loyer ou de financement.',
        negotiationToTenable,
        negotiationToSolid
    };
}

function buildAcquisitionChecklist(inputs, thresholds, confidenceModel) {
    const currentPrice = Math.max(0, Number(inputs['prix']) || 0);
    const worksBudget = Math.max(0, Number(inputs['travaux']) || 0);
    const worksRatio = currentPrice > 0 ? worksBudget / currentPrice : 0;
    const vacancy = Math.max(0, Number(inputs['vacance']) || 0);
    const coproMonthly = Math.max(0, Number(inputs['copro']) || 0);
    const propertyTax = Math.max(0, Number(inputs['fonciere']) || 0);
    const targetRent = Math.max(0, Number(inputs['loyer']) || 0);
    const marketRent = Math.max(0, Number(inputs['loyer-marche']) || targetRent || 0);
    const annualRent = targetRent * 12;
    const propertyTaxRatio = annualRent > 0 ? propertyTax / annualRent : 0;
    const rentGapRatio = marketRent > 0 ? (targetRent - marketRent) / marketRent : 0;
    const dpe = String(inputs['dpe'] || 'D').toUpperCase();
    const coproRisk = String(inputs['copro-risque'] || 'stable');
    const dpeBlocked = thresholds.blockPassoire && ['F', 'G'].includes(dpe);

    const items = [
        {
            key: 'dpe',
            label: 'Diagnostic énergie',
            status: dpeBlocked ? 'block' : (['F', 'G', 'E'].includes(dpe) ? 'watch' : 'ready'),
            detail: dpeBlocked
                ? `DPE ${dpe} : risque de passoire thermique et de travaux lourds à absorber.`
                : (['F', 'G', 'E'].includes(dpe)
                    ? `DPE ${dpe} : le dossier reste jouable, mais le plan de travaux doit être précisé.`
                    : `DPE ${dpe} : le risque énergétique reste contenu à ce stade.`),
            isCritical: dpeBlocked
        },
        {
            key: 'works',
            label: 'Travaux',
            status: (worksBudget >= 30000 || worksRatio >= 0.25) ? 'block' : ((worksBudget >= 12000 || worksRatio >= 0.12) ? 'watch' : 'ready'),
            detail: (worksBudget >= 30000 || worksRatio >= 0.25)
                ? `Travaux lourds (${Math.round(worksBudget)} €) : devis et marge doivent être verrouillés avant offre.`
                : ((worksBudget >= 12000 || worksRatio >= 0.12)
                    ? `Travaux significatifs (${Math.round(worksBudget)} €) : vérifier devis, planning et réserve.`
                    : `Travaux limités (${Math.round(worksBudget)} €) : poste encore compatible avec une offre rapide.`),
            isCritical: worksBudget >= 30000 || worksRatio >= 0.25
        },
        {
            key: 'vacancy',
            label: 'Vacance locative',
            status: vacancy > thresholds.maxVacancy ? 'block' : (vacancy > Math.max(0, thresholds.maxVacancy - 2) ? 'watch' : 'ready'),
            detail: vacancy > thresholds.maxVacancy
                ? `Vacance cible à ${vacancy.toFixed(1)} % : l\'hypothèse d\'exploitation est trop tendue.`
                : (vacancy > Math.max(0, thresholds.maxVacancy - 2)
                    ? `Vacance cible à ${vacancy.toFixed(1)} % : vérifier la profondeur de marché et la vitesse de relocation.`
                    : `Vacance cible à ${vacancy.toFixed(1)} % : hypothèse locative défendable.`),
            isCritical: vacancy > thresholds.maxVacancy
        },
        {
            key: 'copro',
            label: 'Copropriété',
            status: (coproRisk === 'high' || coproMonthly >= 120) ? 'block' : ((coproRisk === 'medium' || coproMonthly >= 80) ? 'watch' : 'ready'),
            detail: (coproRisk === 'high' || coproMonthly >= 120)
                ? `Copropriété sous tension (${Math.round(coproMonthly)} € / mois) : PV d AG et travaux à lire avant toute offre.`
                : ((coproRisk === 'medium' || coproMonthly >= 80)
                    ? `Copropriété à surveiller (${Math.round(coproMonthly)} € / mois) : vérifier appels de fonds et sujets d AG.`
                    : `Copropriété stable (${Math.round(coproMonthly)} € / mois) : pas de signal fort à ce stade.`),
            isCritical: coproRisk === 'high' || coproMonthly >= 120
        },
        {
            key: 'tax',
            label: 'Taxe foncière',
            status: propertyTaxRatio > 0.12 ? 'block' : (propertyTaxRatio > 0.09 ? 'watch' : 'ready'),
            detail: propertyTaxRatio > 0.12
                ? `Taxe foncière à ${Math.round(propertyTax)} € / an : elle capte une part trop lourde des loyers.`
                : (propertyTaxRatio > 0.09
                    ? `Taxe foncière à ${Math.round(propertyTax)} € / an : vérifier si le niveau reste soutenable localement.`
                    : `Taxe foncière à ${Math.round(propertyTax)} € / an : charge encore compatible avec le loyer visé.`),
            isCritical: propertyTaxRatio > 0.12
        },
        {
            key: 'market-rent',
            label: 'Loyer de marché',
            status: marketRent <= 0 ? 'block' : (rentGapRatio > thresholds.maxRentGapRatio ? 'block' : (rentGapRatio > Math.max(0, thresholds.maxRentGapRatio - 0.05) ? 'watch' : 'ready')),
            detail: marketRent <= 0
                ? 'Aucun loyer de marché n est renseigné : impossible de valider l\'hypothèse locative.'
                : (rentGapRatio > thresholds.maxRentGapRatio
                ? `Le loyer visé dépasse d environ ${Math.round(rentGapRatio * 100)} % le loyer de marché (${Math.round(marketRent)} €).`
                : (rentGapRatio > Math.max(0, thresholds.maxRentGapRatio - 0.05)
                    ? `Le loyer visé reste au-dessus du marché (${Math.round(marketRent)} €). Justifier cet écart avant offre.`
                    : `Le loyer visé reste aligné avec le marché estimé (${Math.round(marketRent)} €).`)),
            isCritical: marketRent <= 0 || rentGapRatio > thresholds.maxRentGapRatio
        },
        {
            key: 'confidence',
            label: 'Fiabilité des hypothèses',
            status: (confidenceModel.score < 50 || confidenceModel.criticalUnknowns > 0) ? 'block' : (confidenceModel.score < 70 ? 'watch' : 'ready'),
            detail: confidenceModel.score < 50 || confidenceModel.criticalUnknowns > 0
                ? `Fiabilité ${confidenceModel.score}/100 : trop d hypothèses critiques restent inconnues ou estimées.`
                : (confidenceModel.score < 70
                    ? `Fiabilité ${confidenceModel.score}/100 : dossier jouable mais encore trop dépendant d\'estimations.`
                    : `Fiabilité ${confidenceModel.score}/100 : hypothèses majeures suffisamment documentées.`),
            isCritical: confidenceModel.score < 50 || confidenceModel.criticalUnknowns > 0
        }
    ];

    const blockersCount = items.filter(item => item.status === 'block').length;
    const warningCount = items.filter(item => item.status === 'watch').length;
    const criticalBlockers = items.filter(item => item.status === 'block' && item.isCritical).length;

    let readinessLabel = 'Prêt à offrir';
    let readinessTone = 'positive';
    let summary = 'Le dossier ne montre pas de blocage majeur en dehors du prix et du financement.';

    if (blockersCount > 0) {
        readinessLabel = 'Bloqué';
        readinessTone = criticalBlockers > 0 || blockersCount >= 2 ? 'negative' : 'watch';
        summary = 'Des points bloquants doivent être levés avant de passer en offre.';
    } else if (warningCount > 0) {
        readinessLabel = 'Sous réserve';
        readinessTone = 'watch';
        summary = 'Le dossier reste achetable, mais plusieurs contrôles terrain doivent encore être verrouillés.';
    }

    return {
        items,
        blockersCount,
        warningCount,
        criticalBlockers,
        readinessLabel,
        readinessTone,
        summary
    };
}

function buildScenarioModel(inputs, adults, children, thresholds) {
    const baseRent = Math.max(0, Number(inputs['loyer']) || 0);
    const baseRate = Math.max(0, Number(inputs['taux-input']) || 0);
    const baseVacancy = Math.max(0, Number(inputs['vacance']) || 0);
    const baseCopro = Math.max(0, Number(inputs['copro']) || 0);
    const baseTax = Math.max(0, Number(inputs['fonciere']) || 0);
    const baseWorks = Math.max(0, Number(inputs['travaux']) || 0);
    const adultsCount = adults || 2;
    const childrenCount = children || 0;
    const tmi = calculateTMI(inputs.revenus || 0, { adults: adultsCount, children: childrenCount });

    const scenarios = [
        {
            id: 'pessimistic',
            label: 'Pessimiste',
            description: 'Loyer sous pression, vacance plus élevée, charges et taux plus lourds.',
            data: {
                ...inputs,
                loyer: Math.max(0, baseRent - Math.max(50, Math.round(baseRent * 0.08))),
                vacance: Math.min(100, baseVacancy + 3),
                copro: Math.round(baseCopro * 1.15),
                fonciere: Math.round(baseTax * 1.1),
                travaux: baseWorks + 5000,
                'taux-input': baseRate + 0.35
            }
        },
        {
            id: 'base',
            label: 'Référence',
            description: 'Hypothèses actuellement renseignées.',
            data: { ...inputs }
        },
        {
            id: 'optimistic',
            label: 'Optimiste',
            description: 'Loyer un peu meilleur, négociation obtenue et financement plus propre.',
            data: {
                ...inputs,
                loyer: baseRent + Math.max(50, Math.round(baseRent * 0.05)),
                vacance: Math.max(0, baseVacancy - 2),
                copro: Math.max(0, Math.round(baseCopro * 0.95)),
                nego: (inputs['nego'] || 0) + 5000,
                'taux-input': Math.max(0, baseRate - 0.2)
            }
        }
    ].map(scenario => {
        const metrics = computeProjectMetrics({
            ...scenario.data,
            revenus: inputs.revenus,
            adults: adultsCount,
            children: childrenCount
        });
        const maxOfferPrice = findDisplayPriceForTargetCf(scenario.data, tmi, thresholds.minCf);
        const solidOfferPrice = findDisplayPriceForTargetCf(scenario.data, tmi, thresholds.strongCf);
        const signal = getEconomicAcquisitionSignal(metrics, Number(scenario.data['prix']) || 0, maxOfferPrice, solidOfferPrice, thresholds);

        return {
            id: scenario.id,
            label: scenario.label,
            description: scenario.description,
            cfNetNet: metrics.cfNetNet,
            dscr: metrics.dscr,
            decisionLabel: signal.label,
            matrixLabel: signal.matrixLabel,
            tone: signal.tone
        };
    });

    const passingCount = scenarios.filter(scenario => ['excellent', 'positive'].includes(scenario.tone)).length;
    const pessimistic = scenarios.find(scenario => scenario.id === 'pessimistic') || scenarios[0];

    let label = 'Fragile';
    let tone = 'negative';
    let summary = 'Le dossier casse vite si les hypothèses se dégradent.';

    if (pessimistic.tone === 'positive' || pessimistic.tone === 'excellent') {
        label = 'Robuste';
        tone = 'positive';
        summary = 'Le dossier reste défendable même si les hypothèses se durcissent.';
    } else if (passingCount >= 2) {
        label = 'Intermédiaire';
        tone = 'watch';
        summary = 'Le dossier tient encore en référence, mais il doit garder de la marge sur les postes sensibles.';
    }

    return {
        label,
        tone,
        summary,
        passingCount,
        scenarios,
        worstCase: pessimistic
    };
}

function buildAcquisitionDecision(metrics, regimeComparison, inputs, tmi, checklist, thresholds, confidenceModel, scenarioModel) {
    const prixBrut = Math.max(0, Number(inputs['prix']) || 0);
    const loyerSaisi = Math.max(0, Number(inputs['loyer']) || 0);
    if (prixBrut === 0 || loyerSaisi === 0) {
        return {
            label: 'Saisie en cours',
            tone: 'neutral',
            score: null,
            summary: 'Renseignez le prix et le loyer cible pour obtenir une évaluation complète.',
            action: 'Compléter les données essentielles du dossier.',
            priceBand: '—',
            currentPrice: prixBrut,
            maxOfferPrice: 0,
            solidOfferPrice: 0,
            negotiationToTenable: 0,
            negotiationToSolid: 0,
            economicLabel: '—',
            economicTone: 'neutral',
            checklistLabel: '—',
            checklistTone: 'neutral',
            confidenceLabel: '—',
            confidenceTone: 'neutral',
            stressLabel: '—',
            stressTone: 'neutral',
            blockers: [],
            strengths: []
        };
    }
    const currentPrice = prixBrut;
    const currentRegime = regimeComparison.find(item => item.isCurrent) || regimeComparison[0];
    const bestRegime = regimeComparison[0] || currentRegime;
    const regimeGap = Math.max(0, (bestRegime?.cfNetNet || 0) - (currentRegime?.cfNetNet || 0));
    const maxOfferPrice = findDisplayPriceForTargetCf(inputs, tmi, thresholds.minCf);
    const solidOfferPrice = findDisplayPriceForTargetCf(inputs, tmi, thresholds.strongCf);
    const economicSignal = getEconomicAcquisitionSignal(metrics, currentPrice, maxOfferPrice, solidOfferPrice, thresholds);
    const negotiationToTenable = economicSignal.negotiationToTenable;
    const negotiationToSolid = economicSignal.negotiationToSolid;

    // --- Seuils loyer/effort (P2) ---
    const targetRent = Math.max(0, Number(inputs['loyer']) || 0);
    const marketRent = Math.max(0, Number(inputs['loyer-marche']) || targetRent || 0);
    const rentGapRatio = marketRent > 0 ? (targetRent - marketRent) / marketRent : 0;

    const prixNetForEffort = Math.max(0, (Number(inputs['prix']) || 0) - (Number(inputs['nego']) || 0));
    const effortModel = buildFinancialModel(prixNetForEffort, targetRent, inputs, tmi);
    const monthlyIncome = (Number(inputs.revenus) || 0) / 12;
    const effortRatio = monthlyIncome > 0 ? (effortModel.mensualiteTotale / monthlyIncome) * 100 : 0;
    const effortExceeded = monthlyIncome > 0 && effortRatio > thresholds.maxEffortRatio;
    const rentGapExceeded = marketRent > 0 && rentGapRatio > thresholds.maxRentGapRatio;

    const strengths = [];
    const blockers = [];

    if (metrics.cfNetNet >= thresholds.minCf) {
        strengths.push({
            label: 'Cash-flow immédiatement viable',
            detail: `${Math.round(metrics.cfNetNet)} € / mois sans compter une revente.`
        });
    } else {
        blockers.push({
            label: 'Cash-flow encore négatif',
            detail: `${Math.round(Math.abs(metrics.cfNetNet))} € / mois restent à absorber.`
        });
    }

    if (metrics.dscr >= thresholds.strongDscr) {
        strengths.push({
            label: 'Dette correctement couverte',
            detail: `DSCR a ${metrics.dscr.toFixed(2)}.`
        });
    } else {
        blockers.push({
            label: 'Couverture de dette trop courte',
            detail: `DSCR à ${metrics.dscr.toFixed(2)} sous la zone de confort.`
        });
    }

    if (metrics.rentaNetNet >= 4.5) {
        strengths.push({
            label: 'Rendement défendable',
            detail: `Rentabilité nette-nette à ${metrics.rentaNetNet.toFixed(1)} %.`
        });
    } else {
        blockers.push({
            label: 'Rendement trop court',
            detail: `Rentabilité nette-nette à ${metrics.rentaNetNet.toFixed(1)} %.`
        });
    }

    if (negotiationToTenable > 0) {
        blockers.push({
            label: 'Prix au-dessus de la zone d\'offre',
            detail: `Il faut environ ${Math.round(negotiationToTenable)} € de baisse pour revenir à l\'équilibre.`
        });
    } else {
        strengths.push({
            label: 'Prix encore soutenable',
            detail: 'Le prix affiché reste compatible avec un bien qui tient en exploitation.'
        });
    }

    if (regimeGap > 25) {
        blockers.push({
            label: 'Montage fiscal perfectible',
            detail: `${Math.round(regimeGap)} € / mois sont encore disponibles via ${bestRegime.label}.`
        });
    }

    if (rentGapExceeded) {
        blockers.push({
            label: 'Loyer cible au-dessus du marché',
            detail: `Le loyer visé dépasse le marché de ${Math.round(rentGapRatio * 100)} % (seuil ${Math.round(thresholds.maxRentGapRatio * 100)} %).`
        });
    } else if (marketRent > 0 && rentGapRatio <= 0) {
        strengths.push({
            label: 'Loyer cible compatible avec le marché',
            detail: `Loyer visé aligné ou en dessous du marché estimé (${Math.round(marketRent)} €).`
        });
    }

    if (effortExceeded) {
        blockers.push({
            label: 'Effort d\'emprunt élevé',
            detail: `L'effort crédit représente ${Math.round(effortRatio)} % des revenus (seuil ${Math.round(thresholds.maxEffortRatio)} %).`
        });
    }

    if (confidenceModel.score >= 80) {
        strengths.push({
            label: 'Hypothèses crédibles',
            detail: `Fiabilité ${confidenceModel.score}/100 avec hypothèses critiques majoritairement vérifiées.`
        });
    } else if (confidenceModel.score < 60) {
        blockers.push({
            label: 'Hypothèses trop fragiles',
            detail: `Fiabilité ${confidenceModel.score}/100 : il reste trop d\'inconnues pour engager une offre sereine.`
        });
    }

    if (scenarioModel.worstCase.tone === 'positive' || scenarioModel.worstCase.tone === 'excellent') {
        strengths.push({
            label: 'Stress test valide',
            detail: 'Le scénario pessimiste ne casse pas la décision d\'achat.'
        });
    } else {
        blockers.push({
            label: 'Stress test fragile',
            detail: 'Le scénario pessimiste bascule trop vite hors zone d\'achat.'
        });
    }

    let score = 0;
    if (metrics.cfNetNet >= 150) score += 30;
    else if (metrics.cfNetNet >= 50) score += 24;
    else if (metrics.cfNetNet >= 0) score += 18;
    else if (metrics.cfNetNet >= -100) score += 8;

    if (metrics.dscr >= 1.2) score += 25;
    else if (metrics.dscr >= 1.1) score += 18;
    else if (metrics.dscr >= 1) score += 10;

    if (metrics.rentaNetNet >= 5.5) score += 18;
    else if (metrics.rentaNetNet >= 4.5) score += 12;
    else if (metrics.rentaNetNet >= 3.5) score += 6;

    if (currentPrice <= solidOfferPrice + 500) score += 17;
    else if (currentPrice <= maxOfferPrice + 500) score += 10;

    if (regimeGap <= 5) score += 10;
    else if (regimeGap <= 25) score += 5;

    score -= (checklist.blockersCount * 14) + (checklist.warningCount * 4);
    score += Math.round((confidenceModel.score - 60) * 0.2);
    if (scenarioModel.worstCase.tone === 'positive' || scenarioModel.worstCase.tone === 'excellent') score += 6;
    if (scenarioModel.worstCase.tone === 'negative') score -= 10;
    if (rentGapExceeded) score -= 12;
    if (effortExceeded) score -= 10;
    score = Math.max(0, Math.min(100, Math.round(score)));

    let label = economicSignal.label;
    let tone = economicSignal.tone;
    let summary = economicSignal.summary;
    let action = economicSignal.action;

    if (economicSignal.tone !== 'negative' && checklist.blockersCount > 0) {
        label = checklist.criticalBlockers > 0 || checklist.blockersCount >= 2 ? 'Offre non recevable' : 'Validation bloquée';
        tone = checklist.criticalBlockers > 0 || checklist.blockersCount >= 2 ? 'negative' : 'watch';
        summary = 'Les indicateurs économiques peuvent être recevables, mais le dossier reste incomplet sur des points terrain ou documentaires.';
        action = 'Lever les points bloquants de la checklist avant toute offre.';
    } else if (economicSignal.tone === 'excellent' && checklist.warningCount > 0) {
        label = 'Favorable sous validation';
        tone = 'positive';
        summary = 'Le prix est cohérent, mais certains contrôles doivent encore être confirmés avant engagement.';
        action = 'Clore les réserves de la checklist avant offre.';
    } else if (economicSignal.tone === 'positive' && checklist.warningCount >= 2) {
        label = 'Décision sous réserve';
        tone = 'watch';
        summary = 'Le dossier reste potentiellement recevable, mais les réserves doivent être levées avant engagement.';
        action = 'Traiter les points de vigilance avant décision.';
    }

    if (tone !== 'negative' && confidenceModel.score < 55) {
        label = 'Attendre les confirmations';
        tone = 'watch';
        summary = 'L\'économie existe peut-être, mais la qualité des hypothèses reste trop faible pour avancer proprement.';
        action = 'Faire confirmer les hypothèses critiques avant d émettre une offre.';
    }

    if ((tone === 'excellent' || tone === 'positive') && scenarioModel.worstCase.tone === 'negative') {
        label = 'Acheter avec marge';
        tone = 'watch';
        summary = 'Le dossier est achetable en référence, mais le scénario pessimiste casse trop vite la thèse d\'achat.';
        action = 'N avancer que si la marge de négociation ou de loyer se matérialise réellement.';
    }

    const priceBand = currentPrice <= solidOfferPrice + 500
        ? 'Zone solide'
        : (currentPrice <= maxOfferPrice + 500 ? 'Zone tenable' : 'Au-dessus de l offre plafond');

    return {
        label,
        tone,
        score,
        summary,
        action,
        priceBand,
        currentPrice,
        maxOfferPrice,
        solidOfferPrice,
        negotiationToTenable,
        negotiationToSolid,
        economicLabel: economicSignal.label,
        economicTone: economicSignal.tone,
        checklistLabel: checklist.readinessLabel,
        checklistTone: checklist.readinessTone,
        confidenceLabel: confidenceModel.label,
        confidenceTone: confidenceModel.tone,
        stressLabel: scenarioModel.label,
        stressTone: scenarioModel.tone,
        blockers: blockers.slice(0, 4),
        strengths: strengths.slice(0, 3)
    };
}

function buildDecisionJournal(inputs, acquisitionDecision, confidenceModel, scenarioModel) {
    const thesis = String(inputs['decision-thesis'] || '').trim();
    const nextStep = String(inputs['decision-next-step'] || '').trim();
    const thesisFilled = thesis.length >= 20;
    const nextStepFilled = nextStep.length >= 10;
    const completenessScore = (thesisFilled ? 55 : thesis ? 30 : 0) + (nextStepFilled ? 45 : nextStep ? 20 : 0);

    let label = 'À compléter';
    let tone = 'watch';
    let summary = 'Renseigner la thèse et la prochaine étape force une décision plus nette et comparable entre dossiers.';

    if (completenessScore >= 90) {
        label = 'Renseigné';
        tone = 'positive';
        summary = 'La logique de décision et la prochaine étape sont déjà consignées pour ce dossier.';
    } else if (completenessScore === 0) {
        label = 'Vide';
        tone = 'negative';
        summary = 'Aucune trace écrite de la décision : le dossier reste difficile à arbitrer dans le temps.';
    }

    return {
        thesis,
        nextStep,
        completenessScore,
        label,
        tone,
        summary,
        suggestedThesis: `Décision ${acquisitionDecision.label}, fiabilité ${confidenceModel.label.toLowerCase()}, robustesse ${scenarioModel.label.toLowerCase()}.`,
        suggestedNextStep: acquisitionDecision.action
    };
}

function buildActionLevers(sensitivity, regimeComparison) {
    const currentRegime = regimeComparison.find(item => item.isCurrent) || regimeComparison[0];
    const bestRegime = regimeComparison[0] || currentRegime;
    const levers = [];

    if (bestRegime && currentRegime && bestRegime.id !== currentRegime.id && bestRegime.cfNetNet > currentRegime.cfNetNet + 1) {
        levers.push({
            label: `Basculer en ${bestRegime.label}`,
            category: 'Fiscalité',
            delta: bestRegime.cfNetNet - currentRegime.cfNetNet,
            nextCf: bestRegime.cfNetNet
        });
    }

    return [
        ...levers,
        ...sensitivity
            .filter(item => item.label !== 'Référence actuelle')
            .sort((left, right) => right.delta - left.delta)
            .map(item => ({
                label: item.label,
                category: 'Opérationnel',
                delta: item.delta,
                nextCf: item.cfNetNet
            }))
    ].slice(0, 4);
}

function buildTenYearProjection(model, inputs, tmi) {
    const horizonYears = 10;
    const tauxMensuel = (inputs['taux-input'] / 100) / 12;
    const totalMonths = Math.max(0, Math.round((inputs['duree'] || 0) * 12));
    let remainingCapital = model.montantFinance;
    let cumulativeCashflow = 0;
    let cumulativePrincipal = 0;
    const years = [];

    for (let year = 1; year <= horizonYears; year++) {
        let interestYear = 0;
        let principalYear = 0;
        let insuranceYear = 0;
        let debtServiceYear = 0;

        for (let month = 0; month < 12; month++) {
            const monthIndex = ((year - 1) * 12) + month;
            if (monthIndex >= totalMonths || remainingCapital <= 0) {
                break;
            }

            const interestMonth = tauxMensuel > 0 ? remainingCapital * tauxMensuel : 0;
            let principalMonth = tauxMensuel > 0 ? (model.mensualiteCredit - interestMonth) : model.mensualiteCredit;
            principalMonth = Math.max(0, Math.min(remainingCapital, principalMonth));

            interestYear += interestMonth;
            principalYear += principalMonth;
            insuranceYear += model.coutAssuranceMensuel;
            debtServiceYear += model.mensualiteCredit + model.coutAssuranceMensuel;
            remainingCapital = Math.max(0, remainingCapital - principalMonth);
        }

        const taxesYear = computeAnnualTaxEstimate(
            model.prixNet,
            model.loyersEncaisses,
            model.chargesExploitationAnnuelles,
            inputs,
            tmi,
            interestYear,
            insuranceYear,
            year
        );
        const annualCashflow = model.loyersEncaisses - model.chargesExploitationAnnuelles - debtServiceYear - taxesYear;

        cumulativeCashflow += annualCashflow;
        cumulativePrincipal += principalYear;
        const traction = cumulativeCashflow + cumulativePrincipal;

        years.push({
            year,
            annualCashflow,
            cumulativeCashflow,
            principalRepaid: principalYear,
            cumulativePrincipal,
            traction,
            wealthCreated: traction,
            remainingCapital
        });
    }

    const finalYear = years[years.length - 1] || {
        cumulativeCashflow: 0,
        cumulativePrincipal: 0,
        traction: 0,
        wealthCreated: 0
    };

    return {
        horizonYears,
        years,
        endingCashflow: finalYear.cumulativeCashflow,
        endingPrincipal: finalYear.cumulativePrincipal,
        endingTraction: finalYear.traction,
        endingWealth: finalYear.wealthCreated
    };
}

const _matrixCache = { key: null, data: null };

function buildPriceRentMatrix(prixNet, loyer, inputs, adults, children, thresholds) {
    const cacheKey = `${prixNet}|${loyer}|${adults}|${children}|${inputs['revenus']}|${inputs['taux']}|${inputs['duree']}|${inputs['regime']}|${inputs['nego']}|${inputs['apport']}|${inputs['taxe-fonciere']}|${inputs['charges-copro']}|${inputs['assurance-pno']}|${inputs['vacance']}|${inputs['frais-bancaires']}|${thresholds.minCf}|${thresholds.minDscr}`;
    if (_matrixCache.key === cacheKey) return _matrixCache.data;

    const priceOffsets = [-10000, -5000, 0, 5000, 10000];
    const rentOffsets = [-100, -50, 0, 50, 100];
    const tmi = calculateTMI(inputs.revenus || 0, { adults, children });

    const result = {
        columnRents: rentOffsets.map(delta => ({
            delta,
            value: Math.max(0, loyer + delta),
            isBase: delta === 0
        })),
        rows: priceOffsets.map(delta => {
            const displayPrice = Math.max(inputs['nego'] || 0, (inputs['prix'] || 0) + delta);
            return {
                delta,
                value: displayPrice,
                isBase: delta === 0,
                cells: rentOffsets.map(rentDelta => {
                    const scenario = {
                        ...inputs,
                        prix: displayPrice,
                        loyer: Math.max(0, loyer + rentDelta),
                        revenus: inputs.revenus,
                        adults,
                        children
                    };
                    const scenarioMetrics = computeProjectMetrics(scenario);
                    const scenarioMaxOfferPrice = findDisplayPriceForTargetCf(scenario, tmi, thresholds.minCf);
                    const scenarioSolidOfferPrice = findDisplayPriceForTargetCf(scenario, tmi, thresholds.strongCf);
                    const scenarioDecision = getEconomicAcquisitionSignal(scenarioMetrics, scenario.prix, scenarioMaxOfferPrice, scenarioSolidOfferPrice, thresholds);
                    return {
                        rent: scenario.loyer,
                        cfNetNet: scenarioMetrics.cfNetNet,
                        decisionLabel: scenarioDecision.matrixLabel,
                        decisionTone: scenarioDecision.tone,
                        isBase: delta === 0 && rentDelta === 0
                    };
                })
            };
        })
    };

    _matrixCache.key = cacheKey;
    _matrixCache.data = result;
    return result;
}

function buildLoanCashflowTable(model, inputs, tmi) {
    const duree = Math.max(1, Math.round(inputs['duree'] || 0));
    const tauxMensuel = (inputs['taux-input'] / 100) / 12;
    const totalMonths = model.montantFinance > 0 ? duree * 12 : 0;
    let remainingCapital = model.montantFinance;
    const rows = [];

    for (let year = 1; year <= duree; year++) {
        let interestYear = 0;
        let insuranceYear = 0;
        let debtServiceYear = 0;

        for (let month = 0; month < 12; month++) {
            const monthIndex = ((year - 1) * 12) + month;
            if (monthIndex >= totalMonths || remainingCapital <= 0) break;

            const interestMonth = tauxMensuel > 0 ? remainingCapital * tauxMensuel : 0;
            let principalMonth = tauxMensuel > 0 ? (model.mensualiteCredit - interestMonth) : model.mensualiteCredit;
            principalMonth = Math.max(0, Math.min(remainingCapital, principalMonth));

            interestYear += interestMonth;
            insuranceYear += model.coutAssuranceMensuel;
            debtServiceYear += model.mensualiteCredit + model.coutAssuranceMensuel;
            remainingCapital = Math.max(0, remainingCapital - principalMonth);
        }

        const taxesYear = computeAnnualTaxEstimate(
            model.prixNet,
            model.loyersEncaisses,
            model.chargesExploitationAnnuelles,
            inputs,
            tmi,
            interestYear,
            insuranceYear,
            year
        );

        const cfAvantImpot = (model.loyersEncaisses - model.chargesExploitationAnnuelles - debtServiceYear) / 12;
        const cfApresImpot = cfAvantImpot - (taxesYear / 12);

        rows.push({ year, cfAvantImpot, cfApresImpot });
    }

    return rows;
}

export function computeAnalysisViewModel(projectData) {
    const inputs = projectData;
    const adults = inputs.adults || 2;
    const children = inputs.children || 0;
    const tmi = calculateTMI(inputs.revenus || 0, { adults, children });
    const parts = getHouseholdTaxParts(adults, children);
    const decisionThresholds = normalizeDecisionThresholds(inputs);
    const prixNet = (inputs['prix'] || 0) - (inputs['nego'] || 0);
    const loyer = inputs['loyer'] || 0;
    const metrics = computeProjectMetrics(projectData);
    const model = buildFinancialModel(prixNet, loyer, inputs, tmi);

    const regimeComparison = ['micro-foncier', 'reel', 'sci-is']
        .map(regime => ({
            id: regime,
            label: REGIME_LABELS[regime],
            cfNetNet: computeCF(prixNet, loyer, { ...inputs, regime }, tmi),
            isCurrent: inputs['regime'] === regime
        }))
        .sort((left, right) => right.cfNetNet - left.cfNetNet);

    const sensitivity = [
        { label: 'Référence actuelle', data: { ...inputs } },
        { label: 'Loyer + 50 €', data: { ...inputs, loyer: loyer + 50 } },
        { label: 'Négociation + 5 000 €', data: { ...inputs, nego: (inputs['nego'] || 0) + 5000 } },
        { label: 'Apport + 10 000 €', data: { ...inputs, apport: (inputs['apport'] || 0) + 10000 } },
        { label: 'Vacance - 2 pts', data: { ...inputs, vacance: Math.max(0, (inputs['vacance'] || 0) - 2) } }
    ].map(scenario => {
        const scenarioMetrics = computeProjectMetrics({
            ...scenario.data,
            revenus: inputs.revenus,
            adults,
            children
        });
        return {
            label: scenario.label,
            cfNetNet: scenarioMetrics.cfNetNet,
            delta: scenarioMetrics.cfNetNet - metrics.cfNetNet,
            scoreLabel: scenarioMetrics.scoreLabel
        };
    });

    const decision = buildDecisionModel(metrics, regimeComparison);
    const actionLevers = buildActionLevers(sensitivity, regimeComparison);
    const confidenceModel = buildConfidenceModel(inputs);
    const acquisitionChecklist = buildAcquisitionChecklist(inputs, decisionThresholds, confidenceModel);
    const scenarioModel = buildScenarioModel(inputs, adults, children, decisionThresholds);
    const acquisitionDecision = buildAcquisitionDecision(metrics, regimeComparison, inputs, tmi, acquisitionChecklist, decisionThresholds, confidenceModel, scenarioModel);
    const decisionJournal = buildDecisionJournal(inputs, acquisitionDecision, confidenceModel, scenarioModel);

    return {
        tmi,
        parts,
        metrics,
        decision,
        confidenceModel,
        scenarioModel,
        decisionThresholds,
        decisionJournal,
        acquisitionDecision,
        acquisitionChecklist,
        actionLevers,
        monthlyBreakdown: [
            { label: 'Loyers encaissés', value: model.loyersEncaisses / 12, kind: 'income', signedValue: model.loyersEncaisses / 12 },
            { label: 'Crédit + assurance', value: model.mensualiteTotale, kind: 'expense', signedValue: -model.mensualiteTotale },
            { label: 'Charges d\'exploitation', value: model.chargesExploitationAnnuelles / 12, kind: 'expense', signedValue: -(model.chargesExploitationAnnuelles / 12) },
            { label: 'Impôts', value: Math.abs(model.impotsAnnee / 12), kind: model.impotsAnnee >= 0 ? 'expense' : 'positive', signedValue: -(model.impotsAnnee / 12) },
            { label: 'Cash-flow net-net', value: Math.abs(model.cfNetNet), kind: model.cfNetNet >= 0 ? 'positive' : 'negative', signedValue: model.cfNetNet }
        ],
        costBreakdown: [
            { label: 'Prix net vendeur', value: model.prixNet, kind: 'neutral' },
            { label: 'Notaire', value: model.fraisNotaire, kind: 'neutral' },
            { label: 'Travaux', value: inputs['travaux'] || 0, kind: 'neutral' },
            { label: 'Mobilier', value: inputs['meubles'] || 0, kind: 'neutral' },
            { label: 'Agence', value: inputs['agence'] || 0, kind: 'neutral' },
            { label: 'Frais bancaires', value: inputs['frais-bancaires'] || 0, kind: 'neutral' }
        ],
        regimeComparison,
        sensitivity,
        projection: buildTenYearProjection(model, inputs, tmi),
        priceRentMatrix: buildPriceRentMatrix(prixNet, loyer, inputs, adults, children, decisionThresholds),
        cashflowTable: buildLoanCashflowTable(model, inputs, tmi),
        annual: {
            loyersEncaisses: model.loyersEncaisses,
            charges: model.chargesExploitationAnnuelles,
            impots: model.impotsAnnee
        },
        monthly: {
            credit: model.mensualiteCredit,
            assurance: model.coutAssuranceMensuel,
            mensualiteTotale: model.mensualiteTotale,
            cashflow: model.cfNetNet
        }
    };
}

function buildAnnualTaxSnapshot(prixNet, loyersEncaisses, chargesExploitationAnnuelles, inputs, interestYear, insuranceYear, year = 1) {
    const oneOffCharges = year === 1 ? (inputs['travaux'] || 0) + (inputs['frais-bancaires'] || 0) : 0;

    if (inputs['regime'] === 'micro-foncier') {
        return {
            regime: 'micro-foncier',
            taxableBase: loyersEncaisses * 0.7,
            deficitHorsInterets: 0
        };
    }

    if (inputs['regime'] === 'reel') {
        const chargesAnnuelles = chargesExploitationAnnuelles + insuranceYear + oneOffCharges;
        const taxableBase = loyersEncaisses - chargesAnnuelles - interestYear;
        const soldeHorsInterets = loyersEncaisses - chargesAnnuelles;
        return {
            regime: 'reel',
            taxableBase,
            deficitHorsInterets: Math.min(0, soldeHorsInterets)
        };
    }

    const amortissement = prixNet * 0.80 / 30;
    const chargesDeductibles = chargesExploitationAnnuelles + insuranceYear + interestYear + oneOffCharges;
    return {
        regime: 'sci-is',
        taxableBase: loyersEncaisses - chargesDeductibles - amortissement,
        deficitHorsInterets: 0
    };
}

function computeConsolidatedTaxEstimate(taxSnapshots, tmi) {
    const tauxGlobalImpot = (tmi / 100) + CSG_CRDS_RATE;
    let microBase = 0;
    let reelNetTaxable = 0;
    let reelDeficitHorsInterets = 0;
    let sciBenefit = 0;

    taxSnapshots.forEach(snapshot => {
        if (snapshot.regime === 'micro-foncier') {
            microBase += snapshot.taxableBase;
        } else if (snapshot.regime === 'reel') {
            reelNetTaxable += snapshot.taxableBase;
            reelDeficitHorsInterets += snapshot.deficitHorsInterets;
        } else if (snapshot.regime === 'sci-is') {
            sciBenefit += snapshot.taxableBase;
        }
    });

    let annualTax = 0;
    if (microBase > 0) {
        annualTax += microBase * tauxGlobalImpot;
    }

    if (reelNetTaxable > 0) {
        annualTax += reelNetTaxable * tauxGlobalImpot;
    } else if (reelDeficitHorsInterets < 0) {
        annualTax -= Math.min(10700, Math.abs(reelDeficitHorsInterets)) * (tmi / 100);
    }

    if (sciBenefit > 0) {
        annualTax += Math.min(sciBenefit, 42500) * 0.15 + Math.max(0, sciBenefit - 42500) * 0.25;
    }

    return {
        annualTax,
        microBase,
        reelNetTaxable,
        reelDeficitHorsInterets,
        sciBenefit
    };
}


function buildPortfolioPriorities(portfolioItems) {
    return portfolioItems
        .map(item => {
            const topLever = item.analysisModel.actionLevers[0] || null;
            const severity = (item.metrics.cfNetNet < 0 ? 300 + Math.abs(item.metrics.cfNetNet) : 0)
                + (item.metrics.dscr < 1 ? 120 : 0)
                + Math.max(0, topLever?.delta || 0);

            return {
                id: item.id,
                name: item.name,
                tone: item.metrics.cfNetNet < 0 ? 'negative' : (item.metrics.dscr < 1 ? 'watch' : 'positive'),
                decisionLabel: item.analysisModel.decision?.label || '—',
                cfNetNet: item.metrics.cfNetNet,
                dscr: item.metrics.dscr,
                leverLabel: topLever?.label || 'Aucun levier prioritaire',
                leverDelta: topLever?.delta || 0,
                priorityScore: severity
            };
        })
        .sort((left, right) => right.priorityScore - left.priorityScore)
        .slice(0, 5);
}

export function capitalRestantDu(mensualite, dateFinStr, refDate = null) {
    if (!dateFinStr) return null;
    const parts = dateFinStr.split('-').map(Number);
    const finYear = parts[0];
    const finMonth = parts[1];
    if (!finYear || !finMonth) return null;
    const now = refDate || new Date();
    const monthsRemaining = Math.max(0,
        (finYear - now.getFullYear()) * 12 + (finMonth - 1 - now.getMonth())
    );
    return Math.round(mensualite * monthsRemaining);
}

function computeDebtRatios(mensualitesImmo, autresMensualites, totalRentMonthly, income) {
    const mensualitesTotales = mensualitesImmo + autresMensualites;
    const revenuMensuel = Math.max(1, income / 12);

    const hcsfDenum = revenuMensuel + 0.7 * totalRentMonthly;
    const hcsfRatio = hcsfDenum > 0 ? (mensualitesTotales / hcsfDenum) * 100 : 0;
    const hcsfTone = hcsfRatio <= 28 ? 'positive' : hcsfRatio <= 35 ? 'watch' : 'negative';

    const effortNet = Math.max(0, mensualitesTotales - totalRentMonthly);
    const diffRatio = (effortNet / revenuMensuel) * 100;
    const diffTone = diffRatio <= 20 ? 'positive' : diffRatio <= 33 ? 'watch' : 'negative';

    return {
        mensualitesImmo,
        autresMensualites,
        mensualitesTotales,
        hcsf: { ratio: hcsfRatio, seuil: 35, tone: hcsfTone },
        differentielle: { ratio: diffRatio, seuil: 33, tone: diffTone }
    };
}

function computePortfolioFiscal(portfolioItems, tmi) {
    const tauxGlobal = (tmi / 100) + CSG_CRDS_RATE;
    const regimes = {
        'micro-foncier': { label: 'Micro-foncier', count: 0, loyersAnnuels: 0, impots: 0 },
        'reel': { label: 'Foncier Réel', count: 0, loyersAnnuels: 0, impots: 0 },
        'sci-is': { label: 'SCI à l\'IS', count: 0, loyersAnnuels: 0, impots: 0 }
    };
    let totalImpots = 0;

    portfolioItems.forEach(item => {
        const snap = item.taxSnapshot;
        const regime = snap.regime || 'micro-foncier';
        const r = regimes[regime] || regimes['micro-foncier'];
        r.count++;
        r.loyersAnnuels += item.model.loyersEncaisses;

        let itemTax = 0;
        if (snap.regime === 'micro-foncier') {
            itemTax = Math.max(0, snap.taxableBase * tauxGlobal);
        } else if (snap.regime === 'reel') {
            if (snap.taxableBase > 0) {
                itemTax = snap.taxableBase * tauxGlobal;
            } else if (snap.deficitHorsInterets < 0) {
                itemTax = -(Math.min(10700, Math.abs(snap.deficitHorsInterets)) * (tmi / 100));
            }
        } else {
            itemTax = snap.taxableBase > 0
                ? Math.min(snap.taxableBase, 42500) * 0.15 + Math.max(0, snap.taxableBase - 42500) * 0.25
                : 0;
        }
        r.impots += itemTax;
        totalImpots += itemTax;
    });

    return { totalImpots, tmi, regimes };
}

function amortizationFactor(tauxAnnuel, dureeAns) {
    const r = (tauxAnnuel / 100) / 12;
    const n = dureeAns * 12;
    if (r <= 0) return n;
    return (1 - Math.pow(1 + r, -n)) / r;
}

function computeProjectionPatrimoniale(portfolioItems, revaloAnnuelle) {
    const r = Math.max(0, (revaloAnnuelle || 2)) / 100;
    const currentValue = portfolioItems.reduce((sum, item) => {
        const prix = Math.max(0, (item.variablesData?.['prix'] || 0) - (item.variablesData?.['nego'] || 0));
        return sum + prix;
    }, 0);

    const currentYear = new Date().getFullYear();
    const seriesGross = [];
    const seriesNet = [];

    for (let t = 0; t <= 15; t++) {
        let grossTotal = 0;
        let crdTotal = 0;

        portfolioItems.forEach(item => {
            const prix = Math.max(0, (item.variablesData?.['prix'] || 0) - (item.variablesData?.['nego'] || 0));
            grossTotal += prix * Math.pow(1 + r, t);

            const cs = item.creditSchedule;
            if (cs && cs.mensualite && cs.dateFin) {
                const refDate = new Date(currentYear + t, 0, 1);
                const crd = capitalRestantDu(cs.mensualite, cs.dateFin, refDate);
                crdTotal += crd || 0;
            }
        });

        seriesGross.push(Math.round(grossTotal));
        seriesNet.push(Math.round(grossTotal - crdTotal));
    }

    return {
        currentValue,
        at5: Math.round(currentValue * Math.pow(1 + r, 5)),
        at10: Math.round(currentValue * Math.pow(1 + r, 10)),
        at15: Math.round(currentValue * Math.pow(1 + r, 15)),
        revaloAnnuelle: revaloAnnuelle || 2,
        seriesGross,
        seriesNet
    };
}

function computeProgressionObjectif(dashboard, objectifCF) {
    const current = dashboard.totalCashflow;
    const target = Math.max(1, objectifCF || 1000);
    const pct = Math.min(100, Math.max(0, (current / target) * 100));
    const delta = target - current;
    const avgCF = dashboard.assetCount > 0 ? current / dashboard.assetCount : 0;
    const estimatedAssetsNeeded = delta > 0 && avgCF > 50 ? Math.ceil(delta / avgCF) : null;
    const tone = pct >= 100 ? 'excellent' : pct >= 75 ? 'positive' : pct >= 40 ? 'watch' : 'neutral';
    return { current, target, pct, delta, estimatedAssetsNeeded, tone };
}

function buildPortfolioDashboard(portfolioItems, tmi, income) {
    if (!portfolioItems.length) {
        return {
            assetCount: 0,
            ownedCount: 0,
            totalCashflow: 0,
            totalEffort: 0,
            totalRentMonthly: 0,
            totalDebtMonthly: 0,
            consolidatedTaxAnnual: 0,
            totalTraction: 0,
            totalValue: 0,
            dscr: 0,
            effortRatio: 0,
            income
        };
    }

    const totalRentAnnual = portfolioItems.reduce((sum, item) => sum + item.model.loyersEncaisses, 0);
    const totalChargesAnnual = portfolioItems.reduce((sum, item) => sum + item.model.chargesExploitationAnnuelles, 0);
    const totalDebtAnnual = portfolioItems.reduce((sum, item) => sum + (item.model.mensualiteTotale * 12), 0);
    const totalNoiAnnual = totalRentAnnual - totalChargesAnnual;
    const taxSummary = computeConsolidatedTaxEstimate(portfolioItems.map(item => item.taxSnapshot), tmi);
    const afterTaxAnnual = totalNoiAnnual - totalDebtAnnual - taxSummary.annualTax;
    const totalCashflow = afterTaxAnnual / 12;
    const totalEffort = Math.max(0, -totalCashflow);
    const totalRentMonthly = totalRentAnnual / 12;
    const totalDebtMonthly = totalDebtAnnual / 12;
    const monthlyIncome = Math.max(1, (income || 0) / 12);

    return {
        assetCount: portfolioItems.length,
        ownedCount: portfolioItems.filter(item => item.status === 'owned').length,
        totalCashflow,
        totalEffort,
        totalRentMonthly,
        totalDebtMonthly,
        consolidatedTaxAnnual: taxSummary.annualTax,
        totalTraction: portfolioItems.reduce((sum, item) => sum + item.analysisModel.projection.endingTraction, 0),
        totalValue: portfolioItems.reduce((sum, item) => sum + item.metrics.coutTotal, 0),
        dscr: totalDebtAnnual > 0 ? totalNoiAnnual / totalDebtAnnual : 0,
        effortRatio: totalEffort > 0 ? (totalEffort / monthlyIncome) * 100 : 0,
        income
    };
}


export function computePortfolioViewModel(assetRecords = [], householdProfile = {}, activeAssetId = null, referenceInputs = {}) {
    const income = householdProfile.income || 0;
    const adults = householdProfile.adults || 2;
    const children = householdProfile.children || 0;
    const tmi = calculateTMI(income, { adults, children });

    const assetViews = assetRecords.map(asset => {
        const inputs = {
            ...asset.variablesData,
            revenus: income,
            adults,
            children
        };
        const prixNet = (inputs['prix'] || 0) - (inputs['nego'] || 0);
        const loyer = inputs['loyer'] || 0;
        const model = buildFinancialModel(prixNet, loyer, inputs, tmi);
        const analysisModel = computeAnalysisViewModel(inputs);
        const taxSnapshot = buildAnnualTaxSnapshot(
            prixNet,
            model.loyersEncaisses,
            model.chargesExploitationAnnuelles,
            inputs,
            model.interetsAnnee1,
            model.coutAssuranceMensuel * 12,
            1
        );

        return {
            id: asset.id,
            isActive: asset.id === activeAssetId,
            name: asset.variablesData['nom-bien'] || 'Bien',
            city: asset.variablesData['ville'] || 'Ville non renseignée',
            status: asset.variablesData['statut-bien'] || 'candidate',
            statusLabel: (asset.variablesData['statut-bien'] || 'candidate') === 'owned' ? 'Déjà au portefeuille' : 'À étudier',
            typeBien: asset.variablesData['type-bien'] || 'appartement',
            analysisModel,
            metrics: analysisModel.metrics,
            model,
            taxSnapshot,
            inComparison: Boolean(asset.inComparison),
            inPortfolio: Boolean(asset.inPortfolio),
            creditSchedule: asset.creditSchedule || null,
            dateRevente: asset.dateRevente || '',
            variablesData: asset.variablesData,
        };
    });

    const comparisonItems = assetViews
        .filter(item => item.inComparison)
        .sort((left, right) => {
            const rRank = right.analysisModel.decision?.rank ?? 0;
            const lRank = left.analysisModel.decision?.rank ?? 0;
            if (rRank !== lRank) return rRank - lRank;
            return right.metrics.cfNetNet - left.metrics.cfNetNet;
        });

    const portfolioItems = assetViews
        .filter(item => item.inPortfolio)
        .sort((left, right) => {
            if (left.status !== right.status) {
                return left.status.localeCompare(right.status, 'fr');
            }
            return right.metrics.cfNetNet - left.metrics.cfNetNet;
        });

    const dashboard = buildPortfolioDashboard(portfolioItems, tmi, income);
    const priorities = buildPortfolioPriorities(portfolioItems);

    const mensualitesTotales = portfolioItems.reduce((sum, item) => {
        const m = item.creditSchedule ? item.creditSchedule.mensualite : (item.model.mensualiteTotale || 0);
        return sum + m;
    }, 0);

    // Portfolio-level decision: aggregate health assessment
    const totalValue = dashboard.totalValue || 1;
    const portfolioRentaNetNet = portfolioItems.length > 0
        ? portfolioItems.reduce((s, item) => s + item.metrics.rentaNetNet * (item.metrics.coutTotal || 0), 0) / totalValue
        : 0;
    const decision = getDecisionToneFromThresholds({
        cfNetNet: dashboard.totalCashflow,
        dscr: dashboard.dscr,
        rentaNetNet: portfolioRentaNetNet
    });

    const autresMensualites = (householdProfile.autresCredits || []).reduce((sum, c) => sum + (c.mensualite || 0), 0);

    // Remaining acquisition capacity (35% debt ratio rule, amortization factor from reference loan params)
    const maxMonthlyDebt = income > 0 ? (income / 12) * 0.35 : 0;
    const remainingMonthlyCapacity = Math.max(0, maxMonthlyDebt - dashboard.totalDebtMonthly - autresMensualites);
    const refTaux = referenceInputs['taux'] || 3.5;
    const refDuree = referenceInputs['duree'] || 20;
    const factor = amortizationFactor(refTaux, refDuree);
    const capacity = { acquisitionBudget: Math.round(remainingMonthlyCapacity * factor) };

    return {
        comparisonItems,
        portfolioItems,
        dashboard,
        decision,
        capacity,
        priorities,
        fiscal: computePortfolioFiscal(portfolioItems, tmi),
        debtRatios: computeDebtRatios(mensualitesTotales, autresMensualites, dashboard.totalRentMonthly, income),
        projection: computeProjectionPatrimoniale(portfolioItems, householdProfile.revaloAnnuelle || 2),
        objectif: computeProgressionObjectif(dashboard, householdProfile.objectifCF || 1000)
    };
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function getResaleAbatementsYears(year) {
    const y = Math.max(1, Math.floor(year));

    let ir = 0;
    if (y <= 5) ir = 0;
    else if (y <= 21) ir = (y - 5) * 0.06;
    else if (y === 22) ir = 0.98;
    else ir = 1;

    let ps = 0;
    if (y <= 5) ps = 0;
    else if (y <= 21) ps = (y - 5) * 0.0165;
    else if (y === 22) ps = 0.28;
    else if (y <= 30) ps = 0.28 + ((y - 22) * 0.09);
    else ps = 1;

    return { ir: clamp(ir, 0, 1), ps: clamp(ps, 0, 1) };
}

function computeResaleTax(plusValueTaxable, year, regime, tauxPvInput) {
    if (plusValueTaxable <= 0) return 0;

    if (regime === 'sci-is') {
        const sciRate = clamp((tauxPvInput || 25) / 100, 0, 1);
        return plusValueTaxable * sciRate;
    }

    const abatements = getResaleAbatementsYears(year);
    const baseIR = plusValueTaxable * (1 - abatements.ir);
    const basePS = plusValueTaxable * (1 - abatements.ps);
    return (baseIR * 0.19) + (basePS * CSG_CRDS_RATE);
}

export function computeResaleTimeline(prixNet, capitalRestantSeries, cfCumuleSeries, inputs) {
    const rows = [];
    const basePrice = (inputs['prix-revente-estime'] && inputs['prix-revente-estime'] > 0) ? inputs['prix-revente-estime'] : prixNet;
    const growth = (inputs['appreciation'] || 0) / 100;
    const fraisRate = Math.max(0, (inputs['frais-revente'] || 0) / 100);
    const tauxPv = Math.max(0, inputs['taux-pv'] || 0);
    const apport = inputs['apport'] || 0;
    const regime = inputs['regime'] || 'micro-foncier';
    const fraisNotaireAchat = prixNet * ((inputs['notaire'] || 0) / 100);
    const acquisitionBase = prixNet + fraisNotaireAchat + (inputs['agence'] || 0) + (inputs['travaux'] || 0);

    let firstInterestingYear = null;
    let bestYear = 1;
    let bestGain = -Infinity;

    const amortAnnuelSciIs = prixNet * 0.80 / 30;

    const horizon = Math.min(capitalRestantSeries.length, cfCumuleSeries.length, 25);
    for (let i = 0; i < horizon; i++) {
        const year = i + 1;
        const prixVente = basePrice * Math.pow(1 + growth, i);
        const fraisVente = prixVente * fraisRate;
        const prixVenteNetFrais = prixVente - fraisVente;
        // En SCI-IS, la base fiscale est la valeur nette comptable (après amortissements cumulés)
        let plusValueTaxable;
        if (regime === 'sci-is') {
            const amortCumule = Math.min(amortAnnuelSciIs * year, prixNet * 0.80);
            const valeurComptableNette = Math.max(0, acquisitionBase - amortCumule);
            plusValueTaxable = prixVenteNetFrais - valeurComptableNette;
        } else {
            plusValueTaxable = prixVenteNetFrais - acquisitionBase;
        }
        const impotPv = computeResaleTax(plusValueTaxable, year, regime, tauxPv);
        const netVendeur = prixVente - fraisVente - impotPv;
        const crd = Math.max(0, capitalRestantSeries[i] || 0);
        const cashNetSortie = netVendeur - crd;
        const cfCumule = cfCumuleSeries[i] || 0;
        const gainGlobal = cfCumule + cashNetSortie - apport;
        const interesting = gainGlobal >= 0;

        if (interesting && firstInterestingYear === null) firstInterestingYear = year;
        if (gainGlobal > bestGain) {
            bestGain = gainGlobal;
            bestYear = year;
        }

        rows.push({
            year,
            prixVente,
            fraisVente,
            plusValueTaxable,
            impotPv,
            netVendeur,
            crd,
            cashNetSortie,
            gainGlobal,
            interesting
        });
    }

    return { rows, firstInterestingYear, bestYear, bestGain };
}
