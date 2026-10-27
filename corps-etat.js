// Factures décortiquées par corps d'état (2026-10-27) : chaque frais avec justificatif reçoit un
// champ `detail` = articles lus par l'IA (Cloud Function decortiquerFacture), regroupés ici par
// corps d'état pour la sous-vue « Par corps d'état » de l'onglet Travaux. Vue de lecture : rien
// ici n'entre dans les calculs de cash-flow ou d'impôt. Voir
// docs/superpowers/specs/2026-10-27-factures-par-corps-etat-design.md.
//
// Module pur : aucun accès DOM ni réseau. Testé par tests/test_corps_etat.mjs.
//
// Forme d'un frais décortiqué :
//   detail: { statut: 'ok'|'partiel'|'echec', analyseLe: 'AAAA-MM-JJ', pages, raison?,
//             articles: [{ d, q, pu, t, ce, mo, ceManuel }] }
// `ce` = clé de CORPS_ETAT ou libellé libre proposé par l'IA quand aucun ne convient.

export const CORPS_ETAT = [
    { cle: 'electricite', libelle: 'Électricité' },
    { cle: 'plomberie', libelle: 'Plomberie / sanitaires' },
    { cle: 'chauffage', libelle: 'Chauffage / ventilation' },
    { cle: 'platrerie', libelle: 'Plâtrerie / isolation' },
    { cle: 'peinture', libelle: 'Peinture / murs' },
    { cle: 'sols', libelle: 'Sols (carrelage, parquet)' },
    { cle: 'menuiserie', libelle: 'Menuiserie (portes, fenêtres)' },
    { cle: 'cuisine', libelle: 'Cuisine / électroménager' },
    { cle: 'maconnerie', libelle: 'Maçonnerie / gros œuvre' },
    { cle: 'toiture', libelle: 'Toiture' },
    { cle: 'outillage', libelle: 'Outillage / consommables' },
    { cle: 'divers', libelle: 'Divers' },
];

const CLES = new Set(CORPS_ETAT.map(c => c.cle));
const LIBELLES = Object.fromEntries(CORPS_ETAT.map(c => [c.cle, c.libelle]));

export const MAX_ARTICLES = 200;
// Écart articles / montant du frais en dessous duquel on ne montre rien (arrondis de centimes).
export const SEUIL_ECART = 1;

