import assert from 'node:assert/strict';
import { computeOwnedAssetTimeline, computeAmortizationSchedule, computeCompteResultat } from '../calculs.js';
import { buildRapportAnnuelData, buildRapportAnnuelTexte } from '../rapport-annuel.js';

// Rapport annuel du portefeuille (bilan 2026-10-12, B7) : signes (« --962 € »), CRD réel au lieu de
// « -0 € », patrimoine « non renseigné », blocs Trésorerie (somme = CF de l'année) et Fiscal
// (intérêts dans les charges déductibles seulement), CF libellés par leur base.

const Y = new Date().getFullYear();
const A = Y - 1; // année du rapport testée : année d'achat, détention partielle (5 mois)
const profileData = { income: 60000, adults: 2, children: 2, revenuHistorique: [] };

function makeAsset(overrides = {}) {
    return {
        id: 'b1', nom: '70 rue du Test',
        dateAchat: `${A}-08`,
        acquisition: {
            prix: 85000, fraisAgence: 0, fraisNotaire: 7000, loyerInitial: 675, surface: 50, typeBien: 'appartement',
            credit: { montant: 94182, duree: 25, taux: 4, assurance: 0.485, assuranceMode: 'crd' }
        },
        postAchat: {
            taxeFonciere: 342, chargesCopro: 0, gestionLocative: 0, assurancePNO: 69, vacance: 0,
            travaux: [
                { id: 't1', date: `${A}-09-10`, description: 'Rénovation', montant: 11521, tag: 'deductible', financeParCredit: true },
                { id: 't2', date: `${A}-08-20`, description: 'Courtage', montant: 1250, tag: 'non-deductible', financeParCredit: false }
            ],
            chargesAnnuelles: [], notes: []
        },
        scenarios: [{ id: 'realiste', nom: 'Réaliste', variables: { vacance: 5, regime: 'reel' } }],
        ...overrides
    };
}

const opts = { profileData, regime: 'reel', tmi: 30 };

// --- Test 1 : bloc Trésorerie = CF de l'année (timeline), lignes qui s'additionnent ---
{
    const asset = makeAsset();
    const data = buildRapportAnnuelData([asset], A, opts);
    const row = computeOwnedAssetTimeline(asset, profileData, 'reel').years.find(y => y.year === A);
    const t = data.tresorerie;
    assert.ok(Math.abs(t.cfAnnuel - row.cfAnnuel) < 0.01, 'CF de l\'année = timeline');
    const somme = t.lignes.reduce((s, l) => s + l.montant, 0);
    assert.ok(Math.abs(somme - t.cfAnnuel) < 0.01, `somme des lignes trésorerie (${somme}) = CF annuel (${t.cfAnnuel})`);
    assert.equal(Math.round(t.lignes[0].montant), 675 * 5, 'loyers proratisés sur les 5 mois détenus (vacance Exploitation 0 %)');
    const mens = t.lignes.find(l => /Mensualités/.test(l.label));
    assert.ok(Math.abs(-mens.montant - row.debtService) < 0.01, 'mensualités = échéances réellement payées dans l\'année (5 mois), pas 12 × la mensualité');
    console.log('Test 1 OK — Trésorerie : lignes = CF de l\'année, mensualités proratisées');
}

