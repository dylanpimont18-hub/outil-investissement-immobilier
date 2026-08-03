import assert from 'node:assert/strict';
import {
    computeAmortizationSchedule, computeOwnedAssetTimeline, computeCFBreakdown,
    computeOwnedAssetCF, computeCompteResultat, parseDateAchat, computePatrimoineNet,
    computeEndettementGlobal
} from '../calculs.js';

// Bug signalé : le moteur supposait que tout crédit démarre en janvier. dateAchat ('YYYY-MM')
// remplace l'ancien anneeAchat (année seule) pour permettre un début de crédit en cours d'année —
// la première (et potentiellement la dernière) année d'amortissement devient alors une tranche
// partielle de moins de 12 mois, au lieu d'être comptée comme une année pleine.

const tmi = 30;

function makeAsset({ prix = 150000, loyer = 900, dateAchat, credit } = {}) {
    return {
        id: 'test-mi-annee',
        dateAchat,
        acquisition: {
            prix, fraisAgence: 0, fraisNotaire: 0, loyerInitial: loyer,
            credit
        },
        postAchat: {
            taxeFonciere: 0, chargesCopro: 0, gestionLocative: 0, assurancePNO: 0,
            vacance: 0, travaux: [], chargesAnnuelles: [], notes: []
        }
    };
}

// --- Test 1 : parseDateAchat — 'YYYY-MM', année brute, et valeur absente ---
{
    assert.deepEqual(parseDateAchat('2024-06'), { annee: 2024, mois: 6 }, 'doit parser YYYY-MM');
    assert.deepEqual(parseDateAchat(2024), { annee: 2024, mois: 1 }, 'année brute (legacy) doit résoudre en janvier');
    assert.deepEqual(parseDateAchat('2024'), { annee: 2024, mois: 1 }, 'année brute en chaîne doit aussi résoudre en janvier');
    const fallback = parseDateAchat(null);
    assert.equal(fallback.mois, 1, 'valeur absente doit résoudre en janvier');
    assert.equal(fallback.annee, new Date().getFullYear(), 'valeur absente doit résoudre à l\'année courante');
    console.log('Test 1 OK — parseDateAchat gère YYYY-MM, année brute (legacy) et valeur absente');
}

// --- Test 2 : computeAmortizationSchedule — démarrage en juin, 1ère année = 7 mois seulement ---
{
    const { schedule: scheduleJuin } = computeAmortizationSchedule(120000, 3, 10, '2024-06', 0, 'initial');
    const { schedule: scheduleJanvier } = computeAmortizationSchedule(120000, 3, 10, '2024-01', 0, 'initial');
    const y2024 = scheduleJuin.find(r => r.annee === 2024);
    assert.ok(y2024, 'une ligne 2024 doit exister');
    assert.equal(y2024.crdDebut, 120000, 'le CRD de départ doit être le capital initial, peu importe le mois de démarrage');

    // Les 7 premiers mois (juin→décembre) pèsent forcément moins que les 12 premiers mois d'un
    // prêt démarré en janvier — l'intérêt est à son maximum en tout début de prêt (CRD au plus
    // haut), donc 7 mois ne peuvent jamais dépasser 12 mois d'intérêts sur le même prêt.
    const y2024Janvier = scheduleJanvier.find(r => r.annee === 2024);
    assert.ok(y2024.interets < y2024Janvier.interets, `7 mois d'intérêts (${y2024.interets}€) doit être < 12 mois d'intérêts sur le même prêt (${y2024Janvier.interets}€)`);
    assert.ok(y2024.capital < y2024Janvier.capital, `7 mois de capital remboursé (${y2024.capital}€) doit être < 12 mois (${y2024Janvier.capital}€)`);

    // Le total des intérêts sur toute la durée du prêt ne dépend que du montant/taux/durée, pas du
    // mois calendaire de départ — c'est le même prêt, juste découpé différemment en années civiles.
    const totalInteretsJuin = scheduleJuin.reduce((s, r) => s + r.interets, 0);
    const totalInteretsJanvier = scheduleJanvier.reduce((s, r) => s + r.interets, 0);
    assert.ok(Math.abs(totalInteretsJuin - totalInteretsJanvier) <= scheduleJuin.length, `le total des intérêts sur toute la durée doit être identique quel que soit le mois de départ (juin=${totalInteretsJuin}€, janvier=${totalInteretsJanvier}€)`);

    console.log('Test 2 OK — 1ère année partielle (juin→décembre = 7 mois) : intérêts', y2024.interets, '€ < 12 mois (', y2024Janvier.interets, '€) ; total identique sur la durée du prêt (', totalInteretsJuin, '€ ≈', totalInteretsJanvier, '€)');
}

