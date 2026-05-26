# Scanner — Tableau tri & affichage configurable

**Date :** 2026-05-26  
**Fichier cible :** `scanner.js`

## Objectif

Remplacer l'affichage figé des 15 meilleurs résultats par un tableau complet, triable et configurable, sans dépendance externe.

---

## Comportement attendu

### Affichage

- Par défaut : 20 biens affichés (au lieu de 15 en dur)
- Sélecteur combiné en haut à droite : `20 biens | 50 biens | 100 biens | Tout (N) | Personnalisé…`
- Quand "Personnalisé…" est sélectionné, un champ `<input type="number">` apparaît inline à côté du select pour saisir un nombre exact
- L'en-tête affiche : `X / N biens affichés — triés par [colonne] [↑/↓]`

### Tri

- Clic sur un en-tête de colonne → tri par cette colonne, ordre décroissant par défaut
- 2e clic sur la même colonne → inverse l'ordre (↑ ↓)
- La colonne active est mise en surbrillance dorée (`#C5A059`) avec une flèche directionnelle ; les autres colonnes affichent `↕` en opacité réduite
- Tri par défaut au chargement : CF net décroissant

### Colonnes triables

| Colonne | Clé de tri | Ordre par défaut |
|---|---|---|
| Prix | `prix` | ↑ croissant |
| Loyer | `loyer_estime` | ↓ décroissant |
| Prix/m² | calculé : `prix / surface` | ↑ croissant |
| Mensualité | `mensualite` | ↑ croissant |
| CF net | `cf_net` | ↓ décroissant |
| CF après impôt | `cf_apres_impot` | ↓ décroissant |
| DSCR | `dscr` | ↓ décroissant |
| Renta brute | `renta_brute` | ↓ décroissant |
| Score IA | `score` | ↓ décroissant |

Les colonnes `#`, `Bien`, `Lien` et `Analyser` ne sont pas triables.

---

## Architecture — changements dans `scanner.js`

### Nouveaux états module-level

```js
let _allResultats = [];        // liste complète reçue de l'API
let _displayedResultats = [];  // liste après tri + slice (référencée par les boutons "Analyser")
let _sortKey = 'cf_net';       // colonne de tri active
let _sortDir = -1;             // -1 = décroissant, 1 = croissant
let _displayCount = 20;        // nombre ou 'all'
```

### Nouvelles fonctions

- `_getVal(r, key)` — retourne la valeur de tri d'une annonce, gère le cas calculé `prix_m2`
- `_applyTable()` — trie `_allResultats`, slices, écrit le HTML dans `#scanner-results`, rebinde les selects
- `_renderTable(resultats)` — stocke dans `_allResultats` et appelle `_applyTable()`

### Listener délégué (bindé une seule fois dans `_bindButtons`)

```js
document.getElementById('scanner-results')?.addEventListener('click', e => {
  const btn = e.target.closest('.scanner-analyser-btn');
  if (!btn) return;
  _analyserBien(_displayedResultats[parseInt(btn.dataset.rank, 10)]);
});
```

Le `data-rank` des boutons Analyser devient l'index dans `_displayedResultats` (0-based).

### `_renderRow(r, rank, idx)`

Signature étendue avec `idx` (index 0-based dans le tableau affiché) pour `data-rank`.

---

## Ce qui ne change pas

- `_analyserBien`, `_chargerBienDansFormulaire`, `_showAnalyserModal` : inchangés
- Format des données reçues de l'API : inchangé
- Styles CSS existants du tableau : inchangés (ajout uniquement de styles inline sur les `<th>`)
