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

// Barème 2026 (revenus 2025), loi de finances 2026 promulguée le 19/02/2026 — seuils
// revalorisés de +0,9 % par rapport au barème 2025 (revenus 2024).
const BAREME_IR = [
    { seuil: 11600, taux: 0 },
    { seuil: 29579, taux: 11 },
    { seuil: 84577, taux: 30 },
    { seuil: 181917, taux: 41 },
    { seuil: Infinity, taux: 45 },
];

// Décote 2026, vérifiée BOI-IR-LIQ-20-20-20-20260407 (bofip.impots.gouv.fr) le 2026-07-29.
const DECOTE_TAUX = 0.4525;
const DECOTE_CELIBATAIRE = { seuil: 1982, base: 897 };
const DECOTE_COUPLE = { seuil: 3277, base: 1483 };

// Plafonnement des effets du quotient familial (art. 197 I 2° CGI), vérifié BOI-IR-LIQ-20-20-20-20260407
// le 2026-07-29 : l'avantage procuré par les demi-parts liées aux enfants est plafonné à 1 807 €
// par demi-part (donc 3 614 € par part entière, cas du 3e enfant et suivants). Ne couvre que le cas
// standard (enfants à charge) — pas les plafonds spécifiques (parent isolé case T à 4 262 €, invalidité,
// veuvage avec personne à charge...), non modélisés dans le profil du foyer de cette app (adults/children
// seulement).
const PLAFOND_PAR_DEMI_PART_ENFANT = 1807;

export function calculateTMI(revenus, foyer = 0) {
    const hasObjectShape = typeof foyer === 'object' && foyer !== null;
    const adults = hasObjectShape ? foyer.adults : 2;
    const enfants = hasObjectShape ? foyer.children : foyer;
    const parts = getHouseholdTaxParts(adults, enfants);
    const quotient = Math.max(0, Number(revenus) || 0) / parts;
    const bracket = BAREME_IR.find(b => quotient <= b.seuil);
    return bracket ? bracket.taux : 45;
}

// Applique le barème progressif tranche par tranche à un quotient (revenu ÷ parts) et remultiplie
// par le nombre de parts fourni — factorisé pour être appelable deux fois par computeImpotFoyer
// (une fois avec les parts complètes, une fois avec les parts de base pour le plafonnement).
function appliquerBaremeIR(revenuGlobal, parts) {
    const quotient = parts > 0 ? revenuGlobal / parts : 0;
    const tranches = [];
    let prevSeuil = 0;
    let totalParPart = 0;
    for (const { seuil, taux } of BAREME_IR) {
        if (quotient <= prevSeuil) break;
        const trancheHaut = Math.min(quotient, seuil);
        const montantImposable = Math.max(0, trancheHaut - prevSeuil);
        const impotTranche = montantImposable * (taux / 100);
        tranches.push({
            seuilBas: Math.round(prevSeuil),
            seuilHaut: seuil === Infinity ? null : Math.round(seuil),
            taux,
            montantImposable: Math.round(montantImposable),
            impot: Math.round(impotTranche),
        });
        totalParPart += impotTranche;
        prevSeuil = seuil;
    }
    return { tranches, quotient, irBrut: totalParPart * parts };
}

// Calcule l'IR au barème progressif tranche par tranche (pas juste la TMI appliquée en taux plat),
// avec plafonnement du quotient familial et décote — utilisé par l'onglet Impôt pour reconstituer
// le vrai montant à payer. Limite assumée : ne couvre que le plafonnement standard (enfants à
// charge), pas les plafonds spécifiques (parent isolé, invalidité, veuvage — voir
// PLAFOND_PAR_DEMI_PART_ENFANT ci-dessus), le profil du foyer de cette app ne les distingue pas.
export function computeImpotFoyer(revenuSalarial, revenuFoncierImposable, foyer = {}) {
    const adults = Math.min(2, Math.max(1, Math.round(Number(foyer.adults) || 2)));
    const children = Math.max(0, Math.round(Number(foyer.children) || 0));
    const parts = getHouseholdTaxParts(adults, children);
    const partsBase = adults; // sans les demi-parts liées aux enfants

    const revenuGlobal = Math.max(0, (Number(revenuSalarial) || 0) + (Number(revenuFoncierImposable) || 0));

    const complet = appliquerBaremeIR(revenuGlobal, parts);
    let irBrut = complet.irBrut;
    let plafonnementQF = null;

    if (parts > partsBase) {
        const base = appliquerBaremeIR(revenuGlobal, partsBase);
        const avantage = base.irBrut - complet.irBrut;
        const plafond = (parts - partsBase) * 2 * PLAFOND_PAR_DEMI_PART_ENFANT;
        const applique = avantage > plafond;
        if (applique) irBrut = base.irBrut - plafond;
        plafonnementQF = {
            applique,
            avantage: Math.round(avantage),
            plafond: Math.round(plafond),
            irBrutSansPlafonnement: Math.round(complet.irBrut),
        };
    }

    const decoteParams = adults >= 2 ? DECOTE_COUPLE : DECOTE_CELIBATAIRE;
    const decote = irBrut < decoteParams.seuil ? Math.max(0, decoteParams.base - irBrut * DECOTE_TAUX) : 0;
    const irNet = Math.max(0, Math.round(irBrut - decote));
    const psFoncier = Math.round(Math.max(0, Number(revenuFoncierImposable) || 0) * CSG_CRDS_RATE);

    return {
        revenuSalarial: Math.round(Number(revenuSalarial) || 0),
        revenuFoncierImposable: Math.round(Number(revenuFoncierImposable) || 0),
        revenuGlobal: Math.round(revenuGlobal),
        parts,
        quotient: Math.round(complet.quotient),
        tranches: complet.tranches,
        plafonnementQF,
        irBrut: Math.round(irBrut),
        decote: Math.round(decote),
        irNet,
        psFoncier,
        total: irNet + psFoncier,
    };
}

function computeAnnualTaxEstimate(prixNet, loyersEncaisses, chargesExploitationAnnuelles, inputs, tmi, interestYear, insuranceYear, year = 1, carryForwardDeficit = 0) {
    const tauxGlobalImpot = (tmi / 100) + CSG_CRDS_RATE;
    const oneOffCharges = year === 1 ? (inputs['travaux'] || 0) + (inputs['frais-bancaires'] || 0) : 0;

    if (inputs['regime'] === 'micro-foncier') {
        return { tax: (loyersEncaisses * 0.7) * tauxGlobalImpot, newCarryForward: 0 };
    }

    if (inputs['regime'] === 'reel') {
        const chargesAnnuelles = chargesExploitationAnnuelles + insuranceYear + oneOffCharges;
        const revenusNets = loyersEncaisses - chargesAnnuelles - interestYear;

        if (revenusNets > 0) {
            // Consommer d'abord le carry-forward disponible avant d'imposer
            const absorbed = Math.min(carryForwardDeficit, revenusNets);
            const assiette = revenusNets - absorbed;
            const remainingCarry = carryForwardDeficit - absorbed;
            return { tax: assiette * tauxGlobalImpot, newCarryForward: remainingCarry };
        }

        const soldeHorsInterets = loyersEncaisses - chargesAnnuelles;
        if (soldeHorsInterets < 0) {
            // Déficit hors intérêts : imputable sur revenu global (plafond 10 700 €), excès reportable
            // Déficit dû aux intérêts : non imputable sur revenu global, mais reportable sur revenus fonciers (art. 156 I CGI)
            const deductibleNow = Math.min(10700, Math.abs(soldeHorsInterets));
            const addedCarry = Math.max(0, Math.abs(soldeHorsInterets) - 10700) + interestYear;
            return {
                tax: -(deductibleNow * (tmi / 100)),
                newCarryForward: carryForwardDeficit + addedCarry
            };
        }
        // soldeHorsInterets >= 0 mais revenusNets <= 0 : déficit entièrement dû aux intérêts — reportable
        return { tax: 0, newCarryForward: carryForwardDeficit + Math.abs(revenusNets) };
    }

    if (inputs['regime'] === 'sci-is') {
        const amortissement = prixNet * 0.80 / 30;
        const chargesDeductibles = chargesExploitationAnnuelles + insuranceYear + interestYear + oneOffCharges;
        const benefice = loyersEncaisses - chargesDeductibles - amortissement;
        if (benefice > 0) {
            return { tax: Math.min(benefice, 42500) * 0.15 + Math.max(0, benefice - 42500) * 0.25, newCarryForward: 0 };
        }
    }

    return { tax: 0, newCarryForward: 0 };
}

