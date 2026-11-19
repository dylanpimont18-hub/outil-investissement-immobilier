export const CSG_CRDS_RATE = 0.172; // Taux CSG+CRDS sur revenus du capital (2024)
// Part de la CSG (6,8 points sur 17,2) assise sur les revenus fonciers imposés au barème, déductible
// du revenu global de l'année SUIVANTE (art. 154 quinquies CGI). L'ignorer surestimait l'impôt
// d'environ 160 €/an sur 8 000 € de revenu foncier à 30 % de TMI.
export const CSG_DEDUCTIBLE_RATE = 0.068;

const REGIME_LABELS = {
    'micro-foncier': 'Micro-foncier',
    'reel': 'Foncier Réel',
    'sci-is': 'SCI à l\'IS'
};

function normaliserAdultes(adults) {
    return Math.min(2, Math.max(1, Math.round(Number(adults) || 2)));
}
function normaliserEnfants(enfants) {
    return Math.max(0, Math.round(Number(enfants) || 0));
}

// Format décimal français partagé par toute l'interface (audit 2026-11-18, A1) : « 0,92 », jamais
// « 0.92 ». Pur (pas d'Intl ni de DOM) pour rester utilisable ici, dans pdf.js et dans les tests.
export function formatDecimalFr(value, digits = 2) {
    if (!Number.isFinite(value)) return '--';
    return value.toFixed(digits).replace('.', ',');
}

// Ratios (DSCR, GRM…) : deux décimales.
export function formatRatioFr(value) {
    return formatDecimalFr(value, 2);
}

// Un adulte seul qui a au moins un enfant à charge reçoit une demi-part supplémentaire (art. 194 II
// CGI, « case T »). Sans elle, 1 adulte / 2 enfants à 45 000 € était imposé sur 2 parts au lieu de
// 2,5 : TMI de 30 % au lieu de 11 %. Le profil du foyer ne connaît qu'adultes/enfants : un adulte
// seul est réputé vivre seul (cas de loin le plus fréquent), comme dans Spark Cash-Flow.
export function estParentIsole(adults, enfants) {
    return normaliserAdultes(adults) === 1 && normaliserEnfants(enfants) >= 1;
}