// --- Test 3 : computeAmortizationSchedule — la dernière année est aussi partielle ---
{
    // Prêt de 2 ans démarré en septembre 2024 → se termine fin août 2026 (24 mois : sept-déc 2024
    // = 4 mois, 2025 = 12 mois pleins, jan-août 2026 = 8 mois).
    const { schedule } = computeAmortizationSchedule(24000, 3, 2, '2024-09', 0, 'initial');
    const years = schedule.map(r => r.annee);
    assert.deepEqual(years, [2024, 2025, 2026], 'doit produire exactement 3 lignes (1ère et dernière partielles)');
    const y2026 = schedule.find(r => r.annee === 2026);
    assert.equal(y2026.crdFin, 0, 'le crédit doit être totalement soldé fin août 2026');
    console.log('Test 3 OK — dernière année partielle (jan→août 2026), CRD final =', y2026.crdFin, '€');
}

// --- Test 4 : computeOwnedAssetTimeline — le CF de l'année d'achat ne compte que les mois actifs ---
{
    const credit = { montant: 120000, duree: 10, taux: 3, assurance: 0 };
    const assetJanvier = makeAsset({ dateAchat: '2024-01', credit });
    const assetJuin = makeAsset({ dateAchat: '2024-06', credit });

    const { years: yearsJanvier } = computeOwnedAssetTimeline(assetJanvier, tmi, 'micro-foncier');
    const { years: yearsJuin } = computeOwnedAssetTimeline(assetJuin, tmi, 'micro-foncier');

    const cf2024Janvier = yearsJanvier.find(y => y.year === 2024).cfAnnuel;
    const cf2024Juin = yearsJuin.find(y => y.year === 2024).cfAnnuel;

    // Démarré en juin, la dette 2024 ne pèse que 7 mois au lieu de 12 → le CF 2024 doit être
    // strictement meilleur (moins de mensualités payées cette année-là) que le scénario janvier.
    assert.ok(cf2024Juin > cf2024Janvier, `CF 2024 démarré en juin (${Math.round(cf2024Juin)}€) doit être meilleur que démarré en janvier (${Math.round(cf2024Janvier)}€) — moins de mensualités payées`);

    // Mais l'année suivante (2025), les deux ont 12 mois pleins de crédit : le CF doit être identique.
    const cf2025Janvier = yearsJanvier.find(y => y.year === 2025).cfAnnuel;
    const cf2025Juin = yearsJuin.find(y => y.year === 2025).cfAnnuel;
    assert.ok(Math.abs(cf2025Janvier - cf2025Juin) < 1, `2025 (année pleine dans les deux cas) doit donner le même CF, trouvé ${cf2025Janvier} vs ${cf2025Juin}`);
    console.log('Test 4 OK — CF 2024 (achat en juin) =', Math.round(cf2024Juin), '€ > CF 2024 (achat en janvier) =', Math.round(cf2024Janvier), '€ ; 2025 identique dans les deux cas');
}

// --- Test 5 : computeCFBreakdown — creditDetail (intérêts/capital/assurance) cohérent avec mensualiteCredit ---
{
    const credit = { montant: 100000, duree: 15, taux: 3.2, assurance: 0.3, assuranceMode: 'crd' };
    const asset = makeAsset({ dateAchat: '2023-04', credit });
    const bd = computeCFBreakdown(asset, tmi, 'micro-foncier', 2); // targetYear=2 => année civile 2024, pleine
    assert.ok(bd.creditDetail, 'creditDetail doit être exposé');
    const sommeDetail = bd.creditDetail.interets + bd.creditDetail.capital + bd.creditDetail.assurance;
    assert.ok(Math.abs(sommeDetail - bd.mensualiteCredit) <= 1, `interets+capital+assurance (${sommeDetail}) doit égaler mensualiteCredit (${bd.mensualiteCredit}) à l'arrondi près`);
    console.log('Test 5 OK — creditDetail cohérent : intérêts', bd.creditDetail.interets, '+ capital', bd.creditDetail.capital, '+ assurance', bd.creditDetail.assurance, '=', sommeDetail, '≈ mensualiteCredit', bd.mensualiteCredit);
}