// --- Test 2 : bloc Fiscal — intérêts dans les charges déductibles uniquement ---
{
    const asset = makeAsset();
    const data = buildRapportAnnuelData([asset], A, opts);
    const cr = computeCompteResultat(asset, A, profileData, 'reel');
    assert.equal(data.fiscal.chargesDeductibles, cr.chargesDeductibles);
    assert.equal(data.fiscal.interetsEtAssurance, cr.interetsAnnee + cr.assuranceAnnee);
    const texte = buildRapportAnnuelTexte(data);
    const blocTreso = texte.slice(texte.indexOf('TRÉSORERIE'), texte.indexOf('FISCAL'));
    assert.ok(!/Charges déductibles/.test(blocTreso), 'les charges déductibles (avec intérêts) ne sont pas dans la trésorerie');
    assert.match(texte, /dont intérêts et assurance d'emprunt/, 'les intérêts sont signalés dans le bloc fiscal');
    console.log('Test 2 OK — Fiscal séparé de la trésorerie (plus de double compte visuel des intérêts)');
}

// --- Test 3 : signes — jamais « -- », une économie d'impôt s'affiche en + ---
{
    const data = buildRapportAnnuelData([makeAsset()], A, opts);
    assert.ok(data.tresorerie.impots < 0, 'précondition : déficit foncier → économie d\'impôt');
    const texte = buildRapportAnnuelTexte(data);
    assert.ok(!/--\d/.test(texte) && !/-\s?-/.test(texte.replace(/[═─]/g, '')), 'aucun double signe');
    assert.ok(!/-0 €/.test(texte), 'jamais « -0 € »');
    assert.match(texte, /Impôt estimé.*\+[\d  ]+ € \(économie\)/, 'économie d\'impôt affichée en positif');
    console.log('Test 3 OK — signes : pas de « -- », économie d\'impôt en +');
}

// --- Test 4 : CRD réel en fin d'année, patrimoine net « non renseigné » sans valeur estimée ---
{
    const asset = makeAsset();
    const data = buildRapportAnnuelData([asset], A, opts);
    const { schedule } = computeAmortizationSchedule(94182, 4, 25, `${A}-08`, 0.485, 'crd');
    const crdFin = schedule.find(r => r.annee === A).crdFin;
    assert.ok(Math.abs(data.patrimoine.crdTotal - crdFin) < 0.01, 'CRD = échéancier fin d\'année (et non 0 faute de valeur estimée)');
    assert.equal(data.patrimoine.patrimoineNet, null);
    const texte = buildRapportAnnuelTexte(data);
    assert.match(texte, /Patrimoine net\s*: non renseigné/);
    assert.match(texte, new RegExp(`Capital restant dû \\(fin ${A}\\)\\s*: -${Math.round(crdFin).toLocaleString('fr-FR')} €`));

    const value = buildRapportAnnuelData([makeAsset({ acquisition: { ...makeAsset().acquisition, valeurEstimee: 120000 } })], A, opts);
    assert.ok(Math.abs(value.patrimoine.patrimoineNet - (120000 - crdFin)) < 0.01, 'patrimoine net = valeur − CRD fin d\'année');
    console.log('Test 4 OK — CRD réel, patrimoine « non renseigné » / valeur − CRD');
}

// --- Test 5 : deux CF libellés par leur base ; bien acquis après l'année exclu ---
{
    const futur = makeAsset({ id: 'b2', nom: 'Futur', dateAchat: `${Y}-01` });
    const data = buildRapportAnnuelData([makeAsset(), futur], A, opts);
    assert.equal(data.biens.length, 1, 'un bien acheté après l\'année du rapport n\'y figure pas');
    const texte = buildRapportAnnuelTexte(data);
    assert.match(texte, /CF net-net mensuel moyen \(année ÷ 12\)/);
    assert.match(texte, /au rythme actuel/);
    assert.match(texte, /détenu 5 mois/);
    assert.match(texte, /1 bien acquis après/);
    console.log('Test 5 OK — CF libellés par leur base, biens postérieurs exclus');
}

// --- Test 7 : bloc Fiscal en micro-foncier — abattement 30 %, aucune charge ni intérêt déductible ---
{
    const data = buildRapportAnnuelData([makeAsset()], A, { ...opts, regime: 'micro-foncier' });
    const texte = buildRapportAnnuelTexte(data);
    const bloc = texte.slice(texte.indexOf('FISCAL'), texte.indexOf('PAR BIEN'));
    const recettes = data.fiscal.recettes;
    assert.match(bloc, /Abattement forfaitaire 30 %/);
    assert.match(bloc, new RegExp(`Base imposable \\(70 % des recettes\\)\\s*: ${Math.round(recettes * 0.7).toLocaleString('fr-FR')} €`));
    for (const absent of [/Charges déductibles/, /intérêts et assurance d'emprunt/, /Résultat foncier/, /charge déductible/]) {
        assert.ok(!absent.test(bloc), `micro-foncier : ${absent} ne doit pas apparaître`);
    }
    console.log('Test 7 OK — micro-foncier : recettes, abattement 30 %, base 70 %, pas de charges ni intérêts');
}

// --- Test 8 : bloc Fiscal en SCI-IS — base non calculée (pas d'amortissement), aucun chiffre ---
{
    const texte = buildRapportAnnuelTexte(buildRapportAnnuelData([makeAsset()], A, { ...opts, regime: 'sci-is' }));
    const bloc = texte.slice(texte.indexOf('FISCAL'), texte.indexOf('PAR BIEN'));
    assert.match(bloc, /Base imposable\s*: non calculée par l'application/);
    assert.match(bloc, /amortissement/);
    for (const absent of [/Charges déductibles/, /Résultat foncier/, /Abattement/, /Base imposable[^:]*:\s*[\d+-]/]) {
        assert.ok(!absent.test(bloc), `SCI-IS : ${absent} ne doit pas apparaître`);
    }
    console.log('Test 8 OK — SCI-IS : base imposable non calculée, comme la modale Déclaration');
}

// --- Test 9 : foncier réel inchangé (charges déductibles, intérêts, résultat foncier) ---
{
    const texte = buildRapportAnnuelTexte(buildRapportAnnuelData([makeAsset()], A, opts));
    const bloc = texte.slice(texte.indexOf('FISCAL'), texte.indexOf('PAR BIEN'));
    for (const present of [/Charges déductibles/, /dont intérêts et assurance d'emprunt/, /Résultat foncier/, /Base imposable \(Foncier réel\)/]) {
        assert.match(bloc, present);
    }
    assert.ok(!/Abattement/.test(bloc));
    console.log('Test 9 OK — foncier réel : bloc inchangé');
}

// --- Test 6 : portefeuille vide ---
{
    const texte = buildRapportAnnuelTexte(buildRapportAnnuelData([], A, opts));
    assert.match(texte, /Aucun bien/);
    console.log('Test 6 OK — portefeuille vide');
}

console.log('\nTous les tests rapport-annuel OK');