export function getHouseholdTaxParts(adults = 2, enfants = 0) {
    const adultCount = normaliserAdultes(adults);
    const childCount = normaliserEnfants(enfants);

    let parts = adultCount;
    if (childCount === 1) parts += 0.5;
    else if (childCount >= 2) parts += 1.0 + (childCount - 2);
    if (estParentIsole(adultCount, childCount)) parts += 0.5;
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
// le 2026-07-29 : l'avantage procuré par chaque demi-part supplémentaire est plafonné à 1 807 €. Le
// parent isolé (case T, art. 194 II) a un plafond propre de 4 262 € pour la part entière que forment
// sa demi-part et celle de son premier enfant ; les demi-parts suivantes retombent au plafond commun.
// Invalidité et veuvage ne sont pas modélisés (le profil du foyer ne les distingue pas).
const PLAFOND_PAR_DEMI_PART_ENFANT = 1807;
const PLAFOND_PARENT_ISOLE = 4262;

function plafondQuotientFamilial(adultCount, childCount, parts) {
    const demiPartsSup = Math.max(0, (parts - adultCount) * 2);
    if (demiPartsSup === 0) return 0;
    if (estParentIsole(adultCount, childCount)) {
        return PLAFOND_PARENT_ISOLE + Math.max(0, demiPartsSup - 2) * PLAFOND_PAR_DEMI_PART_ENFANT;
    }
    return demiPartsSup * PLAFOND_PAR_DEMI_PART_ENFANT;
}

// Accepte la forme objet { adults, children } ou, en héritage, un simple nombre d'enfants.
function lireFoyer(foyer) {
    const hasObjectShape = typeof foyer === 'object' && foyer !== null;
    return {
        adults: normaliserAdultes(hasObjectShape ? foyer.adults : 2),
        children: normaliserEnfants(hasObjectShape ? foyer.children : foyer),
    };
}

// TMI réellement supportée : dès que le plafonnement du quotient familial s'applique, chaque euro
// supplémentaire est taxé au taux du quotient calculé sur les seules parts d'adultes. Un couple à
// 80 000 € avec deux enfants voyait s'afficher 11 % là où son taux marginal réel est de 30 %.
// La TMI ne sert plus qu'à l'affichage : l'impôt se calcule par différence de deux impôts complets
// (impotRevenuDifferentiel).
export function calculateTMI(revenus, foyer = 0) {
    const { adults, children } = lireFoyer(foyer);
    const parts = getHouseholdTaxParts(adults, children);
    const revenu = Math.max(0, Number(revenus) || 0);
    const avantage = appliquerBaremeIR(revenu, adults).irBrut - appliquerBaremeIR(revenu, parts).irBrut;
    const plafond = plafondQuotientFamilial(adults, children, parts);
    const partsRetenues = plafond > 0 && avantage > plafond ? adults : parts;
    const quotient = revenu / partsRetenues;
    const bracket = BAREME_IR.find(b => quotient <= b.seuil);
    return bracket ? bracket.taux : 45;
}

// Applique le barème progressif tranche par tranche à un quotient (revenu ÷ parts) et remultiplie
// par le nombre de parts fourni — factorisé pour être appelable deux fois par liquiderIR (une fois
// avec les parts complètes, une fois avec les parts de base pour le plafonnement).
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

// IR net du foyer — barème, plafonnement du quotient familial, décote — NON arrondi. Base commune de
// computeImpotFoyer (affichage) et de impotRevenuDifferentiel (impôt des revenus locatifs).
function liquiderIR(revenuGlobal, adults, children) {
    const parts = getHouseholdTaxParts(adults, children);
    const complet = appliquerBaremeIR(revenuGlobal, parts);
    let irBrut = complet.irBrut;
    let plafonnementQF = null;
    if (parts > adults) {
        const base = appliquerBaremeIR(revenuGlobal, adults);
        const avantage = base.irBrut - complet.irBrut;
        const plafond = plafondQuotientFamilial(adults, children, parts);
        const applique = avantage > plafond;
        if (applique) irBrut = base.irBrut - plafond;
        plafonnementQF = { applique, avantage, plafond, irBrutSansPlafonnement: complet.irBrut };
    }
    const decoteParams = adults >= 2 ? DECOTE_COUPLE : DECOTE_CELIBATAIRE;
    const decote = irBrut < decoteParams.seuil ? Math.max(0, decoteParams.base - irBrut * DECOTE_TAUX) : 0;
    return { parts, complet, irBrut, plafonnementQF, decote, irNet: Math.max(0, irBrut - decote) };
}

// Calcule l'IR au barème progressif tranche par tranche (pas juste la TMI appliquée en taux plat),
// avec plafonnement du quotient familial (parent isolé compris) et décote — utilisé par l'onglet
// Impôt pour reconstituer le vrai montant à payer.
export function computeImpotFoyer(revenuSalarial, revenuFoncierImposable, foyer = {}) {
    const { adults, children } = lireFoyer(foyer);
    const revenuGlobal = Math.max(0, (Number(revenuSalarial) || 0) + (Number(revenuFoncierImposable) || 0));
    const ir = liquiderIR(revenuGlobal, adults, children);
    const irNet = Math.max(0, Math.round(ir.irBrut - ir.decote));
    const psFoncier = Math.round(Math.max(0, Number(revenuFoncierImposable) || 0) * CSG_CRDS_RATE);

    return {
        revenuSalarial: Math.round(Number(revenuSalarial) || 0),
        revenuFoncierImposable: Math.round(Number(revenuFoncierImposable) || 0),
        revenuGlobal: Math.round(revenuGlobal),
        parts: ir.parts,
        quotient: Math.round(ir.complet.quotient),
        tranches: ir.complet.tranches,
        plafonnementQF: ir.plafonnementQF && {
            applique: ir.plafonnementQF.applique,
            avantage: Math.round(ir.plafonnementQF.avantage),
            plafond: Math.round(ir.plafonnementQF.plafond),
            irBrutSansPlafonnement: Math.round(ir.plafonnementQF.irBrutSansPlafonnement),
        },
        irBrut: Math.round(ir.irBrut),
        decote: Math.round(ir.decote),
        irNet,
        psFoncier,
        total: irNet + psFoncier,
    };
}

// Coût en IR d'une base imposable ajoutée au revenu du foyer : la DIFFÉRENCE de deux impôts complets
// (barème tranche par tranche, plafonnement, décote), jamais la base × TMI. Le taux unique ignorait
// la décote et les franchissements de tranche : pour un couple à 45 000 €, 6 930 € de revenu foncier
// coûtent 1 107 € d'IR, pas 762 €. Une base négative (déficit imputé sur le revenu global) donne
// l'économie d'impôt, mesurée de la même façon. Hors prélèvements sociaux.
// `foyer` : { revenus, adults, children }.
export function impotRevenuDifferentiel(foyer, base) {
    const { adults, children } = lireFoyer(foyer);
    const revenus = Math.max(0, Number(foyer?.revenus) || 0);
    const apres = Math.max(0, revenus + (Number(base) || 0));
    return liquiderIR(apres, adults, children).irNet - liquiderIR(revenus, adults, children).irNet;
}

// ─── Moteur fiscal annuel d'un revenu locatif ───────────────────────────────
// Une seule implémentation, partagée par l'étude (computeAnnualTaxEstimate) et les biens détenus
// (computeImpotAnnuelBien). L'état `etat` passe d'une année à la suivante :
//  - reportFoncier : pile de millésimes { annee, montant } du déficit foncier, imputable sur les
//    revenus fonciers des DIX années suivantes (art. 156 I 3° CGI) : le déficit de l'année A sert
//    encore en A+10 et n'est perdu qu'en A+11. Imputation du plus ancien au plus récent. Un report
//    cumulé sans fin laissait croire à des années d'impôt nul qui n'existent pas ;
//  - reportIS : déficit d'une société à l'IS, reportable sans limite de durée (art. 209 I CGI). Il
//    était purement perdu : une année déficitaire n'allégeait jamais l'IS des années suivantes ;
//  - csgDeductible : CSG déductible née l'année précédente (CSG_DEDUCTIBLE_RATE).
export const DUREE_REPORT_DEFICIT_FONCIER = 10;
export const PLAFOND_MICRO_FONCIER = 15000;

export function etatFiscalInitial() {
    return { reportFoncier: [], reportIS: 0, csgDeductible: 0 };
}

// Les appelants historiques passent un déficit reporté scalaire : on le traite comme un millésime de
// l'année précédente.
function etatDepuisReport(report, annee) {
    if (report && typeof report === 'object') return report;
    const etat = etatFiscalInitial();
    const montant = Number(report) || 0;
    if (montant > 0) etat.reportFoncier.push({ annee: annee - 1, montant });
    return etat;
}

const totalReport = pile => pile.reduce((s, m) => s + m.montant, 0);

// Retire les millésimes prescrits et renvoie le montant perdu, pour pouvoir le montrer.
function purgerReportFoncier(pile, annee) {
    let expire = 0;
    for (let i = pile.length - 1; i >= 0; i--) {
        if (annee - pile[i].annee > DUREE_REPORT_DEFICIT_FONCIER) { expire += pile[i].montant; pile.splice(i, 1); }
    }
    return expire;
}

function imputerReportFoncier(pile, montant) {
    let reste = montant;
    for (const m of pile) {
        if (reste <= 0) break;
        const u = Math.min(m.montant, reste);
        m.montant -= u;
        reste -= u;
    }
    for (let i = pile.length - 1; i >= 0; i--) if (pile[i].montant <= 0.005) pile.splice(i, 1);
    return montant - reste;
}

// IS : 15 % jusqu'à 42 500 € de bénéfice, 25 % au-delà (art. 219 CGI).
export function impotSocieteIS(base) {
    const b = Math.max(0, base);
    return Math.min(b, 42500) * 0.15 + Math.max(0, b - 42500) * 0.25;
}

// Impôt d'une année. `flux` :
//   loyers               recettes de l'année (case 211)
//   chargesHorsInterets  charges déductibles hors case 250, travaux déductibles compris
//   interets             case 250 : intérêts, assurance emprunteur, frais d'emprunt
//   chargesIS            charges retenues en SCI à l'IS (défaut : chargesHorsInterets)
//   amortissementIS      dotation de l'année en SCI à l'IS
// `foyer` : { revenus, adults, children } de CETTE année. `etat` : voir etatFiscalInitial (modifié).
function impotLocatifAnnee(regime, { annee, loyers, chargesHorsInterets, interets, chargesIS = null, amortissementIS = 0 }, foyer, etat) {
    // Barème différentiel sur la base, diminuée de la CSG déductible de l'an passé, puis
    // prélèvements sociaux de l'année ; la CSG déductible de l'année naît de la base.
    const impotSurBase = base => {
        const csgImputee = etat.csgDeductible;
        etat.csgDeductible = Math.max(0, base) * CSG_DEDUCTIBLE_RATE;
        return { impot: impotRevenuDifferentiel(foyer, base - csgImputee) + Math.max(0, base) * CSG_CRDS_RATE, csgImputee };
    };

    if (regime === 'sci-is') {
        // Impôt de la société : ni barème du foyer, ni prélèvements sociaux, ni CSG déductible.
        etat.csgDeductible = 0;
        const resultat = loyers - (chargesIS ?? chargesHorsInterets) - interets - amortissementIS;
        if (resultat <= 0) {
            etat.reportIS += -resultat;
            return { impot: 0, regime, baseImposable: 0, deficitReporte: etat.reportIS, deficitExpire: 0, imputeRevenuGlobal: 0, csgImputee: 0 };
        }
        const imputation = Math.min(etat.reportIS, resultat);
        etat.reportIS -= imputation;
        const base = resultat - imputation;
        return { impot: impotSocieteIS(base), regime, baseImposable: base, deficitReporte: etat.reportIS, deficitExpire: 0, imputeRevenuGlobal: 0, csgImputee: 0 };
    }

    if (regime === 'micro-foncier') {
        const base = loyers * 0.7;
        const { impot, csgImputee } = impotSurBase(base);
        return { impot, regime, baseImposable: base, deficitReporte: totalReport(etat.reportFoncier), deficitExpire: 0, imputeRevenuGlobal: 0, csgImputee };
    }

    // Foncier réel.
    const deficitExpire = purgerReportFoncier(etat.reportFoncier, annee);
    const resultat = loyers - chargesHorsInterets - interets;
    if (resultat >= 0) {
        const imputation = imputerReportFoncier(etat.reportFoncier, resultat);
        const base = resultat - imputation;
        const { impot, csgImputee } = impotSurBase(base);
        return { impot, regime, baseImposable: base, deficitReporte: totalReport(etat.reportFoncier), deficitExpire, imputeRevenuGlobal: 0, csgImputee };
    }
    // Déficit : la case 250 s'impute d'abord sur les loyers, le reste sur le revenu global dans la
    // limite de 10 700 €, l'excédent est reporté (repartirDeficitFoncier). L'économie se mesure elle
    // aussi par différence d'impôts ; la CSG déductible de l'an passé s'impute quand même.
    const rep = repartirDeficitFoncier(loyers, chargesHorsInterets, interets);
    if (rep.reportable > 0.005) etat.reportFoncier.push({ annee, montant: rep.reportable });
    const csgImputee = etat.csgDeductible;
    etat.csgDeductible = 0;
    return {
        impot: impotRevenuDifferentiel(foyer, -(rep.imputableRevenuGlobal + csgImputee)),
        regime, baseImposable: 0, deficitReporte: totalReport(etat.reportFoncier), deficitExpire,
        imputeRevenuGlobal: rep.imputableRevenuGlobal, csgImputee,
    };
}

// ─── Étude d'acquisition ─────────────────────────────────────────────────────

// Prélèvement forfaitaire unique sur les dividendes : ce que coûte la remontée de la trésorerie d'une
// SCI à l'IS vers ses associés. 12,8 % d'IR + 18,6 % de prélèvements sociaux depuis le 1er janvier
// 2026 (LFSS 2026 : +1,4 point sur les revenus du capital, revenus fonciers et plus-values
// immobilières exclus). Sans lui, la SCI à l'IS était comparée aux régimes de l'IR sur un cash-flow
// resté dans la société, que l'associé ne touche pas.
export const PFU_TAUX = 0.314;

// Foyer fiscal de l'étude : main.js fusionne le profil dans les inputs (revenus, adults, children).
function foyerEtude(inputs) {
    return { revenus: Math.max(0, Number(inputs.revenus) || 0), adults: inputs.adults || 2, children: inputs.children || 0 };
}

// Seule la part déductible des travaux (amélioration, réparation, entretien) entre dans l'assiette
// des revenus fonciers. Construction, reconstruction et agrandissement (art. 31 I 1° a CGI) entrent
// dans le coût et le financement, pas dans les charges : tout était déduit jusqu'ici.
function travauxEtude(inputs) {
    const total = Math.max(0, Number(inputs['travaux']) || 0);
    const nonDeductibles = Math.min(total, Math.max(0, Number(inputs['travaux-non-deductibles']) || 0));
    return { total, nonDeductibles, deductibles: total - nonDeductibles };
}

// Au-delà de 15 000 € de loyers encaissés, le micro-foncier est exclu et le réel s'applique d'office
// (art. 32 CGI). L'outil continuait de calculer au micro un dossier qui n'y a pas droit.
export function regimeApplicableEtude(regime, loyersEncaisses) {
    if (regime === 'micro-foncier' && loyersEncaisses > PLAFOND_MICRO_FONCIER) return 'reel';
    return regime || 'micro-foncier';
}

// SCI à l'IS : le bâti s'amortit sur 30 ans, le terrain (20 % du prix de revient) jamais. Les frais
// d'acquisition (notaire, agence) entrent dans le prix de revient, les travaux non déductibles
// (agrandissement) s'amortissent comme le bâti, le mobilier sur 7 ans. L'ancien calcul n'amortissait
// que 80 % du prix seul.
const SCI_IS_PART_BATI = 0.8;
const SCI_IS_DUREE_BATI = 30;
const SCI_IS_DUREE_MOBILIER = 7;

function valeurBruteSciIs(prixNet, inputs) {
    const frais = prixNet * ((Number(inputs['notaire']) || 0) / 100) + (Number(inputs['agence']) || 0);
    return prixNet + frais + travauxEtude(inputs).nonDeductibles;
}

function amortissementSciIsAnnee(prixNet, inputs, year) {
    const frais = prixNet * ((Number(inputs['notaire']) || 0) / 100) + (Number(inputs['agence']) || 0);
    const bati = (prixNet + frais) * SCI_IS_PART_BATI + travauxEtude(inputs).nonDeductibles;
    const mobilier = Math.max(0, Number(inputs['meubles']) || 0);
    return (year >= 1 && year <= SCI_IS_DUREE_BATI ? bati / SCI_IS_DUREE_BATI : 0)
        + (year >= 1 && year <= SCI_IS_DUREE_MOBILIER ? mobilier / SCI_IS_DUREE_MOBILIER : 0);
}

// Cash-flow que l'associé touche réellement : en SCI à l'IS, un cash-flow positif reste dans la
// société tant qu'il n'est pas distribué, et sa distribution supporte le PFU.
export function cfDistribue(regime, cf) {
    return regime === 'sci-is' && cf > 0 ? cf * (1 - PFU_TAUX) : cf;
}

// Impôt d'une année de l'étude (moteur commun impotLocatifAnnee). `etatOuReport` : état fiscal
// porté d'une année à l'autre (etatFiscalInitial), ou, pour compatibilité, un déficit reporté.
// `tmi` n'est plus utilisé : l'impôt se calcule par différence de deux impôts complets du foyer.
function computeAnnualTaxEstimate(prixNet, loyersEncaisses, chargesExploitationAnnuelles, inputs, tmi, interestYear, insuranceYear, year = 1, etatOuReport = null) {
    const etat = etatDepuisReport(etatOuReport, year);
    const regime = regimeApplicableEtude(inputs['regime'], loyersEncaisses);
    const fraisBancaires = year === 1 ? (Number(inputs['frais-bancaires']) || 0) : 0;
    const travauxDeductibles = year === 1 ? travauxEtude(inputs).deductibles : 0;
    const fiscal = impotLocatifAnnee(regime, {
        annee: year,
        loyers: loyersEncaisses,
        chargesHorsInterets: chargesExploitationAnnuelles + travauxDeductibles,
        // Case 250 : intérêts, assurance emprunteur et frais bancaires (dossier, garantie).
        interets: interestYear + insuranceYear + fraisBancaires,
        amortissementIS: amortissementSciIsAnnee(prixNet, inputs, year),
    }, foyerEtude(inputs), etat);
    return {
        tax: fiscal.impot,
        newCarryForward: fiscal.deficitReporte,
        deficitExpire: fiscal.deficitExpire,
        baseImposable: fiscal.baseImposable,
        regime,
        etat,
    };
}

// Échéancier annuel du prêt de l'étude (année 1 = douze premières mensualités). Assurance assise sur
// le capital initial (contrat groupe) ou sur le capital restant dû au 1er jour de chaque année
// (délégation dégressive, même convention que computeAmortizationSchedule). La projection 10 ans et
// le tableau du prêt ignoraient ce mode et facturaient la cotisation initiale jusqu'au bout.
function echeancierAnnuelEtude(model, inputs, nbAnnees) {
    const nMois = Math.max(0, Math.round((inputs['duree'] || 0) * 12));
    const tauxMensuel = ((inputs['taux-input'] || 0) / 100) / 12;
    const tauxAssurance = (inputs['assurance'] || 0) / 100;
    const surCrd = inputs['assurance-mode'] === 'crd';
    let crd = model.montantFinance;
    const rows = [];
    for (let year = 1; year <= nbAnnees; year++) {
        let interets = 0, capital = 0, assurance = 0;
        const assuranceMensuelle = ((surCrd ? crd : model.montantFinance) * tauxAssurance) / 12;
        for (let month = 0; month < 12; month++) {
            if ((year - 1) * 12 + month >= nMois || crd <= 0.005) break;
            const interetMois = tauxMensuel > 0 ? crd * tauxMensuel : 0;
            const capitalMois = Math.max(0, Math.min(crd, model.mensualiteCredit - interetMois));
            interets += interetMois;
            capital += capitalMois;
            assurance += assuranceMensuelle;
            crd = Math.max(0, crd - capitalMois);
        }
        rows.push({ year, interets, capital, assurance, debtService: interets + capital + assurance, crdFin: crd });
    }
    return rows;
}

export function buildFinancialModel(prixNet, loyerMensuel, inputs, tmi) {
    const fraisNotaire = prixNet * ((inputs['notaire'] || 0) / 100);
    const fraisFixes = (inputs['agence'] || 0) + (inputs['travaux'] || 0) + (inputs['meubles'] || 0) + (inputs['frais-bancaires'] || 0);
    const coutTotal = prixNet + fraisNotaire + fraisFixes;
    // Sans durée de crédit il n'y a pas de prêt : le coût est intégralement apporté. Un capital
    // emprunté sans mensualité ni intérêt était un prêt gratuit et perpétuel.
    const nMois = Math.max(0, Math.round((inputs['duree'] || 0) * 12));
    const montantFinance = nMois > 0 ? Math.max(0, coutTotal - (inputs['apport'] || 0)) : 0;

    const tauxMensuel = ((inputs['taux-input'] || 0) / 100) / 12;
    let mensualiteCredit = 0;
    if (tauxMensuel > 0 && nMois > 0) mensualiteCredit = (montantFinance * tauxMensuel) / (1 - Math.pow(1 + tauxMensuel, -nMois));
    else if (nMois > 0) mensualiteCredit = montantFinance / nMois;

    // Année 1 : la cotisation est la même dans les deux modes (le capital restant dû au 1er jour est
    // le capital initial).
    const coutAssuranceMensuel = (montantFinance * ((inputs['assurance'] || 0) / 100)) / 12;
    const mensualiteTotale = mensualiteCredit + coutAssuranceMensuel;

    const loyersAnnuelsTheoriques = loyerMensuel * 12;
    const loyersEncaisses = loyersAnnuelsTheoriques * (1 - ((inputs['vacance'] || 0) / 100));
    const chargesExploitationAnnuelles = ((inputs['copro'] || 0) * 12) + (inputs['fonciere'] || 0) + (inputs['pno'] || 0) + (loyersEncaisses * ((inputs['gestion'] || 0) / 100));

    const annee1 = echeancierAnnuelEtude({ montantFinance, mensualiteCredit }, inputs, 1)[0];
    const interetsAnnee1 = annee1.interets;

    const taxResult = computeAnnualTaxEstimate(
        prixNet,
        loyersEncaisses,
        chargesExploitationAnnuelles,
        inputs,
        tmi,
        interetsAnnee1,
        annee1.assurance,
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
        regimeApplique: taxResult.regime,
        cfNet,
        cfNetNet,
        // Cash-flow réellement perçu par l'associé (PFU en SCI à l'IS), base des comparaisons de régimes.
        cfNetNetDistribue: cfDistribue(taxResult.regime, cfNetNet)
    };
}

// ALGORITHME MOTEUR : Calcule le CF Net-Net pour n'importe quelle configuration
export function computeCF(prixVendeur, loyerMensuel, inputs, tmi) {
    const model = buildFinancialModel(prixVendeur, loyerMensuel, inputs, tmi);
    return model.cfNetNet;
}

// CF mensuel moyen sur 3 ans (durée minimale d'engagement du régime réel), tel que l'associé le
// perçoit (après PFU en SCI à l'IS) : sert à comparer les régimes entre eux.
// Prend en compte : décroissance des intérêts et de l'assurance dégressive, charges ponctuelles de
// l'année 1 seulement, report de déficit (foncier et IS), CSG déductible.
function computeAvgCF3Y(prixNet, loyerMensuel, inputs, tmi) {
    const model = buildFinancialModel(prixNet, loyerMensuel, inputs, tmi);
    const etat = etatFiscalInitial();
    let total = 0;
    for (const row of echeancierAnnuelEtude(model, inputs, 3)) {
        const taxResult = computeAnnualTaxEstimate(
            model.prixNet, model.loyersEncaisses, model.chargesExploitationAnnuelles,
            inputs, tmi, row.interets, row.assurance, row.year, etat
        );
        total += cfDistribue(taxResult.regime, model.loyersEncaisses - model.chargesExploitationAnnuelles - row.debtService - taxResult.tax);
    }
    return total / 36;
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

    return { prixNet, coutTotal, loyer, rentaBrute, rentaNette, rentaNetNet, cfNet, cfNetNet, coc, grm, dscr, bestRegime, scoreLabel, regimeApplique: model.regimeApplique };
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
                ? `Vacance cible à ${formatDecimalFr(vacancy, 1)} % : l\'hypothèse d\'exploitation est trop tendue.`
                : (vacancy > Math.max(0, thresholds.maxVacancy - 2)
                    ? `Vacance cible à ${formatDecimalFr(vacancy, 1)} % : vérifier la profondeur de marché et la vitesse de relocation.`
                    : `Vacance cible à ${formatDecimalFr(vacancy, 1)} % : hypothèse locative défendable.`),
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
            isCritical: marketRent <= 0 || rentGapRatio > thresholds.maxRentGapRatio,
            // Loyer de marché absent = information manquante ; loyer au-dessus du marché = vrai défaut.
            isInformation: marketRent <= 0
        },
        {
            key: 'confidence',
            isInformation: true,
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
    // Audit 2026-11-18, F4 : un blocage « information » (fiabilité des hypothèses, loyer de marché
    // non renseigné) se lève en documentant le dossier ; les autres sont de vrais défauts du bien.
    const informationBlockers = items.filter(item => item.status === 'block' && item.isInformation).length;
    const defectBlockers = blockersCount - informationBlockers;
    const criticalDefects = items.filter(item => item.status === 'block' && item.isCritical && !item.isInformation).length;

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
        informationBlockers,
        defectBlockers,
        criticalDefects,
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
            detail: `DSCR à ${formatRatioFr(metrics.dscr)}.`
        });
    } else {
        blockers.push({
            label: 'Couverture de dette trop courte',
            detail: `DSCR à ${formatRatioFr(metrics.dscr)} sous la zone de confort.`
        });
    }

    if (metrics.rentaNetNet >= 4.5) {
        strengths.push({
            label: 'Rendement défendable',
            detail: `Rentabilité nette-nette à ${formatDecimalFr(metrics.rentaNetNet, 1)} %.`
        });
    } else {
        blockers.push({
            label: 'Rendement trop court',
            detail: `Rentabilité nette-nette à ${formatDecimalFr(metrics.rentaNetNet, 1)} %.`
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

    // Classement du verdict (audit 2026-11-18, F4, règles choisies par l'utilisateur le 2026-11-19) :
    //   1. l'économie d'abord : si elle ne tient pas au prix affiché (« Révision de prix requise » ou
    //      « Non recevable »), verdict « Économie défavorable », même si le dossier est aussi incomplet ;
    //   2. économie tenable + seulement des blocages d'information (fiabilité des hypothèses, loyer de
    //      marché non renseigné) → « Dossier à documenter » ;
    //   3. économie tenable + vrai défaut du bien → « Offre non recevable » / « Validation bloquée ».
    // Le score n'est pas modifié (choix utilisateur).
    const economyHolds = economicSignal.tone === 'excellent' || economicSignal.tone === 'positive';
    const informationLabels = checklist.items
        .filter(item => item.status === 'block' && item.isInformation)
        .map(item => item.label.toLowerCase());
    const defectLabels = checklist.items
        .filter(item => item.status === 'block' && !item.isInformation)
        .map(item => item.label.toLowerCase());
    let verdictKind = 'economie-ok';
    let reason = ''; // une ligne sous le verdict, dans la bande compacte de l'Analyse

    if (!economyHolds) {
        verdictKind = 'economie-defavorable';
        label = 'Économie défavorable';
        tone = economicSignal.tone === 'negative' ? 'negative' : 'watch';
        const baisse = Math.ceil(negotiationToTenable / 100) * 100;
        reason = baisse > 0 && maxOfferPrice > 0
            ? `Il faudrait environ ${baisse.toLocaleString('fr-FR')} € de baisse (prix autour de ${Math.round(maxOfferPrice).toLocaleString('fr-FR')} €) pour atteindre le seuil minimal.`
            : 'Cash-flow et couverture du crédit ne tiennent pas, même avec une négociation réaliste.';
        summary = `Au prix affiché, cash-flow et couverture du crédit ne tiennent pas. ${reason}`;
        action = economicSignal.action;
    } else if (checklist.defectBlockers > 0) {
        verdictKind = 'defaut';
        const severe = checklist.criticalDefects > 0 || checklist.defectBlockers >= 2;
        label = severe ? 'Offre non recevable' : 'Validation bloquée';
        tone = severe ? 'negative' : 'watch';
        reason = `L’économie tient, mais point bloquant : ${defectLabels.join(', ')}.`;
        summary = 'L’économie tient au prix affiché, mais le bien présente un point bloquant dans la checklist.';
        action = 'Lever les points bloquants de la checklist avant toute offre.';
    } else if (checklist.informationBlockers > 0 || confidenceModel.score < 55) {
        verdictKind = 'documenter';
        label = 'Dossier à documenter';
        tone = 'watch';
        reason = `L’économie tient au prix affiché ; à confirmer : ${informationLabels.length ? informationLabels.join(', ') : 'fiabilité des hypothèses'}.`;
        summary = `L’économie tient au prix affiché, mais le dossier repose encore sur des estimations${informationLabels.length ? ` (${informationLabels.join(', ')})` : ''}.`;
        action = 'Confirmer les hypothèses (loyer de marché, charges, travaux, documents) avant toute offre.';
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
        verdictKind,
        reason,
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
    const etat = etatFiscalInitial();
    let cumulativeCashflow = 0;
    let cumulativePrincipal = 0;
    let deficitExpireTotal = 0;
    const years = [];

    for (const row of echeancierAnnuelEtude(model, inputs, horizonYears)) {
        const taxResult = computeAnnualTaxEstimate(
            model.prixNet,
            model.loyersEncaisses,
            model.chargesExploitationAnnuelles,
            inputs,
            tmi,
            row.interets,
            row.assurance,
            row.year,
            etat
        );
        deficitExpireTotal += taxResult.deficitExpire || 0;
        // En SCI à l'IS, cash-flow de la société (avant distribution) : c'est ce qui s'accumule.
        const annualCashflow = model.loyersEncaisses - model.chargesExploitationAnnuelles - row.debtService - taxResult.tax;

        cumulativeCashflow += annualCashflow;
        cumulativePrincipal += row.capital;
        const traction = cumulativeCashflow + cumulativePrincipal;

        years.push({
            year: row.year,
            annualCashflow,
            impots: taxResult.tax,
            deficitReporte: taxResult.newCarryForward,
            cumulativeCashflow,
            principalRepaid: row.capital,
            cumulativePrincipal,
            traction,
            wealthCreated: traction,
            remainingCapital: row.crdFin
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
        deficitExpireTotal,
        endingCashflow: finalYear.cumulativeCashflow,
        endingPrincipal: finalYear.cumulativePrincipal,
        endingTraction: finalYear.traction,
        endingWealth: finalYear.wealthCreated
    };
}

const _matrixCache = { key: null, data: null };

function buildPriceRentMatrix(prixNet, loyer, inputs, adults, children, thresholds) {
    // Clé sur TOUTES les entrées : la liste à la main oubliait travaux, notaire, assurance, gestion,
    // mobilier... et resservait une matrice périmée quand l'un d'eux changeait.
    const cacheKey = JSON.stringify([prixNet, loyer, adults, children, inputs, thresholds]);
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
    const etat = etatFiscalInitial();
    return echeancierAnnuelEtude(model, inputs, duree).map(row => {
        const taxResult = computeAnnualTaxEstimate(
            model.prixNet,
            model.loyersEncaisses,
            model.chargesExploitationAnnuelles,
            inputs,
            tmi,
            row.interets,
            row.assurance,
            row.year,
            etat
        );
        const cfAvantImpot = (model.loyersEncaisses - model.chargesExploitationAnnuelles - row.debtService) / 12;
        const cfApresImpot = cfAvantImpot - (taxResult.tax / 12);
        return { year: row.year, cfAvantImpot, cfApresImpot, deficitReporte: Math.round(taxResult.newCarryForward) };
    });
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

    // Comparaison sur ce que le foyer perçoit réellement : en SCI à l'IS, après PFU sur la
    // distribution. Un micro-foncier au-delà du plafond est calculé au réel, et le libellé le dit.
    const regimeComparison = ['micro-foncier', 'reel', 'sci-is']
        .map(regime => {
            const regimeModel = buildFinancialModel(prixNet, loyer, { ...inputs, regime }, tmi);
            let label = REGIME_LABELS[regime];
            if (regime === 'sci-is') label += ' (après PFU)';
            if (regimeModel.regimeApplique !== regime) label += ' — réel d\'office (> 15 000 €)';
            return {
                id: regime,
                label,
                cfNetNet: regimeModel.cfNetNetDistribue,
                cfAvg3Y: computeAvgCF3Y(prixNet, loyer, { ...inputs, regime }, tmi),
                isCurrent: inputs['regime'] === regime
            };
        })
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
        // Régime réellement appliqué aux calculs (micro-foncier rabattu au réel au-delà de 15 000 €).
        regimeApplique: model.regimeApplique,
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

// Abattements pour durée de détention (art. 150 VC CGI), en années révolues : deux barèmes
// différents, d'où l'exonération d'IR à 22 ans mais de prélèvements sociaux seulement à 30 ans.
function getResaleAbatementsYears(year) {
    const y = Math.max(1, Math.floor(year));

    let ir = 0;
    if (y <= 5) ir = 0;
    else if (y <= 21) ir = (y - 5) * 0.06;
    else ir = 1;

    let ps = 0;
    if (y <= 5) ps = 0;
    else if (y <= 21) ps = (y - 5) * 0.0165;
    else if (y === 22) ps = 0.28;
    else if (y <= 30) ps = 0.28 + ((y - 22) * 0.09);
    else ps = 1;

    return { ir: clamp(ir, 0, 1), ps: clamp(ps, 0, 1) };
}

// Taxe sur les plus-values immobilières supérieures à 50 000 € (art. 1609 nonies G CGI), assise sur
// la plus-value imposable à l'IR (après abattement). Barème par paliers, avec lissage à l'entrée de
// chaque tranche sauf la première (effet de seuil réel de la loi à 50 000 €).
const SURTAXE_PV_SEUIL = 50000;
const SURTAXE_PV_BAREME = [
    { borne: 60000, taux: 0.02, lissage: pv => (60000 - pv) / 20 },
    { borne: 100000, taux: 0.02, lissage: () => 0 },
    { borne: 110000, taux: 0.03, lissage: pv => (110000 - pv) / 10 },
    { borne: 150000, taux: 0.03, lissage: () => 0 },
    { borne: 160000, taux: 0.04, lissage: pv => (160000 - pv) * 0.15 },
    { borne: 200000, taux: 0.04, lissage: () => 0 },
    { borne: 210000, taux: 0.05, lissage: pv => (210000 - pv) * 0.2 },
    { borne: 250000, taux: 0.05, lissage: () => 0 },
    { borne: 260000, taux: 0.06, lissage: pv => (260000 - pv) * 0.25 },
    { borne: Infinity, taux: 0.06, lissage: () => 0 },
];

export function computeSurtaxePlusValue(plusValueImposable) {
    if (!(plusValueImposable > SURTAXE_PV_SEUIL)) return 0;
    const tranche = SURTAXE_PV_BAREME.find(t => plusValueImposable <= t.borne);
    return Math.max(0, plusValueImposable * tranche.taux - tranche.lissage(plusValueImposable));
}

// Impôt de plus-value des particuliers : 19 % d'IR et 17,2 % de prélèvements sociaux (les plus-values
// immobilières sont exclues de la hausse de la LFSS 2026), plus la surtaxe.
function computeResaleTax(plusValueTaxable, year) {
    if (plusValueTaxable <= 0) return 0;
    const abatements = getResaleAbatementsYears(year);
    const baseIR = plusValueTaxable * (1 - abatements.ir);
    const basePS = plusValueTaxable * (1 - abatements.ps);
    return (baseIR * 0.19) + (basePS * CSG_CRDS_RATE) + computeSurtaxePlusValue(baseIR);
}

// Gain à la revente, année par année (revente au terme de l'année `year`, détention = year années).
//  - Particulier (micro-foncier, réel) : prix d'acquisition majoré des frais réels ou du forfait de
//    7,5 %, et des travaux NON déduits des revenus fonciers (agrandissement) ou du forfait de 15 %
//    au-delà de 5 ans (art. 150 VB). Les travaux déductibles sont exclus : déduits au réel, réputés
//    couverts par l'abattement de 30 % au micro — les compter deux fois minorait l'impôt.
//  - SCI à l'IS : plus-value professionnelle (prix net de frais − valeur nette comptable, donc
//    amortissements repris), imposée à l'IS, puis PFU sur le boni distribué aux associés. Le barème
//    des particuliers (abattements, exonérations) ne s'applique pas à une société à l'IS.
export function computeResaleTimeline(prixNet, capitalRestantSeries, cfCumuleSeries, inputs) {
    const rows = [];
    const basePrice = (inputs['prix-revente-estime'] && inputs['prix-revente-estime'] > 0) ? inputs['prix-revente-estime'] : prixNet;
    const growth = (inputs['appreciation'] || 0) / 100;
    const fraisRate = Math.max(0, (inputs['frais-revente'] || 0) / 100);
    const apport = inputs['apport'] || 0;
    const regime = inputs['regime'] || 'micro-foncier';
    const fraisAcquisition = prixNet * ((inputs['notaire'] || 0) / 100) + (inputs['agence'] || 0);
    const travauxMajorables = travauxEtude(inputs).nonDeductibles;
    const valeurBruteIS = valeurBruteSciIs(prixNet, inputs) + Math.max(0, Number(inputs['meubles']) || 0);

    let firstInterestingYear = null;
    let bestYear = 1;
    let bestGain = -Infinity;
    let amortCumuleIS = 0;

    const horizon = Math.min(capitalRestantSeries.length, cfCumuleSeries.length, 25);
    for (let i = 0; i < horizon; i++) {
        const year = i + 1;
        const prixVente = basePrice * Math.pow(1 + growth, i);
        const fraisVente = prixVente * fraisRate;
        const prixVenteNetFrais = prixVente - fraisVente;
        const crd = Math.max(0, capitalRestantSeries[i] || 0);
        amortCumuleIS += amortissementSciIsAnnee(prixNet, inputs, year);

        let plusValueTaxable, impotPv;
        if (regime === 'sci-is') {
            const valeurComptableNette = Math.max(0, valeurBruteIS - amortCumuleIS);
            plusValueTaxable = prixVenteNetFrais - valeurComptableNette;
            const impotIS = impotSocieteIS(plusValueTaxable);
            const boni = Math.max(0, prixVenteNetFrais - impotIS - crd - apport);
            impotPv = impotIS + boni * PFU_TAUX;
        } else {
            const fraisRetenus = Math.max(fraisAcquisition, prixNet * 0.075);
            const travauxRetenus = year > 5 ? Math.max(travauxMajorables, prixNet * 0.15) : travauxMajorables;
            plusValueTaxable = prixVenteNetFrais - (prixNet + fraisRetenus + travauxRetenus);
            impotPv = computeResaleTax(plusValueTaxable, year);
        }
        const netVendeur = prixVente - fraisVente - impotPv;
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

/**
 * Scénario « courant » d'un bien détenu, à passer à computeOwnedAssetCF pour tous les chiffres
 * « au rythme actuel » (liste, dashboard, cartes KPI, rapports, alertes, régime optimal).
 * C'est le scénario « réaliste » (repli : premier scénario), MAIS sa vacance est remplacée par
 * celle de l'onglet Exploitation (resolveLoyerVacance → postAchat.vacance ou lots) : l'éditeur
 * des scénarios est masqué, sa vacance par défaut (5 %) contredisait la saisie de l'utilisateur
 * (bilan 2026-10-12, B2). Les scénarios stockés ne sont pas modifiés (simulateur inchangé).
 */
export function resolveScenarioCourant(asset) {
    const scenarios = asset?.scenarios || [];
    const sc = scenarios.find(s => s.id === 'realiste')
        || scenarios.find(s => s.nom?.toLowerCase().includes('éaliste'))
        || scenarios[0]
        || { id: 'realiste', nom: 'Réaliste', variables: {} };
    return { ...sc, variables: { ...(sc.variables || {}), vacance: resolveLoyerVacance(asset || {}).vacancePct } };
}

// Résout le revenu du foyer applicable à une année civile donnée — même logique que
// resolveLoyerFromHistorique (dernière entrée dont `annee` est <= à l'année cible s'applique ;
// avant la première prise d'effet, on retient quand même la première valeur connue). Un revenu qui
// évolue d'une année sur l'autre ne doit pas faire recalculer le TMI (et donc l'impôt) d'une année
// fiscale déjà passée avec le revenu d'aujourd'hui. `profileData.income` reste le fallback legacy
// tant qu'aucune entrée de `revenuHistorique` n'a été saisie — même patron que `loyerInitial` à
// côté de `loyerHistorique`.
export function resolveRevenuFoyer(profileData, annee) {
    const historique = profileData?.revenuHistorique;
    if (!historique?.length) return profileData?.income || 0;
    const sorted = [...historique].sort((a, b) => a.annee - b.annee);
    let applicable = null;
    for (const entry of sorted) {
        if (!entry || typeof entry.annee !== 'number') continue;
        if (entry.annee <= annee) applicable = entry;
        else break;
    }
    return (applicable ?? sorted[0])?.revenu ?? (profileData?.income || 0);
}

// TMI résolu pour une année civile précise à partir du profil complet — combine
// resolveRevenuFoyer + calculateTMI, à utiliser par toute fonction qui reconstruit une année
// fiscale ou une timeline multi-année (le TMI doit varier avec le revenu de CETTE année-là, pas
// rester figé sur le revenu actuel). Les fonctions "taux courant" (computeOwnedAssetCF...) gardent
// elles un TMI figé, résolu une fois par l'appelant sur l'année courante — sémantique différente,
// voir docs/superpowers/specs/2026-08-04-revenus-historises-profil.md.
export function resolveTmiFoyer(profileData, annee) {
    return calculateTMI(resolveRevenuFoyer(profileData, annee), {
        adults: profileData?.adults || 2,
        children: profileData?.children || 0
    });
}

// Copie d'un bien où les variables saisies d'un scénario (loyer, vacance, charges) remplacent celles
// de la fiche, pour passer le scénario au moteur de flux (computeCFReference). Une variable vide
// ('' ou absente) laisse la valeur de la fiche.
function appliquerScenario(asset, variables = {}) {
    const num = k => (variables[k] === '' || variables[k] == null || !Number.isFinite(Number(variables[k]))) ? null : Number(variables[k]);
    const post = { ...(asset.postAchat || {}) };
    const acquisition = { ...(asset.acquisition || {}) };
    let lots = asset.lots;
    const loyer = num('loyer');
    if (loyer != null) {
        acquisition.loyerInitial = loyer;
        post.loyerHistorique = [];
        lots = undefined;
    }
    const vacance = num('vacance');
    if (vacance != null) {
        post.vacance = vacance;
        if (lots?.length) lots = lots.map(l => ({ ...l, vacance }));
    }
    const charges = ['taxeFonciere', 'chargesCopro', 'assurancePNO', 'gestionLocative'].filter(k => num(k) != null);
    for (const k of charges) post[k] = num(k);
    if (charges.length && post.chargesAnnuelles?.length) {
        post.chargesAnnuelles = post.chargesAnnuelles.map(e => {
            const copie = { ...e };
            for (const k of charges) delete copie[k];
            return copie;
        });
    }
    return { ...asset, acquisition, postAchat: post, lots };
}

// CF « au rythme actuel » d'un bien détenu, affiché partout sous « CF net-net / mois » (liste,
// dashboard, carte, tri, alertes, onglet Calcul, rapports, PDF bancaire, Assistant). Depuis le
// chantier CF unique (docs/chantier-cf-unique.md) : façade sur computeCFReference — flux des 12 mois
// qui suivent le mois courant, hors frais ponctuels, impôt annuel réel (computeImpotAnnuelBien)
// ramené au mois. Les variables du scénario (loyer, vacance, charges) remplacent celles de la fiche ;
// tmi est ignoré (TMI de chaque année depuis profileData), gardé pour la compatibilité des appels.
// Retour : { cfNetNet, cfNet, mensualiteTotale, chargesMensuelles, impotsAnnee (12 mois), loyerEffectif,
// rentaBrute, dscr, chargesExploitationMensuelles, fraisPonctuelsMensuels (0), assuranceMensuelle,
// echeance (1er mois de la fenêtre), periode { debut, fin } } — moyennes mensuelles sur la fenêtre.
// cfNet = loyerEffectif − chargesExploitationMensuelles − mensualiteTotale ; chargesMensuelles
// inclut aussi les mensualités des crédits travaux (déjà dans mensualiteTotale).
export function computeOwnedAssetCF(asset, scenario, tmi, regimeOverride = null, profileData = {}) {
    return computeOwnedAssetCFReference(asset, scenario || {}, regimeOverride, profileData || {});
}

// Détail du CF de référence (12 prochains mois, hors frais ponctuels), même forme que
// computeCFBreakdown (onglet Calcul, vue « 12 mois »), + periode. Sommes sur la fenêtre ; cfNetNet =
// computeCFReference().cfAnnuel, la somme des lignes y retombe.
export function computeCFBreakdownReference(asset, profileData, regime, options = {}) {
    const ref = computeCFReference(asset, profileData, regime, options);
    const post = asset.postAchat || {};
    const { annee: anneeAchat, mois: moisAchat } = parseDateAchat(asset.dateAchat);
    const { vacancePct } = resolveLoyerVacance(asset);
    let loyerBrut = 0, taxeFonciere = 0, chargesCopro = 0, assurancePNO = 0;
    for (const r of ref.mois) {
        if (r.annee * 12 + r.mois < anneeAchat * 12 + moisAchat) continue; // pas encore détenu
        loyerBrut += resolveLoyerVacance(asset, `${r.annee}-${String(r.mois).padStart(2, '0')}`).loyer;
        const ce = (post.chargesAnnuelles || []).filter(e => e.annee <= r.annee).sort((a, b) => b.annee - a.annee)[0] || null;
        taxeFonciere += (ce ? (ce.taxeFonciere ?? post.taxeFonciere ?? 0) : (post.taxeFonciere ?? 0)) / 12;
        chargesCopro += ce ? (ce.chargesCopro ?? post.chargesCopro ?? 0) : (post.chargesCopro ?? 0);
        assurancePNO += (ce ? (ce.assurancePNO ?? post.assurancePNO ?? 0) : (post.assurancePNO ?? 0)) / 12;
    }
    const gestion = ref.charges - taxeFonciere - chargesCopro - assurancePNO;
    const capital = ref.mois.reduce((s, r) => s + r.capital, 0);
    return {
        loyerBrut: Math.round(loyerBrut),
        vacanceEuros: Math.round(loyerBrut - ref.loyers),
        loyersEncaisses: Math.round(ref.loyers),
        charges: Math.round(ref.charges),
        travaux: 0,
        creditDetail: { interets: Math.round(ref.interets), capital: Math.round(capital), assurance: Math.round(ref.assurance) },
        chargesDetail: {
            taxeFonciere: Math.round(taxeFonciere), chargesCopro: Math.round(chargesCopro),
            assurancePNO: Math.round(assurancePNO), gestion: Math.round(gestion),
        },
        mensualiteCredit: Math.round(ref.mensualites),
        impots: Math.round(ref.impots),
        cfNetNet: Math.round(ref.cfAnnuel),
        vacancePct,
        periode: ref.periode,
    };
}

// Libellé de la période du CF de référence, le même sur tous les écrans (chantier CF unique, étape 5) :
// « 12 prochains mois (11/2026 – 10/2027) ». periode = { debut, fin } de computeCFReference.
export function libellePeriodeCF(periode) {
    if (!periode?.debut || !periode?.fin) return '12 prochains mois';
    const mm = p => `${String(p.mois).padStart(2, '0')}/${p.annee}`;
    return `12 prochains mois (${mm(periode.debut)} – ${mm(periode.fin)})`;
}

function computeOwnedAssetCFReference(asset, scenario, regimeOverride, profileData) {
    const regime = regimeOverride || scenario.regime || 'micro-foncier';
    const bien = appliquerScenario(asset, scenario);
    const ref = computeCFReference(bien, profileData, regime);
    const acq = bien.acquisition || {};
    const investissementTotal = (acq.prix || 0) + (acq.fraisAgence || 0) + (acq.fraisNotaire || 0);
    const loyer = resolveLoyerVacance(bien).loyer;
    const mensualiteTotale = ref.mensualites / 12;
    const chargesExploitationMensuelles = ref.charges / 12;
    const noiMensuel = (ref.loyers - ref.charges) / 12;
    const cfNet = (ref.cfAnnuel + ref.impots) / 12;
    return {
        cfNetNet: ref.cfMensuel,
        cfNet,
        mensualiteTotale,
        chargesMensuelles: chargesExploitationMensuelles + ref.mensualitesTravaux / 12,
        impotsAnnee: ref.impots,
        loyerEffectif: ref.loyers / 12,
        rentaBrute: investissementTotal > 0 ? ((loyer * 12) / investissementTotal) * 100 : 0,
        dscr: mensualiteTotale > 0 ? noiMensuel / mensualiteTotale : 0,
        // cfNet = loyerEffectif - chargesExploitationMensuelles - mensualiteTotale - fraisPonctuelsMensuels
        chargesExploitationMensuelles,
        fraisPonctuelsMensuels: 0, // hors frais ponctuels par définition
        assuranceMensuelle: ref.assurance / 12,
        echeance: ref.periode.debut,
        periode: ref.periode,
    };
}

// options.horizonYear (facultatif) : prolonge la timeline au moins jusqu'à cette année civile —
// utilisé par le rapport d'un bien (rapport-bien.js) pour projeter les 10 prochaines années même
// quand le crédit se termine avant. Ne raccourcit jamais la borne naturelle ; sans option, le
// comportement est strictement inchangé.
export function computeOwnedAssetTimeline(asset, profileData, regimeOverride = null, options = {}) {
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
    const endYear = Math.max(currentYear + 2, anneeAchat + dureeCredit, Number(options.horizonYear) || 0);

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
    const travauxCashParMois = {}; // trésorerie, clé 'AAAA-M' : seulement les frais payés cash (déductibles ou non)
    const fraisEmpruntParAnnee = {}; // frais d'emprunt (B9) : case 250, avec les intérêts
    for (const t of (post.travaux || [])) {
        if (!t.date || !t.montant) continue;
        const y = Number(String(t.date).slice(0, 4));
        const m = Number(String(t.date).slice(5, 7)) || 1;
        if (estFraisDeductible(t.tag)) { // travaux, taxe foncière et frais d'emprunt (B9)
            travauxDeductiblesParAnnee[y] = (travauxDeductiblesParAnnee[y] || 0) + t.montant;
        }
        if (t.tag === 'frais-emprunt') fraisEmpruntParAnnee[y] = (fraisEmpruntParAnnee[y] || 0) + t.montant;
        if (!t.financeParCredit) {
            travauxCashParMois[`${y}-${m}`] = (travauxCashParMois[`${y}-${m}`] || 0) + t.montant;
        }
    }
    // Crédits dédiés à des travaux (travaux[].credit) : leur mensualité sort de la trésorerie chaque
    // mois de leur échéancier (chantier CF unique : la timeline les oubliait, computeOwnedAssetCF
    // les retirait — 121 €/mois d'écart sur un crédit de 12 k€).
    const mensualitesTravauxParMois = echeancierCreditsTravaux(post.travaux);

    let capitalRestant = montantCredit;
    let loanMonthsElapsedTotal = 0; // mois de crédit déjà écoulés, tous exercices confondus
    // Reports de déficit (foncier par millésimes, IS) et CSG déductible, portés d'une année à l'autre.
    const etatFiscal = etatFiscalInitial();
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
        // Loyer en vigueur chaque mois (historique de loyer), vacance déduite (chantier CF unique, étape 3).
        const loyerParMois = {};
        for (let cm = 13 - moisPossedeAnnee; cm <= 12; cm++) {
            loyerParMois[cm] = resolveLoyerVacance(asset, `${y}-${String(cm).padStart(2, '0')}`).loyer * (1 - vacancePct / 100);
        }
        const loyersAnnuels = Object.values(loyerParMois).reduce((s, v) => s + v, 0);

        const annualEntries = (post.chargesAnnuelles || []).filter(e => e.annee <= y).sort((a, b) => b.annee - a.annee);
        const chargesEntry = annualEntries[0] || null;
        const taxeFonciere = chargesEntry ? (chargesEntry.taxeFonciere ?? post.taxeFonciere ?? 0) : (post.taxeFonciere ?? 0);
        const gestionPct = chargesEntry ? (chargesEntry.gestionLocative ?? post.gestionLocative ?? 0) : (post.gestionLocative ?? 0);
        const assurancePNO = chargesEntry ? (chargesEntry.assurancePNO ?? post.assurancePNO ?? 0) : (post.assurancePNO ?? 0);
        const chargesCopro = chargesEntry ? (chargesEntry.chargesCopro ?? post.chargesCopro ?? 0) : (post.chargesCopro ?? 0);
        const travauxDeductiblesAnnee = travauxDeductiblesParAnnee[y] || 0;
        // Frais payés cash du mois ; ceux datés avant le mois d'achat (année d'achat) sont rattachés
        // au premier mois détenu, pour garder le total annuel d'avant le passage au mensuel.
        const fraisCashMois = cm => cm < firstCalMonth ? 0 : (travauxCashParMois[`${y}-${cm}`] || 0)
            + (cm === firstCalMonth ? Array.from({ length: firstCalMonth - 1 }, (_, i) => travauxCashParMois[`${y}-${i + 1}`] || 0).reduce((s, v) => s + v, 0) : 0);
        let travauxCashAnnee = 0;
        for (let cm = 1; cm <= 12; cm++) travauxCashAnnee += travauxCashParMois[`${y}-${cm}`] || 0;
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
        const creditParMois = {}; // mois civil → { interets, capital, assurance } du crédit principal
        if (creditActif) {
            let cap = capitalRestant;
            for (let cm = firstCalMonth; cm <= 12 && loanMonthsElapsedTotal < nMois && cap > 0; cm++) {
                const intM = tauxM > 0 ? cap * tauxM : 0;
                const capM = Math.max(0, Math.min(cap, mensCredit - intM));
                creditParMois[cm] = { interets: intM, capital: capM, assurance: assurMensUnitaire };
                interetsAnnee += intM;
                capitalAnnee += capM;
                assuranceAnnee += assurMensUnitaire;
                cap -= capM;
                loanMonthsElapsedTotal++;
            }
            capitalRestant = cap;
            debtService = interetsAnnee + capitalAnnee + assuranceAnnee;
        }
        // Mensualités des crédits travaux des mois détenus : comptées dans debtService (service de la
        // dette, lu tel quel par le rapport annuel), exposées à part dans mensualitesTravauxAnnee.
        let mensualitesTravauxAnnee = 0;
        for (let cm = firstCalMonth; cm <= 12; cm++) mensualitesTravauxAnnee += mensualitesTravauxParMois[`${y}-${cm}`]?.mensualite || 0;
        debtService += mensualitesTravauxAnnee;

        // Impôt de l'année : source unique computeImpotAnnuelBien (cases de la 2044 de l'année, TMI de
        // CETTE année via le revenu historisé, déficit reporté des années précédentes).
        const impot = computeImpotAnnuelBien(asset, y, profileData, regimeOverride || 'micro-foncier', etatFiscal);
        const impotsAnnee = impot.impots;
        const baseImposable = impot.baseImposable;

        // Trésorerie : seuls les frais payés cash (travauxCashAnnee, déductibles ou non) sont
        // retranchés ici — ceux financés par le crédit sont déjà remboursés via debtService au
        // fil des années (voir travauxCashParMois plus haut), les compter aussi ici les
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

        // loyersAnnuels/chargesAnneeTax/interetsAnnee/assuranceAnnee/travauxDeductiblesAnnee
        // (frais déductibles, déjà inclus dans chargesAnneeTax) : composantes brutes de l'année.
        // Le déficit foncier (fiche, Impôts à venir) ne les lit plus depuis B8 : il passe par
        // lignes2044Bien, la même source que la déclaration 2044.
        // chargesAnneeBase/debtService/impotsAnnee/travauxCashAnnee : composantes de trésorerie de
        // cfAnnuel (loyersAnnuels - debtService - chargesAnneeBase - impotsAnnee - travauxCashAnnee),
        // exposées pour le bloc « Trésorerie » du rapport annuel (rapport-annuel.js).
        //
        // mois : flux de chaque mois détenu (chantier CF unique). Leur somme redonne exactement les
        // totaux de l'année ; l'impôt annuel est réparti à parts égales sur les mois détenus.
        const nbMoisDetenus = 13 - firstCalMonth;
        const mois = [];
        for (let cm = firstCalMonth; cm <= 12; cm++) {
            const cr = creditParMois[cm] || { interets: 0, capital: 0, assurance: 0 };
            const mensualitesTravaux = mensualitesTravauxParMois[`${y}-${cm}`]?.mensualite || 0;
            const loyerMois = loyerParMois[cm];
            const charges = taxeFonciere / 12 + chargesCopro + assurancePNO / 12 + loyerMois * (gestionPct / 100);
            const fraisPonctuels = fraisCashMois(cm);
            const impots = impotsAnnee / nbMoisDetenus;
            const mensualites = cr.interets + cr.capital + cr.assurance + mensualitesTravaux;
            mois.push({
                annee: y, mois: cm, loyers: loyerMois, charges, interets: cr.interets, capital: cr.capital,
                assurance: cr.assurance, mensualitesTravaux, mensualites, fraisPonctuels, impots,
                cf: loyerMois - mensualites - charges - fraisPonctuels - impots,
            });
        }
        years.push({ year: y, cfAnnuel, cumulCF, recettesAnnee, recettesCum, depensesAnnee, depensesCum, apportAnnee, loyersAnnuels, chargesAnneeTax, interetsAnnee, assuranceAnnee, travauxDeductiblesAnnee, chargesAnneeBase, debtService, mensualitesTravauxAnnee, impotsAnnee, baseImposable, travauxCashAnnee, mois });
    }

    return { years, anneeAchat, endYear };
}

// Échéancier mensuel des crédits dédiés à des travaux (travaux[].credit = { montant, duree, taux }) :
// clé 'AAAA-M' → { mensualite, interets, capital } (sommes sur tous les crédits travaux de ce mois).
// Première échéance le mois suivant la date du frais (déblocage), sur duree × 12 mois.
function echeancierCreditsTravaux(travaux) {
    const parMois = {};
    for (const t of (travaux || [])) {
        const tc = t.credit;
        if (!tc || !(tc.montant > 0) || !(tc.duree > 0) || !t.date) continue;
        const nM = tc.duree * 12;
        const tM = ((tc.taux || 0) / 100) / 12;
        const mens = tM > 0 ? (tc.montant * tM) / (1 - Math.pow(1 + tM, -nM)) : tc.montant / nM;
        let crd = tc.montant;
        let y = Number(String(t.date).slice(0, 4));
        let m = Number(String(t.date).slice(5, 7)) || 1;
        for (let i = 0; i < nM; i++) {
            m++;
            if (m > 12) { m = 1; y++; }
            const interets = crd * tM;
            const capital = mens - interets;
            crd -= capital;
            const r = parMois[`${y}-${m}`] || (parMois[`${y}-${m}`] = { mensualite: 0, interets: 0, capital: 0 });
            r.mensualite += mens;
            r.interets += interets;
            r.capital += capital;
        }
    }
    return parMois;
}

// Impôt annuel d'un bien (chantier CF unique, étape 3) : SOURCE UNIQUE de l'impôt du CF, lue par la
// timeline (donc par le CF de référence, le détail du CF et le compte de résultat). Base = les cases
// de la 2044 de l'année (lignes2044Bien : forfait 20 €, intérêts des crédits travaux, frais
// d'emprunt en case 250) ; deficitReporte = déficit reportable des années précédentes (réel).
// Moteur commun impotLocatifAnnee : IR par différence de deux impôts complets du foyer (revenu de
// CETTE année, barème, plafonnement, décote) + prélèvements sociaux, CSG déductible l'année suivante.
//  - micro-foncier : base = 70 % des loyers ;
//  - réel : bénéfice diminué des déficits reportés (millésimes, dix ans) ; déficit réparti comme la
//    2044 (repartirDeficitFoncier) : part imputable sur le revenu global, reste reporté ;
//  - SCI-IS : bénéfice hors forfait 20 € (propre à la 2044), moins l'amortissement de l'immeuble
//    (amortissementSciIsBienAnnee), déficit reporté sans limite, IS 15 % puis 25 %.
// L'impôt d'un bien est mesuré bien par bien sur le revenu du foyer : avec plusieurs biens, la
// projection « Impôts à venir » (computeProjectionImpotsFoyer) reste la référence au niveau du foyer.
// `etatOuReport` : état fiscal de l'année précédente (etatFiscalInitial, modifié en place) ou, pour
// compatibilité, un déficit foncier reporté.
// Retour : { impots, baseImposable, deficitReporte (après l'année), deficitExpire, etat }.
export function computeImpotAnnuelBien(asset, annee, profileData, regime, etatOuReport = 0) {
    const l = lignes2044Bien(asset, annee, profileData);
    const etat = etatDepuisReport(etatOuReport, annee);
    const fiscal = impotLocatifAnnee(regime === 'reel' || regime === 'sci-is' ? regime : 'micro-foncier', {
        annee,
        loyers: l.case211,
        chargesHorsInterets: l.chargesHorsInterets,
        interets: l.case250,
        chargesIS: l.chargesHorsInterets - l.case222,
        amortissementIS: amortissementSciIsBienAnnee(asset, annee),
    }, foyerAnnee(profileData, annee), etat);
    return { impots: fiscal.impot, baseImposable: fiscal.baseImposable, deficitReporte: fiscal.deficitReporte, deficitExpire: fiscal.deficitExpire, etat };
}

// Foyer fiscal d'une année civile : revenu historisé de cette année-là, composition du profil.
function foyerAnnee(profileData, annee) {
    return {
        revenus: resolveRevenuFoyer(profileData, annee),
        adults: profileData?.adults || 2,
        children: profileData?.children || 0,
    };
}

// Dotation SCI à l'IS d'un bien détenu pour une année civile : 80 % du prix de revient (prix + frais
// de notaire + frais d'agence), terrain exclu, sur 30 ans, prorata l'année d'achat, bornée par le
// stock amortissable. L'ancien calcul dotait 80 % du seul prix, en année pleine dès l'achat et sans
// fin.
function amortissementSciIsBienAnnee(asset, annee) {
    const acq = asset.acquisition || {};
    const base = ((acq.prix || 0) + (acq.fraisNotaire || 0) + (acq.fraisAgence || 0)) * 0.80;
    if (!(base > 0)) return 0;
    const annuel = base / 30;
    const { annee: anneeAchat, mois: moisAchat } = parseDateAchat(asset.dateAchat);
    if (annee < anneeAchat) return 0;
    const premiere = annuel * (13 - moisAchat) / 12;
    if (annee === anneeAchat) return Math.min(base, premiere);
    const cumulAvant = premiere + annuel * (annee - anneeAchat - 1);
    return Math.max(0, Math.min(annuel, base - cumulAvant));
}

// Flux mensuels d'un bien sur une fenêtre (chantier CF unique) : { debut: {annee, mois}, nbMois }.
// Lus dans computeOwnedAssetTimeline (seule source), un mois non détenu (avant l'achat) vaut zéro.
// Retour : { mois: [{annee, mois, loyers, charges, interets, capital, assurance, mensualitesTravaux,
// mensualites, fraisPonctuels, impots, cf}], total: mêmes champs sommés }.
export function computeFluxMensuelsBien(asset, profileData, regime, { debut, nbMois = 12 } = {}) {
    const zero = { loyers: 0, charges: 0, interets: 0, capital: 0, assurance: 0, mensualitesTravaux: 0, mensualites: 0, fraisPonctuels: 0, impots: 0, cf: 0 };
    const finIdx = debut.annee * 12 + (debut.mois - 1) + nbMois - 1;
    const { years } = computeOwnedAssetTimeline(asset, profileData, regime, { horizonYear: Math.floor(finIdx / 12) });
    const parCle = new Map();
    for (const yr of years) for (const r of yr.mois) parCle.set(`${r.annee}-${r.mois}`, r);
    const mois = [];
    const total = { ...zero };
    for (let i = 0; i < nbMois; i++) {
        const idx = debut.annee * 12 + (debut.mois - 1) + i;
        const annee = Math.floor(idx / 12);
        const m = (idx % 12) + 1;
        const r = parCle.get(`${annee}-${m}`) || { annee, mois: m, ...zero };
        mois.push(r);
        for (const k of Object.keys(zero)) total[k] += r[k];
    }
    return { mois, total };
}

// CF de référence d'un bien (chantier CF unique, docs/chantier-cf-unique.md) : flux des 12 mois qui
// suivent le mois courant, hors frais ponctuels, impôt annuel réel ramené au mois. C'est le chiffre
// « CF net-net / mois » de la liste, du dashboard, de la carte, du tri, des alertes et des rapports.
// options.aujourdHui = { annee, mois } (défaut : maintenant), pour les tests.
// Fenêtre du CF de référence : du mois qui suit le mois courant au 12e → { debut, fin } ({annee, mois}).
export function periodeCFReference({ aujourdHui } = {}) {
    const now = new Date();
    const ref = aujourdHui || { annee: now.getFullYear(), mois: now.getMonth() + 1 };
    const debut = ref.mois === 12 ? { annee: ref.annee + 1, mois: 1 } : { annee: ref.annee, mois: ref.mois + 1 };
    const finIdx = debut.annee * 12 + (debut.mois - 1) + 11;
    return { debut, fin: { annee: Math.floor(finIdx / 12), mois: (finIdx % 12) + 1 } };
}

export function computeCFReference(asset, profileData, regime, { aujourdHui } = {}) {
    const { debut } = periodeCFReference({ aujourdHui });
    const { mois, total } = computeFluxMensuelsBien(asset, profileData, regime, { debut, nbMois: 12 });
    const cfAnnuel = total.cf + total.fraisPonctuels;
    const fin = mois[mois.length - 1];
    return {
        cfAnnuel, cfMensuel: cfAnnuel / 12,
        loyers: total.loyers, charges: total.charges, mensualites: total.mensualites,
        mensualitesTravaux: total.mensualitesTravaux, interets: total.interets, assurance: total.assurance,
        impots: total.impots,
        periode: { debut, fin: { annee: fin.annee, mois: fin.mois } },
        mois,
    };
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
export function computeCFBreakdown(asset, profileData, regime, targetYear = 1, targetMonth = null) {
    const acq = asset.acquisition || {};
    const post = asset.postAchat || {};
    const credit = acq.credit || {};
    const { annee: anneeAchat, mois: moisAchat } = parseDateAchat(asset.dateAchat);
    const targetAbsYear = anneeAchat + targetYear - 1;

    const { years } = computeOwnedAssetTimeline(asset, profileData, regime);
    const row = years.find(y => y.year === targetAbsYear) || years[years.length - 1];
    if (!row) return null;

    const moisCible = targetMonth ? `${targetAbsYear}-${String(targetMonth).padStart(2, '0')}` : String(targetAbsYear);
    const { loyer, vacancePct } = resolveLoyerVacance(asset, moisCible);
    // Même proratisation que computeOwnedAssetTimeline : l'année d'achat ne compte le loyer que
    // depuis moisAchat, cohérent avec row.cfAnnuel (sinon l'impôt reconstruit plus bas — qui
    // absorbe l'écart entre loyersEncaisses et row.cfAnnuel — serait faussé).
    const moisPossedeAnnee = targetMonth ? 1 : (targetAbsYear === anneeAchat ? (13 - moisAchat) : 12);
    // Loyer en vigueur chaque mois (chantier CF unique, étape 3), comme la timeline et la 2044.
    const loyerBrut = targetMonth ? loyer : loyersTheoriquesAnnee(asset, targetAbsYear, 13 - moisPossedeAnnee);
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
    // Crédits travaux (chantier CF unique) : leurs mensualités sont dans row.cfAnnuel ; sans elles
    // ici, l'impôt reconstruit plus bas par différence les absorbait.
    const mensualitesTravaux = targetMonth
        ? (row.mois || []).find(r => r.mois === targetMonth)?.mensualitesTravaux || 0
        : row.mensualitesTravauxAnnee || 0;
    mensualiteCredit += mensualitesTravaux;

    // Impôt lu dans la timeline (source unique computeImpotAnnuelBien), plus reconstruit par différence
    // avec cfAnnuel (chantier CF unique, étape 3) : un mois = sa part de l'impôt annuel.
    const impots = targetMonth
        ? (row.mois || []).find(r => r.mois === targetMonth)?.impots || 0
        : row.impotsAnnee;
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

export function computeRegimeComparison(asset, profileData, targetYears = [1, 3, 5, 10]) {
    const regimes = ['micro-foncier', 'reel', 'sci-is'];
    const { annee: anneeAchat } = parseDateAchat(asset.dateAchat);
    const result = {};
    for (const regime of regimes) {
        const { years } = computeOwnedAssetTimeline(asset, profileData, regime);
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

// ─── Coût d'un euro emprunté ─────────────────────────────────────────────────
// Repris de Spark Cash Flow (calc.js, `ratioRemboursement`). Calcul autonome, sans lien avec un
// bien ou une étude : « pour un taux et une durée, combien rembourse-t-on par euro emprunté ? ».
// C'est la seule grandeur qu'on retient d'un tableau d'amortissement, et la seule qu'on puisse
// poser sur un coin de table en rendez-vous.
//
// Elle se déduit de la mensualité d'un prêt à annuité constante :
//   M = C × i / (1 − (1+i)^−n)   avec i = t/12 et n = 12Y
//   total remboursé = M × n = C × 12Y × (t/12) / (1 − (1+t/12)^−12Y)
//   r = total / C = Y × t / (1 − (1+t/12)^−12Y)
// Le capital emprunté disparaît de l'expression : le ratio ne dépend QUE du taux et de la durée.
// Vérifié contre un échéancier simulé mois par mois dans tests/test_ratio_credit.mjs.

export const RATIO_TAUX_MIN = 0;
export const RATIO_TAUX_MAX = 20;    // %/an
export const RATIO_DUREE_MIN = 1;
export const RATIO_DUREE_MAX = 35;   // ans

// `tauxAnnuelPct` en POURCENTS (3,15 pour 3,15 %), `dureeAnnees` en années.
// Les deux entrées sont bornées plutôt que rejetées, et le bornage est exposé (`borne`) : une
// valeur substituée doit se VOIR, jamais être avalée en silence.
export function ratioRemboursement(tauxAnnuelPct, dureeAnnees) {
    const brutTaux = Number(tauxAnnuelPct);
    const brutDuree = Number(dureeAnnees);
    if (!Number.isFinite(brutTaux) || !Number.isFinite(brutDuree)) {
        return { ratio: null, pctInterets: null, taux: null, duree: null, borne: 'saisie' };
    }
    const taux = Math.min(RATIO_TAUX_MAX, Math.max(RATIO_TAUX_MIN, brutTaux));
    const duree = Math.min(RATIO_DUREE_MAX, Math.max(RATIO_DUREE_MIN, brutDuree));
    const borne = Math.abs(taux - brutTaux) > 1e-9 || Math.abs(duree - brutDuree) > 1e-9;

    // Taux nul : la formule tombe sur 0/0. La limite mathématique vaut 1, et c'est aussi le sens
    // économique — sans intérêt, on rembourse exactement ce qu'on a emprunté.
    const t = taux / 100;
    if (!(t > 0)) return { ratio: 1, pctInterets: 0, taux, duree, borne };

    const i = t / 12;
    const n = 12 * duree;
    const ratio = (duree * t) / (1 - Math.pow(1 + i, -n));
    return { ratio, pctInterets: (ratio - 1) * 100, taux, duree, borne };
}

// profileData : TMI de chaque année (CF de référence) ; tmi est gardé pour la compatibilité des appels.
export function getOptimalRegime(asset, tmi, profileData = {}) {
    const vars = resolveScenarioCourant(asset).variables;
    const regimes = ['micro-foncier', 'reel', 'sci-is'];
    const results = regimes.map(r => ({
        regime: r,
        cf: computeOwnedAssetCF(asset, { ...vars, regime: r }, tmi, null, profileData).cfNetNet
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

// Natures d'un frais de l'onglet Travaux (champ `tag`) déductibles au foncier réel (bilan
// 2026-10-12, B9) : 'deductible' = travaux et autres charges (case 224 de la 2044) ;
// 'taxe-fonciere' = taxe foncière payée à part (case 227, avec celle des charges) ; 'frais-emprunt'
// = garantie, courtage, frais de dossier (case 250, avec les intérêts : seulement reportables en
// cas de déficit). Les trois réduisent l'assiette imposable ; le flux de trésorerie les traite tous
// comme des frais payés (financés par le crédit ou non). Ignorées en micro-foncier (abattement 30 %).
export const NATURES_FRAIS_DEDUCTIBLES = ['deductible', 'taxe-fonciere', 'frais-emprunt'];
export function estFraisDeductible(tag) {
    return NATURES_FRAIS_DEDUCTIBLES.includes(tag);
}

// Loyers théoriques (avant vacance) d'une année civile, du mois premierMois à décembre : le loyer en
// vigueur CHAQUE mois (historique de loyer), pas celui du 31/12 appliqué à toute l'année (chantier
// CF unique, étape 3). Utilisé par le compte de résultat, la timeline et le détail du CF.
function loyersTheoriquesAnnee(asset, annee, premierMois = 1) {
    let total = 0;
    for (let m = premierMois; m <= 12; m++) total += resolveLoyerVacance(asset, `${annee}-${String(m).padStart(2, '0')}`).loyer;
    return total;
}

// Compte de résultat d'une année où le bien n'était pas encore détenu : tout à zéro.
function compteResultatVide(annee, regime) {
    const champs = ['recettesBrutes', 'loyersTheoriques', 'vacanceEst', 'interetsAnnee', 'assuranceAnnee', 'taxeFonciere',
        'taxeFonciereFrais', 'fraisEmprunt', 'chargesCopro', 'assurancePNO', 'gestionLocative', 'travauxDed',
        'chargesDeductibles', 'resultatFoncier', 'baseImposable', 'impots', 'resultatNet', 'capitalRembourse', 'cfReel'];
    return { annee, regime, ...Object.fromEntries(champs.map(c => [c, 0])) };
}

// options.base = true : compte de résultat sans l'impôt de la timeline (impôt de l'année seule, sans
// report de déficit) — utilisé par lignes2044Bien, que la timeline lit pour son impôt (évite la
// récursion). Sans option, `impots` = impôt de l'année dans computeOwnedAssetTimeline (même
// régime), seule source de l'impôt d'un bien depuis le chantier CF unique (étape 3).
export function computeCompteResultat(asset, annee, profileData, regime, options = {}) {
    // Revenu du foyer de l'année déclarée (foyerAnnee, pas le revenu actuel) : un revenu qui évolue
    // ne doit pas retaxer une année fiscale déjà passée avec le revenu d'aujourd'hui.
    const acq = asset.acquisition || {};
    const post = asset.postAchat || {};
    const credit = acq.credit || {};
    const { vacancePct } = resolveLoyerVacance(asset, String(annee));
    // Même proratisation que computeCFBreakdown/computeOwnedAssetTimeline : l'année d'achat ne
    // compte le loyer que depuis moisAchat (13 - moisAchat mois), pas une année pleine — sinon
    // les recettes déclarées ici (et dans computeDeclaration2044, qui en dépend) sont surestimées
    // pour tout bien acheté en cours d'année, alors que interetsAnnee/capitalRembourse ci-dessous
    // sont déjà correctement proratisés via computeAmortizationSchedule.
    const { annee: anneeAchat, mois: moisAchat } = parseDateAchat(asset.dateAchat);
    if (annee < anneeAchat) return compteResultatVide(annee, regime);
    const moisPossedeAnnee = annee === anneeAchat ? (13 - moisAchat) : 12;
    const loyersTheoriques = loyersTheoriquesAnnee(asset, annee, 13 - moisPossedeAnnee);
    const vacanceEst = loyersTheoriques * (vacancePct / 100);
    const recettesBrutes = loyersTheoriques - vacanceEst;

    const { schedule } = computeAmortizationSchedule(credit.montant || 0, credit.taux || 0, credit.duree || 0, asset.dateAchat, credit.assurance || 0, credit.assuranceMode);
    const yearRow = schedule.find(r => r.annee === annee);
    // Crédits travaux (chantier CF unique, étape 3) : intérêts déductibles en case 250 avec ceux du
    // crédit principal, capital remboursé retranché du cfReel comme celui du crédit principal.
    const ctMois = Object.entries(echeancierCreditsTravaux(post.travaux))
        .filter(([cle]) => cle.startsWith(`${annee}-`) && Number(cle.split('-')[1]) > 12 - moisPossedeAnnee)
        .map(([, v]) => v);
    const interetsCreditsTravaux = ctMois.reduce((s, v) => s + v.interets, 0);
    const capitalCreditsTravaux = ctMois.reduce((s, v) => s + v.capital, 0);
    const interetsAnnee = (yearRow?.interets || 0) + interetsCreditsTravaux;
    const capitalRembourse = (yearRow?.capital || 0) + capitalCreditsTravaux;
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
    const sommeNature = tag => travauxAnneeAll.filter(t => t.tag === tag).reduce((s, t) => s + (t.montant || 0), 0);
    // Case 224 : seulement la nature 'deductible'. Les frais classés « taxe foncière » (case 227)
    // et « frais d'emprunt » (case 250) sont déductibles aussi, mais pas comme des travaux (B9).
    const travauxDed = sommeNature('deductible');
    const taxeFonciereFrais = sommeNature('taxe-fonciere');
    const fraisEmprunt = sommeNature('frais-emprunt');
    // Part des frais déductibles financée par le crédit principal (déjà remboursée via
    // capitalRembourse ci-dessous, pas une dépense cash cette année) et frais non déductibles payés
    // cash (aucun effet fiscal, mais un vrai décaissement absent des cases ci-dessus) — utilisés
    // uniquement pour corriger cfReel plus bas, chargesDeductibles reste inchangé pour l'impôt.
    const travauxDedFinance = travauxAnneeAll.filter(t => estFraisDeductible(t.tag) && t.financeParCredit).reduce((s, t) => s + (t.montant || 0), 0);
    const travauxCashNonDed = travauxAnneeAll.filter(t => !estFraisDeductible(t.tag) && !t.financeParCredit).reduce((s, t) => s + (t.montant || 0), 0);

    const chargesDeductibles = interetsAnnee + assuranceAnnee + fraisEmprunt + taxeFonciere + taxeFonciereFrais + chargesCopro + assurancePNO + gestionLocative + travauxDed;

    // Impôt de l'année seule (sans report), par le moteur commun : en mode base il n'est lu par
    // personne d'autre que l'appelant, sinon il est remplacé ci-dessous par celui de la timeline.
    // La case 250 (intérêts + assurance emprunteur + frais d'emprunt) s'impute d'abord sur les loyers.
    const case250 = interetsAnnee + assuranceAnnee + fraisEmprunt;
    const resultatFoncier = recettesBrutes - chargesDeductibles;
    const fiscalAnnee = impotLocatifAnnee(regime === 'reel' || regime === 'sci-is' ? regime : 'micro-foncier', {
        annee,
        loyers: recettesBrutes,
        chargesHorsInterets: chargesDeductibles - case250,
        interets: case250,
        amortissementIS: amortissementSciIsBienAnnee(asset, annee),
    }, foyerAnnee(profileData, annee), etatFiscalInitial());
    let baseImposable = fiscalAnnee.baseImposable;
    let impots = fiscalAnnee.impot;
    // Impôt unique (chantier CF unique, étape 3) : celui de la timeline pour cette année et ce
    // régime (forfait 20 €, déficit reporté, amortissement SCI-IS compris), identique au CF affiché.
    if (!options.base) {
        const row = computeOwnedAssetTimeline(asset, profileData, regime, { horizonYear: annee }).years.find(y => y.year === annee);
        if (row) {
            impots = row.impotsAnnee;
            baseImposable = row.baseImposable;
        }
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
        taxeFonciereFrais: Math.round(taxeFonciereFrais),
        fraisEmprunt: Math.round(fraisEmprunt),
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
// 250 intérêts d'emprunt + assurance crédit + frais d'emprunt, 263 résultat par immeuble, 420 résultat
// total. Déficit (lignes 430-440 → 2042 cases 4BB/4BC) : voir repartirDeficitFoncier — corrigé le
// 2026-10-12 (B8, revue) : l'ancien code imputait les intérêts en dernier au lieu de les imputer en
// priorité sur les loyers, et reportait donc à tort toute la case 250 dès qu'il y avait un déficit.
// Ceci reste un calcul indicatif — cf. avertissement à afficher côté UI, ne remplace pas un professionnel.
const PLAFOND_DEFICIT_REVENU_GLOBAL = 10700;
const FORFAIT_FRAIS_GESTION_PAR_LOCAL = 20;

// SOURCE UNIQUE du résultat foncier réel d'un bien pour une année civile (bilan 2026-10-12, B8) :
// les cases de la 2044, lues sur computeCompteResultat. Réutilisée telle quelle par la déclaration
// 2044, le tableau des déficits reportables de la fiche (computeDeficitFoncierHistorique) et la
// projection « Impôts à venir » (creerContexteFoyer) — avant, les deux derniers relisaient
// computeOwnedAssetTimeline avec deux écarts : assurance emprunteur rangée hors intérêts (donc
// imputée sur les salaires) et forfait de 20 € (case 222) oublié.
function lignes2044Bien(asset, annee, profileData) {
    const cr = computeCompteResultat(asset, annee, profileData, 'reel', { base: true });
    const nbLocaux = (asset.lots && asset.lots.length) ? asset.lots.length : 1;
    const case211 = cr.recettesBrutes;
    const case221 = cr.gestionLocative;
    // Forfait de 20 €/local seulement pour un bien qui a produit des loyers dans l'année : sans
    // recette, pas de frais de gestion à forfaitiser (évite un déficit fictif de 20 €).
    const case222 = case211 > 0 ? FORFAIT_FRAIS_GESTION_PAR_LOCAL * nbLocaux : 0;
    const case223 = cr.assurancePNO;
    const case224 = cr.travauxDed;
    // Taxe foncière des charges + frais classés « taxe foncière » dans l'onglet Travaux (B9).
    const case227 = cr.taxeFonciere + cr.taxeFonciereFrais;
    const case229 = cr.chargesCopro;
    // Intérêts + assurance emprunteur + frais d'emprunt (garantie, courtage, dossier) : notice
    // 2044, ligne 250.
    const case250 = cr.interetsAnnee + cr.assuranceAnnee + cr.fraisEmprunt;
    const chargesHorsInterets = case221 + case222 + case223 + case224 + case227 + case229;
    const case263 = case211 - chargesHorsInterets - case250;
    return {
        assetId: asset.id, nom: asset.nom,
        case211, case221, case222, case223, case224, case227, case229, case250,
        chargesHorsInterets, case263: Math.round(case263),
    };
}

// Répartition d'un déficit foncier (art. 156 I 3° CGI, BOI-RFPI-BASE-30-20-10, notice 2044 lignes
// 420 à 440) : les intérêts d'emprunt et frais assimilés (case 250) s'imputent EN PRIORITÉ sur les
// loyers. Seule leur part non couverte, max(0, case 250 − loyers), forme le déficit « d'origine
// intérêts », reportable sur les revenus fonciers des 10 années suivantes. Le reste du déficit
// (autres charges) s'impute sur le revenu global dans la limite de 10 700 € ; l'excédent est
// reportable 10 ans. Retourne des zéros si le résultat n'est pas déficitaire.
function repartirDeficitFoncier(recettes, chargesHorsInterets, interets) {
    const deficit = chargesHorsInterets + interets - recettes;
    if (!(deficit > 0)) return { deficit: 0, imputableRevenuGlobal: 0, reportable: 0, partInterets: 0 };
    const partInterets = Math.max(0, interets - recettes);
    const imputableRevenuGlobal = Math.min(PLAFOND_DEFICIT_REVENU_GLOBAL, deficit - partInterets);
    return { deficit, imputableRevenuGlobal, reportable: deficit - imputableRevenuGlobal, partInterets };
}

export function computeDeclaration2044(assets, annee, profileData) {
    const lignes = assets.map(asset => lignes2044Bien(asset, annee, profileData));

    const totalRecettes = lignes.reduce((s, l) => s + l.case211, 0);
    const totalInterets = lignes.reduce((s, l) => s + l.case250, 0);
    const totalChargesHorsInterets = lignes.reduce((s, l) => s + l.chargesHorsInterets, 0);
    const case420 = Math.round(totalRecettes - totalChargesHorsInterets - totalInterets);

    let deficit = null;
    if (case420 < 0) {
        const rep = repartirDeficitFoncier(totalRecettes, totalChargesHorsInterets, totalInterets);
        deficit = {
            totalDeficit: Math.round(-case420),
            imputableRevenuGlobal: Math.round(rep.imputableRevenuGlobal),
            reportFoncier10ans: Math.round(rep.reportable),
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
export function computeRevenuFoncierPortefeuille(assets, annee, profileData, regime) {
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
        const lignes = assets.map(a => computeCompteResultat(a, annee, profileData, 'micro-foncier'));
        const revenuFoncierImposable = lignes.reduce((s, l) => s + l.baseImposable, 0);
        return { revenuFoncierImposable: Math.round(revenuFoncierImposable), lignes, isTotal: 0, deficit: null };
    }

    const decl = computeDeclaration2044(assets, annee, profileData);
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
export function computeDeficitFoncierHistorique(asset, profileData) {
    const currentYear = new Date().getFullYear();
    const { annee: anneeAchat } = parseDateAchat(asset.dateAchat);
    const EXPIRATION_ANS = DUREE_REPORT_DEFICIT_FONCIER;

    const lignes = []; // { annee, montantInitial, utilise } — ordre chronologique = ordre FIFO
    // Pas d'années projetées, seulement le vécu. Résultat de chaque année = celui de la 2044
    // (lignes2044Bien), réparti par la même règle (repartirDeficitFoncier) : le reportable créé ici
    // est celui de la case 439 de la déclaration.
    for (let y = anneeAchat; y <= currentYear; y++) {
        const l = lignes2044Bien(asset, y, profileData);
        const revenusNets = l.case263;

        if (revenusNets > 0) {
            let restantAAbsorber = revenusNets;
            for (const ligne of lignes) {
                if (restantAAbsorber <= 0) break;
                if (y - ligne.annee > EXPIRATION_ANS) continue; // déficit prescrit : imputable jusqu'en A+10 inclus
                const disponible = ligne.montantInitial - ligne.utilise;
                if (disponible <= 0) continue;
                const absorbe = Math.min(disponible, restantAAbsorber);
                ligne.utilise += absorbe;
                restantAAbsorber -= absorbe;
            }
        } else {
            const { reportable } = repartirDeficitFoncier(l.case211, l.chargesHorsInterets, l.case250);
            if (reportable > 0) lignes.push({ annee: y, montantInitial: reportable, utilise: 0 });
        }
    }

    const lignesFormatees = lignes.map(l => {
        const anciennete = currentYear - l.annee;
        return {
            annee: l.annee,
            montantInitial: Math.round(l.montantInitial),
            utilise: Math.round(l.utilise),
            restant: Math.round(Math.max(0, l.montantInitial - l.utilise)),
            // Dernière année d'imputation : le déficit de A sert sur les revenus de A+1 à A+10.
            expire: l.annee + EXPIRATION_ANS,
            expired: anciennete > EXPIRATION_ANS
        };
    });
    const stockTotal = lignesFormatees.filter(l => !l.expired).reduce((s, l) => s + l.restant, 0);

    return { lignes: lignesFormatees.sort((a, b) => b.annee - a.annee), stockTotal: Math.round(stockTotal) };
}

export function computePortfolioAlerts(assets, profileData, regime, revenusMensuels) {
    const REGIME_LABELS = { 'micro-foncier': 'Micro-foncier', 'reel': 'Foncier réel', 'sci-is': 'SCI-IS' };
    const alerts = [];
    const now = new Date();
    // Alertes CF/DSCR/régime optimal : taux courant, donc TMI de l'année en cours (comme
    // computeOwnedAssetCF). Le déficit foncier historique, lui, reçoit profileData directement
    // plus bas — il a besoin du TMI de chaque année passée, pas d'une seule valeur figée.
    const tmi = resolveTmiFoyer(profileData, now.getFullYear());

    const revenusBruts = computeRevenusLocatifsBruts(assets);
    if (revenusBruts > 15000 && regime === 'micro-foncier') {
        alerts.push({ type: 'fiscal', severity: 'error', msg: `Revenus fonciers ${Math.round(revenusBruts).toLocaleString('fr-FR')} €/an — Micro-foncier interdit (plafond 15 000 €)` });
    }

    const endettement = computeEndettementGlobal(assets, revenusMensuels);
    if (endettement.tauxEndettement > 35) {
        alerts.push({ type: 'dette', severity: 'warning', msg: `Taux d'endettement ${formatDecimalFr(endettement.tauxEndettement, 1)} % — dépasse le seuil HCSF (35 %)` });
    }

    for (const asset of assets) {
        const r = computeOwnedAssetCF(asset, { ...resolveScenarioCourant(asset).variables, regime }, tmi, null, profileData);

        if (r.cfNetNet < -100) {
            alerts.push({ type: 'cf', severity: 'error', assetId: asset.id, msg: `${asset.nom} — CF négatif : ${Math.round(r.cfNetNet).toLocaleString('fr-FR')} €/mois` });
        }
        if (r.dscr > 0 && r.dscr < 1) {
            alerts.push({ type: 'dscr', severity: 'error', assetId: asset.id, msg: `${asset.nom} — DSCR ${formatRatioFr(r.dscr)} : remboursement non couvert par les loyers` });
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
            const opt = getOptimalRegime(asset, tmi, profileData);
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

        // Déficit foncier reportable proche de sa prescription, calculé automatiquement
        // (computeDeficitFoncierHistorique). Le déficit de l'année A reste imputable jusqu'en A+10
        // inclus (la table « Déficits fonciers reportables » ne le marque « Expiré » qu'au-delà) :
        // alerte pendant ses trois dernières années d'imputation, avec l'année limite.
        for (const d of computeDeficitFoncierHistorique(asset, profileData).lignes) {
            const anciennete = now.getFullYear() - d.annee;
            if (d.restant > 0 && anciennete >= 8 && anciennete <= DUREE_REPORT_DEFICIT_FONCIER) {
                alerts.push({ type: 'deficit-expire', severity: 'warning', assetId: asset.id, msg: `${asset.nom} — Déficit foncier ${d.annee} : ${d.restant.toLocaleString('fr-FR')} € non imputés, imputables jusqu'en ${d.expire} seulement` });
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

export function computeSimulationTravaux(asset, montantTravaux, annee, deductible, profileData, regime) {
    const acq = asset.acquisition || {};
    const post = asset.postAchat || {};
    const credit = acq.credit || {};
    const { loyer, vacancePct } = resolveLoyerVacance(asset);
    // Même proratisation que computeOwnedAssetTimeline/computeCompteResultat : l'année d'achat ne
    // compte le loyer que depuis moisAchat, pas une année pleine — sinon la simulation surestime les
    // recettes de l'année d'achat alors qu'interetsAnnee/assuranceAnnee ci-dessous (tirés de
    // l'échéancier réel) sont déjà correctement partiels sur cette même année.
    const { annee: anneeAchat, mois: moisAchat } = parseDateAchat(asset.dateAchat);
    const { schedule } = computeAmortizationSchedule(credit.montant || 0, credit.taux || 0, credit.duree || 0, asset.dateAchat, credit.assurance || 0, credit.assuranceMode);

    // Flux fonciers d'une année civile. Proratisés l'année d'achat (moisPossedeAnnee), comme
    // computeOwnedAssetTimeline/computeCompteResultat/computeCFBreakdown.
    const fluxAnnee = y => {
        const moisPossedeAnnee = y === anneeAchat ? (13 - moisAchat) : (y < anneeAchat ? 0 : 12);
        const loyers = loyer * moisPossedeAnnee * (1 - vacancePct / 100);
        const yearRow = schedule.find(r => r.annee === y);
        const chargesHorsInterets = (post.taxeFonciere ?? 0) * moisPossedeAnnee / 12
            + (post.chargesCopro ?? 0) * moisPossedeAnnee
            + (post.assurancePNO ?? 0) * moisPossedeAnnee / 12
            + loyers * ((post.gestionLocative ?? 0) / 100);
        return { loyers, chargesHorsInterets, interets: (yearRow?.interets || 0) + (yearRow?.assurance || 0) };
    };

    let deficitCree = 0, economieFiscale3ans = 0;
    const applicable = deductible && regime === 'reel';

    if (applicable) {
        const f = fluxAnnee(annee);
        const resultatFoncier = f.loyers - f.chargesHorsInterets - f.interets - montantTravaux;
        if (resultatFoncier < 0) deficitCree = Math.abs(resultatFoncier);
        // Économie sur l'année des travaux et les deux suivantes : impôt SANS moins impôt AVEC,
        // mesurés au barème du foyer (différence d'impôts complets) avec prélèvements sociaux, report
        // du déficit et CSG déductible. L'ancien calcul (min(10 700, déficit) × TMI) ignorait la part
        // reportée, l'impôt évité sur le bénéfice qu'auraient dégagé les loyers, et les prélèvements.
        const etatSans = etatFiscalInitial();
        const etatAvec = etatFiscalInitial();
        for (let y = annee; y <= annee + 2; y++) {
            const fy = fluxAnnee(y);
            const foyer = foyerAnnee(profileData, y);
            const sans = impotLocatifAnnee('reel', { annee: y, ...fy }, foyer, etatSans).impot;
            const avec = impotLocatifAnnee('reel', {
                annee: y, ...fy,
                chargesHorsInterets: fy.chargesHorsInterets + (y === annee ? montantTravaux : 0),
            }, foyer, etatAvec).impot;
            economieFiscale3ans += sans - avec;
        }
    }

    const vars = resolveScenarioCourant(asset).variables;
    // cfBase = CF de référence (12 prochains mois, comme computeOwnedAssetCF partout ailleurs).
    const cfBase = computeOwnedAssetCF(asset, { ...vars, regime }, resolveTmiFoyer(profileData, new Date().getFullYear()), null, profileData);
    const impactCFMois = deductible && applicable ? -(montantTravaux / 12) + (economieFiscale3ans / 36) : -(montantTravaux / 12);
    const nouveauCFMois = cfBase.cfNetNet + impactCFMois;

    return { montantTravaux, deductible, regime, deficitCree: Math.round(deficitCree), economieFiscale3ans: Math.round(economieFiscale3ans), applicable, impactCFMois: Math.round(impactCFMois), cfBase: Math.round(cfBase.cfNetNet), nouveauCFMois: Math.round(nouveauCFMois) };
}

// ─── PROJECTION DES IMPÔTS DU FOYER (effet des travaux déductibles) ──────────
// « Si je fais ces travaux, combien d'impôts vais-je payer les années suivantes ? » Rejoue, au
// niveau du FOYER (tous les biens additionnés, comme sur la 2044), chaque année depuis le premier
// achat jusqu'à anneeDebut + horizon, en régime foncier réel simulé — seul régime où les travaux
// sont déductibles et où le déficit foncier existe, quel que soit le régime actuellement suivi
// (même convention que computeDeficitFoncierHistorique) :
//   - résultat foncier = loyers − charges déductibles − intérêts − travaux déductibles ;
//   - répartition du déficit = repartirDeficitFoncier (art. 156 I 3° CGI) : les intérêts (case 250)
//     s'imputent d'abord sur les loyers ; le reste du déficit s'impute sur le revenu global
//     (salaires) jusqu'à 10 700 €/an (« déduction des salaires ») ;
//   - excédent au-delà du plafond + part des intérêts non couverte par les loyers : reportés sur les
//     revenus fonciers des 10 années suivantes, par ordre d'ancienneté (« déduction des loyers ») ;
//   - impôt de l'année = IR au barème progressif du foyer + prélèvements sociaux 17,2 % sur le
//     revenu foncier imposable (computeImpotFoyer, revenu salarial historisé de l'année).
// Deux scénarios sont calculés avec le même moteur : « avec » (travaux déductibles saisis à partir
// de anneeDebut + travaux simulés optionnels) et « sans » (aucun travaux à partir de anneeDebut).
// Les travaux antérieurs à anneeDebut sont acquis dans les deux : l'économie affichée n'est due
// qu'aux travaux à venir. Les années < anneeDebut servent à reconstituer le stock de report et ne
// sont pas renvoyées.
//
// Limites assumées (affichées en UI) : l'imputation sur le revenu global suppose la location
// maintenue 3 ans ; un déficit global (salaires < 10 700 €) n'est pas reporté. La projection dit ce
// que donnerait le régime réel ; la comparaison avec le micro-foncier et la SCI à l'IS est faite par
// computeProjectionRegimesFoyer (plus bas), l'optimisation du calendrier des travaux par
// computeOptimisationTravaux — tous trois partagent creerContexteFoyer / rejouerFoncierReel.
// Le déficit de l'année A s'impute sur les revenus des dix années suivantes : jusqu'en A+10 inclus,
// perdu en A+11. L'ancienne règle le perdait dès A+10, un an trop tôt.
const DEFICIT_FONCIER_EXPIRATION_ANS = DUREE_REPORT_DEFICIT_FONCIER;


const composantesVides = () => ({ loyers: 0, chargesHorsTravaux: 0, forfaitGestion: 0, interets: 0, travaux: 0 });

// Composantes brutes agrégées par année civile, tous biens confondus (régime réel simulé). Factorisé
// pour que computeOptimisationTravaux / computeProjectionRegimesFoyer rejouent plusieurs scénarios
// sur les mêmes données sans recalculer chaque bien. Chaque année d'un bien vient de
// lignes2044Bien (source unique, B8) : loyers = case 211, charges hors travaux = cases 221 à 229
// sauf 224 (forfait 20 € de la case 222 compris, isolé dans forfaitGestion pour la SCI à l'IS),
// travaux = case 224, intérêts = case 250 (intérêts + assurance emprunteur + frais d'emprunt).
function creerContexteFoyer(assets, profileData, anneeDebut, anneeFin) {
    const list = (assets || []).filter(a => a && (a.acquisition?.prix || 0) > 0);
    const parAnnee = new Map();
    let anneeMin = anneeDebut;
    for (const asset of list) {
        const { annee: anneeAchat } = parseDateAchat(asset.dateAchat);
        anneeMin = Math.min(anneeMin, anneeAchat);
        for (let y = anneeAchat; y <= anneeFin; y++) {
            const l = lignes2044Bien(asset, y, profileData);
            const agg = parAnnee.get(y) || composantesVides();
            agg.loyers += l.case211;
            agg.chargesHorsTravaux += l.chargesHorsInterets - l.case224;
            agg.forfaitGestion += l.case222;
            agg.interets += l.case250;
            agg.travaux += l.case224;
            parAnnee.set(y, agg);
        }
    }
    const foyer = { adults: profileData?.adults || 2, children: profileData?.children || 0 };
    return { list, parAnnee, anneeMin, anneeDebut, anneeFin, profileData, foyer };
}

// Travaux simulés : un objet { assetId, montant, annee } ou un tableau de ces objets (chantier étalé).
// Les montants nuls sont écartés.
function normaliserTravauxSimules(raw, anneeDebut) {
    const liste = Array.isArray(raw) ? raw : (raw ? [raw] : []);
    return liste
        .filter(s => s && Number(s.montant) > 0)
        .map(s => ({ assetId: s.assetId ?? null, montant: Number(s.montant), annee: Math.round(Number(s.annee)) || anneeDebut }));
}

// Montant simulé par année, limité à [anneeDebut, anneeFin] : un chantier passé n'est pas « à venir ».
function simulesParAnnee(simules, anneeDebut, anneeFin) {
    const map = new Map();
    for (const s of simules) {
        if (s.annee < anneeDebut || s.annee > anneeFin) continue;
        map.set(s.annee, (map.get(s.annee) || 0) + s.montant);
    }
    return map;
}

// Rejoue le régime foncier réel du foyer depuis le premier achat (voir le bloc de commentaire de
// computeProjectionImpotsFoyer pour les règles). `travauxFutursSaisis` : garder ou non les travaux
// saisis à partir de anneeDebut ; `simules` : Map année → montant simulé. Lignes non arrondies.
function rejouerFoncierReel(ctx, { travauxFutursSaisis = true, simules = new Map() } = {}) {
    const { parAnnee, anneeMin, anneeDebut, anneeFin, profileData, foyer } = ctx;
    const stock = []; // { annee, restant } — ordre chronologique = ordre FIFO
    let csgDeductible = 0;
    const rows = [];
    for (let y = anneeMin; y <= anneeFin; y++) {
        const agg = parAnnee.get(y) || composantesVides();
        const projete = y >= anneeDebut;
        const travauxSaisis = projete && !travauxFutursSaisis ? 0 : agg.travaux;
        const travauxSimules = projete ? (simules.get(y) || 0) : 0;
        const travaux = travauxSaisis + travauxSimules;

        // Les reports de plus de 10 ans ne sont plus imputables : ce qui en reste est perdu cette année.
        const deficitPerdu = stock
            .filter(l => y - l.annee === DEFICIT_FONCIER_EXPIRATION_ANS + 1)
            .reduce((s, l) => s + l.restant, 0);
        const stockActif = stock.filter(l => y - l.annee <= DEFICIT_FONCIER_EXPIRATION_ANS && l.restant > 0);

        const resultatAvantInterets = agg.loyers - agg.chargesHorsTravaux - travaux;
        const resultatFoncier = resultatAvantInterets - agg.interets;

        let imputeRevenuGlobal = 0, reportUtilise = 0, deficitReporte = 0, revenuFoncierImposable = 0;
        if (resultatFoncier > 0) {
            let reste = resultatFoncier;
            for (const l of stockActif) {
                if (reste <= 0) break;
                const absorbe = Math.min(l.restant, reste);
                l.restant -= absorbe;
                reste -= absorbe;
                reportUtilise += absorbe;
            }
            revenuFoncierImposable = reste;
        } else if (resultatFoncier < 0) {
            const rep = repartirDeficitFoncier(agg.loyers, agg.chargesHorsTravaux + travaux, agg.interets);
            imputeRevenuGlobal = rep.imputableRevenuGlobal;
            deficitReporte = rep.reportable;
            if (deficitReporte > 0) stock.push({ annee: y, restant: deficitReporte });
        }
        const stockFin = stock
            .filter(l => y - l.annee <= DEFICIT_FONCIER_EXPIRATION_ANS)
            .reduce((s, l) => s + l.restant, 0);

        const revenuSalarial = resolveRevenuFoyer(profileData, y);
        // CSG déductible née du revenu foncier imposé l'an passé : déduite du revenu global de l'année.
        const impot = computeImpotFoyer(revenuSalarial - csgDeductible, revenuFoncierImposable - imputeRevenuGlobal, foyer);
        const csgDeductibleImputee = csgDeductible;
        csgDeductible = revenuFoncierImposable * CSG_DEDUCTIBLE_RATE;
        const impotSalairesSeuls = computeImpotFoyer(revenuSalarial, 0, foyer).total;

        rows.push({
            annee: y,
            loyers: agg.loyers, chargesHorsTravaux: agg.chargesHorsTravaux, forfaitGestion: agg.forfaitGestion, interets: agg.interets,
            travaux, travauxSaisis, travauxSimules,
            resultatFoncier, imputeRevenuGlobal, reportUtilise, deficitReporte, deficitPerdu, stockFin,
            revenuFoncierImposable, revenuSalarial, csgDeductibleImputee,
            irNet: impot.irNet, psFoncier: impot.psFoncier, impotTotal: impot.total, impotSalairesSeuls,
        });
    }
    return rows;
}

export function computeProjectionImpotsFoyer(assets, profileData, options = {}) {
    const currentYear = new Date().getFullYear();
    const anneeDebut = Math.round(Number(options.anneeDebut)) || currentYear;
    const horizon = Math.max(1, Math.min(30, Math.round(Number(options.horizon)) || 10));
    const anneeFin = anneeDebut + horizon;

    const simules = normaliserTravauxSimules(options.travauxSimules, anneeDebut);
    const ctx = creerContexteFoyer(assets, profileData, anneeDebut, anneeFin);
    const simMap = simulesParAnnee(simules, anneeDebut, anneeFin);

    // Deux scénarios par le même moteur : « avec » (travaux saisis à venir + simulés) et « sans »
    // (aucun travaux à partir de anneeDebut).
    const avec = rejouerFoncierReel(ctx, { travauxFutursSaisis: true, simules: simMap });
    const sans = rejouerFoncierReel(ctx, { travauxFutursSaisis: false });
    const sansParAnnee = new Map(sans.map(r => [r.annee, r]));
    const rd = v => Math.round(v);

    const years = avec.filter(r => r.annee >= anneeDebut).map(r => {
        const s = sansParAnnee.get(r.annee);
        const out = {};
        for (const [k, v] of Object.entries(r)) out[k] = typeof v === 'number' ? rd(v) : v;
        out.impotSansTravaux = rd(s.impotTotal);
        out.economie = rd(s.impotTotal) - rd(r.impotTotal);
        // Ce que l'immobilier ajoute (> 0) ou retire (< 0, année de déficit) à l'impôt du foyer par
        // rapport à l'impôt sur les seuls salaires.
        out.effetFoncier = out.impotTotal - out.impotSalairesSeuls;
        return out;
    });

    const veille = avec.find(r => r.annee === anneeDebut - 1);
    const stockInitial = rd(veille ? veille.stockFin : 0);
    const somme = key => rd(years.reduce((s, r) => s + r[key], 0));

    // Synthèse pour la phrase d'accroche de l'UI : moyenne, année la plus chère (à égalité, la plus
    // tôt), première année où le report de déficit tombe à zéro (épuisé ou expiré) — null si aucun
    // report n'existait ou s'il dure au-delà de l'horizon.
    let anneeMax = years[0].annee, impotMax = years[0].impotTotal;
    for (const r of years) if (r.impotTotal > impotMax) { impotMax = r.impotTotal; anneeMax = r.annee; }
    let anneeFinReport = null, stockPrec = stockInitial;
    for (const r of years) {
        if (stockPrec > 0 && r.stockFin === 0) { anneeFinReport = r.annee; break; }
        stockPrec = r.stockFin;
    }

    return {
        anneeDebut, anneeFin, horizon,
        regimeSimule: 'reel',
        nbBiens: ctx.list.length,
        plafondRevenuGlobal: PLAFOND_DEFICIT_REVENU_GLOBAL,
        expirationAns: DEFICIT_FONCIER_EXPIRATION_ANS,
        stockInitial,
        // Forme reçue conservée : objet unique (historique) ou tableau (chantier étalé).
        travauxSimules: Array.isArray(options.travauxSimules) ? simules : (simules[0] || null),
        years,
        synthese: {
            impotMoyen: Math.round(years.reduce((s, r) => s + r.impotTotal, 0) / years.length),
            anneeMax, impotMax, anneeFinReport,
        },
        totaux: {
            travaux: somme('travaux'),
            travauxSimules: somme('travauxSimules'),
            imputeRevenuGlobal: somme('imputeRevenuGlobal'),
            reportUtilise: somme('reportUtilise'),
            deficitPerdu: somme('deficitPerdu'),
            impotAvec: somme('impotTotal'),
            impotSans: somme('impotSansTravaux'),
            economie: somme('economie'),
        },
    };
}

// ─── QUAND FAIRE LES TRAVAUX ? (année de départ × étalement) ─────────────────
// Pour un montant de travaux déductibles, compare l'économie d'impôt du foyer de chaque option
// { départ Y dans la fenêtre } × { en une fois, sur 2 ans, sur 3 ans en parts égales }. Toutes les
// options sont rejouées par le moteur réel sur la MÊME fenêtre de calcul [anneeDebut, anneeDebut +
// fenetre − 1 + horizon] : la dernière option a encore `horizon` années pour consommer son report,
// la comparaison est équitable. Économie = impôt cumulé sans travaux simulés − impôt cumulé avec
// l'option ; les travaux déjà saisis sont présents dans les deux.
//
// Ce qui départage les options : la part du déficit déduite des salaires n'économise que l'IR,
// la part reportée sur les loyers économise IR + prélèvements sociaux mais peut expirer (10 ans).
// Non actualisé : un euro économisé dans 5 ans compte comme un euro aujourd'hui.
export function computeOptimisationTravaux(assets, profileData, options = {}) {
    const currentYear = new Date().getFullYear();
    const anneeDebut = Math.round(Number(options.anneeDebut)) || currentYear;
    const fenetre = Math.max(1, Math.min(10, Math.round(Number(options.fenetre)) || 5));
    const horizon = Math.max(1, Math.min(30, Math.round(Number(options.horizon)) || 10));
    const montant = Math.max(0, Number(options.montant) || 0);
    const assetId = options.assetId ?? null;
    const anneeFinCalcul = anneeDebut + fenetre - 1 + horizon;
    const resultat = { anneeDebut, anneeFinCalcul, fenetre, horizon, montant, assetId };
    if (!montant) return { ...resultat, options: [], meilleure: null };

    const ctx = creerContexteFoyer(assets, profileData, anneeDebut, anneeFinCalcul);
    const cumul = (rows, key) => rows.filter(r => r.annee >= anneeDebut).reduce((s, r) => s + Math.round(r[key]), 0);
    const impotBase = cumul(rejouerFoncierReel(ctx, { travauxFutursSaisis: true }), 'impotTotal');

    const opts = [];
    for (const etalement of [1, 2, 3]) {
        for (let y = anneeDebut; y + etalement - 1 <= anneeDebut + fenetre - 1; y++) {
            const annees = Array.from({ length: etalement }, (_, k) => y + k);
            const sim = new Map(annees.map(a => [a, montant / etalement]));
            const rows = rejouerFoncierReel(ctx, { travauxFutursSaisis: true, simules: sim });
            const impotTotal = cumul(rows, 'impotTotal');
            const economie = impotBase - impotTotal;
            opts.push({
                annee: y, etalement, annees,
                montantParAn: Math.round(montant / etalement),
                economie,
                parEuro: Math.round((economie / montant) * 100) / 100,
                imputeRevenuGlobal: cumul(rows, 'imputeRevenuGlobal'),
                deficitPerdu: cumul(rows, 'deficitPerdu'),
                impotTotal,
            });
        }
    }

    // Meilleure : parmi les options « équivalentes » (à moins de max(50 €, 1 %) de l'économie maximale
    // — en deçà, l'écart est du bruit de modélisation sur 15 ans, pas un vrai avantage), la plus tôt
    // puis la moins étalée : à économie égale, mieux vaut un chantier simple et réalisé tôt.
    const ecoMax = Math.max(...opts.map(o => o.economie));
    const tolerance = Math.max(50, Math.abs(ecoMax) * 0.01);
    for (const o of opts) o.equivalente = ecoMax - o.economie <= tolerance;
    const meilleure = opts.filter(o => o.equivalente).reduce((best, o) => {
        if (!best) return o;
        if (o.annee !== best.annee) return o.annee < best.annee ? o : best;
        return o.etalement < best.etalement ? o : best;
    }, null);

    return { ...resultat, impotSansTravauxSimules: impotBase, tolerance: Math.round(tolerance), economieMax: ecoMax, options: opts, meilleure };
}

// ─── QUEL RÉGIME DANS LE TEMPS ? ─────────────────────────────────────────────
// Impôt total du FOYER année par année pour chacun des trois régimes, chaque régime étant supposé
// appliqué depuis le premier achat (même convention que la projection réelle, qui rejoue le déficit
// depuis l'achat) :
//   - micro-foncier : revenu foncier imposable = 70 % des loyers (abattement 30 %), sans déficit ni
//     travaux ; `eligible` = loyers du foyer ≤ 15 000 € cette année-là ;
//   - réel : exactement rejouerFoncierReel (travaux saisis + simulés) ;
//   - SCI à l'IS : une SCI unique détenant tous les biens, aucun dividende distribué. Résultat =
//     loyers − charges − intérêts − travaux déductibles − amortissement (80 % du prix / 30 ans, même
//     convention que computeAnnualTaxEstimate, proratisé l'année d'achat) ; déficit reporté sans
//     limite de durée ; IS 15 % jusqu'à 42 500 € puis 25 %. Impôt du foyer = IR sur salaires seuls
//     + IS de la société (les loyers ne passent plus par l'IR du foyer).
// Limites (affichées en UI) : frais de structure de la SCI, coût de transfert des biens existants,
// fiscalité des dividendes et de sortie non modélisés ; on compare l'impôt, pas le cash-flow.
// PLAFOND_MICRO_FONCIER : voir le moteur fiscal annuel, en tête de fichier.
const REGIMES_ORDRE = ['micro-foncier', 'reel', 'sci-is'];

export function computeProjectionRegimesFoyer(assets, profileData, options = {}) {
    const currentYear = new Date().getFullYear();
    const anneeDebut = Math.round(Number(options.anneeDebut)) || currentYear;
    const horizon = Math.max(1, Math.min(30, Math.round(Number(options.horizon)) || 10));
    const anneeFin = anneeDebut + horizon;

    const ctx = creerContexteFoyer(assets, profileData, anneeDebut, anneeFin);
    const simMap = simulesParAnnee(normaliserTravauxSimules(options.travauxSimules, anneeDebut), anneeDebut, anneeFin);
    const reelRows = rejouerFoncierReel(ctx, { travauxFutursSaisis: true, simules: simMap });

    // Amortissement de l'immeuble par année civile, tous biens confondus : même dotation que le
    // cash-flow d'un bien (amortissementSciIsBienAnnee, frais d'acquisition compris).
    const amortParAnnee = new Map();
    for (const asset of ctx.list) {
        const { annee: anneeAchat } = parseDateAchat(asset.dateAchat);
        for (let y = anneeAchat; y <= anneeFin; y++) {
            amortParAnnee.set(y, (amortParAnnee.get(y) || 0) + amortissementSciIsBienAnnee(asset, y));
        }
    }

    const years = [];
    let reportIS = 0;
    let csgMicro = 0; // CSG déductible du micro-foncier, imputée l'année suivante
    for (const r of reelRows) {
        const amortissement = amortParAnnee.get(r.annee) || 0;
        // Charges réelles seulement : le forfait de 20 €/local (case 222) est propre aux revenus
        // fonciers, une SCI à l'IS déduit ses frais réels.
        const resultat = r.loyers - (r.chargesHorsTravaux - r.forfaitGestion) - r.interets - r.travaux - amortissement;
        let is = 0;
        if (resultat > 0) {
            const absorbe = Math.min(reportIS, resultat);
            reportIS -= absorbe;
            const assiette = resultat - absorbe;
            is = impotSocieteIS(assiette);
        } else {
            reportIS += -resultat;
        }
        const microImposable = r.loyers * 0.7;
        const csgMicroImputee = csgMicro;
        csgMicro = microImposable * CSG_DEDUCTIBLE_RATE;
        if (r.annee < anneeDebut) continue;

        const microImpot = computeImpotFoyer(r.revenuSalarial - csgMicroImputee, microImposable, ctx.foyer).total;
        years.push({
            annee: r.annee,
            revenuSalarial: Math.round(r.revenuSalarial),
            loyers: Math.round(r.loyers),
            impotSalairesSeuls: r.impotSalairesSeuls,
            micro: { impot: microImpot, revenuImposable: Math.round(microImposable), eligible: r.loyers <= PLAFOND_MICRO_FONCIER },
            reel: { impot: r.impotTotal, revenuImposable: Math.round(r.revenuFoncierImposable - r.imputeRevenuGlobal) },
            sciIs: {
                resultat: Math.round(resultat),
                amortissement: Math.round(amortissement),
                is: Math.round(is),
                deficitReporte: Math.round(reportIS),
                impot: r.impotSalairesSeuls + Math.round(is),
            },
        });
    }

    const totaux = {
        'micro-foncier': years.reduce((s, y) => s + y.micro.impot, 0),
        'reel': years.reduce((s, y) => s + y.reel.impot, 0),
        'sci-is': years.reduce((s, y) => s + y.sciIs.impot, 0),
    };
    const microEligible = years.every(y => y.micro.eligible);
    // À égalité, l'ordre REGIMES_ORDRE départage (le plus simple d'abord).
    let meilleur = null;
    for (const regime of REGIMES_ORDRE) {
        if (regime === 'micro-foncier' && !microEligible) continue;
        if (meilleur === null || totaux[regime] < totaux[meilleur]) meilleur = regime;
    }

    return {
        anneeDebut, anneeFin, horizon,
        nbBiens: ctx.list.length,
        plafondMicro: PLAFOND_MICRO_FONCIER,
        years, totaux, microEligible, meilleur,
    };
}