// --- Test 6 : computeOwnedAssetCF lit le MOIS civil courant de l'échéancier (pas seulement
// "l'année a une ligne") : un crédit démarré il y a des années et encore loin d'être soldé doit
// être actif ; un crédit démarré il y a des années et déjà totalement remboursé depuis longtemps
// ne doit plus peser sur le CF courant. Ancrés sur des marges de plusieurs années pour rester vrais
// quel que soit le mois civil réel d'exécution du test (pas de dépendance au calendrier).
{
    const now = new Date();
    const anneeDemarrageActif = now.getFullYear() - 3;
    const moisDemarrage = String(((now.getMonth() + 6) % 12) + 1).padStart(2, '0'); // décalé du mois courant, sans intérêt particulier
    const creditActifLoin = { montant: 120000, duree: 15, taux: 3, assurance: 0 };
    const assetActif = makeAsset({ dateAchat: `${anneeDemarrageActif}-${moisDemarrage}`, credit: creditActifLoin });
    const rActif = computeOwnedAssetCF(assetActif, {}, tmi);
    assert.ok(rActif.mensualiteTotale > 0, `un crédit démarré il y a 3 ans sur 15 ans doit être détecté actif ce mois-ci (mensualiteTotale=${rActif.mensualiteTotale})`);

    const anneeDemarrageSolde = now.getFullYear() - 10;
    const creditSolde = { montant: 12000, duree: 2, taux: 3, assurance: 0 };
    const assetSolde = makeAsset({ dateAchat: `${anneeDemarrageSolde}-${moisDemarrage}`, credit: creditSolde });
    const rSolde = computeOwnedAssetCF(assetSolde, {}, tmi);
    assert.equal(rSolde.mensualiteTotale, 0, `un crédit de 2 ans démarré il y a 10 ans doit être détecté soldé ce mois-ci (mensualiteTotale=${rSolde.mensualiteTotale})`);

    console.log('Test 6 OK — crédit encore actif (démarré il y a 3 ans/15 ans) : mensualiteTotale =', Math.round(rActif.mensualiteTotale), '€/mois ; crédit soldé (démarré il y a 10 ans/2 ans) : mensualiteTotale =', rSolde.mensualiteTotale, '€/mois');
}

// --- Test 7 : computeOwnedAssetTimeline — le LOYER de l'année d'achat doit aussi être proratisé
// (bug signalé : le crédit démarre bien au mois d'achat, mais le loyer était compté sur 12 mois
// pleins dès l'année d'achat, comme si le bien était loué depuis janvier).
{
    const credit = { montant: 120000, duree: 10, taux: 3, assurance: 0 };
    const assetJuin = makeAsset({ loyer: 900, dateAchat: '2024-06', credit });
    const { years } = computeOwnedAssetTimeline(assetJuin, tmi, 'micro-foncier');
    const row2024 = years.find(y => y.year === 2024);

    // Acheté en juin : seuls juin→décembre (7 mois) doivent compter, soit 900*7 = 6300 €,
    // pas 900*12 = 10800 € (loyer d'une année pleine).
    const loyerAttendu7Mois = 900 * 7;
    assert.ok(Math.abs(row2024.loyersAnnuels - loyerAttendu7Mois) < 1, `loyer 2024 (achat juin) doit être proratisé à 7 mois (${loyerAttendu7Mois}€), trouvé ${row2024.loyersAnnuels}€`);
    assert.ok(row2024.loyersAnnuels < 900 * 12, `loyer 2024 ne doit pas compter une année pleine (900*12=${900 * 12}€), trouvé ${row2024.loyersAnnuels}€`);

    console.log('Test 7 OK — loyer 2024 (achat en juin) proratisé à 7 mois =', row2024.loyersAnnuels, '€ (au lieu de', 900 * 12, '€ pour une année pleine)');
}

// --- Test 8 : computeCFBreakdown — même proratisation du loyer sur la vue détaillée (Exploitation) ---
{
    const credit = { montant: 120000, duree: 10, taux: 3, assurance: 0 };
    const assetJuin = makeAsset({ loyer: 900, dateAchat: '2024-06', credit });
    const bd = computeCFBreakdown(assetJuin, tmi, 'micro-foncier', 1); // targetYear=1 => année d'achat, 2024
    const loyerAttendu7Mois = 900 * 7;
    assert.ok(Math.abs(bd.loyersEncaisses - loyerAttendu7Mois) < 1, `loyersEncaisses (détail exploitation) doit être proratisé à 7 mois (${loyerAttendu7Mois}€), trouvé ${bd.loyersEncaisses}€`);
    console.log('Test 8 OK — computeCFBreakdown proratise aussi le loyer de l\'année d\'achat =', bd.loyersEncaisses, '€');
}

