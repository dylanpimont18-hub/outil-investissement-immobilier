# Design — Sélecteur type de bien + filtre score scanner

**Date :** 2026-05-26  
**Périmètre :** `main.js`, `index.html`, `scanner.js`, `calculs.js`, `pdf.js`

---

## 1. Sélecteur type de bien

### Champ

- Identifiant : `type-bien`
- Valeur par défaut : `'appartement'`
- Options : `appartement` | `maison` | `immeuble`
- Emplacement : section **"Identité du dossier"** dans `index.html`, aux côtés de `nom-bien`, `ville`, `statut-bien`

### Intégration données

Ajout dans `main.js` :

```js
// VARIABLE_DEFAULTS
'type-bien': 'appartement'

// VARIABLE_KEYS — dérivé automatiquement

// sanitizeVariablesData()
'type-bien': TYPE_BIEN_VALUES.has(rawVariables['type-bien']) ? rawVariables['type-bien'] : 'appartement'
```

### Defaults intelligents par type

Fonction `getTypeBienDefaults(type)` dans `main.js` :

| Champ            | Appartement | Maison | Immeuble |
|------------------|-------------|--------|----------|
| `copro`          | 40          | 0      | 0        |
| `seuil-cf-min`   | 0           | 50     | 150      |
| `seuil-dscr-min` | 1.0         | 1.0    | 1.10     |
| `seuil-vacance-max` | 8        | 8      | 10       |
| `seuil-effort-max`  | 10       | 10     | 12       |
| `gestion`        | 7           | 5      | 8        |

### Comportement lors du changement de type

- Sur un **nouveau dossier vierge** : defaults appliqués silencieusement.
- Sur un **dossier existant** (données saisies) : `confirm()` — "Changer le type réinitialisera les seuils recommandés. Continuer ?" Annulation si refus.
- Détection "dossier existant" : `state.variablesData.prix !== VARIABLE_DEFAULTS.prix || state.variablesData.loyer !== VARIABLE_DEFAULTS.loyer`

### Affichage étiquette

Le type est affiché comme badge coloré partout où le bien est identifié :

- **Cartes comparateur** : badge `type-badge type-badge--{type}` sous le nom du bien
- **Cartes portfolio** : idem
- **Fiche PDF** : ligne supplémentaire "Type de bien" dans le bloc identité
- **Chip de l'onglet actif** (barre supérieure) : icône + libellé court à côté du nom

Labels affichés :
- `appartement` → "Appartement"
- `maison` → "Maison"
- `immeuble` → "Immeuble de rapport"

Couleurs (CSS, cohérent avec design system existant) :
- Appartement : teinte `--neutral` (gris-bleu)
- Maison : teinte `--positive` (vert)
- Immeuble : teinte `--excellent` (or `#C5A059`)

### Fichiers modifiés

| Fichier | Modification |
|---|---|
| `index.html` | Ajout `<select id="type-bien">` dans fieldset Identité |
| `main.js` | `VARIABLE_DEFAULTS`, `sanitizeVariablesData`, `getTypeBienDefaults`, wiring onChange, badges dans les renders comparateur/portfolio/chip |
| `pdf.js` | Ligne "Type de bien" dans bloc identité |
| `styles.css` | Classes `.type-badge`, `.type-badge--appartement/maison/immeuble` |

---

## 2. Filtre score dans le scanner

### État

Deux nouvelles variables de module dans `scanner.js` :

```js
let _scoreMin = 0;
let _scoreMax = 100;
```

### UI

Dans la barre de contrôles du scanner (à côté du sélecteur de nombre de résultats), ajout d'un bloc :

```
Score : [40] ━━━━━━━━━[100]
         min            max
```

Deux `<input type="range" min="0" max="100" step="5">` affichant les valeurs en live. Le min est plafonné au max et vice versa (pas de croisement).

### Logique

Dans `_applyTable()`, filtrage avant le tri :

```js
const filtered = _allResultats.filter(r =>
  r.score == null || (r.score >= _scoreMin && r.score <= _scoreMax)
);
const sorted = [...filtered].sort(...)
```

Les biens sans score (`null`) passent le filtre (comportement non-bloquant).

### Rebind

Les deux `<input type="range">` sont recréés à chaque `_applyTable()` (même pattern que le select d'affichage existant). `_bindTableControls()` gère les événements `input` → mise à jour `_scoreMin`/`_scoreMax` → `_applyTable()`.

### Fichiers modifiés

| Fichier | Modification |
|---|---|
| `scanner.js` | Variables `_scoreMin`/`_scoreMax`, filtre dans `_applyTable()`, rendu des sliders, bind events |

---

## Hors périmètre

- Modification des formules de calcul financier selon le type (pas demandé)
- Profils de seuils personnalisables par l'utilisateur
- Filtre score dans comparateur ou portfolio
