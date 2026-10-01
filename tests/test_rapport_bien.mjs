import assert from 'node:assert/strict';
import { computeOwnedAssetTimeline } from '../calculs.js';
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

console.log('\nTous les tests rapport-bien OK');
