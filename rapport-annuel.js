// Rapport annuel du portefeuille (modale « Rapport annuel » du dashboard, bouton Copier).
//
// Module pur (aucun accès DOM/window/localStorage, testable sous Node — tests/test_rapport_annuel.mjs) :
//   buildRapportAnnuelData(assets, annee, { profileData, regime, tmi }) → modèle de données
//   buildRapportAnnuelTexte(data) → texte brut (affiché dans un <pre> après escapeHtml, copiable)
//
// Bilan 2026-10-12 (B7) : le texte précédent, construit dans owned-portfolio.js, affichait
// « --962 € » (signe préfixé sur une valeur déjà négative), « -0 € » de CRD (CRD lu dans
// computePatrimoineNet, qui renvoie null sans valeur estimée), « Patrimoine net : 0 € » et comptait
// les intérêts à la fois dans les charges (montants fiscaux) et dans les mensualités. Ici :
//   - bloc TRÉSORERIE : loyers, charges payées, mensualités payées, frais ponctuels payés cash,
//     impôt → la somme des lignes = CF de l'année (computeOwnedAssetTimeline) ;
//   - bloc FISCAL (computeCompteResultat), selon le régime : réel → recettes, charges déductibles
//     (dont intérêts), résultat foncier ; micro-foncier → recettes, abattement 30 %, base 70 % ;
//     SCI-IS → base non calculée (amortissement non géré, comme la modale Déclaration) ;
//   - CRD = échéancier à la fin de l'année du rapport ; patrimoine « non renseigné » sans valeur ;
//   - chaque CF dit sa base (année civile ÷ 12, ou rythme actuel du mois en cours).
import {
    computeOwnedAssetCF, computeOwnedAssetTimeline, computeCompteResultat,
    computeAmortizationSchedule, parseDateAchat, resolveScenarioCourant
} from './calculs.js';

const REGIME_LABELS = { 'micro-foncier': 'Micro-foncier', 'reel': 'Foncier réel', 'sci-is': 'SCI-IS' };

// CRD à la fin de l'année civile `annee` (échéancier réel, départ au mois d'achat).
function crdFinAnnee(asset, annee) {
    const credit = asset.acquisition?.credit || {};
    const montant = credit.montant || 0;
    if (!(montant > 0) || !(credit.duree > 0)) return 0;
    const { schedule } = computeAmortizationSchedule(montant, credit.taux || 0, credit.duree, asset.dateAchat, credit.assurance || 0, credit.assuranceMode);
    if (!schedule.length) return 0;
    const row = schedule.find(r => r.annee === annee);
    if (row) return row.crdFin;
    return annee > schedule[schedule.length - 1].annee ? 0 : montant;
}

