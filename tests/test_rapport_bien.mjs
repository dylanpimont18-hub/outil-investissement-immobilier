import assert from 'node:assert/strict';
import { computeOwnedAssetTimeline, computeOwnedAssetCF, resolveScenarioCourant, resolveTmiFoyer } from '../calculs.js';
import { buildAssetReportData, buildAssetReportHTML, buildAssetReportMarkdown } from '../rapport-bien.js';

// Rapport d'un bien (PDF + Markdown) — spec 2026-10-01 : prévisionnel sur les 10 prochaines années
// civiles (N+1 → N+10) avec CF annuel + CF cumulé depuis aujourd'hui, mêmes données pour le PDF et
// le Markdown (export destiné à être lu par une IA).

const Y = new Date().getFullYear();
const profileData = { income: 50000, adults: 1, children: 0 };

function makeAsset(overrides = {}) {
    return {
        id: 'bien-test',
        nom: 'Appart <b>Lyon</b> | T2',
        ville: 'Lyon',
        codePostal: '69003',
        adresse: '10 rue Test',
        dateAchat: `${Y - 3}-01`,
        acquisition: {
            prix: 150000, fraisAgence: 5000, fraisNotaire: 11000, loyerInitial: 800,
            surface: 40, typeBien: 'appartement',
            credit: { montant: 140000, duree: 20, taux: 2, assurance: 0.3, assuranceMode: 'initial' }
        },
        postAchat: {
            taxeFonciere: 900, chargesCopro: 60, gestionLocative: 0, assurancePNO: 120, vacance: 5,
            travaux: [
                { id: 't1', date: `${Y - 1}-05-10`, description: 'Peinture | salon', montant: 1200, tag: 'deductible' },
                { id: 't2', date: `${Y - 2}-02-01`, description: 'Extension', montant: 3000, tag: 'non-deductible' }
            ],
            chargesAnnuelles: [], notes: []
        },
        scenarios: [{ id: 'realiste', nom: 'Réaliste', variables: { vacance: 5, regime: 'micro-foncier' } }],
        ...overrides
    };
}

// --- Test 1 : horizonYear prolonge la timeline au-delà de la fin du crédit, sans changer le défaut ---
{
    const asset = makeAsset({
        dateAchat: `${Y - 12}-01`,
        acquisition: { ...makeAsset().acquisition, credit: { montant: 100000, duree: 10, taux: 2, assurance: 0, assuranceMode: 'initial' } }
    });
    const parDefaut = computeOwnedAssetTimeline(asset, profileData, 'micro-foncier');
    assert.equal(parDefaut.endYear, Y + 2, 'sans option, la borne reste max(N+2, fin du crédit)');

    const prolonge = computeOwnedAssetTimeline(asset, profileData, 'micro-foncier', { horizonYear: Y + 10 });
    assert.equal(prolonge.endYear, Y + 10, 'horizonYear doit prolonger la timeline');
    assert.equal(prolonge.years.at(-1).year, Y + 10);
    const anneeFuture = prolonge.years.find(y => y.year === Y + 5);
    assert.equal(Math.round(anneeFuture.interetsAnnee), 0, 'crédit soldé : plus aucun intérêt les années prolongées');

    // Les années communes sont identiques : l'option n'altère pas le calcul existant
    for (const y of parDefaut.years) {
        const same = prolonge.years.find(p => p.year === y.year);
        assert.equal(Math.round(same.cfAnnuel), Math.round(y.cfAnnuel), `année ${y.year} inchangée`);
    }
    console.log('Test 1 OK — horizonYear prolonge la timeline sans modifier les années existantes');
}

// --- Test 2 : horizonYear plus court que la borne naturelle ne la raccourcit pas ---
{
    const asset = makeAsset(); // crédit jusqu'à Y+17
    const t = computeOwnedAssetTimeline(asset, profileData, 'micro-foncier', { horizonYear: Y + 1 });
    assert.equal(t.endYear, Y - 3 + 20, 'la fin du crédit reste la borne quand elle est plus lointaine');
    console.log('Test 2 OK — horizonYear ne raccourcit jamais la timeline');
}