export function buildFinancialModel(prixNet, loyerMensuel, inputs, tmi) {
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

    const taxResult = computeAnnualTaxEstimate(
        prixNet,
        loyersEncaisses,
        chargesExploitationAnnuelles,
        inputs,
        tmi,
        interetsAnnee1,
        coutAssuranceMensuel * 12,
        1
    );
    const impotsAnnee = taxResult.tax;

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

// CF mensuel moyen sur 3 ans (durée minimale d'engagement du régime réel)
// Prend en compte : décroissance des intérêts, one-off charges an 1 seulement, report de déficit foncier
function computeAvgCF3Y(prixNet, loyerMensuel, inputs, tmi) {
    const model = buildFinancialModel(prixNet, loyerMensuel, inputs, tmi);
    const nMois = Math.max(0, Math.round((inputs['duree'] || 0) * 12));
    const tauxMensuel = (inputs['taux-input'] / 100) / 12;
    let remainingCapital = model.montantFinance;
    let totalAnnualCF = 0;
    let carryForward = 0;

    for (let year = 1; year <= 3; year++) {
        let interestYear = 0;
        let insuranceYear = 0;
        let debtServiceYear = 0;
        // Base de l'assurance pour cette année : CRD au 1er janvier si le contrat est dégressif,
        // sinon capital initial (cotisation fixe) — voir computeAmortizationSchedule.
        const assuranceMensAnnee = inputs['assurance-mode'] === 'crd'
            ? (remainingCapital * (inputs['assurance'] / 100)) / 12
            : model.coutAssuranceMensuel;

        for (let month = 0; month < 12; month++) {
            const monthIndex = ((year - 1) * 12) + month;
            if (monthIndex >= nMois || remainingCapital <= 0) break;
            const interestMonth = tauxMensuel > 0 ? remainingCapital * tauxMensuel : 0;
            let principalMonth = tauxMensuel > 0 ? model.mensualiteCredit - interestMonth : model.mensualiteCredit;
            principalMonth = Math.max(0, Math.min(remainingCapital, principalMonth));
            interestYear += interestMonth;
            insuranceYear += assuranceMensAnnee;
            debtServiceYear += model.mensualiteCredit + assuranceMensAnnee;
            remainingCapital = Math.max(0, remainingCapital - principalMonth);
        }

        const taxResult = computeAnnualTaxEstimate(
            model.prixNet, model.loyersEncaisses, model.chargesExploitationAnnuelles,
            inputs, tmi, interestYear, insuranceYear, year, carryForward
        );
        totalAnnualCF += model.loyersEncaisses - model.chargesExploitationAnnuelles - debtServiceYear - taxResult.tax;
        carryForward = taxResult.newCarryForward;
    }

    return (totalAnnualCF / 3) / 12;
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

    const cfMicro3Y = computeAvgCF3Y(prixNet, loyer, Object.assign({}, inputs, { regime: 'micro-foncier' }), tmi);
    const cfReel3Y  = computeAvgCF3Y(prixNet, loyer, Object.assign({}, inputs, { regime: 'reel' }), tmi);
    const cfSciIs3Y = computeAvgCF3Y(prixNet, loyer, Object.assign({}, inputs, { regime: 'sci-is' }), tmi);
    const maxCf3Y = Math.max(cfMicro3Y, cfReel3Y, cfSciIs3Y);
    const bestRegime = maxCf3Y === cfMicro3Y ? 'Micro-foncier' : (maxCf3Y === cfReel3Y ? 'Foncier réel' : 'SCI à l\'IS');

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
        const engagementNote = bestRegime?.id === 'reel' ? ' (engagement 3 ans)' : '';
        blockers.push({
            label: 'Montage fiscal perfectible',
            detail: `${Math.round(regimeGap)} € / mois sont encore disponibles via ${bestRegime.label}${engagementNote}.`
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

    if (bestRegime && currentRegime && bestRegime.id !== currentRegime.id && (bestRegime.cfAvg3Y ?? bestRegime.cfNetNet) > (currentRegime.cfAvg3Y ?? currentRegime.cfNetNet) + 1) {
        const lever = {
            label: `Basculer en ${bestRegime.label}`,
            category: 'Fiscalité',
            delta: bestRegime.cfNetNet - currentRegime.cfNetNet,
            nextCf: bestRegime.cfNetNet
        };
        if (bestRegime.id === 'reel') {
            lever.note = 'Engagement irrévocable sur 3 exercices fiscaux (art. 32 CGI)';
        }
        levers.push(lever);
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
    let carryForwardDeficit = 0;
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

        const taxResult = computeAnnualTaxEstimate(
            model.prixNet,
            model.loyersEncaisses,
            model.chargesExploitationAnnuelles,
            inputs,
            tmi,
            interestYear,
            insuranceYear,
            year,
            carryForwardDeficit
        );
        carryForwardDeficit = taxResult.newCarryForward;
        const annualCashflow = model.loyersEncaisses - model.chargesExploitationAnnuelles - debtServiceYear - taxResult.tax;

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
    const cacheKey = `${prixNet}|${loyer}|${adults}|${children}|${inputs['revenus']}|${inputs['taux-input']}|${inputs['duree']}|${inputs['regime']}|${inputs['nego']}|${inputs['apport']}|${inputs['fonciere']}|${inputs['copro']}|${inputs['pno']}|${inputs['vacance']}|${inputs['frais-bancaires']}|${thresholds.minCf}|${thresholds.minDscr}`;
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
    let carryForwardDeficit = 0;

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

        const taxResult = computeAnnualTaxEstimate(
            model.prixNet,
            model.loyersEncaisses,
            model.chargesExploitationAnnuelles,
            inputs,
            tmi,
            interestYear,
            insuranceYear,
            year,
            carryForwardDeficit
        );
        const taxesYear = taxResult.tax;
        carryForwardDeficit = taxResult.newCarryForward;

        const cfAvantImpot = (model.loyersEncaisses - model.chargesExploitationAnnuelles - debtServiceYear) / 12;
        const cfApresImpot = cfAvantImpot - (taxesYear / 12);

        rows.push({ year, cfAvantImpot, cfApresImpot, deficitReporte: Math.round(carryForwardDeficit) });
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
            cfAvg3Y: computeAvgCF3Y(prixNet, loyer, { ...inputs, regime }, tmi),
            isCurrent: inputs['regime'] === regime
        }))
        .sort((left, right) => right.cfAvg3Y - left.cfAvg3Y);

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

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function getResaleAbatementsYears(year) {
    const y = Math.max(1, Math.floor(year));

    let ir = 0;
    if (y <= 5) ir = 0;
    else if (y <= 21) ir = (y - 5) * 0.06;
    else if (y === 22) ir = 1.0;
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

// Consolide loyer/vacance : agrège les lots (immeuble de rapport) s'ils existent,
// sinon retombe sur acquisition.loyerInitial/postAchat.vacance (bien mono-lot, comportement inchangé).
// Loyer applicable à une date : dernière entrée d'historique dont le mois est <= à la date cible.
// `mois` au format 'YYYY-MM' — la comparaison lexicographique suffit sur ce format.
// Retourne null si l'historique est vide ou si aucune entrée n'a encore pris effet.
function resolveLoyerFromHistorique(historique, moisCible) {
    if (!historique?.length) return null;
    const sorted = [...historique].sort((a, b) => a.mois.localeCompare(b.mois));
    let applicable = null;
    for (const entry of sorted) {
        if (!entry?.mois) continue;
        if (entry.mois <= moisCible) applicable = entry;
        else break;
    }
    // Avant la première prise d'effet, on retient quand même le loyer de départ :
    // un bien acquis en cours d'année ne doit pas afficher 0 € sur les années antérieures.
    return (applicable ?? sorted[0])?.montant ?? null;
}

function currentMonthKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Point d'entrée unique loyer/vacance. Résolution par ordre de priorité :
 *   1. asset.lots[] (immeuble de rapport) ;
 *   2. postAchat.loyerHistorique résolu à `moisCible` ;
 *   3. acquisition.loyerInitial (biens créés avant l'historique de loyer).
 * `moisCible` ('YYYY-MM' ou une année 'YYYY') vaut le mois courant par défaut.
 */
export function resolveLoyerVacance(asset, moisCible = null) {
    const lots = asset.lots || [];
    if (lots.length > 0) {
        const totalLoyer = lots.reduce((s, l) => s + (l.loyer || 0), 0);
        const vacancePct = totalLoyer > 0
            ? lots.reduce((s, l) => s + (l.loyer || 0) * (l.vacance ?? 5), 0) / totalLoyer
            : lots.reduce((s, l) => s + (l.vacance ?? 5), 0) / lots.length;
        return { loyer: totalLoyer, vacancePct };
    }
    const vacancePct = asset.postAchat?.vacance ?? 5;
    // Une année seule ('2026') est traitée comme sa fin d'année : le loyer retenu
    // est celui en vigueur au 31/12, cohérent avec un calcul annuel.
    const cible = moisCible == null
        ? currentMonthKey()
        : (/^\d{4}$/.test(String(moisCible)) ? `${moisCible}-12` : String(moisCible));
    const fromHistorique = resolveLoyerFromHistorique(asset.postAchat?.loyerHistorique, cible);
    if (fromHistorique != null) return { loyer: fromHistorique, vacancePct };
    return { loyer: asset.acquisition?.loyerInitial || 0, vacancePct };
}

export function computeOwnedAssetCF(asset, scenario, tmi, regimeOverride = null) {
    const acq = asset.acquisition || {};
    const post = asset.postAchat || {};
    const credit = acq.credit || {};

    const travauxMensualites = (post.travaux || []).reduce((sum, t) => {
        if (!t.credit) return sum;
        const tc = t.credit;
        const nM = (tc.duree || 0) * 12;
        const tM = ((tc.taux || 0) / 100) / 12;
        if (nM <= 0) return sum;
        const m = tM > 0 ? (tc.montant * tM) / (1 - Math.pow(1 + tM, -nM)) : tc.montant / nM;
        return sum + m;
    }, 0);

    const prixAcquisition = acq.prix || 0;
    const montantCredit = credit.montant || 0;
    const dureeCredit = credit.duree || 0;

    // Résoudre les charges en priorisant chargesAnnuelles (entrée la plus récente ≤ aujourd'hui)
    const currentYear = new Date().getFullYear();
    const recentEntries = (post.chargesAnnuelles || []).filter(e => e.annee <= currentYear).sort((a, b) => b.annee - a.annee);
    const ce = recentEntries[0] || null;
    const resolvedTF = ce ? (ce.taxeFonciere ?? post.taxeFonciere ?? 0) : (post.taxeFonciere ?? 0);
    const resolvedGestion = ce ? (ce.gestionLocative ?? post.gestionLocative ?? 0) : (post.gestionLocative ?? 0);
    const resolvedPNO = ce ? (ce.assurancePNO ?? post.assurancePNO ?? 0) : (post.assurancePNO ?? 0);
    const resolvedCopro = ce ? (ce.chargesCopro ?? post.chargesCopro ?? 0) : (post.chargesCopro ?? 0);

    // Mensualité + intérêts/assurance calculés depuis le mois CIVIL COURANT du planning
    // d'amortissement réel (credit.montant), jamais reconstruits via « apport = prix - crédit » :
    // montantCredit peut dépasser prixAcquisition dès que des frais/travaux ont été inclus dans
    // l'emprunt (cas courant), et cette reconstruction sous-estimait alors silencieusement le
    // capital financé (apport négatif tronqué à 0). Même logique que computeOwnedAssetTimeline.
    //
    // Contrairement à computeOwnedAssetTimeline (qui reconstruit un vrai historique comptable par
    // année civile, mois d'achat inclus), computeOwnedAssetCF est LE taux courant affiché tel quel
    // partout dans l'app sous « CF net-net / mois » (bannière, liste, dashboard, carte, tri,
    // alertes) : il répond à « si ma situation actuelle (loyer, mensualité) se maintient, combien
    // je touche par mois ? », pas « qu'ai-je encaissé depuis mon achat cette année civile ? ». Le
    // loyer et rentaBrute (loyer × 12) ne sont donc jamais proratisés sur l'année d'achat — lire le
    // mois courant de l'échéancier (au lieu du total annuel prorata / 12) garde la même logique de
    // taux courant pour la part crédit, plutôt que d'introduire une dilution par les mois non
    // encore possédés (ce qu'un simple prorata loyer × mois_possédés / 12 aurait fait, en
    // contradiction avec la mensualité elle-même jamais proratisée).
    const currentMonth = new Date().getMonth() + 1;
    const nMoisCredit = dureeCredit * 12;
    const tauxMCredit = ((credit.taux || 0) / 100) / 12;
    let mensCredit = 0;
    if (montantCredit > 0 && nMoisCredit > 0) {
        mensCredit = tauxMCredit > 0
            ? (montantCredit * tauxMCredit) / (1 - Math.pow(1 + tauxMCredit, -nMoisCredit))
            : montantCredit / nMoisCredit;
    }
    // creditActif = le crédit a une ligne dans l'échéancier mensuel pour le mois civil courant.
    // Dérivé directement du planning d'amortissement plutôt que d'une comparaison d'années brute :
    // avec un crédit démarré ou soldé en cours d'année, « currentYear < anneeAchat+durée » se
    // trompe sur l'année de démarrage/fin.
    let interetsMoisCourant = 0;
    let assuranceMensCredit = 0;
    let creditActif = false;
    if (montantCredit > 0) {
        const { scheduleMonthly } = computeAmortizationSchedule(montantCredit, credit.taux || 0, dureeCredit, asset.dateAchat, credit.assurance || 0, credit.assuranceMode);
        const monthRow = scheduleMonthly.find(r => r.annee === currentYear && r.mois === currentMonth);
        if (monthRow) {
            creditActif = true;
            interetsMoisCourant = monthRow.interets;
            assuranceMensCredit = monthRow.assurance;
        }
    }
    // Intérêts annualisés au taux courant (mois courant × 12) pour l'estimation fiscale ci-dessous —
    // cohérent avec loyersEncaisses/assuranceMensCredit×12, eux aussi au taux courant, pas un total
    // d'année civile partiel.
    const interetsAnnee = interetsMoisCourant * 12;
    const mensualiteTotale = creditActif ? (mensCredit + assuranceMensCredit) : 0;

    const vacancePct = scenario.vacance ?? 5;
    const loyer = scenario.loyer ?? resolveLoyerVacance(asset).loyer;
    const loyersEncaisses = loyer * 12 * (1 - vacancePct / 100);

    const taxeFonciere = scenario.taxeFonciere ?? resolvedTF;
    const chargesCopro = scenario.chargesCopro ?? resolvedCopro;
    const assurancePNO = scenario?.assurancePNO ?? resolvedPNO;
    const gestionPct = scenario?.gestionLocative ?? resolvedGestion;
    const chargesExploitationAnnuelles = taxeFonciere + (chargesCopro * 12) + assurancePNO + (loyersEncaisses * (gestionPct / 100));

    // Travaux enregistrés cette année (onglet Travaux) : les déductibles réduisent l'assiette
    // imposable (régimes réel/SCI-IS, comme dans computeOwnedAssetTimeline/computeCFBreakdown),
    // financés ou non — la déductibilité fiscale ne dépend pas du mode de financement de la
    // dépense. Seuls les frais payés cash (financeParCredit absent/false) retranchent en plus la
    // trésorerie : ceux financés par le crédit immobilier principal sont déjà remboursés via
    // mensualiteTotale au fil des années, les compter aussi ici les décompterait deux fois. Sans
    // cette prise en compte des travaux du tout, cette fonction — utilisée par la liste, le
    // dashboard, la carte, le tri, les alertes — ignorait entièrement les travaux de l'année,
    // contrairement à l'onglet Exploitation qui les affiche (écart constaté : plusieurs centaines
    // d'euros/mois dès qu'un frais est enregistré dans l'année en cours).
    const travauxAnnee = (post.travaux || []).filter(t => t.date && t.montant && new Date(t.date).getFullYear() === currentYear);
    const travauxDeductiblesAnnee = travauxAnnee.filter(t => t.tag === 'deductible').reduce((s, t) => s + t.montant, 0);
    const travauxCashAnnee = travauxAnnee.filter(t => !t.financeParCredit).reduce((s, t) => s + t.montant, 0);

    const regime = regimeOverride || scenario.regime || 'micro-foncier';
    const { annee: anneeAchat } = parseDateAchat(asset.dateAchat);
    const yearsElapsed = currentYear - anneeAchat;
    const impotsAnnee = computeAnnualTaxEstimate(
        prixAcquisition, loyersEncaisses, chargesExploitationAnnuelles + travauxDeductiblesAnnee,
        { travaux: 0, 'frais-bancaires': 0, regime }, tmi, interetsAnnee, assuranceMensCredit * 12, yearsElapsed + 1
    ).tax;

    const investissementTotal = (acq.prix || 0) + (acq.fraisAgence || 0) + (acq.fraisNotaire || 0);
    const rentaBrute = investissementTotal > 0 ? ((loyer * 12) / investissementTotal) * 100 : 0;
    const noiMensuel = (loyersEncaisses - chargesExploitationAnnuelles) / 12;
    const dscr = mensualiteTotale > 0 ? noiMensuel / mensualiteTotale : 0;
    const cfNet = (loyersEncaisses / 12) - mensualiteTotale - (chargesExploitationAnnuelles / 12) - (travauxCashAnnee / 12);
    const cfNetNet = cfNet - (impotsAnnee / 12);

    return {
        cfNetNet: cfNetNet - travauxMensualites,
        cfNet: cfNet - travauxMensualites,
        mensualiteTotale: mensualiteTotale + travauxMensualites,
        chargesMensuelles: (chargesExploitationAnnuelles / 12) + travauxMensualites,
        impotsAnnee,
        loyerEffectif: loyersEncaisses / 12,
        rentaBrute,
        dscr,
    };
}

export function computeOwnedAssetTimeline(asset, tmi, regimeOverride = null) {
    const acq = asset.acquisition || {};
    const post = asset.postAchat || {};
    const credit = acq.credit || {};

    const prixAcquisition = acq.prix || 0;
    const montantCredit = credit.montant || 0;
    const dureeCredit = credit.duree || 0;
    const nMois = dureeCredit * 12;
    const tauxM = ((credit.taux || 0) / 100) / 12;
    let mensCredit = 0;
    if (tauxM > 0 && nMois > 0) mensCredit = (montantCredit * tauxM) / (1 - Math.pow(1 + tauxM, -nMois));
    else if (nMois > 0) mensCredit = montantCredit / nMois;

    const currentYear = new Date().getFullYear();
    const { annee: anneeAchat, mois: moisAchat } = parseDateAchat(asset.dateAchat);
    // Borne haute sûre pour l'année de fin de prêt (voir preuve dans computeAmortizationSchedule :
    // même démarré en décembre, un crédit de N ans ne peut jamais dépasser anneeAchat+N). Le vrai
    // gate mensuel (loanMonthsElapsedTotal < nMois) est calculé dans la boucle ci-dessous.
    const endYear = Math.max(currentYear + 2, anneeAchat + dureeCredit);

    // Le loyer est résolu année par année dans la boucle ci-dessous : l'historique de loyer
    // (postAchat.loyerHistorique) peut faire varier le montant d'une année sur l'autre.
    const { vacancePct } = resolveLoyerVacance(asset);

    const investBrut = prixAcquisition + (acq.fraisAgence || 0) + (acq.fraisNotaire || 0);
    const apportInitial = Math.max(0, investBrut - montantCredit);

    // Un frais « financé par le crédit » (financeParCredit) fait partie de l'enveloppe du prêt
    // principal — la mensualité (debtService ci-dessous) rembourse déjà cette part au fil des
    // années. Il reste déductible fiscalement l'année où la dépense a eu lieu (déductibilité et
    // remboursement du prêt sont deux mécanismes indépendants en droit fiscal français), mais ne
    // doit plus être retranché une seconde fois du cash-flow comme une dépense ponctuelle.
    const travauxDeductiblesParAnnee = {}; // assiette fiscale : tous les déductibles, financés ou non
    const travauxCashParAnnee = {}; // trésorerie : seulement les frais payés cash (déductibles ou non)
    for (const t of (post.travaux || [])) {
        if (!t.date || !t.montant) continue;
        const y = new Date(t.date).getFullYear();
        if (t.tag === 'deductible') {
            travauxDeductiblesParAnnee[y] = (travauxDeductiblesParAnnee[y] || 0) + t.montant;
        }
        if (!t.financeParCredit) {
            travauxCashParAnnee[y] = (travauxCashParAnnee[y] || 0) + t.montant;
        }
    }

    let capitalRestant = montantCredit;
    let loanMonthsElapsedTotal = 0; // mois de crédit déjà écoulés, tous exercices confondus
    let carryForwardDeficit = 0;
    const years = [];
    let cumulCF = 0;
    let recettesCum = 0;
    let depensesCum = 0;

    for (let y = anneeAchat; y <= endYear; y++) {
        const yearsElapsed = y - anneeAchat;
        // Le crédit ne démarre pas forcément en janvier : l'année d'achat ne compte que les mois
        // depuis moisAchat, les années suivantes comptent normalement depuis janvier.
        const firstCalMonth = y === anneeAchat ? moisAchat : 1;
        const creditActif = dureeCredit > 0 && loanMonthsElapsedTotal < nMois;

        // Comme la dette (firstCalMonth ci-dessus), le loyer de l'année d'achat ne doit compter que
        // les mois depuis moisAchat : un bien acheté en juin n'a pas généré de loyer en janvier-mai.
        const moisPossedeAnnee = y === anneeAchat ? (13 - moisAchat) : 12;
        const loyersAnnuels = resolveLoyerVacance(asset, String(y)).loyer * moisPossedeAnnee * (1 - vacancePct / 100);

        const annualEntries = (post.chargesAnnuelles || []).filter(e => e.annee <= y).sort((a, b) => b.annee - a.annee);
        const chargesEntry = annualEntries[0] || null;
        const taxeFonciere = chargesEntry ? (chargesEntry.taxeFonciere ?? post.taxeFonciere ?? 0) : (post.taxeFonciere ?? 0);
        const gestionPct = chargesEntry ? (chargesEntry.gestionLocative ?? post.gestionLocative ?? 0) : (post.gestionLocative ?? 0);
        const assurancePNO = chargesEntry ? (chargesEntry.assurancePNO ?? post.assurancePNO ?? 0) : (post.assurancePNO ?? 0);
        const chargesCopro = chargesEntry ? (chargesEntry.chargesCopro ?? post.chargesCopro ?? 0) : (post.chargesCopro ?? 0);
        const travauxDeductiblesAnnee = travauxDeductiblesParAnnee[y] || 0;
        const travauxCashAnnee = travauxCashParAnnee[y] || 0;
        // Taxe foncière/PNO (montants annuels) et charges copro (mensuelles) proratisées sur l'année
        // d'achat comme le loyer et le crédit ci-dessus : sinon un bien acheté en cours d'année se
        // voit imputer une taxe foncière/PNO en année pleine contre seulement quelques mois de loyer,
        // creusant artificiellement le CF affiché de l'année d'achat (bug signalé par l'utilisateur,
        // vérifié sur un cas réel : ramène "70 rue du mouton" de -248€ à +227€ sur 5 mois, cohérent
        // avec le taux courant de computeOwnedAssetCF, +45€/mois).
        const chargesAnneeBase = (taxeFonciere * moisPossedeAnnee / 12) + (chargesCopro * moisPossedeAnnee) + (assurancePNO * moisPossedeAnnee / 12) + (loyersAnnuels * (gestionPct / 100));
        // Les travaux déductibles réduisent l'assiette imposable en foncier réel / SCI-IS
        // (ignorés en micro-foncier, où l'abattement forfaitaire 30% remplace toute déduction réelle)
        // — tous les déductibles y compris ceux financés par le crédit, la déduction fiscale ne
        // dépend pas du mode de financement de la dépense.
        const chargesAnneeTax = chargesAnneeBase + travauxDeductiblesAnnee;

        // Base de l'assurance de cette année : CRD au 1er mois actif de l'année (avant
        // l'amortissement de l'année) si le contrat est dégressif, sinon capital initial
        // (cotisation fixe). Accumulée mois par mois ci-dessous pour prorater correctement une
        // année partielle (crédit démarré ou soldé en cours d'année).
        const assuranceBaseAnnee = credit.assuranceMode === 'crd' ? capitalRestant : montantCredit;
        const assurMensUnitaire = (assuranceBaseAnnee * ((credit.assurance || 0) / 100)) / 12;

        let interetsAnnee = 0;
        let capitalAnnee = 0;
        let assuranceAnnee = 0;
        let debtService = 0;
        if (creditActif) {
            let cap = capitalRestant;
            for (let cm = firstCalMonth; cm <= 12 && loanMonthsElapsedTotal < nMois && cap > 0; cm++) {
                const intM = tauxM > 0 ? cap * tauxM : 0;
                const capM = Math.max(0, Math.min(cap, mensCredit - intM));
                interetsAnnee += intM;
                capitalAnnee += capM;
                assuranceAnnee += assurMensUnitaire;
                cap -= capM;
                loanMonthsElapsedTotal++;
            }
            capitalRestant = cap;
            debtService = interetsAnnee + capitalAnnee + assuranceAnnee;
        }

        const inputs = {
            'taux-input': credit.taux || 0,
            'duree': credit.duree || 0,
            'assurance': credit.assurance || 0,
            'apport': Math.max(0, prixAcquisition - montantCredit),
            'notaire': 0, 'agence': 0, 'travaux': 0, 'meubles': 0, 'frais-bancaires': 0,
            'vacance': vacancePct,
            'copro': chargesCopro,
            'fonciere': taxeFonciere,
            'pno': assurancePNO,
            'gestion': gestionPct,
            'regime': regimeOverride || 'micro-foncier',
        };
        const taxResult = computeAnnualTaxEstimate(
            prixAcquisition, loyersAnnuels, chargesAnneeTax, inputs, tmi,
            interetsAnnee, assuranceAnnee, yearsElapsed + 1, carryForwardDeficit
        );
        carryForwardDeficit = taxResult.newCarryForward;
        const impotsAnnee = taxResult.tax;

        // Trésorerie : seuls les frais payés cash (travauxCashAnnee, déductibles ou non) sont
        // retranchés ici — ceux financés par le crédit sont déjà remboursés via debtService au
        // fil des années (voir travauxCashParAnnee plus haut), les compter aussi ici les
        // décompterait deux fois.
        const cfAnnuel = loyersAnnuels - debtService - chargesAnneeBase - impotsAnnee - travauxCashAnnee;
        const recettesAnnee = loyersAnnuels;
        const apportAnnee = y === anneeAchat ? apportInitial : 0;
        // depensesAnnee inclut l'apport (dépense de trésorerie réelle, cf. graphique Recettes vs Dépenses) ;
        // cfAnnuel reste le CF opérationnel hors apport, donc recettesAnnee - depensesAnnee ≠ cfAnnuel l'année d'achat
        // — voir apportAnnee pour réconcilier les deux dans un affichage tabulaire.
        const depensesAnnee = debtService + chargesAnneeBase + impotsAnnee + travauxCashAnnee + apportAnnee;

        cumulCF += cfAnnuel;
        recettesCum += recettesAnnee;
        depensesCum += depensesAnnee;

        // loyersAnnuels/chargesAnneeTax/interetsAnnee/assuranceAnnee : composantes brutes de
        // l'année, réutilisées telles quelles par computeDeficitFoncierHistorique pour rejouer le
        // calcul du régime réel sans dupliquer la résolution loyer/charges/travaux ci-dessus.
        years.push({ year: y, cfAnnuel, cumulCF, recettesAnnee, recettesCum, depensesAnnee, depensesCum, apportAnnee, loyersAnnuels, chargesAnneeTax, interetsAnnee, assuranceAnnee });
    }

    return { years, anneeAchat, endYear };
}

// ─── NOUVELLES FONCTIONS : PATRIMOINE, DETTE, FISCALITÉ, DASHBOARD ──────────

// Date d'achat d'un bien : stockée en 'YYYY-MM' (mois précis, ex. "2024-06") depuis l'ajout du
// démarrage de crédit en cours d'année. Accepte aussi une année brute (nombre ou chaîne, ex. 2024
// ou "2024") pour les biens saisis avant cette évolution — résolue au mois de janvier, ce qui
// reproduit exactement l'ancien comportement (tout le moteur supposait implicitement janvier).
// Point d'entrée unique : tout code qui lisait `asset.anneeAchat` doit passer par cette fonction.
export function parseDateAchat(raw) {
    const currentYear = new Date().getFullYear();
    if (typeof raw === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(raw)) {
        const [annee, mois] = raw.split('-').map(Number);
        return { annee, mois };
    }
    const annee = Number(raw) || currentYear;
    return { annee, mois: 1 };
}

// L'assurance emprunteur suit l'une de deux conventions selon le contrat : « capital initial »
// (cotisation fixe pour toute la durée, base = montant emprunté) ou « capital restant dû »
// (cotisation dégressive, recalculée chaque année sur le CRD au 1er janvier — c'est ce que montre
// l'échéancier de la banque quand le contrat est de ce type). tauxAssurance/assuranceMode sont
// optionnels pour ne pas casser les appels existants qui ne s'intéressent qu'aux intérêts/capital.
//
// dateDebut accepte tout ce que parseDateAchat comprend ('YYYY-MM', année brute, ou déjà un objet
// {annee, mois}) — le crédit ne démarre pas forcément en janvier (ex. acte signé en cours d'année),
// donc la première (et potentiellement la dernière) ligne du tableau peut être une année partielle
// de moins de 12 mois. Le tableau reste indexé par année civile (`schedule[i].annee`), donc les
// appelants qui font `schedule.find(r => r.annee === X)` n'ont rien à changer.
export function computeAmortizationSchedule(montant, tauxAnnuel, dureeAns, dateDebut, tauxAssurance = 0, assuranceMode = 'initial') {
    const nMois = dureeAns * 12;
    const tauxM = (tauxAnnuel / 100) / 12;
    let mensualite = 0;
    if (tauxM > 0 && nMois > 0) mensualite = (montant * tauxM) / (1 - Math.pow(1 + tauxM, -nMois));
    else if (nMois > 0) mensualite = montant / nMois;

    const { annee: anneeStart, mois: moisStart } = (dateDebut && typeof dateDebut === 'object')
        ? dateDebut
        : parseDateAchat(dateDebut);

    let crd = montant;
    const rows = new Map();
    const monthlyRows = [];
    for (let m = 0; m < nMois && crd > 0.01; m++) {
        const annee = anneeStart + Math.floor((moisStart - 1 + m) / 12);
        const mois = ((moisStart - 1 + m) % 12) + 1;
        let row = rows.get(annee);
        if (!row) { row = { annee, interets: 0, capital: 0, assurance: 0, crdDebut: crd, crdFin: crd }; rows.set(annee, row); }

        const crdDebutMois = crd;
        const intM = tauxM > 0 ? crd * tauxM : 0;
        const capM = Math.max(0, Math.min(crd, mensualite - intM));
        const assuranceBase = assuranceMode === 'crd' ? row.crdDebut : montant;
        const assuranceM = (assuranceBase * (tauxAssurance / 100)) / 12;
        row.interets += intM;
        row.capital += capM;
        row.assurance += assuranceM;
        crd = Math.max(0, crd - capM);
        row.crdFin = crd;
        monthlyRows.push({
            annee, mois,
            interets: Math.round(intM),
            capital: Math.round(capM),
            assurance: Math.round(assuranceM),
            crdDebut: Math.round(crdDebutMois),
            crdFin: Math.round(crd)
        });
    }

    const schedule = [...rows.values()]
        .sort((a, b) => a.annee - b.annee)
        .map(r => ({
            annee: r.annee,
            interets: Math.round(r.interets),
            capital: Math.round(r.capital),
            crdDebut: Math.round(r.crdDebut),
            crdFin: Math.round(r.crdFin),
            assurance: Math.round(r.assurance)
        }));
    return { schedule, scheduleMonthly: monthlyRows, mensualite };
}

export function computePatrimoineNet(asset) {
    const acq = asset.acquisition || {};
    const credit = acq.credit || {};
    const valeurEstimee = acq.valeurEstimee || 0;
    const dateEstimation = acq.dateEstimation || null;
    if (!valeurEstimee) return { valeurEstimee: 0, crd: null, patrimoineNet: null, dateEstimation };

    const montant = credit.montant || 0;
    const duree = credit.duree || 0;

    // CRD interpolé au mois courant (pas seulement au 1er janvier de l'année en cours) grâce à
    // scheduleMonthly — sinon le patrimoine net affiché sous-estime le capital déjà remboursé
    // pendant onze mois sur douze (exact seulement en janvier, écart maximal en décembre).
    let crd = 0;
    if (montant > 0 && duree > 0) {
        const { scheduleMonthly } = computeAmortizationSchedule(montant, credit.taux || 0, duree, asset.dateAchat);
        if (scheduleMonthly.length) {
            const now = new Date();
            const nowKey = now.getFullYear() * 12 + (now.getMonth() + 1);
            const exact = scheduleMonthly.find(r => (r.annee * 12 + r.mois) === nowKey);
            if (exact) {
                crd = exact.crdDebut;
            } else {
                const first = scheduleMonthly[0];
                const last = scheduleMonthly[scheduleMonthly.length - 1];
                if (nowKey < (first.annee * 12 + first.mois)) crd = montant; // crédit pas encore démarré
                else if (nowKey > (last.annee * 12 + last.mois)) crd = 0; // crédit déjà soldé
            }
        }
    }
    return { valeurEstimee, crd: Math.round(crd), patrimoineNet: Math.round(valeurEstimee - crd), dateEstimation };
}

export function computeEndettementGlobal(assets, revenusMensuels, creditsHorsImmo = []) {
    const now = new Date();
    let totalMensualites = 0;
    let prochainCreditTermine = null;

    for (const asset of assets) {
        const credit = asset.acquisition?.credit || {};
        const montant = credit.montant || 0;
        const nMois = (credit.duree || 0) * 12;
        const tauxM = ((credit.taux || 0) / 100) / 12;
        let mensCredit = 0;
        if (tauxM > 0 && nMois > 0) mensCredit = (montant * tauxM) / (1 - Math.pow(1 + tauxM, -nMois));
        else if (nMois > 0) mensCredit = montant / nMois;

        if (montant > 0 && nMois > 0) {
            const { annee: anneeAchat, mois: moisAchat } = parseDateAchat(asset.dateAchat);
            // Mois absolu (0-based depuis l'an 0) du 1er mois où le crédit n'est plus actif —
            // remplace l'ancienne comparaison d'années brute, fausse pile sur l'année de fin quand
            // le crédit démarre en cours d'année (voir computeOwnedAssetCF pour le même correctif).
            const finAbsMonth = (anneeAchat * 12 + (moisAchat - 1)) + nMois;
            const nowAbsMonth = now.getFullYear() * 12 + now.getMonth();
            const moisRestants = finAbsMonth - nowAbsMonth;

            if (moisRestants > 0) {
                const { scheduleMonthly } = computeAmortizationSchedule(montant, credit.taux || 0, credit.duree || 0, asset.dateAchat, credit.assurance || 0, credit.assuranceMode);
                // Assurance du mois civil courant lue directement dans l'échéancier mensuel — pas
                // une division par 12 d'un total d'année civile partielle (année d'achat ou de solde
                // du crédit), qui sous-estimait le taux mensuel réel. Même logique de « taux courant »
                // que computeOwnedAssetCF/computePatrimoineNet.
                const monthRow = scheduleMonthly.find(r => r.annee === now.getFullYear() && r.mois === now.getMonth() + 1);
                const assurMens = monthRow ? monthRow.assurance : 0;
                totalMensualites += mensCredit + assurMens;
                const anneeFinCredit = Math.floor(finAbsMonth / 12);
                if (!prochainCreditTermine || moisRestants < prochainCreditTermine.moisRestants) {
                    prochainCreditTermine = { assetNom: asset.nom, anneeFinCredit, moisRestants };
                }
            }
        }
    }

    // Ajouter les crédits hors immobilier (auto, perso, etc.)
    for (const c of creditsHorsImmo) {
        const mens = c.mensualite || 0;
        if (mens <= 0) continue;
        // Vérifier si le crédit est encore actif (dateFin absente ou dans le futur)
        if (c.dateFin) {
            const fin = new Date(c.dateFin + '-01');
            if (fin <= now) continue;
        }
        totalMensualites += mens;
    }

    const revMens = Math.max(1, revenusMensuels);
    const tauxEndettement = (totalMensualites / revMens) * 100;
    const capaciteResiduelle = Math.max(0, revMens * 0.35 - totalMensualites);
    return { totalMensualites, tauxEndettement, capaciteResiduelle, prochainCreditTermine };
}

// targetMonth (1-12, optionnel) restreint la ventilation à un seul mois de targetYear au lieu de
// l'année entière — utilisé par le camembert des dépenses (owned-portfolio.js) quand l'utilisateur
// choisit un mois précis plutôt que « Toute l'année ». Intérêts/capital/assurance crédit, gestion
// locative, travaux et loyer restent exacts au mois (échéancier mensuel, date exacte des travaux,
// resolveLoyerVacance au format 'YYYY-MM'). Taxe foncière et assurance PNO n'ont pas de date
// d'échéance connue dans le modèle de données : elles sont réparties en 1/12 du montant annuel.
// Les impôts n'ont pas de notion mensuelle (calculés à l'année sur le revenu global) : on prend
// 1/12 de l'impôt annuel déjà reconstruit par l'appel récursif sans targetMonth.
export function computeCFBreakdown(asset, tmi, regime, targetYear = 1, targetMonth = null) {
    const acq = asset.acquisition || {};
    const post = asset.postAchat || {};
    const credit = acq.credit || {};
    const { annee: anneeAchat, mois: moisAchat } = parseDateAchat(asset.dateAchat);
    const targetAbsYear = anneeAchat + targetYear - 1;

    const { years } = computeOwnedAssetTimeline(asset, tmi, regime);
    const row = years.find(y => y.year === targetAbsYear) || years[years.length - 1];
    if (!row) return null;

    const moisCible = targetMonth ? `${targetAbsYear}-${String(targetMonth).padStart(2, '0')}` : String(targetAbsYear);
    const { loyer, vacancePct } = resolveLoyerVacance(asset, moisCible);
    // Même proratisation que computeOwnedAssetTimeline : l'année d'achat ne compte le loyer que
    // depuis moisAchat, cohérent avec row.cfAnnuel (sinon l'impôt reconstruit plus bas — qui
    // absorbe l'écart entre loyersEncaisses et row.cfAnnuel — serait faussé).
    const moisPossedeAnnee = targetMonth ? 1 : (targetAbsYear === anneeAchat ? (13 - moisAchat) : 12);
    const loyerBrut = loyer * moisPossedeAnnee;
    const vacanceEuros = loyerBrut * (vacancePct / 100);
    const loyersEncaisses = loyerBrut - vacanceEuros;

    const annualEntries = (post.chargesAnnuelles || []).filter(e => e.annee <= targetAbsYear).sort((a, b) => b.annee - a.annee);
    const chargesEntry = annualEntries[0] || null;
    const taxeFonciereAnnuelle = chargesEntry ? (chargesEntry.taxeFonciere ?? post.taxeFonciere ?? 0) : (post.taxeFonciere ?? 0);
    const gestionPct = chargesEntry ? (chargesEntry.gestionLocative ?? post.gestionLocative ?? 0) : (post.gestionLocative ?? 0);
    const assurancePNOAnnuelle = chargesEntry ? (chargesEntry.assurancePNO ?? post.assurancePNO ?? 0) : (post.assurancePNO ?? 0);
    const chargesCoproMensuelle = chargesEntry ? (chargesEntry.chargesCopro ?? post.chargesCopro ?? 0) : (post.chargesCopro ?? 0);
    // moisPossedeAnnee vaut déjà 1 pour un mois ciblé (ligne ci-dessus) ou (13-moisAchat)/12 sur
    // l'année d'achat, une seule formule couvre donc les deux cas — sans ça, taxe foncière/PNO/copro
    // en année pleine contre un loyer proratisé creusait artificiellement charges/impôts/CF sur
    // l'année d'achat (même bug que computeOwnedAssetTimeline/computeCompteResultat, corrigé ensemble).
    const taxeFonciere = taxeFonciereAnnuelle * moisPossedeAnnee / 12;
    const assurancePNO = assurancePNOAnnuelle * moisPossedeAnnee / 12;
    const chargesCoproTotal = chargesCoproMensuelle * moisPossedeAnnee;
    const gestion = loyersEncaisses * (gestionPct / 100);
    const charges = taxeFonciere + chargesCoproTotal + assurancePNO + gestion;

    // Seuls les frais payés cash entrent dans cette ligne affichée : ceux financés par le crédit
    // (financeParCredit) sont déjà dans « Mensualités crédit » ci-dessous (voir
    // computeOwnedAssetTimeline, dont row.cfAnnuel est la référence ici) — les compter aussi ici
    // les décompterait deux fois et romprait la reconstruction loyers-charges-travaux-impôts=CF.
    const travauxAnnee = (post.travaux || []).filter(t => {
        if (!t.date || !t.montant || t.financeParCredit) return false;
        const d = new Date(t.date);
        return targetMonth
            ? d.getFullYear() === targetAbsYear && d.getMonth() + 1 === targetMonth
            : d.getFullYear() === targetAbsYear;
    });
    const travauxTotal = travauxAnnee.reduce((s, t) => s + t.montant, 0);

    const montant = credit.montant || 0;
    const nMois = (credit.duree || 0) * 12;
    // Détail crédit de l'année (ou du mois) ciblé, lu directement dans le planning d'amortissement
    // (source de vérité unique pour interets/capital/assurance) — mensualiteCredit = leur somme, ce
    // qui reste exact même pour une année partielle (crédit démarré/soldé en cours d'année)
    // contrairement à un ancien calcul en « mensualité fixe × 12 ». interetsAnnee/capitalAnnee/
    // assuranceAnnee sont aussi utilisés tels quels par le camembert des dépenses (owned-portfolio.js).
    let mensualiteCredit = 0;
    let interetsAnnee = 0, capitalAnnee = 0, assuranceAnnee = 0;
    if (montant > 0 && nMois > 0) {
        const { schedule, scheduleMonthly } = computeAmortizationSchedule(montant, credit.taux || 0, credit.duree || 0, asset.dateAchat, credit.assurance || 0, credit.assuranceMode);
        const targetRow = targetMonth
            ? scheduleMonthly.find(r => r.annee === targetAbsYear && r.mois === targetMonth)
            : schedule.find(r => r.annee === targetAbsYear);
        if (targetRow) {
            interetsAnnee = targetRow.interets;
            capitalAnnee = targetRow.capital;
            assuranceAnnee = targetRow.assurance;
            mensualiteCredit = interetsAnnee + capitalAnnee + assuranceAnnee;
        }
    }

    const impots = targetMonth
        ? (computeCFBreakdown(asset, tmi, regime, targetYear, null)?.impots || 0) / 12
        : loyersEncaisses - mensualiteCredit - charges - travauxTotal - row.cfAnnuel;
    const cfNetNet = targetMonth
        ? loyersEncaisses - mensualiteCredit - charges - travauxTotal - impots
        : row.cfAnnuel;

    return {
        loyerBrut: Math.round(loyerBrut),
        vacanceEuros: Math.round(vacanceEuros),
        loyersEncaisses: Math.round(loyersEncaisses),
        charges: Math.round(charges),
        travaux: Math.round(travauxTotal),
        creditDetail: {
            interets: Math.round(interetsAnnee),
            capital: Math.round(capitalAnnee),
            assurance: Math.round(assuranceAnnee)
        },
        chargesDetail: {
            taxeFonciere: Math.round(taxeFonciere),
            chargesCopro: Math.round(chargesCoproTotal),
            assurancePNO: Math.round(assurancePNO),
            gestion: Math.round(gestion)
        },
        mensualiteCredit: Math.round(mensualiteCredit),
        impots: Math.round(impots),
        cfNetNet: Math.round(cfNetNet)
    };
}

export function computeRegimeComparison(asset, tmi, targetYears = [1, 3, 5, 10]) {
    const regimes = ['micro-foncier', 'reel', 'sci-is'];
    const { annee: anneeAchat } = parseDateAchat(asset.dateAchat);
    const result = {};
    for (const regime of regimes) {
        const { years } = computeOwnedAssetTimeline(asset, tmi, regime);
        result[regime] = {};
        for (const yr of targetYears) {
            const absYear = anneeAchat + yr - 1;
            const row = years.find(y => y.year === absYear) || (yr > 1 ? years[years.length - 1] : null);
            result[regime][yr] = row ? Math.round(row.cfAnnuel) : null;
        }
    }
    // Identifier le régime optimal par année cible
    const optimal = {};
    for (const yr of targetYears) {
        let bestRegime = null, bestCF = -Infinity;
        for (const regime of regimes) {
            const cf = result[regime][yr];
            if (cf !== null && cf > bestCF) { bestCF = cf; bestRegime = regime; }
        }
        optimal[yr] = bestRegime;
    }
    return { byRegime: result, optimal };
}

export function computeCapaciteEmprunt(mensualiteMax, dureeAns, tauxPct, apport) {
    const r = (tauxPct / 100) / 12;
    const n = dureeAns * 12;
    let montantEmpruntable = 0;
    if (r > 0 && n > 0) montantEmpruntable = mensualiteMax * (1 - Math.pow(1 + r, -n)) / r;
    else if (n > 0) montantEmpruntable = mensualiteMax * n;
    const budget = montantEmpruntable + apport;
    const prixAchatMax = Math.round(budget / 1.08); // frais notaire ~8%
    return { montantEmpruntable: Math.round(montantEmpruntable), prixAchatMax };
}

export function getOptimalRegime(asset, tmi) {
    const scenarios = asset.scenarios || [];
    const sc = scenarios.find(s => s.id === 'realiste') || scenarios.find(s => s.nom?.toLowerCase().includes('éaliste')) || scenarios[0];
    const vars = sc?.variables || {};
    const regimes = ['micro-foncier', 'reel', 'sci-is'];
    const results = regimes.map(r => ({
        regime: r,
        cf: computeOwnedAssetCF(asset, { ...vars, regime: r }, tmi).cfNetNet
    }));
    const optimal = results.reduce((best, cur) => cur.cf > best.cf ? cur : best, results[0]);
    return { optimal: optimal?.regime, optimalCF: optimal?.cf, allCFs: Object.fromEntries(results.map(r => [r.regime, r.cf])) };
}

export function computeRevenusLocatifsBruts(assets) {
    return assets.reduce((sum, a) => {
        const { loyer, vacancePct: vacance } = resolveLoyerVacance(a);
        return sum + loyer * 12 * (1 - vacance / 100);
    }, 0);
}

// computeTresorerieReelle a été retiré avec le suivi mensuel des loyers encaissés
// (spec 2026-07-27) : il ne se calculait qu'à partir de postAchat.loyersReels.

export function computeCompteResultat(asset, annee, tmi, regime) {
    const acq = asset.acquisition || {};
    const post = asset.postAchat || {};
    const credit = acq.credit || {};
    const { loyer, vacancePct } = resolveLoyerVacance(asset, String(annee));
    // Même proratisation que computeCFBreakdown/computeOwnedAssetTimeline : l'année d'achat ne
    // compte le loyer que depuis moisAchat (13 - moisAchat mois), pas une année pleine — sinon
    // les recettes déclarées ici (et dans computeDeclaration2044, qui en dépend) sont surestimées
    // pour tout bien acheté en cours d'année, alors que interetsAnnee/capitalRembourse ci-dessous
    // sont déjà correctement proratisés via computeAmortizationSchedule.
    const { annee: anneeAchat, mois: moisAchat } = parseDateAchat(asset.dateAchat);
    const moisPossedeAnnee = annee === anneeAchat ? (13 - moisAchat) : 12;
    const loyersTheoriques = loyer * moisPossedeAnnee;
    const vacanceEst = loyersTheoriques * (vacancePct / 100);
    const recettesBrutes = loyersTheoriques - vacanceEst;

    const { schedule } = computeAmortizationSchedule(credit.montant || 0, credit.taux || 0, credit.duree || 0, asset.dateAchat, credit.assurance || 0, credit.assuranceMode);
    const yearRow = schedule.find(r => r.annee === annee);
    const interetsAnnee = yearRow?.interets || 0;
    const capitalRembourse = yearRow?.capital || 0;
    const assuranceAnnee = yearRow?.assurance || 0;

    const chargesEntries = (post.chargesAnnuelles || []).filter(e => e.annee <= annee).sort((a, b) => b.annee - a.annee);
    const ce = chargesEntries[0] || null;
    const gestionPct = ce ? (ce.gestionLocative ?? post.gestionLocative ?? 0) : (post.gestionLocative ?? 0);
    // Taxe foncière/PNO (montants annuels) et charges copro (mensuelles) proratisées sur l'année
    // d'achat comme le loyer ci-dessus (moisPossedeAnnee) : sinon un bien acheté en cours d'année se
    // voit imputer une taxe foncière/PNO en année pleine contre seulement quelques mois de loyer,
    // creusant artificiellement le résultat/CF affiché de l'année d'achat (bug signalé par
    // l'utilisateur sur un cas réel : ramène "70 rue du mouton" de -248€ à +227€ sur 5 mois de
    // détention, cohérent avec le taux courant de computeOwnedAssetCF).
    const taxeFonciere = (ce ? (ce.taxeFonciere ?? post.taxeFonciere ?? 0) : (post.taxeFonciere ?? 0)) * moisPossedeAnnee / 12;
    const assurancePNO = (ce ? (ce.assurancePNO ?? post.assurancePNO ?? 0) : (post.assurancePNO ?? 0)) * moisPossedeAnnee / 12;
    const chargesCopro = (ce ? (ce.chargesCopro ?? post.chargesCopro ?? 0) : (post.chargesCopro ?? 0)) * moisPossedeAnnee;
    const gestionLocative = recettesBrutes * (gestionPct / 100);
    const travauxAnneeAll = (post.travaux || []).filter(t => t.date && t.montant && new Date(t.date).getFullYear() === annee);
    const travauxDed = travauxAnneeAll.filter(t => t.tag === 'deductible').reduce((s, t) => s + (t.montant || 0), 0);
    // Part de travauxDed financée par le crédit principal (déjà remboursée via capitalRembourse
    // ci-dessous, pas une dépense cash cette année) et frais non déductibles payés cash (aucun
    // effet fiscal, mais un vrai décaissement absent des cases ci-dessus) — utilisés uniquement
    // pour corriger cfReel plus bas, chargesDeductibles reste inchangé pour le calcul de l'impôt.
    const travauxDedFinance = travauxAnneeAll.filter(t => t.tag === 'deductible' && t.financeParCredit).reduce((s, t) => s + (t.montant || 0), 0);
    const travauxCashNonDed = travauxAnneeAll.filter(t => t.tag !== 'deductible' && !t.financeParCredit).reduce((s, t) => s + (t.montant || 0), 0);

    const chargesDeductibles = interetsAnnee + assuranceAnnee + taxeFonciere + chargesCopro + assurancePNO + gestionLocative + travauxDed;
    const tauxGlobal = (tmi / 100) + CSG_CRDS_RATE;

    let resultatFoncier, baseImposable, impots;
    if (regime === 'micro-foncier') {
        baseImposable = recettesBrutes * 0.7;
        impots = Math.max(0, baseImposable * tauxGlobal);
        resultatFoncier = recettesBrutes - chargesDeductibles;
    } else if (regime === 'reel') {
        resultatFoncier = recettesBrutes - chargesDeductibles;
        if (resultatFoncier > 0) {
            baseImposable = resultatFoncier;
            impots = resultatFoncier * tauxGlobal;
        } else {
            baseImposable = 0;
            const defHorsInt = Math.min(0, recettesBrutes - (chargesDeductibles - interetsAnnee));
            impots = -(Math.min(10700, Math.abs(defHorsInt)) * (tmi / 100));
        }
    } else {
        resultatFoncier = recettesBrutes - chargesDeductibles;
        baseImposable = Math.max(0, resultatFoncier);
        impots = baseImposable > 0
            ? Math.min(baseImposable, 42500) * 0.15 + Math.max(0, baseImposable - 42500) * 0.25
            : 0;
    }

    const resultatNet = resultatFoncier - impots;
    // cfReel : on retranche capitalRembourse (remboursement du prêt, dette réelle de l'année) puis
    // on corrige pour les travaux — rajouter la part déductible financée (déjà comptée dans
    // resultatNet mais pas un décaissement cette année, voir travauxDedFinance) et retrancher les
    // frais non déductibles payés cash (aucun effet sur resultatNet, mais un vrai décaissement).
    const cfReel = Math.round(resultatNet - capitalRembourse + travauxDedFinance - travauxCashNonDed);

    return {
        annee, regime,
        recettesBrutes: Math.round(recettesBrutes),
        loyersTheoriques: Math.round(loyersTheoriques),
        vacanceEst: Math.round(vacanceEst),
        interetsAnnee: Math.round(interetsAnnee),
        assuranceAnnee: Math.round(assuranceAnnee),
        taxeFonciere: Math.round(taxeFonciere),
        chargesCopro: Math.round(chargesCopro),
        assurancePNO: Math.round(assurancePNO),
        gestionLocative: Math.round(gestionLocative),
        travauxDed: Math.round(travauxDed),
        chargesDeductibles: Math.round(chargesDeductibles),
        resultatFoncier: Math.round(resultatFoncier),
        baseImposable: Math.round(baseImposable),
        impots: Math.round(impots),
        resultatNet: Math.round(resultatNet),
        capitalRembourse: Math.round(capitalRembourse),
        cfReel,
    };
}

// Pré-remplissage indicatif de la déclaration 2044 (foncier réel), à partir des données déjà saisies
// (computeCompteResultat). Mapping de cases vérifié sur la notice officielle 2044-NOT-SD (DGFiP, éd. 2026) :
// 211 loyers bruts, 221 gestion/agence, 222 forfait frais de gestion (20€/local, valeur fixe légale),
// 223 assurance PNO, 224 travaux déductibles, 227 taxe foncière, 229 charges de copropriété,
// 250 intérêts d'emprunt + assurance crédit, 263 résultat par immeuble, 420 résultat total.
// Ceci reste un calcul indicatif — cf. avertissement à afficher côté UI, ne remplace pas un professionnel.
const PLAFOND_DEFICIT_REVENU_GLOBAL = 10700;
const FORFAIT_FRAIS_GESTION_PAR_LOCAL = 20;

export function computeDeclaration2044(assets, annee, tmi) {
    const lignes = assets.map(asset => {
        const cr = computeCompteResultat(asset, annee, tmi, 'reel');
        const nbLocaux = (asset.lots && asset.lots.length) ? asset.lots.length : 1;
        const case211 = cr.recettesBrutes;
        const case221 = cr.gestionLocative;
        const case222 = FORFAIT_FRAIS_GESTION_PAR_LOCAL * nbLocaux;
        const case223 = cr.assurancePNO;
        const case224 = cr.travauxDed;
        const case227 = cr.taxeFonciere;
        const case229 = cr.chargesCopro;
        const case250 = cr.interetsAnnee + cr.assuranceAnnee;
        const chargesHorsInterets = case221 + case222 + case223 + case224 + case227 + case229;
        const case263 = case211 - chargesHorsInterets - case250;
        return {
            assetId: asset.id, nom: asset.nom,
            case211, case221, case222, case223, case224, case227, case229, case250,
            chargesHorsInterets, case263: Math.round(case263),
        };
    });

    const totalRecettes = lignes.reduce((s, l) => s + l.case211, 0);
    const totalInterets = lignes.reduce((s, l) => s + l.case250, 0);
    const totalChargesHorsInterets = lignes.reduce((s, l) => s + l.chargesHorsInterets, 0);
    const case420 = Math.round(totalRecettes - totalChargesHorsInterets - totalInterets);

    let deficit = null;
    if (case420 < 0) {
        const resultatAvantInterets = totalRecettes - totalChargesHorsInterets;
        let imputableRevenuGlobal = 0, reportHorsInterets = 0, reportInterets = 0;
        if (resultatAvantInterets < 0) {
            const deficitHorsInterets = -resultatAvantInterets;
            imputableRevenuGlobal = Math.min(PLAFOND_DEFICIT_REVENU_GLOBAL, deficitHorsInterets);
            reportHorsInterets = Math.max(0, deficitHorsInterets - PLAFOND_DEFICIT_REVENU_GLOBAL);
            reportInterets = totalInterets;
        } else {
            reportInterets = Math.max(0, totalInterets - resultatAvantInterets);
        }
        deficit = {
            totalDeficit: Math.round(-case420),
            imputableRevenuGlobal: Math.round(imputableRevenuGlobal),
            reportFoncier10ans: Math.round(reportHorsInterets + reportInterets),
            plafond: PLAFOND_DEFICIT_REVENU_GLOBAL,
        };
    }

    return {
        annee,
        lignes,
        totalRecettes: Math.round(totalRecettes),
        totalInterets: Math.round(totalInterets),
        totalChargesHorsInterets: Math.round(totalChargesHorsInterets),
        case420,
        deficit,
    };
}

// Revenu foncier imposable du portefeuille pour l'onglet Impôt — ce qui vient réellement s'ajouter
// (ou se retrancher) au revenu global du foyer selon le régime actif :
// - micro-foncier : 70 % des loyers bruts, jamais de déficit possible
// - réel : résultat net (computeDeclaration2044), déficit plafonné à 10 700 €/an imputable sur le
//   revenu global (le surplus est reporté sur les revenus fonciers des 10 années suivantes, pas pris
//   en compte ici)
// - sci-is : taxé à l'IS, hors périmètre de l'IR du foyer — retourné à part (isTotal)
export function computeRevenuFoncierPortefeuille(assets, annee, tmi, regime) {
    if (!assets.length) {
        return { revenuFoncierImposable: 0, lignes: [], isTotal: 0, deficit: null };
    }

    if (regime === 'sci-is') {
        // Pas de calcul chiffré ici : computeCompteResultat ne déduit pas l'amortissement comptable
        // de l'immeuble pour ce régime (cf. openDeclarationFiscaleModal, owned-portfolio.js) — un total
        // d'IS affiché serait faux. Le résultat SCI-IS est de toute façon hors périmètre de l'IR du foyer.
        return { revenuFoncierImposable: 0, lignes: [], isTotal: null, deficit: null };
    }

    if (regime === 'micro-foncier') {
        const lignes = assets.map(a => computeCompteResultat(a, annee, tmi, 'micro-foncier'));
        const revenuFoncierImposable = lignes.reduce((s, l) => s + l.baseImposable, 0);
        return { revenuFoncierImposable: Math.round(revenuFoncierImposable), lignes, isTotal: 0, deficit: null };
    }

    const decl = computeDeclaration2044(assets, annee, tmi);
    const revenuFoncierImposable = decl.case420 >= 0 ? decl.case420 : -(decl.deficit?.imputableRevenuGlobal || 0);
    return { revenuFoncierImposable, lignes: decl.lignes, isTotal: 0, deficit: decl.deficit };
}

// Historique des déficits fonciers reportables, calculé automatiquement depuis les données déjà
// saisies (loyers, charges, crédit) plutôt que saisi à la main — l'utilisateur n'a plus à savoir
// lui-même quoi renseigner. Rejoue chaque année depuis l'achat en simulant le régime réel (seul
// régime où le déficit foncier existe, même si le bien est actuellement suivi en micro-foncier ou
// SCI-IS — même convention que le reste de l'app, qui applique un seul régime sur toute la
// timeline). Une année déficitaire crée une ligne ; une année bénéficiaire consomme les lignes
// existantes par ordre d'ancienneté (FIFO), comme l'exige la règle des 10 ans (art. 156 I 3° CGI).
//
// Limite assumée : ne connaît que ce qui est saisi dans l'app depuis l'année d'achat — un déficit
// réel antérieur à la saisie du bien (ou basé sur des charges non ressaisies rétroactivement)
// n'est pas repris. Affiché comme avertissement dans l'UI (owned-portfolio.js).
export function computeDeficitFoncierHistorique(asset, tmi) {
    const currentYear = new Date().getFullYear();
    const { years } = computeOwnedAssetTimeline(asset, tmi, 'reel');
    const PLAFOND = PLAFOND_DEFICIT_REVENU_GLOBAL;
    const EXPIRATION_ANS = 10;

    const lignes = []; // { annee, montantInitial, utilise } — ordre chronologique = ordre FIFO
    for (const row of years) {
        if (row.year > currentYear) break; // pas d'années projetées, seulement le vécu

        const chargesAnnuelles = row.chargesAnneeTax + row.assuranceAnnee;
        const revenusNets = row.loyersAnnuels - chargesAnnuelles - row.interetsAnnee;

        if (revenusNets > 0) {
            let restantAAbsorber = revenusNets;
            for (const ligne of lignes) {
                if (restantAAbsorber <= 0) break;
                if (row.year - ligne.annee >= EXPIRATION_ANS) continue; // déficit déjà expiré cette année-là
                const disponible = ligne.montantInitial - ligne.utilise;
                if (disponible <= 0) continue;
                const absorbe = Math.min(disponible, restantAAbsorber);
                ligne.utilise += absorbe;
                restantAAbsorber -= absorbe;
            }
        } else {
            const soldeHorsInterets = row.loyersAnnuels - chargesAnnuelles;
            const montantCree = soldeHorsInterets < 0
                ? Math.max(0, Math.abs(soldeHorsInterets) - PLAFOND) + row.interetsAnnee
                : Math.abs(revenusNets);
            if (montantCree > 0) lignes.push({ annee: row.year, montantInitial: montantCree, utilise: 0 });
        }
    }

    const lignesFormatees = lignes.map(l => {
        const anciennete = currentYear - l.annee;
        return {
            annee: l.annee,
            montantInitial: Math.round(l.montantInitial),
            utilise: Math.round(l.utilise),
            restant: Math.round(Math.max(0, l.montantInitial - l.utilise)),
            expire: l.annee + EXPIRATION_ANS,
            expired: anciennete >= EXPIRATION_ANS
        };
    });
    const stockTotal = lignesFormatees.filter(l => !l.expired).reduce((s, l) => s + l.restant, 0);

    return { lignes: lignesFormatees.sort((a, b) => b.annee - a.annee), stockTotal: Math.round(stockTotal) };
}

export function computePortfolioAlerts(assets, tmi, regime, revenusMensuels) {
    const REGIME_LABELS = { 'micro-foncier': 'Micro-foncier', 'reel': 'Foncier réel', 'sci-is': 'SCI-IS' };
    const alerts = [];
    const now = new Date();

    const revenusBruts = computeRevenusLocatifsBruts(assets);
    if (revenusBruts > 15000 && regime === 'micro-foncier') {
        alerts.push({ type: 'fiscal', severity: 'error', msg: `Revenus fonciers ${Math.round(revenusBruts).toLocaleString('fr-FR')} €/an — Micro-foncier interdit (plafond 15 000 €)` });
    }

    const endettement = computeEndettementGlobal(assets, revenusMensuels);
    if (endettement.tauxEndettement > 35) {
        alerts.push({ type: 'dette', severity: 'warning', msg: `Taux d'endettement ${endettement.tauxEndettement.toFixed(1)} % — dépasse le seuil HCSF (35 %)` });
    }

    for (const asset of assets) {
        const sc = (asset.scenarios || []).find(s => s.id === 'realiste') || (asset.scenarios || [])[0];
        const r = computeOwnedAssetCF(asset, { ...(sc?.variables || {}), regime }, tmi);

        if (r.cfNetNet < -100) {
            alerts.push({ type: 'cf', severity: 'error', assetId: asset.id, msg: `${asset.nom} — CF négatif : ${Math.round(r.cfNetNet).toLocaleString('fr-FR')} €/mois` });
        }
        if (r.dscr > 0 && r.dscr < 1) {
            alerts.push({ type: 'dscr', severity: 'error', assetId: asset.id, msg: `${asset.nom} — DSCR ${r.dscr.toFixed(2)} : remboursement non couvert par les loyers` });
        }

        const credit = asset.acquisition?.credit || {};
        if ((credit.duree || 0) > 0) {
            const { annee: anneeAchatCredit, mois: moisAchatCredit } = parseDateAchat(asset.dateAchat);
            const finAbsMonth = (anneeAchatCredit * 12 + (moisAchatCredit - 1)) + (credit.duree || 0) * 12;
            const moisRestants = finAbsMonth - (now.getFullYear() * 12 + now.getMonth());
            if (moisRestants > 0 && moisRestants <= 12) {
                alerts.push({ type: 'credit', severity: 'info', assetId: asset.id, msg: `${asset.nom} — Crédit se termine dans ${Math.round(moisRestants)} mois : libération de ${Math.round(r.mensualiteTotale).toLocaleString('fr-FR')} €/mois` });
            }
        }

        if (!(asset.acquisition?.valeurEstimee > 0)) {
            alerts.push({ type: 'patrimoine', severity: 'info', assetId: asset.id, msg: `${asset.nom} — Valeur estimée non renseignée (patrimoine incomplet)` });
        }

        if ((asset.acquisition?.prix || 0) > 0) {
            const opt = getOptimalRegime(asset, tmi);
            if (opt.optimal && opt.optimal !== regime) {
                const gain = (opt.optimalCF || 0) - (opt.allCFs[regime] || 0);
                if (gain > 20) {
                    const caveat = opt.optimal === 'sci-is' ? ' (hors frais de structure et fiscalité de sortie)' : '';
                    alerts.push({ type: 'fiscal-opt', severity: 'info', assetId: asset.id, msg: `${asset.nom} — ${REGIME_LABELS[opt.optimal]} serait +${Math.round(gain)} €/mois vs ${REGIME_LABELS[regime]}${caveat}` });
                }
            }
        }

        // Loyer inchangé depuis plus de 12 mois (indexation IRL potentiellement en retard).
        // Mesuré sur la dernière prise d'effet de postAchat.loyerHistorique.
        const historique = asset.postAchat?.loyerHistorique || [];
        if (historique.length) {
            const derniere = [...historique].sort((a, b) => a.mois.localeCompare(b.mois)).at(-1);
            const [anneeMaj, moisMaj] = String(derniere.mois).split('-').map(Number);
            if (anneeMaj) {
                const moisEcoules = (now.getFullYear() - anneeMaj) * 12 + (now.getMonth() + 1 - (moisMaj || 1));
                if (moisEcoules >= 12) {
                    alerts.push({ type: 'loyer-non-revise', severity: 'info', assetId: asset.id, msg: `${asset.nom} — Loyer inchangé depuis ${moisEcoules} mois : vérifier la révision (IRL)` });
                }
            }
        }

        // Déficit foncier reportable proche de son expiration (10 ans), calculé automatiquement
        // (computeDeficitFoncierHistorique) plutôt que lu depuis une saisie manuelle. Seuil aligné
        // sur celui de la table "Déficits fonciers reportables" (owned-portfolio.js,
        // renderAccordionPostAchat) qui marque l'entrée "Expiré" dès anciennete >= 10 — l'alerte ne
        // doit donc pas se déclencher à anciennete === 10, sous peine d'annoncer "expire dans 0 an"
        // pour une ligne déjà affichée comme expirée juste en dessous.
        for (const d of computeDeficitFoncierHistorique(asset, tmi).lignes) {
            const anciennete = now.getFullYear() - d.annee;
            if (d.restant > 0 && anciennete >= 8 && anciennete <= 9) {
                const anneesRestantes = 10 - anciennete;
                alerts.push({ type: 'deficit-expire', severity: 'warning', assetId: asset.id, msg: `${asset.nom} — Déficit foncier ${d.annee} : ${d.restant.toLocaleString('fr-FR')} € non imputés, expire dans ${anneesRestantes} an${anneesRestantes > 1 ? 's' : ''}` });
            }
        }

        // Frais/travaux non classifiés (tag à définir)
        const nbAClassifier = (asset.postAchat?.travaux || []).filter(t => t.tag === 'a-classifier').length;
        if (nbAClassifier > 0) {
            alerts.push({ type: 'travaux-a-classer', severity: 'info', assetId: asset.id, msg: `${asset.nom} — ${nbAClassifier} frais/travaux à classer (déductible ou non)` });
        }
    }

    return alerts;
}

export function computeSimulationTravaux(asset, montantTravaux, annee, deductible, tmi, regime) {
    const acq = asset.acquisition || {};
    const post = asset.postAchat || {};
    const credit = acq.credit || {};
    const { loyer, vacancePct } = resolveLoyerVacance(asset);
    // Même proratisation que computeOwnedAssetTimeline/computeCompteResultat : l'année d'achat ne
    // compte le loyer que depuis moisAchat, pas une année pleine — sinon la simulation surestime les
    // recettes de l'année d'achat alors qu'interetsAnnee/assuranceAnnee ci-dessous (tirés de
    // l'échéancier réel) sont déjà correctement partiels sur cette même année.
    const { annee: anneeAchat, mois: moisAchat } = parseDateAchat(asset.dateAchat);
    const moisPossedeAnnee = annee === anneeAchat ? (13 - moisAchat) : 12;
    const loyersAnnuels = loyer * moisPossedeAnnee * (1 - vacancePct / 100);
    const { schedule } = computeAmortizationSchedule(credit.montant || 0, credit.taux || 0, credit.duree || 0, asset.dateAchat, credit.assurance || 0, credit.assuranceMode);
    const yearRow = schedule.find(r => r.annee === annee);
    const interetsAnnee = yearRow?.interets || 0;

    // Proratisées comme le loyer ci-dessus (moisPossedeAnnee) — même correctif que
    // computeOwnedAssetTimeline/computeCompteResultat/computeCFBreakdown.
    const taxeFonciere = (post.taxeFonciere ?? 0) * moisPossedeAnnee / 12;
    const chargesCopro = (post.chargesCopro ?? 0) * moisPossedeAnnee;
    const assurancePNO = (post.assurancePNO ?? 0) * moisPossedeAnnee / 12;
    const gestionLocative = loyersAnnuels * ((post.gestionLocative ?? 0) / 100);
    const assuranceAnnee = yearRow?.assurance || 0;
    const chargesBase = taxeFonciere + chargesCopro + assurancePNO + gestionLocative + assuranceAnnee;

    let deficitCree = 0, economieFiscale3ans = 0;
    const applicable = deductible && regime === 'reel';

    if (applicable) {
        const totalChargesAvecTravaux = chargesBase + interetsAnnee + montantTravaux;
        const resultatFoncier = loyersAnnuels - totalChargesAvecTravaux;
        if (resultatFoncier < 0) {
            deficitCree = Math.abs(resultatFoncier);
            economieFiscale3ans = Math.min(10700, deficitCree) * (tmi / 100);
        }
    }

    const sc = (asset.scenarios || []).find(s => s.id === 'realiste') || (asset.scenarios || [])[0];
    const vars = sc?.variables || {};
    const cfBase = computeOwnedAssetCF(asset, { ...vars, regime }, tmi);
    const impactCFMois = deductible && applicable ? -(montantTravaux / 12) + (economieFiscale3ans / 36) : -(montantTravaux / 12);
    const nouveauCFMois = cfBase.cfNetNet + impactCFMois;

    return { montantTravaux, deductible, regime, deficitCree: Math.round(deficitCree), economieFiscale3ans: Math.round(economieFiscale3ans), applicable, impactCFMois: Math.round(impactCFMois), cfBase: Math.round(cfBase.cfNetNet), nouveauCFMois: Math.round(nouveauCFMois) };
}