// --- Test 9 : computeCompteResultat — le loyer de l'année d'achat doit aussi être proratisé
// (même bug que Test 7/8, mais dans computeCompteResultat cette fois — qui alimente aussi
// computeDeclaration2044, donc le pré-remplissage de la vraie 2044 était faussé pour l'année d'achat).
{
    const credit = { montant: 120000, duree: 10, taux: 3, assurance: 0 };
    const assetJuin = makeAsset({ loyer: 900, dateAchat: '2024-06', credit });
    const cr = computeCompteResultat(assetJuin, 2024, tmi, 'micro-foncier');
    const loyerAttendu7Mois = 900 * 7;
    assert.ok(Math.abs(cr.loyersTheoriques - loyerAttendu7Mois) < 1, `loyersTheoriques (compte de resultat) doit être proratisé à 7 mois (${loyerAttendu7Mois}€), trouvé ${cr.loyersTheoriques}€`);
    console.log('Test 9 OK — computeCompteResultat proratise aussi le loyer de l\'année d\'achat =', cr.loyersTheoriques, '€ (au lieu de', 900 * 12, '€ pour une année pleine)');
}

// --- Test 10 : computePatrimoineNet — le CRD est interpolé au mois courant, pas figé au 1er janvier ---
{
    const now = new Date();
    // Crédit démarré il y a 5 ans, sur 20 ans : largement en cours, capital qui décroît chaque mois.
    const dateAchat = `${now.getFullYear() - 5}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const credit = { montant: 100000, duree: 20, taux: 3, assurance: 0 };
    const asset = { acquisition: { valeurEstimee: 150000, credit }, dateAchat };
    const { crd } = computePatrimoineNet(asset);

    // CRD théorique via l'échéancier mensuel, au mois exact (source de vérité indépendante).
    const { scheduleMonthly } = computeAmortizationSchedule(100000, 3, 20, dateAchat);
    const nowKey = now.getFullYear() * 12 + (now.getMonth() + 1);
    const rowAttendue = scheduleMonthly.find(r => (r.annee * 12 + r.mois) === nowKey);
    assert.equal(crd, rowAttendue.crdDebut, `crd doit correspondre au CRD du mois civil courant (attendu ${rowAttendue.crdDebut}€), trouvé ${crd}€`);

    // Le CRD au 1er janvier de l'année en cours (ancien comportement bugué) doit être strictement
    // supérieur, sauf si "maintenant" est justement janvier.
    if (now.getMonth() > 0) {
        const { schedule } = computeAmortizationSchedule(100000, 3, 20, dateAchat);
        const yearRow = schedule.find(r => r.annee === now.getFullYear());
        assert.ok(crd < yearRow.crdDebut, `crd interpolé au mois (${crd}€) doit être < CRD au 1er janvier (${yearRow.crdDebut}€) puisqu'on n'est pas en janvier`);
    }
    console.log('Test 10 OK — computePatrimoineNet interpole le CRD au mois courant =', crd, '€');
}

// --- Test 11 : computeOwnedAssetCF / computeEndettementGlobal — assurance dégressive lue au mois
// courant de l'échéancier, pas diluée par une division /12 d'un total d'année civile partielle ---
{
    const now = new Date();
    const dateAchatPartiel = `${now.getFullYear()}-${String(Math.max(1, now.getMonth())).padStart(2, '0')}`; // le mois dernier
    const credit = { montant: 100000, duree: 20, taux: 3, assurance: 0.3, assuranceMode: 'crd' };
    const asset = makeAsset({ dateAchat: dateAchatPartiel, credit });

    const { scheduleMonthly } = computeAmortizationSchedule(100000, 3, 20, dateAchatPartiel, 0.3, 'crd');
    const nowKey = now.getFullYear() * 12 + (now.getMonth() + 1);
    const rowCourant = scheduleMonthly.find(r => (r.annee * 12 + r.mois) === nowKey);

    const r = computeOwnedAssetCF(asset, {}, tmi);
    // mensualiteTotale (crédit + assurance) doit correspondre à intérêts+capital+assurance du mois
    // civil courant tel que sorti de l'échéancier — pas à yearRow.assurance/12 (dilué sur une année
    // civile partielle, sous-estimant l'assurance réelle).
    const mensualiteAttendue = rowCourant.interets + rowCourant.capital + rowCourant.assurance;
    assert.ok(Math.abs(r.mensualiteTotale - mensualiteAttendue) <= 1, `mensualiteTotale (${r.mensualiteTotale}€) doit correspondre au mois courant de l'échéancier (${mensualiteAttendue}€ = ${rowCourant.interets}+${rowCourant.capital}+${rowCourant.assurance})`);

    const endettement = computeEndettementGlobal([asset], 5000);
    assert.ok(Math.abs(endettement.totalMensualites - mensualiteAttendue) <= 1, `computeEndettementGlobal (${endettement.totalMensualites}€) doit lui aussi correspondre au mois courant (${mensualiteAttendue}€)`);
    console.log('Test 11 OK — assurance du mois courant =', Math.round(rowCourant.assurance), '€, mensualiteTotale computeOwnedAssetCF =', Math.round(r.mensualiteTotale), '€/mois ≈ computeEndettementGlobal =', Math.round(endettement.totalMensualites), '€/mois');
}