// --- Test 3 : données du rapport — 10 années N+1..N+10, cumul depuis 0, totaux ---
{
    const asset = makeAsset();
    const data = buildAssetReportData(asset, { profileData, regime: 'micro-foncier' });

    assert.equal(data.projection.length, 10, '10 années de prévisionnel');
    assert.equal(data.projection[0].year, Y + 1, 'démarre l\'année prochaine');
    assert.equal(data.projection[9].year, Y + 10, 'termine à N+10');

    let cumul = 0;
    for (const p of data.projection) {
        cumul += p.cfAnnuel;
        assert.equal(Math.round(p.cumul), Math.round(cumul), `cumul ${p.year} = somme depuis aujourd'hui`);
    }
    const timeline = computeOwnedAssetTimeline(asset, profileData, 'micro-foncier', { horizonYear: Y + 10 });
    assert.equal(
        Math.round(data.projection[0].cfAnnuel),
        Math.round(timeline.years.find(y => y.year === Y + 1).cfAnnuel),
        'CF annuel identique au moteur de calcul'
    );

    assert.equal(data.acquisition.investissementTotal, 166000);
    assert.equal(data.acquisition.apport, 26000);
    assert.equal(data.travaux.total, 4200);
    assert.equal(data.travaux.totalDeductible, 1200);
    assert.equal(data.travaux.lignes[0].description, 'Peinture | salon', 'travaux triés du plus récent au plus ancien');
    assert.ok(data.actuel.mensualite > 0, 'mensualité du crédit présente');
    console.log('Test 3 OK — données : 10 ans N+1..N+10, cumul, totaux acquisition/travaux');
}

