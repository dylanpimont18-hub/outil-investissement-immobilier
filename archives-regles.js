// Règle pure de nommage des archives de l'export du portefeuille (owned-portfolio.js) : nom
// d'archive unique, sans écraser une archive existante. Aucun accès DOM, window ou stockage
// (testée sous Node : tests/test_archives_regles.mjs).

// Même convention que l'ancien server.py : portefeuille-AAAA-MM-JJ.json, puis -1, -2…
export function nomArchiveUnique(base, existants) {
    const pris = new Set(existants || []);
    let nom = `${base}.json`;
    for (let i = 1; pris.has(nom); i++) nom = `${base}-${i}.json`;
    return nom;
}