export function buildRapportAnnuelData(assets, annee, { profileData = {}, regime = 'micro-foncier', tmi = 0 } = {}) {
    const tresorerie = { loyers: 0, charges: 0, mensualites: 0, fraisPonctuels: 0, impots: 0, cfAnnuel: 0 };
    const fiscal = { recettes: 0, chargesDeductibles: 0, interetsEtAssurance: 0, resultatFoncier: 0, baseImposable: 0 };
    const patrimoine = { valeurTotale: 0, crdTotal: 0, patrimoineNet: null, nbValorises: 0, nbBiens: 0 };
    const biens = [];
    let nbPosterieurs = 0;

    for (const asset of assets || []) {
        const { annee: anneeAchat, mois: moisAchat } = parseDateAchat(asset.dateAchat);
        if (anneeAchat > annee) { nbPosterieurs++; continue; }

        const row = computeOwnedAssetTimeline(asset, profileData, regime).years.find(y => y.year === annee);
        if (row) {
            tresorerie.loyers += row.loyersAnnuels;
            tresorerie.charges += row.chargesAnneeBase;
            tresorerie.mensualites += row.debtService;
            tresorerie.fraisPonctuels += row.travauxCashAnnee;
            tresorerie.impots += row.impotsAnnee;
            tresorerie.cfAnnuel += row.cfAnnuel;
        }

        const cr = computeCompteResultat(asset, annee, profileData, regime);
        fiscal.recettes += cr.recettesBrutes;
        fiscal.chargesDeductibles += cr.chargesDeductibles;
        // Case 250 : intérêts + assurance emprunteur + frais d'emprunt (garantie, courtage, dossier).
        fiscal.interetsEtAssurance += cr.interetsAnnee + cr.assuranceAnnee + cr.fraisEmprunt;
        fiscal.resultatFoncier += cr.resultatFoncier;
        fiscal.baseImposable += cr.baseImposable;

        const crd = crdFinAnnee(asset, annee);
        const valeur = asset.acquisition?.valeurEstimee || 0;
        patrimoine.nbBiens++;
        patrimoine.crdTotal += crd;
        if (valeur > 0) {
            patrimoine.valeurTotale += valeur;
            patrimoine.patrimoineNet = (patrimoine.patrimoineNet || 0) + (valeur - crd);
            patrimoine.nbValorises++;
        }

        const courant = computeOwnedAssetCF(asset, { ...resolveScenarioCourant(asset).variables, regime }, tmi);
        biens.push({
            nom: asset.nom || 'Bien sans nom',
            cfAnnee: row ? row.cfAnnuel : 0,
            moisDetenus: annee === anneeAchat ? 13 - moisAchat : 12,
            cfRythmeActuel: courant.cfNetNet,
            rentaBrute: courant.rentaBrute,
            patrimoineNet: valeur > 0 ? valeur - crd : null
        });
    }

    tresorerie.lignes = [
        { label: 'Loyers encaissés', montant: tresorerie.loyers },
        { label: 'Charges payées (TF, copro, PNO, gestion)', montant: -tresorerie.charges },
        { label: 'Mensualités payées (capital, intérêts, ass.)', montant: -tresorerie.mensualites },
        { label: 'Frais ponctuels payés (non financés)', montant: -tresorerie.fraisPonctuels },
        { label: 'Impôt estimé', montant: -tresorerie.impots }
    ];

    return { annee, regime, regimeLabel: REGIME_LABELS[regime] || regime, tresorerie, fiscal, patrimoine, biens, nbPosterieurs };
}

// ─── Texte ───────────────────────────────────────────────────────────────────

const _nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const _nf1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1, minimumFractionDigits: 1 });

// Montant arrondi avec UN seul signe (jamais « --962 », jamais « -0 »).
function eur(v) {
    const n = Math.round(Number(v) || 0);
    return `${n < 0 ? '-' : ''}${_nf0.format(Math.abs(n))} €`;
}
function eurSigned(v) {
    const n = Math.round(Number(v) || 0);
    return `${n > 0 ? '+' : n < 0 ? '-' : ''}${_nf0.format(Math.abs(n))} €`;
}
const ligne = (label, valeur) => `  ${label.padEnd(46)}: ${valeur}`;

