// Icônes de l'interface (charte unique, audit A7) : une seule famille, SVG en ligne, trait de 1,5 px, bouts et
// angles arrondis, couleur = celle du texte (currentColor), sur une grille de 16 px. Remplace les emoji couleur et
// les glyphes (✦ ✕ ✓ ⚠ ☀ ← → ↑ ↓ ▶ ● ○) qui venaient de trois familles différentes.
//
// Module pur : aucun accès au DOM au chargement, aucune dépendance. Les icônes sont décoratives (aria-hidden) : un
// bouton qui n'a QUE une icône doit porter un aria-label (ou un texte masqué) — vérifié par le scénario A7 de
// tests/playwright/audit-lot3.mjs.
//
// Usage :
//   - dans un gabarit JS :        `${icone('croix')}`
//   - dans index.html/owned.html : <i data-icone="croix"></i>  (remplacé au démarrage par hydraterIcones)
//   - texte + icône sur un nœud existant, sans innerHTML : definirTexteAvecIcone(el, 'coche', texte)

const CHEMINS = {
    maison: '<path d="M2 7 8 2l6 5"/><path d="M3.5 6.2V13a.5.5 0 0 0 .5.5h2.5V10h3v3.5H12a.5.5 0 0 0 .5-.5V6.2"/>',
    immeuble: '<path d="M3.5 14V2.5h6V14M9.5 6h3V14M2.25 14h11.5M5.5 5h2M5.5 7.75h2M5.5 10.5h2"/>',
    'presse-papier': '<rect x="3" y="2.75" width="10" height="11.5" rx="1.25"/><path d="M6 2.75v-.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 .5.5v.5M5.75 7.5h4.5M5.75 10.25h4.5"/>',
    banque: '<path d="M1.75 6.25 8 2.25l6.25 4H1.75ZM3.25 7.5v4.25M6.1 7.5v4.25M9.9 7.5v4.25M12.75 7.5v4.25M1.75 13.5h12.5"/>',
    document: '<path d="M4 1.75h5l3.5 3.5V14a.75.75 0 0 1-.75.75h-7.5A.75.75 0 0 1 3.5 14V2.5A.75.75 0 0 1 4 1.75Z"/><path d="M9 1.75V5.5h3.5M5.5 8.5h5M5.5 11h5"/>',
    image: '<rect x="2" y="2.75" width="12" height="10.5" rx="1.25"/><circle cx="5.75" cy="6.25" r="1.1"/><path d="m2.5 12 3.5-3.25 2.25 2 2-1.75 3.25 3"/>',
    dossier: '<path d="M1.75 4.5a1 1 0 0 1 1-1H6l1.5 1.75h5.75a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H2.75a1 1 0 0 1-1-1V4.5Z"/>',
    etincelle: '<path d="M8 1.75 9.5 6.5 14.25 8 9.5 9.5 8 14.25 6.5 9.5 1.75 8 6.5 6.5 8 1.75Z"/>',
    ampoule: '<path d="M5.75 12.25h4.5M6.5 14.25h3"/><path d="M8 1.75a4.25 4.25 0 0 0-2.4 7.75c.5.4.9.9.9 1.5v.75h3V11c0-.6.4-1.1.9-1.5A4.25 4.25 0 0 0 8 1.75Z"/>',
    crayon: '<path d="m10.75 2.75 2.5 2.5-8 8-3 .5.5-3 8-8Z"/><path d="m9.25 4.25 2.5 2.5"/>',
    loupe: '<circle cx="7" cy="7" r="4.25"/><path d="m10.25 10.25 3.25 3.25"/>',
    outil: '<path d="M10.25 2.25a3.5 3.5 0 0 0-3.1 4.9l-4.4 4.4a1.4 1.4 0 0 0 2 2l4.4-4.4a3.5 3.5 0 0 0 4.9-3.1l-2.1 2.1-1.9-.5-.5-1.9 2.1-2.1a3.5 3.5 0 0 0-1.4-.5Z"/>',
    graphique: '<path d="M2.5 13.5h11M4.5 13.5V8.5M8 13.5V3M11.5 13.5V6"/>',
    engrenage: '<circle cx="8" cy="8" r="2.25"/><path d="M6.7 1.75h2.6l.4 1.7 1.2.7 1.7-.5 1.3 2.2-1.2 1.2v1.4l1.2 1.2-1.3 2.2-1.7-.5-1.2.7-.4 1.7H6.7l-.4-1.7-1.2-.7-1.7.5-1.3-2.2 1.2-1.2V7.3L2.1 6.1l1.3-2.2 1.7.5 1.2-.7.4-1.7Z"/>',
    horloge: '<circle cx="8" cy="8.5" r="5.25"/><path d="M8 5.5v3l2 1M6.5 1.75h3"/>',
    repere: '<path d="M8 14.25s4.5-4 4.5-7.5a4.5 4.5 0 1 0-9 0c0 3.5 4.5 7.5 4.5 7.5Z"/><circle cx="8" cy="6.75" r="1.5"/>',
    soleil: '<circle cx="8" cy="8" r="2.75"/><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1.05 1.05M11.55 11.55l1.05 1.05M3.4 12.6l1.05-1.05M11.55 4.45l1.05-1.05"/>',
    lune: '<path d="M13.25 9.25A5.75 5.75 0 0 1 6.75 2.75a5.75 5.75 0 1 0 6.5 6.5Z"/>',
    croix: '<path d="m3.75 3.75 8.5 8.5M12.25 3.75l-8.5 8.5"/>',
    coche: '<path d="m3 8.5 3.25 3.25L13 4.75"/>',
    alerte: '<path d="M8 2 14.5 13.5h-13L8 2Z"/><path d="M8 6.5v3.25M8 11.75v.01"/>',
    'fleche-droite': '<path d="M2.5 8h11M9.25 3.75 13.5 8l-4.25 4.25"/>',
    'fleche-gauche': '<path d="M13.5 8h-11M6.75 3.75 2.5 8l4.25 4.25"/>',
    'fleche-haut': '<path d="M8 13.5v-11M3.75 6.75 8 2.5l4.25 4.25"/>',
    'fleche-bas': '<path d="M8 2.5v11M3.75 9.25 8 13.5l4.25-4.25"/>',
    'chevron-droit': '<path d="m6 3.5 4.5 4.5L6 12.5"/>',
    'chevron-haut': '<path d="m3.5 10 4.5-4.5 4.5 4.5"/>',
    'chevron-bas': '<path d="m3.5 6 4.5 4.5L12.5 6"/>',
    point: '<circle cx="8" cy="8" r="3" fill="currentColor"/>',
    'point-vide': '<circle cx="8" cy="8" r="3"/>',
};

