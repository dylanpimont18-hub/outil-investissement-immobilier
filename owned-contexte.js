// Contexte partagé du portefeuille biens détenus (découpage d'owned-portfolio.js, audit T7).
//
// `state`, `nodes` et `IS_MOBILE_PAGE` sont ceux de main.js / owned-entry.js, passés PAR RÉFÉRENCE une seule fois par
// initOwnedPortfolio(deps) via definirContexte(). Ils sont exportés en LIAISONS VIVANTES : un module qui écrit
// `import { state, nodes, IS_MOBILE_PAGE } from './owned-contexte.js'` lit toujours la valeur courante (renseignée
// avant le premier rendu), sans avoir à les recevoir en paramètre — le code des fonctions n'a pas changé.
// Un import est en lecture seule : on ne réaffecte jamais `state = …` ailleurs (on modifie `state.xxx`, comme avant).
export let state, nodes, IS_MOBILE_PAGE;

export function definirContexte(deps) {
    state = deps.state;
    nodes = deps.nodes;
    IS_MOBILE_PAGE = !!deps.IS_MOBILE_PAGE;
}