// --- Test 12 : taxe foncière/PNO/charges copro proratisées sur l'année d'achat, comme le loyer
// (bug signalé par l'utilisateur sur un cas réel — "70 rue du mouton" : la taxe foncière/PNO en
// année pleine contre un loyer proratisé à quelques mois creusait artificiellement le CF/résultat
// affiché de l'année d'achat). Sans crédit pour isoler l'effet des seules charges annuelles.
{
    const assetJuin = {
        id: 'test-charges', nom: 'Test charges proratisées', dateAchat: '2024-06',
        acquisition: { prix: 150000, fraisAgence: 0, fraisNotaire: 0, loyerInitial: 900 },
        postAchat: {
            taxeFonciere: 1200, chargesCopro: 50, assurancePNO: 240, gestionLocative: 0,
            vacance: 0, travaux: [], chargesAnnuelles: [], notes: []
        }
    };

    const cr2024 = computeCompteResultat(assetJuin, 2024, tmi, 'reel');
    assert.ok(Math.abs(cr2024.taxeFonciere - 700) < 1, `taxe foncière 2024 (achat juin, 7 mois) doit être proratisée à 700€ (1200×7/12), trouvé ${cr2024.taxeFonciere}€`);
    assert.ok(Math.abs(cr2024.chargesCopro - 350) < 1, `charges copro 2024 doivent être proratisées à 350€ (50×7), trouvé ${cr2024.chargesCopro}€`);
    assert.ok(Math.abs(cr2024.assurancePNO - 140) < 1, `assurance PNO 2024 doit être proratisée à 140€ (240×7/12), trouvé ${cr2024.assurancePNO}€`);

    const cr2025 = computeCompteResultat(assetJuin, 2025, tmi, 'reel');
    assert.equal(cr2025.taxeFonciere, 1200, `taxe foncière 2025 (année pleine) doit rester 1200€, trouvé ${cr2025.taxeFonciere}€`);
    assert.equal(cr2025.chargesCopro, 600, `charges copro 2025 (année pleine) doivent rester 600€ (50×12), trouvé ${cr2025.chargesCopro}€`);

    const { years } = computeOwnedAssetTimeline(assetJuin, tmi, 'reel');
    const row2024 = years.find(y => y.year === 2024);
    // Même proratisation appliquée à computeOwnedAssetTimeline (pas seulement computeCompteResultat) :
    // loyer 7 mois (6300€) − charges proratisées (700+350+140=1190€), taxées à tmi(30%)+CSG(17,2%).
    const cfAnnuelAttendu = 6300 - 1190 - (6300 - 1190) * (0.30 + 0.172);
    assert.ok(Math.abs(row2024.cfAnnuel - cfAnnuelAttendu) < 1, `cfAnnuel 2024 attendu ${cfAnnuelAttendu.toFixed(2)}€ (charges proratisées), trouvé ${row2024.cfAnnuel}€`);

    console.log('Test 12 OK — taxe foncière/PNO/copro proratisées sur l\'année d\'achat : 2024 (7 mois) =', cr2024.taxeFonciere, '€/', cr2024.chargesCopro, '€/', cr2024.assurancePNO, '€ vs 2025 (année pleine) =', cr2025.taxeFonciere, '€/', cr2025.chargesCopro, '€');
}

console.log('\nTous les tests crédit mi-année passent.');