// --- Test 4 : Markdown exploitable par une IA (titres, tableau 10 lignes, échappement des |) ---
{
    const data = buildAssetReportData(makeAsset(), { profileData, regime: 'reel' });
    const md = buildAssetReportMarkdown(data);
    assert.match(md, /^# Rapport du bien — /m, 'titre principal');
    assert.match(md, /## Prévisionnel sur 10 ans/);
    assert.match(md, /## Hypothèses/);
    assert.match(md, /Foncier réel/, 'régime affiché en clair');
    const lignesProjection = md.split('\n').filter(l => new RegExp(`^\\| (${Y + 1}|${Y + 5}|${Y + 10}) \\|`).test(l));
    assert.equal(lignesProjection.length, 3, 'une ligne de tableau par année');
    assert.ok(md.includes('Peinture \\| salon'), 'les | du texte utilisateur sont échappés dans les tableaux');
    assert.ok(!md.includes('<b>'), 'pas de HTML brut dans le Markdown');
    console.log('Test 4 OK — Markdown : structure, 1 ligne par année, | échappés');
}

// --- Test 5 : HTML imprimable — échappement, graphiques SVG, document autonome ---
{
    const data = buildAssetReportData(makeAsset(), { profileData, regime: 'micro-foncier' });
    const { documentHTML, filename } = buildAssetReportHTML(data);
    assert.match(documentHTML, /^<!doctype html>/i, 'document HTML autonome');
    assert.ok(!documentHTML.includes('<b>Lyon</b>'), 'le nom du bien est échappé');
    assert.ok(documentHTML.includes('&lt;b&gt;Lyon&lt;/b&gt;'));
    assert.equal((documentHTML.match(/<svg /g) || []).length, 2, '2 courbes : CF annuel et CF cumulé');
    assert.ok(!/<script/i.test(documentHTML), 'aucun script dans le document imprimé');
    assert.match(filename, /^rapport-appart-b-lyon-b-t2-\d{4}-\d{2}-\d{2}\.pdf$/, `nom de fichier propre (${filename})`);
    console.log('Test 5 OK — HTML : échappé, 2 courbes SVG, sans script, nom de fichier propre');
}

// --- Test 6 : bien sans crédit ni données → pas d'exception, valeurs à 0 ---
{
    const vide = { id: 'v', nom: '', dateAchat: null, acquisition: {}, postAchat: {} };
    const data = buildAssetReportData(vide, { profileData, regime: 'micro-foncier' });
    assert.equal(data.projection.length, 10);
    assert.equal(data.actuel.mensualite, 0);
    assert.doesNotThrow(() => buildAssetReportMarkdown(data));
    assert.doesNotThrow(() => buildAssetReportHTML(data));
    console.log('Test 6 OK — bien vide : aucune exception');
}

// ─── Bilan 2026-10-12 : B2 (vacance unique) et B3 (cascade du rapport = CF affiché) ─────────────
// Bien bâti comme le cas réel du bilan : loyer 675 €, vacance Exploitation 0 % mais scénario
// « réaliste » (éditeur masqué) resté à 5 %, assurance dégressive (CRD), frais ponctuels payés cash
// dans l'année, un frais financé par le crédit principal et un frais avec son propre crédit.
function makeAssetBilan() {
    return {
        id: 'bien-bilan', nom: 'Bien bilan', ville: 'Bourges', codePostal: '18000', adresse: '',
        dateAchat: `${Y - 1}-01`,
        acquisition: {
            prix: 85000, fraisAgence: 0, fraisNotaire: 7000, loyerInitial: 675, surface: 50, typeBien: 'appartement',
            credit: { montant: 94182, duree: 25, taux: 4, assurance: 0.485, assuranceMode: 'crd' }
        },
        postAchat: {
            taxeFonciere: 342, chargesCopro: 50, gestionLocative: 0, assurancePNO: 69, vacance: 0,
            travaux: [
                { id: 'f1', date: `${Y}-01-15`, description: 'Frais de courtage', montant: 1250, tag: 'non-deductible', financeParCredit: false },
                { id: 'f2', date: `${Y}-01-20`, description: 'Taxe foncière prorata', montant: 334, tag: 'deductible', financeParCredit: false },
                { id: 'f3', date: `${Y}-01-25`, description: 'Cuisine (crédit principal)', montant: 4000, tag: 'deductible', financeParCredit: true },
                { id: 'f4', date: `${Y - 1}-03-01`, description: 'Chaudière (crédit dédié)', montant: 6000, tag: 'deductible',
                    credit: { montant: 6000, duree: 5, taux: 3 } }
            ],
            chargesAnnuelles: [], notes: []
        },
        scenarios: [
            { id: 'pessimiste', nom: 'Pessimiste', variables: { vacance: 8, regime: 'micro-foncier' } },
            { id: 'realiste', nom: 'Réaliste', variables: { vacance: 5, regime: 'micro-foncier' } },
            { id: 'optimiste', nom: 'Optimiste', variables: { vacance: 2, regime: 'micro-foncier' } }
        ]
    };
}

// --- Test 7 (B2) : le scénario courant suit la vacance de l'onglet Exploitation ---
{
    const asset = makeAssetBilan();
    const sc = resolveScenarioCourant(asset);
    assert.equal(sc.variables.vacance, 0, 'vacance du scénario courant = postAchat.vacance (0), pas 5');
    assert.equal(sc.variables.regime, 'micro-foncier', 'les autres variables du scénario sont conservées');
    assert.equal(asset.scenarios[1].variables.vacance, 5, 'le scénario stocké (simulateur) n\'est pas modifié');

    const data = buildAssetReportData(asset, { profileData, regime: 'reel' });
    assert.equal(data.actuel.vacancePct, 0, 'le rapport affiche la vacance de l\'onglet Exploitation');
    assert.equal(Math.round(data.actuel.loyerEffectif), 675, 'vacance 0 % → loyer encaissé = loyer');
    assert.ok(!data.hypotheses.some(h => /vacance locative 5 %/.test(h)), 'plus de vacance 5 % cachée dans les hypothèses');

    // Lots (immeuble) : vacance pondérée des lots, comme l'onglet Exploitation
    const immeuble = { ...makeAssetBilan(), lots: [{ loyer: 500, vacance: 0 }, { loyer: 500, vacance: 10 }] };
    assert.equal(resolveScenarioCourant(immeuble).variables.vacance, 5);
    // Bien sans scénario : pas d'exception, vacance Exploitation
    assert.equal(resolveScenarioCourant({ postAchat: { vacance: 3 } }).variables.vacance, 3);
    console.log('Test 7 OK — B2 : une seule vacance (onglet Exploitation) pour les chiffres au rythme actuel');
}

// --- Test 8 (B3) : la cascade du rapport tombe sur le CF avant impôt affiché ---
{
    const asset = makeAssetBilan();
    const regime = 'reel';
    const data = buildAssetReportData(asset, { profileData, regime });
    const c = data.actuel;
    const lignes = c.cascade;
    // Chantier CF unique : la situation actuelle = CF de référence (12 prochains mois, hors frais
    // ponctuels). Avant, une 4e ligne « Frais ponctuels de l'année (÷ 12) » retirait les frais cash.
    assert.ok(Array.isArray(lignes) && lignes.length === 3, 'cascade : loyer, charges, mensualités');
    const somme = lignes.reduce((s, l) => s + l.montant, 0);
    assert.ok(Math.abs(somme - c.cfNet) < 1, `somme des lignes (${somme.toFixed(2)}) = CF avant impôt (${c.cfNet.toFixed(2)})`);
    // Arrondis affichés : la somme des montants arrondis retombe sur le total arrondi à 1 € près
    const sommeArrondie = lignes.reduce((s, l) => s + Math.round(l.montant), 0);
    assert.ok(Math.abs(sommeArrondie - Math.round(c.cfNet)) <= 1, 'somme des lignes affichées = total affiché, à 1 € près');
    assert.ok(!lignes.some(l => /Frais ponctuels/.test(l.label)), 'plus de ligne frais ponctuels : hors CF de référence');

    const tmi = resolveTmiFoyer(profileData, Y);
    const cf = computeOwnedAssetCF(asset, resolveScenarioCourant(asset).variables, tmi, regime, profileData);
    assert.ok(Math.abs(c.mensualite - cf.mensualiteTotale) < 0.01, 'mensualité du rapport = mensualité de computeOwnedAssetCF');
    assert.ok(Math.abs(c.cfNetNet - cf.cfNetNet) < 0.01, 'CF net-net du rapport = CF de référence');
    const ligneMens = lignes.find(l => /Mensualités/.test(l.label));
    assert.ok(Math.abs(-ligneMens.montant - cf.mensualiteTotale) < 0.01, 'la ligne mensualité de la cascade = mensualité affichée');
    assert.match(c.periode, /^12 prochains mois \(\d{2}\/\d{4} – \d{2}\/\d{4}\)$/, 'la période du CF est écrite');
    assert.ok(Math.abs(cf.assuranceMensuelle - c.assuranceMensuelle) < 0.01, 'assurance moyenne exposée');
    assert.ok(cf.assuranceMensuelle > 0, 'assurance emprunteur > 0');

    const md = buildAssetReportMarkdown(data);
    assert.ok(md.includes(`## Situation actuelle (par mois, ${c.periode})`), 'Markdown : période dans le titre');
    const { documentHTML } = buildAssetReportHTML(data);
    assert.ok(documentHTML.includes('12 prochains mois ('), 'HTML : période dans le titre');
    console.log('Test 8 OK — B3 : cascade = CF avant impôt, CF et mensualité identiques à computeOwnedAssetCF (12 prochains mois)');
}

// --- Test 9 : computeOwnedAssetCF n'exige plus de vacance dans le scénario (repli = Exploitation) ---
{
    const asset = makeAssetBilan();
    const tmi = resolveTmiFoyer(profileData, Y);
    const sansVacance = computeOwnedAssetCF(asset, { regime: 'micro-foncier' }, tmi, null, profileData);
    assert.equal(Math.round(sansVacance.loyerEffectif), 675, 'scénario sans vacance → vacance Exploitation (0 %)');
    console.log('Test 9 OK — repli de vacance de computeOwnedAssetCF = onglet Exploitation');
}

console.log('\nTous les tests rapport-bien OK');