export function buildRapportAnnuelTexte(data) {
    const { annee, tresorerie: t, fiscal: f, patrimoine: p, biens } = data;
    const SEP = '═══════════════════════════════════════════════════════════';
    if (!biens.length) {
        return `${SEP}\n  RAPPORT PORTEFEUILLE — ${annee}\n${SEP}\n\nAucun bien détenu en ${annee}.${data.nbPosterieurs ? ` (${data.nbPosterieurs} bien${data.nbPosterieurs > 1 ? 's' : ''} acquis après ${annee}.)` : ''}`;
    }

    const L = [SEP, `  RAPPORT PORTEFEUILLE — ${annee}`, SEP, ''];

    L.push('PATRIMOINE');
    L.push(ligne('Valeur estimée totale', p.nbValorises ? eur(p.valeurTotale) : 'non renseignée'));
    L.push(ligne(`Capital restant dû (fin ${annee})`, eur(-p.crdTotal)));
    L.push(ligne('Patrimoine net', p.patrimoineNet === null
        ? 'non renseigné'
        : `${eur(p.patrimoineNet)}${p.nbValorises < p.nbBiens ? ` (${p.nbValorises}/${p.nbBiens} biens valorisés)` : ''}`));
    L.push('');

    L.push(`TRÉSORERIE ${annee} (ce qui est réellement entré et sorti)`);
    for (const l of t.lignes) {
        const suffixe = /Impôt/.test(l.label) && Math.round(l.montant) > 0 ? ' (économie)' : '';
        L.push(ligne(l.label, `${eurSigned(l.montant)}${suffixe}`));
    }
    L.push(ligne(`= CF net-net de l'année ${annee}`, eurSigned(t.cfAnnuel)));
    L.push(ligne('CF net-net mensuel moyen (année ÷ 12)', `${eurSigned(t.cfAnnuel / 12)}/mois`));
    L.push('');

    L.push(`FISCAL ${annee} (déclaration, régime ${data.regimeLabel})`);
    if (data.regime === 'micro-foncier') {
        // Micro-foncier : aucune charge réelle (ni intérêts) n'est déductible, l'abattement
        // forfaitaire de 30 % les remplace ; base imposable = 70 % des recettes.
        L.push(ligne('Recettes brutes', eur(f.recettes)));
        L.push(ligne('Abattement forfaitaire 30 %', eur(-f.recettes * 0.3)));
        L.push(ligne('Base imposable (70 % des recettes)', eur(f.recettes * 0.7)));
        L.push('  En micro-foncier, les charges réelles et les intérêts ne sont pas déductibles (abattement forfaitaire).');
    } else if (data.regime === 'sci-is') {
        // SCI-IS : comme la modale Déclaration fiscale, pas de base chiffrée sans l'amortissement
        // comptable de l'immeuble, que l'application ne calcule pas.
        L.push(ligne('Recettes brutes', eur(f.recettes)));
        L.push(ligne('Base imposable', "non calculée par l'application"));
        L.push("  SCI-IS : le résultat imposable (formulaire 2065 et liasse comptable) dépend de l'amortissement");
        L.push("  comptable de l'immeuble, que l'application ne calcule pas ; un expert-comptable est recommandé.");
    } else {
        L.push(ligne('Recettes brutes', eur(f.recettes)));
        L.push(ligne('Charges déductibles', eur(-f.chargesDeductibles)));
        L.push(ligne("  dont intérêts et assurance d'emprunt", eur(-f.interetsEtAssurance)));
        L.push(ligne('Résultat foncier (recettes − charges)', eurSigned(f.resultatFoncier)));
        L.push(ligne(`Base imposable (${data.regimeLabel})`, eur(f.baseImposable)));
        L.push('  Les intérêts figurent ici comme charge déductible ; en trésorerie, ils sont dans les mensualités.');
    }
    L.push('');

    L.push('PAR BIEN');
    for (const b of biens) {
        const detention = b.moisDetenus < 12 ? ` (détenu ${b.moisDetenus} mois)` : '';
        L.push(`  ${String(b.nom)}`);
        L.push(`    CF ${annee} : ${eurSigned(b.cfAnnee)}${detention} │ CF au rythme actuel : ${eurSigned(b.cfRythmeActuel)}/mois`);
        L.push(`    Rdt brut : ${_nf1.format(b.rentaBrute || 0)} % │ Patrimoine net : ${b.patrimoineNet === null ? 'non renseigné' : eur(b.patrimoineNet)}`);
    }
    if (data.nbPosterieurs) {
        L.push(`  (${data.nbPosterieurs} bien${data.nbPosterieurs > 1 ? 's' : ''} acquis après ${annee}, non inclus)`);
    }
    L.push('');
    L.push(`  « CF au rythme actuel » : mois en cours (loyer, mensualité et frais de l'année en cours), régime ${data.regimeLabel}.`);
    L.push(SEP);
    return L.join('\n');
}