export const NOMS_ICONES = Object.keys(CHEMINS);

// Balise <svg> de l'icône `nom` (aria-hidden : décorative). `classe` s'ajoute à « icone icone--<nom> ».
export function icone(nom, { classe = '' } = {}) {
    const corps = CHEMINS[nom];
    if (!corps) throw new Error(`Icône inconnue : « ${nom} »`);
    return `<svg class="icone icone--${nom}${classe ? ` ${classe}` : ''}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${corps}</svg>`;
}

// Remplace chaque <i data-icone="nom"></i> de `racine` par l'icône correspondante (balises statiques du HTML).
export function hydraterIcones(racine = document) {
    racine.querySelectorAll('i[data-icone]').forEach(el => { el.outerHTML = icone(el.dataset.icone); });
}

// Met « icône + texte » dans `el` SANS innerHTML (le texte peut venir de l'utilisateur, ex. un nom de fichier).
export function definirTexteAvecIcone(el, nom, texte, { apres = false } = {}) {
    const gabarit = document.createElement('template');
    gabarit.innerHTML = icone(nom);
    const svg = gabarit.content.firstElementChild;
    const t = document.createTextNode(apres ? `${texte} ` : ` ${texte}`);
    el.replaceChildren(...(apres ? [t, svg] : [svg, t]));
}