const sansAccents = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const cleTexte = s => sansAccents(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const arrondi2 = n => Math.round(n * 100) / 100;

export function libelleCorpsEtat(ce) {
    return LIBELLES[ce] || String(ce || '') || LIBELLES.divers;
}

export function estCorpsEtatListe(ce) {
    return CLES.has(ce);
}

// Clé de la liste, ou libellé libre propre. Une proposition qui correspond (sans accents ni casse)
// à la clé, au libellé ou à son premier terme (« Plomberie » ↔ « Plomberie / sanitaires ») est
// rabattue sur la liste ; sinon sur un libellé libre déjà présent sur le bien (`libresExistants`),
// pour éviter « Piscine » et « piscine » en deux groupes.
export function normaliserCorpsEtat(valeur, libresExistants = []) {
    const brut = String(valeur || '').trim();
    if (!brut) return 'divers';
    if (CLES.has(brut)) return brut;
    const k = cleTexte(brut);
    for (const { cle, libelle } of CORPS_ETAT) {
        const premier = libelle.split(/\s[/(]/)[0];
        if (k === cle || k === cleTexte(libelle) || k === cleTexte(premier)) return cle;
    }
    const existant = libresExistants.find(l => cleTexte(l) === k);
    if (existant) return existant;
    const propre = brut.replace(/\s+/g, ' ').slice(0, 40);
    return propre.charAt(0).toUpperCase() + propre.slice(1);
}

const nombreOuNull = v => {
    const n = typeof v === 'string' ? Number(v.replace(',', '.').replace(/\s/g, '')) : Number(v);
    return v === null || v === undefined || v === '' || !Number.isFinite(n) ? null : n;
};

// Articles bruts de la Cloud Function → articles stockés. Les lignes sans total exploitable sont
// écartées (le total se déduit de quantité × prix unitaire s'il manque). Un total négatif est gardé
// (ligne de remise).
export function nettoyerArticles(brut, libresExistants = []) {
    if (!Array.isArray(brut)) return [];
    const libres = [...libresExistants];
    const out = [];
    for (const a of brut) {
        if (out.length >= MAX_ARTICLES) break;
        if (!a || typeof a !== 'object') continue;
        const d = String(a.designation ?? a.d ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
        if (!d) continue;
        const q = nombreOuNull(a.quantite ?? a.q);
        const pu = nombreOuNull(a.prixUnitaire ?? a.pu);
        let t = nombreOuNull(a.total ?? a.t);
        if (t === null && q !== null && pu !== null) t = q * pu;
        if (t === null) continue;
        const ce = normaliserCorpsEtat(a.corpsEtat ?? a.ce, libres);
        if (!CLES.has(ce) && !libres.includes(ce)) libres.push(ce);
        out.push({
            d,
            q: q === null ? null : arrondi2(q),
            pu: pu === null ? null : arrondi2(pu),
            t: arrondi2(t),
            ce,
            mo: !!(a.mainOeuvre ?? a.mo),
            ceManuel: false,
        });
    }
    return out;
}

// Ré-analyse d'une facture : les reclassements faits à la main sur l'ancienne analyse sont reportés
// sur les nouveaux articles de même désignation (sans accents ni casse). Un article dont la
// désignation a changé perd sa correction mais reste visible.
export function fusionnerReclassements(anciens, nouveaux) {
    const corrections = new Map();
    for (const a of anciens || []) {
        if (a?.ceManuel && !corrections.has(cleTexte(a.d))) corrections.set(cleTexte(a.d), a.ce);
    }
    if (!corrections.size) return nouveaux;
    return nouveaux.map(a => (corrections.has(cleTexte(a.d))
        ? { ...a, ce: corrections.get(cleTexte(a.d)), ceManuel: true }
        : a));
}

// Libellés libres (hors liste) déjà utilisés sur les frais d'un bien.
export function corpsEtatLibres(travaux) {
    const set = new Set();
    for (const t of travaux || []) {
        for (const a of t.detail?.articles || []) if (a.ce && !CLES.has(a.ce)) set.add(a.ce);
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'fr'));
}

const detailExploitable = d => d && (d.statut === 'ok' || d.statut === 'partiel');

// Un justificatif peut être rattaché à plusieurs frais (acompte + solde) : il n'est décortiqué
// qu'une fois, sur le premier frais du groupe qui porte un `detail` (ou le premier tout court).
function groupesParJustificatif(travaux) {
    const map = new Map();
    for (const t of travaux || []) {
        if (!t.pdfFilename) continue;
        if (!map.has(t.pdfFilename)) map.set(t.pdfFilename, []);
        map.get(t.pdfFilename).push(t);
    }
    return map;
}

// Frais à envoyer à l'IA : un par justificatif, sans analyse exploitable (jamais analysé ou en échec).
export function travauxADecortiquer(travaux) {
    const out = [];
    for (const groupe of groupesParJustificatif(travaux).values()) {
        if (groupe.some(t => detailExploitable(t.detail))) continue;
        out.push(groupe.find(t => t.detail) || groupe[0]);
    }
    return out;
}

const refFacture = t => ({ travailId: t.id, date: t.date || '', description: t.description || '', pdfFilename: t.pdfFilename || null });

// Vue « Par corps d'état » d'un bien. `enCours` = ids des frais en cours d'analyse.
// Renvoie { groupes: [{ ce, libelle, total, nbArticles, lignes }], ecarts, nonDetaille, total } ;
// total = somme des montants des frais = Σ groupes + Σ écarts + Σ non détaillé (aux écarts
// d'arrondi sous `seuilEcart` près).
// raison d'un non détaillé : 'sans-justificatif' | 'a-decortiquer' | 'en-cours' | 'echec' | 'aucun-article'.
export function regrouperParCorpsEtat(travaux, { enCours = new Set(), seuilEcart = SEUIL_ECART } = {}) {
    const liste = travaux || [];
    const groupes = new Map();
    const ecarts = { total: 0, lignes: [] };
    const nonDetaille = { total: 0, lignes: [] };
    const ajouterNonDetaille = (t, raison) => {
        const montant = Number(t.montant) || 0;
        nonDetaille.lignes.push({ ...refFacture(t), montant, raison, detailRaison: t.detail?.raison || '' });
        nonDetaille.total += montant;
    };

    for (const t of liste) if (!t.pdfFilename) ajouterNonDetaille(t, 'sans-justificatif');

    for (const groupe of groupesParJustificatif(liste).values()) {
        const porteur = groupe.find(t => detailExploitable(t.detail)) || groupe.find(t => t.detail) || null;
        let raison = null;
        if (groupe.some(t => enCours.has(t.id))) raison = 'en-cours';
        else if (!porteur) raison = 'a-decortiquer';
        else if (porteur.detail.statut === 'echec') raison = 'echec';
        else if (!(porteur.detail.articles || []).length) raison = 'aucun-article';
        if (raison) {
            for (const t of groupe) ajouterNonDetaille(t, raison);
            continue;
        }
        const facture = refFacture(porteur);
        let sommeArticles = 0;
        porteur.detail.articles.forEach((a, index) => {
            if (!groupes.has(a.ce)) groupes.set(a.ce, { ce: a.ce, libelle: libelleCorpsEtat(a.ce), total: 0, nbArticles: 0, lignes: [] });
            const g = groupes.get(a.ce);
            g.lignes.push({ ...a, index, facture });
            g.total += a.t;
            g.nbArticles++;
            sommeArticles += a.t;
        });
        const montantFrais = groupe.reduce((s, t) => s + (Number(t.montant) || 0), 0);
        const ecart = arrondi2(montantFrais - sommeArticles);
        if (Math.abs(ecart) >= seuilEcart) {
            ecarts.lignes.push({ facture, montant: ecart, sommeArticles: arrondi2(sommeArticles), montantFrais, partiel: porteur.detail.statut === 'partiel' });
            ecarts.total += ecart;
        }
        // Écart sous le seuil (centimes d'arrondi) : ignoré, le total affiché reste celui des frais.
    }

    const tri = (a, b) => (a.facture.date || '').localeCompare(b.facture.date || '') || a.facture.travailId.localeCompare(b.facture.travailId) || a.index - b.index;
    const groupesTries = [...groupes.values()]
        .map(g => ({ ...g, total: arrondi2(g.total), lignes: g.lignes.sort(tri) }))
        .sort((a, b) => b.total - a.total || a.libelle.localeCompare(b.libelle, 'fr'));
    ecarts.total = arrondi2(ecarts.total);
    nonDetaille.total = arrondi2(nonDetaille.total);
    nonDetaille.lignes.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const total = arrondi2(liste.reduce((s, t) => s + (Number(t.montant) || 0), 0));
    return { groupes: groupesTries, ecarts, nonDetaille, total };
}

// Reclassement manuel d'un article (copie du detail, l'appelant enregistre).
export function reclasserArticle(detail, index, ce, libresExistants = []) {
    if (!detail?.articles?.[index]) return detail;
    const articles = detail.articles.map((a, i) => (i === index ? { ...a, ce: normaliserCorpsEtat(ce, libresExistants), ceManuel: true } : a));
    return { ...detail, articles };
}
